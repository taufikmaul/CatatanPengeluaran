"""
app/utils/csv_helpers.py — Utilitas bersama untuk parsing & pembuatan template CSV.
"""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from app.services.sales_import_service import (
    _decode_csv_bytes,
    _detect_delimiter,
    _parse_date_id,
    _parse_number,
)


def parse_csv_table(content: bytes) -> tuple[list[str], list[list[str]]]:
    """Decode bytes CSV, deteksi delimiter (, ; tab), lalu kembalikan (headers, data_rows)."""
    text = _decode_csv_bytes(content)
    lines = text.splitlines()
    if not lines:
        raise ValueError("File CSV kosong.")
    delim = _detect_delimiter(lines)
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    non_empty = [r for r in rows if any(c.strip() for c in r)]
    if not non_empty:
        raise ValueError("File CSV tidak berisi baris data.")
    return non_empty[0], non_empty[1:]


def find_header_row(
    rows: list[list[str]],
    required_keywords: tuple[str, ...],
) -> tuple[int, list[str]]:
    """Cari indeks baris header berdasarkan kata kunci kolom utama."""
    for idx, row in enumerate(rows[:20]):
        norm = [c.strip().lower() for c in row if c and c.strip()]
        if any(k in cell for cell in norm for k in required_keywords):
            return idx, row
    raise ValueError(
        f"Header kolom tidak ditemukan. Pastikan terdapat kolom seperti: {', '.join(required_keywords[:3])}."
    )


def col_lookup(headers: list[str], *aliases: str) -> int | None:
    norm_headers = [h.strip().lower() for h in headers]
    for alias in aliases:
        al = alias.lower()
        for idx, h in enumerate(norm_headers):
            if h == al:
                return idx
    for alias in aliases:
        al = alias.lower()
        for idx, h in enumerate(norm_headers):
            if al in h:
                return idx
    return None


def get_cell(row: list[str], idx: int | None) -> str:
    if idx is None or idx >= len(row):
        return ""
    return row[idx].strip()


def parse_bool_cell(raw: str, default: bool = False) -> bool:
    s = (raw or "").strip().lower()
    if not s:
        return default
    if s in ("1", "true", "ya", "yes", "y", "aktif", "active", "langganan"):
        return True
    if s in ("0", "false", "tidak", "no", "n", "nonaktif", "inactive", "bukan"):
        return False
    return default


def parse_date_cell(raw: str, default: date | None = None) -> date | None:
    parsed = _parse_date_id(raw)
    return parsed if parsed is not None else default


def parse_number_cell(raw: str, default: float = 0.0) -> float:
    s = (raw or "").strip()
    if not s or s == "-":
        return default
    return _parse_number(s)


def build_csv_template(headers: list[str], sample_rows: list[list[Any]] | None = None) -> str:
    """Bangun string template CSV ber-BOM UTF-8 agar rapi saat dibuka di Microsoft Excel."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    if sample_rows:
        for row in sample_rows:
            writer.writerow(row)
    return "\ufeff" + buf.getvalue()
