"""
app/services/menu_product_service.py — Layanan Database Menu / Produk, HPP / Food Cost, & Mode Anonim.
"""
import base64
import csv
import hashlib
import hmac
import io
import json
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.expense import Expense
from app.models.incoming_transaction import IncomingTransactionItem
from app.models.master_item import MasterItem
from app.models.menu_product import MenuIngredient, MenuProduct
from app.models.system_setting import SystemSetting
from app.services.sales_import_service import (
    _clean_str,
    _decode_csv_bytes,
    _detect_delimiter,
    _parse_number,
)

ANONYMIZE_LOCK_SETTING_KEY = "menu_anonymize_locked"
PRICE_DRIFT_THRESHOLD_PCT = 5.0

_UNIT_ALIASES: dict[str, str] = {
    "kg": "kg",
    "kilo": "kg",
    "kilogram": "kg",
    "g": "gram",
    "gr": "gram",
    "gram": "gram",
    "ons": "ons",
    "l": "liter",
    "lt": "liter",
    "liter": "liter",
    "ml": "ml",
    "cc": "ml",
    "lusin": "lusin",
    "lsn": "lusin",
    "kodi": "kodi",
    "gross": "gross",
    "pcs": "pcs",
    "pc": "pcs",
    "buah": "pcs",
    "butir": "pcs",
    "biji": "pcs",
    "lembar": "lembar",
    "lbr": "lembar",
    "sachet": "sachet",
    "pouch": "pouch",
    "pack": "pack",
    "box": "box",
    "bks": "bungkus",
    "bungkus": "bungkus",
    "botol": "botol",
    "kaleng": "kaleng",
    "roll": "roll",
    "meter": "meter",
    "m": "meter",
    "cm": "cm",
}

_COUNT_UNITS = {"pcs", "lembar", "sachet", "pouch", "pack", "bungkus", "botol", "kaleng"}


def _canon_unit(raw: str | None) -> str:
    cleaned = re.sub(r"[^a-z]", "", (raw or "").strip().lower())
    return _UNIT_ALIASES.get(cleaned, cleaned)


def _convert_unit_factor(from_unit: str, to_unit: str) -> float | None:
    if not from_unit or not to_unit:
        return None
    if from_unit == to_unit:
        return 1.0
    direct_pairs: dict[tuple[str, str], float] = {
        ("kg", "gram"): 1000.0,
        ("kg", "ons"): 10.0,
        ("ons", "gram"): 100.0,
        ("liter", "ml"): 1000.0,
        ("meter", "cm"): 100.0,
        ("lusin", "pcs"): 12.0,
        ("kodi", "pcs"): 20.0,
        ("gross", "pcs"): 144.0,
    }
    if (from_unit, to_unit) in direct_pairs:
        return direct_pairs[(from_unit, to_unit)]
    if from_unit == "lusin" and to_unit in _COUNT_UNITS:
        return 12.0
    if from_unit == "kodi" and to_unit in _COUNT_UNITS:
        return 20.0
    if from_unit == "gross" and to_unit in _COUNT_UNITS:
        return 144.0
    return None


def _parse_isi_paket_segments(isi_paket: str | None, target_unit: str) -> float | None:
    """Parse faktor konversi dari isi_paket MasterItem (mis. '500g', '6 pouch @ 2kg', '100 Pcs')."""
    if not isi_paket or not isi_paket.strip():
        return None

    for seg in re.split(r"[,;]", isi_paket):
        s = seg.strip()
        if not s:
            continue

        # Pola perkalian: '6 pouch @ 2kg' atau '10 x 500g'
        m_mult = re.search(
            r"(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s*(?:x|@)\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)",
            s,
            re.IGNORECASE,
        )
        if m_mult:
            outer_qty = float(m_mult.group(1).replace(",", "."))
            outer_unit = _canon_unit(m_mult.group(2) or "")
            inner_qty = float(m_mult.group(3).replace(",", "."))
            inner_unit = _canon_unit(m_mult.group(4))
            if outer_unit and outer_unit == target_unit and outer_qty > 0:
                return outer_qty
            conv = _convert_unit_factor(inner_unit, target_unit)
            if conv is not None and outer_qty > 0 and inner_qty > 0:
                return round(outer_qty * inner_qty * conv, 4)

        # Pola tunggal: '500g', '1Kg', '100 Pcs'
        m_single = re.search(r"(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)", s)
        if m_single:
            qty_val = float(m_single.group(1).replace(",", "."))
            unit_val = _canon_unit(m_single.group(2))
            conv = _convert_unit_factor(unit_val, target_unit)
            if conv is not None and qty_val > 0:
                return round(qty_val * conv, 4)

    return None


def suggest_yield_factor(
    satuan_beli: str | None,
    satuan_ecer: str | None,
    isi_paket: str | None,
    recipe_unit: str | None,
) -> tuple[float, str]:
    """
    Hitung saran pembagi kemasan (yield_factor) berdasarkan satuan beli MasterItem dan satuan resep.
    Contoh: satuan_beli='Kg', recipe_unit='Gram' -> (1000.0, 'Auto: 1 Kg = 1.000 Gram').
    """
    buy_canon = _canon_unit(satuan_beli)
    rec_canon = _canon_unit(recipe_unit)
    ecer_canon = _canon_unit(satuan_ecer)

    if not rec_canon:
        return 1.0, "Default 1"

    if buy_canon and buy_canon == rec_canon:
        return 1.0, f"Satuan beli & resep sama ({satuan_beli})"

    direct = _convert_unit_factor(buy_canon, rec_canon)
    if direct is not None:
        return direct, f"Auto: 1 {satuan_beli or buy_canon} = {direct:g} {recipe_unit}"

    parsed_isi = _parse_isi_paket_segments(isi_paket, rec_canon)
    if parsed_isi is not None and parsed_isi > 0:
        return parsed_isi, f"Auto dari isi paket ({isi_paket}): {parsed_isi:g} {recipe_unit}"

    if ecer_canon and ecer_canon != buy_canon:
        ecer_conv = _convert_unit_factor(ecer_canon, rec_canon)
        if ecer_conv is not None and ecer_conv != 1.0:
            return ecer_conv, f"Auto: 1 {satuan_ecer} = {ecer_conv:g} {recipe_unit}"

    return 1.0, "Default 1 (sesuaikan pembagi jika beda ukuran kemasan)"


def _format_anon_code(prefix: str, number: int) -> str:
    clean_prefix = re.sub(r"[^A-Za-z0-9_-]", "", (prefix or "MENU").strip().upper()) or "MENU"
    return f"{clean_prefix}-{number:03d}"


def generate_next_anonymous_code(existing_codes: set[str], prefix: str = "MENU") -> str:
    """Hasilkan kode anonim unik berikutnya (mis. MENU-001, MENU-002)."""
    lowered = {c.strip().lower() for c in existing_codes if c}
    idx = 1
    while True:
        candidate = _format_anon_code(prefix, idx)
        if candidate.lower() not in lowered:
            existing_codes.add(candidate)
            return candidate
        idx += 1


async def get_existing_anonymous_codes(db: AsyncSession) -> set[str]:
    res = await db.execute(select(MenuProduct.anonymous_name))
    return {row[0] for row in res.fetchall() if row[0]}


async def build_master_price_history_map(db: AsyncSession) -> dict[int, dict[str, Any]]:
    """
    Ambil 2 harga beli unit terbaru dari tabel expenses untuk setiap master_item_id
    guna mendeteksi kenaikan harga bahan baku (Price Drift).
    """
    res = await db.execute(
        select(Expense.master_item_id, Expense.unit_price, Expense.expense_date)
        .where(
            Expense.master_item_id.is_not(None),
            Expense.unit_price > 0,
        )
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    grouped: dict[int, list[tuple[float, str | None]]] = {}
    for mid, unit_price, exp_date in res.fetchall():
        if mid is None:
            continue
        key = int(mid)
        entries = grouped.setdefault(key, [])
        if len(entries) < 2:
            entries.append((float(unit_price or 0.0), exp_date.isoformat() if exp_date else None))

    history_map: dict[int, dict[str, Any]] = {}
    for mid, entries in grouped.items():
        latest_price, latest_date = entries[0]
        prev_price = entries[1][0] if len(entries) > 1 else None
        prev_date = entries[1][1] if len(entries) > 1 else None
        change_pct: float | None = None
        has_increase = False
        if prev_price is not None and prev_price > 0:
            change_pct = round(((latest_price - prev_price) / prev_price) * 100.0, 1)
            has_increase = change_pct >= PRICE_DRIFT_THRESHOLD_PCT
        history_map[mid] = {
            "latest_price": round(latest_price, 2),
            "latest_date": latest_date,
            "prev_price": round(prev_price, 2) if prev_price is not None else None,
            "prev_date": prev_date,
            "price_change_pct": change_pct,
            "has_price_increase": has_increase,
        }
    return history_map


async def build_master_latest_price_map(db: AsyncSession) -> dict[int, float]:
    """Ambil harga beli unit terbaru dari tabel expenses untuk setiap master_item_id."""
    hist = await build_master_price_history_map(db)
    return {mid: float(info["latest_price"]) for mid, info in hist.items()}


def compute_menu_financials(
    menu: MenuProduct,
    master_price_map: dict[int, float],
    price_history_map: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Hitung HPP resep, HPP efektif, food cost %, margin kotor, dan deteksi kenaikan harga bahan."""
    ingredient_rows: list[dict[str, Any]] = []
    recipe_hpp = 0.0
    drift_count = 0
    max_increase_pct = 0.0

    for ing in menu.ingredients or []:
        hist_info = (
            price_history_map.get(ing.master_item_id, {})
            if (price_history_map and ing.master_item_id is not None)
            else {}
        )
        master_latest = (
            float(hist_info.get("latest_price", 0.0))
            if hist_info
            else (
                master_price_map.get(ing.master_item_id, 0.0)
                if ing.master_item_id is not None
                else 0.0
            )
        )
        has_override = ing.unit_cost_override is not None
        effective_unit_cost = (
            float(ing.unit_cost_override) if has_override else float(master_latest)
        )
        safe_yield = float(ing.yield_factor) if (ing.yield_factor and ing.yield_factor > 0) else 1.0
        qty = float(ing.qty or 0.0)
        line_cost = round((qty / safe_yield) * effective_unit_cost, 2)
        recipe_hpp += line_cost

        prev_price = hist_info.get("prev_price") if not has_override else None
        change_pct = hist_info.get("price_change_pct") if not has_override else None
        drift_alert = bool(
            not has_override
            and hist_info.get("has_price_increase")
            and change_pct is not None
            and change_pct >= PRICE_DRIFT_THRESHOLD_PCT
        )
        if drift_alert and change_pct is not None:
            drift_count += 1
            if change_pct > max_increase_pct:
                max_increase_pct = float(change_pct)

        ingredient_rows.append(
            {
                "id": ing.id,
                "menu_id": ing.menu_id,
                "master_item_id": ing.master_item_id,
                "master_item_name": ing.master_item.item_name if ing.master_item else None,
                "ingredient_name": ing.ingredient_name,
                "qty": qty,
                "unit": ing.unit,
                "unit_cost_override": float(ing.unit_cost_override) if has_override else None,
                "master_latest_price": round(master_latest, 2),
                "master_prev_price": prev_price,
                "price_change_pct": change_pct,
                "price_drift_alert": drift_alert,
                "effective_unit_cost": round(effective_unit_cost, 2),
                "yield_factor": safe_yield,
                "line_cost": line_cost,
                "notes": ing.notes,
            }
        )

    recipe_hpp = round(recipe_hpp, 2)
    hpp_manual = round(float(menu.hpp_manual or 0.0), 2)
    has_recipe = len(ingredient_rows) > 0
    mode = (menu.hpp_mode or "auto").strip().lower()
    if mode not in ("auto", "manual", "recipe"):
        mode = "auto"

    if mode == "manual":
        effective_hpp = hpp_manual
        active_source = "manual"
    elif mode == "recipe":
        effective_hpp = recipe_hpp
        active_source = "recipe"
    else:
        if has_recipe:
            effective_hpp = recipe_hpp
            active_source = "recipe"
        else:
            effective_hpp = hpp_manual
            active_source = "manual"

    selling_price = round(float(menu.selling_price or 0.0), 2)
    gross_margin = round(selling_price - effective_hpp, 2)
    food_cost_pct = round((effective_hpp / selling_price) * 100.0, 1) if selling_price > 0 else 0.0
    margin_pct = round((gross_margin / selling_price) * 100.0, 1) if selling_price > 0 else 0.0

    if selling_price <= 0:
        fc_status = "no_price"
    elif effective_hpp <= 0:
        fc_status = "no_hpp"
    elif food_cost_pct <= 35.0:
        fc_status = "ideal"
    elif food_cost_pct <= 45.0:
        fc_status = "moderate"
    else:
        fc_status = "high"

    return {
        "ingredients": ingredient_rows,
        "ingredient_count": len(ingredient_rows),
        "recipe_hpp": recipe_hpp,
        "hpp_manual": hpp_manual,
        "hpp_mode": mode,
        "active_hpp_source": active_source,
        "effective_hpp": round(effective_hpp, 2),
        "selling_price": selling_price,
        "gross_margin": gross_margin,
        "food_cost_pct": food_cost_pct,
        "margin_pct": margin_pct,
        "food_cost_status": fc_status,
        "has_price_drift": drift_count > 0,
        "price_drift_count": drift_count,
        "max_ingredient_increase_pct": round(max_increase_pct, 1),
    }


def serialize_menu_product(
    menu: MenuProduct,
    master_price_map: dict[int, float],
    anonymize: bool = False,
    price_history_map: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Serialisasi menu/produk; saat anonymize=True, nama asli, SKU, catatan, dan nama bahan disamarkan."""
    fin = compute_menu_financials(menu, master_price_map, price_history_map=price_history_map)

    if anonymize:
        masked_ingredients = [
            {
                **ing,
                "master_item_id": None,
                "master_item_name": None,
                "ingredient_name": f"Bahan #{idx + 1}",
                "notes": None,
            }
            for idx, ing in enumerate(fin["ingredients"])
        ]
        return {
            "id": menu.id,
            "name": menu.anonymous_name,
            "display_name": menu.anonymous_name,
            "anonymous_name": menu.anonymous_name,
            "sku": None,
            "category": menu.category,
            "product_group": menu.product_group,
            "unit": menu.unit,
            "notes": None,
            "is_active": menu.is_active,
            "is_anonymized": True,
            "created_at": menu.created_at.isoformat() if menu.created_at else None,
            "updated_at": menu.updated_at.isoformat() if menu.updated_at else None,
            **fin,
            "ingredients": masked_ingredients,
        }

    return {
        "id": menu.id,
        "name": menu.name,
        "display_name": menu.name,
        "anonymous_name": menu.anonymous_name,
        "sku": menu.sku,
        "category": menu.category,
        "product_group": menu.product_group,
        "unit": menu.unit,
        "notes": menu.notes,
        "is_active": menu.is_active,
        "is_anonymized": False,
        "created_at": menu.created_at.isoformat() if menu.created_at else None,
        "updated_at": menu.updated_at.isoformat() if menu.updated_at else None,
        **fin,
    }


async def load_menu_with_ingredients(db: AsyncSession, menu_id: int) -> MenuProduct | None:
    """Ambil MenuProduct beserta seluruh ingredients & master_item secara eager-load."""
    res = await db.execute(
        select(MenuProduct)
        .options(selectinload(MenuProduct.ingredients).joinedload(MenuIngredient.master_item))
        .where(MenuProduct.id == menu_id)
        .execution_options(populate_existing=True)
    )
    return res.scalar_one_or_none()


async def sync_menu_ingredients(
    db: AsyncSession,
    menu: MenuProduct,
    ingredients_payload: list[dict[str, Any]],
) -> None:
    """Ganti daftar bahan resep pada menu dengan payload baru dan kaitkan ke MasterItem jika ada."""
    master_ids = [
        int(it["master_item_id"])
        for it in ingredients_payload
        if it.get("master_item_id") is not None
    ]
    master_map: dict[int, MasterItem] = {}
    if master_ids:
        res = await db.execute(select(MasterItem).where(MasterItem.id.in_(master_ids)))
        master_map = {m.id: m for m in res.scalars().all()}

    await db.execute(delete(MenuIngredient).where(MenuIngredient.menu_id == menu.id))
    await db.flush()

    for item in ingredients_payload:
        mid = item.get("master_item_id")
        master_obj = master_map.get(int(mid)) if mid is not None else None
        raw_name = (item.get("ingredient_name") or "").strip()
        ing_name = raw_name or (master_obj.item_name if master_obj else "")
        if not ing_name:
            continue
        unit_val = (item.get("unit") or "").strip() or (
            (master_obj.satuan_ecer or master_obj.satuan_beli) if master_obj else "Gram"
        )
        yield_val = float(item.get("yield_factor") or 1.0)
        if yield_val <= 0:
            yield_val = 1.0
        override_raw = item.get("unit_cost_override")
        override_val = float(override_raw) if override_raw is not None else None

        db.add(
            MenuIngredient(
                menu_id=menu.id,
                master_item_id=master_obj.id if master_obj else None,
                ingredient_name=ing_name,
                qty=float(item.get("qty") or 0.0),
                unit=unit_val,
                unit_cost_override=override_val,
                yield_factor=yield_val,
                notes=(item.get("notes") or "").strip() or None,
            )
        )
    await db.flush()


async def regenerate_anonymous_names(
    db: AsyncSession,
    prefix: str = "MENU",
    preserve_custom: bool = False,
) -> int:
    """Generate ulang nama anonim berurutan (MENU-001, MENU-002, ...) tanpa bentrok unique constraint."""
    res = await db.execute(select(MenuProduct).order_by(MenuProduct.id.asc()))
    menus = res.scalars().all()
    if not menus:
        return 0

    if preserve_custom:
        existing = {m.anonymous_name for m in menus if m.anonymous_name}
        updated = 0
        for m in menus:
            if not m.anonymous_name or not m.anonymous_name.strip():
                m.anonymous_name = generate_next_anonymous_code(existing, prefix=prefix)
                updated += 1
        await db.flush()
        return updated

    # Two-phase rename untuk menghindari tabrakan UNIQUE constraint saat re-numbering
    temp_tag = uuid4().hex[:8]
    for m in menus:
        m.anonymous_name = f"__TMP_{temp_tag}_{m.id}"
    await db.flush()

    for idx, m in enumerate(menus, start=1):
        m.anonymous_name = _format_anon_code(prefix, idx)
    await db.flush()
    return len(menus)


async def import_menus_from_pos_history(db: AsyncSession) -> dict[str, int]:
    """Tarik daftar produk unik dari tabel incoming_transaction_items ke database Menu / Produk."""
    from sqlalchemy import func

    res = await db.execute(
        select(
            IncomingTransactionItem.product_name,
            func.max(IncomingTransactionItem.category),
            func.max(IncomingTransactionItem.product_group),
            func.max(IncomingTransactionItem.sku),
            func.max(IncomingTransactionItem.unit_price),
        )
        .group_by(IncomingTransactionItem.product_name)
        .order_by(IncomingTransactionItem.product_name.asc())
    )
    pos_rows = res.fetchall()
    if not pos_rows:
        return {"added": 0, "skipped": 0, "total_pos_products": 0}

    existing_res = await db.execute(select(MenuProduct.name, MenuProduct.anonymous_name))
    existing_rows = existing_res.fetchall()
    existing_names = {r[0].strip().lower() for r in existing_rows if r[0]}
    existing_codes = {r[1] for r in existing_rows if r[1]}

    added = 0
    skipped = 0
    for prod_name, cat, pgroup, sku, unit_price in pos_rows:
        clean_name = (prod_name or "").strip()
        if not clean_name:
            continue
        if clean_name.lower() in existing_names:
            skipped += 1
            continue

        anon_code = generate_next_anonymous_code(existing_codes)
        menu = MenuProduct(
            name=clean_name,
            anonymous_name=anon_code,
            sku=(sku or "").strip() or None,
            category=(cat or "").strip() or "Lainnya",
            product_group=(pgroup or "").strip() or None,
            unit="Porsi",
            selling_price=float(unit_price or 0.0),
            hpp_manual=0.0,
            hpp_mode="auto",
            is_active=True,
        )
        db.add(menu)
        existing_names.add(clean_name.lower())
        added += 1

    await db.flush()
    return {
        "added": added,
        "skipped": skipped,
        "total_pos_products": len(pos_rows),
    }


def _col_lookup(headers: list[str], *candidates: str) -> int | None:
    lower_headers = [h.strip().lower() for h in headers]
    for cand in candidates:
        c = cand.lower()
        for idx, h in enumerate(lower_headers):
            if h == c:
                return idx
    for cand in candidates:
        c = cand.lower()
        for idx, h in enumerate(lower_headers):
            if c in h:
                return idx
    return None


async def import_menus_from_csv(
    db: AsyncSession,
    content: bytes,
    update_existing: bool = True,
) -> dict[str, Any]:
    """Import atau update database Menu/Produk & HPP dari file CSV."""
    text = _decode_csv_bytes(content)
    lines = text.splitlines()
    delim = _detect_delimiter(lines)
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows:
        raise ValueError("File CSV kosong.")

    header_idx = -1
    for idx, r in enumerate(rows[:20]):
        norm = [c.strip().lower() for c in r if c and c.strip()]
        if any(
            k in cell
            for cell in norm
            for k in ("nama menu", "nama produk", "product_name", "menu", "name")
        ):
            header_idx = idx
            break

    if header_idx < 0:
        raise ValueError(
            "Header kolom nama menu/produk tidak ditemukan. Gunakan kolom seperti 'Nama Menu' atau 'Nama Produk'."
        )

    headers = rows[header_idx]
    idx_name = _col_lookup(headers, "nama menu", "nama produk", "product_name", "menu", "name", "nama")
    idx_anon = _col_lookup(headers, "nama anonim", "kode anonim", "anonymous_name", "anonim", "kode")
    idx_cat = _col_lookup(headers, "kategori", "category", "kategori produk")
    idx_group = _col_lookup(headers, "grup produk", "grup", "product_group", "group")
    idx_sku = _col_lookup(headers, "sku produk", "sku")
    idx_unit = _col_lookup(headers, "satuan", "unit")
    idx_price = _col_lookup(headers, "harga jual", "selling_price", "harga", "price")
    idx_hpp = _col_lookup(headers, "hpp", "food cost", "food_cost", "hpp_manual", "modal")
    idx_notes = _col_lookup(headers, "catatan", "notes", "keterangan")

    if idx_name is None:
        raise ValueError("Kolom 'Nama Menu' / 'Nama Produk' tidak ditemukan.")

    existing_res = await db.execute(select(MenuProduct))
    existing_menus = existing_res.scalars().all()
    by_name = {m.name.strip().lower(): m for m in existing_menus}
    existing_codes = {m.anonymous_name for m in existing_menus if m.anonymous_name}

    added = 0
    updated = 0
    skipped = 0

    def cell(r: list[str], i: int | None) -> str:
        if i is None or i >= len(r):
            return ""
        return r[i].strip()

    for r in rows[header_idx + 1 :]:
        if not any(c.strip() for c in r):
            continue
        raw_name = cell(r, idx_name)
        if not raw_name or raw_name.upper() == "TOTAL":
            continue

        key = raw_name.lower()
        anon_raw = _clean_str(cell(r, idx_anon))
        cat_raw = _clean_str(cell(r, idx_cat))
        group_raw = _clean_str(cell(r, idx_group))
        sku_raw = _clean_str(cell(r, idx_sku))
        unit_raw = _clean_str(cell(r, idx_unit))
        notes_raw = _clean_str(cell(r, idx_notes))
        price_val = _parse_number(cell(r, idx_price)) if idx_price is not None else 0.0
        hpp_val = _parse_number(cell(r, idx_hpp)) if idx_hpp is not None else 0.0

        existing_menu = by_name.get(key)
        if existing_menu:
            if not update_existing:
                skipped += 1
                continue
            if cat_raw:
                existing_menu.category = cat_raw
            if group_raw:
                existing_menu.product_group = group_raw
            if sku_raw:
                existing_menu.sku = sku_raw
            if unit_raw:
                existing_menu.unit = unit_raw
            if idx_price is not None and cell(r, idx_price):
                existing_menu.selling_price = price_val
            if idx_hpp is not None and cell(r, idx_hpp):
                existing_menu.hpp_manual = hpp_val
            if notes_raw:
                existing_menu.notes = notes_raw
            if anon_raw and anon_raw.lower() not in {c.lower() for c in existing_codes}:
                existing_codes.discard(existing_menu.anonymous_name)
                existing_menu.anonymous_name = anon_raw
                existing_codes.add(anon_raw)
            updated += 1
        else:
            if anon_raw and anon_raw.lower() not in {c.lower() for c in existing_codes}:
                anon_code = anon_raw
                existing_codes.add(anon_code)
            else:
                anon_code = generate_next_anonymous_code(existing_codes)

            new_menu = MenuProduct(
                name=raw_name,
                anonymous_name=anon_code,
                sku=sku_raw,
                category=cat_raw or "Lainnya",
                product_group=group_raw,
                unit=unit_raw or "Porsi",
                selling_price=price_val,
                hpp_manual=hpp_val,
                hpp_mode="auto",
                notes=notes_raw,
                is_active=True,
            )
            db.add(new_menu)
            by_name[key] = new_menu
            added += 1

    await db.flush()
    return {"added": added, "updated": updated, "skipped": skipped}


def generate_menu_csv_template() -> str:
    """Bangun template CSV siap isi untuk import Menu / Produk & HPP."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Nama Menu",
            "Kode Anonim",
            "SKU",
            "Kategori",
            "Grup Produk",
            "Satuan",
            "Harga Jual",
            "HPP",
            "Catatan",
        ]
    )
    return "\ufeff" + buf.getvalue()


def export_menus_to_csv(
    serialized_menus: list[dict[str, Any]],
    anonymize: bool = False,
) -> str:
    """Bangun string CSV UTF-8 (dengan BOM) untuk daftar menu/produk dan HPP."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Kode Anonim" if anonymize else "Nama Menu / Produk",
            "Kode Anonim" if not anonymize else "Status Nama",
            "SKU" if not anonymize else "SKU (Disamarkan)",
            "Kategori",
            "Grup Produk",
            "Satuan",
            "Harga Jual",
            "HPP / Food Cost",
            "Food Cost (%)",
            "Margin Kotor (Rp)",
            "Margin (%)",
            "Sumber HPP",
            "Jumlah Bahan Resep",
            "Status Aktif",
        ]
    )
    for m in serialized_menus:
        writer.writerow(
            [
                m["anonymous_name"] if anonymize else m["name"],
                "Anonim" if anonymize else m["anonymous_name"],
                "-" if anonymize else (m.get("sku") or "-"),
                m.get("category") or "Lainnya",
                m.get("product_group") or "-",
                m.get("unit") or "Porsi",
                round(float(m.get("selling_price") or 0.0), 2),
                round(float(m.get("effective_hpp") or 0.0), 2),
                round(float(m.get("food_cost_pct") or 0.0), 1),
                round(float(m.get("gross_margin") or 0.0), 2),
                round(float(m.get("margin_pct") or 0.0), 1),
                m.get("active_hpp_source") or "manual",
                int(m.get("ingredient_count") or 0),
                "Aktif" if m.get("is_active") else "Nonaktif",
            ]
        )
    return "\ufeff" + buf.getvalue()


def build_menus_json_export(
    items: list[dict[str, Any]],
    summary: dict[str, Any],
    anonymize: bool = False,
) -> dict[str, Any]:
    """Bangun payload JSON terstruktur untuk export normal maupun mode anonim."""
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "anonymized": anonymize,
        "summary": summary,
        "items": items,
    }


async def is_menu_anonymize_locked(db: AsyncSession) -> bool:
    row = await db.get(SystemSetting, ANONYMIZE_LOCK_SETTING_KEY)
    if not row or not row.value:
        return False
    return row.value.strip().lower() in ("1", "true", "yes", "on")


async def set_menu_anonymize_locked(db: AsyncSession, locked: bool) -> bool:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    row = await db.get(SystemSetting, ANONYMIZE_LOCK_SETTING_KEY)
    val = "true" if locked else "false"
    if row:
        row.value = val
        row.updated_at = now
    else:
        db.add(
            SystemSetting(
                key=ANONYMIZE_LOCK_SETTING_KEY,
                value=val,
                created_at=now,
                updated_at=now,
            )
        )
    await db.commit()
    return locked


def create_menu_share_token(expire_hours: int = 24, secret_key: str | None = None) -> str:
    """Buat HMAC-SHA256 read-only share token untuk tampilan menu ter-anonim tanpa login."""
    key = secret_key or settings.secret_key
    now_ts = int(time.time())
    safe_hours = max(1, min(int(expire_hours or 24), 24 * 30))
    payload = {
        "purpose": "menu_anon_readonly",
        "iat": now_ts,
        "exp": now_ts + (safe_hours * 3600),
        "nonce": secrets.token_hex(8),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    sig = hmac.new(key.encode("utf-8"), b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def verify_menu_share_token(token: str, secret_key: str | None = None) -> dict[str, Any] | None:
    """Verifikasi HMAC-SHA256 read-only share token; kembalikan payload bila valid & belum kadaluarsa."""
    if not token or "." not in token:
        return None
    try:
        b64_part, sig_part = token.split(".", 1)
        key = secret_key or settings.secret_key
        expected = hmac.new(key.encode("utf-8"), b64_part.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig_part, expected):
            return None
        padded = b64_part + "=" * ((4 - len(b64_part) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        if payload.get("purpose") != "menu_anon_readonly":
            return None
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None
