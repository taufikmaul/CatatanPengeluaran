"""
Test integrasi Alembic.

Memastikan:
1. Seluruh revisi bisa dijalankan dari nol sampai head.
2. Hasil migrasi identik dengan metadata model (tidak ada drift).

Test ini memakai database file sementara karena Alembic butuh koneksi nyata
dan `alembic check` akan membandingkan skema hasil migrasi dengan model.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import inspect

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC = Path(sys.executable).parent / "alembic"


def _alembic_env(db_path: Path) -> dict[str, str]:
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{db_path}",
        "TELEGRAM_TOKEN": "123:TEST",
        "SUMOPOD_API_KEY": "sk-test",
    }
    return env


def _run_alembic(*args: str, db_path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(ALEMBIC), *args],
        cwd=PROJECT_ROOT,
        env=_alembic_env(db_path),
        capture_output=True,
        text=True,
        timeout=180,
    )


@pytest.fixture
def migration_db(tmp_path: Path) -> Path:
    return tmp_path / "migration_test.db"


class TestMigrationLifecycle:
    def test_upgrade_from_scratch_succeeds(self, migration_db):
        result = _run_alembic("upgrade", "head", db_path=migration_db)

        assert result.returncode == 0, result.stderr
        assert "Running upgrade" in result.stderr
        assert migration_db.exists()

    def test_upgrade_is_idempotent(self, migration_db):
        assert _run_alembic("upgrade", "head", db_path=migration_db).returncode == 0
        again = _run_alembic("upgrade", "head", db_path=migration_db)

        assert again.returncode == 0, again.stderr
        # Tidak ada revisi yang dijalankan dua kali.
        assert "Running upgrade" not in again.stderr

    def test_downgrade_and_reupgrade(self, migration_db):
        assert _run_alembic("upgrade", "head", db_path=migration_db).returncode == 0
        down = _run_alembic("downgrade", "base", db_path=migration_db)
        assert down.returncode == 0, down.stderr

        up = _run_alembic("upgrade", "head", db_path=migration_db)
        assert up.returncode == 0, up.stderr

    def test_current_reports_head(self, migration_db):
        _run_alembic("upgrade", "head", db_path=migration_db)
        result = _run_alembic("current", db_path=migration_db)

        assert result.returncode == 0, result.stderr
        assert "(head)" in result.stdout + result.stderr


class TestSchemaMatchesModels:
    def test_no_pending_autogenerate_diff(self, migration_db):
        """
        `alembic check` gagal bila model punya perubahan yang belum dibuat
        menjadi revisi. Ini penjaga utama agar migrasi tidak tertinggal.
        """
        _run_alembic("upgrade", "head", db_path=migration_db)
        result = _run_alembic("check", db_path=migration_db)

        assert result.returncode == 0, (
            "Model dan migrasi tidak sinkron. Jalankan:\n"
            "  alembic revision --autogenerate -m '<deskripsi>'\n\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
        assert "No new upgrade operations detected" in result.stdout + result.stderr

    def test_migrated_schema_contains_all_tables(self, migration_db):
        from sqlalchemy import create_engine

        _run_alembic("upgrade", "head", db_path=migration_db)

        sync_engine = create_engine(f"sqlite:///{migration_db}")
        try:
            tables = set(inspect(sync_engine).get_table_names())
        finally:
            sync_engine.dispose()

        assert {"users", "expenses", "sessions"} <= tables


class TestAlembicConfig:
    def test_ini_file_does_not_hardcode_database_url(self):
        content = (PROJECT_ROOT / "alembic.ini").read_text()
        # URL harus kosong agar dibaca dari DATABASE_URL oleh env.py.
        assert "sqlalchemy.url =\n" in content

    def test_versions_directory_exists(self):
        assert (PROJECT_ROOT / "alembic" / "versions").is_dir()

    def test_at_least_one_revision_exists(self):
        revisions = list((PROJECT_ROOT / "alembic" / "versions").glob("*.py"))
        assert revisions, "belum ada file revisi Alembic"
