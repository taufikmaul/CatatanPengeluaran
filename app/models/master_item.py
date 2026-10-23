"""
app/models/master_item.py — Model Katalog Nama Item Baku (Master Item)
Untuk pencocokan otomatis nama barang dari struk/input agar pembukuan konsisten.
"""
from datetime import datetime
from sqlalchemy import DateTime, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column
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
    isi_paket: Mapped[str | None] = mapped_column(String(255), nullable=True, default="", server_default=text("''"))
    satuan_ecer: Mapped[str | None] = mapped_column(String(50), nullable=True, default="Pcs", server_default=text("'Pcs'"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
