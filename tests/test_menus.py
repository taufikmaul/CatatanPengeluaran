"""
tests/test_menus.py — Test suite untuk Database Menu / Produk, HPP / Food Cost, Resep Bahan, & Mode Anonim.
"""
from datetime import date
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import Expense
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.models.master_item import MasterItem
from app.services.dashboard_auth_service import SESSION_COOKIE_NAME, create_session_token


@pytest.mark.asyncio
async def test_menu_crud_and_recipe_hpp_calculation(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    client.cookies.update(auth_cookies)

    # Siapkan MasterItem bahan kue & riwayat pembelian terakhir untuk harga bahan
    terigu = MasterItem(item_name="Tepung Terigu Cakra", category="Bahan Kue", satuan_beli="Kg", satuan_ecer="Gram")
    cokelat = MasterItem(item_name="Cokelat Couverture", category="Bahan Kue", satuan_beli="Kg", satuan_ecer="Gram")
    db.add_all([terigu, cokelat])
    await db.flush()

    db.add_all(
        [
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Toko Bahan Kue",
                item_name="Tepung Terigu Cakra",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=15000,
                total_price=15000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=terigu.id,
            ),
            Expense(
                expense_date=date(2026, 11, 12),
                supplier="Toko Bahan Kue",
                item_name="Cokelat Couverture",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=120000,
                total_price=120000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=cokelat.id,
            ),
        ]
    )
    await db.commit()

    # 1. Buat menu dengan resep bahan (auto HPP)
    res_create = await client.post(
        "/api/v1/menus",
        json={
            "name": "Brownies Fudge Premium",
            "sku": "BRW-01",
            "category": "Cake Ready",
            "unit": "Box",
            "selling_price": 85000,
            "hpp_manual": 20000,
            "hpp_mode": "auto",
            "ingredients": [
                {
                    "master_item_id": terigu.id,
                    "qty": 200,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 200g / 1000g * 15000 = 3000
                },
                {
                    "master_item_id": cokelat.id,
                    "qty": 150,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 150g / 1000g * 120000 = 18000
                },
                {
                    "ingredient_name": "Box Kemasan",
                    "qty": 1,
                    "unit": "Pcs",
                    "unit_cost_override": 4000,  # 1 * 4000 = 4000
                    "yield_factor": 1,
                },
            ],
        },
    )
    assert res_create.status_code == 201, res_create.text
    menu = res_create.json()["item"]
    assert menu["name"] == "Brownies Fudge Premium"
    assert menu["anonymous_name"] == "MENU-001"
    assert menu["recipe_hpp"] == 25000.0
    assert menu["effective_hpp"] == 25000.0
    assert menu["active_hpp_source"] == "recipe"
    assert menu["gross_margin"] == 60000.0
    assert menu["food_cost_pct"] == 29.4
    assert menu["food_cost_status"] == "ideal"

    menu_id = menu["id"]

    # 2. Switch hpp_mode ke manual
    res_upd = await client.put(
        f"/api/v1/menus/{menu_id}",
        json={"hpp_mode": "manual", "hpp_manual": 35000},
    )
    assert res_upd.status_code == 200
    updated = res_upd.json()["item"]
    assert updated["effective_hpp"] == 35000.0
    assert updated["active_hpp_source"] == "manual"
    assert updated["food_cost_pct"] == 41.2
    assert updated["food_cost_status"] == "moderate"

    # 3. Mode anonim pada GET list & GET detail menyembunyikan nama asli, SKU, dan nama bahan
    res_anon = await client.get("/api/v1/menus?anonymize=true")
    assert res_anon.status_code == 200
    anon_item = res_anon.json()["items"][0]
    assert anon_item["name"] == "MENU-001"
    assert anon_item["display_name"] == "MENU-001"
    assert anon_item["sku"] is None
    assert anon_item["is_anonymized"] is True
    assert anon_item["ingredients"][0]["ingredient_name"] == "Bahan #1"
    assert anon_item["ingredients"][0]["master_item_id"] is None

    # 4. Export CSV mode anonim tidak membocorkan nama asli
    res_csv = await client.get("/api/v1/menus/export?anonymize=true")
    assert res_csv.status_code == 200
    csv_body = res_csv.text
    assert "MENU-001" in csv_body
    assert "Brownies Fudge Premium" not in csv_body
    assert "BRW-01" not in csv_body


@pytest.mark.asyncio
async def test_import_from_pos_csv_and_batch_anonymize(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    client.cookies.update(auth_cookies)

    # Seed transaksi masuk POS
    tx = IncomingTransaction(
        source_type="pos",
        receipt_no="R-1001",
        transaction_date=date(2026, 11, 16),
        order_type="Take Away",
        payment_method="QRIS",
        gross_sales=110000,
        net_sales=110000,
        net_received=110000,
        status="paid",
        items=[
            IncomingTransactionItem(
                category="Cake Ready",
                product_group="Slice",
                product_name="Classic Tiramisu Slice",
                sku="SL-TIR",
                qty=1,
                unit_price=45000,
                gross_amount=45000,
            ),
            IncomingTransactionItem(
                category="Minuman",
                product_group="Coffee",
                product_name="Kopi Susu Gula Aren",
                sku="MN-KSG",
                qty=2,
                unit_price=32500,
                gross_amount=65000,
            ),
        ],
    )
    db.add(tx)
    await db.commit()

    # 1. Tarik menu dari histori POS
    res_pos = await client.post("/api/v1/menus/import-from-pos")
    assert res_pos.status_code == 200
    assert res_pos.json()["added"] == 2

    # 2. Import CSV untuk mengisi HPP & menambah menu baru
    csv_payload = (
        "Nama Menu,Kategori,Harga Jual,HPP\n"
        "Classic Tiramisu Slice,Cake Ready,45000,15000\n"
        "Matcha Latte Iced,Minuman,35000,11000\n"
    ).encode("utf-8")
    res_imp = await client.post(
        "/api/v1/menus/import-csv",
        files={"file": ("menus.csv", csv_payload, "text/csv")},
        data={"update_existing": "true"},
    )
    assert res_imp.status_code == 200
    assert res_imp.json()["added"] == 1
    assert res_imp.json()["updated"] == 1

    # 3. Regenerate kode anonim dengan prefix PRD
    res_anon_all = await client.post(
        "/api/v1/menus/anonymize-all",
        json={"prefix": "PRD", "preserve_custom": False},
    )
    assert res_anon_all.status_code == 200
    assert res_anon_all.json()["updated_count"] == 3

    res_list = await client.get("/api/v1/menus")
    assert res_list.status_code == 200
    data = res_list.json()
    assert data["summary"]["total_menus"] == 3
    anon_codes = sorted(item["anonymous_name"] for item in data["items"])
    assert anon_codes == ["PRD-001", "PRD-002", "PRD-003"]


@pytest.mark.asyncio
async def test_menu_delete_requires_admin_role(
    client: AsyncClient, auth_cookies: dict
):
    # Buat menu sebagai admin
    client.cookies.update(auth_cookies)
    res = await client.post(
        "/api/v1/menus",
        json={"name": "Croissant Butter", "selling_price": 28000, "hpp_manual": 9500},
    )
    assert res.status_code == 201
    menu_id = res.json()["item"]["id"]

    # Role non-admin tidak boleh delete
    purchasing_token = create_session_token(role="purchasing")
    client.cookies.set(SESSION_COOKIE_NAME, purchasing_token)
    res_del_forbidden = await client.delete(f"/api/v1/menus/{menu_id}")
    assert res_del_forbidden.status_code == 403

    # Admin bisa delete
    client.cookies.update(auth_cookies)
    res_del_ok = await client.delete(f"/api/v1/menus/{menu_id}")
    assert res_del_ok.status_code == 200
