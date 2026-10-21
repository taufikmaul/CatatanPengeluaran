"""
app/services/expense_service.py — CRUD pengeluaran ke PostgreSQL
Port dari saveDataToSheet, checkDuplicateInSheet, generateReport, cekHargaTerakhir
"""
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.expense import Expense
from app.models.user import User


async def save_expenses(
    db: AsyncSession,
    items: list[dict],
    msg_link: str = "Private Chat",
    user_id: int | None = None,
) -> list[Expense]:
    """
    Simpan list item pengeluaran ke Postgres.
    Port dari saveDataToSheet di GAS.
    """
    saved = []
    today = date.today()

    for item in items:
        # Parse tanggal
        raw_date = item.get("tanggal", str(today))
        try:
            expense_date = date.fromisoformat(str(raw_date)[:10])
        except (ValueError, TypeError):
            expense_date = today

        expense = Expense(
            expense_date=expense_date,
            supplier=item.get("toko_supplier") or "-",
            item_name=item.get("barang") or "Barang",
            qty=Decimal(str(item.get("qty") or 1)),
            category=item.get("kategori") or "Operasional",
            unit_price=Decimal(str(item.get("harga_satuan") or 0)),
            tax=Decimal(str(item.get("tax") or 0)),
            discount=Decimal(str(item.get("diskon") or 0)),
            total_price=Decimal(str(item.get("total_harga") or 0)),
            pay_method=item.get("metode_bayar") or "Tunai",
            pay_status=item.get("status_pembayaran") or "Lunas",
            due_date=item.get("jatuh_tempo") or "-",
            notes=item.get("keterangan") or "-",
            msg_link=msg_link,
            user_id=user_id,
            sheets_synced=False,
        )
        db.add(expense)
        saved.append(expense)

    await db.flush()
    return saved


async def check_duplicate(
    db: AsyncSession,
    items: list[dict],
    lookback_rows: int = 50,
) -> bool:
    """
    Cek apakah transaksi ini sudah pernah dicatat.
    Port dari checkDuplicateInSheet di GAS.
    Logika: match berdasarkan (toko + total + tanggal).
    """
    result = await db.execute(
        select(Expense)
        .order_by(Expense.id.desc())
        .limit(lookback_rows)
    )
    recent = result.scalars().all()

    for existing in recent:
        existing_date = str(existing.expense_date)
        existing_supplier = (existing.supplier or "").strip().lower()
        existing_total = float(existing.total_price or 0)

        for item in items:
            raw_date = str(item.get("tanggal", date.today().isoformat()))[:10]
            new_supplier = str(item.get("toko_supplier") or "").strip().lower()
            new_total = float(item.get("total_harga") or 0)

            if (
                existing_supplier == new_supplier
                and abs(existing_total - new_total) < 1
                and existing_date == raw_date
                and new_total > 0
            ):
                return True

    return False


async def get_monthly_report(db: AsyncSession, year: int, month: int) -> dict:
    """
    Generate rekap bulan tertentu.
    Port dari generateReport di GAS.
    Return dict dengan total_lunas, per_kategori, list_hutang.
    """
    start_date = date(year, month, 1)
    # Hitung akhir bulan
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)

    result = await db.execute(
        select(Expense).where(
            and_(
                Expense.expense_date >= start_date,
                Expense.expense_date < end_date,
            )
        )
    )
    expenses = result.scalars().all()

    total_lunas = 0.0
    per_kategori: dict[str, float] = {}
    list_hutang: list[dict] = []

    for e in expenses:
        nominal = float(e.total_price or 0)
        status = (e.pay_status or "").lower()

        if status == "lunas":
            total_lunas += nominal
            kat = e.category or "Lainnya"
            per_kategori[kat] = per_kategori.get(kat, 0) + nominal
        elif "belum" in status or status in ("hutang", "tempo"):
            list_hutang.append({
                "barang": e.item_name,
                "nominal": nominal,
                "tempo": e.due_date or "-",
            })

    return {
        "total_lunas": total_lunas,
        "per_kategori": per_kategori,
        "list_hutang": list_hutang,
        "expense_count": len(expenses),
        "month": month,
        "year": year,
    }


async def search_last_price(db: AsyncSession, keyword: str) -> Expense | None:
    """
    Cari harga terakhir suatu barang berdasarkan keyword.
    Port dari cekHargaTerakhir di GAS.
    """
    result = await db.execute(
        select(Expense)
        .where(Expense.item_name.ilike(f"%{keyword}%"))
        .order_by(Expense.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_all_expenses_paginated(
    db: AsyncSession,
    page: int = 1,
    per_page: int = 50,
    category: str | None = None,
    month: int | None = None,
    year: int | None = None,
) -> tuple[list[Expense], int]:
    """Untuk dashboard web: paginated list dengan filter."""
    query = select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc())

    if category:
        query = query.where(Expense.category == category)
    if month and year:
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        query = query.where(and_(Expense.expense_date >= start, Expense.expense_date < end))

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    return result.scalars().all(), total


async def get_unsynced_to_sheets(db: AsyncSession, limit: int = 100) -> list[Expense]:
    """Ambil expense yang belum di-sync ke Google Sheets."""
    result = await db.execute(
        select(Expense)
        .where(Expense.sheets_synced == False)  # noqa: E712
        .order_by(Expense.id.asc())
        .limit(limit)
    )
    return result.scalars().all()


async def mark_synced_to_sheets(db: AsyncSession, expense_ids: list[int]) -> None:
    """Tandai expense sebagai sudah di-sync ke Sheets."""
    from sqlalchemy import update
    await db.execute(
        update(Expense)
        .where(Expense.id.in_(expense_ids))
        .values(sheets_synced=True)
    )
