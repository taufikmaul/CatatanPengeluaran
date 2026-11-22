"""
app/api/menus.py — REST API Database Menu / Produk, HPP / Food Cost, Resep Bahan, & Mode Anonim.
"""
import json
from typing import Any, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin_role, require_roles, validate_upload_file
from app.database.connection import get_db
from app.models.master_item import MasterItem
from app.models.menu_product import MenuIngredient, MenuProduct
from app.services.master_data_service import get_active_names
from app.services.menu_product_service import (
    build_master_price_history_map,
    build_menus_json_export,
    clone_menu_with_scale,
    create_menu_share_token,
    default_anon_prefix,
    export_menus_to_csv,
    generate_menu_csv_template,
    generate_next_anonymous_code,
    get_existing_anonymous_codes,
    get_menu_usages,
    get_pricing_channels,
    import_menus_from_csv,
    import_menus_from_pos_history,
    is_menu_anonymize_locked,
    load_all_menus_graph,
    regenerate_anonymous_names,
    resolve_all_menu_financials,
    serialize_menu_product,
    set_menu_anonymize_locked,
    set_pricing_channels,
    simulate_price_impact,
    suggest_sub_menu_yield_factor,
    suggest_yield_factor,
    sync_menu_ingredients,
    validate_bundle_composition,
    validate_recipe_graph,
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
    sub_menu_id: Optional[int] = None
    cost_group: str = Field("ingredient", pattern="^(ingredient|packaging)$")
    include_sub_packaging: Optional[bool] = None
    waste_pct: float = Field(0.0, ge=0, lt=100)
    ingredient_name: Optional[str] = Field(None, max_length=255)
    qty: float = Field(1.0, ge=0)
    unit: str = Field("Gram", min_length=1, max_length=50)
    unit_cost_override: Optional[float] = Field(None, ge=0)
    yield_factor: float = Field(1.0, gt=0)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_exclusive_source(self) -> "MenuIngredientInput":
        if self.master_item_id is not None and self.sub_menu_id is not None:
            raise ValueError(
                "Satu baris bahan tidak boleh memilih Master Item dan Sub-Resep sekaligus."
            )
        return self


class MenuProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    anonymous_name: Optional[str] = Field(None, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    category: str = Field("Lainnya", min_length=1, max_length=100)
    product_group: Optional[str] = Field(None, max_length=100)
    unit: str = Field("Porsi", min_length=1, max_length=50)
    item_type: str = Field("finished", pattern="^(finished|prepared|bundle)$")
    is_sellable: Optional[bool] = None
    batch_yield_qty: float = Field(1.0, gt=0)
    batch_yield_unit: Optional[str] = Field(None, max_length=50)
    waste_loss_pct: float = Field(0.0, ge=0, lt=100)
    labor_cost: float = Field(0.0, ge=0)
    target_food_cost_pct: Optional[float] = Field(None, gt=0, lt=100)
    shelf_life_days: Optional[int] = Field(None, ge=0)
    storage_method: Optional[str] = Field(None, max_length=50)
    selling_price: float = Field(0.0, ge=0)
    hpp_manual: float = Field(0.0, ge=0)
    hpp_mode: str = Field("auto", pattern="^(auto|manual|recipe)$")
    other_fee: float = Field(0.0, ge=0)
    other_fee_description: Optional[str] = Field(None, max_length=255)
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
    item_type: Optional[str] = Field(None, pattern="^(finished|prepared|bundle)$")
    is_sellable: Optional[bool] = None
    batch_yield_qty: Optional[float] = Field(None, gt=0)
    batch_yield_unit: Optional[str] = Field(None, max_length=50)
    waste_loss_pct: Optional[float] = Field(None, ge=0, lt=100)
    labor_cost: Optional[float] = Field(None, ge=0)
    target_food_cost_pct: Optional[float] = Field(None, gt=0, lt=100)
    shelf_life_days: Optional[int] = Field(None, ge=0)
    storage_method: Optional[str] = Field(None, max_length=50)
    selling_price: Optional[float] = Field(None, ge=0)
    hpp_manual: Optional[float] = Field(None, ge=0)
    hpp_mode: Optional[str] = Field(None, pattern="^(auto|manual|recipe)$")
    other_fee: Optional[float] = Field(None, ge=0)
    other_fee_description: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    ingredients: Optional[list[MenuIngredientInput]] = None


class MenuCloneRequest(BaseModel):
    new_name: str = Field(..., min_length=1, max_length=255)
    scale_factor: float = Field(1.0, gt=0, le=100)
    scale_packaging: bool = False
    item_type: Optional[str] = Field(None, pattern="^(finished|prepared|bundle)$")


class PriceAdjustmentInput(BaseModel):
    master_item_id: int
    mode: str = Field("pct", pattern="^(pct|new_price)$")
    value: float


class PriceSimulationRequest(BaseModel):
    adjustments: list[PriceAdjustmentInput] = Field(..., min_length=1)


class PricingChannelItem(BaseModel):
    key: str = Field(..., min_length=1, max_length=40)
    name: str = Field(..., min_length=1, max_length=80)
    commission_pct: float = Field(0.0, ge=0, le=95)
    fixed_fee: float = Field(0.0, ge=0)
    extra_packaging: float = Field(0.0, ge=0)


class PricingChannelsUpdateRequest(BaseModel):
    channels: list[PricingChannelItem] = Field(..., min_length=1)


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
        it
        for it in items
        if it.get("is_sellable", True) and it["selling_price"] > 0 and it["effective_hpp"] > 0
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
        "finished_count": sum(1 for it in items if it.get("item_type") == "finished"),
        "prepared_count": sum(1 for it in items if it.get("item_type") == "prepared"),
        "bundle_count": sum(1 for it in items if it.get("item_type") == "bundle"),
        "sellable_count": sum(1 for it in items if it.get("is_sellable", True)),
        "used_prepared_count": sum(
            1
            for it in items
            if it.get("item_type") == "prepared" and (it.get("used_in_count") or 0) > 0
        ),
    }


async def _load_filtered_menus(
    db: AsyncSession,
    search: Optional[str] = None,
    category: Optional[str] = None,
    active_only: bool = False,
    hpp_status: Optional[str] = None,
    item_type: Optional[str] = None,
    sellable_only: bool = False,
    anonymize: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    menus_by_id = await load_all_menus_graph(db)
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}
    resolved_map = resolve_all_menu_financials(menus_by_id, price_history_map)

    master_menu_cats = await get_active_names(db, "kategori_menu")
    master_lower = {c.lower() for c in master_menu_cats}
    legacy_cats = sorted(
        {
            (m.category or "Lainnya")
            for m in menus_by_id.values()
            if (m.category or "Lainnya").strip().lower() not in master_lower
        }
    )
    all_categories = [*master_menu_cats, *legacy_cats]
    serialized_all = [
        serialize_menu_product(
            m,
            price_map,
            anonymize=anonymize,
            price_history_map=price_history_map,
            financials=resolved_map[m.id],
        )
        for m in menus_by_id.values()
    ]

    filtered: list[dict[str, Any]] = []
    q = (search or "").strip().lower()
    cat_filter = (category or "").strip()
    status_filter = (hpp_status or "").strip().lower()
    type_filter = (item_type or "").strip().lower()

    for item in serialized_all:
        if active_only and not item["is_active"]:
            continue
        if sellable_only and not item.get("is_sellable", True):
            continue
        if type_filter and type_filter != "all" and item.get("item_type") != type_filter:
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
    item_type: Optional[str] = Query(None),
    sellable_only: bool = Query(False),
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
        item_type=item_type,
        sellable_only=sellable_only,
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
    master_item_id: Optional[int] = Query(None),
    sub_menu_id: Optional[int] = Query(None),
    recipe_unit: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    if (master_item_id is None and sub_menu_id is None) or (
        master_item_id is not None and sub_menu_id is not None
    ):
        raise HTTPException(
            status_code=400,
            detail="Pilih tepat satu sumber: master_item_id atau sub_menu_id.",
        )

    if sub_menu_id is not None:
        sub_menu = await db.get(MenuProduct, sub_menu_id)
        if not sub_menu:
            raise HTTPException(status_code=404, detail="Sub-resep/produk tidak ditemukan.")
        sub_unit = sub_menu.batch_yield_unit or sub_menu.unit or "Porsi"
        factor, reason = suggest_sub_menu_yield_factor(sub_unit, recipe_unit)
        return {
            "ok": True,
            "sub_menu_id": sub_menu.id,
            "sub_yield_unit": sub_unit,
            "recipe_unit": recipe_unit,
            "yield_factor": factor,
            "reason": reason,
        }

    master = await db.get(MasterItem, int(master_item_id))  # type: ignore[arg-type]
    if not master:
        raise HTTPException(status_code=404, detail="Master Item tidak ditemukan.")
    factor, reason = suggest_yield_factor(
        master.satuan_beli,
        master.satuan_ecer,
        master.isi_paket,
        recipe_unit,
        satuan_resep=master.satuan_resep,
        konversi_resep=master.konversi_resep,
    )
    return {
        "ok": True,
        "master_item_id": master.id,
        "satuan_beli": master.satuan_beli,
        "satuan_ecer": master.satuan_ecer,
        "isi_paket": master.isi_paket,
        "satuan_resep": master.satuan_resep,
        "konversi_resep": master.konversi_resep,
        "recipe_unit": recipe_unit,
        "yield_factor": factor,
        "reason": reason,
    }


@router.get("/pricing-channels")
async def api_get_pricing_channels(db: AsyncSession = Depends(get_db)):
    channels = await get_pricing_channels(db)
    return {"ok": True, "channels": channels}


@router.put("/pricing-channels", dependencies=[Depends(require_admin_role)])
async def api_update_pricing_channels(
    payload: PricingChannelsUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    channels = await set_pricing_channels(
        db, [ch.model_dump() for ch in payload.channels]
    )
    return {"ok": True, "channels": channels}


@router.post("/simulate-price-impact")
async def api_simulate_price_impact(
    payload: PriceSimulationRequest,
    db: AsyncSession = Depends(get_db),
):
    menus_by_id = await load_all_menus_graph(db)
    price_history_map = await build_master_price_history_map(db)
    result = await simulate_price_impact(
        db,
        menus_by_id,
        price_history_map,
        [adj.model_dump() for adj in payload.adjustments],
    )
    return {"ok": True, **result}


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
    item_type: Optional[str] = Query(None),
    sellable_only: bool = Query(False),
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
        item_type=item_type,
        sellable_only=sellable_only,
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
    item_type: Optional[str] = Query(None),
    sellable_only: bool = Query(False),
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
        item_type=item_type,
        sellable_only=sellable_only,
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
    item_type: Optional[str] = Query(None),
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
        item_type=item_type,
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

    menus_by_id = await load_all_menus_graph(db)
    existing_menus = list(menus_by_id.values())
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
        sub_ids = [int(ing.sub_menu_id) for ing in it.ingredients if ing.sub_menu_id is not None]

        if existing:
            if not payload.update_existing:
                skipped += 1
                continue
            if it.ingredients:
                ing_dicts = [ing.model_dump() for ing in it.ingredients]
                try:
                    validate_recipe_graph(existing.id, sub_ids, menus_by_id, target_name=clean_name)
                    validate_bundle_composition(it.item_type, ing_dicts, menus_by_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
            elif it.item_type == "bundle":
                existing_ing_dicts = [
                    {
                        "master_item_id": ing.master_item_id,
                        "sub_menu_id": ing.sub_menu_id,
                        "cost_group": ing.cost_group,
                        "ingredient_name": ing.ingredient_name,
                    }
                    for ing in (existing.ingredients or [])
                ]
                try:
                    validate_bundle_composition("bundle", existing_ing_dicts, menus_by_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
            existing.category = it.category.strip() or existing.category
            if it.product_group is not None:
                existing.product_group = it.product_group.strip() or None
            if it.sku is not None:
                existing.sku = it.sku.strip() or None
            existing.unit = it.unit.strip() or existing.unit
            existing.item_type = it.item_type
            if it.is_sellable is not None:
                existing.is_sellable = it.is_sellable
            existing.batch_yield_qty = float(it.batch_yield_qty or 1.0)
            existing.batch_yield_unit = (it.batch_yield_unit or "").strip() or existing.unit
            existing.waste_loss_pct = float(it.waste_loss_pct or 0.0)
            existing.labor_cost = float(it.labor_cost or 0.0)
            existing.other_fee = float(it.other_fee or 0.0)
            existing.other_fee_description = (it.other_fee_description or "").strip() or None
            existing.selling_price = it.selling_price
            existing.hpp_manual = it.hpp_manual
            existing.hpp_mode = it.hpp_mode
            if it.notes is not None:
                existing.notes = it.notes
            existing.is_active = it.is_active
            if it.ingredients:
                await sync_menu_ingredients(
                    db, existing, [ing.model_dump() for ing in it.ingredients]
                )
            updated += 1
        else:
            if sub_ids or (it.item_type == "bundle" and it.ingredients):
                ing_dicts = [ing.model_dump() for ing in it.ingredients]
                try:
                    if sub_ids:
                        validate_recipe_graph(None, sub_ids, menus_by_id, target_name=clean_name)
                    validate_bundle_composition(it.item_type, ing_dicts, menus_by_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
            clean_anon = (it.anonymous_name or "").strip()
            if clean_anon and clean_anon.lower() not in {c.lower() for c in existing_codes}:
                anon_code = clean_anon
            else:
                anon_code = generate_next_anonymous_code(
                    existing_codes, prefix=default_anon_prefix(it.item_type)
                )
            existing_codes.add(anon_code)

            unit_val = it.unit.strip() or "Porsi"
            is_sellable_val = (
                it.is_sellable if it.is_sellable is not None else (it.item_type != "prepared")
            )
            new_menu = MenuProduct(
                name=clean_name,
                anonymous_name=anon_code,
                sku=it.sku.strip() if it.sku else None,
                category=it.category.strip() or "Lainnya",
                product_group=it.product_group.strip() if it.product_group else None,
                unit=unit_val,
                item_type=it.item_type,
                is_sellable=is_sellable_val,
                batch_yield_qty=float(it.batch_yield_qty or 1.0),
                batch_yield_unit=(it.batch_yield_unit or "").strip() or unit_val,
                waste_loss_pct=float(it.waste_loss_pct or 0.0),
                labor_cost=float(it.labor_cost or 0.0),
                target_food_cost_pct=it.target_food_cost_pct,
                shelf_life_days=it.shelf_life_days,
                storage_method=(it.storage_method or "").strip() or None,
                selling_price=it.selling_price,
                hpp_manual=it.hpp_manual,
                hpp_mode=it.hpp_mode,
                other_fee=float(it.other_fee or 0.0),
                other_fee_description=(it.other_fee_description or "").strip() or None,
                notes=it.notes,
                is_active=it.is_active,
            )
            db.add(new_menu)
            await db.flush()
            if it.ingredients:
                await sync_menu_ingredients(
                    db, new_menu, [ing.model_dump() for ing in it.ingredients]
                )
            by_name[key] = new_menu
            menus_by_id[new_menu.id] = new_menu
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


async def _serialize_single_menu_from_graph(
    db: AsyncSession,
    menu_id: int,
    anonymize: bool = False,
) -> dict[str, Any]:
    menus_by_id = await load_all_menus_graph(db)
    menu = menus_by_id.get(menu_id)
    if not menu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}
    resolved_map = resolve_all_menu_financials(menus_by_id, price_history_map)
    return serialize_menu_product(
        menu,
        price_map,
        anonymize=anonymize,
        price_history_map=price_history_map,
        financials=resolved_map[menu.id],
    )


@router.get("/{menu_id}/usages")
async def api_get_menu_usages(
    menu_id: int,
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    locked = await is_menu_anonymize_locked(db)
    effective_anonymize = True if locked else anonymize
    menus_by_id = await load_all_menus_graph(db)
    if menu_id not in menus_by_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")
    price_history_map = await build_master_price_history_map(db)
    resolved_map = resolve_all_menu_financials(menus_by_id, price_history_map)
    usages = get_menu_usages(menu_id, menus_by_id, resolved_map)
    if effective_anonymize:
        usages = [
            {
                **u,
                "name": u["anonymous_name"],
            }
            for u in usages
        ]
    return {
        "ok": True,
        "menu_id": menu_id,
        "count": len(usages),
        "usages": usages,
    }


@router.post("/{menu_id}/clone", status_code=status.HTTP_201_CREATED)
async def api_clone_menu(
    menu_id: int,
    payload: MenuCloneRequest,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_not_anonymize_locked(db)

    clean_new_name = payload.new_name.strip()
    if not clean_new_name:
        raise HTTPException(status_code=400, detail="Nama menu baru wajib diisi.")

    dup_name = await db.execute(
        select(MenuProduct).where(MenuProduct.name.ilike(clean_new_name))
    )
    if dup_name.scalar_one_or_none():
        raise HTTPException(
            status_code=400, detail=f"Menu '{clean_new_name}' sudah terdaftar."
        )

    menus_by_id = await load_all_menus_graph(db)
    source = menus_by_id.get(menu_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu asal tidak ditemukan.")

    target_type = (payload.item_type or source.item_type or "finished").strip().lower()
    if target_type == "bundle":
        source_ing_dicts = [
            {
                "master_item_id": ing.master_item_id,
                "sub_menu_id": ing.sub_menu_id,
                "cost_group": ing.cost_group,
                "ingredient_name": ing.ingredient_name,
            }
            for ing in (source.ingredients or [])
        ]
        try:
            validate_bundle_composition("bundle", source_ing_dicts, menus_by_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    cloned = await clone_menu_with_scale(
        db,
        source,
        new_name=clean_new_name,
        scale_factor=payload.scale_factor,
        scale_packaging=payload.scale_packaging,
        item_type_override=payload.item_type,
    )
    cloned_id = cloned.id
    await db.commit()
    return {
        "ok": True,
        "item": await _serialize_single_menu_from_graph(db, cloned_id, anonymize=False),
    }


@router.get("/{menu_id}")
async def api_get_menu_detail(
    menu_id: int,
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    locked = await is_menu_anonymize_locked(db)
    effective_anonymize = True if locked else anonymize
    return {
        "ok": True,
        "item": await _serialize_single_menu_from_graph(
            db, menu_id, anonymize=effective_anonymize
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

    sub_ids = [
        int(ing.sub_menu_id)
        for ing in payload.ingredients
        if ing.sub_menu_id is not None
    ]
    if sub_ids or (payload.item_type == "bundle" and payload.ingredients):
        menus_by_id = await load_all_menus_graph(db)
        try:
            if sub_ids:
                validate_recipe_graph(None, sub_ids, menus_by_id, target_name=clean_name)
            validate_bundle_composition(
                payload.item_type,
                [ing.model_dump() for ing in payload.ingredients],
                menus_by_id,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

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
        anon_name = generate_next_anonymous_code(
            existing_codes, prefix=default_anon_prefix(payload.item_type)
        )

    unit_val = (payload.unit or "Porsi").strip() or "Porsi"
    is_sellable_val = (
        payload.is_sellable
        if payload.is_sellable is not None
        else (payload.item_type != "prepared")
    )
    menu = MenuProduct(
        name=clean_name,
        anonymous_name=anon_name,
        sku=(payload.sku or "").strip() or None,
        category=(payload.category or "Lainnya").strip() or "Lainnya",
        product_group=(payload.product_group or "").strip() or None,
        unit=unit_val,
        item_type=payload.item_type,
        is_sellable=is_sellable_val,
        batch_yield_qty=float(payload.batch_yield_qty or 1.0),
        batch_yield_unit=(payload.batch_yield_unit or "").strip() or unit_val,
        waste_loss_pct=float(payload.waste_loss_pct or 0.0),
        labor_cost=float(payload.labor_cost or 0.0),
        target_food_cost_pct=payload.target_food_cost_pct,
        shelf_life_days=payload.shelf_life_days,
        storage_method=(payload.storage_method or "").strip() or None,
        selling_price=float(payload.selling_price or 0.0),
        hpp_manual=float(payload.hpp_manual or 0.0),
        hpp_mode=payload.hpp_mode,
        other_fee=float(payload.other_fee or 0.0),
        other_fee_description=(payload.other_fee_description or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
        is_active=payload.is_active,
    )
    db.add(menu)
    await db.flush()

    if payload.ingredients:
        try:
            await sync_menu_ingredients(
                db,
                menu,
                [ing.model_dump() for ing in payload.ingredients],
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    menu_id = menu.id
    await db.commit()
    return {
        "ok": True,
        "item": await _serialize_single_menu_from_graph(db, menu_id, anonymize=False),
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

    next_name = menu.name
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
        next_name = clean_name
        menu.name = clean_name

    next_item_type = (payload.item_type or menu.item_type or "finished").strip().lower()
    if payload.ingredients is not None:
        sub_ids = [
            int(ing.sub_menu_id)
            for ing in payload.ingredients
            if ing.sub_menu_id is not None
        ]
        if sub_ids or (next_item_type == "bundle" and payload.ingredients):
            menus_by_id = await load_all_menus_graph(db)
            try:
                if sub_ids:
                    validate_recipe_graph(menu_id, sub_ids, menus_by_id, target_name=next_name)
                validate_bundle_composition(
                    next_item_type,
                    [ing.model_dump() for ing in payload.ingredients],
                    menus_by_id,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
    elif next_item_type == "bundle" and (menu.item_type or "finished").strip().lower() != "bundle":
        menus_by_id = await load_all_menus_graph(db)
        menu_in_graph = menus_by_id.get(menu_id)
        existing_ing_dicts = [
            {
                "master_item_id": ing.master_item_id,
                "sub_menu_id": ing.sub_menu_id,
                "cost_group": ing.cost_group,
                "ingredient_name": ing.ingredient_name,
            }
            for ing in (menu_in_graph.ingredients if menu_in_graph else [])
        ]
        try:
            validate_bundle_composition("bundle", existing_ing_dicts, menus_by_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if payload.anonymous_name is not None:
        clean_anon = payload.anonymous_name.strip()
        if not clean_anon:
            existing_codes = await get_existing_anonymous_codes(db)
            existing_codes.discard(menu.anonymous_name)
            clean_anon = generate_next_anonymous_code(
                existing_codes,
                prefix=default_anon_prefix(payload.item_type or menu.item_type),
            )
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

    if (
        payload.item_type is not None
        and next_item_type != "finished"
        and (menu.item_type or "finished").strip().lower() == "finished"
    ):
        bundle_ref_res = await db.execute(
            select(MenuProduct.name)
            .join(MenuIngredient, MenuIngredient.menu_id == MenuProduct.id)
            .where(
                MenuIngredient.sub_menu_id == menu_id,
                MenuProduct.item_type == "bundle",
            )
            .distinct()
            .order_by(MenuProduct.name.asc())
        )
        bundle_parents = [row[0] for row in bundle_ref_res.fetchall() if row[0]]
        if bundle_parents:
            preview = ", ".join(bundle_parents[:5])
            extra = f" (+{len(bundle_parents) - 5} lainnya)" if len(bundle_parents) > 5 else ""
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Tidak dapat mengubah tipe '{menu.name}' menjadi bukan Menu Jual karena masih menjadi "
                    f"item penyusun di Paket / Hampers: {preview}{extra}."
                ),
            )

    if payload.sku is not None:
        menu.sku = payload.sku.strip() or None
    if payload.category is not None:
        menu.category = payload.category.strip() or "Lainnya"
    if payload.product_group is not None:
        menu.product_group = payload.product_group.strip() or None
    if payload.unit is not None:
        menu.unit = payload.unit.strip() or "Porsi"
    if payload.item_type is not None:
        menu.item_type = payload.item_type
    if payload.is_sellable is not None:
        menu.is_sellable = payload.is_sellable
    if payload.batch_yield_qty is not None:
        menu.batch_yield_qty = float(payload.batch_yield_qty)
    if payload.batch_yield_unit is not None:
        menu.batch_yield_unit = payload.batch_yield_unit.strip() or menu.unit
    if payload.waste_loss_pct is not None:
        menu.waste_loss_pct = float(payload.waste_loss_pct)
    if payload.labor_cost is not None:
        menu.labor_cost = float(payload.labor_cost)
    if payload.target_food_cost_pct is not None:
        menu.target_food_cost_pct = payload.target_food_cost_pct
    if payload.shelf_life_days is not None:
        menu.shelf_life_days = payload.shelf_life_days
    if payload.storage_method is not None:
        menu.storage_method = payload.storage_method.strip() or None
    if payload.selling_price is not None:
        menu.selling_price = float(payload.selling_price)
    if payload.hpp_manual is not None:
        menu.hpp_manual = float(payload.hpp_manual)
    if payload.hpp_mode is not None:
        menu.hpp_mode = payload.hpp_mode
    if payload.other_fee is not None:
        menu.other_fee = float(payload.other_fee)
    if payload.other_fee_description is not None:
        menu.other_fee_description = payload.other_fee_description.strip() or None
    if payload.notes is not None:
        menu.notes = payload.notes.strip() or None
    if payload.is_active is not None:
        menu.is_active = payload.is_active

    if payload.ingredients is not None:
        try:
            await sync_menu_ingredients(
                db,
                menu,
                [ing.model_dump() for ing in payload.ingredients],
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    await db.commit()
    return {
        "ok": True,
        "item": await _serialize_single_menu_from_graph(db, menu_id, anonymize=False),
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

    ref_res = await db.execute(
        select(MenuProduct.name)
        .join(MenuIngredient, MenuIngredient.menu_id == MenuProduct.id)
        .where(MenuIngredient.sub_menu_id == menu_id)
        .distinct()
        .order_by(MenuProduct.name.asc())
    )
    parent_names = [row[0] for row in ref_res.fetchall() if row[0]]
    if parent_names:
        preview = ", ".join(parent_names[:5])
        extra = f" (+{len(parent_names) - 5} lainnya)" if len(parent_names) > 5 else ""
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Tidak dapat menghapus '{menu.name}' karena masih dipakai di {len(parent_names)} "
                f"resep: {preview}{extra}. Lepas dari resep terkait terlebih dahulu."
            ),
        )

    await db.delete(menu)
    await db.commit()
    return {"ok": True}
