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
    Port dari saveDataToSheet di GAS + auto-match ke MasterItem baku.
    """
    from app.services.master_item_service import match_and_normalize_extracted_items

    await match_and_normalize_extracted_items(db, items)

    saved = []
    today = date.today()

    for item in items:
        # Parse tanggal
        raw_date = item.get("tanggal", str(today))
        try:
            expense_date = date.fromisoformat(str(raw_date)[:10])
        except (ValueError, TypeError):
            expense_date = today

        is_reimb = bool(item.get("is_reimbursement", False))
        ket = str(item.get("keterangan", ""))
        brg = str(item.get("barang", ""))
        if any(w in ket.lower() or w in brg.lower() for w in ("reimburse", "rembes", "ditalangi", "talangan")):
            is_reimb = True

        inv_num = item.get("no_invoice") or item.get("invoice_number") or item.get("no_nota") or "-"

        expense = Expense(
            expense_date=expense_date,
            supplier=item.get("toko_supplier") or "-",
            item_name=item.get("barang") or "Barang",
            qty=Decimal(str(item.get("qty") or 1)),
            unit=(item.get("satuan") or item.get("unit") or "Pcs").strip() or "Pcs",
            category=item.get("kategori") or "Operasional",
            unit_price=Decimal(str(item.get("harga_satuan") or 0)),
            shipping_fee=Decimal(str(item.get("ongkir") or item.get("shipping_fee") or 0)),
            tax=Decimal(str(item.get("tax") or item.get("pajak") or 0)),
            other_fee=Decimal(str(item.get("biaya_lainnya") or item.get("other_fee") or 0)),
            discount=Decimal(str(item.get("diskon") or item.get("discount") or 0)),
            total_price=Decimal(str(item.get("total_harga") or item.get("total_price") or 0)),
            pay_method=item.get("metode_bayar") or "Tunai",
            pay_status=item.get("status_pembayaran") or "Lunas",
            due_date=item.get("jatuh_tempo") or "-",
            notes=item.get("keterangan") or "-",
            is_reimbursement=is_reimb,
            invoice_number=str(inv_num),
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
    per_metode_bayar: dict[str, float] = {}
    list_hutang: list[dict] = []
    reimburse_pending_count = 0
    reimburse_pending_total = 0.0

    for e in expenses:
        nominal = float(e.total_price or 0)
        status = (e.pay_status or "").lower()

        if bool(e.is_reimbursement) and not e.reimbursed_at:
            reimburse_pending_count += 1
            reimburse_pending_total += nominal

        # Agregasi Metode Pembayaran
        metode = (e.pay_method or "Tunai").strip() or "Tunai"
        per_metode_bayar[metode] = per_metode_bayar.get(metode, 0.0) + nominal

        if status == "lunas":
            total_lunas += nominal
            kat = e.category or "Lainnya"
            per_kategori[kat] = per_kategori.get(kat, 0.0) + nominal
        elif "belum" in status or status in ("hutang", "tempo"):
            list_hutang.append({
                "id": e.id,
                "barang": e.item_name,
                "supplier": e.supplier or "-",
                "nominal": nominal,
                "tempo": e.due_date or "-",
                "tanggal": str(e.expense_date),
                "kategori": e.category or "Lainnya",
                "status": e.pay_status or "Belum Lunas",
            })

    return {
        "total_lunas": total_lunas,
        "per_kategori": per_kategori,
        "per_metode_bayar": per_metode_bayar,
        "list_hutang": list_hutang,
        "reimburse_pending_count": reimburse_pending_count,
        "reimburse_pending_total": reimburse_pending_total,
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


async def get_item_price_history(db: AsyncSession, item_name: str) -> dict:
    """
    Ambil riwayat pembelian suatu barang beserta statistik harga satuan
    (termurah, rata-rata, tertinggi, terakhir) dan perbandingan harga antar toko/supplier.
    """
    clean_q = (item_name or "").strip()
    if not clean_q:
        return {
            "item_name": "",
            "tx_count": 0,
            "min_price": 0.0,
            "max_price": 0.0,
            "avg_price": 0.0,
            "latest_price": 0.0,
            "cheapest_supplier": "-",
            "suppliers_comparison": [],
            "history": [],
        }

    # Prioritaskan exact match dulu; jika kosong baru ilike substring
    exact_res = await db.execute(
        select(Expense)
        .where(func.lower(Expense.item_name) == clean_q.lower())
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    rows = list(exact_res.scalars().all())
    if not rows:
        like_res = await db.execute(
            select(Expense)
            .where(Expense.item_name.ilike(f"%{clean_q}%"))
            .order_by(Expense.expense_date.desc(), Expense.id.desc())
        )
        rows = list(like_res.scalars().all())

    if not rows:
        return {
            "item_name": clean_q,
            "tx_count": 0,
            "min_price": 0.0,
            "max_price": 0.0,
            "avg_price": 0.0,
            "latest_price": 0.0,
            "cheapest_supplier": "-",
            "suppliers_comparison": [],
            "history": [],
        }

    priced_rows = [r for r in rows if float(r.unit_price or 0) > 0]
    prices = [float(r.unit_price) for r in priced_rows]

    min_price = min(prices) if prices else 0.0
    max_price = max(prices) if prices else 0.0
    avg_price = round(sum(prices) / len(prices), 2) if prices else 0.0
    latest_price = float(priced_rows[0].unit_price) if priced_rows else 0.0

    # Perbandingan harga per toko/supplier
    sup_map: dict[str, dict] = {}
    cheapest_supplier = "-"
    cheapest_val = None

    for r in priced_rows:
        up = float(r.unit_price or 0)
        sup_raw = (r.supplier or "-").strip() or "-"
        if cheapest_val is None or up < cheapest_val:
            cheapest_val = up
            cheapest_supplier = sup_raw

        skey = sup_raw.lower()
        if skey not in sup_map:
            sup_map[skey] = {
                "supplier": sup_raw,
                "min_price": up,
                "max_price": up,
                "latest_price": up,
                "last_date": str(r.expense_date),
                "tx_count": 1,
            }
        else:
            entry = sup_map[skey]
            entry["tx_count"] += 1
            if up < entry["min_price"]:
                entry["min_price"] = up
            if up > entry["max_price"]:
                entry["max_price"] = up

    suppliers_comparison = sorted(
        sup_map.values(),
        key=lambda x: (x["min_price"], -x["tx_count"]),
    )

    history = [
        {
            "id": r.id,
            "expense_date": str(r.expense_date),
            "supplier": r.supplier or "-",
            "item_name": r.item_name,
            "qty": float(r.qty or 1),
            "unit": getattr(r, "unit", "Pcs") or "Pcs",
            "unit_price": float(r.unit_price or 0),
            "total_price": float(r.total_price or 0),
            "category": r.category or "Operasional",
            "notes": r.notes or "-",
        }
        for r in rows[:15]
    ]

    return {
        "item_name": rows[0].item_name,
        "tx_count": len(rows),
        "min_price": min_price,
        "max_price": max_price,
        "avg_price": avg_price,
        "latest_price": latest_price,
        "cheapest_supplier": cheapest_supplier,
        "suppliers_comparison": suppliers_comparison,
        "history": history,
    }


async def get_all_expenses_paginated(
    db: AsyncSession,
    page: int = 1,
    per_page: int = 50,
    category: str | None = None,
    month: int | None = None,
    year: int | None = None,
    search: str | None = None,
    status: str | None = None,
    is_reimbursement: bool | None = None,
) -> tuple[list[Expense], int]:
    """Untuk dashboard web: paginated list dengan filter kategori, bulan, tahun, search, status, dan reimbursement."""
    query = select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc())

    if category:
        query = query.where(Expense.category == category)
    if month and year:
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        query = query.where(and_(Expense.expense_date >= start, Expense.expense_date < end))
    if status:
        query = query.where(Expense.pay_status.ilike(f"%{status}%"))
    if is_reimbursement is not None:
        query = query.where(Expense.is_reimbursement == is_reimbursement)
    if search:
        search_term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Expense.item_name.ilike(search_term),
                Expense.supplier.ilike(search_term),
                Expense.notes.ilike(search_term),
                Expense.invoice_number.ilike(search_term),
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
            if field in ("qty", "unit_price", "shipping_fee", "tax", "other_fee", "discount", "total_price") and val is not None:
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


async def get_unsynced_to_sheets(db: AsyncSession, limit: int = 500) -> list[Expense]:
    """Ambil expense yang belum di-sync ke Google Sheets."""
    result = await db.execute(
        select(Expense)
        .where(or_(Expense.sheets_synced == False, Expense.sheets_synced.is_(None)))  # noqa: E712
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
    from app.services.master_item_service import match_and_normalize_extracted_items

    await match_and_normalize_extracted_items(db, items)

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
            unit=(item.get("unit") or item.get("satuan") or "Pcs").strip() or "Pcs",
            category=item.get("category") or "Operasional",
            unit_price=Decimal(str(item.get("unit_price") or 0)),
            shipping_fee=Decimal(str(item.get("shipping_fee") or item.get("ongkir") or 0)),
            tax=Decimal(str(item.get("tax") or item.get("pajak") or 0)),
            other_fee=Decimal(str(item.get("other_fee") or item.get("biaya_lainnya") or 0)),
            discount=Decimal(str(item.get("discount") or item.get("diskon") or 0)),
            total_price=Decimal(str(item.get("total_price") or item.get("total_harga") or 0)),
            pay_method=item.get("pay_method") or "Tunai",
            pay_status=item.get("pay_status") or "Lunas",
            due_date=item.get("due_date") or "-",
            notes=item.get("notes") or "-",
            is_reimbursement=bool(item.get("is_reimbursement", False)),
            invoice_number=str(item.get("invoice_number") or item.get("no_invoice") or "-"),
            msg_link=item.get("msg_link") or "Import CSV",
            user_id=user_id,
            sheets_synced=sheets_synced,
        )
        db.add(expense)
        saved.append(expense)

    await db.flush()
    return saved



# ──────────────────────────────────────────────
# Reimbursement (talangan) per user
# ──────────────────────────────────────────────

async def get_outstanding_reimbursements(
    db: AsyncSession,
    user_id: int | None = None,
) -> list[Expense]:
    """Ambil talangan (reimbursement) yang belum diganti.

    user_id=None → semua user (untuk admin). Selain itu hanya milik user tersebut.
    """
    query = (
        select(Expense)
        .where(Expense.is_reimbursement == True)  # noqa: E712
        .where(Expense.reimbursed_at.is_(None))
        .order_by(Expense.expense_date.asc(), Expense.id.asc())
    )
    if user_id is not None:
        query = query.where(Expense.user_id == user_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def group_reimbursements_by_user(
    db: AsyncSession,
    expenses: list[Expense],
) -> list[dict]:
    """Kelompokkan talangan per user → [{user_id, telegram_id, name, items, total}]."""
    user_ids = {e.user_id for e in expenses if e.user_id is not None}
    users: dict[int, User] = {}
    if user_ids:
        res = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = {u.id: u for u in res.scalars().all()}

    groups: dict[int | None, dict] = {}
    for e in expenses:
        g = groups.get(e.user_id)
        if g is None:
            u = users.get(e.user_id) if e.user_id is not None else None
            g = {
                "user_id": e.user_id,
                "telegram_id": u.telegram_id if u else None,
                "name": (u.name if u and u.name else None) or ("Tanpa User (Web)" if e.user_id is None else f"User #{e.user_id}"),
                "items": [],
                "total": 0.0,
            }
            groups[e.user_id] = g
        g["items"].append(e)
        g["total"] += float(e.total_price or 0)

    return sorted(groups.values(), key=lambda g: -g["total"])


async def mark_reimbursed(
    db: AsyncSession,
    expense_ids: list[int],
) -> list[Expense]:
    """Tandai talangan sudah diganti. Hanya memproses item reimbursement yang belum diganti."""
    if not expense_ids:
        return []
    res = await db.execute(
        select(Expense)
        .where(Expense.id.in_(expense_ids))
        .where(Expense.is_reimbursement == True)  # noqa: E712
        .where(Expense.reimbursed_at.is_(None))
    )
    items = list(res.scalars().all())
    now = datetime.utcnow()
    for e in items:
        e.reimbursed_at = now
        e.sheets_synced = False
    await db.flush()
    return items
