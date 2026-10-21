"""
tests/test_import_from_sheets.py — Test untuk script impor Sheets → Postgres.

Fokus pada pemetaan data, karena kesalahan di sini berarti data pengeluaran
user rusak secara diam-diam. Jaringan & Google API tidak disentuh test ini.
"""
from __future__ import annotations

import importlib.util
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

# Helper parsing sekarang tinggal di modul bersama (dipakai CSV & Sheets).
_SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent / "scripts" / "import_common.py"
)
_spec = importlib.util.spec_from_file_location("import_common", _SCRIPT_PATH)
import_common = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(import_common)

row_to_expense_data = import_common.row_to_expense_data
_parse_float = import_common.parse_decimal
_parse_date = import_common.parse_date


class TestParseFloat:
    """Konversi nilai sel ke Decimal harus tahan terhadap format aneh."""

    @pytest.mark.parametrize(
        "value,expected",
        [
            (0, Decimal("0")),
            (15000, Decimal("15000")),
            (15.5, Decimal("15.5")),
            ("15000", Decimal("15000")),
            ("Rp 15.000", Decimal("15000")),
            ("15.000", Decimal("15000")),
            ("1.500.000", Decimal("1500000")),
            ("15.000,50", Decimal("15000.50")),
            ("15,000.50", Decimal("15000.50")),
            ("1,5", Decimal("1.5")),
            ("15.", Decimal("15")),
            ("15.5", Decimal("15.5")),
            ("-15.000", Decimal("-15000")),
            ("", Decimal("0")),
            (None, Decimal("0")),
            ("abc", Decimal("0")),
            ("-", Decimal("0")),
        ],
    )
    def test_parses_indonesian_and_international_formats(self, value, expected):
        assert _parse_float(value) == expected

    def test_single_dot_with_three_digits_is_thousands(self):
        """Kasus paling berbahaya: '15.000' harus 15000, bukan 15."""
        assert _parse_float("15.000") == Decimal("15000")
        assert _parse_float("Rp 15.000") == Decimal("15000")
        assert _parse_float("1.500.000") == Decimal("1500000")

    def test_invalid_value_does_not_raise(self):
        # Satu sel rusak tidak boleh menggagalkan seluruh impor.
        assert _parse_float("tidak ada angka") == Decimal("0")


class TestParseDate:
    """Tanggal dari sheet bisa berupa datetime, ISO, atau format Indonesia."""

    def test_datetime_is_converted_to_date(self):
        assert _parse_date(datetime(2026, 10, 21, 14, 30)) == date(2026, 10, 21)

    @pytest.mark.parametrize(
        "value,expected",
        [
            ("2026-10-21", date(2026, 10, 21)),
            ("21/10/2026", date(2026, 10, 21)),
            ("21-10-2026", date(2026, 10, 21)),
            ("2026-10-21T14:30:00", date(2026, 10, 21)),
            ("2026-10-21 14:30:00", date(2026, 10, 21)),
        ],
    )
    def test_parses_common_formats(self, value, expected):
        assert _parse_date(value) == expected

    def test_empty_uses_fallback(self):
        fallback = date(2020, 1, 1)
        assert _parse_date("", fallback) == fallback

    def test_garbage_uses_fallback(self):
        fallback = date(2020, 1, 1)
        assert _parse_date("bukan tanggal", fallback) == fallback


class TestRowToExpenseData:
    """Pemetaan 15 kolom sheet ke kolom model Expense."""

    def _full_row(self):
        # Urutan identik dengan saveDataToSheet() di kode.gs lama.
        return [
            "2026-10-21 09:15:00",  # 0  timestamp
            "2026-10-21",           # 1  tanggal
            "Toko Sumber Rejeki",   # 2  toko_supplier
            "Tepung Terigu",        # 3  barang
            "2",                    # 4  qty
            "Bahan Kue",            # 5  kategori
            "15000",                # 6  harga_satuan
            "0",                    # 7  tax
            "0",                    # 8  diskon
            "30000",                # 9  total_harga
            "Tunai",                # 10 metode_bayar
            "Lunas",                # 11 status_pembayaran
            "-",                    # 12 jatuh_tempo
            "catatan",              # 13 keterangan
            "https://t.me/c/1/2",   # 14 msg_link
        ]

    def test_maps_all_columns_in_correct_order(self):
        data = row_to_expense_data(self._full_row(), 2)

        assert data is not None
        assert data["expense_date"] == date(2026, 10, 21)
        assert data["created_at"] == datetime(2026, 10, 21, 9, 15)
        assert data["supplier"] == "Toko Sumber Rejeki"
        assert data["item_name"] == "Tepung Terigu"
        assert data["qty"] == Decimal("2")
        assert data["category"] == "Bahan Kue"
        assert data["unit_price"] == Decimal("15000")
        assert data["tax"] == Decimal("0")
        assert data["discount"] == Decimal("0")
        assert data["total_price"] == Decimal("30000")
        assert data["pay_method"] == "Tunai"
        assert data["pay_status"] == "Lunas"
        assert data["due_date"] == "-"
        assert data["notes"] == "catatan"
        assert data["msg_link"] == "https://t.me/c/1/2"

    def test_marks_row_as_already_synced(self):
        """Ini krusial: tanpa flag ini, sync akan menulis data lama balik ke sheet."""
        data = row_to_expense_data(self._full_row(), 2)
        assert data["sheets_synced"] is True

    def test_no_user_id_because_legacy_rows_have_no_owner(self):
        data = row_to_expense_data(self._full_row(), 2)
        assert data["user_id"] is None

    def test_skips_completely_empty_row(self):
        assert row_to_expense_data(["", "", ""], 5) is None
        assert row_to_expense_data([], 5) is None

    def test_skips_row_without_item_name(self):
        row = self._full_row()
        row[3] = ""  # barang kosong
        assert row_to_expense_data(row, 5) is None

    def test_short_row_is_padded_with_defaults(self):
        """Google Sheets memotong trailing sel kosong."""
        data = row_to_expense_data(
            ["2026-10-21 08:00:00", "2026-10-21", "Toko A", "Gula"], 2
        )
        assert data is not None
        assert data["supplier"] == "Toko A"
        assert data["item_name"] == "Gula"
        assert data["qty"] == Decimal("1")  # default qty
        assert data["category"] == "Operasional"  # default kategori
        assert data["pay_status"] == "Lunas"
        assert data["msg_link"] == "Private Chat"

    def test_zero_qty_falls_back_to_one(self):
        row = self._full_row()
        row[4] = "0"
        data = row_to_expense_data(row, 2)
        assert data["qty"] == Decimal("1")

    def test_indonesian_currency_strings_are_parsed(self):
        row = self._full_row()
        row[6] = "Rp 15.000"
        row[9] = "Rp 30.000"
        data = row_to_expense_data(row, 2)
        assert data["unit_price"] == Decimal("15000")
        assert data["total_price"] == Decimal("30000")
