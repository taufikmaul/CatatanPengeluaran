"""
tests/test_config.py — Regresi untuk parsing env var opsional yang kosong.

Latar belakang: di produksi, baris `DASHBOARD_PIN_THREAD_ID=` (dibiarkan kosong
karena chat pribadi tidak punya thread) membuat container crash-loop dengan
`ValidationError: Input should be a valid integer, unable to parse string as an
integer, input_value=''`. Nilai kosong di .env harus berarti "tidak di-set".
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def make_settings(**overrides) -> Settings:
    """Bangun Settings tanpa membaca .env dari disk agar test deterministik."""
    return Settings(_env_file=None, **overrides)


class TestBlankOptionalValues:
    def test_blank_optional_int_becomes_none(self):
        assert make_settings(dashboard_pin_thread_id="").dashboard_pin_thread_id is None

    def test_blank_optional_int_with_whitespace_becomes_none(self):
        s = make_settings(dashboard_pin_thread_id="   ")
        assert s.dashboard_pin_thread_id is None

    def test_optional_int_still_parsed_when_filled(self):
        assert make_settings(dashboard_pin_thread_id="7").dashboard_pin_thread_id == 7

    def test_omitted_optional_int_defaults_to_none(self):
        assert make_settings().dashboard_pin_thread_id is None

    def test_blank_string_keeps_string_default(self):
        s = make_settings(dashboard_pin_chat_id="", report_chat_id="")
        assert s.dashboard_pin_chat_id == ""
        assert s.report_chat_id == ""

    def test_blank_bool_falls_back_to_default(self):
        assert make_settings(auto_create_tables="").auto_create_tables is False

    def test_blank_int_falls_back_to_default(self):
        s = make_settings(
            dashboard_pin_expire_seconds="",
            dashboard_lockout_attempts="",
            report_thread_id="",
            allowed_thread_id="",
        )
        assert s.dashboard_pin_expire_seconds == 300
        assert s.dashboard_lockout_attempts == 5
        assert s.report_thread_id == 7
        assert s.allowed_thread_id == 7

    def test_blank_required_value_is_rejected(self, monkeypatch):
        """Nilai kosong untuk field wajib harus error, bukan lolos sebagai string kosong."""
        monkeypatch.delenv("TELEGRAM_TOKEN", raising=False)

        with pytest.raises(ValidationError):
            Settings(
                _env_file=None,
                telegram_token="",
                sumopod_api_key="sk-test",
                database_url="sqlite+aiosqlite:///:memory:",
            )

    def test_production_blank_combination_does_not_crash(self):
        """Reproduksi konfigurasi produksi: PIN ke chat pribadi tanpa thread."""
        s = make_settings(
            dashboard_pin_chat_id="115334079",
            dashboard_pin_thread_id="",
            dashboard_session_expire_hours="",
            dashboard_pin_expire_seconds="",
            dashboard_pin_cooldown_seconds="",
            dashboard_pin_max_attempts="",
            dashboard_lockout_attempts="",
            dashboard_lockout_minutes="",
        )
        assert s.dashboard_pin_expire_seconds == 300
        assert s.dashboard_pin_cooldown_seconds == 30
        assert s.dashboard_pin_max_attempts == 3
        assert s.dashboard_lockout_attempts == 5
        assert s.dashboard_lockout_minutes == 15


class TestBlankValuesFromEnvFile:
    def test_env_file_with_blank_values_loads(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("DASHBOARD_PIN_CHAT_ID", raising=False)
        monkeypatch.delenv("DASHBOARD_PIN_THREAD_ID", raising=False)
        monkeypatch.delenv("DASHBOARD_SESSION_EXPIRE_HOURS", raising=False)

        env_file = tmp_path / ".env"
        env_file.write_text(
            "DASHBOARD_PIN_CHAT_ID=115334079\n"
            "DASHBOARD_PIN_THREAD_ID=\n"
            "DASHBOARD_SESSION_EXPIRE_HOURS=\n",
            encoding="utf-8",
        )

        s = Settings(_env_file=str(env_file))

        assert s.dashboard_pin_chat_id == "115334079"
        assert s.dashboard_pin_thread_id is None
        assert s.dashboard_session_expire_hours == 24


class TestPublicDashboardUrl:
    def test_default_localhost_points_to_app(self):
        s = make_settings(app_port=8000)
        assert s.public_dashboard_url == "http://localhost:8000/app"

    def test_dashboard_url_override(self):
        s = make_settings(dashboard_url="https://admin.example.com")
        assert s.public_dashboard_url == "https://admin.example.com/app"

        s_with_app = make_settings(dashboard_url="https://admin.example.com/app")
        assert s_with_app.public_dashboard_url == "https://admin.example.com/app"

    def test_webhook_url_fallback(self):
        s = make_settings(webhook_url="https://bot.example.com/webhook")
        assert s.public_dashboard_url == "https://bot.example.com/app"
