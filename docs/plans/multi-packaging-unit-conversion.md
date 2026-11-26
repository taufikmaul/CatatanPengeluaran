# Rencana Implementasi Multi-Kemasan Satuan, Konversi Otomatis, & Konfirmasi Draft Struk AI

Dokumen rencana implementasi untuk mendukung multi-varian kemasan bertingkat per `MasterItem` (contoh: `Karton -> Pouch/Kaleng -> Gram`), konversi otomatis satuan ecer dan satuan resep pada input form maupun AI foto struk (Telegram & Web `Scan Struk`), kalkulasi harga dasar resep dari `unit_price`, serta alur `DRAFT_WARNING` untuk konfirmasi di Web.

---

## Step 1 — Skema Database & Migrasi Multi-Kemasan + Snapshot Transaksi

**Intent**: Menambahkan model `MasterItemPackaging` pada `app/models/master_item.py` (relasi 1-ke-banyak dari `MasterItem`) untuk menyimpan opsi varian kemasan (`label`, `purchase_unit`, `retail_qty`, `retail_unit`, `base_qty`, `keywords`, `is_default`, `is_active`), serta menambahkan kolom snapshot konversi dan status review draft pada `Expense` di `app/models/expense.py` (`packaging_id`, `retail_qty`, `retail_unit`, `base_qty`, `base_unit`, `base_unit_price`, `review_status`, `review_warning`) beserta migrasi Alembic dan backfill varian default dari data `MasterItem` eksisting.

- **Acceptance**:
  1. Model `MasterItemPackaging` dan kolom baru `Expense` terdefinisi dengan type hints dan foreign key yang valid.
  2. Migrasi Alembic berjalan bersih (`upgrade` dan `downgrade`) serta melakukan backfill data `MasterItem` lama ke varian kemasan default tanpa menghilangkan data transaksi historis.
  3. Skema Pydantic di `app/api/schemas.py` mencakup payload varian kemasan dan snapshot/status review transaksi.
- **Out of scope**: Pembuatan tabel kartu stok, mutasi persediaan gudang, atau logika pemotongan stok produksi.

---

## Step 2 — Service Konversi Kemasan, Deteksi Ambiguitas, & Normalisasi Harga Resep

**Intent**: Mengimplementasikan resolver varian kemasan dan konversi bertingkat di `app/services/master_item_service.py`, `app/services/expense_service.py`, `app/services/menu_product_service.py`, dan `app/services/general_reports_service.py` agar setiap transaksi menyimpan snapshot `retail_qty`/`base_qty`, menghitung `base_unit_price` dari `unit_price`, menandai kasus ambigu/anomali harga sebagai `DRAFT_WARNING`, dan memastikan statistik harga terbaru & HPP hanya membaca transaksi `CONFIRMED` menggunakan `base_unit_price`.

- **Acceptance**:
  1. Pembelian via varian apa pun (misal Karton Pouch `8x2kg` vs Karton Kaleng `24x480g` vs Kaleng `480g`) terkonversi deterministik ke `retail_qty`/`retail_unit` dan `base_qty`/`base_unit` serta `base_unit_price` dari `unit_price`.
  2. Endpoint konfirmasi draft (`POST /api/expenses/{id}/confirm-unit`) mengubah kemasan/qty transaksi `DRAFT_WARNING` menjadi `CONFIRMED` dan memperbarui snapshot konversi.
  3. `get_master_items_latest_stats`, kalkulasi HPP `MenuProduct`, dan `general_reports_service` mengabaikan baris `DRAFT_WARNING` serta menormalisasi perbandingan harga per `base_unit`.
- **Out of scope**: Perhitungan stok fisik gudang atau penyelarasan `WarehouseReceivingPage`.

---

## Step 3 — Integrasi AI Struk Web (`POST /api/expenses/ocr`) & Hermes Telegram

**Intent**: Memperbarui pipeline ekstraksi AI di `app/services/ai_service.py`, `app/api/expenses.py` (`scan_expense_ocr`), dan `app/agent/hermes.py` agar hasil scan struk di Web maupun Telegram otomatis dicocokkan ke `MasterItemPackaging`, mengembalikan preview konversi ecer/resep serta flag warning jika ambigu/anomali harga, dan menyimpan transaksi struk Telegram bermasalah sebagai `DRAFT_WARNING` dengan notifikasi konfirmasi ke dashboard Web.

- **Acceptance**:
  1. `POST /api/expenses/ocr` mengembalikan `master_item_id`, `packaging_id`, hasil konversi (`retail_qty`, `retail_unit`, `base_qty`, `base_unit`, `base_unit_price`), dan `review_warning` jika terdeteksi ambiguitas atau anomali harga.
  2. Item foto struk Telegram yang ambigu/anomali tersimpan dengan `review_status = "DRAFT_WARNING"` dan Hermes mengirim pesan peringatan beserta tautan konfirmasi ke Web.
  3. Item struk yang cocok tegas tetap langsung berstatus `CONFIRMED` tanpa menambah friksi alur normal.
- **Out of scope**: Perubahan alur klasifikasi dan penyimpanan kategori `Tukar Cash` maupun `Ongkir`.

---

## Step 4 — UI Master Kemasan, Form Transaksi + Scan Struk Web, & Konfirmasi Draft

**Intent**: Memperbarui UI frontend pada `MasterItemsTab.tsx` (kelola banyak varian kemasan per item), `ExpenseFormDrawer.tsx`, `LedgerSummaryPanel.tsx`, dan `ExpenseMultiItemForm.tsx` (pilih varian kemasan, live preview ecer/resep + `Rp/base_unit` dari `unit_price`, serta integrasi hasil `Scan Struk (AI)` lengkap dengan highlight warning), dan menambahkan filter/aksi konfirmasi cepat transaksi `DRAFT_WARNING` di daftar pengeluaran Web (`ExpenseTable.tsx` / `ExpenseDetailModal.tsx`).

- **Acceptance**:
  1. User dapat menambah, mengubah, dan menghapus beberapa opsi varian kemasan di `MasterItemsTab.tsx` dengan preview rantai konversi yang jelas.
  2. Form input satuan tunggal, multi-item, dan hasil tombol `Scan Struk (AI)` di Web otomatis memuat varian kemasan terdeteksi, menampilkan konversi ecer/resep secara real-time, dan menyorot item ber-warning untuk dikonfirmasi sebelum simpan.
  3. Daftar pengeluaran menampilkan badge dan filter `Draft / Perlu Konfirmasi Kemasan` dengan aksi pilih varian dan konfirmasi dalam 1 dialog.
- **Out of scope**: Pembuatan halaman atau komponen kartu stok gudang.

---

## Step 5 — Pengujian End-to-End & Verifikasi Build

**Intent**: Memverifikasi keseluruhan alur dengan test `pytest` untuk konversi multi-kemasan, deteksi ambiguitas/anomali harga, isolasi HPP dari `DRAFT_WARNING`, endpoint `POST /api/expenses/ocr` dan `confirm-unit`, serta menjalankan type-check TypeScript (`tsc --noEmit`) dan build produksi Vite di `frontend/`.

- **Acceptance**:
  1. Seluruh suite test baru dan test regresi `pytest` terkait lulus tanpa skip atau assertion yang dilonggarkan.
  2. `npx tsc --noEmit` dan `npm run build` di `frontend/` selesai tanpa error.
- **Out of scope**: Deployment ke server produksi atau eksekusi migrasi pada database produksi.
