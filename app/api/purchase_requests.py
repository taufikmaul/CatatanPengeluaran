"""
app/api/purchase_requests.py — REST API untuk Pengajuan / Request Belanja Multi-Item
Mendukung 3 peran:
1. Karyawan: Mengajukan list kebutuhan belanja (multi-item)
2. Purchasing: Mengelompokkan per supplier, template teks WA/email, dan order
3. Gudang: Cek kesesuaian fisik (sesuai/kurang/lebih), input expired date & kondisi barang
"""
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_auth, get_current_role
from app.api.schemas import (
    PurchaseRequestCreate,
    PurchaseRequestUpdate,
    PurchaseRequestRejectInput,
    PurchaseRequestResponse,
    PurchaseRequestListResponse,
    PurchaseRequestStatsResponse,
    PurchasingAssignSupplierInput,
    PurchasingMarkOrderedInput,
    PurchasingWhatsAppTemplateInput,
    WarehouseReceiveItemInput,
    PurchaseRequestItemResponse,
)
from app.services import purchase_request_service

router = APIRouter(prefix="/requests", tags=["purchase_requests"], dependencies=[Depends(require_auth)])


def _item_to_dict(it) -> dict:
    return {
        "id": it.id,
        "request_id": it.request_id,
        "item_name": it.item_name,
        "master_item_id": it.master_item_id,
        "qty": float(it.qty) if it.qty is not None else 1.0,
        "unit": it.unit or "Pcs",
        "category": it.category or "Bahan Kue",
        "notes": it.notes or "-",
        "estimated_price": float(it.estimated_price) if it.estimated_price is not None else None,
        "supplier_id": it.supplier_id,
        "supplier_name": it.supplier_name or "-",
        "order_status": it.order_status or "PENDING",
        "ordered_at": it.ordered_at,
        "qty_received": float(it.qty_received) if it.qty_received is not None else None,
        "receiving_status": it.receiving_status or "PENDING",
        "expired_date": it.expired_date.isoformat() if it.expired_date else None,
        "received_by": it.received_by,
        "received_at": it.received_at,
        "receiving_notes": it.receiving_notes,
        "expense_id": it.expense_id,
    }


def _to_response_dict(req) -> dict:
    items_list = [_item_to_dict(it) for it in (req.items or [])]
    return {
        "id": req.id,
        "request_number": req.request_number or f"REQ-{req.id}",
        "title": req.title or "Request Belanja",
        "request_date": req.request_date.isoformat() if req.request_date else None,
        "user_id": req.user_id,
        "requester_name": req.requester_name or "-",
        "item_name": req.item_name,
        "qty": float(req.qty) if req.qty is not None else 1.0,
        "unit": req.unit or "Pcs",
        "category": req.category,
        "estimated_price": float(req.estimated_price) if req.estimated_price is not None else None,
        "urgency": req.urgency or "NORMAL",
        "notes": req.notes or "-",
        "status": req.status or "PENDING",
        "reviewed_by_id": req.reviewed_by_id,
        "reviewer_name": req.reviewer_name,
        "reviewed_at": req.reviewed_at,
        "reject_reason": req.reject_reason,
        "expense_id": req.expense_id,
        "fulfilled_at": req.fulfilled_at,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
        "items": items_list,
    }


@router.get("", response_model=PurchaseRequestListResponse)
async def list_purchase_requests(
    status: str | None = Query(None, description="Filter status: ALL, PENDING, APPROVED, ORDERED, RECEIVED, REJECTED, FULFILLED"),
    urgency: str | None = Query(None, description="Filter urgency: ALL, NORMAL, URGENT"),
    search: str | None = Query(None, description="Pencarian nama item, judul, catatan, atau pemohon"),
    start_date: date | None = Query(None, description="Mulai tanggal"),
    end_date: date | None = Query(None, description="Sampai tanggal"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Ambil daftar pengajuan belanja dengan pagination dan filter."""
    offset = (page - 1) * limit
    items, total = await purchase_request_service.get_purchase_requests(
        db,
        status=status,
        urgency=urgency,
        search=search,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )
    stats = await purchase_request_service.get_purchase_request_stats(db)

    return PurchaseRequestListResponse(
        items=[PurchaseRequestResponse(**_to_response_dict(r)) for r in items],
        total=total,
        stats=PurchaseRequestStatsResponse(**stats),
    )


@router.get("/stats", response_model=PurchaseRequestStatsResponse)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Ringkasan statistik request belanja."""
    stats = await purchase_request_service.get_purchase_request_stats(db)
    return PurchaseRequestStatsResponse(**stats)


@router.post("", response_model=PurchaseRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_purchase_request(
    payload: PurchaseRequestCreate,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Buat pengajuan belanja baru (bisa multi-item sekaligus)."""
    parsed_date = None
    if payload.request_date:
        try:
            parsed_date = date.fromisoformat(payload.request_date)
        except ValueError:
            parsed_date = date.today()

    items_dict = [it.dict() for it in payload.items] if payload.items else None

    req = await purchase_request_service.create_purchase_request(
        db,
        title=payload.title or "Request Belanja",
        item_name=payload.item_name,
        qty=Decimal(str(payload.qty)) if payload.qty is not None else Decimal("1"),
        unit=payload.unit or "Pcs",
        category=payload.category,
        estimated_price=Decimal(str(payload.estimated_price)) if payload.estimated_price is not None else None,
        urgency=payload.urgency,
        notes=payload.notes,
        user_id=payload.user_id,
        requester_name=payload.requester_name or ("Admin" if role == "admin" else "Staf"),
        request_date=parsed_date,
        items=items_dict,
    )
    return PurchaseRequestResponse(**_to_response_dict(req))


# ──────────────────────────────────────────────
# Endpoints Purchasing (Pemesanan & Supplier)
# ──────────────────────────────────────────────

@router.get("/purchasing/orders")
async def get_purchasing_orders(db: AsyncSession = Depends(get_db)):
    """Ambil daftar belanjaan yang sudah di-approve dan dikelompokkan per Supplier."""
    grouped = await purchase_request_service.get_purchasing_grouped_orders(db)
    # Serialize items
    res = []
    for g in grouped:
        res.append({
            "supplier_name": g["supplier_name"],
            "supplier_id": g["supplier_id"],
            "supplier_phone": g["supplier_phone"],
            "supplier_address": g["supplier_address"],
            "total_items": g["total_items"],
            "items": [_item_to_dict(i) for i in g["items"]],
        })
    return res


@router.post("/purchasing/items/{item_id}/assign-supplier", response_model=PurchaseRequestItemResponse)
async def assign_supplier_endpoint(
    item_id: int,
    payload: PurchasingAssignSupplierInput,
    db: AsyncSession = Depends(get_db),
):
    """Purchasing mengaitkan item belanjaan dengan supplier tertentu."""
    updated = await purchase_request_service.update_item_supplier(
        db,
        item_id=item_id,
        supplier_id=payload.supplier_id,
        supplier_name=payload.supplier_name,
        estimated_price=payload.estimated_price,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Item belanjaan tidak ditemukan")
    return PurchaseRequestItemResponse(**_item_to_dict(updated))


@router.post("/purchasing/generate-whatsapp")
async def generate_whatsapp_endpoint(
    payload: PurchasingWhatsAppTemplateInput,
    db: AsyncSession = Depends(get_db),
):
    """Generate teks pesanan rapi untuk WhatsApp/Email supplier."""
    from sqlalchemy import select
    from app.models.purchase_request import PurchaseRequestItem

    stmt = select(PurchaseRequestItem).where(PurchaseRequestItem.id.in_(payload.item_ids))
    res = await db.execute(stmt)
    items = res.scalars().all()

    text = purchase_request_service.generate_whatsapp_order_text(
        supplier_name=payload.supplier_name,
        items=items,
        custom_notes=payload.custom_notes,
    )
    return {"ok": True, "text": text}


@router.post("/purchasing/mark-ordered")
async def mark_ordered_endpoint(
    payload: PurchasingMarkOrderedInput,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Tandai item-item belanjaan telah dipesan ke supplier (ORDERED)."""
    items = await purchase_request_service.mark_items_as_ordered(
        db, payload.item_ids, actor=f"Purchasing ({role})"
    )
    return {"ok": True, "updated_count": len(items)}


# ──────────────────────────────────────────────
# Endpoints Gudang (Penerimaan Barang & Exp Date)
# ──────────────────────────────────────────────

@router.get("/warehouse/incoming")
async def get_warehouse_incoming_endpoint(
    search: str | None = Query(None, description="Cari nama barang atau supplier"),
    db: AsyncSession = Depends(get_db),
):
    """Daftar item belanjaan yang sedang dalam status ORDERED (menunggu barang datang di gudang)."""
    items = await purchase_request_service.get_warehouse_incoming_items(db, search=search)
    return [_item_to_dict(i) for i in items]


@router.post("/warehouse/items/{item_id}/receive", response_model=PurchaseRequestItemResponse)
async def receive_item_endpoint(
    item_id: int,
    payload: WarehouseReceiveItemInput,
    db: AsyncSession = Depends(get_db),
):
    """
    Pemeriksaan fisik oleh Bagian Gudang:
    Input qty datang, cek kesesuaian (sesuai/kurang/lebih), dan catat tanggal expired.
    """
    exp_date = None
    if payload.expired_date:
        try:
            exp_date = date.fromisoformat(payload.expired_date)
        except ValueError:
            pass

    updated = await purchase_request_service.receive_warehouse_item(
        db,
        item_id=item_id,
        qty_received=payload.qty_received,
        expired_date=exp_date,
        received_by=payload.received_by,
        receiving_notes=payload.receiving_notes,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Item belanjaan tidak ditemukan")
    return PurchaseRequestItemResponse(**_item_to_dict(updated))


# ──────────────────────────────────────────────
# Detail & Admin Approval Endpoints
# ──────────────────────────────────────────────

@router.get("/{request_id}", response_model=PurchaseRequestResponse)
async def get_purchase_request_detail(
    request_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Ambil detail pengajuan belanja berdasarkan ID."""
    req = await purchase_request_service.get_purchase_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.patch("/{request_id}", response_model=PurchaseRequestResponse)
async def update_purchase_request(
    request_id: int,
    payload: PurchaseRequestUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update detail pengajuan belanja."""
    req = await purchase_request_service.get_purchase_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")

    if payload.title is not None:
        req.title = payload.title.strip()
    if payload.item_name is not None:
        req.item_name = payload.item_name.strip()
    if payload.qty is not None:
        req.qty = Decimal(str(payload.qty))
    if payload.unit is not None:
        req.unit = payload.unit.strip()
    if payload.category is not None:
        req.category = payload.category.strip() or None
    if payload.estimated_price is not None:
        req.estimated_price = Decimal(str(payload.estimated_price))
    if payload.urgency is not None:
        req.urgency = "URGENT" if payload.urgency.upper() in ("URGENT", "MENDESAK") else "NORMAL"
    if payload.notes is not None:
        req.notes = payload.notes.strip()
    if payload.requester_name is not None:
        req.requester_name = payload.requester_name.strip()

    await db.commit()
    await db.refresh(req)
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.post("/{request_id}/approve", response_model=PurchaseRequestResponse)
async def approve_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Setujui pengajuan belanja (Admin / Owner)."""
    reviewer_name = "Admin Dashboard" if role == "admin" else "Reviewer"
    req = await purchase_request_service.approve_purchase_request(
        db, request_id, reviewer_name=reviewer_name
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.post("/{request_id}/reject", response_model=PurchaseRequestResponse)
async def reject_request(
    request_id: int,
    payload: PurchaseRequestRejectInput,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Tolak pengajuan belanja dengan alasan."""
    reviewer_name = "Admin Dashboard" if role == "admin" else "Reviewer"
    req = await purchase_request_service.reject_purchase_request(
        db, request_id, reviewer_name=reviewer_name, reason=payload.reason
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.post("/{request_id}/fulfill", response_model=PurchaseRequestResponse)
async def fulfill_request_endpoint(
    request_id: int,
    expense_id: int | None = Query(None, description="ID expense yang merealisasikan"),
    db: AsyncSession = Depends(get_db),
):
    """Tandai pengajuan belanja sudah dibeli/terpenuhi."""
    from datetime import datetime
    req = await purchase_request_service.get_purchase_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    req.status = "FULFILLED"
    req.expense_id = expense_id
    req.fulfilled_at = datetime.utcnow()
    await db.commit()
    await db.refresh(req)
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Hapus data pengajuan belanja."""
    success = await purchase_request_service.delete_purchase_request(db, request_id)
    if not success:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return None
