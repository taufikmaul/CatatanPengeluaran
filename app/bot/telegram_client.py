"""
app/bot/telegram_client.py — Telegram API client (async httpx)
Pengganti UrlFetchApp GAS: sendMessage, editMessage, getFile, dll
"""
import httpx
import base64
import logging
from typing import Any
from app.config import settings

logger = logging.getLogger(__name__)
TELEGRAM_BASE = f"https://api.telegram.org/bot{settings.telegram_token}"


async def send_message(
    chat_id: int,
    text: str,
    thread_id: int | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = "Markdown",
) -> dict | None:
    """Kirim pesan Telegram. Return response JSON dengan fallback jika entity markdown error atau thread id invalid."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    # Chat pribadi (chat_id > 0) tidak menggunakan thread/forum topic
    if thread_id and chat_id < 0:
        payload["message_thread_id"] = thread_id
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(f"{TELEGRAM_BASE}/sendMessage", json=payload)
            data = res.json()
            if not data.get("ok"):
                desc = str(data.get("description", "")).lower()
                payload_fallback = dict(payload)
                modified = False
                if "message_thread_id" in payload_fallback and "thread" in desc:
                    payload_fallback.pop("message_thread_id", None)
                    modified = True
                if parse_mode and ("parse" in desc or "entity" in desc):
                    payload_fallback.pop("parse_mode", None)
                    modified = True
                if modified:
                    logger.warning(
                        "Telegram sendMessage failed (%s). Retrying with fallback payload.",
                        data.get("description"),
                    )
                    res_fb = await client.post(f"{TELEGRAM_BASE}/sendMessage", json=payload_fallback)
                    return res_fb.json()
            return data
    except Exception as e:
        logger.error("Exception in send_message: %s", e)
        return None


async def edit_message(
    chat_id: int,
    message_id: int,
    text: str,
    reply_markup: dict | None = None,
    parse_mode: str | None = "Markdown",
) -> dict | None:
    """Edit pesan yang sudah ada (untuk update progress bar). Dilengkapi fallback jika entity error."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(f"{TELEGRAM_BASE}/editMessageText", json=payload)
            data = res.json()
            if not data.get("ok") and parse_mode:
                desc = (data.get("description") or "").lower()
                if "message is not modified" in desc:
                    return data

                logger.warning(
                    "Telegram editMessageText failed with parse_mode=%s (%s). Retrying without parse_mode.",
                    parse_mode,
                    data.get("description"),
                )
                payload_fallback = dict(payload)
                payload_fallback.pop("parse_mode", None)
                res_fb = await client.post(f"{TELEGRAM_BASE}/editMessageText", json=payload_fallback)
                return res_fb.json()
            return data
    except Exception as e:
        logger.error("Exception in edit_message: %s", e)
        return None


async def answer_callback_query(callback_query_id: str, text: str = "") -> None:
    """Jawab callback query agar loading spinner hilang."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{TELEGRAM_BASE}/answerCallbackQuery",
                json={"callback_query_id": callback_query_id, "text": text},
            )
    except Exception:
        pass


async def update_progress(
    chat_id: int,
    msg_id: int,
    step: int,
    status: str,
    total_steps: int = 4,
) -> None:
    """Update progress bar di pesan yang sudah ada."""
    from app.utils.formatters import build_progress_text
    text = build_progress_text(step, status, total_steps)
    await edit_message(chat_id, msg_id, text)


async def get_file_base64(file_id: str) -> str | None:
    """
    Download file Telegram (foto/audio) dan return sebagai base64 string.
    Menggantikan getTelegramImageBase64 dan getTelegramVoiceBase64 dari GAS.
    """
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # 1. Dapatkan file path
            res = await client.get(f"{TELEGRAM_BASE}/getFile?file_id={file_id}")
            file_path = res.json()["result"]["file_path"]

            # 2. Download file bytes
            file_url = f"https://api.telegram.org/file/bot{settings.telegram_token}/{file_path}"
            file_res = await client.get(file_url)
            
            return base64.b64encode(file_res.content).decode("utf-8")
    except Exception:
        return None


async def set_webhook(url: str) -> dict:
    """Set webhook URL ke Telegram."""
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{TELEGRAM_BASE}/setWebhook",
            json={"url": url, "allowed_updates": ["message", "callback_query"]},
        )
        return res.json()


def build_msg_link(
    chat_id: int,
    chat_type: str,
    thread_id: int | None,
    msg_id: int,
    chat_username: str | None = None,
) -> str:
    """Build link langsung ke pesan Telegram."""
    if chat_username:
        if thread_id:
            return f"https://t.me/{chat_username}/{thread_id}/{msg_id}"
        return f"https://t.me/{chat_username}/{msg_id}"

    if chat_type in ("supergroup", "group"):
        clean_id = str(chat_id)
        if clean_id.startswith("-100"):
            clean_id = clean_id[4:]
        elif clean_id.startswith("-"):
            clean_id = clean_id[1:]
        if thread_id:
            return f"https://t.me/c/{clean_id}/{thread_id}/{msg_id}"
        return f"https://t.me/c/{clean_id}/{msg_id}"

    if chat_type == "private":
        if chat_id:
            return f"tg://user?id={chat_id}"
        return "Private Chat"

    return "Private Chat"
