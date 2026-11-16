"""
app/services/sales_import_service.py — Parser & Importer Laporan Transaksi Masuk
Mendukung:
1. Laporan Transaksi POS (format multi-baris Per Item seperti POS Transaction History Cake.csv)
2. Arsitektur adapter untuk laporan GoFood / GrabFood / ShopeeFood
"""
import csv
import io
import re
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Any


def _decode_csv_bytes(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _detect_delimiter(sample_lines: list[str]) -> str:
    best_delim = ","
    best_count = 0
    for delim in (",", ";", "\t"):
        max_cols = max((line.count(delim) for line in sample_lines[:25]), default=0)
        if max_cols > best_count:
            best_count = max_cols
            best_delim = delim
    return best_delim


def _parse_number(raw: Any) -> float:
    if raw is None:
        return 0.0
    s = str(raw).strip()
    if not s or s in ("-", "—", "nan", "None"):
        return 0.0
    # Hapus simbol mata uang dan spasi
    s = re.sub(r"[Rp\s]", "", s, flags=re.IGNORECASE)
    # Tangani format ribuan Indonesia (125.000) vs desimal (125000.00)
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_date_id(raw: str) -> date | None:
    s = (raw or "").strip()
    if not s or s == "-":
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%d %b %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _clean_time(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s or s == "-":
        return None
    s = re.sub(r"\s*(WIB|WITA|WIT)\s*$", "", s, flags=re.IGNORECASE).strip()
    return s or None


def _clean_str(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s == "-":
        return None
    return s


@dataclass
class ParsedSalesResult:
    source_type: str
    transactions: list[dict[str, Any]] = field(default_factory=list)
    skipped_rows: list[dict[str, Any]] = field(default_factory=list)
    total_raw_rows: int = 0

    @property
    def paid_count(self) -> int:
        return sum(1 for t in self.transactions if t["status"] == "paid")

    @property
    def void_count(self) -> int:
        return sum(1 for t in self.transactions if t["status"] != "paid")

    @property
    def total_items(self) -> int:
        return sum(len(t.get("items", [])) for t in self.transactions)


def _find_pos_header_index(rows: list[list[str]]) -> int:
    for idx, row in enumerate(rows[:40]):
        normalized = {cell.strip().lower() for cell in row if cell and cell.strip()}
        if "no receipt" in normalized and (
            "no penjualan" in normalized or "tanggal penjualan" in normalized
        ):
            return idx
    return -1


def parse_pos_csv(content: bytes) -> ParsedSalesResult:
    """
    Parser khusus laporan ekspor POS (mode Per Item):
    - Melewati baris metadata (baris 1-11) hingga menemukan header `No Receipt`
    - Melewati baris `TOTAL` di akhir laporan
    - Menggabungkan baris child item (yang `No Receipt`-nya kosong) ke transaksi parent
    - Memisahkan transaksi `Dibayar` vs `Void`
    """
    text = _decode_csv_bytes(content)
    lines = text.splitlines()
    delim = _detect_delimiter(lines)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)

    header_idx = _find_pos_header_index(rows)
    if header_idx < 0:
        raise ValueError(
            "Header laporan POS tidak ditemukan. Pastikan file memiliki kolom 'No Receipt' dan 'Tanggal Penjualan'."
        )

    headers = [h.strip() for h in rows[header_idx]]
    col_idx = {h.lower(): i for i, h in enumerate(headers) if h}

    def get_val(row: list[str], *col_names: str) -> str:
        for name in col_names:
            i = col_idx.get(name.lower())
            if i is not None and i < len(row):
                return row[i].strip()
        return ""

    result = ParsedSalesResult(source_type="pos")
    current_tx: dict[str, Any] | None = None

    for row_num, row in enumerate(rows[header_idx + 1 :], start=header_idx + 2):
        if not any(cell.strip() for cell in row):
            continue

        first_cell = row[0].strip().upper() if row else ""
        if first_cell == "TOTAL":
            continue

        result.total_raw_rows += 1
        receipt_no = get_val(row, "No Receipt")
        order_no = get_val(row, "No Penjualan")

        if receipt_no:
            tx_date = _parse_date_id(get_val(row, "Tanggal Penjualan"))
            if not tx_date:
                result.skipped_rows.append(
                    {"row": row_num, "receipt_no": receipt_no, "reason": "Tanggal penjualan tidak valid"}
                )
                current_tx = None
                continue

            raw_status = get_val(row, "Status").lower()
            void_date = _clean_str(get_val(row, "Tanggal Void"))
            void_time = _clean_time(get_val(row, "Waktu Void"))
            if raw_status == "void" or void_date:
                tx_status = "void"
            elif raw_status in ("batal", "cancelled", "cancel"):
                tx_status = "cancelled"
            else:
                tx_status = "paid"

            order_type = _clean_str(get_val(row, "Tipe Order")) or "Lainnya"
            payment_method = _clean_str(get_val(row, "Jenis Pembayaran")) or order_type
            net_sales = _parse_number(get_val(row, "Penjualan Bersih"))
            platform_fee = _parse_number(get_val(row, "Biaya Pembayaran"))
            net_received = _parse_number(get_val(row, "Bersih Diterima"))
            cancellation_total = _parse_number(get_val(row, "Total Pembatalan"))

            if tx_status != "paid":
                net_received = 0.0
                if cancellation_total == 0.0 and net_sales > 0:
                    cancellation_total = net_sales

            current_tx = {
                "source_type": "pos",
                "receipt_no": receipt_no,
                "order_no": _clean_str(order_no),
                "transaction_date": tx_date,
                "transaction_time": _clean_time(get_val(row, "Waktu Penjualan")),
                "location_name": _clean_str(get_val(row, "Nama Lokasi")),
                "order_type": order_type,
                "payment_method": payment_method,
                "customer_name": _clean_str(get_val(row, "Nama Pelanggan")),
                "cashier_name": _clean_str(get_val(row, "Nama Kasir")),
                "gross_sales": 0.0,
                "discount_amount": 0.0,
                "net_sales": net_sales,
                "platform_fee": platform_fee,
                "net_received": net_received,
                "cancellation_total": cancellation_total,
                "promo_name": _clean_str(get_val(row, "Nama Promo")),
                "status": tx_status,
                "void_at": f"{void_date or ''} {void_time or ''}".strip() or None,
                "notes": _clean_str(get_val(row, "Catatan Pembayaran", "Catatan Penyesuaian")),
                "items": [],
            }
            result.transactions.append(current_tx)

        # Tambahkan item (baik untuk baris parent maupun child rows)
        product_name = _clean_str(get_val(row, "Nama Produk"))
        if current_tx is not None and product_name:
            item_gross = _parse_number(get_val(row, "Penjualan Kotor"))
            item_discount = _parse_number(get_val(row, "Total Diskon"))
            item = {
                "category": _clean_str(get_val(row, "Kategori Produk")),
                "product_group": _clean_str(get_val(row, "Grup Produk")),
                "product_name": product_name,
                "sku": _clean_str(get_val(row, "SKU Produk")),
                "qty": _parse_number(get_val(row, "Qty produk")) or 1.0,
                "modifier": _clean_str(get_val(row, "Pengubah")),
                "unit_price": _parse_number(get_val(row, "Harga")),
                "extra_price": _parse_number(get_val(row, "Harga Tambahan")),
                "gross_amount": item_gross,
                "discount_amount": item_discount,
            }
            current_tx["items"].append(item)
            current_tx["gross_sales"] += item_gross
            current_tx["discount_amount"] += item_discount

    return result


def parse_sales_csv(content: bytes, source_type: str = "auto") -> ParsedSalesResult:
    """
    Dispatcher parser laporan transaksi masuk.
    Saat ini format POS (termasuk kolom Tipe Order: Take Away, GoFood Integrasi,
    GrabFood Integrasi, ShopeeFood, Marketplace, Cakeflow) ditangani penuh.
    """
    src = (source_type or "auto").strip().lower()
    if src in ("auto", "pos"):
        return parse_pos_csv(content)
    if src in ("gofood", "grabfood", "shopeefood"):
        # Jika user memilih channel spesifik namun mengunggah CSV POS, fallback ke POS parser
        try:
            parsed = parse_pos_csv(content)
            return parsed
        except ValueError:
            raise ValueError(
                f"Format CSV khusus portal {src.upper()} belum tersedia. "
                "Gunakan file ekspor POS (yang sudah memuat kolom Tipe Order GoFood/GrabFood/ShopeeFood) "
                "atau lampirkan contoh CSV portal untuk ditambahkan mapping-nya."
            )
    raise ValueError(f"Sumber laporan tidak dikenal: {source_type}")
