"""
app/api/master_items.py — REST API untuk Katalog Nama Item Baku (Master Item)
& Saran Autocomplete Form Pengeluaran.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.api.deps import require_auth
from app.models.master_item import MasterItem
from app.api.schemas import (
    MasterItemCreate,
    MasterItemUpdate,
    MasterItemBulkRequest,
    MasterItemResponse,
    MasterItemAuditResponse,
    MasterItemMergeRequest,
    MasterItemMergeResponse,
)
from app.services.master_item_service import (
    list_master_items,
    create_master_item,
    bulk_Import_master_items,
    sync_existing_expenses_to_master,
    import_master_items_from_history,
    get_item_and_supplier_suggestions,
    audit_duplicate_master_items,
    merge_master_items,
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

    # Indeks histori berdasarkan ID MasterItem (produk ID) dan fallback nama
    hist_by_id = {
        s["id"]: s
        for s in suggestions.get("items", [])
        if s.get("id") is not None
    }
    hist_by_name = {
        s["item_name"].strip().lower(): s
        for s in suggestions.get("items", [])
    }

    data = []
    for m in items:
        h = hist_by_id.get(m.id) or hist_by_name.get(m.item_name.strip().lower(), {})
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


@router.get("/audit-duplicates", response_model=MasterItemAuditResponse)
async def audit_duplicates(
    min_score: float = 0.70,
    limit: int = 150,
    db: AsyncSession = Depends(get_db),
):
    """
    Audit seluruh katalog nama item baku untuk mendeteksi potensi duplikat.
    Mendeteksi perbedaan awalan/akhiran hasil scan AI nota belanja.
    """
    result = await audit_duplicate_master_items(db, min_score=min_score, limit=limit)
    return result


@router.post("/merge", response_model=MasterItemMergeResponse)
async def merge_items(
    payload: MasterItemMergeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Gabungkan satu atau lebih master item duplikat ke dalam satu target master item utama.
    Riwayat transaksi dialihkan, nama lama disimpan ke aliases dan catatan.
    """
    try:
        result = await merge_master_items(
            db=db,
            target_item_id=payload.target_item_id,
            source_item_ids=payload.source_item_ids,
            custom_name=payload.custom_name,
            custom_category=payload.custom_category,
            custom_supplier=payload.custom_supplier,
            custom_satuan_beli=payload.custom_satuan_beli,
            custom_tipe_satuan=payload.custom_tipe_satuan,
            custom_isi_paket=payload.custom_isi_paket,
            custom_satuan_ecer=payload.custom_satuan_ecer,
            merge_aliases=payload.merge_aliases,
            update_expenses=payload.update_expenses,
        )
        await db.commit()
        return result
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal menggabungkan item: {str(e)}")


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

    old_name = item.item_name
    name_changed = False
    new_name = None
    if payload.item_name is not None and payload.item_name.strip():
        new_name = payload.item_name.strip()
        if new_name != old_name:
            name_changed = True
            item.item_name = new_name

    # Simpan nama lama ke aliases agar input dengan nama lama tetap cocok otomatis
    if name_changed:
        current_aliases = [a.strip() for a in (item.aliases or "").split(",") if a.strip()]
        if old_name.lower() not in [a.lower() for a in current_aliases]:
            current_aliases.append(old_name)
            item.aliases = ", ".join(current_aliases)

    category_changed = False
    if payload.category is not None and payload.category.strip():
        if payload.category.strip() != item.category:
            category_changed = True
        item.category = payload.category.strip()

    if payload.default_supplier is not None:
        item.default_supplier = payload.default_supplier.strip() or "-"
    if payload.aliases is not None:
        # Jika aliases diupdate eksplisit, pastikan old_name tetap ada jika nama berubah
        new_aliases = [a.strip() for a in (payload.aliases or "").split(",") if a.strip()]
        if name_changed and old_name.lower() not in [a.lower() for a in new_aliases]:
            new_aliases.append(old_name)
        item.aliases = ", ".join(new_aliases)
    if payload.satuan_beli is not None:
        item.satuan_beli = payload.satuan_beli.strip() or "Pcs"
    if payload.tipe_satuan is not None:
        item.tipe_satuan = payload.tipe_satuan.strip() or "keduanya"
    if payload.isi_paket is not None:
        item.isi_paket = payload.isi_paket.strip()
    if payload.satuan_ecer is not None:
        item.satuan_ecer = payload.satuan_ecer.strip() or "Pcs"

    # Sinkronisasi order/transaksi yang terhubung ke produk ini
    from app.models.expense import Expense
    from sqlalchemy import or_

    exp_query = select(Expense).where(
        or_(
            Expense.master_item_id == item.id,
            func.lower(Expense.item_name) == old_name.lower(),
        )
    )
    exp_res = await db.execute(exp_query)
    linked_expenses = exp_res.scalars().all()

    for exp in linked_expenses:
        exp.master_item_id = item.id
        if name_changed and new_name:
            exp.item_name = new_name
            exp.sheets_synced = False
        if category_changed and exp.category != "Tukar Cash":
            exp.category = item.category
            exp.sheets_synced = False

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

    # Unlink expenses agar transaksi historis tetap ada
    from app.models.expense import Expense
    from sqlalchemy import update
    await db.execute(
        update(Expense)
        .where(Expense.master_item_id == item_id)
        .values(master_item_id=None)
    )

    await db.delete(item)
    await db.commit()
    return {"ok": True, "message": "Master item berhasil dihapus"}
