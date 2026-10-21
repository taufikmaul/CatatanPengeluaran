"""
tests/test_import_from_csv.py — Test untuk importer CSV.

Yang diuji adalah hal-hal yang secara diam-diam merusak data:
- delimiter salah → seluruh baris jadi satu kolom
- encoding salah → karakter rusak / exception
- tanggal ambigu → tanggal bergeser sebulan
- header ikut terimpor → satu record sampah
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"


def _load(name: str):
    path = _SCRIPTS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# import_from_csv mengimpor import_common via sys.path, jadi daftarkan dulu.
import sys  # noqa: E402

if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import_common = _load("import_common")
import_from_csv = _load("import_from_csv")

sniff_delimiter = import_from_csv.sniff_delimiter
read_csv_rows = import_from_csv.read_csv_rows
looks_like_header = import_from_csv.looks_like_header


HEADER = [
    "Timestamp", "Tanggal", "Toko/Supplier", "Barang", "Qty", "Kategori",
    "Harga Satuan", "Tax", "Diskon", "Total Harga", "Metode Bayar",
    "Status Pembayaran", "Jatuh Tempo", "Keterangan", "Link Pesan",
]

DATA_ROW = [
    "2026-10-21 09:15:00", "2026-10-21", "Toko Sumber Rejeki", "Tepung Terigu",
    "2", "Bahan Kue", "15000", "0", "0", "30000", "Tunai", "Lunas", "-",
    "catatan", "Private Chat",
]


class TestSniffDelimiter:
    """Delimiter salah = seluruh baris jadi satu kolom. Ini kegagalan senyap."""

    def test_detects_comma(self):
        sample = ",".join(HEADER) + "\n" + ",".join(DATA_ROW)
        assert sniff_delimiter(sample) == ","

    def test_detects_semicolon_from_indonesian_excel(self):
        """Excel locale Indonesia menyimpan CSV dengan titik-koma."""
        sample = ";".join(HEADER) + "\n" + ";".join(DATA_ROW)
        assert sniff_delimiter(sample) == ";"

    def test_detects_tab(self):
        sample = "\t".join(HEADER) + "\n" + "\t".join(DATA_ROW)
        assert sniff_delimiter(sample) == "\t"

    def test_semicolon_wins_when_commas_are_decimal_separators(self):
        """Koma desimal di dalam sel tidak boleh dianggap delimiter."""
        sample = (
            "2026-10-21;Toko A;Gula;1;1,5;15000;22500\n"
            "2026-10-22;Toko B;Garam;1;2,5;5000;12500"
        )
        assert sniff_delimiter(sample) == ";"


class TestReadCsvRows:
    """Encoding & struktur baris."""

    def test_reads_utf8_with_bom(self, tmp_path):
        """Export Google Sheets sering menyertakan BOM."""
        p = tmp_path / "bom.csv"
        content = ",".join(HEADER) + "\n" + ",".join(DATA_ROW) + "\n"
        p.write_bytes(content.encode("utf-8-sig"))

        rows, encoding, delimiter = read_csv_rows(p)

        assert encoding == "utf-8-sig"
        assert delimiter == ","
        # BOM tidak boleh menempel di nama kolom pertama.
        assert not rows[0][0].startswith("\ufeff")

    def test_reads_utf8_plain(self, tmp_path):
        p = tmp_path / "plain.csv"
        content = ",".join(HEADER) + "\n" + ",".join(DATA_ROW) + "\n"
        p.write_text(content, encoding="utf-8")

        rows, encoding, delimiter = read_csv_rows(p)

        assert encoding in ("utf-8-sig", "utf-8")
        assert len(rows) == 2

    def test_reads_cp1252_with_non_ascii(self, tmp_path):
        """Excel Indonesia kadang menyimpan cp1252, bukan UTF-8.

        Catatan: ASCII murni valid di hampir semua encoding, jadi test ini
        sengaja menyisipkan karakter non-ASCII (e-akut = 0xE9 di cp1252,
        yang TIDAK valid sebagai UTF-8) agar jalur fallback benar-benar diuji.
        """
        p = tmp_path / "cp.csv"
        data_row = list(DATA_ROW)
        data_row[2] = "Caf\u00e9 Supplier"  # \u00e9 = 0xE9 di cp1252
        content = ",".join(HEADER) + "\n" + ",".join(data_row) + "\n"
        p.write_bytes(content.encode("cp1252"))

        rows, encoding, delimiter = read_csv_rows(p)

        assert encoding == "cp1252"
        assert len(rows) == 2
        assert "Caf\u00e9 Supplier" in rows[1][2]

    def test_preserves_multi_line_quoted_cell(self, tmp_path):
        p = tmp_path / "quoted.csv"
        content = (
            ",".join(HEADER) + "\n"
            "2026-10-21 09:15:00,2026-10-21,Toko A,Gula,1,Bahan Kue,15000,0,0,"
            "15000,Tunai,Lunas,-,\"baris satu\nbaris dua\",Private Chat\n"
        )
        p.write_text(content, encoding="utf-8")

        rows, _enc, _delim = read_csv_rows(p)

        assert len(rows) == 2
        assert "baris satu\nbaris dua" in rows[1][13]


class TestLooksLikeHeader:
    """Header ikut terimpor = satu record sampah bernama 'Barang'."""

    def test_real_header_is_detected(self):
        assert looks_like_header(HEADER) is True

    def test_data_row_is_not_header(self):
        assert looks_like_header(DATA_ROW) is False

    def test_row_with_indonesian_date_is_not_header(self):
        row = list(DATA_ROW)
        row[1] = "21/10/2026"
        assert looks_like_header(row) is False

    def test_empty_row_is_treated_as_header(self):
        assert looks_like_header(["", "", ""]) is True


class TestEndToEndParsing:
    """Pastikan modul bersama benar-benar menghasilkan nilai yang benar."""

    def test_header_and_data_yield_one_correct_expense(self):
        assert looks_like_header(HEADER) is True

        data = import_common.row_to_expense_data(DATA_ROW, row_number=2)

        assert data is not None
        assert data["expense_date"].isoformat() == "2026-10-21"
        assert data["supplier"] == "Toko Sumber Rejeki"
        assert data["item_name"] == "Tepung Terigu"
        assert str(data["total_price"]) == "30000"
        assert data["sheets_synced"] is True

    def test_ambiguous_date_respects_explicit_format(self):
        """03/04/2026 bisa 3 April atau 4 Maret — format eksplisit menentukannya."""
        row = list(DATA_ROW)
        row[1] = "03/04/2026"

        default = import_common.row_to_expense_data(row)
        assert default["expense_date"].isoformat() == "2026-04-03"  # %d/%m/%Y

        us_style = import_common.row_to_expense_data(row, date_format="%m/%d/%Y")
        assert us_style["expense_date"].isoformat() == "2026-03-04"

    def test_rupiah_total_is_not_divided_by_1000(self):
        """Regresi paling berbahaya: '15.000' harus 15000."""
        row = list(DATA_ROW)
        row[6] = "Rp 15.000"
        row[9] = "Rp 1.500.000"

        data = import_common.row_to_expense_data(row)

        assert str(data["unit_price"]) == "15000"
        assert str(data["total_price"]) == "1500000"


class TestDedupeKey:
    """Impor ulang harus dianggap duplikat, bukan data baru."""

    def test_scale_difference_does_not_change_key(self):
        """Nilai dari CSV (30000) dan dari Postgres (30000.00) harus sama kuncinya.

        `str(Decimal("30000"))` = "30000" sedangkan `str(Decimal("30000.00"))`
        = "30000.00", jadi membandingkan string mentah membuat seluruh data
        terduplikasi setiap kali impor diulang.
        """
        from decimal import Decimal

        from_csv = import_common.expense_key(
            "2026-10-21", "Toko A", "Gula", Decimal("30000")
        )
        from_db = import_common.expense_key(
            "2026-10-21", "Toko A", "Gula", Decimal("30000.00")
        )

        assert from_csv == from_db

    def test_same_row_parsed_twice_has_same_key(self):
        first = import_common.row_to_expense_data(DATA_ROW, row_number=2)
        second = import_common.row_to_expense_data(DATA_ROW, row_number=2)

        assert import_common.dedupe_key(first) == import_common.dedupe_key(second)

    def test_case_and_space_differences_are_ignored(self):
        a = import_common.expense_key("2026-10-21", "Toko A", "Gula Pasir", 1000)
        b = import_common.expense_key("2026-10-21", " toko a ", "GULA PASIR", 1000)

        assert a == b

    def test_different_total_is_not_duplicate(self):
        a = import_common.expense_key("2026-10-21", "Toko A", "Gula", 1000)
        b = import_common.expense_key("2026-10-21", "Toko A", "Gula", 1001)

        assert a != b

    def test_none_total_is_handled(self):
        key = import_common.expense_key("2026-10-21", "Toko A", "Gula", None)

        assert key == import_common.expense_key("2026-10-21", "Toko A", "Gula", 0)
