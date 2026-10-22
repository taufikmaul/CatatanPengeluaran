"""
tests/test_api_v1.py — Test REST API v1 Endpoints
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME


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
async def test_api_auth_status_unauthenticated(client):
    res = await client.get("/api/v1/auth/status")
    assert res.status_code == 200
    data = res.json()
    assert data["authenticated"] is False


@pytest.mark.asyncio
async def test_api_auth_status_authenticated(client, auth_cookies):
    client.cookies.update(auth_cookies)
    res = await client.get("/api/v1/auth/status")
    assert res.status_code == 200
    data = res.json()
    assert data["authenticated"] is True
    assert data["user"] == "Admin"


@pytest.mark.asyncio
async def test_api_expenses_requires_auth(client):
    res = await client.get("/api/v1/expenses")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_api_expenses_crud(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Create expense
    payload = {
        "expense_date": "2026-10-22",
        "supplier": "Toko Bahan Kue Sejahtera",
        "item_name": "Butter Anchor 1kg",
        "qty": 5,
        "category": "Bahan Baku",
        "unit_price": 145000,
        "tax": 0,
        "discount": 0,
        "total_price": 725000,
        "pay_method": "Transfer",
        "pay_status": "Lunas",
        "notes": "Persediaan weekend",
    }
    create_res = await client.post("/api/v1/expenses", json=payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    assert created_data["item_name"] == "Butter Anchor 1kg"
    expense_id = created_data["id"]

    # 2. Get list
    list_res = await client.get("/api/v1/expenses")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["ok"] is True
    assert any(e["id"] == expense_id for e in list_data["data"])

    # 3. Update expense (e.g. toggle status)
    update_res = await client.put(f"/api/v1/expenses/{expense_id}", json={"pay_status": "Belum Lunas"})
    assert update_res.status_code == 200
    assert update_res.json()["pay_status"] == "Belum Lunas"

    # 4. Monthly report check
    report_res = await client.get("/api/v1/reports/monthly?month=10&year=2026")
    assert report_res.status_code == 200
    report_data = report_res.json()
    assert report_data["ok"] is True
    assert "daily_chart" in report_data
    assert "top_frequent_items" in report_data
    assert "top_expensive_items" in report_data
    assert "top_price_spikes" in report_data
    assert "top_suppliers" in report_data
    assert "summary_metrics" in report_data
    assert len(report_data["top_frequent_items"]) >= 1
    assert report_data["top_frequent_items"][0]["item_name"] == "Butter Anchor 1kg"

    # 4b. Dedicated leaderboard endpoint check
    lb_res = await client.get("/api/v1/reports/leaderboard?month=10&year=2026")
    assert lb_res.status_code == 200
    lb_data = lb_res.json()
    assert lb_data["ok"] is True
    assert "top_frequent_items" in lb_data
    assert "top_expensive_items" in lb_data

    # 5. Delete expense
    del_res = await client.delete(f"/api/v1/expenses/{expense_id}")
    assert del_res.status_code == 200
    assert del_res.json()["ok"] is True


@pytest.mark.asyncio
async def test_react_app_route(client):
    res = await client.get("/app")
    assert res.status_code == 200
    assert "Catatan Pengeluaran" in res.text


@pytest.mark.asyncio
async def test_api_config_endpoints(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Get config
    get_res = await client.get("/api/v1/config")
    assert get_res.status_code == 200
    cfg = get_res.json()
    assert cfg["ok"] is True
    assert "telegram_token_masked" in cfg

    # 2. Update config
    payload = {
        "sumopod_model": "seed-2-0-mini",
        "spreadsheet_id": "test_sheet_12345",
        "dashboard_pin_chat_id": "999888777",
    }
    put_res = await client.put("/api/v1/config", json=payload)
    assert put_res.status_code == 200
    assert put_res.json()["ok"] is True

    # 3. Verify get config reflects update
    get_res2 = await client.get("/api/v1/config")
    assert get_res2.json()["spreadsheet_id"] == "test_sheet_12345"
    assert get_res2.json()["dashboard_pin_chat_id"] == "999888777"
