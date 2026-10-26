"""
tests/test_dashboard_auth.py — Test suite untuk verifikasi PIN Telegram & proteksi anti-brute force dashboard
"""
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.database.connection import get_db
from app.main import app
from app.models.dashboard_auth import DashboardPin, DashboardAccessLog
from app.models.user import User
from app.services.dashboard_auth_service import (
    create_session_token,
    verify_session_token,
    generate_and_send_pin,
    verify_pin,
    is_ip_locked_out,
    can_request_pin,
    resolve_telegram_recipients,
    SESSION_COOKIE_NAME,
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


class TestSessionToken:
    def test_create_and_verify_valid_token(self):
        token = create_session_token()
        assert verify_session_token(token) is True

    def test_reject_expired_token(self):
        token = create_session_token(expire_hours=-1)
        assert verify_session_token(token) is False

    def test_reject_tampered_payload(self):
        token = create_session_token()
        b64_payload, sig = token.split(".")
        tampered_token = f"eyJzdWIiOiAiaGFja2VyIn0.{sig}"
        assert verify_session_token(tampered_token) is False

    def test_reject_tampered_signature(self):
        token = create_session_token()
        b64_payload, sig = token.split(".")
        fake_sig = "a" * len(sig)
        assert verify_session_token(f"{b64_payload}.{fake_sig}") is False

    def test_reject_invalid_format(self):
        assert verify_session_token("") is False
        assert verify_session_token("invalid-string-without-dot") is False
        assert verify_session_token("a.b.c") is False


class TestRecipientResolution:
    async def test_fallback_to_auth_user_when_no_chat_id_configured(self, db: AsyncSession):
        with patch.object(settings, "dashboard_pin_chat_id", ""), \
             patch.object(settings, "report_chat_id", ""):
            # Belum ada user
            recipients = await resolve_telegram_recipients(db)
            assert recipients == []

            # Tambah user ter-autentikasi
            user = User(telegram_id=987654321, name="Admin", is_auth=True)
            db.add(user)
            await db.flush()

            recipients = await resolve_telegram_recipients(db)
            assert recipients == [(987654321, None)]

    async def test_uses_dashboard_pin_chat_id_first(self, db: AsyncSession):
        with patch.object(settings, "dashboard_pin_chat_id", "-100123456789"), \
             patch.object(settings, "dashboard_pin_thread_id", 123), \
             patch.object(settings, "report_chat_id", "555"):
            recipients = await resolve_telegram_recipients(db)
            assert recipients == [(-100123456789, 123)]


class TestPinGenerationAndTelegram:
    async def test_successful_pin_generation_and_telegram_dispatch(self, db: AsyncSession):
        ip = "192.168.1.50"
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}

            success, msg = await generate_and_send_pin(db, ip)
            assert success is True
            assert "berhasil dikirim" in msg.lower()
            mock_send.assert_awaited_once()

            # Pastikan PIN tersimpan di DB
            pins = (await db.execute(select(DashboardPin).where(DashboardPin.ip_address == ip))).scalars().all()
            assert len(pins) == 1
            assert pins[0].is_used is False
            assert pins[0].attempts == 0

            # Pastikan log dicatat
            logs = (await db.execute(select(DashboardAccessLog).where(DashboardAccessLog.ip_address == ip))).scalars().all()
            assert any(l.action == "request_pin" for l in logs)

    async def test_cooldown_prevents_rapid_pin_requests(self, db: AsyncSession):
        ip = "192.168.1.51"
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}

            # Request ke-1: berhasil
            success1, _ = await generate_and_send_pin(db, ip)
            assert success1 is True

            # Request ke-2 langsung: ditolak cooldown
            success2, reason = await generate_and_send_pin(db, ip)
            assert success2 is False
            assert "tunggu" in reason.lower()

    async def test_rate_limit_exceeded_blocks_requests(self, db: AsyncSession):
        ip = "192.168.1.52"
        now = datetime.utcnow()
        # Masukkan 5 request log dalam 10 menit terakhir
        for i in range(5):
            db.add(DashboardAccessLog(
                ip_address=ip,
                action="request_pin",
                created_at=now - timedelta(minutes=10 - i),
            ))
        await db.flush()

        can_req, reason = await can_request_pin(db, ip)
        assert can_req is False
        assert "terlalu banyak" in reason.lower()


class TestPinVerificationAndAntiBruteForce:
    async def test_successful_verification(self, db: AsyncSession):
        ip = "192.168.1.60"
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}

            await generate_and_send_pin(db, ip)
            # Ambil PIN yang dikirim ke telegram_client.send_message
            sent_text = mock_send.call_args.kwargs["text"]
            # Extract PIN dari sent_text: 👉 *`XXXXXX`* 👈
            import re
            match = re.search(r"`(\d{6})`", sent_text)
            assert match is not None
            pin = match.group(1)

            # Verifikasi
            ok, msg = await verify_pin(db, ip, pin)
            assert ok is True
            assert msg == "Verifikasi berhasil."

            # Pastikan PIN di DB sudah ditandai used
            pin_record = (await db.execute(select(DashboardPin).where(DashboardPin.ip_address == ip))).scalars().first()
            assert pin_record.is_used is True

            # Re-verifikasi dengan PIN yang sama harus gagal karena sudah hangus
            ok2, msg2 = await verify_pin(db, ip, pin)
            assert ok2 is False
            assert "tidak valid" in msg2.lower()

    async def test_wrong_pin_decrements_attempts(self, db: AsyncSession):
        ip = "192.168.1.61"
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}
            await generate_and_send_pin(db, ip)

            # Percobaan salah 1
            ok1, msg1 = await verify_pin(db, ip, "000000")
            assert ok1 is False
            assert "sisa kesempatan" in msg1.lower()

            # Percobaan salah 2
            ok2, msg2 = await verify_pin(db, ip, "111111")
            assert ok2 is False
            assert "sisa kesempatan" in msg2.lower()

            # Percobaan salah 3 -> batas percobaan habis, pin hangus
            ok3, msg3 = await verify_pin(db, ip, "222222")
            assert ok3 is False
            assert "batas percobaan habis" in msg3.lower()

            # Percobaan ke 4 -> pin sudah hangus
            ok4, msg4 = await verify_pin(db, ip, "333333")
            assert ok4 is False
            assert "tidak valid" in msg4.lower()

    async def test_expired_pin_rejected(self, db: AsyncSession):
        ip = "192.168.1.62"
        now = datetime.utcnow()
        # Buat pin yang sudah kedaluwarsa 10 menit lalu
        db.add(DashboardPin(
            pin_hash="abc",
            salt="def",
            ip_address=ip,
            attempts=0,
            max_attempts=3,
            is_used=False,
            created_at=now - timedelta(minutes=15),
            expires_at=now - timedelta(minutes=10),
        ))
        await db.flush()

        ok, msg = await verify_pin(db, ip, "123456")
        assert ok is False
        assert "kedaluwarsa" in msg.lower() or "tidak valid" in msg.lower()

    async def test_ip_lockout_after_consecutive_failed_verifications(self, db: AsyncSession):
        ip = "192.168.1.63"
        now = datetime.utcnow()

        # Simulasi 5 kegagalan berturut-turut dari IP ini
        for i in range(5):
            db.add(DashboardAccessLog(
                ip_address=ip,
                action="verify_failed",
                created_at=now - timedelta(minutes=5 - i),
            ))
        await db.flush()

        locked, remaining = await is_ip_locked_out(db, ip)
        assert locked is True
        assert remaining > 0

        # Percobaan request PIN harus ditolak karena lockout
        can_req, reason = await can_request_pin(db, ip)
        assert can_req is False
        assert "diblokir" in reason.lower()

        # Percobaan verifikasi PIN juga harus ditolak langsung
        ok, v_reason = await verify_pin(db, ip, "123456")
        assert ok is False
        assert "diblokir" in v_reason.lower()


class TestDashboardEndpoints:
    async def test_legacy_dashboard_redirects_to_app(self, client):
        response = await client.get("/dashboard", follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/app"

    async def test_api_auth_request_and_verify_pin_flow(self, client, db):
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}

            # 1. Request PIN via API
            response = await client.post("/api/v1/auth/request-pin")
            assert response.status_code == 200
            assert response.json()["ok"] is True

            # 2. Extract PIN sent to Telegram
            sent_text = mock_send.call_args.kwargs["text"]
            import re
            pin = re.search(r"`(\d{6})`", sent_text).group(1)

            # 3. Verify valid PIN via API
            verify_res = await client.post("/api/v1/auth/verify-pin", json={"pin": pin})
            assert verify_res.status_code == 200
            assert verify_res.json()["ok"] is True
            assert SESSION_COOKIE_NAME in verify_res.cookies

            # 4. Check status with cookie
            status_res = await client.get("/api/v1/auth/status")
            assert status_res.status_code == 200
            assert status_res.json()["authenticated"] is True

            # 5. Logout clears auth
            logout_res = await client.post("/api/v1/auth/logout")
            assert logout_res.status_code == 200
            assert logout_res.json()["ok"] is True

            client.cookies.delete(SESSION_COOKIE_NAME)
            status_after = await client.get("/api/v1/auth/status")
            assert status_after.status_code == 200
            assert status_after.json()["authenticated"] is False


class TestAdminInputAccessAndRestrictions:
    """Test suite khusus untuk hak akses dan pembatasan peran Admin Input."""

    async def test_admin_input_login_wrong_password_rejected(self, client):
        response = await client.post(
            "/api/v1/auth/login-admin-input",
            json={"password": "wrong_password_123"},
        )
        assert response.status_code == 400
        assert response.json()["ok"] is False

    async def test_admin_input_login_success_and_permissions(self, client):
        with patch.object(settings, "admin_input_password", "input123"):
            response = await client.post(
                "/api/v1/auth/login-admin-input",
                json={"password": "input123"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["ok"] is True
            assert data["role"] == "admin_input"
            assert SESSION_COOKIE_NAME in response.cookies

            # Cek endpoint /status
            status_res = await client.get("/api/v1/auth/status")
            assert status_res.status_code == 200
            s_data = status_res.json()
            assert s_data["authenticated"] is True
            assert s_data["role"] == "admin_input"
            assert s_data["permissions"]["can_edit"] is True
            assert s_data["permissions"]["can_delete"] is False
            assert s_data["permissions"]["can_view_charts"] is False
            assert s_data["permissions"]["can_manage_config"] is False

    async def test_admin_input_can_create_and_correct_expense_but_cannot_delete(self, client, db):
        with patch.object(settings, "admin_input_password", "input123"):
            # 1. Login sebagai Admin Input
            login_res = await client.post(
                "/api/v1/auth/login-admin-input",
                json={"password": "input123"},
            )
            assert login_res.status_code == 200
            token = login_res.json()["token"]

            headers = {"Authorization": f"Bearer {token}"}

            # 2. Bisa membuat transaksi pengeluaran baru
            create_res = await client.post(
                "/api/v1/expenses",
                json={
                    "expense_date": "2026-10-23",
                    "item_name": "Tepung Terigu Segitiga",
                    "qty": 5,
                    "unit_price": 12000,
                    "total_price": 60000,
                    "category": "Bahan Baku",
                    "supplier": "Toko Bahan Kue Berkah",
                },
                headers=headers,
            )
            assert create_res.status_code == 201
            expense_id = create_res.json()["id"]

            # 3. BISA melakukan koreksi transaksi (PUT /expenses/{id})
            update_res = await client.put(
                f"/api/v1/expenses/{expense_id}",
                json={
                    "qty": 6,
                    "total_price": 72000,
                    "notes": "Koreksi jumlah sak tepung oleh admin input",
                },
                headers=headers,
            )
            assert update_res.status_code == 200
            assert update_res.json()["qty"] == 6.0
            assert update_res.json()["total_price"] == 72000.0

            # 4. TIDAK BISA menghapus transaksi (DELETE /expenses/{id} dilarang / 403 Forbidden)
            delete_res = await client.delete(
                f"/api/v1/expenses/{expense_id}",
                headers=headers,
            )
            assert delete_res.status_code == 403
            assert "Akses ditolak" in delete_res.json()["detail"] or "Owner" in delete_res.json()["detail"]

            # 5. TIDAK BISA mengakses konfigurasi sistem (GET /config -> 403 Forbidden)
            config_res = await client.get("/api/v1/config", headers=headers)
            assert config_res.status_code == 403

            # 6. Verifikasi bahwa Owner (admin) BISA menghapus transaksi yang sama
            owner_token = create_session_token(role="admin")
            owner_headers = {"Authorization": f"Bearer {owner_token}"}
            owner_del_res = await client.delete(
                f"/api/v1/expenses/{expense_id}",
                headers=owner_headers,
            )
            assert owner_del_res.status_code == 200
            assert owner_del_res.json()["ok"] is True


class TestSsoAndCandidateAuth:
    @staticmethod
    def _create_sso_jwt(role: str, exp_offset: int = 3600) -> str:
        import base64
        import hashlib
        import hmac
        import json
        import time

        secret = getattr(settings, "auth_secret", "change-me-use-a-long-random-string-min-32-chars")
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": "42",
            "username": "sso_user",
            "role": role,
            "exp": int(time.time()) + exp_offset,
        }
        h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
        p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        signing_input = f"{h_b64}.{p_b64}".encode()
        sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
        sig_b64 = base64.urlsafe_b64encode(sig).decode().rstrip("=")
        return f"{h_b64}.{p_b64}.{sig_b64}"

    async def test_sso_owner_authenticated_as_admin(self, client: AsyncClient):
        token = self._create_sso_jwt(role="owner")
        res = await client.get("/api/v1/auth/status", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["authenticated"] is True
        assert data["role"] == "admin"
        assert data["permissions"]["can_delete"] is True

    async def test_sso_staff_authenticated_as_admin_input(self, client: AsyncClient):
        token = self._create_sso_jwt(role="staff")
        res = await client.get("/api/v1/auth/status", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["authenticated"] is True
        assert data["role"] == "admin_input"
        assert data["permissions"]["can_delete"] is False

    async def test_stale_bearer_header_falls_back_to_valid_cookie(self, client: AsyncClient):
        # Cookie sesi valid
        valid_cookie_token = create_session_token(role="admin")
        # Header Bearer berisi token usang / rusak
        stale_header = {"Authorization": "Bearer invalid.or.expired.jwt.token"}

        client.cookies.set(SESSION_COOKIE_NAME, valid_cookie_token)
        res = await client.get("/api/v1/auth/status", headers=stale_header)
        assert res.status_code == 200
        data = res.json()
        assert data["authenticated"] is True
        assert data["role"] == "admin"

    async def test_root_browser_redirects_to_app_with_query_params(self, client: AsyncClient):
        res = await client.get("/?token=sso_sample_token_123", headers={"Accept": "text/html"}, follow_redirects=False)
        assert res.status_code == 307
        assert res.headers["location"] == "/app?token=sso_sample_token_123"

    async def test_root_json_api_returns_app_info(self, client: AsyncClient):
        res = await client.get("/", headers={"Accept": "application/json"})
        assert res.status_code == 200
        assert res.json()["app"] == "CatatanPengeluaran v2.0"
