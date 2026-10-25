"""
app/services/alert_service.py — Service notifikasi Telegram untuk Audit Alert
Mengirim notifikasi ketika data pengeluaran bernilai besar diubah atau dihapus.
"""
import logging
from app.config import settings
from app.bot import telegram_client as tg
from app.utils.formatters import fmt_rupiah

logger = logging.getLogger(__name__)


async def notify_high_value_expense_action(
    action: str,
    item_name: str,
    total_price: float,
    actor: str,
    date_str: str | None = None,
    supplier: str | None = None,
    changes_diff: str | None = None,
) -> None:
    """Kirim notifikasi Telegram jika pengeluaran bernilai >= high_value_alert_threshold

    diubah atau dihapus.
    """
    threshold = float(getattr(settings, "high_value_alert_threshold", 500000.0) or 500000.0)
    if float(total_price or 0) < threshold:
        return

    target_chat = settings.report_chat_id or settings.dashboard_pin_chat_id
    if not target_chat:
        return

    thread_id = settings.report_thread_id or settings.dashboard_pin_thread_id or None

    try:
        chat_id = int(str(target_chat).split(",")[0].strip())
    except Exception:
        return

    action_label = {
        "UPDATE": "✏️ PENGELUARAN DIUBAH",
        "DELETE": "🗑️ PENGELUARAN DIHAPUS",
        "STATUS_CHANGE": "🔄 STATUS DIUBAH",
        "RESTORE": "♻️ PENGELUARAN DIPULIHKAN",
    }.get(action, f"⚡ {action}")

    msg_lines = [
        f"🔔 *AUDIT ALERT: {action_label}*",
        f"⚠️ *Nilai Transaksi:* *{fmt_rupiah(total_price)}* (Ambang: {fmt_rupiah(threshold)})",
        "",
        f"📦 *Barang:* {item_name}",
        f"🏬 *Supplier:* {supplier or '-'}",
        f"📅 *Tanggal:* {date_str or '-'}",
        f"👤 *Pelaku:* `{actor}`",
    ]

    if changes_diff:
        msg_lines.append(f"\n📝 *Rincian Perubahan:*\n{changes_diff}")

    text = "\n".join(msg_lines)

    try:
        await tg.send_message(chat_id=chat_id, text=text, thread_id=thread_id)
    except Exception as exc:
        logger.warning(f"Failed to send high value audit alert: {exc}")
