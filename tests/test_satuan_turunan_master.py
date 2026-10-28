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
from app.services.master_item_service import (
    create_master_item,
    list_master_items,
    match_and_normalize_extracted_items,
    extract_derivative,
    sync_derivative_to_isi_paket,
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
