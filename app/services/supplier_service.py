"""
app/services/supplier_service.py — Layanan Master Toko / Supplier
CRUD, pencocokan otomatis, statistik belanja, top items, item termahal, audit duplikat & merge.
"""
import asyncio
import re
from difflib import SequenceMatcher
from datetime import date
from decimal import Decimal
from typing import Any
from sqlalchemy import (
    select, func, desc, asc, or_, and_, update, delete, cast, String, case
)
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.models.supplier import Supplier
from app.models.expense import Expense
from app.models.master_item import MasterItem
from app.models.expense_log import ExpenseLog


def _normalize_supplier_name(s: str) -> str:
    """Bersihkan karakter non-alfanumerik berlebih dan kecilkan huruf."""
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_aliases(aliases_str: str | None) -> list[str]:
    if not aliases_str:
        return []
    return [a.strip() for a in aliases_str.split(",") if a.strip()]


def find_best_supplier_match(
    raw_name: str,
    suppliers: list[Supplier],
    threshold: float = 0.75,
) -> Supplier | None:
    """
    Cari Supplier yang paling cocok dengan teks input (`raw_name`).
    Urutan:
    1. Exact match (case-insensitive) nama atau alias
    2. Token overlap & substring match
    3. Fuzzy SequenceMatcher similarity >= threshold
    """
    if not raw_name or not suppliers:
        return None

    norm_raw = _normalize_supplier_name(raw_name)
    if not norm_raw or norm_raw in ("-", "none", "null"):
        return None

    raw_tokens = set(norm_raw.split())

    # 1. Exact match nama atau alias
    for s in suppliers:
        if norm_raw == _normalize_supplier_name(s.name):
            return s
        for alias in _parse_aliases(s.aliases):
            if norm_raw == _normalize_supplier_name(alias):
                return s

    # 2. Token overlap / substring & fuzzy similarity
    best_match: Supplier | None = None
    best_score: float = 0.0

    for s in suppliers:
        candidates = [s.name] + _parse_aliases(s.aliases)
        for cand in candidates:
            norm_cand = _normalize_supplier_name(cand)
            if not norm_cand:
                continue

            cand_tokens = set(norm_cand.split())
            if cand_tokens and cand_tokens.issubset(raw_tokens):
                score = 0.85 + (0.15 * (len(cand_tokens) / max(len(raw_tokens), 1)))
                if score > best_score:
                    best_score = score
                    best_match = s
                continue

            if raw_tokens and len(norm_raw) >= 4 and raw_tokens.issubset(cand_tokens):
                score = 0.82 + (0.15 * (len(raw_tokens) / max(len(cand_tokens), 1)))
                if score > best_score:
                    best_score = score
                    best_match = s
                continue

            sim = SequenceMatcher(None, norm_raw, norm_cand).ratio()
            if sim >= threshold and sim > best_score:
                best_score = sim
                best_match = s

    return best_match


async def get_or_create_supplier_by_name(
    db: AsyncSession,
    raw_name: str,
    auto_create: bool = True
) -> Supplier | None:
    """
    Ambil atau buat otomatis record Supplier berdasarkan teks nama toko.
    Jika raw_name kosong / '-' kembalikan None.
    """
    name = (raw_name or "").strip()
    if not name or name in ("-", "None", "null"):
        return None

    # Cari exact match dulu (case-insensitive)
    stmt = select(Supplier).where(func.lower(Supplier.name) == name.lower())
    res = await db.execute(stmt)
    supplier = res.scalar_one_or_none()
    if supplier:
        return supplier

    # Cari via aliases dan fuzzy match terhadap semua supplier aktif
    all_suppliers_res = await db.execute(select(Supplier).where(Supplier.is_active == True))
    all_suppliers = list(all_suppliers_res.scalars().all())

    matched = find_best_supplier_match(name, all_suppliers)
    if matched:
        return matched

    if not auto_create:
        return None

    # Buat supplier baru otomatis
    new_supplier = Supplier(
        name=name,
        phone="",
        address="",
        aliases="",
        notes="",
        is_active=True,
    )
    db.add(new_supplier)
    await db.flush()
    return new_supplier


async def get_suppliers(
    db: AsyncSession,
    search: str | None = None,
    is_active: bool | None = None,
    has_unpaid: bool | None = None,
    skip: int = 0,
    limit: int = 50,
    sort_by: str = "total_spent",
    sort_order: str = "desc",
) -> tuple[list[dict], int, dict]:
    """
    Ambil daftar supplier beserta agregasi statistik belanja & tagihan:
    total_spent, transaction_count, unpaid_bills_count, unpaid_bills_total, last_expense_date,
    serta summary agregat seluruh supplier.
    """
    # Subquery agregasi dari tabel expenses
    exp_sub = (
        select(
            Expense.supplier_id.label("sup_id"),
            func.coalesce(func.sum(Expense.total_price), 0).label("total_spent"),
            func.count(Expense.id).label("transaction_count"),
            func.coalesce(
                func.sum(
                    case(
                        (func.lower(Expense.pay_status) != "lunas", 1),
                        else_=0,
                    )
                ),
                0,
            ).label("unpaid_bills_count"),
            func.coalesce(
                func.sum(
                    case(
                        (func.lower(Expense.pay_status) != "lunas", Expense.total_price),
                        else_=0,
                    )
                ),
                0,
            ).label("unpaid_bills_total"),
            func.max(Expense.expense_date).label("last_expense_date"),
        )
        .where(Expense.supplier_id.is_not(None))
        .group_by(Expense.supplier_id)
        .subquery()
    )

    query = (
        select(
            Supplier,
            func.coalesce(exp_sub.c.total_spent, 0).label("total_spent"),
            func.coalesce(exp_sub.c.transaction_count, 0).label("transaction_count"),
            func.coalesce(exp_sub.c.unpaid_bills_count, 0).label("unpaid_bills_count"),
            func.coalesce(exp_sub.c.unpaid_bills_total, 0).label("unpaid_bills_total"),
            exp_sub.c.last_expense_date.label("last_expense_date"),
        )
        .outerjoin(exp_sub, Supplier.id == exp_sub.c.sup_id)
    )

    count_query = select(func.count(Supplier.id)).outerjoin(exp_sub, Supplier.id == exp_sub.c.sup_id)

    filters = []
    if is_active is not None:
        filters.append(Supplier.is_active == is_active)

    if has_unpaid is True:
        filters.append(func.coalesce(exp_sub.c.unpaid_bills_count, 0) > 0)
    elif has_unpaid is False:
        filters.append(func.coalesce(exp_sub.c.unpaid_bills_count, 0) == 0)

    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(Supplier.name).like(term),
                func.lower(Supplier.aliases).like(term),
                func.lower(Supplier.phone).like(term),
                func.lower(Supplier.address).like(term),
            )
        )

    if filters:
        query = query.where(and_(*filters))
        count_query = count_query.where(and_(*filters))

    # Sorting
    order_func = desc if sort_order.lower() == "desc" else asc
    if sort_by == "name":
        query = query.order_by(order_func(func.lower(Supplier.name)))
    elif sort_by == "transaction_count":
        query = query.order_by(order_func("transaction_count"), desc(Supplier.id))
    elif sort_by == "unpaid_bills_total":
        query = query.order_by(order_func("unpaid_bills_total"), desc(Supplier.id))
    elif sort_by == "unpaid_bills_count":
        query = query.order_by(order_func("unpaid_bills_count"), desc(Supplier.id))
    elif sort_by == "last_expense_date":
        query = query.order_by(order_func("last_expense_date").nulls_last(), desc(Supplier.id))
    elif sort_by == "created_at":
        query = query.order_by(order_func(Supplier.created_at))
    else:  # default: total_spent
        query = query.order_by(order_func("total_spent"), desc(Supplier.id))

    total_count = (await db.execute(count_query)).scalar_one()

    rows = (await db.execute(query.offset(skip).limit(limit))).all()

    items = []
    for supp, total_spent, tx_count, unpaid_count, unpaid_total, last_date in rows:
        items.append({
            "id": supp.id,
            "name": supp.name,
            "phone": supp.phone or "",
            "address": supp.address or "",
            "aliases": supp.aliases or "",
            "notes": supp.notes or "",
            "is_active": supp.is_active,
            "created_at": supp.created_at,
            "updated_at": supp.updated_at,
            "total_spent": float(total_spent or 0),
            "transaction_count": int(tx_count or 0),
            "unpaid_bills_count": int(unpaid_count or 0),
            "unpaid_bills_total": float(unpaid_total or 0),
            "last_expense_date": last_date.isoformat() if last_date else None,
        })

    # Summary agregat untuk list supplier
    summary_stmt = (
        select(
            func.count(Supplier.id).label("total_suppliers"),
            func.coalesce(func.sum(exp_sub.c.total_spent), 0).label("total_spent"),
            func.coalesce(func.sum(exp_sub.c.unpaid_bills_total), 0).label("total_unpaid_amount"),
            func.coalesce(
                func.sum(
                    case(
                        (exp_sub.c.unpaid_bills_count > 0, 1),
                        else_=0,
                    )
                ),
                0,
            ).label("unpaid_suppliers_count"),
        )
        .outerjoin(exp_sub, Supplier.id == exp_sub.c.sup_id)
    )
    if is_active is not None:
        summary_stmt = summary_stmt.where(Supplier.is_active == is_active)

    summary_row = (await db.execute(summary_stmt)).one()
    summary = {
        "total_suppliers": int(summary_row.total_suppliers or 0),
        "total_spent": float(summary_row.total_spent or 0),
        "total_unpaid_amount": float(summary_row.total_unpaid_amount or 0),
        "unpaid_suppliers_count": int(summary_row.unpaid_suppliers_count or 0),
    }

    return items, total_count, summary


async def get_supplier_by_id(db: AsyncSession, supplier_id: int) -> dict | None:
    """Ambil detail supplier beserta ringkasan statistik lengkap & daftar tagihan belum lunas."""
    supp = await db.get(Supplier, supplier_id)
    if not supp:
        return None

    # Hitung statistik
    stats_query = select(
        func.coalesce(func.sum(Expense.total_price), 0).label("total_spent"),
        func.count(Expense.id).label("transaction_count"),
        func.coalesce(
            func.sum(
                case(
                    (func.lower(Expense.pay_status) != "lunas", 1),
                    else_=0,
                )
            ),
            0,
        ).label("unpaid_bills_count"),
        func.coalesce(
            func.sum(
                case(
                    (func.lower(Expense.pay_status) != "lunas", Expense.total_price),
                    else_=0,
                )
            ),
            0,
        ).label("unpaid_bills_total"),
        func.min(Expense.expense_date).label("first_expense_date"),
        func.max(Expense.expense_date).label("last_expense_date"),
    ).where(Expense.supplier_id == supplier_id)

    stats = (await db.execute(stats_query)).one()
    total_spent = float(stats.total_spent or 0)
    tx_count = int(stats.transaction_count or 0)
    unpaid_count = int(stats.unpaid_bills_count or 0)
    unpaid_total = float(stats.unpaid_bills_total or 0)
    avg_per_tx = total_spent / tx_count if tx_count > 0 else 0.0

    # Ambil detail daftar tagihan belum lunas di toko ini
    unpaid_bills_query = (
        select(Expense)
        .where(
            Expense.supplier_id == supplier_id,
            func.lower(Expense.pay_status) != "lunas",
        )
        .order_by(asc(Expense.expense_date), asc(Expense.id))
    )
    unpaid_expenses = (await db.execute(unpaid_bills_query)).scalars().all()
    unpaid_bills = [
        {
            "id": e.id,
            "expense_date": str(e.expense_date),
            "item_name": e.item_name,
            "total_price": float(e.total_price or 0),
            "due_date": e.due_date or "-",
            "invoice_number": e.invoice_number or "-",
            "notes": e.notes or "-",
            "category": e.category or "Operasional",
            "pay_method": e.pay_method or "Tunai",
            "pay_status": e.pay_status or "Belum Lunas",
        }
        for e in unpaid_expenses
    ]

    return {
        "id": supp.id,
        "name": supp.name,
        "phone": supp.phone or "",
        "address": supp.address or "",
        "aliases": supp.aliases or "",
        "notes": supp.notes or "",
        "is_active": supp.is_active,
        "created_at": supp.created_at,
        "updated_at": supp.updated_at,
        "total_spent": total_spent,
        "transaction_count": tx_count,
        "unpaid_bills_count": unpaid_count,
        "unpaid_bills_total": unpaid_total,
        "unpaid_bills": unpaid_bills,
        "avg_per_transaction": avg_per_tx,
        "first_expense_date": stats.first_expense_date.isoformat() if stats.first_expense_date else None,
        "last_expense_date": stats.last_expense_date.isoformat() if stats.last_expense_date else None,
    }


async def create_supplier(
    db: AsyncSession,
    name: str,
    phone: str = "",
    address: str = "",
    aliases: str = "",
    notes: str = "",
    is_active: bool = True,
) -> Supplier:
    """Buat master supplier baru dengan validasi keunikan nama."""
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nama supplier / toko wajib diisi.",
        )

    # Cek duplikat nama
    existing = (
        await db.execute(
            select(Supplier).where(func.lower(Supplier.name) == clean_name.lower())
        )
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Supplier dengan nama '{clean_name}' sudah ada.",
        )

    supplier = Supplier(
        name=clean_name,
        phone=phone.strip(),
        address=address.strip(),
        aliases=aliases.strip(),
        notes=notes.strip(),
        is_active=is_active,
    )
    db.add(supplier)
    await db.flush()
    return supplier


async def update_supplier(
    db: AsyncSession,
    supplier_id: int,
    name: str | None = None,
    phone: str | None = None,
    address: str | None = None,
    aliases: str | None = None,
    notes: str | None = None,
    is_active: bool | None = None,
) -> Supplier:
    """Update informasi master supplier."""
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )

    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nama supplier tidak boleh kosong.",
            )
        # Cek bentrok nama dengan ID lain
        duplicate = (
            await db.execute(
                select(Supplier).where(
                    func.lower(Supplier.name) == clean_name.lower(),
                    Supplier.id != supplier_id,
                )
            )
        ).scalar_one_or_none()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supplier dengan nama '{clean_name}' sudah digunakan oleh data lain.",
            )
        supplier.name = clean_name

    if phone is not None:
        supplier.phone = phone.strip()
    if address is not None:
        supplier.address = address.strip()
    if aliases is not None:
        supplier.aliases = aliases.strip()
    if notes is not None:
        supplier.notes = notes.strip()
    if is_active is not None:
        supplier.is_active = is_active

    await db.flush()
    return supplier


async def delete_supplier(
    db: AsyncSession,
    supplier_id: int,
    actor: str = "owner",
) -> None:
    """
    Hapus supplier (Hanya Owner).
    Transaksi belanja yang terhubung akan di-set supplier_id = NULL,
    nama teks supplier di expense tetap dipertahankan.
    """
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )

    # Lepas relasi di tabel expenses
    await db.execute(
        update(Expense)
        .where(Expense.supplier_id == supplier_id)
        .values(supplier_id=None)
    )

    # Catat audit log
    log = ExpenseLog(
        expense_id=None,
        action="DELETE_SUPPLIER",
        actor=actor,
        details=f"Menghapus master supplier #{supplier.id} ('{supplier.name}'). Relasi expense di-unlink.",
    )
    db.add(log)

    await db.delete(supplier)
    await db.flush()


async def get_supplier_expenses(
    db: AsyncSession,
    supplier_id: int,
    start_date: date | None = None,
    end_date: date | None = None,
    category: str | None = None,
    pay_status: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[Expense], int]:
    """Riwayat belanja di toko ini dengan paginasi dan filter periode."""
    supp = await db.get(Supplier, supplier_id)
    if not supp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )

    filters = [Expense.supplier_id == supplier_id]
    if start_date:
        filters.append(Expense.expense_date >= start_date)
    if end_date:
        filters.append(Expense.expense_date <= end_date)
    if category and category.strip():
        filters.append(Expense.category == category.strip())
    if pay_status and pay_status.strip():
        ps = pay_status.strip().lower()
        if ps == "unpaid":
            filters.append(func.lower(Expense.pay_status) != "lunas")
        else:
            filters.append(func.lower(Expense.pay_status) == ps)

    count_stmt = select(func.count(Expense.id)).where(and_(*filters))
    total_count = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(Expense)
        .where(and_(*filters))
        .order_by(desc(Expense.expense_date), desc(Expense.id))
        .offset(skip)
        .limit(limit)
    )
    expenses = (await db.execute(stmt)).scalars().all()
    return list(expenses), total_count


async def get_supplier_top_items(
    db: AsyncSession,
    supplier_id: int,
    limit: int = 10,
) -> list[dict]:
    """
    Item yang paling sering dibeli di toko ini.
    Dikelompokkan berdasarkan master_item_id (fallback ke item_name).
    """
    supp = await db.get(Supplier, supplier_id)
    if not supp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )

    # Kelompokkan berdasarkan master_item_id jika ada, atau teks nama item jika tidak ada
    group_key = func.coalesce(
        cast(Expense.master_item_id, String),
        func.lower(func.trim(Expense.item_name))
    )

    stmt = (
        select(
            group_key.label("grp"),
            func.coalesce(func.max(MasterItem.item_name), func.max(Expense.item_name)).label("item_name"),
            func.max(Expense.master_item_id).label("master_item_id"),
            func.coalesce(func.max(MasterItem.category), func.max(Expense.category)).label("category"),
            func.count(Expense.id).label("purchase_count"),
            func.sum(Expense.qty).label("total_qty"),
            func.max(Expense.unit).label("unit"),
            func.sum(Expense.total_price).label("total_spent"),
        )
        .outerjoin(MasterItem, Expense.master_item_id == MasterItem.id)
        .where(Expense.supplier_id == supplier_id)
        .group_by("grp")
        .order_by(desc("purchase_count"), desc("total_spent"))
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    result = []
    for r in rows:
        result.append({
            "item_name": r.item_name,
            "master_item_id": r.master_item_id,
            "category": r.category or "Lainnya",
            "purchase_count": int(r.purchase_count),
            "total_qty": float(r.total_qty or 0),
            "unit": r.unit or "Pcs",
            "total_spent": float(r.total_spent or 0),
        })
    return result


async def get_supplier_priciest_items(
    db: AsyncSession,
    supplier_id: int,
    limit: int = 10,
) -> list[dict]:
    """
    Item dengan harga satuan (unit_price) tertinggi yang pernah dibeli di toko ini.
    Dikelompokkan berdasarkan master_item_id (fallback ke item_name).
    """
    supp = await db.get(Supplier, supplier_id)
    if not supp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )

    # Subquery untuk harga satuan tertinggi per item
    group_key = func.coalesce(
        cast(Expense.master_item_id, String),
        func.lower(func.trim(Expense.item_name))
    )

    stmt = (
        select(
            group_key.label("grp"),
            func.coalesce(func.max(MasterItem.item_name), func.max(Expense.item_name)).label("item_name"),
            func.max(Expense.master_item_id).label("master_item_id"),
            func.coalesce(func.max(MasterItem.category), func.max(Expense.category)).label("category"),
            func.max(Expense.unit_price).label("max_unit_price"),
            func.max(Expense.unit).label("unit"),
            func.max(Expense.expense_date).label("last_purchase_date"),
        )
        .outerjoin(MasterItem, Expense.master_item_id == MasterItem.id)
        .where(
            Expense.supplier_id == supplier_id,
            Expense.unit_price > 0,
        )
        .group_by("grp")
        .order_by(desc("max_unit_price"))
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    result = []
    for r in rows:
        result.append({
            "item_name": r.item_name,
            "master_item_id": r.master_item_id,
            "category": r.category or "Lainnya",
            "max_unit_price": float(r.max_unit_price or 0),
            "unit": r.unit or "Pcs",
            "last_purchase_date": r.last_purchase_date.isoformat() if r.last_purchase_date else None,
        })
    return result


def _compute_supplier_duplicates(
    suppliers: list[Supplier],
    tx_map: dict[int, tuple[int, float]],
    threshold: float,
) -> list[dict]:
    """Hitung cluster duplikat supplier secara efisien di threadpool."""
    clusters: list[dict] = []
    visited_ids = set()
    n = len(suppliers)

    # Pre-parse attributes
    parsed = []
    for s in suppliers:
        norm = _normalize_supplier_name(s.name)
        toks = set(norm.split())
        aliases = [_normalize_supplier_name(a) for a in _parse_aliases(s.aliases)]
        s_cnt, s_spent = tx_map.get(s.id, (0, 0.0))
        parsed.append({
            "supplier": s,
            "norm": norm,
            "len": len(norm),
            "tokens": toks,
            "aliases": aliases,
            "cnt": s_cnt,
            "spent": s_spent,
        })

    for i in range(n):
        p1 = parsed[i]
        s1 = p1["supplier"]
        if s1.id in visited_ids:
            continue

        norm1 = p1["norm"]
        len1 = p1["len"]
        tokens1 = p1["tokens"]
        aliases1 = p1["aliases"]
        s1_cnt = p1["cnt"]
        s1_spent = p1["spent"]

        duplicates = []

        for j in range(i + 1, n):
            p2 = parsed[j]
            s2 = p2["supplier"]
            if s2.id in visited_ids:
                continue

            norm2 = p2["norm"]
            len2 = p2["len"]
            tokens2 = p2["tokens"]
            aliases2 = p2["aliases"]
            s2_cnt = p2["cnt"]
            s2_spent = p2["spent"]

            reason = None
            sim_score = 0.0

            if norm1 == norm2:
                reason = "Nama persis sama (hanya beda kapitalisasi/spasi)"
                sim_score = 1.0
            elif norm2 in aliases1 or norm1 in aliases2:
                reason = "Salah satu nama terdaftar sebagai alias"
                sim_score = 0.95
            elif tokens1 and tokens2 and (tokens1.issubset(tokens2) or tokens2.issubset(tokens1)):
                if min(len1, len2) >= 4:
                    reason = f"Nama merupakan bagian dari nama toko lain ('{s1.name}' & '{s2.name}')"
                    sim_score = 0.88
            else:
                max_ratio = (2.0 * min(len1, len2)) / (len1 + len2) if (len1 + len2) > 0 else 0.0
                if max_ratio >= threshold:
                    union_tok = len(tokens1 | tokens2)
                    jaccard = (len(tokens1 & tokens2) / union_tok) if union_tok > 0 else 0.0
                    if jaccard > 0 or min(len1, len2) < 8 or (len1 >= 4 and len2 >= 4 and norm1[:4] == norm2[:4]):
                        ratio = SequenceMatcher(None, norm1, norm2).ratio()
                        if ratio >= threshold:
                            reason = f"Kemiripan teks {int(ratio * 100)}%"
                            sim_score = ratio

            if reason:
                duplicates.append({
                    "id": s2.id,
                    "name": s2.name,
                    "phone": s2.phone or "",
                    "address": s2.address or "",
                    "transaction_count": s2_cnt,
                    "total_spent": s2_spent,
                    "similarity": round(sim_score, 2),
                    "reason": reason,
                })
                visited_ids.add(s2.id)

        if duplicates:
            visited_ids.add(s1.id)
            all_in_cluster = [{
                "id": s1.id,
                "name": s1.name,
                "phone": s1.phone or "",
                "address": s1.address or "",
                "transaction_count": s1_cnt,
                "total_spent": s1_spent,
            }] + [
                {
                    "id": d["id"],
                    "name": d["name"],
                    "phone": d["phone"],
                    "address": d["address"],
                    "transaction_count": d["transaction_count"],
                    "total_spent": d["total_spent"],
                }
                for d in duplicates
            ]

            all_in_cluster.sort(key=lambda x: (x["transaction_count"], x["total_spent"]), reverse=True)
            suggested_primary_id = all_in_cluster[0]["id"]

            clusters.append({
                "suggested_primary_id": suggested_primary_id,
                "primary": {
                    "id": s1.id,
                    "name": s1.name,
                    "phone": s1.phone or "",
                    "address": s1.address or "",
                    "transaction_count": s1_cnt,
                    "total_spent": s1_spent,
                },
                "duplicates": duplicates,
            })

    return clusters


async def audit_duplicate_suppliers(
    db: AsyncSession,
    threshold: float = 0.75,
) -> list[dict]:
    """
    Audit kemungkinan toko/supplier ganda atau penulisan mirip.
    Mengembalikan cluster kandidat duplikat dengan kalkulasi threadpool non-blocking.
    """
    suppliers_res = await db.execute(
        select(Supplier).order_by(Supplier.name)
    )
    suppliers = list(suppliers_res.scalars().all())

    tx_counts_res = await db.execute(
        select(
            Expense.supplier_id,
            func.count(Expense.id).label("cnt"),
            func.coalesce(func.sum(Expense.total_price), 0).label("spent"),
        )
        .where(Expense.supplier_id.is_not(None))
        .group_by(Expense.supplier_id)
    )
    tx_map = {row.supplier_id: (row.cnt, float(row.spent)) for row in tx_counts_res.all()}

    return await asyncio.to_thread(_compute_supplier_duplicates, suppliers, tx_map, threshold)


async def merge_suppliers(
    db: AsyncSession,
    target_id: int,
    source_ids: list[int],
    actor: str = "owner",
) -> dict:
    """
    Gabungkan supplier duplikat (Hanya Owner).
    Semua transaksi expenses dialihkan ke target_id.
    Nama-nama supplier sumber dimasukkan ke alias target_id.
    Supplier sumber dihapus.
    """
    if not source_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Daftar supplier sumber yang akan digabung tidak boleh kosong.",
        )

    if target_id in source_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target gabung tidak boleh ada di dalam daftar sumber yang akan digabung.",
        )

    target = await db.get(Supplier, target_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target supplier #{target_id} tidak ditemukan.",
        )

    source_suppliers = (
        await db.execute(select(Supplier).where(Supplier.id.in_(source_ids)))
    ).scalars().all()

    if not source_suppliers:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tidak ada supplier sumber yang ditemukan.",
        )

    # Kumpulkan alias baru dari nama supplier sumber
    existing_aliases = set(_parse_aliases(target.aliases))
    merged_names = []

    for src in source_suppliers:
        merged_names.append(f"#{src.id} '{src.name}'")
        if src.name.lower() != target.name.lower():
            existing_aliases.add(src.name)
        for a in _parse_aliases(src.aliases):
            if a.lower() != target.name.lower():
                existing_aliases.add(a)

        # Lengkapi kontak jika target kosong
        if not target.phone and src.phone:
            target.phone = src.phone
        if not target.address and src.address:
            target.address = src.address
        if not target.notes and src.notes:
            target.notes = src.notes

    target.aliases = ", ".join(sorted(existing_aliases))

    # Pindahkan semua expenses ke target_id dan perbarui nama supplier teksnya
    update_res = await db.execute(
        update(Expense)
        .where(Expense.supplier_id.in_(source_ids))
        .values(
            supplier_id=target.id,
            supplier=target.name,
        )
    )
    expenses_moved = update_res.rowcount

    # Hapus supplier sumber
    await db.execute(
        delete(Supplier).where(Supplier.id.in_(source_ids))
    )

    # Catat audit log
    log = ExpenseLog(
        expense_id=None,
        action="MERGE_SUPPLIERS",
        actor=actor,
        details=(
            f"Menggabungkan supplier {', '.join(merged_names)} ke #{target.id} '{target.name}'. "
            f"Sebanyak {expenses_moved} transaksi belanja dialihkan."
        ),
    )
    db.add(log)
    await db.flush()

    return {
        "success": True,
        "target_supplier_id": target.id,
        "target_supplier_name": target.name,
        "merged_supplier_count": len(source_suppliers),
        "expenses_transferred": expenses_moved,
    }


async def sync_existing_expenses(db: AsyncSession) -> dict:
    """
    Sinkronisasi transaksi belanja lama yang belum terhubung ke master supplier.
    Mencari supplier yang cocok atau membuat otomatis record supplier jika belum ada.
    """
    # Ambil expenses yang supplier_id IS NULL dan nama supplier-nya valid
    stmt = select(Expense).where(
        Expense.supplier_id.is_(None),
        Expense.supplier.is_not(None),
        func.trim(Expense.supplier) != "",
        func.trim(Expense.supplier) != "-",
        func.trim(Expense.supplier) != "None",
    )
    unlinked_expenses = (await db.execute(stmt)).scalars().all()

    if not unlinked_expenses:
        return {
            "synced_count": 0,
            "created_suppliers": 0,
            "message": "Semua data belanja sudah tersinkronisasi dengan master supplier.",
        }

    # Muat semua supplier yang sudah ada
    all_suppliers = list((await db.execute(select(Supplier))).scalars().all())
    supplier_cache: dict[str, Supplier] = {}
    created_count = 0
    synced_count = 0

    for exp in unlinked_expenses:
        raw_name = (exp.supplier or "").strip()
        if not raw_name or raw_name in ("-", "None"):
            continue

        norm = _normalize_supplier_name(raw_name)
        supplier = supplier_cache.get(norm)

        if not supplier:
            supplier = find_best_supplier_match(raw_name, all_suppliers)
            if not supplier:
                # Buat supplier baru
                supplier = Supplier(
                    name=raw_name,
                    phone="",
                    address="",
                    aliases="",
                    notes="",
                    is_active=True,
                )
                db.add(supplier)
                await db.flush()
                all_suppliers.append(supplier)
                created_count += 1

            supplier_cache[norm] = supplier

        exp.supplier_id = supplier.id
        synced_count += 1

    await db.flush()
    return {
        "synced_count": synced_count,
        "created_suppliers": created_count,
        "message": f"Berhasil mensinkronisasi {synced_count} transaksi belanja ({created_count} supplier baru dibuat).",
    }
