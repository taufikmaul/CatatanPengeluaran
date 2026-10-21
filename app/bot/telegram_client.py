"""
app/bot/telegram_client.py — Telegram API client (async httpx)
Pengganti UrlFetchApp GAS: sendMessage, editMessage, getFile, dll
"""
import httpx
import base64
from typing import Any
from app.config import settings

TELEGRAM_BASE = f"https://api.telegram.org/bot{settings.telegram_token}"


async def send_message(
    chat_id: int,
    text: str,
    thread_id: int | None = None,
    reply_markup: dict | None = None,
    parse_mode: str = "Markdown",
) -> dict | None:
    """Kirim pesan Telegram. Return response JSON."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }
    if thread_id:
        payload["message_thread_id"] = thread_id
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(f"{TELEGRAM_BASE}/sendMessage", json=payload)
            return res.json()
    except Exception:
        return None


async def edit_message(
    chat_id: int,
    message_id: int,
    text: str,
    reply_markup: dict | None = None,
    parse_mode: str = "Markdown",
) -> None:
    """Edit pesan yang sudah ada (untuk update progress bar)."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": parse_mode,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(f"{TELEGRAM_BASE}/editMessageText", json=payload)
    except Exception:
        pass


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


def build_msg_link(chat_id: int, chat_type: str, thread_id: int | None, msg_id: int) -> str:
    """Build link langsung ke pesan Telegram."""
    if chat_type in ("supergroup", "group"):
        clean_id = str(chat_id).replace("-100", "")
        if thread_id:
            return f"https://t.me/c/{clean_id}/{thread_id}/{msg_id}"
        return f"https://t.me/c/{clean_id}/{msg_id}"
    return "Private Chat"
