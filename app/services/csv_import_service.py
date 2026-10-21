"""
app/services/csv_import_service.py — Service untuk parsing, sanitasi, dan validasi file CSV pengeluaran.
Mendukung ekspor Google Sheets v1 (kode.gs) dan format CSV fleksibel.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


@dataclass
class CsvParseResult:
    """Hasil parsing file CSV."""
    valid_rows: list[dict] = field(default_factory=list)
    skipped_rows: list[dict] = field(default_factory=list)
    total_rows: int = 0


def parse_rupiah(value: str | int | float | Decimal | None) -> Decimal:
    """
    Sanitasi string mata uang Indonesia atau angka ke Decimal.
    Contoh:
        "Rp 15.000,00" -> Decimal("15000.00")
        "15.000"       -> Decimal("15000.00")
        "15,000.50"    -> Decimal("15000.50")
        "1,500,000"    -> Decimal("1500000.00")
        "" / None      -> Decimal("0.00")
    """
    if value is None:
        return Decimal("0.00")
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value)).quantize(Decimal("0.01"))

    val = str(value).strip()
    if not val or val == "-":
        return Decimal("0.00")

    # Bersihkan prefix Rp, IDR, spasi
    val = re.sub(r"(?i)^(rp|idr)\.?\s*", "", val).strip()

    # Bersihkan karakter non-digit selain . , dan -
    val = re.sub(r"[^\d.,\-]", "", val)
    if not val:
        return Decimal("0.00")

    is_negative = val.startswith("-")
    val = val.lstrip("-")

    # Deteksi pola pemisah ribuan dan desimal:
    # Kasus 1: Ada . dan ,
    if "." in val and "," in val:
        last_dot = val.rfind(".")
        last_comma = val.rfind(",")
        if last_comma > last_dot:
            # Format Indonesia: 15.000,50 -> buang titik, ganti koma jadi titik
            val = val.replace(".", "").replace(",", ".")
        else:
            # Format Inggris: 15,000.50 -> buang koma
            val = val.replace(",", "")
    elif "," in val:
        # Hanya ada koma: bisa desimal (15,5) atau ribuan (15,000)
        parts = val.split(",")
        if len(parts) == 2 and len(parts[1]) in (1, 2):
            # Desimal Indonesia (misal 15,5 atau 15,50)
            val = val.replace(",", ".")
        else:
            # Ribuan gaya US (15,000)
            val = val.replace(",", "")
    elif "." in val:
        # Hanya ada titik: bisa ribuan (15.000) atau desimal (15.5)
        parts = val.split(".")
        if len(parts) > 2:
            # Multiple dots = ribuan (1.500.000)
            val = val.replace(".", "")
        elif len(parts) == 2:
            if len(parts[1]) == 3:
                # Titik ribuan (misal 15.000)
                val = val.replace(".", "")
            else:
                # Desimal standar (15.5 atau 15.50)
                pass

    try:
        dec = Decimal(val)
        if is_negative:
            dec = -dec
        return dec.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def parse_date_id(value: str | date | datetime | None) -> date | None:
    """
    Parse string tanggal Indonesia / ISO ke datetime.date.
    Format yang didukung:
        YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY
        atau string timestamp ISO / Google Sheets: "2026-10-21 14:30:00"
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    val = str(value).strip()
    if not val or val == "-":
        return None

    # Jika mengandung jam, ambil bagian tanggalnya saja
    if " " in val:
        val = val.split(" ")[0].strip()
    if "T" in val:
        val = val.split("T")[0].strip()

    formats = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d/%m/%y",
        "%d-%m-%y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue

    return None


def detect_header(row: list[str]) -> bool:
    """
    Deteksi apakah baris pertama adalah header tabel pengeluaran.
    Mencari kecocokan minimal 2 kata kunci header.
    """
    keywords = {
        "tanggal", "date", "tgl",
        "barang", "item", "nama barang",
        "kategori", "category",
        "total", "harga", "harga satuan",
        "toko", "supplier", "qty", "jumlah"
    }
    matches = 0
    for cell in row:
        clean = str(cell).strip().lower()
        if clean in keywords or any(kw in clean for kw in ("tanggal", "barang", "kategori", "total")):
            matches += 1
            if matches >= 2:
                return True
    return False


def build_header_map(row: list[str]) -> dict[str, int]:
    """Buat pemetaan kolom berdasarkan nama header di baris pertama."""
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(row):
        name = str(cell).strip().lower()
        if not name:
            continue

        if any(k in name for k in ("tgl nota", "tgl", "tanggal", "date")) and "timestamp" not in name:
            mapping.setdefault("expense_date", idx)
        elif "timestamp" in name or "waktu catat" in name or "created" in name:
            mapping.setdefault("created_at", idx)
        elif any(k in name for k in ("toko", "supplier", "vendor")):
            mapping.setdefault("supplier", idx)
        elif any(k in name for k in ("nama barang", "barang", "item", "nama item")):
            mapping.setdefault("item_name", idx)
        elif any(k in name for k in ("qty", "jumlah", "kuantitas", "quantity")):
            mapping.setdefault("qty", idx)
        elif any(k in name for k in ("kategori", "category")):
            mapping.setdefault("category", idx)
        elif any(k in name for k in ("harga satuan", "harga_satuan", "unit price", "unit_price", "harga per unit")):
            mapping.setdefault("unit_price", idx)
        elif any(k in name for k in ("tax", "pajak", "ppn")):
            mapping.setdefault("tax", idx)
        elif any(k in name for k in ("diskon", "discount", "potongan")):
            mapping.setdefault("discount", idx)
        elif any(k in name for k in ("total harga", "total_harga", "total", "subtotal", "nominal")):
            mapping.setdefault("total_price", idx)
        elif any(k in name for k in ("metode bayar", "metode_bayar", "cara bayar", "pembayaran")):
            mapping.setdefault("pay_method", idx)
        elif any(k in name for k in ("status bayar", "status pembayaran", "status_pembayaran", "status")):
            mapping.setdefault("pay_status", idx)
        elif any(k in name for k in ("jatuh tempo", "jatuh_tempo", "due date", "tempo")):
            mapping.setdefault("due_date", idx)
        elif any(k in name for k in ("keterangan", "catatan", "notes", "ket")):
            mapping.setdefault("notes", idx)
        elif any(k in name for k in ("link pesan", "link chat", "msg_link", "link")):
            mapping.setdefault("msg_link", idx)

    return mapping


def map_row_to_expense(
    row: list[str],
    header_map: dict[str, int] | None = None,
) -> dict | None:
    """
    Petakan baris CSV ke dict pengeluaran.
    Jika header_map tersedia, gunakan pemetaan kolom cerdas.
    Jika tidak, gunakan pemetaan posisi baku Google Apps Script (15 kolom).
    """
    if not row or all(not str(c).strip() for c in row):
        return None

    def get_val(idx: int | None, default: str = "") -> str:
        if idx is not None and 0 <= idx < len(row):
            return str(row[idx]).strip()
        return default

    # 1. Mode Header Map
    if header_map:
        raw_date = get_val(header_map.get("expense_date"))
        parsed_date = parse_date_id(raw_date)

        raw_item = get_val(header_map.get("item_name"))
        if not raw_item and not parsed_date:
            return None

        qty_dec = parse_rupiah(get_val(header_map.get("qty"), "1"))
        if qty_dec <= 0:
            qty_dec = Decimal("1")

        unit_price_dec = parse_rupiah(get_val(header_map.get("unit_price"), "0"))
        tax_dec = parse_rupiah(get_val(header_map.get("tax"), "0"))
        discount_dec = parse_rupiah(get_val(header_map.get("discount"), "0"))
        total_price_dec = parse_rupiah(get_val(header_map.get("total_price"), "0"))

        return {
            "expense_date": parsed_date,
            "supplier": get_val(header_map.get("supplier"), "-") or "-",
            "item_name": raw_item or "Barang",
            "qty": qty_dec,
            "category": get_val(header_map.get("category"), "Operasional") or "Operasional",
            "unit_price": unit_price_dec,
            "tax": tax_dec,
            "discount": discount_dec,
            "total_price": total_price_dec,
            "pay_method": get_val(header_map.get("pay_method"), "Tunai") or "Tunai",
            "pay_status": get_val(header_map.get("pay_status"), "Lunas") or "Lunas",
            "due_date": get_val(header_map.get("due_date"), "-") or "-",
            "notes": get_val(header_map.get("notes"), "-") or "-",
            "msg_link": get_val(header_map.get("msg_link"), "Import CSV") or "Import CSV",
        }

    # 2. Mode Posisi Baku Google Sheets (15 Kolom)
    # Kolom 0: Timestamp, Kolom 1: Tanggal, Kolom 2: Toko, Kolom 3: Barang, ...
    if len(row) >= 4:
        # Cek apakah kolom 0 adalah tanggal atau timestamp
        date_cand1 = parse_date_id(get_val(1))
        date_cand0 = parse_date_id(get_val(0))

        if date_cand1:
            # Format GAS standar: Kolom 0 = created_at, Kolom 1 = expense_date
            exp_date = date_cand1
            supplier_idx, item_idx, qty_idx, cat_idx = 2, 3, 4, 5
            unit_idx, tax_idx, disc_idx, total_idx = 6, 7, 8, 9
            method_idx, status_idx, due_idx, notes_idx, link_idx = 10, 11, 12, 13, 14
        elif date_cand0:
            # Format ringkas tanpa timestamp: Kolom 0 = expense_date, Kolom 1 = Toko, Kolom 2 = Barang
            exp_date = date_cand0
            supplier_idx, item_idx, qty_idx, cat_idx = 1, 2, 3, 4
            unit_idx, tax_idx, disc_idx, total_idx = 5, 6, 7, 8
            method_idx, status_idx, due_idx, notes_idx, link_idx = 9, 10, 11, 12, 13
        else:
            exp_date = None
            supplier_idx, item_idx, qty_idx, cat_idx = 2, 3, 4, 5
            unit_idx, tax_idx, disc_idx, total_idx = 6, 7, 8, 9
            method_idx, status_idx, due_idx, notes_idx, link_idx = 10, 11, 12, 13, 14

        qty_dec = parse_rupiah(get_val(qty_idx, "1"))
        if qty_dec <= 0:
            qty_dec = Decimal("1")

        return {
            "expense_date": exp_date,
            "supplier": get_val(supplier_idx, "-") or "-",
            "item_name": get_val(item_idx, "Barang") or "Barang",
            "qty": qty_dec,
            "category": get_val(cat_idx, "Operasional") or "Operasional",
            "unit_price": parse_rupiah(get_val(unit_idx, "0")),
            "tax": parse_rupiah(get_val(tax_idx, "0")),
            "discount": parse_rupiah(get_val(disc_idx, "0")),
            "total_price": parse_rupiah(get_val(total_idx, "0")),
            "pay_method": get_val(method_idx, "Tunai") or "Tunai",
            "pay_status": get_val(status_idx, "Lunas") or "Lunas",
            "due_date": get_val(due_idx, "-") or "-",
            "notes": get_val(notes_idx, "-") or "-",
            "msg_link": get_val(link_idx, "Import CSV") or "Import CSV",
        }

    return None


def audit_calculation(data: dict) -> dict:
    """
    Verifikasi dan rekalkulasi rumus matematika:
    total_price = (qty * unit_price) + tax - discount
    Port dari auditCalculations() di kode.gs.
    """
    qty = data.get("qty") or Decimal("1")
    unit_price = data.get("unit_price") or Decimal("0")
    tax = data.get("tax") or Decimal("0")
    discount = data.get("discount") or Decimal("0")
    total_price = data.get("total_price") or Decimal("0")

    expected_total = (qty * unit_price) + tax - discount

    # Jika total_price kosong/nol tapi ada qty & unit_price
    if total_price <= 0 and expected_total > 0:
        data["total_price"] = expected_total
    # Jika unit_price nol tapi ada total_price & qty
    elif unit_price <= 0 and total_price > 0 and qty > 0:
        calculated_unit = (total_price - tax + discount) / qty
        data["unit_price"] = calculated_unit.quantize(Decimal("0.01"))
    # Jika ada selisih perhitungan lebih dari 1 Rupiah dan unit_price > 0
    elif unit_price > 0 and abs(total_price - expected_total) > Decimal("1.00"):
        data["total_price"] = expected_total

    return data


def validate_expense_dict(data: dict, valid_categories: list[str]) -> list[str]:
    """
    Validasi field required dan format data pengeluaran.
    Return list of error messages (kosong jika valid).
    """
    errors: list[str] = []

    if not data.get("expense_date"):
        errors.append("Tanggal pengeluaran tidak valid atau kosong")

    item_name = str(data.get("item_name") or "").strip()
    if not item_name or item_name == "Barang":
        # Periksa jika benar-benar kosong
        if not item_name:
            errors.append("Nama barang wajib diisi")

    total_price = data.get("total_price")
    if total_price is None or total_price < Decimal("0.00"):
        errors.append("Total harga tidak boleh negatif")

    # Normalisasi kategori
    category = str(data.get("category") or "").strip()
    if valid_categories:
        valid_lower = {c.lower(): c for c in valid_categories}
        if category.lower() in valid_lower:
            data["category"] = valid_lower[category.lower()]
        else:
            # Jangan batalkan baris hanya karena kategori typo, beri fallback aman
            data["category"] = "Operasional"

    return errors


def parse_csv_file(
    content: bytes,
    valid_categories: list[str] | None = None,
) -> CsvParseResult:
    """
    Parse bytes file CSV menjadi list item yang tervalidasi dan siap insert.
    Mendukung deteksi encoding otomatis (utf-8, utf-8-sig, cp1252, latin-1).
    """
    if not content:
        return CsvParseResult(valid_rows=[], skipped_rows=[], total_rows=0)

    # Deteksi encoding
    decoded_text = ""
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            decoded_text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if not decoded_text:
        return CsvParseResult(
            valid_rows=[],
            skipped_rows=[{"row_num": 1, "reason": "Encoding file tidak dikenali", "raw": ""}],
            total_rows=0,
        )

    # Deteksi delimiter (koma, titik koma, atau tab)
    sample = decoded_text[:2048]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        delimiter = dialect.delimiter
    except Exception:
        # Default koma, tapi cek apakah lebih banyak titik koma
        if sample.count(";") > sample.count(","):
            delimiter = ";"

    reader = csv.reader(io.StringIO(decoded_text), delimiter=delimiter)
    all_rows = list(reader)

    if not all_rows:
        return CsvParseResult(valid_rows=[], skipped_rows=[], total_rows=0)

    # Cek header
    first_row = all_rows[0]
    has_header = detect_header(first_row)
    header_map = build_header_map(first_row) if has_header else None
    data_rows = all_rows[1:] if has_header else all_rows

    valid_rows: list[dict] = []
    skipped_rows: list[dict] = []

    cats = valid_categories or []

    for idx, row in enumerate(data_rows, start=2 if has_header else 1):
        if not row or all(not str(c).strip() for c in row):
            continue  # Abaikan baris kosong

        mapped = map_row_to_expense(row, header_map)
        if not mapped:
            skipped_rows.append({
                "row_num": idx,
                "reason": "Format baris tidak sesuai atau data kosong",
                "raw": " | ".join(row[:5]),
            })
            continue

        # Audit kalkulasi matematika
        mapped = audit_calculation(mapped)

        # Validasi field
        errs = validate_expense_dict(mapped, cats)
        if errs:
            skipped_rows.append({
                "row_num": idx,
                "reason": ", ".join(errs),
                "raw": f"{mapped.get('item_name', '-')} ({mapped.get('expense_date', '-')})",
            })
            continue

        valid_rows.append(mapped)

    return CsvParseResult(
        valid_rows=valid_rows,
        skipped_rows=skipped_rows,
        total_rows=len(valid_rows) + len(skipped_rows),
    )
