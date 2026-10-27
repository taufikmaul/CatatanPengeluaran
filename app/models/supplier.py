"""
app/models/supplier.py — Model Master Toko / Supplier
Mencatat informasi toko/vendor, kontak, alamat, dan alias untuk pencocokan otomatis.
"""
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.expense import Expense


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True, default="", server_default=text("''"))
    address: Mapped[str | None] = mapped_column(Text, nullable=True, default="", server_default=text("''"))
    aliases: Mapped[str | None] = mapped_column(Text, nullable=True, default="", server_default=text("''"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True, default="", server_default=text("''"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now(), nullable=False
    )

    # Relasi ke transaksi pengeluaran
    expenses: Mapped[list["Expense"]] = relationship(
        "Expense", back_populates="supplier_rel", lazy="selectin"
    )
