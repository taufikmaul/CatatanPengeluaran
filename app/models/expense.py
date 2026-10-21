"""
app/models/expense.py — Expense (Pengeluaran) model
Kolom identik dengan Google Sheets lama + extras untuk Postgres
"""
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer,
    Numeric, String, Text
)
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


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
    category: Mapped[str] = mapped_column(String(100), nullable=True, index=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    discount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    total_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=0)
    pay_method: Mapped[str] = mapped_column(String(50), default="Tunai")
    pay_status: Mapped[str] = mapped_column(String(50), default="Lunas", index=True)
    due_date: Mapped[str] = mapped_column(String(50), default="-")
    notes: Mapped[str] = mapped_column(Text, default="-")
    msg_link: Mapped[str] = mapped_column(Text, default="Private Chat")
    
    # Relasi user
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    
    # Untuk Google Sheets sync
    sheets_synced: Mapped[bool] = mapped_column(Boolean, default=False)
