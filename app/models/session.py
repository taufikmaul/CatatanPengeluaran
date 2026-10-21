"""
app/models/session.py — Hermes Agent conversation memory per user
"""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, JSON
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class ConversationSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    
    # Context disimpan sebagai JSON — fleksibel untuk tambah field baru.
    # MutableDict wajib agar perubahan in-place (mis. append ke
    # conversation_history) terdeteksi dan benar-benar di-UPDATE.
    context: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSON), default=dict)
    # Format context:
    # {
    #   "last_intent": "scan_receipt",
    #   "last_items": ["tepung", "gula"],
    #   "last_action_at": "2026-10-21T10:00:00",
    #   "pending_action": null,
    #   "conversation_history": [...last 5 turns...]
    # }
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
