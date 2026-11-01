# app/models/background_job.py
"""
app/models/background_job.py — Model persistensi antrean dan riwayat background jobs
Menyimpan state job ke database agar tidak hilang saat container direstart
dan mendukung multi-worker.
"""
from datetime import datetime
from typing import Any
from sqlalchemy import String, Text, DateTime, Integer, Float, JSON, func, text
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class BackgroundJobRecord(Base):
    """
    Menyimpan tugas latar belakang (audit duplikasi, merge katalog, dll.)
    secara persisten di database.
    """
    __tablename__ = "background_jobs"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True, default="queued", server_default=text("'queued'")
    )
    progress: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    progress_message: Mapped[str] = mapped_column(
        String(255), default="Menunggu antrean...", server_default=text("'Menunggu antrean...'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, default=dict)
    result: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor: Mapped[str] = mapped_column(String(100), default="user", server_default=text("'user'"), nullable=False)
