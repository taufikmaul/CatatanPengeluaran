"""
app/services/telegram_sync_service.py: Sinkronisasi penginput transaksi dari tautan pesan Telegram
"""
import asyncio
import logging
import re
import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.expense import Expense
from app.models.user import User

logger = logging.getLogger(__name__)


def parse_telegram_msg_link(link: str) -> tuple[int | str | None, int | None]:
    """Ekstrak (from_chat_id, message_id) dari tautan pesan Telegram."""
    if not link or "t.me" not in link:
        return None, None

    # Format supergroup private: https://t.me/c/3586832862/7/3499 atau https://t.me/c/3586832862/3499
    c_match = re.search(r"t\.me/c/(\d+)(?:/(\d+))?/(\d+)", link)
    if c_match:
        raw_chat = c_match.group(1)
        msg_id = int(c_match.group(3))
        from_chat_id = -int(f"100{raw_chat}") if not raw_chat.startswith("100") else -int(raw_chat)
        return from_chat_id, msg_id

    # Format public chat: https://t.me/username/7/3499 atau https://t.me/username/3499
    pub_match = re.search(r"t\.me/([a-zA-Z0-9_]+)(?:/(\d+))?/(\d+)", link)
    if pub_match and pub_match.group(1) != "c":
        from_chat_id = f"@{pub_match.group(1)}"
        msg_id = int(pub_match.group(3))
        return from_chat_id, msg_id

    return None, None


async def sync_telegram_users_from_links(
    db: AsyncSession,
    target_chat_id: int | None = None,
    batch_delay_seconds: float = 0.08,
) -> dict:
    """
    Telusuri transaksi yang belum memiliki user_id namun memiliki msg_link Telegram.
    Gunakan forwardMessage + deleteMessage secara senyap untuk mendapatkan identitas
    pengirim asli (forward_from / forward_origin / forward_sender_name),
    lalu hubungkan ke tabel users dan perbarui kolom expenses.user_id.
    """
    # 1. Cari target chat_id penerima forward jika tidak dispesifikasikan
    if not target_chat_id:
        res_admin = await db.execute(
            select(User.telegram_id).where(User.is_auth == True).limit(1)  # noqa: E712
        )
        target_chat_id = res_admin.scalar_one_or_none()
        if not target_chat_id and settings.admin_telegram_ids:
            try:
                target_chat_id = int(settings.admin_telegram_ids.split(",")[0].strip())
            except Exception:
                target_chat_id = None

    if not target_chat_id:
        return {
            "ok": False,
            "error": "Tidak ditemukan target chat Telegram admin untuk proses verifikasi forward message.",
        }

    # 2. Ambil seluruh transaksi tanpa user_id yang memiliki link Telegram
    res_expenses = await db.execute(
        select(Expense.id, Expense.msg_link)
        .where(Expense.user_id.is_(None), Expense.msg_link.like("%t.me%"))
    )
    rows = res_expenses.all()
    if not rows:
        return {
            "ok": True,
            "message": "Semua transaksi dengan link Telegram sudah terhubung dengan user.",
            "updated_count": 0,
            "links_processed": 0,
        }

    # Kelompokkan expense IDs berdasarkan msg_link
    link_to_expense_ids: dict[str, list[int]] = {}
    for exp_id, link in rows:
        link_to_expense_ids.setdefault(link.strip(), []).append(exp_id)

    # Ambil cache user yang sudah ada di database
    res_users = await db.execute(select(User))
    all_users = res_users.scalars().all()
    user_by_tg_id: dict[int, User] = {u.telegram_id: u for u in all_users if u.telegram_id}
    user_by_name: dict[str, User] = {u.name.lower().strip(): u for u in all_users if u.name}

    updated_count = 0
    resolved_links = 0
    failed_links = 0
    token = settings.telegram_token
    api_base = f"https://api.telegram.org/bot{token}"

    async with httpx.AsyncClient(timeout=15) as client:
        for link, exp_ids in link_to_expense_ids.items():
            from_chat_id, msg_id = parse_telegram_msg_link(link)
            if not from_chat_id or not msg_id:
                failed_links += 1
                continue

            try:
                # Forward message ke target chat secara senyap
                fwd_res = await client.post(
                    f"{api_base}/forwardMessage",
                    json={
                        "chat_id": target_chat_id,
                        "from_chat_id": from_chat_id,
                        "message_id": msg_id,
                        "disable_notification": True,
                    },
                )
                fwd_data = fwd_res.json()
                if not fwd_data.get("ok"):
                    failed_links += 1
                    await asyncio.sleep(batch_delay_seconds)
                    continue

                result_obj = fwd_data["result"]
                fwd_msg_id = result_obj.get("message_id")

                # Hapus pesan forwarded sesegera mungkin
                if fwd_msg_id:
                    try:
                        await client.post(
                            f"{api_base}/deleteMessage",
                            json={"chat_id": target_chat_id, "message_id": fwd_msg_id},
                        )
                    except Exception:
                        pass

                # Ekstraksi identitas sender
                tg_user_id = None
                display_name = None

                # 1. Dari forward_origin (Telegram Bot API 7.0+)
                fwd_origin = result_obj.get("forward_origin") or {}
                if fwd_origin.get("type") == "user" and fwd_origin.get("sender_user"):
                    su = fwd_origin["sender_user"]
                    tg_user_id = su.get("id")
                    first_name = su.get("first_name", "") or ""
                    last_name = su.get("last_name", "") or ""
                    username = su.get("username", "") or ""
                    display_name = f"{first_name} {last_name}".strip() or username
                elif fwd_origin.get("sender_user_name"):
                    display_name = fwd_origin["sender_user_name"]

                # 2. Fallback: forward_from tradisional
                if not tg_user_id and result_obj.get("forward_from"):
                    ff = result_obj["forward_from"]
                    tg_user_id = ff.get("id")
                    first_name = ff.get("first_name", "") or ""
                    last_name = ff.get("last_name", "") or ""
                    username = ff.get("username", "") or ""
                    display_name = f"{first_name} {last_name}".strip() or username

                # 3. Fallback: forward_sender_name
                if not display_name and result_obj.get("forward_sender_name"):
                    display_name = result_obj["forward_sender_name"]

                target_user: User | None = None

                if tg_user_id:
                    if tg_user_id in user_by_tg_id:
                        target_user = user_by_tg_id[tg_user_id]
                        if display_name and (not target_user.name or target_user.name.startswith("User #")):
                            target_user.name = display_name
                    else:
                        new_user = User(
                            telegram_id=tg_user_id,
                            name=display_name or f"User #{tg_user_id}",
                            is_auth=False,
                        )
                        db.add(new_user)
                        await db.flush()
                        user_by_tg_id[tg_user_id] = new_user
                        if new_user.name:
                            user_by_name[new_user.name.lower().strip()] = new_user
                        target_user = new_user
                elif display_name:
                    clean_name = display_name.lower().strip()
                    if clean_name in user_by_name:
                        target_user = user_by_name[clean_name]

                if target_user:
                    await db.execute(
                        update(Expense)
                        .where(Expense.id.in_(exp_ids))
                        .values(user_id=target_user.id)
                    )
                    updated_count += len(exp_ids)
                    resolved_links += 1
                else:
                    failed_links += 1

            except Exception as e:
                logger.warning("Gagal memproses sync Telegram link %s: %s", link, e)
                failed_links += 1

            await asyncio.sleep(batch_delay_seconds)

    await db.commit()
    return {
        "ok": True,
        "message": f"Sinkronisasi selesai. Berhasil menghubungkan {updated_count} transaksi ({resolved_links} tautan Telegram).",
        "updated_count": updated_count,
        "links_processed": resolved_links,
        "failed_links": failed_links,
    }
