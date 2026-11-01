"""
app/config.py — Centralized settings menggunakan pydantic-settings
Semua env vars dibaca dari .env file
"""
from functools import lru_cache
from typing import Any

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        populate_by_name=True,
        extra="ignore",
    )

    # Telegram
    telegram_token: str = Field(..., validation_alias="TELEGRAM_TOKEN")
    bot_password: str = Field("12345", validation_alias="BOT_PASSWORD")
    allowed_thread_id: int = Field(7, validation_alias="ALLOWED_THREAD_ID")
    allowed_thread_ids: str = Field("", validation_alias="ALLOWED_THREAD_IDS")  # e.g. "7, 12, 15"
    tukar_cash_thread_ids: str = Field("", validation_alias="TUKAR_CASH_THREAD_IDS")  # Topic khusus Tukar Cash
    ongkir_thread_ids: str = Field("", validation_alias="ONGKIR_THREAD_IDS")  # Topic khusus Ongkir & Kurir

    # Database
    database_url: str = Field(..., validation_alias="DATABASE_URL")

    # AI - Sumopod
    sumopod_api_key: str = Field(..., validation_alias="SUMOPOD_API_KEY")
    sumopod_url: str = Field("https://ai.sumopod.com/v1/chat/completions", validation_alias="SUMOPOD_URL")
    sumopod_model: str = Field("seed-2-0-mini", validation_alias="SUMOPOD_MODEL")

    # AI - Financial Analysis (ClassAI / DeepSeek / Custom Router)
    ai_analysis_api_key: str = Field("", validation_alias="AI_ANALYSIS_API_KEY")
    ai_analysis_url: str = Field("https://router.classai.id/v1/chat/completions", validation_alias="AI_ANALYSIS_URL")
    ai_analysis_model: str = Field("deepseek-v4.1-flash-1017", validation_alias="AI_ANALYSIS_MODEL")

    # Google Sheets (optional)
    spreadsheet_id: str = Field("", validation_alias="SPREADSHEET_ID")
    google_credentials_json: str = Field("credentials.json", validation_alias="GOOGLE_CREDENTIALS_JSON")

    # App
    app_host: str = Field("0.0.0.0", validation_alias="APP_HOST")
    app_port: int = Field(8000, validation_alias="APP_PORT")
    webhook_url: str = Field("", validation_alias="WEBHOOK_URL")
    # URL publik dashboard, dipakai untuk tombol/link di balasan Telegram.
    # Kosongkan untuk menurunkan otomatis dari WEBHOOK_URL (buang suffix /webhook).
    dashboard_url: str = Field("", validation_alias="DASHBOARD_URL")
    secret_key: str = Field("change_me", validation_alias="SECRET_KEY")
    auth_secret: str = Field("change-me-use-a-long-random-string-min-32-chars", validation_alias="AUTH_SECRET")
    # Skema database dikelola Alembic. Set AUTO_CREATE_TABLES=true hanya untuk
    # development cepat / SQLite lokal; jangan diaktifkan di produksi.
    auto_create_tables: bool = Field(False, validation_alias="AUTO_CREATE_TABLES")

    # Scheduler & Budget
    auto_report_time: str = Field("08:00", validation_alias="AUTO_REPORT_TIME")
    report_chat_id: str = Field("", validation_alias="REPORT_CHAT_ID")
    report_thread_id: int = Field(7, validation_alias="REPORT_THREAD_ID")
    high_value_alert_threshold: float = Field(500000.0, validation_alias="HIGH_VALUE_ALERT_THRESHOLD")
    monthly_budget_limit: int = Field(0, validation_alias="MONTHLY_BUDGET_LIMIT")
    category_budgets_json: str = Field("{}", validation_alias="CATEGORY_BUDGETS_JSON")

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
    dashboard_pin_chat_id: str = Field("", validation_alias="DASHBOARD_PIN_CHAT_ID")
    dashboard_pin_thread_id: int | None = Field(None, validation_alias="DASHBOARD_PIN_THREAD_ID")
    dashboard_session_expire_hours: int = Field(24, validation_alias="DASHBOARD_SESSION_EXPIRE_HOURS")
    dashboard_pin_expire_seconds: int = Field(300, validation_alias="DASHBOARD_PIN_EXPIRE_SECONDS")
    dashboard_pin_cooldown_seconds: int = Field(30, validation_alias="DASHBOARD_PIN_COOLDOWN_SECONDS")
    dashboard_pin_max_attempts: int = Field(3, validation_alias="DASHBOARD_PIN_MAX_ATTEMPTS")
    dashboard_lockout_attempts: int = Field(5, validation_alias="DASHBOARD_LOCKOUT_ATTEMPTS")
    dashboard_lockout_minutes: int = Field(15, validation_alias="DASHBOARD_LOCKOUT_MINUTES")
    admin_input_password: str = Field("input123", validation_alias="ADMIN_INPUT_PASSWORD")
    purchasing_password: str = Field("purchasing123", validation_alias="PURCHASING_PASSWORD")
    warehouse_password: str = Field("gudang123", validation_alias="WAREHOUSE_PASSWORD")
    staff_password: str = Field("staf123", validation_alias="STAFF_PASSWORD")

    # Notifikasi Request Belanja
    request_belanja_chat_id: str | None = Field(None, validation_alias="REQUEST_BELANJA_CHAT_ID")
    request_belanja_thread_id: int | None = Field(None, validation_alias="REQUEST_BELANJA_THREAD_ID")

    # Admin Telegram (boleh menandai reimburse "Sudah Diganti").
    # Daftar Telegram user ID dipisah koma. Jika kosong, fallback ke DASHBOARD_PIN_CHAT_ID.
    admin_telegram_ids: str = Field("", validation_alias="ADMIN_TELEGRAM_IDS")

    def get_allowed_thread_ids(self) -> set[int]:
        """Ambil kumpulan thread/topic ID yang diizinkan di grup toko."""
        ids: set[int] = set()
        if self.allowed_thread_id is not None:
            try:
                ids.add(int(self.allowed_thread_id))
            except (ValueError, TypeError):
                pass
        if self.allowed_thread_ids:
            for part in str(self.allowed_thread_ids).split(","):
                part = part.strip()
                if part.isdigit():
                    ids.add(int(part))
        for extra in (self.tukar_cash_thread_ids, self.ongkir_thread_ids):
            if extra:
                for part in str(extra).split(","):
                    part = part.strip()
                    if part.isdigit():
                        ids.add(int(part))
        return ids

    def is_thread_allowed(self, thread_id: int | None) -> bool:
        """Cek apakah topic thread ID diizinkan (atau True jika grup tanpa topic forum)."""
        allowed = self.get_allowed_thread_ids()
        if not allowed:
            return True
        if thread_id is None:
            return True
        return thread_id in allowed

    def get_thread_topic_type(self, thread_id: int | None) -> str | None:
        """Deteksi tipe konteks topic (tukar_cash / ongkir / None)."""
        if thread_id is None:
            return None
        tukar_cash_ids = {int(p.strip()) for p in str(self.tukar_cash_thread_ids).split(",") if p.strip().isdigit()}
        if thread_id in tukar_cash_ids:
            return "tukar_cash"
        ongkir_ids = {int(p.strip()) for p in str(self.ongkir_thread_ids).split(",") if p.strip().isdigit()}
        if thread_id in ongkir_ids:
            return "ongkir"
        return None

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
        "Asset", "Iuran", "Tukar Cash", "Ongkir",
        "Gaji", "Sewa", "Marketing", "Software", "Maintenance"
    ]

    # Metode pembayaran yang valid (sesuai master data, default)
    valid_payment_methods: list[str] = [
        "Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"
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


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
