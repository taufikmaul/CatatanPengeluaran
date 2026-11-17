"""
app/models/expense_payment.py — Riwayat Pembayaran DP, Termin/Cicilan, dan Pelunasan Expense
"""
from datetime import datetime, date
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base

if TYPE_CHECKING:
    from app.models.expense import Expense
    from app.models.bank_account import BankAccount


class ExpensePayment(Base):
    __tablename__ = "expense_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    expense_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # "dp" (DP awal), "installment" (cicilan/termin), "settlement" (pelunasan akhir)
    payment_type: Mapped[str] = mapped_column(String(30), default="dp", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    dp_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True, default=None)

    payment_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today, index=True)
    pay_method: Mapped[str] = mapped_column(String(50), default="Transfer", nullable=False)
    bank_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reference_no: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    notes: Mapped[str] = mapped_column(Text, default="-", nullable=False)
    actor: Mapped[str] = mapped_column(String(100), default="system", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    expense: Mapped["Expense"] = relationship("Expense", back_populates="payments")
    bank_account: Mapped["BankAccount | None"] = relationship(
        "BankAccount", foreign_keys=[bank_account_id], lazy="selectin"
    )
