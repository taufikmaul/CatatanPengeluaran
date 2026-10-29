"""
app/database/connection.py — SQLAlchemy async engine + session factory
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool
from app.config import settings


def create_engine(url: str | None = None):
    """
    Buat async engine untuk URL tertentu (default: settings.database_url).

    Parameter pooling hanya berlaku untuk server-based database seperti
    PostgreSQL; SQLite memakai NullPool dan akan menolak pool_size /
    max_overflow. Ini dipakai juga oleh test suite (SQLite in-memory).
    """
    db_url = url or settings.database_url
    kwargs: dict = {"echo": False, "pool_pre_ping": True}

    if db_url.startswith("sqlite"):
        # SQLite in-memory: tiap koneksi membuat database terpisah, jadi seluruh
        # sesi harus berbagi satu koneksi (dipakai oleh test suite).
        if ":memory:" in db_url:
            kwargs.update(poolclass=StaticPool, connect_args={"check_same_thread": False})
    else:
        kwargs.update(pool_size=5, max_overflow=10)

    return create_async_engine(db_url, **kwargs)


engine = create_engine()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """Dependency injector untuk FastAPI routes."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """
    Siapkan skema database saat startup.

    Produksi: skema dikelola Alembic (`alembic upgrade head` di entrypoint /
    deploy step). Fungsi ini hanya memastikan model ter-import sehingga
    metadata lengkap.

    Development: set AUTO_CREATE_TABLES=true untuk memakai create_all.
    """
    # Import semua models agar Base.metadata mengenali mereka
    import app.models  # noqa: F401

    if not settings.auto_create_tables:
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
