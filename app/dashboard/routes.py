"""
app/dashboard/routes.py — Web dashboard routes
Overview pengeluaran dengan chart dan tabel filter, dilindungi autentikasi PIN Telegram & Anti-Brute Force.
"""
from datetime import datetime
from urllib.parse import quote
from fastapi import APIRouter, Depends, Request, Query, Form, UploadFile, File, Response
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database.connection import get_db
from app.models.expense import Expense
from app.services.expense_service import (
    get_all_expenses_paginated,
    get_monthly_report,
    get_monthly_leaderboards,
    bulk_check_duplicates,
    batch_insert_expenses,
    make_duplicate_key,
)
from app.services.csv_import_service import parse_csv_file
from app.services.sheets_service import sync_to_sheets
from app.services.ai_service import call_ai_text, get_system_prompt
from app.utils.formatters import fmt_rupiah, fmt_date_id
from app.config import settings
from app.services.dashboard_auth_service import (
    is_authenticated_request,
    get_client_ip,
    generate_and_send_pin,
    verify_pin,
    create_session_token,
    SESSION_COOKIE_NAME,
)
import os

router = APIRouter()
templates = Jinja2Templates(
    directory=os.path.join(os.path.dirname(__file__), "templates")
)


def _is_secure_request(request: Request) -> bool:
    """Cek apakah koneksi melalui HTTPS (langsung atau via reverse proxy)."""
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "").lower()
    return proto == "https"


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_index(
    request: Request,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    category: str = Query(None),
    month: int = Query(None),
    year: int = Query(None),
):
    if not is_authenticated_request(request):
        return RedirectResponse(url="/dashboard/login", status_code=303)

    now = datetime.now()
    current_month = month or now.month
    current_year = year or now.year

    # Data rekap bulan ini
    report = await get_monthly_report(db, current_year, current_month)
    leaderboards = await get_monthly_leaderboards(db, current_year, current_month)

    # List expenses dengan filter + pagination
    expenses, total_count = await get_all_expenses_paginated(
        db,
        page=page,
        per_page=30,
        category=category,
        month=current_month,
        year=current_year,
    )

    # Data untuk chart: per kategori & metode bayar
    chart_labels = list(report["per_kategori"].keys())
    chart_values = [round(v) for v in report["per_kategori"].values()]
    pm_chart_labels = list(report.get("per_metode_bayar", {}).keys())
    pm_chart_values = [round(v) for v in report.get("per_metode_bayar", {}).values()]

    MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
              "Juli","Agustus","September","Oktober","November","Desember"]

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "active_tab": "overview",
            "expenses": expenses,
            "report": report,
            "leaderboards": leaderboards,
            "total_count": total_count,
            "page": page,
            "per_page": 30,
            "total_pages": (total_count + 29) // 30,
            "current_month": current_month,
            "current_year": current_year,
            "month_name": MONTHS[current_month - 1],
            "selected_category": category,
            "valid_categories": settings.valid_categories,
            "chart_labels": chart_labels,
            "chart_values": chart_values,
            "pm_chart_labels": pm_chart_labels,
            "pm_chart_values": pm_chart_values,
            "fmt_rupiah": fmt_rupiah,
            "fmt_date_id": fmt_date_id,
        },
    )


@router.get("/dashboard/login", response_class=HTMLResponse)
async def dashboard_login_page(
    request: Request,
    error: str = Query(None),
    message: str = Query(None),
    sent: int = Query(None),
    logout: int = Query(None),
):
    if is_authenticated_request(request):
        return RedirectResponse(url="/dashboard", status_code=303)

    display_message = message
    if sent == 1 and not display_message:
        display_message = "Kode PIN 6-digit berhasil dikirim ke Telegram! Berlaku selama 5 menit."
    elif logout == 1 and not display_message:
        display_message = "Anda telah berhasil keluar dari dashboard."

    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "error": error,
            "message": display_message,
        },
    )


@router.post("/dashboard/request-pin")
async def dashboard_request_pin(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = get_client_ip(request)
    success, reason = await generate_and_send_pin(db, ip)

    is_json = "application/json" in request.headers.get("accept", "")
    if success:
        if is_json:
            return JSONResponse({"ok": True, "message": reason})
        return RedirectResponse(url="/dashboard/login?sent=1", status_code=303)

    if is_json:
        status_code = 429 if ("tunggu" in reason.lower() or "terlalu banyak" in reason.lower() or "diblokir" in reason.lower()) else 400
        return JSONResponse({"ok": False, "error": reason}, status_code=status_code)

    return RedirectResponse(url=f"/dashboard/login?error={quote(reason)}", status_code=303)


@router.post("/dashboard/verify-pin")
async def dashboard_verify_pin(
    request: Request,
    pin: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    ip = get_client_ip(request)
    success, reason = await verify_pin(db, ip, pin)

    is_json = "application/json" in request.headers.get("accept", "")

    if success:
        token = create_session_token()
        if is_json:
            response = JSONResponse({"ok": True, "redirect": "/dashboard"})
        else:
            response = RedirectResponse(url="/dashboard", status_code=303)

        secure = _is_secure_request(request)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=token,
            max_age=settings.dashboard_session_expire_hours * 3600,
            httponly=True,
            samesite="lax",
            secure=secure,
            path="/",
        )
        return response

    if is_json:
        status_code = 429 if ("diblokir" in reason.lower() or "terlalu banyak" in reason.lower()) else 400
        return JSONResponse({"ok": False, "error": reason}, status_code=status_code)

    return RedirectResponse(url=f"/dashboard/login?error={quote(reason)}", status_code=303)


@router.get("/dashboard/logout")
@router.post("/dashboard/logout")
async def dashboard_logout():
    response = RedirectResponse(url="/dashboard/login?logout=1", status_code=303)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return response


# ──────────────────────────────────────────────
# Halaman Config & Monitoring
# ──────────────────────────────────────────────

@router.get("/dashboard/config", response_class=HTMLResponse)
async def dashboard_config_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
    msg: str = Query(None),
    err: str = Query(None),
):
    if not is_authenticated_request(request):
        return RedirectResponse(url="/dashboard/login", status_code=303)

    # Hitung data database
    total_res = await db.execute(select(func.count(Expense.id)))
    total_expenses = total_res.scalar() or 0

    unsynced_res = await db.execute(
        select(func.count(Expense.id)).where(Expense.sheets_synced == False)  # noqa: E712
    )
    unsynced_count = unsynced_res.scalar() or 0

    # Token & Key Masking
    tg_token = settings.telegram_token
    tg_masked = f"{tg_token[:6]}...{tg_token[-4:]}" if len(tg_token) > 10 else "Terkonfigurasi"

    ai_key = settings.sumopod_api_key
    ai_masked = f"{ai_key[:7]}...{ai_key[-4:]}" if len(ai_key) > 12 else "Terkonfigurasi"

    # Status credentials file
    creds_exist = os.path.exists(settings.google_credentials_json)

    return templates.TemplateResponse(
        "config.html",
        {
            "request": request,
            "active_tab": "config",
            "msg": msg,
            "err": err,
            "total_expenses": total_expenses,
            "unsynced_count": unsynced_count,
            "telegram_token_masked": tg_masked,
            "webhook_url": settings.webhook_url or "Belum diatur di .env",
            "allowed_thread_id": settings.allowed_thread_id,
            "report_chat_id": settings.report_chat_id or "Belum diatur",
            "report_thread_id": settings.report_thread_id,
            "ai_provider": "Sumopod AI",
            "ai_url": settings.sumopod_url,
            "ai_model": settings.sumopod_model,
            "ai_key_masked": ai_masked,
            "system_prompt": get_system_prompt(),
            "spreadsheet_id": settings.spreadsheet_id or "Belum diatur",
            "sheets_creds_path": settings.google_credentials_json,
            "sheets_creds_exists": creds_exist,
            "valid_categories": settings.valid_categories,
        },
    )


@router.post("/dashboard/config/test-ai")
async def dashboard_test_ai(
    request: Request,
    test_text: str = Form(...),
):
    """Test ekstraksi AI langsung dari dashboard untuk verifikasi koneksi dan parsing."""
    if not is_authenticated_request(request):
        return JSONResponse({"ok": False, "error": "Unauthorized"}, status_code=401)

    result = await call_ai_text(test_text.strip())
    is_json = "application/json" in request.headers.get("accept", "")

    if is_json:
        return JSONResponse({"ok": not result.get("error"), "result": result})

    # Jika via form biasa
    if result.get("error"):
        err_msg = quote(f"Error AI: {result.get('message', 'Gagal memproses AI')}")
        return RedirectResponse(url=f"/dashboard/config?err={err_msg}", status_code=303)

    item_count = len(result.get("items", []))
    msg = quote(f"Tes AI Berhasil! {item_count} item terdeteksi dengan model {settings.sumopod_model}.")
    return RedirectResponse(url=f"/dashboard/config?msg={msg}", status_code=303)


@router.post("/dashboard/config/trigger-sheets-sync")
async def dashboard_trigger_sheets_sync(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Trigger sinkronisasi manual ke Google Sheets dari dashboard."""
    if not is_authenticated_request(request):
        return JSONResponse({"ok": False, "error": "Unauthorized"}, status_code=401)

    synced_count = await sync_to_sheets(db)
    is_json = "application/json" in request.headers.get("accept", "")

    if is_json:
        return JSONResponse({"ok": True, "synced_count": synced_count})

    msg = quote(f"Sinkronisasi selesai! {synced_count} baris data berhasil dikirim ke Google Sheets.")
    return RedirectResponse(url=f"/dashboard/config?msg={msg}", status_code=303)


# ──────────────────────────────────────────────
# Halaman Import CSV
# ──────────────────────────────────────────────

@router.get("/dashboard/import", response_class=HTMLResponse)
async def dashboard_import_page(
    request: Request,
):
    if not is_authenticated_request(request):
        return RedirectResponse(url="/dashboard/login", status_code=303)

    return templates.TemplateResponse(
        "import.html",
        {
            "request": request,
            "active_tab": "import",
            "valid_categories": settings.valid_categories,
            "result": None,
        },
    )


@router.post("/dashboard/import", response_class=HTMLResponse)
async def dashboard_import_csv(
    request: Request,
    file: UploadFile = File(...),
    skip_duplicates: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    if not is_authenticated_request(request):
        return RedirectResponse(url="/dashboard/login", status_code=303)

    is_json = "application/json" in request.headers.get("accept", "")

    # Validasi ekstensi
    if not file.filename or not file.filename.lower().endswith(".csv"):
        err_msg = "Format file tidak valid. Harap unggah file dengan format .csv"
        if is_json:
            return JSONResponse({"ok": False, "error": err_msg}, status_code=400)
        return templates.TemplateResponse(
            "import.html",
            {
                "request": request,
                "active_tab": "import",
                "valid_categories": settings.valid_categories,
                "error": err_msg,
                "result": None,
            },
            status_code=400,
        )

    try:
        content = await file.read()
    except Exception as e:
        err_msg = f"Gagal membaca file: {str(e)}"
        if is_json:
            return JSONResponse({"ok": False, "error": err_msg}, status_code=400)
        return templates.TemplateResponse(
            "import.html",
            {
                "request": request,
                "active_tab": "import",
                "valid_categories": settings.valid_categories,
                "error": err_msg,
                "result": None,
            },
            status_code=400,
        )

    # Parse CSV
    parsed = parse_csv_file(content, valid_categories=settings.valid_categories)

    if not parsed.valid_rows and not parsed.skipped_rows:
        err_msg = "File CSV kosong atau tidak memiliki baris data yang bisa dibaca."
        if is_json:
            return JSONResponse({"ok": False, "error": err_msg}, status_code=400)
        return templates.TemplateResponse(
            "import.html",
            {
                "request": request,
                "active_tab": "import",
                "valid_categories": settings.valid_categories,
                "error": err_msg,
                "result": None,
            },
            status_code=400,
        )

    to_insert: list[dict] = []
    skipped_duplicates: list[dict] = []

    if skip_duplicates and parsed.valid_rows:
        dup_keys = await bulk_check_duplicates(db, parsed.valid_rows)
        for item in parsed.valid_rows:
            key = make_duplicate_key(
                item["expense_date"], item["supplier"], item["item_name"], item["total_price"]
            )
            if key in dup_keys:
                skipped_duplicates.append(item)
            else:
                to_insert.append(item)
                # Tambahkan ke set lokal agar tidak duplikat di dalam file itu sendiri
                dup_keys.add(key)
    else:
        to_insert = parsed.valid_rows

    # Simpan batch ke DB dengan sheets_synced=True (karena ini data historis impor)
    inserted_expenses = []
    if to_insert:
        inserted_expenses = await batch_insert_expenses(db, to_insert, sheets_synced=True)
        await db.commit()

    import_result = {
        "inserted_count": len(inserted_expenses),
        "duplicate_count": len(skipped_duplicates),
        "failed_count": len(parsed.skipped_rows),
        "total_rows": parsed.total_rows,
        "failed_rows": parsed.skipped_rows[:50],  # batasi max 50 untuk preview
    }

    if is_json:
        return JSONResponse({"ok": True, "result": import_result}, status_code=201)

    return templates.TemplateResponse(
        "import.html",
        {
            "request": request,
            "active_tab": "import",
            "valid_categories": settings.valid_categories,
            "result": import_result,
            "filename": file.filename,
        },
        status_code=200,
    )


@router.get("/dashboard/import/template")
async def dashboard_download_csv_template(
    request: Request,
):
    """Download template CSV resmi CatatanPengeluaran dengan 15 kolom standar."""
    if not is_authenticated_request(request):
        return RedirectResponse(url="/dashboard/login", status_code=303)

    template_csv = (
        "Timestamp,Tanggal Nota,Toko / Supplier,Barang,Qty,Kategori,Harga Satuan,Tax,Diskon,Total Harga,Metode Bayar,Status Pembayaran,Jatuh Tempo,Keterangan,Link Pesan\r\n"
        "2026-10-01 10:00:00,2026-10-01,Toko Bahan Roti Makmur,Tepung Terigu Cakra 25kg,2,Bahan Kue,260000,0,0,520000,Transfer,Lunas,-,Bahan adonan utama,Private Chat\r\n"
        "2026-10-02 11:30:00,2026-10-02,Plastik Jaya Sentosa,Dus Kue 20x20,100,Kemasan,3500,0,10000,340000,Tunai,Lunas,-,Box cake reguler,Private Chat\r\n"
        "2026-10-03 14:15:00,2026-10-03,Super Indo,Susu UHT Full Cream 1L,12,Bahan Kue,18500,0,0,222000,Debit,Lunas,-,Stok mingguan,Private Chat\r\n"
    )

    response = Response(content=template_csv, media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=template_import_catpen.csv"
    return response

