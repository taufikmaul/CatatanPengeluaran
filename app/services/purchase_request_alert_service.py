"""
app/services/purchase_request_alert_service.py — Layanan Notifikasi Telegram untuk Alur Request Belanja
Mengirim notifikasi feed aktivitas ke Telegram Topic Khusus Request Belanja (atau topic fallback) untuk:
1. Pengajuan belanja (baru, diperbarui, dihapus)
2. Approval belanja (disetujui, ditolak)
3. Purchasing & gudang (penetapan supplier, koreksi item, item susulan, pembatalan item, order supplier)
4. Penerimaan & realisasi (pemeriksaan fisik gudang & status terpenuhi)
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


def _format_req_number(req: PurchaseRequest | None = None, request_id: int | None = None) -> str:
    """Format nomor request secara konsisten."""
    if req is not None:
        if req.request_number:
            return req.request_number
        return f"REQ-{req.id:03d}" if req.id is not None else "REQ-?"
    if request_id is not None:
        return f"REQ-{request_id}"
    return "REQ-?"


def _format_qty(qty: Any) -> str:
    """Format angka qty agar rapi tanpa trailing zero berlebih."""
    if qty is None:
        return "0"
    try:
        return f"{float(qty):g}"
    except (ValueError, TypeError):
        return str(qty)


def _format_item_req_tag(item: PurchaseRequestItem) -> str:
    """Format tag nomor request untuk baris item."""
    if getattr(item, "request", None) is not None and item.request.request_number:
        return f" `[{item.request.request_number}]`"
    if item.request_id:
        return f" `[REQ-{item.request_id}]`"
    return ""


def _build_request_items_lines(
    req: PurchaseRequest,
    *,
    include_total: bool = False,
) -> tuple[list[str], Decimal, bool]:
    """Bangun daftar baris item untuk header PurchaseRequest."""
    lines: list[str] = []
    total_est = Decimal("0")
    has_est = False

    if req.items:
        for idx, item in enumerate(req.items, 1):
            item_line = f"{idx}. *{item.item_name}* — {_format_qty(item.qty)} {item.unit}"
            extra_parts: list[str] = []
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
    elif req.item_name:
        lines.append(f"1. *{req.item_name}* — {_format_qty(req.qty)} {req.unit}")
        if req.estimated_price:
            subtotal = Decimal(str(req.estimated_price)) * Decimal(str(req.qty))
            total_est = subtotal
            has_est = True

    if include_total and has_est and total_est > 0:
        lines.append("")
        lines.append(f"💰 *Total Estimasi Biaya:* *{fmt_rupiah(float(total_est))}*")

    return lines, total_est, has_est


async def _send_topic_alert(text: str, action_label: str) -> None:
    """Kirim pesan aktivitas ke Topic Khusus Request Belanja tanpa melempar exception."""
    chat_id, thread_id = get_target_chat_and_thread()
    if not chat_id:
        return

    try:
        await tg.send_message(chat_id=chat_id, text=text, thread_id=thread_id)
    except Exception as e:
        logger.warning(f"Gagal mengirim notifikasi {action_label} ke Telegram: {e}")


# ──────────────────────────────────────────────
# 1. Pengajuan Belanja
# ──────────────────────────────────────────────

async def notify_new_purchase_request(req: PurchaseRequest) -> None:
    """Kirim notifikasi Telegram saat pengajuan belanja baru dibuat."""
    urgency_badge = "🔥 *[URGENT]*" if req.urgency == "URGENT" else "🟢 *[NORMAL]*"
    req_num = _format_req_number(req)
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
    item_lines, _, _ = _build_request_items_lines(req, include_total=True)
    lines.extend(item_lines)
    lines.append("")
    lines.append("👉 _Menunggu approval belanja di menu Approval (Owner / Manager)._")

    await _send_topic_alert("\n".join(lines), "request belanja baru")


async def notify_purchase_request_updated(
    req: PurchaseRequest,
    actor: str = "Staf / Admin",
) -> None:
    """Kirim notifikasi Telegram saat pengajuan belanja diperbarui."""
    urgency_badge = "🔥 *[URGENT]*" if req.urgency == "URGENT" else "🟢 *[NORMAL]*"
    req_num = _format_req_number(req)

    lines = [
        f"✏️ *PENGAJUAN BELANJA DIPERBARUI* {urgency_badge}",
        f"📋 *No. Req:* `{req_num}`",
        f"👤 *Pemohon:* {req.requester_name}",
        f"🛠️ *Diperbarui oleh:* {actor}",
    ]

    if req.title and req.title != "Request Belanja":
        lines.append(f"📌 *Judul:* {req.title}")
    if req.notes and req.notes != "-":
        lines.append(f"📝 *Catatan:* {req.notes}")

    lines.append("")
    lines.append("📦 *Daftar Barang Terbaru:*")
    item_lines, _, _ = _build_request_items_lines(req, include_total=True)
    lines.extend(item_lines)

    await _send_topic_alert("\n".join(lines), "perubahan request belanja")


async def notify_purchase_request_deleted(
    req_number: str,
    title: str = "Request Belanja",
    requester_name: str = "-",
    items_summary: list[str] | None = None,
    actor: str = "Admin / Staf",
) -> None:
    """Kirim notifikasi Telegram saat pengajuan belanja dihapus."""
    lines = [
        "🗑️ *PENGAJUAN BELANJA DIHAPUS*",
        f"📋 *No. Req:* `{req_number}`",
        f"👤 *Pemohon:* {requester_name}",
        f"🛠️ *Dihapus oleh:* {actor}",
    ]
    if title and title != "Request Belanja":
        lines.append(f"📌 *Judul:* {title}")
    if items_summary:
        lines.append("")
        lines.append("📦 *Barang:*")
        for idx, entry in enumerate(items_summary[:10], 1):
            lines.append(f"{idx}. {entry}")

    await _send_topic_alert("\n".join(lines), "penghapusan request belanja")


# ──────────────────────────────────────────────
# 2. Approval Belanja
# ──────────────────────────────────────────────

async def notify_purchase_request_approved(
    req: PurchaseRequest,
    actor: str = "Owner / Manager",
) -> None:
    """Kirim notifikasi Telegram saat pengajuan belanja disetujui."""
    urgency_badge = "🔥 *[URGENT]*" if req.urgency == "URGENT" else "🟢 *[NORMAL]*"
    req_num = _format_req_number(req)

    lines = [
        f"✅ *APPROVAL BELANJA: DISETUJUI* {urgency_badge}",
        f"📋 *No. Req:* `{req_num}`",
        f"👤 *Pemohon:* {req.requester_name}",
        f"👑 *Disetujui oleh:* {actor}",
    ]

    if req.title and req.title != "Request Belanja":
        lines.append(f"📌 *Judul:* {req.title}")

    lines.append("")
    lines.append("📦 *Daftar Barang Disetujui:*")
    item_lines, _, _ = _build_request_items_lines(req, include_total=True)
    lines.extend(item_lines)
    lines.append("")
    lines.append("👉 _Diteruskan ke Tim Purchasing untuk penetapan supplier & pemesanan._")

    await _send_topic_alert("\n".join(lines), "approval belanja disetujui")


async def notify_purchase_request_rejected(
    req: PurchaseRequest,
    actor: str = "Owner / Manager",
) -> None:
    """Kirim notifikasi Telegram saat pengajuan belanja ditolak."""
    req_num = _format_req_number(req)

    lines = [
        "❌ *APPROVAL BELANJA: DITOLAK*",
        f"📋 *No. Req:* `{req_num}`",
        f"👤 *Pemohon:* {req.requester_name}",
        f"👑 *Ditolak oleh:* {actor}",
        f"📝 *Alasan:* {req.reject_reason or 'Ditolak oleh admin'}",
    ]

    lines.append("")
    lines.append("📦 *Daftar Barang Ditolak:*")
    item_lines, _, _ = _build_request_items_lines(req, include_total=False)
    lines.extend(item_lines)

    await _send_topic_alert("\n".join(lines), "approval belanja ditolak")


# ──────────────────────────────────────────────
# 3. Purchasing & Gudang
# ──────────────────────────────────────────────

async def notify_purchasing_supplier_assigned(
    item: PurchaseRequestItem,
    actor: str = "Purchasing",
) -> None:
    """Kirim notifikasi Telegram saat Purchasing menetapkan supplier untuk item belanja."""
    req_tag = _format_item_req_tag(item)
    lines = [
        "🏬 *PURCHASING: SUPPLIER DITETAPKAN*",
        f"👤 *Purchasing:* {actor}",
        f"📦 *Barang:* *{item.item_name}* — {_format_qty(item.qty)} {item.unit}{req_tag}",
        f"🏬 *Supplier:* *{item.supplier_name or '-'}*",
    ]
    if item.estimated_price and item.estimated_price > 0:
        lines.append(f"💰 *Harga Estimasi:* {fmt_rupiah(float(item.estimated_price))} / {item.unit}")

    await _send_topic_alert("\n".join(lines), "penetapan supplier purchasing")


async def notify_purchasing_item_updated(
    item: PurchaseRequestItem,
    actor: str = "Purchasing",
) -> None:
    """Kirim notifikasi Telegram saat Purchasing mengoreksi detail item belanja."""
    req_tag = _format_item_req_tag(item)
    lines = [
        "✏️ *PURCHASING: KOREKSI ITEM BELANJA*",
        f"👤 *Purchasing:* {actor}",
        f"📦 *Barang:* *{item.item_name}* — {_format_qty(item.qty)} {item.unit}{req_tag}",
    ]
    if item.supplier_name and item.supplier_name != "-":
        lines.append(f"🏬 *Supplier:* {item.supplier_name}")
    if item.estimated_price and item.estimated_price > 0:
        lines.append(f"💰 *Harga Estimasi:* {fmt_rupiah(float(item.estimated_price))} / {item.unit}")
    if item.notes and item.notes != "-":
        lines.append(f"📝 *Catatan:* {item.notes}")

    await _send_topic_alert("\n".join(lines), "koreksi item purchasing")


async def notify_purchasing_item_added(
    item: PurchaseRequestItem,
    actor: str = "Purchasing",
) -> None:
    """Kirim notifikasi Telegram saat Purchasing menambahkan item susulan/koreksi."""
    req_tag = _format_item_req_tag(item)
    lines = [
        "➕ *PURCHASING: ITEM SUSULAN / TAMBAHAN*",
        f"👤 *Purchasing:* {actor}",
        f"📦 *Barang:* *{item.item_name}* — {_format_qty(item.qty)} {item.unit}{req_tag}",
    ]
    if item.supplier_name and item.supplier_name != "-":
        lines.append(f"🏬 *Supplier:* {item.supplier_name}")
    if item.estimated_price and item.estimated_price > 0:
        lines.append(f"💰 *Harga Estimasi:* {fmt_rupiah(float(item.estimated_price))} / {item.unit}")
    if item.notes and item.notes != "-":
        lines.append(f"📝 *Catatan:* {item.notes}")

    await _send_topic_alert("\n".join(lines), "penambahan item purchasing")


async def notify_purchasing_item_cancelled(
    item: PurchaseRequestItem,
    reason: str = "Barang tidak tersedia di supplier",
    actor: str = "Purchasing",
) -> None:
    """Kirim notifikasi Telegram saat Purchasing membatalkan item belanja."""
    req_tag = _format_item_req_tag(item)
    lines = [
        "🚫 *PURCHASING: ITEM DIBATALKAN*",
        f"👤 *Purchasing:* {actor}",
        f"📦 *Barang:* *{item.item_name}* — {_format_qty(item.qty)} {item.unit}{req_tag}",
        f"📝 *Alasan:* {reason or 'Barang tidak tersedia di supplier'}",
    ]
    if item.supplier_name and item.supplier_name != "-":
        lines.append(f"🏬 *Supplier:* {item.supplier_name}")

    await _send_topic_alert("\n".join(lines), "pembatalan item purchasing")


async def notify_purchasing_ordered(
    items: list[PurchaseRequestItem],
    supplier_name: str | None = None,
    actor: str = "Purchasing",
) -> None:
    """Kirim notifikasi Telegram saat purchasing telah memesan daftar item ke supplier."""
    if not items:
        return

    lines = [
        "🛍️ *PESANAN BELANJA TELAH DIBELI / DIORDER*",
        f"👤 *Purchasing:* {actor}",
    ]

    if supplier_name and supplier_name != "-":
        lines.append(f"🏬 *Supplier:* *{supplier_name}*")

    lines.append("")
    lines.append("📦 *Daftar Item Dipesan:*")

    for idx, item in enumerate(items, 1):
        req_info = _format_item_req_tag(item)
        sup_info = ""
        if not supplier_name and item.supplier_name and item.supplier_name != "-":
            sup_info = f" (Supplier: {item.supplier_name})"

        lines.append(f"{idx}. *{item.item_name}* — {_format_qty(item.qty)} {item.unit}{req_info}{sup_info}")

    lines.append("")
    lines.append("🚚 *Status:* Menunggu kedatangan fisik & pemeriksaan oleh Tim Gudang.")

    await _send_topic_alert("\n".join(lines), "pembelian belanja")


# ──────────────────────────────────────────────
# 4. Penerimaan & Realisasi
# ──────────────────────────────────────────────

async def notify_warehouse_received(
    item: PurchaseRequestItem,
    actor: str = "Gudang",
    all_received: bool = False,
) -> None:
    """
    Kirim notifikasi Telegram saat barang fisik tiba dan diperiksa oleh Gudang.
    Mencakup status kesesuaian qty (SESUAI/KURANG/LEBIH), Tanggal Expired, dan catatan kondisi.
    """
    status_map = {
        "SESUAI": "✅ *SESUAI*",
        "KURANG": "⚠️ *KURANG (SELISIH)*",
        "LEBIH": "ℹ️ *LEBIH*",
    }
    status_str = status_map.get(item.receiving_status or "SESUAI", f"*{item.receiving_status}*")

    req_num = ""
    if getattr(item, "request", None) is not None and item.request.request_number:
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
    lines.append(f"• Jumlah Dipesan: *{_format_qty(item.qty)} {item.unit}*")
    lines.append(f"• Jumlah Diterima: *{_format_qty(item.qty_received or item.qty)} {item.unit}*")
    lines.append(f"• Kesesuaian Fisik: {status_str}")
    lines.append(f"• Tanggal Expired: `{exp_str}`")

    if item.receiving_notes and item.receiving_notes != "-":
        lines.append(f"• Catatan Kondisi: _{item.receiving_notes}_")

    if all_received and req_num:
        lines.append("")
        lines.append(f"🎉 _Seluruh item pada `{req_num}` telah selesai diterima di gudang._")

    await _send_topic_alert("\n".join(lines), "penerimaan barang")


async def notify_purchase_request_fulfilled(
    req: PurchaseRequest,
    actor: str = "Sistem",
    source_note: str | None = None,
) -> None:
    """Kirim notifikasi Telegram saat request belanja selesai / terpenuhi (FULFILLED)."""
    req_num = _format_req_number(req)
    lines = [
        "🏁 *REQUEST BELANJA TERPENUHI (SELESAI)*",
        f"📋 *No. Req:* `{req_num}`",
        f"👤 *Pemohon:* {req.requester_name}",
        f"🛠️ *Diproses oleh:* {actor}",
    ]
    if source_note:
        lines.append(f"🧾 *Keterangan:* {source_note}")

    lines.append("")
    lines.append("📦 *Daftar Barang:*")
    item_lines, _, _ = _build_request_items_lines(req, include_total=False)
    lines.extend(item_lines)

    await _send_topic_alert("\n".join(lines), "realisasi request belanja")
