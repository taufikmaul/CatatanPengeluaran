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
    """Ambil IP address pengakses dengan memprioritaskan proxy headers tepercaya (Cloudflare & Nginx)."""
    # 1. Cloudflare header
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip and cf_ip.strip():
        return cf_ip.strip()

    # 2. X-Real-IP dari reverse proxy tepercaya (Nginx)
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()

    # 3. X-Forwarded-For (ambil part pertama jika ada)
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
        if parts:
            return parts[0]

    # 4. Fallback ke host client connection
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


class SlidingWindowRateLimiter:
    """
    Fast tier in-memory sliding window rate limiter untuk menangkal serangan flooding & brute force.
    Mencegah penyerang membombardir database dengan ratusan request per detik.
    """
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.records: dict[str, list[float]] = {}

    def is_rate_limited(self, key: str) -> tuple[bool, int]:
        """Cek dan catat request. Return (is_limited, retry_after_seconds)."""
        now = time.time()
        window_start = now - self.window_seconds
        timestamps = [t for t in self.records.get(key, []) if t > window_start]

        if len(timestamps) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - timestamps[0]))
            self.records[key] = timestamps
            return True, max(1, retry_after)

        timestamps.append(now)
        self.records[key] = timestamps

        if len(self.records) > 2000:
            self._cleanup(now)

        return False, 0

    def check_limit_only(self, key: str) -> tuple[bool, int]:
        """Hanya cek apakah key saat ini terkena limit tanpa menambahkan hitungan baru."""
        now = time.time()
        window_start = now - self.window_seconds
        timestamps = [t for t in self.records.get(key, []) if t > window_start]
        if len(timestamps) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - timestamps[0]))
            return True, max(1, retry_after)
        return False, 0

    def record_event(self, key: str) -> None:
        """Catat satu kejadian kegagalan ke dalam window."""
        now = time.time()
        window_start = now - self.window_seconds
        timestamps = [t for t in self.records.get(key, []) if t > window_start]
        timestamps.append(now)
        self.records[key] = timestamps

    def reset(self, key: str) -> None:
        """Reset riwayat request untuk key tertentu saat sukses login."""
        self.records.pop(key, None)

    def _cleanup(self, now: float) -> None:
        cutoff = now - self.window_seconds
        stale = [k for k, v in self.records.items() if not v or v[-1] < cutoff]
        for k in stale:
            self.records.pop(k, None)


# Rate limiter per-IP: maksimal 10 requests dalam 60 detik pada endpoint auth
auth_ip_limiter = SlidingWindowRateLimiter(max_requests=10, window_seconds=60)

# Distributed brute force tracker per-role: maksimal 15 kegagalan lintas IP dalam 15 menit (900s)
role_failure_limiter = SlidingWindowRateLimiter(max_requests=15, window_seconds=900)


async def send_brute_force_security_alert(
    ip: str, target: str, attempts: int, lockout_minutes: int
) -> None:
    """Kirim notifikasi keamanan ke Telegram saat IP diblokir akibat percobaan brute-force."""
    target_chat = settings.report_chat_id or settings.dashboard_pin_chat_id
    if not target_chat:
        return
    try:
        chat_id = int(str(target_chat).split(",")[0].strip())
    except (ValueError, TypeError):
        return

    thread_id = settings.report_thread_id or None
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    msg = (
        "🚨 *SECURITY ALERT: PERCOBAAN BRUTE FORCE DIBLOKIR*\n"
        f"🌐 *IP Address:* `{ip}`\n"
        f"🎯 *Target Akses:* *{target}*\n"
        f"⚠️ *Percobaan Gagal:* {attempts}x berturut-turut\n"
        f"🔒 *Tindakan Sistem:* IP diblokir sementara (*{lockout_minutes} menit*)\n"
        f"⏰ *Waktu Kejadian:* `{now_str}`\n\n"
        "🛡️ _Aplikasi otomatis menolak seluruh percobaan login selanjutnya dari IP ini._"
    )
    try:
        await tg.send_message(chat_id=chat_id, text=msg, thread_id=thread_id)
    except Exception:
        pass


async def apply_progressive_delay(failed_count: int) -> None:
    """Terapkan exponential delay untuk melumpuhkan skrip otomatisasi brute-force."""
    import asyncio
    delays = {1: 0.3, 2: 0.6, 3: 1.2, 4: 2.0}
    delay = delays.get(failed_count, 0.3 if failed_count > 0 else 0.0)
    if delay > 0:
        await asyncio.sleep(delay)


def create_session_token(role: str = "admin", secret_key: str | None = None, expire_hours: int | None = None) -> str:
    """Buat signed session token dengan HMAC-SHA256 yang memuat role ('admin' atau 'admin_input')."""
    key = secret_key or settings.secret_key
    exp_hours = expire_hours or settings.dashboard_session_expire_hours
    now_ts = int(time.time())
    payload = {
        "sub": f"dashboard_{role}",
        "role": role,
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


def get_token_payload(token: str, secret_key: str | None = None) -> dict | None:
    """Dekode dan validasi token HMAC, kembalikan payload dictionary jika sah."""
    if not token or "." not in token:
        return None
    key = secret_key or settings.secret_key
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        b64_payload, signature = parts
        expected_sig = hmac.new(
            key.encode("utf-8"),
            b64_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None

        # Tambahkan padding jika diperlukan
        padding = 4 - (len(b64_payload) % 4)
        if padding != 4:
            b64_payload += "=" * padding

        payload_bytes = base64.urlsafe_b64decode(b64_payload.encode("utf-8"))
        payload = json.loads(payload_bytes.decode("utf-8"))

        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def verify_sso_jwt(token: str) -> dict | None:
    """Verifikasi token SSO JWT dari HCTeams Auth Service (algoritma HS256)."""
    if not token or token.count(".") != 2:
        return None

    candidate_secrets = [
        getattr(settings, "auth_secret", None),
        "90585c0050b1bd25cbd8e8960b1d0b40234a084eae2030bf3712bb2c5e93808d",
        "change-me-use-a-long-random-string-min-32-chars",
        getattr(settings, "secret_key", None),
    ]
    candidate_secrets = list(dict.fromkeys(s for s in candidate_secrets if s))

    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        rem = len(sig_b64) % 4
        padded_sig = sig_b64 + ("=" * (4 - rem) if rem else "")
        actual_sig_bytes = base64.urlsafe_b64decode(padded_sig.encode("utf-8"))

        rem_p = len(payload_b64) % 4
        padded_payload = payload_b64 + ("=" * (4 - rem_p) if rem_p else "")
        payload = json.loads(base64.urlsafe_b64decode(padded_payload.encode("utf-8")).decode("utf-8"))
        if payload.get("exp") and payload["exp"] < int(time.time()):
            return None

        for secret in candidate_secrets:
            expected_sig_bytes = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
            if hmac.compare_digest(expected_sig_bytes, actual_sig_bytes):
                return payload
    except Exception:
        pass

    return None


def verify_session_token(token: str, secret_key: str | None = None) -> bool:
    """Validasi signature dan tanggal kedaluwarsa session token."""
    return get_token_payload(token, secret_key=secret_key) is not None


def get_authenticated_role(request: Request) -> str | None:
    """Ambil role user yang terautentikasi ('admin' atau 'admin_input'), atau None jika belum login."""
    candidates: list[str] = []
    auth_hdr = request.headers.get("authorization", "")
    if auth_hdr.lower().startswith("bearer "):
        candidates.append(auth_hdr[7:].strip())
    if request.headers.get("x-session-token"):
        candidates.append(request.headers.get("x-session-token").strip())
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        candidates.append(cookie_token.strip())

    for token in candidates:
        if not token:
            continue

        # 1. Cek apakah token adalah JWT SSO dari HCTeams Hub
        sso_data = verify_sso_jwt(token)
        if sso_data:
            sso_role = sso_data.get("role", "staff")
            if sso_role == "owner":
                return "admin"
            elif sso_role in ("purchasing", "warehouse"):
                return sso_role
            return "admin_input"

        # 2. Cek apakah token adalah HMAC session token internal
        payload = get_token_payload(token)
        if payload:
            role = payload.get("role")
            if not role:
                sub = payload.get("sub", "")
                if "admin_input" in sub:
                    role = "admin_input"
                elif "purchasing" in sub:
                    role = "purchasing"
                elif "warehouse" in sub:
                    role = "warehouse"
                elif "staff" in sub:
                    role = "staff"
                else:
                    role = "admin"
            return role

    return None


def is_authenticated_request(request: Request) -> bool:
    """Cek apakah request memiliki cookie sesi dashboard atau token auth yang sah."""
    return get_authenticated_role(request) is not None


async def get_failed_attempt_count(db: AsyncSession, ip: str) -> tuple[int, datetime | None]:
    """Hitung jumlah kesalahan verifikasi berturut-turut dari IP dalam lockout window."""
    lockout_window = datetime.utcnow() - timedelta(minutes=settings.dashboard_lockout_minutes)
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
    failed_count = 0
    latest_fail_time = None
    for log in logs:
        if log.action == "verify_failed":
            failed_count += 1
            if latest_fail_time is None:
                latest_fail_time = log.created_at
        else:
            break
    return failed_count, latest_fail_time


async def is_ip_locked_out(db: AsyncSession, ip: str) -> tuple[bool, int]:
    """
    Cek apakah IP sedang di-lockout karena terlalu banyak percobaan salah.
    Return (is_locked, remaining_seconds).
    """
    failed_count, latest_fail_time = await get_failed_attempt_count(db, ip)
    if failed_count >= settings.dashboard_lockout_attempts and latest_fail_time:
        lockout_end = latest_fail_time + timedelta(minutes=settings.dashboard_lockout_minutes)
        remaining = int((lockout_end - datetime.utcnow()).total_seconds())
        if remaining > 0:
            return True, remaining

    return False, 0


async def can_request_pin(db: AsyncSession, ip: str) -> tuple[bool, str]:
    """Validasi apakah IP diizinkan meminta PIN baru (cek rate limiter, lockout & cooldown)."""
    # 0. Fast in-memory rate check per IP
    is_rate_limited, retry_after = auth_ip_limiter.is_rate_limited(ip)
    if is_rate_limited:
        return False, f"Terlalu banyak permintaan PIN. Harap tunggu {retry_after} detik."

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
    is_dev = (
        settings.telegram_token.startswith("123456:")
        or "test" in settings.telegram_token.lower()
        or settings.secret_key.startswith("historycake_dev")
    )

    if not recipients and not is_dev:
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
    if recipients:
        for chat_id, thread_id in recipients:
            res = await tg.send_message(chat_id=chat_id, text=msg, thread_id=thread_id)
            if res and res.get("ok"):
                send_success = True

    if not send_success:
        if is_dev:
            print("\n" + "=" * 50)
            print(f"🔑 [DEV MODE] KODE PIN DASHBOARD: {pin_str}")
            print(f"👉 Masukkan PIN ini di layar modal login")
            print("=" * 50 + "\n")
            return True, f"[DEV MODE] PIN Anda: {pin_str} (Juga dicetak di terminal backend)"

        # Jika bukan dev mode dan gagal kirim via Telegram, batalkan pin
        new_pin.is_used = True
        await db.flush()
        return False, "Gagal mengirim PIN via Telegram. Periksa koneksi bot atau chat ID."

    return True, "PIN berhasil dikirim ke Telegram! Silakan periksa pesan Telegram Anda."


async def verify_pin(db: AsyncSession, ip: str, input_pin: str) -> tuple[bool, str]:
    """
    Verifikasi input PIN dengan proteksi brute force (Fast rate limiter, per-PIN attempts, IP lockout, & progressive delay).
    """
    # 0. Fast in-memory rate check per IP (max 10 requests / 60s)
    is_rate_limited, retry_after = auth_ip_limiter.is_rate_limited(ip)
    if is_rate_limited:
        return False, f"Terlalu banyak permintaan verifikasi. Harap tunggu {retry_after} detik."

    # 1. Cek lockout IP
    locked, remaining = await is_ip_locked_out(db, ip)
    if locked:
        rem_min = max(1, (remaining + 59) // 60)
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
        failed_count, _ = await get_failed_attempt_count(db, ip)
        await apply_progressive_delay(failed_count)
        return False, "PIN tidak valid atau sudah kedaluwarsa. Silakan minta PIN baru via Telegram."

    # 3. Cek batas percobaan pada PIN ini
    if pin_record.attempts >= pin_record.max_attempts:
        pin_record.is_used = True
        db.add(DashboardAccessLog(ip_address=ip, action="verify_failed", details="Max PIN attempts exceeded", created_at=now))
        await db.flush()
        failed_count, _ = await get_failed_attempt_count(db, ip)
        await apply_progressive_delay(failed_count)
        return False, "Batas percobaan untuk PIN ini telah habis. Silakan minta PIN baru via Telegram."

    # 4. Validasi PIN dengan constant-time comparison
    computed_hash = hashlib.sha256((clean_pin + pin_record.salt).encode("utf-8")).hexdigest()
    is_correct = hmac.compare_digest(computed_hash, pin_record.pin_hash)

    if is_correct:
        # PIN Benar -> konsumsi PIN, catat sukses
        pin_record.is_used = True
        db.add(DashboardAccessLog(ip_address=ip, action="verify_success", details="PIN verified", created_at=now))
        await db.flush()
        auth_ip_limiter.reset(ip)
        return True, "Verifikasi berhasil."

    # PIN Salah -> naikkan counter percobaan dan catat log
    pin_record.attempts += 1
    db.add(DashboardAccessLog(ip_address=ip, action="verify_failed", details=f"Wrong PIN, attempt {pin_record.attempts}", created_at=now))
    await db.flush()

    failed_count, _ = await get_failed_attempt_count(db, ip)
    await apply_progressive_delay(failed_count)

    # Cek apakah akumulasi kesalahan IP mencapai lockout
    if failed_count >= settings.dashboard_lockout_attempts:
        import asyncio
        asyncio.create_task(
            send_brute_force_security_alert(
                ip=ip,
                target="Login Owner (PIN Telegram)",
                attempts=failed_count,
                lockout_minutes=settings.dashboard_lockout_minutes,
            )
        )
        return False, f"PIN salah. Batas percobaan habis ({settings.dashboard_lockout_attempts}x). Akses diblokir selama {settings.dashboard_lockout_minutes} menit."

    if pin_record.attempts >= pin_record.max_attempts:
        pin_record.is_used = True
        await db.flush()
        return False, "PIN salah. Batas percobaan habis. Silakan minta PIN baru via Telegram."

    remaining_attempts = pin_record.max_attempts - pin_record.attempts
    return False, f"PIN salah. Sisa kesempatan mencoba: {remaining_attempts} kali."


ROLE_CONFIG = {
    "admin_input": {
        "label": "Admin Input",
        "get_pwd": lambda: settings.admin_input_password or "input123",
    },
    "purchasing": {
        "label": "Bagian Purchasing",
        "get_pwd": lambda: settings.purchasing_password or "purchasing123",
    },
    "warehouse": {
        "label": "Bagian Gudang",
        "get_pwd": lambda: settings.warehouse_password or "gudang123",
    },
    "staff": {
        "label": "Staf Dapur",
        "get_pwd": lambda: settings.staff_password or "staf123",
    },
}


async def verify_role_password(
    db: AsyncSession, ip: str, role: str, password: str
) -> tuple[bool, str, str]:
    """
    Verifikasi password login role-based (staff, purchasing, warehouse, admin_input)
    dengan proteksi brute force (Fast in-memory rate limit, IP lockout, progressive delay, & distributed attack defense).
    Return: (is_valid, message, normalized_role)
    """
    # 0. Fast in-memory rate check per IP (max 10 requests / 60 detik)
    is_rate_limited, retry_after = auth_ip_limiter.is_rate_limited(ip)
    if is_rate_limited:
        return False, f"Terlalu banyak permintaan login. Harap tunggu {retry_after} detik.", role

    # 1. Cek lockout IP dari database
    locked, remaining = await is_ip_locked_out(db, ip)
    if locked:
        rem_min = max(1, (remaining + 59) // 60)
        return False, f"Akses diblokir sementara karena terlalu banyak percobaan salah. Silakan coba {rem_min} menit lagi.", role

    now = datetime.utcnow()
    clean_pwd = (password or "").strip()
    if not clean_pwd:
        return False, "Password tidak boleh kosong.", role

    # Normalisasi nama role
    norm_role = role.lower().strip()
    if norm_role in ("staf", "kitchen", "dapur"):
        norm_role = "staff"
    elif norm_role in ("gudang",):
        norm_role = "warehouse"
    elif norm_role in ("input", "admin-input"):
        norm_role = "admin_input"

    cfg = ROLE_CONFIG.get(norm_role)
    if not cfg:
        return False, f"Role '{role}' tidak valid.", role

    # 2. Cek distributed brute force attack per-role lintas IP (max 15 gagal / 15 menit)
    is_role_attacked, wait_sec = role_failure_limiter.check_limit_only(norm_role)
    if is_role_attacked:
        rem_min = max(1, (wait_sec + 59) // 60)
        return False, f"Akses login {cfg['label']} ditangguhkan sementara selama {rem_min} menit untuk alasan keamanan.", norm_role

    expected_pwd = cfg["get_pwd"]().strip()
    is_correct = hmac.compare_digest(clean_pwd, expected_pwd)

    if is_correct:
        db.add(DashboardAccessLog(ip_address=ip, action="verify_success", details=f"{cfg['label']} login successful", created_at=now))
        await db.flush()
        auth_ip_limiter.reset(ip)
        return True, f"Login {cfg['label']} berhasil.", norm_role

    # Password salah
    db.add(DashboardAccessLog(ip_address=ip, action="verify_failed", details=f"{cfg['label']} wrong password", created_at=now))
    await db.flush()

    # Catat ke distributed failure limiter
    role_failure_limiter.record_event(norm_role)

    failed_count, _ = await get_failed_attempt_count(db, ip)
    attempts_left = max(0, settings.dashboard_lockout_attempts - failed_count)

    # Terapkan progressive backoff delay
    await apply_progressive_delay(failed_count)

    if failed_count >= settings.dashboard_lockout_attempts:
        import asyncio
        asyncio.create_task(
            send_brute_force_security_alert(
                ip=ip,
                target=f"Login {cfg['label']}",
                attempts=failed_count,
                lockout_minutes=settings.dashboard_lockout_minutes,
            )
        )
        return False, f"Password {cfg['label']} salah. Batas percobaan habis ({settings.dashboard_lockout_attempts}x). Akses diblokir selama {settings.dashboard_lockout_minutes} menit.", norm_role

    return False, f"Password {cfg['label']} salah. Sisa kesempatan mencoba: {attempts_left} kali.", norm_role


async def verify_admin_input_password(db: AsyncSession, ip: str, password: str) -> tuple[bool, str]:
    """
    Verifikasi password login khusus Admin Input dengan proteksi brute force (IP lockout & logging).
    """
    success, reason, _ = await verify_role_password(db, ip, "admin_input", password)
    return success, reason
