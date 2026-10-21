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
    async def test_unauthenticated_dashboard_redirects_to_login(self, client):
        response = await client.get("/dashboard", follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/dashboard/login"

    async def test_login_page_renders_cleanly(self, client):
        response = await client.get("/dashboard/login")
        assert response.status_code == 200
        assert "Verifikasi PIN" in response.text
        assert "Minta Kode PIN via Telegram" in response.text

    async def test_authenticated_user_accessing_login_redirects_to_dashboard(self, client):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        response = await client.get("/dashboard/login", follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/dashboard"

    async def test_request_pin_endpoint(self, client):
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}

            response = await client.post("/dashboard/request-pin", follow_redirects=False)
            assert response.status_code == 303
            assert "/dashboard/login?sent=1" in response.headers["location"]

    async def test_verify_pin_endpoint_sets_cookie_on_success(self, client, db):
        with patch.object(settings, "dashboard_pin_chat_id", "12345678"), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}

            # Request pin
            await client.post("/dashboard/request-pin")
            sent_text = mock_send.call_args.kwargs["text"]
            import re
            pin = re.search(r"`(\d{6})`", sent_text).group(1)

            # Submit valid PIN
            res = await client.post("/dashboard/verify-pin", data={"pin": pin}, follow_redirects=False)
            assert res.status_code == 303
            assert res.headers["location"] == "/dashboard"
            assert SESSION_COOKIE_NAME in res.cookies

            # Now access dashboard with this cookie
            dash_res = await client.get("/dashboard")
            assert dash_res.status_code == 200
            assert "Catatan Pengeluaran" in dash_res.text

    async def test_logout_clears_cookie(self, client):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        res = await client.get("/dashboard/logout", follow_redirects=False)
        assert res.status_code == 303
        assert "/dashboard/login?logout=1" in res.headers["location"]

        # Cookie should be expired / removed
        client.cookies.delete(SESSION_COOKIE_NAME)
        dash_res = await client.get("/dashboard", follow_redirects=False)
        assert dash_res.status_code == 303
        assert dash_res.headers["location"] == "/dashboard/login"
