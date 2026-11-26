import React, { useEffect, useState, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import {
  BankAccount,
  Expense,
  ExpenseFormData,
  ExpenseUser,
  FixedAsset,
  ItemSuggestion,
  OcrExtractedItem,
  Supplier,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { formatRupiah, toIsoDate } from "@/lib/formatters";
import { DatePicker } from "@/components/ui/date-picker";
import {
  scanExpenseOcr,
  getExpenseUsers,
  checkInvoiceDuplicate,
  getBankAccounts,
  getSuppliers,
  createSupplier,
  getAssets,
} from "@/lib/api";
import {
  Camera,
  FileText,
  ScanLine,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Check,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { getCategoryFormProfile } from "@/lib/categoryFormConfig";
import { isDpStatus } from "@/lib/paymentStatus";
import { toast } from "sonner";
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
      packaging_id: null,
      review_status: "CONFIRMED",
      review_warning: null,
    },
  });

  const [usersList, setUsersList] = useState<ExpenseUser[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [courierList, setCourierList] = useState<Supplier[]>([]);
  const [newCourierName, setNewCourierName] = useState("");
  const [showAddCourier, setShowAddCourier] = useState(false);
  const [isAddingCourier, setIsAddingCourier] = useState(false);
  const [assetsList, setAssetsList] = useState<FixedAsset[]>([]);
  const [assetThreshold, setAssetThreshold] = useState<number>(500000);

  useEffect(() => {
    if (isOpen) {
      getBankAccounts(true).then(setBankAccounts).catch(() => {});
      getExpenseUsers()
        .then((res) => {
          if (Array.isArray(res)) setUsersList(res);
        })
        .catch(() => {});
      getSuppliers({ supplier_type: "kurir", is_active: true, limit: 100 })
        .then((res) => setCourierList(res.items || []))
        .catch(() => {});
      getAssets()
        .then((res) => {
          setAssetsList(res.items || []);
          if (res.config?.asset_capitalization_threshold !== undefined) {
            setAssetThreshold(res.config.asset_capitalization_threshold);
          }
        })
        .catch(() => {});
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
  const userIdVal = watch("user_id");
  const assetIdVal = watch("asset_id");
  const catProfile = useMemo(() => getCategoryFormProfile(categoryVal), [categoryVal]);
  const isOngkir = catProfile.archetype === "ongkir";
  const isTukarCash = catProfile.archetype === "tukar_cash";
  const isPayroll = catProfile.archetype === "payroll";
  const isAssetCategory = categoryVal.trim().toLowerCase() === "asset";
  const isMaintenanceCategory = categoryVal.trim().toLowerCase() === "maintenance";
  const totalPriceVal = Number(watch("total_price") || 0);
  const qtyVal = Math.max(1, Number(watch("qty") || 1));

  const handleAddSubscribedCourier = async () => {
    const clean = newCourierName.trim();
    if (!clean) {
      toast.error("Masukkan nama kurir langganan.");
      return;
    }
    setIsAddingCourier(true);
    try {
      const created = await createSupplier({
        name: clean,
        supplier_type: "kurir",
        courier_category: "Langganan",
        is_subscribed: true,
        is_active: true,
      });
      setCourierList((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      setValue("supplier", created.name);
      setValue("supplier_id", created.id);
      setNewCourierName("");
      setShowAddCourier(false);
      toast.success(`Kurir langganan "${created.name}" ditambahkan.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal menambahkan kurir langganan.");
    } finally {
      setIsAddingCourier(false);
    }
  };

  const msgLinkVal = watch("msg_link") || "";
  const notesVal = watch("notes") || "";
  const initialTgMeta = parseTelegramLink(initialData?.msg_link);

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

  const courierOptions = useMemo(() => {
    if (courierList.length > 0) {
      const sorted = [
        ...courierList.filter((c) => c.is_subscribed),
        ...courierList.filter((c) => !c.is_subscribed),
      ];
      return sorted.map((c) => ({
        value: c.name,
        label: c.name,
        badge: c.is_subscribed ? "Langganan" : undefined,
      }));
    }
    return [
      "GoSend",
      "GoCar",
      "Lalamove",
      "GrabExpress",
      "Shopee Express",
      "Maxim",
      "JNE",
      "Kurir Lainnya",
    ].map((name) => ({ value: name, label: name }));
  }, [courierList]);

  const supplierComboboxOptions = useMemo(() => {
    if (isPayroll) {
      return usersList.map((u) => ({
        value: u.name,
        label: u.name,
        sublabel: u.telegram_id ? `@${u.telegram_id}` : undefined,
      }));
    }
    const merged = Array.from(
      new Set([
        ...(catProfile.quickSupplierChips || []),
        ...supplierSuggestions.filter((s) => s && s !== "-"),
      ])
    );
    return merged.map((s) => ({ value: s, label: s }));
  }, [isPayroll, usersList, catProfile.quickSupplierChips, supplierSuggestions]);

  const assetSelectOptions = useMemo(() => {
    return [
      { value: "", label: "-- Tidak ditautkan --" },
      ...assetsList
        .filter((a) => a.status !== "Dihapuskan" && a.status !== "Dijual")
        .map((a) => ({
          value: String(a.id),
          label: `[${a.asset_code}] ${a.name}`,
          sublabel: a.location || undefined,
        })),
    ];
  }, [assetsList]);

  const userSelectOptions = useMemo(() => {
    return [
      { value: "", label: "Otomatis (Web Dashboard)" },
      ...usersList.map((u) => ({
        value: String(u.id),
        label: u.name,
        sublabel: u.telegram_id ? `@${u.telegram_id}` : undefined,
      })),
    ];
  }, [usersList]);

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
        paid_amount: initialData.paid_amount || 0,
        dp_type: initialData.dp_type || "percent",
        dp_percent: initialData.dp_percent ?? 50,
        notes: initialData.notes || "-",
        invoice_number: initialData.invoice_number || "-",
        is_reimbursement: Boolean(initialData.is_reimbursement),
        msg_link: initialData.msg_link || "Web Dashboard",
        user_id: initialData.user_id ?? null,
        master_item_id: initialData.master_item_id ?? null,
        packaging_id: initialData.packaging_id ?? null,
        review_status: initialData.review_status || "CONFIRMED",
        review_warning: initialData.review_warning ?? null,
        supplier_id: initialData.supplier_id ?? null,
        bank_account_id: initialData.bank_account_id ?? null,
      });
      if (initialData.master_item_id) {
        const foundSug = itemSuggestions.find((s) => s.id === initialData.master_item_id) || null;
        setSelectedSuggestionHint(foundSug);
      } else {
        setSelectedSuggestionHint(null);
      }
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
        paid_amount: repeatData.paid_amount || 0,
        dp_type: repeatData.dp_type || "percent",
        dp_percent: repeatData.dp_percent ?? 50,
        notes: repeatData.notes || "-",
        invoice_number: repeatData.invoice_number || "-",
        is_reimbursement: Boolean(repeatData.is_reimbursement),
        msg_link: "Web Dashboard",
        user_id: repeatData.user_id ?? null,
        master_item_id: repeatData.master_item_id ?? null,
        packaging_id: repeatData.packaging_id ?? null,
        review_status: "CONFIRMED",
        review_warning: null,
        supplier_id: repeatData.supplier_id ?? null,
      });
      if (repeatData.master_item_id) {
        const foundSug = itemSuggestions.find((s) => s.id === repeatData.master_item_id) || null;
        setSelectedSuggestionHint(foundSug);
      } else {
        setSelectedSuggestionHint(null);
      }
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
        paid_amount: 0,
        dp_type: "percent",
        dp_percent: 50,
        notes: "-",
        invoice_number: "-",
        is_reimbursement: false,
        msg_link: "Web Dashboard",
        user_id: null,
        master_item_id: null,
        packaging_id: null,
        review_status: "CONFIRMED",
        review_warning: null,
        supplier_id: null,
      });
      setSelectedSuggestionHint(null);
    }
    setInvoiceWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, repeatData, reset, isOpen, defaultCategory]);

  const handleSelectSuggestion = (s: ItemSuggestion) => {
    setValue("item_name", s.item_name, { shouldValidate: true });
    if (s.is_master && s.id) {
      setValue("master_item_id", s.id);
    }
    const defaultPkg =
      s.packagings?.find((p) => p.is_default && p.is_active !== false) ||
      s.packagings?.[0] ||
      null;
    setValue("packaging_id", defaultPkg?.id ?? null);
    setValue("review_status", "CONFIRMED");
    setValue("review_warning", null);
    if (s.category && categories.includes(s.category)) {
      setValue("category", s.category);
    }
    if (s.last_supplier && s.last_supplier !== "-" && (!supplierVal || supplierVal === "-")) {
      setValue("supplier", s.last_supplier);
    }
    const curUnitPrice = getValues("unit_price");
    const suggestedPrice = defaultPkg?.last_unit_price ?? s.last_unit_price;
    if (suggestedPrice > 0 && (!curUnitPrice || Number(curUnitPrice) === 0)) {
      setValue("unit_price", suggestedPrice);
    }
    if (defaultPkg?.purchase_unit || s.satuan_beli) {
      setValue("unit", defaultPkg?.purchase_unit || s.satuan_beli || "Pcs");
    }
    setSelectedSuggestionHint(s);
    setShowItemDropdown(false);
  };

  const applyExtractedItemToForm = (item: OcrExtractedItem) => {
    if (item.barang) setValue("item_name", item.barang, { shouldValidate: true });
    setValue("master_item_id", item.master_item_id ?? null);
    setValue("packaging_id", item.packaging_id ?? null);
    setValue("review_status", item.review_status || "CONFIRMED");
    setValue("review_warning", item.review_warning ?? null);
    const matchedSug =
      (item.master_item_id
        ? itemSuggestions.find((s) => s.id === item.master_item_id)
        : null) ||
      (item.barang
        ? itemSuggestions.find(
            (s) => s.item_name.toLowerCase() === item.barang!.trim().toLowerCase()
          )
        : null) ||
      null;
    setSelectedSuggestionHint(matchedSug);
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
        if (res.items.length > 1 && onBatchSubmit && !initialData && !repeatData) {
          setActiveTab("multi");
          if ((res.warning_count || 0) > 0) {
            toast.warning(
              `Berhasil membaca ${res.items.length} item, namun ${res.warning_count} item butuh konfirmasi varian kemasan.`
            );
          } else {
            toast.success(
              `Berhasil membaca ${res.items.length} item dari struk dan dimuat ke mode Multi-Item.`
            );
          }
        } else {
          setActiveTab("form");
          setOcrSuccessBanner(
            (res.warning_count || 0) > 0
              ? `Berhasil membaca ${res.items.length} item, periksa peringatan varian kemasan sebelum simpan.`
              : `Berhasil membaca ${res.items.length} item dari struk. Silakan periksa rincian data lalu simpan.`
          );
        }
      } else {
        setOcrError(
          res.message || "Gagal membaca struk/nota. Pastikan gambar jelas dan tidak terpotong."
        );
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
    if (isDpStatus(data.pay_status)) {
      const totalVal = Number(data.total_price || 0);
      const dpVal =
        data.dp_type === "percent" && data.dp_percent
          ? Math.round((totalVal * Number(data.dp_percent)) / 100)
          : Number(data.paid_amount || 0);
      if (dpVal <= 0) {
        toast.error("Nominal DP awal harus lebih dari Rp 0.");
        return;
      }
      if (totalVal > 0 && dpVal >= totalVal) {
        toast.error(
          "Nominal DP tidak boleh sama atau melebihi total invoice. Pilih status Lunas jika dibayar penuh."
        );
        return;
      }
      data.paid_amount = dpVal;
      if (!data.due_date || data.due_date === "-") {
        toast.error("Tentukan tanggal jatuh tempo pelunasan untuk sisa DP.");
        return;
      }
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
      const totalPrice =
        tot > 0 ? tot : qty * unitPrice + shippingFee + tax + otherFee - discount;

      const itPm = it.metode_bayar || currentPayMethod;
      const itPs =
        itPm === "COD"
          ? it.status_pembayaran || currentPayStatus || "Belum Lunas"
          : "Lunas";

      return {
        expense_date: it.tanggal || currentExpenseDate,
        supplier: it.toko_supplier || currentSupplier,
        item_name: it.barang || "Barang",
        qty,
        unit: it.satuan || it.unit || "Pcs",
        category:
          it.kategori && categories.includes(it.kategori)
            ? it.kategori
            : currentCategory,
        unit_price: unitPrice,
        shipping_fee: shippingFee,
        tax,
        other_fee: otherFee,
        discount,
        total_price: totalPrice,
        pay_method: itPm,
        pay_status: itPs,
        due_date: currentDueDate,
        notes: it.keterangan && it.keterangan !== "-" ? it.keterangan : currentNotes,
        invoice_number:
          it.no_invoice && it.no_invoice !== "-" ? it.no_invoice : currentInvoice,
        is_reimbursement:
          it.is_reimbursement !== undefined
            ? Boolean(it.is_reimbursement)
            : currentIsReimb,
        msg_link: "Web Scan Struk (AI)",
        user_id: watch("user_id") || null,
        master_item_id: it.master_item_id ?? null,
        packaging_id: it.packaging_id ?? null,
        retail_qty: it.retail_qty ?? null,
        retail_unit: it.retail_unit ?? null,
        base_qty: it.base_qty ?? null,
        base_unit: it.base_unit ?? null,
        base_unit_price: it.base_unit_price ?? null,
        review_status: it.review_status || "CONFIRMED",
        review_warning: it.review_warning ?? null,
      };
    });

    onBatchSubmit(batch);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[95vw] sm:max-w-2xl md:max-w-4xl lg:max-w-5xl max-h-[94dvh] flex flex-col p-0 overflow-hidden rounded-xl border-border shadow-xl bg-background">
        {/* Clean Editorial Header */}
        <DialogHeader className="px-4 sm:px-6 py-3.5 border-b border-border/80 bg-background shrink-0 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pr-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base font-bold tracking-tight text-foreground">
                  {initialData
                    ? "Edit Catatan Pengeluaran"
                    : repeatData
                    ? `Beli Lagi: ${repeatData.item_name}`
                    : activeTab === "multi"
                    ? "Input 1 Nota (Multi-Item & Multi-Kategori)"
                    : "Tambah Catatan Pengeluaran"}
                </DialogTitle>
                {activeTab === "form" && (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {catProfile.badgeLabel} ({catProfile.coaLabel})
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {activeTab === "multi"
                  ? "Catat beberapa barang dari kategori berbeda dalam 1 nota/struk belanja sekaligus."
                  : catProfile.description}
              </p>
            </div>

            {/* Mode Switcher */}
            {!initialData && !repeatData && (
              <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg shrink-0 self-start sm:self-auto w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab("form")}
                  className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-colors ${
                    activeTab === "form"
                      ? "bg-background text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>1 Item</span>
                </button>
                {onBatchSubmit && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("multi")}
                    className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-colors ${
                      activeTab === "multi"
                        ? "bg-background text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Multi-Item</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab("ocr")}
                  className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md transition-colors ${
                    activeTab === "ocr"
                      ? "bg-foreground text-background shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>Scan Struk</span>
                </button>
              </div>
            )}
          </div>
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
            bankAccounts={bankAccounts}
            isSubmitting={isSubmitting}
            ocrSeedItems={ocrExtractedItems.length > 0 ? ocrExtractedItems : undefined}
            onBatchSubmit={onBatchSubmit}
            onClose={onClose}
          />
        ) : activeTab === "ocr" && !initialData && !repeatData ? (
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                className="lg:col-span-7 border border-dashed border-border hover:border-foreground/50 rounded-lg p-6 sm:p-8 text-center cursor-pointer transition-colors"
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
                    <div className="relative mx-auto max-w-[260px] max-h-64 overflow-hidden rounded-md border border-border bg-background">
                      <img
                        src={ocrPreview}
                        alt="Pratinjau Nota"
                        className="w-full h-auto object-contain"
                      />
                    </div>
                    <p className="text-xs font-medium text-foreground">
                      {ocrFile?.name} ({(Number(ocrFile?.size) / 1024).toFixed(1)} KB)
                    </p>
                    <span className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium inline-block py-1">
                      Klik untuk ganti foto nota
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2 py-4">
                    <Camera className="w-7 h-7 text-muted-foreground mx-auto" />
                    <h4 className="text-sm font-semibold text-foreground">
                      Foto Struk atau Unggah Gambar Nota
                    </h4>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                      Ambil foto langsung dari kamera ponsel atau tarik file gambar (JPG, PNG, WEBP) ke area ini.
                    </p>
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 space-y-4 lg:pl-6 lg:border-l border-border/70">
                <h5 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Ekstraksi Nota Otomatis
                </h5>
                <ul className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
                  <li>1. Sistem membaca nama barang, kuantitas, harga satuan, nama toko, dan nomor nota.</li>
                  <li>2. Kategori pengeluaran otomatis disesuaikan dan tetap dapat dikoreksi sebelum disimpan.</li>
                  <li>3. Jika nota memiliki banyak baris barang, Anda dapat memilih per item atau simpan sekaligus.</li>
                </ul>

                {ocrError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {ocrError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActiveTab("form")}
                    className="h-9 text-xs px-4"
                  >
                    Kembali ke Form
                  </Button>
                  <Button
                    type="button"
                    disabled={!ocrFile || isScanningOcr}
                    onClick={handleScanOcr}
                    className="h-9 text-xs px-5 font-semibold gap-1.5"
                  >
                    {isScanningOcr ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Menganalisis Struk...</span>
                      </>
                    ) : (
                      <>
                        <ScanLine className="w-3.5 h-3.5" />
                        <span>Pindai Struk (OCR)</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* MANUAL / REVIEW FORM VIEW (2-Column Editorial Hairline Ledger) */
          <form
            onSubmit={handleSubmit(handleFormSubmit)}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              {/* Banner saat berhasil OCR */}
              {ocrSuccessBanner && (
                <div className="pb-3 border-b border-border/70 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <p className="font-semibold text-foreground">{ocrSuccessBanner}</p>
                    {ocrExtractedItems.length > 1 && (
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {ocrExtractedItems.map((it, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setSelectedOcrIndex(idx);
                                applyExtractedItemToForm(it);
                              }}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                selectedOcrIndex === idx
                                  ? "bg-foreground text-background border-foreground"
                                  : "bg-background text-foreground border-input hover:bg-muted/60"
                              }`}
                            >
                              {it.review_status === "DRAFT_WARNING" ? "⚠ " : ""}
                              {it.barang || `Item #${idx + 1}`} (
                              {formatRupiah(Number(it.total_harga || 0))})
                            </button>
                          ))}
                        </div>

                        {onBatchSubmit && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span className="text-[11px] text-muted-foreground">
                              Total {ocrExtractedItems.length} item terbaca di nota ini.
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setActiveTab("multi")}
                                className="h-8 text-xs px-3"
                              >
                                Edit di Tabel Multi-Item
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={handleBatchSaveAll}
                                className="h-8 text-xs px-3 font-semibold"
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Simpan Semua ({ocrExtractedItems.length})
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Telegram Cross-Check Line for existing expense */}
              {initialData && initialTgMeta.isUrl && (
                <div className="pb-3 border-b border-border/70 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <TelegramIcon className="w-4 h-4 text-[#229ED9] shrink-0" />
                    <span className="font-medium text-foreground">Sumber Telegram:</span>
                    <span className="text-muted-foreground font-mono truncate">
                      {initialData.msg_link}
                    </span>
                  </div>
                  <a
                    href={initialData.msg_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium shrink-0"
                  >
                    <span>Cross Check</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* MAIN 2-COLUMN DESKTOP GRID WITH HAIRLINE DIVIDER */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-0 items-start lg:divide-x lg:divide-border/70">
                {/* LEFT COLUMN (7 cols on Desktop) */}
                <div className="lg:col-span-7 lg:pr-6 space-y-4">
                  {/* Baris Tanggal & Dropdown Kategori (Shadcn SearchableSelect > 10 options) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground block">
                        Tanggal Nota
                      </label>
                      <DatePicker
                        value={watch("expense_date")}
                        onChange={(d) =>
                          setValue("expense_date", toIsoDate(d), { shouldValidate: true })
                        }
                        className="w-full h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground block">
                        Kategori Pengeluaran
                      </label>
                      <AdaptiveSelect
                        value={categoryVal}
                        onValueChange={(nextCat) =>
                          setValue("category", nextCat, { shouldValidate: true })
                        }
                        options={categories}
                        placeholder="Pilih kategori..."
                        searchPlaceholder="Cari kategori..."
                      />
                    </div>
                  </div>

                  {/* Nama Barang / Judul Transaksi / Jenis Keperluan (ReUI InputGroup) */}
                  <div className="relative space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      {catProfile.itemLabel}
                    </label>
                    <InputGroup className="h-9">
                      <InputGroupInput
                        placeholder={catProfile.itemPlaceholder}
                        autoComplete="off"
                        {...register("item_name", {
                          required: "Kolom ini wajib diisi",
                          onChange: () => {
                            setValue("master_item_id", null);
                            setSelectedSuggestionHint(null);
                          },
                          onBlur: () => setTimeout(() => setShowItemDropdown(false), 180),
                        })}
                        onFocus={() => {
                          if (catProfile.showMasterItemAutocomplete) setShowItemDropdown(true);
                        }}
                        className="text-xs"
                      />
                      {catProfile.showMasterItemAutocomplete &&
                        selectedSuggestionHint &&
                        selectedSuggestionHint.last_unit_price > 0 && (
                          <InputGroupAddon align="inline-end" className="pr-1.5">
                            <InputGroupButton
                              size="xs"
                              onClick={() =>
                                setValue("unit_price", selectedSuggestionHint.last_unit_price)
                              }
                              className="text-[11px] font-medium text-blue-600 dark:text-blue-400"
                            >
                              Harga terakhir: {formatRupiah(selectedSuggestionHint.last_unit_price)}
                            </InputGroupButton>
                          </InputGroupAddon>
                        )}
                    </InputGroup>
                    {errors.item_name && (
                      <span className="text-[11px] text-rose-500 block">
                        {errors.item_name.message}
                      </span>
                    )}

                    {/* Dropdown Autocomplete Master Item */}
                    {catProfile.showMasterItemAutocomplete &&
                      showItemDropdown &&
                      filteredItemSuggestions.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-border/50">
                          {filteredItemSuggestions.map((s) => (
                            <button
                              key={`${s.item_name}-${s.is_master}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectSuggestion(s);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-accent/60 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-foreground truncate">
                                    {s.item_name}
                                  </span>
                                  {s.is_master && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                      Master
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-[11px] text-muted-foreground block truncate">
                                  {s.category}
                                  {s.last_supplier && s.last_supplier !== "-"
                                    ? ` • ${s.last_supplier}`
                                    : ""}
                                  {s.isi_paket
                                    ? ` • ${s.satuan_beli}: ${s.isi_paket}`
                                    : s.satuan_beli && s.satuan_beli !== "Pcs"
                                    ? ` • ${s.satuan_beli}`
                                    : ""}
                                </span>
                              </div>
                              {s.last_unit_price > 0 && (
                                <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">
                                  {formatRupiah(s.last_unit_price)}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>

                  {/* Toko / Supplier / Kurir / Penerima Gaji / Vendor (Shadcn AdaptiveSelect, Zero Chips) */}
                  {isTukarCash ? (
                    <div className="py-2 border-y border-border/60 text-xs text-muted-foreground">
                      <strong className="text-foreground">Tukar Cash:</strong> Tanpa supplier (kas fisik keluar dari laci kasir). Bukti transfer bank dicatat di kolom keterangan.
                      <input type="hidden" {...register("supplier")} value="-" />
                    </div>
                  ) : isOngkir ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-foreground block">
                          {catProfile.supplierLabel}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowAddCourier((v) => !v)}
                          className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {showAddCourier ? "Tutup" : "+ Kurir Langganan"}
                        </button>
                      </div>
                      <AdaptiveSelect
                        value={supplierVal === "-" ? "" : supplierVal}
                        onValueChange={(nextCourier) => {
                          setValue("supplier", nextCourier || "-", { shouldValidate: true });
                          const matched = courierList.find(
                            (c) => c.name.toLowerCase() === (nextCourier || "").trim().toLowerCase()
                          );
                          setValue("supplier_id", matched ? matched.id : null);
                        }}
                        options={courierOptions}
                        searchable={true}
                        creatable={true}
                        creatablePrefix="Gunakan kurir"
                        placeholder={catProfile.supplierPlaceholder}
                        searchPlaceholder="Cari atau ketik nama kurir..."
                      />

                      {showAddCourier && (
                        <InputGroup className="h-9">
                          <InputGroupInput
                            value={newCourierName}
                            onChange={(e) => setNewCourierName(e.target.value)}
                            placeholder="Nama kurir langganan baru..."
                            className="text-xs"
                          />
                          <InputGroupAddon align="inline-end" className="pr-1.5">
                            <InputGroupButton
                              disabled={isAddingCourier}
                              onClick={handleAddSubscribedCourier}
                              className="font-semibold text-blue-600 dark:text-blue-400"
                            >
                              {isAddingCourier ? "Menyimpan..." : "Simpan Kurir"}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground block">
                        {catProfile.supplierLabel}
                      </label>
                      <AdaptiveSelect
                        value={supplierVal === "-" ? "" : supplierVal}
                        onValueChange={(val) => setValue("supplier", val || "-")}
                        options={supplierComboboxOptions}
                        searchable={true}
                        creatable={true}
                        creatablePrefix="Gunakan"
                        allowClear={true}
                        clearValue="-"
                        placeholder={catProfile.supplierPlaceholder}
                        searchPlaceholder={`Cari atau ketik ${catProfile.supplierLabel.toLowerCase()}...`}
                      />
                    </div>
                  )}

                  {/* Field Kontekstual Spesifik Kategori (Flat Hairline Section, Zero Chips) */}
                  {(catProfile.metaField1Label || catProfile.metaField2Label) && (
                    <div className="pt-3 border-t border-border/70 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {catProfile.metaField1Label && catProfile.metaField1TagPrefix && (
                        <div
                          className={`space-y-1 ${
                            catProfile.metaField2Label ? "" : "sm:col-span-2"
                          }`}
                        >
                          <label className="text-xs font-medium text-foreground block">
                            {catProfile.metaField1Label}
                          </label>
                          <InputGroup className="h-9">
                            <InputGroupInput
                              value={extractNoteTag(catProfile.metaField1TagPrefix, notesVal)}
                              onChange={(e) =>
                                upsertNoteTag(catProfile.metaField1TagPrefix!, e.target.value)
                              }
                              placeholder={catProfile.metaField1Placeholder}
                              className="text-xs"
                            />
                          </InputGroup>
                        </div>
                      )}

                      {catProfile.metaField2Label && catProfile.metaField2TagPrefix && (
                        <div
                          className={`space-y-1 ${
                            catProfile.metaField1Label ? "" : "sm:col-span-2"
                          }`}
                        >
                          <label className="text-xs font-medium text-foreground block">
                            {catProfile.metaField2Label}
                          </label>
                          <InputGroup className="h-9">
                            <InputGroupInput
                              value={extractNoteTag(catProfile.metaField2TagPrefix, notesVal)}
                              onChange={(e) =>
                                upsertNoteTag(catProfile.metaField2TagPrefix!, e.target.value)
                              }
                              placeholder={catProfile.metaField2Placeholder}
                              className="text-xs"
                            />
                          </InputGroup>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pengaturan Otomatis Inventaris Aset (Flat Hairline Section + ReUI InputGroup) */}
                  {isAssetCategory && !initialData && (
                    <div className="pt-3 border-t border-border/70 space-y-2.5">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Inventaris Aset Tetap (SAK EMKM)
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Batas kapitalisasi aktif: {formatRupiah(assetThreshold)}/unit.{" "}
                          {totalPriceVal > 0 &&
                            (totalPriceVal / qtyVal >= assetThreshold
                              ? "Dikapitalisasi ke Neraca (1-2100)."
                              : "Peralatan Nilai Rendah (6-2200).")}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-foreground block">
                            Masa Garansi
                          </label>
                          <InputGroup className="h-9">
                            <InputGroupInput
                              type="number"
                              min={0}
                              placeholder="12"
                              {...register("warranty_months", {
                                setValueAs: (v) => (v === "" ? undefined : Number(v)),
                              })}
                              className="text-xs tabular-nums"
                            />
                            <InputGroupAddon align="inline-end" className="pr-2.5">
                              <InputGroupText className="text-xs">Bulan</InputGroupText>
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-foreground block">
                            Masa Manfaat Penyusutan
                          </label>
                          <InputGroup className="h-9">
                            <InputGroupInput
                              type="number"
                              min={0}
                              placeholder="48"
                              {...register("useful_life_months", {
                                setValueAs: (v) => (v === "" ? undefined : Number(v)),
                              })}
                              className="text-xs tabular-nums"
                            />
                            <InputGroupAddon align="inline-end" className="pr-2.5">
                              <InputGroupText className="text-xs">Bulan</InputGroupText>
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tautan Unit Aset (Flat Hairline Section + Shadcn AdaptiveSelect) */}
                  {isMaintenanceCategory && !initialData && (
                    <div className="pt-3 border-t border-border/70 space-y-2.5">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Tautkan ke Inventaris Aset (Opsional)
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Pilih unit aset yang diservis agar tercatat ke riwayat maintenance aset.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-foreground block">
                            Pilih Unit Aset
                          </label>
                          <AdaptiveSelect
                            value={assetIdVal ? String(assetIdVal) : ""}
                            onValueChange={(val) =>
                              setValue("asset_id", val ? Number(val) : null)
                            }
                            options={assetSelectOptions}
                            placeholder="-- Tidak ditautkan --"
                            searchPlaceholder="Cari kode atau nama aset..."
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-foreground block">
                            Jadwal Servis Berikutnya
                          </label>
                          <DatePicker
                            value={watch("next_service_date") || ""}
                            onChange={(d) => setValue("next_service_date", toIsoDate(d))}
                            className="w-full h-9 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Baris Referensi: No. Invoice, Reimbursement, & Penginput Transaksi */}
                  <div className="pt-3 border-t border-border/70 grid grid-cols-1 sm:grid-cols-12 gap-3">
                    {!isTukarCash && (
                      <>
                        <div className="sm:col-span-4 space-y-1">
                          <label className="text-xs font-medium text-foreground block">
                            {isPayroll ? "No. Slip / Ref" : "No. Invoice / Nota"}
                          </label>
                          <Input
                            placeholder="INV-2026/.. atau -"
                            {...register("invoice_number")}
                            onBlur={(e) => handleCheckInvoice(e.target.value)}
                            className="h-9 text-xs font-mono"
                          />
                        </div>

                        <div className="sm:col-span-4 space-y-1">
                          <label className="text-xs font-medium text-foreground block">
                            Tipe Dana
                          </label>
                          <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background hover:bg-muted/40 cursor-pointer transition-colors">
                            <input
                              type="checkbox"
                              {...register("is_reimbursement")}
                              className="w-3.5 h-3.5 rounded border-input cursor-pointer"
                            />
                            <span className="text-xs font-medium text-foreground truncate">
                              Talangan / Reimburse
                            </span>
                          </label>
                        </div>
                      </>
                    )}

                    <div
                      className={`space-y-1 ${
                        isTukarCash ? "sm:col-span-12" : "sm:col-span-4"
                      }`}
                    >
                      <label className="text-xs font-medium text-foreground block">
                        Penginput (User)
                      </label>
                      <AdaptiveSelect
                        value={userIdVal ? String(userIdVal) : ""}
                        onValueChange={(val) =>
                          setValue("user_id", val ? Number(val) : null)
                        }
                        options={userSelectOptions}
                        placeholder="Otomatis (Web Dashboard)"
                        searchPlaceholder="Cari penginput..."
                      />
                    </div>
                  </div>

                  {invoiceWarning && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{invoiceWarning}</span>
                    </div>
                  )}

                  {/* Keterangan / Catatan & Link Sumber Telegram */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground block">
                        {catProfile.notesLabel}
                      </label>
                      <Input
                        placeholder={catProfile.notesPlaceholder}
                        {...register("notes")}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground block">
                        Link Bukti / Sumber
                      </label>
                      <InputGroup className="h-9">
                        <InputGroupInput
                          placeholder="https://t.me/c/... atau Web Dashboard"
                          {...register("msg_link")}
                          className="text-xs"
                        />
                        {msgLinkVal && parseTelegramLink(msgLinkVal).isUrl && (
                          <InputGroupAddon align="inline-end" className="pr-1.5">
                            <a
                              href={msgLinkVal}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <span>Buka</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </InputGroupAddon>
                        )}
                      </InputGroup>
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
                  bankAccounts={bankAccounts}
                />
              </div>
            </div>

            {/* Sticky Bottom Action Bar */}
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
