"""Smoke test untuk app/main.py, dashboard, dan konsistensi skema."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import Base, get_db
from app.main import app
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


class TestUtilityEndpoints:
    async def test_root_reports_running(self, client):
        response = await client.get("/")
        body = response.json()

        assert response.status_code == 200
        assert body["status"] == "running"
        assert body["agent"] == "Hermes"
        assert body["dashboard"] == "/dashboard"

    async def test_health_check(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestDashboard:
    async def test_redirects_unauthenticated_to_login(self, client):
        response = await client.get("/dashboard", follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/dashboard/login"

    async def test_renders_with_empty_database(self, client, db):
        # Dashboard memanggil get_monthly_report + pagination lewat dependency
        # yang sudah di-override ke DB test.
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        response = await client.get("/dashboard")

        assert response.status_code == 200
        assert "Catatan Pengeluaran" in response.text
        assert "Historycake Dashboard" in response.text

    async def test_accepts_filter_query_params(self, client, db):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        response = await client.get("/dashboard?month=9&year=2025")
        assert response.status_code == 200
        assert "September" in response.text

    async def test_rejects_invalid_page(self, client, db):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        response = await client.get("/dashboard?page=0")
        assert response.status_code == 422


class TestSchemaConsistency:
    async def test_all_expected_tables_exist(self, engine):
        async with engine.connect() as conn:
            tables = await conn.run_sync(
                lambda sync_conn: set(inspect(sync_conn).get_table_names())
            )

        assert {"users", "expenses", "sessions", "dashboard_pins", "dashboard_access_logs"} <= tables

    async def test_users_table_has_unique_telegram_id(self, engine):
        async with engine.connect() as conn:
            indexes = await conn.run_sync(
                lambda c: inspect(c).get_indexes("users")
            )

        telegram_indexes = [i for i in indexes if i["column_names"] == ["telegram_id"]]
        assert telegram_indexes, "index telegram_id harus ada"
        # SQLite mengembalikan 1/0 sementara PostgreSQL mengembalikan bool.
        assert bool(telegram_indexes[0]["unique"]) is True

    async def test_expenses_has_foreign_key_to_users(self, engine):
        async with engine.connect() as conn:
            fks = await conn.run_sync(
                lambda c: inspect(c).get_foreign_keys("expenses")
            )

        assert any(fk["referred_table"] == "users" for fk in fks)

    async def test_models_metadata_matches_alembic_target(self):
        """Alembic memakai Base.metadata yang sama; pastikan tabel terdaftar."""
        assert set(Base.metadata.tables) == {"users", "expenses", "sessions", "dashboard_pins", "dashboard_access_logs"}
