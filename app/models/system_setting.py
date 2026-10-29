# app/models/system_setting.py
"""
app/models/system_setting.py — Tabel untuk menyimpan konfigurasi sistem dinamis ke database
"""
from datetime import datetime
from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class SystemSetting(Base):
    """
    Menyimpan konfigurasi sistem dinamis agar persisten di PostgreSQL
    dan tidak hilang saat deploy / container recreate:
    - key: nama konfigurasi (e.g. "allowed_thread_ids", "tukar_cash_thread_ids", "ongkir_thread_ids")
    - value: nilai konfigurasi (string / serialized JSON)
    """
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
