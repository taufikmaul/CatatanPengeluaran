"""
app/api/master_items.py — REST API untuk Katalog Nama Item Baku (Master Item)
& Saran Autocomplete Form Pengeluaran.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.api.deps import require_auth
from app.models.master_item import MasterItem
from app.api.schemas import (
    MasterItemCreate,
    MasterItemUpdate,
    MasterItemBulkRequest,
    MasterItemResponse,
)
from app.services.master_item_service import (
    list_master_items,
    create_master_item,
    bulk_Import_master_items,
    sync_existing_expenses_to_master,
    import_master_items_from_history,
    get_item_and_supplier_suggestions,
)

router = APIRouter(
    prefix="/master-items",
    tags=["master-items"],
    dependencies=[Depends(require_auth)],
)


@router.get("")
async def get_master_items(db: AsyncSession = Depends(get_db)):
    """Ambil semua daftar Master Item beserta statistik histori harga & transaksi."""
    items = await list_master_items(db)
    suggestions = await get_item_and_supplier_suggestions(db)

    hist_map = {
        s["item_name"].strip().lower(): s
        for s in suggestions.get("items", [])
    }

    data = []
    for m in items:
        h = hist_map.get(m.item_name.strip().lower(), {})
        data.append(
            MasterItemResponse(
                id=m.id,
                item_name=m.item_name,
                category=m.category,
                default_supplier=m.default_supplier or "-",
                aliases=m.aliases or "",
                satuan_beli=m.satuan_beli or "Pcs",
                tipe_satuan=m.tipe_satuan or "keduanya",
                isi_paket=m.isi_paket or "",
                satuan_ecer=m.satuan_ecer or "Pcs",
                last_unit_price=float(h.get("last_unit_price") or 0.0),
                last_supplier=h.get("last_supplier") or m.default_supplier or "-",
                tx_count=int(h.get("tx_count") or 0),
                created_at=m.created_at,
            )
        )

    return {
        "ok": True,
        "data": data,
        "total": len(data),
    }


@router.get("/suggestions")
async def get_suggestions(db: AsyncSession = Depends(get_db)):
    """Ambil saran autocomplete nama barang, harga terakhir, dan daftar supplier."""
    suggestions = await get_item_and_supplier_suggestions(db)
    return {
        "ok": True,
        **suggestions,
    }


@router.post("", response_model=MasterItemResponse, status_code=status.HTTP_201_CREATED)
async def add_master_item(
    payload: MasterItemCreate,
    db: AsyncSession = Depends(get_db),
):
    if not payload.item_name or not payload.item_name.strip():
        raise HTTPException(status_code=400, detail="Nama item baku wajib diisi")

    item = await create_master_item(
        db,
        item_name=payload.item_name,
        category=payload.category,
        default_supplier=payload.default_supplier,
        aliases=payload.aliases,
        satuan_beli=payload.satuan_beli,
        tipe_satuan=payload.tipe_satuan,
        isi_paket=payload.isi_paket,
        satuan_ecer=payload.satuan_ecer,
    )
    await db.commit()
    await db.refresh(item)
    return MasterItemResponse(
        id=item.id,
        item_name=item.item_name,
        category=item.category,
        default_supplier=item.default_supplier or "-",
        aliases=item.aliases or "",
        satuan_beli=item.satuan_beli or "Pcs",
        tipe_satuan=item.tipe_satuan or "keduanya",
        isi_paket=item.isi_paket or "",
        satuan_ecer=item.satuan_ecer or "Pcs",
        created_at=item.created_at,
    )


@router.post("/bulk")
async def bulk_add_master_items(
    payload: MasterItemBulkRequest,
    db: AsyncSession = Depends(get_db),
):
    """Tambah daftar nama item baku sekaligus (baris per baris)."""
    if not payload.raw_text or not payload.raw_text.strip():
        raise HTTPException(status_code=400, detail="Daftar teks item tidak boleh kosong")

    result = await bulk_Import_master_items(
        db,
        raw_text=payload.raw_text,
        default_category=payload.default_category,
    )
    await db.commit()
    return {
        "ok": True,
        **result,
    }


@router.post("/sync-existing")
async def sync_existing_expenses(db: AsyncSession = Depends(get_db)):
    """Cocokkan dan rapikan data pengeluaran yang sudah ada di DB ke Master Item baku."""
    result = await sync_existing_expenses_to_master(db)
    await db.commit()
    return {
        "ok": True,
        **result,
    }


@router.post("/import-from-history")
async def seed_master_items_from_history(db: AsyncSession = Depends(get_db)):
    """Tarik otomatis nama item unik dari histori transaksi pengeluaran menjadi Master Item."""
    result = await import_master_items_from_history(db)
    await db.commit()
    return {
        "ok": True,
        **result,
    }


@router.put("/{item_id}", response_model=MasterItemResponse)
async def update_master_item(
    item_id: int,
    payload: MasterItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(MasterItem).where(MasterItem.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Master item tidak ditemukan")

    if payload.item_name is not None and payload.item_name.strip():
        item.item_name = payload.item_name.strip()
    if payload.category is not None and payload.category.strip():
        item.category = payload.category.strip()
    if payload.default_supplier is not None:
        item.default_supplier = payload.default_supplier.strip() or "-"
    if payload.aliases is not None:
        item.aliases = payload.aliases.strip()
    if payload.satuan_beli is not None:
        item.satuan_beli = payload.satuan_beli.strip() or "Pcs"
    if payload.tipe_satuan is not None:
        item.tipe_satuan = payload.tipe_satuan.strip() or "keduanya"
    if payload.isi_paket is not None:
        item.isi_paket = payload.isi_paket.strip()
    if payload.satuan_ecer is not None:
        item.satuan_ecer = payload.satuan_ecer.strip() or "Pcs"

    await db.commit()
    await db.refresh(item)
    return MasterItemResponse(
        id=item.id,
        item_name=item.item_name,
        category=item.category,
        default_supplier=item.default_supplier or "-",
        aliases=item.aliases or "",
        satuan_beli=item.satuan_beli or "Pcs",
        tipe_satuan=item.tipe_satuan or "keduanya",
        isi_paket=item.isi_paket or "",
        satuan_ecer=item.satuan_ecer or "Pcs",
        created_at=item.created_at,
    )


@router.delete("/{item_id}")
async def delete_master_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(MasterItem).where(MasterItem.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Master item tidak ditemukan")

    await db.delete(item)
    await db.commit()
    return {"ok": True, "message": "Master item berhasil dihapus"}
