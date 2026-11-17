"""
app/api/assets.py — REST API Inventaris Aset Tetap, Label QR, Maintenance & Analisa Ulang (SAK EMKM)
"""
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_role,
    require_admin_role,
    require_auth,
    require_roles,
)
from app.api.schemas import (
    AssetMaintenanceCreate,
    AssetReanalyzeRequest,
    FixedAssetCreate,
    FixedAssetDisposeRequest,
    FixedAssetUpdate,
)
from app.database.connection import get_db
from app.services import asset_service
from app.services.dashboard_auth_service import get_authenticated_role, is_authenticated_request

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("", dependencies=[Depends(require_roles("admin", "admin_input", "warehouse", "purchasing"))])
async def list_assets_endpoint(
    search: str | None = Query(None, description="Cari kode, nama, merk, serial, vendor, atau lokasi"),
    status_filter: str | None = Query(None, alias="status", description="Filter status aset"),
    capitalization_status: str | None = Query(None, description="Filter: capitalized | expensed_low_value"),
    asset_group: str | None = Query(None, description="Filter kelompok aset"),
    location: str | None = Query(None, description="Filter lokasi penempatan"),
    as_of_year: int | None = Query(None, ge=2000, le=2100),
    as_of_month: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """Ambil daftar inventaris aset tetap beserta ringkasan nilai buku dan penyusutan."""
    return await asset_service.list_assets(
        db,
        search=search,
        status_filter=status_filter,
        capitalization_status=capitalization_status,
        asset_group=asset_group,
        location=location,
        as_of_year=as_of_year,
        as_of_month=as_of_month,
    )


@router.get("/label/{qr_token}")
async def get_asset_by_qr_label(
    qr_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Endpoint scan QR Label Aset.
    - Publik/staf tanpa login admin: hanya mengembalikan identitas fisik, lokasi, garansi & riwayat servis (tanpa data finansial).
    - Admin/Owner terautentikasi: mengembalikan data lengkap termasuk nilai perolehan, penyusutan & biaya servis.
    """
    is_auth = is_authenticated_request(request)
    role = get_authenticated_role(request) if is_auth else None
    include_financial = bool(is_auth and role == "admin")
    detail = await asset_service.get_asset_detail(
        db,
        qr_token=qr_token,
        include_financial=include_financial,
    )
    return {"ok": True, "asset": detail}


@router.post("/sync-existing", dependencies=[Depends(require_admin_role)])
async def sync_existing_asset_expenses_endpoint(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Sinkronkan pengeluaran kategori 'Asset' yang belum tercatat di inventaris."""
    actor = f"dashboard:{get_current_role(request)}"
    res = await asset_service.sync_existing_asset_expenses(db, actor=actor)
    await db.commit()
    return res


@router.post("/reanalyze", dependencies=[Depends(require_admin_role)])
async def reanalyze_assets_endpoint(
    payload: AssetReanalyzeRequest | None = None,
    request: Request = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Analisa ulang seluruh inventaris aset terhadap batas minimal harga kapitalisasi.
    Otomatis mengevaluasi ulang status kapitalisasi & metode penyusutan aset non-override.
    """
    actor = f"dashboard:{get_current_role(request)}" if request else "dashboard:admin"
    res = await asset_service.reanalyze_assets_by_threshold(
        db,
        new_threshold=payload.asset_capitalization_threshold if payload else None,
        new_default_life_months=payload.asset_default_useful_life_months if payload else None,
        actor=actor,
    )
    await db.commit()
    return res


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles("admin", "admin_input"))])
async def create_asset_endpoint(
    payload: FixedAssetCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Tambah data inventaris aset secara manual."""
    actor = f"dashboard:{get_current_role(request)}"
    ast = await asset_service.create_manual_asset(db, payload.model_dump(), actor=actor)
    await db.commit()
    detail = await asset_service.get_asset_detail(db, asset_id=ast.id, include_financial=True)
    return {"ok": True, "asset": detail}


@router.get("/{asset_id}", dependencies=[Depends(require_roles("admin", "admin_input", "warehouse", "purchasing"))])
async def get_asset_detail_endpoint(
    asset_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    role = get_current_role(request)
    include_financial = role in ("admin", "admin_input")
    detail = await asset_service.get_asset_detail(db, asset_id=asset_id, include_financial=include_financial)
    return {"ok": True, "asset": detail}


@router.put("/{asset_id}", dependencies=[Depends(require_roles("admin", "admin_input", "warehouse"))])
async def update_asset_endpoint(
    asset_id: int,
    payload: FixedAssetUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    actor = f"dashboard:{get_current_role(request)}"
    updates = payload.model_dump(exclude_unset=True)
    ast = await asset_service.update_asset(db, asset_id=asset_id, updates=updates, actor=actor)
    await db.commit()
    detail = await asset_service.get_asset_detail(db, asset_id=ast.id, include_financial=True)
    return {"ok": True, "asset": detail}


@router.post("/{asset_id}/dispose", dependencies=[Depends(require_admin_role)])
async def dispose_asset_endpoint(
    asset_id: int,
    payload: FixedAssetDisposeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Catat pelepasan, penjualan, atau penghapusan aset tetap sesuai SAK EMKM."""
    actor = f"dashboard:{get_current_role(request)}"
    ast = await asset_service.dispose_asset(
        db,
        asset_id=asset_id,
        disposed_at=payload.disposed_at,
        disposal_type=payload.disposal_type,
        disposal_proceeds=payload.disposal_proceeds,
        disposal_notes=payload.disposal_notes,
        actor=actor,
    )
    await db.commit()
    detail = await asset_service.get_asset_detail(db, asset_id=ast.id, include_financial=True)
    return {"ok": True, "asset": detail}


@router.post("/{asset_id}/maintenances", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_auth)])
async def add_asset_maintenance_endpoint(
    asset_id: int,
    payload: AssetMaintenanceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Tambah catatan pemeliharaan / servis aset (opsional sekaligus membuat transaksi Maintenance)."""
    actor = f"dashboard:{get_current_role(request)}"
    mt = await asset_service.add_asset_maintenance(
        db,
        asset_id=asset_id,
        maintenance_date=payload.maintenance_date,
        maintenance_type=payload.maintenance_type,
        vendor_name=payload.vendor_name,
        cost=payload.cost,
        description=payload.description,
        next_service_date=payload.next_service_date,
        service_warranty_until=payload.service_warranty_until,
        performed_by=payload.performed_by,
        create_expense=payload.create_expense,
        pay_method=payload.pay_method,
        actor=actor,
    )
    await db.commit()
    detail = await asset_service.get_asset_detail(db, asset_id=asset_id, include_financial=True)
    return {"ok": True, "maintenance_id": mt.id, "asset": detail}
