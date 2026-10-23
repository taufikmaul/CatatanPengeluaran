"""
tests/test_master_items_satuan.py — Test Satuan Item & Paket/Ecer pada Master Item
Contoh: Carnation bisa 1 box isi 6 pouch 2kg
"""
import pytest
from decimal import Decimal
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.models.master_item import MasterItem
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.master_item_service import (
    create_master_item,
    list_master_items,
    match_and_normalize_extracted_items,
    bulk_Import_master_items,
    get_item_and_supplier_suggestions,
)
from app.services.expense_service import save_expenses, get_item_price_history
from app.utils.formatters import build_items_summary, format_expense_items_summary


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
    token = create_session_token()
    return {SESSION_COOKIE_NAME: token}


@pytest.mark.asyncio
async def test_create_master_item_carnation_paket_ecer(db: AsyncSession):
    """
    Test pembuatan Master Item untuk Susu Carnation:
    - Satuan Beli: Box
    - Tipe: keduanya (Bisa Paket & Ecer)
    - Isi Paket: 1 box isi 6 pouch 2kg
    - Satuan Ecer: Pouch
    """
    item = await create_master_item(
        db,
        item_name="Susu Carnation",
        category="Bahan Kue",
        default_supplier="Toko Makmur",
        aliases="carnation pouch, skm carnation, susu kental manis carnation",
        satuan_beli="Box",
        tipe_satuan="keduanya",
        isi_paket="1 box isi 6 pouch 2kg",
        satuan_ecer="Pouch",
    )
    assert item.id is not None
    assert item.item_name == "Susu Carnation"
    assert item.satuan_beli == "Box"
    assert item.tipe_satuan == "keduanya"
    assert item.isi_paket == "1 box isi 6 pouch 2kg"
    assert item.satuan_ecer == "Pouch"


@pytest.mark.asyncio
async def test_bulk_import_with_satuan(db: AsyncSession):
    """Test bulk import dengan kolom satuan & isi paket."""
    raw_text = (
        "Susu Carnation | Bahan Kue | carnation pouch | Toko Makmur | Box | keduanya | 1 box isi 6 pouch 2kg | Pouch\n"
        "Tepung Terigu Cakra | Bahan Kue | terigu cakra | Toko Roti | Sak | keduanya | 25 kg | Kg\n"
        "Kardus Kue 20x20 | Kemasan | dus 20x20 | Surya Kemasan | Bal | paket | 1 bal isi 100 pcs | Pcs"
    )
    res = await bulk_Import_master_items(db, raw_text)
    assert res["added"] == 3

    items = await list_master_items(db)
    carnation = next(i for i in items if i.item_name == "Susu Carnation")
    assert carnation.satuan_beli == "Box"
    assert carnation.tipe_satuan == "keduanya"
    assert carnation.isi_paket == "1 box isi 6 pouch 2kg"
    assert carnation.satuan_ecer == "Pouch"

    kardus = next(i for i in items if i.item_name == "Kardus Kue 20x20")
    assert kardus.satuan_beli == "Bal"
    assert kardus.tipe_satuan == "paket"
    assert kardus.isi_paket == "1 bal isi 100 pcs"


@pytest.mark.asyncio
async def test_matching_detects_box_vs_pouch(db: AsyncSession):
    """
    Test pencocokan nama struk:
    - Jika tertulis '1 box carnation' -> unit otomatis Box
    - Jika tertulis 'pouch carnation' -> unit otomatis Pouch
    """
    await create_master_item(
        db,
        item_name="Susu Carnation",
        category="Bahan Kue",
        default_supplier="Toko Makmur",
        aliases="carnation",
        satuan_beli="Box",
        tipe_satuan="keduanya",
        isi_paket="1 box isi 6 pouch 2kg",
        satuan_ecer="Pouch",
    )

    items_to_match = [
        {"barang": "1 box carnation", "qty": 1, "harga_satuan": 120000},
        {"barang": "pouch carnation 2kg", "qty": 2, "harga_satuan": 21000},
    ]

    normalized = await match_and_normalize_extracted_items(db, items_to_match)

    assert normalized[0]["barang"] == "Susu Carnation"
    assert normalized[0]["satuan"] == "Box"
    assert "Struk: 1 box carnation" in normalized[0]["keterangan"]

    assert normalized[1]["barang"] == "Susu Carnation"
    assert normalized[1]["satuan"] == "Pouch"
    assert "Struk: pouch carnation 2kg" in normalized[1]["keterangan"]


@pytest.mark.asyncio
async def test_api_master_items_crud_with_satuan(client, auth_cookies):
    """Test REST API endpoint /api/v1/master-items dengan field satuan."""
    client.cookies.update(auth_cookies)

    # 1. Tambah Master Item
    create_payload = {
        "item_name": "Susu Carnation",
        "category": "Bahan Kue",
        "default_supplier": "Toko Makmur",
        "aliases": "skm carnation",
        "satuan_beli": "Box",
        "tipe_satuan": "keduanya",
        "isi_paket": "1 box isi 6 pouch 2kg",
        "satuan_ecer": "Pouch",
    }
    post_res = await client.post("/api/v1/master-items", json=create_payload)
    assert post_res.status_code == 201
    item_data = post_res.json()
    assert item_data["satuan_beli"] == "Box"
    assert item_data["tipe_satuan"] == "keduanya"
    assert item_data["isi_paket"] == "1 box isi 6 pouch 2kg"
    assert item_data["satuan_ecer"] == "Pouch"
    item_id = item_data["id"]

    # 2. Get Master Items list
    list_res = await client.get("/api/v1/master-items")
    assert list_res.status_code == 200
    all_items = list_res.json()["data"]
    found = next(i for i in all_items if i["id"] == item_id)
    assert found["satuan_beli"] == "Box"
    assert found["isi_paket"] == "1 box isi 6 pouch 2kg"

    # 3. Update Master Item
    update_res = await client.put(
        f"/api/v1/master-items/{item_id}",
        json={"isi_paket": "1 box isi 6 pouch @ 2kg (12kg)", "satuan_ecer": "Pouch"},
    )
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["isi_paket"] == "1 box isi 6 pouch @ 2kg (12kg)"

    # 4. Get suggestions includes satuan fields
    sug_res = await client.get("/api/v1/master-items/suggestions")
    assert sug_res.status_code == 200
    sug_items = sug_res.json()["items"]
    carnation_sug = next(i for i in sug_items if i["item_name"] == "Susu Carnation")
    assert carnation_sug["satuan_beli"] == "Box"
    assert carnation_sug["tipe_satuan"] == "keduanya"
    assert carnation_sug["isi_paket"] == "1 box isi 6 pouch @ 2kg (12kg)"
    assert carnation_sug["satuan_ecer"] == "Pouch"


@pytest.mark.asyncio
async def test_expense_crud_with_unit(client, auth_cookies):
    """Test pencatatan pengeluaran dengan kolom unit (satuan)."""
    client.cookies.update(auth_cookies)

    # Create expense with unit = Box
    exp_payload = {
        "expense_date": "2026-10-23",
        "supplier": "Toko Makmur",
        "item_name": "Susu Carnation",
        "qty": 2,
        "unit": "Box",
        "category": "Bahan Kue",
        "unit_price": 125000,
        "total_price": 250000,
        "pay_method": "Transfer",
        "pay_status": "Lunas",
    }
    res = await client.post("/api/v1/expenses", json=exp_payload)
    assert res.status_code == 201
    data = res.json()
    assert data["unit"] == "Box"
    assert data["qty"] == 2.0
    exp_id = data["id"]

    # Read list
    list_res = await client.get("/api/v1/expenses")
    assert list_res.status_code == 200
    items = list_res.json()["data"]
    exp_found = next(e for e in items if e["id"] == exp_id)
    assert exp_found["unit"] == "Box"

    # Price history shows unit
    hist_res = await client.get("/api/v1/expenses/price-history?item_name=Susu Carnation")
    assert hist_res.status_code == 200
    hist_data = hist_res.json()
    assert len(hist_data["history"]) >= 1
    assert hist_data["history"][0]["unit"] == "Box"


def test_formatters_include_satuan():
    """Test formatters Telegram/teks menampilkan satuan dengan rapi."""
    raw_items = [
        {"barang": "Susu Carnation", "qty": 1, "satuan": "Box", "harga_satuan": 120000, "total_harga": 120000},
        {"barang": "Gula Pasir", "qty": 5, "satuan": "Kg", "harga_satuan": 17000, "total_harga": 85000},
    ]
    summary, total = build_items_summary(raw_items)
    assert "1 Box @Rp 120.000" in summary
    assert "5 Kg @Rp 17.000" in summary
    assert total == 205000.0
