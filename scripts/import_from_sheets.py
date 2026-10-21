#!/usr/bin/env python3
"""
scripts/import_from_sheets.py — Impor data historis Google Sheets → PostgreSQL.

Konteks
-------
Aplikasi ini hanya punya sync SATU ARAH (Postgres → Sheets). Data lama yang
sudah terlanjur ada di tab `Pengeluaran` tidak akan pernah masuk Postgres, jadi
dashboard dan `/rekap` di Telegram terlihat kosong. Script ini mengisi kekosongan
itu: membaca sheet sekali, lalu menyimpannya ke tabel `expenses`.

Butuh service account Google (lihat README). Kalau tujuannya hanya impor
riwayat sekali jalan dan Anda tidak mau mengurus service account, pakai
`import_from_csv.py` — hasilnya sama, tanpa setup GCP.

Dua hal yang membuat script ini aman dijalankan berulang:

1. Baris hasil impor ditandai `sheets_synced = True`. Sync 5 menit milik app
   hanya mengambil baris dengan `sheets_synced = False`, sehingga data historis
   TIDAK ditulis balik ke sheet (kalau tidak, sheet akan berisi duplikat).

2. Impor bersifat idempoten. Kombinasi (tanggal, supplier, item_name,
   total_price) dibandingkan dengan isi DB; baris yang sudah ada dilewati.

Pemakaian
---------
    python scripts/import_from_sheets.py --dry-run   # cek tanpa menulis
    python scripts/import_from_sheets.py             # impor sungguhan
    python scripts/import_from_sheets.py --limit 20  # uji coba
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any

# Import modul bersama; script ini dijalankan langsung sebagai file.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_common import (  # noqa: E402
    ROOT,
    SHEET_NAME,
    import_rows,
    load_env,
    print_summary,
)


def open_worksheet(credentials_path: str, spreadsheet_id: str):
    """Buka worksheet tab Pengeluaran dengan service account."""
    import gspread
    from google.oauth2.service_account import Credentials

    if not os.path.isfile(credentials_path):
        raise FileNotFoundError(
            f"Credential tidak ditemukan di '{credentials_path}'. "
            "Letakkan service account JSON di path tersebut, atau pakai "
            "import_from_csv.py bila tidak ingin mengurus service account."
        )

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(credentials_path, scopes=scopes)
    gc = gspread.authorize(creds)
    return gc.open_by_key(spreadsheet_id).worksheet(SHEET_NAME)


def read_sheet_rows(credentials_path: str, spreadsheet_id: str) -> list[list[Any]]:
    """Baca seluruh isi tab Pengeluaran (baris header dibuang)."""
    values = open_worksheet(credentials_path, spreadsheet_id).get_all_values()
    if not values:
        return []
    return values[1:]


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Impor data historis Google Sheets ke PostgreSQL."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Tampilkan hasil parsing tanpa menulis ke database.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Batasi jumlah baris yang diproses (untuk uji coba).",
    )
    args = parser.parse_args()

    load_env()

    spreadsheet_id = os.getenv("SPREADSHEET_ID", "")
    credentials_path = os.getenv("GOOGLE_CREDENTIALS_JSON", "secrets/credentials.json")

    if not spreadsheet_id:
        print("ERROR: SPREADSHEET_ID belum di-set di .env", file=sys.stderr)
        return 1

    if not os.path.isabs(credentials_path):
        credentials_path = str(ROOT / credentials_path)

    print(f"Spreadsheet : {spreadsheet_id}")
    print(f"Credential  : {credentials_path}")
    print(f"Tab         : {SHEET_NAME}")
    print(f"Mode        : {'DRY-RUN (tanpa menulis)' if args.dry_run else 'IMPOR'}")
    print()

    try:
        rows = read_sheet_rows(credentials_path, spreadsheet_id)
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — beri pesan yang bisa ditindaklanjuti
        print(f"ERROR membaca Google Sheets: {exc}", file=sys.stderr)
        print(
            "\nPeriksa:\n"
            "  1. Service account sudah di-share sebagai Editor pada spreadsheet.\n"
            "  2. Google Sheets API & Drive API sudah diaktifkan di project GCP.\n"
            f"  3. Tab bernama '{SHEET_NAME}' memang ada.\n"
            "\nAlternatif tanpa service account: export spreadsheet ke CSV lalu\n"
            "jalankan `python scripts/import_from_csv.py <file>.csv`.",
            file=sys.stderr,
        )
        return 1

    print(f"Baris data ditemukan di sheet: {len(rows)}\n")

    stats = await import_rows(rows, dry_run=args.dry_run, limit=args.limit)
    print_summary(stats, args.dry_run)

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
