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


def fmt_qty(qty: float | int | str) -> str:
    """Format kuantitas agar tanpa desimal .0 jika bilangan bulat."""
    try:
        f = float(qty)
        return f"{int(f)}" if f.is_integer() else f"{f:g}"
    except (ValueError, TypeError):
        return str(qty)


def build_items_summary(items: list[dict]) -> tuple[str, float]:
    """
    Buat ringkasan item dan total dari list item.
    Return: (item_list_string, total_belanja)
    """
    total = 0.0
    lines = []
    for i, item in enumerate(items, 1):
        raw_qty = item.get("qty", 1)
        try:
            qty = float(raw_qty)
        except (ValueError, TypeError):
            qty = 1.0
        harga = float(item.get("harga_satuan", 0))
        total_item = float(item.get("total_harga", qty * harga))
        total += total_item

        meta = []
        supplier = item.get("toko_supplier") or item.get("supplier")
        if supplier and supplier != "-":
            meta.append(f"Toko: {supplier}")
        inv = item.get("no_invoice") or item.get("invoice_number") or item.get("no_nota")
        if inv and inv != "-":
            meta.append(f"Nota: {inv}")
        meta_str = f" _({', '.join(meta)})_" if meta else ""

        satuan = (item.get("satuan") or item.get("unit") or "").strip()
        unit_label = f" {satuan}" if satuan and satuan.lower() != "pcs" else "x"

        lines.append(
            f"{i}. {item.get('barang', 'Item')} "
            f"({fmt_qty(qty)}{unit_label} @{fmt_rupiah(harga)}) : {fmt_rupiah(total_item)}{meta_str}"
        )
    return "\n".join(lines), total


def format_expense_items_summary(expenses: list, strikethrough: bool = False) -> tuple[str, float]:
    """
    Format list instance Expense (atau dict) menjadi rincian item teks.
    Return: (item_list_string, total_belanja)
    """
    total = 0.0
    lines = []
    for i, exp in enumerate(expenses, 1):
        if isinstance(exp, dict):
            raw_qty = exp.get("qty", 1)
            satuan = (exp.get("satuan") or exp.get("unit") or "").strip()
            harga = float(exp.get("harga_satuan", 0) or exp.get("unit_price", 0) or 0)
            item_total = float(exp.get("total_harga", 0) or exp.get("total_price", 0) or 0)
            name = exp.get("barang") or exp.get("item_name") or "Item"
            supplier = exp.get("toko_supplier") or exp.get("supplier")
            inv = exp.get("no_invoice") or exp.get("invoice_number") or exp.get("no_nota")
        else:
            raw_qty = getattr(exp, "qty", 1)
            satuan = (getattr(exp, "unit", "") or "").strip()
            harga = float(getattr(exp, "unit_price", 0) or 0)
            item_total = float(getattr(exp, "total_price", 0) or 0)
            name = getattr(exp, "item_name", "Item")
            supplier = getattr(exp, "supplier", None)
            inv = getattr(exp, "invoice_number", None)

        try:
            qty = float(raw_qty)
        except (ValueError, TypeError):
            qty = 1.0

        if item_total <= 0 and harga > 0:
            item_total = qty * harga
        total += item_total

        meta = []
        if supplier and supplier != "-":
            meta.append(f"Toko: {supplier}")
        if inv and inv != "-":
            meta.append(f"Nota: {inv}")
        meta_str = f" _({', '.join(meta)})_" if meta else ""

        unit_label = f" {satuan}" if satuan and satuan.lower() != "pcs" else "x"
        line = (
            f"{i}. {name} "
            f"({fmt_qty(qty)}{unit_label} @{fmt_rupiah(harga)}) : {fmt_rupiah(item_total)}{meta_str}"
        )
        if strikethrough:
            line = f"~{line}~"
        lines.append(line)

    return "\n".join(lines), total


def build_expense_action_keyboard(
    ids_str: str,
    is_paid: bool,
    is_reimb: bool,
    dashboard_url: str = "",
) -> dict:
    """Buat inline keyboard konsisten untuk aksi pengeluaran di Telegram."""
    pay_btn = (
        {"text": "⏳ Set Belum Lunas", "callback_data": f"unpaid_save:{ids_str}"}
        if is_paid
        else {"text": "✅ Tandai Lunas", "callback_data": f"mark_paid:{ids_str}"}
    )
    reimb_btn = "💼 Reimburse: YA (Ubah)" if is_reimb else "💼 Tandai Reimburse"

    rows = []
    if ids_str:
        rows.append([
            {"text": "🗑️ Batal Simpan", "callback_data": f"undo_save:{ids_str}"},
            pay_btn,
        ])
        rows.append([
            {"text": reimb_btn, "callback_data": f"toggle_reimb:{ids_str}"},
        ])
    if dashboard_url:
        rows.append([{"text": "🌐 Lihat Dashboard", "url": dashboard_url}])

    return {"inline_keyboard": rows}


def extract_insight_from_text(text: str) -> str:
    """Ambil kembali teks insight Hermes (diawali 💡) dari teks pesan sebelumnya."""
    if not text or "💡" not in text:
        return ""
    idx = text.find("💡")
    return "\n\n" + text[idx:].strip()


def extract_items_block_from_text(text: str) -> str:
    """Fallback mengekstrak blok rincian item dari teks pesan Telegram sebelumnya."""
    if not text:
        return ""
    import re
    match = re.search(r"(📝\s*\*Rincian[^\n]*\*.*?)(\n\s*💰|\n\s*_|\n\s*💳|$)", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""
