"""
app/bot/callbacks.py — Handler untuk inline keyboard button callbacks
Port dari handleCallbackQuery di GAS
"""
from sqlalchemy.ext.asyncio import AsyncSession
from app.bot import telegram_client as tg
from app.agent import tools
from app.utils.formatters import fmt_rupiah
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

    elif data == "menu_audit":
        from app.agent.hermes import HermesAgent
        user_tg_id = cb["from"]["id"]
        from app.utils.auth import get_or_create_user
        user = await get_or_create_user(db, user_tg_id)
        agent = HermesAgent(db, user.id, chat_id, thread_id)
        await agent._handle_audit_kategori()

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
        from app.services.expense_service import delete_expense

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]
        deleted_count = 0
        for eid in expense_ids:
            if await delete_expense(db, eid):
                deleted_count += 1
        await db.commit()

        msg_id = cb["message"].get("message_id")
        cancel_text = (
            f"🗑️ *Simpan Dibatalkan!*\n"
            f"Berhasil menghapus *{deleted_count} item* yang baru saja dicatat dari database."
        )
        if msg_id:
            await tg.edit_message(chat_id, msg_id, cancel_text)
        else:
            await tg.send_message(chat_id, cancel_text, thread_id)

    elif data.startswith("unpaid_save:"):
        from app.services.expense_service import update_expense

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]
        updated_names = []
        for eid in expense_ids:
            exp = await update_expense(db, eid, {"pay_status": "Belum Lunas"})
            if exp:
                updated_names.append(f"• {exp.item_name} ({fmt_rupiah(float(exp.total_price or 0))})")
        await db.commit()

        msg_id = cb["message"].get("message_id")
        items_info = "\n".join(updated_names) if updated_names else f"{len(expense_ids)} item"
        unpaid_text = (
            f"⏳ *Status Diubah ke Belum Lunas (Hutang)*\n\n"
            f"{items_info}\n\n"
            f"_Klik tombol di bawah jika tagihan ini sudah dilunasi._"
        )
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "✅ Tandai Lunas", "callback_data": f"mark_paid:{ids_raw}"},
                    {"text": "🗑️ Batal Simpan", "callback_data": f"undo_save:{ids_raw}"},
                ],
                [{"text": "🌐 Lihat Dashboard", "url": settings.public_dashboard_url}],
            ]
        }
        if msg_id:
            await tg.edit_message(chat_id, msg_id, unpaid_text, keyboard)
        else:
            await tg.send_message(chat_id, unpaid_text, thread_id, keyboard)

    elif data.startswith("mark_paid:"):
        from app.services.expense_service import update_expense

        ids_raw = data.split(":", 1)[1]
        expense_ids = [int(x) for x in ids_raw.split(",") if x.strip().isdigit()]
        paid_names = []
        for eid in expense_ids:
            exp = await update_expense(db, eid, {"pay_status": "Lunas"})
            if exp:
                paid_names.append(f"• {exp.item_name} ({fmt_rupiah(float(exp.total_price or 0))})")
        await db.commit()

        msg_id = cb["message"].get("message_id")
        items_info = "\n".join(paid_names) if paid_names else f"{len(expense_ids)} transaksi"
        paid_text = (
            f"✅ *Tagihan Telah Dilunasi!*\n\n"
            f"{items_info}\n\n"
            f"_Status pembayaran di database telah diperbarui menjadi Lunas._"
        )
        keyboard = {
            "inline_keyboard": [
                [{"text": "🌐 Lihat Dashboard", "url": settings.public_dashboard_url}]
            ]
        }
        if msg_id:
            await tg.edit_message(chat_id, msg_id, paid_text, keyboard)
        else:
            await tg.send_message(chat_id, paid_text, thread_id, keyboard)
