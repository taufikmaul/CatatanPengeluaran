# Rencana Redesign Form Input (Awwwards Editorial Craft & ReUI InputGroup)

Dokumen rencana arsitektur & UI/UX ini mendefinisikan langkah-langkah redesign menyeluruh pada seluruh form input di `frontend/src/components/` dengan standar **Awwwards Product Register (Restrained Editorial Craft)**, prinsip **Anti-Slop (during)**, serta komponen **ReUI InputGroup** dan **Shadcn Select / Searchable Combobox**.

## Ringkasan Prinsip & Target Desain

1. **Menghindari Desain Card dalam Card (Zero Nested Card)**:
   - Modal (`DialogContent` / `DrawerContent`) adalah satu-satunya permukaan kartu utama.
   - Dilarang membungkus grup field di dalam box berlapis (`rounded-2xl border bg-slate-50 p-4` di dalam modal).
   - Gunakan struktur **Editorial Hairline Ledger**: pemisah garis tipis (`border-t border-border/70 pt-4`), tipografi berjenjang, dan grid 2-kolom dengan divider vertikal (`lg:divide-x lg:divide-border/70`).
2. **Menghilangkan Seluruh "Pilihan Cepat" (Quick Pick Chips & Presets)**:
   - Hapus seluruh baris chip/preset yang memenuhi ruang vertikal form: `Pilihan cepat:`, `Pilih kurir:`, `Saran penyedia:`, `Paling sering:`, `Staf terdaftar:`, `Sering dibeli:`, `Belanja rutin:`, `Pilih cepat:`, `Tambah cepat:`, preset persentase DP (`20%`, `30%`, `50%`, `70%`), preset jatuh tempo (`+7 Hari`, `+14 Hari`, `+30 Hari`, `Akhir Bulan`), serta panel `Pilihan Cepat` di `DateRangePicker`.
3. **Lebih Simple & Clean (High Signal-to-Noise Ratio)**:
   - Rapatkan kerapatan visual, selaraskan tinggi kontrol (`h-9`), hilangkan badge dekoratif berlebih, dan ganti daftar baris yang tadinya berupa kartu bertumpuk menjadi baris tabel/hairline (`divide-y divide-border/60`).
4. **Standarisasi Dropdown Shadcn & Searchable Select (> 10 Opsi)**:
   - Ganti semua elemen native `<select>` dan `<datalist>` dengan komponen Shadcn.
   - Buat komponen terpadu `AdaptiveSelect` / `SearchableSelect`:
     - Jika jumlah opsi `<= 10` dan tidak butuh input kustom: render Shadcn `<Select>`.
     - Jika jumlah opsi `> 10` (atau dinamis seperti Kategori, Satuan, Master Item, Supplier, Kurir, Aset, COA, Rekening, User): otomatis render `<Popover>` + Search Input + Keyboard Navigation (Combobox / Autocomplete).
5. **Penggunaan ReUI `InputGroup` secara Proporsional (Tanpa Over-Icon)**:
   - Gunakan `InputGroup`, `InputGroupAddon`, `InputGroupText`, `InputGroupInput`, `InputGroupButton`, dan `InputGroupTextarea` dari [`frontend/src/components/ui/input-group.tsx`](file:///Users/taufik/Documents/Historycake/HCTeams/CatatanPengeluaran/frontend/src/components/ui/input-group.tsx) untuk semua input yang memiliki unit/affix kontekstual (`Rp`, `%`, `Bulan`, `Hari`, satuan, tombol aksi/kalkulator inline, atau clear button).
   - Input teks biasa (Nama Barang, Catatan, No. Invoice, SKU) tetap bersih tanpa ikon dekoratif di kiri/kanan.

---

## Step 1 — Design Foundation, Adaptive SearchableSelect & ReUI InputGroup Integration

**Intent**: Membangun fondasi komponen input terpadu (`SearchableSelect` / `AdaptiveSelect`) dengan ambang batas > 10 opsi otomatis menggunakan pencarian/autocomplete, memperbarui `InlineMathInput` agar berbasis ReUI `InputGroup`, serta membersihkan `DateRangePicker` dari opsi Pilihan Cepat.

**Target File**:
- `frontend/src/components/ui/searchable-select.tsx` (Baru)
- `frontend/src/components/ui/input-group.tsx`
- `frontend/src/components/forms/expense/InlineMathInput.tsx`
- `frontend/src/components/ui/date-range-picker.tsx`

**Detail Implementasi**:
- Buat komponen `SearchableSelect` (dan wrapper `AdaptiveSelect`) menggunakan Shadcn `Select` untuk `options.length <= 10` dan `Popover` + `InputGroup` search filter + keyboard navigation untuk `options.length > 10` atau mode `creatable`.
- Refactor `InlineMathInput` agar menggunakan `InputGroup` + `InputGroupAddon` (`Rp` atau unit) + `InputGroupInput` + `InputGroupText` untuk preview hasil kalkulasi rumus secara inline tanpa floating badge yang menutupi angka.
- Hapus dropdown & sidebar `Pilihan Cepat` pada `DateRangePicker` agar kalender tampil bersih dan ringkas.

**Acceptance Criteria**:
- `AdaptiveSelect` otomatis beralih ke mode searchable combobox ketika `options.length > 10` dan mendukung navigasi keyboard penuh (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).
- `InlineMathInput` merender `InputGroup` ReUI dengan addon teks (`Rp` / satuan) tanpa ikon berlebihan.
- `DateRangePicker` tidak lagi menampilkan sidebar atau dropdown "Pilihan Cepat".
- **Out of scope**: Mengubah skema API backend atau format tanggal ISO yang dikirim ke server.

---

## Step 2 — Refactor ExpenseFormDrawer & LedgerSummaryPanel (Single Expense Form)

**Intent**: Merombak form input pengeluaran utama (`ExpenseFormDrawer` dan `LedgerSummaryPanel`) untuk menghilangkan nested card, menghapus seluruh chip Pilihan Cepat, menerapkan `InputGroup` ReUI pada input nominal/kuantitas/durasi, dan mengganti seluruh `<select>`/`<datalist>` dengan Shadcn `AdaptiveSelect` / `SearchableSelect`.

**Target File**:
- `frontend/src/components/forms/ExpenseFormDrawer.tsx`
- `frontend/src/components/forms/expense/LedgerSummaryPanel.tsx`
- `frontend/src/lib/categoryFormConfig.ts`

**Detail Implementasi**:
- Hilangkan rail pill kategori di header drawer dan seluruh chip di bawah input (`quickItemChips`, `quickSupplierChips`, `Pilih kurir`, `Staf terdaftar`, `Paling sering`, `metaField1Chips`, `metaField2Chips`, preset `%` DP, dan preset jatuh tempo `+7/+14/+30 Hari`).
- Hilangkan container `rounded-2xl border bg-slate-50` di dalam form (panel `LedgerSummaryPanel`, box metadata kategori, box inventaris aset, box maintenance, box DP, dan box jatuh tempo). Ganti dengan layout 2-kolom dengan hairline divider (`lg:divide-x lg:divide-slate-200`) dan section divider (`border-t border-slate-200/70 pt-4`).
- Ganti seluruh native `<select>` dan `<datalist>` (Kategori Pengeluaran, Satuan, Metode Bayar, Status Pembayaran, Rekening Sumber, Pilih Unit Aset, Penginput User, Kurir Ongkir) dengan `AdaptiveSelect` / `SearchableSelect`.
- Gunakan ReUI `InputGroup` dengan `InputGroupText` untuk harga (`Rp`), pajak (`Rp` + `InputGroupButton` `+11%`), masa garansi (`Bulan`), masa manfaat (`Bulan`), dan persentase DP (`%`).

**Acceptance Criteria**:
- Tidak ada satupun elemen `<select>` atau `<datalist>` native yang tersisa di `ExpenseFormDrawer.tsx` dan `LedgerSummaryPanel.tsx`.
- Tidak ada lagi chip "Pilihan cepat", "Saran penyedia", "Paling sering", atau preset jatuh tempo/DP.
- Struktur form bebas dari card-in-card dan menggunakan pemisah hairline yang bersih.
- **Out of scope**: Mengubah logika perhitungan pajak, DP, atau payload penyimpanan transaksi pengeluaran.

---

## Step 3 — Refactor ExpenseMultiItemForm & PurchaseRequestDrawer (Multi-Item & Procurement Forms)

**Intent**: Menyederhanakan form multi-item nota (`ExpenseMultiItemForm`) dan form pengajuan belanja (`PurchaseRequestDrawer`) menjadi layout daftar hairline yang bersih tanpa nested card, tanpa chip pilihan cepat, dengan ReUI `InputGroup` dan Shadcn `AdaptiveSelect`.

**Target File**:
- `frontend/src/components/forms/expense/ExpenseMultiItemForm.tsx`
- `frontend/src/components/forms/PurchaseRequestDrawer.tsx`

**Detail Implementasi**:
- Pada `ExpenseMultiItemForm`:
  - Hapus `quickItemChips` per baris dan tombol shortcut `+ Tambah baris kategori lain:` di bawah tabel.
  - Hilangkan box luar berlapis pada header nota dan footer biaya tambahan; gunakan struktur daftar baris hairline (`divide-y divide-slate-200/70`).
  - Ganti `<select>` Kategori Baris (> 10 opsi), Satuan (> 10 opsi), Metode Bayar, Status Pembayaran, dan Penginput dengan `AdaptiveSelect` / `SearchableSelect`.
  - Gunakan `InputGroup` ReUI pada input Ongkir, Pajak (dengan `InputGroupButton` `+11%`), Biaya Lain, dan Diskon.
- Pada `PurchaseRequestDrawer`:
  - Hapus `Sering dibeli:` (`quickAddChips`) dan `Belanja rutin:` (`usableRecentRequests`).
  - Hilangkan box `bg-amber-50/70 border-amber-200 rounded-2xl` yang membungkus input pencarian; jadikan bar `InputGroup` langsung dengan `InputGroupAddon` pencarian dan `InputGroupButton` `Tambah`.
  - Ganti `<select>` Kategori dan Satuan pada tiap baris daftar belanja serta qty stepper dengan `AdaptiveSelect` dan `InputGroup`.

**Acceptance Criteria**:
- `ExpenseMultiItemForm` dan `PurchaseRequestDrawer` bebas dari native `<select>` dan bebas dari chip "Sering dibeli" / "Belanja rutin" / "quickItemChips".
- Baris item menggunakan tata letak tabular/hairline yang ringkas tanpa kartu di dalam kartu.
- **Out of scope**: Mengubah parser `parseInlineQtyAndUnit` atau struktur state daftar belanja.

---

## Step 4 — Refactor MenuFormDialog (Studio Resep, HPP & Bundling)

**Intent**: Merapikan `MenuFormDialog` dengan menghapus seluruh kartu bersarang (`IngredientRowCard`, `Section 2 Packaging box`, `Section 3 Batch Cost box`, `Identity box`, `Telemetry cards`), menghapus chip `Pilih cepat:` dan `Tambah cepat:`, serta menerapkan `AdaptiveSelect` dan ReUI `InputGroup`.

**Target File**:
- `frontend/src/components/menu/MenuFormDialog.tsx`
- `frontend/src/components/menu/RecipeQuickAddAutocomplete.tsx`

**Detail Implementasi**:
- Hapus chip `Pilih cepat:` (master kategori menu) dan `Tambah cepat:` (`BATCH_COST_PRESETS`).
- Ubah `IngredientRowCard` dan baris `batchCostRows` dari kartu berbingkai (`rounded-xl border p-3 bg-white shadow-2xs`) menjadi baris datar dengan pemisah hairline (`divide-y divide-slate-200/70 py-2.5`).
- Hilangkan kartu pembungkus pada panel kiri (Tipe Item, Identitas Menu, Hasil Batch & Susut, Kemasan, Labor & Operasional, Status) dan panel kanan (Telemetry HPP & Pricing) sehingga menjadi dua kolom studio bersih dengan hairline divider.
- Ganti semua `<select>` dan `<datalist>` (`Kategori Menu`, `Satuan Utama`, `Satuan Hasil Batch`, `Cara Penyimpanan`, `Jenis Biaya`, `Sumber Perhitungan HPP`, dan satuan bahan) dengan `AdaptiveSelect` / `SearchableSelect`.
- Gunakan ReUI `InputGroup` dengan `InputGroupText` untuk input `Hasil 1 Batch` (addon satuan), `Susut Masak` (`%`), `Masa Simpan` (`Hari`), `Biaya per Batch` (`Rp`), `Harga Jual` (`Rp`), `Target Food Cost` (`%`), dan `HPP Manual` (`Rp`).

**Acceptance Criteria**:
- `MenuFormDialog.tsx` tidak lagi memiliki kartu di dalam kartu pada daftar bahan, kemasan, biaya batch, maupun panel kanan HPP.
- Seluruh chip "Pilih cepat" dan "Tambah cepat" telah dihapus.
- Semua dropdown menggunakan komponen Shadcn (`Select` untuk <= 10 opsi, `SearchableSelect` untuk > 10 opsi seperti Kategori Menu dan Satuan).
- **Out of scope**: Mengubah rumus kalkulasi `effectiveHpp`, `foodCostPct`, atau validasi bundling.

---

## Step 5 — Refactor Transaksi Masuk, DP Payment, Budget & Master/Config Forms

**Intent**: Menyelaraskan seluruh modal dan form pendukung (`IncomingTransactionFormModal`, `DpPaymentModal`, `BudgetSetupDialog`, `MasterItemsTab`, `MasterDataSection`, `BankAccountSection`) agar bebas dari nested card, bebas dari tombol preset cepat, menggunakan Shadcn `AdaptiveSelect`, dan ReUI `InputGroup`.

**Target File**:
- `frontend/src/components/incoming/IncomingTransactionFormModal.tsx`
- `frontend/src/components/unpaid/DpPaymentModal.tsx`
- `frontend/src/components/dashboard/BudgetSetupDialog.tsx`
- `frontend/src/components/master/MasterItemsTab.tsx`
- `frontend/src/components/config/MasterDataSection.tsx`
- `frontend/src/components/config/BankAccountSection.tsx`

**Detail Implementasi**:
- `IncomingTransactionFormModal`:
  - Hilangkan 3 box `p-3.5 rounded-xl border bg-slate-50` di dalam dialog; ganti dengan section hairline.
  - Ganti `<Input list="...">` (`Tipe Order`, `Metode Pembayaran`) dan `<select>` (`Rekening Bank Tujuan`, `Status Transaksi`) dengan `AdaptiveSelect` / `SearchableSelect` (mendukung opsi kustom).
  - Bungkus `Penjualan Kotor`, `Diskon Penjualan`, dan `Fee Platform` dengan ReUI `InputGroup` (`Rp`).
- `DpPaymentModal`:
  - Hapus tombol preset `20%`, `30%`, `50%`, `70%` (`DP_PRESET_PERCENTS`) dan tombol preset jatuh tempo (`+7 Hari`, `+14 Hari`, `+30 Hari`, `Akhir Bulan`).
  - Hilangkan nested box berwarna (`bg-amber-50`, `bg-rose-50`, preview box berlapis) di dalam dialog.
  - Ganti `<select>` `Metode Pembayaran` dan `Rekening Sumber Dana` dengan `AdaptiveSelect`, serta gunakan `InputGroup` (`%` dan `Rp`).
- `BudgetSetupDialog`:
  - Hapus baris `Tambah Cepat: +1 Jt, +5 Jt, +10 Jt`.
  - Hilangkan nested card `bg-emerald-50/60 border-emerald-200` di dalam modal; gunakan `InputGroup` dengan addon `Rp` dan `%`.
- `MasterItemsTab`, `MasterDataSection`, `BankAccountSection`:
  - Ganti semua native `<select>` (`Kategori`, `Tipe Satuan`, `Satuan Beli`, `Satuan Eceran`, `Satuan Resep`, `Kelompok Akun`, `Masuk ke Laporan`, `Tipe Akun`, `Kode Akun COA`) dengan `AdaptiveSelect` / `SearchableSelect`.
  - Hilangkan box dalam modal (`Konfigurasi Satuan Resep`, `Pemetaan Akuntansi Standar`) menjadi section berbatas hairline (`border-t pt-4`).
  - Hapus chip `SUGGESTED_POS_CHANNELS` di `BankAccountSection` atau ubah menjadi multi-select / input bersih menggunakan `InputGroup`.

**Acceptance Criteria**:
- Tidak ada native `<select>` atau `<datalist>` di keenam file form tersebut.
- Tidak ada tombol preset "Tambah Cepat" atau preset persentase/jatuh tempo di `DpPaymentModal` dan `BudgetSetupDialog`.
- Semua input nominal/persentase menggunakan ReUI `InputGroup` dan bebas dari desain card-in-card.
- **Out of scope**: Mengubah tabel daftar utama di luar form/dialog.

---

## Step 6 — Verification, Accessibility Audit & Anti-Slop Delivery Gate

**Intent**: Memverifikasi kompilasi TypeScript, build produksi Vite, konsistensi dark/light mode, kontras WCAG AA, navigasi keyboard pada seluruh `AdaptiveSelect` dan `InputGroup`, serta menjalankan pemeriksaan Anti-Slop Delivery Gate.

**Target File**:
- Seluruh file form di `frontend/src/components/`

**Detail Implementasi**:
- Jalankan `npm run build` (`tsc && vite build`) di direktori `frontend/` untuk memastikan tidak ada type error, unused import (seperti array preset yang dihapus), atau broken prop.
- Audit visual & interaksi pada browser untuk memastikan tidak ada horizontal overflow pada mobile (320px–1920px), semua dropdown > 10 item memiliki fitur search yang berfungsi dengan keyboard, dan tidak ada nested card yang tersisa.

**Acceptance Criteria**:
- `npm run build` di `frontend/` lulus dengan exit code 0 tanpa error TypeScript.
- `grep` untuk `Pilihan cepat`, `Pilih cepat`, `Tambah cepat`, `Sering dibeli`, dan `<select` pada komponen form yang di-redesign menghasilkan 0 temuan.
- Seluruh kriteria Anti-Slop Delivery Gate (R-01 s/d R-38) berstatus PASS.
