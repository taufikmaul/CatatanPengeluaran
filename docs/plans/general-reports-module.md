# Rencana Implementasi Modul Laporan Umum (Operasional & Manajerial)

Dokumen rencana implementasi untuk membangun pusat **Laporan Umum** (di luar Laporan Akuntansi SAK EMKM) pada project `CatatanPengeluaran`, mencakup Laporan Bahan & Harga, Ongkir & Kurir, Omset & Channel, HPP & Menu Engineering, Realisasi Anggaran & Aging Hutang, serta Pengadaan Gudang & Pemeliharaan Aset.

---

## Step 1 — Fondasi Service & Skema Kontrak Laporan Umum

**Intent**: Membangun pondasi modul `app/services/general_reports_service.py` dengan helper resolusi rentang periode standar (`start_date`/`end_date` serta `year`/`month`/`month_end` dan periode pembanding MoM/YoY) serta mendefinisikan skema Pydantic deterministik pada `app/api/schemas.py` untuk seluruh payload Laporan Umum.

- **Acceptance**:
  1. Fungsi resolusi periode menangani rentang tanggal kustom maupun filter bulan/multi-bulan secara konsisten, termasuk kalkulasi periode pembanding dan delta persentase aman (tanpa pembagian nol).
  2. Skema response Pydantic untuk ringkasan metrik, item tabel, dan data grafik terdefinisi di `app/api/schemas.py` dengan type hints lengkap.
  3. Unit test `pytest` untuk helper periode dan validasi skema lulus tanpa error.
- **Out of scope**: Perubahan skema tabel database atau pembuatan migrasi Alembic.

---

## Step 2 — Laporan Bahan Baku, Kemasan & Pergerakan Harga

**Intent**: Mengimplementasikan `get_materials_report` pada `app/services/general_reports_service.py` dan endpoint `GET /api/reports/general/materials` beserta `/export` CSV pada `app/api/reports.py` menggunakan data `Expense`, `MasterItem`, `Supplier`, dan `PurchaseRequestItem`.

- **Acceptance**:
  1. Menghitung belanja bruto (`sum(qty * unit_price)`), belanja netto/landed cost (`sum(total_price)`), harga satuan efektif terkonversi ke `MasterItem.satuan_resep` via `konversi_resep`, Weighted Average Price (WAP), dan rasio belanja bahan terhadap omset bersih.
  2. Mendeteksi item dengan kenaikan harga >= 5% (`PRICE_DRIFT_THRESHOLD_PCT`) dibanding pembelian sebelumnya serta menyajikan selisih penerimaan gudang (`PurchaseRequestItem.qty_received - qty` dan tingkat `KURANG`/`RUSAK`).
  3. Mendukung ekspor CSV UTF-8 dengan header terstruktur dan lolos unit test `pytest` termasuk edge case satuan berbeda (`Kg` vs `Gram`) dan `qty == 0`.
- **Out of scope**: Fitur stock opname fisik atau kartu mutasi persediaan bahan baku.

---

## Step 3 — Laporan Ongkir & Logistik Kurir

**Intent**: Mengimplementasikan `get_shipping_report` pada `app/services/general_reports_service.py` dan endpoint `GET /api/reports/general/shipping` beserta `/export` CSV pada `app/api/reports.py` untuk memisahkan ongkir kurir pengiriman mandiri vs ongkir pembelian yang melekat di struk supplier (`Expense.shipping_fee`).

- **Acceptance**:
  1. Memisahkan agregasi Ongkir Mandiri (transaksi kurir) vs Freight-In (`Expense.shipping_fee > 0` pada belanja non-ongkir) beserta rata-rata biaya per trip, rasio ongkir terhadap omset bersih, dan rasio freight-in terhadap belanja bahan.
  2. Menyajikan breakdown per kurir (`Supplier`) lengkap dengan status langganan (`is_subscribed`), serta memisahkan ongkir tunai/kas toko vs talangan (`is_reimbursement`) dan saldo talangan belum diganti (`reimbursed_at IS NULL`).
  3. Unit test `pytest` memverifikasi tidak ada double-counting antara transaksi ongkir mandiri dan `shipping_fee` serta ekspor CSV valid.
- **Out of scope**: Penambahan kolom baru di database atau integrasi API pelacakan kurir eksternal.

---

## Step 4 — Laporan Omset & Performa Channel Penjualan

**Intent**: Mengimplementasikan `get_sales_report` pada `app/services/general_reports_service.py` dan endpoint `GET /api/reports/general/sales` beserta `/export` CSV pada `app/api/reports.py` berbasis `IncomingTransaction` dan `IncomingTransactionItem`.

- **Acceptance**:
  1. Menyajikan tiga lapis omset secara terpisah (`gross_sales`, `net_sales`, `net_received`), Average Order Value (AOV), Discount Rate, Effective Platform Fee Rate per `order_type`, rata-rata omset harian, dan pertumbuhan periode pembanding.
  2. Menghitung Void/Cancellation Rate baik berdasarkan jumlah transaksi maupun persentase nominal (`cancellation_total`) per channel dan tren omset harian.
  3. Unit test `pytest` memverifikasi agregasi transaksi `paid` vs `void`/`cancelled`, transaksi tanpa rincian item (itemless/Cakeflow), dan ekspor CSV.
- **Out of scope**: Rekonsiliasi mutasi rekening bank atau perubahan alur import CSV POS.

---

## Step 5 — Laporan HPP & Profitabilitas Menu (Menu Engineering)

**Intent**: Mengimplementasikan `get_hpp_report` pada `app/services/general_reports_service.py` dan endpoint `GET /api/reports/general/hpp` beserta `/export` CSV pada `app/api/reports.py` dengan memanfaatkan `resolve_all_menu_financials` dan `DEFAULT_PRICING_CHANNELS` dari `app/services/menu_product_service.py`.

- **Acceptance**:
  1. Menghitung HPP unit per menu (`Core Unit HPP`, `Recipe HPP`, `Food Cost %`, `Pure Food Cost %`, `Packaging Cost %`, `Gross Margin %`) serta simulasi net profit per channel delivery (`dine_in`, `gofood`, `grabfood`, `shopeefood`).
  2. Menyajikan perbandingan HPP Teoritis penjualan (`qty_sold * effective_hpp`) vs HPP Aktual berbasis pembelian (`HPP Pembelian`) secara eksplisit beserta daftar produk POS yang belum terpetakan (`unmatched_items`).
  3. Mengklasifikasikan menu terjual ke matriks Menu Engineering (`Star`, `Plowhorse`, `Puzzle`, `Dog`) berdasarkan rata-rata popularitas dan weighted contribution margin, terverifikasi unit test `pytest`.
- **Out of scope**: Perubahan rumus dasar HPP di `MenuProductsTab` atau pemetaan otomatis permanen `menu_product_id` di tabel transaksi masuk.

---

## Step 6 — Laporan Realisasi Anggaran, Performa Supplier & Aging Hutang

**Intent**: Mengimplementasikan `get_budget_and_ap_report` pada `app/services/general_reports_service.py` dan endpoint `GET /api/reports/general/budget-aging` beserta `/export` CSV pada `app/api/reports.py` menggunakan `MonthlyBudget`, `Expense`, `ExpensePayment`, dan `Supplier`.

- **Acceptance**:
  1. Menghitung serapan anggaran (`Realisasi / Budget * 100%`), sisa plafon, dan proyeksi run-rate akhir bulan per kategori dari `get_effective_budget`.
  2. Mengelompokkan sisa hutang belanja (`total_price - paid_amount`) ke bucket aging (`Belum Jatuh Tempo`, `1-7 Hari`, `8-30 Hari`, `>30 Hari`), menghitung share belanja per supplier, serta SLA penggantian talangan (`reimbursed_at - created_at`).
  3. Unit test `pytest` lulus untuk skenario DP/cicilan lintas bulan, jatuh tempo lewat hari ini, dan fallback saat `MonthlyBudget` belum disetup.
- **Out of scope**: Perubahan alur pembayaran termin `ExpensePayment` atau pengingat WA/Telegram otomatis.

---

## Step 7 — Laporan Pengadaan Gudang, Kedaluwarsa & Pemeliharaan Aset

**Intent**: Mengimplementasikan `get_procurement_and_asset_report` pada `app/services/general_reports_service.py` dan endpoint `GET /api/reports/general/procurement-assets` pada `app/api/reports.py` berbasis `PurchaseRequest`, `PurchaseRequestItem`, `FixedAsset`, dan `AssetMaintenance`.

- **Acceptance**:
  1. Menghitung rata-rata lead time pengadaan (`received_at - request_date`), akurasi estimasi harga (`(actual - estimated) / estimated * 100%`), tingkat ketidaksesuaian penerimaan (`KURANG`/`LEBIH`/`RUSAK`), dan daftar item mendekati `expired_date` (<= 7 hari dan <= 30 hari).
  2. Menyajikan rasio biaya pemeliharaan aset (`sum(cost) / acquisition_cost * 100%`), jadwal servis terdekat (`next_service_date`), dan aset mendekati akhir masa garansi (`warranty_expiry_date`).
  3. Unit test `pytest` memverifikasi perhitungan metrik pengadaan, expired alert, dan rasio maintenance aset.
- **Out of scope**: Perubahan workflow approval pengajuan belanja atau pencatatan QR label aset.

---

## Step 8 — Integrasi Read-Only Tool Laporan Umum ke Agent Hermes

**Intent**: Menambahkan tool read-only `tool_get_general_report_summary` pada `app/agent/tools.py` dan `app/services/ai_chat_tools.py` dengan kontrak observation standar (`status`, `summary`, `data`, `next_actions`) agar owner dapat menanyakan ringkasan laporan bahan, ongkir, omset, HPP, dan anggaran melalui chat Hermes/AI Chat.

- **Acceptance**:
  1. Tool terdaftar dengan skema parameter tervalidasi (`report_type`, `month`, `year`, `start_date`, `end_date`) dan hanya bersifat read-only.
  2. Output tool mematuhi kontrak observation (`status`, `summary`, `data`, `next_actions`) dan memanfaatkan `app/services/general_reports_service.py` tanpa duplikasi rumus.
  3. Unit test `pytest` memverifikasi pemanggilan tool per `report_type` dan penanganan input invalid tanpa crash.
- **Out of scope**: Mengubah logika intent classifier utama atau menambah aksi tulis/hapus pada bot Telegram.

---

## Step 9 — Antarmuka Frontend `GeneralReportsTab` & Integrasi `GovernanceHubView`

**Intent**: Menambahkan tipe TypeScript pada `frontend/src/types/index.ts`, fungsi API client pada `frontend/src/lib/api.ts`, rute `/laporan-umum` pada `frontend/src/App.tsx`, tab `Laporan Umum` pada `frontend/src/components/accounting/GovernanceHubView.tsx`, serta membangun komponen `frontend/src/components/reports/GeneralReportsTab.tsx` dengan sub-tab `Bahan & Harga`, `Ongkir & Kurir`, `Omset & Channel`, `HPP & Menu`, `Anggaran & Hutang`, dan `Gudang & Aset`.

- **Acceptance**:
  1. Setiap sub-tab menampilkan filter periode terpadu, KPI strip dengan delta periode lalu, visualisasi grafik, tabel `DataTable` sortable/searchable, serta tombol Export CSV.
  2. Seluruh state UI (Loading skeleton, Error dengan retry, Empty state informatif) lengkap, responsif mobile, dan memenuhi kontras warna WCAG AA.
  3. Typecheck TypeScript dan `npm run build` di direktori `frontend/` lulus tanpa error maupun warning tipe.
- **Out of scope**: Mendesain ulang layout `AccountingTab.tsx` atau tab `CashflowHubView` yang sudah ada.

---

## Step 10 — Verifikasi End-to-End, Regresi Backend & Build Production

**Intent**: Menjalankan verifikasi menyeluruh setelah seluruh integrasi selesai: eksekusi test suite `pytest` untuk modul laporan umum dan regresi laporan akuntansi, validasi `npm run build` frontend, serta smoke check alur API dan rendering antar-tab laporan umum.

- **Acceptance**:
  1. Seluruh suite `pytest` backend untuk `general_reports_service`, `reports` API, dan regresi `accounting_service` lulus 100% tanpa skip.
  2. Production build frontend (`npm run build` di `frontend/`) dan pemeriksaan tipe TypeScript selesai bersih dengan exit code 0.
  3. Endpoint API laporan umum mengembalikan status HTTP 200 dengan payload valid sesuai skema saat diuji end-to-end.
- **Out of scope**: Penambahan fitur baru atau perubahan skema database di luar Step 1-9.
