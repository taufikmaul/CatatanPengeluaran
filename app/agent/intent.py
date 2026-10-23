"""
app/agent/intent.py — Intent classifier untuk Hermes Agent
Menentukan apa yang user mau tanpa harus pakai command eksplisit
"""
import re
from enum import Enum


class Intent(str, Enum):
    # Command eksplisit
    CMD_REKAP = "cmd_rekap"
    CMD_HUTANG = "cmd_hutang"
    CMD_HARGA = "cmd_harga"
    CMD_CATAT = "cmd_catat"
    CMD_AUDIT = "cmd_audit"
    CMD_AUDIT_HITUNG = "cmd_audit_hitung"
    CMD_MENU = "cmd_menu"
    CMD_CONFIG = "cmd_config"
    CMD_REIMBURSE = "cmd_reimburse"
    CMD_ANALISIS = "cmd_analisis"

    # Input media
    SCAN_RECEIPT = "scan_receipt"    # foto struk
    VOICE_INPUT = "voice_input"      # voice note
    TEXT_INPUT = "text_input"        # teks biasa (no command)

    # Query natural language
    QUERY_PRICE = "query_price"      # "berapa harga tepung?"
    QUERY_REPORT = "query_report"    # "rekap bulan ini gimana?"
    QUERY_TREND = "query_trend"      # "pengeluaran bulan ini naik?"

    UNKNOWN = "unknown"


# Pola regex untuk deteksi command
_COMMANDS = {
    r"^/rekap": Intent.CMD_REKAP,
    r"^/hutang": Intent.CMD_HUTANG,
    r"^/audit\s+hitung": Intent.CMD_AUDIT_HITUNG,
    r"^/audit": Intent.CMD_AUDIT,
    r"^/harga": Intent.CMD_HARGA,
    r"^/catat": Intent.CMD_CATAT,
    r"^/(menu|help|start)": Intent.CMD_MENU,
    r"^/config": Intent.CMD_CONFIG,
    r"^/(reimburse|reimbursement|talangan)": Intent.CMD_REIMBURSE,
    r"^/(analisis|analisa|ai_analisis|insight|evaluasi)": Intent.CMD_ANALISIS,
}

# Pola untuk natural language (tanpa command)
_NL_PATTERNS = {
    r"(analisis|analisa|evaluasi|insight|saran).*(keuangan|pengeluaran|belanja|biaya|toko)": Intent.CMD_ANALISIS,
    r"(cek|lihat|daftar|review)\s+(reimburse|reimbursement|talangan|rembes)": Intent.CMD_REIMBURSE,
    r"(berapa|harga|terakhir|beli)\s+(tepung|gula|mentega|telur|\w+)": Intent.QUERY_PRICE,
    r"(daftar\s+hutang|tagihan\s+belum\s+lunas|cek\s+hutang)": Intent.CMD_HUTANG,
    r"(naik|turun|trend|perbandingan|banding)": Intent.QUERY_TREND,
    r"(rekap|laporan|total|pengeluaran|belanja).*(bulan|minggu|hari)": Intent.QUERY_REPORT,
}


def classify_intent(
    text: str,
    has_photo: bool = False,
    has_voice: bool = False,
) -> tuple[Intent, str]:
    """
    Klasifikasi intent dari pesan user.
    Return: (Intent, extracted_param)
    extracted_param = keyword untuk harga, atau teks untuk catat, dll.
    """
    # Media takes priority
    if has_photo:
        return Intent.SCAN_RECEIPT, ""
    if has_voice:
        return Intent.VOICE_INPUT, ""

    text_lower = text.lower().strip()

    # Cek command eksplisit
    for pattern, intent in _COMMANDS.items():
        if re.match(pattern, text_lower):
            # Ekstrak parameter setelah command
            param = re.sub(pattern, "", text_lower, flags=re.IGNORECASE).strip()
            return intent, param

    # Cek natural language patterns
    for pattern, intent in _NL_PATTERNS.items():
        if re.search(pattern, text_lower):
            return intent, text

    # Kalau ada teks panjang (>10 char) tapi bukan command → anggap text input
    if len(text.strip()) > 10:
        return Intent.TEXT_INPUT, text

    return Intent.UNKNOWN, text
