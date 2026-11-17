"""
Integration test untuk app/bot/webhook.py.

Panggilan keluar ke Telegram dan AI selalu di-mock, sehingga test tidak
menyentuh jaringan. Database memakai fixture SQLite in-memory.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import webhook as webhook_module
from app.database.connection import get_db
from app.main import app
from app.models.user import User


@pytest.fixture
async def client(db: AsyncSession):
    """AsyncClient yang menembak app FastAPI dengan dependency DB di-override."""

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def telegram_spy(monkeypatch) -> list[dict[str, Any]]:
    """Rekam semua pesan yang 'dikirim' ke Telegram."""
    sent: list[dict[str, Any]] = []

    async def fake_send_message(
        chat_id, text, thread_id=None, reply_markup=None, parse_mode="Markdown"
    ):
        sent.append(
            {
                "chat_id": chat_id,
                "text": text,
                "thread_id": thread_id,
                "reply_markup": reply_markup,
            }
        )
        return {"ok": True, "result": {"message_id": 999}}

    async def fake_edit_message(chat_id, message_id, text, reply_markup=None,
                                parse_mode="Markdown"):
        sent.append({"chat_id": chat_id, "text": text, "edited": True})

    monkeypatch.setattr(webhook_module.tg, "send_message", fake_send_message)
    monkeypatch.setattr(webhook_module.tg, "edit_message", fake_edit_message)
    return sent


def _private_message(text: str, sender_id: int = 55501) -> dict:
    return {
        "update_id": 1,
        "message": {
            "message_id": 10,
            "date": int(datetime(2026, 10, 21, 10, 0).timestamp()),
            "chat": {"id": sender_id, "type": "private"},
            "from": {"id": sender_id, "first_name": "Budi"},
            "text": text,
        },
    }


def _group_message(text: str, thread_id: int | None) -> dict:
    message = {
        "message_id": 20,
        "date": int(datetime(2026, 10, 21, 10, 0).timestamp()),
        "chat": {"id": -1001234567890, "type": "supergroup"},
        "from": {"id": 777, "first_name": "Siti"},
        "text": text,
    }
    if thread_id is not None:
        message["message_thread_id"] = thread_id
    return {"update_id": 2, "message": message}


class TestAuthentication:
    async def test_wrong_password_locks_bot(self, client, db, telegram_spy):
        response = await client.post("/webhook", json=_private_message("salah"))

        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert any("Terkunci" in m["text"] for m in telegram_spy)

        users = (await db.execute(select(User))).scalars().all()
        assert users == []

    async def test_correct_password_authenticates_user(self, client, db, telegram_spy):
        from app.config import settings

        response = await client.post(
            "/webhook", json=_private_message(settings.bot_password)
        )

        assert response.status_code == 200
        assert any("Akses Diterima" in m["text"] for m in telegram_spy)

        user = (await db.execute(select(User))).scalar_one()
        assert user.is_auth is True
        assert user.name == "Budi"

    async def test_authenticated_user_message_reaches_agent(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.utils.auth import authenticate_user

        await authenticate_user(db, 55501, "Budi")
        await db.flush()

        calls: list[str] = []

        async def fake_process(self, text="", **kwargs):
            calls.append(text)

        monkeypatch.setattr("app.agent.hermes.HermesAgent.process", fake_process)

        await client.post("/webhook", json=_private_message("/rekap"))
        assert calls == ["/rekap"]


class TestGroupAuthorization:
    async def test_wrong_thread_is_ignored(self, client, db, telegram_spy, monkeypatch):
        from app.config import settings

        calls: list[str] = []

        async def fake_process(self, text="", **kwargs):
            calls.append(text)

        monkeypatch.setattr("app.agent.hermes.HermesAgent.process", fake_process)

        wrong_thread = (settings.allowed_thread_id or 7) + 1
        await client.post("/webhook", json=_group_message("/rekap", wrong_thread))

        assert calls == []
        assert telegram_spy == []

    async def test_allowed_thread_reaches_agent(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.config import settings

        calls: list[str] = []

        async def fake_process(self, text="", **kwargs):
            calls.append(text)

        monkeypatch.setattr("app.agent.hermes.HermesAgent.process", fake_process)

        await client.post(
            "/webhook", json=_group_message("/rekap", settings.allowed_thread_id)
        )
        assert calls == ["/rekap"]

    async def test_request_belanja_topic_ignores_all_messages_and_media(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.config import settings

        agent_calls: list[str] = []
        photo_calls: list[dict] = []
        voice_calls: list[dict] = []

        async def fake_process(self, text="", **kwargs):
            agent_calls.append(text)

        async def fake_process_photo(**kwargs):
            photo_calls.append(kwargs)

        async def fake_process_voice(**kwargs):
            voice_calls.append(kwargs)

        monkeypatch.setattr("app.agent.hermes.HermesAgent.process", fake_process)
        monkeypatch.setattr(webhook_module, "_process_photo", fake_process_photo)
        monkeypatch.setattr(webhook_module, "_process_voice", fake_process_voice)
        monkeypatch.setattr(settings, "request_belanja_thread_id", 4947)
        monkeypatch.setattr(settings, "request_belanja_chat_id", None)
        # Sekalipun admin sempat menambahkan 4947 ke allowed_thread_ids, Topic Request Belanja tetap tidak mencatat pesan
        monkeypatch.setattr(settings, "allowed_thread_ids", "4947")

        # 1. Teks biasa & command /catat
        await client.post("/webhook", json=_group_message("beli tepung 5kg 60000", 4947))
        await client.post("/webhook", json=_group_message("/catat gula 20000", 4947))
        await client.post("/webhook", json=_group_message("/rekap", 4947))

        # 2. Foto struk
        photo_update = _group_message("", 4947)
        photo_update["message"].pop("text")
        photo_update["message"]["photo"] = [{"file_id": "foto-1", "file_size": 100}]
        photo_update["message"]["caption"] = "struk belanja"
        await client.post("/webhook", json=photo_update)

        # 3. Voice note
        voice_update = _group_message("", 4947)
        voice_update["message"].pop("text")
        voice_update["message"]["voice"] = {"file_id": "voice-1"}
        await client.post("/webhook", json=voice_update)
        await asyncio.sleep(0)

        assert agent_calls == []
        assert photo_calls == []
        assert voice_calls == []
        assert telegram_spy == []

    async def test_request_belanja_topic_callback_filtering(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.config import settings

        handled: list[str] = []

        async def fake_handle_callback(cb, session):
            handled.append(cb["id"])

        monkeypatch.setattr(webhook_module, "handle_callback_query", fake_handle_callback)
        monkeypatch.setattr(settings, "request_belanja_thread_id", 4947)
        monkeypatch.setattr(settings, "request_belanja_chat_id", "-1001234567890")

        # Callback non-request (mis. undo_save) di Topic Request Belanja diabaikan
        await client.post(
            "/webhook",
            json={
                "callback_query": {
                    "id": "cb-exp-1",
                    "from": {"id": 777},
                    "message": {
                        "message_id": 11,
                        "message_thread_id": 4947,
                        "chat": {"id": -1001234567890, "type": "supergroup"},
                    },
                    "data": "undo_save:1",
                }
            },
        )
        # Callback request belanja (req_app:) tetap diizinkan
        await client.post(
            "/webhook",
            json={
                "callback_query": {
                    "id": "cb-req-1",
                    "from": {"id": 777},
                    "message": {
                        "message_id": 12,
                        "message_thread_id": 4947,
                        "chat": {"id": -1001234567890, "type": "supergroup"},
                    },
                    "data": "req_app:5",
                }
            },
        )
        await asyncio.sleep(0)

        assert handled == ["cb-req-1"]


class TestMediaRouting:
    async def test_photo_is_processed_in_background(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.config import settings
        from app.utils.auth import authenticate_user

        await authenticate_user(db, 777, "Siti")
        await db.flush()

        received: dict[str, Any] = {}

        async def fake_process_photo(**kwargs):
            received.update(kwargs)

        monkeypatch.setattr(webhook_module, "_process_photo", fake_process_photo)

        update = _group_message("", settings.allowed_thread_id)
        update["message"].pop("text")
        update["message"]["photo"] = [
            {"file_id": "small", "file_size": 10},
            {"file_id": "large", "file_size": 100},
        ]
        update["message"]["caption"] = "struk belanja"

        await client.post("/webhook", json=update)
        await asyncio.sleep(0)  # biarkan create_task berjalan

        assert received.get("file_id") == "small"
        assert received.get("caption") == "struk belanja"

    async def test_image_document_is_processed_as_photo(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.config import settings
        from app.utils.auth import authenticate_user

        await authenticate_user(db, 777, "Siti")
        await db.flush()

        received: dict[str, Any] = {}

        async def fake_process_photo(**kwargs):
            received.update(kwargs)

        monkeypatch.setattr(webhook_module, "_process_photo", fake_process_photo)

        update = _group_message("", settings.allowed_thread_id)
        update["message"].pop("text")
        update["message"]["document"] = {
            "file_id": "doc-img-123",
            "mime_type": "image/jpeg",
            "file_name": "struk.jpg",
        }
        update["message"]["caption"] = "struk versi dokumen"

        await client.post("/webhook", json=update)
        await asyncio.sleep(0)

        assert received.get("file_id") == "doc-img-123"
        assert received.get("caption") == "struk versi dokumen"

    async def test_voice_is_processed_in_background(
        self, client, db, telegram_spy, monkeypatch
    ):
        from app.config import settings
        from app.utils.auth import authenticate_user

        await authenticate_user(db, 777, "Siti")
        await db.flush()

        received: dict[str, Any] = {}

        async def fake_process_voice(**kwargs):
            received.update(kwargs)

        monkeypatch.setattr(webhook_module, "_process_voice", fake_process_voice)

        update = _group_message("", settings.allowed_thread_id)
        update["message"].pop("text")
        update["message"]["voice"] = {"file_id": "voice-file"}

        await client.post("/webhook", json=update)
        await asyncio.sleep(0)

        assert received.get("file_id") == "voice-file"


class TestCallbackQuery:
    async def test_duplicate_callback_is_ignored_once(
        self, client, db, telegram_spy, monkeypatch
    ):
        handled: list[str] = []

        async def fake_handle_callback(cb, session):
            handled.append(cb["id"])

        monkeypatch.setattr(
            webhook_module, "handle_callback_query", fake_handle_callback
        )

        update = {
            "callback_query": {
                "id": "cb-1",
                "from": {"id": 777},
                "message": {
                    "message_id": 5,
                    "chat": {"id": -100123, "type": "supergroup"},
                },
                "data": "menu_rekap",
            }
        }

        await client.post("/webhook", json=update)
        await asyncio.sleep(0)
        await client.post("/webhook", json=update)
        await asyncio.sleep(0)

        # Dedup: callback dengan id sama hanya diproses sekali.
        assert handled == ["cb-1"]

    async def test_unknown_update_type_is_acknowledged(self, client):
        response = await client.post("/webhook", json={"update_id": 99})
        assert response.status_code == 200
        assert response.json() == {"ok": True}


class TestMalformedPayload:
    async def test_invalid_json_is_swallowed(self, client):
        """
        Perilaku saat ini: error ditelan dan tetap balas 200.

        Test ini mengunci kontrak tersebut; bila nanti webhook diperbaiki untuk
        memvalidasi payload (mis. 400), update test ini secara eksplisit.
        """
        response = await client.post(
            "/webhook",
            content=b"not-json",
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 200
        assert response.json() == {"ok": True}
