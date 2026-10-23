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

    # Hitung bulan sebelumnya untuk perbandingan MoM (Month-over-Month)
    if cur_month == 1:
        prev_month, prev_year = 12, cur_year - 1
    else:
        prev_month, prev_year = cur_month - 1, cur_year

    prev_report = await get_monthly_report(db, prev_year, prev_month)
    prev_total_lunas = float(prev_report.get("total_lunas", 0))
    prev_total_hutang = sum(item.get("nominal", 0) for item in prev_report.get("list_hutang", []))
    prev_total_pengeluaran = prev_total_lunas + prev_total_hutang

    # Total pengeluaran (lunas + belum lunas) bulan ini
    total_hutang = sum(item.get("nominal", 0) for item in report.get("list_hutang", []))
    total_lunas = float(report.get("total_lunas", 0))
    total_pengeluaran = total_lunas + total_hutang

    mom_lunas_change_pct = (
        round(((total_lunas - prev_total_lunas) / prev_total_lunas) * 100.0, 1)
        if prev_total_lunas > 0
        else None
    )
    mom_total_change_pct = (
        round(((total_pengeluaran - prev_total_pengeluaran) / prev_total_pengeluaran) * 100.0, 1)
        if prev_total_pengeluaran > 0
        else None
    )

    cat_budgets = settings.category_budgets
    budget_limit = float(settings.monthly_budget_limit or 0)
    # Jika anggaran total belum diisi manual tapi anggaran per kategori diisi, gunakan total kategori
    if budget_limit <= 0 and cat_budgets:
        budget_limit = float(sum(cat_budgets.values()))

    budget_used_pct = (
        round((total_pengeluaran / budget_limit) * 100.0, 1)
        if budget_limit > 0
        else None
    )

    return MonthlyReportResponse(
        ok=True,
        month=cur_month,
        year=cur_year,
        month_name=MONTH_NAMES[cur_month - 1],
        total_lunas=total_lunas,
        total_pengeluaran=total_pengeluaran,
        expense_count=report.get("expense_count", 0),
        prev_month_name=MONTH_NAMES[prev_month - 1],
        prev_total_lunas=prev_total_lunas,
        prev_total_pengeluaran=prev_total_pengeluaran,
        mom_lunas_change_pct=mom_lunas_change_pct,
        mom_total_change_pct=mom_total_change_pct,
        monthly_budget_limit=budget_limit,
        budget_used_pct=budget_used_pct,
        category_budgets=cat_budgets,
        per_kategori=report.get("per_kategori", {}),
        per_metode_bayar=report.get("per_metode_bayar", {}),
        list_hutang=report.get("list_hutang", []),
        daily_chart=daily_chart,
        valid_categories=settings.valid_categories,
        reimburse_pending_count=int(report.get("reimburse_pending_count", 0)),
        reimburse_pending_total=float(report.get("reimburse_pending_total", 0.0)),
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
