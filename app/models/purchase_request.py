"""
app/models/purchase_request.py — Model Pengajuan / Request Belanja
Mencatat kebutuhan belanja dari tim dapur/toko sebelum dibelanjakan.
"""
from datetime import datetime, date
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import (
    Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func, text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.expense import Expense


class PurchaseRequest(Base):
    __tablename__ = "purchase_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False, index=True)

    # Pemohon
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id], lazy="selectin")
    requester_name: Mapped[str] = mapped_column(String(255), default="-", server_default=text("'-'"))

    # Detail Barang
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=1, server_default=text("1"))
    unit: Mapped[str] = mapped_column(String(50), default="Pcs", server_default=text("'Pcs'"), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    estimated_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True, default=None)
    urgency: Mapped[str] = mapped_column(String(20), default="NORMAL", server_default=text("'NORMAL'"), index=True)
    notes: Mapped[str] = mapped_column(Text, default="-", server_default=text("'-'"))

    # Status: PENDING / APPROVED / REJECTED / FULFILLED / CANCELLED
    status: Mapped[str] = mapped_column(String(30), default="PENDING", server_default=text("'PENDING'"), index=True)

    # Reviewer
    reviewed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by_id], lazy="selectin")
    reviewer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Link ke transaksi pembelian riil
    expense_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expense: Mapped["Expense | None"] = relationship("Expense", foreign_keys=[expense_id], lazy="selectin")
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now(), nullable=False
    )
