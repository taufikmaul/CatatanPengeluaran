"""
app/services/expense_service.py — CRUD pengeluaran ke PostgreSQL
Port dari saveDataToSheet, checkDuplicateInSheet, generateReport, cekHargaTerakhir
"""
from datetime import datetime, date
from decimal import Decimal
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from app.models.expense import Expense
from app.models.user import User
from app.models.expense_log import ExpenseLog


async def record_expense_log(
    db: AsyncSession,
    expense_id: int | None,
    action: str,
    actor: str = "system",
    details: dict | str | None = None,
) -> ExpenseLog:
    """
    Catat log aksi / riwayat perubahan pada data belanja.
    Action: CREATE, UPDATE, DELETE, STATUS_CHANGE
    Actor: telegram:<id>, dashboard:admin, dashboard:admin_input, import:csv, sync:sheets, system
    """
    details_str = json.dumps(details, default=str) if isinstance(details, dict) else (details or "")
    log_entry = ExpenseLog(
        expense_id=expense_id,
        action=action.upper(),
        actor=actor,
        details=details_str,
    )
    db.add(log_entry)
    return log_entry


async def save_expenses(
    db: AsyncSession,
    items: list[dict],
    msg_link: str = "Private Chat",
    user_id: int | None = None,
    actor: str | None = None,
    allow_zero: bool = True,
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
        qty = Decimal(str(item.get("qty") or 1))
        unit_price = Decimal(str(item.get("harga_satuan") or 0))
        shipping_fee = Decimal(str(item.get("ongkir") or item.get("shipping_fee") or 0))
        tax = Decimal(str(item.get("tax") or item.get("pajak") or 0))
        other_fee = Decimal(str(item.get("biaya_lainnya") or item.get("other_fee") or 0))
        discount = Decimal(str(item.get("diskon") or item.get("discount") or 0))

        raw_tot = item.get("total_harga") if item.get("total_harga") is not None else item.get("total_price")
        if raw_tot is not None:
            total_price = Decimal(str(raw_tot))
        else:
            total_price = (qty * unit_price) + shipping_fee + tax + other_fee - discount

        # Jangan simpan pengeluaran minus atau 0 (jika allow_zero=False)
        if total_price < 0 or (total_price == 0 and not allow_zero):
            continue

        # Parse tanggal dengan memprioritaskan tanggal pemesanan jika tersedia
        raw_date = (
            item.get("tanggal_pemesanan")
            or item.get("waktu_pesanan")
            or item.get("order_date")
            or item.get("tanggal")
            or str(today)
        )
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
            supplier=item.get("toko_supplier") or item.get("supplier") or "-",
            item_name=item.get("barang") or item.get("item_name") or "Barang",
            qty=qty if qty > 0 else Decimal("1"),
            unit=(item.get("satuan") or item.get("unit") or "Pcs").strip() or "Pcs",
            category=item.get("kategori") or item.get("category") or "Operasional",
            unit_price=unit_price,
            shipping_fee=shipping_fee,
            tax=tax,
            other_fee=other_fee,
            discount=discount,
            total_price=total_price,
            pay_method=item.get("metode_bayar") or item.get("pay_method") or "Tunai",
            pay_status=item.get("status_pembayaran") or item.get("pay_status") or "Lunas",
            due_date=item.get("jatuh_tempo") or item.get("due_date") or "-",
            notes=item.get("keterangan") or item.get("notes") or "-",
            is_reimbursement=is_reimb,
            invoice_number=str(inv_num),
            msg_link=msg_link,
            user_id=user_id,
            master_item_id=item.get("master_item_id"),
            sheets_synced=False,
        )
        db.add(expense)
        saved.append(expense)

    await db.flush()

    effective_actor = actor or (f"telegram:{user_id}" if user_id else "system")
    for exp in saved:
        await record_expense_log(
            db,
            expense_id=exp.id,
            action="CREATE",
            actor=effective_actor,
            details={
                "item_name": exp.item_name,
                "total_price": float(exp.total_price),
                "supplier": exp.supplier,
                "expense_date": str(exp.expense_date),
                "category": exp.category,
                "pay_status": exp.pay_status,
                "msg_link": exp.msg_link,
            },
        )

    await db.flush()
    return saved


async def find_duplicate_expenses(
    db: AsyncSession,
    items: list[dict],
    lookback_rows: int = 50,
) -> list[dict]:
    """
    Cari duplikasi pengeluaran dan kembalikan rincian kecocokan:
    Return list of dict:
    [
        {
            "new_item": item,
            "existing_expense": existing, # instance of Expense
        }
    ]
    1. Memprioritaskan tanggal pemesanan (tanggal_pemesanan / order_date). Jika tanggal berbeda, bukan duplikat.
    2. Jika no_invoice ada pada kedua data dan berbeda, bukan duplikat. Jika sama, duplikat.
    3. Jika item_name tersedia, bandingkan nama barang (agar barang berbeda dari toko yang sama tidak terblokir).
    """
    result = await db.execute(
        select(Expense)
        .options(selectinload(Expense.user))
        .order_by(Expense.id.desc())
        .limit(lookback_rows)
    )
    recent = result.scalars().all()

    matches = []
    matched_existing_ids = set()

    for item in items:
        raw_date = str(
            item.get("tanggal_pemesanan")
            or item.get("waktu_pesanan")
            or item.get("order_date")
            or item.get("tanggal")
            or date.today().isoformat()
        )[:10]
        new_supplier = str(item.get("toko_supplier") or item.get("supplier") or "").strip().lower()
        new_item = str(item.get("barang") or item.get("item_name") or "").strip().lower()
        new_total = float(item.get("total_harga") if item.get("total_harga") is not None else (item.get("total_price") or 0))
        new_invoice = str(item.get("no_invoice") or item.get("invoice_number") or "").strip()

        if new_total <= 0:
            continue

        for existing in recent:
            if existing.id in matched_existing_ids:
                continue

            existing_date = str(existing.expense_date)
            existing_supplier = (existing.supplier or "").strip().lower()
            existing_item = (existing.item_name or "").strip().lower()
            existing_total = float(existing.total_price or 0)
            existing_invoice = (existing.invoice_number or "").strip()

            # Jika kedua data memiliki invoice valid yang berbeda, bukan duplikat
            if existing_invoice and existing_invoice != "-" and new_invoice and new_invoice != "-":
                if existing_invoice.lower() == new_invoice.lower():
                    matches.append({"new_item": item, "existing_expense": existing})
                    matched_existing_ids.add(existing.id)
                    break
                continue

            # Tanggal pemesanan harus sama persis
            if existing_date != raw_date:
                continue

            # Toko / supplier harus sama
            if existing_supplier != new_supplier:
                continue

            # Nominal harus sama
            if abs(existing_total - new_total) >= 1:
                continue

            # Jika nama barang tersedia pada kedua data, bandingkan nama barang
            if existing_item and new_item:
                if existing_item == new_item:
                    matches.append({"new_item": item, "existing_expense": existing})
                    matched_existing_ids.add(existing.id)
                    break
                continue

            matches.append({"new_item": item, "existing_expense": existing})
            matched_existing_ids.add(existing.id)
            break

    return matches


async def check_duplicate(
    db: AsyncSession,
    items: list[dict],
    lookback_rows: int = 50,
) -> bool:
    """
    Cek apakah transaksi ini sudah pernah dicatat.
    Kembalikan True jika ada duplikat, False jika tidak.
    """
    matches = await find_duplicate_expenses(db, items, lookback_rows=lookback_rows)
    return len(matches) > 0


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
    total_tukar_cash = 0.0
    tukar_cash_count = 0
    total_ongkir = 0.0
    ongkir_count = 0
    ongkir_reimburse_count = 0
    ongkir_reimburse_total = 0.0
    per_kategori: dict[str, float] = {}
    per_metode_bayar: dict[str, float] = {}
    list_hutang: list[dict] = []
    reimburse_pending_count = 0
    reimburse_pending_total = 0.0

    for e in expenses:
        nominal = float(e.total_price or 0)
        status = (e.pay_status or "").lower()
        kat = e.category or "Lainnya"
        item_l = (e.item_name or "").lower()
        sup_l = (e.supplier or "").lower()

        # Deteksi Tukar Cash (tarik tunai karyawan)
        is_tukar_cash = kat.lower() == "tukar cash" or "tukar cash" in item_l or "tarik tunai" in item_l
        if is_tukar_cash:
            total_tukar_cash += nominal
            tukar_cash_count += 1

        # Deteksi Ongkir & Kurir
        is_ongkir = (
            kat.lower() == "ongkir"
            or item_l.startswith("ongkir")
            or "ongkir" in item_l
            or any(k in sup_l for k in ("gosend", "grabexpress", "lalamove", "j&t", "sicepat", "anteraja"))
        )
        if is_ongkir and not is_tukar_cash:
            total_ongkir += nominal
            ongkir_count += 1
            if bool(e.is_reimbursement):
                ongkir_reimburse_count += 1
                ongkir_reimburse_total += nominal
        elif float(e.shipping_fee or 0) > 0 and not is_tukar_cash:
            total_ongkir += float(e.shipping_fee)

        if bool(e.is_reimbursement) and not e.reimbursed_at:
            reimburse_pending_count += 1
            reimburse_pending_total += nominal

        # Agregasi Metode Pembayaran
        metode = (e.pay_method or "Tunai").strip() or "Tunai"
        per_metode_bayar[metode] = per_metode_bayar.get(metode, 0.0) + nominal

        if status == "lunas":
            total_lunas += nominal
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
        "total_tukar_cash": total_tukar_cash,
        "tukar_cash_count": tukar_cash_count,
        "total_ongkir": total_ongkir,
        "ongkir_count": ongkir_count,
        "ongkir_reimburse_count": ongkir_reimburse_count,
        "ongkir_reimburse_total": ongkir_reimburse_total,
        "total_belanja_riil": max(0.0, total_lunas - total_tukar_cash),
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


async def get_item_price_history(
    db: AsyncSession,
    item_name: str | None = None,
    master_item_id: int | None = None,
) -> dict:
    """
    Ambil riwayat pembelian suatu barang beserta statistik harga satuan
    (termurah, rata-rata, tertinggi, terakhir) dan perbandingan harga antar toko/supplier.
    Mendukung pencarian via ID Item Baku (produk ID) maupun nama barang/alias.
    """
    from app.models.master_item import MasterItem

    matched_master = None
    if master_item_id:
        m_res = await db.execute(select(MasterItem).where(MasterItem.id == master_item_id))
        matched_master = m_res.scalar_one_or_none()

    clean_q = (item_name or "").strip()
    if not matched_master and clean_q:
        # Cari MasterItem berdasarkan nama baku atau alias
        m_res = await db.execute(
            select(MasterItem).where(func.lower(MasterItem.item_name) == clean_q.lower())
        )
        matched_master = m_res.scalar_one_or_none()
        if not matched_master:
            all_m_res = await db.execute(select(MasterItem))
            all_masters = list(all_m_res.scalars().all())
            for m in all_masters:
                aliases = [a.strip().lower() for a in (m.aliases or "").split(",") if a.strip()]
                if clean_q.lower() in aliases:
                    matched_master = m
                    break

    target_master_id = matched_master.id if matched_master else master_item_id
    display_name = matched_master.item_name if matched_master else clean_q

    if not target_master_id and not clean_q:
        return {
            "item_name": "",
            "master_item_id": None,
            "tx_count": 0,
            "min_price": 0.0,
            "max_price": 0.0,
            "avg_price": 0.0,
            "latest_price": 0.0,
            "cheapest_supplier": "-",
            "suppliers_comparison": [],
            "history": [],
        }

    # Cari data transaksi: prioritaskan relasi master_item_id dan nama item
    conditions = []
    if target_master_id:
        conditions.append(Expense.master_item_id == target_master_id)
    if display_name:
        conditions.append(func.lower(Expense.item_name) == display_name.lower())
    if clean_q and clean_q.lower() != display_name.lower():
        conditions.append(func.lower(Expense.item_name) == clean_q.lower())

    exact_res = await db.execute(
        select(Expense)
        .where(or_(*conditions))
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    rows = list(exact_res.scalars().all())

    # Jika belum ada hasil dan terdapat clean_q, coba substring (ilike)
    if not rows and clean_q:
        like_res = await db.execute(
            select(Expense)
            .where(Expense.item_name.ilike(f"%{clean_q}%"))
            .order_by(Expense.expense_date.desc(), Expense.id.desc())
        )
        rows = list(like_res.scalars().all())

    if not rows:
        return {
            "item_name": display_name or clean_q,
            "master_item_id": target_master_id,
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
            "master_item_id": r.master_item_id,
        }
        for r in rows[:50]
    ]

    return {
        "item_name": display_name or rows[0].item_name,
        "master_item_id": target_master_id,
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
    user_id: int | None = None,
    special_type: str | None = None,
) -> tuple[list[Expense], int]:
    """Untuk dashboard web: paginated list dengan filter kategori, bulan, tahun, search, status, reimbursement, user, dan special_type (tukar_cash, ongkir, all_cash_delivery)."""
    query = select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc())

    if special_type == "tukar_cash":
        query = query.where(
            or_(
                Expense.category.ilike("%tukar cash%"),
                Expense.item_name.ilike("%tukar cash%"),
                Expense.item_name.ilike("%tarik tunai%"),
            )
        )
    elif special_type == "ongkir":
        query = query.where(
            or_(
                Expense.category.ilike("%ongkir%"),
                Expense.item_name.ilike("ongkir%"),
                Expense.item_name.ilike("%ongkir%"),
                Expense.supplier.ilike("%gosend%"),
                Expense.supplier.ilike("%grabexpress%"),
                Expense.supplier.ilike("%lalamove%"),
                Expense.supplier.ilike("%j&t%"),
                Expense.supplier.ilike("%sicepat%"),
                Expense.shipping_fee > 0,
            )
        )
    elif special_type in ("all_cash_delivery", "cash_or_delivery", "tukar_cash_ongkir"):
        query = query.where(
            or_(
                Expense.category.ilike("%tukar cash%"),
                Expense.item_name.ilike("%tukar cash%"),
                Expense.item_name.ilike("%tarik tunai%"),
                Expense.category.ilike("%ongkir%"),
                Expense.item_name.ilike("ongkir%"),
                Expense.item_name.ilike("%ongkir%"),
                Expense.supplier.ilike("%gosend%"),
                Expense.supplier.ilike("%grabexpress%"),
                Expense.supplier.ilike("%lalamove%"),
                Expense.supplier.ilike("%j&t%"),
                Expense.supplier.ilike("%sicepat%"),
                Expense.shipping_fee > 0,
            )
        )

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
    if user_id is not None:
        query = query.where(Expense.user_id == user_id)
    if search:
        search_term = f"%{search.strip()}%"
        query = query.outerjoin(User, Expense.user_id == User.id).where(
            or_(
                Expense.item_name.ilike(search_term),
                Expense.supplier.ilike(search_term),
                Expense.notes.ilike(search_term),
                Expense.invoice_number.ilike(search_term),
                User.name.ilike(search_term),
            )
        )

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    return result.scalars().all(), total


async def get_all_expense_users(db: AsyncSession) -> list[User]:
    """Ambil seluruh user yang terdaftar untuk filter dan atribusi penginput nota."""
    result = await db.execute(
        select(User).order_by(func.coalesce(User.name, "").asc(), User.id.asc())
    )
    return result.scalars().all()


async def get_expense_by_id(db: AsyncSession, expense_id: int) -> Expense | None:
    """Ambil satu expense berdasarkan ID."""
    result = await db.execute(select(Expense).where(Expense.id == expense_id))
    return result.scalar_one_or_none()


async def update_expense(
    db: AsyncSession,
    expense_id: int,
    updates: dict,
    actor: str = "system",
) -> Expense | None:
    """Update field expense yang ada dan catat perubahan di expense_logs."""
    expense = await get_expense_by_id(db, expense_id)
    if not expense:
        return None

    changes = {}
    for field, val in updates.items():
        if hasattr(expense, field):
            old_val = getattr(expense, field)
            # Khusus konversi jika perlu
            if field in ("qty", "unit_price", "shipping_fee", "tax", "other_fee", "discount", "total_price") and val is not None:
                val = Decimal(str(val))
            elif field == "expense_date" and isinstance(val, str):
                try:
                    val = date.fromisoformat(val[:10])
                except (ValueError, TypeError):
                    continue

            # Deteksi perubahan nilai
            if str(old_val) != str(val):
                changes[field] = {
                    "old": float(old_val) if isinstance(old_val, Decimal) else str(old_val),
                    "new": float(val) if isinstance(val, Decimal) else str(val),
                }
            setattr(expense, field, val)

    # Auto-match ke master_item_id jika nama barang berubah tanpa eksplisit master_item_id
    if "item_name" in updates and "master_item_id" not in updates and expense.item_name:
        from app.services.master_item_service import list_master_items, find_best_master_match
        master_items = await list_master_items(db)
        matched = find_best_master_match(expense.item_name, master_items)
        if matched and matched.id != expense.master_item_id:
            changes["master_item_id"] = {
                "old": expense.master_item_id,
                "new": matched.id,
            }
            expense.master_item_id = matched.id

    # Tandai sheets_synced = False agar perubahan tersinkron ulang jika perlu
    expense.sheets_synced = False

    # Catat log jika ada perubahan field
    if changes:
        action = "STATUS_CHANGE" if set(changes.keys()) <= {"pay_status"} else "UPDATE"
        await record_expense_log(
            db,
            expense_id=expense.id,
            action=action,
            actor=actor,
            details={
                "item_name": expense.item_name,
                "supplier": expense.supplier,
                "changes": changes,
            },
        )

        from app.services.alert_service import notify_high_value_expense_action
        diff_lines = [f"• {k}: {v.get('old')} ➔ {v.get('new')}" for k, v in changes.items()]
        await notify_high_value_expense_action(
            action=action,
            item_name=expense.item_name,
            total_price=float(expense.total_price or 0),
            actor=actor,
            date_str=str(expense.expense_date),
            supplier=expense.supplier,
            changes_diff="\n".join(diff_lines),
        )

    await db.flush()
    return expense


async def delete_expense(
    db: AsyncSession,
    expense_id: int,
    actor: str = "system",
) -> bool:
    """Hapus satu record pengeluaran dan catat log aksi DELETE."""
    expense = await get_expense_by_id(db, expense_id)
    if not expense:
        return False

    total_price_val = float(expense.total_price or 0)
    item_name_val = expense.item_name
    supplier_val = expense.supplier
    date_val = str(expense.expense_date)

    # Catat log DELETE sebelum data dihapus dengan snapshot komprehensif
    await record_expense_log(
        db,
        expense_id=expense.id,
        action="DELETE",
        actor=actor,
        details={
            "deleted_expense": {
                "id": expense.id,
                "item_name": expense.item_name,
                "supplier": expense.supplier,
                "total_price": total_price_val,
                "unit_price": float(expense.unit_price or 0),
                "qty": float(expense.qty or 1),
                "unit": expense.unit,
                "shipping_fee": float(expense.shipping_fee or 0),
                "tax": float(expense.tax or 0),
                "other_fee": float(expense.other_fee or 0),
                "discount": float(expense.discount or 0),
                "expense_date": date_val,
                "category": expense.category,
                "pay_status": expense.pay_status,
                "pay_method": getattr(expense, "pay_method", "Tunai"),
                "is_reimbursement": bool(expense.is_reimbursement),
                "reimbursed_at": str(expense.reimbursed_at) if getattr(expense, "reimbursed_at", None) else None,
                "notes": expense.notes,
                "invoice_number": expense.invoice_number,
                "user_id": expense.user_id,
                "master_item_id": expense.master_item_id,
                "msg_link": expense.msg_link,
            }
        },
    )

    await db.delete(expense)
    await db.flush()

    from app.services.alert_service import notify_high_value_expense_action
    await notify_high_value_expense_action(
        action="DELETE",
        item_name=item_name_val,
        total_price=total_price_val,
        actor=actor,
        date_str=date_val,
        supplier=supplier_val,
    )

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
    actor: str = "system",
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
        tot = Decimal(str(item.get("total_price") if item.get("total_price") is not None else (item.get("total_harga") or 0)))
        if tot <= 0:
            continue

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
            total_price=tot,
            pay_method=item.get("pay_method") or "Tunai",
            pay_status=item.get("pay_status") or "Lunas",
            due_date=item.get("due_date") or "-",
            notes=item.get("notes") or "-",
            is_reimbursement=bool(item.get("is_reimbursement", False)),
            invoice_number=str(item.get("invoice_number") or item.get("no_invoice") or "-"),
            msg_link=item.get("msg_link") or "Import CSV",
            user_id=item.get("user_id") or user_id,
            master_item_id=item.get("master_item_id"),
            sheets_synced=sheets_synced,
        )
        db.add(expense)
        saved.append(expense)

    await db.flush()

    for exp in saved:
        await record_expense_log(
            db,
            expense_id=exp.id,
            action="CREATE",
            actor=actor,
            details={
                "item_name": exp.item_name,
                "total_price": float(exp.total_price),
                "supplier": exp.supplier,
                "expense_date": str(exp.expense_date),
                "category": exp.category,
                "msg_link": exp.msg_link,
            },
        )

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
    actor: str = "system",
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
        await record_expense_log(
            db,
            expense_id=e.id,
            action="UPDATE",
            actor=actor,
            details={
                "item_name": e.item_name,
                "changes": {
                    "reimbursed_at": {
                        "old": None,
                        "new": str(now),
                    }
                },
            },
        )
    await db.flush()
    return items


async def get_expense_logs(
    db: AsyncSession,
    expense_id: int,
) -> list[ExpenseLog]:
    """Ambil seluruh riwayat log perubahan untuk suatu transaksi belanja."""
    result = await db.execute(
        select(ExpenseLog)
        .where(ExpenseLog.expense_id == expense_id)
        .order_by(ExpenseLog.created_at.desc(), ExpenseLog.id.desc())
    )
    return list(result.scalars().all())


async def get_recent_expense_logs(
    db: AsyncSession,
    limit: int = 50,
) -> list[ExpenseLog]:
    """Ambil log aktivitas perubahan belanja terkini secara global."""
    result = await db.execute(
        select(ExpenseLog)
        .order_by(ExpenseLog.created_at.desc(), ExpenseLog.id.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_expense_log_by_id(
    db: AsyncSession,
    log_id: int,
) -> ExpenseLog | None:
    """Ambil satu entri log aksi berdasarkan ID."""
    result = await db.execute(select(ExpenseLog).where(ExpenseLog.id == log_id))
    return result.scalar_one_or_none()


async def restore_deleted_expense(
    db: AsyncSession,
    log_id: int,
    actor: str = "dashboard:admin",
) -> Expense | None:
    """Pulihkan data pengeluaran yang pernah dihapus berdasarkan ID ExpenseLog."""
    log = await get_expense_log_by_id(db, log_id)
    if not log or log.action != "DELETE":
        return None

    details = {}
    if log.details:
        try:
            details = json.loads(log.details) if isinstance(log.details, str) else log.details
        except Exception:
            details = {}

    snap = details.get("deleted_expense") or details.get("deleted_record")
    if not snap or not isinstance(snap, dict):
        return None

    exp_date = date.today()
    if snap.get("expense_date"):
        try:
            exp_date = date.fromisoformat(str(snap["expense_date"])[:10])
        except Exception:
            pass

    expense = Expense(
        expense_date=exp_date,
        supplier=snap.get("supplier") or "-",
        item_name=snap.get("item_name") or "Item Dipulihkan",
        category=snap.get("category") or "Operasional",
        qty=Decimal(str(snap.get("qty") or 1)),
        unit=(snap.get("unit") or "Pcs").strip() or "Pcs",
        unit_price=Decimal(str(snap.get("unit_price") or 0)),
        shipping_fee=Decimal(str(snap.get("shipping_fee") or 0)),
        tax=Decimal(str(snap.get("tax") or 0)),
        other_fee=Decimal(str(snap.get("other_fee") or 0)),
        discount=Decimal(str(snap.get("discount") or 0)),
        total_price=Decimal(str(snap.get("total_price") or 0)),
        pay_method=snap.get("pay_method") or snap.get("payment_method") or "Tunai",
        pay_status=snap.get("pay_status") or "Lunas",
        is_reimbursement=bool(snap.get("is_reimbursement", False)),
        notes=snap.get("notes") or "-",
        invoice_number=snap.get("invoice_number") or "-",
        user_id=snap.get("user_id"),
        master_item_id=snap.get("master_item_id"),
        msg_link=snap.get("msg_link") or "Restored Data",
        sheets_synced=False,
    )
    db.add(expense)
    await db.flush()

    await record_expense_log(
        db,
        expense_id=expense.id,
        action="RESTORE",
        actor=actor,
        details={
            "restored_from_log_id": log_id,
            "original_deleted_expense_id": log.expense_id,
            "item_name": expense.item_name,
            "total_price": float(expense.total_price),
            "expense_date": str(expense.expense_date),
        },
    )
    await db.flush()

    from app.services.alert_service import notify_high_value_expense_action
    await notify_high_value_expense_action(
        action="RESTORE",
        item_name=expense.item_name,
        total_price=float(expense.total_price),
        actor=actor,
        date_str=str(expense.expense_date),
        supplier=expense.supplier,
        changes_diff=f"Dipulihkan dari log aksi #{log_id}",
    )

    return expense
