"""
app/utils/formatters.py — Helper format Rupiah, tanggal, progress bar, dll
"""
from datetime import datetime, date, timedelta
from typing import Any


def escape_markdown(text: Any) -> str:
    """
    Escape karakter khusus Telegram Markdown v1: _, *, [, `
    Memastikan string dinamis (nama toko, barang, dll) aman saat dikirim ke Telegram.
    """
    if text is None:
        return ""
    s = str(text)
    s = s.replace("\\", "\\\\")
    for ch in ("_", "*", "`", "["):
        s = s.replace(ch, f"\\{ch}")
    return s


def fmt_rupiah(amount: float | int) -> str:
    """Format angka ke format Rupiah Indonesia."""
    return f"Rp {int(amount):,}".replace(",", ".")


def fmt_date_id(dt: datetime | str | None) -> str:
    """Format tanggal ke format Indonesia: '21 Oktober 2026'"""
    if not dt:
        return "-"
    MONTHS = {
        1: "Januari", 2: "Februari", 3: "Maret", 4: "April",
        5: "Mei", 6: "Juni", 7: "Juli", 8: "Agustus",
        9: "September", 10: "Oktober", 11: "November", 12: "Desember"
    }
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt[:10])
        except Exception:
            return dt
    return f"{dt.day} {MONTHS.get(dt.month, str(dt.month))} {dt.year}"


def fmt_datetime_id(dt: datetime | str | None) -> str:
    """Format tanggal dan waktu ke format Indonesia: '26 Oktober 2026, 14:30 WIB'"""
    if not dt:
        return "-"
    MONTHS = {
        1: "Januari", 2: "Februari", 3: "Maret", 4: "April",
        5: "Mei", 6: "Juni", 7: "Juli", 8: "Agustus",
        9: "September", 10: "Oktober", 11: "November", 12: "Desember"
    }
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return dt
    try:
        month_name = MONTHS.get(dt.month, str(dt.month))
        time_str = dt.strftime("%H:%M")
        return f"{dt.day} {month_name} {dt.year}, {time_str} WIB"
    except Exception:
        return str(dt)


def build_progress_text(step: int, status: str, total_steps: int = 4) -> str:
    """Buat teks progress bar: [■■□□] 50%"""
    filled = "■" * step
    empty = "□" * (total_steps - step)
    percentage = round((step / total_steps) * 100)
    return (
        f"⏳ *Memproses Data...*\n"
        f"`[{filled}{empty}] {percentage}%`\n"
        f"_Status: {escape_markdown(status)}_"
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
        cat = (item.get("kategori") or item.get("category") or "").strip().lower()
        pay = item.get("metode_bayar") or item.get("pay_method")
        raw_barang = (item.get("barang") or item.get("item_name") or "").lower()

        if cat == "ongkir" or raw_barang.startswith("ongkir"):
            if supplier and supplier != "-":
                meta.append(f"Kurir: {escape_markdown(supplier)}")
            if pay and pay != "-":
                meta.append(f"Bayar: {escape_markdown(pay)}")
        elif cat == "tukar cash" or "tukar cash" in raw_barang or "tarik tunai" in raw_barang:
            meta.append("Metode: Cash/Tunai")
            notes = item.get("keterangan") or item.get("notes")
            if notes and notes != "-":
                meta.append(f"Catatan: {escape_markdown(notes)}")
        else:
            if supplier and supplier != "-":
                meta.append(f"Toko: {escape_markdown(supplier)}")
            inv = item.get("no_invoice") or item.get("invoice_number") or item.get("no_nota")
            if inv and inv != "-":
                meta.append(f"Nota: {escape_markdown(inv)}")
        meta_str = f" _({', '.join(meta)})_" if meta else ""

        satuan = (item.get("satuan") or item.get("unit") or "").strip()
        unit_label = f" {escape_markdown(satuan)}" if satuan and satuan.lower() != "pcs" else "x"
        item_name = escape_markdown(item.get("barang", "Item"))

        lines.append(
            f"{i}. {item_name} "
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
        cat = (getattr(exp, "category", "") or (exp.get("kategori") if isinstance(exp, dict) else "") or "").lower()
        pay = getattr(exp, "pay_method", None) or (exp.get("metode_bayar") if isinstance(exp, dict) else None)
        notes = getattr(exp, "notes", None) or (exp.get("keterangan") if isinstance(exp, dict) else None)
        name_lower = name.lower()

        if cat == "ongkir" or name_lower.startswith("ongkir"):
            if supplier and supplier != "-":
                meta.append(f"Kurir: {escape_markdown(supplier)}")
            if pay and pay != "-":
                meta.append(f"Bayar: {escape_markdown(pay)}")
        elif cat == "tukar cash" or "tukar cash" in name_lower or "tarik tunai" in name_lower:
            meta.append("Metode: Cash/Tunai")
            if notes and notes != "-":
                meta.append(f"Catatan: {escape_markdown(notes)}")
        else:
            if supplier and supplier != "-":
                meta.append(f"Toko: {escape_markdown(supplier)}")
            if inv and inv != "-":
                meta.append(f"Nota: {escape_markdown(inv)}")
        meta_str = f" _({', '.join(meta)})_" if meta else ""

        unit_label = f" {escape_markdown(satuan)}" if satuan and satuan.lower() != "pcs" else "x"
        item_name = escape_markdown(name)
        line = (
            f"{i}. {item_name} "
            f"({fmt_qty(qty)}{unit_label} @{fmt_rupiah(harga)}) : {fmt_rupiah(item_total)}{meta_str}"
        )
        if strikethrough:
            line = f"~{line}~"
        lines.append(line)

    return "\n".join(lines), total


def is_ongkir_or_tukar_cash(
    category: str | None = None,
    item_name: str | None = None,
    items: list[dict] | None = None,
    expenses: list | None = None,
    topic_type: str | None = None,
    text: str | None = None,
) -> bool:
    """Deteksi apakah transaksi merupakan pengeluaran Ongkir atau Tukar Cash."""
    if topic_type in ("ongkir", "tukar_cash"):
        return True

    def _check_single(cat: str | None, name: str | None) -> bool:
        c = (cat or "").strip().lower()
        n = (name or "").strip().lower()
        is_ongkir = c == "ongkir" or c.startswith("ongkir") or n.startswith("ongkir") or "ongkir" in n
        is_cash = c == "tukar cash" or "tukar cash" in c or "tarik tunai" in c or "tukar cash" in n or "tarik tunai" in n
        return is_ongkir or is_cash

    if category is not None or item_name is not None:
        if _check_single(category, item_name):
            return True

    if items:
        item_checks = []
        for it in items:
            cat = it.get("kategori") or it.get("category")
            name = it.get("barang") or it.get("item_name")
            item_checks.append(_check_single(cat, name))
        if item_checks and any(item_checks):
            return True

    if expenses:
        exp_checks = []
        for e in expenses:
            cat = getattr(e, "category", None)
            name = getattr(e, "item_name", None)
            exp_checks.append(_check_single(cat, name))
        if exp_checks and any(exp_checks):
            return True

    if text:
        t = text.lower()
        if "ongkir" in t or "tukar cash" in t or "tarik tunai" in t or "/ongkir" in t or "/tukercash" in t:
            return True

    return False


def build_expense_action_keyboard(
    ids_str: str,
    is_paid: bool,
    is_reimb: bool,
    dashboard_url: str = "",
    is_ongkir_or_cash: bool = False,
    category: str | None = None,
    item_name: str | None = None,
    expenses: list | None = None,
    items: list | None = None,
    topic_type: str | None = None,
) -> dict:
    """Buat inline keyboard konsisten untuk aksi pengeluaran di Telegram."""
    if not is_ongkir_or_cash:
        is_ongkir_or_cash = is_ongkir_or_tukar_cash(
            category=category,
            item_name=item_name,
            items=items,
            expenses=expenses,
            topic_type=topic_type,
        )

    rows = []
    if ids_str:
        if is_ongkir_or_cash:
            # Pengeluaran Ongkir & Tukar Cash:
            # Hilangkan tombol Set Belum Lunas, Tandai Reimburse, dan Lihat Dashboard.
            # Hanya sisakan tombol Batal Simpan.
            rows.append([
                {"text": "🗑️ Batal Simpan", "callback_data": f"undo_save:{ids_str}"},
            ])
        else:
            pay_btn = (
                {"text": "⏳ Set Belum Lunas", "callback_data": f"unpaid_save:{ids_str}"}
                if is_paid
                else {"text": "✅ Tandai Lunas", "callback_data": f"mark_paid:{ids_str}"}
            )
            reimb_btn = "💼 Reimburse: YA (Ubah)" if is_reimb else "💼 Tandai Reimburse"
            rows.append([
                {"text": "🗑️ Batal Simpan", "callback_data": f"undo_save:{ids_str}"},
                pay_btn,
            ])
            rows.append([
                {"text": reimb_btn, "callback_data": f"toggle_reimb:{ids_str}"},
            ])

    if dashboard_url and not is_ongkir_or_cash:
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


def parse_due_date(due_str: str | None, ref_date: date | None = None) -> date | None:
    """
    Parse string jatuh tempo ke date object.
    Mendukung format:
    - YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
    - Ekspresi bahasa alami: 'besok', 'lusa', 'minggu depan', '1 minggu', '2 minggu', '1 bulan'
    """
    if not due_str or str(due_str).strip() in ("-", "", "None", "null"):
        return None
    s = str(due_str).strip().lower()
    base_date = ref_date or date.today()

    # Kata relatif bahasa Indonesia
    if s in ("besok", "1 hari", "1 hari lagi"):
        return base_date + timedelta(days=1)
    if s in ("lusa", "2 hari", "2 hari lagi"):
        return base_date + timedelta(days=2)
    if s in ("minggu depan", "1 minggu", "1 minggu lagi", "seminggu"):
        return base_date + timedelta(days=7)
    if s in ("2 minggu", "2 minggu lagi"):
        return base_date + timedelta(days=14)
    if s in ("1 bulan", "sebulan", "bulan depan"):
        return base_date + timedelta(days=30)

    # Format YYYY-MM-DD atau DD-MM-YYYY
    if "-" in s:
        parts = s.split("-")
        if len(parts) == 3:
            if len(parts[0]) == 4 and parts[0].isdigit():
                try:
                    return date(int(parts[0]), int(parts[1]), int(parts[2]))
                except ValueError:
                    pass
            elif len(parts[2]) == 4 and parts[2].isdigit():
                try:
                    return date(int(parts[2]), int(parts[1]), int(parts[0]))
                except ValueError:
                    pass
    # Format DD/MM/YYYY atau YYYY/MM/DD
    elif "/" in s:
        parts = s.split("/")
        if len(parts) == 3:
            if len(parts[2]) == 4 and parts[2].isdigit():
                try:
                    return date(int(parts[2]), int(parts[1]), int(parts[0]))
                except ValueError:
                    pass
            elif len(parts[0]) == 4 and parts[0].isdigit():
                try:
                    return date(int(parts[0]), int(parts[1]), int(parts[2]))
                except ValueError:
                    pass
    return None


def get_due_date_status_label(due_date_str: str | None, ref_date: date | None = None) -> dict:
    """
    Analisis status jatuh tempo tagihan:
    Kembalikan info urgensi, jumlah hari tersisa, dan label deskriptif.
    """
    today = ref_date or date.today()
    parsed = parse_due_date(due_date_str, ref_date=today)
    if not parsed:
        return {
            "parsed_date": None,
            "iso_string": str(due_date_str or "-"),
            "is_overdue": False,
            "days_left": None,
            "label": str(due_date_str or "-"),
            "urgency": "none",
        }

    delta_days = (parsed - today).days
    iso_str = parsed.isoformat()

    if delta_days < 0:
        overdue_days = abs(delta_days)
        label = f"🚨 Lewat {overdue_days} hari ({fmt_date_id(parsed)})"
        urgency = "overdue"
    elif delta_days == 0:
        label = f"🚨 HARI INI ({fmt_date_id(parsed)})"
        urgency = "today"
    elif delta_days == 1:
        label = f"⚠️ Besok ({fmt_date_id(parsed)})"
        urgency = "soon"
    elif delta_days <= 3:
        label = f"⚠️ Sisa {delta_days} hari ({fmt_date_id(parsed)})"
        urgency = "soon"
    else:
        label = f"📅 Sisa {delta_days} hari ({fmt_date_id(parsed)})"
        urgency = "upcoming"

    return {
        "parsed_date": parsed,
        "iso_string": iso_str,
        "is_overdue": delta_days < 0,
        "days_left": delta_days,
        "label": label,
        "urgency": urgency,
    }

