"""
app/api/reports.py — REST API for Analytics & Reports
"""
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.api.deps import require_auth
from app.api.schemas import MonthlyReportResponse, AiAnalysisResponse, AccountingReportResponse
from app.services.expense_service import (
    get_monthly_report,
    get_monthly_chart_data,
    get_monthly_leaderboards,
    get_price_inflation_summary,
)
from app.services.ai_analysis_service import generate_ai_analysis
from app.services.accounting_service import get_accounting_report
from app.services.budget_service import get_effective_budget
from app.services.master_data_service import get_valid_units

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

    eff_budget = await get_effective_budget(db, cur_year, cur_month)
    budget_limit = float(eff_budget.get("total_budget", 0))
    cat_budgets = eff_budget.get("category_amounts", {})
    cat_percentages = eff_budget.get("category_percentages", {})
    is_custom_budget = eff_budget.get("is_custom", False)

    budget_used_pct = (
        round((total_pengeluaran / budget_limit) * 100.0, 1)
        if budget_limit > 0
        else None
    )

    # Perhitungan MoM & Indikator Inflasi Klasifikasi Akuntansi (SAK EMKM)
    cur_per_account = report.get("per_account_group", {})
    prev_per_account = prev_report.get("per_account_group", {})

    prev_hpp = float(prev_per_account.get("HPP", 0.0))
    cur_hpp = float(cur_per_account.get("HPP", 0.0))
    mom_hpp_change_pct = (
        round(((cur_hpp - prev_hpp) / prev_hpp) * 100.0, 1)
        if prev_hpp > 0
        else None
    )

    prev_opex = float(prev_per_account.get("OPEX", 0.0))
    cur_opex = float(cur_per_account.get("OPEX", 0.0))
    mom_opex_change_pct = (
        round(((cur_opex - prev_opex) / prev_opex) * 100.0, 1)
        if prev_opex > 0
        else None
    )

    prev_asset = float(prev_per_account.get("ASSET", 0.0))
    cur_asset = float(cur_per_account.get("ASSET", 0.0))
    mom_asset_change_pct = (
        round(((cur_asset - prev_asset) / prev_asset) * 100.0, 1)
        if prev_asset > 0
        else None
    )

    prev_laba_rugi = prev_hpp + prev_opex
    cur_laba_rugi = cur_hpp + cur_opex
    mom_laba_rugi_change_pct = (
        round(((cur_laba_rugi - prev_laba_rugi) / prev_laba_rugi) * 100.0, 1)
        if prev_laba_rugi > 0
        else None
    )

    prev_per_account_group = {
        "HPP": prev_hpp,
        "OPEX": prev_opex,
        "ASSET": prev_asset,
        "CASH_TRANSFER": float(prev_per_account.get("CASH_TRANSFER", 0.0)),
    }

    mom_account_group_change_pct = {
        "HPP": mom_hpp_change_pct,
        "OPEX": mom_opex_change_pct,
        "ASSET": mom_asset_change_pct,
        "LABA_RUGI": mom_laba_rugi_change_pct,
    }

    # Analisis inflasi harga satuan item barang bulan ini vs bulan lalu
    price_inflation_summary = await get_price_inflation_summary(
        db, cur_year, cur_month, prev_year, prev_month
    )

    accounting_inflation = {
        "laba_rugi_inflation_pct": mom_laba_rugi_change_pct,
        "hpp_inflation_pct": mom_hpp_change_pct,
        "opex_inflation_pct": mom_opex_change_pct,
        "asset_change_pct": mom_asset_change_pct,
        "prev_laba_rugi_total": prev_laba_rugi,
        "prev_hpp_total": prev_hpp,
        "prev_opex_total": prev_opex,
        "prev_asset_total": prev_asset,
        "price_inflation_pct": price_inflation_summary.get("price_inflation_pct"),
        "items_compared_count": price_inflation_summary.get("items_compared_count", 0),
        "items_inflated_count": price_inflation_summary.get("items_inflated_count", 0),
        "items_deflated_count": price_inflation_summary.get("items_deflated_count", 0),
        "items_stable_count": price_inflation_summary.get("items_stable_count", 0),
        "top_inflated_items": price_inflation_summary.get("top_inflated_items", []),
    }

    # Perkaya accounting_breakdown dengan nominal bulan lalu & persentase perubahan MoM
    cur_breakdown = report.get("accounting_breakdown", [])
    prev_kategori = prev_report.get("per_kategori", {})
    prev_ongkir = float(prev_report.get("total_ongkir", 0.0))
    prev_tukar = float(prev_report.get("total_tukar_cash", 0.0))

    enriched_breakdown = []
    for item in cur_breakdown:
        cat = item.get("category", "")
        if cat == "Ongkir":
            prev_val = prev_ongkir
        elif cat == "Tukar Cash":
            prev_val = prev_tukar
        else:
            prev_val = float(prev_kategori.get(cat, 0.0))

        cur_val = float(item.get("total", 0.0))
        item_mom_pct = (
            round(((cur_val - prev_val) / prev_val) * 100.0, 1)
            if prev_val > 0
            else None
        )
        item_copy = dict(item)
        item_copy["prev_total"] = prev_val
        item_copy["mom_change_pct"] = item_mom_pct
        enriched_breakdown.append(item_copy)

    return MonthlyReportResponse(
        ok=True,
        month=cur_month,
        year=cur_year,
        month_name=MONTH_NAMES[cur_month - 1],
        total_lunas=total_lunas,
        total_pengeluaran=total_pengeluaran,
        total_tukar_cash=float(report.get("total_tukar_cash", 0.0)),
        tukar_cash_count=int(report.get("tukar_cash_count", 0)),
        total_ongkir=float(report.get("total_ongkir", 0.0)),
        ongkir_count=int(report.get("ongkir_count", 0)),
        ongkir_reimburse_count=int(report.get("ongkir_reimburse_count", 0)),
        ongkir_reimburse_total=float(report.get("ongkir_reimburse_total", 0.0)),
        total_belanja_riil=float(report.get("total_belanja_riil", 0.0)),
        expense_count=report.get("expense_count", 0),
        prev_month_name=MONTH_NAMES[prev_month - 1],
        prev_total_lunas=prev_total_lunas,
        prev_total_pengeluaran=prev_total_pengeluaran,
        mom_lunas_change_pct=mom_lunas_change_pct,
        mom_total_change_pct=mom_total_change_pct,
        monthly_budget_limit=budget_limit,
        budget_used_pct=budget_used_pct,
        category_budgets=cat_budgets,
        category_budget_percentages=cat_percentages,
        is_custom_budget=is_custom_budget,
        per_kategori=report.get("per_kategori", {}),
        per_metode_bayar=report.get("per_metode_bayar", {}),
        per_account_group=report.get("per_account_group", {}),
        prev_per_account_group=prev_per_account_group,
        mom_account_group_change_pct=mom_account_group_change_pct,
        accounting_inflation=accounting_inflation,
        accounting_breakdown=enriched_breakdown,
        list_hutang=report.get("list_hutang", []),
        daily_chart=daily_chart,
        valid_categories=settings.valid_categories,
        valid_units=await get_valid_units(db),
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


@router.get("/ai-analysis", response_model=AiAnalysisResponse)
async def get_ai_analysis_endpoint(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    force_refresh: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Endpoint untuk analisis keuangan cerdas berbasis AI."""
    now = datetime.now()
    cur_month = month or now.month
    cur_year = year or now.year

    analysis = await generate_ai_analysis(db, cur_year, cur_month, force_refresh=force_refresh)
    return AiAnalysisResponse(**analysis)


@router.get("/accounting", response_model=AccountingReportResponse)
async def get_accounting_analytics(
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
):
    """
    Endpoint laporan & analisis akuntansi lengkap standar SAK EMKM:
    - Laba Rugi (HPP & OPEX)
    - Posisi Keuangan (Neraca Belanja & Aset)
    - Arus Kas (Operasi, Investasi, Kliring)
    - Analisis Rasio & Evaluasi Kesehatan Finansial
    - Bagan Akun (Chart of Accounts)
    """
    now = datetime.now()
    cur_month = month or now.month
    cur_year = year or now.year

    return await get_accounting_report(db, cur_year, cur_month)
