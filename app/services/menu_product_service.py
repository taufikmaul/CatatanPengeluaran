"""
app/services/menu_product_service.py — Layanan Database Menu / Produk, HPP / Food Cost, & Mode Anonim.
"""
import csv
import io
import re
from typing import Any
from uuid import uuid4
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.models.expense import Expense
from app.models.incoming_transaction import IncomingTransactionItem
from app.models.master_item import MasterItem
from app.models.menu_product import MenuIngredient, MenuProduct
from app.services.sales_import_service import (
    _clean_str,
    _decode_csv_bytes,
    _detect_delimiter,
    _parse_number,
)


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


async def build_master_latest_price_map(db: AsyncSession) -> dict[int, float]:
    """Ambil harga beli unit terbaru dari tabel expenses untuk setiap master_item_id."""
    res = await db.execute(
        select(Expense.master_item_id, Expense.unit_price)
        .where(
            Expense.master_item_id.is_not(None),
            Expense.unit_price > 0,
        )
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    price_map: dict[int, float] = {}
    for mid, unit_price in res.fetchall():
        if mid is not None and int(mid) not in price_map:
            price_map[int(mid)] = float(unit_price or 0.0)
    return price_map


def compute_menu_financials(
    menu: MenuProduct,
    master_price_map: dict[int, float],
) -> dict[str, Any]:
    """Hitung HPP resep, HPP efektif, persentase food cost, dan margin kotor per menu."""
    ingredient_rows: list[dict[str, Any]] = []
    recipe_hpp = 0.0

    for ing in menu.ingredients or []:
        master_latest = (
            master_price_map.get(ing.master_item_id, 0.0)
            if ing.master_item_id is not None
            else 0.0
        )
        has_override = ing.unit_cost_override is not None
        effective_unit_cost = (
            float(ing.unit_cost_override) if has_override else float(master_latest)
        )
        safe_yield = float(ing.yield_factor) if (ing.yield_factor and ing.yield_factor > 0) else 1.0
        qty = float(ing.qty or 0.0)
        line_cost = round((qty / safe_yield) * effective_unit_cost, 2)
        recipe_hpp += line_cost

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
    }


def serialize_menu_product(
    menu: MenuProduct,
    master_price_map: dict[int, float],
    anonymize: bool = False,
) -> dict[str, Any]:
    """Serialisasi menu/produk; saat anonymize=True, nama asli, SKU, catatan, dan nama bahan disamarkan."""
    fin = compute_menu_financials(menu, master_price_map)

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
