#!/usr/bin/env python3
"""
scripts/import_from_csv.py — Impor data historis dari file CSV ke PostgreSQL.

Kenapa CSV?
-----------
Jalur Google Sheets butuh service account, dua API diaktifkan, dan spreadsheet
di-share ke email robot. Untuk impor riwayat sekali jalan, itu berlebihan.
Export saja spreadsheet-nya ke CSV, lalu impor dari sini.

Yang ditangani otomatis:
- Delimiter koma (,) maupun titik-koma (;) — Excel dengan locale Indonesia
  menyimpan CSV bertitik-koma, dan itu penyebab paling umum data "jadi satu
  kolom" saat dibuka dengan parser koma.
- Encoding UTF-8 (dengan/tanpa BOM) dan CP1252/Latin-1 (default Excel
  Indonesia yang tidak memilih UTF-8).
- Angka Rupiah: "Rp 15.000", "1.500.000", "15.000,50", "15,000.50".
- Baris kosong dan baris tanpa nama barang dilewati.

Pemakaian
---------
    # Export dari Google Sheets: File → Download → Comma Separated Values
    python scripts/import_from_csv.py pengeluaran.csv --dry-run
    python scripts/import_from_csv.py pengeluaran.csv

    # Tanggal ambigu (03/04/2026) — tentukan formatnya
    python scripts/import_from_csv.py pengeluaran.csv --date-format "%d/%m/%Y"

    # CSV tanpa baris header
    python scripts/import_from_csv.py pengeluaran.csv --no-header

CATATAN PENTING: impor ini menandai semua baris sebagai `sheets_synced = True`.
Itu benar untuk data yang SUDAH ada di Sheet, karena mencegah job sync
menuliskannya kembali dan membuat duplikat.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import sys
from pathlib import Path
from typing import Any

# Import modul bersama; script ini dijalankan langsung sebagai file.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_common import (  # noqa: E402
    EXPECTED_COLUMNS,
    import_rows,
    load_env,
    print_summary,
)

# Urutan percobaan encoding. UTF-8 dengan BOM ("utf-8-sig") menangani file
# hasil export Google Sheets; cp1252/latin-1 menangani Excel locale Indonesia
# yang menyimpan karakter seperti "é" atau "–" tanpa UTF-8.
ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")

# Kandidat delimiter, dari yang paling umum.
DELIMITERS = (",", ";", "\t", "|")


def sniff_delimiter(sample: str) -> str:
    """Tebak delimiter dari beberapa baris pertama.

    Sengaja TIDAK memakai `csv.Sniffer`: pada file Indonesia yang memakai
    titik-koma sebagai pemisah kolom namun koma sebagai pemisah desimal
    (mis. "1,5"), Sniffer sering salah memilih koma. Akibatnya seluruh baris
    terbaca sebagai satu kolom dan impor menghasilkan data rusak tanpa error.

    Pendekatan yang dipakai: untuk setiap kandidat delimiter, parse tiap baris
    dengan `csv.reader` (supaya tanda kutip dihormati) lalu hitung jumlah
    kolom. Delimiter terbaik adalah yang menghasilkan jumlah kolom KONSISTEN
    di semua baris DAN kolomnya paling banyak.
    """
    lines = [line for line in sample.splitlines() if line.strip()][:20]
    if not lines:
        return ","

    best_delim = ","
    best_score: tuple[int, int] = (-1, -1)

    for delim in DELIMITERS:
        try:
            counts = [
                len(next(csv.reader([line], delimiter=delim))) for line in lines
            ]
        except csv.Error:
            continue

        if not counts or max(counts) <= 1:
            continue

        # Jumlah kolom yang paling sering muncul.
        modal = max(set(counts), key=counts.count)
        consistent = counts.count(modal) == len(counts)

        score = (1 if consistent else 0, modal)
        if score > best_score:
            best_score = score
            best_delim = delim

    return best_delim


def read_csv_rows(path: Path) -> tuple[list[list[str]], str, str]:
    """Baca CSV. Return (rows, encoding, delimiter) tanpa baris header.

    Header dibuang di sini karena `import_common.import_rows` hanya menerima
    baris data.
    """
    raw = path.read_bytes()

    text: str | None = None
    used_encoding = ""
    for encoding in ENCODINGS:
        try:
            text = raw.decode(encoding)
            used_encoding = encoding
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        raise ValueError(
            "Tidak bisa membaca file dengan encoding umum "
            f"({', '.join(ENCODINGS)}). Simpan ulang sebagai UTF-8."
        )

    sample = "\n".join(text.splitlines()[:20])
    delimiter = sniff_delimiter(sample)

    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    rows: list[list[str]] = []
    for row in reader:
        # csv menambahkan baris kosong untuk blank line; simpan apa adanya
        # karena import_rows yang akan menyaringnya.
        rows.append(row)

    return rows, used_encoding, delimiter


def looks_like_header(row: list[str]) -> bool:
    """Deteksi apakah baris pertama adalah header, bukan data.

    Heuristik: header biasanya tidak punya tanggal valid di kolom ke-2 dan
    tidak punya angka di kolom total. Data asli hampir selalu punya keduanya.
    """
    from import_common import is_parseable_date, parse_decimal

    cells = list(row) + [""] * max(0, EXPECTED_COLUMNS - len(row))

    # Tanggal yang bisa diparse? Kalau ya, ini bukan header.
    if is_parseable_date(cells[1]):
        return False

    # Total angka > 0? Kalau ya, ini bukan header.
    if parse_decimal(cells[9]) > 0:
        return False

    # Tidak ada jejak data → anggap header.
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Impor data historis dari file CSV ke PostgreSQL."
    )
    parser.add_argument("csv_path", help="Path ke file CSV hasil export Sheets.")
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
    parser.add_argument(
        "--date-format",
        default=None,
        help=(
            "Format tanggal eksplisit, mis. \"%%d/%%m/%%Y\". "
            "Pakai ini bila tanggal ambigu seperti 03/04/2026."
        ),
    )
    parser.add_argument(
        "--no-header",
        action="store_true",
        help="File CSV tidak punya baris header.",
    )
    parser.add_argument(
        "--delimiter",
        default=None,
        help="Paksa delimiter tertentu (mis. ';'). Default: deteksi otomatis.",
    )
    args = parser.parse_args()

    load_env()

    path = Path(args.csv_path).expanduser()
    if not path.is_file():
        print(f"ERROR: File tidak ditemukan: {path}", file=sys.stderr)
        return 1

    try:
        rows, encoding, delimiter = read_csv_rows(path)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    # Override deteksi bila user memaksa delimiter.
    if args.delimiter:
        text = path.read_text(encoding=encoding, errors="replace")
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=args.delimiter)
        rows = [row for row in reader]
        delimiter = args.delimiter

    print(f"File        : {path}")
    print(f"Encoding    : {encoding}")
    print(f"Delimiter   : {delimiter!r}")
    print(f"Mode        : {'DRY-RUN (tanpa menulis)' if args.dry_run else 'IMPOR'}")
    if args.date_format:
        print(f"Date format : {args.date_format}")
    print()

    # Buang header bila ada.
    source_row_start = 2
    if args.no_header:
        source_row_start = 1
    elif rows and looks_like_header(rows[0]):
        print(f"Header terdeteksi & dilewati: {', '.join(rows[0][:6])}...")
        rows = rows[1:]
    else:
        source_row_start = 1
        print("Tidak ada header terdeteksi — semua baris diperlakukan sebagai data.")

    print(f"Baris data  : {len(rows)}\n")

    stats = await import_rows(
        rows,
        dry_run=args.dry_run,
        limit=args.limit,
        date_format=args.date_format,
        source_row_start=source_row_start,
    )

    print_summary(stats, args.dry_run)

    if not args.dry_run and stats["inserted"] > 0:
        print(
            "\nData historis ditandai sheets_synced = True, sehingga job sync "
            "tidak akan menuliskannya balik ke Google Sheets."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
