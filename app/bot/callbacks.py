"""
app/bot/callbacks.py — Handler untuk inline keyboard button callbacks
Port dari handleCallbackQuery di GAS
"""
from sqlalchemy.ext.asyncio import AsyncSession
from app.bot import telegram_client as tg
from app.agent import tools
from app.utils.formatters import (
    fmt_rupiah,
    format_expense_items_summary,
    build_expense_action_keyboard,
    extract_insight_from_text,
    extract_items_block_from_text,
)
from app.config import settings


async def handle_callback_query(cb: dict, db: AsyncSession) -> None:
    """Dispatch callback berdasarkan data field."""
    cb_id = cb["id"]
    chat_id = cb["message"]["chat"]["id"]
    thread_id = cb["message"].get("message_thread_id")
    data = cb.get("data", "")

    # Jawab dulu agar spinner hilang
    await tg.answer_callback_query(cb_id)

    if data == "menu_rekap":
        from app.agent.hermes import HermesAgent
        # Ambil user_id dari message sender
        user_tg_id = cb["from"]["id"]
        from app.utils.auth import get_or_create_user
        user = await get_or_create_user(db, user_tg_id)
        agent = HermesAgent(db, user.id, chat_id, thread_id)
        await agent._handle_report()

    elif data == "menu_hutang":
        from app.agent.hermes import HermesAgent
        user_tg_id = cb["from"]["id"]
        from app.utils.auth import get_or_create_user
        user = await get_or_create_user(db, user_tg_id)
        agent = HermesAgent(db, user.id, chat_id, thread_id)
        await agent._handle_hutang()

    elif data == "menu_reimburse":
        from app.agent.hermes import HermesAgent
        from app.utils.auth import get_or_create_user
        user = await get_or_create_user(db, cb["from"]["id"])
        agent = HermesAgent(db, user.id, chat_id, thread_id)
        await agent._handle_reimburse()

    elif data.startswith("reimb_user:"):
        await _handle_reimb_user_paid(cb, db, chat_id, thread_id, data)

    elif data == "menu_audit":
        from app.agent.hermes import HermesAgent
        user_tg_id = cb["from"]["id"]
        from app.utils.auth import get_or_create_user
        user = await get_or_create_user(db, user_tg_id)
        agent = HermesAgent(db, user.id, chat_id, thread_id)
        await agent._handle_audit_kategori()

    elif data in ("menu_analisis", "refresh_ai_analysis"):
        from app.agent.hermes import HermesAgent
        user_tg_id = cb["from"]["id"]
        from app.utils.auth import get_or_create_user
        user = await get_or_create_user(db, user_tg_id)
        agent = HermesAgent(db, user.id, chat_id, thread_id)
        await agent._handle_ai_analysis(force_refresh=(data == "refresh_ai_analysis"))

    elif data == "action_autofix":
        sent = await tg.send_message(
            chat_id,
            "⏳ *Auto-Fix dimulai...*\n_Menganalisis & memperbaiki kategori via AI..._",
            thread_id,
        )
        msg_id = sent["result"]["message_id"] if sent else None

        result = await tools.tool_autofix_categories(db)
        await db.commit()

        if result.get("error"):
            text = "❌ Auto-Fix gagal. Coba lagi."
        else:
            sisa = f"\n_Masih tersisa {result['remaining']} data, klik lagi._" if result.get("remaining", 0) > 0 else ""
            text = f"✅ *Auto-Fix Selesai!*\nBerhasil memperbaiki *{result['fixed_count']} kategori*.{sisa}"

        if msg_id:
            await tg.edit_message(chat_id, msg_id, text)

    elif data == "menu_bantuan":
        help_msg = (
            "💡 *Panduan Penggunaan:*\n\n"
            "1. 📷 Kirim *foto struk* langsung\n"
            "2. 🎤 Kirim *voice note* belanja\n"
            "3. ✏️ Ketik `/catat [detail belanja]`\n"
            "4. 🔎 Ketik `/audit` untuk cek kategori\n"
            "5. 🔢 Ketik `/audit hitung` untuk fix rumus\n\n"
            f"📂 *Kategori valid:*\n"
            + "\n".join(f"▪️ {c}" for c in settings.valid_categories)
        )
        await tg.send_message(chat_id, help_msg, thread_id)

    elif data == "menu_config":
        msg = (
            f"⚙️ *Konfigurasi Aktif:*\n"
            f"- Provider AI: *Sumopod AI*\n"
            f"- Model: `{settings.sumopod_model}`\n"
            f"- Database: *PostgreSQL*"
        )
        await tg.send_message(chat_id, msg, thread_id)

    elif data == "retry_scan":
        await tg.send_message(chat_id, "🔄 Silakan kirim ulang foto/voice/teks.", thread_id)

    elif data.startswith("undo_save:"):
        from app.services.expense_service import get_expense_by_id, delete_expense

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]

        # Ambil detail items sebelum dihapus agar tetap tersimpan di teks chat untuk pencarian
        expenses_to_delete = []
        for eid in expense_ids:
            exp = await get_expense_by_id(db, eid)
            if exp:
                expenses_to_delete.append(exp)

        deleted_count = 0
        for exp in expenses_to_delete:
            if await delete_expense(db, exp.id):
                deleted_count += 1
        # Hapus juga ID yang mungkin belum ter-fetch
        for eid in expense_ids:
            if eid not in [e.id for e in expenses_to_delete]:
                if await delete_expense(db, eid):
                    deleted_count += 1
        await db.commit()

        items_summary, total_val = format_expense_items_summary(expenses_to_delete, strikethrough=True)
        if not items_summary:
            items_summary = extract_items_block_from_text(cb.get("message", {}).get("text", ""))

        msg_id = cb["message"].get("message_id")
        items_block = f"\n\n📝 *Item yang Dibatalkan:*\n{items_summary}" if items_summary else ""
        total_block = f"\n\n💰 *Total Dibatalkan: {fmt_rupiah(total_val)}*" if total_val > 0 else ""

        cancel_text = (
            f"🗑️ *Pencatatan Dibatalkan!*\n"
            f"_{deleted_count} item telah dihapus dari database._"
            f"{items_block}"
            f"{total_block}"
        )
        keyboard = {
            "inline_keyboard": [
                [{"text": "🌐 Lihat Dashboard", "url": settings.public_dashboard_url}]
            ]
        }
        if msg_id:
            await tg.edit_message(chat_id, msg_id, cancel_text, keyboard)
        else:
            await tg.send_message(chat_id, cancel_text, thread_id, keyboard)

    elif data.startswith("unpaid_save:"):
        from app.services.expense_service import update_expense, get_expense_by_id

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]
        updated_expenses = []
        for eid in expense_ids:
            exp = await update_expense(db, eid, {"pay_status": "Belum Lunas"})
            if exp:
                updated_expenses.append(exp)
        await db.commit()

        items_summary, total_val = format_expense_items_summary(updated_expenses)
        if not items_summary:
            items_summary = extract_items_block_from_text(cb.get("message", {}).get("text", ""))

        is_reimb = any(bool(e.is_reimbursement) for e in updated_expenses)
        reimb_label = "💼 Ya (Ditalangi)" if is_reimb else "🏷️ Tidak (Reguler)"
        insight = extract_insight_from_text(cb.get("message", {}).get("text", ""))

        msg_id = cb["message"].get("message_id")
        unpaid_text = (
            f"⏳ *Status: BELUM LUNAS (HUTANG)*\n\n"
            f"📝 *Rincian:*\n{items_summary}\n\n"
            f"💰 *Total: {fmt_rupiah(total_val)}*\n"
            f"💳 *Status Bayar:* ⏳ Belum Lunas (Hutang)\n"
            f"💼 *Status Reimburse:* {reimb_label}\n\n"
            f"_Klik tombol 'Tandai Lunas' di bawah jika tagihan ini sudah dibayar._"
            f"{insight}"
        )
        keyboard = build_expense_action_keyboard(
            ids_raw,
            is_paid=False,
            is_reimb=is_reimb,
            dashboard_url=settings.public_dashboard_url,
        )
        if msg_id:
            await tg.edit_message(chat_id, msg_id, unpaid_text, keyboard)
        else:
            await tg.send_message(chat_id, unpaid_text, thread_id, keyboard)

    elif data.startswith("mark_paid:"):
        from app.services.expense_service import update_expense, get_expense_by_id

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]
        updated_expenses = []
        for eid in expense_ids:
            exp = await update_expense(db, eid, {"pay_status": "Lunas"})
            if exp:
                updated_expenses.append(exp)
        await db.commit()

        items_summary, total_val = format_expense_items_summary(updated_expenses)
        if not items_summary:
            items_summary = extract_items_block_from_text(cb.get("message", {}).get("text", ""))

        is_reimb = any(bool(e.is_reimbursement) for e in updated_expenses)
        reimb_label = "💼 Ya (Ditalangi)" if is_reimb else "🏷️ Tidak (Reguler)"
        insight = extract_insight_from_text(cb.get("message", {}).get("text", ""))

        msg_id = cb["message"].get("message_id")
        paid_text = (
            f"✅ *Status: LUNAS (Telah Dilunasi)*\n\n"
            f"📝 *Rincian:*\n{items_summary}\n\n"
            f"💰 *Total: {fmt_rupiah(total_val)}*\n"
            f"💳 *Status Bayar:* ✅ Lunas\n"
            f"💼 *Status Reimburse:* {reimb_label}\n\n"
            f"_Status pembayaran di database telah diperbarui menjadi Lunas._"
            f"{insight}"
        )
        keyboard = build_expense_action_keyboard(
            ids_raw,
            is_paid=True,
            is_reimb=is_reimb,
            dashboard_url=settings.public_dashboard_url,
        )
        if msg_id:
            await tg.edit_message(chat_id, msg_id, paid_text, keyboard)
        else:
            await tg.send_message(chat_id, paid_text, thread_id, keyboard)

    elif data.startswith("toggle_reimb:"):
        from app.services.expense_service import get_expense_by_id

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]

        current_states = []
        expenses_to_update = []
        for eid in expense_ids:
            exp = await get_expense_by_id(db, eid)
            if exp:
                current_states.append(bool(exp.is_reimbursement))
                expenses_to_update.append(exp)

        # Jika ada yang belum reimbursement, tandai semua jadi reimbursement (True).
        # Jika semua sudah reimbursement, batalkan jadi False.
        new_state = not all(current_states) if current_states else True
        for exp in expenses_to_update:
            exp.is_reimbursement = new_state
            if not new_state:
                exp.reimbursed_at = None
            exp.sheets_synced = False
        await db.commit()

        items_summary, total_val = format_expense_items_summary(expenses_to_update)
        if not items_summary:
            items_summary = extract_items_block_from_text(cb.get("message", {}).get("text", ""))

        is_paid = not any(
            str(e.pay_status or "Lunas").lower() in ("belum lunas", "hutang", "tempo")
            for e in expenses_to_update
        )
        pay_label = "✅ Lunas" if is_paid else "⏳ Belum Lunas (Hutang)"
        reimb_header = "💼 *Status: REIMBURSEMENT (Ditalangi)*" if new_state else "🏷️ *Status: BUKAN REIMBURSEMENT (Reguler)*"
        reimb_label = "💼 Ya (Ditalangi)" if new_state else "🏷️ Tidak (Reguler)"
        insight = extract_insight_from_text(cb.get("message", {}).get("text", ""))

        msg_id = cb["message"].get("message_id")
        reimb_text = (
            f"{reimb_header}\n\n"
            f"📝 *Rincian:*\n{items_summary}\n\n"
            f"💰 *Total: {fmt_rupiah(total_val)}*\n"
            f"💳 *Status Bayar:* {pay_label}\n"
            f"💼 *Status Reimburse:* {reimb_label}\n\n"
            f"_Data transaksi berhasil diperbarui di database._"
            f"{insight}"
        )
        keyboard = build_expense_action_keyboard(
            ids_raw,
            is_paid=is_paid,
            is_reimb=new_state,
            dashboard_url=settings.public_dashboard_url,
        )
        if msg_id:
            await tg.edit_message(chat_id, msg_id, reimb_text, keyboard)
        else:
            await tg.send_message(chat_id, reimb_text, thread_id, keyboard)


async def _handle_reimb_user_paid(
    cb: dict, db: AsyncSession, chat_id: int, thread_id: int | None, data: str
) -> None:
    """Admin menandai seluruh talangan milik satu user sudah diganti, lalu DM user tersebut."""
    from app.services.expense_service import (
        get_outstanding_reimbursements,
        group_reimbursements_by_user,
        mark_reimbursed,
    )
    from app.bot.reimburse import build_admin_review, build_paid_notification
    from app.models.user import User

    if not settings.is_admin_telegram(cb["from"]["id"]):
        await tg.send_message(
            chat_id,
            "⛔ *Akses ditolak.* Hanya admin/owner yang dapat menandai talangan sudah diganti.",
            thread_id,
        )
        return

    raw_uid = data.split(":", 1)[1].strip()
    if not raw_uid.isdigit():
        return
    uid = int(raw_uid)

    if uid == 0:
        outstanding = [e for e in await get_outstanding_reimbursements(db) if e.user_id is None]
    else:
        outstanding = await get_outstanding_reimbursements(db, user_id=uid)

    paid = await mark_reimbursed(db, [e.id for e in outstanding])
    await db.commit()

    # Notifikasi DM ke pemilik talangan (abaikan jika user belum pernah chat bot / gagal kirim)
    if paid and uid:
        owner = await db.get(User, uid)
        if owner and owner.telegram_id and owner.telegram_id != chat_id:
            await tg.send_message(owner.telegram_id, build_paid_notification(paid))

    # Perbarui pesan review admin dengan sisa talangan
    remaining = await get_outstanding_reimbursements(db)
    groups = await group_reimbursements_by_user(db, remaining)
    text, keyboard = build_admin_review(groups)
    total_paid = sum(float(e.total_price or 0) for e in paid)
    paid_items_lines = "\n".join([f"• {e.item_name} ({fmt_rupiah(float(e.total_price or 0))})" for e in paid[:10]])
    paid_header = f"✅ *{len(paid)} talangan ({fmt_rupiah(total_paid)}) ditandai sudah diganti:*\n{paid_items_lines}\n\n" if paid else ""
    text = paid_header + text

    msg_id = cb["message"].get("message_id")
    if msg_id:
        await tg.edit_message(chat_id, msg_id, text, keyboard)
    else:
        await tg.send_message(chat_id, text, thread_id, keyboard)
