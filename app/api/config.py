"""
app/api/config.py — REST API for System Configuration & Monitoring
"""
import json
import os
from typing import Any
from fastapi import APIRouter, Depends, Body, UploadFile, File, HTTPException, status
from pathlib import Path
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.models.expense import Expense
from app.api.deps import require_admin_role
from app.api.schemas import SystemConfigUpdate
from app.services.ai_service import call_ai_text, get_system_prompt
from app.services.sheets_service import (
    sync_to_sheets,
    extract_spreadsheet_id,
    resolve_credentials_path,
    get_service_account_email,
)

router = APIRouter(prefix="/config", tags=["config"], dependencies=[Depends(require_admin_role)])

ENV_MAP = {
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
    "spreadsheet_id": "SPREADSHEET_ID",
    "bot_password": "BOT_PASSWORD",
    "admin_input_password": "ADMIN_INPUT_PASSWORD",
    "webhook_url": "WEBHOOK_URL",
    "monthly_budget_limit": "MONTHLY_BUDGET_LIMIT",
}


def _update_env_file(env_dict: dict[str, str], env_file_path: str = ".env"):
    """Update atau tambah pasangan key=value di file .env."""
    lines = []
    if os.path.exists(env_file_path):
        with open(env_file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    updated_keys = set()
    new_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue

        if "=" in line:
            key, _ = line.split("=", 1)
            key = key.strip()
            if key in env_dict:
                new_lines.append(f"{key}={env_dict[key]}\n")
                updated_keys.add(key)
                continue

        new_lines.append(line)

    for key, val in env_dict.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={val}\n")

    with open(env_file_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


@router.get("")
async def get_system_config(
    db: AsyncSession = Depends(get_db),
):
    total_res = await db.execute(select(func.count(Expense.id)))
    total_expenses = total_res.scalar() or 0

    unsynced_res = await db.execute(
        select(func.count(Expense.id)).where(
            or_(Expense.sheets_synced == False, Expense.sheets_synced.is_(None))  # noqa: E712
        )
    )
    unsynced_count = unsynced_res.scalar() or 0

    tg_token = settings.telegram_token
    tg_masked = f"{tg_token[:6]}...{tg_token[-4:]}" if len(tg_token) > 10 else "Terkonfigurasi"

    ai_key = settings.sumopod_api_key
    ai_masked = f"{ai_key[:7]}...{ai_key[-4:]}" if len(ai_key) > 12 else "Terkonfigurasi"

    creds_p = resolve_credentials_path(settings.google_credentials_json)
    creds_exist = creds_p.is_file()
    sa_email = None
    if creds_exist:
        try:
            with open(creds_p, "r", encoding="utf-8") as f:
                creds_data = json.load(f)
                sa_email = creds_data.get("client_email")
        except Exception:
            pass

    return {
        "ok": True,
        "total_expenses": total_expenses,
        "unsynced_count": unsynced_count,
        # Display masked
        "telegram_token_masked": tg_masked,
        "ai_key_masked": ai_masked,
        # Editable raw values
        "telegram_token": tg_token if tg_token != "123456:TEST_BOT_TOKEN" else "",
        "dashboard_pin_chat_id": settings.dashboard_pin_chat_id or "",
        "dashboard_pin_thread_id": settings.dashboard_pin_thread_id,
        "allowed_thread_id": settings.allowed_thread_id,
        "allowed_thread_ids": settings.allowed_thread_ids or "",
        "tukar_cash_thread_ids": settings.tukar_cash_thread_ids or "",
        "ongkir_thread_ids": settings.ongkir_thread_ids or "",
        "report_chat_id": settings.report_chat_id or "",
        "report_thread_id": settings.report_thread_id,
        "bot_password": settings.bot_password,
        "admin_input_password": settings.admin_input_password,
        "webhook_url": settings.webhook_url or "",
        # AI
        "ai_provider": "Sumopod AI",
        "ai_url": settings.sumopod_url,
        "ai_model": settings.sumopod_model,
        "sumopod_api_key": ai_key if ai_key != "sk-test-sumopod-key" else "",
        "system_prompt": get_system_prompt(),
        # Sheets
        "spreadsheet_id": settings.spreadsheet_id or "",
        "sheets_creds_path": settings.google_credentials_json,
        "sheets_creds_exists": creds_exist,
        "service_account_email": sa_email,
        "valid_categories": settings.valid_categories,
        "monthly_budget_limit": settings.monthly_budget_limit,
        "category_budgets": settings.category_budgets,
    }


@router.put("")
async def update_system_config(
    payload: SystemConfigUpdate,
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return {"ok": True, "message": "Tidak ada perubahan"}

    env_updates: dict[str, str] = {}
    if "category_budgets" in updates and updates["category_budgets"] is not None:
        clean_cat_budgets = {
            str(k): float(v)
            for k, v in updates["category_budgets"].items()
            if v is not None and float(v) > 0
        }
        json_str = json.dumps(clean_cat_budgets, ensure_ascii=False)
        env_updates["CATEGORY_BUDGETS_JSON"] = json_str
        os.environ["CATEGORY_BUDGETS_JSON"] = json_str
        settings.category_budgets_json = json_str

    for attr, val in updates.items():
        if val is not None and attr in ENV_MAP:
            env_key = ENV_MAP[attr]
            str_val = str(val).strip()
            if attr == "spreadsheet_id":
                str_val = extract_spreadsheet_id(str_val)
            env_updates[env_key] = str_val
            os.environ[env_key] = str_val

            # Update runtime settings
            if hasattr(settings, attr):
                current_attr = getattr(settings, attr)
                if isinstance(current_attr, int) and str_val.isdigit():
                    setattr(settings, attr, int(str_val))
                elif current_attr is None and str_val.isdigit():
                    setattr(settings, attr, int(str_val))
                else:
                    setattr(settings, attr, str_val)

    if env_updates:
        _update_env_file(env_updates)

    # Jika webhook_url atau telegram_token diupdate, re-register webhook jika ada
    if "WEBHOOK_URL" in env_updates or "TELEGRAM_TOKEN" in env_updates:
        if settings.webhook_url:
            from app.bot.telegram_client import set_webhook
            try:
                await set_webhook(settings.webhook_url)
            except Exception:
                pass

    return {
        "ok": True,
        "message": "Konfigurasi sistem berhasil disimpan ke .env dan diperbarui di memori!",
    }


@router.post("/upload-credentials")
async def upload_google_credentials(
    file: UploadFile = File(...),
):
    """Unggah file Google Service Account JSON (credentials.json) untuk Google Sheets sync."""
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format file tidak valid. Harap unggah file kredensial berformat .json",
        )

    try:
        content = await file.read()
        creds_data = json.loads(content.decode("utf-8"))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gagal membaca atau mem-parse file JSON: {str(e)}",
        )

    client_email = creds_data.get("client_email")
    if not client_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File JSON bukan Service Account Key Google yang valid (tidak ditemukan field 'client_email').",
        )

    project_root = Path(__file__).resolve().parent.parent.parent
    save_path = str(project_root / "credentials.json")
    try:
        with open(save_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal menyimpan file ke disk: {str(e)}",
        )

    # Update config & env
    _update_env_file({"GOOGLE_CREDENTIALS_JSON": save_path})
    settings.google_credentials_json = save_path
    os.environ["GOOGLE_CREDENTIALS_JSON"] = save_path

    return {
        "ok": True,
        "message": "File Google Service Account berhasil diunggah & disimpan!",
        "service_account_email": client_email,
        "project_id": creds_data.get("project_id", "-"),
    }


@router.post("/test-ai")
async def api_test_ai(
    text: str = Body(..., embed=True),
):
    result = await call_ai_text(text.strip())
    return {"ok": not result.get("error"), "result": result}


@router.post("/sync-sheets")
async def api_trigger_sheets_sync(
    db: AsyncSession = Depends(get_db),
):
    try:
        synced_count = await sync_to_sheets(db, raise_on_error=True)
        return {
            "ok": True,
            "synced_count": synced_count,
            "message": (
                f"Berhasil menyinkronkan {synced_count} baris data ke Google Sheets."
                if synced_count > 0
                else "Tidak ada data baru yang perlu disinkronkan ke Google Sheets."
            ),
        }
    except Exception as e:
        err_msg = str(e).strip()
        if not err_msg:
            creds_path = resolve_credentials_path(settings.google_credentials_json)
            sa_email = get_service_account_email(creds_path)
            email_hint = f" '{sa_email}'" if sa_email else ""
            if isinstance(e, PermissionError):
                err_msg = (
                    f"Akses Google Sheets ditolak (403 Forbidden). Pastikan spreadsheet telah dibagikan (Share) "
                    f"ke email Service Account{email_hint} dengan hak akses Editor."
                )
            elif isinstance(e, FileNotFoundError):
                clean_sheet_id = extract_spreadsheet_id(settings.spreadsheet_id)
                err_msg = (
                    f"Spreadsheet dengan ID '{clean_sheet_id}' tidak ditemukan (404 Not Found). "
                    "Periksa kembali Spreadsheet ID Anda dan pastikan Service Account memiliki akses."
                )
            else:
                err_msg = (
                    f"Gagal menyinkronkan data ke Google Sheets ({type(e).__name__}). "
                    f"Pastikan spreadsheet dibagikan ke Service Account{email_hint} sebagai Editor."
                )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg,
        )


@router.post("/sync-telegram-users")
async def api_trigger_telegram_users_sync(
    db: AsyncSession = Depends(get_db),
):
    """Sinkronisasi penginput transaksi dari tautan pesan Telegram."""
    from app.services.telegram_sync_service import sync_telegram_users_from_links

    res = await sync_telegram_users_from_links(db)
    if not res.get("ok"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=res.get("error", "Gagal menyinkronkan user dari Telegram."),
        )
    return res
