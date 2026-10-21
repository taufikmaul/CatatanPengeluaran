"""
app/config.py — Centralized settings menggunakan pydantic-settings
Semua env vars dibaca dari .env file
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


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

    # Google Sheets (optional)
    spreadsheet_id: str = Field("", env="SPREADSHEET_ID")
    google_credentials_json: str = Field("credentials.json", env="GOOGLE_CREDENTIALS_JSON")

    # App
    app_host: str = Field("0.0.0.0", env="APP_HOST")
    app_port: int = Field(8000, env="APP_PORT")
    webhook_url: str = Field("", env="WEBHOOK_URL")
    secret_key: str = Field("change_me", env="SECRET_KEY")

    # Scheduler
    auto_report_time: str = Field("08:00", env="AUTO_REPORT_TIME")
    report_chat_id: str = Field("", env="REPORT_CHAT_ID")
    report_thread_id: int = Field(7, env="REPORT_THREAD_ID")

    # Kategori yang valid (fix, tidak perlu dari env)
    valid_categories: list[str] = [
        "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor",
        "Kemasan", "Operasional", "Topper & Mainan", "Renovasi",
        "Asset", "Iuran", "Tukar Cash"
    ]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
