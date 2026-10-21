"""
app/utils/formatters.py — Helper format Rupiah, tanggal, progress bar, dll
"""
from datetime import datetime


def fmt_rupiah(amount: float | int) -> str:
    """Format angka ke format Rupiah Indonesia."""
    return f"Rp {int(amount):,}".replace(",", ".")


def fmt_date_id(dt: datetime | str) -> str:
    """Format tanggal ke format Indonesia: '21 Oktober 2026'"""
    MONTHS = {
        1: "Januari", 2: "Februari", 3: "Maret", 4: "April",
        5: "Mei", 6: "Juni", 7: "Juli", 8: "Agustus",
        9: "September", 10: "Oktober", 11: "November", 12: "Desember"
    }
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    return f"{dt.day} {MONTHS[dt.month]} {dt.year}"


def build_progress_text(step: int, status: str, total_steps: int = 4) -> str:
    """Buat teks progress bar: [■■□□] 50%"""
    filled = "■" * step
    empty = "□" * (total_steps - step)
    percentage = round((step / total_steps) * 100)
    return (
        f"⏳ *Memproses Data...*\n"
        f"`[{filled}{empty}] {percentage}%`\n"
        f"_Status: {status}_"
    )


def build_items_summary(items: list[dict]) -> tuple[str, float]:
    """
    Buat ringkasan item dan total dari list item.
    Return: (item_list_string, total_belanja)
    """
    total = 0.0
    lines = []
    for i, item in enumerate(items, 1):
        qty = float(item.get("qty", 1))
        harga = float(item.get("harga_satuan", 0))
        total_item = float(item.get("total_harga", qty * harga))
        total += total_item
        lines.append(
            f"{i}. {item.get('barang', 'Item')} "
            f"({qty}x @{fmt_rupiah(harga)}) — {fmt_rupiah(total_item)}"
        )
    return "\n".join(lines), total
