"""
tests/test_accounting_report.py — Tests untuk endpoint & layanan laporan akuntansi
"""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.connection import get_db
from app.services.accounting_service import get_accounting_report


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
async def test_accounting_service_direct(db):
    """Pastikan service get_accounting_report mengembalikan struktur lengkap."""
    data = await get_accounting_report(db, 2026, 10)
    assert data["ok"] is True
    assert data["month"] == 10
    assert data["year"] == 2026
    assert data["month_name"] == "Oktober"

    # Laba Rugi
    assert "laba_rugi" in data
    assert "hpp_items" in data["laba_rugi"]
    assert "opex_items" in data["laba_rugi"]
    assert "total_beban" in data["laba_rugi"]

    # Neraca
    assert "neraca" in data
    assert "aset_lancar" in data["neraca"]
    assert "aset_tetap" in data["neraca"]
    assert "kewajiban_lancar" in data["neraca"]

    # Arus Kas
    assert "arus_kas" in data
    assert "aktivitas_operasi" in data["arus_kas"]
    assert "aktivitas_investasi" in data["arus_kas"]
    assert "aktivitas_kliring" in data["arus_kas"]

    # Analisis
    assert "analisis" in data
    assert "cost_structure" in data["analisis"]
    assert "top_variances_mom" in data["analisis"]
    assert "health_evaluation" in data["analisis"]


@pytest.mark.anyio
async def test_accounting_endpoint(client, auth_cookies):
    """Pastikan GET /api/v1/reports/accounting berfungsi dengan otentikasi."""
    client.cookies.update(auth_cookies)
    res = await client.get("/api/v1/reports/accounting?month=10&year=2026")
    assert res.status_code == 200
    json_data = res.json()
    assert json_data["ok"] is True
    assert json_data["month"] == 10
    assert json_data["year"] == 2026
    assert len(json_data["laba_rugi"]["hpp_items"]) > 0
    assert len(json_data["laba_rugi"]["opex_items"]) > 0
