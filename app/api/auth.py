"""
app/api/auth.py — REST API Authentication Endpoints
"""
import secrets
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.services.dashboard_auth_service import (
    get_authenticated_role,
    get_client_ip,
    generate_and_send_pin,
    verify_pin,
    verify_admin_input_password,
    verify_role_password,
    verify_sso_jwt,
    resolve_sso_role,
    create_session_token,
    SESSION_COOKIE_NAME,
    CSRF_COOKIE_NAME,
)
from app.api.schemas import (
    AuthStatusResponse,
    AuthPermissions,
    PinVerifyRequest,
    AdminInputLoginRequest,
    RoleLoginRequest,
    SsoExchangeRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])

ROLE_LABELS: dict[str, str] = {
    "admin": "Owner / Super Admin",
    "purchasing": "Bagian Purchasing",
    "warehouse": "Bagian Gudang",
    "staff": "Staf Dapur / Karyawan",
    "admin_input": "Admin Input",
}


def get_role_permissions(role: str) -> AuthPermissions:
    if role == "admin":
        return AuthPermissions(
            can_edit=True,
            can_delete=True,
            can_view_charts=True,
            can_manage_config=True,
            can_manage_requests=True,
            can_approve_requests=True,
            can_order_purchasing=True,
            can_receive_warehouse=True,
            can_settle_talangan=True,
            can_access_warehouse=True,
        )
    elif role == "purchasing":
        return AuthPermissions(
            can_edit=True,
            can_delete=False,
            can_view_charts=False,
            can_manage_config=False,
            can_manage_requests=True,
            can_approve_requests=False,
            can_order_purchasing=True,
            can_receive_warehouse=False,
            can_settle_talangan=False,
            can_access_warehouse=False,
        )
    elif role == "warehouse":
        return AuthPermissions(
            can_edit=False,
            can_delete=False,
            can_view_charts=False,
            can_manage_config=False,
            can_manage_requests=True,
            can_approve_requests=False,
            can_order_purchasing=False,
            can_receive_warehouse=True,
            can_settle_talangan=False,
            can_access_warehouse=True,
        )
    elif role == "staff":
        return AuthPermissions(
            can_edit=False,
            can_delete=False,
            can_view_charts=False,
            can_manage_config=False,
            can_manage_requests=True,
            can_approve_requests=False,
            can_order_purchasing=False,
            can_receive_warehouse=False,
            can_settle_talangan=False,
            can_access_warehouse=False,
        )
    else:  # admin_input
        return AuthPermissions(
            can_edit=True,
            can_delete=False,
            can_view_charts=False,
            can_manage_config=False,
            can_manage_requests=True,
            can_approve_requests=False,
            can_order_purchasing=False,
            can_receive_warehouse=False,
            can_settle_talangan=False,
            can_access_warehouse=False,
        )


def _is_secure_request(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "").lower()
    return proto == "https"


def _set_session_cookies(response: Response, request: Request, token: str) -> None:
    secure = _is_secure_request(request)
    samesite = getattr(settings, "cookie_samesite", "strict") or "strict"
    max_age = settings.dashboard_session_expire_hours * 3600
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite=samesite,
        secure=secure,
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=secrets.token_urlsafe(24),
        max_age=max_age,
        httponly=False,
        samesite=samesite,
        secure=secure,
        path="/",
    )


@router.get("/status", response_model=AuthStatusResponse)
async def get_auth_status(request: Request, response: Response):
    role = get_authenticated_role(request)
    is_auth = role is not None
    user_label = ROLE_LABELS.get(role, "User") if role else None
    permissions = get_role_permissions(role) if is_auth and role else None

    if is_auth and request.cookies.get(SESSION_COOKIE_NAME) and not request.cookies.get(CSRF_COOKIE_NAME):
        secure = _is_secure_request(request)
        samesite = getattr(settings, "cookie_samesite", "strict") or "strict"
        response.set_cookie(
            key=CSRF_COOKIE_NAME,
            value=secrets.token_urlsafe(24),
            max_age=settings.dashboard_session_expire_hours * 3600,
            httponly=False,
            samesite=samesite,
            secure=secure,
            path="/",
        )

    return AuthStatusResponse(
        authenticated=is_auth,
        user=user_label,
        role=role,
        permissions=permissions,
    )


@router.post("/request-pin")
async def api_request_pin(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = get_client_ip(request)
    success, reason = await generate_and_send_pin(db, ip)
    if success:
        return {"ok": True, "message": reason}

    status_code = 429 if ("tunggu" in reason.lower() or "terlalu banyak" in reason.lower() or "diblokir" in reason.lower()) else 400
    return JSONResponse({"ok": False, "error": reason}, status_code=status_code)


@router.post("/verify-pin")
async def api_verify_pin(
    request: Request,
    payload: PinVerifyRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    ip = get_client_ip(request)
    success, reason = await verify_pin(db, ip, payload.pin.strip())

    if success:
        token = create_session_token(role="admin")
        _set_session_cookies(response, request, token)
        return {
            "ok": True,
            "token": token,
            "role": "admin",
            "user": "Owner / Super Admin",
            "message": "Autentikasi berhasil",
        }

    status_code = (
        429
        if any(
            k in reason.lower()
            for k in ("diblokir", "terlalu banyak", "ditangguhkan", "batas percobaan habis", "tunggu")
        )
        else 400
    )
    return JSONResponse({"ok": False, "error": reason}, status_code=status_code)


@router.post("/login-admin-input")
async def api_login_admin_input(
    request: Request,
    payload: AdminInputLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login khusus untuk staf Admin Input tanpa perlu verifikasi PIN Telegram."""
    ip = get_client_ip(request)
    success, reason = await verify_admin_input_password(db, ip, payload.password)

    if success:
        token = create_session_token(role="admin_input")
        _set_session_cookies(response, request, token)
        return {
            "ok": True,
            "token": token,
            "role": "admin_input",
            "user": "Admin Input",
            "message": "Login Admin Input berhasil",
        }

    status_code = (
        429
        if any(
            k in reason.lower()
            for k in ("diblokir", "terlalu banyak", "ditangguhkan", "batas percobaan habis", "tunggu")
        )
        else 400
    )
    return JSONResponse({"ok": False, "error": reason}, status_code=status_code)


@router.post("/login-role")
async def api_login_role(
    request: Request,
    payload: RoleLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Login masing-masing bagian (Staf Dapur, Purchasing, Gudang, Admin Input)
    menggunakan password / PIN khusus divisi masing-masing.
    """
    ip = get_client_ip(request)
    success, reason, norm_role = await verify_role_password(db, ip, payload.role, payload.password)

    if success:
        token = create_session_token(role=norm_role)
        _set_session_cookies(response, request, token)
        return {
            "ok": True,
            "token": token,
            "role": norm_role,
            "user": ROLE_LABELS.get(norm_role, norm_role),
            "message": reason,
        }

    status_code = (
        429
        if any(
            k in reason.lower()
            for k in ("diblokir", "terlalu banyak", "ditangguhkan", "batas percobaan habis", "tunggu")
        )
        else 400
    )
    return JSONResponse({"ok": False, "error": reason}, status_code=status_code)


@router.post("/sso-exchange")
async def api_sso_exchange(
    request: Request,
    payload: SsoExchangeRequest,
    response: Response,
):
    """Tukarkan token SSO JWT dari HCTeams Hub menjadi cookie sesi HttpOnly."""
    sso_data = verify_sso_jwt(payload.token.strip())
    if not sso_data:
        return JSONResponse(
            {"ok": False, "error": "Token SSO tidak valid atau sudah kedaluwarsa."},
            status_code=401,
        )

    role = resolve_sso_role(sso_data)
    session_token = create_session_token(role=role)
    _set_session_cookies(response, request, session_token)
    return {
        "ok": True,
        "role": role,
        "user": ROLE_LABELS.get(role, role),
    }


@router.post("/logout")
async def api_logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")
    return {"ok": True, "message": "Berhasil logout"}
