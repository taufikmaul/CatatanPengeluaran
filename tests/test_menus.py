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

    # 1b. Buat menu dengan bahan + biaya lainnya (kemasan & overhead)
    res_other_fee = await client.post(
        "/api/v1/menus",
        json={
            "name": "Choco Lava Cake",
            "category": "Cake Ready",
            "unit": "Pcs",
            "selling_price": 30000,
            "hpp_mode": "recipe",
            "other_fee": 2500,
            "other_fee_description": "Kemasan & Gas",
            "ingredients": [
                {
                    "master_item_id": cokelat.id,
                    "qty": 50,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 50 / 1000 * 120000 = 6000
                }
            ],
        },
    )
    assert res_other_fee.status_code == 201, res_other_fee.text
    lava = res_other_fee.json()["item"]
    assert lava["subtotal_ingredients"] == 6000.0
    assert lava["other_fee"] == 2500.0
    assert lava["other_fee_description"] == "Kemasan & Gas"
    assert lava["recipe_hpp"] == 8500.0
    assert lava["effective_hpp"] == 8500.0

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


@pytest.mark.asyncio
async def test_prepared_batch_yield_dual_use_packaging_and_multilevel_nesting(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    client.cookies.update(auth_cookies)

    gula = MasterItem(item_name="Gula Pasir", category="Bahan Kue", satuan_beli="Kg", satuan_ecer="Gram")
    coklat = MasterItem(item_name="Dark Chocolate", category="Bahan Kue", satuan_beli="Kg", satuan_ecer="Gram")
    botol = MasterItem(item_name="Botol Kaca 250ml", category="Kemasan", satuan_beli="Pcs", satuan_ecer="Pcs")
    box_cake = MasterItem(item_name="Box Cake 20cm", category="Kemasan", satuan_beli="Pcs", satuan_ecer="Pcs")
    box_hampers = MasterItem(item_name="Box Hampers Hardbox", category="Kemasan", satuan_beli="Pcs", satuan_ecer="Pcs")
    db.add_all([gula, coklat, botol, box_cake, box_hampers])
    await db.flush()

    db.add_all(
        [
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Supplier Bahan",
                item_name="Gula Pasir",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=18000,
                total_price=18000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=gula.id,
            ),
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Supplier Bahan",
                item_name="Dark Chocolate",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=100000,
                total_price=100000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=coklat.id,
            ),
            Expense(
                expense_date=date(2026, 11, 12),
                supplier="Supplier Bahan",
                item_name="Dark Chocolate",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=120000,  # +20% -> memicu price drift
                total_price=120000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=coklat.id,
            ),
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Supplier Kemasan",
                item_name="Botol Kaca 250ml",
                qty=1,
                unit="Pcs",
                category="Kemasan",
                unit_price=3500,
                total_price=3500,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=botol.id,
            ),
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Supplier Kemasan",
                item_name="Box Cake 20cm",
                qty=1,
                unit="Pcs",
                category="Kemasan",
                unit_price=5000,
                total_price=5000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=box_cake.id,
            ),
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Supplier Kemasan",
                item_name="Box Hampers Hardbox",
                qty=1,
                unit="Pcs",
                category="Kemasan",
                unit_price=15000,
                total_price=15000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=box_hampers.id,
            ),
        ]
    )
    await db.commit()

    # 1. Level 1: Prepared internal (batch_yield_qty=1000 Gram, waste_loss_pct=10% -> net_yield=900 Gram)
    res_syrup = await client.post(
        "/api/v1/menus",
        json={
            "name": "Simple Syrup",
            "item_type": "prepared",
            "is_sellable": False,
            "category": "Prepared / Sub-Resep",
            "unit": "Gram",
            "batch_yield_qty": 1000,
            "batch_yield_unit": "Gram",
            "waste_loss_pct": 10,
            "shelf_life_days": 7,
            "storage_method": "Chiller",
            "ingredients": [
                {
                    "master_item_id": gula.id,
                    "cost_group": "ingredient",
                    "qty": 500,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 500/1000 * 18000 = 9000
                }
            ],
        },
    )
    assert res_syrup.status_code == 201, res_syrup.text
    syrup = res_syrup.json()["item"]
    assert syrup["item_type"] == "prepared"
    assert syrup["is_sellable"] is False
    assert syrup["anonymous_name"].startswith("PREP-")
    assert syrup["food_cost_status"] == "not_sellable"
    assert syrup["net_yield_qty"] == 900.0
    assert syrup["core_unit_hpp"] == 10.0  # 9000 / 900 = 10/gram
    assert syrup["effective_hpp"] == 10.0

    # 2. Level 1b: Dual-Use Prepared (bisa dijual langsung pakai botol kaca, juga bisa dipakai di menu lain tanpa botol)
    res_sauce = await client.post(
        "/api/v1/menus",
        json={
            "name": "Dark Choco Sauce Jar",
            "item_type": "prepared",
            "is_sellable": True,
            "category": "Kondimen",
            "unit": "Jar",
            "batch_yield_qty": 1,
            "batch_yield_unit": "Jar",
            "selling_price": 45000,
            "ingredients": [
                {
                    "master_item_id": coklat.id,
                    "cost_group": "ingredient",
                    "qty": 100,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 100/1000 * 120000 = 12000 (price drift +20%)
                },
                {
                    "master_item_id": botol.id,
                    "cost_group": "packaging",
                    "qty": 1,
                    "unit": "Pcs",
                    "yield_factor": 1,  # 3500
                },
            ],
        },
    )
    assert res_sauce.status_code == 201, res_sauce.text
    sauce = res_sauce.json()["item"]
    assert sauce["is_sellable"] is True
    assert sauce["core_unit_hpp"] == 12000.0
    assert sauce["subtotal_packaging"] == 3500.0
    assert sauce["effective_hpp"] == 15500.0
    assert sauce["has_price_drift"] is True

    # 3. Level 2: Prepared Sponge Base memakai Simple Syrup
    res_sponge = await client.post(
        "/api/v1/menus",
        json={
            "name": "Choco Sponge Base",
            "item_type": "prepared",
            "is_sellable": False,
            "category": "Prepared / Sub-Resep",
            "unit": "Loyang",
            "batch_yield_qty": 1,
            "batch_yield_unit": "Loyang",
            "ingredients": [
                {
                    "sub_menu_id": syrup["id"],
                    "cost_group": "ingredient",
                    "qty": 100,
                    "unit": "Gram",
                    "yield_factor": 1,  # 100 * 10 = 1000
                },
                {
                    "master_item_id": coklat.id,
                    "cost_group": "ingredient",
                    "qty": 200,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 200/1000 * 120000 = 24000
                },
            ],
        },
    )
    assert res_sponge.status_code == 201, res_sponge.text
    sponge = res_sponge.json()["item"]
    assert sponge["core_unit_hpp"] == 25000.0  # 1000 + 24000
    assert sponge["has_price_drift"] is True
    assert sponge["ingredients"][0]["sub_menu_breakdown"][0]["ingredient_name"] == "Gula Pasir"

    # 4. Level 3: Menu Jual Finished memakai Sponge Base + Dark Choco Sauce (include_sub_packaging auto False) + Box Cake + Labor
    res_cake = await client.post(
        "/api/v1/menus",
        json={
            "name": "Whole Choco Cake",
            "item_type": "finished",
            "category": "Cake Ready",
            "unit": "Box",
            "selling_price": 200000,
            "labor_cost": 10000,
            "ingredients": [
                {
                    "sub_menu_id": sponge["id"],
                    "cost_group": "ingredient",
                    "qty": 1,
                    "unit": "Loyang",
                    "yield_factor": 1,  # 25000
                },
                {
                    "sub_menu_id": sauce["id"],
                    "cost_group": "ingredient",
                    "qty": 1,
                    "unit": "Jar",
                    "yield_factor": 1,  # auto include_sub_packaging=False -> 12000 (tanpa botol 3500!)
                },
                {
                    "master_item_id": box_cake.id,
                    "cost_group": "packaging",
                    "qty": 1,
                    "unit": "Pcs",
                    "yield_factor": 1,  # 5000
                },
            ],
        },
    )
    assert res_cake.status_code == 201, res_cake.text
    cake = res_cake.json()["item"]
    assert cake["subtotal_ingredients"] == 37000.0  # 25000 + 12000 (botol tidak ikut!)
    assert cake["subtotal_packaging"] == 5000.0
    assert cake["unit_labor_cost"] == 10000.0
    assert cake["core_unit_hpp"] == 47000.0  # 37000 + 10000
    assert cake["effective_hpp"] == 52000.0  # 47000 + 5000
    assert cake["pure_food_cost_pct"] == 18.5  # 37000 / 200000
    assert cake["packaging_cost_pct"] == 2.5  # 5000 / 200000
    assert cake["food_cost_pct"] == 26.0  # 52000 / 200000
    assert cake["has_price_drift"] is True  # merambat dari Dark Chocolate di dalam prepared!
    assert cake["max_ingredient_increase_pct"] == 20.0
    assert cake["ingredients"][0]["drift_source"] == "Choco Sponge Base"

    # 5. Level 4: Bundle / Hampers memakai Whole Choco Cake (include_sub_packaging auto True) + Box Hampers
    res_bundle = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Lebaran Eksklusif",
            "item_type": "bundle",
            "category": "Hampers / Bundling",
            "unit": "Paket",
            "selling_price": 250000,
            "ingredients": [
                {
                    "sub_menu_id": cake["id"],
                    "cost_group": "ingredient",
                    "qty": 1,
                    "unit": "Box",
                    "yield_factor": 1,  # auto include_sub_packaging=True -> 52000
                },
                {
                    "master_item_id": box_hampers.id,
                    "cost_group": "packaging",
                    "qty": 1,
                    "unit": "Pcs",
                    "yield_factor": 1,  # 15000
                },
            ],
        },
    )
    assert res_bundle.status_code == 201, res_bundle.text
    bundle = res_bundle.json()["item"]
    assert bundle["anonymous_name"].startswith("PKT-")
    assert bundle["ingredients"][0]["include_sub_packaging"] is True
    assert bundle["subtotal_ingredients"] == 52000.0
    assert bundle["subtotal_packaging"] == 15000.0
    assert bundle["effective_hpp"] == 67000.0
    assert bundle["has_price_drift"] is True

    # 6. Conversion Hint untuk sub_menu_id
    res_conv = await client.get(
        f"/api/v1/menus/conversion-hint?sub_menu_id={syrup['id']}&recipe_unit=Gram"
    )
    assert res_conv.status_code == 200
    assert res_conv.json()["yield_factor"] == 1.0

    # 7. Filter item_type & summary hanya hitung is_sellable di rata-rata
    res_prep_list = await client.get("/api/v1/menus?item_type=prepared")
    assert res_prep_list.status_code == 200
    assert len(res_prep_list.json()["items"]) == 3  # Syrup, Sauce, Sponge

    # 8. Where-Used & Delete Protection (409 Conflict)
    res_usages = await client.get(f"/api/v1/menus/{sponge['id']}/usages")
    assert res_usages.status_code == 200
    assert res_usages.json()["count"] == 1
    assert res_usages.json()["usages"][0]["name"] == "Whole Choco Cake"

    res_del_conflict = await client.delete(f"/api/v1/menus/{sponge['id']}")
    assert res_del_conflict.status_code == 409
    assert "Whole Choco Cake" in res_del_conflict.json()["detail"]

    # 9. Mode Anonim menyamarkan nama prepared, bundle, sub-resep, dan kemasan
    res_anon = await client.get(f"/api/v1/menus/{cake['id']}?anonymize=true")
    assert res_anon.status_code == 200
    cake_anon = res_anon.json()["item"]
    assert cake_anon["name"].startswith("MENU-")
    assert cake_anon["ingredients"][0]["ingredient_name"] == "Sub-Resep #1"
    assert cake_anon["ingredients"][0]["sub_menu_id"] is None
    assert cake_anon["ingredients"][0]["sub_menu_breakdown"] == []
    assert cake_anon["ingredients"][2]["ingredient_name"] == "Kemasan #1"


@pytest.mark.asyncio
async def test_cycle_detection_clone_scale_simulator_and_channels(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    client.cookies.update(auth_cookies)

    butter = MasterItem(item_name="Butter Test", category="Bahan Kue", satuan_beli="Kg", satuan_ecer="Gram")
    box = MasterItem(item_name="Box Test", category="Kemasan", satuan_beli="Pcs", satuan_ecer="Pcs")
    db.add_all([butter, box])
    await db.flush()
    db.add_all(
        [
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Toko A",
                item_name="Butter Test",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=200000,
                total_price=200000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=butter.id,
            ),
            Expense(
                expense_date=date(2026, 11, 10),
                supplier="Toko B",
                item_name="Box Test",
                qty=1,
                unit="Pcs",
                category="Kemasan",
                unit_price=4000,
                total_price=4000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=box.id,
            ),
        ]
    )
    await db.commit()

    # Buat Prepared A -> B dan uji penolakan siklus A -> B -> A serta self-reference A -> A
    prep_a = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Prep A",
                "item_type": "prepared",
                "unit": "Gram",
                "batch_yield_qty": 1000,
                "ingredients": [
                    {
                        "master_item_id": butter.id,
                        "cost_group": "ingredient",
                        "qty": 500,
                        "unit": "Gram",
                        "yield_factor": 1000,  # 100000 / 1000 = 100/gram
                    }
                ],
            },
        )
    ).json()["item"]

    prep_b = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Prep B",
                "item_type": "prepared",
                "unit": "Gram",
                "batch_yield_qty": 100,
                "ingredients": [
                    {
                        "sub_menu_id": prep_a["id"],
                        "cost_group": "ingredient",
                        "qty": 100,
                        "unit": "Gram",
                        "yield_factor": 1,  # 100 * 100 = 10000 / 100 = 100/gram
                    }
                ],
            },
        )
    ).json()["item"]

    # Self reference A -> A ditolak 400
    res_self = await client.put(
        f"/api/v1/menus/{prep_a['id']}",
        json={
            "ingredients": [
                {"sub_menu_id": prep_a["id"], "cost_group": "ingredient", "qty": 10, "unit": "Gram", "yield_factor": 1}
            ]
        },
    )
    assert res_self.status_code == 400
    assert "sendiri" in res_self.json()["detail"].lower()

    # Indirect cycle A -> B -> A ditolak 400
    res_cycle = await client.put(
        f"/api/v1/menus/{prep_a['id']}",
        json={
            "ingredients": [
                {"sub_menu_id": prep_b["id"], "cost_group": "ingredient", "qty": 10, "unit": "Gram", "yield_factor": 1}
            ]
        },
    )
    assert res_cycle.status_code == 400
    assert "siklus" in res_cycle.json()["detail"].lower()

    # Menu Jual memakai Prep B + Box Test
    cake = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Butter Cake 16cm",
                "item_type": "finished",
                "unit": "Box",
                "selling_price": 60000,
                "ingredients": [
                    {"sub_menu_id": prep_b["id"], "cost_group": "ingredient", "qty": 100, "unit": "Gram", "yield_factor": 1},
                    {"master_item_id": box.id, "cost_group": "packaging", "qty": 1, "unit": "Pcs", "yield_factor": 1},
                ],
            },
        )
    ).json()["item"]
    assert cake["effective_hpp"] == 14000.0  # 10000 + 4000

    # Clone & Scale 2x (bahan ikut dikali 2, batch_yield_qty finished tetap 1.0, packaging tetap 1.0)
    res_clone = await client.post(
        f"/api/v1/menus/{cake['id']}/clone",
        json={"new_name": "Butter Cake 20cm", "scale_factor": 2.0, "scale_packaging": False},
    )
    assert res_clone.status_code == 201, res_clone.text
    cloned = res_clone.json()["item"]
    assert cloned["name"] == "Butter Cake 20cm"
    assert cloned["subtotal_ingredients"] == 20000.0
    assert cloned["effective_hpp"] == 24000.0
    ing_row = next(r for r in cloned["ingredients"] if r["cost_group"] == "ingredient")
    pkg_row = next(r for r in cloned["ingredients"] if r["cost_group"] == "packaging")
    assert ing_row["qty"] == 200.0
    assert pkg_row["qty"] == 1.0
    assert cloned["batch_yield_qty"] == 1.0

    # What-If Price Simulator (+50% Butter -> Prep A, Prep B, Butter Cake 16cm & 20cm terdampak, DB tidak berubah)
    res_sim = await client.post(
        "/api/v1/menus/simulate-price-impact",
        json={"adjustments": [{"master_item_id": butter.id, "mode": "pct", "value": 50}]},
    )
    assert res_sim.status_code == 200, res_sim.text
    sim = res_sim.json()
    assert sim["summary"]["total_affected"] >= 3
    cake_sim = next(it for it in sim["affected_items"] if it["menu_id"] == cake["id"])
    assert cake_sim["old_hpp"] == 14000.0
    assert cake_sim["new_hpp"] == 19000.0  # 10000 * 1.5 + 4000
    assert cake_sim["delta_hpp"] == 5000.0
    assert cake_sim["suggested_selling_price"] is not None

    # Pastikan DB asli tidak berubah setelah simulasi
    res_cake_after = await client.get(f"/api/v1/menus/{cake['id']}")
    assert res_cake_after.json()["item"]["effective_hpp"] == 14000.0

    # Pricing Channels GET & PUT (admin only)
    res_ch_get = await client.get("/api/v1/menus/pricing-channels")
    assert res_ch_get.status_code == 200
    assert len(res_ch_get.json()["channels"]) >= 4

    purchasing_token = create_session_token(role="purchasing")
    client.cookies.set(SESSION_COOKIE_NAME, purchasing_token)
    res_ch_forb = await client.put(
        "/api/v1/menus/pricing-channels",
        json={"channels": [{"key": "gofood", "name": "GoFood", "commission_pct": 22, "fixed_fee": 1000, "extra_packaging": 500}]},
    )
    assert res_ch_forb.status_code == 403

    client.cookies.update(auth_cookies)
    res_ch_upd = await client.put(
        "/api/v1/menus/pricing-channels",
        json={"channels": [{"key": "gofood", "name": "GoFood", "commission_pct": 22, "fixed_fee": 1000, "extra_packaging": 500}]},
    )
    assert res_ch_upd.status_code == 200
    assert res_ch_upd.json()["channels"][0]["commission_pct"] == 22.0

    # Regression test untuk POST /api/v1/menus/bulk dengan ingredients (memastikan sync_menu_ingredients menerima object MenuProduct)
    res_bulk = await client.post(
        "/api/v1/menus/bulk",
        json={
            "update_existing": True,
            "items": [
                {
                    "name": "Bulk Croissant",
                    "category": "Pastry",
                    "unit": "Pcs",
                    "selling_price": 30000,
                    "ingredients": [
                        {"master_item_id": butter.id, "cost_group": "ingredient", "qty": 30, "unit": "Gram", "yield_factor": 1000}
                    ],
                }
            ],
        },
    )
    assert res_bulk.status_code == 201, res_bulk.text
    assert res_bulk.json()["added"] == 1

    # Update via bulk dengan ingredients juga harus sukses
    res_bulk_upd = await client.post(
        "/api/v1/menus/bulk",
        json={
            "update_existing": True,
            "items": [
                {
                    "name": "Bulk Croissant",
                    "category": "Pastry",
                    "unit": "Pcs",
                    "selling_price": 32000,
                    "ingredients": [
                        {"master_item_id": butter.id, "cost_group": "ingredient", "qty": 40, "unit": "Gram", "yield_factor": 1000}
                    ],
                }
            ],
        },
    )
    assert res_bulk_upd.status_code == 201, res_bulk_upd.text
    assert res_bulk_upd.json()["updated"] == 1


@pytest.mark.asyncio
async def test_bundle_composition_only_finished_menus_plus_packaging_and_fees(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    """
    Menu Paket / Hampers (item_type='bundle'):
    - Item penyusun HANYA boleh Menu Jual yang sudah jadi (item_type='finished')
    - Menolak item 1/2 jadi (prepared), bahan mentah (master_item), input bahan manual, dan paket lain (bundle)
    - Tetap memperbolehkan kemasan (master_item & manual packaging) serta labor_cost & other_fee
    """
    client.cookies.update(auth_cookies)

    tepung = MasterItem(item_name="Tepung Bundle Test", category="Bahan Kue", satuan_beli="Kg", satuan_ecer="Gram")
    box_hampers = MasterItem(item_name="Box Hampers Eksklusif", category="Kemasan", satuan_beli="Pcs", satuan_ecer="Pcs")
    db.add_all([tepung, box_hampers])
    await db.flush()
    db.add_all(
        [
            Expense(
                expense_date=date(2026, 11, 15),
                supplier="Toko Bahan",
                item_name="Tepung Bundle Test",
                qty=1,
                unit="Kg",
                category="Bahan Kue",
                unit_price=15000,
                total_price=15000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=tepung.id,
            ),
            Expense(
                expense_date=date(2026, 11, 15),
                supplier="Toko Box",
                item_name="Box Hampers Eksklusif",
                qty=1,
                unit="Pcs",
                category="Kemasan",
                unit_price=20000,
                total_price=20000,
                pay_method="Tunai",
                pay_status="Lunas",
                master_item_id=box_hampers.id,
            ),
        ]
    )
    await db.commit()

    # Siapkan 1 item Prepared (1/2 jadi, bahkan yang dual-use sellable) & 1 Menu Jual Finished
    prep_item = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Saus Coklat 1/2 Jadi",
                "item_type": "prepared",
                "is_sellable": True,
                "unit": "Jar",
                "selling_price": 30000,
                "ingredients": [
                    {"master_item_id": tepung.id, "cost_group": "ingredient", "qty": 200, "unit": "Gram", "yield_factor": 1000}
                ],
            },
        )
    ).json()["item"]

    finished_cake = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Kue Nastar Jar",
                "item_type": "finished",
                "unit": "Toples",
                "selling_price": 85000,
                "hpp_manual": 35000,
                "hpp_mode": "manual",
            },
        )
    ).json()["item"]

    # 1. VALID: Bundle dari Menu Jual (finished) + Kemasan Master Item + Kemasan Manual + Labor & Biaya Lainnya
    res_ok = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Spesial A",
            "item_type": "bundle",
            "category": "Hampers / Bundling",
            "unit": "Paket",
            "selling_price": 250000,
            "labor_cost": 5000,
            "other_fee": 7500,
            "other_fee_description": "Biaya dekorasi pita & kartu",
            "ingredients": [
                {"sub_menu_id": finished_cake["id"], "cost_group": "ingredient", "qty": 2, "unit": "Toples", "yield_factor": 1},
                {"master_item_id": box_hampers.id, "cost_group": "packaging", "qty": 1, "unit": "Pcs", "yield_factor": 1},
                {
                    "cost_group": "packaging",
                    "ingredient_name": "Kartu Ucapan Custom",
                    "qty": 1,
                    "unit": "Pcs",
                    "yield_factor": 1,
                    "unit_cost_override": 2500,
                },
            ],
        },
    )
    assert res_ok.status_code == 201, res_ok.text
    bundle_a = res_ok.json()["item"]
    # 2 * 35000 = 70000 (isi) + 5000 (labor) + 7500 (other_fee) + 20000 (box) + 2500 (kartu) = 105000
    assert bundle_a["subtotal_ingredients"] == 70000.0
    assert bundle_a["subtotal_packaging"] == 22500.0
    assert bundle_a["unit_labor_cost"] == 5000.0
    assert bundle_a["unit_other_fee"] == 7500.0
    assert bundle_a["effective_hpp"] == 105000.0

    # 2. TOLAK: Bundle memakai item 1/2 jadi (Prepared)
    res_prep_err = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Invalid Prepared",
            "item_type": "bundle",
            "unit": "Paket",
            "ingredients": [
                {"sub_menu_id": prep_item["id"], "cost_group": "ingredient", "qty": 1, "unit": "Jar", "yield_factor": 1},
            ],
        },
    )
    assert res_prep_err.status_code == 400
    assert "1/2 jadi" in res_prep_err.json()["detail"].lower()

    # 3. TOLAK: Bundle memakai bahan mentah (Master Item) sebagai penyusun (ingredient)
    res_raw_err = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Invalid Bahan",
            "item_type": "bundle",
            "unit": "Paket",
            "ingredients": [
                {"master_item_id": tepung.id, "cost_group": "ingredient", "qty": 100, "unit": "Gram", "yield_factor": 1000},
            ],
        },
    )
    assert res_raw_err.status_code == 400
    assert "bahan baku" in res_raw_err.json()["detail"].lower()

    # 4. TOLAK: Bundle memakai input bahan manual sebagai penyusun (ingredient)
    res_manual_err = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Invalid Manual",
            "item_type": "bundle",
            "unit": "Paket",
            "ingredients": [
                {
                    "cost_group": "ingredient",
                    "ingredient_name": "Kacang Mete Mentah",
                    "qty": 100,
                    "unit": "Gram",
                    "yield_factor": 1,
                    "unit_cost_override": 200,
                },
            ],
        },
    )
    assert res_manual_err.status_code == 400
    assert "menu jual" in res_manual_err.json()["detail"].lower()

    # 5. TOLAK: Bundle memakai bundle lain sebagai penyusun
    res_nested_bundle = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Invalid Nested",
            "item_type": "bundle",
            "unit": "Paket",
            "ingredients": [
                {"sub_menu_id": bundle_a["id"], "cost_group": "ingredient", "qty": 1, "unit": "Paket", "yield_factor": 1},
            ],
        },
    )
    assert res_nested_bundle.status_code == 400
    assert "paket lain" in res_nested_bundle.json()["detail"].lower()

    # 6. TOLAK: Bundle memakai sub_menu di kelompok kemasan
    res_sub_pkg = await client.post(
        "/api/v1/menus",
        json={
            "name": "Hampers Invalid Sub Pkg",
            "item_type": "bundle",
            "unit": "Paket",
            "ingredients": [
                {"sub_menu_id": finished_cake["id"], "cost_group": "ingredient", "qty": 1, "unit": "Toples", "yield_factor": 1},
                {"sub_menu_id": prep_item["id"], "cost_group": "packaging", "qty": 1, "unit": "Jar", "yield_factor": 1},
            ],
        },
    )
    assert res_sub_pkg.status_code == 400
    assert "kemasan" in res_sub_pkg.json()["detail"].lower()

    # 7. TOLAK: Mengubah item_type menu finished yang punya bahan mentah menjadi bundle (tanpa kirim ingredients)
    finished_with_raw = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Bolu Bahan Mentah",
                "item_type": "finished",
                "unit": "Box",
                "ingredients": [
                    {"master_item_id": tepung.id, "cost_group": "ingredient", "qty": 500, "unit": "Gram", "yield_factor": 1000}
                ],
            },
        )
    ).json()["item"]

    res_convert = await client.put(
        f"/api/v1/menus/{finished_with_raw['id']}",
        json={"item_type": "bundle"},
    )
    assert res_convert.status_code == 400

    # 8. TOLAK: Clone menu finished berbahan mentah menjadi bundle
    res_clone_bundle = await client.post(
        f"/api/v1/menus/{finished_with_raw['id']}/clone",
        json={"new_name": "Clone Invalid Bundle", "scale_factor": 1.0, "item_type": "bundle"},
    )
    assert res_clone_bundle.status_code == 400

    # 9. TOLAK: Mengubah Menu Jual yang sedang dipakai di Bundle menjadi Prepared (1/2 jadi)
    res_demote = await client.put(
        f"/api/v1/menus/{finished_cake['id']}",
        json={"item_type": "prepared"},
    )
    assert res_demote.status_code == 400
    assert "hampers spesial a" in res_demote.json()["detail"].lower()

    # 10. TOLAK: Menu Jual (finished) maupun Prepared tidak boleh disusun dari Menu Jual (finished) atau Bundle
    res_fin_uses_fin = await client.post(
        "/api/v1/menus",
        json={
            "name": "Menu Jual Pakai Menu Jual Lain",
            "item_type": "finished",
            "unit": "Porsi",
            "ingredients": [
                {"sub_menu_id": finished_cake["id"], "cost_group": "ingredient", "qty": 1, "unit": "Toples", "yield_factor": 1}
            ],
        },
    )
    assert res_fin_uses_fin.status_code == 400
    assert "menu jual" in res_fin_uses_fin.json()["detail"].lower()

    res_prep_uses_fin = await client.post(
        "/api/v1/menus",
        json={
            "name": "Prepared Pakai Menu Jual",
            "item_type": "prepared",
            "unit": "Gram",
            "batch_yield_qty": 1000,
            "ingredients": [
                {"sub_menu_id": finished_cake["id"], "cost_group": "ingredient", "qty": 1, "unit": "Toples", "yield_factor": 1}
            ],
        },
    )
    assert res_prep_uses_fin.status_code == 400
    assert "menu jual" in res_prep_uses_fin.json()["detail"].lower()

    res_fin_uses_bundle = await client.post(
        "/api/v1/menus",
        json={
            "name": "Menu Jual Pakai Paket",
            "item_type": "finished",
            "unit": "Porsi",
            "ingredients": [
                {"sub_menu_id": bundle_a["id"], "cost_group": "ingredient", "qty": 1, "unit": "Paket", "yield_factor": 1}
            ],
        },
    )
    assert res_fin_uses_bundle.status_code == 400
    assert "paket" in res_fin_uses_bundle.json()["detail"].lower()

    # 11. TOLAK: Mengubah item Prepared yang sedang dipakai di Menu Jual menjadi Menu Jual (finished)
    used_by_finished = (
        await client.post(
            "/api/v1/menus",
            json={
                "name": "Menu Jual Pakai Saus Prepared",
                "item_type": "finished",
                "unit": "Porsi",
                "ingredients": [
                    {"sub_menu_id": prep_item["id"], "cost_group": "ingredient", "qty": 1, "unit": "Jar", "yield_factor": 1}
                ],
            },
        )
    ).json()["item"]
    assert used_by_finished["id"] > 0

    res_promote_used_prep = await client.put(
        f"/api/v1/menus/{prep_item['id']}",
        json={"item_type": "finished"},
    )
    assert res_promote_used_prep.status_code == 400
    assert "menu jual pakai saus prepared" in res_promote_used_prep.json()["detail"].lower()


@pytest.mark.asyncio
async def test_multi_component_batch_cost_items_labor_and_operational(
    client: AsyncClient, db: AsyncSession, auth_cookies: dict
):
    """
    Section 3: Tenaga Kerja (Labor) & Biaya Operasional Batch mendukung lebih dari 1 komponen rincian:
    - Beberapa item labor + beberapa item operational dijumlahkan otomatis ke labor_cost & other_fee
    - Setiap item punya unit_amount yang dibagi net_yield_qty
    - Mode anonim menyamarkan nama komponen rincian
    - Duplikasi / clone dengan scale_factor ikut menskalakan setiap komponen rincian
    """
    client.cookies.update(auth_cookies)

    biji_kopi = MasterItem(
        item_name="Bens Coffee Arabika 1KG",
        category="Bahan Minuman",
        satuan_beli="Kg",
        satuan_ecer="Gram",
    )
    db.add(biji_kopi)
    await db.flush()
    db.add(
        Expense(
            expense_date=date(2026, 11, 20),
            supplier="Roastery",
            item_name="Bens Coffee Arabika 1KG",
            qty=1,
            unit="Kg",
            category="Bahan Minuman",
            unit_price=263000,
            total_price=263000,
            pay_method="Tunai",
            pay_status="Lunas",
            master_item_id=biji_kopi.id,
        )
    )
    await db.commit()

    # Buat Prepared Espresso Shot: batch yield 30 ml, 4 komponen rincian di Section 3
    res_create = await client.post(
        "/api/v1/menus",
        json={
            "name": "Espresso Base Multi Batch Cost",
            "item_type": "prepared",
            "is_sellable": False,
            "category": "Prepared / Sub-Resep",
            "unit": "ml",
            "batch_yield_qty": 30,
            "batch_yield_unit": "ml",
            "waste_loss_pct": 0,
            "ingredients": [
                {
                    "master_item_id": biji_kopi.id,
                    "cost_group": "ingredient",
                    "qty": 18,
                    "unit": "Gram",
                    "yield_factor": 1000,  # 18/1000 * 263000 = 4734
                }
            ],
            "batch_cost_items": [
                {"category": "labor", "name": "Tenaga Barista Kalibrasi", "amount": 600},
                {"category": "labor", "name": "Tenaga Barista Ekstraksi", "amount": 900},
                {"category": "operational", "name": "Listrik Mesin Espresso", "amount": 450},
                {"category": "operational", "name": "Penyusutan Grinder & Mesin", "amount": 300},
                {"category": "operational", "name": "Air Filter & Flushing", "amount": 150},
            ],
        },
    )
    assert res_create.status_code == 201, res_create.text
    item = res_create.json()["item"]

    # Total labor = 600 + 900 = 1500 (per ml = 50.0)
    # Total operational = 450 + 300 + 150 = 900 (per ml = 30.0)
    assert item["labor_cost"] == 1500.0
    assert item["unit_labor_cost"] == 50.0
    assert item["other_fee"] == 900.0
    assert item["unit_other_fee"] == 30.0
    assert "Listrik Mesin Espresso" in (item["other_fee_description"] or "")
    assert "Penyusutan Grinder & Mesin" in (item["other_fee_description"] or "")
    assert len(item["batch_cost_items"]) == 5
    assert item["batch_cost_items"][0]["name"] == "Tenaga Barista Kalibrasi"
    assert item["batch_cost_items"][0]["unit_amount"] == 20.0
    assert item["batch_cost_items"][2]["name"] == "Listrik Mesin Espresso"
    assert item["batch_cost_items"][2]["unit_amount"] == 15.0

    # Mode anonim menyamarkan nama komponen rincian
    res_anon = await client.get(f"/api/v1/menus/{item['id']}?anonymize=true")
    assert res_anon.status_code == 200
    anon_item = res_anon.json()["item"]
    anon_bc_names = [bc["name"] for bc in anon_item["batch_cost_items"]]
    assert anon_bc_names == [
        "Tenaga Kerja #1",
        "Tenaga Kerja #2",
        "Biaya Operasional #1",
        "Biaya Operasional #2",
        "Biaya Operasional #3",
    ]

    # Clone dengan scale_factor=2.0 ikut menskalakan setiap rincian batch_cost_items
    res_clone = await client.post(
        f"/api/v1/menus/{item['id']}/clone",
        json={"new_name": "Espresso Base Double Batch", "scale_factor": 2.0},
    )
    assert res_clone.status_code == 201, res_clone.text
    cloned = res_clone.json()["item"]
    assert cloned["labor_cost"] == 3000.0
    assert cloned["other_fee"] == 1800.0
    assert len(cloned["batch_cost_items"]) == 5
    assert cloned["batch_cost_items"][0]["amount"] == 1200.0
    assert cloned["batch_cost_items"][1]["amount"] == 1800.0




