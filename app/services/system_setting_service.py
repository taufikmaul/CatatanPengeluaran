"""
app/services/system_setting_service.py — Layanan penyimpanan konfigurasi sistem ke database.
Memastikan pengaturan dinamis (seperti topic IDs, token, passwords) persisten di PostgreSQL
dan tidak hilang saat deploy container Docker baru.
"""
import json
import logging
import os
from datetime import datetime
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.system_setting import SystemSetting

logger = logging.getLogger(__name__)

# Mapping nama field di settings/payload ke ENV variable
ENV_MAP: dict[str, str] = {
    "telegram_token": "TELEGRAM_TOKEN",
    "dashboard_pin_chat_id": "DASHBOARD_PIN_CHAT_ID",
    "dashboard_pin_thread_id": "DASHBOARD_PIN_THREAD_ID",
    "allowed_thread_id": "ALLOWED_THREAD_ID",
    "allowed_thread_ids": "ALLOWED_THREAD_IDS",
    "tukar_cash_thread_ids": "TUKAR_CASH_THREAD_IDS",
    "ongkir_thread_ids": "ONGKIR_THREAD_IDS",
    "report_chat_id": "REPORT_CHAT_ID",
    "report_thread_id": "REPORT_THREAD_ID",
    "sumopod_api_key": "SUMOPOD_API_KEY",
    "sumopod_model": "SUMOPOD_MODEL",
    "sumopod_url": "SUMOPOD_URL",
    "ai_analysis_api_key": "AI_ANALYSIS_API_KEY",
    "ai_analysis_url": "AI_ANALYSIS_URL",
    "ai_analysis_model": "AI_ANALYSIS_MODEL",
    "spreadsheet_id": "SPREADSHEET_ID",
    "bot_password": "BOT_PASSWORD",
    "admin_input_password": "ADMIN_INPUT_PASSWORD",
    "webhook_url": "WEBHOOK_URL",
    "monthly_budget_limit": "MONTHLY_BUDGET_LIMIT",
    "category_budgets_json": "CATEGORY_BUDGETS_JSON",
}

INT_FIELDS = {
    "allowed_thread_id",
    "report_thread_id",
    "dashboard_pin_thread_id",
    "monthly_budget_limit",
}


async def get_all_system_settings(db: AsyncSession) -> dict[str, str]:
    """Ambil semua konfigurasi dari tabel system_settings."""
    try:
        stmt = select(SystemSetting)
        result = await db.execute(stmt)
        rows = result.scalars().all()
        return {row.key: (row.value if row.value is not None else "") for row in rows}
    except Exception as e:
        logger.warning(f"Gagal membaca system_settings dari database: {e}")
        return {}


async def save_bulk_system_settings(db: AsyncSession, settings_map: dict[str, Any]) -> None:
    """Simpan atau perbarui banyak konfigurasi ke tabel system_settings."""
    now = datetime.utcnow()
    for key, val in settings_map.items():
        if val is None:
            continue

        if isinstance(val, (dict, list)):
            str_val = json.dumps(val, ensure_ascii=False)
        else:
            str_val = str(val).strip()

        setting_obj = await db.get(SystemSetting, key)
        if setting_obj:
            setting_obj.value = str_val
            setting_obj.updated_at = now
        else:
            new_obj = SystemSetting(
                key=key,
                value=str_val,
                created_at=now,
                updated_at=now,
            )
            db.add(new_obj)

    await db.commit()


def apply_settings_to_runtime(settings_map: dict[str, Any]) -> None:
    """Terapkan pasangan key-value konfigurasi ke objek `settings` di memori dan `os.environ`."""
    for key, raw_val in settings_map.items():
        if raw_val is None:
            continue

        str_val = str(raw_val).strip() if not isinstance(raw_val, (dict, list)) else json.dumps(raw_val)

        # Update environment variable jika terdaftar di ENV_MAP
        env_key = ENV_MAP.get(key)
        if env_key:
            os.environ[env_key] = str_val

        # Khusus category_budgets
        if key in ("category_budgets", "category_budgets_json"):
            if isinstance(raw_val, dict):
                json_str = json.dumps(raw_val, ensure_ascii=False)
                settings.category_budgets_json = json_str
                os.environ["CATEGORY_BUDGETS_JSON"] = json_str
            elif isinstance(raw_val, str) and raw_val.strip():
                settings.category_budgets_json = raw_val
                os.environ["CATEGORY_BUDGETS_JSON"] = raw_val
            continue

        # Update objek settings pydantic di memori
        if hasattr(settings, key):
            if key in INT_FIELDS:
                if str_val.isdigit():
                    setattr(settings, key, int(str_val))
                elif not str_val:
                    # Jika dikosongkan
                    if key == "dashboard_pin_thread_id":
                        setattr(settings, key, None)
                    elif key == "allowed_thread_id":
                        setattr(settings, key, 7)
                    elif key == "report_thread_id":
                        setattr(settings, key, 7)
                    elif key == "monthly_budget_limit":
                        setattr(settings, key, 0)
            else:
                setattr(settings, key, str_val)


async def load_and_apply_system_settings(db: AsyncSession) -> dict[str, str]:
    """Muat konfigurasi dari database saat startup lalu terapkan ke runtime settings."""
    db_settings = await get_all_system_settings(db)
    if db_settings:
        apply_settings_to_runtime(db_settings)
    return db_settings
