"""
app/api/deps.py — API Dependencies (Auth, Granular RBAC, CSRF, Upload Validation)
"""
import hmac
from urllib.parse import urlparse
from fastapi import Request, HTTPException, status
from app.config import settings
from app.services.dashboard_auth_service import (
    is_authenticated_request,
    get_authenticated_role,
    SESSION_COOKIE_NAME,
    CSRF_COOKIE_NAME,
)

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _verify_csrf_and_origin(request: Request) -> None:
    """Lindungi sesi berbasis cookie terhadap CSRF saat mutasi."""
    if request.method.upper() in _SAFE_METHODS:
        return

    # Jika request membawa Bearer / X-Session-Token eksplisit, tidak rentan CSRF cookie
    has_header_auth = bool(
        request.headers.get("authorization") or request.headers.get("x-session-token")
    )
    has_session_cookie = bool(request.cookies.get(SESSION_COOKIE_NAME))
    if has_header_auth or not has_session_cookie:
        return

    # 1. Validasi Origin/Referer jika dikirim oleh browser
    host = (request.headers.get("host") or "").split(":")[0].lower()
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    source_url = origin or referer
    if source_url and host:
        parsed_host = (urlparse(source_url).hostname or "").lower()
        if parsed_host and parsed_host != host:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permintaan lintas origin ditolak (CSRF protection).",
            )

    # 2. Double-submit CSRF token bila cookie CSRF diterbitkan saat login
    csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
    if csrf_cookie:
        csrf_header = request.headers.get("x-csrf-token", "")
        if not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token CSRF tidak valid atau tidak ditemukan.",
            )


def require_auth(request: Request):
    """Pastikan request terautentikasi via cookie atau token header."""
    if not is_authenticated_request(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Akses tidak diizinkan. Silakan login terlebih dahulu.",
        )
    _verify_csrf_and_origin(request)
    return True


def require_roles(*allowed_roles: str):
    """Factory dependency untuk membatasi endpoint ke peran/divisi tertentu."""
    allowed = set(allowed_roles)

    def _dependency(request: Request):
        require_auth(request)
        role = get_authenticated_role(request)
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Akses ditolak. Divisi/peran Anda tidak memiliki izin untuk tindakan ini.",
            )
        return role

    return _dependency


def require_admin_role(request: Request):
    """Pastikan request memiliki hak akses admin penuh (Owner/Superadmin)."""
    require_auth(request)
    role = get_authenticated_role(request)
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak. Tindakan ini hanya dapat dilakukan oleh Owner / Super Admin.",
        )
    return True


def get_current_role(request: Request) -> str:
    """Ambil role user saat ini ('admin', 'admin_input', 'purchasing', 'warehouse', 'staff', atau 'anonymous')."""
    return get_authenticated_role(request) or "anonymous"


def validate_upload_file(
    content: bytes,
    filename: str | None,
    allowed_extensions: tuple[str, ...],
    content_type: str | None = None,
    allowed_mime_prefixes: tuple[str, ...] = (),
) -> None:
    """Validasi ukuran, ekstensi, dan tipe MIME file yang diunggah."""
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File kosong atau tidak dapat dibaca.",
        )

    max_bytes = getattr(settings, "max_upload_bytes", 10 * 1024 * 1024)
    if len(content) > max_bytes:
        max_mb = max(1, max_bytes // (1024 * 1024))
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Ukuran file terlalu besar. Maksimal {max_mb} MB.",
        )

    clean_name = (filename or "").strip().lower()
    if not clean_name or not any(clean_name.endswith(ext) for ext in allowed_extensions):
        ext_list = ", ".join(allowed_extensions)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Format file tidak valid. Ekstensi yang diizinkan: {ext_list}",
        )

    if allowed_mime_prefixes and content_type:
        ct = content_type.lower().split(";")[0].strip()
        if ct and ct != "application/octet-stream" and not any(ct.startswith(p) for p in allowed_mime_prefixes):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tipe konten file '{ct}' tidak diizinkan.",
            )
