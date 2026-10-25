"""
app/models/budget.py — Model Anggaran Bulanan (Monthly Budget)
Memungkinkan setup anggaran keseluruhan dan alokasi persentase per kategori per bulan (bisa beda tiap bulan).
"""
import json
from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, Integer, Numeric, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column
from app.database.connection import Base


class MonthlyBudget(Base):
    __tablename__ = "monthly_budgets"
    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_monthly_budgets_year_month"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    # Plafon anggaran keseluruhan (Rp)
    total_budget: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), default=0, server_default=text("0"), nullable=False
    )

    # JSON string persentase: {"Bahan Kue": 40.0, "Operasional": 25.0, ...}
    category_percentages_json: Mapped[str] = mapped_column(
        Text, default="{}", server_default=text("'{}'"), nullable=False
    )

    # JSON string nominal Rp terhitung: {"Bahan Kue": 8000000, "Operasional": 5000000, ...}
    category_amounts_json: Mapped[str] = mapped_column(
        Text, default="{}", server_default=text("'{}'"), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    @property
    def category_percentages(self) -> dict[str, float]:
        try:
            raw = json.loads(self.category_percentages_json or "{}")
            if isinstance(raw, dict):
                return {
                    str(k): float(v)
                    for k, v in raw.items()
                    if v is not None and float(v) >= 0
                }
        except Exception:
            pass
        return {}

    @property
    def category_amounts(self) -> dict[str, float]:
        try:
            raw = json.loads(self.category_amounts_json or "{}")
            if isinstance(raw, dict):
                return {
                    str(k): float(v)
                    for k, v in raw.items()
                    if v is not None and float(v) >= 0
                }
        except Exception:
            pass
        return {}
