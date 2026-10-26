"""
app/services/master_item_service.py — Layanan Katalog Nama Item Baku (Master Item)
& Pencocokan Otomatis (Fuzzy + Alias + Exact Match) untuk konsistensi pembukuan.
"""
import re
from uuid import uuid4
from difflib import SequenceMatcher
from sqlalchemy import select, func, or_
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
        matched = None
        req_mid = item.get("master_item_id")
        if req_mid:
            matched = next((m for m in master_items if m.id == req_mid), None)

        raw_name = (item.get("barang") or item.get("item_name") or "").strip()
        if not matched and raw_name:
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

        item["master_item_id"] = matched.id
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

        changed = False
        if exp.master_item_id != matched.id:
            exp.master_item_id = matched.id
            changed = True

        if raw_name != matched.item_name:
            exp.notes = append_original_name_to_notes(raw_name, matched.item_name, exp.notes)
            exp.item_name = matched.item_name
            exp.sheets_synced = False
            changed = True

        if exp.category != "Tukar Cash" and matched.category and exp.category != matched.category:
            exp.category = matched.category
            exp.sheets_synced = False
            changed = True

        if changed:
            updated_items.append({
                "id": exp.id,
                "old_name": raw_name,
                "new_name": matched.item_name,
                "category": exp.category,
                "master_item_id": matched.id,
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

    history_by_master_id: dict[int, dict] = {}
    history_by_name: dict[str, dict] = {}
    supplier_counts: dict[str, dict] = {}

    for e in recent_expenses:
        name = (e.item_name or "").strip()
        sup = (e.supplier or "").strip()
        price = float(e.unit_price or 0)
        dt_str = str(e.expense_date)

        # 1. Catat histori berdasarkan master_item_id (produk id)
        if e.master_item_id:
            mid = e.master_item_id
            if mid not in history_by_master_id:
                history_by_master_id[mid] = {
                    "item_name": name,
                    "category": e.category or "Bahan Kue",
                    "last_unit_price": price,
                    "last_supplier": sup or "-",
                    "last_date": dt_str,
                    "tx_count": 1,
                }
            else:
                history_by_master_id[mid]["tx_count"] += 1
                if history_by_master_id[mid]["last_unit_price"] <= 0 and price > 0:
                    history_by_master_id[mid]["last_unit_price"] = price

        # 2. Catat histori berdasarkan nama item
        if name and name != "-":
            key = name.lower()
            if key not in history_by_name:
                history_by_name[key] = {
                    "item_name": name,
                    "category": e.category or "Bahan Kue",
                    "last_unit_price": price,
                    "last_supplier": sup or "-",
                    "last_date": dt_str,
                    "tx_count": 1,
                }
            else:
                history_by_name[key]["tx_count"] += 1
                if history_by_name[key]["last_unit_price"] <= 0 and price > 0:
                    history_by_name[key]["last_unit_price"] = price

        if sup and sup != "-":
            skey = sup.lower()
            if skey not in supplier_counts:
                supplier_counts[skey] = {"supplier": sup, "count": 1}
            else:
                supplier_counts[skey]["count"] += 1

    suggestions_map: dict[str, dict] = {}

    # 1. Masukkan semua MasterItem terlebih dahulu (prioritas utama, dicocokkan via ID lalu nama)
    for m in master_items:
        key = m.item_name.strip().lower()
        hist = history_by_master_id.get(m.id) or history_by_name.get(key)
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


async def audit_duplicate_master_items(
    db: AsyncSession,
    min_score: float = 0.70,
    limit: int = 150,
) -> dict:
    """
    Audit seluruh katalog master items untuk mendeteksi potensi duplikat.
    Mendeteksi variasi input seperti perbedaan awalan/akhiran hasil scan AI
    (mis. 'Kabel listrik NYM Dynamic 2 x 1.5' vs 'Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga').
    """
    master_items = await list_master_items(db)
    if len(master_items) < 2:
        return {"ok": True, "total_duplicates": 0, "pairs": []}

    suggestions = await get_item_and_supplier_suggestions(db)
    hist_by_id = {
        s["id"]: s
        for s in suggestions.get("items", [])
        if s.get("id") is not None
    }
    hist_by_name = {
        s["item_name"].strip().lower(): s
        for s in suggestions.get("items", [])
    }

    def _get_item_stats(m: MasterItem) -> dict:
        h = hist_by_id.get(m.id) or hist_by_name.get(m.item_name.strip().lower(), {})
        return {
            "id": m.id,
            "item_name": m.item_name,
            "category": m.category,
            "default_supplier": m.default_supplier or "-",
            "aliases": m.aliases or "",
            "satuan_beli": m.satuan_beli or "Pcs",
            "tipe_satuan": m.tipe_satuan or "keduanya",
            "isi_paket": m.isi_paket or "",
            "satuan_ecer": m.satuan_ecer or "Pcs",
            "last_unit_price": float(h.get("last_unit_price") or 0.0),
            "last_supplier": h.get("last_supplier") or m.default_supplier or "-",
            "tx_count": int(h.get("tx_count") or 0),
            "created_at": m.created_at,
        }

    # Pre-calculate stats and normalized attributes
    items_data = []
    for m in master_items:
        stats = _get_item_stats(m)
        norm_name = _normalize_str(m.item_name)
        tokens = set(norm_name.split())
        nums = set(re.findall(r"\b\d+(?:[\.,]\d+)?\b", norm_name))
        aliases_list = [_normalize_str(a) for a in _parse_aliases(m.aliases)]
        items_data.append({
            "model": m,
            "stats": stats,
            "norm_name": norm_name,
            "tokens": tokens,
            "nums": nums,
            "aliases": aliases_list,
        })

    pairs = []
    n = len(items_data)

    for i in range(n):
        data_a = items_data[i]
        norm_a = data_a["norm_name"]
        if not norm_a:
            continue

        for j in range(i + 1, n):
            data_b = items_data[j]
            norm_b = data_b["norm_name"]
            if not norm_b:
                continue

            nums_a = data_a["nums"]
            nums_b = data_b["nums"]
            # Cek jika ada perbedaan angka/dimensi spesifik yang bertentangan (mis. 2 vs 3, 20 vs 25)
            has_num_conflict = bool(nums_a and nums_b and (nums_a - nums_b) and (nums_b - nums_a))

            # Cek kecocokan alias
            has_alias_match = (
                norm_a in data_b["aliases"]
                or norm_b in data_a["aliases"]
                or bool(set(data_a["aliases"]) & set(data_b["aliases"]) - {""})
            )

            similarity = 0.0
            match_type = ""
            reason = ""

            if has_alias_match:
                similarity = 0.98
                match_type = "alias"
                reason = "Kata kunci alias struk saling terhubung"
            elif has_num_conflict:
                # Angka/dimensi berbeda (misal 2x1.5 vs 3x1.5), jangan deteksi sebagai duplikat
                continue
            else:
                tokens_a = data_a["tokens"]
                tokens_b = data_b["tokens"]
                is_sub_a_in_b = norm_a in norm_b
                is_sub_b_in_a = norm_b in norm_a

                if is_sub_a_in_b or is_sub_b_in_a:
                    shorter = norm_a if is_sub_a_in_b else norm_b
                    longer = norm_b if is_sub_a_in_b else norm_a
                    shorter_name = data_a["stats"]["item_name"] if is_sub_a_in_b else data_b["stats"]["item_name"]
                    longer_name = data_b["stats"]["item_name"] if is_sub_a_in_b else data_a["stats"]["item_name"]

                    if len(shorter.split()) >= 2 or len(shorter) >= 6:
                        len_ratio = len(shorter) / max(len(longer), 1)
                        similarity = round(0.85 + (0.14 * len_ratio), 2)
                        match_type = "substring"
                        if longer.startswith(shorter):
                            reason = f"Nama '{shorter_name}' terkandung di awalan '{longer_name}'"
                        elif longer.endswith(shorter):
                            reason = f"Nama '{shorter_name}' terkandung di akhiran '{longer_name}'"
                        else:
                            reason = f"Nama '{shorter_name}' terkandung utuh di dalam '{longer_name}'"
                elif tokens_a.issubset(tokens_b) or tokens_b.issubset(tokens_a):
                    shorter_tokens = tokens_a if len(tokens_a) <= len(tokens_b) else tokens_b
                    longer_tokens = tokens_b if len(tokens_a) <= len(tokens_b) else tokens_a
                    if len(shorter_tokens) >= 2:
                        tok_ratio = len(shorter_tokens) / max(len(longer_tokens), 1)
                        similarity = round(0.82 + (0.16 * tok_ratio), 2)
                        match_type = "prefix_suffix"
                        shorter_name = data_a["stats"]["item_name"] if len(tokens_a) <= len(tokens_b) else data_b["stats"]["item_name"]
                        longer_name = data_b["stats"]["item_name"] if len(tokens_a) <= len(tokens_b) else data_a["stats"]["item_name"]
                        reason = f"Semua kata '{shorter_name}' termuat di '{longer_name}'"
                else:
                    seq_ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
                    union_len = len(tokens_a | tokens_b)
                    jaccard = len(tokens_a & tokens_b) / union_len if union_len > 0 else 0.0
                    combined = (seq_ratio * 0.6) + (jaccard * 0.4)
                    if combined >= 0.76:
                        similarity = round(combined, 2)
                        match_type = "fuzzy"
                        reason = f"Kemiripan teks {int(similarity * 100)}%"

            if match_type and similarity >= min_score:
                tx_a = data_a["stats"]["tx_count"]
                tx_b = data_b["stats"]["tx_count"]
                if tx_a > tx_b:
                    suggested_primary = data_a["stats"]["id"]
                elif tx_b > tx_a:
                    suggested_primary = data_b["stats"]["id"]
                else:
                    if len(data_a["stats"]["item_name"]) <= len(data_b["stats"]["item_name"]):
                        suggested_primary = data_a["stats"]["id"]
                    else:
                        suggested_primary = data_b["stats"]["id"]

                pairs.append({
                    "item_a": data_a["stats"],
                    "item_b": data_b["stats"],
                    "similarity_score": similarity,
                    "match_type": match_type,
                    "reason": reason,
                    "suggested_primary_id": suggested_primary,
                })

    # Urutkan berdasarkan similarity_score tertinggi
    pairs.sort(key=lambda x: -x["similarity_score"])

    return {
        "ok": True,
        "total_duplicates": len(pairs),
        "pairs": pairs[:limit],
    }


async def merge_master_items(
    db: AsyncSession,
    target_item_id: int,
    source_item_ids: list[int],
    custom_name: str | None = None,
    custom_category: str | None = None,
    custom_supplier: str | None = None,
    custom_satuan_beli: str | None = None,
    custom_tipe_satuan: str | None = None,
    custom_isi_paket: str | None = None,
    custom_satuan_ecer: str | None = None,
    merge_aliases: bool = True,
    update_expenses: bool = True,
) -> dict:
    """
    Gabungkan satu atau lebih MasterItem duplikat ke dalam satu target MasterItem utama:
    1. Menggabungkan nama dan alias lama ke dalam `aliases` target item.
    2. Mengalihkan semua transaksi Expense (berdasarkan master_item_id dan nama lama) ke target item.
    3. Menyimpan nama struk lama di kolom notes jika namanya diubah.
    4. Menghapus MasterItem sumber yang sudah dilebur tanpa memicu konflik unique constraint.
    """
    target = await db.scalar(select(MasterItem).where(MasterItem.id == target_item_id))
    if not target:
        raise ValueError("Item baku tujuan (target) tidak ditemukan.")

    clean_source_ids = [sid for sid in set(source_item_ids) if sid != target_item_id]
    if not clean_source_ids:
        raise ValueError("Pilih minimal satu item duplikat untuk digabungkan.")

    sources_res = await db.execute(
        select(MasterItem).where(MasterItem.id.in_(clean_source_ids))
    )
    sources = list(sources_res.scalars().all())
    if not sources:
        raise ValueError("Item duplikat tidak ditemukan di database.")

    # 1. Tentukan nama akhir target
    final_name = custom_name.strip() if custom_name and custom_name.strip() else target.item_name

    # 2. Cek apakah final_name sudah digunakan oleh item KETIGA (di luar target dan sources)
    conflict_check = await db.execute(
        select(MasterItem).where(
            func.lower(MasterItem.item_name) == final_name.lower(),
            MasterItem.id != target.id,
            MasterItem.id.not_in(clean_source_ids),
        )
    )
    conflict_item = conflict_check.scalar_one_or_none()
    if conflict_item:
        raise ValueError(
            f"Nama item baku '{final_name}' sudah digunakan oleh item lain (ID: {conflict_item.id}). "
            "Silakan pilih nama lain atau sertakan item tersebut untuk digabungkan."
        )

    # 3. Kumpulkan data sources sebelum diubah/dihapus
    source_names = [s.item_name for s in sources]
    source_aliases_lists = [(s.aliases or "").split(",") for s in sources]

    # Kumpulkan field default yang bisa diadopsi target jika target kosong
    adopted_supplier = custom_supplier.strip() if custom_supplier is not None else None
    if adopted_supplier is None and (target.default_supplier in (None, "", "-")):
        for s in sources:
            if s.default_supplier and s.default_supplier != "-":
                adopted_supplier = s.default_supplier
                break

    adopted_satuan_beli = custom_satuan_beli.strip() if custom_satuan_beli is not None else None
    if adopted_satuan_beli is None and (not target.satuan_beli or target.satuan_beli == "Pcs"):
        for s in sources:
            if s.satuan_beli and s.satuan_beli != "Pcs":
                adopted_satuan_beli = s.satuan_beli
                break

    adopted_tipe_satuan = custom_tipe_satuan.strip() if custom_tipe_satuan is not None else None

    adopted_isi_paket = custom_isi_paket.strip() if custom_isi_paket is not None else None
    if adopted_isi_paket is None and not target.isi_paket:
        for s in sources:
            if s.isi_paket:
                adopted_isi_paket = s.isi_paket
                break

    adopted_satuan_ecer = custom_satuan_ecer.strip() if custom_satuan_ecer is not None else None
    if adopted_satuan_ecer is None and (not target.satuan_ecer or target.satuan_ecer == "Pcs"):
        for s in sources:
            if s.satuan_ecer and s.satuan_ecer != "Pcs":
                adopted_satuan_ecer = s.satuan_ecer
                break

    # 4. Hitung alias gabungan
    aliases_added: list[str] = []
    final_aliases_str = target.aliases or ""
    if merge_aliases:
        existing_aliases = [a.strip() for a in (target.aliases or "").split(",") if a.strip()]
        # Tambahkan nama lama target jika target ganti nama
        if target.item_name.lower() != final_name.lower():
            existing_aliases.append(target.item_name)

        existing_lower = {a.lower() for a in existing_aliases}

        candidates = []
        for s_name in source_names:
            candidates.append(s_name)
        for s_aliases in source_aliases_lists:
            for a in s_aliases:
                ca = a.strip()
                if ca:
                    candidates.append(ca)

        for cand in candidates:
            cl = cand.lower()
            if cl != final_name.lower() and cl not in existing_lower:
                existing_aliases.append(cand)
                existing_lower.add(cl)
                aliases_added.append(cand)

        # Pastikan final_name sendiri tidak ada di aliases
        existing_aliases = [a for a in existing_aliases if a.lower() != final_name.lower()]
        final_aliases_str = ", ".join(existing_aliases)

    # 5. Alihkan semua transaksi Expense (lakukan sebelum mengubah target agar autoflush tidak memicu bentrok nama)
    lower_source_names = [n.lower() for n in source_names]
    exp_query = select(Expense).where(
        or_(
            Expense.master_item_id.in_(clean_source_ids),
            func.lower(Expense.item_name).in_(lower_source_names),
        )
    )
    exp_res = await db.execute(exp_query)
    expenses = exp_res.scalars().all()

    target_category = (
        custom_category.strip()
        if custom_category and custom_category.strip() in settings.valid_categories
        else target.category
    )

    reassigned_count = 0
    for exp in expenses:
        orig_name = exp.item_name
        exp.master_item_id = target.id
        if update_expenses:
            exp.notes = append_original_name_to_notes(orig_name, final_name, exp.notes)
            exp.item_name = final_name
            if target_category and exp.category != "Tukar Cash":
                exp.category = target_category
        exp.sheets_synced = False
        reassigned_count += 1

    # 6. PENTING: Untuk menghindari pelanggaran unique constraint `ix_master_items_item_name` di Postgres
    # ketika `final_name` sama persis dengan salah satu nama item sumber:
    # Rename sources ke unique dummy name lalu hapus dan flush terlebih dahulu!
    for s in sources:
        s.item_name = f"__merged_{s.id}_{uuid4().hex[:8]}"
        await db.delete(s)

    await db.flush()

    # 7. Sekarang aman memperbarui nama & data target tanpa bentrok unique constraint
    target.item_name = final_name
    if target_category:
        target.category = target_category
    if adopted_supplier is not None:
        target.default_supplier = adopted_supplier or "-"
    if adopted_satuan_beli is not None:
        target.satuan_beli = adopted_satuan_beli or "Pcs"
    if adopted_tipe_satuan is not None:
        target.tipe_satuan = adopted_tipe_satuan or "keduanya"
    if adopted_isi_paket is not None:
        target.isi_paket = adopted_isi_paket
    if adopted_satuan_ecer is not None:
        target.satuan_ecer = adopted_satuan_ecer or "Pcs"
    if merge_aliases:
        target.aliases = final_aliases_str

    await db.flush()

    # Ambil ulang stats target
    suggestions = await get_item_and_supplier_suggestions(db)
    hist_by_id = {
        s["id"]: s
        for s in suggestions.get("items", [])
        if s.get("id") is not None
    }
    h = hist_by_id.get(target.id) or {}

    target_resp = {
        "id": target.id,
        "item_name": target.item_name,
        "category": target.category,
        "default_supplier": target.default_supplier or "-",
        "aliases": target.aliases or "",
        "satuan_beli": target.satuan_beli or "Pcs",
        "tipe_satuan": target.tipe_satuan or "keduanya",
        "isi_paket": target.isi_paket or "",
        "satuan_ecer": target.satuan_ecer or "Pcs",
        "last_unit_price": float(h.get("last_unit_price") or 0.0),
        "last_supplier": h.get("last_supplier") or target.default_supplier or "-",
        "tx_count": int(h.get("tx_count") or 0),
        "created_at": target.created_at,
    }

    return {
        "ok": True,
        "message": f"Berhasil menggabungkan {len(sources)} item ke '{target.item_name}'. {reassigned_count} transaksi dialihkan.",
        "target_item": target_resp,
        "merged_sources": source_names,
        "expenses_reassigned_count": reassigned_count,
        "aliases_added": aliases_added,
    }
