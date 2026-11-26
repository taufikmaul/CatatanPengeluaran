"""
app/models/master_item.py — Model Katalog Nama Item Baku (Master Item)
Untuk pencocokan otomatis nama barang dari struk/input agar pembukuan konsisten.
"""
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base


class MasterItem(Base):
    __tablename__ = "master_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="Bahan Kue", index=True)
    default_supplier: Mapped[str | None] = mapped_column(String(255), nullable=True, default="-")
    aliases: Mapped[str | None] = mapped_column(Text, nullable=True, default="")
    # Satuan beli dan konfigurasi paket/ecer
    satuan_beli: Mapped[str] = mapped_column(String(50), default="Pcs", server_default=text("'Pcs'"), nullable=False)
    tipe_satuan: Mapped[str] = mapped_column(String(20), default="keduanya", server_default=text("'keduanya'"), nullable=False)
    isi_paket: Mapped[str | None] = mapped_column(Text, nullable=True, default="", server_default=text("''"))
    satuan_ecer: Mapped[str | None] = mapped_column(String(50), nullable=True, default="Pcs", server_default=text("'Pcs'"))
    # Turunan satuan resep terkecil (contoh: beli 1 Kg -> satuan_resep='Gram', konversi_resep=1000)
    satuan_resep: Mapped[str | None] = mapped_column(String(50), nullable=True)
    konversi_resep: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    packagings: Mapped[list["MasterItemPackaging"]] = relationship(
        "MasterItemPackaging",
        back_populates="master_item",
        cascade="all, delete-orphan",
        order_by="MasterItemPackaging.is_default.desc(), MasterItemPackaging.id.asc()",
        lazy="selectin",
    )


class MasterItemPackaging(Base):
    """Varian kemasan bertingkat per MasterItem (Satuan Beli -> Satuan Ecer -> Satuan Resep/Base)."""

    __tablename__ = "master_item_packagings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    master_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("master_items.id", name="fk_master_item_packagings_master_item_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    purchase_unit: Mapped[str] = mapped_column(String(50), nullable=False)
    retail_qty: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default=text("1.0"))
    retail_unit: Mapped[str] = mapped_column(String(50), nullable=False)
    base_qty: Mapped[float] = mapped_column(Float, nullable=False)
    base_unit: Mapped[str] = mapped_column(String(50), nullable=False)
    keywords: Mapped[str | None] = mapped_column(Text, nullable=True, default="", server_default=text("''"))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    master_item: Mapped["MasterItem"] = relationship("MasterItem", back_populates="packagings")
