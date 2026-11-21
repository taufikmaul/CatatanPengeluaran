"""
tests/test_satuan_turunan_master.py — Unit & Integration tests untuk Pemilihan Satuan sesuai Master
& Turunan Satuan (Isi Kemasan) yang sinkron ke Master Item saat Auto Detect.

Kasus Pengguna:
1. Pemilihan Satuan di manapun harus sesuai data master yang terdaftar (tidak boleh satuan bebas/asal).
2. Satuan ada turunannya ketika beli, misal:
   1 Bungkus isi 1Kg tapi ada 1 Bungkus lain yang isinya 500g dengan item yang sama.
   Ini harus tersinkronisasi ketika auto detect ke master item.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.master_data_service import (
    get_valid_units,
    normalize_unit_to_master,
    create_master_option,
)
from app.models.master_item import MasterItem
from app.services.master_item_service import (
    create_master_item,
    list_master_items,
    match_and_normalize_extracted_items,
    extract_derivative,
    sync_derivative_to_isi_paket,
    infer_recipe_unit_conversion,
)


@pytest.fixture
async def client(db: AsyncSession):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def auth_cookies():
    token = create_session_token(role="admin")
    return {SESSION_COOKIE_NAME: token}


def test_extract_derivative():
    """Test regex ekstraksi turunan isi kemasan (berat, volume, hitungan)."""
    assert extract_derivative("Terigu Cakra 1kg") == "1 Kg"
    assert extract_derivative("Terigu Cakra 1 Bungkus isi 1Kg") == "1Kg"
    assert extract_derivative("Terigu Segitiga Biru 1 Bungkus isi 500g") == "500g"
    assert extract_derivative("Gula Pasir 500 gram") == "500 Gram"
    assert extract_derivative("Susu Carnation 1 box isi 6 pouch 2kg") == "6 pouch 2kg"
    assert extract_derivative("Minyak Bimoli 2L") == "2 Liter"
    assert extract_derivative("Plastik Roll 100 pcs") == "100 pcs"


def test_sync_derivative_to_isi_paket():
    """Test penggabungan varian turunan ke isi_paket tanpa duplikasi."""
    s1, c1 = sync_derivative_to_isi_paket("", "1Kg")
    assert c1 is True
    assert s1 == "1Kg"

    s2, c2 = sync_derivative_to_isi_paket(s1, "500g")
    assert c2 is True
    assert s2 == "1Kg, 500g"

    s3, c3 = sync_derivative_to_isi_paket(s2, "500g")
    assert c3 is False
    assert s3 == "1Kg, 500g"

    s4, c4 = sync_derivative_to_isi_paket(s3, "250g")
    assert c4 is True
    assert s4 == "1Kg, 500g, 250g"


@pytest.mark.asyncio
async def test_master_units_contain_bungkus_and_system_units(db: AsyncSession):
    """Pastikan Bungkus, Trans, Trip, Kg, Gram ada di data master satuan default."""
    units = await get_valid_units(db)
    for expected in ("Pcs", "Box", "Bungkus", "Kg", "Gram", "Dus", "Pack", "Trans", "Trip"):
        assert expected in units


@pytest.mark.asyncio
async def test_auto_detect_syncs_multiple_derivatives_for_same_item(db: AsyncSession):
    """
    Skenario Inti User:
    Item yang sama (misal 'Tepung Terigu Segitiga Biru').
    Beli 1: 1 Bungkus isi 1Kg
    Beli 2: 1 Bungkus lain yang isinya 500g dengan item yang sama.
    - Satuan transaksi keduanya adalah 'Bungkus' (sesuai data master).
    - Auto-detect mencocokkan keduanya ke MasterItem yang sama.
    - MasterItem.isi_paket tersinkronisasi menjadi memuat '1Kg' dan '500g'.
    """
    master_item = await create_master_item(
        db,
        item_name="Tepung Terigu Segitiga Biru",
        category="Bahan Kue",
        default_supplier="Toko Berkah",
        aliases="segitiga biru, terigu segitiga",
        satuan_beli="Bungkus",
        tipe_satuan="keduanya",
        isi_paket="",
        satuan_ecer="Gram",
    )
    assert master_item.satuan_beli == "Bungkus"

    # Transaksi 1: 1 Bungkus isi 1Kg
    items_tx1 = [
        {"barang": "Terigu Segitiga Biru 1 Bungkus isi 1Kg", "qty": 1, "satuan": "Bungkus", "harga_satuan": 14000}
    ]
    norm1 = await match_and_normalize_extracted_items(db, items_tx1)
    assert norm1[0]["barang"] == "Tepung Terigu Segitiga Biru"
    assert norm1[0]["satuan"] == "Bungkus"
    assert "Isi: 1Kg" in norm1[0]["keterangan"]
    assert master_item.isi_paket == "1Kg"

    # Transaksi 2: 1 Bungkus lain isi 500g dengan item yang sama
    items_tx2 = [
        {"barang": "Terigu Segitiga Biru 1 Bungkus isi 500g", "qty": 1, "satuan": "Bungkus", "harga_satuan": 7500}
    ]
    norm2 = await match_and_normalize_extracted_items(db, items_tx2)
    assert norm2[0]["barang"] == "Tepung Terigu Segitiga Biru"
    assert norm2[0]["satuan"] == "Bungkus"
    assert "Isi: 500g" in norm2[0]["keterangan"]

    # Pastikan isi_paket di master item tersinkronisasi menampung kedua turunan!
    assert "1Kg" in master_item.isi_paket
    assert "500g" in master_item.isi_paket
    assert master_item.isi_paket == "1Kg, 500g"


@pytest.mark.asyncio
async def test_expense_api_rejects_unregistered_unit(client, auth_cookies):
    """
    Validasi pemilihan satuan: di manapun harus sesuai data master yang terdaftar.
    Jika memasukkan satuan asal/typo (misal 'Bks-Asal' atau 'Kotakkk'), API menolak dengan HTTP 400.
    """
    client.cookies.update(auth_cookies)

    # 1. Coba simpan pengeluaran dengan satuan yang tidak terdaftar
    invalid_payload = {
        "expense_date": "2026-10-28",
        "supplier": "Toko Bahan",
        "item_name": "Gula Pasir",
        "qty": 1,
        "unit": "SatuanAsalGaib",
        "category": "Bahan Kue",
        "unit_price": 15000,
        "total_price": 15000,
        "pay_method": "Tunai",
    }
    res_invalid = await client.post("/api/v1/expenses", json=invalid_payload)
    assert res_invalid.status_code == 400
    assert "tidak sesuai data master" in res_invalid.json()["detail"]

    # 2. Simpan dengan satuan valid 'Bungkus'
    valid_payload = {**invalid_payload, "unit": "Bungkus"}
    res_valid = await client.post("/api/v1/expenses", json=valid_payload)
    assert res_valid.status_code == 201
    created = res_valid.json()
    assert created["unit"] == "Bungkus"
    exp_id = created["id"]

    # 3. Update pengeluaran dengan satuan tidak valid ditolak
    res_update_invalid = await client.put(f"/api/v1/expenses/{exp_id}", json={"unit": "SalahKetikUnit"})
    assert res_update_invalid.status_code == 400

    # 4. Update dengan satuan valid 'Kg' berhasil
    res_update_valid = await client.put(f"/api/v1/expenses/{exp_id}", json={"unit": "Kg"})
    assert res_update_valid.status_code == 200
    assert res_update_valid.json()["unit"] == "Kg"


@pytest.mark.asyncio
async def test_master_item_api_rejects_unregistered_unit(client, auth_cookies):
    """API Master Item juga menolak satuan beli/ecer yang tidak terdaftar di data master."""
    client.cookies.update(auth_cookies)

    invalid_payload = {
        "item_name": "Mentega Blueband",
        "category": "Bahan Kue",
        "satuan_beli": "SatuanAneh",
        "satuan_ecer": "Pcs",
    }
    res = await client.post("/api/v1/master-items", json=invalid_payload)
    assert res.status_code == 400
    assert "tidak sesuai data master" in res.json()["detail"]


def test_infer_recipe_unit_conversion():
    """Test inferensi turunan satuan resep terkecil dari satuan beli / isi paket / nama item."""
    assert infer_recipe_unit_conversion("Kg", "Kg", "") == ("Gram", 1000.0)
    assert infer_recipe_unit_conversion("Liter", "Liter", "") == ("ml", 1000.0)
    assert infer_recipe_unit_conversion("Box", "Pouch", "6 pouch @ 2kg") == ("Gram", 12000.0)
    assert infer_recipe_unit_conversion("Bungkus", "Bungkus", "500g") == ("Gram", 500.0)
    assert infer_recipe_unit_conversion("Tray", "Tray", "") == ("Butir", 30.0)
    assert infer_recipe_unit_conversion("Pack", "Pcs", "25 pcs") == ("Pcs", 25.0)
    # Pastikan dimensi kemasan seperti 20x20 tidak salah terdeteksi sebagai gram/ml
    assert infer_recipe_unit_conversion("Box", "Pcs", "", "Box Mika 20x20") == (None, None)


@pytest.mark.asyncio
async def test_master_item_recipe_units_crud_autofill_and_conversion_hint(
    client, db: AsyncSession, auth_cookies
):
    """Test POST/PUT/auto-fill satuan resep MasterItem, recipe_unit_price, dan integration /menus/conversion-hint."""
    client.cookies.update(auth_cookies)

    # 1. POST MasterItem dengan satuan_beli='Kg' -> auto-infer Gram & 1000
    res_kg = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Gula Pasir Premium",
            "category": "Bahan Kue",
            "satuan_beli": "Kg",
            "satuan_ecer": "Kg",
        },
    )
    assert res_kg.status_code == 201
    kg_item = res_kg.json()
    kg_id = kg_item["id"]
    assert kg_item["satuan_resep"] == "Gram"
    assert kg_item["konversi_resep"] == 1000.0

    # Buat transaksi pengeluaran Rp 18.000/Kg agar recipe_unit_price terhitung (18.0 / Gram)
    res_exp = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-11-22",
            "supplier": "Toko Berkah",
            "item_name": "Gula Pasir Premium",
            "master_item_id": kg_id,
            "qty": 2,
            "unit": "Kg",
            "category": "Bahan Kue",
            "unit_price": 18000,
            "total_price": 36000,
            "pay_method": "Tunai",
        },
    )
    assert res_exp.status_code == 201

    res_list = await client.get("/api/v1/master-items")
    assert res_list.status_code == 200
    listed_kg = [x for x in res_list.json()["data"] if x["id"] == kg_id][0]
    assert listed_kg["last_unit_price"] == 18000.0
    assert listed_kg["satuan_resep"] == "Gram"
    assert listed_kg["konversi_resep"] == 1000.0
    assert listed_kg["recipe_unit_price"] == 18.0

    # 2. PUT ubah satuan_resep & konversi_resep (misal butter 227g per bungkus)
    res_butter = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Mentega Anchor Salted",
            "category": "Bahan Kue",
            "satuan_beli": "Bungkus",
            "satuan_ecer": "Bungkus",
        },
    )
    assert res_butter.status_code == 201
    butter_id = res_butter.json()["id"]

    res_put = await client.put(
        f"/api/v1/master-items/{butter_id}",
        json={"satuan_resep": "gr", "konversi_resep": 227},
    )
    assert res_put.status_code == 200
    assert res_put.json()["satuan_resep"] == "Gram"
    assert res_put.json()["konversi_resep"] == 227.0

    # 3. Item lama di DB tanpa satuan_resep vs item yang sudah diatur manual -> auto-fill tidak menimpa manual
    legacy_liter = MasterItem(
        item_name="Susu UHT Full Cream Legacy",
        category="Bahan Kue",
        satuan_beli="Liter",
        satuan_ecer="Liter",
        isi_paket="",
        satuan_resep=None,
        konversi_resep=None,
    )
    manual_custom = MasterItem(
        item_name="Butter Custom Legacy",
        category="Bahan Kue",
        satuan_beli="Kg",
        satuan_ecer="Kg",
        isi_paket="",
        satuan_resep="Gram",
        konversi_resep=950.0,
    )
    db.add(legacy_liter)
    db.add(manual_custom)
    await db.commit()
    await db.refresh(legacy_liter)
    await db.refresh(manual_custom)

    res_autofill = await client.post("/api/v1/master-items/auto-fill-recipe-units")
    assert res_autofill.status_code == 200
    assert res_autofill.json()["ok"] is True
    assert res_autofill.json()["updated"] >= 1

    db.expire_all()
    await db.refresh(legacy_liter)
    await db.refresh(manual_custom)
    assert legacy_liter.satuan_resep == "ml"
    assert legacy_liter.konversi_resep == 1000.0
    assert manual_custom.konversi_resep == 950.0

    # 4. /api/v1/menus/conversion-hint memprioritaskan satuan_resep & konversi_resep (termasuk konversi silang)
    res_hint_gram = await client.get(
        f"/api/v1/menus/conversion-hint?master_item_id={butter_id}&recipe_unit=Gram"
    )
    assert res_hint_gram.status_code == 200
    assert res_hint_gram.json()["yield_factor"] == 227.0
    assert res_hint_gram.json()["satuan_resep"] == "Gram"
    assert res_hint_gram.json()["konversi_resep"] == 227.0

    res_hint_kg = await client.get(
        f"/api/v1/menus/conversion-hint?master_item_id={butter_id}&recipe_unit=Kg"
    )
    assert res_hint_kg.status_code == 200
    assert res_hint_kg.json()["yield_factor"] == 0.227
