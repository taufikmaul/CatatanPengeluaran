"""
app/models/expense.py — Expense (Pengeluaran) model
Kolom identik dengan Google Sheets lama + extras untuk Postgres
"""
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer,
    Numeric, String, Text, text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.master_item import MasterItem
    from app.models.supplier import Supplier
    from app.models.expense_payment import ExpensePayment


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    
    # Data utama (sama persis dengan GAS)
    supplier: Mapped[str] = mapped_column(String(255), default="-")
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=1)
    unit: Mapped[str] = mapped_column(String(50), default="Pcs", server_default=text("'Pcs'"), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=True, index=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    shipping_fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0, server_default=text("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    other_fee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0, server_default=text("0"))
    discount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    total_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    pay_method: Mapped[str] = mapped_column(String(50), default="Tunai")
    pay_status: Mapped[str] = mapped_column(String(50), default="Lunas", index=True)
    due_date: Mapped[str] = mapped_column(String(50), default="-")
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0, server_default=text("0"))
    dp_type: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    dp_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True, default=None)
    notes: Mapped[str] = mapped_column(Text, default="-")
    msg_link: Mapped[str] = mapped_column(Text, default="Private Chat")

    # Reimbursement & Invoice
    is_reimbursement: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), index=True)
    invoice_number: Mapped[str] = mapped_column(String(100), default="-", server_default="-", nullable=True)
    # Waktu talangan diganti oleh admin/owner (NULL = belum diganti)
    reimbursed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    
    # Relasi user
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    # Relasi master item (katalog item baku)
    master_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("master_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    master_item: Mapped["MasterItem | None"] = relationship("MasterItem", foreign_keys=[master_item_id], lazy="selectin")

    # Relasi master supplier (toko/vendor)
    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supplier_rel: Mapped["Supplier | None"] = relationship(
        "Supplier", foreign_keys=[supplier_id], back_populates="expenses", lazy="selectin"
    )

    # Relasi rekening sumber pembayaran (Kas / Bank / Petty Cash) & Rekonsiliasi
    bank_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    reconciled_ref: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    
    # Untuk Google Sheets sync
    sheets_synced: Mapped[bool] = mapped_column(Boolean, default=False)

    # Riwayat pembayaran DP / cicilan / pelunasan
    payments: Mapped[list["ExpensePayment"]] = relationship(
        "ExpensePayment",
        back_populates="expense",
        cascade="all, delete-orphan",
        order_by="ExpensePayment.payment_date.asc(), ExpensePayment.id.asc()",
        lazy="selectin",
    )
