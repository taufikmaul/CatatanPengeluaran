"""
app/models/purchase_request.py — Model Pengajuan / Request Belanja Multi-Item
Mendukung alur 3 peran:
1. Karyawan Dapur/Toko: Mengajukan daftar belanjaan (multi-item list)
2. Purchasing: Mengelompokkan per supplier, copy template WA/email, dan memesan
3. Gudang (Receiving): Memeriksa kesesuaian qty (sesuai/lebih/kurang), cek kondisi & input expired date
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
    from app.models.master_item import MasterItem
    from app.models.supplier import Supplier


class PurchaseRequest(Base):
    """Header pengajuan belanja yang memuat satu atau banyak item kebutuhan."""
    __tablename__ = "purchase_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_number: Mapped[str] = mapped_column(String(50), default="", server_default=text("''"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="Request Belanja", server_default=text("'Request Belanja'"))
    request_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False, index=True)

    # Pemohon
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id], lazy="selectin")
    requester_name: Mapped[str] = mapped_column(String(255), default="-", server_default=text("'-'"))

    # Legacy fields (untuk kompatibilitas fallback baris single-item lama)
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    qty: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True, default=1)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True, default="Pcs")
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    estimated_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True, default=None)

    urgency: Mapped[str] = mapped_column(String(20), default="NORMAL", server_default=text("'NORMAL'"), index=True)
    notes: Mapped[str] = mapped_column(Text, default="-", server_default=text("'-'"))

    # Status Keseluruhan: PENDING / APPROVED / PARTIAL_ORDERED / ORDERED / RECEIVED / REJECTED / CANCELLED
    status: Mapped[str] = mapped_column(String(30), default="PENDING", server_default=text("'PENDING'"), index=True)

    # Reviewer
    reviewed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by_id], lazy="selectin")
    reviewer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Legacy expense link
    expense_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expense: Mapped["Expense | None"] = relationship("Expense", foreign_keys=[expense_id], lazy="selectin")
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relasi ke detail list item
    items: Mapped[list["PurchaseRequestItem"]] = relationship(
        "PurchaseRequestItem",
        back_populates="request",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PurchaseRequestItem.id",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now(), nullable=False
    )


class PurchaseRequestItem(Base):
    """Rincian item dalam satu pengajuan belanja."""
    __tablename__ = "purchase_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("purchase_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    request: Mapped["PurchaseRequest"] = relationship("PurchaseRequest", back_populates="items")

    # Info Barang
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    master_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("master_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    master_item: Mapped["MasterItem | None"] = relationship("MasterItem", foreign_keys=[master_item_id], lazy="selectin")
    qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=1, server_default=text("1"), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), default="Pcs", server_default=text("'Pcs'"), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, default="Bahan Kue")
    notes: Mapped[str] = mapped_column(Text, default="-", server_default=text("'-'"))

    # ───────────────────────────────────────────
    # Bidang Purchasing (Pemesanan & Supplier)
    # ───────────────────────────────────────────
    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supplier: Mapped["Supplier | None"] = relationship("Supplier", foreign_keys=[supplier_id], lazy="selectin")
    supplier_name: Mapped[str] = mapped_column(String(255), default="-", server_default=text("'-'"))
    estimated_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True, default=None)
    order_status: Mapped[str] = mapped_column(String(30), default="PENDING", server_default=text("'PENDING'"), index=True)
    # PENDING / ORDERED / CANCELLED
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ───────────────────────────────────────────
    # Bidang Gudang (Penerimaan, Exp Date, & Cek Qty)
    # ───────────────────────────────────────────
    qty_received: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True, default=None)
    # Status penerimaan: PENDING / SESUAI / KURANG / LEBIH / RUSAK
    receiving_status: Mapped[str] = mapped_column(String(30), default="PENDING", server_default=text("'PENDING'"), index=True)
    expired_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None, index=True)
    received_by: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    receiving_notes: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    # Link ke Expense jika sudah dibuatkan pengeluaran
    expense_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expense: Mapped["Expense | None"] = relationship("Expense", foreign_keys=[expense_id], lazy="selectin")

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now(), nullable=False
    )
