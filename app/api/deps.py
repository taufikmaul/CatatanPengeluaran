"""
app/api/deps.py — API Dependencies
"""
from fastapi import Request, HTTPException, status
from app.services.dashboard_auth_service import is_authenticated_request


def require_auth(request: Request):
    """Pastikan request terautentikasi via cookie atau token header."""
    if not is_authenticated_request(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Akses tidak diizinkan. Silakan login dengan PIN Telegram.",
        )
    return True
