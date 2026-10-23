import React, { useEffect, useState, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { Expense, ExpenseFormData, ItemSuggestion, OcrExtractedItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/formatters";
import { scanExpenseOcr } from "@/lib/api";
import {
  Sparkles,
  CalendarClock,
  Store,
  Camera,
  UploadCloud,
  FileText,
  ScanLine,
  Loader2,
  CheckCircle2,
  Receipt,
  FileSearch,
} from "lucide-react";

interface ExpenseFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ExpenseFormData, expenseId?: number) => void;
  onBatchSubmit?: (items: ExpenseFormData[]) => void;
  categories: string[];
  initialData?: Expense | null;
  repeatData?: Expense | null;
  isSubmitting?: boolean;
  itemSuggestions?: ItemSuggestion[];
  supplierSuggestions?: string[];
}

export const ExpenseFormDrawer: React.FC<ExpenseFormDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onBatchSubmit,
  categories,
  initialData,
  repeatData,
  isSubmitting = false,
  itemSuggestions = [],
  supplierSuggestions = [],
}) => {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    defaultValues: {
      expense_date: new Date().toISOString().split("T")[0],
      supplier: "-",
      item_name: "",
      qty: 1,
      category: "Bahan Kue",
      unit_price: 0,
      tax: 0,
      discount: 0,
      total_price: 0,
      pay_method: "Transfer",
      pay_status: "Lunas",
      due_date: "-",
      notes: "-",
      invoice_number: "-",
      is_reimbursement: false,
    },
  });

  const [activeTab, setActiveTab] = useState<"form" | "ocr">("form");
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);
  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrSuccessBanner, setOcrSuccessBanner] = useState<string | null>(null);
  const [ocrExtractedItems, setOcrExtractedItems] = useState<OcrExtractedItem[]>([]);
  const [selectedOcrIndex, setSelectedOcrIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedSuggestionHint, setSelectedSuggestionHint] = useState<ItemSuggestion | null>(null);

  const itemNameVal = watch("item_name") || "";
  const supplierVal = watch("supplier") || "";
  const qty = watch("qty") || 0;
  const unitPrice = watch("unit_price") || 0;
  const tax = watch("tax") || 0;
  const discount = watch("discount") || 0;
  const payStatus = watch("pay_status") || "Lunas";

  // Filter suggestions based on input
  const filteredItemSuggestions = useMemo(() => {
    const q = itemNameVal.trim().toLowerCase();
    if (!q) return itemSuggestions.slice(0, 8);
    return itemSuggestions
      .filter(
        (s) =>
          s.item_name.toLowerCase().includes(q) ||
          (s.aliases && s.aliases.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [itemNameVal, itemSuggestions]);

  // Auto-calculate total price when components change
  useEffect(() => {
    const calc = Number(qty) * Number(unitPrice) + Number(tax) - Number(discount);
    setValue("total_price", Math.max(0, calc));
  }, [qty, unitPrice, tax, discount, setValue]);

  // Set form values when editing or repeating an order
  useEffect(() => {
    setSelectedSuggestionHint(null);
    setActiveTab("form");
    setOcrFile(null);
    setOcrPreview(null);
    setOcrError(null);
    setOcrSuccessBanner(null);
    setOcrExtractedItems([]);
    setSelectedOcrIndex(0);

    if (initialData) {
      reset({
        expense_date: initialData.expense_date,
        supplier: initialData.supplier || "-",
        item_name: initialData.item_name || "",
        qty: initialData.qty || 1,
        category: initialData.category || categories[0] || "Bahan Kue",
        unit_price: initialData.unit_price || 0,
        tax: initialData.tax || 0,
        discount: initialData.discount || 0,
        total_price: initialData.total_price || 0,
        pay_method: initialData.pay_method || "Transfer",
        pay_status: initialData.pay_status || "Lunas",
        due_date: initialData.due_date || "-",
        notes: initialData.notes || "-",
        invoice_number: initialData.invoice_number || "-",
        is_reimbursement: Boolean(initialData.is_reimbursement),
      });
    } else if (repeatData) {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: repeatData.supplier || "-",
        item_name: repeatData.item_name || "",
        qty: repeatData.qty || 1,
        category: repeatData.category || categories[0] || "Bahan Kue",
        unit_price: repeatData.unit_price || 0,
        tax: repeatData.tax || 0,
        discount: repeatData.discount || 0,
        total_price: repeatData.total_price || 0,
        pay_method: repeatData.pay_method || "Transfer",
        pay_status: "Lunas",
        due_date: "-",
        notes: "-",
        invoice_number: "-",
        is_reimbursement: Boolean(repeatData.is_reimbursement),
      });
    } else {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: "-",
        item_name: "",
        qty: 1,
        category: categories[0] || "Bahan Kue",
        unit_price: 0,
        tax: 0,
        discount: 0,
        total_price: 0,
        pay_method: "Transfer",
        pay_status: "Lunas",
        due_date: "-",
        notes: "-",
        invoice_number: "-",
        is_reimbursement: false,
      });
    }
  }, [initialData, repeatData, reset, categories, isOpen]);

  const handleSelectSuggestion = (s: ItemSuggestion) => {
    setValue("item_name", s.item_name, { shouldValidate: true });
    if (s.category && categories.includes(s.category)) {
      setValue("category", s.category);
    }
    if (s.last_supplier && s.last_supplier !== "-" && (!supplierVal || supplierVal === "-")) {
      setValue("supplier", s.last_supplier);
    }
    if (s.last_unit_price > 0 && (!unitPrice || Number(unitPrice) === 0)) {
      setValue("unit_price", s.last_unit_price);
    }
    setSelectedSuggestionHint(s);
    setShowItemDropdown(false);
  };

  const applyExtractedItemToForm = (item: OcrExtractedItem) => {
    if (item.barang) setValue("item_name", item.barang, { shouldValidate: true });
    if (item.qty) setValue("qty", Number(item.qty));
    if (item.harga_satuan) setValue("unit_price", Number(item.harga_satuan));
    if (item.tax !== undefined) setValue("tax", Number(item.tax));
    if (item.diskon !== undefined) setValue("discount", Number(item.diskon));
    if (item.total_harga) setValue("total_price", Number(item.total_harga));
    if (item.toko_supplier) setValue("supplier", item.toko_supplier);
    if (item.tanggal) setValue("expense_date", item.tanggal);
    if (item.kategori && categories.includes(item.kategori)) {
      setValue("category", item.kategori);
    }
    if (item.metode_bayar) setValue("pay_method", item.metode_bayar);
    if (item.status_pembayaran) setValue("pay_status", item.status_pembayaran);
    if (item.no_invoice && item.no_invoice !== "-") {
      setValue("invoice_number", item.no_invoice);
    }
    if (item.is_reimbursement !== undefined) {
      setValue("is_reimbursement", Boolean(item.is_reimbursement));
    }
    if (item.keterangan && item.keterangan !== "-") {
      setValue("notes", item.keterangan);
    }
  };

  const handleFileSelect = (file: File) => {
    setOcrFile(file);
    setOcrError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setOcrPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleScanOcr = async () => {
    if (!ocrFile) return;
    setIsScanningOcr(true);
    setOcrError(null);
    try {
      const res = await scanExpenseOcr(ocrFile);
      if (res.ok && res.items && res.items.length > 0) {
        setOcrExtractedItems(res.items);
        setSelectedOcrIndex(0);
        applyExtractedItemToForm(res.items[0]);
        setActiveTab("form");
        setOcrSuccessBanner(
          `Berhasil membaca ${res.items.length} item dari struk! Silakan periksa rincian data lalu simpan.`
        );
      } else {
        setOcrError(res.message || "Gagal membaca struk/nota. Pastikan gambar jelas dan tidak terpotong.");
      }
    } catch (err: any) {
      setOcrError(err.response?.data?.detail || "Gagal memproses gambar struk via AI.");
    } finally {
      setIsScanningOcr(false);
    }
  };

  const handleFormSubmit = (data: ExpenseFormData) => {
    onSubmit(data, initialData ? initialData.id : undefined);
    onClose();
  };

  const handleBatchSaveAll = () => {
    if (!onBatchSubmit || ocrExtractedItems.length === 0) return;
    const currentExpenseDate = watch("expense_date") || new Date().toISOString().split("T")[0];
    const currentSupplier = watch("supplier") || "-";
    const currentCategory = watch("category") || "Bahan Kue";
    const currentPayMethod = watch("pay_method") || "Transfer";
    const currentPayStatus = watch("pay_status") || "Lunas";
    const currentDueDate = watch("due_date") || "-";
    const currentNotes = watch("notes") || "-";
    const currentInvoice = watch("invoice_number") || "-";
    const currentIsReimb = watch("is_reimbursement") || false;

    const batch: ExpenseFormData[] = ocrExtractedItems.map((it) => {
      const qty = Number(it.qty || 1);
      const unitPrice = Number(it.harga_satuan || 0);
      const tax = Number(it.tax || 0);
      const discount = Number(it.diskon || 0);
      const tot = Number(it.total_harga || 0);
      const totalPrice = tot > 0 ? tot : (qty * unitPrice) + tax - discount;

      return {
        expense_date: it.tanggal || currentExpenseDate,
        supplier: it.toko_supplier || currentSupplier,
        item_name: it.barang || "Barang",
        qty,
        category: (it.kategori && categories.includes(it.kategori)) ? it.kategori : currentCategory,
        unit_price: unitPrice,
        tax,
        discount,
        total_price: totalPrice,
        pay_method: it.metode_bayar || currentPayMethod,
        pay_status: it.status_pembayaran || currentPayStatus,
        due_date: currentDueDate,
        notes: (it.keterangan && it.keterangan !== "-") ? it.keterangan : currentNotes,
        invoice_number: (it.no_invoice && it.no_invoice !== "-") ? it.no_invoice : currentInvoice,
        is_reimbursement: it.is_reimbursement !== undefined ? Boolean(it.is_reimbursement) : currentIsReimb,
      };
    });

    onBatchSubmit(batch);
    onClose();
  };

  const calculatedTotal = watch("total_price");
  const isUnpaid = payStatus.toLowerCase().includes("belum") || payStatus.toLowerCase().includes("hutang");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span>🎂</span>
            {initialData
              ? "Edit Catatan Pengeluaran"
              : repeatData
              ? `Beli Lagi: ${repeatData.item_name}`
              : "Tambah Catatan Pengeluaran"}
          </DialogTitle>
        </DialogHeader>

        {/* Mode Switcher (Manual Form vs OCR Scan) - Only when adding fresh new expense */}
        {!initialData && !repeatData && (
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl mb-3">
            <button
              type="button"
              onClick={() => setActiveTab("form")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
                activeTab === "form"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Input Form Manual</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ocr")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
                activeTab === "ocr"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Scan Nota / Struk (OCR)</span>
              <span className="bg-amber-400 text-slate-900 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                AI
              </span>
            </button>
          </div>
        )}

        {/* OCR SCAN VIEW */}
        {activeTab === "ocr" && !initialData && !repeatData ? (
          <div className="space-y-4 py-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileSelect(e.dataTransfer.files[0]);
                }
              }}
              className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/30 rounded-2xl p-6 text-center cursor-pointer transition-all"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0]);
                  }
                }}
              />

              {ocrPreview ? (
                <div className="space-y-3">
                  <div className="relative mx-auto max-w-[200px] max-h-48 overflow-hidden rounded-xl border border-slate-200 shadow-sm bg-white">
                    <img
                      src={ocrPreview}
                      alt="Pratinjau Nota"
                      className="w-full h-auto object-contain"
                    />
                  </div>
                  <p className="text-xs font-medium text-slate-700">
                    {ocrFile?.name} ({(Number(ocrFile?.size) / 1024).toFixed(1)} KB)
                  </p>
                  <span className="text-[11px] text-blue-600 hover:underline">
                    Klik untuk ganti foto
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
                    <Camera className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-800">
                    Foto Struk atau Unggah Gambar Nota
                  </h4>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Ambil foto langsung dari ponsel atau pilih file gambar (JPG, PNG, WEBP). AI akan mengekstrak barang, harga, toko, tanggal, & invoice otomatis.
                  </p>
                </div>
              )}
            </div>

            {ocrError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {ocrError}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveTab("form")}
                className="rounded-xl text-xs h-10 px-4"
              >
                Kembali ke Form
              </Button>
              <Button
                type="button"
                disabled={!ocrFile || isScanningOcr}
                onClick={handleScanOcr}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-10 px-5 font-semibold gap-1.5"
              >
                {isScanningOcr ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Menganalisis Struk...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Pindai dengan AI</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* MANUAL / REVIEW FORM VIEW */
          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            {/* Banner saat berhasil OCR */}
            {ocrSuccessBanner && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-emerald-800">
                  <p className="font-semibold">{ocrSuccessBanner}</p>
                  {ocrExtractedItems.length > 1 && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[11px] text-emerald-700 block font-medium">
                        Pilih item dari struk untuk dimuat ke form:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {ocrExtractedItems.map((it, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSelectedOcrIndex(idx);
                              applyExtractedItemToForm(it);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                              selectedOcrIndex === idx
                                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                : "bg-white text-emerald-900 border-emerald-200 hover:bg-emerald-100"
                            }`}
                          >
                            {it.barang || `Item #${idx + 1}`} ({formatRupiah(Number(it.total_harga || 0))})
                          </button>
                        ))}
                      </div>

                      {onBatchSubmit && (
                        <div className="mt-2.5 pt-2 border-t border-emerald-200/80 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-emerald-700">
                            Total {ocrExtractedItems.length} item terbaca di nota ini.
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            disabled={isSubmitting}
                            onClick={handleBatchSaveAll}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs h-8 px-3 shadow-sm font-semibold flex items-center gap-1.5"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Simpan Semua ({ocrExtractedItems.length} Item)</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Tanggal Nota
                </label>
                <Input
                  type="date"
                  {...register("expense_date", { required: true })}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Kategori
                </label>
                <select
                  {...register("category")}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium focus:ring-2 focus:ring-blue-500"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Nama Barang + Autocomplete Master Item & Histori */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">
                  Nama Barang / Keperluan *
                </label>
                {selectedSuggestionHint && selectedSuggestionHint.last_unit_price > 0 && (
                  <button
                    type="button"
                    onClick={() => setValue("unit_price", selectedSuggestionHint.last_unit_price)}
                    className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                  >
                    <Sparkles className="w-3 h-3" />
                    Harga terakhir: {formatRupiah(selectedSuggestionHint.last_unit_price)}
                  </button>
                )}
              </div>
              <Input
                placeholder="Ketik atau pilih dari Master Item (mis: Tepung Terigu Cakra)"
                autoComplete="off"
                {...register("item_name", { required: "Nama barang wajib diisi" })}
                onFocus={() => setShowItemDropdown(true)}
                onBlur={() => setTimeout(() => setShowItemDropdown(false), 180)}
                className="h-10 text-xs rounded-xl"
              />
              {errors.item_name && (
                <span className="text-[11px] text-red-500">{errors.item_name.message}</span>
              )}

              {/* Dropdown Autocomplete */}
              {showItemDropdown && filteredItemSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {filteredItemSuggestions.map((s) => (
                    <button
                      key={`${s.item_name}-${s.is_master}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(s);
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 transition-colors flex items-center justify-between group"
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-600">
                            {s.item_name}
                          </span>
                          {s.is_master && (
                            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[10px] px-1.5 py-0 h-4">
                              Master
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {s.category} {s.last_supplier !== "-" ? `• ${s.last_supplier}` : ""}
                        </span>
                      </div>
                      {s.last_unit_price > 0 && (
                        <div className="text-right">
                          <span className="text-xs font-bold text-slate-700 block">
                            {formatRupiah(s.last_unit_price)}
                          </span>
                          <span className="text-[10px] text-slate-400">harga satuan</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Toko / Supplier */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Toko / Supplier
              </label>
              <Input
                placeholder="mis: Toko Roti Makmur, Super Indo, atau -"
                {...register("supplier")}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            {/* No. Invoice / Nota & Checkbox Reimbursement */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  No. Invoice / Nota
                </label>
                <Input
                  placeholder="mis: INV-2026/10/012 atau -"
                  {...register("invoice_number")}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Tipe Transaksi
                </label>
                <label className="flex items-center gap-2.5 h-10 px-3 rounded-xl border border-input bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    {...register("is_reimbursement")}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                  />
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <span>💼</span>
                    <span>Reimbursement (Ditalangi)</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Qty & Harga Satuan */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Qty / Jumlah
                </label>
                <Input
                  type="number"
                  step="any"
                  {...register("qty", { required: true, valueAsNumber: true })}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Harga Satuan (Rp)
                </label>
                <Input
                  type="number"
                  step="any"
                  {...register("unit_price", { required: true, valueAsNumber: true })}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>

            {/* Tax & Diskon */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Pajak / Biaya Layanan (Rp)
                </label>
                <Input
                  type="number"
                  step="any"
                  {...register("tax", { valueAsNumber: true })}
                  className="h-9 text-xs rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Diskon / Potongan (Rp)
                </label>
                <Input
                  type="number"
                  step="any"
                  {...register("discount", { valueAsNumber: true })}
                  className="h-9 text-xs rounded-xl"
                />
              </div>
            </div>

            {/* Calculated Total Highlight Box */}
            <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-2xl flex items-center justify-between">
              <span className="text-xs font-medium text-blue-900">Total Pengeluaran</span>
              <span className="text-base font-bold text-blue-700 tabular-nums">
                {formatRupiah(calculatedTotal)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Metode Bayar
                </label>
                <select
                  {...register("pay_method")}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium"
                >
                  <option value="Transfer">Transfer</option>
                  <option value="Tunai">Tunai</option>
                  <option value="QRIS">QRIS</option>
                  <option value="Debit">Debit</option>
                  <option value="Kredit">Kartu Kredit</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Status Pembayaran
                </label>
                <select
                  {...register("pay_status")}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium"
                >
                  <option value="Lunas">Lunas</option>
                  <option value="Belum Lunas">Belum Lunas (Hutang)</option>
                </select>
              </div>
            </div>

            {/* Jatuh Tempo (Tampil menonjol saat Belum Lunas) */}
            {isUnpaid && (
              <div className="p-3 bg-rose-50/60 border border-rose-200/80 rounded-2xl">
                <label className="text-xs font-semibold text-rose-800 flex items-center gap-1.5 mb-1.5">
                  <CalendarClock className="w-3.5 h-3.5 text-rose-600" />
                  Tanggal Jatuh Tempo Tagihan (untuk Reminder Otomatis)
                </label>
                <Input
                  type="date"
                  {...register("due_date")}
                  className="h-9 text-xs rounded-xl bg-white border-rose-200"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Catatan Tambahan
              </label>
              <Input
                placeholder="Keterangan pengeluaran..."
                {...register("notes")}
                className="h-10 text-xs rounded-xl"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="rounded-xl text-xs h-10 px-4"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-10 px-5 font-semibold"
              >
                {isSubmitting ? "Menyimpan..." : initialData ? "Simpan Perubahan" : "Tambah Catatan"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
