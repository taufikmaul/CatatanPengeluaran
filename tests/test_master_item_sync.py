"""
tests/test_master_item_sync.py — Test sinkronisasi order & item baku berdasarkan Product ID (master_item_id)
Memastikan ketika nama item baku diubah, pesanan/order tidak hilang dan tetap tersinkronisasi.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.models.master_item import MasterItem
from app.models.expense import Expense
from app.services.master_item_service import (
    create_master_item,
    list_master_items,
    sync_existing_expenses_to_master,
    get_item_and_supplier_suggestions,
)
from app.services.expense_service import (
    save_expenses,
    get_item_price_history,
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
    token = create_session_token()
    return {SESSION_COOKIE_NAME: token}


@pytest.mark.asyncio
async def test_expense_links_to_master_item_id(db):
    """Pastikan expense yang dibuat otomatis menyimpan master_item_id dari item baku."""
    master = await create_master_item(
        db,
        item_name="Tepung Terigu Segitiga Biru",
        category="Bahan Kue",
        default_supplier="Toko Loyang",
        aliases="segitiga biru, terigu segitiga",
        satuan_beli="Sak",
    )
    await db.commit()

    saved_list = await save_expenses(
        db,
        [
            {
                "tanggal": "2026-10-24",
                "barang": "Terigu Segitiga 1kg",
                "qty": 5,
                "harga_satuan": 12000,
                "total_harga": 60000,
                "toko_supplier": "Toko Loyang",
            }
        ],
    )
    await db.commit()

    assert len(saved_list) == 1
    exp = saved_list[0]
    assert exp.master_item_id == master.id
    assert exp.item_name == "Tepung Terigu Segitiga Biru"
    assert "Struk: Terigu Segitiga 1kg" in exp.notes


@pytest.mark.asyncio
async def test_renaming_master_item_keeps_orders_synced(client, auth_cookies, db):
    """
    Skenario Utama Pengguna:
    Ketika ganti nama item baku, orderannya tidak boleh hilang.
    Harus tetap sync karena dikaitkan berdasarkan ID produk (master_item_id).
    """
    client.cookies.update(auth_cookies)

    # 1. Buat item baku awal
    create_master_res = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Coklat Bubuk Tulip",
            "category": "Bahan Kue",
            "default_supplier": "Toko Bahan Kue",
            "aliases": "tulip coklat, bubuk tulip",
            "satuan_beli": "Box",
        },
    )
    assert create_master_res.status_code == 201
    master_data = create_master_res.json()
    master_id = master_data["id"]

    # 2. Catat order / pengeluaran untuk barang tersebut
    exp_res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-24",
            "supplier": "Toko Bahan Kue",
            "item_name": "Tulip Coklat Bubuk 250g",
            "qty": 3,
            "unit_price": 35000,
            "total_price": 105000,
            "pay_method": "Tunai",
            "pay_status": "Lunas",
        },
    )
    assert exp_res.status_code == 201
    exp_data = exp_res.json()
    assert exp_data["master_item_id"] == master_id
    assert exp_data["item_name"] == "Coklat Bubuk Tulip"

    # Verifikasi sebelum ganti nama: transaksi terhitung di katalog
    list_before = await client.get("/api/v1/master-items")
    assert list_before.status_code == 200
    item_before = next(i for i in list_before.json()["data"] if i["id"] == master_id)
    assert item_before["tx_count"] == 1
    assert item_before["last_unit_price"] == 35000.0

    # 3. Ganti nama item baku menjadi nama baru
    update_res = await client.put(
        f"/api/v1/master-items/{master_id}",
        json={
            "item_name": "Tulip Pure Cocoa Powder",
            "category": "Bahan Kue",
        },
    )
    assert update_res.status_code == 200
    updated_master = update_res.json()
    assert updated_master["item_name"] == "Tulip Pure Cocoa Powder"
    # Nama lama otomatis masuk ke aliases
    assert "Coklat Bubuk Tulip" in updated_master["aliases"]

    # 4. Verifikasi di DB: Pengeluaran/order lama otomatis sinkron ke nama baru & master_item_id tetap sama
    exp_db = await db.scalar(select(Expense).where(Expense.id == exp_data["id"]))
    assert exp_db.master_item_id == master_id
    assert exp_db.item_name == "Tulip Pure Cocoa Powder"

    # 5. Verifikasi katalog /master-items: transaksi TIDAK hilang (tetap 1x dan harga tetap ada)
    list_after = await client.get("/api/v1/master-items")
    assert list_after.status_code == 200
    item_after = next(i for i in list_after.json()["data"] if i["id"] == master_id)
    assert item_after["item_name"] == "Tulip Pure Cocoa Powder"
    assert item_after["tx_count"] == 1
    assert item_after["last_unit_price"] == 35000.0

    # 6. Verifikasi endpoint price-history via item_id maupun nama baru
    history_by_id = await client.get(f"/api/v1/expenses/price-history?item_id={master_id}")
    assert history_by_id.status_code == 200
    h_data_id = history_by_id.json()
    assert h_data_id["tx_count"] == 1
    assert h_data_id["item_name"] == "Tulip Pure Cocoa Powder"
    assert len(h_data_id["history"]) == 1
    assert h_data_id["history"][0]["id"] == exp_data["id"]

    history_by_new_name = await client.get("/api/v1/expenses/price-history?item_name=Tulip%20Pure%20Cocoa%20Powder")
    assert history_by_new_name.status_code == 200
    assert history_by_new_name.json()["tx_count"] == 1

    # History dengan nama lama pun tetap dapat menemukan datanya lewat alias
    history_by_old_name = await client.get("/api/v1/expenses/price-history?item_name=Coklat%20Bubuk%20Tulip")
    assert history_by_old_name.status_code == 200
    assert history_by_old_name.json()["tx_count"] == 1


@pytest.mark.asyncio
async def test_sync_existing_expenses_populates_master_item_id(db):
    """Uji bahwa sinkronisasi data lama mengisi master_item_id."""
    master = await create_master_item(
        db,
        item_name="Keju Cheddar Meg",
        category="Bahan Kue",
    )
    await db.commit()

    # Buat transaksi tanpa master_item_id
    exp = Expense(
        item_name="Keju Cheddar Meg",
        supplier="Toko Sejahtera",
        category="Operasional",
        expense_date=pytest.importorskip("datetime").date.today(),
        qty=1,
        unit="Pcs",
        unit_price=22000,
        total_price=22000,
        pay_method="Tunai",
        pay_status="Lunas",
        master_item_id=None,
    )
    db.add(exp)
    await db.commit()

    # Jalankan sync_existing_expenses_to_master
    sync_res = await sync_existing_expenses_to_master(db)
    await db.commit()

    await db.refresh(exp)
    assert exp.master_item_id == master.id
    assert exp.category == "Bahan Kue"


@pytest.mark.asyncio
async def test_deleting_master_item_unlinks_without_deleting_expenses(client, auth_cookies, db):
    """Menghapus item baku hanya mengosongkan master_item_id tanpa menghapus pengeluaran."""
    client.cookies.update(auth_cookies)

    create_res = await client.post(
        "/api/v1/master-items",
        json={"item_name": "Kertas Roti", "category": "Kemasan"},
    )
    master_id = create_res.json()["id"]

    exp_res = await client.post(
        "/api/v1/expenses",
        json={
            "item_name": "Kertas Roti",
            "qty": 1,
            "unit_price": 10000,
            "total_price": 10000,
        },
    )
    exp_id = exp_res.json()["id"]

    # Hapus item baku
    del_res = await client.delete(f"/api/v1/master-items/{master_id}")
    assert del_res.status_code == 200

    # Expense tetap ada, tapi master_item_id jadi None
    exp = await db.scalar(select(Expense).where(Expense.id == exp_id))
    assert exp is not None
    assert exp.master_item_id is None
