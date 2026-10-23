"""
app/api/deps.py — API Dependencies
"""
from fastapi import Request, HTTPException, status
from app.services.dashboard_auth_service import is_authenticated_request, get_authenticated_role


def require_auth(request: Request):
    """Pastikan request terautentikasi via cookie atau token header (admin maupun admin_input)."""
    if not is_authenticated_request(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Akses tidak diizinkan. Silakan login terlebih dahulu.",
        )
    return True


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
    """Ambil role user saat ini ('admin', 'admin_input', atau 'anonymous')."""
    return get_authenticated_role(request) or "anonymous"
