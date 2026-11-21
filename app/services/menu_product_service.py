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
PRICING_CHANNELS_SETTING_KEY = "menu_pricing_channels"
PRICE_DRIFT_THRESHOLD_PCT = 5.0
MAX_RECIPE_DEPTH = 5

DEFAULT_PRICING_CHANNELS: list[dict[str, Any]] = [
    {
        "key": "dine_in",
        "name": "Dine-in / Takeaway",
        "commission_pct": 0.0,
        "fixed_fee": 0.0,
        "extra_packaging": 0.0,
    },
    {
        "key": "gofood",
        "name": "GoFood",
        "commission_pct": 20.0,
        "fixed_fee": 1000.0,
        "extra_packaging": 0.0,
    },
    {
        "key": "grabfood",
        "name": "GrabFood",
        "commission_pct": 20.0,
        "fixed_fee": 0.0,
        "extra_packaging": 0.0,
    },
    {
        "key": "shopeefood",
        "name": "ShopeeFood",
        "commission_pct": 20.0,
        "fixed_fee": 0.0,
        "extra_packaging": 0.0,
    },
]

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
    satuan_resep: str | None = None,
    konversi_resep: float | None = None,
) -> tuple[float, str]:
    """
    Hitung saran pembagi kemasan (yield_factor) berdasarkan turunan satuan resep MasterItem, satuan beli, dan satuan resep.
    Contoh: satuan_beli='Kg', satuan_resep='Gram', konversi_resep=1000 -> (1000.0, 'Master Resep: 1 Kg = 1000 Gram').
    """
    buy_canon = _canon_unit(satuan_beli)
    rec_canon = _canon_unit(recipe_unit)
    ecer_canon = _canon_unit(satuan_ecer)

    if satuan_resep and konversi_resep is not None and float(konversi_resep) > 0:
        konv = float(konversi_resep)
        resep_canon = _canon_unit(satuan_resep)
        if not rec_canon or (resep_canon and resep_canon == rec_canon):
            return round(konv, 6), (
                f"Master Resep: 1 {satuan_beli or 'unit'} = {konv:g} {satuan_resep}"
            )
        if buy_canon and buy_canon == rec_canon:
            return 1.0, f"Satuan beli & resep sama ({satuan_beli})"
        direct_from_resep = _convert_unit_factor(resep_canon, rec_canon)
        if direct_from_resep is not None:
            factor = round(konv * direct_from_resep, 6)
            return factor, (
                f"Master Resep ({konv:g} {satuan_resep}): {factor:g} {recipe_unit}"
            )
        inverse_to_resep = _convert_unit_factor(rec_canon, resep_canon)
        if inverse_to_resep is not None and inverse_to_resep > 0:
            factor = round(konv / inverse_to_resep, 6)
            return factor, (
                f"Master Resep ({konv:g} {satuan_resep}): {factor:g} {recipe_unit}"
            )

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


def suggest_sub_menu_yield_factor(
    sub_yield_unit: str | None,
    recipe_unit: str | None,
) -> tuple[float, str]:
    """
    Hitung saran pembagi (yield_factor) ketika memakai menu/sub-resep lain sebagai bahan.
    Contoh: sub-resep yield dalam 'Kg' lalu dipakai dalam 'Gram' -> 1000.0.
    """
    sub_canon = _canon_unit(sub_yield_unit)
    rec_canon = _canon_unit(recipe_unit)

    if not rec_canon or not sub_canon:
        return 1.0, "Default 1"
    if sub_canon == rec_canon:
        return 1.0, f"Satuan hasil & resep sama ({sub_yield_unit})"

    direct = _convert_unit_factor(sub_canon, rec_canon)
    if direct is not None:
        return direct, f"Auto: 1 {sub_yield_unit} = {direct:g} {recipe_unit}"

    inverse = _convert_unit_factor(rec_canon, sub_canon)
    if inverse is not None and inverse > 0:
        factor = round(1.0 / inverse, 6)
        return factor, f"Auto: 1 {recipe_unit} = {inverse:g} {sub_yield_unit}"

    return 1.0, "Default 1 (sesuaikan pembagi jika beda satuan hasil)"


def default_anon_prefix(item_type: str | None) -> str:
    t = (item_type or "finished").strip().lower()
    if t == "prepared":
        return "PREP"
    if t == "bundle":
        return "PKT"
    return "MENU"


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


async def load_all_menus_graph(db: AsyncSession) -> dict[int, MenuProduct]:
    """Muat seluruh MenuProduct beserta ingredients dan master_item dalam satu query terpadu."""
    res = await db.execute(
        select(MenuProduct)
        .options(selectinload(MenuProduct.ingredients).joinedload(MenuIngredient.master_item))
        .order_by(MenuProduct.name.asc(), MenuProduct.id.asc())
        .execution_options(populate_existing=True)
    )
    menus = res.scalars().all()
    return {m.id: m for m in menus}


def validate_recipe_graph(
    target_menu_id: int | None,
    new_sub_menu_ids: list[int],
    menus_by_id: dict[int, MenuProduct],
    target_name: str = "Menu Baru",
) -> None:
    """
    Validasi graf BOM multi-level:
    - Semua sub_menu_id harus ada.
    - Menolak self-reference (A -> A) dan siklus tak berujung (A -> B -> A).
    - Menolak kedalaman hierarki melebihi MAX_RECIPE_DEPTH.
    """
    for sid in new_sub_menu_ids:
        if sid not in menus_by_id:
            raise ValueError(f"Sub-resep/produk dengan ID {sid} tidak ditemukan.")
        if target_menu_id is not None and sid == target_menu_id:
            raise ValueError(
                f"Menu '{target_name}' tidak boleh memakai dirinya sendiri sebagai bahan resep."
            )

    sim_key = target_menu_id if target_menu_id is not None else -1
    children_map: dict[int, list[int]] = {
        mid: [
            int(ing.sub_menu_id)
            for ing in (m.ingredients or [])
            if getattr(ing, "sub_menu_id", None) is not None
        ]
        for mid, m in menus_by_id.items()
    }
    children_map[sim_key] = list(dict.fromkeys(new_sub_menu_ids))

    name_map: dict[int, str] = {mid: m.name for mid, m in menus_by_id.items()}
    name_map[sim_key] = target_name

    height_cache: dict[int, int] = {}

    def _dfs_height(node: int, path: list[int], in_path: set[int]) -> int:
        if node in height_cache:
            return height_cache[node]
        max_child_h = 0
        for ch in children_map.get(node, []):
            if ch in in_path:
                cycle_ids = path[path.index(ch) :] + [ch]
                cycle_str = " -> ".join(name_map.get(cid, str(cid)) for cid in cycle_ids)
                raise ValueError(f"Siklus resep terdeteksi: {cycle_str}")
            in_path.add(ch)
            path.append(ch)
            ch_h = _dfs_height(ch, path, in_path)
            path.pop()
            in_path.remove(ch)
            if ch_h > max_child_h:
                max_child_h = ch_h
        h = 1 + max_child_h
        height_cache[node] = h
        return h

    # Cek subtree dari sim_key terlebih dahulu agar pesan siklusnya selalu dimulai dari item yang sedang diubah
    _dfs_height(sim_key, [sim_key], {sim_key})

    max_depth = 0
    for node_id in children_map:
        d = _dfs_height(node_id, [node_id], {node_id})
        if d > max_depth:
            max_depth = d

    if max_depth > MAX_RECIPE_DEPTH:
        raise ValueError(
            f"Kedalaman hierarki resep mencapai {max_depth} tingkat, melebihi batas maksimal {MAX_RECIPE_DEPTH} tingkat."
        )


def _build_sub_breakdown(
    sub_ingredients: list[dict[str, Any]],
    depth: int = 1,
    max_depth: int = 3,
) -> list[dict[str, Any]]:
    """Bangun preview struktur bahan turunan dari sub-resep untuk tampilan tree di UI."""
    rows: list[dict[str, Any]] = []
    for ing in sub_ingredients:
        nested: list[dict[str, Any]] = []
        if depth < max_depth and ing.get("sub_menu_breakdown"):
            nested = _build_sub_breakdown(
                ing["sub_menu_breakdown"], depth=depth + 1, max_depth=max_depth
            )
        rows.append(
            {
                "id": ing.get("id"),
                "ingredient_name": ing.get("ingredient_name"),
                "master_item_id": ing.get("master_item_id"),
                "sub_menu_id": ing.get("sub_menu_id"),
                "sub_menu_name": ing.get("sub_menu_name"),
                "sub_menu_item_type": ing.get("sub_menu_item_type"),
                "cost_group": ing.get("cost_group", "ingredient"),
                "qty": ing.get("qty"),
                "unit": ing.get("unit"),
                "yield_factor": ing.get("yield_factor", 1.0),
                "waste_pct": ing.get("waste_pct", 0.0),
                "line_cost": ing.get("line_cost", 0.0),
                "price_drift_alert": bool(ing.get("price_drift_alert")),
                "price_change_pct": ing.get("price_change_pct"),
                "drift_source": ing.get("drift_source"),
                "sub_menu_breakdown": nested,
            }
        )
    return rows


def resolve_all_menu_financials(
    menus_by_id: dict[int, MenuProduct],
    price_history_map: dict[int, dict[str, Any]],
    master_price_overrides: dict[int, float] | None = None,
) -> dict[int, dict[str, Any]]:
    """
    Hitung finansial seluruh MenuProduct dalam graf secara rekursif dengan memoization:
    - Memisahkan bahan resep (ingredient) vs kemasan (packaging)
    - Menghitung Batch Yield & Susut Produksi (Waste %)
    - Mendukung sub-resep multi-level dan aturan include_sub_packaging
    - Merambatkan kenaikan harga (Cascading Price Drift) dari bahan mentah ke induk
    """
    used_in_map: dict[int, list[int]] = {}
    for mid, m in menus_by_id.items():
        seen_subs: set[int] = set()
        for ing in m.ingredients or []:
            sid = getattr(ing, "sub_menu_id", None)
            if sid is not None and sid in menus_by_id and sid not in seen_subs:
                seen_subs.add(sid)
                used_in_map.setdefault(sid, []).append(mid)

    cache: dict[int, dict[str, Any]] = {}

    def _resolve(menu_id: int, visiting: set[int]) -> dict[str, Any]:
        if menu_id in cache:
            return cache[menu_id]

        menu = menus_by_id[menu_id]
        if menu_id in visiting:
            # Pengaman jika ada data siklus korup di DB agar tidak stack overflow
            return {
                "ingredients": [],
                "ingredient_count": 0,
                "ingredient_only_count": 0,
                "packaging_count": 0,
                "raw_batch_ingredients": 0.0,
                "raw_batch_total": 0.0,
                "subtotal_ingredients": 0.0,
                "subtotal_packaging": 0.0,
                "batch_yield_qty": 1.0,
                "batch_yield_unit": menu.unit or "Porsi",
                "waste_loss_pct": 0.0,
                "net_yield_qty": 1.0,
                "labor_cost": 0.0,
                "unit_labor_cost": 0.0,
                "other_fee": 0.0,
                "unit_other_fee": 0.0,
                "other_fee_description": getattr(menu, "other_fee_description", None),
                "core_unit_hpp": 0.0,
                "recipe_hpp": 0.0,
                "hpp_manual": 0.0,
                "hpp_mode": "auto",
                "active_hpp_source": "manual",
                "effective_hpp": 0.0,
                "selling_price": round(float(menu.selling_price or 0.0), 2),
                "gross_margin": 0.0,
                "food_cost_pct": 0.0,
                "pure_food_cost_pct": 0.0,
                "packaging_cost_pct": 0.0,
                "margin_pct": 0.0,
                "food_cost_status": "no_hpp",
                "has_price_drift": False,
                "price_drift_count": 0,
                "max_ingredient_increase_pct": 0.0,
                "used_in_count": len(used_in_map.get(menu_id, [])),
            }

        next_visiting = visiting | {menu_id}
        ingredient_rows: list[dict[str, Any]] = []
        raw_batch_ingredients = 0.0
        subtotal_packaging = 0.0
        ingredient_only_count = 0
        packaging_count = 0
        drift_count = 0
        max_increase_pct = 0.0

        for ing in menu.ingredients or []:
            cost_group = (getattr(ing, "cost_group", None) or "ingredient").strip().lower()
            if cost_group not in ("ingredient", "packaging"):
                cost_group = "ingredient"

            waste_pct = min(99.0, max(0.0, float(getattr(ing, "waste_pct", 0.0) or 0.0)))
            qty = float(ing.qty or 0.0)
            effective_qty = (qty / (1.0 - waste_pct / 100.0)) if waste_pct > 0 else qty
            safe_yield = float(ing.yield_factor) if (ing.yield_factor and ing.yield_factor > 0) else 1.0
            has_override = ing.unit_cost_override is not None

            sub_menu_id = getattr(ing, "sub_menu_id", None)
            if sub_menu_id is not None and sub_menu_id in menus_by_id:
                sub_menu = menus_by_id[sub_menu_id]
                sub_fin = _resolve(sub_menu.id, next_visiting)
                use_sub_pkg = bool(getattr(ing, "include_sub_packaging", False))
                sub_unit_cost = float(
                    sub_fin["effective_hpp"] if use_sub_pkg else sub_fin["core_unit_hpp"]
                )
                effective_unit_cost = (
                    float(ing.unit_cost_override) if has_override else sub_unit_cost
                )
                line_cost = round((effective_qty / safe_yield) * effective_unit_cost, 2)

                drift_alert = bool(not has_override and sub_fin.get("has_price_drift"))
                change_pct = sub_fin.get("max_ingredient_increase_pct") if drift_alert else None
                drift_source = sub_menu.name if drift_alert else None
                if drift_alert and change_pct is not None:
                    drift_count += 1
                    if float(change_pct) > max_increase_pct:
                        max_increase_pct = float(change_pct)

                sub_breakdown = _build_sub_breakdown(sub_fin.get("ingredients", []))
                master_latest = sub_unit_cost
                prev_price = None
                sub_meta = {
                    "sub_menu_id": sub_menu.id,
                    "sub_menu_name": sub_menu.name,
                    "sub_menu_anonymous_name": sub_menu.anonymous_name,
                    "sub_menu_item_type": getattr(sub_menu, "item_type", "finished") or "finished",
                    "sub_menu_yield_unit": sub_fin["batch_yield_unit"],
                    "sub_menu_core_unit_hpp": sub_fin["core_unit_hpp"],
                    "sub_menu_effective_hpp": sub_fin["effective_hpp"],
                    "include_sub_packaging": use_sub_pkg,
                    "sub_menu_breakdown": sub_breakdown,
                    "drift_source": drift_source,
                }
            else:
                hist_info = (
                    price_history_map.get(ing.master_item_id, {})
                    if (price_history_map and ing.master_item_id is not None)
                    else {}
                )
                if (
                    master_price_overrides is not None
                    and ing.master_item_id is not None
                    and ing.master_item_id in master_price_overrides
                ):
                    master_latest = float(master_price_overrides[ing.master_item_id])
                else:
                    master_latest = float(hist_info.get("latest_price", 0.0)) if hist_info else 0.0

                effective_unit_cost = (
                    float(ing.unit_cost_override) if has_override else float(master_latest)
                )
                line_cost = round((effective_qty / safe_yield) * effective_unit_cost, 2)

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
                    if float(change_pct) > max_increase_pct:
                        max_increase_pct = float(change_pct)

                sub_meta = {
                    "sub_menu_id": None,
                    "sub_menu_name": None,
                    "sub_menu_anonymous_name": None,
                    "sub_menu_item_type": None,
                    "sub_menu_yield_unit": None,
                    "sub_menu_core_unit_hpp": None,
                    "sub_menu_effective_hpp": None,
                    "include_sub_packaging": False,
                    "sub_menu_breakdown": [],
                    "drift_source": None,
                }

            if cost_group == "packaging":
                subtotal_packaging += line_cost
                packaging_count += 1
            else:
                raw_batch_ingredients += line_cost
                ingredient_only_count += 1

            ingredient_rows.append(
                {
                    "id": ing.id,
                    "menu_id": ing.menu_id,
                    "master_item_id": ing.master_item_id,
                    "master_item_name": ing.master_item.item_name if ing.master_item else None,
                    "ingredient_name": ing.ingredient_name,
                    "cost_group": cost_group,
                    "qty": qty,
                    "unit": ing.unit,
                    "waste_pct": round(waste_pct, 2),
                    "unit_cost_override": float(ing.unit_cost_override) if has_override else None,
                    "master_latest_price": round(master_latest, 2),
                    "master_prev_price": prev_price,
                    "price_change_pct": change_pct,
                    "price_drift_alert": drift_alert,
                    "effective_unit_cost": round(effective_unit_cost, 2),
                    "yield_factor": safe_yield,
                    "line_cost": line_cost,
                    "notes": ing.notes,
                    **sub_meta,
                }
            )

        raw_batch_ingredients = round(raw_batch_ingredients, 2)
        subtotal_packaging = round(subtotal_packaging, 2)
        batch_yield_qty = float(getattr(menu, "batch_yield_qty", 1.0) or 1.0)
        if batch_yield_qty <= 0:
            batch_yield_qty = 1.0
        batch_yield_unit = (
            getattr(menu, "batch_yield_unit", None) or menu.unit or "Porsi"
        ).strip() or "Porsi"
        waste_loss_pct = min(99.0, max(0.0, float(getattr(menu, "waste_loss_pct", 0.0) or 0.0)))
        net_yield_qty = round(
            max(0.0001, batch_yield_qty * (1.0 - waste_loss_pct / 100.0)), 4
        )

        labor_cost = round(float(getattr(menu, "labor_cost", 0.0) or 0.0), 2)
        other_fee = round(float(getattr(menu, "other_fee", 0.0) or 0.0), 2)
        other_fee_desc = getattr(menu, "other_fee_description", None)
        raw_batch_total = round(raw_batch_ingredients + labor_cost + other_fee, 2)

        unit_ingredient_cost = round(raw_batch_ingredients / net_yield_qty, 2)
        unit_labor_cost = round(labor_cost / net_yield_qty, 2)
        unit_other_fee = round(other_fee / net_yield_qty, 2)
        core_unit_hpp = round(unit_ingredient_cost + unit_labor_cost + unit_other_fee, 2)
        recipe_hpp = round(core_unit_hpp + subtotal_packaging, 2)

        hpp_manual = round(float(menu.hpp_manual or 0.0), 2)
        has_recipe = len(ingredient_rows) > 0 or other_fee > 0 or labor_cost > 0
        mode = (menu.hpp_mode or "auto").strip().lower()
        if mode not in ("auto", "manual", "recipe"):
            mode = "auto"

        if mode == "manual":
            effective_hpp = hpp_manual
            core_unit_hpp_effective = hpp_manual
            active_source = "manual"
        elif mode == "recipe" or has_recipe:
            effective_hpp = recipe_hpp
            core_unit_hpp_effective = core_unit_hpp
            active_source = "recipe"
        else:
            effective_hpp = hpp_manual
            core_unit_hpp_effective = hpp_manual
            active_source = "manual"

        is_sellable = bool(getattr(menu, "is_sellable", True))
        selling_price = round(float(menu.selling_price or 0.0), 2)
        gross_margin = round(selling_price - effective_hpp, 2) if is_sellable else 0.0
        food_cost_pct = (
            round((effective_hpp / selling_price) * 100.0, 1)
            if (is_sellable and selling_price > 0)
            else 0.0
        )
        pure_food_cost_pct = (
            round(
                (
                    (unit_ingredient_cost if active_source == "recipe" else effective_hpp)
                    / selling_price
                )
                * 100.0,
                1,
            )
            if (is_sellable and selling_price > 0)
            else 0.0
        )
        packaging_cost_pct = (
            round((subtotal_packaging / selling_price) * 100.0, 1)
            if (is_sellable and selling_price > 0 and active_source == "recipe")
            else 0.0
        )
        margin_pct = (
            round((gross_margin / selling_price) * 100.0, 1)
            if (is_sellable and selling_price > 0)
            else 0.0
        )

        if not is_sellable:
            fc_status = "not_sellable"
        elif selling_price <= 0:
            fc_status = "no_price"
        elif effective_hpp <= 0:
            fc_status = "no_hpp"
        elif food_cost_pct <= 35.0:
            fc_status = "ideal"
        elif food_cost_pct <= 45.0:
            fc_status = "moderate"
        else:
            fc_status = "high"

        result = {
            "ingredients": ingredient_rows,
            "ingredient_count": len(ingredient_rows),
            "ingredient_only_count": ingredient_only_count,
            "packaging_count": packaging_count,
            "raw_batch_ingredients": raw_batch_ingredients,
            "raw_batch_total": raw_batch_total,
            "subtotal_ingredients": unit_ingredient_cost,
            "subtotal_packaging": subtotal_packaging,
            "batch_yield_qty": batch_yield_qty,
            "batch_yield_unit": batch_yield_unit,
            "waste_loss_pct": round(waste_loss_pct, 2),
            "net_yield_qty": net_yield_qty,
            "labor_cost": labor_cost,
            "unit_labor_cost": unit_labor_cost,
            "other_fee": other_fee,
            "unit_other_fee": unit_other_fee,
            "other_fee_description": other_fee_desc,
            "core_unit_hpp": round(core_unit_hpp_effective, 2),
            "recipe_hpp": recipe_hpp,
            "hpp_manual": hpp_manual,
            "hpp_mode": mode,
            "active_hpp_source": active_source,
            "effective_hpp": round(effective_hpp, 2),
            "selling_price": selling_price,
            "gross_margin": gross_margin,
            "food_cost_pct": food_cost_pct,
            "pure_food_cost_pct": pure_food_cost_pct,
            "packaging_cost_pct": packaging_cost_pct,
            "margin_pct": margin_pct,
            "food_cost_status": fc_status,
            "has_price_drift": drift_count > 0,
            "price_drift_count": drift_count,
            "max_ingredient_increase_pct": round(max_increase_pct, 1),
            "used_in_count": len(used_in_map.get(menu_id, [])),
        }
        cache[menu_id] = result
        return result

    for mid in menus_by_id:
        _resolve(mid, set())

    return cache


def compute_menu_financials(
    menu: MenuProduct,
    master_price_map: dict[int, float],
    price_history_map: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Wrapper single-menu untuk kompatibilitas pemanggil lama."""
    merged_hist: dict[int, dict[str, Any]] = dict(price_history_map or {})
    for mid, latest in master_price_map.items():
        if mid not in merged_hist:
            merged_hist[mid] = {"latest_price": latest}
    resolved = resolve_all_menu_financials({menu.id: menu}, merged_hist)
    return resolved[menu.id]


def serialize_menu_product(
    menu: MenuProduct,
    master_price_map: dict[int, float],
    anonymize: bool = False,
    price_history_map: dict[int, dict[str, Any]] | None = None,
    financials: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Serialisasi menu/produk; saat anonymize=True, nama asli, SKU, catatan, dan nama bahan disamarkan."""
    fin = financials or compute_menu_financials(
        menu, master_price_map, price_history_map=price_history_map
    )

    item_type = (getattr(menu, "item_type", None) or "finished").strip().lower()
    if item_type not in ("finished", "prepared", "bundle"):
        item_type = "finished"
    is_sellable = bool(getattr(menu, "is_sellable", True))
    target_fc = getattr(menu, "target_food_cost_pct", None)
    shelf_life = getattr(menu, "shelf_life_days", None)
    storage_method = getattr(menu, "storage_method", None)

    base_meta = {
        "id": menu.id,
        "anonymous_name": menu.anonymous_name,
        "category": menu.category,
        "product_group": menu.product_group,
        "unit": menu.unit,
        "item_type": item_type,
        "is_sellable": is_sellable,
        "target_food_cost_pct": float(target_fc) if target_fc is not None else None,
        "shelf_life_days": int(shelf_life) if shelf_life is not None else None,
        "storage_method": storage_method,
        "is_active": menu.is_active,
        "created_at": menu.created_at.isoformat() if menu.created_at else None,
        "updated_at": menu.updated_at.isoformat() if menu.updated_at else None,
    }

    if anonymize:
        bahan_idx = 0
        sub_idx = 0
        pkg_idx = 0
        masked_ingredients: list[dict[str, Any]] = []
        for ing in fin["ingredients"]:
            if ing.get("cost_group") == "packaging":
                pkg_idx += 1
                masked_label = f"Kemasan #{pkg_idx}"
            elif ing.get("sub_menu_id") is not None:
                sub_idx += 1
                masked_label = f"Sub-Resep #{sub_idx}"
            else:
                bahan_idx += 1
                masked_label = f"Bahan #{bahan_idx}"

            masked_ingredients.append(
                {
                    **ing,
                    "master_item_id": None,
                    "master_item_name": None,
                    "sub_menu_id": None,
                    "sub_menu_name": None,
                    "sub_menu_anonymous_name": None,
                    "sub_menu_breakdown": [],
                    "drift_source": None,
                    "ingredient_name": masked_label,
                    "notes": None,
                }
            )
        return {
            **base_meta,
            "name": menu.anonymous_name,
            "display_name": menu.anonymous_name,
            "sku": None,
            "notes": None,
            "is_anonymized": True,
            **fin,
            "other_fee_description": None,
            "ingredients": masked_ingredients,
        }

    return {
        **base_meta,
        "name": menu.name,
        "display_name": menu.name,
        "sku": menu.sku,
        "notes": menu.notes,
        "is_anonymized": False,
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
    """Ganti daftar bahan & kemasan resep pada menu serta kaitkan ke MasterItem atau Sub-Menu."""
    master_ids = [
        int(it["master_item_id"])
        for it in ingredients_payload
        if it.get("master_item_id") is not None
    ]
    sub_menu_ids = [
        int(it["sub_menu_id"])
        for it in ingredients_payload
        if it.get("sub_menu_id") is not None
    ]

    master_map: dict[int, MasterItem] = {}
    if master_ids:
        res = await db.execute(select(MasterItem).where(MasterItem.id.in_(master_ids)))
        master_map = {m.id: m for m in res.scalars().all()}

    sub_menu_map: dict[int, MenuProduct] = {}
    if sub_menu_ids:
        res_sub = await db.execute(select(MenuProduct).where(MenuProduct.id.in_(sub_menu_ids)))
        sub_menu_map = {s.id: s for s in res_sub.scalars().all()}

    await db.execute(delete(MenuIngredient).where(MenuIngredient.menu_id == menu.id))
    await db.flush()

    for item in ingredients_payload:
        mid = item.get("master_item_id")
        sid = item.get("sub_menu_id")
        if mid is not None and sid is not None:
            raise ValueError("Satu baris bahan tidak boleh merujuk Master Item dan Sub-Resep sekaligus.")

        master_obj = master_map.get(int(mid)) if mid is not None else None
        sub_obj = sub_menu_map.get(int(sid)) if sid is not None else None

        raw_name = (item.get("ingredient_name") or "").strip()
        ing_name = (
            raw_name
            or (sub_obj.name if sub_obj else "")
            or (master_obj.item_name if master_obj else "")
        )
        if not ing_name:
            continue

        cost_group = (item.get("cost_group") or "ingredient").strip().lower()
        if cost_group not in ("ingredient", "packaging"):
            cost_group = "ingredient"

        if sub_obj is not None:
            default_unit = sub_obj.batch_yield_unit or sub_obj.unit or "Gram"
            raw_inc_pkg = item.get("include_sub_packaging")
            if raw_inc_pkg is None:
                include_sub_pkg = (sub_obj.item_type or "finished") != "prepared"
            else:
                include_sub_pkg = bool(raw_inc_pkg)
        else:
            default_unit = (
                (master_obj.satuan_ecer or master_obj.satuan_beli) if master_obj else "Gram"
            )
            include_sub_pkg = False

        unit_val = (item.get("unit") or "").strip() or default_unit
        yield_val = float(item.get("yield_factor") or 1.0)
        if yield_val <= 0:
            yield_val = 1.0
        waste_val = min(99.0, max(0.0, float(item.get("waste_pct") or 0.0)))
        override_raw = item.get("unit_cost_override")
        override_val = float(override_raw) if override_raw is not None else None

        db.add(
            MenuIngredient(
                menu_id=menu.id,
                master_item_id=master_obj.id if master_obj else None,
                sub_menu_id=sub_obj.id if sub_obj else None,
                cost_group=cost_group,
                include_sub_packaging=include_sub_pkg,
                waste_pct=waste_val,
                ingredient_name=ing_name,
                qty=float(item.get("qty") or 0.0),
                unit=unit_val,
                unit_cost_override=override_val,
                yield_factor=yield_val,
                notes=(item.get("notes") or "").strip() or None,
            )
        )
    await db.flush()


def get_menu_usages(
    target_menu_id: int,
    menus_by_id: dict[int, MenuProduct],
    resolved_map: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Daftar menu induk yang menggunakan target_menu_id sebagai bahan/sub-resep beserta kontribusi biayanya."""
    usages: list[dict[str, Any]] = []
    for parent_id, parent in menus_by_id.items():
        if parent_id == target_menu_id:
            continue
        parent_fin = resolved_map.get(parent_id, {})
        matched_rows = [
            ing
            for ing in parent_fin.get("ingredients", [])
            if ing.get("sub_menu_id") == target_menu_id
        ]
        if not matched_rows:
            continue
        total_cost_contrib = round(sum(float(r.get("line_cost") or 0.0) for r in matched_rows), 2)
        total_qty = round(sum(float(r.get("qty") or 0.0) for r in matched_rows), 4)
        parent_eff = float(parent_fin.get("effective_hpp") or 0.0)
        usages.append(
            {
                "menu_id": parent.id,
                "name": parent.name,
                "anonymous_name": parent.anonymous_name,
                "item_type": getattr(parent, "item_type", "finished") or "finished",
                "category": parent.category,
                "qty": total_qty,
                "unit": matched_rows[0].get("unit") or parent.unit,
                "cost_group": matched_rows[0].get("cost_group") or "ingredient",
                "include_sub_packaging": bool(matched_rows[0].get("include_sub_packaging")),
                "line_cost": total_cost_contrib,
                "parent_effective_hpp": parent_eff,
                "cost_share_pct": round((total_cost_contrib / parent_eff) * 100.0, 1)
                if parent_eff > 0
                else 0.0,
            }
        )
    usages.sort(key=lambda u: u["name"].lower())
    return usages


async def clone_menu_with_scale(
    db: AsyncSession,
    source_menu: MenuProduct,
    new_name: str,
    scale_factor: float = 1.0,
    scale_packaging: bool = False,
    item_type_override: str | None = None,
) -> MenuProduct:
    """Duplikasi menu/sub-resep beserta seluruh bahan & kemasan dengan opsi pengali skala takaran."""
    target_type = (item_type_override or getattr(source_menu, "item_type", "finished") or "finished").strip().lower()
    if target_type not in ("finished", "prepared", "bundle"):
        target_type = "finished"

    existing_codes = await get_existing_anonymous_codes(db)
    anon_code = generate_next_anonymous_code(existing_codes, prefix=default_anon_prefix(target_type))
    safe_scale = float(scale_factor) if scale_factor > 0 else 1.0

    cloned = MenuProduct(
        name=new_name.strip(),
        anonymous_name=anon_code,
        sku=None,
        category=source_menu.category,
        product_group=source_menu.product_group,
        unit=source_menu.unit,
        item_type=target_type,
        is_sellable=bool(getattr(source_menu, "is_sellable", True))
        if item_type_override is None
        else (target_type != "prepared"),
        batch_yield_qty=round(
            float(getattr(source_menu, "batch_yield_qty", 1.0) or 1.0)
            * (safe_scale if target_type == "prepared" else 1.0),
            4,
        ),
        batch_yield_unit=getattr(source_menu, "batch_yield_unit", None),
        waste_loss_pct=float(getattr(source_menu, "waste_loss_pct", 0.0) or 0.0),
        labor_cost=round(float(getattr(source_menu, "labor_cost", 0.0) or 0.0) * safe_scale, 2),
        target_food_cost_pct=getattr(source_menu, "target_food_cost_pct", None),
        shelf_life_days=getattr(source_menu, "shelf_life_days", None),
        storage_method=getattr(source_menu, "storage_method", None),
        selling_price=float(source_menu.selling_price or 0.0),
        hpp_manual=float(source_menu.hpp_manual or 0.0),
        hpp_mode=source_menu.hpp_mode,
        other_fee=round(float(getattr(source_menu, "other_fee", 0.0) or 0.0) * safe_scale, 2),
        other_fee_description=getattr(source_menu, "other_fee_description", None),
        notes=source_menu.notes,
        is_active=True,
    )
    db.add(cloned)
    await db.flush()

    for ing in source_menu.ingredients or []:
        cg = (getattr(ing, "cost_group", None) or "ingredient").strip().lower()
        row_scale = safe_scale if (cg != "packaging" or scale_packaging) else 1.0
        db.add(
            MenuIngredient(
                menu_id=cloned.id,
                master_item_id=ing.master_item_id,
                sub_menu_id=getattr(ing, "sub_menu_id", None),
                cost_group=cg,
                include_sub_packaging=bool(getattr(ing, "include_sub_packaging", False)),
                waste_pct=float(getattr(ing, "waste_pct", 0.0) or 0.0),
                ingredient_name=ing.ingredient_name,
                qty=round(float(ing.qty or 0.0) * row_scale, 4),
                unit=ing.unit,
                unit_cost_override=ing.unit_cost_override,
                yield_factor=float(ing.yield_factor or 1.0),
                notes=ing.notes,
            )
        )
    await db.flush()
    return cloned


async def simulate_price_impact(
    db: AsyncSession,
    menus_by_id: dict[int, MenuProduct],
    price_history_map: dict[int, dict[str, Any]],
    adjustments: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Simulasikan perubahan harga 1 atau beberapa MasterItem tanpa mengubah database,
    lalu kembalikan daftar seluruh prepared, menu jual, dan bundle yang terdampak.
    """
    adj_ids = [int(a["master_item_id"]) for a in adjustments if a.get("master_item_id")]
    master_name_map: dict[int, str] = {}
    if adj_ids:
        res_mi = await db.execute(select(MasterItem).where(MasterItem.id.in_(adj_ids)))
        master_name_map = {m.id: m.item_name for m in res_mi.scalars().all()}

    override_map: dict[int, float] = {}
    resolved_adjustments: list[dict[str, Any]] = []
    for adj in adjustments:
        mid = int(adj["master_item_id"])
        base_price = float(price_history_map.get(mid, {}).get("latest_price", 0.0))
        mode = (adj.get("mode") or "pct").strip().lower()
        val = float(adj.get("value") or 0.0)
        if mode == "new_price":
            sim_price = max(0.0, round(val, 2))
        else:
            sim_price = max(0.0, round(base_price * (1.0 + val / 100.0), 2))
        override_map[mid] = sim_price
        delta_pct = (
            round(((sim_price - base_price) / base_price) * 100.0, 1) if base_price > 0 else None
        )
        resolved_adjustments.append(
            {
                "master_item_id": mid,
                "master_item_name": master_name_map.get(mid, f"Item #{mid}"),
                "mode": mode,
                "value": val,
                "base_price": round(base_price, 2),
                "simulated_price": sim_price,
                "delta_pct": delta_pct,
            }
        )

    baseline = resolve_all_menu_financials(menus_by_id, price_history_map)
    simulated = resolve_all_menu_financials(
        menus_by_id, price_history_map, master_price_overrides=override_map
    )

    affected_items: list[dict[str, Any]] = []
    affected_prepared_count = 0
    affected_menu_count = 0
    newly_high_fc_count = 0

    for mid, menu in menus_by_id.items():
        base_fin = baseline[mid]
        sim_fin = simulated[mid]
        old_hpp = float(base_fin["effective_hpp"])
        new_hpp = float(sim_fin["effective_hpp"])
        delta_hpp = round(new_hpp - old_hpp, 2)
        if abs(delta_hpp) < 0.01:
            continue

        item_type = getattr(menu, "item_type", "finished") or "finished"
        if item_type == "prepared":
            affected_prepared_count += 1
        else:
            affected_menu_count += 1

        if base_fin["food_cost_status"] != "high" and sim_fin["food_cost_status"] == "high":
            newly_high_fc_count += 1

        delta_hpp_pct = round((delta_hpp / old_hpp) * 100.0, 1) if old_hpp > 0 else None
        old_margin = float(base_fin["gross_margin"])
        new_margin = float(sim_fin["gross_margin"])
        delta_margin = round(new_margin - old_margin, 2)

        suggested_price: float | None = None
        if getattr(menu, "is_sellable", True) and float(menu.selling_price or 0.0) > 0:
            old_margin_pct = float(base_fin["margin_pct"])
            target_fc = getattr(menu, "target_food_cost_pct", None)
            if target_fc is not None and 0 < float(target_fc) < 95:
                denom = float(target_fc) / 100.0
            elif 0 < old_margin_pct < 95.0:
                denom = 1.0 - (old_margin_pct / 100.0)
            else:
                denom = 0.35
            if denom > 0.05:
                raw_sug = new_hpp / denom
                suggested_price = (
                    round(raw_sug / 500.0) * 500.0 if raw_sug >= 500.0 else round(raw_sug, 2)
                )

        affected_items.append(
            {
                "menu_id": menu.id,
                "name": menu.name,
                "anonymous_name": menu.anonymous_name,
                "item_type": item_type,
                "is_sellable": bool(getattr(menu, "is_sellable", True)),
                "category": menu.category,
                "unit": sim_fin["batch_yield_unit"],
                "selling_price": float(menu.selling_price or 0.0),
                "old_hpp": old_hpp,
                "new_hpp": new_hpp,
                "delta_hpp": delta_hpp,
                "delta_hpp_pct": delta_hpp_pct,
                "old_margin": old_margin,
                "new_margin": new_margin,
                "delta_margin": delta_margin,
                "old_food_cost_pct": base_fin["food_cost_pct"],
                "new_food_cost_pct": sim_fin["food_cost_pct"],
                "old_status": base_fin["food_cost_status"],
                "new_status": sim_fin["food_cost_status"],
                "suggested_selling_price": suggested_price,
            }
        )

    affected_items.sort(key=lambda x: abs(x["delta_hpp"]), reverse=True)
    return {
        "adjustments": resolved_adjustments,
        "affected_items": affected_items,
        "summary": {
            "total_affected": len(affected_items),
            "affected_prepared_count": affected_prepared_count,
            "affected_menu_count": affected_menu_count,
            "newly_high_fc_count": newly_high_fc_count,
        },
    }


async def get_pricing_channels(db: AsyncSession) -> list[dict[str, Any]]:
    """Ambil konfigurasi komisi channel penjualan dari SystemSetting, atau gunakan default."""
    row = await db.get(SystemSetting, PRICING_CHANNELS_SETTING_KEY)
    if not row or not row.value:
        return [dict(ch) for ch in DEFAULT_PRICING_CHANNELS]
    try:
        parsed = json.loads(row.value)
        if isinstance(parsed, list) and parsed:
            return parsed
    except Exception:
        pass
    return [dict(ch) for ch in DEFAULT_PRICING_CHANNELS]


async def set_pricing_channels(
    db: AsyncSession, channels: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Simpan konfigurasi komisi channel penjualan ke SystemSetting."""
    cleaned: list[dict[str, Any]] = []
    for idx, ch in enumerate(channels):
        key = re.sub(r"[^a-z0-9_-]", "_", (ch.get("key") or f"ch_{idx + 1}").strip().lower())
        cleaned.append(
            {
                "key": key or f"ch_{idx + 1}",
                "name": (ch.get("name") or f"Channel {idx + 1}").strip(),
                "commission_pct": max(0.0, min(95.0, float(ch.get("commission_pct") or 0.0))),
                "fixed_fee": max(0.0, float(ch.get("fixed_fee") or 0.0)),
                "extra_packaging": max(0.0, float(ch.get("extra_packaging") or 0.0)),
            }
        )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    row = await db.get(SystemSetting, PRICING_CHANNELS_SETTING_KEY)
    val = json.dumps(cleaned, ensure_ascii=False)
    if row:
        row.value = val
        row.updated_at = now
    else:
        db.add(
            SystemSetting(
                key=PRICING_CHANNELS_SETTING_KEY,
                value=val,
                created_at=now,
                updated_at=now,
            )
        )
    await db.commit()
    return cleaned


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
