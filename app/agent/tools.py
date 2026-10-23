"""
app/agent/tools.py — Tool definitions untuk Hermes Agent
Setiap tool adalah fungsi async yang bisa dipanggil oleh orchestrator
"""
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from app.services import ai_service, expense_service
from app.utils.validators import audit_calculations, is_valid_category
from app.config import settings


# ──────────────────────────────────────────────
# Tool: Ekstraksi Data
# ──────────────────────────────────────────────

async def tool_extract_text(text: str) -> dict:
    """Ekstrak item belanja dari teks biasa via AI."""
    result = await ai_service.call_ai_text(text)
    return audit_calculations(result)


async def tool_extract_image(base64_image: str, caption: str = "") -> dict:
    """Ekstrak item belanja dari foto struk via AI."""
    result = await ai_service.call_ai_image(base64_image, caption)
    return audit_calculations(result)


async def tool_extract_voice(base64_audio: str) -> dict:
    """Ekstrak item belanja dari voice note via AI."""
    result = await ai_service.call_ai_voice(base64_audio)
    return audit_calculations(result)


# ──────────────────────────────────────────────
# Tool: Database Operations
# ──────────────────────────────────────────────

async def tool_save_expenses(
    db: AsyncSession,
    items: list[dict],
    msg_link: str = "Private Chat",
    user_id: int | None = None,
) -> list:
    """Simpan item pengeluaran ke Postgres."""
    return await expense_service.save_expenses(db, items, msg_link, user_id)


async def tool_check_duplicate(db: AsyncSession, items: list[dict]) -> bool:
    """Cek apakah transaksi ini sudah pernah dicatat."""
    return await expense_service.check_duplicate(db, items)


async def tool_get_report(db: AsyncSession, year: int | None = None, month: int | None = None) -> dict:
    """Generate laporan bulanan."""
    now = datetime.now()
    return await expense_service.get_monthly_report(
        db,
        year=year or now.year,
        month=month or now.month,
    )


async def tool_search_price(db: AsyncSession, keyword: str):
    """Cari harga terakhir suatu barang."""
    return await expense_service.search_last_price(db, keyword)


# ──────────────────────────────────────────────
# Tool: Audit
# ──────────────────────────────────────────────

async def tool_audit_categories(db: AsyncSession) -> dict:
    """
    Audit semua data kategori di DB.
    Return: {invalid_count, invalid_items}
    """
    from sqlalchemy import select
    from app.models.expense import Expense

    result = await db.execute(select(Expense).order_by(Expense.id.asc()))
    all_expenses = result.scalars().all()

    invalid = []
    for e in all_expenses:
        if not is_valid_category(e.category or ""):
            invalid.append({
                "id": e.id,
                "barang": e.item_name,
                "kategori": e.category or "Kosong",
            })

    return {"invalid_count": len(invalid), "invalid_items": invalid}


async def tool_audit_calculations(db: AsyncSession) -> dict:
    """
    Audit dan auto-fix perhitungan (qty × harga) yang salah di DB.
    Port dari auditHitungan GAS.
    """
    from sqlalchemy import select, update
    from app.models.expense import Expense
    from decimal import Decimal

    result = await db.execute(select(Expense))
    all_expenses = result.scalars().all()

    fixed = []
    for e in all_expenses:
        qty = float(e.qty or 1)
        harga = float(e.unit_price or 0)
        shipping = float(e.shipping_fee or 0)
        tax = float(e.tax or 0)
        other = float(e.other_fee or 0)
        diskon = float(e.discount or 0)
        total_tercatat = float(e.total_price or 0)
        total_seharusnya = (qty * harga) + shipping + tax + other - diskon

        if abs(total_tercatat - total_seharusnya) > 1:
            e.total_price = Decimal(str(round(total_seharusnya, 2)))
            fixed.append({
                "id": e.id,
                "barang": e.item_name,
                "lama": total_tercatat,
                "baru": total_seharusnya,
            })

    await db.flush()
    return {"fixed_count": len(fixed), "fixed_items": fixed}


async def tool_autofix_categories(db: AsyncSession) -> dict:
    """
    Auto-fix kategori tidak valid menggunakan AI.
    Port dari runAutoFix GAS.
    """
    from sqlalchemy import select
    from app.models.expense import Expense

    audit = await tool_audit_categories(db)
    invalid_items = audit["invalid_items"]

    if not invalid_items:
        return {"fixed_count": 0}

    # Proses max 40 item sekaligus
    batch = invalid_items[:40]
    fix_result = await ai_service.call_ai_fix_categories(batch)

    if fix_result.get("error") or not fix_result.get("items"):
        return {"error": True, "message": "AI gagal memproses"}

    fixed_count = 0
    for fix in fix_result["items"]:
        expense_id = fix.get("row")  # row di sini adalah ID
        new_cat = fix.get("kategori_baru")
        if expense_id and new_cat and new_cat in settings.valid_categories:
            result = await db.execute(select(Expense).where(Expense.id == expense_id))
            expense = result.scalar_one_or_none()
            if expense:
                expense.category = new_cat
                fixed_count += 1

    await db.flush()
    remaining = max(0, len(invalid_items) - 40)
    return {"fixed_count": fixed_count, "remaining": remaining}


# ──────────────────────────────────────────────
# Tool: Insight (bonus Hermes feature)
# ──────────────────────────────────────────────

async def tool_get_price_insight(db: AsyncSession, keyword: str, current_price: float) -> str | None:
    """
    Bandingkan harga sekarang dengan harga terakhir di DB.
    Return insight string atau None jika tidak ada histori.
    """
    last = await tool_search_price(db, keyword)
    if not last:
        return None

    last_price = float(last.unit_price or 0)
    if last_price <= 0 or current_price <= 0:
        return None

    diff = current_price - last_price
    pct = abs(diff / last_price * 100)

    if pct < 2:
        return None  # tidak signifikan

    from app.utils.formatters import fmt_rupiah, fmt_date_id
    direction = "naik" if diff > 0 else "turun"
    return (
        f"💡 FYI: *{keyword}* {direction} {fmt_rupiah(abs(diff))}/satuan "
        f"dibanding terakhir ({fmt_date_id(last.expense_date)}, {fmt_rupiah(last_price)})"
    )
