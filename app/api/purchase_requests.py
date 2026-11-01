"""
app/api/purchase_requests.py — REST API untuk Pengajuan / Request Belanja
Endpoints untuk daftar kebutuhan belanja, persetujuan admin, dan checklist belanja pasar.
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
)
from app.services import purchase_request_service

router = APIRouter(prefix="/requests", tags=["purchase_requests"], dependencies=[Depends(require_auth)])


def _to_response_dict(req) -> dict:
    return {
        "id": req.id,
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
    }


@router.get("", response_model=PurchaseRequestListResponse)
async def list_purchase_requests(
    status: str | None = Query(None, description="Filter status: ALL, PENDING, APPROVED, REJECTED, FULFILLED"),
    urgency: str | None = Query(None, description="Filter urgency: ALL, NORMAL, URGENT"),
    search: str | None = Query(None, description="Pencarian nama item, catatan, atau pemohon"),
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
    """Buat pengajuan belanja baru (dari Web Dashboard atau Staf)."""
    parsed_date = None
    if payload.request_date:
        try:
            parsed_date = date.fromisoformat(payload.request_date)
        except ValueError:
            parsed_date = date.today()

    req = await purchase_request_service.create_purchase_request(
        db,
        item_name=payload.item_name,
        qty=Decimal(str(payload.qty)),
        unit=payload.unit,
        category=payload.category,
        estimated_price=Decimal(str(payload.estimated_price)) if payload.estimated_price is not None else None,
        urgency=payload.urgency,
        notes=payload.notes,
        user_id=payload.user_id,
        requester_name=payload.requester_name or ("Admin" if role == "admin" else "Staf"),
        request_date=parsed_date,
    )
    return PurchaseRequestResponse(**_to_response_dict(req))


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
    req = await purchase_request_service.reject_request(
        db, request_id, reviewer_name=reviewer_name, reason=payload.reason
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.post("/{request_id}/fulfill", response_model=PurchaseRequestResponse)
async def fulfill_request(
    request_id: int,
    expense_id: int | None = Query(None, description="ID expense yang merealisasikan"),
    db: AsyncSession = Depends(get_db),
):
    """Tandai pengajuan belanja sudah dibeli/terpenuhi."""
    req = await purchase_request_service.fulfill_purchase_request(
        db, request_id, expense_id=expense_id
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
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
