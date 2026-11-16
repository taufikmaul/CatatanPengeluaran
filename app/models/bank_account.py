"""
app/models/bank_account.py — Master Data Rekening & Kas Penerimaan (Rekening Setup)
"""
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class BankAccount(Base):
    """
    Menyimpan daftar rekening bank, kas tunai, dan dompet aggregator (GoBiz, GrabMerchant, Shopee)
    beserta pemetaan channel/metode bayar POS agar transaksi masuk otomatis terarah ke rekening.
    """
    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(100), nullable=False)
    account_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    account_holder: Mapped[str | None] = mapped_column(String(100), nullable=True)
    account_type: Mapped[str] = mapped_column(String(30), default="bank", nullable=False)  # bank | cash | ewallet | aggregator
    account_code: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Kode akun COA (cth: 1-1110, 1-1120)
    opening_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    channel_mappings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of strings
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_bank_accounts_active_sort", "is_active", "sort_order"),
    )
