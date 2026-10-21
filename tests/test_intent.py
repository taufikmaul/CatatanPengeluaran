"""Test untuk app/agent/intent.py."""

import pytest

from app.agent.intent import Intent, classify_intent


class TestCommandIntents:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("/rekap", Intent.CMD_REKAP),
            ("/harga tepung", Intent.CMD_HARGA),
            ("/catat beli gula 2kg", Intent.CMD_CATAT),
            ("/audit", Intent.CMD_AUDIT),
            ("/audit hitung", Intent.CMD_AUDIT_HITUNG),
            ("/menu", Intent.CMD_MENU),
            ("/help", Intent.CMD_MENU),
            ("/start", Intent.CMD_MENU),
            ("/config", Intent.CMD_CONFIG),
        ],
    )
    def test_recognizes_commands(self, text, expected):
        intent, _ = classify_intent(text)
        assert intent == expected

    def test_audit_hitung_takes_priority_over_audit(self):
        # Urutan _COMMANDS penting: /audit hitung harus dicek sebelum /audit.
        intent, _ = classify_intent("/audit hitung")
        assert intent == Intent.CMD_AUDIT_HITUNG

    def test_extracts_command_parameter(self):
        intent, param = classify_intent("/harga tepung terigu")
        assert intent == Intent.CMD_HARGA
        assert param == "terigu" or "tepung" in param

    def test_command_is_case_insensitive(self):
        intent, _ = classify_intent("/REKAP")
        assert intent == Intent.CMD_REKAP


class TestMediaIntents:
    def test_photo_takes_priority(self):
        intent, _ = classify_intent("/rekap", has_photo=True)
        assert intent == Intent.SCAN_RECEIPT

    def test_voice_input(self):
        intent, _ = classify_intent("", has_voice=True)
        assert intent == Intent.VOICE_INPUT

    def test_photo_beats_voice(self):
        intent, _ = classify_intent("", has_photo=True, has_voice=True)
        assert intent == Intent.SCAN_RECEIPT


class TestNaturalLanguage:
    @pytest.mark.parametrize(
        "text",
        ["berapa harga tepung", "harga gula terakhir", "beli mentega kemarin"],
    )
    def test_price_queries(self, text):
        intent, _ = classify_intent(text)
        assert intent == Intent.QUERY_PRICE

    def test_report_queries(self):
        intent, _ = classify_intent("rekap pengeluaran bulan ini")
        assert intent == Intent.QUERY_REPORT


class TestTextInputFallback:
    def test_long_text_becomes_text_input(self):
        text = "catat pengeluaran kemarin untuk operasional toko"
        intent, param = classify_intent(text)
        assert intent == Intent.TEXT_INPUT
        assert param == text

    def test_natural_language_price_pattern_wins_over_text_input(self):
        # "beli tepung ..." cocok dengan pola harga, jadi sengaja diarahkan
        # ke QUERY_PRICE, bukan TEXT_INPUT.
        intent, _ = classify_intent("beli tepung 2 kg dan gula 1 kg di toko")
        assert intent == Intent.QUERY_PRICE

    def test_short_text_is_unknown(self):
        intent, _ = classify_intent("halo")
        assert intent == Intent.UNKNOWN

    def test_empty_text_is_unknown(self):
        intent, _ = classify_intent("")
        assert intent == Intent.UNKNOWN


class TestDocumentedGap:
    def test_greeting_over_ten_chars_is_treated_as_expense_input(self):
        """
        Perilaku saat ini (belum ideal): sapaan panjang tetap dianggap input
        belanja sehingga dikirim ke AI. Test ini mengunci perilaku agar
        perubahan di masa depan (misal menambah langkah konfirmasi) terdeteksi.
        """
        intent, _ = classify_intent("selamat pagi semuanya")
        assert intent == Intent.TEXT_INPUT
