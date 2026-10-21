"""
app/services/dashboard_auth_service.py — Service autentikasi PIN Telegram dan proteksi brute force
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from fastapi import Request
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.dashboard_auth import DashboardPin, DashboardAccessLog
from app.models.user import User
from app.bot import telegram_client as tg


SESSION_COOKIE_NAME = "dashboard_session"


def get_client_ip(request: Request) -> str:
    """Ambil IP address pengakses dengan memperhatikan proxy headers."""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
        if parts:
            return parts[0]
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


def create_session_token(secret_key: str | None = None, expire_hours: int | None = None) -> str:
    """Buat signed session token dengan HMAC-SHA256."""
    key = secret_key or settings.secret_key
    exp_hours = expire_hours or settings.dashboard_session_expire_hours
    now_ts = int(time.time())
    payload = {
        "sub": "dashboard_admin",
        "iat": now_ts,
        "exp": now_ts + (exp_hours * 3600),
        "nonce": secrets.token_hex(16),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    signature = hmac.new(
        key.encode("utf-8"),
        b64_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{b64_payload}.{signature}"


def verify_session_token(token: str, secret_key: str | None = None) -> bool:
    """Validasi signature dan tanggal kedaluwarsa session token."""
    if not token or "." not in token:
        return False
    key = secret_key or settings.secret_key
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False
        b64_payload, signature = parts
        expected_sig = hmac.new(
            key.encode("utf-8"),
            b64_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return False

        # Tambahkan padding jika diperlukan
        padding = 4 - (len(b64_payload) % 4)
        if padding != 4:
            b64_payload += "=" * padding

        payload_bytes = base64.urlsafe_b64decode(b64_payload.encode("utf-8"))
        payload = json.loads(payload_bytes.decode("utf-8"))

        if payload.get("exp", 0) < int(time.time()):
            return False
        return True
    except Exception:
        return False


def is_authenticated_request(request: Request) -> bool:
    """Cek apakah request memiliki cookie sesi dashboard yang sah."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return False
    return verify_session_token(token)


async def is_ip_locked_out(db: AsyncSession, ip: str) -> tuple[bool, int]:
    """
    Cek apakah IP sedang di-lockout karena terlalu banyak percobaan salah.
    Return (is_locked, remaining_seconds).
    """
    lockout_window = datetime.utcnow() - timedelta(minutes=settings.dashboard_lockout_minutes)
    
    # Hitung jumlah kesalahan verifikasi berturut-turut dalam window
    result = await db.execute(
        select(DashboardAccessLog)
        .where(
            DashboardAccessLog.ip_address == ip,
            DashboardAccessLog.action.in_(["verify_failed", "verify_success"]),
            DashboardAccessLog.created_at >= lockout_window,
        )
        .order_by(DashboardAccessLog.id.desc())
        .limit(settings.dashboard_lockout_attempts)
    )
    logs = result.scalars().all()

    # Jika log terbaru diawali oleh kegagalan sebanyak >= dashboard_lockout_attempts
    failed_count = 0
    latest_fail_time = None
    for log in logs:
        if log.action == "verify_failed":
            failed_count += 1
            if latest_fail_time is None:
                latest_fail_time = log.created_at
        else:
            break

    if failed_count >= settings.dashboard_lockout_attempts and latest_fail_time:
        lockout_end = latest_fail_time + timedelta(minutes=settings.dashboard_lockout_minutes)
        remaining = int((lockout_end - datetime.utcnow()).total_seconds())
        if remaining > 0:
            return True, remaining

    return False, 0


async def can_request_pin(db: AsyncSession, ip: str) -> tuple[bool, str]:
    """Validasi apakah IP diizinkan meminta PIN baru (cek cooldown & rate limit)."""
    # 1. Cek lockout IP
    locked, remaining = await is_ip_locked_out(db, ip)
    if locked:
        rem_min = max(1, (remaining + 59) // 60)
        return False, f"Akses diblokir sementara karena terlalu banyak percobaan salah. Silakan coba {rem_min} menit lagi."

    now = datetime.utcnow()

    # 2. Cek Cooldown (minimal interval antar request)
    res_last = await db.execute(
        select(DashboardAccessLog)
        .where(
            DashboardAccessLog.ip_address == ip,
            DashboardAccessLog.action == "request_pin",
        )
        .order_by(DashboardAccessLog.id.desc())
        .limit(1)
    )
    last_req = res_last.scalar_one_or_none()
    if last_req:
        elapsed = (now - last_req.created_at).total_seconds()
        if elapsed < settings.dashboard_pin_cooldown_seconds:
            wait_sec = int(settings.dashboard_pin_cooldown_seconds - elapsed)
            return False, f"Harap tunggu {wait_sec} detik sebelum meminta PIN baru."

    # 3. Cek Rate limit per 15 menit (maks 5 request per IP)
    window_15m = now - timedelta(minutes=15)
    res_count = await db.execute(
        select(func.count(DashboardAccessLog.id))
        .where(
            DashboardAccessLog.ip_address == ip,
            DashboardAccessLog.action == "request_pin",
            DashboardAccessLog.created_at >= window_15m,
        )
    )
    count_15m = res_count.scalar() or 0
    if count_15m >= 5:
        return False, "Terlalu banyak permintaan PIN dalam waktu singkat. Harap coba lagi beberapa menit kemudian."

    return True, ""


async def resolve_telegram_recipients(db: AsyncSession) -> list[tuple[int, int | None]]:
    """
    Tentukan tujuan pengiriman pesan PIN via Telegram.
    Return list of (chat_id, thread_id).
    """
    recipients = []

    # 1. Prioritas utama: konfigurasi khusus dashboard
    if settings.dashboard_pin_chat_id:
        try:
            cid = int(settings.dashboard_pin_chat_id.strip())
            recipients.append((cid, settings.dashboard_pin_thread_id))
            return recipients
        except ValueError:
            pass

    # 2. Prioritas kedua: report_chat_id
    if settings.report_chat_id:
        try:
            cid = int(settings.report_chat_id.strip())
            recipients.append((cid, settings.report_thread_id))
            return recipients
        except ValueError:
            pass

    # 3. Fallback: user terautentikasi di database
    result = await db.execute(
        select(User.telegram_id).where(User.is_auth == True)  # noqa: E712
    )
    user_ids = result.scalars().all()
    for uid in user_ids:
        recipients.append((uid, None))

    return recipients


async def generate_and_send_pin(db: AsyncSession, ip: str) -> tuple[bool, str]:
    """
    Hasilkan 6-digit PIN acak, simpan hash-nya di database, dan kirim via Telegram.
    Aman dari brute force dengan rate limit dan invalidasi PIN lama.
    """
    allowed, reason = await can_request_pin(db, ip)
    if not allowed:
        return False, reason

    recipients = await resolve_telegram_recipients(db)
    if not recipients:
        return False, "Telegram Chat ID belum dikonfigurasi. Harap atur DASHBOARD_PIN_CHAT_ID atau REPORT_CHAT_ID di .env."

    now = datetime.utcnow()

    # Invalidate semua PIN aktif sebelumnya untuk IP ini
    active_pins_res = await db.execute(
        select(DashboardPin).where(
            DashboardPin.ip_address == ip,
            DashboardPin.is_used == False,  # noqa: E712
        )
    )
    for p in active_pins_res.scalars().all():
        p.is_used = True

    # Generate 6-digit cryptographically secure PIN (000000 - 999999)
    pin_int = secrets.randbelow(1_000_000)
    pin_str = f"{pin_int:06d}"
    salt = secrets.token_hex(16)
    pin_hash = hashlib.sha256((pin_str + salt).encode("utf-8")).hexdigest()

    expires_at = now + timedelta(seconds=settings.dashboard_pin_expire_seconds)

    # Simpan record PIN
    new_pin = DashboardPin(
        pin_hash=pin_hash,
        salt=salt,
        ip_address=ip,
        attempts=0,
        max_attempts=settings.dashboard_pin_max_attempts,
        is_used=False,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(new_pin)

    # Log action
    db.add(
        DashboardAccessLog(
            ip_address=ip,
            action="request_pin",
            details="PIN generated & dispatched",
            created_at=now,
        )
    )
    await db.flush()

    # Format waktu WIB (UTC+7)
    wib_now = datetime.now(timezone.utc) + timedelta(hours=7)
    time_str = wib_now.strftime("%d/%m/%Y %H:%M:%S")

    msg = (
        "🔐 *Konfirmasi PIN Dashboard Historycake*\n\n"
        f"Kode PIN Anda:\n"
        f"👉 *`{pin_str}`* 👈\n\n"
        f"⏱ Berlaku: *{settings.dashboard_pin_expire_seconds // 60} menit*\n"
        f"⚠️ Batas percobaan: *{settings.dashboard_pin_max_attempts} kali*\n"
        f"🌐 Diminta dari IP: `{ip}`\n"
        f"📅 Waktu: `{time_str} WIB`\n\n"
        "_Jangan berikan kode ini kepada siapapun._"
    )

    send_success = False
    for chat_id, thread_id in recipients:
        res = await tg.send_message(chat_id=chat_id, text=msg, thread_id=thread_id)
        if res and res.get("ok"):
            send_success = True

    if not send_success:
        # Jika gagal kirim via Telegram, batalkan pin
        new_pin.is_used = True
        await db.flush()
        return False, "Gagal mengirim PIN via Telegram. Periksa koneksi bot atau chat ID."

    return True, "PIN berhasil dikirim ke Telegram! Silakan periksa pesan Telegram Anda."


async def verify_pin(db: AsyncSession, ip: str, input_pin: str) -> tuple[bool, str]:
    """
    Verifikasi input PIN dengan proteksi brute force (per-PIN attempts + IP lockout).
    """
    # 1. Cek lockout IP
    locked, remaining = await is_ip_locked_out(db, ip)
    if locked:
        rem_min = max(1, (remaining + 59) // 60)
        db.add(DashboardAccessLog(ip_address=ip, action="lockout", details="Blocked by lockout", created_at=datetime.utcnow()))
        await db.flush()
        return False, f"Akses diblokir sementara karena terlalu banyak percobaan salah. Silakan coba {rem_min} menit lagi."

    now = datetime.utcnow()
    clean_pin = (input_pin or "").strip()

    # 2. Cari PIN aktif untuk IP ini
    result = await db.execute(
        select(DashboardPin)
        .where(
            DashboardPin.ip_address == ip,
            DashboardPin.is_used == False,  # noqa: E712
            DashboardPin.expires_at > now,
        )
        .order_by(DashboardPin.id.desc())
        .limit(1)
    )
    pin_record = result.scalar_one_or_none()

    if not pin_record:
        db.add(DashboardAccessLog(ip_address=ip, action="verify_failed", details="No active PIN / expired", created_at=now))
        await db.flush()
        return False, "PIN tidak valid atau sudah kedaluwarsa. Silakan minta PIN baru via Telegram."

    # 3. Cek batas percobaan pada PIN ini
    if pin_record.attempts >= pin_record.max_attempts:
        pin_record.is_used = True
        db.add(DashboardAccessLog(ip_address=ip, action="verify_failed", details="Max PIN attempts exceeded", created_at=now))
        await db.flush()
        return False, "Batas percobaan untuk PIN ini telah habis. Silakan minta PIN baru via Telegram."

    # 4. Validasi PIN dengan constant-time comparison
    computed_hash = hashlib.sha256((clean_pin + pin_record.salt).encode("utf-8")).hexdigest()
    is_correct = hmac.compare_digest(computed_hash, pin_record.pin_hash)

    if is_correct:
        # PIN Benar -> konsumsi PIN, catat sukses
        pin_record.is_used = True
        db.add(DashboardAccessLog(ip_address=ip, action="verify_success", details="PIN verified", created_at=now))
        await db.flush()
        return True, "Verifikasi berhasil."

    # PIN Salah -> naikkan counter percobaan dan catat log
    pin_record.attempts += 1
    db.add(DashboardAccessLog(ip_address=ip, action="verify_failed", details=f"Wrong PIN, attempt {pin_record.attempts}", created_at=now))
    
    if pin_record.attempts >= pin_record.max_attempts:
        pin_record.is_used = True
        await db.flush()
        return False, "PIN salah. Batas percobaan habis. Silakan minta PIN baru via Telegram."

    remaining_attempts = pin_record.max_attempts - pin_record.attempts
    await db.flush()
    return False, f"PIN salah. Sisa kesempatan mencoba: {remaining_attempts} kali."
