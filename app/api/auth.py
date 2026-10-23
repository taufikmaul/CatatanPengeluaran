"""
app/api/auth.py — REST API Authentication Endpoints
"""
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.services.dashboard_auth_service import (
    is_authenticated_request,
    get_authenticated_role,
    get_client_ip,
    generate_and_send_pin,
    verify_pin,
    verify_admin_input_password,
    create_session_token,
    SESSION_COOKIE_NAME,
)
from app.api.schemas import AuthStatusResponse, AuthPermissions, PinVerifyRequest, AdminInputLoginRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _is_secure_request(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "").lower()
    return proto == "https"


@router.get("/status", response_model=AuthStatusResponse)
async def get_auth_status(request: Request):
    role = get_authenticated_role(request)
    is_auth = role is not None
    user_label = "Owner / Super Admin" if role == "admin" else ("Admin Input" if role == "admin_input" else None)

    permissions = None
    if is_auth:
        permissions = AuthPermissions(
            can_edit=True,
            can_delete=role == "admin",
            can_view_charts=role == "admin",
            can_manage_config=role == "admin",
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
        secure = _is_secure_request(request)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=token,
            max_age=settings.dashboard_session_expire_hours * 3600,
            httponly=True,
            samesite="lax",
            secure=secure,
            path="/",
        )
        return {
            "ok": True,
            "token": token,
            "role": "admin",
            "user": "Owner / Super Admin",
            "message": "Autentikasi berhasil",
        }

    status_code = 429 if ("diblokir" in reason.lower() or "terlalu banyak" in reason.lower()) else 400
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
        secure = _is_secure_request(request)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=token,
            max_age=settings.dashboard_session_expire_hours * 3600,
            httponly=True,
            samesite="lax",
            secure=secure,
            path="/",
        )
        return {
            "ok": True,
            "token": token,
            "role": "admin_input",
            "user": "Admin Input",
            "message": "Login Admin Input berhasil",
        }

    status_code = 429 if ("diblokir" in reason.lower() or "terlalu banyak" in reason.lower()) else 400
    return JSONResponse({"ok": False, "error": reason}, status_code=status_code)


@router.post("/logout")
async def api_logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"ok": True, "message": "Berhasil logout"}
