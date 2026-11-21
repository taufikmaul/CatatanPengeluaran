"""
tests/test_master_data.py — Unit & Integration tests untuk Master Data Sistem (Metode Bayar, Kategori, Satuan)
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from app.main import app
from app.models.master_data import MasterDataOption
from app.models.menu_product import MenuProduct
from app.services.master_data_service import (
    get_master_options,
    create_master_option,
    update_master_option,
    delete_master_option,
    reset_master_data_defaults,
    get_active_names,
)


from app.database.connection import get_db


@pytest.fixture
async def client(db):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_ensure_default_master_data_seeded(db):
    """Pastikan data master default terisi otomatis."""
    cats = await get_active_names(db, "kategori")
    pay_methods = await get_active_names(db, "metode_bayar")
    units = await get_active_names(db, "satuan")

    assert len(cats) >= 16
    assert "Bahan Kue" in cats
    assert "Kemasan" in cats
    assert "Tukar Cash" in cats
    assert "Gaji" in cats
    assert "Sewa" in cats
    assert "Marketing" in cats
    assert "Software" in cats
    assert "Maintenance" in cats

    # Pastikan kode akun terpetakan
    from app.services.master_data_service import get_category_accounting_map
    coa_map = await get_category_accounting_map(db)
    assert "Bahan Kue" in coa_map
    assert coa_map["Bahan Kue"]["account_code"] == "5-1100"
    assert coa_map["Bahan Kue"]["account_group"] == "HPP"
    assert coa_map["Asset"]["account_code"] == "1-2100"
    assert coa_map["Asset"]["report_type"] == "NERACA"
    assert coa_map["Tukar Cash"]["account_code"] == "1-1199"
    assert coa_map["Tukar Cash"]["account_group"] == "CASH_TRANSFER"
    assert coa_map["Gaji"]["account_code"] == "6-1600"
    assert coa_map["Gaji"]["account_group"] == "OPEX"
    assert coa_map["Gaji"]["report_type"] == "LABA_RUGI"
    assert coa_map["Sewa"]["account_code"] == "6-1700"
    assert coa_map["Sewa"]["account_group"] == "OPEX"
    assert coa_map["Marketing"]["account_code"] == "6-1800"
    assert coa_map["Marketing"]["account_group"] == "OPEX"
    assert coa_map["Software"]["account_code"] == "6-1900"
    assert coa_map["Software"]["account_group"] == "OPEX"
    assert coa_map["Maintenance"]["account_code"] == "6-2000"
    assert coa_map["Maintenance"]["account_group"] == "OPEX"

    assert len(pay_methods) >= 5
    assert "Tunai" in pay_methods
    assert "Transfer" in pay_methods
    assert "QRIS" in pay_methods

    assert len(units) >= 16
    assert "Pcs" in units
    assert "Box" in units
    assert "Kg" in units


@pytest.mark.anyio
async def test_create_and_update_master_option(db):
    """Test pembuatan dan pembaharuan opsi master data."""
    # Create
    created = await create_master_option(
        db,
        opt_type="kategori",
        name="Dekorasi & Display",
        description="Lampu hias dan banner",
        sort_order=20,
    )
    assert created["id"] is not None
    assert created["name"] == "Dekorasi & Display"
    assert created["type"] == "kategori"

    # Update
    updated = await update_master_option(
        db,
        item_id=created["id"],
        name="Dekorasi Toko",
        description="Banner dan dekorasi toko",
        is_active=False,
    )
    assert updated["name"] == "Dekorasi Toko"
    assert updated["is_active"] is False


@pytest.mark.anyio
async def test_api_master_data_endpoints(client):
    """Test REST API endpoint /api/v1/config/master-data."""
    from app.services.dashboard_auth_service import create_session_token
    token = create_session_token(role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Get master data all
    res = await client.get("/api/v1/config/master-data", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert len(data["items"]) > 0

    # 2. Get master data filtered by type
    res_pay = await client.get("/api/v1/config/master-data?type=metode_bayar", headers=headers)
    assert res_pay.status_code == 200
    pay_items = res_pay.json()["items"]
    assert all(it["type"] == "metode_bayar" for it in pay_items)

    # 3. Tambah opsi baru
    new_payload = {
        "type": "metode_bayar",
        "name": "ShopeePay",
        "description": "E-wallet ShopeePay",
        "sort_order": 10,
        "is_default": False,
        "account_code": "1-1123",
        "account_name": "E-Wallet ShopeePay",
        "account_group": "BANK",
        "report_type": "NERACA",
    }
    res_create = await client.post("/api/v1/config/master-data", json=new_payload, headers=headers)
    assert res_create.status_code == 200
    created_item = res_create.json()["item"]
    assert created_item["name"] == "ShopeePay"
    assert created_item["account_code"] == "1-1123"
    assert created_item["account_group"] == "BANK"
    item_id = created_item["id"]

    # 4. Cek duplikasi ditolak
    res_dup = await client.post("/api/v1/config/master-data", json=new_payload, headers=headers)
    assert res_dup.status_code == 400

    # 5. Update opsi
    res_update = await client.put(
        f"/api/v1/config/master-data/{item_id}",
        json={
            "name": "ShopeePay Merchant",
            "description": "Akun toko",
            "account_code": "1-1124",
            "account_name": "ShopeePay Merchant Toko",
        },
        headers=headers,
    )
    assert res_update.status_code == 200
    assert res_update.json()["item"]["name"] == "ShopeePay Merchant"
    assert res_update.json()["item"]["account_code"] == "1-1124"

    # 6. Delete opsi
    res_del = await client.delete(f"/api/v1/config/master-data/{item_id}", headers=headers)
    assert res_del.status_code == 200
    assert res_del.json()["ok"] is True

    # 7. Reset defaults
    res_reset = await client.post(
        "/api/v1/config/master-data/reset-defaults",
        json={"type": "satuan"},
        headers=headers,
    )
    assert res_reset.status_code == 200
    assert res_reset.json()["ok"] is True


@pytest.mark.anyio
async def test_menu_category_master_data_crud_usage_and_cascade(client, db):
    """Test CRUD master kategori_menu, hitung pemakaian MenuProduct, proteksi hapus, & rename cascade."""
    from app.services.dashboard_auth_service import create_session_token

    token = create_session_token(role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Default kategori_menu ter-seed otomatis
    res_list = await client.get("/api/v1/config/master-data?type=kategori_menu", headers=headers)
    assert res_list.status_code == 200
    items = res_list.json()["items"]
    names = [it["name"] for it in items]
    assert "Cake Ready" in names
    assert "Prepared / Sub-Resep" in names
    assert all(it["type"] == "kategori_menu" for it in items)

    # 2. Tambah kategori_menu baru
    res_create = await client.post(
        "/api/v1/config/master-data",
        json={
            "type": "kategori_menu",
            "name": "Seasonal Cake",
            "description": "Kue edisi musiman",
            "sort_order": 20,
        },
        headers=headers,
    )
    assert res_create.status_code == 200
    created_cat = res_create.json()["item"]
    cat_id = created_cat["id"]
    assert created_cat["name"] == "Seasonal Cake"
    assert created_cat["usage_count"] == 0

    # 3. Buat MenuProduct memakai kategori baru
    res_menu = await client.post(
        "/api/v1/menus",
        json={
            "name": "Mango Sticky Roll",
            "category": "Seasonal Cake",
            "unit": "Porsi",
            "selling_price": 45000,
        },
        headers=headers,
    )
    assert res_menu.status_code in (200, 201)
    menu_id = res_menu.json()["item"]["id"]

    # Verifikasi usage_count == 1
    res_list_after = await client.get("/api/v1/config/master-data?type=kategori_menu", headers=headers)
    assert res_list_after.status_code == 200
    matched = [it for it in res_list_after.json()["items"] if it["id"] == cat_id]
    assert len(matched) == 1
    assert matched[0]["usage_count"] == 1

    # 4. Hapus ditolak (400) karena masih dipakai MenuProduct
    res_del_blocked = await client.delete(f"/api/v1/config/master-data/{cat_id}", headers=headers)
    assert res_del_blocked.status_code == 400
    assert "menu / resep" in res_del_blocked.json()["detail"].lower()

    # 5. Rename kategori otomatis cascade ke MenuProduct.category dan muncul di /api/v1/menus categories
    res_rename = await client.put(
        f"/api/v1/config/master-data/{cat_id}",
        json={"name": "Limited Edition Cake"},
        headers=headers,
    )
    assert res_rename.status_code == 200
    assert res_rename.json()["item"]["name"] == "Limited Edition Cake"
    assert res_rename.json()["item"]["usage_count"] == 1

    db.expire_all()
    refreshed_menu = (
        await db.execute(select(MenuProduct).where(MenuProduct.id == menu_id))
    ).scalar_one()
    assert refreshed_menu.category == "Limited Edition Cake"

    res_menus = await client.get("/api/v1/menus", headers=headers)
    assert res_menus.status_code == 200
    assert "Limited Edition Cake" in res_menus.json()["categories"]

    # 6. Nonaktifkan, pindahkan menu ke kategori lain, lalu hapus berhasil (200)
    res_deactivate = await client.put(
        f"/api/v1/config/master-data/{cat_id}",
        json={"is_active": False},
        headers=headers,
    )
    assert res_deactivate.status_code == 200
    assert res_deactivate.json()["item"]["is_active"] is False

    res_move_menu = await client.put(
        f"/api/v1/menus/{menu_id}",
        json={"category": "Cake Ready"},
        headers=headers,
    )
    assert res_move_menu.status_code == 200

    res_del_ok = await client.delete(f"/api/v1/config/master-data/{cat_id}", headers=headers)
    assert res_del_ok.status_code == 200
    assert res_del_ok.json()["ok"] is True
