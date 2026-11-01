"""
tests/test_auto_sync_chain.py — Test chain otomatisasi update transaksi ke Master Item & Master Supplier
dan uji background delta sync 5x sehari.
"""
from datetime import date
from decimal import Decimal
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.expense import Expense
from app.models.master_item import MasterItem
from app.models.supplier import Supplier
from app.models.system_setting import SystemSetting
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.master_item_service import create_master_item
from app.services.supplier_service import create_supplier, get_suppliers
from app.services.expense_service import (
    save_expenses,
    update_expense,
    batch_insert_expenses,
    sync_changed_expenses_delta,
)
from app.scheduler.jobs import job_auto_sync_delta


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


@pytest.mark.asyncio
async def test_update_expense_auto_syncs_master_item(db: AsyncSession):
    """
    Ketika user mengubah nama barang pada transaksi:
    1. Jika cocok dengan master item lain, master_item_id otomatis diperbarui ke master item tersebut.
    2. Jika tidak cocok ke katalog master, master_item_id dilepas (None) agar tidak mengotori master lama.
    """
    m1 = await create_master_item(
        db,
        item_name="Tepung Terigu Segitiga Biru",
        category="Bahan Kue",
        default_supplier="Toko Berkah",
    )
    m2 = await create_master_item(
        db,
        item_name="Cokelat Colatta Dark 1kg",
        category="Bahan Kue",
        default_supplier="Toko Sandy",
    )
    await db.commit()

    # 1. Simpan transaksi awal terhubung ke m1
    saved = await save_expenses(
        db,
        [
            {
                "expense_date": date(2026, 11, 1),
                "supplier": "Toko Berkah",
                "item_name": "Tepung Terigu Segitiga Biru",
                "qty": 2,
                "unit": "Sak",
                "category": "Bahan Kue",
                "total_price": 250000,
                "pay_method": "Tunai",
                "pay_status": "Lunas",
            }
        ],
    )
    expense = saved[0]
    assert expense.master_item_id == m1.id

    # 2. Update nama barang ke Cokelat Colatta
    updated = await update_expense(
        db,
        expense.id,
        {"item_name": "Cokelat Colatta Dark 1kg", "master_item_id": m1.id},  # Simulasi payload frontend
        actor="dashboard:admin",
    )
    await db.commit()
    await db.refresh(updated)

    assert updated.item_name == "Cokelat Colatta Dark 1kg"
    assert updated.master_item_id == m2.id

    # 3. Update ke barang yang tidak ada di master catalog
    updated2 = await update_expense(
        db,
        expense.id,
        {"item_name": "Barang Random Tidak Ada Di Master XYZ 999"},
        actor="dashboard:admin",
    )
    await db.commit()
    await db.refresh(updated2)

    assert updated2.master_item_id is None


@pytest.mark.asyncio
async def test_update_expense_auto_syncs_master_supplier(db: AsyncSession):
    """
    Ketika user mengubah nama supplier pada transaksi:
    1. Supplier baru otomatis dibuat atau dicocokkan di tabel suppliers.
    2. supplier_id pada transaksi otomatis terhubung ke supplier yang benar.
    """
    s1 = await create_supplier(db, name="Toko Sumber Rejeki")
    await db.commit()

    saved = await save_expenses(
        db,
        [
            {
                "expense_date": date(2026, 11, 1),
                "supplier": "Toko Sumber Rejeki",
                "item_name": "Plastik Kemasan",
                "qty": 5,
                "unit": "Pack",
                "category": "Operasional",
                "total_price": 50000,
                "pay_method": "Transfer",
                "pay_status": "Lunas",
            }
        ],
    )
    expense = saved[0]
    assert expense.supplier_id == s1.id

    # Update nama supplier ke toko baru
    updated = await update_expense(
        db,
        expense.id,
        {"supplier": "Toko Sentosa Jaya Baru"},
        actor="dashboard:admin",
    )
    await db.commit()
    await db.refresh(updated)

    assert updated.supplier == "Toko Sentosa Jaya Baru"
    assert updated.supplier_id is not None
    assert updated.supplier_id != s1.id

    # Verifikasi supplier baru tercatat di database Master Supplier
    s2 = await db.get(Supplier, updated.supplier_id)
    assert s2 is not None
    assert s2.name == "Toko Sentosa Jaya Baru"


@pytest.mark.asyncio
async def test_create_expense_api_links_supplier(client: AsyncClient, auth_cookies: dict, db: AsyncSession):
    """Memastikan POST /expenses langsung menghubungkan supplier_id sehingga supplier stats langsung update."""
    payload = {
        "expense_date": "2026-11-01",
        "supplier": "Toko Aneka Plastik",
        "item_name": "Cup Puding 100ml",
        "qty": 10,
        "unit": "Pack",
        "category": "Operasional",
        "unit_price": 15000,
        "total_price": 150000,
        "pay_method": "Tunai",
        "pay_status": "Lunas",
    }
    res = await client.post("/api/v1/expenses", json=payload, cookies=auth_cookies)
    assert res.status_code == 201
    data = res.json()
    assert data["supplier_id"] is not None

    # Cek di get_suppliers
    items, total, summary = await get_suppliers(db, search="Aneka Plastik")
    assert total >= 1
    target = next((s for s in items if s["name"] == "Toko Aneka Plastik"), None)
    assert target is not None
    assert target["total_spent"] >= 150000


@pytest.mark.asyncio
async def test_batch_insert_expenses_links_supplier(db: AsyncSession):
    """Memastikan batch_insert_expenses (OCR) juga menghubungkan supplier_id."""
    items = [
        {
            "expense_date": date(2026, 11, 1),
            "supplier": "TBK Makmur Jaya",
            "item_name": "Keju Cheddar 2kg",
            "qty": 1,
            "unit": "Box",
            "category": "Bahan Kue",
            "unit_price": 120000,
            "total_price": 120000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
        }
    ]
    saved = await batch_insert_expenses(db, items, actor="test:batch")
    await db.commit()

    assert len(saved) == 1
    assert saved[0].supplier_id is not None
    assert saved[0].supplier == "TBK Makmur Jaya"


@pytest.mark.asyncio
async def test_sync_changed_expenses_delta(db: AsyncSession):
    """
    Uji background delta sync:
    1. Hanya memproses transaksi yang berubah atau unlinked.
    2. Menyimpan checkpoint log ID agar hemat dan tidak memproses ulang seluruh database.
    """
    m = await create_master_item(
        db,
        item_name="Margarin ForVITA 200g",
        category="Bahan Kue",
        default_supplier="Toko Roti Indah",
    )
    s = await create_supplier(db, name="Toko Roti Indah")
    await db.commit()

    # Buat expense unlinked secara manual
    exp = Expense(
        expense_date=date(2026, 11, 1),
        supplier="Toko Roti Indah",
        supplier_id=None,
        item_name="Margarin ForVITA 200g",
        master_item_id=None,
        qty=Decimal("5"),
        unit="Pcs",
        category="Bahan Kue",
        unit_price=Decimal("8000"),
        total_price=Decimal("40000"),
        pay_method="Tunai",
        pay_status="Lunas",
    )
    db.add(exp)
    await db.commit()
    await db.refresh(exp)

    assert exp.master_item_id is None
    assert exp.supplier_id is None

    # Jalankan delta sync
    res = await sync_changed_expenses_delta(db, limit=50)
    assert res["ok"] is True
    assert res["synced_count"] >= 1

    await db.refresh(exp)
    assert exp.master_item_id == m.id
    assert exp.supplier_id == s.id

    # Jalankan delta sync kedua kali -> Tidak ada data yang berubah (no-op)
    res2 = await sync_changed_expenses_delta(db, limit=50)
    assert res2["ok"] is True
    assert res2["synced_count"] == 0
    assert "Tidak ada data transaksi" in res2["message"]


@pytest.mark.asyncio
async def test_scheduler_job_auto_sync_delta():
    """Memastikan fungsi job_auto_sync_delta yang dipanggil APScheduler dapat dieksekusi tanpa error."""
    # Menjalankan job tanpa raise exception
    await job_auto_sync_delta()
