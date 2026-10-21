"""
app/dashboard/routes.py — Web dashboard routes
Overview pengeluaran dengan chart dan tabel filter
"""
from datetime import datetime
from fastapi import APIRouter, Depends, Request, Query
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.services.expense_service import get_all_expenses_paginated, get_monthly_report
from app.utils.formatters import fmt_rupiah, fmt_date_id
from app.config import settings
import os

router = APIRouter()
templates = Jinja2Templates(
    directory=os.path.join(os.path.dirname(__file__), "templates")
)


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_index(
    request: Request,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    category: str = Query(None),
    month: int = Query(None),
    year: int = Query(None),
):
    now = datetime.now()
    current_month = month or now.month
    current_year = year or now.year

    # Data rekap bulan ini
    report = await get_monthly_report(db, current_year, current_month)

    # List expenses dengan filter + pagination
    expenses, total_count = await get_all_expenses_paginated(
        db,
        page=page,
        per_page=30,
        category=category,
        month=current_month,
        year=current_year,
    )

    # Data untuk chart: per kategori
    chart_labels = list(report["per_kategori"].keys())
    chart_values = [round(v) for v in report["per_kategori"].values()]

    MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
              "Juli","Agustus","September","Oktober","November","Desember"]

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "expenses": expenses,
            "report": report,
            "total_count": total_count,
            "page": page,
            "per_page": 30,
            "total_pages": (total_count + 29) // 30,
            "current_month": current_month,
            "current_year": current_year,
            "month_name": MONTHS[current_month - 1],
            "selected_category": category,
            "valid_categories": settings.valid_categories,
            "chart_labels": chart_labels,
            "chart_values": chart_values,
            "fmt_rupiah": fmt_rupiah,
            "fmt_date_id": fmt_date_id,
        },
    )
