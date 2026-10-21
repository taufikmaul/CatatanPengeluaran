"""
app/utils/auth.py — Autentikasi user berbasis Postgres (pengganti PropertiesService GAS)
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User


async def is_user_authenticated(db: AsyncSession, telegram_id: int) -> bool:
    """Cek apakah user sudah ter-autentikasi."""
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()
    return bool(user and user.is_auth)


async def authenticate_user(db: AsyncSession, telegram_id: int, name: str = "") -> User:
    """Set user sebagai authenticated. Buat record baru jika belum ada."""
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()

    if user:
        user.is_auth = True
        user.name = name or user.name
    else:
        user = User(telegram_id=telegram_id, name=name, is_auth=True)
        db.add(user)

    await db.flush()
    return user


async def get_or_create_user(db: AsyncSession, telegram_id: int, name: str = "") -> User:
    """Dapatkan atau buat user record (belum tentu ter-auth)."""
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        user = User(telegram_id=telegram_id, name=name, is_auth=False)
        db.add(user)
        await db.flush()

    return user
