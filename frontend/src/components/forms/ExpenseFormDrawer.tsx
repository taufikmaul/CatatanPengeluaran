import React, { useEffect, useState, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { Expense, ExpenseFormData, ExpenseUser, ItemSuggestion, OcrExtractedItem } from "@/types";
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
import { scanExpenseOcr, getExpenseUsers, checkInvoiceDuplicate } from "@/lib/api";
import {
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
  ExternalLink,
  Clock,
  Check,
  Briefcase,
  Package,
  ShoppingBag,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { getCategoryFormProfile } from "@/lib/categoryFormConfig";
import { LedgerSummaryPanel, IsolatedStickyFooter } from "./expense/LedgerSummaryPanel";
import { ExpenseMultiItemForm } from "./expense/ExpenseMultiItemForm";

interface ExpenseFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ExpenseFormData, expenseId?: number) => void;
  onBatchSubmit?: (items: ExpenseFormData[]) => void;
  categories: string[];
  defaultCategory?: string;
  paymentMethods?: string[];
  units?: string[];
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
  defaultCategory,
  paymentMethods = ["Tunai", "Transfer", "QRIS", "Debit", "Kredit"],
  units = [
    "Pcs", "Box", "Bungkus", "Pack", "Pouch", "Kg", "Gram", "Dus",
    "Kaleng", "Sak", "Bal", "Botol", "Tray", "Liter", "Roll", "Lembar",
    "Meter", "Ikat", "Butir", "Trans", "Trip"
  ],
  initialData,
  repeatData,
  isSubmitting = false,
  itemSuggestions = [],
  supplierSuggestions = [],
}) => {
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    defaultValues: {
      expense_date: new Date().toISOString().split("T")[0],
      supplier: "-",
      item_name: "",
      qty: 1,
      unit: "Pcs",
      category: "Bahan Kue",
      unit_price: 0,
      shipping_fee: 0,
      tax: 0,
      other_fee: 0,
      discount: 0,
      total_price: 0,
      pay_method: "Transfer",
      pay_status: "Lunas",
      due_date: "-",
      notes: "-",
      invoice_number: "-",
      is_reimbursement: false,
      msg_link: "Web Dashboard",
      user_id: null,
      master_item_id: null,
    },
  });

  const [usersList, setUsersList] = useState<ExpenseUser[]>([]);

  useEffect(() => {
    if (isOpen) {
      getExpenseUsers().then((res) => {
        if (Array.isArray(res)) setUsersList(res);
      }).catch(() => {});
    }
  }, [isOpen]);

  const [activeTab, setActiveTab] = useState<"form" | "multi" | "ocr">("form");
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);
  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrSuccessBanner, setOcrSuccessBanner] = useState<string | null>(null);
  const [ocrExtractedItems, setOcrExtractedItems] = useState<OcrExtractedItem[]>([]);
  const [selectedOcrIndex, setSelectedOcrIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [selectedSuggestionHint, setSelectedSuggestionHint] = useState<ItemSuggestion | null>(null);
  const [invoiceWarning, setInvoiceWarning] = useState<string | null>(null);

  const handleCheckInvoice = async (inv: string) => {
    if (!inv || inv.trim() === "-" || inv.trim().length < 3) {
      setInvoiceWarning(null);
      return;
    }
    try {
      const res = await checkInvoiceDuplicate(inv, initialData?.id);
      if (res.is_duplicate && res.message) {
        setInvoiceWarning(res.message);
      } else {
        setInvoiceWarning(null);
      }
    } catch {
      setInvoiceWarning(null);
    }
  };

  const itemNameVal = watch("item_name") || "";
  const supplierVal = watch("supplier") || "";
  const categoryVal = watch("category") || "";
  const catProfile = useMemo(() => getCategoryFormProfile(categoryVal), [categoryVal]);
  const isOngkir = catProfile.archetype === "ongkir";
  const isTukarCash = catProfile.archetype === "tukar_cash";
  const isPayroll = catProfile.archetype === "payroll";
  const msgLinkVal = watch("msg_link") || "";
  const notesVal = watch("notes") || "";
  const initialTgMeta = parseTelegramLink(initialData?.msg_link);

  // Helper untuk membaca/menyimpan tag metadata kontekstual di dalam kolom notes
  const upsertNoteTag = (tagPrefix: string, val: string) => {
    const curNotes = getValues("notes") || "";
    const regex = new RegExp(`(?:\\|\\s*)?${tagPrefix}:\\s*[^|]+`, "gi");
    const stripped = curNotes.replace(regex, "").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim();
    if (!val.trim()) {
      setValue("notes", stripped || "-");
      return;
    }
    const newTag = `${tagPrefix}: ${val.trim()}`;
    const updated = !stripped || stripped === "-" ? newTag : `${stripped} | ${newTag}`;
    setValue("notes", updated);
  };

  const extractNoteTag = (tagPrefix: string | undefined, rawNotes: string): string => {
    if (!tagPrefix || !rawNotes || rawNotes === "-") return "";
    const regex = new RegExp(`${tagPrefix}:\\s*([^|]+)`, "i");
    const match = rawNotes.match(regex);
    return match ? match[1].trim() : "";
  };

  // Auto-set defaults saat kategori berubah
  useEffect(() => {
    if (isTukarCash) {
      setValue("supplier", "-");
      setValue("pay_method", "Tunai");
      setValue("unit", "Trans");
      setValue("qty", 1);
      setValue("shipping_fee", 0);
      setValue("tax", 0);
      setValue("other_fee", 0);
      setValue("discount", 0);
      setValue("master_item_id", null);
    } else if (isOngkir) {
      setValue("unit", "Trip");
      setValue("shipping_fee", 0);
      setValue("tax", 0);
      setValue("master_item_id", null);
    } else {
      if (catProfile.hideQty) {
        setValue("qty", 1);
      }
      if (!catProfile.showMasterItemAutocomplete) {
        setValue("master_item_id", null);
        setSelectedSuggestionHint(null);
      }
      if (catProfile.shippingFeeLabel === null) setValue("shipping_fee", 0);
      if (catProfile.taxLabel === null) setValue("tax", 0);
      if (catProfile.otherFeeLabel === null) setValue("other_fee", 0);
      if (catProfile.discountLabel === null) setValue("discount", 0);
      if (catProfile.defaultUnit && (!initialData || initialData.category !== categoryVal)) {
        setValue("unit", catProfile.defaultUnit);
      }
    }
  }, [categoryVal, isTukarCash, isOngkir, catProfile, initialData, setValue]);

  // Filter suggestions based on input and prioritize active category
  const filteredItemSuggestions = useMemo(() => {
    const q = itemNameVal.trim().toLowerCase();
    const activeCatLower = categoryVal.trim().toLowerCase();
    const sorted = [...itemSuggestions].sort((a, b) => {
      const aMatch = (a.category || "").toLowerCase() === activeCatLower ? 1 : 0;
      const bMatch = (b.category || "").toLowerCase() === activeCatLower ? 1 : 0;
      return bMatch - aMatch;
    });
    if (!q) return sorted.slice(0, 8);
    return sorted
      .filter(
        (s) =>
          s.item_name.toLowerCase().includes(q) ||
          (s.aliases && s.aliases.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [itemNameVal, itemSuggestions, categoryVal]);

  // Filter supplier suggestions based on input
  const filteredSupplierSuggestions = useMemo(() => {
    const q = supplierVal.trim().toLowerCase();
    if (!q || q === "-") return supplierSuggestions.slice(0, 10);
    return supplierSuggestions
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, 10);
  }, [supplierVal, supplierSuggestions]);

  // Set form values when opening, editing, or repeating an order
  useEffect(() => {
    if (!isOpen) return;

    setSelectedSuggestionHint(null);
    setActiveTab("form");
    setOcrFile(null);
    setOcrPreview(null);
    setOcrError(null);
    setOcrSuccessBanner(null);
    setOcrExtractedItems([]);
    setSelectedOcrIndex(0);

    const fallbackCat =
      (defaultCategory && categories.includes(defaultCategory) ? defaultCategory : "") ||
      categories[0] ||
      "Bahan Kue";
    const defaultProfile = getCategoryFormProfile(fallbackCat);

    if (initialData) {
      reset({
        expense_date: initialData.expense_date,
        supplier: initialData.supplier || "-",
        item_name: initialData.item_name || "",
        qty: initialData.qty || 1,
        unit: initialData.unit || "Pcs",
        category: initialData.category || fallbackCat,
        unit_price: initialData.unit_price || 0,
        shipping_fee: initialData.shipping_fee || 0,
        tax: initialData.tax || 0,
        other_fee: initialData.other_fee || 0,
        discount: initialData.discount || 0,
        total_price: initialData.total_price || 0,
        pay_method: initialData.pay_method || "Transfer",
        pay_status: initialData.pay_status || "Lunas",
        due_date: initialData.due_date || "-",
        notes: initialData.notes || "-",
        invoice_number: initialData.invoice_number || "-",
        is_reimbursement: Boolean(initialData.is_reimbursement),
        msg_link: initialData.msg_link || "Web Dashboard",
        user_id: initialData.user_id ?? null,
        master_item_id: initialData.master_item_id ?? null,
        supplier_id: initialData.supplier_id ?? null,
      });
    } else if (repeatData) {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: repeatData.supplier || "-",
        item_name: repeatData.item_name || "",
        qty: repeatData.qty || 1,
        unit: repeatData.unit || "Pcs",
        category: repeatData.category || fallbackCat,
        unit_price: repeatData.unit_price || 0,
        shipping_fee: repeatData.shipping_fee || 0,
        tax: repeatData.tax || 0,
        other_fee: repeatData.other_fee || 0,
        discount: repeatData.discount || 0,
        total_price: repeatData.total_price || 0,
        pay_method: repeatData.pay_method || "Transfer",
        pay_status: repeatData.pay_status || "Lunas",
        due_date: repeatData.due_date || "-",
        notes: repeatData.notes || "-",
        invoice_number: repeatData.invoice_number || "-",
        is_reimbursement: Boolean(repeatData.is_reimbursement),
        msg_link: "Web Dashboard",
        user_id: repeatData.user_id ?? null,
        master_item_id: repeatData.master_item_id ?? null,
        supplier_id: repeatData.supplier_id ?? null,
      });
    } else {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: "-",
        item_name: "",
        qty: 1,
        unit: defaultProfile.defaultUnit || "Pcs",
        category: fallbackCat,
        unit_price: 0,
        shipping_fee: 0,
        tax: 0,
        other_fee: 0,
        discount: 0,
        total_price: 0,
        pay_method: "Transfer",
        pay_status: "Lunas",
        due_date: "-",
        notes: "-",
        invoice_number: "-",
        is_reimbursement: false,
        msg_link: "Web Dashboard",
        user_id: null,
        master_item_id: null,
        supplier_id: null,
      });
    }
    setInvoiceWarning(null);
    // Deliberately exclude `categories` array ref so background refetches don't wipe user's category choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, repeatData, reset, isOpen, defaultCategory]);

  const handleSelectSuggestion = (s: ItemSuggestion) => {
    setValue("item_name", s.item_name, { shouldValidate: true });
    if (s.is_master && s.id) {
      setValue("master_item_id", s.id);
    }
    if (s.category && categories.includes(s.category)) {
      setValue("category", s.category);
    }
    if (s.last_supplier && s.last_supplier !== "-" && (!supplierVal || supplierVal === "-")) {
      setValue("supplier", s.last_supplier);
    }
    const curUnitPrice = getValues("unit_price");
    if (s.last_unit_price > 0 && (!curUnitPrice || Number(curUnitPrice) === 0)) {
      setValue("unit_price", s.last_unit_price);
    }
    if (s.satuan_beli) {
      setValue("unit", s.satuan_beli);
    }
    setSelectedSuggestionHint(s);
    setShowItemDropdown(false);
  };

  const applyExtractedItemToForm = (item: OcrExtractedItem) => {
    if (item.barang) setValue("item_name", item.barang, { shouldValidate: true });
    if (item.qty) setValue("qty", Number(item.qty));
    if (item.satuan || item.unit) setValue("unit", item.satuan || item.unit);
    if (item.harga_satuan) setValue("unit_price", Number(item.harga_satuan));
    if (item.ongkir !== undefined || item.shipping_fee !== undefined) {
      setValue("shipping_fee", Number(item.ongkir ?? item.shipping_fee ?? 0));
    }
    if (item.tax !== undefined) setValue("tax", Number(item.tax));
    if (item.biaya_lainnya !== undefined || item.other_fee !== undefined) {
      setValue("other_fee", Number(item.biaya_lainnya ?? item.other_fee ?? 0));
    }
    if (item.diskon !== undefined) setValue("discount", Number(item.diskon));
    if (item.total_harga) setValue("total_price", Number(item.total_harga));
    if (item.toko_supplier) setValue("supplier", item.toko_supplier);
    if (item.tanggal) setValue("expense_date", item.tanggal);
    if (item.kategori && categories.includes(item.kategori)) {
      setValue("category", item.kategori);
    }
    if (item.metode_bayar) {
      setValue("pay_method", item.metode_bayar);
      if (item.metode_bayar === "COD") {
        setValue("pay_status", item.status_pembayaran || "Belum Lunas");
      } else {
        setValue("pay_status", "Lunas");
      }
    } else if (item.status_pembayaran) {
      setValue("pay_status", item.status_pembayaran);
    }
    if (item.no_invoice && item.no_invoice !== "-") {
      setValue("invoice_number", item.no_invoice);
      handleCheckInvoice(item.no_invoice);
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
    if (isTukarCash) {
      data.supplier = "-";
      data.pay_method = "Tunai";
      data.master_item_id = null;
    } else if (isOngkir) {
      data.master_item_id = null;
    }
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
      const shippingFee = Number(it.shipping_fee ?? it.ongkir ?? 0);
      const tax = Number(it.tax || 0);
      const otherFee = Number(it.other_fee ?? it.biaya_lainnya ?? 0);
      const discount = Number(it.diskon || 0);
      const tot = Number(it.total_harga || 0);
      const totalPrice = tot > 0 ? tot : (qty * unitPrice) + shippingFee + tax + otherFee - discount;

      const itPm = it.metode_bayar || currentPayMethod;
      const itPs = itPm === "COD" ? (it.status_pembayaran || currentPayStatus || "Belum Lunas") : "Lunas";

      return {
        expense_date: it.tanggal || currentExpenseDate,
        supplier: it.toko_supplier || currentSupplier,
        item_name: it.barang || "Barang",
        qty,
        unit: it.satuan || it.unit || "Pcs",
        category: (it.kategori && categories.includes(it.kategori)) ? it.kategori : currentCategory,
        unit_price: unitPrice,
        shipping_fee: shippingFee,
        tax,
        other_fee: otherFee,
        discount,
        total_price: totalPrice,
        pay_method: itPm,
        pay_status: itPs,
        due_date: currentDueDate,
        notes: (it.keterangan && it.keterangan !== "-") ? it.keterangan : currentNotes,
        invoice_number: (it.no_invoice && it.no_invoice !== "-") ? it.no_invoice : currentInvoice,
        is_reimbursement: it.is_reimbursement !== undefined ? Boolean(it.is_reimbursement) : currentIsReimb,
        msg_link: "Web Dashboard",
        user_id: watch("user_id") || null,
      };
    });

    onBatchSubmit(batch);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[95vw] sm:max-w-2xl md:max-w-4xl lg:max-w-5xl max-h-[94dvh] flex flex-col p-0 overflow-hidden rounded-2xl sm:rounded-3xl border-slate-200 shadow-2xl bg-white">
        {/* Sticky Top Header + Mode Switcher + Category Quick Rail */}
        <DialogHeader className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-200/80 bg-slate-50/80 shrink-0 space-y-3 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pr-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-blue-600 shrink-0" />
                  <span className="truncate">
                    {initialData
                      ? "Edit Catatan Pengeluaran"
                      : repeatData
                      ? `Beli Lagi: ${repeatData.item_name}`
                      : activeTab === "multi"
                      ? "Input 1 Nota (Multi-Item & Multi-Kategori)"
                      : "Tambah Catatan Pengeluaran"}
                  </span>
                </DialogTitle>
                {activeTab === "form" && (
                  <>
                    <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 px-2 py-0.5 rounded-lg">
                      {catProfile.badgeLabel}
                    </span>
                    <span className="text-[11px] font-mono font-semibold bg-white text-slate-600 border border-slate-200 px-2 py-0.5 rounded-lg">
                      {catProfile.coaLabel}
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 line-clamp-1">
                {activeTab === "multi"
                  ? "Catat beberapa barang dari kategori berbeda dalam 1 nota/struk belanja sekaligus."
                  : catProfile.description}
              </p>
            </div>

            {/* Mode Switcher (1 Item vs Multi-Item 1 Nota vs OCR Scan) - Only when adding fresh new expense */}
            {!initialData && !repeatData && (
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl shrink-0 self-start sm:self-auto w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab("form")}
                  className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-[34px] text-xs font-semibold rounded-lg transition-all ${
                    activeTab === "form"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>1 Item</span>
                </button>
                {onBatchSubmit && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("multi")}
                    className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-[34px] text-xs font-semibold rounded-lg transition-all ${
                      activeTab === "multi"
                        ? "bg-white text-blue-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Multi-Item (1 Nota)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab("ocr")}
                  className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-[34px] text-xs font-semibold rounded-lg transition-all ${
                    activeTab === "ocr"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>Scan Struk</span>
                </button>
              </div>
            )}
          </div>

          {/* Interactive Category Pill Bar (Horizontal scroll on mobile, wrapped/scrollable rail on desktop) */}
          {activeTab === "form" && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
              <span className="text-[11px] font-semibold text-slate-500 shrink-0 mr-1">
                Kategori:
              </span>
              {categories.map((c) => {
                const isSelected = categoryVal === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setValue("category", c, { shouldValidate: true })}
                    className={`shrink-0 px-2.5 py-1.5 min-h-[34px] sm:min-h-[30px] rounded-xl text-xs font-semibold transition-all border ${
                      isSelected
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200/90 hover:border-blue-300 hover:text-blue-700"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}
        </DialogHeader>

        {/* MULTI-ITEM & MULTI-CATEGORY 1 NOTA VIEW */}
        {activeTab === "multi" && !initialData && !repeatData && onBatchSubmit ? (
          <ExpenseMultiItemForm
            categories={categories}
            defaultCategory={categoryVal || defaultCategory}
            units={units}
            paymentMethods={paymentMethods}
            itemSuggestions={itemSuggestions}
            supplierSuggestions={supplierSuggestions}
            usersList={usersList}
            isSubmitting={isSubmitting}
            ocrSeedItems={ocrExtractedItems.length > 0 ? ocrExtractedItems : undefined}
            onBatchSubmit={onBatchSubmit}
            onClose={onClose}
          />
        ) : activeTab === "ocr" && !initialData && !repeatData ? (
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                className="lg:col-span-7 border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/30 rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all"
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
                    <div className="relative mx-auto max-w-[260px] max-h-64 overflow-hidden rounded-xl border border-slate-200 shadow-sm bg-white">
                      <img
                        src={ocrPreview}
                        alt="Pratinjau Nota"
                        className="w-full h-auto object-contain"
                      />
                    </div>
                    <p className="text-xs font-medium text-slate-700">
                      {ocrFile?.name} ({(Number(ocrFile?.size) / 1024).toFixed(1)} KB)
                    </p>
                    <span className="text-xs text-blue-600 hover:underline font-medium inline-block py-1">
                      Klik untuk ganti foto nota
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5 py-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
                      <Camera className="w-7 h-7" />
                    </div>
                    <h4 className="text-sm sm:text-base font-bold text-slate-800">
                      Foto Struk atau Unggah Gambar Nota
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                      Ambil foto langsung dari kamera ponsel atau tarik file gambar (JPG, PNG, WEBP) ke area ini.
                    </p>
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 space-y-4 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 sm:p-5">
                <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Ekstraksi Nota Otomatis
                </h5>
                <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
                  <li>1. Sistem membaca nama barang, kuantitas, harga satuan, nama toko, dan nomor nota.</li>
                  <li>2. Kategori pengeluaran otomatis disesuaikan dan tetap dapat dikoreksi sebelum disimpan.</li>
                  <li>3. Jika nota memiliki banyak baris barang, Anda dapat memilih per item atau simpan sekaligus.</li>
                </ul>

                {ocrError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                    {ocrError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActiveTab("form")}
                    className="rounded-xl text-xs h-11 sm:h-10 px-4"
                  >
                    Kembali ke Form
                  </Button>
                  <Button
                    type="button"
                    disabled={!ocrFile || isScanningOcr}
                    onClick={handleScanOcr}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-11 sm:h-10 px-5 font-semibold gap-1.5"
                  >
                    {isScanningOcr ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Menganalisis Struk...</span>
                      </>
                    ) : (
                      <>
                        <ScanLine className="w-4 h-4" />
                        <span>Pindai Struk (OCR)</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* MANUAL / REVIEW FORM VIEW (Wide 2-Column Desktop + Adaptive Mobile Sheet) */
          <form onSubmit={handleSubmit(handleFormSubmit)} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              {/* Banner saat berhasil OCR */}
              {ocrSuccessBanner && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs text-emerald-800">
                    <p className="font-semibold">{ocrSuccessBanner}</p>
                    {ocrExtractedItems.length > 1 && (
                      <div className="mt-2 space-y-1.5">
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
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
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
                          <div className="mt-2.5 pt-2 border-t border-emerald-200/80 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] text-emerald-700">
                              Total {ocrExtractedItems.length} item terbaca di nota ini.
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setActiveTab("multi")}
                                className="bg-white hover:bg-emerald-100 text-emerald-900 border-emerald-300 rounded-xl text-xs h-9 px-3 font-semibold flex items-center gap-1.5"
                              >
                                <Layers className="w-3.5 h-3.5" />
                                <span>Edit Semua di Tabel Multi-Item</span>
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={handleBatchSaveAll}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs h-9 px-3.5 shadow-sm font-semibold flex items-center gap-1.5"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Simpan Semua ({ocrExtractedItems.length} Item)</span>
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Telegram Cross-Check Banner for existing expense */}
              {initialData && initialTgMeta.isUrl && (
                <div className="p-3.5 bg-sky-50/80 border border-sky-200/90 rounded-2xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#229ED9] text-white flex items-center justify-center shrink-0">
                      <TelegramIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-sky-950">Chat Telegram Asli</span>
                        <span className="text-[10px] font-semibold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded-md">
                          {initialTgMeta.badgeLabel}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-sky-700 truncate block mt-0.5 max-w-[220px] sm:max-w-[380px]">
                        {initialData.msg_link}
                      </span>
                    </div>
                  </div>
                  <a
                    href={initialData.msg_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#229ED9] hover:bg-[#1d8ec4] text-white text-xs font-semibold shrink-0 transition-all"
                    title="Buka pesan Telegram di tab baru"
                  >
                    <span>Cross Check</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* MAIN 2-COLUMN DESKTOP GRID (Reflows to 1 column on mobile/tablet) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
                {/* LEFT COLUMN (7 cols on Desktop): Identitas Item, Supplier/Penerima, Metadata Kategori, & Referensi */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Baris Tanggal & Dropdown Kategori */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        Tanggal Nota
                      </label>
                      <Input
                        type="date"
                        {...register("expense_date", { required: true })}
                        className="h-11 sm:h-10 text-xs rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        Kategori Pengeluaran
                      </label>
                      <select
                        {...register("category")}
                        className="h-11 sm:h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-semibold focus:ring-2 focus:ring-blue-500"
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Nama Barang / Judul Transaksi / Jenis Keperluan */}
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-700">
                        {catProfile.itemLabel}
                      </label>
                      {catProfile.showMasterItemAutocomplete && selectedSuggestionHint && selectedSuggestionHint.last_unit_price > 0 && (
                        <button
                          type="button"
                          onClick={() => setValue("unit_price", selectedSuggestionHint.last_unit_price)}
                          className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <Clock className="w-3 h-3" />
                          Harga terakhir: {formatRupiah(selectedSuggestionHint.last_unit_price)}
                        </button>
                      )}
                    </div>
                    <Input
                      placeholder={catProfile.itemPlaceholder}
                      autoComplete="off"
                      {...register("item_name", { required: "Kolom ini wajib diisi" })}
                      onFocus={() => {
                        if (catProfile.showMasterItemAutocomplete) setShowItemDropdown(true);
                      }}
                      onBlur={() => setTimeout(() => setShowItemDropdown(false), 180)}
                      className="h-11 sm:h-10 text-xs rounded-xl font-medium"
                    />
                    {errors.item_name && (
                      <span className="text-[11px] text-red-500 mt-0.5 block">{errors.item_name.message}</span>
                    )}

                    {/* Quick Item Chips sesuai Kategori */}
                    {catProfile.quickItemChips && catProfile.quickItemChips.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[10px] font-medium text-slate-400">Pilihan cepat:</span>
                        {catProfile.quickItemChips.map((chip) => {
                          const isSelected = itemNameVal.trim().toLowerCase() === chip.toLowerCase();
                          return (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => setValue("item_name", chip, { shouldValidate: true })}
                              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors font-medium border ${
                                isSelected
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 border-slate-200/70"
                              }`}
                            >
                              {chip}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Dropdown Autocomplete hanya untuk kategori yang terhubung ke Master Item */}
                    {catProfile.showMasterItemAutocomplete && showItemDropdown && filteredItemSuggestions.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto divide-y divide-slate-100">
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
                              <span className="text-[11px] text-slate-500">
                                {s.category} {s.last_supplier !== "-" ? `• ${s.last_supplier}` : ""}
                                {s.isi_paket ? ` • ${s.satuan_beli}: ${s.isi_paket}` : (s.satuan_beli && s.satuan_beli !== "Pcs" ? ` • ${s.satuan_beli}` : "")}
                              </span>
                            </div>
                            {s.last_unit_price > 0 && (
                              <div className="text-right">
                                <span className="text-xs font-bold text-slate-700 block tabular-nums">
                                  {formatRupiah(s.last_unit_price)}
                                </span>
                                <span className="text-[10px] text-slate-500">harga satuan</span>
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Toko / Supplier / Kurir / Penerima Gaji / Vendor */}
                  {isTukarCash ? (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 flex items-center gap-2.5">
                      <Store className="w-4 h-4 text-slate-400 shrink-0" />
                      <span><strong>Tukar Cash:</strong> Tanpa supplier (kas fisik keluar dari laci kasir). Bukti transfer bank dicatat di kolom keterangan.</span>
                      <input type="hidden" {...register("supplier")} value="-" />
                    </div>
                  ) : isOngkir ? (
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        {catProfile.supplierLabel}
                      </label>
                      <Input
                        placeholder={catProfile.supplierPlaceholder}
                        list="ongkir-courier-list"
                        {...register("supplier", { required: isOngkir ? "Nama kurir wajib diisi" : false })}
                        className="h-11 sm:h-10 text-xs rounded-xl"
                      />
                      <datalist id="ongkir-courier-list">
                        <option value="GoSend Car" />
                        <option value="GoSend Bike" />
                        <option value="GrabExpress Instant" />
                        <option value="GrabExpress SameDay" />
                        <option value="Lalamove" />
                        <option value="Maxim" />
                        <option value="J&T Express" />
                        <option value="SiCepat" />
                        <option value="Anteraja" />
                      </datalist>
                      {catProfile.quickSupplierChips && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-slate-400">Pilih kurir:</span>
                          {catProfile.quickSupplierChips.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setValue("supplier", c)}
                              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors font-medium border ${
                                supplierVal === c
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 border-slate-200/70"
                              }`}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">
                          {catProfile.supplierLabel}
                        </label>
                        {supplierVal && supplierVal !== "-" && (
                          <button
                            type="button"
                            onClick={() => setValue("supplier", "-")}
                            className="text-[11px] text-slate-400 hover:text-slate-600"
                          >
                            Reset (-)
                          </button>
                        )}
                      </div>
                      <Input
                        placeholder={catProfile.supplierPlaceholder}
                        autoComplete="off"
                        {...register("supplier")}
                        onFocus={() => {
                          if (!isPayroll) setShowSupplierDropdown(true);
                        }}
                        onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 180)}
                        className="h-11 sm:h-10 text-xs rounded-xl"
                      />

                      {/* Untuk Gaji: Tampilkan daftar karyawan terdaftar dari usersList agar 1-klik */}
                      {isPayroll && usersList.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-slate-400">Staf terdaftar:</span>
                          {usersList.slice(0, 6).map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => setValue("supplier", u.name)}
                              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors font-medium border ${
                                supplierVal === u.name
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 border-slate-200/70"
                              }`}
                            >
                              {u.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Untuk Kategori dengan Quick Supplier Chips (Operasional, Software, Marketing) */}
                      {!isPayroll && catProfile.quickSupplierChips && catProfile.quickSupplierChips.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-slate-400">Saran penyedia:</span>
                          {catProfile.quickSupplierChips.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setValue("supplier", s)}
                              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors font-medium border ${
                                supplierVal === s
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 border-slate-200/70"
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Dropdown Autocomplete Toko/Supplier */}
                      {!isPayroll && showSupplierDropdown && filteredSupplierSuggestions.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                          <div className="px-3 py-1.5 bg-slate-50/80 text-[10px] font-semibold text-slate-500 flex items-center gap-1">
                            <Store className="w-3 h-3 text-slate-400" />
                            <span>Riwayat {catProfile.supplierLabel}</span>
                          </div>
                          {filteredSupplierSuggestions.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setValue("supplier", s);
                                setShowSupplierDropdown(false);
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-blue-50/60 transition-colors flex items-center justify-between group"
                            >
                              <span className="text-xs font-medium text-slate-800 group-hover:text-blue-600">
                                {s}
                              </span>
                              <Check className="w-3.5 h-3.5 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Quick suggestions chips untuk kategori belanja reguler */}
                      {!isPayroll && !catProfile.quickSupplierChips && (!supplierVal || supplierVal === "-") && supplierSuggestions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-slate-400">Paling sering:</span>
                          {supplierSuggestions.slice(0, 5).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setValue("supplier", s)}
                              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 transition-colors font-medium border border-slate-200/70"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Field Kontekstual Spesifik Kategori (Periode Gaji, Durasi Sewa, Siklus Software, Kondisi Aset, Area Servis, dll.) */}
                  {(catProfile.metaField1Label || catProfile.metaField2Label) && (
                    <div className="p-3.5 bg-blue-50/40 border border-blue-200/70 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {catProfile.metaField1Label && catProfile.metaField1TagPrefix && (
                        <div className={catProfile.metaField2Label ? "" : "sm:col-span-2"}>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">
                            {catProfile.metaField1Label}
                          </label>
                          <Input
                            value={extractNoteTag(catProfile.metaField1TagPrefix, notesVal)}
                            onChange={(e) => upsertNoteTag(catProfile.metaField1TagPrefix!, e.target.value)}
                            placeholder={catProfile.metaField1Placeholder}
                            className="h-10 text-xs rounded-xl bg-white"
                          />
                          {catProfile.metaField1Chips && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {catProfile.metaField1Chips.map((chip) => {
                                const curVal = extractNoteTag(catProfile.metaField1TagPrefix, notesVal);
                                const active = curVal.toLowerCase() === chip.toLowerCase();
                                return (
                                  <button
                                    key={chip}
                                    type="button"
                                    onClick={() => upsertNoteTag(catProfile.metaField1TagPrefix!, active ? "" : chip)}
                                    className={`text-[10px] px-2 py-1 rounded-lg transition-colors font-medium border ${
                                      active
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "bg-white hover:bg-blue-50 text-slate-600 border-slate-200"
                                    }`}
                                  >
                                    {chip}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {catProfile.metaField2Label && catProfile.metaField2TagPrefix && (
                        <div className={catProfile.metaField1Label ? "" : "sm:col-span-2"}>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">
                            {catProfile.metaField2Label}
                          </label>
                          <Input
                            value={extractNoteTag(catProfile.metaField2TagPrefix, notesVal)}
                            onChange={(e) => upsertNoteTag(catProfile.metaField2TagPrefix!, e.target.value)}
                            placeholder={catProfile.metaField2Placeholder}
                            className="h-10 text-xs rounded-xl bg-white"
                          />
                          {catProfile.metaField2Chips && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {catProfile.metaField2Chips.map((chip) => {
                                const curVal = extractNoteTag(catProfile.metaField2TagPrefix, notesVal);
                                const active = curVal.toLowerCase() === chip.toLowerCase();
                                return (
                                  <button
                                    key={chip}
                                    type="button"
                                    onClick={() => upsertNoteTag(catProfile.metaField2TagPrefix!, active ? "" : chip)}
                                    className={`text-[10px] px-2 py-1 rounded-lg transition-colors font-medium border ${
                                      active
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "bg-white hover:bg-blue-50 text-slate-600 border-slate-200"
                                    }`}
                                  >
                                    {chip}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Baris Referensi: No. Invoice, Reimbursement, & Penginput Transaksi */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                    {!isTukarCash && (
                      <>
                        <div className="sm:col-span-4">
                          <label className="text-xs font-semibold text-slate-700 block mb-1">
                            {isPayroll ? "No. Slip / Ref" : "No. Invoice / Nota"}
                          </label>
                          <Input
                            placeholder="INV-2026/.. atau -"
                            {...register("invoice_number")}
                            onBlur={(e) => handleCheckInvoice(e.target.value)}
                            className="h-11 sm:h-10 text-xs rounded-xl font-mono"
                          />
                        </div>

                        <div className="sm:col-span-4">
                          <label className="text-xs font-semibold text-slate-700 block mb-1">
                            Tipe Dana
                          </label>
                          <label className="flex items-center gap-2 h-11 sm:h-10 px-3 rounded-xl border border-input bg-slate-50/60 hover:bg-slate-100/70 cursor-pointer transition-colors">
                            <input
                              type="checkbox"
                              {...register("is_reimbursement")}
                              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                            />
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 truncate">
                              <Briefcase className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span className="truncate">Talangan / Reimburse</span>
                            </div>
                          </label>
                        </div>
                      </>
                    )}

                    <div className={isTukarCash ? "sm:col-span-12" : "sm:col-span-4"}>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        Penginput (User)
                      </label>
                      <select
                        {...register("user_id", {
                          setValueAs: (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
                        })}
                        className="w-full h-11 sm:h-10 px-3 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Otomatis (Web Dashboard)</option>
                        {usersList.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} {u.telegram_id ? `(@${u.telegram_id})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {invoiceWarning && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2 leading-snug">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>{invoiceWarning}</span>
                    </div>
                  )}

                  {/* Keterangan / Catatan & Link Sumber Telegram */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        {catProfile.notesLabel}
                      </label>
                      <Input
                        placeholder={catProfile.notesPlaceholder}
                        {...register("notes")}
                        className="h-11 sm:h-10 text-xs rounded-xl"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <TelegramIcon className="w-3.5 h-3.5 text-[#229ED9]" />
                          <span>Link Bukti / Sumber</span>
                        </label>
                        {msgLinkVal && parseTelegramLink(msgLinkVal).isUrl && (
                          <a
                            href={msgLinkVal}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                          >
                            <span>Buka Link</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      <Input
                        placeholder="https://t.me/c/... atau Web Dashboard"
                        {...register("msg_link")}
                        className="h-11 sm:h-10 text-xs rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN (5 cols on Desktop): Isolated Watcher Ledger Kalkulasi & Pembayaran */}
                <LedgerSummaryPanel
                  control={control}
                  register={register}
                  setValue={setValue}
                  catProfile={catProfile}
                  units={units}
                  paymentMethods={paymentMethods}
                  selectedSuggestionHint={selectedSuggestionHint}
                  itemSuggestions={itemSuggestions}
                  upsertNoteTag={upsertNoteTag}
                />
              </div>
            </div>

            {/* Sticky Bottom Action Bar (Isolated Watcher) */}
            <IsolatedStickyFooter
              control={control}
              catProfile={catProfile}
              isSubmitting={isSubmitting}
              isEditing={Boolean(initialData)}
              onClose={onClose}
            />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
