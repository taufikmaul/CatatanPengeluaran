"""
app/models/bank_transfer.py — Mutasi Transfer Antar Rekening (Setor Tunai & Pencairan Platform)
"""
from datetime import datetime, date
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base


class BankTransfer(Base):
    """
    Mencatat perpindahan saldo internal antar rekening (mis. Setor Tunai Kasir ke BCA,
    atau Pencairan Dompet GoBiz/ShopeeFood ke Rekening Bank). Netral terhadap Laba Rugi.
    """
    __tablename__ = "bank_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transfer_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    from_account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    to_account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    admin_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    transfer_type: Mapped[str] = mapped_column(String(30), default="antar_rekening", nullable=False)  # setor_tunai | pencairan_platform | antar_rekening
    reference_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    from_account = relationship("BankAccount", foreign_keys=[from_account_id], lazy="joined")
    to_account = relationship("BankAccount", foreign_keys=[to_account_id], lazy="joined")

    __table_args__ = (
        Index("ix_bank_transfers_date", "transfer_date"),
    )
