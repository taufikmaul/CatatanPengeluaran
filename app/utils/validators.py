"""
app/utils/validators.py — Validasi kategori, audit perhitungan, cek duplikat
"""
from app.config import settings


def audit_calculations(extracted_data: dict) -> dict:
    """
    Paksa recalculate total_harga agar pasti akurat:
    total = (qty * harga_satuan) + ongkir + tax + biaya_lainnya - diskon
    """
    if not extracted_data or extracted_data.get("error") or not extracted_data.get("items"):
        return extracted_data

    for item in extracted_data["items"]:
        qty = float(item.get("qty") or 1)
        harga_satuan = float(item.get("harga_satuan") or 0)
        diskon = float(item.get("diskon") or 0)
        tax = float(item.get("tax") or 0)
        ongkir = float(item.get("ongkir") or item.get("shipping_fee") or 0)
        biaya_lainnya = float(item.get("biaya_lainnya") or item.get("other_fee") or 0)

        item["total_harga"] = (qty * harga_satuan) + ongkir + tax + biaya_lainnya - diskon
        item["qty"] = qty
        item["harga_satuan"] = harga_satuan
        item["ongkir"] = ongkir
        item["biaya_lainnya"] = biaya_lainnya
        item["diskon"] = diskon
        item["tax"] = tax

    return extracted_data


def validate_non_zero_expenses(extracted_data: dict) -> dict:
    """
    Validasi agar pengeluaran tidak ada yang bernilai Rp 0 atau minus.
    Item bernilai <= 0 akan disaring/dieliminasi.
    Jika semua item bernilai <= 0, kembalikan dict dengan status error.
    """
    if not extracted_data or extracted_data.get("error"):
        return extracted_data

    items = extracted_data.get("items")
    if not items:
        return extracted_data

    valid_items = []
    for item in items:
        tot = float(item.get("total_harga") or 0)
        if tot > 0:
            valid_items.append(item)

    if not valid_items:
        return {
            "error": True,
            "message": "Pengeluaran tidak boleh bernilai Rp 0 atau minus.",
            "items": [],
        }

    extracted_data["items"] = valid_items
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
