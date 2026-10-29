# app/models/master_data.py
"""
app/models/master_data.py — Master Data Opsi Sistem (Metode Bayar, Kategori, Satuan)
"""
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class MasterDataOption(Base):
    """
    Menyimpan opsi master data sistem yang dapat dikonfigurasi secara dinamis:
    - type = "kategori" (Kategori belanja: Bahan Kue, Kemasan, dll.)
    - type = "metode_bayar" (Metode pembayaran: Tunai, Transfer, QRIS, dll.)
    - type = "satuan" (Satuan kemasan & eceran: Pcs, Box, Kg, Liter, dll.)
    """
    __tablename__ = "master_data_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Pemetaan Akuntansi Standar (Chart of Accounts / COA)
    account_code: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    account_name: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    account_group: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)
    report_type: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("type", "name", name="uq_master_data_type_name"),
        Index("ix_master_data_type_active", "type", "is_active", "sort_order"),
    )
