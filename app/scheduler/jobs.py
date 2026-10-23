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
# Job 3: Reminder Harian Tagihan Belum Lunas (Hutang)
# ──────────────────────────────────────────────

async def job_send_unpaid_reminder() -> None:
    """
    Kirim pengingat harian untuk tagihan berstatus Belum Lunas / Hutang,
    lengkap dengan tombol inline sekali klik untuk menandai Lunas.
    """
    if not settings.report_chat_id:
        return

    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select, or_
            from app.models.expense import Expense
            from app.bot.telegram_client import send_message
            from app.utils.formatters import fmt_rupiah

            result = await db.execute(
                select(Expense)
                .where(
                    or_(
                        Expense.pay_status.ilike("%belum%"),
                        Expense.pay_status.ilike("%hutang%"),
                        Expense.pay_status.ilike("%tempo%"),
                    )
                )
                .order_by(Expense.expense_date.asc(), Expense.id.asc())
            )
            unpaid_list = result.scalars().all()
            if not unpaid_list:
                return

            today_str = datetime.now().date().isoformat()
            total_hutang = sum(float(e.total_price or 0) for e in unpaid_list)

            msg = (
                f"⏰ *PENGINGAT TAGIHAN BELUM LUNAS*\n"
                f"Total: *{len(unpaid_list)} tagihan ({fmt_rupiah(total_hutang)})*\n\n"
            )

            inline_rows = []
            for idx, e in enumerate(unpaid_list[:8], start=1):
                nominal = fmt_rupiah(float(e.total_price or 0))
                sup = f" ({e.supplier})" if e.supplier and e.supplier != "-" else ""
                tempo_info = ""
                if e.due_date and e.due_date != "-":
                    if e.due_date <= today_str:
                        tempo_info = f" 🚨 *Jatuh Tempo: {e.due_date}*"
                    else:
                        tempo_info = f" _(Tempo: {e.due_date})_"
                msg += f"{idx}. *#{e.id} {e.item_name}*{sup} — {nominal}{tempo_info}\n"
                inline_rows.append([
                    {
                        "text": f"✅ Tandai Lunas #{e.id} ({e.item_name[:18]})",
                        "callback_data": f"mark_paid:{e.id}",
                    }
                ])

            if len(unpaid_list) > 8:
                msg += f"\n_...dan {len(unpaid_list) - 8} tagihan lainnya._\n"

            inline_rows.append([
                {"text": "🌐 Buka Dashboard", "url": settings.public_dashboard_url}
            ])

            await send_message(
                chat_id=int(settings.report_chat_id),
                text=msg,
                thread_id=settings.report_thread_id or None,
                reply_markup={"inline_keyboard": inline_rows},
            )
            print(f"[SCHEDULER] Unpaid reminder sent ({len(unpaid_list)} items)")

    except Exception as e:
        print(f"[SCHEDULER ERROR] job_send_unpaid_reminder: {e}")


# ──────────────────────────────────────────────
# Job 4: Pengingat Mingguan Reimburse per User (Senin jam 09:30 WIB)
# ──────────────────────────────────────────────

async def job_send_weekly_reimburse_reminder() -> None:
    """Kirim pengingat mingguan talangan belum diganti ke masing-masing user via DM dan ringkasan ke admin."""
    try:
        async with AsyncSessionLocal() as db:
            from app.services.expense_service import (
                get_outstanding_reimbursements,
                group_reimbursements_by_user,
            )
            from app.bot.reimburse import build_user_review, build_admin_review
            from app.bot.telegram_client import send_message

            items = await get_outstanding_reimbursements(db)
            if not items:
                return

            groups = await group_reimbursements_by_user(db, items)

            # 1. Kirim review talangan ke masing-masing user via DM pribadi
            for g in groups:
                if g.get("telegram_id"):
                    msg_text, reply_markup = build_user_review(g, is_reminder=True)
                    await send_message(
                        chat_id=int(g["telegram_id"]),
                        text=msg_text,
                        reply_markup=reply_markup,
                    )

            # 2. Kirim ringkasan admin jika ada admin chat ID / report chat ID
            admin_targets: set[int] = set()
            if settings.dashboard_pin_chat_id and settings.dashboard_pin_chat_id.strip().lstrip("-").isdigit():
                admin_targets.add(int(settings.dashboard_pin_chat_id.strip()))
            if settings.admin_telegram_ids:
                for a in settings.admin_telegram_ids.split(","):
                    if a.strip().lstrip("-").isdigit():
                        admin_targets.add(int(a.strip()))

            admin_text, admin_keyboard = build_admin_review(groups)
            for target_id in admin_targets:
                await send_message(
                    chat_id=target_id,
                    text=f"⏰ *PENGINGAT MINGGUAN TALANGAN USER*\n\n" + admin_text,
                    reply_markup=admin_keyboard,
                )

            print(f"[SCHEDULER] Weekly reimburse reminder sent ({len(items)} items, {len(groups)} users)")

    except Exception as e:
        print(f"[SCHEDULER ERROR] job_send_weekly_reimburse_reminder: {e}")


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

    # Job 3: Pengingat harian tagihan belum lunas — setiap hari jam 09:00 WIB
    scheduler.add_job(
        job_send_unpaid_reminder,
        trigger=CronTrigger(
            hour=9,
            minute=0,
            timezone="Asia/Jakarta",
        ),
        id="unpaid_reminder",
        replace_existing=True,
    )

    # Job 4: Pengingat mingguan reimburse ke user & admin — setiap Senin jam 09:30 WIB
    scheduler.add_job(
        job_send_weekly_reimburse_reminder,
        trigger=CronTrigger(
            day_of_week="mon",
            hour=9,
            minute=30,
            timezone="Asia/Jakarta",
        ),
        id="reimburse_reminder",
        replace_existing=True,
    )

    return scheduler
