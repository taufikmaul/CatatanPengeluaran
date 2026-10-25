"""
app/api/budgets.py — REST API untuk Manajemen Anggaran Bulanan
Mendukung setup anggaran bulanan per persentase kategori dengan preview nominal Rupiah.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.api.deps import require_auth, require_admin_role
from app.api.schemas import (
    MonthlyBudgetUpsert,
    MonthlyBudgetCopyRequest,
    MonthlyBudgetDetailResponse,
)
from app.services.budget_service import (
    get_effective_budget,
    upsert_monthly_budget,
    copy_budget_from_previous,
)

router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.get("", response_model=MonthlyBudgetDetailResponse, dependencies=[Depends(require_auth)])
async def get_budget_endpoint(
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """
    Ambil konfigurasi anggaran untuk bulan & tahun tertentu.
    Jika belum ada kustomisasi untuk bulan tersebut, sistem akan mengembalikan fallback global.
    """
    now = datetime.now()
    target_year = year or now.year
    target_month = month or now.month

    data = await get_effective_budget(db, target_year, target_month)
    return MonthlyBudgetDetailResponse(
        ok=True,
        year=target_year,
        month=target_month,
        total_budget=data.get("total_budget", 0.0),
        category_percentages=data.get("category_percentages", {}),
        category_amounts=data.get("category_amounts", {}),
        is_custom=data.get("is_custom", False),
        valid_categories=settings.valid_categories,
        message="Berhasil memuat anggaran",
    )


@router.post("", response_model=MonthlyBudgetDetailResponse, dependencies=[Depends(require_admin_role)])
async def save_budget_endpoint(
    payload: MonthlyBudgetUpsert,
    db: AsyncSession = Depends(get_db),
):
    """
    Setup atau update anggaran bulanan:
    - Input anggaran total (Rupiah)
    - Alokasi persentase per kategori (%)
    - Nominal Rupiah per kategori dihitung otomatis oleh server
    """
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Bulan tidak valid (1-12)")
    if payload.year < 2000 or payload.year > 2100:
        raise HTTPException(status_code=400, detail="Tahun tidak valid")
    if payload.total_budget < 0:
        raise HTTPException(status_code=400, detail="Total anggaran tidak boleh negatif")

    record = await upsert_monthly_budget(
        db=db,
        year=payload.year,
        month=payload.month,
        total_budget=payload.total_budget,
        category_percentages=payload.category_percentages,
    )

    data = await get_effective_budget(db, payload.year, payload.month)
    return MonthlyBudgetDetailResponse(
        ok=True,
        year=record.year,
        month=record.month,
        total_budget=float(record.total_budget),
        category_percentages=record.category_percentages,
        category_amounts=record.category_amounts,
        is_custom=True,
        valid_categories=settings.valid_categories,
        message=f"Anggaran bulan {payload.month}/{payload.year} berhasil disimpan!",
    )


@router.post("/copy", response_model=MonthlyBudgetDetailResponse, dependencies=[Depends(require_admin_role)])
async def copy_budget_endpoint(
    payload: MonthlyBudgetCopyRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Salin anggaran dari bulan sebelumnya (atau bulan acuan yang diminta) ke bulan target.
    """
    record = await copy_budget_from_previous(
        db=db,
        target_year=payload.target_year,
        target_month=payload.target_month,
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tidak ditemukan data anggaran acuan untuk disalin.",
        )

    return MonthlyBudgetDetailResponse(
        ok=True,
        year=record.year,
        month=record.month,
        total_budget=float(record.total_budget),
        category_percentages=record.category_percentages,
        category_amounts=record.category_amounts,
        is_custom=True,
        valid_categories=settings.valid_categories,
        message=f"Berhasil menyalin anggaran ke bulan {payload.target_month}/{payload.target_year}!",
    )
