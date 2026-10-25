"""
tests/test_budgets.py — Unit & Integration Tests untuk Anggaran Bulanan (Monthly Budget)
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.budget_service import (
    get_effective_budget,
    upsert_monthly_budget,
    copy_budget_from_previous,
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


@pytest.mark.asyncio
async def test_monthly_budget_different_per_month(db: AsyncSession):
    """Pastikan budget bulan Oktober dan November bisa beda-beda."""
    # Setup Oktober 2026: 20 Jt (Bahan Baku 50%, Operasional 30%)
    b_oct = await upsert_monthly_budget(
        db=db,
        year=2026,
        month=10,
        total_budget=20_000_000,
        category_percentages={"Bahan Baku": 50.0, "Operasional": 30.0},
    )
    assert b_oct.id is not None
    assert float(b_oct.total_budget) == 20_000_000
    assert b_oct.category_percentages["Bahan Baku"] == 50.0
    assert b_oct.category_amounts["Bahan Baku"] == 10_000_000
    assert b_oct.category_amounts["Operasional"] == 6_000_000

    # Setup November 2026: 35 Jt (Bahan Baku 60%, Promosi 20%)
    b_nov = await upsert_monthly_budget(
        db=db,
        year=2026,
        month=11,
        total_budget=35_000_000,
        category_percentages={"Bahan Baku": 60.0, "Promosi": 20.0},
    )
    assert float(b_nov.total_budget) == 35_000_000
    assert b_nov.category_percentages["Bahan Baku"] == 60.0
    assert b_nov.category_amounts["Bahan Baku"] == 21_000_000
    assert b_nov.category_amounts["Promosi"] == 7_000_000

    # Cek Oktober tetap 20 Jt
    eff_oct = await get_effective_budget(db, 2026, 10)
    assert eff_oct["total_budget"] == 20_000_000
    assert eff_oct["category_amounts"]["Bahan Baku"] == 10_000_000
    assert eff_oct["category_percentages"]["Bahan Baku"] == 50.0

    # Cek November tetap 35 Jt
    eff_nov = await get_effective_budget(db, 2026, 11)
    assert eff_nov["total_budget"] == 35_000_000
    assert eff_nov["category_amounts"]["Bahan Baku"] == 21_000_000
    assert eff_nov["category_percentages"]["Bahan Baku"] == 60.0


@pytest.mark.asyncio
async def test_copy_budget_from_previous_month(db: AsyncSession):
    """Pastikan fitur salin anggaran dari bulan sebelumnya berfungsi."""
    await upsert_monthly_budget(
        db=db,
        year=2026,
        month=10,
        total_budget=25_000_000,
        category_percentages={"Bahan Baku": 40.0, "Operasional": 25.0},
    )

    copied = await copy_budget_from_previous(
        db=db,
        target_year=2026,
        target_month=11,
    )
    assert copied is not None
    assert float(copied.total_budget) == 25_000_000
    assert copied.category_percentages["Bahan Baku"] == 40.0
    assert copied.category_amounts["Bahan Baku"] == 10_000_000


@pytest.mark.asyncio
async def test_budget_api_endpoints(client, auth_cookies):
    """Test REST API endpoint /api/v1/budgets."""
    client.cookies.update(auth_cookies)

    # 1. POST simpan budget Oktober 2026
    payload = {
        "year": 2026,
        "month": 10,
        "total_budget": 30_000_000,
        "category_percentages": {
            "Bahan Baku": 50.0,
            "Operasional": 20.0,
            "Kemasan": 10.0,
        },
    }
    res_post = await client.post("/api/v1/budgets", json=payload)
    assert res_post.status_code == 200, res_post.text
    data_post = res_post.json()
    assert data_post["ok"] is True
    assert data_post["total_budget"] == 30_000_000
    assert data_post["category_percentages"]["Bahan Baku"] == 50.0
    assert data_post["category_amounts"]["Bahan Baku"] == 15_000_000
    assert data_post["category_amounts"]["Operasional"] == 6_000_000
    assert data_post["category_amounts"]["Kemasan"] == 3_000_000

    # 2. GET budget Oktober 2026
    res_get = await client.get("/api/v1/budgets?year=2026&month=10")
    assert res_get.status_code == 200
    data_get = res_get.json()
    assert data_get["total_budget"] == 30_000_000
    assert data_get["category_amounts"]["Bahan Baku"] == 15_000_000
    assert data_get["is_custom"] is True

    # 3. POST copy budget ke November 2026
    res_copy = await client.post(
        "/api/v1/budgets/copy",
        json={"target_year": 2026, "target_month": 11},
    )
    assert res_copy.status_code == 200
    data_copy = res_copy.json()
    assert data_copy["total_budget"] == 30_000_000
    assert data_copy["category_percentages"]["Bahan Baku"] == 50.0
    assert data_copy["month"] == 11
