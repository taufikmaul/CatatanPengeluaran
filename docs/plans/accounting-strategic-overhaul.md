# Rencana Perbaikan Akuntansi & Kompas Strategis Owner (SAK EMKM)

Dokumen rencana implementasi untuk menuntaskan 6 celah validitas alur data akuntansi dan melengkapi metrik strategis CFO/Owner pada project `CatatanPengeluaran` (Historycake).

---

## Step 1 — Konsistensi Akrual Laba Rugi dan Pemisahan Kas Keluar Riil

**Intent**: Memperbaiki `get_monthly_report` di `app/services/expense_service.py` dan `get_accounting_report` di `app/services/accounting_service.py` agar belanja tempo (Belum Lunas / DP) diakui penuh secara akrual pada `per_kategori` (HPP & OPEX Laba Rugi) di bulan terjadinya transaksi, sedangkan Laporan Arus Kas (`arus_kas`) hanya menghitung kas yang benar-benar keluar pada periode tersebut (`ExpensePayment` + `Expense` lunas non-talangan + `BankTransfer.admin_fee`).

- **Acceptance**:
  1. Belanja kategori HPP/OPEX berstatus `Belum Lunas` atau `DP` masuk penuh ke `per_kategori` pada Laba Rugi bulan transaksi, sementara sisa tagihannya tetap tercatat di `list_hutang`.
  2. `arus_kas.total_kas_keluar_riil` hanya menghitung pengeluaran kas aktual bulan berjalan (mengecualikan porsi hutang tempo belum dibayar dan talangan yang `reimbursed_at IS NULL`, serta memasukkan `BankTransfer.admin_fee` dan pembayaran `ExpensePayment` bulan berjalan).
  3. Unit test pytest untuk skenario belanja tempo, DP, pelunasan lintas bulan, dan talangan lulus 100%.
- **Out of scope**: Perubahan skema tabel database atau migrasi Alembic.

---

## Step 2 — Perbaikan Neraca Point-in-Time (As-Of Cutoff) & Laba Ditahan

**Intent**: Memperbaiki `neraca` di `app/services/accounting_service.py` agar `aset_lancar` menggunakan posisi saldo kas/bank kumulatif per tanggal akhir periode laporan (`< end_date`) bukan total pengeluaran per metode bayar, menerapkan filter cutoff `< end_date` pada `hutang_usaha`, `hutang_talangan`, dan `rekening_positions`, serta menghitung `Laba Ditahan (Retained Earnings)` (`3-2000`) dari periode sebelum `start_date` agar Neraca seimbang.

- **Acceptance**:
  1. `neraca.aset_lancar` mencerminkan saldo kas & bank aktual pada akhir bulan laporan (`opening_balance + cash_in_until_end - cash_out_until_end`) yang dikelompokkan berdasarkan akun COA `1-11xx`.
  2. `neraca.kewajiban_lancar` (Hutang Usaha `2-1110` dan Hutang Talangan `2-1120`) hanya menghitung kewajiban yang sudah terjadi sebelum `end_date` dan belum lunas/diganti per `end_date`.
  3. `neraca.ekuitas` memuat Modal Awal (`3-1100`), Laba Ditahan Periode Sebelumnya (`3-2000`), dan Laba/Rugi Bersih Periode Berjalan (`3-2100`).
- **Out of scope**: Perubahan tampilan komponen UI frontend.

---

## Step 3 — Koreksi Penyebut Rasio Finansial Strategis Terhadap Net Revenue

**Intent**: Memperbaiki perhitungan `cost_structure` dan `health_evaluation` di `app/services/accounting_service.py` agar menggunakan `revenue_net` (Pendapatan Bersih) sebagai penyebut utama rasio strategis F&B (HPP/Food Cost Ratio, Labor/Gaji Ratio, Rent/Sewa Ratio, Marketing Ratio, Net Profit Margin, Gross Profit Margin), dengan tetap mempertahankan proporsi terhadap total beban sebagai informasi sekunder.

- **Acceptance**:
  1. `cost_structure` menyertakan rasio terhadap `revenue_net` (`hpp_to_revenue_pct`, `gaji_to_revenue_pct`, `sewa_to_revenue_pct`, `opex_to_revenue_pct`, `gross_margin_pct`, `net_margin_pct`) ketika `revenue_net > 0`.
  2. `health_evaluation` mengevaluasi kesehatan HPP (40%-55%), Gaji (15%-28%), dan Sewa (5%-12%) menggunakan rasio terhadap `revenue_net` apabila omset tersedia, sehingga tidak memicu false warning saat OPEX efisien.
  3. Seluruh pengujian `pytest` pada modul laporan akuntansi lulus.
- **Out of scope**: Pembuatan halaman dashboard baru di luar tab akuntansi.

---

## Step 4 — Analisis Variansi HPP Teoritis (Resep/BOM) vs HPP Aktual (Belanja)

**Intent**: Menambahkan kalkulasi `theoretical_vs_actual_hpp` di `app/services/accounting_service.py` yang mengalikan kuantitas item terjual (`IncomingTransactionItem` pada transaksi `paid`) dengan `effective_hpp` dari `MenuProduct` (`app/services/menu_product_service.py`), lalu membandingkannya dengan `subtotal_hpp` aktual untuk mendeteksi selisih stok bahan baku atau waste produksi.

- **Acceptance**:
  1. `analisis` pada response `get_accounting_report` menyertakan objek `hpp_variance` berisi `theoretical_hpp`, `actual_hpp`, `variance_nominal`, `variance_pct`, `matched_menu_count`, dan `unmatched_item_count`.
  2. Pencocokan produk mendukung pencocokan nama menu (`case-insensitive`) antara `IncomingTransactionItem.product_name` dan `MenuProduct.name` بدون menghasilkan N+1 query.
  3. Tetap aman (graceful fallback) apabila belum ada data `MenuProduct` atau `IncomingTransactionItem` pada periode tersebut.
- **Out of scope**: Sistem manajemen stok inventaris gudang penuh (stock opname fisik).

---

## Step 5 — Upgrade AI Financial CFO Analysis dengan Konteks Revenue & Profitabilitas

**Intent**: Memperbarui `_aggregate_financial_data`, `_build_prompt`, dan `_build_fallback_analysis` di `app/services/ai_analysis_service.py` agar AI CFO membaca data Pendapatan Bersih (`revenue_net`), Laba Kotor, Laba Bersih, Margin Laba, dan Rasio HPP terhadap Omset dari `get_accounting_report`, bukan hanya membaca pengeluaran secara terisolasi.

- **Acceptance**:
  1. `_aggregate_financial_data` menyertakan `revenue_gross`, `revenue_net`, `gross_profit`, `net_profit`, `gross_margin_pct`, `net_margin_pct`, dan `hpp_to_revenue_pct`.
  2. Prompt AI CFO di `_build_prompt` dan fallback deterministik di `_build_fallback_analysis` mengevaluasi pengeluaran secara proporsional terhadap omset dan profitabilitas.
  3. Struktur response `AiAnalysisResponse` tetap backwards-compatible dengan schema API yang ada.
- **Out of scope**: Mengubah provider LLM atau konfigurasi environment variable API key.

---

## Step 6 — Penyempurnaan Rekonsiliasi Mutasi Bank (ExpensePayment & Daily Batch Payout)

**Intent**: Memperbarui `preview_reconciliation` dan `apply_reconciliation` di `app/services/reconciliation_service.py` agar pencocokan mutasi Debit (`DB`) juga memeriksa pembayaran cicilan/DP/pelunasan tempo di tabel `ExpensePayment`, serta pencocokan mutasi Kredit (`CR`) mendukung agregasi payout harian per channel/metode bayar apabila pencocokan 1-lawan-1 per transaksi tidak ditemukan.

- **Acceptance**:
  1. Mutasi `DB` pada CSV rekening koran dapat mencocokkan record `ExpensePayment` (DP, termin, pelunasan tempo, reimbursement) berdasarkan tanggal dan nominal dalam toleransi hari.
  2. Mutasi `CR` memiliki fallback pencocokan akumulasi `net_received` harian per `order_type` / `payment_method` untuk menangkap settlement bulk harian platform/QRIS.
  3. Tidak ada regresi pada pencocokan 1-lawan-1 `IncomingTransaction` dan `Expense` yang sudah berjalan.
- **Out of scope**: Integrasi API mutasi bank otomatis (open banking webhook).

---

## Step 7 — Sinkronisasi UI AccountingTab & Export CSV SAK EMKM

**Intent**: Memperbarui `frontend/src/components/accounting/AccountingTab.tsx` dan `frontend/src/types/index.ts` agar menampilkan Aset Lancar Neraca berbasis saldo kas/bank cutoff, baris Laba Ditahan di Ekuitas, metrik Rasio terhadap Omset (`% Omset` vs `% Beban`), kartu Variansi HPP Teoritis vs Aktual, serta memperbarui fungsi Export CSV Akuntansi.

- **Acceptance**:
  1. Sub-tab Laba Rugi, Neraca, dan Analisis di `AccountingTab.tsx` menampilkan rasio `% Omset` (Gross/Net Margin, Food Cost % terhadap Revenue), Laba Ditahan, dan kartu HPP Teoritis vs Aktual secara jelas dan responsif.
  2. Semua state UI (loading, error, empty state) dan kontras warna mematuhi standar WCAG AA dan aturan anti-slop.
  3. Build TypeScript dan Vite (`npm run build` di `frontend/`) sukses tanpa error.
- **Out of scope**: Mengubah desain navigasi utama di luar tab Akuntansi.
