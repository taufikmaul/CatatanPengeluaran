"""
app/bot/reimburse.py — Pesan & keyboard Telegram untuk review reimbursement (talangan).

Dipakai oleh Hermes (/reimburse), callback tombol, dan scheduler pengingat mingguan.
"""
from app.config import settings
from app.utils.formatters import fmt_rupiah

MAX_ITEMS_SHOWN = 10


def _item_line(idx: int, e) -> str:
    sup = f" ({e.supplier})" if e.supplier and e.supplier != "-" else ""
    inv = f" `#{e.invoice_number}`" if e.invoice_number and e.invoice_number != "-" else ""
    return (
        f"{idx}. *#{e.id} {e.item_name}*{sup}{inv}\n"
        f"    {e.expense_date} — {fmt_rupiah(float(e.total_price or 0))}\n"
    )


def build_user_review(group: dict | None, is_reminder: bool = False) -> tuple[str, dict]:
    """Ringkasan talangan milik satu user (tanpa tombol pelunasan)."""
    dashboard_row = [{"text": "🌐 Buka Dashboard", "url": settings.public_dashboard_url}]

    if not group or not group["items"]:
        text = (
            "✅ *Tidak Ada Talangan Tertunda*\n"
            "Semua reimbursement Anda sudah diganti. Terima kasih!"
        )
        return text, {"inline_keyboard": [dashboard_row]}

    header = "⏰ *PENGINGAT MINGGUAN REIMBURSE*" if is_reminder else "💼 *REVIEW REIMBURSE ANDA*"
    items = group["items"]
    text = (
        f"{header}\n"
        f"Halo *{group['name']}*, berikut talangan Anda yang *belum diganti*:\n\n"
        f"Total: *{len(items)} transaksi ({fmt_rupiah(group['total'])})*\n\n"
    )
    for idx, e in enumerate(items[:MAX_ITEMS_SHOWN], start=1):
        text += _item_line(idx, e)
    if len(items) > MAX_ITEMS_SHOWN:
        text += f"\n_...dan {len(items) - MAX_ITEMS_SHOWN} transaksi lainnya di Dashboard._\n"
    text += "\n_Pelunasan talangan dikonfirmasi oleh admin/owner._"
    return text, {"inline_keyboard": [dashboard_row]}


def build_admin_review(groups: list[dict]) -> tuple[str, dict]:
    """Ringkasan talangan semua user untuk admin, lengkap dengan tombol pelunasan per user."""
    dashboard_row = [{"text": "🌐 Buka Dashboard", "url": settings.public_dashboard_url}]

    if not groups:
        text = "✅ *Tidak Ada Talangan Tertunda*\nSemua reimbursement karyawan sudah diganti."
        return text, {"inline_keyboard": [dashboard_row]}

    grand_total = sum(g["total"] for g in groups)
    grand_count = sum(len(g["items"]) for g in groups)
    text = (
        "💼 *REVIEW REIMBURSE SEMUA USER* _(Admin)_\n"
        f"Total: *{grand_count} transaksi ({fmt_rupiah(grand_total)})* "
        f"dari *{len(groups)} orang*\n\n"
    )

    rows = []
    for g in groups:
        text += f"👤 *{g['name']}* — {len(g['items'])} item, *{fmt_rupiah(g['total'])}*\n"
        for e in g["items"][:5]:
            text += f"   • #{e.id} {e.item_name} — {fmt_rupiah(float(e.total_price or 0))}\n"
        if len(g["items"]) > 5:
            text += f"   _...dan {len(g['items']) - 5} lainnya_\n"
        text += "\n"

        # callback_data Telegram maks 64 byte → kirim user_id saja (0 = tanpa user / input web)
        uid = g["user_id"] if g["user_id"] is not None else 0
        label_name = (g["name"] or "User")[:16]
        rows.append([{
            "text": f"✅ Ganti {label_name} ({fmt_rupiah(g['total'])})",
            "callback_data": f"reimb_user:{uid}",
        }])

    rows.append(dashboard_row)
    return text, {"inline_keyboard": rows}


def build_paid_notification(items: list) -> str:
    """Pesan DM ke pemilik talangan setelah admin menandai sudah diganti."""
    total = sum(float(e.total_price or 0) for e in items)
    lines = "\n".join(
        f"• #{e.id} {e.item_name} — {fmt_rupiah(float(e.total_price or 0))}" for e in items[:15]
    )
    return (
        "💸 *Talangan Anda Sudah Diganti!*\n\n"
        f"{lines}\n\n"
        f"Total: *{fmt_rupiah(total)}*\n"
        "_Dikonfirmasi oleh admin/owner._"
    )
