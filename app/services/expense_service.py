"""
app/services/expense_service.py — CRUD pengeluaran ke PostgreSQL
Port dari saveDataToSheet, checkDuplicateInSheet, generateReport, cekHargaTerakhir
"""
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
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
    search: str | None = None,
    status: str | None = None,
) -> tuple[list[Expense], int]:
    """Untuk dashboard web: paginated list dengan filter kategori, bulan, tahun, search, dan status."""
    query = select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc())

    if category:
        query = query.where(Expense.category == category)
    if month and year:
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        query = query.where(and_(Expense.expense_date >= start, Expense.expense_date < end))
    if status:
        query = query.where(Expense.pay_status.ilike(f"%{status}%"))
    if search:
        search_term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Expense.item_name.ilike(search_term),
                Expense.supplier.ilike(search_term),
                Expense.notes.ilike(search_term),
            )
        )

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    return result.scalars().all(), total


async def get_expense_by_id(db: AsyncSession, expense_id: int) -> Expense | None:
    """Ambil satu expense berdasarkan ID."""
    result = await db.execute(select(Expense).where(Expense.id == expense_id))
    return result.scalar_one_or_none()


async def update_expense(
    db: AsyncSession,
    expense_id: int,
    updates: dict,
) -> Expense | None:
    """Update field expense yang ada."""
    expense = await get_expense_by_id(db, expense_id)
    if not expense:
        return None

    for field, val in updates.items():
        if hasattr(expense, field):
            # Khusus konversi jika perlu
            if field in ("qty", "unit_price", "tax", "discount", "total_price") and val is not None:
                val = Decimal(str(val))
            elif field == "expense_date" and isinstance(val, str):
                try:
                    val = date.fromisoformat(val[:10])
                except (ValueError, TypeError):
                    continue
            setattr(expense, field, val)

    # Tandai sheets_synced = False agar perubahan tersinkron ulang jika perlu
    expense.sheets_synced = False
    await db.flush()
    return expense


async def delete_expense(db: AsyncSession, expense_id: int) -> bool:
    """Hapus satu record pengeluaran."""
    expense = await get_expense_by_id(db, expense_id)
    if not expense:
        return False
    await db.delete(expense)
    await db.flush()
    return True


async def get_monthly_chart_data(db: AsyncSession, year: int, month: int) -> list[dict]:
    """Mengambil akumulasi harian pengeluaran dalam satu bulan untuk visualisasi chart."""
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)

    result = await db.execute(
        select(
            Expense.expense_date,
            func.sum(Expense.total_price).label("daily_total"),
            func.count(Expense.id).label("count"),
        )
        .where(and_(Expense.expense_date >= start, Expense.expense_date < end))
        .group_by(Expense.expense_date)
        .order_by(Expense.expense_date.asc())
    )
    rows = result.all()
    return [
        {
            "date": str(r.expense_date),
            "total": float(r.daily_total or 0),
            "count": int(r.count or 0),
        }
        for r in rows
    ]


async def get_monthly_leaderboards(db: AsyncSession, year: int, month: int) -> dict:
    """
    Menghitung statistik analitik mendalam dan leaderboard untuk dashboard:
    - Top 5 Item Paling Sering Dibeli (frekuensi & volume)
    - Top 5 Item Paling Mahal / Pengeluaran Terbesar (budget share)
    - Top 5 Item dengan Harga Satuan Tertinggi (unit price)
    - Top 5 Item yang Mengalami Lonjakan Kenaikan Harga Drastis (price spike)
    - Top 5 Supplier / Toko dengan Pengeluaran Terbesar
    - Ringkasan KPI Eksekutif (rata-rata per transaksi, rata-rata harian, transaksi terbesar, ragam item)
    """
    start_date = date(year, month, 1)
    end_date = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)

    result = await db.execute(
        select(Expense)
        .where(and_(Expense.expense_date >= start_date, Expense.expense_date < end_date))
        .order_by(Expense.expense_date.asc(), Expense.id.asc())
    )
    month_expenses = result.scalars().all()

    if not month_expenses:
        return {
            "top_frequent_items": [],
            "top_expensive_items": [],
            "top_unit_price_items": [],
            "top_price_spikes": [],
            "top_suppliers": [],
            "summary_metrics": {
                "daily_average": 0.0,
                "average_per_transaction": 0.0,
                "max_single_transaction": None,
                "unique_items_count": 0,
                "unique_suppliers_count": 0,
                "active_days_count": 0,
            },
        }

    total_month_spent = sum(float(e.total_price or 0) for e in month_expenses)
    total_lunas_spent = sum(
        float(e.total_price or 0)
        for e in month_expenses
        if (e.pay_status or "").lower() == "lunas"
    )

    items_map: dict[str, dict] = {}
    suppliers_map: dict[str, dict] = {}
    active_days: set[date] = set()
    max_expense = None

    for e in month_expenses:
        total_p = float(e.total_price or 0)
        unit_p = float(e.unit_price or 0)
        qty = float(e.qty or 0)
        active_days.add(e.expense_date)

        if max_expense is None or total_p > float(max_expense.total_price or 0):
            max_expense = e

        # Agregasi Item
        raw_name = (e.item_name or "Barang").strip()
        norm_name = raw_name.lower()
        if norm_name not in items_map:
            items_map[norm_name] = {
                "item_name": raw_name,
                "category": e.category or "Operasional",
                "count": 0,
                "total_qty": 0.0,
                "total_spent": 0.0,
                "max_unit_price": unit_p,
                "supplier": e.supplier or "-",
                "last_expense_date": str(e.expense_date),
            }
        item_entry = items_map[norm_name]
        item_entry["count"] += 1
        item_entry["total_qty"] += qty
        item_entry["total_spent"] += total_p
        if unit_p > item_entry["max_unit_price"]:
            item_entry["max_unit_price"] = unit_p
            item_entry["supplier"] = e.supplier or "-"
        item_entry["last_expense_date"] = str(e.expense_date)

        # Agregasi Supplier
        raw_supplier = (e.supplier or "-").strip()
        if raw_supplier and raw_supplier != "-":
            norm_sup = raw_supplier.lower()
            if norm_sup not in suppliers_map:
                suppliers_map[norm_sup] = {
                    "supplier": raw_supplier,
                    "count": 0,
                    "total_spent": 0.0,
                }
            suppliers_map[norm_sup]["count"] += 1
            suppliers_map[norm_sup]["total_spent"] += total_p

    # Top 5 Sering Dibeli
    sorted_frequent = sorted(
        items_map.values(),
        key=lambda x: (x["count"], x["total_qty"], x["total_spent"]),
        reverse=True,
    )[:5]
    top_frequent_items = [
        {
            "item_name": it["item_name"],
            "category": it["category"],
            "count": it["count"],
            "total_qty": round(it["total_qty"], 2),
            "total_spent": round(it["total_spent"], 2),
            "avg_unit_price": round(it["total_spent"] / it["total_qty"], 2) if it["total_qty"] > 0 else 0.0,
        }
        for it in sorted_frequent
    ]

    # Top 5 Item Paling Mahal / Pengeluaran Terbesar
    sorted_expensive = sorted(
        items_map.values(),
        key=lambda x: x["total_spent"],
        reverse=True,
    )[:5]
    top_expensive_items = [
        {
            "item_name": it["item_name"],
            "category": it["category"],
            "total_spent": round(it["total_spent"], 2),
            "count": it["count"],
            "total_qty": round(it["total_qty"], 2),
            "max_unit_price": round(it["max_unit_price"], 2),
            "percentage": round((it["total_spent"] / total_month_spent * 100), 1) if total_month_spent > 0 else 0.0,
        }
        for it in sorted_expensive
    ]

    # Top 5 Item dengan Harga Satuan Termahal
    sorted_unit_price = sorted(
        items_map.values(),
        key=lambda x: x["max_unit_price"],
        reverse=True,
    )[:5]
    top_unit_price_items = [
        {
            "item_name": it["item_name"],
            "category": it["category"],
            "supplier": it["supplier"],
            "unit_price": round(it["max_unit_price"], 2),
            "last_date": it["last_expense_date"],
        }
        for it in sorted_unit_price
    ]

    # Top 5 Supplier Terbanyak
    sorted_suppliers = sorted(
        suppliers_map.values(),
        key=lambda x: x["total_spent"],
        reverse=True,
    )[:5]
    top_suppliers = [
        {
            "supplier": s["supplier"],
            "count": s["count"],
            "total_spent": round(s["total_spent"], 2),
            "percentage": round((s["total_spent"] / total_month_spent * 100), 1) if total_month_spent > 0 else 0.0,
        }
        for s in sorted_suppliers
    ]

    # Top 5 Kenaikan Harga Drastis (Price Spikes)
    distinct_item_keys = list(items_map.keys())
    price_spikes = []

    if distinct_item_keys:
        hist_result = await db.execute(
            select(Expense)
            .where(
                and_(
                    Expense.expense_date < end_date,
                    func.lower(Expense.item_name).in_(distinct_item_keys),
                    Expense.unit_price > 0,
                )
            )
            .order_by(Expense.expense_date.asc(), Expense.id.asc())
        )
        all_hist = hist_result.scalars().all()

        hist_by_item: dict[str, list[Expense]] = {}
        for h in all_hist:
            k = (h.item_name or "").strip().lower()
            hist_by_item.setdefault(k, []).append(h)

        for norm_name, records in hist_by_item.items():
            current_month_records = [r for r in records if r.expense_date >= start_date]
            if not current_month_records:
                continue

            latest_record = current_month_records[-1]
            latest_price = float(latest_record.unit_price or 0)
            if latest_price <= 0:
                continue

            # Prioritas 1: cari pembelian sebelum bulan ini
            prior_records = [r for r in records if r.expense_date < start_date and float(r.unit_price or 0) > 0]
            baseline_record = None
            if prior_records:
                baseline_record = prior_records[-1]
            else:
                # Prioritas 2: pembelian lebih awal dalam bulan yang sama
                earlier_month_records = [
                    r for r in current_month_records[:-1]
                    if float(r.unit_price or 0) > 0 and float(r.unit_price or 0) < latest_price
                ]
                if earlier_month_records:
                    baseline_record = earlier_month_records[0]

            if baseline_record:
                base_price = float(baseline_record.unit_price or 0)
                if base_price > 0 and latest_price > base_price:
                    diff = latest_price - base_price
                    pct_change = (diff / base_price) * 100.0
                    price_spikes.append({
                        "item_name": latest_record.item_name,
                        "category": latest_record.category or "Operasional",
                        "supplier": latest_record.supplier or "-",
                        "previous_price": round(base_price, 2),
                        "current_price": round(latest_price, 2),
                        "diff_price": round(diff, 2),
                        "percent_change": round(pct_change, 1),
                        "previous_date": str(baseline_record.expense_date),
                        "latest_date": str(latest_record.expense_date),
                    })

    price_spikes.sort(key=lambda x: (x["percent_change"], x["diff_price"]), reverse=True)
    top_price_spikes = price_spikes[:5]

    # Summary Metrics
    active_days_count = len(active_days)
    expense_count = len(month_expenses)
    daily_average = round(total_lunas_spent / active_days_count, 2) if active_days_count > 0 else 0.0
    avg_per_transaction = round(total_month_spent / expense_count, 2) if expense_count > 0 else 0.0

    max_single_tx = None
    if max_expense:
        max_single_tx = {
            "item_name": max_expense.item_name,
            "supplier": max_expense.supplier or "-",
            "amount": float(max_expense.total_price or 0),
            "date": str(max_expense.expense_date),
            "category": max_expense.category or "Operasional",
        }

    return {
        "top_frequent_items": top_frequent_items,
        "top_expensive_items": top_expensive_items,
        "top_unit_price_items": top_unit_price_items,
        "top_price_spikes": top_price_spikes,
        "top_suppliers": top_suppliers,
        "summary_metrics": {
            "daily_average": daily_average,
            "average_per_transaction": avg_per_transaction,
            "max_single_transaction": max_single_tx,
            "unique_items_count": len(items_map),
            "unique_suppliers_count": len(suppliers_map),
            "active_days_count": active_days_count,
        },
    }


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


def make_duplicate_key(expense_date: date | str, supplier: str | None, item_name: str | None, total_price: float | Decimal) -> str:
    """Helper untuk membuat key identifikasi duplikasi pengeluaran."""
    d_str = str(expense_date)[:10]
    s_str = (supplier or "-").strip().lower()
    i_str = (item_name or "").strip().lower()
    t_val = int(round(float(total_price or 0)))
    return f"{d_str}|{s_str}|{i_str}|{t_val}"


async def bulk_check_duplicates(
    db: AsyncSession,
    items: list[dict],
) -> set[str]:
    """
    Cek duplikasi secara bulk untuk list pengeluaran baru.
    Mencari transaksi yang sudah ada dengan tanggal, supplier, nama barang, dan nominal yang sama.
    Return: set key duplikat.
    """
    if not items:
        return set()

    dates = {item["expense_date"] for item in items if item.get("expense_date")}
    if not dates:
        return set()

    min_date = min(dates)
    max_date = max(dates)

    result = await db.execute(
        select(Expense).where(
            and_(
                Expense.expense_date >= min_date,
                Expense.expense_date <= max_date,
            )
        )
    )
    existing_expenses = result.scalars().all()

    existing_keys = {
        make_duplicate_key(e.expense_date, e.supplier, e.item_name, e.total_price)
        for e in existing_expenses
    }
    return existing_keys


async def batch_insert_expenses(
    db: AsyncSession,
    items: list[dict],
    sheets_synced: bool = True,
    user_id: int | None = None,
) -> list[Expense]:
    """
    Simpan sekumpulan pengeluaran (misal dari CSV) ke Postgres secara batch.
    Flag sheets_synced default=True agar data historis impor tidak membebani Google Sheets.
    """
    saved = []
    today = date.today()

    for item in items:
        raw_date = item.get("expense_date", today)
        if isinstance(raw_date, str):
            try:
                expense_date = date.fromisoformat(raw_date[:10])
            except (ValueError, TypeError):
                expense_date = today
        elif isinstance(raw_date, date):
            expense_date = raw_date
        else:
            expense_date = today

        expense = Expense(
            expense_date=expense_date,
            supplier=item.get("supplier") or "-",
            item_name=item.get("item_name") or "Barang",
            qty=Decimal(str(item.get("qty") or 1)),
            category=item.get("category") or "Operasional",
            unit_price=Decimal(str(item.get("unit_price") or 0)),
            tax=Decimal(str(item.get("tax") or 0)),
            discount=Decimal(str(item.get("discount") or 0)),
            total_price=Decimal(str(item.get("total_price") or 0)),
            pay_method=item.get("pay_method") or "Tunai",
            pay_status=item.get("pay_status") or "Lunas",
            due_date=item.get("due_date") or "-",
            notes=item.get("notes") or "-",
            msg_link=item.get("msg_link") or "Import CSV",
            user_id=user_id,
            sheets_synced=sheets_synced,
        )
        db.add(expense)
        saved.append(expense)

    await db.flush()
    return saved

