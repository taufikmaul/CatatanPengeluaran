"""
app/agent/memory.py — Per-user conversation memory untuk Hermes
Disimpan di Postgres (tabel sessions) agar persist antar restart
"""
from datetime import datetime
from copy import deepcopy
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.session import ConversationSession


DEFAULT_CONTEXT = {
    "last_intent": None,
    "last_items": [],
    "last_supplier": None,
    "last_action_at": None,
    "pending_action": None,
    "conversation_history": [],   # max 5 turns
}


async def get_user_context(db: AsyncSession, user_id: int) -> dict:
    """Ambil context user dari DB. Return default jika belum ada.

    Selalu mengembalikan salinan, supaya pemanggil tidak memutasi objek milik
    sesi SQLAlchemy secara diam-diam.
    """
    result = await db.execute(
        select(ConversationSession).where(ConversationSession.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if not session or not session.context:
        return deepcopy(DEFAULT_CONTEXT)
    return dict(session.context)


async def update_user_context(db: AsyncSession, user_id: int, updates: dict) -> None:
    """Update context user. Merge dengan context existing."""
    result = await db.execute(
        select(ConversationSession).where(ConversationSession.user_id == user_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        context = {**deepcopy(DEFAULT_CONTEXT), **updates}
        session = ConversationSession(user_id=user_id, context=context)
        db.add(session)
    else:
        # Assign dict baru (bukan mutasi in-place) agar perubahan pasti
        # terdeteksi SQLAlchemy dan terkirim sebagai UPDATE.
        current = {**(session.context or {})}
        current.update(updates)
        # Simpan last 5 conversation turns only
        if "conversation_history" in current:
            current["conversation_history"] = current["conversation_history"][-5:]
        session.context = current
        session.updated_at = datetime.utcnow()

    await db.flush()


async def add_conversation_turn(
    db: AsyncSession,
    user_id: int,
    role: str,
    content: str,
) -> None:
    """Tambah 1 turn ke conversation history."""
    ctx = await get_user_context(db, user_id)
    history = list(ctx.get("conversation_history", []))
    history.append({
        "role": role,
        "content": content[:500],  # limit panjang
        "at": datetime.utcnow().isoformat(),
    })
    await update_user_context(db, user_id, {"conversation_history": history[-5:]})


async def clear_user_context(db: AsyncSession, user_id: int) -> None:
    """Reset context user ke default."""
    await update_user_context(db, user_id, deepcopy(DEFAULT_CONTEXT))
