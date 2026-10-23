"""
app/services/sheets_service.py — Google Sheets background sync
Data baru di Postgres → sync ke Sheets agar tim tetap bisa pakai Sheets
"""
import json
import os
import re
from datetime import datetime, date
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.expense import Expense

# Dicatat sekali saja: tanpa credential, job 5 menit akan menulis error yang sama
# berulang kali ke log. Data tetap menunggu dengan sheets_synced = false.
_missing_credentials_reported = False


def extract_spreadsheet_id(raw_id: str) -> str:
    """Ekstrak Spreadsheet ID jika user memasukkan full URL Google Sheets atau ID dengan spasi."""
    if not raw_id:
        return ""
    raw = raw_id.strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", raw)
    if match:
        return match.group(1)
    return raw.strip("/")


def resolve_credentials_path(path_str: str) -> Path:
    """Cari path file credentials.json baik relatif ke CWD atau relatif ke project root."""
    p = Path(path_str)
    if p.is_absolute() and p.exists():
        return p
    if p.exists():
        return p.resolve()
    # Relatif ke project root (CatatanPengeluaran)
    project_root = Path(__file__).resolve().parent.parent.parent
    candidate = project_root / path_str
    if candidate.exists():
        return candidate.resolve()
    return p


def get_service_account_email(creds_path: Path | str) -> str | None:
    """Ambil client_email dari credentials.json bila tersedia."""
    try:
        p = Path(creds_path)
        if p.is_file():
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("client_email")
    except Exception:
        pass
    return None


async def sync_to_sheets(
    db: AsyncSession, limit: int = 500, raise_on_error: bool = False
) -> int:
    """
    Sync semua expense yang belum ter-sync ke Google Sheets.
    Return jumlah row yang berhasil di-sync.
    Bila raise_on_error=True (mis. saat dipicu manual dari dashboard),
    error akan di-raise agar user mendapat pesan yang jelas, bukan sekadar 0 synced.
    """
    clean_sheet_id = extract_spreadsheet_id(settings.spreadsheet_id)
    if not clean_sheet_id:
        err_msg = (
            "Spreadsheet ID belum diatur. Harap masukkan Spreadsheet ID di tab "
            "Integrasi Google Sheets pada menu Konfigurasi."
        )
        if raise_on_error:
            raise ValueError(err_msg)
        return 0

    creds_path = resolve_credentials_path(settings.google_credentials_json)
    if not creds_path.is_file():
        global _missing_credentials_reported
        err_msg = (
            f"File kredensial Google ({settings.google_credentials_json}) belum ada. "
            "Harap unggah file credentials.json di tab Integrasi Google Sheets."
        )
        if raise_on_error:
            raise FileNotFoundError(err_msg)
        if not _missing_credentials_reported:
            print(f"[SHEETS SYNC] {err_msg} — sync ditunda sampai service account dipasang.")
            _missing_credentials_reported = True
        return 0

    from app.services.expense_service import get_unsynced_to_sheets, mark_synced_to_sheets

    unsynced = await get_unsynced_to_sheets(db, limit=limit)
    if not unsynced:
        return 0

    sa_email = get_service_account_email(creds_path)
    try:
        import gspread
        from google.oauth2.service_account import Credentials

        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ]
        creds = Credentials.from_service_account_file(str(creds_path), scopes=scopes)
        gc = gspread.authorize(creds)

        try:
            doc = gc.open_by_key(clean_sheet_id)
        except gspread.exceptions.APIError as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 403:
                email_hint = f" '{sa_email}'" if sa_email else ""
                raise PermissionError(
                    f"Akses Google Sheets ditolak (403 Forbidden). Pastikan spreadsheet telah dibagikan (Share) "
                    f"ke email Service Account{email_hint} dengan hak akses Editor."
                ) from e
            elif status_code == 404:
                raise FileNotFoundError(
                    f"Spreadsheet dengan ID '{clean_sheet_id}' tidak ditemukan (404 Not Found). "
                    "Periksa kembali Spreadsheet ID Anda dan pastikan Service Account memiliki akses."
                ) from e
            raise RuntimeError(f"Gagal membuka spreadsheet Google ({e}): {e}") from e
        except gspread.exceptions.SpreadsheetNotFound as e:
            raise FileNotFoundError(
                f"Spreadsheet dengan ID '{clean_sheet_id}' tidak ditemukan. "
                "Periksa kembali Spreadsheet ID Anda."
            ) from e

        # Cari tab worksheet 'Pengeluaran'
        sheet = None
        try:
            sheet = doc.worksheet("Pengeluaran")
        except gspread.exceptions.WorksheetNotFound:
            # Cari case-insensitive
            for ws in doc.worksheets():
                if ws.title.strip().lower() == "pengeluaran":
                    sheet = ws
                    break

            # Jika belum ada tab Pengeluaran, buat otomatis dengan 15 header standar
            if sheet is None:
                sheet = doc.add_worksheet(title="Pengeluaran", rows=1000, cols=20)
                headers = [
                    "Timestamp", "Tanggal Nota", "Toko / Supplier", "Barang", "Qty",
                    "Kategori", "Harga Satuan", "Tax", "Diskon", "Total Harga",
                    "Metode Bayar", "Status Pembayaran", "Jatuh Tempo", "Keterangan", "Link Pesan"
                ]
                sheet.append_row(headers, value_input_option="USER_ENTERED")

        rows_to_append = []
        for e in unsynced:
            # Timestamp created_at aman
            if isinstance(e.created_at, datetime):
                created_at_str = e.created_at.strftime("%Y-%m-%d %H:%M:%S")
            elif e.created_at:
                created_at_str = str(e.created_at)
            else:
                created_at_str = ""

            # Tanggal nota aman
            if isinstance(e.expense_date, (date, datetime)):
                expense_date_str = e.expense_date.strftime("%Y-%m-%d")
            elif e.expense_date:
                expense_date_str = str(e.expense_date)
            else:
                expense_date_str = ""

            rows_to_append.append([
                created_at_str,
                expense_date_str,
                e.supplier or "-",
                e.item_name or "Barang",
                float(e.qty if e.qty is not None else 1),
                e.category or "Operasional",
                float(e.unit_price if e.unit_price is not None else 0),
                float(e.tax if e.tax is not None else 0),
                float(e.discount if e.discount is not None else 0),
                float(e.total_price if e.total_price is not None else 0),
                e.pay_method or "Tunai",
                e.pay_status or "Lunas",
                str(e.due_date or "-"),
                str(e.notes or "-"),
                str(e.msg_link or "Private Chat"),
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
        if raise_on_error:
            raise
        return 0
