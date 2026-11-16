"""
app/models/menu_product.py — Database Menu / Produk beserta HPP / Food Cost & Nama Anonim.
Mendukung HPP manual maupun perhitungan otomatis dari resep bahan (terhubung ke MasterItem).
"""
from datetime import datetime
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base


class MenuProduct(Base):
    """Katalog menu/produk jual beserta harga jual, HPP/Food Cost, dan kode nama anonim."""

    __tablename__ = "menu_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    anonymous_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    sku: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="Lainnya", index=True)
    product_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="Porsi")

    selling_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hpp_manual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hpp_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="auto")  # auto | manual | recipe

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    ingredients: Mapped[list["MenuIngredient"]] = relationship(
        "MenuIngredient",
        back_populates="menu",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="MenuIngredient.id",
    )


class MenuIngredient(Base):
    """Komposisi bahan resep (BOM) per menu untuk menghitung HPP/Food Cost otomatis."""

    __tablename__ = "menu_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    menu_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("menu_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    master_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("master_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ingredient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="Gram")
    unit_cost_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    yield_factor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    menu: Mapped["MenuProduct"] = relationship("MenuProduct", back_populates="ingredients")
    master_item = relationship("MasterItem", lazy="joined")
