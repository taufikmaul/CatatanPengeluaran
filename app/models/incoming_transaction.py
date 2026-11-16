"""
app/models/incoming_transaction.py — Transaksi Masuk (Penjualan POS, GoFood, GrabFood, ShopeeFood, dll.)
"""
from datetime import datetime, date
from sqlalchemy import (
    String,
    Integer,
    Float,
    Date,
    DateTime,
    Text,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base


class IncomingTransaction(Base):
    """Header transaksi penjualan masuk per struk / order ID."""
    __tablename__ = "incoming_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(30), default="pos", nullable=False, index=True)
    receipt_no: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    order_no: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)

    transaction_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    transaction_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(100), nullable=True)

    order_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    payment_method: Mapped[str] = mapped_column(String(60), nullable=False, index=True)

    bank_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )

    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cashier_name: Mapped[str | None] = mapped_column(String(80), nullable=True)

    gross_sales: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    discount_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    net_sales: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    platform_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    net_received: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cancellation_total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    promo_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="paid", nullable=False, index=True)  # paid | void | cancelled
    void_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    items: Mapped[list["IncomingTransactionItem"]] = relationship(
        "IncomingTransactionItem",
        back_populates="transaction",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    bank_account = relationship("BankAccount", lazy="joined")

    __table_args__ = (
        UniqueConstraint("source_type", "receipt_no", name="uq_incoming_tx_source_receipt"),
        Index("ix_incoming_tx_date_status", "transaction_date", "status"),
    )


class IncomingTransactionItem(Base):
    """Detail item produk pada setiap transaksi masuk."""
    __tablename__ = "incoming_transaction_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("incoming_transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100), nullable=True)
    qty: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    modifier: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    extra_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    gross_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    discount_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    transaction: Mapped["IncomingTransaction"] = relationship("IncomingTransaction", back_populates="items")
