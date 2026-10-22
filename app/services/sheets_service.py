"""
app/services/sheets_service.py — Google Sheets background sync
Data baru di Postgres → sync ke Sheets agar tim tetap bisa pakai Sheets
"""
import json
import os
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.expense import Expense

# Dicatat sekali saja: tanpa credential, job 5 menit akan menulis error yang sama
# berulang kali ke log. Data tetap menunggu dengan sheets_synced = false.
_missing_credentials_reported = False


async def sync_to_sheets(db: AsyncSession) -> int:
    """
    Sync semua expense yang belum ter-sync ke Google Sheets.
    Return jumlah row yang berhasil di-sync.
    """
    if not settings.spreadsheet_id:
        return 0

    global _missing_credentials_reported
    if not os.path.isfile(settings.google_credentials_json):
        if not _missing_credentials_reported:
            print(
                f"[SHEETS SYNC] {settings.google_credentials_json} belum ada — "
                "sync ditunda sampai service account dipasang."
            )
            _missing_credentials_reported = True
        return 0

    from app.services.expense_service import get_unsynced_to_sheets, mark_synced_to_sheets

    unsynced = await get_unsynced_to_sheets(db, limit=100)
    if not unsynced:
        return 0

    try:
        import gspread
        from google.oauth2.service_account import Credentials

        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ]
        creds = Credentials.from_service_account_file(
            settings.google_credentials_json, scopes=scopes
        )
        gc = gspread.authorize(creds)
        sheet = gc.open_by_key(settings.spreadsheet_id).worksheet("Pengeluaran")

        rows_to_append = []
        for e in unsynced:
            rows_to_append.append([
                str(e.created_at.strftime("%Y-%m-%d %H:%M:%S") if e.created_at else ""),
                str(e.expense_date),
                e.supplier or "-",
                e.item_name or "Barang",
                float(e.qty or 1),
                e.category or "Operasional",
                float(e.unit_price or 0),
                float(e.tax or 0),
                float(e.discount or 0),
                float(e.total_price or 0),
                e.pay_method or "Tunai",
                e.pay_status or "Lunas",
                e.due_date or "-",
                e.notes or "-",
                e.msg_link or "Private Chat",
            ])

        if rows_to_append:
            sheet.append_rows(rows_to_append, value_input_option="USER_ENTERED")

        # Tandai sebagai synced
        expense_ids = [e.id for e in unsynced]
        await mark_synced_to_sheets(db, expense_ids)
        await db.commit()

        return len(rows_to_append)

    except Exception as e:
        print(f"[SHEETS SYNC ERROR] {e}")
        return 0
