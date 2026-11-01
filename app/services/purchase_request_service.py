"""
app/services/purchase_request_service.py — Layanan CRUD & Alur Pengajuan Belanja
Mengelola pembuatan pengajuan belanja, persetujuan admin, checklist, dan pemenuhan belanja.
"""
from datetime import datetime, date
from decimal import Decimal
import logging
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.purchase_request import PurchaseRequest
from app.models.user import User
from app.models.expense import Expense

logger = logging.getLogger(__name__)


async def create_purchase_request(
    db: AsyncSession,
    item_name: str,
    qty: Decimal | float = 1,
    unit: str = "Pcs",
    category: str | None = None,
    estimated_price: Decimal | float | None = None,
    urgency: str = "NORMAL",
    notes: str = "-",
    user_id: int | None = None,
    requester_name: str = "-",
    request_date: date | None = None,
) -> PurchaseRequest:
    """
    Buat data pengajuan belanja baru.
    Jika category atau estimated_price kosong, coba cari dari master item / harga terakhir.
    """
    clean_item = item_name.strip()
    clean_unit = unit.strip() if unit else "Pcs"
    clean_urgency = "URGENT" if str(urgency).upper() in ("URGENT", "MENDESAK", "DARURAT") else "NORMAL"
    clean_qty = Decimal(str(qty)) if qty else Decimal("1")
    req_date = request_date or date.today()

    # Jika pemohon memiliki user_id tapi requester_name kosong / default, ambil dari nama user
    req_name = requester_name.strip() if requester_name else "-"
    if user_id and req_name in ("-", "", "None"):
        u_res = await db.execute(select(User).where(User.id == user_id))
        user_obj = u_res.scalar_one_or_none()
        if user_obj and user_obj.name:
            req_name = user_obj.name

    # Coba autofill category & estimated_price jika belum diisi
    final_cat = category
    final_est_price = Decimal(str(estimated_price)) if estimated_price is not None else None

    if not final_cat or final_est_price is None:
        try:
            from app.services.expense_service import search_last_price
            last_exp = await search_last_price(db, clean_item)
            if last_exp:
                if not final_cat and last_exp.category:
                    final_cat = last_exp.category
                if final_est_price is None and last_exp.unit_price:
                    final_est_price = Decimal(str(last_exp.unit_price))
        except Exception as e:
            logger.debug(f"Autofill info request gagal: {e}")

    req = PurchaseRequest(
        request_date=req_date,
        user_id=user_id,
        requester_name=req_name or "Staf Toko",
        item_name=clean_item,
        qty=clean_qty,
        unit=clean_unit,
        category=final_cat,
        estimated_price=final_est_price,
        urgency=clean_urgency,
        notes=notes.strip() if notes else "-",
        status="PENDING",
    )

    db.add(req)
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
    """
    Ambil list pengajuan belanja dengan berbagai filter.
    Return: (items, total_count)
    """
    query = select(PurchaseRequest)
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
                func.lower(PurchaseRequest.item_name).like(term),
                func.lower(PurchaseRequest.requester_name).like(term),
                func.lower(PurchaseRequest.notes).like(term),
            )
        )
    if start_date:
        filters.append(PurchaseRequest.request_date >= start_date)
    if end_date:
        filters.append(PurchaseRequest.request_date <= end_date)

    if filters:
        query = query.where(and_(*filters))
        count_query = count_query.where(and_(*filters))

    # Urutkan: URGENT & PENDING di atas, lalu tanggal terbaru
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
        select(PurchaseRequest).where(PurchaseRequest.id == request_id)
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


async def fulfill_purchase_request(
    db: AsyncSession,
    request_id: int,
    expense_id: int | None = None,
) -> PurchaseRequest | None:
    """Tandai pengajuan belanja sudah dibeli/terpenuhi."""
    req = await get_purchase_request_by_id(db, request_id)
    if not req:
        return None

    req.status = "FULFILLED"
    req.expense_id = expense_id
    req.fulfilled_at = datetime.utcnow()

    await db.commit()
    await db.refresh(req)
    return req


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
            "fulfilled": 0,
            "rejected": 0,
            "urgent_pending": 0,
        }

    return {
        "total": row.total or 0,
        "pending": row.pending or 0,
        "approved": row.approved or 0,
        "fulfilled": row.fulfilled or 0,
        "rejected": row.rejected or 0,
        "urgent_pending": row.urgent_pending or 0,
    }


async def auto_match_and_fulfill(
    db: AsyncSession, expense: Expense
) -> list[PurchaseRequest]:
    """
    Otomatis cari pengajuan belanja berstatus APPROVED yang nama barangnya mirip
    dengan pengeluaran yang baru saja disimpan, lalu tandai sebagai FULFILLED.
    """
    if not expense.item_name:
        return []

    item_name_clean = expense.item_name.strip().lower()
    # Cari request yang APPROVED dan belum punya expense_id
    stmt = (
        select(PurchaseRequest)
        .where(
            PurchaseRequest.status == "APPROVED",
            PurchaseRequest.expense_id.is_(None),
        )
        .order_by(PurchaseRequest.request_date.asc())
    )
    res = await db.execute(stmt)
    approved_requests = res.scalars().all()

    matched = []
    for req in approved_requests:
        req_name = req.item_name.strip().lower()
        # Jika nama persis atau mengandung satu sama lain
        if req_name == item_name_clean or (len(req_name) > 3 and req_name in item_name_clean) or (len(item_name_clean) > 3 and item_name_clean in req_name):
            req.status = "FULFILLED"
            req.expense_id = expense.id
            req.fulfilled_at = datetime.utcnow()
            matched.append(req)

    if matched:
        await db.commit()

    return matched
