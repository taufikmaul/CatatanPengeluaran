"""
app/api/suppliers.py — REST API untuk Master Toko / Supplier
CRUD, statistik belanja, top item, item termahal, audit duplikat & merge.
"""
from datetime import date
from fastapi import APIRouter, Depends, Query, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_auth, require_admin_role, get_current_role
from app.api.schemas import (
    SupplierCreate,
    SupplierUpdate,
    SupplierResponse,
    SupplierDetailResponse,
    SupplierListResponse,
    SupplierTopItem,
    SupplierPriciestItem,
    SupplierDuplicateGroup,
    SupplierMergeRequest,
    ExpenseResponse,
    ExpenseListResponse,
    ExpenseCreate,
)
from app.services import supplier_service
from app.services.expense_service import (
    save_expenses,
    delete_expense,
)
from app.api.expenses import _to_response_dict

router = APIRouter(prefix="/suppliers", tags=["suppliers"], dependencies=[Depends(require_auth)])


@router.get("", response_model=SupplierListResponse)
async def list_suppliers(
    search: str | None = Query(None, description="Pencarian nama, alias, telp, atau alamat"),
    is_active: bool | None = Query(None, description="Filter status aktif"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    sort_by: str = Query("total_spent", description="total_spent, name, transaction_count, last_expense_date, created_at"),
    sort_order: str = Query("desc", description="asc atau desc"),
    db: AsyncSession = Depends(get_db),
):
    """Ambil daftar supplier beserta ringkasan statistik belanja."""
    skip = (page - 1) * limit
    items, total = await supplier_service.get_suppliers(
        db,
        search=search,
        is_active=is_active,
        skip=skip,
        limit=limit,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    return SupplierListResponse(
        items=[SupplierResponse(**it) for it in items],
        total=total,
        page=page,
        limit=limit,
    )


@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    payload: SupplierCreate,
    db: AsyncSession = Depends(get_db),
):
    """Tambah master supplier / toko baru (Admin & Owner)."""
    supp = await supplier_service.create_supplier(
        db,
        name=payload.name,
        phone=payload.phone,
        address=payload.address,
        aliases=payload.aliases,
        notes=payload.notes,
        is_active=payload.is_active,
    )
    await db.commit()
    # Muat detail dengan statistik awal (0)
    data = await supplier_service.get_supplier_by_id(db, supp.id)
    return SupplierResponse(**data)


@router.post("/sync-existing")
async def sync_existing_expenses(
    db: AsyncSession = Depends(get_db),
):
    """Sinkronkan data belanja lama yang belum terhubung ke master supplier."""
    result = await supplier_service.sync_existing_expenses(db)
    await db.commit()
    return result


@router.get("/audit-duplicates", response_model=list[SupplierDuplicateGroup])
async def audit_duplicate_suppliers(
    threshold: float = Query(0.75, ge=0.5, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    """Audit kemungkinan toko/supplier ganda atau salah penulisan."""
    return await supplier_service.audit_duplicate_suppliers(db, threshold=threshold)


@router.post("/merge", dependencies=[Depends(require_admin_role)])
async def merge_suppliers(
    payload: SupplierMergeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Gabungkan supplier duplikat ke satu target utama (HANYA OWNER).
    Seluruh transaksi belanja supplier sumber akan dialihkan ke target.
    """
    actor = get_current_role(request) or "owner"
    result = await supplier_service.merge_suppliers(
        db,
        target_id=payload.target_supplier_id,
        source_ids=payload.source_supplier_ids,
        actor=actor,
    )
    await db.commit()
    return result


@router.get("/{supplier_id}", response_model=SupplierDetailResponse)
async def get_supplier_detail(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Detail supplier dan statistik belanja komprehensif."""
    data = await supplier_service.get_supplier_by_id(db, supplier_id)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )
    return SupplierDetailResponse(**data)


@router.put("/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Perbarui informasi supplier (Admin & Owner)."""
    supp = await supplier_service.update_supplier(
        db,
        supplier_id=supplier_id,
        name=payload.name,
        phone=payload.phone,
        address=payload.address,
        aliases=payload.aliases,
        notes=payload.notes,
        is_active=payload.is_active,
    )
    await db.commit()
    data = await supplier_service.get_supplier_by_id(db, supp.id)
    return SupplierResponse(**data)


@router.delete("/{supplier_id}", dependencies=[Depends(require_admin_role)])
async def delete_supplier(
    supplier_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Hapus master supplier (HANYA OWNER). Transaksi belanja tidak dihapus, hanya dilepas relasinya."""
    actor = get_current_role(request) or "owner"
    await supplier_service.delete_supplier(db, supplier_id, actor=actor)
    await db.commit()
    return {"ok": True, "message": "Supplier berhasil dihapus."}


@router.get("/{supplier_id}/expenses", response_model=ExpenseListResponse)
async def get_supplier_expenses(
    supplier_id: int,
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    category: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Daftar riwayat belanja di toko ini dengan filter periode dan paginasi."""
    skip = (page - 1) * limit
    expenses, total = await supplier_service.get_supplier_expenses(
        db,
        supplier_id=supplier_id,
        start_date=start_date,
        end_date=end_date,
        category=category,
        skip=skip,
        limit=limit,
    )
    total_pages = (total + limit - 1) // limit if total > 0 else 1
    return ExpenseListResponse(
        ok=True,
        data=[ExpenseResponse(**_to_response_dict(e)) for e in expenses],
        total=total,
        page=page,
        per_page=limit,
        total_pages=total_pages,
    )


@router.get("/{supplier_id}/top-items", response_model=list[SupplierTopItem])
async def get_supplier_top_items(
    supplier_id: int,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Top barang yang paling sering dibeli di toko ini."""
    items = await supplier_service.get_supplier_top_items(db, supplier_id, limit=limit)
    return [SupplierTopItem(**it) for it in items]


@router.get("/{supplier_id}/priciest-items", response_model=list[SupplierPriciestItem])
async def get_supplier_priciest_items(
    supplier_id: int,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Barang dengan harga satuan tertinggi yang pernah dibeli di toko ini."""
    items = await supplier_service.get_supplier_priciest_items(db, supplier_id, limit=limit)
    return [SupplierPriciestItem(**it) for it in items]


@router.post("/{supplier_id}/expenses", response_model=ExpenseResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier_expense(
    supplier_id: int,
    payload: ExpenseCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Tambah catatan belanja langsung dari halaman detail supplier / toko."""
    supp = await supplier_service.get_supplier_by_id(db, supplier_id)
    if not supp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier tidak ditemukan.",
        )

    actor = get_current_role(request) or "admin"
    exp_data = payload.model_dump()
    exp_data["supplier_id"] = supplier_id
    exp_data["supplier"] = supp["name"]

    expenses = await save_expenses(db, items=[exp_data], actor=actor)
    expense = expenses[0]
    await db.commit()
    await db.refresh(expense)
    return ExpenseResponse(**_to_response_dict(expense))


@router.delete("/{supplier_id}/expenses/{expense_id}", dependencies=[Depends(require_admin_role)])
async def delete_supplier_expense(
    supplier_id: int,
    expense_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Hapus catatan belanja dari riwayat toko (HANYA OWNER)."""
    actor = get_current_role(request) or "owner"
    success = await delete_expense(db, expense_id, actor=actor)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catatan pengeluaran tidak ditemukan.",
        )
    await db.commit()
    return {"ok": True, "message": "Catatan belanja berhasil dihapus."}
