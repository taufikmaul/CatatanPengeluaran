import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  autoFillMasterRecipeUnits,
  enqueueMergeMasterItems,
  enqueueBatchMergeMasterItems,
  downloadMasterItemCsvTemplate,
  bulkCreateMasterItemsStructured,
  importMasterItemsCsv,
} from "@/lib/api";
import {
  BulkRowImportDialog,
  type BulkRowColumn,
} from "@/components/common/BulkRowImportDialog";
import { CsvTemplateImportDialog } from "@/components/common/CsvTemplateImportDialog";
import {
  MasterItem,
  DuplicatePair,
  MasterItemAuditResponse,
  MasterItemMergeRequest,
} from "@/types";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/common/DataTable";
import {
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { Filters } from "@/components/reui/filters/filters";
import type { FilterField, FilterQuery, FilterNode } from "@/components/reui/filters/filters-types";
import { createFilterQuery, createFilterRule, isFilterRule } from "@/components/reui/filters/filters-query";
import { ColumnDef, useTable, PaginationState } from "@tanstack/react-table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { formatRupiah } from "@/lib/formatters";
import { toast } from "sonner";
import {
  PackageCheck,
  Plus,
  Trash2,
  Edit3,
  Search,
  FileText,
  Check,
  X,
  RefreshCw,
  DatabaseZap,
  LineChart,
  GitMerge,
  SearchCheck,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  FileSpreadsheet,
  ChevronDown,
  RotateCcw,
  Scale,
  Receipt,
  CheckCircle,
} from "lucide-react";

const RECIPE_UNIT_BASE = ["Gram", "ml", "Pcs", "Butir", "Lembar", "cm"] as const;

function normalizeLocalRecipeUnit(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, string> = {
    g: "Gram",
    gr: "Gram",
    gram: "Gram",
    grams: "Gram",
    kg: "Kg",
    kilogram: "Kg",
    ons: "Ons",
    oz: "Ons",
    ml: "ml",
    cc: "ml",
    l: "Liter",
    lt: "Liter",
    ltr: "Liter",
    liter: "Liter",
    m: "Meter",
    meter: "Meter",
    cm: "cm",
    pcs: "Pcs",
    pc: "Pcs",
    buah: "Pcs",
    butir: "Butir",
    lembar: "Lembar",
    lbr: "Lembar",
    lusin: "Lusin",
    lsn: "Lusin",
    kodi: "Kodi",
    gross: "Gross",
    tray: "Tray",
  };
  return map[cleaned] || raw.trim();
}

function convertParsedQtyToSmallest(
  qty: number,
  rawUnit: string
): { unit: string; factor: number } | null {
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const norm = normalizeLocalRecipeUnit(rawUnit);
  const direct: Record<string, { unit: string; mult: number }> = {
    Kg: { unit: "Gram", mult: 1000 },
    Ons: { unit: "Gram", mult: 100 },
    Gram: { unit: "Gram", mult: 1 },
    Liter: { unit: "ml", mult: 1000 },
    ml: { unit: "ml", mult: 1 },
    Meter: { unit: "cm", mult: 100 },
    cm: { unit: "cm", mult: 1 },
    Lusin: { unit: "Pcs", mult: 12 },
    Kodi: { unit: "Pcs", mult: 20 },
    Gross: { unit: "Pcs", mult: 144 },
    Tray: { unit: "Butir", mult: 30 },
    Butir: { unit: "Butir", mult: 1 },
    Pcs: { unit: "Pcs", mult: 1 },
    Lembar: { unit: "Lembar", mult: 1 },
  };
  const found = direct[norm];
  if (!found) return null;
  return {
    unit: found.unit,
    factor: Math.round(qty * found.mult * 10000) / 10000,
  };
}

function suggestLocalRecipeUnit(
  satuanBeli: string,
  isiPaket: string
): { unit: string; factor: string } | null {
  if (isiPaket && isiPaket.trim()) {
    for (const seg of isiPaket.split(/[,;]/)) {
      const s = seg.trim();
      if (!s) continue;
      const mMult = s.match(
        /(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s*(?:x|@)\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/i
      );
      if (mMult) {
        const outerQty = parseFloat(mMult[1].replace(",", "."));
        const innerQty = parseFloat(mMult[3].replace(",", "."));
        const innerConv = convertParsedQtyToSmallest(innerQty, mMult[4]);
        if (innerConv && outerQty > 0) {
          const total = Math.round(outerQty * innerConv.factor * 10000) / 10000;
          return { unit: innerConv.unit, factor: String(total) };
        }
      }
      const mSingle = s.match(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/);
      if (mSingle) {
        const qtyVal = parseFloat(mSingle[1].replace(",", "."));
        const conv = convertParsedQtyToSmallest(qtyVal, mSingle[2]);
        if (conv) {
          return { unit: conv.unit, factor: String(conv.factor) };
        }
      }
    }
  }

  const normBeli = normalizeLocalRecipeUnit(satuanBeli);
  const direct = convertParsedQtyToSmallest(1, normBeli);
  if (direct) {
    return { unit: direct.unit, factor: String(direct.factor) };
  }
  return null;
}

interface MasterItemsTabProps {
  categories: string[];
  units?: string[];
  onInspectItemPrice?: (itemName: string, itemId?: number) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export const MasterItemsTab: React.FC<MasterItemsTabProps> = ({
  categories,
  units = [
    "Pcs", "Box", "Bungkus", "Pack", "Pouch", "Kg", "Gram", "Dus",
    "Kaleng", "Sak", "Bal", "Botol", "Tray", "Liter", "Roll", "Lembar",
    "Meter", "Ikat", "Butir", "Trans", "Trip"
  ],
  onInspectItemPrice,
  canEdit = true,
  canDelete = false,
}) => {
  const queryClient = useQueryClient();

  // Form states for single add dialog
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState(categories[0] || "Bahan Kue");
  const [aliases, setAliases] = useState("");
  const [defaultSupplier, setDefaultSupplier] = useState("");
  const [satuanBeli, setSatuanBeli] = useState("Box");
  const [tipeSatuan, setTipeSatuan] = useState<"keduanya" | "paket" | "ecer">("keduanya");
  const [isiPaket, setIsiPaket] = useState("");
  const [satuanEcer, setSatuanEcer] = useState("Pouch");
  const [satuanResep, setSatuanResep] = useState("");
  const [konversiResep, setKonversiResep] = useState("");
  const [recipeUnitTouched, setRecipeUnitTouched] = useState(false);

  const recipeUnitOptions = useMemo(
    () => Array.from(new Set([...RECIPE_UNIT_BASE, ...units])),
    [units]
  );

  // Bulk import state
  const [showBulkBox, setShowBulkBox] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkCategory, setBulkCategory] = useState(categories[0] || "Bahan Kue");
  const [isBulkFormOpen, setIsBulkFormOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);

  type BulkMasterItemRow = {
    item_name: string;
    category: string;
    satuan_beli: string;
    tipe_satuan: "keduanya" | "paket" | "ecer";
    isi_paket: string;
    satuan_ecer: string;
    satuan_resep: string;
    konversi_resep: string;
    default_supplier: string;
    aliases: string;
  };

  const masterItemBulkColumns: BulkRowColumn<BulkMasterItemRow>[] = [
    { key: "item_name", label: "Nama Item Baku *", type: "text", required: true, placeholder: "Susu Carnation", widthClass: "min-w-[180px]" },
    {
      key: "category",
      label: "Kategori",
      type: "select",
      widthClass: "min-w-[140px]",
      options: (categories.length ? categories : ["Bahan Kue"]).map((c) => ({ value: c, label: c })),
    },
    {
      key: "satuan_beli",
      label: "Satuan Beli",
      type: "select",
      widthClass: "min-w-[115px]",
      options: units.map((u) => ({ value: u, label: u })),
    },
    {
      key: "tipe_satuan",
      label: "Tipe Satuan",
      type: "select",
      widthClass: "min-w-[130px]",
      options: [
        { value: "keduanya", label: "Paket & Ecer" },
        { value: "paket", label: "Hanya Paket" },
        { value: "ecer", label: "Hanya Ecer" },
      ],
    },
    { key: "isi_paket", label: "Isi Paket", type: "text", placeholder: "12 pcs", widthClass: "min-w-[110px]" },
    {
      key: "satuan_ecer",
      label: "Satuan Ecer",
      type: "select",
      widthClass: "min-w-[115px]",
      options: units.map((u) => ({ value: u, label: u })),
    },
    {
      key: "satuan_resep",
      label: "Satuan Resep",
      type: "select",
      widthClass: "min-w-[115px]",
      options: [{ value: "", label: "Otomatis" }, ...recipeUnitOptions.map((u) => ({ value: u, label: u }))],
    },
    { key: "konversi_resep", label: "Konversi Resep", type: "text", placeholder: "mis. 1000", widthClass: "min-w-[115px]" },
    { key: "default_supplier", label: "Supplier Default", type: "text", placeholder: "Toko Makmur", widthClass: "min-w-[140px]" },
    { key: "aliases", label: "Alias", type: "text", placeholder: "alias1, alias2", widthClass: "min-w-[150px]" },
  ];

  const createEmptyMasterItemRow = (): BulkMasterItemRow => ({
    item_name: "",
    category: categories[0] || "Bahan Kue",
    satuan_beli: units[0] || "Pcs",
    tipe_satuan: "keduanya",
    isi_paket: "",
    satuan_ecer: units[0] || "Pcs",
    satuan_resep: "",
    konversi_resep: "",
    default_supplier: "-",
    aliases: "",
  });

  // Search & filter
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterRecipeStatus, setFilterRecipeStatus] = useState<"" | "configured" | "unconfigured">("");
  const [filterTipeSatuan, setFilterTipeSatuan] = useState<"" | "keduanya" | "paket" | "ecer">("");

  // Edit dialog state
  const [editingItem, setEditingItem] = useState<MasterItem | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    item_name: "",
    category: "",
    aliases: "",
    default_supplier: "",
    satuan_beli: "Pcs",
    tipe_satuan: "keduanya" as "keduanya" | "paket" | "ecer",
    isi_paket: "",
    satuan_ecer: "Pcs",
    satuan_resep: "",
    konversi_resep: "",
  });

  // Audit & Merge state
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditMinScore, setAuditMinScore] = useState(0.70);
  const [ignoredPairKeys, setIgnoredPairKeys] = useState<Set<string>>(new Set());

  // Manual table selection for merge
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Merge modal dialog state
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeItemsList, setMergeItemsList] = useState<MasterItem[]>([]);
  const [targetItemId, setTargetItemId] = useState<number | null>(null);
  const [customMergeName, setCustomMergeName] = useState("");
  const [customMergeCategory, setCustomMergeCategory] = useState("");
  const [customMergeSupplier, setCustomMergeSupplier] = useState("");
  const [mergeAliasesOption, setMergeAliasesOption] = useState(true);
  const [updateExpensesOption, setUpdateExpensesOption] = useState(true);
  const [runMergeInBackground, setRunMergeInBackground] = useState(false);

  const { data: masterRes, isLoading } = useQuery<{
    ok: boolean;
    data: MasterItem[];
    total: number;
  }>({
    queryKey: ["master-items"],
    queryFn: async () => (await api.get("/master-items")).data,
  });

  const masterItems = masterRes?.data || [];

  const filteredItems = useMemo(() => {
    return masterItems.filter((item) => {
      if (filterCat && item.category !== filterCat) return false;
      const isConfigured = Boolean(
        item.satuan_resep && item.konversi_resep && item.konversi_resep > 0
      );
      if (filterRecipeStatus === "configured" && !isConfigured) return false;
      if (filterRecipeStatus === "unconfigured" && isConfigured) return false;
      if (filterTipeSatuan && item.tipe_satuan !== filterTipeSatuan) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.item_name.toLowerCase().includes(q) ||
          (item.aliases || "").toLowerCase().includes(q) ||
          (item.default_supplier || "").toLowerCase().includes(q) ||
          (item.satuan_beli || "").toLowerCase().includes(q) ||
          (item.isi_paket || "").toLowerCase().includes(q) ||
          (item.satuan_ecer || "").toLowerCase().includes(q) ||
          (item.satuan_resep || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [masterItems, filterCat, filterRecipeStatus, filterTipeSatuan, search]);

  // Bento living metrics computation
  const bentoStats = useMemo(() => {
    const total = masterItems.length;
    if (total === 0) {
      return {
        total: 0,
        configuredCount: 0,
        unconfiguredCount: 0,
        configuredPct: 0,
        activeInTxCount: 0,
        categoriesCount: 0,
      };
    }
    let configuredCount = 0;
    let activeInTxCount = 0;
    const catSet = new Set<string>();

    for (const item of masterItems) {
      if (item.category) catSet.add(item.category);
      if (item.satuan_resep && item.konversi_resep && item.konversi_resep > 0) {
        configuredCount++;
      }
      if (item.tx_count && item.tx_count > 0) {
        activeInTxCount++;
      }
    }

    const unconfiguredCount = total - configuredCount;
    const configuredPct = Math.round((configuredCount / total) * 100);

    return {
      total,
      configuredCount,
      unconfiguredCount,
      configuredPct,
      activeInTxCount,
      categoriesCount: catSet.size,
    };
  }, [masterItems]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["master-items"] });
    queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["price-history"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["report"] });
    queryClient.invalidateQueries({ queryKey: ["master-items-audit"] });
    queryClient.invalidateQueries({ queryKey: ["menus"] });
    queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const parsedKonv = Number(konversiResep);
      return (
        await api.post("/master-items", {
          item_name: itemName,
          category,
          aliases,
          default_supplier: defaultSupplier || "-",
          satuan_beli: satuanBeli || "Pcs",
          tipe_satuan: tipeSatuan,
          isi_paket: isiPaket,
          satuan_ecer: satuanEcer || "Pcs",
          satuan_resep: satuanResep.trim() || null,
          konversi_resep: parsedKonv > 0 ? parsedKonv : null,
        })
      ).data;
    },
    onSuccess: () => {
      toast.success("Item baku berhasil disimpan!");
      setIsAddDialogOpen(false);
      setItemName("");
      setAliases("");
      setDefaultSupplier("");
      setIsiPaket("");
      setRecipeUnitTouched(false);
      const nextHint = suggestLocalRecipeUnit(satuanBeli, "");
      setSatuanResep(nextHint ? nextHint.unit : "");
      setKonversiResep(nextHint ? nextHint.factor : "");
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan item baku");
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      return (
        await api.post("/master-items/bulk", {
          raw_text: bulkText,
          default_category: bulkCategory,
        })
      ).data;
    },
    onSuccess: (res) => {
      toast.success(
        `Berhasil memproses daftar! (+${res.added} baru, ${res.updated} diperbarui)`
      );
      setBulkText("");
      setShowBulkBox(false);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengimpor daftar item");
    },
  });

  const bulkFormMutation = useMutation({
    mutationFn: ({ rows, updateExisting }: { rows: BulkMasterItemRow[]; updateExisting: boolean }) =>
      bulkCreateMasterItemsStructured(
        rows.map((r) => {
          const parsedKonv = Number(String(r.konversi_resep || "").replace(",", "."));
          return {
            item_name: r.item_name.trim(),
            category: r.category || categories[0] || "Bahan Kue",
            satuan_beli: r.satuan_beli || "Pcs",
            tipe_satuan: r.tipe_satuan || "keduanya",
            isi_paket: r.isi_paket.trim(),
            satuan_ecer: r.satuan_ecer || "Pcs",
            satuan_resep: r.satuan_resep?.trim() || null,
            konversi_resep: parsedKonv > 0 ? parsedKonv : null,
            default_supplier: r.default_supplier.trim() || "-",
            aliases: r.aliases.trim(),
          };
        }),
        categories[0] || "Bahan Kue",
        updateExisting
      ),
    onSuccess: (res) => {
      toast.success(
        res.message || `Berhasil memproses katalog (+${res.added} baru, ${res.updated} diperbarui).`
      );
      setIsBulkFormOpen(false);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan katalog item masal.");
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: ({ file, updateExisting }: { file: File; updateExisting: boolean }) =>
      importMasterItemsCsv(file, categories[0] || "Bahan Kue", updateExisting),
    onSuccess: (res) => {
      toast.success(res.message || `+${res.added} item diimpor, ${res.updated} diperbarui.`);
      setIsCsvImportOpen(false);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mengimpor CSV master item.");
    },
  });

  const syncExistingMutation = useMutation({
    mutationFn: async () => {
      return (await api.post("/master-items/sync-existing")).data;
    },
    onSuccess: (res) => {
      if (res.matched_count > 0) {
        toast.success(
          `✨ ${res.matched_count} transaksi lama berhasil dicocokkan ke Nama Item Baku!`
        );
      } else {
        toast.info("Semua transaksi sudah sesuai atau belum ada yang cocok.");
      }
      invalidateAll();
    },
    onError: () => {
      toast.error("Gagal mencocokkan transaksi lama");
    },
  });

  const importHistoryMutation = useMutation({
    mutationFn: async () => {
      return (await api.post("/master-items/import-from-history")).data;
    },
    onSuccess: (res) => {
      if (res.added > 0) {
        toast.success(
          `⚡ Berhasil menarik ${res.added} nama barang unik dari histori transaksi!`
        );
      } else {
        toast.info("Semua barang di histori transaksi sudah terdaftar di Master Item.");
      }
      invalidateAll();
    },
    onError: () => {
      toast.error("Gagal menarik data dari histori transaksi");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => {
      return (await api.put(`/master-items/${id}`, payload)).data;
    },
    onSuccess: () => {
      toast.success("Item baku diperbarui");
      setEditingItem(null);
      setIsEditDialogOpen(false);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui item baku");
    },
  });

  const autoFillRecipeMutation = useMutation({
    mutationFn: () => autoFillMasterRecipeUnits(),
    onSuccess: (res) => {
      toast.success(res.message || "Satuan resep berhasil diisi otomatis.");
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengisi otomatis satuan resep.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return (await api.delete(`/master-items/${id}`)).data;
    },
    onSuccess: () => {
      toast.success("Item baku dihapus");
      invalidateAll();
    },
  });

  // Audit Duplikat Query
  const {
    data: auditRes,
    isLoading: isAuditing,
    refetch: refetchAudit,
  } = useQuery<MasterItemAuditResponse>({
    queryKey: ["master-items-audit", auditMinScore],
    queryFn: async () =>
      (await api.get(`/master-items/audit-duplicates?min_score=${auditMinScore}`)).data,
    enabled: showAuditModal,
  });

  // Merge Items Mutation (Instant)
  const mergeMutation = useMutation({
    mutationFn: async (payload: MasterItemMergeRequest) => {
      return (await api.post("/master-items/merge", payload)).data;
    },
    onSuccess: (res) => {
      toast.success(res.message || "Berhasil menggabungkan item!");
      setMergeDialogOpen(false);
      setSelectedIds([]);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["master-items-audit"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menggabungkan item baku");
    },
  });

  // Batch Merge Mutation (Background Queue)
  const batchMergeMutation = useMutation({
    mutationFn: async (merges: any[]) => {
      return await enqueueBatchMergeMasterItems(merges);
    },
    onSuccess: (data) => {
      toast.success(
        `Tugas penggabungan massal berhasil didaftarkan ke antrean latar belakang (#${data.id}).`
      );
      setShowAuditModal(false);
      queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mendaftarkan penggabungan massal");
    },
  });

  const handleBatchMergeAllSuggested = () => {
    if (auditPairs.length === 0) return;
    const count = auditPairs.length;
    if (
      !confirm(
        `Gabungkan ${count} pasang item duplikat sekaligus sesuai rekomendasi sistem? Tugas ini akan dieksekusi secara asinkron di antrean latar belakang.`
      )
    ) {
      return;
    }

    const merges = auditPairs.map((pair) => {
      const isAPrimary = pair.suggested_primary_id === pair.item_a.id;
      const target = isAPrimary ? pair.item_a : pair.item_b;
      const source = isAPrimary ? pair.item_b : pair.item_a;
      return {
        target_item_id: target.id,
        source_item_ids: [source.id],
        custom_name: target.item_name,
        custom_category: target.category,
        custom_supplier: target.default_supplier === "-" ? undefined : target.default_supplier,
        merge_aliases: true,
        update_expenses: true,
      };
    });

    batchMergeMutation.mutate(merges);
  };

  const openMergeDialogForItems = (items: MasterItem[], defaultPrimaryId?: number) => {
    if (items.length < 2) return;
    setMergeItemsList(items);

    const primary =
      (defaultPrimaryId ? items.find((i) => i.id === defaultPrimaryId) : null) ||
      [...items].sort((a, b) => (b.tx_count || 0) - (a.tx_count || 0))[0] ||
      items[0];

    setTargetItemId(primary.id);
    setCustomMergeName(primary.item_name);
    setCustomMergeCategory(primary.category || categories[0] || "Bahan Kue");
    setCustomMergeSupplier(primary.default_supplier === "-" ? "" : primary.default_supplier || "");
    setMergeAliasesOption(true);
    setUpdateExpensesOption(true);
    setRunMergeInBackground(false);
    setMergeDialogOpen(true);
  };

  const handleSelectPrimaryTarget = (item: MasterItem) => {
    setTargetItemId(item.id);
    setCustomMergeName(item.item_name);
    if (item.category) setCustomMergeCategory(item.category);
    if (item.default_supplier && item.default_supplier !== "-") {
      setCustomMergeSupplier(item.default_supplier);
    }
  };

  const handleExecuteMerge = async () => {
    if (!targetItemId) {
      toast.error("Pilih salah satu item sebagai item baku utama!");
      return;
    }
    const sourceIds = mergeItemsList.map((i) => i.id).filter((id) => id !== targetItemId);
    if (sourceIds.length === 0) {
      toast.error("Minimal harus ada satu item duplikat yang digabungkan!");
      return;
    }

    const payload: MasterItemMergeRequest = {
      target_item_id: targetItemId,
      source_item_ids: sourceIds,
      custom_name: customMergeName.trim() || undefined,
      custom_category: customMergeCategory.trim() || undefined,
      custom_supplier: customMergeSupplier.trim() || undefined,
      merge_aliases: mergeAliasesOption,
      update_expenses: updateExpensesOption,
    };

    if (runMergeInBackground) {
      try {
        const job = await enqueueMergeMasterItems(payload);
        toast.success(`Penggabungan item didaftarkan ke antrean latar belakang (#${job.id}).`);
        setMergeDialogOpen(false);
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      } catch (err: any) {
        toast.error(err.response?.data?.detail || "Gagal mendaftarkan tugas penggabungan");
      }
    } else {
      mergeMutation.mutate(payload);
    }
  };

  const toggleSelectItem = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredItems.map((i) => i.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const auditPairs = useMemo(() => {
    if (!auditRes?.pairs) return [];
    return auditRes.pairs.filter((p) => {
      const key = `${Math.min(p.item_a.id, p.item_b.id)}-${Math.max(p.item_a.id, p.item_b.id)}`;
      return !ignoredPairKeys.has(key);
    });
  }, [auditRes, ignoredPairKeys]);

  const ignorePair = (itemAId: number, itemBId: number) => {
    const key = `${Math.min(itemAId, itemBId)}-${Math.max(itemAId, itemBId)}`;
    setIgnoredPairKeys((prev) => new Set([...prev, key]));
  };

  const startEdit = (item: MasterItem) => {
    setEditingItem(item);
    setEditForm({
      item_name: item.item_name,
      category: item.category,
      aliases: item.aliases || "",
      default_supplier: item.default_supplier === "-" ? "" : item.default_supplier,
      satuan_beli: item.satuan_beli || "Pcs",
      tipe_satuan: item.tipe_satuan || "keduanya",
      isi_paket: item.isi_paket || "",
      satuan_ecer: item.satuan_ecer || "Pcs",
      satuan_resep: item.satuan_resep || "",
      konversi_resep:
        item.konversi_resep !== null && item.konversi_resep !== undefined
          ? String(item.konversi_resep)
          : "",
    });
    setIsEditDialogOpen(true);
  };

  const [tablePagination, setTablePagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

  const masterFilterFields: FilterField[] = useMemo(
    () => [
      {
        id: "category",
        label: "Kategori",
        type: "select",
        options: categories.map((c) => ({ label: c, value: c })),
      },
      {
        id: "recipe_status",
        label: "Status Satuan Resep",
        type: "select",
        options: [
          { label: "Sudah Diatur", value: "configured" },
          { label: "Belum Diatur", value: "unconfigured" },
        ],
      },
      {
        id: "tipe_satuan",
        label: "Tipe Satuan",
        type: "select",
        options: [
          { label: "Paket & Ecer", value: "keduanya" },
          { label: "Hanya Paket", value: "paket" },
          { label: "Hanya Ecer", value: "ecer" },
        ],
      },
    ],
    [categories]
  );

  const masterFilterQuery = useMemo(() => {
    const rules = [];
    if (filterCat) {
      rules.push(createFilterRule({ id: "rule-cat", path: ["category"], operator: "is", value: filterCat }));
    }
    if (filterRecipeStatus) {
      rules.push(
        createFilterRule({
          id: "rule-recipe-status",
          path: ["recipe_status"],
          operator: "is",
          value: filterRecipeStatus,
        })
      );
    }
    if (filterTipeSatuan) {
      rules.push(
        createFilterRule({
          id: "rule-tipe-satuan",
          path: ["tipe_satuan"],
          operator: "is",
          value: filterTipeSatuan,
        })
      );
    }
    return createFilterQuery(rules, "and");
  }, [filterCat, filterRecipeStatus, filterTipeSatuan]);

  const handleMasterQueryChange = (nextQuery: FilterQuery) => {
    let newCat = "";
    let newRecipeStatus: "" | "configured" | "unconfigured" = "";
    let newTipeSatuan: "" | "keduanya" | "paket" | "ecer" = "";
    const traverse = (nodes: FilterNode[]) => {
      for (const node of nodes) {
        if (isFilterRule(node)) {
          const fieldId = node.path[0];
          const val = String(node.value ?? "");
          if (fieldId === "category") newCat = val;
          if (fieldId === "recipe_status") {
            if (val === "configured" || val === "unconfigured") newRecipeStatus = val;
          }
          if (fieldId === "tipe_satuan") {
            if (val === "keduanya" || val === "paket" || val === "ecer") newTipeSatuan = val;
          }
        } else if (node.rules) {
          traverse(node.rules);
        }
      }
    };
    if (nextQuery?.rules) traverse(nextQuery.rules);
    setFilterCat(newCat);
    setFilterRecipeStatus(newRecipeStatus);
    setFilterTipeSatuan(newTipeSatuan);
  };

  const masterColumns = useMemo<ColumnDef<DataGridFeatures, MasterItem>[]>(
    () => [
      ...(canDelete
        ? [
            {
              id: "select",
              header: () => (
                <div className="w-10 text-center">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua item yang tampil"
                    checked={
                      filteredItems.length > 0 &&
                      filteredItems.every((i) => selectedIds.includes(i.id))
                    }
                    onChange={handleToggleSelectAllVisible}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
                  />
                </div>
              ),
              cell: ({ row }: { row: { original: MasterItem } }) => {
                const item = row.original;
                const isSelected = selectedIds.includes(item.id);
                return (
                  <div className="w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Pilih ${item.item_name}`}
                      checked={isSelected}
                      onChange={() => toggleSelectItem(item.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
                    />
                  </div>
                );
              },
              size: 50,
            } as ColumnDef<DataGridFeatures, MasterItem>,
          ]
        : []),
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => <DataGridColumnHeader title="Nama Item Baku" column={column} />,
        cell: ({ row }) => {
          const item = row.original;
          const hasRecipe = Boolean(item.satuan_resep && item.konversi_resep && item.konversi_resep > 0);
          return (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onInspectItemPrice?.(item.item_name, item.id)}
                className="group/item inline-flex items-center gap-1.5 text-left font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Buka riwayat harga & perbandingan toko"
              >
                <span>{item.item_name}</span>
                <LineChart className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover/item:opacity-100 transition-opacity" />
              </button>
              {!hasRecipe && (
                <span
                  title="Satuan resep belum diatur"
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                />
              )}
            </div>
          );
        },
        size: 200,
        enableSorting: true,
      },
      {
        accessorKey: "category",
        id: "category",
        header: ({ column }) => <DataGridColumnHeader title="Kategori" column={column} />,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] font-medium">
            {row.original.category}
          </Badge>
        ),
        size: 130,
        enableSorting: true,
      },
      {
        id: "satuan",
        header: () => <span>Satuan & Kemasan</span>,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-0.5 min-w-[140px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-slate-800 text-xs">
                  {item.satuan_beli || "Pcs"}
                </span>
                {item.tipe_satuan === "keduanya" ? (
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                    Paket & Ecer
                  </Badge>
                ) : item.tipe_satuan === "paket" ? (
                  <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                    Paket
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                    Ecer
                  </Badge>
                )}
              </div>
              {item.isi_paket && (
                <div className="text-[11px] text-slate-500 font-normal flex items-center gap-1 flex-wrap pt-0.5">
                  <span className="text-[10px] text-slate-400">Turunan:</span>
                  {item.isi_paket.split(/[,;]\s*/).filter(Boolean).map((p, i) => (
                    <span key={i} className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 text-[10px] font-medium border border-blue-200">
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {item.tipe_satuan === "keduanya" && item.satuan_ecer && item.satuan_ecer !== item.satuan_beli && (
                <div className="text-[10px] text-slate-500">
                  Ecer: <span className="text-slate-600 font-medium">{item.satuan_ecer}</span>
                </div>
              )}
            </div>
          );
        },
        size: 190,
      },
      {
        id: "satuan_resep",
        header: () => <span>Satuan Resep (Terkecil)</span>,
        cell: ({ row }) => {
          const item = row.original;
          const hasRecipe = Boolean(
            item.satuan_resep &&
              item.konversi_resep !== null &&
              item.konversi_resep !== undefined &&
              item.konversi_resep > 0
          );
          if (!hasRecipe) {
            return (
              <div className="flex items-center gap-1.5 min-w-[150px]">
                <span className="text-[11px] text-slate-600 italic">
                  Belum diatur
                </span>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startEdit(item)}
                    className="h-6 px-2 text-[10px] rounded-md text-blue-700 border-blue-200 hover:bg-blue-50"
                  >
                    Atur
                  </Button>
                )}
              </div>
            );
          }

          const computedUnitPrice =
            item.recipe_unit_price ??
            (item.last_unit_price > 0 && item.konversi_resep
              ? item.last_unit_price / item.konversi_resep
              : 0);

          return (
            <div className="space-y-0.5 min-w-[165px]">
              <Badge
                variant="outline"
                className="text-[10px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-900 border-emerald-200 tabular-nums"
              >
                1 {item.satuan_beli || "Pcs"} = {item.konversi_resep}{" "}
                {item.satuan_resep}
              </Badge>
              {computedUnitPrice > 0 && (
                <div className="text-[11px] font-medium text-slate-700 tabular-nums">
                  {formatRupiah(computedUnitPrice)} / {item.satuan_resep}
                </div>
              )}
            </div>
          );
        },
        size: 195,
      },
      {
        accessorKey: "aliases",
        id: "aliases",
        header: ({ column }) => <DataGridColumnHeader title="Kata Kunci / Alias Struk" column={column} />,
        cell: ({ row }) => {
          const item = row.original;
          return item.aliases ? (
            <div className="flex flex-wrap gap-1">
              {item.aliases.split(",").map((a) => (
                <span
                  key={a}
                  className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]"
                >
                  {a.trim()}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-300">-</span>
          );
        },
        size: 170,
      },
      {
        accessorKey: "default_supplier",
        id: "default_supplier",
        header: ({ column }) => <DataGridColumnHeader title="Toko Default" column={column} />,
        cell: ({ row }) => <span>{row.original.last_supplier || row.original.default_supplier || "-"}</span>,
        size: 140,
        enableSorting: true,
      },
      {
        accessorKey: "last_unit_price",
        id: "last_unit_price",
        header: ({ column }) => <DataGridColumnHeader title="Harga Terakhir" column={column} className="justify-end text-right" />,
        cell: ({ row }) => (
          <div className="text-right font-semibold tabular-nums text-emerald-700">
            {row.original.last_unit_price > 0 ? formatRupiah(row.original.last_unit_price) : "-"}
          </div>
        ),
        size: 120,
        enableSorting: true,
      },
      {
        accessorKey: "tx_count",
        id: "tx_count",
        header: ({ column }) => <DataGridColumnHeader title="Transaksi" column={column} className="justify-center text-center" />,
        cell: ({ row }) => (
          <div className="text-center">
            <Badge variant="secondary" className="text-[10px]">
              {row.original.tx_count}x
            </Badge>
          </div>
        ),
        size: 90,
        enableSorting: true,
      },
      {
        id: "actions",
        header: () => <div className="text-right">Aksi</div>,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              {canDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedIds((prev) =>
                      prev.includes(item.id) ? prev : [...prev, item.id]
                    );
                    toast.info(
                      `'${item.item_name}' ditandai. Centang item lain di tabel untuk digabungkan.`
                    );
                  }}
                  className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                  title="Pilih untuk digabung"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                </Button>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startEdit(item)}
                  className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                  title="Edit item"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="h-7 w-7 p-0 text-slate-500 hover:text-rose-600"
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          );
        },
        size: 110,
      },
    ],
    [filteredItems, selectedIds, categories, units, recipeUnitOptions, canEdit, canDelete, handleToggleSelectAllVisible, toggleSelectItem, onInspectItemPrice, deleteMutation]
  );

  const masterTable = useTable({
    features: dataGridFeatures,
    columns: masterColumns,
    data: filteredItems,
    rowCount: filteredItems.length,
    getRowId: (row) => String(row.id),
    state: {
      pagination: tablePagination,
    },
    onPaginationChange: setTablePagination,
  });

  return (
    <div className="space-y-4">
      {/* ── Bento Metrics Strip (Living Overview) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Total Catalog */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-medium">Total Item Baku</span>
            <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <PackageCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
              {bentoStats.total}
            </span>
            <span className="text-[11px] text-slate-400">
              di {bentoStats.categoriesCount} kategori
            </span>
          </div>
        </div>

        {/* Card 2: Kelengkapan Resep (Interactive Pill) */}
        <button
          type="button"
          onClick={() => {
            setFilterRecipeStatus((prev) => (prev === "configured" ? "" : "configured"));
          }}
          className={`p-3.5 rounded-2xl border text-left transition-all ${
            filterRecipeStatus === "configured"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-xs ring-2 ring-emerald-500/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-emerald-200 shadow-2xs"
          }`}
          title="Klik untuk filter: Item sudah diatur satuan resep"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Resep Terkonfigurasi
            </span>
            <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Scale className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-emerald-800 dark:text-emerald-300 tabular-nums">
              {bentoStats.configuredCount}
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              ({bentoStats.configuredPct}%)
            </span>
          </div>
        </button>

        {/* Card 3: Perlu Dilengkapi (Interactive Alert Pill) */}
        <button
          type="button"
          onClick={() => {
            setFilterRecipeStatus((prev) => (prev === "unconfigured" ? "" : "unconfigured"));
          }}
          className={`p-3.5 rounded-2xl border text-left transition-all ${
            filterRecipeStatus === "unconfigured"
              ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 shadow-xs ring-2 ring-amber-500/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-amber-200 shadow-2xs"
          }`}
          title="Klik untuk filter: Item belum punya satuan resep"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Belum Diatur Resep
            </span>
            <div className="w-6 h-6 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-amber-900 dark:text-amber-300 tabular-nums">
              {bentoStats.unconfiguredCount}
            </span>
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              perlu dikonversi
            </span>
          </div>
        </button>

        {/* Card 4: Aktif Digunakan Transaksi */}
        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-medium">Aktif di Transaksi</span>
            <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Receipt className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
              {bentoStats.activeInTxCount}
            </span>
            <span className="text-[11px] text-slate-400">
              pernah dibeli di struk
            </span>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {masterItems.length} Master Item
          </Badge>
          <span className="text-xs text-slate-500 hidden sm:inline">
            Standarisasi nama item untuk pencocokan otomatis transaksi
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
          {canEdit && (
            <Button
              size="sm"
              onClick={() => {
                setItemName("");
                setAliases("");
                setDefaultSupplier("");
                setIsiPaket("");
                setRecipeUnitTouched(false);
                const nextHint = suggestLocalRecipeUnit(satuanBeli, "");
                setSatuanResep(nextHint ? nextHint.unit : "");
                setKonversiResep(nextHint ? nextHint.factor : "");
                setIsAddDialogOpen(true);
              }}
              className="h-8 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Item</span>
            </Button>
          )}

          {canDelete && (
            <>
            {/* Dropdown: Alat & Audit */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl text-xs font-semibold gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
                >
                  <DatabaseZap className="w-3.5 h-3.5 text-blue-500" />
                  <span>Alat &amp; Audit</span>
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 rounded-xl border border-slate-200 dark:border-slate-800 p-1.5 shadow-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                  Pemeliharaan &amp; Deteksi
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={importHistoryMutation.isPending}
                  onClick={() => importHistoryMutation.mutate()}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <DatabaseZap className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <div className="font-medium">
                      {importHistoryMutation.isPending ? "Menarik data..." : "Tarik dari Histori Transaksi"}
                    </div>
                    <div className="text-[10px] text-slate-400">Ekstrak item dari struk belanja lama</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setShowAuditModal(true);
                    refetchAudit();
                  }}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <SearchCheck className="w-3.5 h-3.5 text-amber-500" />
                  <div>
                    <div className="font-medium">Audit Item Duplikat</div>
                    <div className="text-[10px] text-slate-400">Deteksi kesamaan &amp; gabungkan item</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={autoFillRecipeMutation.isPending || masterItems.length === 0}
                  onClick={() => autoFillRecipeMutation.mutate()}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <div>
                    <div className="font-medium">
                      {autoFillRecipeMutation.isPending
                        ? "Mengisi satuan resep..."
                        : "Auto-Isi Satuan Resep"}
                    </div>
                    <div className="text-[10px] text-slate-400">Turunkan satuan terkecil dari satuan beli</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Dropdown: Input & Import Masal */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl text-xs font-semibold gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
                >
                  <Table2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Import &amp; Masal</span>
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 rounded-xl border border-slate-200 dark:border-slate-800 p-1.5 shadow-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                  Pilihan Input Massal
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setIsBulkFormOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <Table2 className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <div className="font-medium">Form Input Masal</div>
                    <div className="text-[10px] text-slate-400">Input spreadsheet interaktif</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setIsCsvImportOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  <div>
                    <div className="font-medium">Import dari CSV</div>
                    <div className="text-[10px] text-slate-400">Upload template file CSV</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                <DropdownMenuItem
                  onClick={() => setShowBulkBox((v) => !v)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <FileText className="w-3.5 h-3.5 text-amber-500" />
                  <div>
                    <div className="font-medium">
                      {showBulkBox ? "Tutup Form Paste" : "Paste Teks Sekaligus"}
                    </div>
                    <div className="text-[10px] text-slate-400">1 baris = 1 item nama baku</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Cocokkan Data Lama */}
            <Button
              variant="outline"
              size="sm"
              disabled={syncExistingMutation.isPending || masterItems.length === 0}
              onClick={() => syncExistingMutation.mutate()}
              className="h-8 rounded-xl text-xs font-semibold gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncExistingMutation.isPending ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Cocokkan ({masterItems.length})</span>
            </Button>
            </>
          )}
        </div>
      </div>

      {/* Bulk Paste Box */}
      {canDelete && showBulkBox && (
        <Card className="border-blue-200 bg-blue-50/40 rounded-2xl shadow-xs">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Paste Daftar Nama Item Sekaligus (1 Baris = 1 Item)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Format per baris:{" "}
                  <code className="bg-white px-1.5 py-0.5 rounded border text-slate-700">
                    Nama Baku | Kategori | Alias | Toko | Satuan Beli | Tipe (keduanya/paket/ecer) | Isi Paket | Satuan Ecer
                  </code>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Kategori Default:</span>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <textarea
              rows={6}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={
                "Contoh:\nSusu Carnation | Bahan Kue | carnation pouch, skm carnation | Toko Makmur | Box | keduanya | 6 pouch @ 2kg | Pouch\nTepung Terigu Cakra | Bahan Kue | cakra kembar, terigu cakra | Toko Roti | Sak | keduanya | 25 kg | Kg\nBox Kue 20x20 | Kemasan | dus 20x20, kotak kue 20 | Toko Plastik | Bal | paket | isi 100 pcs | Pcs"
              }
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkBox(false)}
                className="rounded-xl text-xs"
              >
                Batal
              </Button>
              <Button
                size="sm"
                disabled={!bulkText.trim() || bulkMutation.isPending}
                onClick={() => bulkMutation.mutate()}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold px-4"
              >
                {bulkMutation.isPending ? "Menyimpan..." : "Simpan Semua ke Katalog"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog Tambah Master Item */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-blue-600" />
              Tambah Master Item Baku
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Daftarkan item bahan baku atau kemasan baru untuk standardisasi transaksi &amp; resep menu.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!itemName.trim()) return;
              addMutation.mutate();
            }}
            className="space-y-4 pt-2"
          >
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Nama Item Baku <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="Contoh: Susu Carnation"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="h-9 text-xs rounded-xl"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Kategori
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Tipe Satuan
                </label>
                <select
                  value={tipeSatuan}
                  onChange={(e) => setTipeSatuan(e.target.value as any)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  <option value="keduanya">Paket &amp; Ecer</option>
                  <option value="paket">Hanya Paket</option>
                  <option value="ecer">Hanya Ecer</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Satuan Beli / Kemasan
                </label>
                <select
                  value={satuanBeli}
                  onChange={(e) => {
                    const nextBeli = e.target.value;
                    setSatuanBeli(nextBeli);
                    if (!recipeUnitTouched) {
                      const nextHint = suggestLocalRecipeUnit(nextBeli, isiPaket);
                      setSatuanResep(nextHint ? nextHint.unit : "");
                      setKonversiResep(nextHint ? nextHint.factor : "");
                    }
                  }}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Satuan Eceran
                </label>
                <select
                  value={satuanEcer}
                  onChange={(e) => setSatuanEcer(e.target.value)}
                  disabled={tipeSatuan === "paket"}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Turunan / Isi Kemasan
                </label>
                <Input
                  placeholder="Contoh: 1Kg, 500g atau 1 box isi 6 pouch 2kg"
                  value={isiPaket}
                  onChange={(e) => {
                    const nextIsi = e.target.value;
                    setIsiPaket(nextIsi);
                    if (!recipeUnitTouched) {
                      const nextHint = suggestLocalRecipeUnit(satuanBeli, nextIsi);
                      setSatuanResep(nextHint ? nextHint.unit : "");
                      setKonversiResep(nextHint ? nextHint.factor : "");
                    }
                  }}
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Supplier / Toko Default
                </label>
                <Input
                  placeholder="Opsional (mis. Toko Makmur)"
                  value={defaultSupplier}
                  onChange={(e) => setDefaultSupplier(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Kata Kunci / Alias di Struk (Opsional)
              </label>
              <Input
                placeholder="Pisahkan koma: carnation pouch, skm carnation"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                className="h-9 text-xs rounded-xl"
              />
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                Konfigurasi Satuan Resep (Terkecil)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Satuan Resep (Terkecil)
                  </label>
                  <select
                    value={satuanResep}
                    onChange={(e) => {
                      setRecipeUnitTouched(true);
                      setSatuanResep(e.target.value);
                    }}
                    className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">Auto dari satuan beli / isi paket</option>
                    {recipeUnitOptions.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Isi / 1 {satuanBeli || "Satuan Beli"}
                  </label>
                  <Input
                    type="number"
                    min={0.0001}
                    step="any"
                    placeholder="Contoh: 1000"
                    value={konversiResep}
                    onChange={(e) => {
                      setRecipeUnitTouched(true);
                      setKonversiResep(e.target.value);
                    }}
                    className="h-9 text-xs rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                {satuanResep && Number(konversiResep) > 0 ? (
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/90 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 font-medium">
                    <span className="font-semibold px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                      1 {satuanBeli || "Pcs"}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    {isiPaket ? (
                      <span className="text-slate-600 dark:text-slate-400 text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800">
                        ({isiPaket})
                      </span>
                    ) : null}
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {konversiResep} {satuanResep}
                    </span>
                  </div>
                ) : (
                  <span>Kosongkan jika ingin sistem mendeteksi otomatis (mis. 1 Kg = 1000 Gram).</span>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2 border-t border-slate-100 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddDialogOpen(false)}
                className="rounded-xl text-xs"
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={addMutation.isPending || !itemName.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold gap-1.5 px-4"
              >
                <Plus className="w-3.5 h-3.5" />
                {addMutation.isPending ? "Menyimpan..." : "Simpan Item Baku"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Edit Master Item */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-blue-600" />
              Edit Master Item Baku
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Perbarui rincian, satuan beli/ecer, konversi resep, dan supplier item baku.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingItem || !editForm.item_name.trim()) return;
              const cleanUnit = editForm.satuan_resep.trim();
              const cleanKonv = Number(editForm.konversi_resep);
              if (cleanUnit && !(cleanKonv > 0)) {
                toast.error("Isi faktor konversi resep lebih dari 0.");
                return;
              }
              if (!cleanUnit && editForm.konversi_resep.trim() !== "") {
                toast.error("Pilih satuan resep terkecil.");
                return;
              }
              updateMutation.mutate({
                id: editingItem.id,
                payload: {
                  ...editForm,
                  default_supplier: editForm.default_supplier.trim() || "-",
                  satuan_resep: cleanUnit || null,
                  konversi_resep: cleanUnit && cleanKonv > 0 ? cleanKonv : null,
                },
              });
            }}
            className="space-y-4 pt-2"
          >
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Nama Item Baku <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="Contoh: Susu Carnation"
                value={editForm.item_name}
                onChange={(e) => setEditForm({ ...editForm, item_name: e.target.value })}
                className="h-9 text-xs rounded-xl"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Kategori
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Tipe Satuan
                </label>
                <select
                  value={editForm.tipe_satuan}
                  onChange={(e) => setEditForm({ ...editForm, tipe_satuan: e.target.value as any })}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  <option value="keduanya">Paket &amp; Ecer</option>
                  <option value="paket">Hanya Paket</option>
                  <option value="ecer">Hanya Ecer</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Satuan Beli / Kemasan
                </label>
                <select
                  value={editForm.satuan_beli}
                  onChange={(e) => setEditForm({ ...editForm, satuan_beli: e.target.value })}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Satuan Eceran
                </label>
                <select
                  value={editForm.satuan_ecer}
                  onChange={(e) => setEditForm({ ...editForm, satuan_ecer: e.target.value })}
                  disabled={editForm.tipe_satuan === "paket"}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Turunan / Isi Kemasan
                </label>
                <Input
                  placeholder="Contoh: 1Kg, 500g"
                  value={editForm.isi_paket}
                  onChange={(e) => setEditForm({ ...editForm, isi_paket: e.target.value })}
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Supplier / Toko Default
                </label>
                <Input
                  placeholder="Opsional (mis. Toko Makmur)"
                  value={editForm.default_supplier}
                  onChange={(e) => setEditForm({ ...editForm, default_supplier: e.target.value })}
                  className="h-9 text-xs rounded-xl"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Kata Kunci / Alias di Struk (Opsional)
              </label>
              <Input
                placeholder="Pisahkan koma: alias1, alias2"
                value={editForm.aliases}
                onChange={(e) => setEditForm({ ...editForm, aliases: e.target.value })}
                className="h-9 text-xs rounded-xl"
              />
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Konfigurasi Satuan Resep (Terkecil)
                </span>
                {(() => {
                  const suggested = suggestLocalRecipeUnit(editForm.satuan_beli, editForm.isi_paket);
                  return suggested ? (
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm((prev) => ({
                          ...prev,
                          satuan_resep: suggested.unit,
                          konversi_resep: suggested.factor,
                        }))
                      }
                      className="text-[11px] text-blue-700 dark:text-blue-400 hover:underline font-medium"
                    >
                      Saran: {suggested.factor} {suggested.unit}
                    </button>
                  ) : null;
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Satuan Resep (Terkecil)
                  </label>
                  <select
                    value={editForm.satuan_resep}
                    onChange={(e) => setEditForm({ ...editForm, satuan_resep: e.target.value })}
                    className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">Belum diatur</option>
                    {recipeUnitOptions.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Isi / 1 {editForm.satuan_beli || "Beli"}
                  </label>
                  <Input
                    type="number"
                    min={0.0001}
                    step="any"
                    placeholder="mis. 1000"
                    value={editForm.konversi_resep}
                    onChange={(e) => setEditForm({ ...editForm, konversi_resep: e.target.value })}
                    className="h-9 text-xs rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                {editForm.satuan_resep && Number(editForm.konversi_resep) > 0 ? (
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/90 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 font-medium">
                    <span className="font-semibold px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                      1 {editForm.satuan_beli || "Pcs"}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    {editForm.isi_paket ? (
                      <span className="text-slate-600 dark:text-slate-400 text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800">
                        ({editForm.isi_paket})
                      </span>
                    ) : null}
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {editForm.konversi_resep} {editForm.satuan_resep}
                    </span>
                  </div>
                ) : (
                  <span>Belum ada konversi resep.</span>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2 border-t border-slate-100 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditDialogOpen(false)}
                className="rounded-xl text-xs"
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={updateMutation.isPending || !editForm.item_name.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold gap-1.5 px-4"
              >
                <Check className="w-3.5 h-3.5" />
                {updateMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filter & DataTable List */}
      <DataTable
        table={masterTable}
        recordCount={filteredItems.length}
        isLoading={isLoading}
        headerClassName="p-0"
        emptyMessage={
          <div className="py-12 flex flex-col items-center justify-center text-center px-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3 border border-slate-200 dark:border-slate-700">
              <PackageCheck className="w-6 h-6 stroke-[1.5]" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">
              Tidak Ada Item yang Cocok
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
              {Boolean(search || filterCat || filterRecipeStatus || filterTipeSatuan)
                ? "Tidak ada item master yang sesuai dengan kriteria filter atau pencarian saat ini."
                : "Belum ada item bahan baku yang terdaftar di katalog master."}
            </p>
            <div className="flex items-center gap-2">
              {Boolean(search || filterCat || filterRecipeStatus || filterTipeSatuan) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setFilterCat("");
                    setFilterRecipeStatus("");
                    setFilterTipeSatuan("");
                  }}
                  className="rounded-xl text-xs h-8"
                >
                  Reset Filter
                </Button>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => setIsAddDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-8 font-medium gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Item Baru
                </Button>
              )}
            </div>
          </div>
        }
        header={
          <>
            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Cari nama item baku atau kata kunci alias..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs rounded-xl bg-slate-50/70 dark:bg-slate-800/70"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filters
                variant="advanced"
                advancedMode="popover"
                advancedAlign="end"
                reorderable
                fields={masterFilterFields}
                query={masterFilterQuery}
                onQueryChange={handleMasterQueryChange}
                className="[--filter-field-width:9rem] [--filter-operator-width:6.5rem] [--filter-value-width:11rem]"
              />
              <select
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
                aria-label="Filter kategori master item"
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="">Semua Kategori ({masterItems.length})</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={filterRecipeStatus}
                onChange={(e) =>
                  setFilterRecipeStatus(
                    e.target.value as "" | "configured" | "unconfigured"
                  )
                }
                aria-label="Filter status satuan resep"
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="">Semua Satuan Resep</option>
                <option value="configured">Resep: Sudah Diatur</option>
                <option value="unconfigured">Resep: Belum Diatur</option>
              </select>
              <select
                value={filterTipeSatuan}
                onChange={(e) =>
                  setFilterTipeSatuan(
                    e.target.value as "" | "keduanya" | "paket" | "ecer"
                  )
                }
                aria-label="Filter tipe satuan master item"
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="">Semua Tipe Satuan</option>
                <option value="keduanya">Paket & Ecer</option>
                <option value="paket">Hanya Paket</option>
                <option value="ecer">Hanya Ecer</option>
              </select>
            </div>
          </div>

          {/* Active Filter Chips / Pills */}
          {(Boolean(search) || Boolean(filterCat) || Boolean(filterRecipeStatus) || Boolean(filterTipeSatuan)) && (
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[11px] font-medium text-slate-500">Filter Aktif:</span>
              {search && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-medium">
                  <span>Cari: "{search}"</span>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="hover:text-blue-900 rounded-full p-0.5"
                    title="Hapus pencarian"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filterCat && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                  <span>Kategori: {filterCat}</span>
                  <button
                    type="button"
                    onClick={() => setFilterCat("")}
                    className="hover:text-slate-900 rounded-full p-0.5"
                    title="Hapus filter kategori"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filterRecipeStatus && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                  <span>
                    Resep: {filterRecipeStatus === "configured" ? "Sudah Diatur" : "Belum Diatur"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilterRecipeStatus("")}
                    className="hover:text-slate-900 rounded-full p-0.5"
                    title="Hapus filter resep"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filterTipeSatuan && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                  <span>
                    Tipe:{" "}
                    {filterTipeSatuan === "keduanya"
                      ? "Paket & Ecer"
                      : filterTipeSatuan === "paket"
                      ? "Paket"
                      : "Ecer"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilterTipeSatuan("")}
                    className="hover:text-slate-900 rounded-full p-0.5"
                    title="Hapus filter tipe satuan"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setFilterCat("");
                  setFilterRecipeStatus("");
                  setFilterTipeSatuan("");
                }}
                className="h-6 text-[11px] text-slate-500 hover:text-rose-600 px-2 py-0 ml-1"
              >
                Reset Semua Filter
              </Button>
            </div>
          )}

          {/* Selected Items Merge Action Bar */}
          {selectedIds.length > 0 && (
            <div className="bg-blue-50/80 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900 px-4 py-2.5 flex items-center justify-between gap-3 text-xs animate-in fade-in">
              <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-medium">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>
                  <strong>{selectedIds.length}</strong> item dipilih
                  {selectedIds.length < 2 && (
                    <span className="text-slate-500 font-normal ml-1">
                      (Pilih minimal 2 item untuk digabungkan)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={selectedIds.length < 2}
                  onClick={() => {
                    const selectedItems = masterItems.filter((m) =>
                      selectedIds.includes(m.id)
                    );
                    openMergeDialogForItems(selectedItems);
                  }}
                  className="h-8 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  Gabungkan ({selectedIds.length}) Jadi 1 Item
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds([])}
                  className="h-8 rounded-xl text-xs text-slate-600 hover:text-slate-900"
                >
                  Batal
                </Button>
              </div>
            </div>
          )}
          </>
        }
      />

      {/* Floating Action Bar ketika item dipilih */}
      {selectedIds.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-4 border border-slate-700/80 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold">
              <strong>{selectedIds.length} item</strong> dipilih
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                const selectedItems = masterItems.filter((m) =>
                  selectedIds.includes(m.id)
                );
                openMergeDialogForItems(selectedItems);
              }}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
            >
              <GitMerge className="w-3.5 h-3.5" />
              Gabungkan Jadi 1 Item
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
              className="rounded-xl text-xs text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* Dialog Audit Duplikat Item Master */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
                  <SearchCheck className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Audit Duplikat Katalog Item Baku
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 mt-0.5">
                    Deteksi otomatis item yang sama namun berbeda awalan/akhiran akibat input scan AI atau variasi penulisan.
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Sub-toolbar controls */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/60">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">Tingkat Kemiripan:</span>
                <select
                  value={auditMinScore}
                  onChange={(e) => setAuditMinScore(parseFloat(e.target.value))}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  <option value={0.90}>Sangat Ketat (90% kemiripan)</option>
                  <option value={0.80}>Ketat (80% kemiripan)</option>
                  <option value={0.70}>Normal (70% kemiripan - Rekomendasi)</option>
                  <option value={0.60}>Sensitif / Luas (60% kemiripan)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                {auditPairs.length > 0 && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleBatchMergeAllSuggested}
                    disabled={batchMergeMutation.isPending}
                    className="h-8 rounded-lg text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
                    title="Gabungkan semua rekomendasi item duplikat sekaligus secara asinkron di antrean latar belakang"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    {batchMergeMutation.isPending
                      ? "Mendaftarkan..."
                      : `Gabungkan Semua (${auditPairs.length} Pasang) di Antrean`}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchAudit()}
                  disabled={isAuditing}
                  className="h-8 rounded-lg text-xs gap-1.5"
                >
                  <RefreshCw className={`w-3 h-3 ${isAuditing ? "animate-spin" : ""}`} />
                  Pindai Ulang
                </Button>
                <Badge variant="secondary" className="text-xs py-1 px-2.5 font-semibold">
                  {auditPairs.length} Potensi Duplikat
                </Badge>
              </div>
            </div>
          </DialogHeader>

          {/* Dialog Body - Scrollable */}
          <div className="p-6 overflow-y-auto space-y-4 flex-1 bg-slate-50/30">
            {isAuditing ? (
              <div className="py-16 text-center space-y-3">
                <RefreshCw className="w-7 h-7 text-blue-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-800">
                  Sedang menganalisis katalog item baku...
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Mencocokkan kemiripan teks, susunan kata, awalan/akhiran, dan riwayat transaksi...
                </p>
              </div>
            ) : auditPairs.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">
                  Katalog Rapi! Tidak Ada Duplikat
                </h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Tidak ditemukan item ganda atau variasi awalan/akhiran yang mencurigakan pada tingkat sensitivitas saat ini.
                </p>
              </div>
            ) : (
              auditPairs.map((pair) => {
                const isItemAPrimary = pair.suggested_primary_id === pair.item_a.id;
                return (
                  <div
                    key={`${pair.item_a.id}-${pair.item_b.id}`}
                    className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-3 hover:border-slate-300 transition-colors"
                  >
                    {/* Header info */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-[11px] font-medium bg-amber-50 text-amber-800 border-amber-200"
                        >
                          {pair.reason}
                        </Badge>
                      </div>
                      <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                        {Math.round(pair.similarity_score * 100)}% Kemiripan
                      </Badge>
                    </div>

                    {/* Comparison 2 Items */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Item A */}
                      <div
                        className={`p-3 rounded-xl border transition-all text-xs space-y-1.5 ${
                          isItemAPrimary
                            ? "border-blue-300 bg-blue-50/20 shadow-xs"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 text-sm">
                            {pair.item_a.item_name}
                          </span>
                          {isItemAPrimary && (
                            <Badge className="bg-blue-600 text-white text-[10px] font-medium">
                              ⭐ Disarankan Utama
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {pair.item_a.category}
                          </Badge>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Satuan: <strong>{pair.item_a.satuan_beli || "Pcs"}</strong>
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Toko: <strong>{pair.item_a.default_supplier || "-"}</strong>
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-2">
                          <span className="text-slate-500">
                            Riwayat:{" "}
                            <strong className="text-slate-800">{pair.item_a.tx_count}x transaksi</strong>
                          </span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {pair.item_a.last_unit_price > 0
                              ? formatRupiah(pair.item_a.last_unit_price)
                              : "-"}
                          </span>
                        </div>
                      </div>

                      {/* Item B */}
                      <div
                        className={`p-3 rounded-xl border transition-all text-xs space-y-1.5 ${
                          !isItemAPrimary
                            ? "border-blue-300 bg-blue-50/20 shadow-xs"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 text-sm">
                            {pair.item_b.item_name}
                          </span>
                          {!isItemAPrimary && (
                            <Badge className="bg-blue-600 text-white text-[10px] font-medium">
                              ⭐ Disarankan Utama
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {pair.item_b.category}
                          </Badge>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Satuan: <strong>{pair.item_b.satuan_beli || "Pcs"}</strong>
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Toko: <strong>{pair.item_b.default_supplier || "-"}</strong>
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-2">
                          <span className="text-slate-500">
                            Riwayat:{" "}
                            <strong className="text-slate-800">{pair.item_b.tx_count}x transaksi</strong>
                          </span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {pair.item_b.last_unit_price > 0
                              ? formatRupiah(pair.item_b.last_unit_price)
                              : "-"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => ignorePair(pair.item_a.id, pair.item_b.id)}
                        className="text-slate-400 hover:text-slate-700 text-xs h-8"
                      >
                        Abaikan
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          openMergeDialogForItems(
                            [pair.item_a, pair.item_b],
                            pair.suggested_primary_id
                          )
                        }
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold gap-1.5 h-8 rounded-xl shadow-xs"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        Gabungkan Jadi 1 Item
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAuditModal(false)}
              className="rounded-xl text-xs"
            >
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Konfirmasi & Eksekusi Merge Item */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-6 overflow-y-auto rounded-2xl">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <GitMerge className="w-4 h-4" />
              </div>
              <DialogTitle className="text-base font-bold text-slate-900">
                Gabungkan Item Baku
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500">
              Pilih satu item baku utama yang dipertahankan. Item lainnya akan dilebur, riwayat transaksi dialihkan, dan namanya dicatat ke kata kunci alias.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2 text-xs">
            {/* Step 1: Pilih Item Utama */}
            <div className="space-y-2">
              <label className="font-semibold text-slate-700 block">
                1. Pilih Item Utama yang Dipertahankan:
              </label>
              <div className="space-y-2">
                {mergeItemsList.map((item) => {
                  const isSelected = targetItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectPrimaryTarget(item)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                        isSelected
                          ? "border-blue-500 bg-blue-50/30 ring-1 ring-blue-500"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name="primary_item"
                        checked={isSelected}
                        onChange={() => handleSelectPrimaryTarget(item)}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{item.item_name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {item.category}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                          <span>Toko: <strong>{item.default_supplier || "-"}</strong></span>
                          <span>Satuan: <strong>{item.satuan_beli || "Pcs"}</strong></span>
                          <span>Transaksi: <strong className="text-blue-700">{item.tx_count}x</strong></span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Sesuaikan Nama Baku & Kategori Hasil Gabungan */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="font-semibold text-slate-700 block">
                2. Sesuaikan Data Akhir Hasil Gabungan:
              </label>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Nama Baku Akhir *
                </label>
                <Input
                  value={customMergeName}
                  onChange={(e) => setCustomMergeName(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                  placeholder="Nama baku yang akan digunakan di semua transaksi"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Kategori
                  </label>
                  <select
                    value={customMergeCategory}
                    onChange={(e) => setCustomMergeCategory(e.target.value)}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Toko Default
                  </label>
                  <Input
                    value={customMergeSupplier}
                    onChange={(e) => setCustomMergeSupplier(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                    placeholder="Nama toko"
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Opsi Gabung & Alias */}
            <div className="space-y-2 pt-2 border-t border-slate-100 bg-slate-50/70 p-3 rounded-xl border border-slate-200/60">
              <span className="font-semibold text-slate-800 block text-[11px]">
                Opsi Sinkronisasi & Otomasi AI:
              </span>
              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={mergeAliasesOption}
                  onChange={(e) => setMergeAliasesOption(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>Tambahkan nama item lain ke Kata Kunci / Alias Struk</strong>
                  <br />
                  <span className="text-slate-500 text-[10px]">
                    Scan AI di masa depan yang membaca variasi nama ini akan otomatis disamakan ke item baku utama ini.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={updateExpensesOption}
                  onChange={(e) => setUpdateExpensesOption(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>Alihkan semua riwayat transaksi ke item utama ini</strong>
                  <br />
                  <span className="text-slate-500 text-[10px]">
                    Nama asli di nota belanja fisik tetap tersimpan aman di kolom Catatan/Keterangan.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700 pt-1 border-t border-slate-200/50">
                <input
                  type="checkbox"
                  checked={runMergeInBackground}
                  onChange={(e) => setRunMergeInBackground(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>Jalankan di antrean latar belakang (Background Action)</strong>
                  <br />
                  <span className="text-slate-500 text-[10px]">
                    Proses penggabungan berjalan secara asinkron tanpa menunggu di browser, ideal jika transaksi sangat banyak.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeDialogOpen(false)}
              className="rounded-xl text-xs"
            >
              Batal
            </Button>
            <Button
              size="sm"
              disabled={mergeMutation.isPending || !customMergeName.trim()}
              onClick={handleExecuteMerge}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold gap-1.5 px-4"
            >
              <GitMerge className="w-3.5 h-3.5" />
              {mergeMutation.isPending ? "Menggabungkan..." : "Ya, Gabungkan Sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkRowImportDialog<BulkMasterItemRow>
        isOpen={isBulkFormOpen}
        onClose={() => setIsBulkFormOpen(false)}
        title="Tambah Master Item Masal (Form Tabel)"
        description="Input banyak item bahan baku/kemasan sekaligus atau tempel (paste) baris data langsung dari Excel/Google Sheets."
        columns={masterItemBulkColumns}
        createEmptyRow={createEmptyMasterItemRow}
        requiredKey="item_name"
        showUpdateExistingToggle={true}
        isSubmitting={bulkFormMutation.isPending}
        submitLabel="Simpan Semua Item"
        onSubmit={async (rows, updateExisting) => {
          await bulkFormMutation.mutateAsync({ rows, updateExisting });
        }}
      />

      <CsvTemplateImportDialog
        isOpen={isCsvImportOpen}
        onClose={() => setIsCsvImportOpen(false)}
        title="Import Master Item via Template CSV"
        description="Unduh template CSV resmi untuk Katalog Master Item, isi data item & satuan, lalu unggah kembali ke sistem."
        templateColumns={[
          "Nama Item",
          "Kategori",
          "Satuan Beli",
          "Tipe Satuan (paket/ecer/keduanya)",
          "Isi Paket",
          "Satuan Ecer",
          "Satuan Resep",
          "Konversi Resep",
          "Supplier Default",
          "Alias",
        ]}
        showUpdateExistingToggle={true}
        isImporting={csvImportMutation.isPending}
        onDownloadTemplate={downloadMasterItemCsvTemplate}
        onImportCsv={async (file, updateExisting) => {
          await csvImportMutation.mutateAsync({ file, updateExisting });
        }}
      />

    </div>
  );
};
