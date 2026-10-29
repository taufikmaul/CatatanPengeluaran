"""Test untuk app/utils/formatters.py."""

from datetime import date, datetime

import pytest

from app.utils.formatters import (
    build_items_summary,
    build_progress_text,
    escape_markdown,
    fmt_date_id,
    fmt_rupiah,
    format_expense_items_summary,
)


class TestFmtRupiah:
    @pytest.mark.parametrize(
        ("amount", "expected"),
        [
            (0, "Rp 0"),
            (1500, "Rp 1.500"),
            (15000, "Rp 15.000"),
            (1_500_000, "Rp 1.500.000"),
            (1_234_567_890, "Rp 1.234.567.890"),
        ],
    )
    def test_formats_thousands_separator(self, amount, expected):
        assert fmt_rupiah(amount) == expected

    def test_truncates_decimal(self):
        assert fmt_rupiah(1500.99) == "Rp 1.500"

    def test_accepts_negative(self):
        assert fmt_rupiah(-2500) == "Rp -2.500"


class TestFmtDateId:
    def test_formats_datetime(self):
        assert fmt_date_id(datetime(2026, 10, 21, 14, 30)) == "21 Oktober 2026"

    def test_formats_date_object(self):
        assert fmt_date_id(date(2026, 1, 5)) == "5 Januari 2026"

    def test_formats_iso_string(self):
        assert fmt_date_id("2026-12-31T23:59:00") == "31 Desember 2026"

    def test_all_months_have_indonesian_names(self):
        names = [fmt_date_id(date(2026, m, 1)).split()[1] for m in range(1, 13)]
        assert names == [
            "Januari", "Februari", "Maret", "April", "Mei", "Juni",
            "Juli", "Agustus", "September", "Oktober", "November", "Desember",
        ]


class TestBuildProgressText:
    def test_shows_percentage_and_bar(self):
        text = build_progress_text(2, "Menganalisis", total_steps=4)
        assert "[■■□□] 50%" in text
        assert "Menganalisis" in text

    def test_zero_step_is_empty_bar(self):
        assert "[□□□□] 0%" in build_progress_text(0, "Memulai")

    def test_full_step_is_complete_bar(self):
        assert "[■■■■] 100%" in build_progress_text(4, "Selesai")


class TestBuildItemsSummary:
    def test_sums_totals_and_formats_lines(self, sample_items):
        text, total = build_items_summary(sample_items)
        assert total == 30000
        assert "Tepung Terigu" in text
        assert "Rp 15.000" in text
        assert "Rp 30.000" in text

    def test_falls_back_to_qty_times_price(self):
        items = [{"barang": "Gula", "qty": 3, "harga_satuan": 10000}]
        text, total = build_items_summary(items)
        assert total == 30000
        assert "Gula" in text

    def test_empty_list(self):
        text, total = build_items_summary([])
        assert text == ""
        assert total == 0

    def test_escapes_special_characters_in_supplier_and_items(self):
        items = [{
            "barang": "Box_Jendela*Mika",
            "qty": 2,
            "satuan": "pcs_pack",
            "harga_satuan": 50000,
            "total_harga": 100000,
            "toko_supplier": "Boxlab_Bdg",
            "no_invoice": "INV_2026*01",
        }]
        text, total = build_items_summary(items)
        assert total == 100000
        assert "Boxlab\\_Bdg" in text
        assert "Box\\_Jendela\\*Mika" in text
        assert "INV\\_2026\\*01" in text


class TestEscapeMarkdown:
    def test_escapes_underscore_asterisk_backtick_bracket(self):
        raw = "Toko_Bdg *promo* [link] `code` \\slash"
        escaped = escape_markdown(raw)
        assert escaped == "Toko\\_Bdg \\*promo\\* \\[link] \\`code\\` \\\\slash"

    def test_handles_none_and_empty(self):
        assert escape_markdown(None) == ""
        assert escape_markdown("") == ""

    def test_plain_text_untouched(self):
        assert escape_markdown("Tepung Terigu 1kg") == "Tepung Terigu 1kg"


class TestParseDueDateAndStatus:
    def test_parse_iso_format(self):
        from app.utils.formatters import parse_due_date
        d = parse_due_date("2026-11-15")
        assert d == date(2026, 11, 15)

    def test_parse_slash_format(self):
        from app.utils.formatters import parse_due_date
        d = parse_due_date("15/11/2026")
        assert d == date(2026, 11, 15)

    def test_parse_relative_terms(self):
        from app.utils.formatters import parse_due_date
        ref = date(2026, 10, 29)
        assert parse_due_date("besok", ref_date=ref) == date(2026, 10, 30)
        assert parse_due_date("lusa", ref_date=ref) == date(2026, 10, 31)
        assert parse_due_date("1 minggu", ref_date=ref) == date(2026, 11, 5)
        assert parse_due_date("2 minggu", ref_date=ref) == date(2026, 11, 12)

    def test_due_date_status_labels(self):
        from app.utils.formatters import get_due_date_status_label
        ref = date(2026, 10, 29)
        # Overdue
        st_overdue = get_due_date_status_label("2026-10-27", ref_date=ref)
        assert st_overdue["is_overdue"] is True
        assert st_overdue["urgency"] == "overdue"
        assert "Lewat 2 hari" in st_overdue["label"]

        # Today
        st_today = get_due_date_status_label("2026-10-29", ref_date=ref)
        assert st_today["urgency"] == "today"
        assert "HARI INI" in st_today["label"]

        # Tomorrow
        st_tomorrow = get_due_date_status_label("2026-10-30", ref_date=ref)
        assert st_tomorrow["urgency"] == "soon"
        assert "Besok" in st_tomorrow["label"]


