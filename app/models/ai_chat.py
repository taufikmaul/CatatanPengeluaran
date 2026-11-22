"""
app/models/ai_chat.py — Sesi dan pesan AI Financial Chat (khusus Owner)
"""
from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base


def _utc_now() -> datetime:
    """Return naive UTC timestamp konsisten dengan model database lain."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AiChatSession(Base):
    """Header sesi percakapan AI Financial Chat."""

    __tablename__ = "ai_chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), default="Percakapan Baru", nullable=False)
    provider: Mapped[str] = mapped_column(String(32), default="openrouter", nullable=False)
    model_id: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utc_now, onupdate=_utc_now, nullable=False
    )

    messages: Mapped[list["AiChatMessage"]] = relationship(
        "AiChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="AiChatMessage.created_at, AiChatMessage.id",
    )


class AiChatMessage(Base):
    """Pesan individual dalam sesi AI Financial Chat."""

    __tablename__ = "ai_chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ai_chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tool_calls_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now, nullable=False)

    session: Mapped["AiChatSession"] = relationship("AiChatSession", back_populates="messages")

    __table_args__ = (
        Index("ix_ai_chat_messages_session_created", "session_id", "created_at"),
    )
