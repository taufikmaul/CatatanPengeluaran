"""
app/api/menus.py — REST API Database Menu / Produk, HPP / Food Cost, Resep Bahan, & Mode Anonim.
"""
import json
from typing import Any, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin_role, require_roles, validate_upload_file
from app.database.connection import get_db
from app.models.master_item import MasterItem
from app.models.menu_product import MenuIngredient, MenuProduct
from app.services.menu_product_service import (
    build_master_latest_price_map,
    build_master_price_history_map,
    build_menus_json_export,
    create_menu_share_token,
    export_menus_to_csv,
    generate_menu_csv_template,
    generate_next_anonymous_code,
    get_existing_anonymous_codes,
    import_menus_from_csv,
    import_menus_from_pos_history,
    is_menu_anonymize_locked,
    load_menu_with_ingredients,
    regenerate_anonymous_names,
    serialize_menu_product,
    set_menu_anonymize_locked,
    suggest_yield_factor,
    sync_menu_ingredients,
    verify_menu_share_token,
)

router = APIRouter(
    prefix="/menus",
    tags=["menus"],
    dependencies=[Depends(require_roles("admin", "purchasing", "admin_input"))],
)

# Public read-only router khusus link share ter-anonim bertoken HMAC
public_menus_router = APIRouter(
    prefix="/menus",
    tags=["menus"],
)


class MenuIngredientInput(BaseModel):
    master_item_id: Optional[int] = None
    ingredient_name: Optional[str] = Field(None, max_length=255)
    qty: float = Field(1.0, ge=0)
    unit: str = Field("Gram", min_length=1, max_length=50)
    unit_cost_override: Optional[float] = Field(None, ge=0)
    yield_factor: float = Field(1.0, gt=0)
    notes: Optional[str] = None


class MenuProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    anonymous_name: Optional[str] = Field(None, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    category: str = Field("Lainnya", min_length=1, max_length=100)
    product_group: Optional[str] = Field(None, max_length=100)
    unit: str = Field("Porsi", min_length=1, max_length=50)
    selling_price: float = Field(0.0, ge=0)
    hpp_manual: float = Field(0.0, ge=0)
    hpp_mode: str = Field("auto", pattern="^(auto|manual|recipe)$")
    notes: Optional[str] = None
    is_active: bool = True
    ingredients: list[MenuIngredientInput] = Field(default_factory=list)


class MenuProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    anonymous_name: Optional[str] = Field(None, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, min_length=1, max_length=100)
    product_group: Optional[str] = Field(None, max_length=100)
    unit: Optional[str] = Field(None, min_length=1, max_length=50)
    selling_price: Optional[float] = Field(None, ge=0)
    hpp_manual: Optional[float] = Field(None, ge=0)
    hpp_mode: Optional[str] = Field(None, pattern="^(auto|manual|recipe)$")
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    ingredients: Optional[list[MenuIngredientInput]] = None


class MenuBulkUpdateItem(BaseModel):
    id: int
    selling_price: Optional[float] = Field(None, ge=0)
    hpp_manual: Optional[float] = Field(None, ge=0)
    hpp_mode: Optional[str] = Field(None, pattern="^(auto|manual|recipe)$")
    is_active: Optional[bool] = None


class MenuBulkUpdateRequest(BaseModel):
    updates: list[MenuBulkUpdateItem] = Field(..., min_length=1)


class AnonymizeBatchRequest(BaseModel):
    prefix: str = Field("MENU", min_length=1, max_length=20)
    preserve_custom: bool = False


class AnonymizeLockRequest(BaseModel):
    locked: bool


class ShareTokenRequest(BaseModel):
    expire_hours: int = Field(24, ge=1, le=720)


async def _ensure_not_anonymize_locked(db: AsyncSession) -> None:
    if await is_menu_anonymize_locked(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Mode Anonim Read-Only sedang dikunci. Buka kunci terlebih dahulu untuk mengubah data menu.",
        )


def _compute_menu_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    with_price_and_hpp = [
        it for it in items if it["selling_price"] > 0 and it["effective_hpp"] > 0
    ]
    avg_fc = (
        round(sum(it["food_cost_pct"] for it in with_price_and_hpp) / len(with_price_and_hpp), 1)
        if with_price_and_hpp
        else 0.0
    )
    avg_margin = (
        round(sum(it["margin_pct"] for it in with_price_and_hpp) / len(with_price_and_hpp), 1)
        if with_price_and_hpp
        else 0.0
    )
    return {
        "total_menus": len(items),
        "active_menus": sum(1 for it in items if it["is_active"]),
        "with_hpp_count": sum(1 for it in items if it["effective_hpp"] > 0),
        "missing_hpp_count": sum(1 for it in items if it["effective_hpp"] <= 0),
        "recipe_based_count": sum(1 for it in items if it["active_hpp_source"] == "recipe"),
        "price_drift_menus_count": sum(1 for it in items if it.get("has_price_drift")),
        "avg_food_cost_pct": avg_fc,
        "avg_margin_pct": avg_margin,
        "ideal_count": sum(1 for it in items if it["food_cost_status"] == "ideal"),
        "moderate_count": sum(1 for it in items if it["food_cost_status"] == "moderate"),
        "high_count": sum(1 for it in items if it["food_cost_status"] == "high"),
    }


async def _load_filtered_menus(
    db: AsyncSession,
    search: Optional[str] = None,
    category: Optional[str] = None,
    active_only: bool = False,
    hpp_status: Optional[str] = None,
    anonymize: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    res = await db.execute(
        select(MenuProduct)
        .options(selectinload(MenuProduct.ingredients).joinedload(MenuIngredient.master_item))
        .order_by(MenuProduct.name.asc(), MenuProduct.id.asc())
    )
    menus = res.scalars().all()
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}

    all_categories = sorted({(m.category or "Lainnya") for m in menus})
    serialized_all = [
        serialize_menu_product(
            m,
            price_map,
            anonymize=anonymize,
            price_history_map=price_history_map,
        )
        for m in menus
    ]

    filtered: list[dict[str, Any]] = []
    q = (search or "").strip().lower()
    cat_filter = (category or "").strip()
    status_filter = (hpp_status or "").strip().lower()

    for item in serialized_all:
        if active_only and not item["is_active"]:
            continue
        if cat_filter and cat_filter != "all" and item["category"] != cat_filter:
            continue
        if status_filter and status_filter != "all":
            if status_filter == "missing_hpp" and item["effective_hpp"] > 0:
                continue
            elif status_filter == "price_drift" and not item.get("has_price_drift"):
                continue
            elif status_filter not in ("missing_hpp", "price_drift") and item["food_cost_status"] != status_filter:
                continue
        if q:
            haystack = " ".join(
                [
                    item.get("display_name") or "",
                    item.get("anonymous_name") or "",
                    item.get("category") or "",
                    item.get("product_group") or "",
                    item.get("sku") or "",
                ]
            ).lower()
            if q not in haystack:
                continue
        filtered.append(item)

    return filtered, all_categories


@router.get("")
async def api_list_menus(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    hpp_status: Optional[str] = Query(None),
    active_only: bool = Query(False),
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    locked = await is_menu_anonymize_locked(db)
    effective_anonymize = True if locked else anonymize

    items, categories = await _load_filtered_menus(
        db,
        search=search,
        category=category,
        active_only=active_only,
        hpp_status=hpp_status,
        anonymize=effective_anonymize,
    )
    summary = _compute_menu_summary(items)

    return {
        "ok": True,
        "items": items,
        "summary": summary,
        "categories": categories,
        "anonymized": effective_anonymize,
        "anonymize_locked": locked,
    }


@router.get("/conversion-hint")
async def api_conversion_hint(
    master_item_id: int = Query(...),
    recipe_unit: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    master = await db.get(MasterItem, master_item_id)
    if not master:
        raise HTTPException(status_code=404, detail="Master Item tidak ditemukan.")
    factor, reason = suggest_yield_factor(
        master.satuan_beli,
        master.satuan_ecer,
        master.isi_paket,
        recipe_unit,
    )
    return {
        "ok": True,
        "master_item_id": master.id,
        "satuan_beli": master.satuan_beli,
        "satuan_ecer": master.satuan_ecer,
        "isi_paket": master.isi_paket,
        "recipe_unit": recipe_unit,
        "yield_factor": factor,
        "reason": reason,
    }


@router.get("/template-csv")
async def api_download_menu_csv_template():
    csv_text = generate_menu_csv_template()
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="template_import_menu_hpp.csv"'},
    )


@router.get("/export")
async def api_export_menus_csv(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    hpp_status: Optional[str] = Query(None),
    active_only: bool = Query(False),
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    locked = await is_menu_anonymize_locked(db)
    effective_anonymize = True if locked else anonymize
    items, _ = await _load_filtered_menus(
        db,
        search=search,
        category=category,
        active_only=active_only,
        hpp_status=hpp_status,
        anonymize=effective_anonymize,
    )
    csv_text = export_menus_to_csv(items, anonymize=effective_anonymize)
    filename = "database_menu_hpp_anonim.csv" if effective_anonymize else "database_menu_hpp.csv"
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export-json")
async def api_export_menus_json(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    hpp_status: Optional[str] = Query(None),
    active_only: bool = Query(False),
    anonymize: bool = Query(False),
    download: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    locked = await is_menu_anonymize_locked(db)
    effective_anonymize = True if locked else anonymize
    items, _ = await _load_filtered_menus(
        db,
        search=search,
        category=category,
        active_only=active_only,
        hpp_status=hpp_status,
        anonymize=effective_anonymize,
    )
    summary = _compute_menu_summary(items)
    payload = build_menus_json_export(items, summary, anonymize=effective_anonymize)
    if not download:
        return {"ok": True, **payload}

    filename = "database_menu_hpp_anonim.json" if effective_anonymize else "database_menu_hpp.json"
    return Response(
        content=json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@public_menus_router.get("/shared/{token}")
async def api_get_shared_anonymous_menus(
    token: str,
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    hpp_status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Endpoint publik read-only yang selalu mengembalikan data ter-anonim bila token HMAC valid."""
    token_payload = verify_menu_share_token(token)
    if not token_payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Link presentasi anonim tidak valid atau sudah kedaluwarsa.",
        )

    items, categories = await _load_filtered_menus(
        db,
        search=search,
        category=category,
        active_only=False,
        hpp_status=hpp_status,
        anonymize=True,
    )
    summary = _compute_menu_summary(items)
    return {
        "ok": True,
        "items": items,
        "summary": summary,
        "categories": categories,
        "anonymized": True,
        "read_only": True,
        "expires_at": token_payload.get("exp"),
    }


@router.post("/anonymize-lock", dependencies=[Depends(require_admin_role)])
async def api_set_anonymize_lock(
    payload: AnonymizeLockRequest,
    db: AsyncSession = Depends(get_db),
):
    locked = await set_menu_anonymize_locked(db, payload.locked)
    return {"ok": True, "anonymize_locked": locked}


@router.post("/share-token", dependencies=[Depends(require_admin_role)])
async def api_create_share_token(payload: ShareTokenRequest):
    token = create_menu_share_token(expire_hours=payload.expire_hours)
    return {
        "ok": True,
        "token": token,
        "expire_hours": payload.expire_hours,
        "share_path": f"/app/shared/menus?share={token}",
        "api_path": f"/api/v1/menus/shared/{token}",
    }


@router.patch("/bulk-update")
async def api_bulk_update_menus(
    payload: MenuBulkUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)

    ids = [u.id for u in payload.updates]
    res = await db.execute(select(MenuProduct).where(MenuProduct.id.in_(ids)))
    menu_map = {m.id: m for m in res.scalars().all()}

    missing = [mid for mid in ids if mid not in menu_map]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Menu ID tidak ditemukan: {missing}",
        )

    updated_count = 0
    for item in payload.updates:
        menu = menu_map[item.id]
        if item.selling_price is not None:
            menu.selling_price = float(item.selling_price)
        if item.hpp_manual is not None:
            menu.hpp_manual = float(item.hpp_manual)
        if item.hpp_mode is not None:
            menu.hpp_mode = item.hpp_mode
        if item.is_active is not None:
            menu.is_active = item.is_active
        updated_count += 1

    await db.commit()
    return {"ok": True, "updated_count": updated_count}


@router.get("/{menu_id}")
async def api_get_menu_detail(
    menu_id: int,
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    locked = await is_menu_anonymize_locked(db)
    effective_anonymize = True if locked else anonymize
    menu = await load_menu_with_ingredients(db, menu_id)
    if not menu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}
    return {
        "ok": True,
        "item": serialize_menu_product(
            menu,
            price_map,
            anonymize=effective_anonymize,
            price_history_map=price_history_map,
        ),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def api_create_menu(
    payload: MenuProductCreate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)

    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Nama menu wajib diisi.")

    dup_name = await db.execute(
        select(MenuProduct).where(MenuProduct.name.ilike(clean_name))
    )
    if dup_name.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Menu '{clean_name}' sudah terdaftar.")

    existing_codes = await get_existing_anonymous_codes(db)
    raw_anon = (payload.anonymous_name or "").strip()
    if raw_anon:
        if raw_anon.lower() in {c.lower() for c in existing_codes}:
            raise HTTPException(
                status_code=400,
                detail=f"Kode/nama anonim '{raw_anon}' sudah dipakai menu lain.",
            )
        anon_name = raw_anon
    else:
        anon_name = generate_next_anonymous_code(existing_codes)

    menu = MenuProduct(
        name=clean_name,
        anonymous_name=anon_name,
        sku=(payload.sku or "").strip() or None,
        category=(payload.category or "Lainnya").strip() or "Lainnya",
        product_group=(payload.product_group or "").strip() or None,
        unit=(payload.unit or "Porsi").strip() or "Porsi",
        selling_price=float(payload.selling_price or 0.0),
        hpp_manual=float(payload.hpp_manual or 0.0),
        hpp_mode=payload.hpp_mode,
        notes=(payload.notes or "").strip() or None,
        is_active=payload.is_active,
    )
    db.add(menu)
    await db.flush()

    if payload.ingredients:
        await sync_menu_ingredients(
            db,
            menu,
            [ing.model_dump() for ing in payload.ingredients],
        )

    menu_id = menu.id
    await db.commit()
    loaded = await load_menu_with_ingredients(db, menu_id)
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}
    return {
        "ok": True,
        "item": serialize_menu_product(
            loaded,
            price_map,
            anonymize=False,
            price_history_map=price_history_map,
        ),
    }


@router.put("/{menu_id}")
async def api_update_menu(
    menu_id: int,
    payload: MenuProductUpdate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)

    menu = await db.get(MenuProduct, menu_id)
    if not menu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")

    if payload.name is not None:
        clean_name = payload.name.strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Nama menu tidak boleh kosong.")
        dup_name = await db.execute(
            select(MenuProduct).where(
                MenuProduct.name.ilike(clean_name),
                MenuProduct.id != menu_id,
            )
        )
        if dup_name.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Menu '{clean_name}' sudah terdaftar.")
        menu.name = clean_name

    if payload.anonymous_name is not None:
        clean_anon = payload.anonymous_name.strip()
        if not clean_anon:
            existing_codes = await get_existing_anonymous_codes(db)
            existing_codes.discard(menu.anonymous_name)
            clean_anon = generate_next_anonymous_code(existing_codes)
        else:
            dup_anon = await db.execute(
                select(MenuProduct).where(
                    MenuProduct.anonymous_name.ilike(clean_anon),
                    MenuProduct.id != menu_id,
                )
            )
            if dup_anon.scalar_one_or_none():
                raise HTTPException(
                    status_code=400,
                    detail=f"Kode/nama anonim '{clean_anon}' sudah dipakai menu lain.",
                )
        menu.anonymous_name = clean_anon

    if payload.sku is not None:
        menu.sku = payload.sku.strip() or None
    if payload.category is not None:
        menu.category = payload.category.strip() or "Lainnya"
    if payload.product_group is not None:
        menu.product_group = payload.product_group.strip() or None
    if payload.unit is not None:
        menu.unit = payload.unit.strip() or "Porsi"
    if payload.selling_price is not None:
        menu.selling_price = float(payload.selling_price)
    if payload.hpp_manual is not None:
        menu.hpp_manual = float(payload.hpp_manual)
    if payload.hpp_mode is not None:
        menu.hpp_mode = payload.hpp_mode
    if payload.notes is not None:
        menu.notes = payload.notes.strip() or None
    if payload.is_active is not None:
        menu.is_active = payload.is_active

    if payload.ingredients is not None:
        await sync_menu_ingredients(
            db,
            menu,
            [ing.model_dump() for ing in payload.ingredients],
        )

    await db.commit()
    loaded = await load_menu_with_ingredients(db, menu_id)
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}
    return {
        "ok": True,
        "item": serialize_menu_product(
            loaded,
            price_map,
            anonymize=False,
            price_history_map=price_history_map,
        ),
    }


@router.delete("/{menu_id}", dependencies=[Depends(require_admin_role)])
async def api_delete_menu(
    menu_id: int,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)

    menu = await db.get(MenuProduct, menu_id)
    if not menu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")
    await db.delete(menu)
    await db.commit()
    return {"ok": True}


class MenuBulkCreateRequest(BaseModel):
    items: list[MenuProductCreate]
    update_existing: bool = True


@router.post("/bulk", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin_role)])
async def api_bulk_create_menus(
    payload: MenuBulkCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Tambah atau perbarui banyak Menu / Produk & HPP sekaligus via form masal."""
    await _ensure_not_anonymize_locked(db)
    if not payload.items:
        raise HTTPException(status_code=400, detail="Daftar menu tidak boleh kosong.")

    existing_menus = list((await db.execute(select(MenuProduct))).scalars().all())
    by_name = {m.name.strip().lower(): m for m in existing_menus}
    existing_codes = {m.anonymous_name for m in existing_menus if m.anonymous_name}

    added = 0
    updated = 0
    skipped = 0

    for it in payload.items:
        clean_name = it.name.strip()
        if not clean_name:
            skipped += 1
            continue
        key = clean_name.lower()
        existing = by_name.get(key)
        if existing:
            if not payload.update_existing:
                skipped += 1
                continue
            existing.category = it.category.strip() or existing.category
            if it.product_group is not None:
                existing.product_group = it.product_group.strip() or None
            if it.sku is not None:
                existing.sku = it.sku.strip() or None
            existing.unit = it.unit.strip() or existing.unit
            existing.selling_price = it.selling_price
            existing.hpp_manual = it.hpp_manual
            existing.hpp_mode = it.hpp_mode
            if it.notes is not None:
                existing.notes = it.notes
            existing.is_active = it.is_active
            if it.ingredients:
                await sync_menu_ingredients(db, existing.id, [ing.model_dump() for ing in it.ingredients])
            updated += 1
        else:
            clean_anon = (it.anonymous_name or "").strip()
            if clean_anon and clean_anon.lower() not in {c.lower() for c in existing_codes}:
                anon_code = clean_anon
            else:
                anon_code = generate_next_anonymous_code(existing_codes)
            existing_codes.add(anon_code)

            new_menu = MenuProduct(
                name=clean_name,
                anonymous_name=anon_code,
                sku=it.sku.strip() if it.sku else None,
                category=it.category.strip() or "Lainnya",
                product_group=it.product_group.strip() if it.product_group else None,
                unit=it.unit.strip() or "Porsi",
                selling_price=it.selling_price,
                hpp_manual=it.hpp_manual,
                hpp_mode=it.hpp_mode,
                notes=it.notes,
                is_active=it.is_active,
            )
            db.add(new_menu)
            await db.flush()
            if it.ingredients:
                await sync_menu_ingredients(db, new_menu.id, [ing.model_dump() for ing in it.ingredients])
            by_name[key] = new_menu
            added += 1

    await db.commit()
    return {
        "ok": True,
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "message": f"Tambah masal menu selesai: {added} ditambahkan, {updated} diperbarui, {skipped} dilewati.",
    }


@router.post("/import-from-pos", dependencies=[Depends(require_admin_role)])
async def api_import_menus_from_pos(db: AsyncSession = Depends(get_db)):
    await _ensure_not_anonymize_locked(db)
    result = await import_menus_from_pos_history(db)
    await db.commit()
    return {"ok": True, **result}


@router.post("/import-csv", dependencies=[Depends(require_admin_role)])
async def api_import_menus_csv(
    file: UploadFile = File(...),
    update_existing: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)
    content = await file.read()
    validate_upload_file(content, file.filename, allowed_extensions=(".csv",))
    try:
        result = await import_menus_from_csv(db, content, update_existing=update_existing)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return {"ok": True, **result}


@router.post("/anonymize-all", dependencies=[Depends(require_admin_role)])
async def api_anonymize_all_menus(
    payload: AnonymizeBatchRequest,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)
    updated = await regenerate_anonymous_names(
        db,
        prefix=payload.prefix,
        preserve_custom=payload.preserve_custom,
    )
    await db.commit()
    return {"ok": True, "updated_count": updated}
