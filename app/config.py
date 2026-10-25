"""
app/config.py — Centralized settings menggunakan pydantic-settings
Semua env vars dibaca dari .env file
"""
from functools import lru_cache
from typing import Any

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Telegram
    telegram_token: str = Field(..., env="TELEGRAM_TOKEN")
    bot_password: str = Field("12345", env="BOT_PASSWORD")
    allowed_thread_id: int = Field(7, env="ALLOWED_THREAD_ID")

    # Database
    database_url: str = Field(..., env="DATABASE_URL")

    # AI - Sumopod
    sumopod_api_key: str = Field(..., env="SUMOPOD_API_KEY")
    sumopod_url: str = Field("https://ai.sumopod.com/v1/chat/completions", env="SUMOPOD_URL")
    sumopod_model: str = Field("seed-2-0-mini", env="SUMOPOD_MODEL")

    # AI - Financial Analysis (ClassAI / DeepSeek / Custom Router)
    ai_analysis_api_key: str = Field("", env="AI_ANALYSIS_API_KEY")
    ai_analysis_url: str = Field("https://router.classai.id/v1/chat/completions", env="AI_ANALYSIS_URL")
    ai_analysis_model: str = Field("deepseek-v4.1-flash-1017", env="AI_ANALYSIS_MODEL")

    # Google Sheets (optional)
    spreadsheet_id: str = Field("", env="SPREADSHEET_ID")
    google_credentials_json: str = Field("credentials.json", env="GOOGLE_CREDENTIALS_JSON")

    # App
    app_host: str = Field("0.0.0.0", env="APP_HOST")
    app_port: int = Field(8000, env="APP_PORT")
    webhook_url: str = Field("", env="WEBHOOK_URL")
    # URL publik dashboard, dipakai untuk tombol/link di balasan Telegram.
    # Kosongkan untuk menurunkan otomatis dari WEBHOOK_URL (buang suffix /webhook).
    dashboard_url: str = Field("", env="DASHBOARD_URL")
    secret_key: str = Field("change_me", env="SECRET_KEY")
    auth_secret: str = Field("change-me-use-a-long-random-string-min-32-chars", env="AUTH_SECRET")
    # Skema database dikelola Alembic. Set AUTO_CREATE_TABLES=true hanya untuk
    # development cepat / SQLite lokal; jangan diaktifkan di produksi.
    auto_create_tables: bool = Field(False, env="AUTO_CREATE_TABLES")

    # Scheduler & Budget
    auto_report_time: str = Field("08:00", env="AUTO_REPORT_TIME")
    report_chat_id: str = Field("", env="REPORT_CHAT_ID")
    report_thread_id: int = Field(7, env="REPORT_THREAD_ID")
    high_value_alert_threshold: float = Field(500000.0, env="HIGH_VALUE_ALERT_THRESHOLD")
    monthly_budget_limit: int = Field(0, env="MONTHLY_BUDGET_LIMIT")
    category_budgets_json: str = Field("{}", env="CATEGORY_BUDGETS_JSON")

    @property
    def category_budgets(self) -> dict[str, float]:
        """Parse anggaran per kategori dari JSON string."""
        import json
        try:
            raw = json.loads(self.category_budgets_json or "{}")
            if isinstance(raw, dict):
                return {
                    str(k): float(v)
                    for k, v in raw.items()
                    if v is not None and float(v) > 0
                }
        except Exception:
            pass
        return {}

    # Dashboard PIN & Security
    dashboard_pin_chat_id: str = Field("", env="DASHBOARD_PIN_CHAT_ID")
    dashboard_pin_thread_id: int | None = Field(None, env="DASHBOARD_PIN_THREAD_ID")
    dashboard_session_expire_hours: int = Field(24, env="DASHBOARD_SESSION_EXPIRE_HOURS")
    dashboard_pin_expire_seconds: int = Field(300, env="DASHBOARD_PIN_EXPIRE_SECONDS")
    dashboard_pin_cooldown_seconds: int = Field(30, env="DASHBOARD_PIN_COOLDOWN_SECONDS")
    dashboard_pin_max_attempts: int = Field(3, env="DASHBOARD_PIN_MAX_ATTEMPTS")
    dashboard_lockout_attempts: int = Field(5, env="DASHBOARD_LOCKOUT_ATTEMPTS")
    dashboard_lockout_minutes: int = Field(15, env="DASHBOARD_LOCKOUT_MINUTES")
    admin_input_password: str = Field("input123", env="ADMIN_INPUT_PASSWORD")

    # Admin Telegram (boleh menandai reimburse "Sudah Diganti").
    # Daftar Telegram user ID dipisah koma. Jika kosong, fallback ke DASHBOARD_PIN_CHAT_ID.
    admin_telegram_ids: str = Field("", env="ADMIN_TELEGRAM_IDS")

    def is_admin_telegram(self, telegram_id: int | str | None) -> bool:
        """Cek apakah Telegram user ID termasuk admin/owner."""
        if telegram_id is None:
            return False
        raw = self.admin_telegram_ids or self.dashboard_pin_chat_id or ""
        ids = {p.strip() for p in str(raw).split(",") if p.strip()}
        return str(telegram_id).strip() in ids

    # Kategori yang valid (fix, tidak perlu dari env)
    valid_categories: list[str] = [
        "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor",
        "Kemasan", "Operasional", "Topper & Mainan", "Renovasi",
        "Asset", "Iuran", "Tukar Cash"
    ]

    @property
    def public_dashboard_url(self) -> str:
        """URL dashboard yang bisa dibuka user dari Telegram.

        Prioritas: DASHBOARD_URL → turunan WEBHOOK_URL → localhost (dev).
        """
        if self.dashboard_url:
            url = self.dashboard_url.rstrip("/")
            if url.endswith("/app"):
                return url
            return url + "/app"
        if self.webhook_url.startswith(("http://", "https://")):
            base = self.webhook_url.rstrip("/")
            if base.endswith("/webhook"):
                base = base[: -len("/webhook")]
            return base + "/app"
        return f"http://localhost:{self.app_port}/app"

    @model_validator(mode="before")
    @classmethod
    def _treat_blank_values_as_unset(cls, values: Any) -> Any:
        """Anggap nilai kosong ("") dari .env sebagai "tidak di-set".

        Tanpa ini, baris seperti `DASHBOARD_PIN_THREAD_ID=` pada .env dikirim
        sebagai string kosong dan gagal di-parse Pydantic untuk field non-string
        (mis. `int | None`), sehingga aplikasi gagal start. Dengan penanganan ini,
        nilai kosong berarti "pakai default" (atau `None` untuk field opsional),
        sehingga menghapus isi sebuah baris di .env selalu aman.
        """
        if not isinstance(values, dict):
            return values

        return {
            key: value
            for key, value in values.items()
            if not (isinstance(value, str) and not value.strip())
        }

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
