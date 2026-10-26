"""
app/bot/webhook.py — FastAPI router untuk Telegram webhook
Menggantikan doPost() di Google Apps Script
"""
import asyncio
import traceback
from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.utils.auth import is_user_authenticated, authenticate_user, get_or_create_user
from app.bot import telegram_client as tg
from app.bot.callbacks import handle_callback_query
from app.agent.hermes import HermesAgent

router = APIRouter()

# Cache sederhana untuk deduplikasi callback (in-memory, cukup untuk 1 worker)
_processed_callbacks: set[str] = set()


@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Entry point utama — semua update dari Telegram masuk sini.
    Port dari doPost() di GAS.
    """
    try:
        update = await request.json()

        # ── Callback Query (tombol inline) ──
        if "callback_query" in update:
            cb = update["callback_query"]
            cb_id = cb["id"]

            # Deduplikasi
            if cb_id in _processed_callbacks:
                return {"ok": True}
            _processed_callbacks.add(cb_id)
            # Cleanup jika terlalu besar
            if len(_processed_callbacks) > 1000:
                _processed_callbacks.clear()

            asyncio.create_task(handle_callback_query(cb, db))
            return {"ok": True}

        # ── Pesan Biasa ──
        message = update.get("message")
        if not message:
            return {"ok": True}

        chat_id = message["chat"]["id"]
        chat_type = message["chat"]["type"]
        thread_id = message.get("message_thread_id")
        sender_id = message["from"]["id"]
        sender_name = (
            message["from"].get("first_name", "")
            + (" " + message["from"].get("last_name", "") if message["from"].get("last_name") else "")
        ).strip()
        text = (message.get("text") or "").strip()
        msg_id = message["message_id"]
        chat_username = message.get("chat", {}).get("username")

        # Build msg link
        msg_link = tg.build_msg_link(chat_id, chat_type, thread_id, msg_id, chat_username=chat_username)

        # ── Autentikasi ──
        is_authorized = False

        if chat_type == "private":
            if await is_user_authenticated(db, sender_id):
                is_authorized = True
            else:
                if text == settings.bot_password:
                    await authenticate_user(db, sender_id, sender_name)
                    await db.commit()
                    await tg.send_message(chat_id, "🔓 *Akses Diterima! Selamat datang.*", thread_id)
                    # Lanjut ke pipeline normal (menu tampil dari classify_intent)
                    is_authorized = True
                else:
                    await tg.send_message(chat_id, "🔒 *Bot Terkunci.* Masukkan password.", thread_id)
                    return {"ok": True}

        elif chat_type in ("group", "supergroup"):
            if thread_id == settings.allowed_thread_id:
                is_authorized = True

        if not is_authorized:
            return {"ok": True}

        # ── Get or create user ──
        user = await get_or_create_user(db, sender_id, sender_name)
        await db.commit()

        # ── Media: foto ──
        if message.get("photo"):
            photo = message["photo"]
            # Pilih resolusi optimal (second-to-last untuk hemat bandwidth)
            photo_idx = len(photo) - 2 if len(photo) > 1 else len(photo) - 1
            file_id = photo[photo_idx]["file_id"]
            caption = (message.get("caption") or "").strip()

            # Download async di background untuk tidak block
            asyncio.create_task(
                _process_photo(
                    file_id=file_id,
                    caption=caption,
                    chat_id=chat_id,
                    thread_id=thread_id,
                    msg_link=msg_link,
                    user_id=user.id,
                    sender_name=sender_name,
                    db=db,
                )
            )
            return {"ok": True}

        # ── Media: voice note ──
        if message.get("voice"):
            file_id = message["voice"]["file_id"]
            asyncio.create_task(
                _process_voice(
                    file_id=file_id,
                    chat_id=chat_id,
                    thread_id=thread_id,
                    msg_link=msg_link,
                    user_id=user.id,
                    db=db,
                )
            )
            return {"ok": True}

        # ── Teks (commands + natural language) ──
        if text:
            agent = HermesAgent(db, user.id, chat_id, thread_id)
            await agent.process(
                text=text,
                msg_link=msg_link,
                sender_name=sender_name,
            )
            await db.commit()

    except Exception as e:
        # Jangan telan exception: traceback wajib muncul di log container.
        traceback.print_exc()
        print(f"[WEBHOOK ERROR] {type(e).__name__}: {e}")

    return {"ok": True}


# ──────────────────────────────────────────────
# Background task helpers
# ──────────────────────────────────────────────

async def _process_photo(
    file_id: str,
    caption: str,
    chat_id: int,
    thread_id: int | None,
    msg_link: str,
    user_id: int,
    sender_name: str,
    db: AsyncSession,
) -> None:
    """Download foto dan proses dengan Hermes Agent."""
    from app.database.connection import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as session:
            base64_img = await tg.get_file_base64(file_id)
            agent = HermesAgent(session, user_id, chat_id, thread_id)
            await agent.process(
                has_photo=True,
                photo_base64=base64_img,
                caption=caption,
                msg_link=msg_link,
                sender_name=sender_name,
            )
            await session.commit()
    except Exception as e:
        traceback.print_exc()
        print(f"[_process_photo error] {e}")


async def _process_voice(
    file_id: str,
    chat_id: int,
    thread_id: int | None,
    msg_link: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    """Download voice note dan proses dengan Hermes Agent."""
    from app.database.connection import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as session:
            base64_audio = await tg.get_file_base64(file_id)
            agent = HermesAgent(session, user_id, chat_id, thread_id)
            await agent.process(
                has_voice=True,
                voice_base64=base64_audio,
                msg_link=msg_link,
            )
            await session.commit()
    except Exception as e:
        traceback.print_exc()
        print(f"[_process_voice error] {e}")
