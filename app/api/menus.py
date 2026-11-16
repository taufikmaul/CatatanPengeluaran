"""
app/api/menus.py — REST API Database Menu / Produk, HPP / Food Cost, Resep Bahan, & Mode Anonim.
"""
from typing import Any, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin_role, require_auth
from app.database.connection import get_db
from app.models.menu_product import MenuIngredient, MenuProduct
from app.services.menu_product_service import (
    build_master_latest_price_map,
    export_menus_to_csv,
    generate_next_anonymous_code,
    get_existing_anonymous_codes,
    import_menus_from_csv,
    import_menus_from_pos_history,
    load_menu_with_ingredients,
    regenerate_anonymous_names,
    serialize_menu_product,
    sync_menu_ingredients,
)

router = APIRouter(
    prefix="/menus",
    tags=["menus"],
    dependencies=[Depends(require_auth)],
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


class AnonymizeBatchRequest(BaseModel):
    prefix: str = Field("MENU", min_length=1, max_length=20)
    preserve_custom: bool = False


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
    price_map = await build_master_latest_price_map(db)

    all_categories = sorted({(m.category or "Lainnya") for m in menus})
    serialized_all = [serialize_menu_product(m, price_map, anonymize=anonymize) for m in menus]

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
            elif status_filter != "missing_hpp" and item["food_cost_status"] != status_filter:
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
    items, categories = await _load_filtered_menus(
        db,
        search=search,
        category=category,
        active_only=active_only,
        hpp_status=hpp_status,
        anonymize=anonymize,
    )

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

    summary = {
        "total_menus": len(items),
        "active_menus": sum(1 for it in items if it["is_active"]),
        "with_hpp_count": sum(1 for it in items if it["effective_hpp"] > 0),
        "missing_hpp_count": sum(1 for it in items if it["effective_hpp"] <= 0),
        "recipe_based_count": sum(1 for it in items if it["active_hpp_source"] == "recipe"),
        "avg_food_cost_pct": avg_fc,
        "avg_margin_pct": avg_margin,
        "ideal_count": sum(1 for it in items if it["food_cost_status"] == "ideal"),
        "moderate_count": sum(1 for it in items if it["food_cost_status"] == "moderate"),
        "high_count": sum(1 for it in items if it["food_cost_status"] == "high"),
    }

    return {
        "ok": True,
        "items": items,
        "summary": summary,
        "categories": categories,
        "anonymized": anonymize,
    }


@router.get("/export")
async def api_export_menus_csv(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    hpp_status: Optional[str] = Query(None),
    active_only: bool = Query(False),
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    items, _ = await _load_filtered_menus(
        db,
        search=search,
        category=category,
        active_only=active_only,
        hpp_status=hpp_status,
        anonymize=anonymize,
    )
    csv_text = export_menus_to_csv(items, anonymize=anonymize)
    filename = "database_menu_hpp_anonim.csv" if anonymize else "database_menu_hpp.csv"
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{menu_id}")
async def api_get_menu_detail(
    menu_id: int,
    anonymize: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    menu = await load_menu_with_ingredients(db, menu_id)
    if not menu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")
    price_map = await build_master_latest_price_map(db)
    return {"ok": True, "item": serialize_menu_product(menu, price_map, anonymize=anonymize)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def api_create_menu(
    payload: MenuProductCreate,
    db: AsyncSession = Depends(get_db),
):
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
    price_map = await build_master_latest_price_map(db)
    return {"ok": True, "item": serialize_menu_product(loaded, price_map, anonymize=False)}


@router.put("/{menu_id}")
async def api_update_menu(
    menu_id: int,
    payload: MenuProductUpdate,
    db: AsyncSession = Depends(get_db),
):
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

    menu_id = menu.id
    await db.commit()
    loaded = await load_menu_with_ingredients(db, menu_id)
    price_map = await build_master_latest_price_map(db)
    return {"ok": True, "item": serialize_menu_product(loaded, price_map, anonymize=False)}


@router.delete("/{menu_id}", dependencies=[Depends(require_admin_role)])
async def api_delete_menu(
    menu_id: int,
    db: AsyncSession = Depends(get_db),
):
    menu = await db.get(MenuProduct, menu_id)
    if not menu:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu tidak ditemukan.")
    await db.delete(menu)
    await db.commit()
    return {"ok": True}


@router.post("/import-from-pos")
async def api_import_menus_from_pos(db: AsyncSession = Depends(get_db)):
    result = await import_menus_from_pos_history(db)
    await db.commit()
    return {"ok": True, **result}


@router.post("/import-csv")
async def api_import_menus_csv(
    file: UploadFile = File(...),
    update_existing: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Format file harus .csv")
    content = await file.read()
    try:
        result = await import_menus_from_csv(db, content, update_existing=update_existing)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return {"ok": True, **result}


@router.post("/anonymize-all")
async def api_anonymize_all_menus(
    payload: AnonymizeBatchRequest,
    db: AsyncSession = Depends(get_db),
):
    updated = await regenerate_anonymous_names(
        db,
        prefix=payload.prefix,
        preserve_custom=payload.preserve_custom,
    )
    await db.commit()
    return {"ok": True, "updated_count": updated}
