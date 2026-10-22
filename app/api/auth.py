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
    get_client_ip,
    generate_and_send_pin,
    verify_pin,
    create_session_token,
    SESSION_COOKIE_NAME,
)
from app.api.schemas import AuthStatusResponse, PinVerifyRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _is_secure_request(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "").lower()
    return proto == "https"


@router.get("/status", response_model=AuthStatusResponse)
async def get_auth_status(request: Request):
    is_auth = is_authenticated_request(request)
    return AuthStatusResponse(
        authenticated=is_auth,
        user="Admin" if is_auth else None,
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
        token = create_session_token()
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
        return {"ok": True, "token": token, "message": "Autentikasi berhasil"}

    status_code = 429 if ("diblokir" in reason.lower() or "terlalu banyak" in reason.lower()) else 400
    return JSONResponse({"ok": False, "error": reason}, status_code=status_code)


@router.post("/logout")
async def api_logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"ok": True, "message": "Berhasil logout"}
