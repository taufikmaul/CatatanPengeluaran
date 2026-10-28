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


# ──────────────────────────────────────────────
# 6. Tests for Preserving Items in Chat for Telegram Search
# ──────────────────────────────────────────────

class TestItemSearchPreservationInCallbacks:
    @pytest.mark.asyncio
    async def test_items_preserved_across_all_callback_actions(self, db: AsyncSession, monkeypatch):
        """Pastikan rincian nama barang, harga, toko, nota tidak hilang saat tombol Telegram diklik."""
        from app.services.expense_service import save_expenses, get_expense_by_id
        from app.bot import telegram_client as tg

        edited = []

        async def fake_ans(cb_id, text=""):
            return None

        async def fake_edit(chat_id, msg_id, text, reply_markup=None, parse_mode="Markdown"):
            edited.append({"text": text, "markup": reply_markup})

        monkeypatch.setattr(tg, "answer_callback_query", fake_ans)
        monkeypatch.setattr(tg, "edit_message", fake_edit)

        saved = await save_expenses(
            db,
            [
                {
                    "tanggal": "2026-10-23",
                    "barang": "Mentega Anchor 200g",
                    "qty": 2,
                    "harga_satuan": 45000,
                    "total_harga": 90000,
                    "toko_supplier": "TBK Makmur",
                    "no_invoice": "INV-789",
                },
                {
                    "tanggal": "2026-10-23",
                    "barang": "Pewarna Hijau Koepoe",
                    "qty": 1,
                    "harga_satuan": 8500,
                    "total_harga": 8500,
                    "toko_supplier": "TBK Makmur",
                    "no_invoice": "INV-789",
                },
            ],
        )
        await db.commit()
        ids_str = f"{saved[0].id},{saved[1].id}"

        # 1. Action: toggle_reimb
        cb_reimb = {
            "id": "cb-1",
            "from": {"id": 1001},
            "message": {"message_id": 101, "chat": {"id": 2002}, "text": "Dummy previous message"},
            "data": f"toggle_reimb:{ids_str}",
        }
        await handle_callback_query(cb_reimb, db)
        text_reimb = edited[-1]["text"]
        assert "Mentega Anchor 200g" in text_reimb
        assert "Pewarna Hijau Koepoe" in text_reimb
        assert "TBK Makmur" in text_reimb
        assert "INV-789" in text_reimb
        assert "REIMBURSEMENT" in text_reimb
        assert "Rp 98.500" in text_reimb

        # 2. Action: unpaid_save
        cb_unpaid = {
            "id": "cb-2",
            "from": {"id": 1001},
            "message": {"message_id": 101, "chat": {"id": 2002}, "text": text_reimb},
            "data": f"unpaid_save:{ids_str}",
        }
        await handle_callback_query(cb_unpaid, db)
        text_unpaid = edited[-1]["text"]
        assert "Mentega Anchor 200g" in text_unpaid
        assert "Pewarna Hijau Koepoe" in text_unpaid
        assert "TBK Makmur" in text_unpaid
        assert "Belum Lunas" in text_unpaid
        assert "Rp 98.500" in text_unpaid

        # 3. Action: mark_paid
        cb_paid = {
            "id": "cb-3",
            "from": {"id": 1001},
            "message": {"message_id": 101, "chat": {"id": 2002}, "text": text_unpaid},
            "data": f"mark_paid:{ids_str}",
        }
        await handle_callback_query(cb_paid, db)
        text_paid = edited[-1]["text"]
        assert "Mentega Anchor 200g" in text_paid
        assert "Pewarna Hijau Koepoe" in text_paid
        assert "Lunas" in text_paid
        assert "Rp 98.500" in text_paid

        # 4. Action: undo_save
        cb_undo = {
            "id": "cb-4",
            "from": {"id": 1001},
            "message": {"message_id": 101, "chat": {"id": 2002}, "text": text_paid},
            "data": f"undo_save:{ids_str}",
        }
        await handle_callback_query(cb_undo, db)
        text_undo = edited[-1]["text"]
        assert "Mentega Anchor 200g" in text_undo
        assert "Pewarna Hijau Koepoe" in text_undo
        assert "Dibatalkan" in text_undo
        assert "Rp 98.500" in text_undo

        # Pastikan data di database terhapus
        assert await get_expense_by_id(db, saved[0].id) is None
        assert await get_expense_by_id(db, saved[1].id) is None


class TestReimbursementEndpoints:
    @pytest.mark.asyncio
    async def test_reimbursement_summary_and_settlement_api(self, client, auth_cookies, db: AsyncSession):
        client.cookies.update(auth_cookies)
        user = User(telegram_id=8888, name="Staff Pastry", is_auth=True)
        db.add(user)
        await db.commit()
        await db.refresh(user)

        e1 = Expense(
            expense_date=date(2026, 10, 20),
            item_name="Coklat Bubuk Tulen",
            total_price=Decimal("50000"),
            is_reimbursement=True,
            user_id=user.id,
        )
        e2 = Expense(
            expense_date=date(2026, 10, 21),
            item_name="Vanili Cair 50ml",
            total_price=Decimal("25000"),
            is_reimbursement=True,
            user_id=user.id,
        )
        db.add_all([e1, e2])
        await db.commit()
        await db.refresh(e1)
        await db.refresh(e2)

        # 1. Summary API
        res = await client.get("/api/v1/expenses/reimbursements/summary?year=2026&month=10")
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["pending_count"] >= 2
        assert data["pending_total"] >= 75000
        user_row = next((u for u in data["by_user"] if u["user_id"] == user.id), None)
        assert user_row is not None
        assert user_row["user_name"] == "Staff Pastry"
        assert user_row["pending_count"] == 2
        assert user_row["pending_total"] == 75000

        # 2. Settle mark_reimbursed
        settle_res = await client.post(
            "/api/v1/expenses/reimbursements/settle",
            json={"expense_ids": [e1.id, e2.id], "action": "mark_reimbursed"},
        )
        assert settle_res.status_code == 200
        settle_data = settle_res.json()
        assert settle_data["ok"] is True
        assert settle_data["updated_count"] == 2

        # 3. Verify updated in db
        await db.refresh(e1)
        assert e1.reimbursed_at is not None

        # 4. Summary after settled
        res2 = await client.get(f"/api/v1/expenses/reimbursements/summary?year=2026&month=10&user_id={user.id}")
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["pending_count"] == 0
        assert data2["reimbursed_count"] == 2
        assert data2["reimbursed_total"] == 75000

        # 5. Filter list_expenses by reimbursed_status
        list_res = await client.get("/api/v1/expenses?is_reimbursement=true&reimbursed_status=reimbursed")
        assert list_res.status_code == 200
        list_data = list_res.json()
        reimb_ids = [item["id"] for item in list_data["data"]]
        assert e1.id in reimb_ids
        assert e2.id in reimb_ids


class TestUnpaidEndpoints:
    @pytest.mark.asyncio
    async def test_unpaid_summary_nearest_due_and_settle(self, client, auth_cookies, db: AsyncSession):
        client.cookies.update(auth_cookies)
        from datetime import date, timedelta
        today = date.today()
        d_soon = today + timedelta(days=2)
        d_overdue = today - timedelta(days=3)

        u1 = Expense(
            expense_date=today,
            item_name="Tepung Cakra Kembar 25kg",
            supplier="Toko Makmur Sejahtera",
            total_price=Decimal("350000"),
            pay_status="Belum Lunas",
            due_date=str(d_overdue),
        )
        u2 = Expense(
            expense_date=today,
            item_name="Mentega Wisman 1kg",
            supplier="Toko Makmur Sejahtera",
            total_price=Decimal("150000"),
            pay_status="Belum Lunas",
            due_date=str(d_soon),
        )
        db.add_all([u1, u2])
        await db.commit()
        await db.refresh(u1)
        await db.refresh(u2)

        # 1. Summary API
        res = await client.get("/api/v1/expenses/unpaid/summary")
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["total_unpaid_count"] >= 2
        assert data["total_unpaid_nominal"] >= 500000
        assert data["overdue_count"] >= 1
        assert data["due_soon_count"] >= 1
        assert data["nearest_due"] is not None
        # Tempo terdekat yang paling mendesak adalah yang sudah lewat tempo (u1)
        assert data["nearest_due"]["expense_id"] == u1.id
        assert data["nearest_due"]["is_overdue"] is True

        # Supplier breakdown
        sup_group = next((s for s in data["by_supplier"] if s["supplier_name"] == "Toko Makmur Sejahtera"), None)
        assert sup_group is not None
        assert sup_group["unpaid_count"] == 2
        assert sup_group["unpaid_total"] == 500000

        # 2. Settle mark_paid
        settle_res = await client.post(
            "/api/v1/expenses/unpaid/settle",
            json={"expense_ids": [u1.id, u2.id], "action": "mark_paid"},
        )
        assert settle_res.status_code == 200
        assert settle_res.json()["updated_count"] == 2

        await db.refresh(u1)
        assert u1.pay_status == "Lunas"
        await db.refresh(u2)
        assert u2.pay_status == "Lunas"

