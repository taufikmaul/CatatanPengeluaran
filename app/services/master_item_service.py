"""
app/services/master_item_service.py — Layanan Katalog Nama Item Baku (Master Item)
& Pencocokan Otomatis (Fuzzy + Alias + Exact Match) untuk konsistensi pembukuan.
"""
import asyncio
import re
from typing import Any
from uuid import uuid4
from difflib import SequenceMatcher
from sqlalchemy import select, func, or_, and_, delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.master_item import MasterItem, MasterItemPackaging
from app.models.expense import Expense
from app.models.expense_log import ExpenseLog
from app.models.menu_product import MenuIngredient
from app.models.purchase_request import PurchaseRequestItem
from app.models.supplier import Supplier
from app.config import settings
from app.services.master_data_service import (
    get_valid_units,
    normalize_unit_to_master,
    get_active_names,
    normalize_payment_method_name,
)


def _normalize_str(s: str) -> str:
    """Bersihkan karakter non-alfanumerik berlebih, pisahkan angka & satuan, dan kecilkan huruf."""
    s = (s or "").strip().lower()
    s = re.sub(r"(\d+)([a-z]+)", r"\1 \2", s)
    s = re.sub(r"([a-z]+)(\d+)", r"\1 \2", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_RECIPE_UNIT_CANON: dict[str, str] = {
    "g": "Gram",
    "gr": "Gram",
    "gram": "Gram",
    "grams": "Gram",
    "kg": "Kg",
    "kilogram": "Kg",
    "kilo": "Kg",
    "ons": "Ons",
    "oz": "Ons",
    "ml": "ml",
    "mililiter": "ml",
    "cc": "ml",
    "l": "Liter",
    "lt": "Liter",
    "ltr": "Liter",
    "liter": "Liter",
    "liters": "Liter",
    "cm": "cm",
    "m": "Meter",
    "meter": "Meter",
    "mtr": "Meter",
    "pcs": "Pcs",
    "pc": "Pcs",
    "buah": "Pcs",
    "biji": "Pcs",
    "butir": "Butir",
    "btr": "Butir",
    "lembar": "Lembar",
    "lbr": "Lembar",
    "pack": "Pack",
    "pak": "Pack",
    "pouch": "Pouch",
    "sachet": "Sachet",
    "box": "Box",
    "bungkus": "Bungkus",
    "bks": "Bungkus",
    "botol": "Botol",
    "btl": "Botol",
    "kaleng": "Kaleng",
    "klg": "Kaleng",
    "roll": "Roll",
    "lusin": "Lusin",
    "lsn": "Lusin",
    "kodi": "Kodi",
    "gross": "Gross",
    "tray": "Tray",
    "ikat": "Ikat",
    "sak": "Sak",
    "bal": "Bal",
    "dus": "Dus",
    "karton": "Dus",
    "ctn": "Dus",
}

_DIRECT_RECIPE_MAP: dict[str, tuple[str, float]] = {
    "Kg": ("Gram", 1000.0),
    "Ons": ("Gram", 100.0),
    "Gram": ("Gram", 1.0),
    "Liter": ("ml", 1000.0),
    "ml": ("ml", 1.0),
    "Meter": ("cm", 100.0),
    "cm": ("cm", 1.0),
    "Lusin": ("Pcs", 12.0),
    "Kodi": ("Pcs", 20.0),
    "Gross": ("Pcs", 144.0),
    "Tray": ("Butir", 30.0),
    "Butir": ("Butir", 1.0),
    "Pcs": ("Pcs", 1.0),
    "Lembar": ("Lembar", 1.0),
}

_CONTAINER_UNITS = {
    "Bungkus",
    "Pack",
    "Pouch",
    "Box",
    "Botol",
    "Kaleng",
    "Dus",
    "Sak",
    "Bal",
    "Roll",
    "Sachet",
}


def normalize_recipe_unit(raw: str | None) -> str | None:
    """Normalkan satuan resep agar konsisten (mis. 'gr' -> 'Gram', 'cc' -> 'ml')."""
    if not raw or not raw.strip():
        return None
    cleaned = raw.strip()
    key = re.sub(r"[^a-z]", "", cleaned.lower())
    return _RECIPE_UNIT_CANON.get(key, cleaned)


def _convert_qty_to_smallest_unit(
    qty: float,
    raw_unit: str | None,
) -> tuple[str | None, float | None]:
    norm = normalize_recipe_unit(raw_unit)
    if not norm or qty <= 0:
        return None, None
    mapped = _DIRECT_RECIPE_MAP.get(norm)
    if mapped:
        target_unit, mult = mapped
        return target_unit, round(qty * mult, 4)
    return None, None


def infer_recipe_unit_conversion(
    satuan_beli: str | None,
    satuan_ecer: str | None = None,
    isi_paket: str | None = None,
    item_name: str | None = None,
) -> tuple[str | None, float | None]:
    """
    Turunkan satuan resep terkecil dan faktor konversi dari satuan beli / isi paket MasterItem.
    Contoh: Kg -> ('Gram', 1000.0); Box + '6 pouch @ 2kg' -> ('Gram', 12000.0).
    """
    _ = satuan_ecer

    if isi_paket and isi_paket.strip():
        for seg in re.split(r"[,;]", isi_paket):
            s = seg.strip()
            if not s:
                continue

            m_mult = re.search(
                r"(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s*(?:x|@)\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)",
                s,
                re.IGNORECASE,
            )
            if m_mult:
                outer_qty = float(m_mult.group(1).replace(",", "."))
                inner_qty = float(m_mult.group(3).replace(",", "."))
                inner_unit, inner_factor = _convert_qty_to_smallest_unit(
                    inner_qty, m_mult.group(4)
                )
                if inner_unit and inner_factor is not None and outer_qty > 0:
                    return inner_unit, round(outer_qty * inner_factor, 4)

            m_single = re.search(r"(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)", s)
            if m_single:
                qty_val = float(m_single.group(1).replace(",", "."))
                res_unit, res_factor = _convert_qty_to_smallest_unit(
                    qty_val, m_single.group(2)
                )
                if res_unit and res_factor is not None:
                    return res_unit, res_factor

    norm_beli = normalize_recipe_unit(satuan_beli)
    if norm_beli and norm_beli in _DIRECT_RECIPE_MAP:
        return _DIRECT_RECIPE_MAP[norm_beli]

    if (not norm_beli or norm_beli in _CONTAINER_UNITS) and item_name:
        m_name = re.search(
            r"(?<![0-9x×*])\b(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilo|ons|oz|gram|grams|gr|g|liter|liters|ltr|lt|l|ml|cc)\b(?!\s*[x×*])",
            item_name,
            re.IGNORECASE,
        )
        if m_name:
            qty_val = float(m_name.group(1).replace(",", "."))
            res_unit, res_factor = _convert_qty_to_smallest_unit(
                qty_val, m_name.group(2)
            )
            if res_unit and res_factor is not None:
                return res_unit, res_factor

    return None, None


_METRIC_CONVERSIONS: dict[tuple[str, str], float] = {
    ("Kg", "Gram"): 1000.0,
    ("Ons", "Gram"): 100.0,
    ("Liter", "ml"): 1000.0,
    ("Meter", "cm"): 100.0,
    ("Lusin", "Pcs"): 12.0,
    ("Kodi", "Pcs"): 20.0,
    ("Gross", "Pcs"): 144.0,
    ("Tray", "Butir"): 30.0,
}


def _units_match(a: str | None, b: str | None) -> bool:
    """Bandingkan dua satuan secara kanonik (case-insensitive & alias-aware)."""
    ca = normalize_recipe_unit(a) or (a or "").strip()
    cb = normalize_recipe_unit(b) or (b or "").strip()
    if not ca or not cb:
        return False
    return ca.lower() == cb.lower()


def _convert_direct_qty_to_base(
    qty: float,
    unit: str | None,
    target_base_unit: str | None = None,
) -> tuple[float | None, str | None]:
    """Konversi kuantitas satuan standar/metrik langsung ke base_unit (jika kompatibel)."""
    if qty <= 0 or not unit:
        return None, None
    norm_u = normalize_recipe_unit(unit)
    norm_target = normalize_recipe_unit(target_base_unit) if target_base_unit else None
    if not norm_u:
        return None, None

    if norm_target:
        if norm_u == norm_target:
            return round(qty, 4), norm_target
        mult = _METRIC_CONVERSIONS.get((norm_u, norm_target))
        if mult is not None:
            return round(qty * mult, 4), norm_target
        inv = _METRIC_CONVERSIONS.get((norm_target, norm_u))
        if inv is not None and inv > 0:
            return round(qty / inv, 4), norm_target
        return None, None

    mapped = _DIRECT_RECIPE_MAP.get(norm_u)
    if mapped:
        target_u, mult = mapped
        return round(qty * mult, 4), target_u
    return None, None


def _score_packaging_keywords(pkg: MasterItemPackaging, raw_text: str) -> int:
    """Hitung kecocokan keyword/label/ukuran kemasan pada teks struk."""
    if not raw_text:
        return 0
    text_l = raw_text.lower()
    text_compact = re.sub(r"[^a-z0-9]", "", text_l)
    score = 0

    # Bonus jika satuan beli (atau sinonimnya) muncul langsung di teks struk
    p_unit_l = (pkg.purchase_unit or "").strip().lower()
    p_unit_aliases: dict[str, tuple[str, ...]] = {
        "dus": ("dus", "karton", "ctn"),
        "kaleng": ("kaleng", "klg", "can"),
        "bungkus": ("bungkus", "bks"),
        "botol": ("botol", "btl"),
        "pouch": ("pouch",),
        "box": ("box", "kotak"),
        "pack": ("pack", "pak"),
        "sak": ("sak", "karung"),
    }
    for alias in p_unit_aliases.get(p_unit_l, (p_unit_l,)):
        if alias and re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", text_l):
            score += 3
            break

    tokens: list[str] = []
    if pkg.keywords:
        tokens.extend(k.strip() for k in re.split(r"[,;|]", pkg.keywords) if k.strip())
    if pkg.retail_unit and pkg.retail_unit.lower() != p_unit_l:
        tokens.append(pkg.retail_unit.strip())
    for m in re.finditer(
        r"\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|gram|gr|g|liter|lt|l|ml|pcs)",
        pkg.label or "",
        re.IGNORECASE,
    ):
        tokens.append(m.group(0).strip())

    seen: set[str] = set()
    for tok in tokens:
        t_l = tok.lower()
        t_comp = re.sub(r"[^a-z0-9]", "", t_l)
        if not t_comp or t_comp in seen:
            continue
        seen.add(t_comp)
        if re.search(r"(?<![a-z0-9])" + re.escape(t_l) + r"(?![a-z0-9])", text_l):
            score += 2
        elif len(t_comp) >= 3 and t_comp in text_compact:
            score += 1
    return score


async def get_packaging_latest_prices(
    db: AsyncSession,
    master_item_ids: set[int] | None = None,
) -> dict[int, float]:
    """Ambil unit_price terbaru yang CONFIRMED untuk setiap packaging_id."""
    stmt = (
        select(Expense.packaging_id, Expense.unit_price, Expense.total_price, Expense.qty)
        .where(
            Expense.packaging_id.isnot(None),
            or_(Expense.review_status.is_(None), Expense.review_status != "DRAFT_WARNING"),
        )
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    if master_item_ids:
        stmt = stmt.where(Expense.master_item_id.in_(master_item_ids))
    rows = (await db.execute(stmt)).all()
    prices: dict[int, float] = {}
    for row in rows:
        pid = int(row.packaging_id)
        if pid in prices:
            continue
        eff = resolve_effective_unit_price(row.unit_price, row.total_price, row.qty)
        if eff > 0:
            prices[pid] = eff
    return prices


async def sync_master_item_packagings(
    db: AsyncSession,
    master_item: MasterItem,
    packagings_data: list[dict[str, Any]] | None,
) -> None:
    """Sinkronkan daftar MasterItemPackaging dan selaraskan field legacy MasterItem."""
    if packagings_data is None:
        return

    cleaned_rows: list[MasterItemPackaging] = []
    has_default = False
    for raw in packagings_data:
        if not isinstance(raw, dict):
            continue
        p_unit_raw = str(raw.get("purchase_unit") or "").strip()
        r_unit_raw = str(raw.get("retail_unit") or p_unit_raw).strip()
        b_unit_raw = str(raw.get("base_unit") or "").strip()
        r_qty = float(raw.get("retail_qty") or 1.0)
        b_qty = float(raw.get("base_qty") or 0.0)
        if not p_unit_raw or not b_unit_raw or b_qty <= 0 or r_qty <= 0:
            continue

        norm_p = (await normalize_unit_to_master(db, p_unit_raw)) or p_unit_raw
        norm_r = (await normalize_unit_to_master(db, r_unit_raw)) or r_unit_raw
        norm_b = normalize_recipe_unit(b_unit_raw) or b_unit_raw
        label = str(raw.get("label") or "").strip() or f"{norm_p} ({r_qty:g} {norm_r} = {b_qty:g} {norm_b})"
        is_def = bool(raw.get("is_default", False)) and not has_default
        if is_def:
            has_default = True
        cleaned_rows.append(
            MasterItemPackaging(
                master_item_id=master_item.id,
                label=label[:120],
                purchase_unit=norm_p[:50],
                retail_qty=round(r_qty, 4),
                retail_unit=norm_r[:50],
                base_qty=round(b_qty, 4),
                base_unit=norm_b[:50],
                keywords=str(raw.get("keywords") or "").strip(),
                is_default=is_def,
                is_active=bool(raw.get("is_active", True)),
            )
        )

    if cleaned_rows and not has_default:
        active_first = next((r for r in cleaned_rows if r.is_active), cleaned_rows[0])
        active_first.is_default = True

    await db.execute(
        delete(MasterItemPackaging).where(MasterItemPackaging.master_item_id == master_item.id)
    )
    await db.flush()
    if cleaned_rows:
        db.add_all(cleaned_rows)
        await db.flush()
    await db.refresh(master_item, ["packagings"])

    if cleaned_rows:
        default_pkg = next((r for r in cleaned_rows if r.is_default and r.is_active), None) or cleaned_rows[0]
        _apply_default_packaging_to_legacy_fields(master_item, default_pkg, len(cleaned_rows))


def _apply_default_packaging_to_legacy_fields(
    master_item: MasterItem,
    default_pkg: MasterItemPackaging,
    packaging_count: int,
) -> None:
    """Selaraskan field legacy MasterItem dengan varian kemasan default."""
    master_item.satuan_beli = default_pkg.purchase_unit
    master_item.satuan_ecer = default_pkg.retail_unit
    master_item.satuan_resep = default_pkg.base_unit
    master_item.konversi_resep = round(float(default_pkg.base_qty), 6)
    if packaging_count > 1 or float(default_pkg.retail_qty) > 1:
        master_item.tipe_satuan = "keduanya"


def _packaging_dedupe_key(p: MasterItemPackaging) -> tuple[str, float, str, float]:
    return (
        (normalize_recipe_unit(p.purchase_unit) or p.purchase_unit or "").strip().lower(),
        round(float(p.retail_qty), 4),
        (normalize_recipe_unit(p.retail_unit) or p.retail_unit or "").strip().lower(),
        round(float(p.base_qty), 4),
    )


def _merge_keyword_strings(*parts: str | None) -> str:
    """Gabungkan daftar keyword dipisah koma tanpa duplikat (case-insensitive)."""
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        for token in (part or "").split(","):
            t = token.strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    return ", ".join(out)


async def _materialize_legacy_packaging(db: AsyncSession, items: list[MasterItem]) -> None:
    """Item lama tanpa baris varian tetapi punya konversi resep dibuatkan 1 varian default."""
    for item in items:
        if item.packagings:
            continue
        b_unit = (item.satuan_resep or "").strip()
        b_qty = float(item.konversi_resep or 0.0)
        if not b_unit or b_qty <= 0:
            continue
        p_unit = (item.satuan_beli or "Pcs").strip() or "Pcs"
        r_unit = (item.satuan_ecer or p_unit).strip() or p_unit
        isi = (item.isi_paket or "").strip()
        label = f"{p_unit} ({isi})" if isi else f"{p_unit} ({b_qty:g} {b_unit})"
        pkg = MasterItemPackaging(
            master_item_id=item.id,
            label=label[:120],
            purchase_unit=p_unit[:50],
            retail_qty=1.0,
            retail_unit=r_unit[:50],
            base_qty=round(b_qty, 4),
            base_unit=(normalize_recipe_unit(b_unit) or b_unit)[:50],
            keywords=isi,
            is_default=True,
            is_active=True,
        )
        db.add(pkg)
        await db.flush()
        await db.refresh(item, ["packagings"])


def _resolve_merge_base_unit(target: MasterItem, sources: list[MasterItem]) -> str | None:
    default_pkg = next((p for p in target.packagings if p.is_default), None) or (
        target.packagings[0] if target.packagings else None
    )
    if default_pkg and default_pkg.base_unit:
        return normalize_recipe_unit(default_pkg.base_unit) or default_pkg.base_unit
    if target.satuan_resep:
        return normalize_recipe_unit(target.satuan_resep) or target.satuan_resep
    for s in sources:
        for p in s.packagings:
            if p.base_unit:
                return normalize_recipe_unit(p.base_unit) or p.base_unit
    return None


def _assert_packaging_units_compatible(
    target: MasterItem,
    sources: list[MasterItem],
    base_unit: str | None,
) -> None:
    """Tolak merge bila satuan resep sebuah varian tidak sekeluarga dengan satuan resep item utama."""
    if not base_unit:
        return
    for item in [target, *sources]:
        for p in item.packagings:
            converted, _ = _convert_direct_qty_to_base(1.0, p.base_unit, base_unit)
            if converted is None:
                raise ValueError(
                    f"Satuan resep '{p.base_unit}' pada '{item.item_name}' tidak kompatibel dengan "
                    f"'{base_unit}' milik item utama. Samakan satuan resep kedua item sebelum digabungkan."
                )


async def _merge_packagings(
    db: AsyncSession,
    target: MasterItem,
    sources: list[MasterItem],
    base_unit: str | None,
) -> dict[str, int]:
    """
    Pindahkan varian kemasan item sumber ke item target.
    - Varian identik dengan milik target tidak dipindah; transaksi dialihkan ke varian target.
    - Varian unik dipindah lewat relasi ORM sehingga `id` tetap dan Expense.packaging_id tetap valid.
    """
    moved = 0
    deduped = 0
    existing: dict[tuple[str, float, str, float], MasterItemPackaging] = {
        _packaging_dedupe_key(p): p for p in target.packagings
    }

    for src in sources:
        seed = _merge_keyword_strings(src.item_name, src.aliases)
        for pkg in list(src.packagings):
            if base_unit and (normalize_recipe_unit(pkg.base_unit) or pkg.base_unit) != base_unit:
                converted, _ = _convert_direct_qty_to_base(float(pkg.base_qty), pkg.base_unit, base_unit)
                if converted is not None:
                    pkg.base_qty = converted
                    pkg.base_unit = base_unit

            key = _packaging_dedupe_key(pkg)
            kept = existing.get(key)
            if kept is not None:
                await db.execute(
                    update(Expense).where(Expense.packaging_id == pkg.id).values(packaging_id=kept.id)
                )
                kept.keywords = _merge_keyword_strings(kept.keywords, pkg.keywords, seed)
                deduped += 1
                continue

            pkg.is_default = False
            pkg.keywords = _merge_keyword_strings(pkg.keywords, seed)
            pkg.master_item = target
            existing[key] = pkg
            moved += 1

    await db.flush()

    if target.packagings:
        defaults = [p for p in target.packagings if p.is_default and p.is_active]
        if not defaults:
            first_active = next((p for p in target.packagings if p.is_active), target.packagings[0])
            first_active.is_default = True
        elif len(defaults) > 1:
            for extra in defaults[1:]:
                extra.is_default = False
        default_pkg = next((p for p in target.packagings if p.is_default), target.packagings[0])
        _apply_default_packaging_to_legacy_fields(target, default_pkg, len(target.packagings))
        await db.flush()

    return {"packagings_moved": moved, "packagings_deduped": deduped}


def _pick_closest_by_price(
    candidates: list[MasterItemPackaging],
    unit_price: float,
    pkg_last_prices: dict[int, float] | None,
) -> MasterItemPackaging:
    """Pilih kandidat terbaik berdasarkan kedekatan harga historis atau default."""
    if unit_price > 0 and pkg_last_prices:
        scored: list[tuple[float, MasterItemPackaging]] = []
        for c in candidates:
            hp = pkg_last_prices.get(c.id, 0.0)
            if hp > 0:
                ratio = max(unit_price / hp, hp / unit_price)
                scored.append((ratio, c))
        if scored:
            scored.sort(key=lambda x: x[0])
            return scored[0][1]
    return next((c for c in candidates if c.is_default), candidates[0])


def _is_price_anomalous(
    unit_price: float,
    pkg: MasterItemPackaging,
    pkg_last_prices: dict[int, float] | None,
) -> tuple[bool, float]:
    if unit_price <= 0 or not pkg_last_prices:
        return False, 0.0
    hist = float(pkg_last_prices.get(pkg.id, 0.0) or 0.0)
    if hist <= 0:
        return False, 0.0
    if unit_price < hist * 0.4 or unit_price > hist * 2.5:
        return True, hist
    return False, hist


def resolve_packaging_conversion(
    master_item: MasterItem | None,
    qty: float,
    unit: str | None,
    unit_price: float,
    raw_text: str = "",
    explicit_packaging_id: int | None = None,
    pkg_last_prices: dict[int, float] | None = None,
    allow_draft_warning: bool = True,
) -> dict[str, Any]:
    """
    Hitung snapshot konversi kemasan bertingkat (beli -> ecer -> satuan resep)
    serta deteksi ambiguitas/anomali harga sebagai DRAFT_WARNING.
    `base_unit_price` selalu dihitung dari `unit_price`.
    """
    qty_val = float(qty) if (qty is not None and float(qty) > 0) else 1.0
    unit_price_val = max(0.0, float(unit_price or 0.0))
    unit_clean = (unit or "Pcs").strip() or "Pcs"

    def _from_pkg(
        pkg: MasterItemPackaging,
        review_status: str = "CONFIRMED",
        review_warning: str | None = None,
    ) -> dict[str, Any]:
        b_qty = round(qty_val * float(pkg.base_qty), 4)
        r_qty = round(qty_val * float(pkg.retail_qty), 4)
        b_price = round(unit_price_val / float(pkg.base_qty), 4) if (unit_price_val > 0 and float(pkg.base_qty) > 0) else None
        return {
            "packaging_id": pkg.id,
            "resolved_unit": pkg.purchase_unit,
            "retail_qty": r_qty,
            "retail_unit": pkg.retail_unit,
            "base_qty": b_qty,
            "base_unit": pkg.base_unit,
            "base_unit_price": b_price,
            "review_status": review_status,
            "review_warning": review_warning,
        }

    active_pkgs = [p for p in (getattr(master_item, "packagings", None) or []) if p.is_active] if master_item else []

    if explicit_packaging_id is not None and active_pkgs:
        found = next((p for p in active_pkgs if p.id == int(explicit_packaging_id)), None)
        if found:
            return _from_pkg(found)

    if master_item and active_pkgs:
        unit_matches = [p for p in active_pkgs if _units_match(p.purchase_unit, unit_clean)]
        item_base_unit = active_pkgs[0].base_unit or master_item.satuan_resep

        if len(unit_matches) == 1:
            cand = unit_matches[0]
            anomalous, hist = _is_price_anomalous(unit_price_val, cand, pkg_last_prices)
            if anomalous and allow_draft_warning:
                return _from_pkg(
                    cand,
                    review_status="DRAFT_WARNING",
                    review_warning=(
                        f"Harga satuan Rp {unit_price_val:,.0f}/{cand.purchase_unit} menyimpang jauh dari "
                        f"histori varian '{cand.label}' (Rp {hist:,.0f}). Mohon konfirmasi di Web."
                    ),
                )
            return _from_pkg(cand)

        if len(unit_matches) > 1:
            scored_kw = sorted(
                ((_score_packaging_keywords(p, raw_text), p) for p in unit_matches),
                key=lambda x: x[0],
                reverse=True,
            )
            top_score, top_pkg = scored_kw[0]
            second_score = scored_kw[1][0]
            if top_score > 0 and top_score > second_score:
                anomalous, hist = _is_price_anomalous(unit_price_val, top_pkg, pkg_last_prices)
                if anomalous and allow_draft_warning:
                    return _from_pkg(
                        top_pkg,
                        review_status="DRAFT_WARNING",
                        review_warning=(
                            f"Harga satuan Rp {unit_price_val:,.0f}/{top_pkg.purchase_unit} menyimpang dari "
                            f"histori '{top_pkg.label}' (Rp {hist:,.0f}). Mohon konfirmasi di Web."
                        ),
                    )
                return _from_pkg(top_pkg)

            guess = _pick_closest_by_price(unit_matches, unit_price_val, pkg_last_prices)
            if allow_draft_warning:
                labels = ", ".join(p.label for p in unit_matches)
                return _from_pkg(
                    guess,
                    review_status="DRAFT_WARNING",
                    review_warning=(
                        f"'{master_item.item_name}' memiliki {len(unit_matches)} varian kemasan '{unit_clean}' "
                        f"({labels}). Mohon konfirmasi varian yang dibeli di Web."
                    ),
                )
            return _from_pkg(guess)

        if _units_match(unit_clean, "Pcs"):
            scored_all = sorted(
                ((_score_packaging_keywords(p, raw_text), p) for p in active_pkgs),
                key=lambda x: x[0],
                reverse=True,
            )
            if scored_all[0][0] > 0 and (len(scored_all) == 1 or scored_all[0][0] > scored_all[1][0]):
                winner = scored_all[0][1]
                anomalous, hist = _is_price_anomalous(unit_price_val, winner, pkg_last_prices)
                if anomalous and allow_draft_warning:
                    return _from_pkg(
                        winner,
                        review_status="DRAFT_WARNING",
                        review_warning=(
                            f"Struk terbaca '{unit_clean}' dan dicocokkan ke '{winner.label}', namun harga "
                            f"Rp {unit_price_val:,.0f} menyimpang dari histori (Rp {hist:,.0f}). Konfirmasi di Web."
                        ),
                    )
                return _from_pkg(winner)

        direct_base_qty, direct_base_unit = _convert_direct_qty_to_base(qty_val, unit_clean, item_base_unit)
        if direct_base_qty is not None and direct_base_unit:
            b_price = round((qty_val * unit_price_val) / direct_base_qty, 4) if (unit_price_val > 0 and direct_base_qty > 0) else None
            return {
                "packaging_id": None,
                "resolved_unit": unit_clean,
                "retail_qty": round(qty_val, 4),
                "retail_unit": unit_clean,
                "base_qty": direct_base_qty,
                "base_unit": direct_base_unit,
                "base_unit_price": b_price,
                "review_status": "CONFIRMED",
                "review_warning": None,
            }

        guess = _pick_closest_by_price(active_pkgs, unit_price_val, pkg_last_prices)
        if allow_draft_warning:
            return _from_pkg(
                guess,
                review_status="DRAFT_WARNING",
                review_warning=(
                    f"Satuan '{unit_clean}' belum terdaftar pada varian kemasan '{master_item.item_name}' "
                    f"(default: {guess.label}). Mohon konfirmasi kemasan di Web."
                ),
            )

    if master_item and master_item.satuan_resep and master_item.konversi_resep and float(master_item.konversi_resep) > 0:
        konv = float(master_item.konversi_resep)
        if _units_match(master_item.satuan_beli, unit_clean):
            b_qty = round(qty_val * konv, 4)
            b_price = round(unit_price_val / konv, 4) if unit_price_val > 0 else None
            return {
                "packaging_id": None,
                "resolved_unit": unit_clean,
                "retail_qty": round(qty_val, 4),
                "retail_unit": master_item.satuan_ecer or unit_clean,
                "base_qty": b_qty,
                "base_unit": master_item.satuan_resep,
                "base_unit_price": b_price,
                "review_status": "CONFIRMED",
                "review_warning": None,
            }
        direct_base_qty, direct_base_unit = _convert_direct_qty_to_base(qty_val, unit_clean, master_item.satuan_resep)
        if direct_base_qty is not None and direct_base_unit:
            b_price = round((qty_val * unit_price_val) / direct_base_qty, 4) if (unit_price_val > 0 and direct_base_qty > 0) else None
            return {
                "packaging_id": None,
                "resolved_unit": unit_clean,
                "retail_qty": round(qty_val, 4),
                "retail_unit": unit_clean,
                "base_qty": direct_base_qty,
                "base_unit": direct_base_unit,
                "base_unit_price": b_price,
                "review_status": "CONFIRMED",
                "review_warning": None,
            }

    if _units_match(unit_clean, "Pcs"):
        inf_text_unit, inf_text_factor = infer_recipe_unit_conversion(None, None, None, raw_text)
        if inf_text_unit and inf_text_factor and inf_text_factor > 0:
            b_qty = round(qty_val * float(inf_text_factor), 4)
            b_price = round(unit_price_val / float(inf_text_factor), 4) if unit_price_val > 0 else None
            return {
                "packaging_id": None,
                "resolved_unit": unit_clean,
                "retail_qty": round(qty_val, 4),
                "retail_unit": unit_clean,
                "base_qty": b_qty,
                "base_unit": inf_text_unit,
                "base_unit_price": b_price,
                "review_status": "CONFIRMED",
                "review_warning": None,
            }

    inf_unit, inf_factor = infer_recipe_unit_conversion(unit_clean, unit_clean, None, raw_text)
    direct_base_qty, direct_base_unit = _convert_direct_qty_to_base(qty_val, unit_clean, None)
    if direct_base_qty is not None and direct_base_unit:
        b_price = round((qty_val * unit_price_val) / direct_base_qty, 4) if (unit_price_val > 0 and direct_base_qty > 0) else None
        return {
            "packaging_id": None,
            "resolved_unit": unit_clean,
            "retail_qty": round(qty_val, 4),
            "retail_unit": unit_clean,
            "base_qty": direct_base_qty,
            "base_unit": direct_base_unit,
            "base_unit_price": b_price,
            "review_status": "CONFIRMED",
            "review_warning": None,
        }

    if inf_unit and inf_factor and inf_factor > 0:
        b_qty = round(qty_val * float(inf_factor), 4)
        b_price = round(unit_price_val / float(inf_factor), 4) if unit_price_val > 0 else None
        return {
            "packaging_id": None,
            "resolved_unit": unit_clean,
            "retail_qty": round(qty_val, 4),
            "retail_unit": unit_clean,
            "base_qty": b_qty,
            "base_unit": inf_unit,
            "base_unit_price": b_price,
            "review_status": "CONFIRMED",
            "review_warning": None,
        }

    return {
        "packaging_id": None,
        "resolved_unit": unit_clean,
        "retail_qty": None,
        "retail_unit": None,
        "base_qty": None,
        "base_unit": None,
        "base_unit_price": None,
        "review_status": "CONFIRMED",
        "review_warning": None,
    }


async def auto_fill_master_item_recipe_units(
    db: AsyncSession,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Isi otomatis satuan_resep & konversi_resep untuk MasterItem yang belum dikonfigurasi."""
    items = await list_master_items(db)
    updated = 0
    skipped = 0

    for item in items:
        has_both = bool(
            item.satuan_resep
            and item.konversi_resep is not None
            and float(item.konversi_resep) > 0
        )
        if has_both and not overwrite:
            skipped += 1
            continue

        inf_unit, inf_factor = infer_recipe_unit_conversion(
            item.satuan_beli,
            item.satuan_ecer,
            item.isi_paket,
            item.item_name,
        )
        if inf_unit and inf_factor is not None and inf_factor > 0:
            changed = False
            if overwrite or not item.satuan_resep:
                item.satuan_resep = inf_unit
                changed = True
            if overwrite or item.konversi_resep is None or float(item.konversi_resep) <= 0:
                item.konversi_resep = float(inf_factor)
                changed = True
            if changed:
                updated += 1
            else:
                skipped += 1
        else:
            skipped += 1

    await db.flush()
    return {
        "ok": True,
        "updated": updated,
        "skipped": skipped,
        "total": len(items),
        "message": (
            f"Auto-isi satuan resep selesai: {updated} item diperbarui, {skipped} item dilewati."
        ),
    }


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


def _norm_variant(v: str) -> str:
    s = (v or "").strip().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def extract_derivative(raw_text: str | None) -> str | None:
    """
    Ekstrak turunan satuan / isi kemasan dari teks nama barang atau catatan.
    Contoh:
    - 'Terigu Cakra 1kg' -> '1Kg'
    - 'Terigu Cakra 1 Bungkus isi 500g' -> '500g'
    - 'Susu Carnation 1 box isi 6 pouch 2kg' -> '6 pouch @ 2kg'
    - 'Gula Pasir 500 gram' -> '500 Gram'
    - 'Minyak Goreng 2L' -> '2 Liter'
    - 'Kardus 20x20 isi 100 pcs' -> '100 Pcs'
    """
    if not raw_text:
        return None
    s = raw_text.strip()

    # 1. 'isi ...' misal '1 bks isi 500g', 'isi 6 pouch @ 2kg', 'isi: 1kg', 'isi 100 pcs'
    m_isi = re.search(r'\bisi[:\s]+([^,;|]+)', s, re.IGNORECASE)
    if m_isi:
        val = m_isi.group(1).strip()
        # Jangan anggap kata umum operasional seperti 'ulang', 'bensin', 'kasir', 'saldo', 'token' sebagai ukuran kemasan
        is_invalid = re.match(r'^(?:ulang|bensin|kasir|saldo|token|dompet|pulsa|toko)\b', val, re.IGNORECASE)
        # Wajib mengandung angka dan satuan atau kata hitung kemasan
        has_unit = re.search(r'(?:^|\W|\d)(?:kg|kilo|gram|gr|g|liter|lt|l|ml|oz|lb|pcs|lembar|butir|biji|sachet|pouch|kantong|roll|bks|bungkus|kaleng|pack|box)\b', val, re.IGNORECASE)
        if not is_invalid and has_unit and len(val) <= 60:
            return val

    # 2. Pola perkalian ecer: '6 pouch @ 2kg', '6 x 2kg', '10 x 500g'
    m_mult = re.search(
        r'(\d+\s*(?:pouch|box|pcs|bks|bungkus|kaleng|pack)?\s*(?:x|@)\s*\d+(?:[.,]\d+)?\s*(?:kg|kilo|gram|gr|g|liter|lt|l|ml|oz))\b',
        s,
        re.IGNORECASE,
    )
    if m_mult:
        return m_mult.group(1).strip()

    # 3. Satuan berat / volume: '1kg', '500g', '500 gram', '2 liter', '250ml', dll.
    m_weight = re.search(
        r'(\d+(?:[.,]\d+)?\s*(?:kg|kilo|gram|gr|g|liter|lt|l|ml|oz|lb))\b',
        s,
        re.IGNORECASE,
    )
    if m_weight:
        val = m_weight.group(1).strip()
        val_clean = re.sub(r'(\d+)\s*(kg|kilo)\b', r'\1 Kg', val, flags=re.IGNORECASE)
        val_clean = re.sub(r'(\d+)\s*(gram|gr)\b', r'\1 Gram', val_clean, flags=re.IGNORECASE)
        val_clean = re.sub(r'(\d+)\s*g\b', r'\1g', val_clean, flags=re.IGNORECASE)
        val_clean = re.sub(r'(\d+)\s*(liter|lt|l)\b', r'\1 Liter', val_clean, flags=re.IGNORECASE)
        val_clean = re.sub(r'(\d+)\s*ml\b', r'\1ml', val_clean, flags=re.IGNORECASE)
        return val_clean

    # 4. Satuan hitung / lembar / butir / pcs: '100 pcs', '50 lembar', '30 butir'
    m_count = re.search(
        r'(\d+\s*(?:pcs|lembar|butir|biji|sachet|pouch|kantong|roll))\b',
        s,
        re.IGNORECASE,
    )
    if m_count:
        return m_count.group(1).strip()

    return None


def sync_derivative_to_isi_paket(current_isi: str | None, new_derivative: str | None) -> tuple[str, bool]:
    """
    Sinkronkan turunan satuan baru ke `isi_paket` MasterItem.
    Contoh: jika sudah ada '1Kg', lalu ada varian baru '500g',
    maka isi_paket menjadi '1Kg, 500g'.
    Jika sudah ada varian yang identik, tidak diduplikasi.
    """
    if not new_derivative or not new_derivative.strip():
        return current_isi or "", False

    clean_new = new_derivative.strip()
    if not current_isi or not current_isi.strip():
        return clean_new[:255], True

    parts = [p.strip() for p in re.split(r"[,;]\s*", current_isi) if p.strip()]
    norm_new = _norm_variant(clean_new)
    for p in parts:
        if _norm_variant(p) == norm_new:
            return current_isi, False

    updated = f"{current_isi}, {clean_new}"
    # Batasi kapasitas maksimal agar aman dari overflow/truncation di DB
    if len(updated) > 255:
        return current_isi, False

    return updated, True


async def list_master_items(db: AsyncSession) -> list[MasterItem]:
    """Ambil semua daftar MasterItem diurutkan sesuai abjad."""
    result = await db.execute(select(MasterItem).order_by(MasterItem.item_name.asc()))
    return list(result.scalars().all())


async def match_and_normalize_extracted_items(
    db: AsyncSession,
    items: list[dict],
    preserve_explicit_pay_status: bool = False,
    allow_draft_warning: bool = True,
) -> list[dict]:
    """
    Cocokkan setiap item hasil ekstraksi AI/input dengan katalog MasterItem.
    - Mengubah `barang` ke `MasterItem.item_name`
    - Menyesuaikan `kategori` ke `MasterItem.category` (kecuali kategori Tukar Cash)
    - Mengisi `toko_supplier` dengan `default_supplier` jika kosong/"-"
    - Menyesuaikan `satuan` / `unit` agar SELALU sesuai data master yang terdaftar
    - Mendeteksi turunan kemasan (mis. 1 Bungkus isi 1Kg vs 1 Bungkus isi 500g)
      dan otomatis menyinkronkannya ke MasterItem.isi_paket
    - Menghitung snapshot konversi kemasan (`retail_qty`, `base_qty`, `base_unit_price`)
      serta menandai `DRAFT_WARNING` bila varian kemasan ambigu/anomali harga
    - Menyimpan nama asli struk & turunan ke `keterangan`
    """
    if not items:
        return items

    master_items = await list_master_items(db)
    valid_units = await get_valid_units(db)
    valid_pms = await get_active_names(db, "metode_bayar")
    pkg_last_prices = await get_packaging_latest_prices(db)

    # Pemetaan kata kemasan di teks struk/input ke satuan master resmi
    pkg_kw_map = {
        "bungkus": "Bungkus",
        "bks": "Bungkus",
        "box": "Box",
        "kotak": "Box",
        "dus": "Dus",
        "karton": "Dus",
        "pack": "Pack",
        "pak": "Pack",
        "sak": "Sak",
        "karung": "Sak",
        "bal": "Bal",
        "botol": "Botol",
        "btl": "Botol",
        "kaleng": "Kaleng",
        "can": "Kaleng",
        "pouch": "Pouch",
        "tray": "Tray",
        "roll": "Roll",
        "lembar": "Lembar",
        "meter": "Meter",
        "ikat": "Ikat",
        "butir": "Butir",
    }

    for item in items:
        # 1. Normalisasi metode bayar dan status pembayaran agar selalu sesuai master data
        curr_pm = item.get("metode_bayar") or item.get("pay_method")
        if curr_pm:
            norm_pm = normalize_payment_method_name(str(curr_pm), valid_methods=valid_pms)
            if "metode_bayar" in item:
                item["metode_bayar"] = norm_pm
            if "pay_method" in item:
                item["pay_method"] = norm_pm

            # Status pembayaran: selain pembayaran COD maka statusnya lunas (kecuali input dashboard/batch eksplisit)
            notes_str = str(item.get("keterangan") or item.get("notes") or "").lower()
            if norm_pm == "COD":
                is_explicit_paid = any(k in notes_str for k in ("sudah lunas", "sudah dibayar", "lunas kasir", "sudah bayar"))
                cod_status = "Lunas" if is_explicit_paid else "Belum Lunas"
                if "status_pembayaran" in item or "pay_status" not in item:
                    item["status_pembayaran"] = item.get("status_pembayaran") or cod_status
                if "pay_status" in item:
                    item["pay_status"] = item.get("pay_status") or cod_status
            elif not preserve_explicit_pay_status:
                if "status_pembayaran" in item:
                    item["status_pembayaran"] = "Lunas"
                if "pay_status" in item:
                    item["pay_status"] = "Lunas"
        # Pengecekan Eksklusi: Ongkir & Tukar Cash TIDAK BOLEH dicocokkan ke MasterItem
        kat_check = (item.get("kategori") or item.get("category") or "").strip().lower()
        raw_name = (item.get("barang") or item.get("item_name") or "").strip()
        raw_name_lower = raw_name.lower()
        if (
            kat_check in ("ongkir", "tukar cash")
            or raw_name_lower.startswith("ongkir")
            or "tukar cash" in raw_name_lower
            or "tarik tunai" in raw_name_lower
        ):
            item["master_item_id"] = None
            item["packaging_id"] = None
            item["review_status"] = "CONFIRMED"
            item["review_warning"] = None
            # Pastikan satuan khusus tukar cash / ongkir tetap valid
            current_unit = (item.get("satuan") or item.get("unit") or "").strip()
            if kat_check == "tukar cash" or "tukar cash" in raw_name_lower:
                item["satuan"] = "Trans"
                item["unit"] = "Trans"
            elif kat_check == "ongkir" or raw_name_lower.startswith("ongkir"):
                item["satuan"] = "Trip"
                item["unit"] = "Trip"
            elif current_unit:
                norm_u = await normalize_unit_to_master(db, current_unit)
                item["satuan"] = norm_u or "Pcs"
                item["unit"] = norm_u or "Pcs"
            continue

        matched = None
        req_mid = item.get("master_item_id")
        if req_mid:
            matched = next((m for m in master_items if m.id == req_mid), None)

        if not matched and raw_name:
            matched = find_best_master_match(raw_name, master_items)

        qty_val = float(item.get("qty") or 1.0)
        price_val = resolve_effective_unit_price(
            item.get("harga_satuan") if "harga_satuan" in item else item.get("unit_price"),
            item.get("total_harga") if "total_harga" in item else item.get("total_price"),
            qty_val,
        )
        old_notes = item.get("keterangan") if "keterangan" in item else item.get("notes", "-")
        item_allow_draft = allow_draft_warning and str(item.get("review_status") or "").upper() != "CONFIRMED"

        if not matched:
            # Jika tidak cocok ke master item, tetap pastikan satuan sesuai data master
            current_unit = (item.get("satuan") or item.get("unit") or "").strip()
            norm_u = await normalize_unit_to_master(db, current_unit)
            final_unit = norm_u or "Pcs"
            item["satuan"] = final_unit
            item["unit"] = final_unit
            conv = resolve_packaging_conversion(
                None,
                qty=qty_val,
                unit=final_unit,
                unit_price=price_val,
                raw_text=f"{raw_name} {old_notes or ''}",
                allow_draft_warning=False,
            )
            if item.get("base_qty") is None and conv["base_qty"] is not None:
                item["retail_qty"] = conv["retail_qty"]
                item["retail_unit"] = conv["retail_unit"]
                item["base_qty"] = conv["base_qty"]
                item["base_unit"] = conv["base_unit"]
                item["base_unit_price"] = conv["base_unit_price"]
            item.setdefault("review_status", "CONFIRMED")
            continue

        # Simpan nama asli ke keterangan bila berbeda
        new_notes = append_original_name_to_notes(raw_name, matched.item_name, old_notes)

        # 1. Deteksi Turunan Satuan (misal: '1Kg', '500g', 'isi 500g', '6 pouch 2kg')
        detected_derivative = (
            extract_derivative(raw_name)
            or extract_derivative(old_notes)
            or (item.get("isi_paket") or item.get("turunan") or "").strip()
        )
        if detected_derivative:
            # Sinkronkan otomatis ke MasterItem.isi_paket jika belum ada
            updated_isi, changed = sync_derivative_to_isi_paket(matched.isi_paket, detected_derivative)
            if changed:
                matched.isi_paket = updated_isi
                await db.flush()

            # Catat turunan di keterangan agar histori transaksi tercatat jelas varian isinya
            deriv_tag = f"Isi: {detected_derivative}"
            if deriv_tag.lower() not in new_notes.lower():
                new_notes = f"{new_notes} | {deriv_tag}" if new_notes and new_notes != "-" else deriv_tag

            item["turunan"] = detected_derivative
            item["isi_paket"] = detected_derivative

        # 2. Penentuan Satuan (WAJIB SESUAI DATA MASTER YANG TERDAFTAR)
        current_unit = (item.get("satuan") or item.get("unit") or "").strip()
        norm_current = await normalize_unit_to_master(db, current_unit, valid_units=valid_units) if current_unit else None
        if not norm_current and current_unit:
            mapped_alias = pkg_kw_map.get(current_unit.lower())
            if mapped_alias:
                norm_current = await normalize_unit_to_master(db, mapped_alias, valid_units=valid_units)

        active_pkgs = [p for p in (getattr(matched, "packagings", None) or []) if p.is_active]
        chosen_unit = None
        if norm_current and norm_current.lower() != "pcs":
            chosen_unit = norm_current
        else:
            detected_pkg = None
            for kw, candidate_unit in pkg_kw_map.items():
                if re.search(r'\b' + re.escape(kw) + r'\b', raw_name_lower):
                    detected_pkg = candidate_unit
                    break

            if detected_pkg:
                chosen_unit = await normalize_unit_to_master(db, detected_pkg)

            if not chosen_unit:
                if active_pkgs and norm_current and norm_current.lower() == "pcs":
                    # Biarkan resolver memeriksa apakah 'Pcs' cocok ke kemasan/keyword atau ambigu
                    chosen_unit = "Pcs"
                elif any(k in raw_name_lower for k in ("ecer", "biji", "butir")):
                    chosen_unit = await normalize_unit_to_master(db, matched.satuan_ecer)
                else:
                    chosen_unit = await normalize_unit_to_master(db, matched.satuan_beli)

        if not chosen_unit:
            chosen_unit = await normalize_unit_to_master(db, matched.satuan_beli) or "Pcs"

        # 3. Resolusi Varian Kemasan & Snapshot Konversi
        explicit_pid = item.get("packaging_id")
        conv = resolve_packaging_conversion(
            matched,
            qty=qty_val,
            unit=chosen_unit,
            unit_price=price_val,
            raw_text=f"{raw_name} {old_notes or ''} {detected_derivative or ''}",
            explicit_packaging_id=explicit_pid,
            pkg_last_prices=pkg_last_prices,
            allow_draft_warning=item_allow_draft,
        )
        if conv["resolved_unit"] and conv["resolved_unit"] != chosen_unit:
            norm_res_u = await normalize_unit_to_master(db, conv["resolved_unit"])
            if norm_res_u:
                chosen_unit = norm_res_u

        item["master_item_id"] = matched.id
        if item.get("base_qty") is None or item.get("packaging_id") is None:
            item["packaging_id"] = conv["packaging_id"]
            if item.get("retail_qty") is None:
                item["retail_qty"] = conv["retail_qty"]
                item["retail_unit"] = conv["retail_unit"]
            if item.get("base_qty") is None:
                item["base_qty"] = conv["base_qty"]
                item["base_unit"] = conv["base_unit"]
                item["base_unit_price"] = conv["base_unit_price"]
        if not item.get("review_status"):
            item["review_status"] = conv["review_status"]
        if item.get("review_warning") is None:
            item["review_warning"] = conv["review_warning"]

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
    satuan_resep: str | None = None,
    konversi_resep: float | None = None,
    packagings: list[dict[str, Any]] | None = None,
) -> MasterItem:
    """Buat satu MasterItem baru atau update jika nama sudah ada."""
    clean_name = item_name.strip()
    norm_beli = (await normalize_unit_to_master(db, satuan_beli)) or "Pcs"
    norm_ecer = (await normalize_unit_to_master(db, satuan_ecer)) or "Pcs"
    norm_resep = normalize_recipe_unit(satuan_resep)
    clean_konv = (
        round(float(konversi_resep), 6)
        if konversi_resep is not None and float(konversi_resep) > 0
        else None
    )

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
            existing.satuan_beli = norm_beli
        if tipe_satuan:
            existing.tipe_satuan = tipe_satuan
        if isi_paket is not None:
            existing.isi_paket = isi_paket
        if satuan_ecer:
            existing.satuan_ecer = norm_ecer
        if norm_resep is not None:
            existing.satuan_resep = norm_resep
        if clean_konv is not None:
            existing.konversi_resep = clean_konv
        if not existing.satuan_resep and existing.konversi_resep is None:
            inf_u, inf_f = infer_recipe_unit_conversion(
                existing.satuan_beli,
                existing.satuan_ecer,
                existing.isi_paket,
                existing.item_name,
            )
            if inf_u and inf_f is not None:
                existing.satuan_resep = inf_u
                existing.konversi_resep = inf_f
        await db.flush()
        if packagings is not None:
            await sync_master_item_packagings(db, existing, packagings)
        return existing

    if not norm_resep and clean_konv is None:
        inf_u, inf_f = infer_recipe_unit_conversion(
            norm_beli, norm_ecer, isi_paket, clean_name
        )
        norm_resep = inf_u
        clean_konv = inf_f

    item = MasterItem(
        item_name=clean_name,
        category=category if category in settings.valid_categories else "Bahan Kue",
        default_supplier=(default_supplier or "-").strip() or "-",
        aliases=(aliases or "").strip(),
        satuan_beli=norm_beli,
        tipe_satuan=(tipe_satuan or "keduanya").strip() or "keduanya",
        isi_paket=(isi_paket or "").strip(),
        satuan_ecer=norm_ecer,
        satuan_resep=norm_resep,
        konversi_resep=clean_konv,
    )
    db.add(item)
    await db.flush()
    if packagings is not None:
        await sync_master_item_packagings(db, item, packagings)
    elif norm_resep and clean_konv and float(clean_konv) > 0:
        default_label = (
            f"{norm_beli} ({isi_paket.strip()})"
            if isi_paket and isi_paket.strip()
            else f"{norm_beli} ({float(clean_konv):g} {norm_resep})"
        )
        await sync_master_item_packagings(
            db,
            item,
            [
                {
                    "label": default_label[:120],
                    "purchase_unit": norm_beli,
                    "retail_qty": 1.0,
                    "retail_unit": norm_ecer,
                    "base_qty": float(clean_konv),
                    "base_unit": norm_resep,
                    "keywords": (isi_paket or "").strip(),
                    "is_default": True,
                    "is_active": True,
                }
            ],
        )
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
        raw_beli = parts[4] if len(parts) > 4 and parts[4] else "Pcs"
        satuan_beli = (await normalize_unit_to_master(db, raw_beli)) or "Pcs"
        tipe_satuan = parts[5] if len(parts) > 5 and parts[5] in ("paket", "ecer", "keduanya") else "keduanya"
        isi_paket = parts[6] if len(parts) > 6 else ""
        raw_ecer = parts[7] if len(parts) > 7 and parts[7] else "Pcs"
        satuan_ecer = (await normalize_unit_to_master(db, raw_ecer)) or "Pcs"

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
                m.satuan_beli = satuan_beli
            if len(parts) > 5 and parts[5]:
                m.tipe_satuan = parts[5]
            if len(parts) > 6:
                m.isi_paket = parts[6]
            if len(parts) > 7 and parts[7]:
                m.satuan_ecer = satuan_ecer
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
    - Menyesuaikan nama item ke nama baku dan simpan nama lama di notes
    - Menyesuaikan kategori ke MasterItem
    - Menormalisasi satuan agar sesuai data master yang terdaftar
    - Menemukan turunan satuan (isi kemasan) dan menyinkronkannya ke MasterItem.isi_paket
    Optimasi:
    - Pre-fetch master data satuan (O(1) in-memory lookup vs ribuan DB queries)
    - Pre-index master items by id, exact name, dan alias
    - Caching pencocokan nama item per nama raw untuk menghindari sequence matching berulang
    - Parsing turunan dari notes hanya pada tag Struk/Isi terstruktur
    """
    master_items = await list_master_items(db)
    if not master_items:
        return {"matched_count": 0, "updated_items": []}

    # 1. Pre-fetch valid units untuk normalisasi satuan in-memory O(1)
    valid_units = await get_valid_units(db)
    valid_units_map = {u.strip().lower(): u for u in valid_units}

    # 2. Pre-index master items
    master_by_id: dict[int, MasterItem] = {m.id: m for m in master_items}
    exact_by_name: dict[str, MasterItem] = {}
    exact_by_alias: dict[str, MasterItem] = {}
    for m in master_items:
        norm_name = _normalize_str(m.item_name)
        if norm_name and norm_name not in exact_by_name:
            exact_by_name[norm_name] = m
        for alias in _parse_aliases(m.aliases):
            norm_alias = _normalize_str(alias)
            if norm_alias and norm_alias not in exact_by_alias:
                exact_by_alias[norm_alias] = m

    # 3. Cache pencocokan raw_name -> MasterItem
    match_cache: dict[str, MasterItem | None] = {}

    result = await db.execute(select(Expense).order_by(Expense.id.desc()))
    all_expenses = result.scalars().all()

    updated_items = []
    for exp in all_expenses:
        raw_name = (exp.item_name or "").strip()
        if not raw_name:
            continue

        # Cek apakah sudah terhubung ke master_item_id yang valid
        matched: MasterItem | None = None
        if exp.master_item_id and exp.master_item_id in master_by_id:
            matched = master_by_id[exp.master_item_id]
        else:
            norm_raw = _normalize_str(raw_name)
            if norm_raw in match_cache:
                matched = match_cache[norm_raw]
            else:
                # Cek exact name atau alias terlebih dahulu O(1)
                matched = exact_by_name.get(norm_raw) or exact_by_alias.get(norm_raw)
                if not matched:
                    matched = find_best_master_match(raw_name, master_items)
                match_cache[norm_raw] = matched

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

        # Normalisasi satuan transaksi ke data master secara in-memory
        if exp.unit:
            cleaned_unit = exp.unit.strip().lower()
            norm_u = valid_units_map.get(cleaned_unit)
            if norm_u and exp.unit != norm_u:
                exp.unit = norm_u
                exp.sheets_synced = False
                changed = True

        # Sinkronkan turunan kemasan dari raw_name / notes terstruktur ke MasterItem.isi_paket
        deriv = extract_derivative(raw_name)
        if not deriv and exp.notes:
            m_struk = re.search(r'Struk:\s*([^|]+)', exp.notes, re.IGNORECASE)
            if m_struk:
                deriv = extract_derivative(m_struk.group(1))
            if not deriv:
                m_isi_tag = re.search(r'Isi:\s*([^|]+)', exp.notes, re.IGNORECASE)
                if m_isi_tag:
                    deriv = extract_derivative(m_isi_tag.group(1))

        if deriv:
            updated_isi, isi_changed = sync_derivative_to_isi_paket(matched.isi_paket, deriv)
            if isi_changed:
                matched.isi_paket = updated_isi
                changed = True
            deriv_tag = f"Isi: {deriv}"
            if deriv_tag.lower() not in (exp.notes or "").lower():
                exp.notes = f"{exp.notes} | {deriv_tag}" if exp.notes and exp.notes != "-" else deriv_tag
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
            if len(updated_items) % 250 == 0:
                await db.flush()

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

        # Exclude Ongkir dan Tukar Cash dari import master items
        cat_l = (e.category or "").strip().lower()
        raw_l = raw_name.lower()
        if (
            cat_l in ("ongkir", "tukar cash")
            or raw_l.startswith("ongkir")
            or "tukar cash" in raw_l
            or "tarik tunai" in raw_l
        ):
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


def resolve_effective_unit_price(
    unit_price: Any,
    total_price: Any = None,
    qty: Any = None,
) -> float:
    """
    Hitung harga satuan efektif dari sebuah transaksi pengeluaran.
    Prioritas utama: unit_price jika > 0; jika 0 (mis. data lama/impor),
    turunkan dari total_price / qty agar harga terbaru tetap terbaca akurat.
    """
    up = float(unit_price or 0)
    if up > 0:
        return round(up, 2)
    tp = float(total_price or 0)
    if tp > 0:
        q = float(qty or 0)
        if q > 0:
            return round(tp / q, 2)
        return round(tp, 2)
    return 0.0


def _is_excluded_suggestion_expense(category: str | None, item_name: str | None) -> bool:
    cat_l = (category or "").strip().lower()
    name_l = (item_name or "").strip().lower()
    return (
        cat_l in ("ongkir", "tukar cash")
        or name_l.startswith("ongkir")
        or "tukar cash" in name_l
        or "tarik tunai" in name_l
    )


async def get_master_items_latest_stats(
    db: AsyncSession,
    master_items: list[MasterItem] | None = None,
) -> dict[int, dict[str, Any]]:
    """
    Hitung statistik harga & transaksi terbaru dari SELURUH tabel expenses
    untuk setiap MasterItem (diurutkan expense_date DESC, id DESC):
    - `last_unit_price`: harga satuan dari transaksi CONFIRMED paling baru
    - `last_base_unit_price`: harga per satuan resep (dari `unit_price`) transaksi CONFIRMED terbaru
    - `prev_base_unit_price`: harga per satuan resep transaksi CONFIRMED kedua terbaru
    - `packaging_last_prices`: dict[packaging_id, latest_unit_price]
    - `last_supplier`, `last_date`, `tx_count`
    """
    if master_items is None:
        master_items = await list_master_items(db)
    if not master_items:
        return {}

    target_ids = {m.id for m in master_items}
    master_by_id = {m.id: m for m in master_items}
    name_to_mid: dict[str, int] = {}
    for m in master_items:
        clean_nm = (m.item_name or "").strip().lower()
        if clean_nm and clean_nm not in name_to_mid:
            name_to_mid[clean_nm] = m.id

    stmt = select(
        Expense.id,
        Expense.master_item_id,
        Expense.item_name,
        Expense.unit_price,
        Expense.total_price,
        Expense.qty,
        Expense.unit,
        Expense.packaging_id,
        Expense.base_qty,
        Expense.base_unit_price,
        Expense.review_status,
        Expense.supplier,
        Expense.expense_date,
        Expense.category,
    )
    if len(master_items) <= 20:
        conds = [Expense.master_item_id.in_(target_ids)]
        if name_to_mid:
            conds.append(
                and_(
                    Expense.master_item_id.is_(None),
                    func.lower(func.trim(Expense.item_name)).in_(list(name_to_mid.keys())),
                )
            )
        stmt = stmt.where(or_(*conds))

    stmt = stmt.order_by(Expense.expense_date.desc(), Expense.id.desc())
    rows = (await db.execute(stmt)).all()

    stats: dict[int, dict[str, Any]] = {}
    for row in rows:
        mid: int | None = None
        if row.master_item_id is not None:
            if row.master_item_id in target_ids:
                mid = int(row.master_item_id)
        else:
            if _is_excluded_suggestion_expense(row.category, row.item_name):
                continue
            name_key = (row.item_name or "").strip().lower()
            mid = name_to_mid.get(name_key)

        if mid is None:
            continue

        is_draft = (row.review_status or "CONFIRMED") == "DRAFT_WARNING"
        eff_price = resolve_effective_unit_price(row.unit_price, row.total_price, row.qty)
        sup_clean = (row.supplier or "").strip()
        dt_str = row.expense_date.isoformat() if row.expense_date else None

        entry = stats.get(mid)
        if entry is None:
            entry = {
                "last_unit_price": 0.0,
                "last_base_unit_price": None,
                "latest_price_date": None,
                "prev_unit_price": None,
                "prev_base_unit_price": None,
                "prev_date": None,
                "last_supplier": "",
                "last_date": dt_str,
                "tx_count": 0,
                "draft_warning_count": 0,
                "packaging_last_prices": {},
            }
            stats[mid] = entry

        entry["tx_count"] += 1
        if is_draft:
            entry["draft_warning_count"] += 1
            continue

        if entry["last_date"] is None and dt_str:
            entry["last_date"] = dt_str
        if not entry["last_supplier"] and sup_clean and sup_clean != "-":
            entry["last_supplier"] = sup_clean

        if row.packaging_id is not None and eff_price > 0:
            pid = int(row.packaging_id)
            if pid not in entry["packaging_last_prices"]:
                entry["packaging_last_prices"][pid] = eff_price

        # Hitung harga per satuan dasar (base_unit_price) dari unit_price
        row_base_price: float | None = None
        if row.base_unit_price is not None and float(row.base_unit_price) > 0:
            row_base_price = float(row.base_unit_price)
        elif row.base_qty is not None and float(row.base_qty) > 0 and eff_price > 0 and float(row.qty or 0) > 0:
            row_base_price = round((eff_price * float(row.qty)) / float(row.base_qty), 4)
        else:
            mi_obj = master_by_id.get(mid)
            if mi_obj and mi_obj.konversi_resep and float(mi_obj.konversi_resep) > 0 and eff_price > 0:
                if not row.unit or _units_match(row.unit, mi_obj.satuan_beli):
                    row_base_price = round(eff_price / float(mi_obj.konversi_resep), 4)

        if eff_price > 0:
            if entry["last_unit_price"] <= 0:
                entry["last_unit_price"] = eff_price
                entry["last_base_unit_price"] = row_base_price
                entry["latest_price_date"] = dt_str
            elif entry["prev_unit_price"] is None:
                entry["prev_unit_price"] = eff_price
                entry["prev_base_unit_price"] = row_base_price
                entry["prev_date"] = dt_str

    return stats


def serialize_master_item_packagings(
    m: MasterItem,
    pkg_last_prices: dict[int, float] | None = None,
) -> list[dict[str, Any]]:
    """Serialisasikan daftar varian kemasan MasterItem lengkap dengan harga historisnya."""
    out: list[dict[str, Any]] = []
    for p in getattr(m, "packagings", None) or []:
        last_p = float((pkg_last_prices or {}).get(p.id, 0.0) or 0.0)
        b_price = round(last_p / float(p.base_qty), 4) if (last_p > 0 and float(p.base_qty) > 0) else None
        out.append(
            {
                "id": p.id,
                "master_item_id": p.master_item_id,
                "label": p.label,
                "purchase_unit": p.purchase_unit,
                "retail_qty": float(p.retail_qty),
                "retail_unit": p.retail_unit,
                "base_qty": float(p.base_qty),
                "base_unit": p.base_unit,
                "keywords": p.keywords or "",
                "is_default": bool(p.is_default),
                "is_active": bool(p.is_active),
                "last_unit_price": last_p if last_p > 0 else None,
                "base_unit_price": b_price,
                "created_at": p.created_at,
            }
        )
    return out


async def get_item_and_supplier_suggestions(db: AsyncSession) -> dict:
    """
    Kembalikan daftar saran autocomplete untuk form tambah/edit pengeluaran:
    - `items`: gabungan MasterItem + item unik dari histori Expense beserta harga terakhir,
      kategori, varian kemasan, dan supplier terakhir (diambil dari transaksi paling baru).
    - `suppliers`: daftar nama toko/supplier unik yang paling sering digunakan.
    """
    master_items = await list_master_items(db)
    master_stats = await get_master_items_latest_stats(db, master_items)

    # Query ringan kolom skalar atas seluruh transaksi (tanpa limit 600) agar harga terbaru selalu akurat
    result = await db.execute(
        select(
            Expense.master_item_id,
            Expense.item_name,
            Expense.category,
            Expense.unit_price,
            Expense.total_price,
            Expense.qty,
            Expense.review_status,
            Expense.supplier,
            Expense.expense_date,
        ).order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    all_expenses = result.all()

    history_by_name: dict[str, dict] = {}
    supplier_counts: dict[str, dict] = {}

    for e in all_expenses:
        if (e.review_status or "CONFIRMED") == "DRAFT_WARNING":
            continue
        name = (e.item_name or "").strip()
        sup = (e.supplier or "").strip()
        price = resolve_effective_unit_price(e.unit_price, e.total_price, e.qty)
        dt_str = str(e.expense_date) if e.expense_date else None

        # Abaikan transaksi Ongkir & Tukar Cash agar tidak mengotori saran belanja barang umum
        if _is_excluded_suggestion_expense(e.category, name):
            continue

        # Catat histori berdasarkan nama item untuk item non-master
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
                if (
                    history_by_name[key]["last_supplier"] in ("", "-")
                    and sup
                    and sup != "-"
                ):
                    history_by_name[key]["last_supplier"] = sup

        if sup and sup != "-":
            skey = sup.lower()
            if skey not in supplier_counts:
                supplier_counts[skey] = {"supplier": sup, "count": 1}
            else:
                supplier_counts[skey]["count"] += 1

    suggestions_map: dict[str, dict] = {}

    # 1. Masukkan semua MasterItem terlebih dahulu menggunakan statistik akurat dari transaksi terbaru
    for m in master_items:
        key = m.item_name.strip().lower()
        hist = master_stats.get(m.id)
        last_sup = (
            hist["last_supplier"]
            if hist and hist.get("last_supplier") and hist["last_supplier"] != "-"
            else (m.default_supplier or "-")
        )
        last_price = float(hist["last_unit_price"]) if hist else 0.0
        base_price = hist.get("last_base_unit_price") if hist else None
        if base_price is None and last_price > 0 and m.konversi_resep and float(m.konversi_resep) > 0:
            base_price = round(last_price / float(m.konversi_resep), 4)
        pkg_prices = hist.get("packaging_last_prices", {}) if hist else {}
        suggestions_map[key] = {
            "id": m.id,
            "item_name": m.item_name,
            "category": m.category,
            "aliases": m.aliases or "",
            "satuan_beli": m.satuan_beli or "Pcs",
            "tipe_satuan": m.tipe_satuan or "keduanya",
            "isi_paket": m.isi_paket or "",
            "satuan_ecer": m.satuan_ecer or "Pcs",
            "satuan_resep": m.satuan_resep,
            "konversi_resep": m.konversi_resep,
            "recipe_unit_price": base_price,
            "packagings": serialize_master_item_packagings(m, pkg_prices),
            "last_unit_price": last_price,
            "last_supplier": last_sup,
            "last_date": hist["last_date"] if hist else None,
            "tx_count": int(hist["tx_count"]) if hist else 0,
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

    # Urutkan: MasterItem dulu (tidak terpotong), lalu item histori non-master
    master_sorted = sorted(
        [v for v in suggestions_map.values() if v["is_master"]],
        key=lambda x: (-x["tx_count"], x["item_name"].lower()),
    )
    non_master_sorted = sorted(
        [v for v in suggestions_map.values() if not v["is_master"]],
        key=lambda x: (-x["tx_count"], x["item_name"].lower()),
    )
    sorted_items = master_sorted + non_master_sorted[:250]

    # Ambil master supplier aktif dari tabel suppliers agar toko baru yang didaftarkan langsung muncul
    from app.models.supplier import Supplier
    supp_res = await db.execute(
        select(Supplier.name).where(Supplier.is_active.is_(True))
    )
    master_suppliers_set = {r[0].strip() for r in supp_res.fetchall() if r[0] and r[0].strip() not in ("-", "None", "")}

    # Gabungkan: supplier yang sering dipakai lebih dahulu, diikuti master supplier terdaftar lainnya
    seen_supp_lower = set()
    combined_suppliers: list[str] = []

    for s in sorted(supplier_counts.values(), key=lambda x: (-x["count"], x["supplier"].lower())):
        s_name = s["supplier"].strip()
        if s_name and s_name.lower() not in seen_supp_lower and s_name not in ("-", "None"):
            seen_supp_lower.add(s_name.lower())
            combined_suppliers.append(s_name)

    for ms_name in sorted(master_suppliers_set, key=lambda x: x.lower()):
        if ms_name.lower() not in seen_supp_lower:
            seen_supp_lower.add(ms_name.lower())
            combined_suppliers.append(ms_name)

    valid_units = await get_valid_units(db)

    return {
        "items": sorted_items,
        "suppliers": combined_suppliers[:150],
        "units": valid_units,
    }


def _compute_master_item_duplicates(
    items_data: list[dict],
    min_score: float,
    limit: int,
    supplier_item_ids: set[int] | None = None,
    strict_supplier: bool = False,
) -> list[dict]:
    """Hitung duplikat antar item baku secara efisien di worker thread."""
    pairs = []
    n = len(items_data)

    for i in range(n):
        data_a = items_data[i]
        id_a = data_a["stats"]["id"]
        is_supp_a = bool(supplier_item_ids and id_a in supplier_item_ids)

        # Jika filter supplier aktif dalam mode ketat, item a harus milik supplier
        if supplier_item_ids is not None and strict_supplier and not is_supp_a:
            continue

        norm_a = data_a["norm_name"]
        if not norm_a:
            continue
        tokens_a = data_a["tokens"]
        nums_a = data_a["nums"]
        aliases_a = data_a["aliases"]
        len_a = data_a["len"]

        for j in range(i + 1, n):
            data_b = items_data[j]
            id_b = data_b["stats"]["id"]
            is_supp_b = bool(supplier_item_ids and id_b in supplier_item_ids)

            if supplier_item_ids is not None:
                if strict_supplier and not is_supp_b:
                    continue
                if not strict_supplier and not (is_supp_a or is_supp_b):
                    continue

            norm_b = data_b["norm_name"]
            if not norm_b:
                continue

            nums_b = data_b["nums"]
            has_num_conflict = bool(nums_a and nums_b and (nums_a - nums_b) and (nums_b - nums_a))

            aliases_b = data_b["aliases"]
            has_alias_match = (
                norm_a in aliases_b
                or norm_b in aliases_a
                or bool(set(aliases_a) & set(aliases_b) - {""})
            )

            similarity = 0.0
            match_type = ""
            reason = ""

            if has_alias_match:
                similarity = 0.98
                match_type = "alias"
                reason = "Kata kunci alias struk saling terhubung"
            elif has_num_conflict:
                continue
            else:
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
                    len_b = data_b["len"]
                    max_seq = (2.0 * min(len_a, len_b)) / (len_a + len_b)
                    if max_seq >= min_score - 0.10:
                        union_len = len(tokens_a | tokens_b)
                        inter_len = len(tokens_a & tokens_b)
                        jaccard = inter_len / union_len if union_len > 0 else 0.0
                        if jaccard >= 0.20:
                            seq_ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
                            best_score = max(seq_ratio, (seq_ratio * 0.5) + (jaccard * 0.5))
                            if best_score >= min_score:
                                similarity = round(best_score, 2)
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

                both_in_supp = (is_supp_a and is_supp_b) if supplier_item_ids is not None else True

                pairs.append({
                    "item_a": data_a["stats"],
                    "item_b": data_b["stats"],
                    "similarity_score": similarity,
                    "match_type": match_type,
                    "reason": reason,
                    "suggested_primary_id": suggested_primary,
                    "both_in_supplier": both_in_supp,
                })

    if supplier_item_ids is not None:
        pairs.sort(key=lambda x: (not x.get("both_in_supplier", False), -x["similarity_score"]))
    else:
        pairs.sort(key=lambda x: -x["similarity_score"])
    return pairs[:limit]


async def audit_duplicate_master_items(
    db: AsyncSession,
    min_score: float = 0.70,
    limit: int = 150,
    supplier_id: int | None = None,
    supplier_name: str | None = None,
    strict_supplier: bool = False,
) -> dict:
    """
    Audit seluruh katalog master items untuk mendeteksi potensi duplikat.
    Dapat difilter per toko / supplier tertentu untuk mengecek duplikasi barang belanjaan toko tersebut.
    Dioptimalkan dengan agregasi SQL langsung, pruning token, dan komputasi di threadpool.
    """
    supplier_item_ids: set[int] | None = None

    if supplier_id is not None or (supplier_name and supplier_name.strip()):
        target_supplier: Supplier | None = None
        supplier_names: set[str] = set()

        if supplier_id is not None:
            target_supplier = await db.get(Supplier, supplier_id)
            if target_supplier:
                supplier_names.add(target_supplier.name.strip().lower())
                if target_supplier.aliases:
                    for a in target_supplier.aliases.split(","):
                        if a.strip():
                            supplier_names.add(a.strip().lower())

        if supplier_name and supplier_name.strip():
            supplier_names.add(supplier_name.strip().lower())
            if not target_supplier:
                s_res = await db.execute(
                    select(Supplier).where(func.lower(Supplier.name) == supplier_name.strip().lower())
                )
                target_supplier = s_res.scalar_one_or_none()
                if target_supplier and target_supplier.aliases:
                    for a in target_supplier.aliases.split(","):
                        if a.strip():
                            supplier_names.add(a.strip().lower())

        # Kumpulkan filter transaksi pengeluaran untuk supplier ini
        exp_conds = []
        if target_supplier:
            exp_conds.append(Expense.supplier_id == target_supplier.id)
        if supplier_names:
            exp_conds.append(func.lower(func.trim(Expense.supplier)).in_(list(supplier_names)))

        supplier_filter = or_(*exp_conds) if exp_conds else None

        existing_items = await list_master_items(db)
        existing_map = {m.item_name.strip().lower(): m for m in existing_items}
        new_master_added = False

        if supplier_filter is not None:
            exp_stmt = (
                select(
                    Expense.master_item_id,
                    Expense.item_name,
                    Expense.category,
                    Expense.supplier,
                )
                .where(supplier_filter)
                .where(Expense.category != "Tukar Cash")
            )
            exp_rows = (await db.execute(exp_stmt)).all()

            for row in exp_rows:
                raw_name = (row.item_name or "").strip()
                if not raw_name or raw_name == "-":
                    continue
                cat_l = (row.category or "").strip().lower()
                raw_l = raw_name.lower()
                if cat_l in ("ongkir", "tukar cash") or raw_l.startswith("ongkir"):
                    continue

                if raw_l not in existing_map:
                    new_m = MasterItem(
                        item_name=raw_name,
                        category=row.category or "Bahan Kue",
                        default_supplier=row.supplier or (target_supplier.name if target_supplier else "-"),
                        aliases="",
                    )
                    db.add(new_m)
                    existing_map[raw_l] = new_m
                    new_master_added = True

        if new_master_added:
            await db.flush()

        supplier_item_ids = set()
        for m in existing_map.values():
            if m.default_supplier and m.default_supplier.strip().lower() in supplier_names:
                supplier_item_ids.add(m.id)

        if supplier_filter is not None:
            tx_items_stmt = (
                select(
                    Expense.master_item_id,
                    func.lower(func.trim(Expense.item_name)).label("item_lower"),
                )
                .where(supplier_filter)
                .distinct()
            )
            tx_rows = (await db.execute(tx_items_stmt)).all()
            for r in tx_rows:
                if r.master_item_id:
                    supplier_item_ids.add(r.master_item_id)
                if r.item_lower and r.item_lower in existing_map:
                    supplier_item_ids.add(existing_map[r.item_lower].id)

        master_items = list(existing_map.values())
        if not supplier_item_ids or (strict_supplier and len(supplier_item_ids) < 2):
            return {"ok": True, "total_duplicates": 0, "pairs": []}
    else:
        master_items = await list_master_items(db)

    if len(master_items) < 2:
        return {"ok": True, "total_duplicates": 0, "pairs": []}

    # Ambil statistik harga & transaksi terbaru yang akurat (ORDER BY expense_date DESC, id DESC)
    latest_stats = await get_master_items_latest_stats(db, master_items)

    def _get_item_stats(m: MasterItem) -> dict:
        h = latest_stats.get(m.id, {})
        last_sup = h.get("last_supplier") or m.default_supplier or "-"
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
            "last_supplier": last_sup,
            "tx_count": int(h.get("tx_count") or 0),
            "created_at": m.created_at,
        }

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
            "len": len(norm_name),
        })

    # Jalankan matching CPU-bound di threadpool agar event loop tidak terblokir
    pairs = await asyncio.to_thread(
        _compute_master_item_duplicates,
        items_data,
        min_score,
        limit,
        supplier_item_ids,
        strict_supplier,
    )

    return {
        "ok": True,
        "total_duplicates": len(pairs),
        "pairs": pairs,
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

    # 2b. Kemasan: materialisasi item lama -> validasi satuan resep -> pindahkan varian (id tetap)
    await _materialize_legacy_packaging(db, [target, *sources])
    merge_base_unit = _resolve_merge_base_unit(target, sources)
    _assert_packaging_units_compatible(target, sources, merge_base_unit)
    pkg_stats = await _merge_packagings(db, target, sources, merge_base_unit)

    # 2c. Alihkan tautan resep menu & request belanja agar tidak terputus (FK SET NULL saat sumber dihapus)
    menu_ing_res = await db.execute(
        update(MenuIngredient)
        .where(MenuIngredient.master_item_id.in_(clean_source_ids))
        .values(master_item_id=target.id)
    )
    pr_item_res = await db.execute(
        update(PurchaseRequestItem)
        .where(PurchaseRequestItem.master_item_id.in_(clean_source_ids))
        .values(master_item_id=target.id)
    )
    menu_ingredients_reassigned = int(menu_ing_res.rowcount or 0)
    purchase_request_items_reassigned = int(pr_item_res.rowcount or 0)

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

    adopted_satuan_resep = target.satuan_resep
    adopted_konversi_resep = target.konversi_resep
    if not adopted_satuan_resep or not adopted_konversi_resep:
        for s in sources:
            if s.satuan_resep and s.konversi_resep and s.konversi_resep > 0:
                adopted_satuan_resep = adopted_satuan_resep or s.satuan_resep
                adopted_konversi_resep = adopted_konversi_resep or s.konversi_resep
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
    # Bila item punya varian kemasan, field legacy mengikuti varian default (kecuali dioverride eksplisit)
    has_pkgs = bool(target.packagings)
    if adopted_satuan_beli is not None and (not has_pkgs or custom_satuan_beli is not None):
        target.satuan_beli = adopted_satuan_beli or "Pcs"
    if adopted_tipe_satuan is not None:
        target.tipe_satuan = adopted_tipe_satuan or "keduanya"
    if adopted_isi_paket is not None:
        target.isi_paket = adopted_isi_paket
    if adopted_satuan_ecer is not None and (not has_pkgs or custom_satuan_ecer is not None):
        target.satuan_ecer = adopted_satuan_ecer or "Pcs"
    if not has_pkgs:
        if adopted_satuan_resep is not None:
            target.satuan_resep = adopted_satuan_resep
        if adopted_konversi_resep is not None:
            target.konversi_resep = adopted_konversi_resep
    if merge_aliases:
        target.aliases = final_aliases_str

    await db.flush()

    # Ambil ulang stats target dari transaksi paling baru secara akurat
    t_stats_map = await get_master_items_latest_stats(db, [target])
    t_stats = t_stats_map.get(target.id, {})
    tx_count = int(t_stats.get("tx_count") or 0)
    last_unit_price = float(t_stats.get("last_unit_price") or 0.0)
    last_supplier = t_stats.get("last_supplier") or target.default_supplier or "-"

    # Catat audit log penggabungan item baku
    log = ExpenseLog(
        expense_id=None,
        action="MERGE_MASTER_ITEMS",
        actor="system",
        details=(
            f"Menggabungkan {len(sources)} item duplikat ({', '.join(source_names)}) ke #{target.id} '{target.item_name}'. "
            f"Sebanyak {reassigned_count} transaksi belanja dialihkan."
        ),
    )
    db.add(log)
    await db.flush()

    recipe_unit_price = (
        round(last_unit_price / float(target.konversi_resep), 4)
        if last_unit_price > 0 and target.konversi_resep and float(target.konversi_resep) > 0
        else None
    )

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
        "satuan_resep": target.satuan_resep,
        "konversi_resep": target.konversi_resep,
        "recipe_unit_price": recipe_unit_price,
        "last_unit_price": last_unit_price,
        "last_supplier": last_supplier,
        "tx_count": tx_count,
        "packagings": serialize_master_item_packagings(
            target, t_stats.get("packaging_last_prices") or {}
        ),
        "created_at": target.created_at,
    }

    return {
        "ok": True,
        "message": (
            f"Berhasil menggabungkan {len(sources)} item ke '{target.item_name}'. "
            f"{reassigned_count} transaksi dialihkan, "
            f"{len(target.packagings)} varian kemasan."
        ),
        "target_item": target_resp,
        "merged_sources": source_names,
        "expenses_reassigned_count": reassigned_count,
        "aliases_added": aliases_added,
        "packagings_moved": pkg_stats["packagings_moved"],
        "packagings_deduped": pkg_stats["packagings_deduped"],
        "menu_ingredients_reassigned": menu_ingredients_reassigned,
        "purchase_request_items_reassigned": purchase_request_items_reassigned,
    }


async def bulk_upsert_master_items(
    db: AsyncSession,
    items: list[dict[str, Any]],
    default_category: str = "Bahan Kue",
    update_existing: bool = True,
) -> dict[str, Any]:
    """Tambah atau perbarui banyak Master Item terstruktur sekaligus."""
    existing_items = await list_master_items(db)
    existing_map = {m.item_name.strip().lower(): m for m in existing_items}
    valid_cats = {c.lower(): c for c in settings.valid_categories}

    added = 0
    updated = 0
    skipped = 0

    for raw in items:
        name = str(raw.get("item_name") or "").strip()
        if not name:
            skipped += 1
            continue

        raw_cat = str(raw.get("category") or default_category).strip()
        cat = valid_cats.get(raw_cat.lower(), default_category)
        raw_beli = str(raw.get("satuan_beli") or "Pcs").strip() or "Pcs"
        satuan_beli = (await normalize_unit_to_master(db, raw_beli)) or "Pcs"
        raw_ecer = str(raw.get("satuan_ecer") or "Pcs").strip() or "Pcs"
        satuan_ecer = (await normalize_unit_to_master(db, raw_ecer)) or "Pcs"
        raw_tipe = str(raw.get("tipe_satuan") or "keduanya").strip().lower()
        tipe_satuan = raw_tipe if raw_tipe in ("paket", "ecer", "keduanya") else "keduanya"
        isi_paket = str(raw.get("isi_paket") or "").strip()
        default_supplier = str(raw.get("default_supplier") or "-").strip() or "-"
        aliases = str(raw.get("aliases") or "").strip()
        satuan_resep = normalize_recipe_unit(raw.get("satuan_resep"))
        raw_konv = raw.get("konversi_resep")
        konversi_resep: float | None = None
        if raw_konv is not None and str(raw_konv).strip() != "":
            try:
                parsed_konv = float(str(raw_konv).replace(",", "."))
                if parsed_konv > 0:
                    konversi_resep = round(parsed_konv, 6)
            except ValueError:
                konversi_resep = None

        key = name.lower()
        if key in existing_map:
            if not update_existing:
                skipped += 1
                continue
            m = existing_map[key]
            m.category = cat
            m.satuan_beli = satuan_beli
            m.satuan_ecer = satuan_ecer
            m.tipe_satuan = tipe_satuan
            if isi_paket:
                m.isi_paket = isi_paket
            if satuan_resep:
                m.satuan_resep = satuan_resep
            if konversi_resep is not None:
                m.konversi_resep = konversi_resep
            if default_supplier and default_supplier != "-":
                m.default_supplier = default_supplier
            if aliases:
                m.aliases = aliases
            updated += 1
        else:
            if not satuan_resep and konversi_resep is None:
                satuan_resep, konversi_resep = infer_recipe_unit_conversion(
                    satuan_beli, satuan_ecer, isi_paket, name
                )
            new_m = MasterItem(
                item_name=name,
                category=cat,
                default_supplier=default_supplier,
                aliases=aliases,
                satuan_beli=satuan_beli,
                tipe_satuan=tipe_satuan,
                isi_paket=isi_paket,
                satuan_ecer=satuan_ecer,
                satuan_resep=satuan_resep,
                konversi_resep=konversi_resep,
            )
            db.add(new_m)
            existing_map[key] = new_m
            added += 1

    await db.flush()
    return {
        "ok": True,
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "total": len(existing_map),
        "message": f"Import Master Item selesai: {added} ditambahkan, {updated} diperbarui, {skipped} dilewati.",
    }


def generate_master_item_csv_template() -> str:
    """Bangun template CSV siap isi untuk import Katalog Master Item."""
    from app.utils.csv_helpers import build_csv_template

    return build_csv_template([
        "Nama Item",
        "Kategori",
        "Satuan Beli",
        "Tipe Satuan (paket/ecer/keduanya)",
        "Isi Paket",
        "Satuan Ecer",
        "Satuan Resep",
        "Konversi Resep",
        "Supplier Default",
        "Alias",
    ])


async def import_master_items_from_csv(
    db: AsyncSession,
    content: bytes,
    default_category: str = "Bahan Kue",
    update_existing: bool = True,
) -> dict[str, Any]:
    """Import banyak Master Item dari file CSV."""
    from app.utils.csv_helpers import (
        col_lookup,
        find_header_row,
        get_cell,
        parse_csv_table,
    )

    first_row, rest_rows = parse_csv_table(content)
    all_rows = [first_row, *rest_rows]
    hdr_idx, headers = find_header_row(all_rows, ("nama item", "item_name", "nama barang", "item"))

    idx_name = col_lookup(headers, "nama item", "item_name", "nama barang", "item", "nama")
    idx_cat = col_lookup(headers, "kategori", "category")
    idx_beli = col_lookup(headers, "satuan beli", "satuan_beli", "satuan")
    idx_tipe = col_lookup(headers, "tipe satuan", "tipe_satuan", "tipe")
    idx_isi = col_lookup(headers, "isi paket", "isi_paket", "isi")
    idx_ecer = col_lookup(headers, "satuan ecer", "satuan_ecer", "ecer")
    idx_resep = col_lookup(headers, "satuan resep", "satuan_resep", "resep")
    idx_konv = col_lookup(headers, "konversi resep", "konversi_resep", "konversi")
    idx_sup = col_lookup(headers, "supplier default", "default_supplier", "supplier", "toko")
    idx_alias = col_lookup(headers, "alias", "aliases")

    if idx_name is None:
        raise ValueError("Kolom 'Nama Item' tidak ditemukan di file CSV.")

    items_payload: list[dict[str, Any]] = []
    for row in all_rows[hdr_idx + 1:]:
        if not any(c.strip() for c in row):
            continue
        name = get_cell(row, idx_name)
        if not name:
            continue
        items_payload.append({
            "item_name": name,
            "category": get_cell(row, idx_cat) or default_category,
            "satuan_beli": get_cell(row, idx_beli) or "Pcs",
            "tipe_satuan": get_cell(row, idx_tipe) or "keduanya",
            "isi_paket": get_cell(row, idx_isi),
            "satuan_ecer": get_cell(row, idx_ecer) or "Pcs",
            "satuan_resep": get_cell(row, idx_resep),
            "konversi_resep": get_cell(row, idx_konv),
            "default_supplier": get_cell(row, idx_sup) or "-",
            "aliases": get_cell(row, idx_alias),
        })

    if not items_payload:
        raise ValueError("Tidak ada baris Master Item valid di dalam file CSV.")

    return await bulk_upsert_master_items(
        db,
        items_payload,
        default_category=default_category,
        update_existing=update_existing,
    )
