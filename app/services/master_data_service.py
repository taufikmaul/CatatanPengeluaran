# app/services/master_data_service.py
"""
app/services/master_data_service.py — Service Layer Master Data (Kategori, Metode Bayar, Satuan)
"""
import re
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
        {"name": "Bahan Kue", "description": "Bahan baku pembuatan kue & roti", "sort_order": 1, "is_default": False, "account_code": "5-1100", "account_name": "Beban Pokok Bahan Baku Kue", "account_group": "HPP", "report_type": "LABA_RUGI"},
        {"name": "Bahan Minuman", "description": "Bahan baku minuman, sirup, teh, kopi", "sort_order": 2, "is_default": False, "account_code": "5-1200", "account_name": "Beban Pokok Bahan Minuman", "account_group": "HPP", "report_type": "LABA_RUGI"},
        {"name": "Kebersihan", "description": "Sabun, plastik sampah, pembersih lantai, spon", "sort_order": 3, "is_default": False, "account_code": "6-1200", "account_name": "Beban Perlengkapan & Sanitasi", "account_group": "OPEX", "report_type": "LABA_RUGI"},
        {"name": "Kantor", "description": "ATK, kertas nota, pulpen, lakban", "sort_order": 4, "is_default": False, "account_code": "6-1300", "account_name": "Beban Administrasi & ATK", "account_group": "OPEX", "report_type": "LABA_RUGI"},
        {"name": "Kemasan", "description": "Box kue, standing pouch, kantong plastik, pita", "sort_order": 5, "is_default": False, "account_code": "5-1300", "account_name": "Beban Bahan Pembantu & Kemasan", "account_group": "HPP", "report_type": "LABA_RUGI"},
        {"name": "Operasional", "description": "Gas LPG, listrik, galon air, es batu, transportasi", "sort_order": 6, "is_default": False, "account_code": "6-1100", "account_name": "Beban Utilitas & Operasional Toko", "account_group": "OPEX", "report_type": "LABA_RUGI"},
        {"name": "Topper & Mainan", "description": "Lilin ultah, topper cake, hiasan kue", "sort_order": 7, "is_default": False, "account_code": "5-1400", "account_name": "Beban Aksesoris & Ornamen Produk", "account_group": "HPP", "report_type": "LABA_RUGI"},
        {"name": "Renovasi", "description": "Perbaikan toko, cat, peralatan tukang", "sort_order": 8, "is_default": False, "account_code": "6-1400", "account_name": "Beban Pemeliharaan & Perbaikan", "account_group": "OPEX", "report_type": "LABA_RUGI"},
        {"name": "Asset", "description": "Peralatan tahan lama, mixer, loyang, showcase", "sort_order": 9, "is_default": False, "account_code": "1-2100", "account_name": "Aset Tetap - Peralatan & Mesin", "account_group": "ASSET", "report_type": "NERACA"},
        {"name": "Iuran", "description": "Iuran sampah, keamanan, lingkungan", "sort_order": 10, "is_default": False, "account_code": "6-1500", "account_name": "Beban Retribusi & Lingkungan", "account_group": "OPEX", "report_type": "LABA_RUGI"},
        {"name": "Tukar Cash", "description": "Tarik tunai kasir / titip transfer kas", "sort_order": 11, "is_default": False, "account_code": "1-1199", "account_name": "Kas Kliring / Penukaran Tunai", "account_group": "CASH_TRANSFER", "report_type": "ARUS_KAS"},
        {"name": "Ongkir", "description": "Ongkos kirim kurir delivery pesanan", "sort_order": 12, "is_default": False, "account_code": "5-1500", "account_name": "Beban Angkut Penjualan (Delivery)", "account_group": "HPP", "report_type": "LABA_RUGI"},
    ],
    "metode_bayar": [
        {"name": "Tunai", "description": "Uang tunai kasir toko", "sort_order": 1, "is_default": True, "account_code": "1-1110", "account_name": "Kas Tunai Kasir", "account_group": "KAS", "report_type": "NERACA"},
        {"name": "Transfer", "description": "Transfer bank (BCA, Mandiri, BRI, dll)", "sort_order": 2, "is_default": False, "account_code": "1-1120", "account_name": "Bank Operasional", "account_group": "BANK", "report_type": "NERACA"},
        {"name": "QRIS", "description": "Pembayaran barcode QRIS", "sort_order": 3, "is_default": False, "account_code": "1-1121", "account_name": "QRIS Settlement", "account_group": "BANK", "report_type": "NERACA"},
        {"name": "Debit", "description": "Kartu debit EDC", "sort_order": 4, "is_default": False, "account_code": "1-1122", "account_name": "EDC Debit", "account_group": "BANK", "report_type": "NERACA"},
        {"name": "Kredit", "description": "Kartu kredit EDC / tempo bank", "sort_order": 5, "is_default": False, "account_code": "2-1110", "account_name": "Kartu Kredit / Tempo", "account_group": "HUTANG", "report_type": "NERACA"},
        {"name": "COD", "description": "Cash on Delivery / Bayar di Tempat (Kasir)", "sort_order": 6, "is_default": False, "account_code": "1-1110", "account_name": "Kas Tunai Kasir (COD)", "account_group": "KAS", "report_type": "NERACA"},
    ],
    "satuan": [
        {"name": "Pcs", "description": "Pieces / satuan bijian umum", "sort_order": 1, "is_default": True},
        {"name": "Box", "description": "Kotak / kardus kecil", "sort_order": 2, "is_default": False},
        {"name": "Bungkus", "description": "Bungkus / kemasan pembungkus", "sort_order": 3, "is_default": False},
        {"name": "Pack", "description": "Paket isi beberapa kemasan", "sort_order": 4, "is_default": False},
        {"name": "Pouch", "description": "Kemasan kantong / pouch berdiri", "sort_order": 5, "is_default": False},
        {"name": "Kg", "description": "Kilogram (berat)", "sort_order": 6, "is_default": False},
        {"name": "Gram", "description": "Gram (satuan berat kecil)", "sort_order": 7, "is_default": False},
        {"name": "Dus", "description": "Karton besar / dus luar", "sort_order": 8, "is_default": False},
        {"name": "Kaleng", "description": "Kemasan kaleng can / tin", "sort_order": 9, "is_default": False},
        {"name": "Sak", "description": "Karung besar / sak (terigu, gula)", "sort_order": 10, "is_default": False},
        {"name": "Bal", "description": "Bal besar (kemasan plastik/kertas)", "sort_order": 11, "is_default": False},
        {"name": "Botol", "description": "Kemasan botol cairan / perisa", "sort_order": 12, "is_default": False},
        {"name": "Tray", "description": "Rak telur / kemasan nampan", "sort_order": 13, "is_default": False},
        {"name": "Liter", "description": "Liter (satuan volume)", "sort_order": 14, "is_default": False},
        {"name": "Roll", "description": "Gulungan (plastik roll, pita)", "sort_order": 15, "is_default": False},
        {"name": "Lembar", "description": "Lembaran kertas / stiker", "sort_order": 16, "is_default": False},
        {"name": "Meter", "description": "Satuan panjang", "sort_order": 17, "is_default": False},
        {"name": "Ikat", "description": "Ikatan (daun pandan, sayur, dll)", "sort_order": 18, "is_default": False},
        {"name": "Butir", "description": "Butir (telur, kelapa, buah)", "sort_order": 19, "is_default": False},
        {"name": "Trans", "description": "Transaksi (Tukar Cash kasir)", "sort_order": 20, "is_default": False},
        {"name": "Trip", "description": "Trip pengiriman kurir (Ongkir)", "sort_order": 21, "is_default": False},
    ],
}


async def ensure_default_master_data(db: AsyncSession) -> None:
    """Pastikan data master default terisi bila belum ada di tabel, dan lengkapi akun akuntansi jika kosong."""
    changed = False
    for opt_type, items in DEFAULT_MASTER_DATA.items():
        existing_res = await db.execute(
            select(MasterDataOption).where(MasterDataOption.type == opt_type)
        )
        existing_items = existing_res.scalars().all()
        existing_map = {row.name.strip().lower(): row for row in existing_items}

        for itm in items:
            key = itm["name"].strip().lower()
            if key not in existing_map:
                new_opt = MasterDataOption(
                    type=opt_type,
                    name=itm["name"],
                    description=itm.get("description", ""),
                    sort_order=itm.get("sort_order", 0),
                    is_active=True,
                    is_default=itm.get("is_default", False),
                    account_code=itm.get("account_code"),
                    account_name=itm.get("account_name"),
                    account_group=itm.get("account_group"),
                    report_type=itm.get("report_type"),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(new_opt)
                existing_map[key] = new_opt
                changed = True
            else:
                existing_item = existing_map[key]
                if not existing_item.account_code and itm.get("account_code"):
                    existing_item.account_code = itm.get("account_code")
                    existing_item.account_name = itm.get("account_name")
                    existing_item.account_group = itm.get("account_group")
                    existing_item.report_type = itm.get("report_type")
                    existing_item.updated_at = datetime.utcnow()
                    changed = True

    if changed:
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
            "account_code": itm.account_code,
            "account_name": itm.account_name,
            "account_group": itm.account_group,
            "report_type": itm.report_type,
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


async def get_valid_units(db: AsyncSession) -> list[str]:
    """Ambil semua nama satuan yang terdaftar dan aktif di data master."""
    return await get_active_names(db, "satuan")


async def normalize_unit_to_master(db: AsyncSession, unit_str: str | None) -> str | None:
    """
    Cek apakah satuan yang diinput sesuai dengan data master satuan yang aktif (case-insensitive).
    Mengembalikan nama satuan resmi dari master data jika cocok, atau None jika tidak terdaftar.
    """
    if not unit_str or not unit_str.strip():
        return None
    valid_units = await get_valid_units(db)
    cleaned = unit_str.strip().lower()
    for u in valid_units:
        if u.strip().lower() == cleaned:
            return u
    return None


async def sync_runtime_settings(db: AsyncSession) -> None:
    """Sinkronkan settings.valid_categories dan valid_payment_methods dengan master data aktif di DB."""
    active_cats = await get_active_names(db, "kategori")
    if active_cats:
        settings.valid_categories = active_cats
    active_pay_methods = await get_active_names(db, "metode_bayar")
    if active_pay_methods:
        settings.valid_payment_methods = active_pay_methods


def normalize_payment_method_name(
    raw_name: str | None,
    valid_methods: list[str] | None = None,
) -> str:
    """
    Normalisasi input metode bayar agar SELALU sesuai dengan master data metode pembayaran.
    - Mencocokkan case-insensitive ke master options
    - Menangani sinonim umum: COD / bayar di tempat, Tunai / cash, Transfer / bank / tf, QRIS / qr, Debit, Kredit
    - Menjamin hasil mengembalikan salah satu nama opsi di master data
    """
    methods = valid_methods or getattr(
        settings, "valid_payment_methods", ["Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"]
    )
    if not methods:
        methods = ["Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"]

    # Cari nama canonical dengan case-insensitive mapping
    method_map = {m.strip().lower(): m.strip() for m in methods}
    default_method = methods[0] if methods else "Tunai"
    if "tunai" in method_map:
        default_method = method_map["tunai"]

    if not raw_name or not str(raw_name).strip() or str(raw_name).strip() in ("-", "None"):
        return default_method

    cleaned = str(raw_name).strip()
    cleaned_lower = cleaned.lower()

    # 1. Exact match (case-insensitive)
    if cleaned_lower in method_map:
        return method_map[cleaned_lower]

    # 2. Sinonim QRIS (dicek awal agar tidak terpotong kata lain)
    if re.search(r"\b(qris|qr|scan qr|barcode|qris dinamik|qris statis)\b", cleaned_lower) or "qr code" in cleaned_lower or "qris" in cleaned_lower:
        if "qris" in method_map:
            return method_map["qris"]

    # 3. Sinonim COD (Cash on Delivery / Bayar di Tempat)
    if re.search(r"\b(cod|cash on delivery)\b", cleaned_lower) or "bayar di tempat" in cleaned_lower or "bayar ditempat" in cleaned_lower:
        if "cod" in method_map:
            return method_map["cod"]
        for k, v in method_map.items():
            if "cod" in k:
                return v

    # 4. Sinonim Tunai / Cash
    if re.search(r"\b(tunai|cash|kasir|uang fisik|laci)\b", cleaned_lower):
        if "tunai" in method_map:
            return method_map["tunai"]

    # 5. Sinonim Kartu Debit
    if re.search(r"\b(debit|kartu debit|edc debit)\b", cleaned_lower):
        if "debit" in method_map:
            return method_map["debit"]

    # 6. Sinonim Kartu Kredit
    if re.search(r"\b(kredit|credit|cc|kartu kredit)\b", cleaned_lower):
        if "kredit" in method_map:
            return method_map["kredit"]

    # 7. Sinonim Transfer Bank & E-Wallet
    if re.search(r"\b(transfer|tf|bank|bca|mandiri|bri|bni|permata|dana|gopay|ovo|shopeepay|linkaja|m-banking|livin|brimo)\b", cleaned_lower):
        if "transfer" in method_map:
            return method_map["transfer"]

    # 8. Substring match pada master options lainnya
    for k, v in method_map.items():
        if k in cleaned_lower or cleaned_lower in k:
            return v

    return default_method


async def create_master_option(
    db: AsyncSession,
    opt_type: str,
    name: str,
    description: str = "",
    sort_order: int | None = None,
    is_default: bool = False,
    account_code: str | None = None,
    account_name: str | None = None,
    account_group: str | None = None,
    report_type: str | None = None,
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
        account_code=account_code.strip() if account_code and account_code.strip() else None,
        account_name=account_name.strip() if account_name and account_name.strip() else None,
        account_group=account_group.strip() if account_group and account_group.strip() else None,
        report_type=report_type.strip() if report_type and report_type.strip() else None,
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
        "account_code": new_opt.account_code,
        "account_name": new_opt.account_name,
        "account_group": new_opt.account_group,
        "report_type": new_opt.report_type,
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
    account_code: str | None = None,
    account_name: str | None = None,
    account_group: str | None = None,
    report_type: str | None = None,
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

    if account_code is not None:
        item.account_code = account_code.strip() if account_code.strip() else None

    if account_name is not None:
        item.account_name = account_name.strip() if account_name.strip() else None

    if account_group is not None:
        item.account_group = account_group.strip() if account_group.strip() else None

    if report_type is not None:
        item.report_type = report_type.strip() if report_type.strip() else None

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
        "account_code": item.account_code,
        "account_name": item.account_name,
        "account_group": item.account_group,
        "report_type": item.report_type,
        "usage_count": usage,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
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
                    account_code=itm.get("account_code"),
                    account_name=itm.get("account_name"),
                    account_group=itm.get("account_group"),
                    report_type=itm.get("report_type"),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(new_opt)
                restored_count += 1
            else:
                updated_fields = False
                # Pastikan aktif kembali jika sebelumnya dinonaktifkan
                if not existing.is_active:
                    existing.is_active = True
                    updated_fields = True
                # Perbarui akun akuntansi jika masih kosong
                if not existing.account_code and itm.get("account_code"):
                    existing.account_code = itm.get("account_code")
                    existing.account_name = itm.get("account_name")
                    existing.account_group = itm.get("account_group")
                    existing.report_type = itm.get("report_type")
                    updated_fields = True
                if updated_fields:
                    existing.updated_at = datetime.utcnow()
                    restored_count += 1

    await db.commit()
    await sync_runtime_settings(db)

    return {
        "ok": True,
        "message": f"Berhasil memulihkan opsi default ({restored_count} opsi ditambahkan/diaktifkan kembali).",
        "restored_count": restored_count,
    }


async def get_category_accounting_map(db: AsyncSession) -> dict[str, dict[str, str | None]]:
    """
    Ambil kamus pemetaan kategori ke bagan akun standar (Chart of Accounts):
    {
        "Bahan Kue": {
            "account_code": "5-1100",
            "account_name": "Beban Pokok Bahan Baku Kue",
            "account_group": "HPP",
            "report_type": "LABA_RUGI"
        },
        ...
    }
    """
    await ensure_default_master_data(db)
    res = await db.execute(
        select(MasterDataOption).where(MasterDataOption.type == "kategori")
    )
    items = res.scalars().all()
    mapping: dict[str, dict[str, str | None]] = {}
    for itm in items:
        mapping[itm.name] = {
            "account_code": itm.account_code,
            "account_name": itm.account_name,
            "account_group": itm.account_group,
            "report_type": itm.report_type,
        }
    return mapping
