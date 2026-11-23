"""
app/services/budget_service.py — Layanan Manajemen Anggaran Bulanan (Monthly Budget)
Mendukung setup anggaran per bulan dengan alokasi persentase per kategori dan preview nominal rupiah.
"""
import json
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.budget import MonthlyBudget


async def get_monthly_budget_record(
    db: AsyncSession, year: int, month: int
) -> MonthlyBudget | None:
    """Ambil data catatan MonthlyBudget untuk tahun & bulan tertentu."""
    stmt = select(MonthlyBudget).where(
        MonthlyBudget.year == year,
        MonthlyBudget.month == month,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_previous_month_cash_balance(
    db: AsyncSession, year: int, month: int
) -> tuple[int, int, float]:
    """Hitung tahun, bulan, dan saldo kas akhir periode bulan sebelumnya."""
    if month == 1:
        prev_year = year - 1
        prev_month = 12
    else:
        prev_year = year
        prev_month = month - 1

    try:
        from app.services.cashflow_service import get_daily_cashflow

        prev_cf = await get_daily_cashflow(db, year=prev_year, month=prev_month)
        ending_balance = round(float(prev_cf.get("saldo_akhir", 0.0)), 2)
    except Exception:
        ending_balance = 0.0

    return prev_year, prev_month, ending_balance


async def get_effective_budget(
    db: AsyncSession, year: int, month: int
) -> dict:
    """
    Ambil anggaran efektif untuk bulan dan tahun yang diminta.
    Jika bulan tersebut sudah disetup khusus di tabel `monthly_budgets`, gunakan data tersebut.
    Jika belum, fallback ke konfigurasi global di `settings`.
    Juga menghitung estimasi kas akhir bulan sebelumnya sebagai referensi setup kas awal.
    """
    prev_year, prev_month, prev_balance = await get_previous_month_cash_balance(db, year, month)
    record = await get_monthly_budget_record(db, year, month)
    if record is not None:
        tot = float(record.total_budget or 0)
        pcts = record.category_percentages
        amts = record.category_amounts

        # Jika nominal belum tersinkronisasi dengan persentase & total
        if tot > 0 and pcts and not amts:
            amts = {
                k: round(tot * (float(v) / 100.0), 2)
                for k, v in pcts.items()
                if float(v) > 0
            }
        elif tot <= 0 and amts:
            tot = float(sum(amts.values()))

        # Hitung persentase jika hanya nominal yang ada
        if tot > 0 and amts and not pcts:
            pcts = {
                k: round((float(v) / tot) * 100.0, 1)
                for k, v in amts.items()
                if float(v) > 0
            }

        return {
            "year": year,
            "month": month,
            "total_budget": tot,
            "category_percentages": pcts,
            "category_amounts": amts,
            "is_custom": True,
            "previous_month_ending_balance": prev_balance,
            "previous_month_year": prev_year,
            "previous_month": prev_month,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }

    # Fallback ke konfigurasi global (settings)
    global_tot = float(settings.monthly_budget_limit or 0)
    global_cat_budgets = settings.category_budgets

    if global_tot <= 0 and global_cat_budgets:
        global_tot = float(sum(global_cat_budgets.values()))

    # Hitung estimasi persentase global
    global_pcts: dict[str, float] = {}
    if global_tot > 0 and global_cat_budgets:
        for cat, amt in global_cat_budgets.items():
            if amt > 0:
                global_pcts[cat] = round((amt / global_tot) * 100.0, 1)

    return {
        "year": year,
        "month": month,
        "total_budget": global_tot,
        "category_percentages": global_pcts,
        "category_amounts": global_cat_budgets,
        "is_custom": False,
        "previous_month_ending_balance": prev_balance,
        "previous_month_year": prev_year,
        "previous_month": prev_month,
        "updated_at": None,
    }


async def upsert_monthly_budget(
    db: AsyncSession,
    year: int,
    month: int,
    total_budget: float,
    category_percentages: dict[str, float],
) -> MonthlyBudget:
    """
    Simpan atau perbarui anggaran bulanan.
    Nominal Rupiah per kategori dihitung otomatis: (persentase / 100) * total_budget.
    """
    total_budget = max(0.0, float(total_budget))
    clean_pcts: dict[str, float] = {}
    clean_amts: dict[str, float] = {}

    for k, v in category_percentages.items():
        cat_name = str(k).strip()
        pct_val = max(0.0, float(v or 0))
        if pct_val > 0:
            clean_pcts[cat_name] = round(pct_val, 2)
            # Hitung nominal rupiah
            clean_amts[cat_name] = round(total_budget * (pct_val / 100.0), 2)

    record = await get_monthly_budget_record(db, year, month)
    pcts_json = json.dumps(clean_pcts, ensure_ascii=False)
    amts_json = json.dumps(clean_amts, ensure_ascii=False)

    if record is not None:
        record.total_budget = total_budget  # type: ignore
        record.category_percentages_json = pcts_json
        record.category_amounts_json = amts_json
        record.updated_at = datetime.utcnow()
    else:
        record = MonthlyBudget(
            year=year,
            month=month,
            total_budget=total_budget,  # type: ignore
            category_percentages_json=pcts_json,
            category_amounts_json=amts_json,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    return record


async def copy_budget_from_previous(
    db: AsyncSession,
    target_year: int,
    target_month: int,
    use_previous_cash_balance: bool = False,
) -> MonthlyBudget | None:
    """
    Salin anggaran dari bulan sebelumnya (atau bulan terakhir yang ada catatannya).
    Jika use_previous_cash_balance bernilai True, total_budget akan menggunakan saldo kas akhir
    riil dari bulan sebelumnya (dari laporan arus kas harian), dengan persentase alokasi kategori
    mengikuti bulan acuan.
    """
    if target_month == 1:
        prev_year = target_year - 1
        prev_month = 12
    else:
        prev_year = target_year
        prev_month = target_month - 1

    source_record = await get_monthly_budget_record(db, prev_year, prev_month)
    if source_record is None:
        # Cari catatan anggaran terakhir yang tersedia sebelum bulan target
        stmt = (
            select(MonthlyBudget)
            .where(
                (MonthlyBudget.year < target_year)
                | (
                    (MonthlyBudget.year == target_year)
                    & (MonthlyBudget.month < target_month)
                )
            )
            .order_by(MonthlyBudget.year.desc(), MonthlyBudget.month.desc())
            .limit(1)
        )
        res = await db.execute(stmt)
        source_record = res.scalar_one_or_none()

    # Tentukan total budget yang akan dipakai
    if use_previous_cash_balance:
        _, _, ending_cash = await get_previous_month_cash_balance(db, target_year, target_month)
        chosen_total = max(0.0, float(ending_cash))
    elif source_record is not None:
        chosen_total = float(source_record.total_budget)
    else:
        chosen_total = 0.0

    if source_record is None:
        # Jika sama sekali tidak ada di DB, gunakan konfigurasi global jika ada
        global_budget = await get_effective_budget(db, prev_year, prev_month)
        source_pcts = global_budget.get("category_percentages", {})
        if not use_previous_cash_balance:
            chosen_total = float(global_budget.get("total_budget", 0))

        if chosen_total > 0 or source_pcts:
            return await upsert_monthly_budget(
                db=db,
                year=target_year,
                month=target_month,
                total_budget=chosen_total,
                category_percentages=source_pcts,
            )
        return None

    return await upsert_monthly_budget(
        db=db,
        year=target_year,
        month=target_month,
        total_budget=chosen_total,
        category_percentages=source_record.category_percentages,
    )
