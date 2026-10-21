"""
app/dashboard/routes.py — Web dashboard routes
Overview pengeluaran dengan chart dan tabel filter, dilindungi autentikasi PIN Telegram & Anti-Brute Force.
"""
from datetime import datetime
from urllib.parse import quote
from fastapi import APIRouter, Depends, Request, Query, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.services.expense_service import get_all_expenses_paginated, get_monthly_report
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

    # List expenses dengan filter + pagination
    expenses, total_count = await get_all_expenses_paginated(
        db,
        page=page,
        per_page=30,
        category=category,
        month=current_month,
        year=current_year,
    )

    # Data untuk chart: per kategori
    chart_labels = list(report["per_kategori"].keys())
    chart_values = [round(v) for v in report["per_kategori"].values()]

    MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
              "Juli","Agustus","September","Oktober","November","Desember"]

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "expenses": expenses,
            "report": report,
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
