"""Test untuk app/utils/auth.py dan app/agent/memory.py."""

import pytest
from sqlalchemy import select

from app.agent.memory import (
    DEFAULT_CONTEXT,
    add_conversation_turn,
    clear_user_context,
    get_user_context,
    update_user_context,
)
from app.models.session import ConversationSession
from app.models.user import User
from app.utils.auth import (
    authenticate_user,
    get_or_create_user,
    is_user_authenticated,
)


class TestAuth:
    async def test_new_user_is_not_authenticated(self, db):
        assert await is_user_authenticated(db, 111) is False

    async def test_authenticate_creates_user(self, db):
        await authenticate_user(db, 111, "Budi")
        assert await is_user_authenticated(db, 111) is True

    async def test_authenticate_updates_existing_user(self, db):
        await get_or_create_user(db, 222, "Lama")
        await authenticate_user(db, 222, "Baru")

        result = await db.execute(select(User).where(User.telegram_id == 222))
        user = result.scalar_one()
        assert user.is_auth is True
        assert user.name == "Baru"
        assert len((await db.execute(select(User))).scalars().all()) == 1

    async def test_get_or_create_is_idempotent(self, db):
        first = await get_or_create_user(db, 333, "Siti")
        second = await get_or_create_user(db, 333, "Siti")
        assert first.id == second.id

    async def test_get_or_create_does_not_authenticate(self, db):
        await get_or_create_user(db, 444)
        assert await is_user_authenticated(db, 444) is False


class TestMemory:
    async def test_default_context_when_absent(self, db):
        ctx = await get_user_context(db, 1)
        assert ctx == DEFAULT_CONTEXT

    async def test_update_creates_session(self, db):
        await update_user_context(db, 1, {"last_intent": "cmd_rekap"})
        ctx = await get_user_context(db, 1)
        assert ctx["last_intent"] == "cmd_rekap"

    async def test_update_merges_with_existing(self, db):
        await update_user_context(db, 1, {"last_intent": "cmd_rekap"})
        await update_user_context(db, 1, {"last_supplier": "Toko A"})

        ctx = await get_user_context(db, 1)
        assert ctx["last_intent"] == "cmd_rekap"
        assert ctx["last_supplier"] == "Toko A"

    async def test_only_one_session_row_per_user(self, db):
        await update_user_context(db, 1, {"last_intent": "a"})
        await update_user_context(db, 1, {"last_intent": "b"})

        rows = (await db.execute(select(ConversationSession))).scalars().all()
        assert len(rows) == 1
        assert rows[0].context["last_intent"] == "b"

    async def test_sessions_are_isolated_per_user(self, db):
        await update_user_context(db, 1, {"last_intent": "user1"})
        await update_user_context(db, 2, {"last_intent": "user2"})

        assert (await get_user_context(db, 1))["last_intent"] == "user1"
        assert (await get_user_context(db, 2))["last_intent"] == "user2"

    async def test_conversation_history_capped_at_five_turns(self, db):
        for i in range(8):
            await add_conversation_turn(db, 1, "user", f"pesan {i}")

        history = (await get_user_context(db, 1))["conversation_history"]
        assert len(history) == 5
        assert history[-1]["content"] == "pesan 7"

    async def test_conversation_content_truncated_to_500(self, db):
        await add_conversation_turn(db, 1, "user", "x" * 1000)
        history = (await get_user_context(db, 1))["conversation_history"]
        assert len(history[0]["content"]) == 500

    async def test_clear_resets_context(self, db):
        await update_user_context(db, 1, {"last_intent": "cmd_rekap"})
        await clear_user_context(db, 1)

        ctx = await get_user_context(db, 1)
        assert ctx["last_intent"] is None
        assert ctx["last_items"] == []
