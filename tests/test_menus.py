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


@pytest.mark.asyncio
async def test_unit_conversion_hint_and_price_drift_alert(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    client.cookies.update(auth_cookies)

    butter = MasterItem(
        item_name="Butter Anchor",
        category="Bahan Kue",
        satuan_beli="Kg",
        satuan_ecer="Gram",
        isi_paket="5 Kg",
    )
    vanili = MasterItem(
        item_name="Ekstrak Vanili",
        category="Bahan Kue",
        satuan_beli="Liter",
        satuan_ecer="ml",
    )
    telur = MasterItem(
        item_name="Telur Ayam",
        category="Bahan Kue",
        satuan_beli="Lusin",
        satuan_ecer="Butir",
    )
    db.add_all([butter, vanili, telur])
    await db.flush()

    # Dua histori pembelian butter: harga naik dari 180000 -> 216000 (+20%)
    db.add_all(
        [
            Expense(
                expense_date=date(2026, 11, 1),
                supplier="Toko A",
                item_name="Butter Anchor",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=180000,
                total_price=180000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=butter.id,
            ),
            Expense(
                expense_date=date(2026, 11, 14),
                supplier="Toko A",
                item_name="Butter Anchor",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=216000,
                total_price=216000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=butter.id,
            ),
        ]
    )
    await db.commit()

    # 1. Cek conversion hint API
    h1 = await client.get(f"/api/v1/menus/conversion-hint?master_item_id={butter.id}&recipe_unit=Gram")
    assert h1.status_code == 200
    assert h1.json()["yield_factor"] == 1000.0

    h2 = await client.get(f"/api/v1/menus/conversion-hint?master_item_id={vanili.id}&recipe_unit=ml")
    assert h2.status_code == 200
    assert h2.json()["yield_factor"] == 1000.0

    h3 = await client.get(f"/api/v1/menus/conversion-hint?master_item_id={telur.id}&recipe_unit=Butir")
    assert h3.status_code == 200
    assert h3.json()["yield_factor"] == 12.0

    # 2. Menu dengan Butter memicu price_drift_alert (+20%)
    res_create = await client.post(
        "/api/v1/menus",
        json={
            "name": "Butter Cake Classic",
            "selling_price": 120000,
            "ingredients": [
                {
                    "master_item_id": butter.id,
                    "qty": 250,
                    "unit": "Gram",
                    "yield_factor": 1000,
                }
            ],
        },
    )
    assert res_create.status_code == 201
    created = res_create.json()["item"]
    assert created["has_price_drift"] is True
    assert created["price_drift_count"] == 1
    assert created["max_ingredient_increase_pct"] == 20.0
    assert created["ingredients"][0]["price_drift_alert"] is True
    assert created["ingredients"][0]["master_prev_price"] == 180000.0

    res_list = await client.get("/api/v1/menus?hpp_status=price_drift")
    assert res_list.status_code == 200
    assert res_list.json()["summary"]["price_drift_menus_count"] == 1
    assert len(res_list.json()["items"]) == 1


@pytest.mark.asyncio
async def test_bulk_update_template_csv_export_json_and_anonymize_lock_share(
    client: AsyncClient, auth_cookies: dict
):
    client.cookies.update(auth_cookies)

    m1 = (
        await client.post(
            "/api/v1/menus",
            json={"name": "Red Velvet Slice", "sku": "RV-01", "selling_price": 40000, "hpp_manual": 12000},
        )
    ).json()["item"]
    m2 = (
        await client.post(
            "/api/v1/menus",
            json={"name": "Americano Iced", "sku": "AM-01", "selling_price": 25000, "hpp_manual": 6000},
        )
    ).json()["item"]

    # 1. Quick-edit massal
    res_bulk = await client.patch(
        "/api/v1/menus/bulk-update",
        json={
            "updates": [
                {"id": m1["id"], "selling_price": 45000, "hpp_manual": 13500},
                {"id": m2["id"], "hpp_manual": 7500, "is_active": False},
            ]
        },
    )
    assert res_bulk.status_code == 200
    assert res_bulk.json()["updated_count"] == 2

    # 2. Template CSV
    res_tpl = await client.get("/api/v1/menus/template-csv")
    assert res_tpl.status_code == 200
    assert "Nama Menu,Kode Anonim,SKU,Kategori" in res_tpl.text

    # 3. Export JSON (anonymized)
    res_json = await client.get("/api/v1/menus/export-json?anonymize=true&download=false")
    assert res_json.status_code == 200
    body_json = res_json.json()
    assert body_json["anonymized"] is True
    exported_names = {it["name"] for it in body_json["items"]}
    assert exported_names == {"MENU-001", "MENU-002"}
    assert "Red Velvet Slice" not in str(body_json["items"])

    # 4. Share token read-only (tanpa login cookie)
    res_share = await client.post("/api/v1/menus/share-token", json={"expire_hours": 24})
    assert res_share.status_code == 200
    share_token = res_share.json()["token"]

    client.cookies.clear()
    res_shared_get = await client.get(f"/api/v1/menus/shared/{share_token}")
    assert res_shared_get.status_code == 200
    shared_data = res_shared_get.json()
    assert shared_data["anonymized"] is True
    assert shared_data["read_only"] is True
    assert all(it["name"].startswith("MENU-") for it in shared_data["items"])

    res_shared_bad = await client.get("/api/v1/menus/shared/invalid.token")
    assert res_shared_bad.status_code == 401

    # 5. Kunci Mode Anonim Read-Only (hanya admin bisa mengunci/membuka)
    purchasing_token = create_session_token(role="purchasing")
    client.cookies.set(SESSION_COOKIE_NAME, purchasing_token)
    res_lock_forbidden = await client.post("/api/v1/menus/anonymize-lock", json={"locked": True})
    assert res_lock_forbidden.status_code == 403

    client.cookies.update(auth_cookies)
    res_lock = await client.post("/api/v1/menus/anonymize-lock", json={"locked": True})
    assert res_lock.status_code == 200
    assert res_lock.json()["anonymize_locked"] is True

    # Saat terkunci, ?anonymize=false tetap memaksa anonymize=True dan mutasi ditolak (403)
    res_locked_list = await client.get("/api/v1/menus?anonymize=false")
    assert res_locked_list.status_code == 200
    assert res_locked_list.json()["anonymized"] is True
    assert res_locked_list.json()["anonymize_locked"] is True
    assert all(it["name"].startswith("MENU-") for it in res_locked_list.json()["items"])

    res_locked_mut = await client.patch(
        "/api/v1/menus/bulk-update",
        json={"updates": [{"id": m1["id"], "selling_price": 50000}]},
    )
    assert res_locked_mut.status_code == 403

    # Buka kunci kembali sebagai admin
    res_unlock = await client.post("/api/v1/menus/anonymize-lock", json={"locked": False})
    assert res_unlock.status_code == 200
    assert res_unlock.json()["anonymize_locked"] is False

