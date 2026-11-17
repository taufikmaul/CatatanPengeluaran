"""
app/api/purchase_requests.py — REST API untuk Pengajuan / Request Belanja Multi-Item
Mendukung 3 peran:
1. Karyawan: Mengajukan list kebutuhan belanja (multi-item)
2. Purchasing: Mengelompokkan per supplier, template teks WA/email, dan order
3. Gudang: Cek kesesuaian fisik (sesuai/kurang/lebih), input expired date & kondisi barang
"""
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_auth, require_roles, get_current_role
from app.api.schemas import (
    PurchaseRequestCreate,
    PurchaseRequestUpdate,
    PurchaseRequestRejectInput,
    PurchaseRequestResponse,
    PurchaseRequestListResponse,
    PurchaseRequestStatsResponse,
    PurchasingAssignSupplierInput,
    PurchasingSupplierOptionsResponse,
    PurchasingItemUpdateInput,
    PurchasingItemCreateInput,
    PurchasingItemCancelInput,
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
    status: str | None = Query(None, description="Filter status: ALL, DRAFT, PENDING, APPROVED, ORDERED, RECEIVED, REJECTED, FULFILLED"),
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


@router.post(
    "",
    response_model=PurchaseRequestResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "staff", "admin_input", "purchasing"))],
)
async def create_purchase_request(
    payload: PurchaseRequestCreate,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Buat pengajuan belanja baru (bisa multi-item sekaligus, atau simpan sebagai DRAFT)."""
    parsed_date = None
    if payload.request_date:
        try:
            parsed_date = date.fromisoformat(payload.request_date)
        except ValueError:
            parsed_date = date.today()

    req_status = (payload.status or "PENDING").strip().upper()
    items_dict = [it.dict() for it in payload.items] if payload.items else None
    has_valid_item = bool(items_dict and any((it.get("item_name") or "").strip() for it in items_dict)) or bool(
        payload.item_name and payload.item_name.strip()
    )
    if req_status == "PENDING" and not has_valid_item:
        raise HTTPException(
            status_code=400,
            detail="Tambahkan minimal 1 barang sebelum mengirim pengajuan belanja.",
        )

    try:
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
            status=req_status,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return PurchaseRequestResponse(**_to_response_dict(req))


# ──────────────────────────────────────────────
# Endpoints Purchasing (Pemesanan & Supplier)
# ──────────────────────────────────────────────

@router.get("/purchasing/orders", dependencies=[Depends(require_roles("admin", "purchasing"))])
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


@router.get(
    "/purchasing/items/{item_id}/supplier-options",
    response_model=PurchasingSupplierOptionsResponse,
    dependencies=[Depends(require_roles("admin", "purchasing"))],
)
async def get_purchasing_item_supplier_options(
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Daftar supplier terdaftar yang memiliki item ini + opsi supplier terdaftar lainnya."""
    data = await purchase_request_service.get_supplier_options_for_item(db, item_id)
    if not data:
        raise HTTPException(status_code=404, detail="Item belanjaan tidak ditemukan")
    return PurchasingSupplierOptionsResponse(**data)


@router.post(
    "/purchasing/items/{item_id}/assign-supplier",
    response_model=PurchaseRequestItemResponse,
    dependencies=[Depends(require_roles("admin", "purchasing"))],
)
async def assign_supplier_endpoint(
    item_id: int,
    payload: PurchasingAssignSupplierInput,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Purchasing mengaitkan item belanjaan dengan supplier terdaftar."""
    try:
        updated = await purchase_request_service.update_item_supplier(
            db,
            item_id=item_id,
            supplier_id=payload.supplier_id,
            supplier_name=payload.supplier_name,
            estimated_price=payload.estimated_price,
            require_registered=True,
            actor=f"Purchasing ({role})",
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not updated:
        raise HTTPException(status_code=404, detail="Item belanjaan tidak ditemukan")
    return PurchaseRequestItemResponse(**_item_to_dict(updated))


@router.post(
    "/purchasing/items",
    response_model=PurchaseRequestItemResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "purchasing"))],
)
async def add_purchasing_item_endpoint(
    payload: PurchasingItemCreateInput,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Purchasing menambahkan item susulan / koreksi kekurangan ke antrean belanja."""
    try:
        created = await purchase_request_service.add_purchasing_item(
            db,
            item_name=payload.item_name,
            qty=payload.qty,
            unit=payload.unit,
            category=payload.category,
            supplier_id=payload.supplier_id,
            supplier_name=payload.supplier_name,
            estimated_price=payload.estimated_price,
            notes=payload.notes,
            request_id=payload.request_id,
            actor=f"Purchasing ({role})",
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return PurchaseRequestItemResponse(**_item_to_dict(created))


@router.patch(
    "/purchasing/items/{item_id}",
    response_model=PurchaseRequestItemResponse,
    dependencies=[Depends(require_roles("admin", "purchasing"))],
)
async def update_purchasing_item_endpoint(
    item_id: int,
    payload: PurchasingItemUpdateInput,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Koreksi detail item belanja (qty, satuan, nama, harga, catatan) dari halaman Purchasing."""
    try:
        updated = await purchase_request_service.update_purchasing_item(
            db,
            item_id=item_id,
            item_name=payload.item_name,
            qty=payload.qty,
            unit=payload.unit,
            category=payload.category,
            estimated_price=payload.estimated_price,
            notes=payload.notes,
            actor=f"Purchasing ({role})",
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not updated:
        raise HTTPException(status_code=404, detail="Item belanjaan tidak ditemukan")
    return PurchaseRequestItemResponse(**_item_to_dict(updated))


@router.post(
    "/purchasing/items/{item_id}/cancel",
    response_model=PurchaseRequestItemResponse,
    dependencies=[Depends(require_roles("admin", "purchasing"))],
)
async def cancel_purchasing_item_endpoint(
    item_id: int,
    payload: PurchasingItemCancelInput,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Tandai item tidak tersedia / batalkan dari daftar pesanan Purchasing."""
    try:
        cancelled = await purchase_request_service.cancel_purchasing_item(
            db,
            item_id=item_id,
            reason=payload.reason,
            actor=f"Purchasing ({role})",
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not cancelled:
        raise HTTPException(status_code=404, detail="Item belanjaan tidak ditemukan")
    return PurchaseRequestItemResponse(**_item_to_dict(cancelled))


@router.post("/purchasing/generate-whatsapp", dependencies=[Depends(require_roles("admin", "purchasing"))])
async def generate_whatsapp_endpoint(
    payload: PurchasingWhatsAppTemplateInput,
    db: AsyncSession = Depends(get_db),
):
    """Generate teks pesanan rapi untuk WhatsApp/Email supplier."""
    from sqlalchemy import select
    from app.models.purchase_request import PurchaseRequestItem

    stmt = select(PurchaseRequestItem).where(
        PurchaseRequestItem.id.in_(payload.item_ids),
        PurchaseRequestItem.order_status != "CANCELLED",
    )
    res = await db.execute(stmt)
    items = res.scalars().all()

    text = purchase_request_service.generate_whatsapp_order_text(
        supplier_name=payload.supplier_name,
        items=items,
        custom_notes=payload.custom_notes,
    )
    return {"ok": True, "text": text}


@router.post("/purchasing/mark-ordered", dependencies=[Depends(require_roles("admin", "purchasing"))])
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
    request: Request,
    search: str | None = Query(None, description="Cari nama barang atau supplier"),
    db: AsyncSession = Depends(get_db),
):
    """Daftar item belanjaan yang sedang dalam status ORDERED (menunggu barang datang di gudang)."""
    role = get_current_role(request)
    if role not in ("admin", "warehouse"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: Admin Input tidak memiliki akses ke bagian gudang.",
        )
    items = await purchase_request_service.get_warehouse_incoming_items(db, search=search)
    return [_item_to_dict(i) for i in items]


@router.post("/warehouse/items/{item_id}/receive", response_model=PurchaseRequestItemResponse)
async def receive_item_endpoint(
    item_id: int,
    payload: WarehouseReceiveItemInput,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Pemeriksaan fisik oleh Bagian Gudang:
    Input qty datang, cek kesesuaian (sesuai/kurang/lebih), dan catat tanggal expired.
    """
    role = get_current_role(request)
    if role not in ("admin", "warehouse"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: Admin Input tidak memiliki izin untuk melakukan penerimaan barang gudang.",
        )
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


@router.patch(
    "/{request_id}",
    response_model=PurchaseRequestResponse,
    dependencies=[Depends(require_roles("admin", "staff", "admin_input", "purchasing"))],
)
async def update_purchase_request(
    request_id: int,
    payload: PurchaseRequestUpdate,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Update detail pengajuan belanja (termasuk daftar item saat DRAFT atau PENDING, dan submit DRAFT -> PENDING)."""
    from app.models.purchase_request import PurchaseRequestItem
    from app.services.master_item_service import list_master_items, find_best_master_match
    from app.services.supplier_service import find_best_supplier_match
    from app.models.supplier import Supplier

    req = await purchase_request_service.get_purchase_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")

    was_draft = req.status == "DRAFT"
    if role != "admin" and req.status not in ("DRAFT", "PENDING"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Pengajuan yang sudah diproses hanya dapat diubah oleh Owner / Manager.",
        )

    target_status = payload.status.strip().upper() if payload.status else None
    if target_status is not None:
        if was_draft and target_status not in ("DRAFT", "PENDING"):
            raise HTTPException(status_code=400, detail="Draft hanya dapat disimpan sebagai DRAFT atau dikirim menjadi PENDING.")
        if not was_draft and target_status == "DRAFT":
            raise HTTPException(status_code=400, detail="Pengajuan yang sudah dikirim tidak dapat dikembalikan ke Draft.")

    if payload.title is not None:
        req.title = payload.title.strip() or "Request Belanja"
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
        req.notes = payload.notes.strip() or "-"
    if payload.requester_name is not None:
        req.requester_name = payload.requester_name.strip() or "Staf Toko"
    if payload.request_date is not None:
        try:
            req.request_date = date.fromisoformat(payload.request_date)
        except ValueError:
            pass

    if payload.items is not None and req.status in ("DRAFT", "PENDING"):
        master_items = await list_master_items(db)
        sup_res = await db.execute(select(Supplier).where(Supplier.is_active == True))
        active_suppliers = list(sup_res.scalars().all())

        req.items.clear()
        await db.flush()
        for it in payload.items:
            it_name = (it.item_name or "").strip()
            if not it_name:
                continue
            matched_master = find_best_master_match(it_name, master_items)
            sup_id = None
            sup_name = "-"
            if it.supplier_name and it.supplier_name.strip() not in ("", "-"):
                matched_sup = find_best_supplier_match(it.supplier_name.strip(), active_suppliers)
                if matched_sup:
                    sup_id = matched_sup.id
                    sup_name = matched_sup.name
            elif matched_master and matched_master.default_supplier and matched_master.default_supplier != "-":
                matched_sup = find_best_supplier_match(matched_master.default_supplier, active_suppliers)
                if matched_sup:
                    sup_id = matched_sup.id
                    sup_name = matched_sup.name

            req.items.append(
                PurchaseRequestItem(
                    request_id=req.id,
                    item_name=it_name,
                    master_item_id=matched_master.id if matched_master else None,
                    qty=Decimal(str(it.qty or 1)),
                    unit=(it.unit or "Pcs").strip() or "Pcs",
                    category=it.category or (matched_master.category if matched_master else "Bahan Kue"),
                    notes=(it.notes or "-").strip() or "-",
                    supplier_id=sup_id,
                    supplier_name=sup_name,
                    estimated_price=Decimal(str(it.estimated_price)) if it.estimated_price is not None else None,
                    order_status="PENDING",
                    receiving_status="PENDING",
                )
            )
        if req.items:
            req.item_name = req.items[0].item_name
            req.qty = req.items[0].qty
            req.unit = req.items[0].unit
            req.category = req.items[0].category
        elif was_draft:
            req.item_name = "Draft Belanja"

    if was_draft and target_status == "PENDING":
        has_items = bool(req.items and len(req.items) > 0) or bool(
            req.item_name and req.item_name.strip() and req.item_name.strip() != "Draft Belanja"
        )
        if not has_items:
            await db.rollback()
            raise HTTPException(
                status_code=400,
                detail="Tambahkan minimal 1 barang sebelum mengirim pengajuan belanja.",
            )
        req.status = "PENDING"

    await db.commit()
    fresh = await purchase_request_service.get_purchase_request_by_id(db, req.id)
    if fresh:
        try:
            from app.services.purchase_request_alert_service import (
                notify_new_purchase_request,
                notify_purchase_request_updated,
            )
            if was_draft and fresh.status == "PENDING":
                await notify_new_purchase_request(fresh)
            elif fresh.status != "DRAFT":
                actor = "Owner / Manager" if role == "admin" else f"Staf ({role})"
                await notify_purchase_request_updated(fresh, actor=actor)
        except Exception:
            pass
    return PurchaseRequestResponse(**_to_response_dict(fresh))


@router.post(
    "/{request_id}/submit",
    response_model=PurchaseRequestResponse,
    dependencies=[Depends(require_roles("admin", "staff", "admin_input", "purchasing"))],
)
async def submit_draft_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Kirim pengajuan belanja yang masih berstatus DRAFT menjadi PENDING (masuk antrean approval)."""
    try:
        req = await purchase_request_service.submit_purchase_request(db, request_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.post("/{request_id}/approve", response_model=PurchaseRequestResponse)
async def approve_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Setujui pengajuan belanja (hanya Owner / Manager)."""
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya Owner / Manager yang berhak menyetujui pengajuan belanja.",
        )
    reviewer_name = "Owner / Manager"
    try:
        req = await purchase_request_service.approve_purchase_request(
            db, request_id, reviewer_name=reviewer_name
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
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
    """Tolak pengajuan belanja dengan alasan (hanya Owner / Manager)."""
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya Owner / Manager yang berhak menolak pengajuan belanja.",
        )
    reviewer_name = "Owner / Manager"
    try:
        req = await purchase_request_service.reject_purchase_request(
            db, request_id, reviewer_name=reviewer_name, reason=payload.reason
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.post(
    "/{request_id}/fulfill",
    response_model=PurchaseRequestResponse,
    dependencies=[Depends(require_roles("admin", "purchasing"))],
)
async def fulfill_request_endpoint(
    request_id: int,
    expense_id: int | None = Query(None, description="ID expense yang merealisasikan"),
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Tandai pengajuan belanja sudah dibeli/terpenuhi."""
    actor = "Owner / Manager" if role == "admin" else f"Purchasing ({role})"
    try:
        req = await purchase_request_service.fulfill_purchase_request(
            db, request_id, expense_id=expense_id, actor=actor
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return PurchaseRequestResponse(**_to_response_dict(req))


@router.delete(
    "/{request_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("admin", "staff", "admin_input", "purchasing"))],
)
async def delete_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    role: str = Depends(get_current_role),
):
    """Hapus data pengajuan belanja (non-Owner hanya boleh menghapus saat DRAFT atau PENDING)."""
    req = await purchase_request_service.get_purchase_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    if role != "admin" and req.status not in ("DRAFT", "PENDING"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Pengajuan yang sudah diproses hanya dapat dihapus oleh Owner / Manager.",
        )
    actor = "Owner / Manager" if role == "admin" else f"Staf ({role})"
    success = await purchase_request_service.delete_purchase_request(db, request_id, actor=actor)
    if not success:
        raise HTTPException(status_code=404, detail="Request belanja tidak ditemukan")
    return None
