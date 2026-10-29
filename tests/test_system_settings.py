"""
tests/test_system_settings.py — Test persistensi konfigurasi sistem di database.
Memastikan Topic IDs (Multi-Topic, Tukar Cash, Ongkir) tidak hilang saat deploy / container recreate.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.config import settings
from app.models.system_setting import SystemSetting
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.system_setting_service import (
    get_all_system_settings,
    save_bulk_system_settings,
    apply_settings_to_runtime,
    load_and_apply_system_settings,
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
async def test_save_and_get_system_settings(db):
    """Test simpan dan ambil konfigurasi sistem langsung dari database."""
    # 1. Simpan konfigurasi
    test_data = {
        "allowed_thread_ids": "7, 12, 15",
        "tukar_cash_thread_ids": "12",
        "ongkir_thread_ids": "15",
        "bot_password": "secret_bot_pass",
    }
    await save_bulk_system_settings(db, test_data)

    # 2. Ambil semua dari DB
    all_settings = await get_all_system_settings(db)
    assert all_settings.get("allowed_thread_ids") == "7, 12, 15"
    assert all_settings.get("tukar_cash_thread_ids") == "12"
    assert all_settings.get("ongkir_thread_ids") == "15"
    assert all_settings.get("bot_password") == "secret_bot_pass"


@pytest.mark.asyncio
async def test_apply_settings_to_runtime(db):
    """Test penerapan konfigurasi dari database ke runtime settings memori."""
    test_data = {
        "allowed_thread_id": "7",
        "allowed_thread_ids": "7, 20, 30",
        "tukar_cash_thread_ids": "20",
        "ongkir_thread_ids": "30",
    }
    await save_bulk_system_settings(db, test_data)

    # Reset runtime settings sementara
    settings.allowed_thread_ids = ""
    settings.tukar_cash_thread_ids = ""
    settings.ongkir_thread_ids = ""

    # Load dan apply dari DB
    loaded = await load_and_apply_system_settings(db)
    assert "allowed_thread_ids" in loaded
    assert settings.allowed_thread_ids == "7, 20, 30"
    assert settings.tukar_cash_thread_ids == "20"
    assert settings.ongkir_thread_ids == "30"

    # Verifikasi fungsionalitas topik Telegram
    allowed_ids = settings.get_allowed_thread_ids()
    assert 7 in allowed_ids
    assert 20 in allowed_ids
    assert 30 in allowed_ids
    assert settings.is_thread_allowed(20) is True
    assert settings.is_thread_allowed(30) is True
    assert settings.is_thread_allowed(999) is False

    assert settings.get_thread_topic_type(20) == "tukar_cash"
    assert settings.get_thread_topic_type(30) == "ongkir"
    assert settings.get_thread_topic_type(7) is None


@pytest.mark.asyncio
async def test_api_config_put_and_persist_across_restart(client, auth_cookies, db):
    """
    Test skenario deploy:
    1. User mengisi konfigurasi di Dashboard Web (PUT /config).
    2. Konfigurasi tersimpan di PostgreSQL.
    3. Simulasi restart container: memori settings di-reset.
    4. Startup me-load dari database: konfigurasi tetap utuh (tidak hilang).
    """
    client.cookies.update(auth_cookies)

    # 1. Simpan via REST API (seperti klik Simpan di Dashboard Web)
    payload = {
        "allowed_thread_id": 7,
        "allowed_thread_ids": "7, 12, 15",
        "tukar_cash_thread_ids": "12",
        "ongkir_thread_ids": "15",
    }
    put_res = await client.put("/api/v1/config", json=payload)
    assert put_res.status_code == 200
    assert put_res.json()["ok"] is True

    # 2. Pastikan tersimpan di DB
    db_obj_allowed = await db.get(SystemSetting, "allowed_thread_ids")
    assert db_obj_allowed is not None
    assert db_obj_allowed.value == "7, 12, 15"

    db_obj_tukar = await db.get(SystemSetting, "tukar_cash_thread_ids")
    assert db_obj_tukar is not None
    assert db_obj_tukar.value == "12"

    db_obj_ongkir = await db.get(SystemSetting, "ongkir_thread_ids")
    assert db_obj_ongkir is not None
    assert db_obj_ongkir.value == "15"

    # 3. Verifikasi GET /config mengembalikan nilai yang baru
    get_res = await client.get("/api/v1/config")
    assert get_res.status_code == 200
    res_data = get_res.json()
    assert res_data["allowed_thread_ids"] == "7, 12, 15"
    assert res_data["tukar_cash_thread_ids"] == "12"
    assert res_data["ongkir_thread_ids"] == "15"

    # 4. SIMULASI DEPLOY / REBOOT:
    # Saat deploy baru, container dibuat ulang dan memori settings kembali ke nilai default env
    settings.allowed_thread_ids = ""
    settings.tukar_cash_thread_ids = ""
    settings.ongkir_thread_ids = ""

    # Saat aplikasi start, lifespan menjalankan load_and_apply_system_settings
    await load_and_apply_system_settings(db)

    # 5. Nilai HARUS kembali utuh dari database!
    assert settings.allowed_thread_ids == "7, 12, 15"
    assert settings.tukar_cash_thread_ids == "12"
    assert settings.ongkir_thread_ids == "15"
