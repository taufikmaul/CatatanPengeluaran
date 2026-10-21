"""
alembic/env.py — Konfigurasi Alembic untuk CatatanPengeluaran.

URL database diambil dari settings aplikasi (environment variable
DATABASE_URL), bukan di-hardcode di alembic.ini. Mendukung dua mode:

1. Online  : koneksi async via asyncpg / aiosqlite (default).
2. Offline : generate SQL tanpa koneksi (`alembic upgrade head --sql`).

Semua model diimpor lewat `app.models` agar `Base.metadata` lengkap saat
autogenerate.
"""

from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Pastikan root project ada di sys.path saat alembic dipanggil dari CLI.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.database.connection import Base  # noqa: E402
import app.models  # noqa: F401,E402  — mendaftarkan semua tabel ke metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# ---------------------------------------------------------------------------
# Database URL
# ---------------------------------------------------------------------------

def get_database_url() -> str:
    """
    Ambil URL database dengan prioritas:
    1. -x db_url=... dari CLI (berguna untuk CI / test)
    2. DATABASE_URL environment variable
    3. settings aplikasi (.env)

    Fallback terakhir: SQLite lokal, supaya `alembic upgrade head` tetap bisa
    dijalankan tanpa PostgreSQL (misal untuk review migrasi).
    """
    url = context.get_x_argument(as_dictionary=True).get("db_url") or os.getenv(
        "DATABASE_URL"
    )

    if not url:
        try:
            from app.config import settings

            url = settings.database_url
        except Exception:  # pragma: no cover - hanya saat .env belum diisi
            url = "sqlite+aiosqlite:///./catatan_pengeluaran.db"

    return url


def _escape_for_config(url: str) -> str:
    """Escape '%' agar tidak dianggap interpolation oleh ConfigParser."""
    return url.replace("%", "%%")


# ---------------------------------------------------------------------------
# Offline mode
# ---------------------------------------------------------------------------

def run_migrations_offline() -> None:
    context.configure(
        url=get_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online mode
# ---------------------------------------------------------------------------

def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        render_as_batch=connection.dialect.name == "sqlite",
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _escape_for_config(get_database_url())

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
