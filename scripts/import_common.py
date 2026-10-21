"""
scripts/import_common.py — Logika impor bersama untuk Sheets & CSV.

Modul ini sengaja dipisah supaya `import_from_sheets.py` dan `import_from_csv.py`
memakai parser dan penulis database yang SAMA. Kalau parsing nilai uang
diduplikasi, cepat atau lambat dua salinan itu akan berbeda perilaku dan
menghasilkan angka yang salah di salah satu jalur.

Konvensi kolom mengikuti `saveDataToSheet()` di kode.gs lama (15 kolom):
    0 timestamp | 1 tanggal | 2 supplier | 3 barang | 4 qty | 5 kategori
    6 harga_satuan | 7 tax | 8 diskon | 9 total_harga | 10 metode_bayar
    11 status_pembayaran | 12 jatuh_tempo | 13 keterangan | 14 msg_link
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SHEET_NAME = "Pengeluaran"
EXPECTED_COLUMNS = 15

COLUMN_MAP = (
    "timestamp",
    "tanggal",
    "toko_supplier",
    "barang",
    "qty",
    "kategori",
    "harga_satuan",
    "tax",
    "diskon",
    "total_harga",
    "metode_bayar",
    "status_pembayaran",
    "jatuh_tempo",
    "keterangan",
    "msg_link",
)


# ──────────────────────────────────────────────
# Konversi nilai sel → tipe database
# ──────────────────────────────────────────────

def parse_decimal(value: Any) -> Decimal:
    """Konversi nilai sel apa pun ke Decimal yang aman untuk kolom Numeric.

    Sheet/CSV ini berisi angka Rupiah, jadi titik hampir selalu pemisah ribuan:
    "15.000" berarti lima belas ribu, bukan 15,0. Menebak salah di sini
    menggeser nilai uang sampai 1000x, jadi aturannya dibuat konservatif:

    - Titik + koma  → ikuti posisi terakhir: "15.000,50" (ID) atau
      "15,000.50" (internasional).
    - Hanya titik   → pemisah ribuan bila setiap grup setelah titik tepat
      3 digit ("15.000", "1.500.000"); selain itu desimal ("15.5").
    - Hanya koma    → desimal bila 1-2 digit di belakang koma ("1,5"),
      selain itu pemisah ribuan ("15,000").
    """
    if value is None or value == "":
        return Decimal("0")

    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))

    text = str(value).strip()
    if not text:
        return Decimal("0")

    # Buang simbol mata uang, spasi, dan non-breaking space.
    for junk in ("Rp", "rp", "RP", " ", "\u00a0"):
        text = text.replace(junk, "")

    negative = text.startswith("-")
    if negative:
        text = text[1:]

    # Pola pemisah ribuan bertitik: "15.000", "1.500.000", "12.345.678".
    if "," not in text and text.count(".") >= 1:
        parts = text.split(".")
        head, tail_groups = parts[0], parts[1:]
        if head.isdigit() and all(len(g) == 3 and g.isdigit() for g in tail_groups):
            text = head + "".join(tail_groups)

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        head, _, tail = text.partition(",")
        text = f"{head}.{tail}" if len(tail) <= 2 else text.replace(",", "")

    try:
        result = Decimal(text)
    except (InvalidOperation, ValueError):
        return Decimal("0")

    return -result if negative else result


def parse_date(
    value: Any,
    fallback: date | None = None,
    date_format: str | None = None,
) -> date:
    """Parse tanggal dari sel/CSV.

    Args:
        value: nilai mentah (datetime, date, atau string).
        fallback: dipakai bila kosong/tidak bisa diparse.
        date_format: format eksplisit, mis. "%d/%m/%Y". Penting untuk tanggal
            ambigu seperti "03/04/2026" yang bisa berarti 3 April atau 4 Maret.
            Tanpa ini, format Indonesia (%d/%m/%Y) diutamakan.
    """
    fallback = fallback or date.today()

    if value is None or value == "":
        return fallback

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return fallback

    # Buang jam bila ada: "2026-10-21 14:30:00" / "2026-10-21T14:30:00"
    text = text.split("T")[0].split(" ")[0]

    formats: tuple[str, ...]
    if date_format:
        formats = (date_format,)
    else:
        # Urutan penting: format Indonesia (%d/%m) didahulukan daripada
        # format Amerika (%m/%d) karena data berasal dari aplikasi Indonesia.
        formats = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y")

    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    return fallback


def is_parseable_date(value: Any, date_format: str | None = None) -> bool:
    """Cek apakah nilai bisa diparse sebagai tanggal, tanpa fallback.

    Dipakai untuk membedakan baris header ("Tanggal", "toko_supplier") dari
    baris data. `parse_date()` tidak bisa dipakai untuk ini karena selalu
    mengembalikan nilai (fallback hari ini).
    """
    if value is None or value == "":
        return False
    if isinstance(value, (datetime, date)):
        return True

    text = str(value).strip()
    if not text:
        return False

    text = text.split("T")[0].split(" ")[0]
    formats = (date_format,) if date_format else (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
    )
    for fmt in formats:
        try:
            datetime.strptime(text, fmt)
            return True
        except (ValueError, TypeError):
            continue
    return False


def parse_datetime(value: Any, fallback: date) -> datetime:
    """Parse timestamp pembuatan baris (kolom pertama)."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())

    text = str(value or "").strip()
    if text:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M:%S"):
            try:
                return datetime.strptime(text.split(".")[0], fmt)
            except ValueError:
                continue

    # Tanpa timestamp valid, pakai tanggal transaksi agar urutan tetap masuk akal.
    return datetime.combine(fallback, datetime.min.time())


def cell_text(value: Any, default: str = "-") -> str:
    """Ambil teks sel; sel kosong jadi default."""
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def row_to_expense_data(
    row: list[Any],
    row_number: int = 0,
    date_format: str | None = None,
) -> dict[str, Any] | None:
    """Petakan satu baris (15 kolom) ke kwargs model Expense.

    Return None bila baris tidak layak diimpor (kosong atau tanpa nama barang),
    supaya baris kosong tidak menghasilkan record sampah.
    """
    if not row or all(str(cell).strip() == "" for cell in row):
        return None

    # Normalisasi panjang baris: Sheets memotong trailing sel kosong dan CSV
    # kadang punya kolom kurang bila sel terakhir kosong.
    cells = list(row) + [""] * max(0, EXPECTED_COLUMNS - len(row))

    item_name = cell_text(cells[3], default="")
    if not item_name:
        return None

    expense_date = parse_date(cells[1], date_format=date_format)
    qty = parse_decimal(cells[4])

    return {
        "created_at": parse_datetime(cells[0], expense_date),
        "expense_date": expense_date,
        "supplier": cell_text(cells[2]),
        "item_name": item_name,
        "qty": qty if qty > 0 else Decimal("1"),
        "category": cell_text(cells[5], default="Operasional"),
        "unit_price": parse_decimal(cells[6]),
        "tax": parse_decimal(cells[7]),
        "discount": parse_decimal(cells[8]),
        "total_price": parse_decimal(cells[9]),
        "pay_method": cell_text(cells[10], default="Tunai"),
        "pay_status": cell_text(cells[11], default="Lunas"),
        "due_date": cell_text(cells[12]),
        "notes": cell_text(cells[13]),
        "msg_link": cell_text(cells[14], default="Private Chat"),
        "user_id": None,
        # PENTING: baris historis SUDAH ada di Sheet/CSV sumber. Tandai synced
        # agar job sync tidak menuliskannya kembali ke Sheet (mencegah duplikat).
        "sheets_synced": True,
        "_source_row": row_number,
    }


# ──────────────────────────────────────────────
# Penulisan ke database
# ──────────────────────────────────────────────

def money_key(value: Any) -> Decimal:
    """Normalisasi nilai uang ke 2 desimal untuk keperluan pembandingan.

    `str(Decimal)` tidak bisa dipakai karena ikut menyertakan skala: nilai dari
    CSV bisa jadi Decimal("30000") sedangkan dari Postgres Decimal("30000.00").
    Dibandingkan sebagai string keduanya berbeda, sehingga impor ulang
    menganggap semua baris baru dan menduplikasi seluruh data.
    """
    try:
        amount = Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError):
        amount = Decimal("0")
    return amount.quantize(Decimal("0.01"))


def expense_key(
    expense_date: Any,
    supplier: Any,
    item_name: Any,
    total_price: Any,
) -> tuple:
    """Kunci identitas satu baris pengeluaran.

    Dipakai untuk dedupe impor, jadi harus menghasilkan kunci yang sama baik
    untuk data yang baru diparse dari CSV maupun untuk record yang dibaca
    kembali dari database.
    """
    return (
        str(expense_date),
        str(supplier or "").strip().lower(),
        str(item_name or "").strip().lower(),
        money_key(total_price),
    )


def dedupe_key(data: dict[str, Any]) -> tuple:
    """Kunci pembanding agar impor bisa diulang tanpa duplikasi."""
    return expense_key(
        data["expense_date"],
        data["supplier"],
        data["item_name"],
        data["total_price"],
    )


async def import_rows(
    rows: list[list[Any]],
    dry_run: bool = False,
    limit: int | None = None,
    date_format: str | None = None,
    source_row_start: int = 2,
) -> dict[str, int]:
    """Simpan baris (tanpa header) ke Postgres dan kembalikan statistik.

    Args:
        rows: baris data, header sudah dibuang oleh pemanggil.
        dry_run: hanya tampilkan hasil parsing, tanpa menulis.
        limit: batasi jumlah baris valid yang diproses.
        date_format: format tanggal eksplisit untuk data ambigu.
        source_row_start: nomor baris pertama di file sumber (untuk pelaporan).
    """
    stats = {"parsed": 0, "skipped_invalid": 0, "skipped_duplicate": 0, "inserted": 0}

    parsed_rows: list[dict[str, Any]] = []
    for offset, row in enumerate(rows):
        if limit is not None and len(parsed_rows) >= limit:
            break
        data = row_to_expense_data(
            row, source_row_start + offset, date_format=date_format
        )
        if data is None:
            stats["skipped_invalid"] += 1
            continue
        parsed_rows.append(data)
        stats["parsed"] += 1

    if dry_run:
        for data in parsed_rows:
            print(
                f"  baris {data['_source_row']:>5}: {data['expense_date']} | "
                f"{data['supplier'][:18]:<18} | {data['item_name'][:26]:<26} | "
                f"{str(data['total_price']):>12} | {data['category'][:16]}"
            )
        print("\n--dry-run: tidak ada perubahan pada database.")
        return stats

    if not parsed_rows:
        return stats

    from sqlalchemy import select

    from app.database.connection import AsyncSessionLocal
    from app.models.expense import Expense

    async with AsyncSessionLocal() as db:
        existing_result = await db.execute(select(Expense))
        existing_keys = {
            expense_key(e.expense_date, e.supplier, e.item_name, e.total_price)
            for e in existing_result.scalars().all()
        }

        batch_keys: set[tuple] = set()

        for data in parsed_rows:
            key = dedupe_key(data)
            if key in existing_keys or key in batch_keys:
                stats["skipped_duplicate"] += 1
                continue

            batch_keys.add(key)
            payload = {k: v for k, v in data.items() if not k.startswith("_")}
            db.add(Expense(**payload))
            stats["inserted"] += 1

        await db.commit()

    return stats


def print_summary(stats: dict[str, int], dry_run: bool) -> None:
    """Cetak ringkasan hasil impor secara konsisten."""
    print("Ringkasan:")
    print(f"  baris valid        : {stats['parsed']}")
    print(f"  baris kosong/rusak : {stats['skipped_invalid']}")
    if not dry_run:
        print(f"  duplikat dilewati  : {stats['skipped_duplicate']}")
        print(f"  berhasil dimasukkan: {stats['inserted']}")


def load_env() -> None:
    """Muat .env repo (script berjalan di host, app dapat env dari Docker)."""
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
