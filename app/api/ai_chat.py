"""
app/api/ai_chat.py — Endpoint AI Financial Chat khusus Owner (require_admin_role)
"""
from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin_role
from app.config import settings
from app.database.connection import AsyncSessionLocal, get_db
from app.models.ai_chat import AiChatSession
from app.services.ai_chat_service import (
    create_session,
    delete_session,
    get_session_with_messages,
    list_sessions,
    stream_chat_response,
    update_session,
)

router = APIRouter(
    prefix="/ai-chat",
    tags=["ai-chat"],
    dependencies=[Depends(require_admin_role)],
)


def get_chat_session_factory() -> Callable[[], AsyncSession]:
    """Dependency factory untuk AsyncSession independen sepanjang umur stream SSE."""
    return AsyncSessionLocal


class AiChatSessionCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    provider: str | None = Field(default=None, max_length=32)
    model_id: str | None = Field(default=None, max_length=120)


class AiChatSessionUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    provider: str | None = Field(default=None, max_length=32)
    model_id: str | None = Field(default=None, max_length=120)


class AiChatMessageStreamRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    provider: str | None = Field(default=None, max_length=32)
    model_id: str | None = Field(default=None, max_length=120)


@router.get("/models")
async def api_get_ai_chat_models():
    """Ambil katalog provider (OpenRouter & Sumopod) dan opsi model yang tersedia untuk AI Chat."""
    return settings.get_ai_chat_catalog()


@router.get("/sessions")
async def api_list_ai_chat_sessions(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """Ambil daftar riwayat sesi AI Chat."""
    safe_limit = max(1, min(100, limit))
    sessions = await list_sessions(db, limit=safe_limit)
    return {"ok": True, "sessions": sessions}


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def api_create_ai_chat_session(
    payload: AiChatSessionCreate | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Buat sesi AI Chat baru."""
    data = payload or AiChatSessionCreate()
    session = await create_session(
        db,
        provider=data.provider,
        model_id=data.model_id,
        title=data.title,
    )
    return {"ok": True, "session": session}


@router.get("/sessions/{session_id}")
async def api_get_ai_chat_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Ambil detail sesi beserta seluruh riwayat pesan."""
    session = await get_session_with_messages(db, session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesi percakapan tidak ditemukan.",
        )
    return {"ok": True, "session": session}


@router.patch("/sessions/{session_id}")
async def api_update_ai_chat_session(
    session_id: int,
    payload: AiChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Perbarui judul atau provider/model default pada sesi."""
    updated = await update_session(
        db,
        session_id=session_id,
        title=payload.title,
        provider=payload.provider,
        model_id=payload.model_id,
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesi percakapan tidak ditemukan.",
        )
    return {"ok": True, "session": updated}


@router.delete("/sessions/{session_id}")
async def api_delete_ai_chat_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Hapus sesi percakapan beserta seluruh pesan di dalamnya."""
    deleted = await delete_session(db, session_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesi percakapan tidak ditemukan.",
        )
    return {"ok": True, "deleted_id": session_id}


@router.post("/sessions/{session_id}/messages/stream")
async def api_stream_ai_chat_message(
    session_id: int,
    payload: AiChatMessageStreamRequest,
    db: AsyncSession = Depends(get_db),
    session_factory: Callable[[], AsyncSession] = Depends(get_chat_session_factory),
):
    """Kirim pertanyaan ke AI Chat dan terima jawaban via Server-Sent Events (SSE)."""
    existing = await db.get(AiChatSession, session_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sesi percakapan tidak ditemukan.",
        )

    event_stream = stream_chat_response(
        session_factory,
        session_id=session_id,
        user_message=payload.content,
        provider=payload.provider,
        model_id=payload.model_id,
    )
    return StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
