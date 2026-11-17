"""
app/models/fixed_asset.py — Model Inventaris Aset Tetap, Riwayat Maintenance & Audit Log (SAK EMKM)
"""
from datetime import datetime, date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.connection import Base

if TYPE_CHECKING:
    from app.models.expense import Expense
    from app.models.supplier import Supplier


class FixedAsset(Base):
    """Master inventaris aset tetap & peralatan yang terhubung ke transaksi Asset dan akuntansi SAK EMKM."""

    __tablename__ = "fixed_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    asset_group: Mapped[str] = mapped_column(
        String(100),
        default="Mesin & Peralatan Dapur",
        server_default=text("'Mesin & Peralatan Dapur'"),
        nullable=False,
    )
    brand_model: Mapped[str | None] = mapped_column(
        String(255), nullable=True, default="", server_default=text("''")
    )
    serial_number: Mapped[str | None] = mapped_column(
        String(120), nullable=True, default="", server_default=text("''")
    )

    expense_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    unit_index: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    qty_in_lot: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=1, server_default=text("1"), nullable=False
    )

    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    vendor_name: Mapped[str] = mapped_column(
        String(255), default="-", server_default=text("'-'"), nullable=False
    )

    location: Mapped[str] = mapped_column(
        String(120), default="Dapur Produksi", server_default=text("'Dapur Produksi'"), nullable=False
    )
    pic_name: Mapped[str] = mapped_column(
        String(120), default="-", server_default=text("'-'"), nullable=False
    )
    condition: Mapped[str] = mapped_column(
        String(50), default="Baik", server_default=text("'Baik'"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(50), default="Aktif", server_default=text("'Aktif'"), nullable=False, index=True
    )

    purchase_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    warranty_months: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    warranty_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warranty_notes: Mapped[str] = mapped_column(
        Text, default="", server_default=text("''"), nullable=False
    )

    acquisition_cost: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), default=0, server_default=text("0"), nullable=False
    )
    salvage_value: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), default=0, server_default=text("0"), nullable=False
    )
    useful_life_months: Mapped[int] = mapped_column(
        Integer, default=48, server_default=text("48"), nullable=False
    )
    depreciation_method: Mapped[str] = mapped_column(
        String(30), default="straight_line", server_default=text("'straight_line'"), nullable=False
    )
    capitalization_status: Mapped[str] = mapped_column(
        String(30), default="capitalized", server_default=text("'capitalized'"), nullable=False, index=True
    )
    is_capitalization_overridden: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    depreciation_start_date: Mapped[date] = mapped_column(Date, nullable=False)

    disposed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    disposal_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    disposal_proceeds: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    disposal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    notes: Mapped[str] = mapped_column(Text, default="", server_default=text("''"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    expense: Mapped["Expense | None"] = relationship("Expense", foreign_keys=[expense_id], lazy="selectin")
    supplier_rel: Mapped["Supplier | None"] = relationship(
        "Supplier", foreign_keys=[supplier_id], lazy="selectin"
    )
    maintenances: Mapped[list["AssetMaintenance"]] = relationship(
        "AssetMaintenance",
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetMaintenance.maintenance_date.desc(), AssetMaintenance.id.desc()",
        lazy="selectin",
    )


class AssetMaintenance(Base):
    """Riwayat pemeliharaan, servis rutin, perbaikan, dan klaim garansi per aset."""

    __tablename__ = "asset_maintenances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("fixed_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expense_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    maintenance_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    maintenance_type: Mapped[str] = mapped_column(
        String(50), default="Perbaikan", server_default=text("'Perbaikan'"), nullable=False
    )
    vendor_name: Mapped[str] = mapped_column(
        String(255), default="-", server_default=text("'-'"), nullable=False
    )
    cost: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), default=0, server_default=text("0"), nullable=False
    )
    description: Mapped[str] = mapped_column(
        Text, default="-", server_default=text("'-'"), nullable=False
    )
    next_service_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    service_warranty_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    performed_by: Mapped[str] = mapped_column(
        String(120), default="-", server_default=text("'-'"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    asset: Mapped["FixedAsset"] = relationship("FixedAsset", back_populates="maintenances")
    expense: Mapped["Expense | None"] = relationship("Expense", foreign_keys=[expense_id], lazy="selectin")


class AssetLog(Base):
    """Audit trail untuk mutasi aset, analisa ulang threshold, maintenance, dan pelepasan."""

    __tablename__ = "asset_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("fixed_assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    actor: Mapped[str] = mapped_column(
        String(100), default="system", server_default=text("'system'"), nullable=False
    )
    details: Mapped[str] = mapped_column(Text, default="{}", server_default=text("'{}'"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
