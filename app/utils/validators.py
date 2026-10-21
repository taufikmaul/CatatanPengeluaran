"""
app/utils/validators.py — Validasi kategori, audit perhitungan, cek duplikat
"""
from app.config import settings


def audit_calculations(extracted_data: dict) -> dict:
    """
    Paksa recalculate total_harga agar pasti akurat:
    total = (qty * harga_satuan) - diskon + tax
    Sama persis dengan logika GAS lama.
    """
    if not extracted_data or extracted_data.get("error") or not extracted_data.get("items"):
        return extracted_data

    for item in extracted_data["items"]:
        qty = float(item.get("qty") or 1)
        harga_satuan = float(item.get("harga_satuan") or 0)
        diskon = float(item.get("diskon") or 0)
        tax = float(item.get("tax") or 0)

        item["total_harga"] = (qty * harga_satuan) - diskon + tax
        item["qty"] = qty
        item["harga_satuan"] = harga_satuan

    return extracted_data


def validate_category(category: str) -> str:
    """
    Validasi dan normalisasi kategori.
    Return kategori valid atau 'Operasional' sebagai fallback.
    """
    valid_lower = {c.lower(): c for c in settings.valid_categories}
    if category and category.lower() in valid_lower:
        return valid_lower[category.lower()]
    return "Operasional"


def is_valid_category(category: str) -> bool:
    """Return True jika kategori ada di daftar valid."""
    valid_lower = [c.lower() for c in settings.valid_categories]
    return bool(category) and category.lower() in valid_lower
