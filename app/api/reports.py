"""
app/api/reports.py — REST API for Analytics & Reports
"""
from datetime import datetime, date
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.api.deps import require_admin_role, require_roles
from app.api.schemas import (
    MonthlyReportResponse,
    AiAnalysisResponse,
    AccountingReportResponse,
    DailyCashflowResponse,
    MaterialsReportResponse,
    ShippingReportResponse,
    SalesReportResponse,
    HppReportResponse,
)
from app.services.cashflow_service import get_daily_cashflow, export_cashflow_to_csv
from app.services.general_reports_service import (
    get_materials_report,
    export_materials_csv,
    get_shipping_report,
    export_shipping_csv,
    get_sales_report,
    export_sales_csv,
    get_hpp_report,
    export_hpp_csv,
)
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

router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    dependencies=[Depends(require_roles("admin", "admin_input", "purchasing"))],
)

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


@router.get("/monthly", response_model=MonthlyReportResponse)
async def get_monthly_analytics(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now()
    cur_month = month or now.month
    cur_month_end = month_end or cur_month
    cur_year = year or now.year

    report = await get_monthly_report(db, cur_year, cur_month, month_end=cur_month_end)
    daily_chart = await get_monthly_chart_data(db, cur_year, cur_month, month_end=cur_month_end)
    leaderboards = await get_monthly_leaderboards(db, cur_year, cur_month, month_end=cur_month_end)

    # Hitung periode sebelumnya untuk perbandingan MoM / YoY
    if cur_month_end == cur_month:
        if cur_month == 1:
            prev_month, prev_year = 12, cur_year - 1
        else:
            prev_month, prev_year = cur_month - 1, cur_year
        prev_report = await get_monthly_report(db, prev_year, prev_month)
        prev_label = MONTH_NAMES[prev_month - 1]
    else:
        # Multi-month: bandingkan dengan rentang yang sama di tahun lalu
        prev_year = cur_year - 1
        prev_month = cur_month
        prev_report = await get_monthly_report(db, prev_year, cur_month, month_end=cur_month_end)
        prev_label = f"{MONTH_NAMES[cur_month - 1][:3]}-{MONTH_NAMES[cur_month_end - 1][:3]} {prev_year}"

    prev_total_lunas = float(prev_report.get("total_lunas", 0))
    prev_total_hutang = sum(item.get("nominal", 0) for item in prev_report.get("list_hutang", []))
    prev_total_pengeluaran = prev_total_lunas + prev_total_hutang

    # Total pengeluaran (lunas + belum lunas) periode ini
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

    if cur_month_end and cur_month_end > cur_month:
        total_b = 0.0
        cat_b: dict[str, float] = {}
        for m in range(cur_month, cur_month_end + 1):
            eff = await get_effective_budget(db, cur_year, m)
            total_b += float(eff.get("total_budget", 0))
            for c, amt in eff.get("category_amounts", {}).items():
                cat_b[c] = cat_b.get(c, 0.0) + float(amt)
        budget_limit = total_b
        cat_budgets = cat_b
        cat_percentages = {}
        is_custom_budget = False
    else:
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

    cur_period_name = (
        f"{MONTH_NAMES[cur_month - 1]} - {MONTH_NAMES[cur_month_end - 1]}"
        if cur_month_end != cur_month
        else MONTH_NAMES[cur_month - 1]
    )

    return MonthlyReportResponse(
        ok=True,
        month=cur_month,
        month_end=cur_month_end,
        year=cur_year,
        month_name=cur_period_name,
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
        prev_month_name=prev_label,
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


@router.get("/ai-analysis", response_model=AiAnalysisResponse, dependencies=[Depends(require_admin_role)])
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


@router.get("/accounting", response_model=AccountingReportResponse, dependencies=[Depends(require_admin_role)])
async def get_accounting_analytics(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
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
    cur_month_end = month_end or cur_month
    cur_year = year or now.year

    return await get_accounting_report(db, cur_year, cur_month, month_end=cur_month_end)


@router.get("/cashflow", response_model=DailyCashflowResponse)
async def get_daily_cashflow_endpoint(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    bank_account_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Endpoint rekapitulasi arus kas harian (Daily Cashflow):
    - Saldo awal
    - Kas Masuk (Cash In) harian
    - Kas Keluar (Cash Out) harian
    - Arus kas bersih (Net Flow)
    - Saldo kumulatif (Running Balance)
    """
    data = await get_daily_cashflow(
        db,
        year=year,
        month=month,
        month_end=month_end,
        start_date=start_date,
        end_date=end_date,
        bank_account_id=bank_account_id,
    )
    return DailyCashflowResponse(**data)


@router.get("/cashflow/export")
async def export_daily_cashflow_csv_endpoint(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    bank_account_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Export laporan arus kas harian ke format CSV dengan kolom:
    Tanggal, Kas Masuk (Cash In), Kas Keluar (Cash Out), Arus Kas Bersih (Net), Saldo (Balance), Jml Tx Masuk, Jml Tx Keluar
    """
    data = await get_daily_cashflow(
        db,
        year=year,
        month=month,
        month_end=month_end,
        start_date=start_date,
        end_date=end_date,
        bank_account_id=bank_account_id,
    )
    csv_text = export_cashflow_to_csv(data)

    if start_date and end_date:
        filename = f"cashflow_harian_{start_date.isoformat()}_{end_date.isoformat()}.csv"
    elif year and month:
        filename = f"cashflow_harian_{year}_{month:02d}.csv"
    else:
        now = datetime.now()
        filename = f"cashflow_harian_{now.year}_{now.month:02d}.csv"

    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_general_export_filename(
    prefix: str,
    year: int | None,
    month: int | None,
    start_date: date | None,
    end_date: date | None,
) -> str:
    if start_date and end_date:
        return f"{prefix}_{start_date.isoformat()}_{end_date.isoformat()}.csv"
    if year and month:
        return f"{prefix}_{year}_{month:02d}.csv"
    now = datetime.now()
    return f"{prefix}_{now.year}_{now.month:02d}.csv"


@router.get("/general/materials", response_model=MaterialsReportResponse)
async def get_general_materials_report(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Laporan Umum: Bahan Baku, Kemasan & Pergerakan Harga."""
    data = await get_materials_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    return MaterialsReportResponse(**data)


@router.get("/general/materials/export")
async def export_general_materials_csv(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    data = await get_materials_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    csv_text = export_materials_csv(data)
    filename = _build_general_export_filename("laporan_bahan", year, month, start_date, end_date)
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/general/shipping", response_model=ShippingReportResponse)
async def get_general_shipping_report(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Laporan Umum: Ongkir Mandiri & Freight-In Pembelian."""
    data = await get_shipping_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    return ShippingReportResponse(**data)


@router.get("/general/shipping/export")
async def export_general_shipping_csv(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    data = await get_shipping_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    csv_text = export_shipping_csv(data)
    filename = _build_general_export_filename("laporan_ongkir", year, month, start_date, end_date)
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/general/sales", response_model=SalesReportResponse, dependencies=[Depends(require_admin_role)])
async def get_general_sales_report(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Laporan Umum: Omset 3 Lapis & Performa Channel Penjualan."""
    data = await get_sales_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    return SalesReportResponse(**data)


@router.get("/general/sales/export", dependencies=[Depends(require_admin_role)])
async def export_general_sales_csv(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    data = await get_sales_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    csv_text = export_sales_csv(data)
    filename = _build_general_export_filename("laporan_omset", year, month, start_date, end_date)
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/general/hpp", response_model=HppReportResponse, dependencies=[Depends(require_admin_role)])
async def get_general_hpp_report(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Laporan Umum: HPP Pembelian vs Teoritis & Matriks Menu Engineering."""
    data = await get_hpp_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    return HppReportResponse(**data)


@router.get("/general/hpp/export", dependencies=[Depends(require_admin_role)])
async def export_general_hpp_csv(
    month: int | None = Query(None, ge=1, le=12),
    month_end: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2000, le=2100),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    data = await get_hpp_report(
        db, year=year, month=month, month_end=month_end, start_date=start_date, end_date=end_date
    )
    csv_text = export_hpp_csv(data)
    filename = _build_general_export_filename("laporan_hpp", year, month, start_date, end_date)
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

