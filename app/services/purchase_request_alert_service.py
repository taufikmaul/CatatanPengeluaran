"""
app/services/purchase_request_alert_service.py — Layanan Notifikasi Telegram untuk Alur Request Belanja
Mengirim notifikasi ke Telegram Topic khusus Request Belanja (atau topic fallback) saat:
1. Staf membuat pengajuan belanja baru (Pengajuan)
2. Purchasing memesan barang ke supplier (Belanja / Ordered)
3. Gudang memeriksa fisik & mencatat kedatangan barang (Penerimaan Barang & Exp Date)
"""
from decimal import Decimal
import logging
from typing import Any
from app.config import settings
from app.bot import telegram_client as tg
from app.models.purchase_request import PurchaseRequest, PurchaseRequestItem
from app.utils.formatters import fmt_rupiah

logger = logging.getLogger(__name__)


def get_target_chat_and_thread() -> tuple[int | None, int | None]:
    """
    Ambil target chat ID dan thread ID untuk notifikasi request belanja.
    Prioritas Chat ID:
    1. REQUEST_BELANJA_CHAT_ID
    2. REPORT_CHAT_ID
    3. DASHBOARD_PIN_CHAT_ID
    Prioritas Thread ID:
    1. REQUEST_BELANJA_THREAD_ID
    2. REPORT_THREAD_ID
    """
    target_chat = (
        settings.request_belanja_chat_id
        or settings.report_chat_id
        or settings.dashboard_pin_chat_id
    )
    if not target_chat:
        return None, None

    try:
        chat_id = int(str(target_chat).split(",")[0].strip())
    except (ValueError, TypeError):
        return None, None

    thread_id = settings.request_belanja_thread_id
    if thread_id is None:
        thread_id = settings.report_thread_id

    return chat_id, thread_id


async def notify_new_purchase_request(req: PurchaseRequest) -> None:
    """
    Kirim notifikasi Telegram saat pengajuan belanja baru dibuat oleh staf.
    """
    chat_id, thread_id = get_target_chat_and_thread()
    if not chat_id:
        return

    try:
        urgency_badge = "🔥 *[URGENT]*" if req.urgency == "URGENT" else "🟢 *[NORMAL]*"
        req_num = req.request_number or f"REQ-{req.id:03d}"
        date_str = req.request_date.strftime("%d/%m/%Y") if req.request_date else "-"

        lines = [
            f"🛒 *REQUEST BELANJA BARU* {urgency_badge}",
            f"📋 *No. Req:* `{req_num}`",
            f"👤 *Diajukan oleh:* {req.requester_name}",
            f"📅 *Tanggal:* {date_str}",
        ]

        if req.title and req.title != "Request Belanja":
            lines.append(f"📌 *Judul:* {req.title}")
        if req.notes and req.notes != "-":
            lines.append(f"📝 *Catatan:* {req.notes}")

        lines.append("")
        lines.append("📦 *Daftar Barang Belanja:*")

        total_est = Decimal("0")
        has_est = False

        if req.items:
            for idx, item in enumerate(req.items, 1):
                item_line = f"{idx}. *{item.item_name}* — {item.qty} {item.unit}"
                extra_parts = []
                if item.estimated_price and item.estimated_price > 0:
                    subtotal = Decimal(str(item.estimated_price)) * Decimal(str(item.qty))
                    extra_parts.append(f"Est: {fmt_rupiah(float(subtotal))}")
                    total_est += subtotal
                    has_est = True
                if item.supplier_name and item.supplier_name != "-":
                    extra_parts.append(f"Supplier: {item.supplier_name}")
                if item.notes and item.notes != "-":
                    extra_parts.append(f"Ket: {item.notes}")

                if extra_parts:
                    item_line += f" ({', '.join(extra_parts)})"
                lines.append(item_line)
        else:
            # Fallback single item
            lines.append(f"1. *{req.item_name}* — {req.qty} {req.unit}")
            if req.estimated_price:
                subtotal = Decimal(str(req.estimated_price)) * Decimal(str(req.qty))
                total_est = subtotal
                has_est = True

        if has_est and total_est > 0:
            lines.append("")
            lines.append(f"💰 *Total Estimasi Biaya:* *{fmt_rupiah(float(total_est))}*")

        lines.append("")
        lines.append("👉 _Buka menu Request Belanja > Tab Purchasing untuk memproses order supplier._")

        msg = "\n".join(lines)
        await tg.send_message(chat_id=chat_id, text=msg, thread_id=thread_id)
    except Exception as e:
        logger.warning(f"Gagal mengirim notifikasi request belanja baru ke Telegram: {e}")


async def notify_purchasing_ordered(
    items: list[PurchaseRequestItem],
    supplier_name: str | None = None,
    actor: str = "Purchasing",
) -> None:
    """
    Kirim notifikasi Telegram saat purchasing telah memesan daftar item ke supplier.
    """
    if not items:
        return

    chat_id, thread_id = get_target_chat_and_thread()
    if not chat_id:
        return

    try:
        lines = [
            "🛍️ *PESANAN BELANJA TELAH DIBELI / DIORDER*",
            f"👤 *Purchasing:* {actor}",
        ]

        if supplier_name and supplier_name != "-":
            lines.append(f"🏬 *Supplier:* *{supplier_name}*")

        lines.append("")
        lines.append("📦 *Daftar Item Dipesan:*")

        for idx, item in enumerate(items, 1):
            req_info = ""
            if item.request and item.request.request_number:
                req_info = f" `[{item.request.request_number}]`"
            elif item.request_id:
                req_info = f" `[REQ-{item.request_id}]`"

            sup_info = ""
            if not supplier_name and item.supplier_name and item.supplier_name != "-":
                sup_info = f" (Supplier: {item.supplier_name})"

            lines.append(f"{idx}. *{item.item_name}* — {item.qty} {item.unit}{req_info}{sup_info}")

        lines.append("")
        lines.append("🚚 *Status:* Menunggu kedatangan fisik & pemeriksaan oleh Tim Gudang.")

        msg = "\n".join(lines)
        await tg.send_message(chat_id=chat_id, text=msg, thread_id=thread_id)
    except Exception as e:
        logger.warning(f"Gagal mengirim notifikasi pembelian belanja ke Telegram: {e}")


async def notify_warehouse_received(
    item: PurchaseRequestItem,
    actor: str = "Gudang",
) -> None:
    """
    Kirim notifikasi Telegram saat barang fisik tiba dan diperiksa oleh Gudang.
    Mencakup status kesesuaian qty (SESUAI/KURANG/LEBIH), Tanggal Expired, dan catatan kondisi.
    """
    chat_id, thread_id = get_target_chat_and_thread()
    if not chat_id:
        return

    try:
        status_map = {
            "SESUAI": "✅ *SESUAI*",
            "KURANG": "⚠️ *KURANG (SELISIH)*",
            "LEBIH": "ℹ️ *LEBIH*",
        }
        status_str = status_map.get(item.receiving_status or "SESUAI", f"*{item.receiving_status}*")

        req_num = ""
        if item.request and item.request.request_number:
            req_num = item.request.request_number
        elif item.request_id:
            req_num = f"REQ-{item.request_id}"

        exp_str = item.expired_date.strftime("%d/%m/%Y") if item.expired_date else "-"

        lines = [
            "📥 *BARANG DITERIMA DI GUDANG*",
            f"👤 *Pemeriksa Gudang:* {actor}",
            f"📦 *Barang:* *{item.item_name}*",
        ]

        if item.supplier_name and item.supplier_name != "-":
            lines.append(f"🏬 *Supplier:* {item.supplier_name}")
        if req_num:
            lines.append(f"📋 *No. Req:* `{req_num}`")

        lines.append("")
        lines.append("📊 *Hasil Pemeriksaan:*")
        lines.append(f"• Jumlah Dipesan: *{item.qty} {item.unit}*")
        lines.append(f"• Jumlah Diterima: *{item.qty_received or item.qty} {item.unit}*")
        lines.append(f"• Kesesuaian Fisik: {status_str}")
        lines.append(f"• Tanggal Expired: `{exp_str}`")

        if item.receiving_notes and item.receiving_notes != "-":
            lines.append(f"• Catatan Kondisi: _{item.receiving_notes}_")

        msg = "\n".join(lines)
        await tg.send_message(chat_id=chat_id, text=msg, thread_id=thread_id)
    except Exception as e:
        logger.warning(f"Gagal mengirim notifikasi penerimaan barang ke Telegram: {e}")
