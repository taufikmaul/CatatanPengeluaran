"""
tests/test_reimburse_and_batch.py — Tests for batch expense creation, reimbursement review,
weekly reminder scheduler, and reimbursement settlements.
"""
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.expense import Expense
from app.models.user import User
from app.services.dashboard_auth_service import SESSION_COOKIE_NAME, create_session_token
from app.services.expense_service import (
    get_outstanding_reimbursements,
    group_reimbursements_by_user,
    mark_reimbursed,
    get_monthly_report,
)
from app.bot.reimburse import build_user_review, build_admin_review, build_paid_notification
from app.agent.intent import classify_intent, Intent
from app.agent.hermes import HermesAgent
from app.bot.callbacks import handle_callback_query


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


# ──────────────────────────────────────────────
# 1. Tests for POST /api/v1/expenses/batch
# ──────────────────────────────────────────────

class TestBatchExpenseEndpoint:
    @pytest.mark.asyncio
    async def test_batch_create_successful(self, client, auth_cookies, db: AsyncSession):
        client.cookies.update(auth_cookies)
        payload = {
            "items": [
                {
                    "expense_date": "2026-10-23",
                    "supplier": "Toko Bahan Kue 1",
                    "item_name": "Tepung Terigu Segitiga",
                    "qty": 2,
                    "unit_price": 12000,
                    "total_price": 24000,
                    "category": "Bahan Kue",
                    "is_reimbursement": True,
                    "invoice_number": "INV-001",
                },
                {
                    "expense_date": "2026-10-23",
                    "supplier": "Toko Bahan Kue 1",
                    "item_name": "Gula Pasir 1kg",
                    "qty": 3,
                    "unit_price": 15000,
                    "total_price": 0,  # Should auto calculate to 45000
                    "category": "Bahan Kue",
                    "is_reimbursement": False,
                    "invoice_number": "INV-001",
                },
            ]
        }
        res = await client.post("/api/v1/expenses/batch", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert len(data) == 2
        assert data[0]["item_name"] == "Tepung Terigu Segitiga"
        assert data[0]["is_reimbursement"] is True
        assert data[0]["invoice_number"] == "INV-001"
        assert data[1]["item_name"] == "Gula Pasir 1kg"
        assert data[1]["total_price"] == 45000.0

    @pytest.mark.asyncio
    async def test_batch_create_empty_fails(self, client, auth_cookies):
        client.cookies.update(auth_cookies)
        res = await client.post("/api/v1/expenses/batch", json={"items": []})
        assert res.status_code == 400
        assert "kosong" in res.json()["detail"].lower()


# ──────────────────────────────────────────────
# 2. Tests for Reimbursement Services & Reports
# ──────────────────────────────────────────────

class TestReimbursementServices:
    @pytest.mark.asyncio
    async def test_reimbursement_aggregation_and_settlement(self, db: AsyncSession):
        user = User(
            telegram_id=888999,
            name="Budi Santoso",
            is_auth=True,
        )
        db.add(user)
        await db.flush()

        e1 = Expense(
            expense_date=date(2026, 10, 15),
            item_name="Mentega Wijsman",
            total_price=Decimal("150000"),
            is_reimbursement=True,
            user_id=user.id,
            reimbursed_at=None,
        )
        e2 = Expense(
            expense_date=date(2026, 10, 16),
            item_name="Keju Edam",
            total_price=Decimal("80000"),
            is_reimbursement=True,
            user_id=user.id,
            reimbursed_at=None,
        )
        e3 = Expense(
            expense_date=date(2026, 10, 17),
            item_name="Plastik Wrap",
            total_price=Decimal("25000"),
            is_reimbursement=False,  # Not reimbursement
            user_id=user.id,
        )
        db.add_all([e1, e2, e3])
        await db.commit()

        # Check outstanding claims
        outstanding = await get_outstanding_reimbursements(db, user_id=user.id)
        assert len(outstanding) == 2

        # Group by user
        groups = await group_reimbursements_by_user(db, outstanding)
        assert len(groups) == 1
        assert groups[0]["name"] == "Budi Santoso"
        assert groups[0]["total"] == 230000.0
        assert len(groups[0]["items"]) == 2

        # Check monthly report includes reimbursement count and total
        report = await get_monthly_report(db, 2026, 10)
        assert report["reimburse_pending_count"] == 2
        assert report["reimburse_pending_total"] == 230000.0

        # Mark reimbursed
        settled_count = await mark_reimbursed(db, expense_ids=[e1.id, e2.id])
        assert len(settled_count) == 2

        # Check remaining outstanding
        remaining = await get_outstanding_reimbursements(db, user_id=user.id)
        assert len(remaining) == 0


# ──────────────────────────────────────────────
# 3. Tests for Telegram Messages & Keyboards
# ──────────────────────────────────────────────

class TestTelegramReimburseBuilders:
    def test_build_user_review_with_items(self):
        e1 = Expense(
            id=10,
            expense_date=date(2026, 10, 20),
            item_name="Perisa Vanilla",
            total_price=Decimal("35000"),
            supplier="Toko Aroma",
            invoice_number="INV-99",
            is_reimbursement=True,
        )
        group = {
            "user_id": 1,
            "name": "Siti",
            "telegram_id": 123456,
            "items": [e1],
            "total": 35000.0,
        }
        text, kb = build_user_review(group)
        assert "REVIEW REIMBURSE ANDA" in text
        assert "Siti" in text
        assert "Perisa Vanilla" in text
        assert "35.000" in text
        assert kb is not None

    def test_build_user_review_empty(self):
        text, kb = build_user_review(None)
        assert "Tidak Ada Talangan Tertunda" in text

    def test_build_admin_review(self):
        groups = [
            {
                "user_id": 5,
                "name": "Joko",
                "telegram_id": 12345,
                "items": [
                    Expense(
                        id=11,
                        expense_date=date(2026, 10, 20),
                        item_name="Loyang 20cm",
                        total_price=Decimal("45000"),
                    )
                ],
                "total": 45000.0,
            }
        ]
        text, kb = build_admin_review(groups)
        assert "REVIEW REIMBURSE SEMUA USER" in text
        assert "Joko" in text
        assert "45.000" in text
        assert kb is not None
        callback_datas = [btn["callback_data"] for row in kb["inline_keyboard"] for btn in row if "callback_data" in btn]
        assert "reimb_user:5" in callback_datas


# ──────────────────────────────────────────────
# 4. Tests for Intent & Telegram Bot Flows
# ──────────────────────────────────────────────

class TestReimburseTelegramFlows:
    def test_reimburse_intent_classification(self):
        intent, _ = classify_intent("/reimburse")
        assert intent == Intent.CMD_REIMBURSE
        intent, _ = classify_intent("/talangan")
        assert intent == Intent.CMD_REIMBURSE
        intent, _ = classify_intent("cek reimburse saya")
        assert intent == Intent.CMD_REIMBURSE
        intent, _ = classify_intent("daftar talangan")
        assert intent == Intent.CMD_REIMBURSE

    @pytest.mark.asyncio
    async def test_handle_reimburse_as_user(self, db: AsyncSession, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "admin_telegram_ids", "")
        monkeypatch.setattr(settings, "dashboard_pin_chat_id", "99999999")

        u = User(
            telegram_id=777888,
            name="Dewi Bakery",
            is_auth=True,
        )
        db.add(u)
        await db.commit()

        exp = Expense(
            expense_date=date(2026, 10, 22),
            item_name="Pewarna Merah",
            total_price=Decimal("15000"),
            is_reimbursement=True,
            user_id=u.id,
        )
        db.add(exp)
        await db.commit()

        agent = HermesAgent(db, user_id=u.id, chat_id=777888, thread_id=None)
        with patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            await agent.process(text="/reimburse")
            mock_send.assert_called_once()
            sent_text = mock_send.call_args[0][1]
            assert "Dewi Bakery" in sent_text
            assert "Pewarna Merah" in sent_text
            assert "15.000" in sent_text

    @pytest.mark.asyncio
    async def test_callback_reimb_user_paid(self, db: AsyncSession, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "admin_telegram_ids", "111222")

        u = User(
            telegram_id=333444,
            name="Andi Staff",
            is_auth=True,
        )
        db.add(u)
        await db.commit()

        exp = Expense(
            expense_date=date(2026, 10, 21),
            item_name="Sarung Tangan Plastik",
            total_price=Decimal("20000"),
            is_reimbursement=True,
            user_id=u.id,
            reimbursed_at=None,
        )
        db.add(exp)
        await db.commit()

        callback_query = {
            "id": "cb_1",
            "from": {"id": 111222, "first_name": "Owner Admin"},
            "message": {
                "chat": {"id": 111222},
                "message_id": 999,
            },
            "data": f"reimb_user:{u.id}",
        }

        with patch("app.bot.telegram_client.answer_callback_query", new_callable=AsyncMock) as mock_ans, \
             patch("app.bot.telegram_client.edit_message", new_callable=AsyncMock) as mock_edit, \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send_dm:
            await handle_callback_query(callback_query, db)

            mock_ans.assert_called_once()
            mock_send_dm.assert_called_once()
            dm_text = mock_send_dm.call_args[0][1]
            assert "Sudah Diganti" in dm_text
            assert "20.000" in dm_text

        # Verify expense in DB is marked reimbursed
        await db.refresh(exp)
        assert exp.reimbursed_at is not None


# ──────────────────────────────────────────────
# 5. Tests for Scheduler Job
# ──────────────────────────────────────────────

class TestSchedulerReimburseReminder:
    @pytest.mark.asyncio
    async def test_job_send_weekly_reimburse_reminder(self, db: AsyncSession, monkeypatch):
        from app.config import settings
        from app.scheduler.jobs import job_send_weekly_reimburse_reminder
        from contextlib import asynccontextmanager

        monkeypatch.setattr(settings, "admin_telegram_ids", "555666")

        u = User(
            telegram_id=121212,
            name="Rina",
            is_auth=True,
        )
        db.add(u)
        await db.commit()

        exp = Expense(
            expense_date=date(2026, 10, 22),
            item_name="Cokelat Putih",
            total_price=Decimal("60000"),
            is_reimbursement=True,
            user_id=u.id,
        )
        db.add(exp)
        await db.commit()

        @asynccontextmanager
        async def fake_session_cm():
            yield db

        with patch("app.scheduler.jobs.AsyncSessionLocal", side_effect=fake_session_cm), \
             patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
            await job_send_weekly_reimburse_reminder()
            assert mock_send.call_count >= 1
            # Check DM message to Rina
            rina_calls = [c for c in mock_send.call_args_list if c[1].get("chat_id") == 121212 or (c[0] and c[0][0] == 121212)]
            assert len(rina_calls) == 1
