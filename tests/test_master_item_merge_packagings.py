"""
tests/test_master_item_merge_packagings.py — Gabung Master Item membawa varian kemasan.
Kasus utama: Carnation 1 Dus = 8 Pcs @ 2Kg (16.000 Gram) digabung dengan
1 Dus = 48 Kaleng @ 488g (23.424 Gram).
"""
from datetime import date

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.models.master_item import MasterItem, MasterItemPackaging
from app.models.expense import Expense
from app.models.menu_product import MenuProduct, MenuIngredient
from app.models.purchase_request import PurchaseRequest, PurchaseRequestItem
from app.services.master_item_service import (
    create_master_item,
    merge_master_items,
    resolve_packaging_conversion,
)


@pytest.fixture
async def client(db):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def auth_cookies():
    return {SESSION_COOKIE_NAME: create_session_token()}


def _pouch_pkg() -> dict:
    return {
        "label": "Dus (8 Pcs @ 2Kg)",
        "purchase_unit": "Dus",
        "retail_qty": 8,
        "retail_unit": "Pcs",
        "base_qty": 16000,
        "base_unit": "Gram",
        "is_default": True,
    }


def _kaleng_pkg() -> dict:
    return {
        "label": "Dus (48 Kaleng @ 488Gram)",
        "purchase_unit": "Dus",
        "retail_qty": 48,
        "retail_unit": "Kaleng",
        "base_qty": 23424,
        "base_unit": "Gram",
        "is_default": True,
    }


async def _make_carnation_pair(db):
    target = await create_master_item(
        db,
        item_name="Carnation Pcs 2kg",
        default_supplier="Ny. Liem",
        satuan_beli="Dus",
        satuan_resep="Gram",
        konversi_resep=16000,
        packagings=[_pouch_pkg()],
    )
    source = await create_master_item(
        db,
        item_name="Carnation Kaleng 488g",
        default_supplier="Ny. Liem",
        aliases="SKM Carnation Kaleng",
        satuan_beli="Dus",
        satuan_resep="Gram",
        konversi_resep=23424,
        packagings=[_kaleng_pkg()],
    )
    await db.commit()
    return target, source


async def _all_packagings(db, item_id: int) -> list[MasterItemPackaging]:
    res = await db.execute(
        select(MasterItemPackaging).where(MasterItemPackaging.master_item_id == item_id)
    )
    return list(res.scalars().all())


@pytest.mark.asyncio
async def test_merge_moves_both_packagings_carnation_case(db):
    target, source = await _make_carnation_pair(db)
    source_pkg_id = (await _all_packagings(db, source.id))[0].id

    res = await merge_master_items(db, target_item_id=target.id, source_item_ids=[source.id])
    await db.commit()

    pkgs = await _all_packagings(db, target.id)
    assert sorted(float(p.base_qty) for p in pkgs) == [16000.0, 23424.0]
    assert sum(1 for p in pkgs if p.is_default) == 1
    assert source_pkg_id in {p.id for p in pkgs}, "id varian sumber harus tetap sama"
    assert res["packagings_moved"] == 1
    assert res["packagings_deduped"] == 0
    assert len(res["target_item"]["packagings"]) == 2
    assert (await db.scalar(select(MasterItem).where(MasterItem.id == source.id))) is None

    await db.refresh(target)
    assert target.tipe_satuan == "keduanya"
    assert float(target.konversi_resep) == 16000.0, "default tetap varian milik item utama"


@pytest.mark.asyncio
async def test_merge_keeps_expense_packaging_id(db):
    target, source = await _make_carnation_pair(db)
    source_pkg_id = (await _all_packagings(db, source.id))[0].id
    exp = Expense(
        expense_date=date(2026, 11, 20),
        item_name=source.item_name,
        category="Bahan Kue",
        supplier="Ny. Liem",
        unit="Dus",
        unit_price=700000,
        qty=1,
        total_price=700000,
        master_item_id=source.id,
        packaging_id=source_pkg_id,
    )
    db.add(exp)
    await db.commit()

    await merge_master_items(db, target_item_id=target.id, source_item_ids=[source.id])
    await db.commit()
    await db.refresh(exp)

    assert exp.master_item_id == target.id
    assert exp.packaging_id == source_pkg_id


@pytest.mark.asyncio
async def test_merge_dedupes_identical_packaging_and_remaps_expense(db):
    target = await create_master_item(
        db,
        item_name="Gula Pasir Utama",
        satuan_beli="Kg",
        satuan_resep="Gram",
        konversi_resep=1000,
        packagings=[
            {
                "label": "Kg",
                "purchase_unit": "Kg",
                "retail_qty": 1,
                "retail_unit": "Kg",
                "base_qty": 1000,
                "base_unit": "Gram",
                "keywords": "gula kg",
                "is_default": True,
            }
        ],
    )
    source = await create_master_item(
        db,
        item_name="Gula Pasir Duplikat",
        satuan_beli="Kg",
        satuan_resep="Gram",
        konversi_resep=1000,
        packagings=[
            {
                "label": "Kg dup",
                "purchase_unit": "kg",
                "retail_qty": 1,
                "retail_unit": "Kg",
                "base_qty": 1000,
                "base_unit": "Gram",
                "keywords": "gula 1kg",
                "is_default": True,
            }
        ],
    )
    await db.commit()
    kept_id = (await _all_packagings(db, target.id))[0].id
    dup_id = (await _all_packagings(db, source.id))[0].id
    exp = Expense(
        expense_date=date(2026, 11, 21),
        item_name=source.item_name,
        category="Bahan Kue",
        supplier="Toko",
        unit="Kg",
        unit_price=15000,
        qty=1,
        total_price=15000,
        master_item_id=source.id,
        packaging_id=dup_id,
    )
    db.add(exp)
    await db.commit()

    res = await merge_master_items(db, target_item_id=target.id, source_item_ids=[source.id])
    await db.commit()
    await db.refresh(exp)

    pkgs = await _all_packagings(db, target.id)
    assert len(pkgs) == 1
    assert res["packagings_deduped"] == 1
    assert exp.packaging_id == kept_id
    assert "gula 1kg" in (pkgs[0].keywords or "").lower()
    assert "gula kg" in (pkgs[0].keywords or "").lower()


@pytest.mark.asyncio
async def test_merge_materializes_legacy_item_without_packagings(db):
    target = await create_master_item(
        db,
        item_name="Susu Target",
        satuan_beli="Dus",
        satuan_resep="Gram",
        konversi_resep=16000,
        packagings=[_pouch_pkg()],
    )
    legacy = MasterItem(
        item_name="Susu Legacy 900ml",
        category="Bahan Kue",
        satuan_beli="Pcs",
        satuan_ecer="Pcs",
        tipe_satuan="keduanya",
        isi_paket="",
        satuan_resep="Gram",
        konversi_resep=900,
    )
    db.add(legacy)
    await db.commit()
    assert (await _all_packagings(db, legacy.id)) == []

    res = await merge_master_items(db, target_item_id=target.id, source_item_ids=[legacy.id])
    await db.commit()

    pkgs = await _all_packagings(db, target.id)
    assert sorted(float(p.base_qty) for p in pkgs) == [900.0, 16000.0]
    assert res["packagings_moved"] == 1


@pytest.mark.asyncio
async def test_merge_rejects_incompatible_base_units(db):
    target = await create_master_item(
        db,
        item_name="Santan Gram",
        satuan_beli="Dus",
        satuan_resep="Gram",
        konversi_resep=16000,
        packagings=[_pouch_pkg()],
    )
    source = await create_master_item(
        db,
        item_name="Santan Liter",
        satuan_beli="Botol",
        satuan_resep="ml",
        konversi_resep=1000,
        packagings=[
            {
                "label": "Botol 1L",
                "purchase_unit": "Botol",
                "retail_qty": 1,
                "retail_unit": "Botol",
                "base_qty": 1000,
                "base_unit": "ml",
                "is_default": True,
            }
        ],
    )
    await db.commit()
    target_id, source_id = target.id, source.id

    with pytest.raises(ValueError, match="tidak kompatibel"):
        await merge_master_items(db, target_item_id=target_id, source_item_ids=[source_id])
    await db.rollback()

    assert (await db.scalar(select(MasterItem).where(MasterItem.id == source_id))) is not None
    assert len(await _all_packagings(db, source_id)) == 1


@pytest.mark.asyncio
async def test_merge_repoints_menu_ingredient_and_pr_item(db):
    target, source = await _make_carnation_pair(db)
    menu = MenuProduct(name="Kue Susu", anonymous_name="Menu-X1", category="Kue", unit="Porsi")
    db.add(menu)
    await db.flush()
    ing = MenuIngredient(
        menu_id=menu.id,
        master_item_id=source.id,
        ingredient_name=source.item_name,
        qty=100,
        unit="Gram",
    )
    pr = PurchaseRequest(title="Req")
    db.add_all([ing, pr])
    await db.flush()
    pr_item = PurchaseRequestItem(
        request_id=pr.id, item_name=source.item_name, master_item_id=source.id
    )
    db.add(pr_item)
    await db.commit()

    res = await merge_master_items(db, target_item_id=target.id, source_item_ids=[source.id])
    await db.commit()
    await db.refresh(ing)
    await db.refresh(pr_item)

    assert ing.master_item_id == target.id
    assert pr_item.master_item_id == target.id
    assert res["menu_ingredients_reassigned"] == 1
    assert res["purchase_request_items_reassigned"] == 1


@pytest.mark.asyncio
async def test_resolve_after_merge_uses_seeded_keywords(db):
    target, source = await _make_carnation_pair(db)
    await merge_master_items(db, target_item_id=target.id, source_item_ids=[source.id])
    await db.commit()
    await db.refresh(target, ["packagings"])

    conv = resolve_packaging_conversion(
        target,
        qty=1,
        unit="Dus",
        unit_price=700000,
        raw_text="Carnation Kaleng 488g",
        allow_draft_warning=True,
    )
    assert conv["review_status"] == "CONFIRMED"
    assert conv["base_qty"] == 23424.0

    ambiguous = resolve_packaging_conversion(
        target,
        qty=1,
        unit="Dus",
        unit_price=700000,
        raw_text="Susu kental manis",
        allow_draft_warning=True,
    )
    assert ambiguous["review_status"] == "DRAFT_WARNING"


@pytest.mark.asyncio
async def test_api_merge_returns_packagings(client, auth_cookies, db):
    client.cookies.update(auth_cookies)
    target, source = await _make_carnation_pair(db)

    resp = await client.post(
        "/api/v1/master-items/merge",
        json={"target_item_id": target.id, "source_item_ids": [source.id]},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["packagings_moved"] == 1
    assert len(data["target_item"]["packagings"]) == 2
    assert {round(p["base_qty"]) for p in data["target_item"]["packagings"]} == {16000, 23424}
