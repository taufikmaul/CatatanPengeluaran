"""
tests/test_ongkir_talangan_default.py — Tests verifying data ongkir is not in Daftar Talangan by default
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
from app.services.ai_service import _execute_fetch
from app.services.expense_service import (
    save_expenses,
    get_all_expenses_paginated,
    get_reimbursement_summary,
    get_outstanding_reimbursements,
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
async def test_ai_ongkir_defaults_to_not_reimbursement_even_with_gopay():
    # Raw LLM response with Gopay payment method for GoSend
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "Ongkir GoSend - cake Bu Maya",
                            "qty": 1,
                            "satuan": "Trip",
                            "harga_satuan": 35000,
                            "total_harga": 35000,
                            "toko_supplier": "GoSend",
                            "metode_bayar": "gopay kasir",
                            "status_pembayaran": "Lunas",
                            "kategori": "Ongkir",
                            "keterangan": "kirim cake ke Tebet",
                            "is_reimbursement": false
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
        res = await _execute_fetch([{"role": "user", "content": "ongkir gosend 35rb bayar gopay"}])

        assert "items" in res
        item = res["items"][0]
        # Should NOT be reimbursement
        assert item["is_reimbursement"] is False
        assert item["kategori"] == "Ongkir"


@pytest.mark.asyncio
async def test_ai_ongkir_marked_reimbursement_only_with_explicit_keyword():
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "Ongkir GrabExpress",
                            "qty": 1,
                            "satuan": "Trip",
                            "harga_satuan": 45000,
                            "total_harga": 45000,
                            "toko_supplier": "GrabExpress",
                            "metode_bayar": "OVO",
                            "status_pembayaran": "Lunas",
                            "kategori": "Ongkir",
                            "keterangan": "talangan uang pribadi karyawan Budi",
                            "is_reimbursement": true
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
        res = await _execute_fetch([{"role": "user", "content": "ongkir ditalangi budi"}])

        assert "items" in res
        item = res["items"][0]
        # Should be reimbursement because notes contains "talangan"
        assert item["is_reimbursement"] is True


@pytest.mark.asyncio
async def test_save_expenses_ongkir_defaults_to_not_reimbursement(db):
    user = User(telegram_id=88881, name="Staff Ongkir", is_auth=True)
    db.add(user)
    await db.flush()

    items = [
        {
            "barang": "Ongkir GoSend",
            "qty": 1,
            "satuan": "Trip",
            "harga_satuan": 25000,
            "total_harga": 25000,
            "kategori": "Ongkir",
            "toko_supplier": "GoSend",
            "metode_bayar": "Tunai",
            "status_pembayaran": "Lunas",
            "keterangan": "Kirim bolu",
        }
    ]

    saved = await save_expenses(db=db, items=items, user_id=user.id)
    assert len(saved) == 1
    assert saved[0].is_reimbursement is False


@pytest.mark.asyncio
async def test_talangan_queries_exclude_ongkir_by_default(db):
    user = User(telegram_id=88882, name="User Talangan", is_auth=True)
    db.add(user)
    await db.flush()

    # Regular shopping reimbursement (Belanja Bahan)
    exp_belanja = Expense(
        expense_date=date(2026, 10, 29),
        supplier="TBK Prima",
        item_name="Keju Cheddar",
        qty=Decimal("2"),
        unit="Kg",
        category="Bahan Kue",
        unit_price=Decimal("80000"),
        total_price=Decimal("160000"),
        pay_method="Transfer",
        pay_status="Lunas",
        is_reimbursement=True,
        user_id=user.id,
    )
    # Ongkir that happened to have is_reimbursement=True in DB
    exp_ongkir = Expense(
        expense_date=date(2026, 10, 29),
        supplier="GoSend",
        item_name="Ongkir GoSend - cake bu lita",
        qty=Decimal("1"),
        unit="Trip",
        category="Ongkir",
        unit_price=Decimal("40000"),
        total_price=Decimal("40000"),
        pay_method="Tunai",
        pay_status="Lunas",
        is_reimbursement=True,
        user_id=user.id,
    )
    db.add_all([exp_belanja, exp_ongkir])
    await db.flush()

    # 1. get_all_expenses_paginated with special_type="talangan" without include_ongkir
    items_def, total_def = await get_all_expenses_paginated(
        db, page=1, per_page=10, special_type="talangan", is_reimbursement=True
    )
    assert any(e.item_name == "Keju Cheddar" for e in items_def)
    assert not any("Ongkir" in e.item_name for e in items_def)

    # 2. get_all_expenses_paginated with include_ongkir=True
    items_inc, total_inc = await get_all_expenses_paginated(
        db, page=1, per_page=10, special_type="talangan", is_reimbursement=True, include_ongkir=True
    )
    assert any(e.item_name == "Keju Cheddar" for e in items_inc)
    assert any("Ongkir" in e.item_name for e in items_inc)

    # 3. get_reimbursement_summary without include_ongkir
    summary_def = await get_reimbursement_summary(db, include_ongkir=False)
    assert summary_def["pending_total"] == 160000.0  # Only Keju Cheddar

    # 4. get_reimbursement_summary with include_ongkir=True
    summary_inc = await get_reimbursement_summary(db, include_ongkir=True)
    assert summary_inc["pending_total"] == 200000.0  # 160k + 40k

    # 5. get_outstanding_reimbursements without include_ongkir
    out_def = await get_outstanding_reimbursements(db, include_ongkir=False)
    assert len(out_def) == 1
    assert out_def[0].item_name == "Keju Cheddar"


@pytest.mark.asyncio
async def test_api_talangan_and_summary_exclude_ongkir_by_default(client, auth_cookies, db):
    user = User(telegram_id=88883, name="API Talangan User", is_auth=True)
    db.add(user)
    await db.flush()

    exp1 = Expense(
        expense_date=date(2026, 10, 29),
        supplier="Toko Plastik",
        item_name="Dus Box Brownies",
        qty=Decimal("100"),
        unit="Pcs",
        category="Kemasan",
        unit_price=Decimal("1500"),
        total_price=Decimal("150000"),
        pay_method="Tunai",
        pay_status="Lunas",
        is_reimbursement=True,
        user_id=user.id,
    )
    exp2 = Expense(
        expense_date=date(2026, 10, 29),
        supplier="Lalamove",
        item_name="Ongkir Lalamove Cake",
        qty=Decimal("1"),
        unit="Trip",
        category="Ongkir",
        unit_price=Decimal("50000"),
        total_price=Decimal("50000"),
        pay_method="Tunai",
        pay_status="Lunas",
        is_reimbursement=True,
        user_id=user.id,
    )
    db.add_all([exp1, exp2])
    await db.flush()

    client.cookies.update(auth_cookies)

    # Default API call: /expenses?is_reimbursement=true&special_type=talangan
    res = await client.get("/api/v1/expenses?is_reimbursement=true&special_type=talangan")
    assert res.status_code == 200
    items = res.json()["data"]
    assert any(i["item_name"] == "Dus Box Brownies" for i in items)
    assert not any(i["item_name"] == "Ongkir Lalamove Cake" for i in items)

    # Summary default: /expenses/reimbursements/summary
    res_sum = await client.get("/api/v1/expenses/reimbursements/summary")
    assert res_sum.status_code == 200
    assert res_sum.json()["pending_total"] == 150000.0

    # With include_ongkir=true
    res_inc = await client.get("/api/v1/expenses?is_reimbursement=true&special_type=talangan&include_ongkir=true")
    assert res_inc.status_code == 200
    items_inc = res_inc.json()["data"]
    assert any(i["item_name"] == "Ongkir Lalamove Cake" for i in items_inc)
