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
    for fmt in (
        "%d/%m/%Y",
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%Y/%m/%d",
        "%d %b %Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ):
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
        if "no receipt" in normalized and any(
            k in normalized
            for k in (
                "no penjualan",
                "no order",
                "order id",
                "tanggal penjualan",
                "tanggal",
                "tanggal transaksi",
                "penjualan kotor",
                "gross sales",
            )
        ):
            return idx
        if (
            "order id" in normalized
            and "total belanja" in normalized
            and any(k in normalized for k in ("tanggal input", "tanggal target", "tanggal"))
        ):
            return idx
    return -1


def parse_pos_csv(content: bytes) -> ParsedSalesResult:
    """
    Parser laporan penjualan:
    1. Format Template Transaksi Masuk (Transaction Import.csv: per-transaksi)
    2. Format Laporan Ekspor POS Moka / Olsera (mode Per Item multi-baris)
    - Melewati baris metadata hingga menemukan header `No Receipt`
    - Melewati baris `TOTAL` di akhir laporan
    - Menggabungkan baris child item ke transaksi parent jika ada kolom produk
    - Mendukung format 'Tanggal' & 'Jam' maupun 'Tanggal Penjualan' & 'Waktu Penjualan'
    - Memisahkan status transaksi `Dibayar` / `Paid` vs `Void` / `Cancelled`
    """
    text = _decode_csv_bytes(content)
    lines = text.splitlines()
    delim = _detect_delimiter(lines)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)

    header_idx = _find_pos_header_index(rows)
    if header_idx < 0:
        raise ValueError(
            "Header laporan tidak ditemukan. Pastikan file memiliki kolom 'No Receipt' dan 'Tanggal' (format Transaction Import / POS)."
        )

    headers = [h.strip() for h in rows[header_idx]]
    col_idx = {h.lower(): i for i, h in enumerate(headers) if h}

    def get_val(row: list[str], *col_names: str) -> str:
        for name in col_names:
            i = col_idx.get(name.lower())
            if i is not None and i < len(row):
                return row[i].strip()
        return ""

    has_product_col = any(
        k in col_idx for k in ("nama produk", "kategori produk", "sku produk")
    )

    result = ParsedSalesResult(source_type="pos")
    current_tx: dict[str, Any] | None = None

    for row_num, row in enumerate(rows[header_idx + 1 :], start=header_idx + 2):
        if not any(cell.strip() for cell in row):
            continue

        first_cell = row[0].strip().upper() if row else ""
        if first_cell == "TOTAL":
            continue

        result.total_raw_rows += 1
        receipt_no = get_val(row, "No Receipt", "No Struk", "Receipt", "Struk")
        order_no = get_val(row, "No Penjualan", "No Order", "Order ID", "No Pesanan")
        if not receipt_no and order_no:
            receipt_no = order_no

        if receipt_no or not has_product_col:
            if not receipt_no:
                continue

            tx_date = (
                _parse_date_id(get_val(row, "Tanggal Penjualan", "Tanggal", "Tanggal Transaksi", "Date", "Tgl"))
                or _parse_date_id(get_val(row, "Tanggal Target"))
                or _parse_date_id(get_val(row, "Tanggal Input"))
            )
            if not tx_date:
                result.skipped_rows.append(
                    {"row": row_num, "receipt_no": receipt_no, "reason": "Tanggal penjualan tidak valid"}
                )
                current_tx = None
                continue

            raw_status = get_val(row, "Status", "Status Transaksi").lower()
            void_date = _clean_str(get_val(row, "Tanggal Void"))
            void_time = _clean_time(get_val(row, "Waktu Void"))
            if raw_status in ("void", "dibatalkan") or void_date:
                tx_status = "void"
            elif raw_status in ("batal", "cancelled", "cancel"):
                tx_status = "cancelled"
            else:
                tx_status = "paid"

            order_type = _clean_str(get_val(row, "Tipe Order", "Channel", "Saluran")) or "Take Away"
            payment_method = (
                _clean_str(get_val(row, "Jenis Pembayaran", "Metode Bayar", "Metode Pembayaran", "Payment"))
                or _clean_str(get_val(row, "Metode Pelunasan"))
                or _clean_str(get_val(row, "Metode DP"))
                or order_type
            )

            raw_gross = _parse_number(
                get_val(row, "Penjualan Kotor", "Gross Sales", "Total Kotor", "Gross", "Total Belanja")
            )
            raw_disc = _parse_number(get_val(row, "Total Diskon", "Diskon", "Discount", "Diskon Penjualan"))
            platform_fee = _parse_number(
                get_val(row, "Biaya Pembayaran", "Fee Platform", "Biaya Platform", "Platform Fee", "Komisi")
            )

            net_sales_raw = get_val(row, "Penjualan Bersih", "Net Sales")
            if net_sales_raw:
                net_sales = _parse_number(net_sales_raw)
            else:
                net_sales = max(0.0, raw_gross - raw_disc) if tx_status == "paid" else 0.0

            net_rec_raw = get_val(row, "Bersih Diterima", "Net Received")
            if net_rec_raw:
                net_received = _parse_number(net_rec_raw)
            else:
                net_received = max(0.0, net_sales - platform_fee) if tx_status == "paid" else 0.0

            cancellation_total = _parse_number(get_val(row, "Total Pembatalan"))
            if tx_status != "paid":
                net_received = 0.0
                if cancellation_total == 0.0 and net_sales > 0:
                    cancellation_total = net_sales
                elif cancellation_total == 0.0 and raw_gross > 0:
                    cancellation_total = max(0.0, raw_gross - raw_disc)

            bank_account_name = _clean_str(
                get_val(row, "Rekening Tujuan", "Rekening", "Nama Rekening", "Bank Account")
            )
            notes = (
                _clean_str(get_val(row, "Catatan Pembayaran", "Catatan Penyesuaian", "Catatan", "Notes", "Keterangan"))
                or _clean_str(get_val(row, "Produk"))
            )
            void_str = f"{void_date or ''} {void_time or ''}".strip() or None

            current_tx = {
                "source_type": "pos",
                "receipt_no": receipt_no,
                "order_no": _clean_str(order_no),
                "transaction_date": tx_date,
                "transaction_time": _clean_time(get_val(row, "Waktu Penjualan", "Jam", "Waktu", "Time")),
                "location_name": _clean_str(get_val(row, "Nama Lokasi")),
                "order_type": order_type,
                "payment_method": payment_method,
                "bank_account_name": bank_account_name,
                "raw_bank_account_name": bank_account_name,
                "customer_name": _clean_str(get_val(row, "Nama Pelanggan", "Customer", "Customer/Penerima")),
                "cashier_name": _clean_str(get_val(row, "Nama Kasir", "Cashier", "Admin")),
                "gross_sales": raw_gross if not has_product_col else 0.0,
                "discount_amount": raw_disc if not has_product_col else 0.0,
                "net_sales": net_sales,
                "platform_fee": platform_fee,
                "net_received": net_received,
                "cancellation_total": cancellation_total,
                "promo_name": _clean_str(get_val(row, "Nama Promo")),
                "status": tx_status,
                "void_at": void_str,
                "notes": notes,
                "items": [],
            }
            result.transactions.append(current_tx)

        # Tambahkan item (hanya untuk laporan multi-item POS agar ringkasan produk 1-baris tidak memicu selisih audit item)
        product_name = _clean_str(get_val(row, "Nama Produk", "Product Name", "Produk"))
        if current_tx is not None and has_product_col and product_name:
            item_gross = _parse_number(get_val(row, "Penjualan Kotor", "Harga Subtotal"))
            item_discount = _parse_number(get_val(row, "Total Diskon", "Diskon Produk", "Diskon"))
            item = {
                "category": _clean_str(get_val(row, "Kategori Produk", "Kategori")),
                "product_group": _clean_str(get_val(row, "Grup Produk")),
                "product_name": product_name,
                "sku": _clean_str(get_val(row, "SKU Produk", "SKU")),
                "qty": _parse_number(get_val(row, "Qty produk", "Qty", "Jumlah")) or 1.0,
                "modifier": _clean_str(get_val(row, "Pengubah", "Modifier")),
                "unit_price": _parse_number(get_val(row, "Harga", "Harga Satuan")),
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


def audit_sales_transactions(
    transactions: list[dict[str, Any]],
    existing_receipts: set[str] | None = None,
    registered_bank_accounts: set[str] | None = None,
    skipped_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Verifikasi & audit data anomali atau data kurang sebelum import transaksi masuk.
    Mendeteksi:
    1. Kelengkapan: baris dilewati (tanggal/kolom kosong), struk tanpa nomor, order_type/metode bayar kosong.
    2. Tanggal Anomali: tanggal di masa depan atau terlalu lampau (>2 tahun).
    3. Anomali Finansial:
       - Status paid tapi penjualan kotor Rp 0 / minus
       - Diskon lebih besar dari penjualan kotor
       - Fee platform lebih besar dari penjualan bersih
       - Penjualan kotor sangat tinggi (> Rp 15 juta per struk, warning potensi typo 0)
       - Selisih total kotor struk vs jumlahan item produk
    4. Rekening Tujuan: rekening tujuan belum terpetakan atau nama rekening tidak dikenal.
    5. Duplikasi: nomor struk duplikat di dalam file impor atau sudah terdaftar di database.
    """
    from datetime import timedelta

    findings: list[dict[str, Any]] = []

    # 0. Baris yang dilewati saat parse (format rusak / tanggal kosong)
    if skipped_rows:
        for s in skipped_rows:
            srno = s.get("receipt_no")
            row_num = s.get("row")
            reason = s.get("reason") or "Format data tidak valid"
            findings.append({
                "level": "error",
                "category": "missing_field",
                "receipt_no": srno,
                "message": f"Baris #{row_num}" + (f" (Struk '{srno}')" if srno else "") + f": Dilewati karena {reason}.",
            })
    receipt_counts: dict[str, int] = {}
    for tx in transactions:
        rno = (tx.get("receipt_no") or "").strip()
        if rno:
            receipt_counts[rno] = receipt_counts.get(rno, 0) + 1

    seen_internal_duplicates: set[str] = set()
    today = date.today()

    for idx, tx in enumerate(transactions, start=1):
        rno = (tx.get("receipt_no") or "").strip() or None

        # 1. Duplikasi internal dalam file
        if rno and receipt_counts.get(rno, 0) > 1 and rno not in seen_internal_duplicates:
            seen_internal_duplicates.add(rno)
            findings.append({
                "level": "warning",
                "category": "duplicate",
                "receipt_no": rno,
                "message": f"Struk '{rno}' muncul {receipt_counts[rno]} kali dalam file ini.",
            })

        # 2. Duplikasi data yang sudah ada di database
        if existing_receipts and rno and rno in existing_receipts:
            findings.append({
                "level": "info",
                "category": "duplicate",
                "receipt_no": rno,
                "message": f"Struk '{rno}' sudah terdaftar di database (akan dilewati jika skip duplicate aktif).",
            })

        # 3. Kelengkapan data dasar
        if not rno:
            findings.append({
                "level": "warning",
                "category": "missing_field",
                "receipt_no": None,
                "message": f"Baris #{idx}: Nomor receipt/struk kosong.",
            })

        tx_date = tx.get("transaction_date")
        if not tx_date:
            findings.append({
                "level": "error",
                "category": "missing_field",
                "receipt_no": rno,
                "message": f"Struk '{rno or f'#{idx}'}': Tanggal transaksi tidak valid atau kosong.",
            })
        elif isinstance(tx_date, date):
            if tx_date > today:
                findings.append({
                    "level": "warning",
                    "category": "date_anomaly",
                    "receipt_no": rno,
                    "message": f"Struk '{rno}': Tanggal transaksi ({tx_date.isoformat()}) berada di masa depan.",
                })
            elif tx_date < today - timedelta(days=365 * 2):
                findings.append({
                    "level": "info",
                    "category": "date_anomaly",
                    "receipt_no": rno,
                    "message": f"Struk '{rno}': Tanggal transaksi ({tx_date.isoformat()}) lebih dari 2 tahun lalu.",
                })

        order_type = (tx.get("order_type") or "").strip()
        pay_method = (tx.get("payment_method") or "").strip()
        if not order_type:
            findings.append({
                "level": "warning",
                "category": "missing_field",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Tipe order kosong.",
            })
        if not pay_method:
            findings.append({
                "level": "warning",
                "category": "missing_field",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Metode pembayaran kosong.",
            })

        # 4. Anomali finansial
        gross = float(tx.get("gross_sales") or 0.0)
        disc = float(tx.get("discount_amount") or 0.0)
        fee = float(tx.get("platform_fee") or 0.0)
        net_s = float(tx.get("net_sales") or 0.0)
        st = (tx.get("status") or "paid").lower()

        if st == "paid" and gross <= 0:
            findings.append({
                "level": "warning",
                "category": "financial_anomaly",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Status Dibayar tetapi Penjualan Kotor Rp {gross:,.0f}.",
            })
        if disc > gross and gross > 0:
            findings.append({
                "level": "warning",
                "category": "financial_anomaly",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Diskon (Rp {disc:,.0f}) lebih besar dari Penjualan Kotor (Rp {gross:,.0f}).",
            })
        if fee > net_s and net_s > 0:
            findings.append({
                "level": "warning",
                "category": "financial_anomaly",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Fee platform (Rp {fee:,.0f}) melebihi Penjualan Bersih (Rp {net_s:,.0f}).",
            })
        if gross > 15_000_000:
            findings.append({
                "level": "info",
                "category": "financial_anomaly",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Penjualan kotor tinggi (Rp {gross:,.0f}), periksa potensi typo digit 0.",
            })

        # 5. Rekening tujuan
        raw_acc = (tx.get("raw_bank_account_name") or "").strip()
        acc_name = (tx.get("bank_account_name") or "").strip()
        acc_id = tx.get("bank_account_id")

        if raw_acc and registered_bank_accounts and raw_acc.lower() not in registered_bank_accounts:
            findings.append({
                "level": "warning",
                "category": "account_mapping",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Rekening tujuan '{raw_acc}' tidak terdaftar di sistem Rekening Setup.",
            })
        elif not raw_acc and not acc_name and not acc_id:
            findings.append({
                "level": "warning",
                "category": "account_mapping",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Rekening tujuan belum terpetakan untuk metode bayar '{pay_method}'.",
            })
        elif not raw_acc and registered_bank_accounts and acc_name and acc_name.lower() not in registered_bank_accounts:
            findings.append({
                "level": "warning",
                "category": "account_mapping",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Rekening tujuan '{acc_name}' tidak terdaftar di sistem Rekening Setup.",
            })

        # 6. Online fee checks
        is_online = any(k in order_type.lower() for k in ("gofood", "grabfood", "shopeefood", "marketplace"))
        if is_online and st == "paid" and gross > 0 and fee == 0:
            findings.append({
                "level": "info",
                "category": "financial_anomaly",
                "receipt_no": rno,
                "message": f"Struk '{rno}': Pesanan online '{order_type}' tetapi Fee Platform tercatat Rp 0.",
            })

        # 7. Item check
        items = tx.get("items", [])
        if items:
            items_gross = sum(float(it.get("gross_amount") or 0.0) for it in items)
            if abs(gross - items_gross) > 1000:
                findings.append({
                    "level": "warning",
                    "category": "financial_anomaly",
                    "receipt_no": rno,
                    "message": f"Struk '{rno}': Terdapat selisih Rp {abs(gross - items_gross):,.0f} antara total struk vs rincian item.",
                })
            for it in items:
                qty = float(it.get("qty") or 0.0)
                if qty <= 0:
                    findings.append({
                        "level": "warning",
                        "category": "missing_field",
                        "receipt_no": rno,
                        "message": f"Struk '{rno}': Item '{it.get('product_name')}' memiliki kuantitas {qty}.",
                    })

    return {
        "total_findings": len(findings),
        "error_count": sum(1 for f in findings if f["level"] == "error"),
        "warning_count": sum(1 for f in findings if f["level"] == "warning"),
        "info_count": sum(1 for f in findings if f["level"] == "info"),
        "has_blocking_errors": any(f["level"] == "error" for f in findings),
        "findings": findings,
    }
