"""
tests/conftest.py — Fixture bersama untuk seluruh test suite.

Strategi testing:
- Database memakai SQLite in-memory (aiosqlite), sehingga test tidak butuh
  PostgreSQL dan berjalan cepat.
- Environment variable di-set SEBELUM `app.config` diimpor, karena Settings
  mewajibkan TELEGRAM_TOKEN dan SUMOPOD_API_KEY.
- Setiap test mendapat database bersih (tabel dibuat ulang) dan session
  terisolasi.
"""

from __future__ import annotations

import os

# ── Environment dummy: harus di-set sebelum import app.config ──
os.environ.setdefault("TELEGRAM_TOKEN", "123456:TEST-TOKEN")
os.environ.setdefault("SUMOPOD_API_KEY", "sk-test-key")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("BOT_PASSWORD", "test-password")

import pytest  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402

from app.database.connection import Base, create_engine  # noqa: E402
import app.models  # noqa: F401,E402  — pastikan semua tabel terdaftar


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    """Gunakan asyncio (bukan trio) untuk test async."""
    return "asyncio"


@pytest.fixture
async def engine():
    """Engine SQLite in-memory baru untuk setiap test."""
    test_engine = create_engine("sqlite+aiosqlite:///:memory:")

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield test_engine

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await test_engine.dispose()


@pytest.fixture
async def db(engine) -> AsyncSession:
    """
    Session async yang terhubung ke engine test.

    Tidak memakai `commit()` otomatis seperti dependency produksi agar test
    bisa menguji perilaku commit/flush secara eksplisit.
    """
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest.fixture
def sample_items() -> list[dict]:
    """Contoh hasil ekstraksi AI yang valid."""
    return [
        {
            "tanggal": "2026-10-21",
            "barang": "Tepung Terigu",
            "qty": 2,
            "kategori": "Bahan Kue",
            "harga_satuan": 15000,
            "tax": 0,
            "diskon": 0,
            "total_harga": 30000,
            "toko_supplier": "Toko Sumber Rejeki",
            "metode_bayar": "Tunai",
            "status_pembayaran": "Lunas",
            "jatuh_tempo": "-",
            "keterangan": "-",
        }
    ]
