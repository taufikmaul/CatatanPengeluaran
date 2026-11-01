"""
app/services/purchase_request_service.py — Layanan CRUD & Alur Pengajuan Belanja Multi-Item
Mendukung 3 peran:
1. Karyawan Toko/Dapur: Mengajukan daftar belanja multi-item yang simple & cepat
2. Purchasing: Mapping supplier, mengelompokkan pesanan per supplier, generate format WA/Email, order
3. Gudang: Memeriksa fisik (sesuai/kurang/lebih), input tanggal expired, dan catatan kondisi
"""
from datetime import datetime, date
from decimal import Decimal
import logging
from typing import Any
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.purchase_request import PurchaseRequest, PurchaseRequestItem
from app.models.user import User
from app.models.master_item import MasterItem
from app.models.supplier import Supplier
from app.models.expense import Expense

logger = logging.getLogger(__name__)


def _generate_req_number(req_id: int, req_date: date) -> str:
    """Format nomor request: REQ-YYYYMMDD-ID"""
    d_str = req_date.strftime("%Y%m%d")
    return f"REQ-{d_str}-{req_id:03d}"


async def create_purchase_request(
    db: AsyncSession,
    item_name: str | None = None,
    qty: Decimal | float = 1,
    unit: str = "Pcs",
    category: str | None = None,
    estimated_price: Decimal | float | None = None,
    urgency: str = "NORMAL",
    notes: str = "-",
    user_id: int | None = None,
    requester_name: str = "-",
    request_date: date | None = None,
    title: str = "Request Belanja",
    items: list[dict] | None = None,
) -> PurchaseRequest:
    """
    Buat data pengajuan belanja baru.
    Mendukung pembuatan multi-item (jika items diberikan) atau single item (fallback).
    """
    clean_urgency = "URGENT" if str(urgency).upper() in ("URGENT", "MENDESAK", "DARURAT") else "NORMAL"
    req_date = request_date or date.today()

    # Resolusi nama pemohon
    req_name = requester_name.strip() if requester_name else "-"
    if user_id and req_name in ("-", "", "None"):
        u_res = await db.execute(select(User).where(User.id == user_id))
        user_obj = u_res.scalar_one_or_none()
        if user_obj and user_obj.name:
            req_name = user_obj.name

    # Header pengajuan
    req = PurchaseRequest(
        title=title.strip() if title else "Request Belanja",
        request_date=req_date,
        user_id=user_id,
        requester_name=req_name or "Staf Toko",
        urgency=clean_urgency,
        notes=notes.strip() if notes else "-",
        status="PENDING",
        # Simpan ringkasan single-item untuk backward compatibility jika ada
        item_name=item_name.strip() if item_name else (items[0].get("item_name") if items else "Item Belanja"),
        qty=Decimal(str(qty)) if qty else Decimal("1"),
        unit=unit.strip() if unit else "Pcs",
        category=category,
        estimated_price=Decimal(str(estimated_price)) if estimated_price is not None else None,
    )
    db.add(req)
    await db.flush()

    # Set nomor request resmi
    req.request_number = _generate_req_number(req.id, req_date)

    # Siapkan daftar item detail
    raw_items = items if items else []
    if not raw_items and item_name:
        raw_items = [{
            "item_name": item_name,
            "qty": qty,
            "unit": unit,
            "category": category,
            "estimated_price": estimated_price,
            "notes": notes,
        }]

    # Lookup master items untuk auto-assign supplier & harga estimasi
    from app.services.master_item_service import list_master_items, find_best_master_match
    master_items = await list_master_items(db)

    for it in raw_items:
        it_name = (it.get("item_name") or it.get("barang") or "").strip()
        if not it_name:
            continue

        it_qty = Decimal(str(it.get("qty") or 1))
        it_unit = (it.get("unit") or it.get("satuan") or "Pcs").strip() or "Pcs"
        it_cat = it.get("category") or it.get("kategori") or "Bahan Kue"
        it_notes = (it.get("notes") or it.get("catatan") or "-").strip()

        # Cek kecocokan master item
        matched_master = find_best_master_match(it_name, master_items)
        master_id = matched_master.id if matched_master else None
        sup_id = None
        sup_name = "-"
        est_price = Decimal(str(it["estimated_price"])) if it.get("estimated_price") is not None else None

        if matched_master:
            it_cat = matched_master.category or it_cat
            if matched_master.default_supplier and matched_master.default_supplier != "-":
                sup_name = matched_master.default_supplier
                # Cari supplier_id jika ada di tabel suppliers
                s_res = await db.execute(select(Supplier).where(Supplier.name == sup_name))
                s_obj = s_res.scalar_one_or_none()
                if s_obj:
                    sup_id = s_obj.id

        # Fallback estimasi harga dari histori jika kosong
        if est_price is None:
            try:
                from app.services.expense_service import search_last_price
                last_exp = await search_last_price(db, it_name)
                if last_exp:
                    if last_exp.unit_price:
                        est_price = Decimal(str(last_exp.unit_price))
                    if sup_name == "-" and last_exp.supplier and last_exp.supplier != "-":
                        sup_name = last_exp.supplier
                        sup_id = last_exp.supplier_id
            except Exception:
                pass

        req_item = PurchaseRequestItem(
            request_id=req.id,
            item_name=it_name,
            master_item_id=master_id,
            qty=it_qty,
            unit=it_unit,
            category=it_cat,
            notes=it_notes,
            supplier_id=sup_id,
            supplier_name=sup_name,
            estimated_price=est_price,
            order_status="PENDING",
            receiving_status="PENDING",
        )
        db.add(req_item)

    await db.commit()
    await db.refresh(req)
    return req


async def get_purchase_requests(
    db: AsyncSession,
    status: str | None = None,
    urgency: str | None = None,
    user_id: int | None = None,
    search: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[PurchaseRequest], int]:
    """Ambil daftar header pengajuan belanja lengkap dengan rincian itemnya."""
    query = select(PurchaseRequest).options(
        selectinload(PurchaseRequest.items).selectinload(PurchaseRequestItem.supplier),
        selectinload(PurchaseRequest.items).selectinload(PurchaseRequestItem.master_item),
    )
    count_query = select(func.count(PurchaseRequest.id))

    filters = []
    if status and status.upper() != "ALL":
        filters.append(PurchaseRequest.status == status.upper())
    if urgency and urgency.upper() != "ALL":
        filters.append(PurchaseRequest.urgency == urgency.upper())
    if user_id:
        filters.append(PurchaseRequest.user_id == user_id)
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(PurchaseRequest.title).like(term),
                func.lower(PurchaseRequest.request_number).like(term),
                func.lower(PurchaseRequest.requester_name).like(term),
                func.lower(PurchaseRequest.notes).like(term),
                PurchaseRequest.items.any(func.lower(PurchaseRequestItem.item_name).like(term)),
            )
        )
    if start_date:
        filters.append(PurchaseRequest.request_date >= start_date)
    if end_date:
        filters.append(PurchaseRequest.request_date <= end_date)

    if filters:
        query = query.where(and_(*filters))
        count_query = count_query.where(and_(*filters))

    query = query.order_by(
        desc(PurchaseRequest.urgency == "URGENT"),
        desc(PurchaseRequest.request_date),
        desc(PurchaseRequest.id),
    ).offset(offset).limit(limit)

    total_res = await db.execute(count_query)
    total_count = total_res.scalar_one_or_none() or 0

    items_res = await db.execute(query)
    items = list(items_res.scalars().all())

    return items, total_count


async def get_purchase_request_by_id(
    db: AsyncSession, request_id: int
) -> PurchaseRequest | None:
    """Ambil detail satu pengajuan belanja."""
    res = await db.execute(
        select(PurchaseRequest)
        .options(
            selectinload(PurchaseRequest.items).selectinload(PurchaseRequestItem.supplier),
            selectinload(PurchaseRequest.items).selectinload(PurchaseRequestItem.master_item),
        )
        .where(PurchaseRequest.id == request_id)
    )
    return res.scalar_one_or_none()


async def approve_purchase_request(
    db: AsyncSession,
    request_id: int,
    reviewer_id: int | None = None,
    reviewer_name: str | None = None,
) -> PurchaseRequest | None:
    """Setujui pengajuan belanja (oleh Admin / Owner)."""
    req = await get_purchase_request_by_id(db, request_id)
    if not req:
        return None

    req.status = "APPROVED"
    req.reviewed_by_id = reviewer_id
    req.reviewer_name = reviewer_name or req.reviewer_name or "Admin"
    req.reviewed_at = datetime.utcnow()
    req.reject_reason = None

    await db.commit()
    await db.refresh(req)
    return req


async def reject_purchase_request(
    db: AsyncSession,
    request_id: int,
    reviewer_id: int | None = None,
    reviewer_name: str | None = None,
    reason: str | None = None,
) -> PurchaseRequest | None:
    """Tolak pengajuan belanja."""
    req = await get_purchase_request_by_id(db, request_id)
    if not req:
        return None

    req.status = "REJECTED"
    req.reviewed_by_id = reviewer_id
    req.reviewer_name = reviewer_name or req.reviewer_name or "Admin"
    req.reviewed_at = datetime.utcnow()
    req.reject_reason = reason or "Ditolak oleh admin"

    await db.commit()
    await db.refresh(req)
    return req


# ──────────────────────────────────────────────
# Modul Purchasing: Kelompokkan per Supplier & Order
# ──────────────────────────────────────────────

async def update_item_supplier(
    db: AsyncSession,
    item_id: int,
    supplier_id: int | None = None,
    supplier_name: str | None = None,
    estimated_price: Decimal | float | None = None,
) -> PurchaseRequestItem | None:
    """Purchasing mengaitkan item belanjaan dengan supplier tertentu."""
    res = await db.execute(
        select(PurchaseRequestItem).where(PurchaseRequestItem.id == item_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        return None

    if supplier_id is not None:
        item.supplier_id = supplier_id
        sup = await db.get(Supplier, supplier_id)
        if sup:
            item.supplier_name = sup.name
    elif supplier_name is not None:
        item.supplier_name = supplier_name.strip()

    if estimated_price is not None:
        item.estimated_price = Decimal(str(estimated_price))

    await db.commit()
    await db.refresh(item)
    return item


async def get_purchasing_grouped_orders(
    db: AsyncSession,
    status: str = "APPROVED",
) -> list[dict]:
    """
    Kelompokkan item-item belanjaan yang siap dibeli berdasarkan Supplier.
    Sangat memudahkan bagian purchasing untuk memesan ke masing-masing toko/vendor.
    """
    stmt = (
        select(PurchaseRequestItem)
        .join(PurchaseRequest, PurchaseRequestItem.request_id == PurchaseRequest.id)
        .options(
            selectinload(PurchaseRequestItem.request),
            selectinload(PurchaseRequestItem.supplier),
        )
        .where(
            or_(
                PurchaseRequest.status == "APPROVED",
                PurchaseRequest.status == "PARTIAL_ORDERED",
                PurchaseRequestItem.order_status == "PENDING",
            )
        )
        .order_by(PurchaseRequestItem.supplier_name.asc(), PurchaseRequestItem.id.asc())
    )
    res = await db.execute(stmt)
    all_items = res.scalars().all()

    grouped: dict[str, dict] = {}
    for it in all_items:
        sup_key = it.supplier_name.strip() if it.supplier_name and it.supplier_name != "-" else "Belum Ditentukan"
        if sup_key not in grouped:
            sup_phone = it.supplier.phone if it.supplier and it.supplier.phone else ""
            sup_addr = it.supplier.address if it.supplier and it.supplier.address else ""
            grouped[sup_key] = {
                "supplier_name": sup_key,
                "supplier_id": it.supplier_id,
                "supplier_phone": sup_phone,
                "supplier_address": sup_addr,
                "total_items": 0,
                "items": [],
            }
        grouped[sup_key]["items"].append(it)
        grouped[sup_key]["total_items"] += 1

    return list(grouped.values())


def generate_whatsapp_order_text(
    supplier_name: str,
    items: list[Any],
    store_name: str = "Historycake Bakery",
    custom_notes: str = "",
) -> str:
    """
    Format teks pesanan WhatsApp / Email yang sopan & profesional.
    Siap di-copy 1-klik oleh purchasing.
    """
    today_str = date.today().strftime("%d %b %Y")
    lines = [
        f"Halo *{supplier_name}*,",
        f"Mohon disiapkan pesanan dari *{store_name}* untuk tanggal *{today_str}* ya kak:",
        "",
        "📋 *DAFTAR PESANAN:*",
    ]

    for idx, it in enumerate(items, 1):
        name = it.get("item_name") if isinstance(it, dict) else it.item_name
        qty = it.get("qty") if isinstance(it, dict) else float(it.qty)
        unit = it.get("unit") if isinstance(it, dict) else it.unit
        notes = it.get("notes") if isinstance(it, dict) else it.notes
        
        note_str = f" _({notes})_" if notes and notes != "-" else ""
        lines.append(f"{idx}. {name} — *{qty:g} {unit}*{note_str}")

    lines.append("")
    if custom_notes:
        lines.append(f"📌 *Catatan:* {custom_notes}")
    lines.append("Mohon konfirmasi ketersediaan barang dan total biayanya. Terima kasih! 🙏")

    return "\n".join(lines)


async def mark_items_as_ordered(
    db: AsyncSession,
    item_ids: list[int],
    actor: str = "Purchasing",
) -> list[PurchaseRequestItem]:
    """
    Tandai item-item belanjaan telah dipesan ke supplier (ORDERED).
    Otomatis mengupdate status PurchaseRequest terkait jika semua itemnya sudah dipesan.
    """
    stmt = select(PurchaseRequestItem).where(PurchaseRequestItem.id.in_(item_ids))
    res = await db.execute(stmt)
    items = res.scalars().all()

    now = datetime.utcnow()
    affected_request_ids = set()

    for it in items:
        it.order_status = "ORDERED"
        it.ordered_at = now
        affected_request_ids.add(it.request_id)

    # Cek & update status header PurchaseRequest
    for req_id in affected_request_ids:
        req = await get_purchase_request_by_id(db, req_id)
        if req and req.items:
            all_ordered = all(i.order_status in ("ORDERED", "CANCELLED") for i in req.items)
            if all_ordered:
                req.status = "ORDERED"
            else:
                req.status = "PARTIAL_ORDERED"

    await db.commit()
    return list(items)


# ──────────────────────────────────────────────
# Modul Gudang: Pemeriksaan Fisik, Qty & Exp Date
# ──────────────────────────────────────────────

async def get_warehouse_incoming_items(
    db: AsyncSession,
    search: str | None = None,
) -> list[PurchaseRequestItem]:
    """
    Daftar item belanjaan yang sedang dalam status ORDERED (menunggu kedatangan fisik di gudang).
    """
    stmt = (
        select(PurchaseRequestItem)
        .join(PurchaseRequest, PurchaseRequestItem.request_id == PurchaseRequest.id)
        .options(
            selectinload(PurchaseRequestItem.request),
            selectinload(PurchaseRequestItem.supplier),
        )
        .where(
            or_(
                PurchaseRequestItem.order_status == "ORDERED",
                PurchaseRequest.status == "ORDERED",
            )
        )
        .order_by(desc(PurchaseRequestItem.ordered_at), PurchaseRequestItem.id.asc())
    )
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PurchaseRequestItem.item_name).like(term),
                func.lower(PurchaseRequestItem.supplier_name).like(term),
            )
        )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def receive_warehouse_item(
    db: AsyncSession,
    item_id: int,
    qty_received: Decimal | float,
    expired_date: date | None = None,
    received_by: str = "Gudang",
    receiving_notes: str = "-",
) -> PurchaseRequestItem | None:
    """
    Pemeriksaan fisik oleh Bagian Gudang:
    1. Mencatat Qty Diterima
    2. Menghitung status kesesuaian:
       - Sesuai jika qty_received == item.qty
       - Kurang jika qty_received < item.qty
       - Lebih jika qty_received > item.qty
    3. Mencatat Tanggal Expired (Tgl Exp)
    4. Catatan kondisi barang
    """
    res = await db.execute(
        select(PurchaseRequestItem).where(PurchaseRequestItem.id == item_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        return None

    clean_qty = Decimal(str(qty_received))
    item.qty_received = clean_qty
    item.expired_date = expired_date
    item.received_by = received_by or "Gudang"
    item.received_at = datetime.utcnow()
    item.receiving_notes = receiving_notes.strip() if receiving_notes else "-"

    # Evaluasi status kesesuaian fisik
    if clean_qty == item.qty:
        item.receiving_status = "SESUAI"
    elif clean_qty < item.qty:
        item.receiving_status = "KURANG"
    else:
        item.receiving_status = "LEBIH"

    # Periksa apakah seluruh item dalam PurchaseRequest sudah diterima
    req = await get_purchase_request_by_id(db, item.request_id)
    if req and req.items:
        all_received = all(i.receiving_status != "PENDING" for i in req.items)
        if all_received:
            req.status = "RECEIVED"

    await db.commit()
    await db.refresh(item)
    return item


async def delete_purchase_request(
    db: AsyncSession, request_id: int
) -> bool:
    """Hapus pengajuan belanja."""
    req = await get_purchase_request_by_id(db, request_id)
    if not req:
        return False

    await db.delete(req)
    await db.commit()
    return True


async def get_purchase_request_stats(db: AsyncSession) -> dict:
    """Statistik ringkas pengajuan belanja untuk dashboard & bot."""
    q = select(
        func.count(PurchaseRequest.id).label("total"),
        func.count(func.nullif(PurchaseRequest.status != "PENDING", True)).label("pending"),
        func.count(func.nullif(PurchaseRequest.status != "APPROVED", True)).label("approved"),
        func.count(func.nullif(PurchaseRequest.status != "ORDERED", True)).label("ordered"),
        func.count(func.nullif(PurchaseRequest.status != "RECEIVED", True)).label("received"),
        func.count(func.nullif(PurchaseRequest.status != "FULFILLED", True)).label("fulfilled"),
        func.count(func.nullif(PurchaseRequest.status != "REJECTED", True)).label("rejected"),
        func.count(
            func.nullif(
                and_(PurchaseRequest.status == "PENDING", PurchaseRequest.urgency == "URGENT"),
                False,
            )
        ).label("urgent_pending"),
    )
    res = await db.execute(q)
    row = res.one_or_none()
    if not row:
        return {
            "total": 0,
            "pending": 0,
            "approved": 0,
            "ordered": 0,
            "received": 0,
            "fulfilled": 0,
            "rejected": 0,
            "urgent_pending": 0,
        }

    return {
        "total": row.total or 0,
        "pending": row.pending or 0,
        "approved": row.approved or 0,
        "ordered": getattr(row, "ordered", 0) or 0,
        "received": getattr(row, "received", 0) or 0,
        "fulfilled": row.fulfilled or 0,
        "rejected": row.rejected or 0,
        "urgent_pending": row.urgent_pending or 0,
    }


async def auto_match_and_fulfill(
    db: AsyncSession, expense: Expense
) -> list[PurchaseRequest]:
    """
    Otomatis cari pengajuan belanja yang nama barangnya cocok
    dengan pengeluaran baru, lalu tandai sebagai FULFILLED.
    """
    if not expense.item_name:
        return []

    item_name_clean = expense.item_name.strip().lower()
    stmt = (
        select(PurchaseRequest)
        .options(selectinload(PurchaseRequest.items))
        .where(
            PurchaseRequest.status.in_(["APPROVED", "ORDERED", "RECEIVED"]),
            PurchaseRequest.expense_id.is_(None),
        )
        .order_by(PurchaseRequest.request_date.asc())
    )
    res = await db.execute(stmt)
    active_requests = res.scalars().all()

    matched = []
    for req in active_requests:
        # Cek di list items
        matched_item = None
        for it in req.items:
            it_name = it.item_name.strip().lower()
            if it_name == item_name_clean or (len(it_name) > 3 and it_name in item_name_clean):
                matched_item = it
                break

        # Cek fallback single-item
        req_name = (req.item_name or "").strip().lower()
        if matched_item or req_name == item_name_clean:
            req.status = "FULFILLED"
            req.expense_id = expense.id
            req.fulfilled_at = datetime.utcnow()
            if matched_item:
                matched_item.expense_id = expense.id
            matched.append(req)

    if matched:
        await db.commit()

    return matched
