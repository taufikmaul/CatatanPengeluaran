"""
app/scheduler/jobs.py — Background jobs dengan APScheduler
1. Auto-report mingguan (Senin pagi)
2. Google Sheets sync (setiap 5 menit)
"""
import asyncio
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app.config import settings
from app.database.connection import AsyncSessionLocal


scheduler = AsyncIOScheduler(timezone="Asia/Jakarta")


# ──────────────────────────────────────────────
# Job 1: Auto-Report Mingguan
# ──────────────────────────────────────────────

async def job_send_weekly_report() -> None:
    """
    Kirim laporan otomatis setiap Senin pagi ke chat yang dikonfigurasi.
    Port dari konsep schedule di GAS (tapi GAS tidak bisa melakukan ini native).
    """
    if not settings.report_chat_id:
        return

    try:
        async with AsyncSessionLocal() as db:
            from app.services.expense_service import get_monthly_report
            from app.bot.telegram_client import send_message
            from app.utils.formatters import fmt_rupiah

            now = datetime.now()
            report = await get_monthly_report(db, now.year, now.month)

            MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
                      "Juli","Agustus","September","Oktober","November","Desember"]
            bulan = MONTHS[report["month"] - 1]

            msg = (
                f"📅 *LAPORAN OTOMATIS — {bulan.upper()} {report['year']}*\n"
                f"_(Dikirim setiap Senin pagi)_\n\n"
                f"💰 *Total Lunas: {fmt_rupiah(report['total_lunas'])}*\n\n"
                f"📂 *Breakdown Kategori:*\n"
            )
            for kat, total in sorted(report["per_kategori"].items(), key=lambda x: -x[1]):
                msg += f"▪️ {kat}: {fmt_rupiah(total)}\n"

            if report["list_hutang"]:
                msg += f"\n⚠️ *{len(report['list_hutang'])} Tagihan Belum Lunas*\n"
                for h in report["list_hutang"][:5]:
                    msg += f"• {h['barang']} — {fmt_rupiah(h['nominal'])}\n"

            await send_message(
                chat_id=int(settings.report_chat_id),
                text=msg,
                thread_id=settings.report_thread_id or None,
            )
            print(f"[SCHEDULER] Weekly report sent at {now}")

    except Exception as e:
        print(f"[SCHEDULER ERROR] job_send_weekly_report: {e}")


# ──────────────────────────────────────────────
# Job 2: Google Sheets Sync
# ──────────────────────────────────────────────

async def job_sync_sheets() -> None:
    """Sync data baru ke Google Sheets setiap 5 menit."""
    if not settings.spreadsheet_id:
        return

    try:
        async with AsyncSessionLocal() as db:
            from app.services.sheets_service import sync_to_sheets
            count = await sync_to_sheets(db)
            if count > 0:
                print(f"[SCHEDULER] Synced {count} rows to Google Sheets")
    except Exception as e:
        print(f"[SCHEDULER ERROR] job_sync_sheets: {e}")


# ──────────────────────────────────────────────
# Setup & Start Scheduler
# ──────────────────────────────────────────────

def setup_scheduler() -> AsyncIOScheduler:
    """Daftarkan semua jobs ke scheduler."""

    # Parse jam auto-report dari config (format "HH:MM")
    try:
        report_hour, report_minute = settings.auto_report_time.split(":")
    except ValueError:
        report_hour, report_minute = "8", "0"

    # Job 1: Laporan otomatis — setiap Senin jam AUTO_REPORT_TIME WIB
    scheduler.add_job(
        job_send_weekly_report,
        trigger=CronTrigger(
            day_of_week="mon",
            hour=int(report_hour),
            minute=int(report_minute),
            timezone="Asia/Jakarta",
        ),
        id="weekly_report",
        replace_existing=True,
    )

    # Job 2: Sync ke Sheets — setiap 5 menit
    scheduler.add_job(
        job_sync_sheets,
        trigger=CronTrigger(minute="*/5"),
        id="sheets_sync",
        replace_existing=True,
    )

    return scheduler
