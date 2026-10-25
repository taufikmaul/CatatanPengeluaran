"""
app/models/expense_log.py — Model Log Audit & Riwayat Perubahan Data Belanja
Mencatat seluruh aksi penambahan, perubahan (update), dan penghapusan (delete) pengeluaran.
"""
from datetime import datetime
from sqlalchemy import DateTime, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class ExpenseLog(Base):
    __tablename__ = "expense_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    expense_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    actor: Mapped[str] = mapped_column(
        String(100), nullable=False, default="system", server_default=text("'system'")
    )
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False, index=True
    )
