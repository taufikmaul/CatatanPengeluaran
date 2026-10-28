# app/services/master_data_service.py
"""
app/services/master_data_service.py — Service Layer Master Data (Kategori, Metode Bayar, Satuan)
"""
from datetime import datetime
from typing import Any
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.models.master_data import MasterDataOption
from app.models.expense import Expense
from app.models.master_item import MasterItem
from app.config import settings

VALID_TYPES = ("kategori", "metode_bayar", "satuan")

DEFAULT_MASTER_DATA: dict[str, list[dict[str, Any]]] = {
    "kategori": [
        {"name": "Bahan Kue", "description": "Bahan baku pembuatan kue & roti", "sort_order": 1, "is_default": False},
        {"name": "Bahan Minuman", "description": "Bahan baku minuman, sirup, teh, kopi", "sort_order": 2, "is_default": False},
        {"name": "Kebersihan", "description": "Sabun, plastik sampah, pembersih lantai, spon", "sort_order": 3, "is_default": False},
        {"name": "Kantor", "description": "ATK, kertas nota, pulpen, lakban", "sort_order": 4, "is_default": False},
        {"name": "Kemasan", "description": "Box kue, standing pouch, kantong plastik, pita", "sort_order": 5, "is_default": False},
        {"name": "Operasional", "description": "Gas LPG, listrik, galon air, es batu, transportasi", "sort_order": 6, "is_default": False},
        {"name": "Topper & Mainan", "description": "Lilin ultah, topper cake, hiasan kue", "sort_order": 7, "is_default": False},
        {"name": "Renovasi", "description": "Perbaikan toko, cat, peralatan tukang", "sort_order": 8, "is_default": False},
        {"name": "Asset", "description": "Peralatan tahan lama, mixer, loyang, showcase", "sort_order": 9, "is_default": False},
        {"name": "Iuran", "description": "Iuran sampah, keamanan, lingkungan", "sort_order": 10, "is_default": False},
        {"name": "Tukar Cash", "description": "Tarik tunai kasir / titip transfer kas", "sort_order": 11, "is_default": False},
        {"name": "Ongkir", "description": "Ongkos kirim kurir delivery pesanan", "sort_order": 12, "is_default": False},
    ],
    "metode_bayar": [
        {"name": "Tunai", "description": "Uang tunai kasir toko", "sort_order": 1, "is_default": True},
        {"name": "Transfer", "description": "Transfer bank (BCA, Mandiri, BRI, dll)", "sort_order": 2, "is_default": False},
        {"name": "QRIS", "description": "Pembayaran barcode QRIS", "sort_order": 3, "is_default": False},
        {"name": "Debit", "description": "Kartu debit EDC", "sort_order": 4, "is_default": False},
        {"name": "Kredit", "description": "Kartu kredit EDC / tempo bank", "sort_order": 5, "is_default": False},
    ],
    "satuan": [
        {"name": "Pcs", "description": "Pieces / satuan bijian umum", "sort_order": 1, "is_default": True},
        {"name": "Box", "description": "Kotak / kardus kecil", "sort_order": 2, "is_default": False},
        {"name": "Pouch", "description": "Kemasan kantong / pouch berdiri", "sort_order": 3, "is_default": False},
        {"name": "Kg", "description": "Kilogram (berat)", "sort_order": 4, "is_default": False},
        {"name": "Dus", "description": "Karton besar / dus luar", "sort_order": 5, "is_default": False},
        {"name": "Kaleng", "description": "Kemasan kaleng can / tin", "sort_order": 6, "is_default": False},
        {"name": "Pack", "description": "Paket isi beberapa kemasan", "sort_order": 7, "is_default": False},
        {"name": "Sak", "description": "Karung besar / sak (terigu, gula)", "sort_order": 8, "is_default": False},
        {"name": "Bal", "description": "Bal besar (kemasan plastik/kertas)", "sort_order": 9, "is_default": False},
        {"name": "Botol", "description": "Kemasan botol cairan / perisa", "sort_order": 10, "is_default": False},
        {"name": "Tray", "description": "Rak telur / kemasan nampan", "sort_order": 11, "is_default": False},
        {"name": "Liter", "description": "Liter (satuan volume)", "sort_order": 12, "is_default": False},
        {"name": "Gram", "description": "Gram (satuan berat kecil)", "sort_order": 13, "is_default": False},
        {"name": "Roll", "description": "Gulungan (plastik roll, pita)", "sort_order": 14, "is_default": False},
        {"name": "Lembar", "description": "Lembaran kertas / stiker", "sort_order": 15, "is_default": False},
        {"name": "Meter", "description": "Satuan panjang", "sort_order": 16, "is_default": False},
    ],
}


async def ensure_default_master_data(db: AsyncSession) -> None:
    """Pastikan data master default terisi bila tabel masih kosong."""
    for opt_type, items in DEFAULT_MASTER_DATA.items():
        res = await db.execute(
            select(func.count(MasterDataOption.id)).where(MasterDataOption.type == opt_type)
        )
        count = res.scalar() or 0
        if count == 0:
            for itm in items:
                new_opt = MasterDataOption(
                    type=opt_type,
                    name=itm["name"],
                    description=itm.get("description", ""),
                    sort_order=itm.get("sort_order", 0),
                    is_active=True,
                    is_default=itm.get("is_default", False),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(new_opt)
            await db.commit()


async def get_usage_count(db: AsyncSession, opt_type: str, name: str) -> int:
    """Hitung berapa kali nama opsi ini dipakai di database."""
    name_clean = name.strip()
    if opt_type == "kategori":
        exp_res = await db.execute(
            select(func.count(Expense.id)).where(func.lower(Expense.category) == func.lower(name_clean))
        )
        exp_count = exp_res.scalar() or 0

        mi_res = await db.execute(
            select(func.count(MasterItem.id)).where(func.lower(MasterItem.category) == func.lower(name_clean))
        )
        mi_count = mi_res.scalar() or 0
        return exp_count + mi_count

    elif opt_type == "metode_bayar":
        exp_res = await db.execute(
            select(func.count(Expense.id)).where(func.lower(Expense.pay_method) == func.lower(name_clean))
        )
        return exp_res.scalar() or 0

    elif opt_type == "satuan":
        exp_res = await db.execute(
            select(func.count(Expense.id)).where(func.lower(Expense.unit) == func.lower(name_clean))
        )
        exp_count = exp_res.scalar() or 0

        mi_res = await db.execute(
            select(func.count(MasterItem.id)).where(
                or_(
                    func.lower(MasterItem.satuan_beli) == func.lower(name_clean),
                    func.lower(MasterItem.satuan_ecer) == func.lower(name_clean),
                )
            )
        )
        mi_count = mi_res.scalar() or 0
        return exp_count + mi_count

    return 0


async def get_master_options(
    db: AsyncSession,
    opt_type: str | None = None,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    """Ambil daftar opsi master data beserta jumlah penggunaannya."""
    await ensure_default_master_data(db)

    query = select(MasterDataOption).order_by(
        MasterDataOption.type,
        MasterDataOption.sort_order.asc(),
        MasterDataOption.name.asc(),
    )
    if opt_type:
        query = query.where(MasterDataOption.type == opt_type)
    if active_only:
        query = query.where(MasterDataOption.is_active == True)  # noqa: E712

    res = await db.execute(query)
    items = res.scalars().all()

    output = []
    for itm in items:
        usage = await get_usage_count(db, itm.type, itm.name)
        output.append({
            "id": itm.id,
            "type": itm.type,
            "name": itm.name,
            "description": itm.description or "",
            "sort_order": itm.sort_order,
            "is_active": itm.is_active,
            "is_default": itm.is_default,
            "usage_count": usage,
            "created_at": itm.created_at.isoformat() if itm.created_at else None,
            "updated_at": itm.updated_at.isoformat() if itm.updated_at else None,
        })

    return output


async def get_active_names(db: AsyncSession, opt_type: str) -> list[str]:
    """Ambil daftar nama aktif yang terurut."""
    await ensure_default_master_data(db)
    query = (
        select(MasterDataOption.name)
        .where(MasterDataOption.type == opt_type, MasterDataOption.is_active == True)  # noqa: E712
        .order_by(MasterDataOption.sort_order.asc(), MasterDataOption.name.asc())
    )
    res = await db.execute(query)
    names = [row[0] for row in res.fetchall()]
    return names


async def sync_runtime_settings(db: AsyncSession) -> None:
    """Sinkronkan settings.valid_categories dengan master data aktif di DB."""
    active_cats = await get_active_names(db, "kategori")
    if active_cats:
        settings.valid_categories = active_cats


async def create_master_option(
    db: AsyncSession,
    opt_type: str,
    name: str,
    description: str = "",
    sort_order: int | None = None,
    is_default: bool = False,
) -> dict[str, Any]:
    """Tambah opsi master data baru."""
    clean_type = opt_type.strip().lower()
    if clean_type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipe master data tidak valid. Pilihan: {', '.join(VALID_TYPES)}",
        )

    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nama opsi tidak boleh kosong",
        )

    # Cek duplikasi nama untuk type ini
    existing = await db.execute(
        select(MasterDataOption).where(
            MasterDataOption.type == clean_type,
            func.lower(MasterDataOption.name) == func.lower(clean_name),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Opsi '{clean_name}' sudah ada dalam master {clean_type}",
        )

    # Tentukan sort order jika tidak dispesifikasikan
    if sort_order is None or sort_order <= 0:
        max_order_res = await db.execute(
            select(func.max(MasterDataOption.sort_order)).where(MasterDataOption.type == clean_type)
        )
        current_max = max_order_res.scalar() or 0
        sort_order = current_max + 1

    # Jika diset sebagai default, reset default opsi lain di tipe yang sama
    if is_default:
        await db.execute(
            update(MasterDataOption)
            .where(MasterDataOption.type == clean_type)
            .values(is_default=False)
        )

    new_opt = MasterDataOption(
        type=clean_type,
        name=clean_name,
        description=description.strip() if description else "",
        sort_order=sort_order,
        is_active=True,
        is_default=is_default,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(new_opt)
    await db.commit()
    await db.refresh(new_opt)

    if clean_type == "kategori":
        await sync_runtime_settings(db)

    return {
        "id": new_opt.id,
        "type": new_opt.type,
        "name": new_opt.name,
        "description": new_opt.description,
        "sort_order": new_opt.sort_order,
        "is_active": new_opt.is_active,
        "is_default": new_opt.is_default,
        "usage_count": 0,
        "created_at": new_opt.created_at.isoformat(),
        "updated_at": new_opt.updated_at.isoformat(),
    }


async def update_master_option(
    db: AsyncSession,
    item_id: int,
    name: str | None = None,
    description: str | None = None,
    sort_order: int | None = None,
    is_active: bool | None = None,
    is_default: bool | None = None,
) -> dict[str, Any]:
    """Perbarui opsi master data."""
    res = await db.execute(select(MasterDataOption).where(MasterDataOption.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Opsi master data tidak ditemukan",
        )

    # Validasi nama jika diubah
    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nama opsi tidak boleh kosong",
            )
        if clean_name.lower() != item.name.lower():
            dup_res = await db.execute(
                select(MasterDataOption).where(
                    MasterDataOption.type == item.type,
                    func.lower(MasterDataOption.name) == func.lower(clean_name),
                    MasterDataOption.id != item_id,
                )
            )
            if dup_res.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Opsi '{clean_name}' sudah ada dalam master {item.type}",
                )
        item.name = clean_name

    if description is not None:
        item.description = description.strip()

    if sort_order is not None:
        item.sort_order = int(sort_order)

    if is_active is not None:
        item.is_active = bool(is_active)

    if is_default is not None:
        if is_default:
            await db.execute(
                update(MasterDataOption)
                .where(MasterDataOption.type == item.type, MasterDataOption.id != item_id)
                .values(is_default=False)
            )
            item.is_default = True
        else:
            item.is_default = False

    item.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(item)

    if item.type == "kategori":
        await sync_runtime_settings(db)

    usage = await get_usage_count(db, item.type, item.name)
    return {
        "id": item.id,
        "type": item.type,
        "name": item.name,
        "description": item.description,
        "sort_order": item.sort_order,
        "is_active": item.is_active,
        "is_default": item.is_default,
        "usage_count": usage,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


async def delete_master_option(
    db: AsyncSession,
    item_id: int,
    force: bool = False,
) -> dict[str, Any]:
    """Hapus opsi master data. Bila masih dipakai dalam transaksi, tolak kecuali force=True atau sarankan nonaktifkan."""
    res = await db.execute(select(MasterDataOption).where(MasterDataOption.id == item_id))
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Opsi master data tidak ditemukan",
        )

    usage = await get_usage_count(db, item.type, item.name)
    if usage > 0 and not force:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Opsi '{item.name}' tidak dapat dihapus karena sedang dipakai oleh {usage} transaksi / data master. "
                "Anda dapat menonaktifkannya agar tidak muncul lagi pada pilihan input baru."
            ),
        )

    opt_type = item.type
    opt_name = item.name
    await db.delete(item)
    await db.commit()

    if opt_type == "kategori":
        await sync_runtime_settings(db)

    return {
        "ok": True,
        "message": f"Opsi '{opt_name}' berhasil dihapus dari master {opt_type}",
        "deleted_id": item_id,
    }


async def reset_master_data_defaults(
    db: AsyncSession,
    opt_type: str | None = None,
) -> dict[str, Any]:
    """Pulihkan opsi default yang mungkin terhapus atau belum ada."""
    types_to_check = [opt_type.strip().lower()] if opt_type and opt_type in VALID_TYPES else list(VALID_TYPES)
    restored_count = 0

    for t in types_to_check:
        default_items = DEFAULT_MASTER_DATA.get(t, [])
        for itm in default_items:
            res = await db.execute(
                select(MasterDataOption).where(
                    MasterDataOption.type == t,
                    func.lower(MasterDataOption.name) == func.lower(itm["name"]),
                )
            )
            existing = res.scalar_one_or_none()
            if not existing:
                new_opt = MasterDataOption(
                    type=t,
                    name=itm["name"],
                    description=itm.get("description", ""),
                    sort_order=itm.get("sort_order", 0),
                    is_active=True,
                    is_default=itm.get("is_default", False),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(new_opt)
                restored_count += 1
            else:
                # Pastikan aktif kembali jika sebelumnya dinonaktifkan
                if not existing.is_active:
                    existing.is_active = True
                    restored_count += 1

    await db.commit()
    await sync_runtime_settings(db)

    return {
        "ok": True,
        "message": f"Berhasil memulihkan opsi default ({restored_count} opsi ditambahkan/diaktifkan kembali).",
        "restored_count": restored_count,
    }
