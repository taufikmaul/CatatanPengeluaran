"""
tests/test_pay_method_filter.py — Tests for payment method filtering and AI payment method normalization
"""
import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.models.expense import Expense
from app.models.user import User
from app.services.master_data_service import normalize_payment_method_name
from app.services.ai_service import _execute_fetch
from app.services.master_item_service import match_and_normalize_extracted_items
from app.services.expense_service import save_expenses, get_all_expenses_paginated


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


def test_normalize_payment_method_name():
    # Tunai synonyms
    assert normalize_payment_method_name("tunai") == "Tunai"
    assert normalize_payment_method_name("cash") == "Tunai"
    assert normalize_payment_method_name("kasir") == "Tunai"

    # Transfer synonyms
    assert normalize_payment_method_name("bca") == "Transfer"
    assert normalize_payment_method_name("tf") == "Transfer"
    assert normalize_payment_method_name("transfer bank") == "Transfer"
    assert normalize_payment_method_name("dana") == "Transfer"
    assert normalize_payment_method_name("gopay") == "Transfer"

    # QRIS synonyms
    assert normalize_payment_method_name("qris") == "QRIS"
    assert normalize_payment_method_name("scan qr") == "QRIS"
    assert normalize_payment_method_name("qr code") == "QRIS"

    # Debit synonyms
    assert normalize_payment_method_name("kartu debit") == "Debit"
    assert normalize_payment_method_name("edc debit") == "Debit"

    # Kredit synonyms
    assert normalize_payment_method_name("kartu kredit") == "Kredit"
    assert normalize_payment_method_name("cc") == "Kredit"

    # COD synonyms
    assert normalize_payment_method_name("cod") == "COD"
    assert normalize_payment_method_name("bayar di tempat") == "COD"
    assert normalize_payment_method_name("bayar ditempat") == "COD"
    assert normalize_payment_method_name("cash on delivery") == "COD"

    # None or unknown fallback to master default (Tunai)
    assert normalize_payment_method_name(None) == "Tunai"
    assert normalize_payment_method_name("") == "Tunai"
    assert normalize_payment_method_name("unknown_random_method") == "Tunai"


@pytest.mark.asyncio
async def test_ai_service_non_cod_forces_lunas():
    # Mock LLM returning Transfer with Belum Lunas
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "Tepung Terigu Cakra Kembar",
                            "qty": 2,
                            "satuan": "Sak",
                            "harga_satuan": 250000,
                            "total_harga": 500000,
                            "toko_supplier": "Toko Bahan Kue",
                            "metode_bayar": "transfer bca",
                            "status_pembayaran": "Belum Lunas",
                            "keterangan": "beli terigu"
                        }
                    ]
                }"""
            }
        }]
    }

    mock_res = MagicMock()
    mock_res.json.return_value = raw_llm_response

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_res
        res = await _execute_fetch([{"role": "user", "content": "terigu 2 sak transfer bca"}])

        assert "items" in res
        item = res["items"][0]
        # Should be normalized to canonical "Transfer"
        assert item["metode_bayar"] == "Transfer"
        # Should be forced to "Lunas" because it's not COD
        assert item["status_pembayaran"] == "Lunas"


@pytest.mark.asyncio
async def test_master_item_service_normalizes_payment_method_and_status(db):
    items = [
        {
            "barang": "Susu UHT",
            "qty": 1,
            "satuan": "Dus",
            "harga_satuan": 180000,
            "total_harga": 180000,
            "toko_supplier": "Diamond",
            "metode_bayar": "cash kasir",
            "status_pembayaran": "Belum Lunas",
        },
        {
            "barang": "Mika Box",
            "qty": 10,
            "satuan": "Pcs",
            "harga_satuan": 5000,
            "total_harga": 50000,
            "toko_supplier": "Boxlab",
            "metode_bayar": "bayar di tempat",
            "status_pembayaran": "Belum Lunas",
        }
    ]

    normalized = await match_and_normalize_extracted_items(db, items)

    # Item 1: cash -> Tunai, status -> Lunas
    assert normalized[0]["metode_bayar"] == "Tunai"
    assert normalized[0]["status_pembayaran"] == "Lunas"

    # Item 2: bayar di tempat -> COD, status -> Belum Lunas
    assert normalized[1]["metode_bayar"] == "COD"
    assert normalized[1]["status_pembayaran"] == "Belum Lunas"


@pytest.mark.asyncio
async def test_save_expenses_enforces_lunas_for_non_cod(db):
    user = User(telegram_id=77771, name="Test User", is_auth=True)
    db.add(user)
    await db.flush()

    items = [
        {
            "barang": "Mentega Wisman",
            "qty": 1,
            "satuan": "Kaleng",
            "harga_satuan": 300000,
            "total_harga": 300000,
            "toko_supplier": "TBK Berkah",
            "metode_bayar": "bca",
            "status_pembayaran": "Belum Lunas",  # Should become Lunas
        },
        {
            "barang": "Stiker Logo",
            "qty": 100,
            "satuan": "Pcs",
            "harga_satuan": 500,
            "total_harga": 50000,
            "toko_supplier": "Percetakan Express",
            "metode_bayar": "cod",
            "status_pembayaran": "Belum Lunas",  # Should remain Belum Lunas
        }
    ]

    saved = await save_expenses(
        db=db,
        items=items,
        user_id=user.id,
    )

    assert len(saved) == 2
    wisman = next(e for e in saved if e.item_name == "Mentega Wisman")
    assert wisman.pay_method == "Transfer"
    assert wisman.pay_status == "Lunas"

    stiker = next(e for e in saved if e.item_name == "Stiker Logo")
    assert stiker.pay_method == "COD"
    assert stiker.pay_status == "Belum Lunas"


@pytest.mark.asyncio
async def test_get_all_expenses_paginated_pay_method_filter(db):
    user = User(telegram_id=77772, name="Test Filter User", is_auth=True)
    db.add(user)
    await db.flush()

    exp1 = Expense(
        expense_date=date(2026, 10, 28),
        supplier="Supplier A",
        item_name="Item Tunai Unik",
        qty=Decimal("1"),
        unit="Pcs",
        category="Bahan Baku",
        unit_price=Decimal("10000"),
        total_price=Decimal("10000"),
        pay_method="Tunai",
        pay_status="Lunas",
        user_id=user.id,
    )
    exp2 = Expense(
        expense_date=date(2026, 10, 28),
        supplier="Supplier B",
        item_name="Item Transfer Unik",
        qty=Decimal("1"),
        unit="Pcs",
        category="Bahan Baku",
        unit_price=Decimal("20000"),
        total_price=Decimal("20000"),
        pay_method="Transfer",
        pay_status="Lunas",
        user_id=user.id,
    )
    exp3 = Expense(
        expense_date=date(2026, 10, 28),
        supplier="Supplier C",
        item_name="Item COD Unik",
        qty=Decimal("1"),
        unit="Pcs",
        category="Bahan Baku",
        unit_price=Decimal("30000"),
        total_price=Decimal("30000"),
        pay_method="COD",
        pay_status="Belum Lunas",
        user_id=user.id,
    )
    db.add_all([exp1, exp2, exp3])
    await db.flush()

    # Filter by Transfer
    items_tf, total_tf = await get_all_expenses_paginated(db, page=1, per_page=10, pay_method="Transfer")
    assert any(e.item_name == "Item Transfer Unik" for e in items_tf)
    assert not any(e.item_name == "Item Tunai Unik" for e in items_tf)
    assert not any(e.item_name == "Item COD Unik" for e in items_tf)

    # Filter by COD
    items_cod, total_cod = await get_all_expenses_paginated(db, page=1, per_page=10, pay_method="COD")
    assert any(e.item_name == "Item COD Unik" for e in items_cod)
    assert not any(e.item_name == "Item Tunai Unik" for e in items_cod)
    assert not any(e.item_name == "Item Transfer Unik" for e in items_cod)


@pytest.mark.asyncio
async def test_api_list_expenses_with_pay_method_param(client, auth_cookies, db):
    user = User(telegram_id=77773, name="API User", is_auth=True)
    db.add(user)
    await db.flush()

    exp_qris = Expense(
        expense_date=date(2026, 10, 28),
        supplier="Toko Plastik",
        item_name="Plastik Wrap API Unik",
        qty=Decimal("1"),
        unit="Roll",
        category="Kemasan",
        unit_price=Decimal("45000"),
        total_price=Decimal("45000"),
        pay_method="QRIS",
        pay_status="Lunas",
        user_id=user.id,
    )
    exp_cod = Expense(
        expense_date=date(2026, 10, 28),
        supplier="Toko Kemasan",
        item_name="Paper Bag API Unik",
        qty=Decimal("50"),
        unit="Pcs",
        category="Kemasan",
        unit_price=Decimal("2000"),
        total_price=Decimal("100000"),
        pay_method="COD",
        pay_status="Belum Lunas",
        user_id=user.id,
    )
    db.add_all([exp_qris, exp_cod])
    await db.flush()

    client.cookies.update(auth_cookies)

    # Filter QRIS
    res = await client.get("/api/v1/expenses?pay_method=QRIS")
    assert res.status_code == 200
    data = res.json()
    items = data["data"]
    assert any(i["item_name"] == "Plastik Wrap API Unik" for i in items)
    assert not any(i["item_name"] == "Paper Bag API Unik" for i in items)

    # Filter COD
    res = await client.get("/api/v1/expenses?pay_method=COD")
    assert res.status_code == 200
    data = res.json()
    items = data["data"]
    assert any(i["item_name"] == "Paper Bag API Unik" for i in items)
    assert not any(i["item_name"] == "Plastik Wrap API Unik" for i in items)
