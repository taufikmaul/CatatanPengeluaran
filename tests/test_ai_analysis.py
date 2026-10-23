"""
tests/test_ai_analysis.py - Pengujian Fitur Integrasi Analisis AI
Menguji intent classification, service analisis, endpoint REST, dan fallback.
"""
from datetime import datetime
from unittest.mock import patch, AsyncMock
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.agent.intent import Intent, classify_intent
from app.services.ai_analysis_service import (
    generate_ai_analysis,
    clear_analysis_cache,
)
from app.models.expense import Expense


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


class TestAiAnalysisIntent:
    @pytest.mark.parametrize(
        "command",
        [
            "/analisis",
            "/analisa",
            "/ai_analisis",
            "/insight",
            "/evaluasi",
        ],
    )
    def test_recognizes_ai_analysis_commands(self, command):
        intent, _ = classify_intent(command)
        assert intent == Intent.CMD_ANALISIS

    def test_recognizes_natural_language_intent(self):
        intent, _ = classify_intent("tolong berikan analisis pengeluaran bulan ini")
        assert intent == Intent.CMD_ANALISIS

        intent2, _ = classify_intent("analisa biaya toko")
        assert intent2 == Intent.CMD_ANALISIS


class TestAiAnalysisService:
    @pytest.mark.asyncio
    async def test_generate_ai_analysis_fallback_when_empty_db(self, db: AsyncSession):
        clear_analysis_cache()
        now = datetime.now()
        res = await generate_ai_analysis(db, now.year, now.month, force_refresh=True)

        assert res["ok"] is True
        assert res["month"] == now.month
        assert res["year"] == now.year
        assert res["health_status"] in ("SEHAT", "PERLU_PERHATIAN", "KRITIS")
        assert 1 <= res["health_score"] <= 100
        assert len(res["summary"]) > 0
        assert isinstance(res["actionable_recommendations"], list)
        assert len(res["actionable_recommendations"]) > 0

    @pytest.mark.asyncio
    async def test_generate_ai_analysis_with_expenses(self, db: AsyncSession):
        clear_analysis_cache()
        now = datetime.now()
        today_date = now.date()

        # Tambahkan transaksi uji
        e1 = Expense(
            expense_date=today_date,
            supplier="Toko Bahan Kue Makmur",
            item_name="Tepung Terigu Cakra 25kg",
            qty=2.0,
            unit="Sak",
            category="Bahan Kue",
            unit_price=280000.0,
            total_price=560000.0,
            pay_method="Transfer",
            pay_status="Lunas",
        )
        e2 = Expense(
            expense_date=today_date,
            supplier="Plastik Berkah",
            item_name="Kotak Kue Tart 20x20",
            qty=50.0,
            unit="Pcs",
            category="Kemasan",
            unit_price=5000.0,
            total_price=250000.0,
            pay_method="Tunai",
            pay_status="Belum Lunas",
            due_date="2026-10-30",
        )
        db.add_all([e1, e2])
        await db.commit()

        res = await generate_ai_analysis(db, now.year, now.month, force_refresh=True)
        assert res["ok"] is True
        assert res["cached"] is False

        # Uji pemanggilan kedua menggunakan cache
        cached_res = await generate_ai_analysis(db, now.year, now.month, force_refresh=False)
        assert cached_res["cached"] is True


class TestAiAnalysisEndpoints:
    @pytest.mark.asyncio
    async def test_endpoint_requires_auth(self, client):
        res = await client.get("/api/v1/reports/ai-analysis")
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_endpoint_returns_analysis_for_authenticated_user(self, client, auth_cookies):
        client.cookies.update(auth_cookies)
        res = await client.get("/api/v1/reports/ai-analysis")
        assert res.status_code == 200

        data = res.json()
        assert data["ok"] is True
        assert "health_status" in data
        assert "health_score" in data
        assert "summary" in data
        assert "actionable_recommendations" in data
        assert "markdown_report" in data
