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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.connection import Base


class MenuProduct(Base):
    """Katalog menu/produk jual, bahan prepared/setengah jadi, & paket bundling beserta HPP/Food Cost."""

    __tablename__ = "menu_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    anonymous_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    sku: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="Lainnya", index=True)
    product_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="Porsi")

    item_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="finished", server_default=text("'finished'"), index=True
    )  # finished | prepared | bundle
    is_sellable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    batch_yield_qty: Mapped[float] = mapped_column(
        Float, nullable=False, default=1.0, server_default=text("1.0")
    )
    batch_yield_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    waste_loss_pct: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default=text("0.0")
    )
    labor_cost: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default=text("0.0")
    )
    target_food_cost_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    shelf_life_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_method: Mapped[str | None] = mapped_column(String(50), nullable=True)

    selling_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hpp_manual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hpp_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="auto")  # auto | manual | recipe
    other_fee: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default=text("0.0"))
    other_fee_description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    batch_cost_items_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    ingredients: Mapped[list["MenuIngredient"]] = relationship(
        "MenuIngredient",
        foreign_keys="[MenuIngredient.menu_id]",
        back_populates="menu",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="MenuIngredient.id",
    )


class MenuIngredient(Base):
    """Komposisi bahan resep (BOM) per menu untuk menghitung HPP/Food Cost & Kemasan otomatis."""

    __tablename__ = "menu_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    menu_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("menu_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    master_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("master_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sub_menu_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("menu_products.id", name="fk_menu_ingredients_sub_menu_id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    cost_group: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ingredient", server_default=text("'ingredient'"), index=True
    )  # ingredient | packaging
    include_sub_packaging: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    waste_pct: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default=text("0.0")
    )
    ingredient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    unit: Mapped[str] = mapped_column(String(50), nullable=False, default="Gram")
    unit_cost_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    yield_factor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    menu: Mapped["MenuProduct"] = relationship(
        "MenuProduct", foreign_keys=[menu_id], back_populates="ingredients"
    )
    sub_menu: Mapped["MenuProduct | None"] = relationship(
        "MenuProduct", foreign_keys=[sub_menu_id], lazy="noload"
    )
    master_item = relationship("MasterItem", lazy="joined")
