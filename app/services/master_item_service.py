"""
app/services/master_item_service.py — Layanan Katalog Nama Item Baku (Master Item)
& Pencocokan Otomatis (Fuzzy + Alias + Exact Match) untuk konsistensi pembukuan.
"""
import re
from difflib import SequenceMatcher
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.master_item import MasterItem
from app.models.expense import Expense
from app.config import settings


def _normalize_str(s: str) -> str:
    """Bersihkan karakter non-alfanumerik berlebih dan kecilkan huruf."""
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_aliases(aliases_str: str | None) -> list[str]:
    if not aliases_str:
        return []
    return [a.strip() for a in aliases_str.split(",") if a.strip()]


def find_best_master_match(
    raw_name: str,
    master_items: list[MasterItem],
    threshold: float = 0.72,
) -> MasterItem | None:
    """
    Cari MasterItem yang paling cocok dengan nama barang masuk (`raw_name`).
    Urutan prioritas:
    1. Exact match (case-insensitive) dengan item_name atau salah satu alias
    2. Substring/phrase match dengan alias atau item_name baku
    3. Token overlap & SequenceMatcher fuzzy similarity >= threshold
    """
    if not raw_name or not master_items:
        return None

    norm_raw = _normalize_str(raw_name)
    if not norm_raw or norm_raw == "-":
        return None

    raw_tokens = set(norm_raw.split())

    # 1. Exact Match (item_name atau alias)
    for m in master_items:
        norm_master = _normalize_str(m.item_name)
        if norm_raw == norm_master:
            return m
        for alias in _parse_aliases(m.aliases):
            if norm_raw == _normalize_str(alias):
                return m

    # 2. Phrase / Substring & Fuzzy Scoring
    best_match: MasterItem | None = None
    best_score: float = 0.0

    for m in master_items:
        candidates = [m.item_name] + _parse_aliases(m.aliases)
        for cand in candidates:
            norm_cand = _normalize_str(cand)
            if not norm_cand:
                continue

            cand_tokens = set(norm_cand.split())
            # Cek apakah seluruh kata kandidat ada di dalam raw_name (contoh: "tepung cakra" di "tepung terigu cakra 1kg")
            if cand_tokens and cand_tokens.issubset(raw_tokens):
                # Beri skor tinggi berdasarkan proporsi panjang
                overlap_bonus = 0.85 + (0.15 * (len(cand_tokens) / max(len(raw_tokens), 1)))
                if overlap_bonus > best_score:
                    best_score = overlap_bonus
                    best_match = m
                continue

            # Cek apakah seluruh kata raw_name (minimal 2 kata atau >= 4 huruf) ada di kandidat
            if raw_tokens and len(norm_raw) >= 4 and raw_tokens.issubset(cand_tokens):
                overlap_score = 0.78 + (0.15 * (len(raw_tokens) / max(len(cand_tokens), 1)))
                if overlap_score > best_score:
                    best_score = overlap_score
                    best_match = m

            # Hitung SequenceMatcher similarity + Jaccard token similarity
            seq_ratio = SequenceMatcher(None, norm_raw, norm_cand).ratio()
            union_len = len(raw_tokens | cand_tokens)
            jaccard = len(raw_tokens & cand_tokens) / union_len if union_len > 0 else 0.0
            combined = (seq_ratio * 0.65) + (jaccard * 0.35)

            # Jika kata pertama sama persis dan panjang >= 4, beri sedikit boost
            raw_first = norm_raw.split()[0] if norm_raw else ""
            cand_first = norm_cand.split()[0] if norm_cand else ""
            if raw_first and raw_first == cand_first and len(raw_first) >= 4:
                combined += 0.06

            if combined > best_score:
                best_score = combined
                best_match = m

    if best_match and best_score >= threshold:
        return best_match

    return None


def append_original_name_to_notes(raw_name: str, master_name: str, current_notes: str | None) -> str:
    """
    Jika nama asli di struk/input berbeda dengan nama item baku,
    catat nama asli di kolom Keterangan/Catatan.
    """
    notes = (current_notes or "-").strip()
    if not raw_name:
        return notes or "-"

    norm_raw = _normalize_str(raw_name)
    norm_master = _normalize_str(master_name)

    # Jika sama persis (hanya beda huruf besar/kecil atau tanda baca), tidak perlu dicatat
    if norm_raw == norm_master:
        return notes or "-"

    tag = f"Struk: {raw_name.strip()}"
    if not notes or notes == "-":
        return tag
    if raw_name.strip().lower() in notes.lower():
        return notes
    return f"{notes} | {tag}"


async def list_master_items(db: AsyncSession) -> list[MasterItem]:
    """Ambil semua daftar MasterItem diurutkan sesuai abjad."""
    result = await db.execute(select(MasterItem).order_by(MasterItem.item_name.asc()))
    return list(result.scalars().all())


async def match_and_normalize_extracted_items(db: AsyncSession, items: list[dict]) -> list[dict]:
    """
    Cocokkan setiap item hasil ekstraksi AI/input dengan katalog MasterItem.
    - Mengubah `barang` ke `MasterItem.item_name`
    - Menyesuaikan `kategori` ke `MasterItem.category` (kecuali kategori Tukar Cash)
    - Mengisi `toko_supplier` dengan `default_supplier` jika kosong/"-"
    - Menyesuaikan `satuan` / `unit` berdasarkan MasterItem dan konteks paket/ecer
    - Menyimpan nama asli struk ke `keterangan` jika namanya berubah
    """
    if not items:
        return items

    master_items = await list_master_items(db)
    if not master_items:
        return items

    for item in items:
        raw_name = (item.get("barang") or item.get("item_name") or "").strip()
        if not raw_name:
            continue

        matched = find_best_master_match(raw_name, master_items)
        if not matched:
            continue

        # Simpan nama asli ke keterangan bila berbeda
        old_notes = item.get("keterangan") if "keterangan" in item else item.get("notes", "-")
        new_notes = append_original_name_to_notes(raw_name, matched.item_name, old_notes)

        # Deteksi satuan paket vs ecer dari teks input / nama struk jika belum diset eksplisit
        current_unit = (item.get("satuan") or item.get("unit") or "").strip()
        if not current_unit or current_unit.lower() == "pcs":
            raw_lower = raw_name.lower()
            if any(k in raw_lower for k in ("box", "dus", "karton", "bal", "sak", "pack", "tray", "peti", "lusin")):
                chosen_unit = matched.satuan_beli or "Box"
            elif any(k in raw_lower for k in ("pouch", "kaleng", "kg", "gram", "gr", "butir", "botol", "ecer", "biji", "lembar")):
                chosen_unit = matched.satuan_ecer or matched.satuan_beli or "Pcs"
            else:
                chosen_unit = matched.satuan_beli or "Pcs"
        else:
            chosen_unit = current_unit

        if "barang" in item:
            item["barang"] = matched.item_name
            item["keterangan"] = new_notes
            item["satuan"] = chosen_unit
            item["unit"] = chosen_unit
            if item.get("kategori") != "Tukar Cash" and matched.category:
                item["kategori"] = matched.category
            if (not item.get("toko_supplier") or item.get("toko_supplier") == "-") and matched.default_supplier and matched.default_supplier != "-":
                item["toko_supplier"] = matched.default_supplier
        else:
            item["item_name"] = matched.item_name
            item["notes"] = new_notes
            item["satuan"] = chosen_unit
            item["unit"] = chosen_unit
            if item.get("category") != "Tukar Cash" and matched.category:
                item["category"] = matched.category
            if (not item.get("supplier") or item.get("supplier") == "-") and matched.default_supplier and matched.default_supplier != "-":
                item["supplier"] = matched.default_supplier

    return items


async def create_master_item(
    db: AsyncSession,
    item_name: str,
    category: str = "Bahan Kue",
    default_supplier: str = "-",
    aliases: str = "",
    satuan_beli: str = "Pcs",
    tipe_satuan: str = "keduanya",
    isi_paket: str = "",
    satuan_ecer: str = "Pcs",
) -> MasterItem:
    """Buat satu MasterItem baru atau update jika nama sudah ada."""
    clean_name = item_name.strip()
    existing_res = await db.execute(
        select(MasterItem).where(func.lower(MasterItem.item_name) == clean_name.lower())
    )
    existing = existing_res.scalar_one_or_none()
    if existing:
        existing.category = category or existing.category
        if default_supplier and default_supplier != "-":
            existing.default_supplier = default_supplier
        if aliases:
            existing.aliases = aliases
        if satuan_beli:
            existing.satuan_beli = satuan_beli
        if tipe_satuan:
            existing.tipe_satuan = tipe_satuan
        if isi_paket is not None:
            existing.isi_paket = isi_paket
        if satuan_ecer:
            existing.satuan_ecer = satuan_ecer
        await db.flush()
        return existing

    item = MasterItem(
        item_name=clean_name,
        category=category if category in settings.valid_categories else "Bahan Kue",
        default_supplier=(default_supplier or "-").strip() or "-",
        aliases=(aliases or "").strip(),
        satuan_beli=(satuan_beli or "Pcs").strip() or "Pcs",
        tipe_satuan=(tipe_satuan or "keduanya").strip() or "keduanya",
        isi_paket=(isi_paket or "").strip(),
        satuan_ecer=(satuan_ecer or "Pcs").strip() or "Pcs",
    )
    db.add(item)
    await db.flush()
    return item


async def bulk_Import_master_items(
    db: AsyncSession,
    raw_text: str,
    default_category: str = "Bahan Kue",
) -> dict:
    """
    Import banyak nama item baku sekaligus dari teks baris per baris.
    Format per baris yang didukung:
    - `Nama Item`
    - `Nama Item | Kategori`
    - `Nama Item | Kategori | Alias1, Alias2`
    - `Nama Item | Kategori | Alias1, Alias2 | Supplier`
    - `Nama Item | Kategori | Alias1, Alias2 | Supplier | Satuan Beli`
    - `Nama Item | Kategori | Alias1, Alias2 | Supplier | Satuan Beli | Tipe Satuan | Isi Paket | Satuan Ecer`
    """
    lines = [line.strip() for line in (raw_text or "").splitlines() if line.strip()]
    added = 0
    updated = 0

    existing_items = await list_master_items(db)
    existing_map = {m.item_name.strip().lower(): m for m in existing_items}

    for line in lines:
        # Abaikan baris komentar atau bullet di awal
        cleaned_line = re.sub(r"^[\-\*\•\d\.\)\s]+", "", line).strip()
        if not cleaned_line:
            continue

        parts = [p.strip() for p in cleaned_line.split("|")]
        name = parts[0]
        if not name:
            continue

        cat = parts[1] if len(parts) > 1 and parts[1] in settings.valid_categories else default_category
        aliases = parts[2] if len(parts) > 2 else ""
        supplier = parts[3] if len(parts) > 3 else "-"
        satuan_beli = parts[4] if len(parts) > 4 and parts[4] else "Pcs"
        tipe_satuan = parts[5] if len(parts) > 5 and parts[5] in ("paket", "ecer", "keduanya") else "keduanya"
        isi_paket = parts[6] if len(parts) > 6 else ""
        satuan_ecer = parts[7] if len(parts) > 7 and parts[7] else "Pcs"

        key = name.lower()
        if key in existing_map:
            m = existing_map[key]
            if len(parts) > 1 and parts[1] in settings.valid_categories:
                m.category = parts[1]
            if aliases:
                m.aliases = aliases
            if supplier and supplier != "-":
                m.default_supplier = supplier
            if len(parts) > 4 and parts[4]:
                m.satuan_beli = parts[4]
            if len(parts) > 5 and parts[5]:
                m.tipe_satuan = parts[5]
            if len(parts) > 6:
                m.isi_paket = parts[6]
            if len(parts) > 7 and parts[7]:
                m.satuan_ecer = parts[7]
            updated += 1
        else:
            new_m = MasterItem(
                item_name=name,
                category=cat,
                aliases=aliases,
                default_supplier=supplier or "-",
                satuan_beli=satuan_beli,
                tipe_satuan=tipe_satuan,
                isi_paket=isi_paket,
                satuan_ecer=satuan_ecer,
            )
            db.add(new_m)
            existing_map[key] = new_m
            added += 1

    await db.flush()
    return {"added": added, "updated": updated, "total": len(existing_map)}


async def sync_existing_expenses_to_master(db: AsyncSession) -> dict:
    """
    Cocokkan semua transaksi Expense yang sudah ada di DB dengan MasterItem baku.
    Jika ada yang cocok dan namanya belum sama persis, ubah ke nama baku dan
    simpan nama lama di kolom notes.
    """
    master_items = await list_master_items(db)
    if not master_items:
        return {"matched_count": 0, "updated_items": []}

    result = await db.execute(select(Expense).order_by(Expense.id.desc()))
    all_expenses = result.scalars().all()

    updated_items = []
    for exp in all_expenses:
        raw_name = (exp.item_name or "").strip()
        if not raw_name:
            continue

        matched = find_best_master_match(raw_name, master_items)
        if not matched:
            continue

        if raw_name != matched.item_name:
            exp.notes = append_original_name_to_notes(raw_name, matched.item_name, exp.notes)
            exp.item_name = matched.item_name
            if exp.category != "Tukar Cash" and matched.category:
                exp.category = matched.category
            exp.sheets_synced = False
            updated_items.append({
                "id": exp.id,
                "old_name": raw_name,
                "new_name": matched.item_name,
                "category": exp.category,
            })

    await db.flush()
    return {
        "matched_count": len(updated_items),
        "updated_items": updated_items[:50],
    }


async def import_master_items_from_history(db: AsyncSession) -> dict:
    """
    Tarik otomatis daftar nama barang unik dari histori tabel `expenses`
    beserta kategori dan toko/supplier yang paling sering digunakan, lalu
    simpan ke tabel `master_items` bila belum ada.
    """
    existing_items = await list_master_items(db)
    existing_map = {m.item_name.strip().lower(): m for m in existing_items}

    result = await db.execute(
        select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    all_expenses = result.scalars().all()

    grouped: dict[str, dict] = {}
    for e in all_expenses:
        raw_name = (e.item_name or "").strip()
        if not raw_name or raw_name == "-":
            continue
        key = raw_name.lower()
        if key not in grouped:
            grouped[key] = {
                "item_name": raw_name,
                "category": (
                    e.category
                    if e.category in settings.valid_categories
                    else "Bahan Kue"
                ),
                "supplier": (e.supplier or "-").strip() or "-",
                "count": 1,
            }
        else:
            grouped[key]["count"] += 1
            if (
                grouped[key]["supplier"] == "-"
                and e.supplier
                and e.supplier.strip() != "-"
            ):
                grouped[key]["supplier"] = e.supplier.strip()

    added = 0
    for key, info in grouped.items():
        if key in existing_map:
            continue
        # Pastikan tidak duplikat dengan fuzzy match yang sangat dekat
        new_m = MasterItem(
            item_name=info["item_name"],
            category=info["category"],
            default_supplier=info["supplier"],
            aliases="",
        )
        db.add(new_m)
        existing_map[key] = new_m
        added += 1

    await db.flush()
    return {
        "added": added,
        "total": len(existing_map),
    }


async def get_item_and_supplier_suggestions(db: AsyncSession) -> dict:
    """
    Kembalikan daftar saran autocomplete untuk form tambah/edit pengeluaran:
    - `items`: gabungan MasterItem + item unik dari histori Expense beserta harga terakhir,
      kategori, dan supplier terakhir.
    - `suppliers`: daftar nama toko/supplier unik yang paling sering digunakan.
    """
    master_items = await list_master_items(db)

    # Ambil transaksi terbaru untuk mengetahui harga terakhir & supplier terakhir tiap item
    result = await db.execute(
        select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc()).limit(600)
    )
    recent_expenses = result.scalars().all()

    history_by_name: dict[str, dict] = {}
    supplier_counts: dict[str, dict] = {}

    for e in recent_expenses:
        name = (e.item_name or "").strip()
        if name and name != "-":
            key = name.lower()
            if key not in history_by_name:
                history_by_name[key] = {
                    "item_name": name,
                    "category": e.category or "Bahan Kue",
                    "last_unit_price": float(e.unit_price or 0),
                    "last_supplier": e.supplier or "-",
                    "last_date": str(e.expense_date),
                    "tx_count": 1,
                }
            else:
                history_by_name[key]["tx_count"] += 1
                if history_by_name[key]["last_unit_price"] <= 0 and float(e.unit_price or 0) > 0:
                    history_by_name[key]["last_unit_price"] = float(e.unit_price or 0)

        sup = (e.supplier or "").strip()
        if sup and sup != "-":
            skey = sup.lower()
            if skey not in supplier_counts:
                supplier_counts[skey] = {"supplier": sup, "count": 1}
            else:
                supplier_counts[skey]["count"] += 1

    suggestions_map: dict[str, dict] = {}

    # 1. Masukkan semua MasterItem terlebih dahulu (prioritas utama)
    for m in master_items:
        key = m.item_name.strip().lower()
        hist = history_by_name.get(key)
        suggestions_map[key] = {
            "id": m.id,
            "item_name": m.item_name,
            "category": m.category,
            "aliases": m.aliases or "",
            "satuan_beli": m.satuan_beli or "Pcs",
            "tipe_satuan": m.tipe_satuan or "keduanya",
            "isi_paket": m.isi_paket or "",
            "satuan_ecer": m.satuan_ecer or "Pcs",
            "last_unit_price": hist["last_unit_price"] if hist else 0.0,
            "last_supplier": (
                hist["last_supplier"]
                if hist and hist["last_supplier"] != "-"
                else (m.default_supplier or "-")
            ),
            "last_date": hist["last_date"] if hist else None,
            "tx_count": hist["tx_count"] if hist else 0,
            "is_master": True,
        }

    # 2. Tambahkan histori item yang belum ada di MasterItem
    for key, hist in history_by_name.items():
        if key not in suggestions_map:
            suggestions_map[key] = {
                "id": None,
                "item_name": hist["item_name"],
                "category": hist["category"],
                "aliases": "",
                "satuan_beli": "Pcs",
                "tipe_satuan": "ecer",
                "isi_paket": "",
                "satuan_ecer": "Pcs",
                "last_unit_price": hist["last_unit_price"],
                "last_supplier": hist["last_supplier"],
                "last_date": hist["last_date"],
                "tx_count": hist["tx_count"],
                "is_master": False,
            }

    # Urutkan: MasterItem dulu, lalu berdasarkan frekuensi pembelian & abjad
    sorted_items = sorted(
        suggestions_map.values(),
        key=lambda x: (not x["is_master"], -x["tx_count"], x["item_name"].lower()),
    )

    sorted_suppliers = [
        s["supplier"]
        for s in sorted(supplier_counts.values(), key=lambda x: (-x["count"], x["supplier"].lower()))
    ]

    return {
        "items": sorted_items[:250],
        "suppliers": sorted_suppliers[:100],
    }
