"""
app/api/reports.py — REST API for Analytics & Reports
"""
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.api.deps import require_auth
from app.api.schemas import MonthlyReportResponse
from app.services.expense_service import (
    get_monthly_report,
    get_monthly_chart_data,
    get_monthly_leaderboards,
)

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_auth)])

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


@router.get("/monthly", response_model=MonthlyReportResponse)
async def get_monthly_analytics(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now()
    cur_month = month or now.month
    cur_year = year or now.year

    report = await get_monthly_report(db, cur_year, cur_month)
    daily_chart = await get_monthly_chart_data(db, cur_year, cur_month)
    leaderboards = await get_monthly_leaderboards(db, cur_year, cur_month)

    # Total pengeluaran (lunas + belum lunas)
    total_hutang = sum(item.get("nominal", 0) for item in report.get("list_hutang", []))
    total_lunas = float(report.get("total_lunas", 0))

    return MonthlyReportResponse(
        ok=True,
        month=cur_month,
        year=cur_year,
        month_name=MONTH_NAMES[cur_month - 1],
        total_lunas=total_lunas,
        total_pengeluaran=total_lunas + total_hutang,
        expense_count=report.get("expense_count", 0),
        per_kategori=report.get("per_kategori", {}),
        per_metode_bayar=report.get("per_metode_bayar", {}),
        list_hutang=report.get("list_hutang", []),
        daily_chart=daily_chart,
        valid_categories=settings.valid_categories,
        top_frequent_items=leaderboards.get("top_frequent_items", []),
        top_expensive_items=leaderboards.get("top_expensive_items", []),
        top_unit_price_items=leaderboards.get("top_unit_price_items", []),
        top_price_spikes=leaderboards.get("top_price_spikes", []),
        top_suppliers=leaderboards.get("top_suppliers", []),
        summary_metrics=leaderboards.get("summary_metrics", {}),
    )


@router.get("/leaderboard")
async def get_leaderboard_endpoint(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
):
    """Endpoint khusus untuk leaderboard & top analytics."""
    now = datetime.now()
    cur_month = month or now.month
    cur_year = year or now.year
    leaderboards = await get_monthly_leaderboards(db, cur_year, cur_month)
    return {
        "ok": True,
        "month": cur_month,
        "year": cur_year,
        "month_name": MONTH_NAMES[cur_month - 1],
        **leaderboards,
    }
