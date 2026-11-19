import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  anonymizeAllMenus,
  api,
  bulkCreateMenus,
  bulkUpdateMenus,
  createMenu,
  createMenuShareToken,
  deleteMenu,
  downloadMenusCsv,
  downloadMenusJson,
  downloadMenusTemplateCsv,
  getMenus,
  getMenusJsonPayload,
  importMenusCsv,
  importMenusFromPos,
  setMenuAnonymizeLock,
  updateMenu,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  FoodCostStatus,
  MasterItem,
  MenuHppMode,
  MenuProduct,
  MenuProductPayload,
} from "@/types";
import { MenuFormDialog } from "./MenuFormDialog";
import {
  BulkRowImportDialog,
  type BulkRowColumn,
} from "@/components/common/BulkRowImportDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  Link2,
  Loader2,
  Lock,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Table2,
  Trash2,
  TrendingUp,
  Unlock,
  Upload,
  X,
} from "lucide-react";

interface MenuProductsTabProps {
  isAdmin: boolean;
  units: string[];
}

interface QuickEditRow {
  selling_price: string;
  hpp_manual: string;
  hpp_mode: MenuHppMode;
  is_active: boolean;
}

const PAGE_SIZE = 25;

function getFoodCostBadge(status: FoodCostStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "ideal":
      return {
        label: "Ideal",
        className:
          "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "moderate":
      return {
        label: "Sedang",
        className:
          "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
      };
    case "high":
      return {
        label: "Tinggi",
        className:
          "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
      };
    case "no_price":
      return {
        label: "Belum Ada Harga",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
    default:
      return {
        label: "Belum Ada HPP",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

export const MenuProductsTab: React.FC<MenuProductsTabProps> = ({
  isAdmin,
  units,
}) => {
  const queryClient = useQueryClient();

  const [anonymizeMode, setAnonymizeMode] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [hppStatusFilter, setHppStatusFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(1);

  // Quick-edit massal state
  const [quickEditMode, setQuickEditMode] = useState(false);
  const [quickEdits, setQuickEdits] = useState<Record<number, QuickEditRow>>({});

  // Modal states
  const [formOpen, setFormOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuProduct | null>(null);

  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [bulkFormOpen, setBulkFormOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  type BulkMenuRow = {
    name: string;
    sku: string;
    category: string;
    product_group: string;
    unit: string;
    selling_price: number;
    hpp_manual: number;
    hpp_mode: MenuHppMode;
    notes: string;
    is_active: boolean;
  };

  const menuUnitOptions = Array.from(
    new Set(["Porsi", "Cup", "Box", "Pcs", "Pack", ...units])
  ).map((u) => ({ value: u, label: u }));

  const menuBulkColumns: BulkRowColumn<BulkMenuRow>[] = [
    { key: "name", label: "Nama Menu *", type: "text", required: true, placeholder: "Kopi Susu Gula Aren", widthClass: "min-w-[180px]" },
    { key: "sku", label: "SKU / Kode", type: "text", placeholder: "KSGA-01", widthClass: "min-w-[110px]" },
    { key: "category", label: "Kategori", type: "text", placeholder: "Minuman / Kue", widthClass: "min-w-[130px]" },
    { key: "product_group", label: "Grup Produk", type: "text", placeholder: "Signature", widthClass: "min-w-[120px]" },
    { key: "unit", label: "Satuan", type: "select", widthClass: "min-w-[100px]", options: menuUnitOptions },
    { key: "selling_price", label: "Harga Jual (Rp)", type: "number", min: 0, widthClass: "min-w-[130px]" },
    { key: "hpp_manual", label: "HPP Manual (Rp)", type: "number", min: 0, widthClass: "min-w-[130px]" },
    {
      key: "hpp_mode",
      label: "Mode HPP",
      type: "select",
      widthClass: "min-w-[110px]",
      options: [
        { value: "manual", label: "Manual" },
        { value: "recipe", label: "Resep" },
      ],
    },
    { key: "notes", label: "Catatan", type: "text", placeholder: "Opsional", widthClass: "min-w-[130px]" },
    { key: "is_active", label: "Aktif", type: "checkbox", widthClass: "w-[70px]" },
  ];

  const createEmptyMenuRow = (): BulkMenuRow => ({
    name: "",
    sku: "",
    category: "Lainnya",
    product_group: "",
    unit: "Porsi",
    selling_price: 0,
    hpp_manual: 0,
    hpp_mode: "manual",
    notes: "",
    is_active: true,
  });
  const [updateExistingCsv, setUpdateExistingCsv] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [anonymizeDialogOpen, setAnonymizeDialogOpen] = useState(false);
  const [anonPrefix, setAnonPrefix] = useState("MENU");
  const [preserveCustomAnon, setPreserveCustomAnon] = useState(false);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareExpireHours, setShareExpireHours] = useState(24);
  const [generatedShareUrl, setGeneratedShareUrl] = useState("");

  const {
    data: menuRes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [
      "menus",
      { search, categoryFilter, hppStatusFilter, anonymizeMode },
    ],
    queryFn: () =>
      getMenus({
        search: search.trim() || undefined,
        category: categoryFilter !== "all" ? categoryFilter : undefined,
        hpp_status: hppStatusFilter !== "all" ? hppStatusFilter : undefined,
        anonymize: anonymizeMode,
      }),
  });

  const { data: masterItemsRes } = useQuery<{ ok: boolean; data: MasterItem[] }>({
    queryKey: ["master-items"],
    queryFn: async () => (await api.get("/master-items")).data,
    enabled: formOpen,
  });

  const masterItems = masterItemsRes?.data || [];
  const items = menuRes?.items || [];
  const summary = menuRes?.summary;
  const categories = menuRes?.categories || [];
  const isLockedReadOnly = !!menuRes?.anonymize_locked;
  const effectiveAnonymized = isLockedReadOnly || !!menuRes?.anonymized || anonymizeMode;

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, hppStatusFilter]);

  useEffect(() => {
    if (isLockedReadOnly) {
      setAnonymizeMode(true);
      setQuickEditMode(false);
      setQuickEdits({});
    }
  }, [isLockedReadOnly]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, safePage]);

  const invalidateMenus = () => {
    queryClient.invalidateQueries({ queryKey: ["menus"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: MenuProductPayload) => createMenu(payload),
    onSuccess: (created) => {
      toast.success(`Menu "${created.name}" berhasil ditambahkan.`);
      setFormOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menambahkan menu.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MenuProductPayload }) =>
      updateMenu(id, payload),
    onSuccess: (updated) => {
      toast.success(`Menu "${updated.name}" berhasil diperbarui.`);
      setFormOpen(false);
      setEditingMenu(null);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui menu.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMenu(id),
    onSuccess: () => {
      toast.success("Menu berhasil dihapus.");
      setDeleteTarget(null);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus menu.");
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: () => {
      const updates = Object.entries(quickEdits).map(([idStr, draft]) => ({
        id: Number(idStr),
        selling_price: Math.max(0, Number(draft.selling_price) || 0),
        hpp_manual: Math.max(0, Number(draft.hpp_manual) || 0),
        hpp_mode: draft.hpp_mode,
        is_active: draft.is_active,
      }));
      return bulkUpdateMenus(updates);
    },
    onSuccess: (res) => {
      toast.success(`${res.updated_count} menu berhasil diperbarui sekaligus.`);
      setQuickEdits({});
      setQuickEditMode(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan quick-edit massal.");
    },
  });

  const bulkFormCreateMutation = useMutation({
    mutationFn: ({ rows, updateExisting }: { rows: BulkMenuRow[]; updateExisting: boolean }) =>
      bulkCreateMenus(
        rows.map((r) => ({
          name: r.name.trim(),
          sku: r.sku.trim() || undefined,
          category: r.category.trim() || "Lainnya",
          product_group: r.product_group.trim() || undefined,
          unit: r.unit || "Porsi",
          selling_price: Math.max(0, Number(r.selling_price) || 0),
          hpp_manual: Math.max(0, Number(r.hpp_manual) || 0),
          hpp_mode: r.hpp_mode || "manual",
          notes: r.notes.trim() || undefined,
          is_active: Boolean(r.is_active),
          ingredients: [],
        })),
        updateExisting
      ),
    onSuccess: (res) => {
      toast.success(res.message || `+${res.added} menu ditambahkan, ${res.updated} diperbarui.`);
      setBulkFormOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan menu masal.");
    },
  });

  const posImportMutation = useMutation({
    mutationFn: () => importMenusFromPos(),
    onSuccess: (res) => {
      if (res.total_pos_products === 0) {
        toast.info("Belum ada data item di Transaksi Masuk (POS) untuk ditarik.");
      } else if (res.added > 0) {
        toast.success(
          `${res.added} menu baru ditarik dari histori POS (${res.skipped} sudah terdaftar).`
        );
      } else {
        toast.info("Semua produk dari histori POS sudah terdaftar di database menu.");
      }
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menarik data menu dari POS.");
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: () => {
      if (!csvFile) throw new Error("Pilih file CSV terlebih dahulu.");
      return importMenusCsv(csvFile, updateExistingCsv);
    },
    onSuccess: (res) => {
      toast.success(
        `Import CSV selesai: +${res.added} baru, ${res.updated} diperbarui, ${res.skipped} dilewati.`
      );
      setCsvFile(null);
      setImportCsvOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengimpor file CSV menu.");
    },
  });

  const batchAnonMutation = useMutation({
    mutationFn: () => anonymizeAllMenus(anonPrefix, preserveCustomAnon),
    onSuccess: (res) => {
      toast.success(
        `${res.updated_count} kode nama anonim berhasil diperbarui dengan prefix ${anonPrefix.toUpperCase()}.`
      );
      setAnonymizeDialogOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui kode nama anonim.");
    },
  });

  const lockMutation = useMutation({
    mutationFn: (locked: boolean) => setMenuAnonymizeLock(locked),
    onSuccess: (res) => {
      if (res.anonymize_locked) {
        setAnonymizeMode(true);
        setQuickEditMode(false);
        setQuickEdits({});
        toast.success("Mode Anonim Read-Only dikunci. Semua perubahan data dinonaktifkan.");
      } else {
        toast.success("Kunci Mode Anonim Read-Only dibuka.");
      }
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengubah status kunci mode anonim.");
    },
  });

  const shareTokenMutation = useMutation({
    mutationFn: () => createMenuShareToken(shareExpireHours),
    onSuccess: (res) => {
      const fullUrl = `${window.location.origin}${res.share_path}`;
      setGeneratedShareUrl(fullUrl);
      toast.success("Link presentasi anonim read-only berhasil dibuat.");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal membuat link presentasi.");
    },
  });

  const currentFilterParams = {
    search: search.trim() || undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    hpp_status: hppStatusFilter !== "all" ? hppStatusFilter : undefined,
    anonymize: effectiveAnonymized,
  };

  const handleExportCsv = async () => {
    try {
      await downloadMenusCsv(currentFilterParams);
      toast.success(
        effectiveAnonymized
          ? "File CSV (Mode Anonim) berhasil diunduh."
          : "File CSV database menu berhasil diunduh."
      );
    } catch {
      toast.error("Gagal mengunduh file CSV menu.");
    }
  };

  const handleExportJson = async () => {
    try {
      await downloadMenusJson(currentFilterParams);
      toast.success(
        effectiveAnonymized
          ? "File JSON (Mode Anonim) berhasil diunduh."
          : "File JSON database menu berhasil diunduh."
      );
    } catch {
      toast.error("Gagal mengunduh file JSON menu.");
    }
  };

  const handleCopyJson = async () => {
    try {
      const payload = await getMenusJsonPayload(currentFilterParams);
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(
        effectiveAnonymized
          ? "JSON anonim disalin ke clipboard."
          : "JSON database menu disalin ke clipboard."
      );
    } catch {
      toast.error("Gagal menyalin JSON ke clipboard.");
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadMenusTemplateCsv();
      toast.success("Template CSV siap isi berhasil diunduh.");
    } catch {
      toast.error("Gagal mengunduh template CSV.");
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openCreateModal = () => {
    if (effectiveAnonymized) {
      toast.info("Matikan atau buka kunci Mode Anonim terlebih dahulu untuk menambah menu.");
      return;
    }
    setEditingMenu(null);
    setFormOpen(true);
  };

  const openEditModal = (menu: MenuProduct) => {
    if (effectiveAnonymized) {
      toast.info("Matikan atau buka kunci Mode Anonim terlebih dahulu untuk mengedit menu.");
      return;
    }
    setEditingMenu(menu);
    setFormOpen(true);
  };

  const getQuickRow = (menu: MenuProduct): QuickEditRow => {
    return (
      quickEdits[menu.id] || {
        selling_price: String(menu.selling_price || 0),
        hpp_manual: String(menu.hpp_manual || 0),
        hpp_mode: menu.hpp_mode,
        is_active: menu.is_active,
      }
    );
  };

  const setQuickField = <K extends keyof QuickEditRow>(
    menu: MenuProduct,
    field: K,
    value: QuickEditRow[K]
  ) => {
    setQuickEdits((prev) => {
      const base = prev[menu.id] || {
        selling_price: String(menu.selling_price || 0),
        hpp_manual: String(menu.hpp_manual || 0),
        hpp_mode: menu.hpp_mode,
        is_active: menu.is_active,
      };
      return {
        ...prev,
        [menu.id]: { ...base, [field]: value },
      };
    });
  };

  const dirtyCount = Object.keys(quickEdits).length;

  const hasFilters = Boolean(
    search.trim() || categoryFilter !== "all" || hppStatusFilter !== "all"
  );

  const resetFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setHppStatusFilter("all");
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;
  const displayedTotal = useMemo(() => summary?.total_menus || 0, [summary]);

  return (
    <div className="space-y-4">
      {/* Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="text-xs font-semibold px-2.5 py-1 rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 shadow-xs"
          >
            {displayedTotal} Menu Terdaftar
          </Badge>
          {effectiveAnonymized && (
            <Badge className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold gap-1 px-2.5 py-1 rounded-lg">
              {isLockedReadOnly && <Lock className="w-3 h-3" />}
              {isLockedReadOnly ? "Anonim Terkunci" : "Mode Anonim"}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          {/* 1. Mode Anonim & Proteksi */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={effectiveAnonymized ? "default" : "outline"}
                size="sm"
                className={`h-9 rounded-xl text-xs gap-1.5 ${
                  effectiveAnonymized
                    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                    : ""
                }`}
                aria-pressed={effectiveAnonymized}
              >
                {effectiveAnonymized ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>{isLockedReadOnly ? "Anonim Terkunci" : "Mode Anonim: Aktif"}</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Mode Anonim</span>
                  </>
                )}
                <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
              <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                Privasi &amp; Proteksi Menu
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={isLockedReadOnly}
                onClick={() => {
                  const next = !anonymizeMode;
                  setAnonymizeMode(next);
                  if (next) {
                    setQuickEditMode(false);
                    setQuickEdits({});
                  }
                }}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                {effectiveAnonymized ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-blue-500" />
                    <div>
                      <div className="font-medium">Tampilkan Nama Asli</div>
                      <div className="text-[10px] text-slate-400">Nonaktifkan samaran menu</div>
                    </div>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                    <div>
                      <div className="font-medium">Aktifkan Nama Anonim</div>
                      <div className="text-[10px] text-slate-400">Samarkan nama produk &amp; resep</div>
                    </div>
                  </>
                )}
              </DropdownMenuItem>

              {isAdmin && (
                <>
                  <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                  <DropdownMenuItem
                    onClick={() => {
                      setGeneratedShareUrl("");
                      setShareDialogOpen(true);
                    }}
                    className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                  >
                    <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                    <div>
                      <div className="font-medium">Link Berbagi Anonim</div>
                      <div className="text-[10px] text-slate-400">Bagi link baca tanpa login</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isLockedReadOnly}
                    onClick={() => setAnonymizeDialogOpen(true)}
                    className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                  >
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    <div>
                      <div className="font-medium">Atur Format Kode</div>
                      <div className="text-[10px] text-slate-400">Prefix MENU-001 &amp; garam acak</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={lockMutation.isPending}
                    onClick={() => lockMutation.mutate(!isLockedReadOnly)}
                    className={`text-xs gap-2 py-2 cursor-pointer rounded-lg ${
                      isLockedReadOnly ? "text-amber-600 focus:text-amber-700" : ""
                    }`}
                  >
                    {isLockedReadOnly ? (
                      <>
                        <Unlock className="w-3.5 h-3.5 text-amber-600" />
                        <div>
                          <div className="font-medium text-amber-600 dark:text-amber-400">Buka Kunci Read-Only</div>
                          <div className="text-[10px] text-slate-400">Izinkan pengeditan menu kembali</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5 text-amber-600" />
                        <div>
                          <div className="font-medium">Kunci Read-Only Global</div>
                          <div className="text-[10px] text-slate-400">Bekukan data agar tidak bisa diedit</div>
                        </div>
                      </>
                    )}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 2. Quick-Edit Mode */}
          <Button
            type="button"
            variant={quickEditMode ? "default" : "outline"}
            size="sm"
            disabled={effectiveAnonymized || items.length === 0}
            onClick={() => {
              if (quickEditMode) {
                setQuickEditMode(false);
                setQuickEdits({});
              } else {
                setQuickEditMode(true);
              }
            }}
            className="h-9 rounded-xl text-xs gap-1.5"
          >
            <PencilLine className="w-3.5 h-3.5" />
            <span>{quickEditMode ? "Keluar Quick-Edit" : "Quick-Edit Massal"}</span>
          </Button>

          {/* 3. Input & POS Masal */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={effectiveAnonymized || isLockedReadOnly}
                  className="h-9 rounded-xl text-xs gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Input &amp; POS</span>
                  <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5 shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                  Input Masal &amp; Integrasi
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setBulkFormOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <Table2 className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <div className="font-medium">Tambah Masal</div>
                    <div className="text-[10px] text-slate-400">Spreadsheet input multi-menu</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setImportCsvOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  <div>
                    <div className="font-medium">Import CSV</div>
                    <div className="text-[10px] text-slate-400">Unggah file template CSV</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                <DropdownMenuItem
                  disabled={posImportMutation.isPending}
                  onClick={() => posImportMutation.mutate()}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-indigo-500 ${posImportMutation.isPending ? "animate-spin" : ""}`}
                  />
                  <div>
                    <div className="font-medium">
                      {posImportMutation.isPending ? "Mengambil..." : "Tarik dari POS"}
                    </div>
                    <div className="text-[10px] text-slate-400">Sinkron menu dari mesin kasir</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 4. Export Data */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={items.length === 0}
                className="h-9 rounded-xl text-xs gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
                <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5 shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
              <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                Format Unduhan
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={handleExportCsv}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <div>
                  <div className="font-medium">{effectiveAnonymized ? "Export CSV (Anonim)" : "Export CSV"}</div>
                  <div className="text-[10px] text-slate-400">Tabel Excel / Spreadsheet</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportJson}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <FileJson className="w-3.5 h-3.5 text-amber-500" />
                <div>
                  <div className="font-medium">{effectiveAnonymized ? "Export JSON (Anonim)" : "Export JSON"}</div>
                  <div className="text-[10px] text-slate-400">File JSON terstruktur</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
              <DropdownMenuItem
                onClick={handleCopyJson}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <Copy className="w-3.5 h-3.5 text-blue-500" />
                <div>
                  <div className="font-medium">Salin JSON ke Clipboard</div>
                  <div className="text-[10px] text-slate-400">Copy data mentah ke clipboard</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 5. Primary Action: Tambah Menu */}
          <Button
            type="button"
            size="sm"
            onClick={openCreateModal}
            disabled={effectiveAnonymized}
            className="h-9 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Menu</span>
          </Button>
        </div>
      </div>

      {/* Mode Anonim Privacy Notice */}
      {effectiveAnonymized && (
        <div className="rounded-xl border border-slate-300 bg-slate-900 text-slate-100 dark:border-slate-700 dark:bg-slate-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div>
            <strong>{isLockedReadOnly ? "Proteksi Mode Anonim Read-Only Terkunci:" : "Mode Anonim aktif:"}</strong>{" "}
            Nama asli menu, SKU, catatan, dan nama bahan resep disembunyikan oleh server (menjadi kode MENU-001 &amp; Bahan #1).
            {isLockedReadOnly
              ? " Semua aksi ubah/hapus/import dinonaktifkan sampai Owner membuka kunci."
              : ""}
          </div>
          {!isLockedReadOnly ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAnonymizeMode(false)}
              className="h-8 text-xs shrink-0 self-start sm:self-auto"
            >
              Kembali ke Nama Asli
            </Button>
          ) : isAdmin ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => lockMutation.mutate(false)}
              disabled={lockMutation.isPending}
              className="h-8 text-xs shrink-0 self-start sm:self-auto gap-1"
            >
              <Unlock className="w-3.5 h-3.5" />
              Buka Kunci
            </Button>
          ) : null}
        </div>
      )}

      {/* Quick-Edit Massal Action Bar */}
      {quickEditMode && !effectiveAnonymized && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div className="text-blue-900 dark:text-blue-200">
            <strong>Mode Quick-Edit Massal aktif:</strong> Ubah Harga Jual, HPP Manual, Mode HPP, atau Status Aktif langsung pada tabel di bawah lalu simpan sekaligus.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickEdits({});
                setQuickEditMode(false);
              }}
              className="h-9 text-xs gap-1 bg-white dark:bg-slate-900"
            >
              <X className="w-3.5 h-3.5" />
              <span>Batal</span>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={dirtyCount === 0 || bulkUpdateMutation.isPending}
              onClick={() => bulkUpdateMutation.mutate()}
              className="h-9 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {bulkUpdateMutation.isPending
                  ? "Menyimpan..."
                  : `Simpan Perubahan (${dirtyCount})`}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* Real-Data KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="border-slate-200 dark:border-slate-800 shadow-none">
          <CardContent className="p-3.5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Total Menu Terdaftar
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
              {summary?.total_menus ?? 0}
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              {summary?.active_menus ?? 0} aktif, {summary?.recipe_based_count ?? 0} pakai resep
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-none">
          <CardContent className="p-3.5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Rata-rata Food Cost
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
              {summary && summary.avg_food_cost_pct > 0 ? `${summary.avg_food_cost_pct}%` : "-"}
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              Rata-rata margin: {summary && summary.avg_margin_pct > 0 ? `${summary.avg_margin_pct}%` : "-"}
            </div>
          </CardContent>
        </Card>

        <button
          type="button"
          onClick={() =>
            setHppStatusFilter((prev) => (prev === "missing_hpp" ? "all" : "missing_hpp"))
          }
          className="text-left rounded-xl focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <Card
            className={`border-slate-200 dark:border-slate-800 shadow-none transition-colors ${
              hppStatusFilter === "missing_hpp" ? "ring-2 ring-blue-600" : "hover:bg-slate-50 dark:hover:bg-slate-900"
            }`}
          >
            <CardContent className="p-3.5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                Belum Memiliki HPP
              </div>
              <div className="text-lg font-bold text-amber-700 dark:text-amber-300 tabular-nums mt-0.5">
                {summary?.missing_hpp_count ?? 0}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Klik untuk filter menu tanpa HPP
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          onClick={() => setHppStatusFilter((prev) => (prev === "high" ? "all" : "high"))}
          className="text-left rounded-xl focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <Card
            className={`border-slate-200 dark:border-slate-800 shadow-none transition-colors ${
              hppStatusFilter === "high" ? "ring-2 ring-rose-600" : "hover:bg-slate-50 dark:hover:bg-slate-900"
            }`}
          >
            <CardContent className="p-3.5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                Food Cost Tinggi (&gt;45%)
              </div>
              <div className="text-lg font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-0.5">
                {summary?.high_count ?? 0}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Ideal: {summary?.ideal_count ?? 0}, Sedang: {summary?.moderate_count ?? 0}
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          onClick={() =>
            setHppStatusFilter((prev) => (prev === "price_drift" ? "all" : "price_drift"))
          }
          className="text-left rounded-xl focus-visible:outline-2 focus-visible:outline-blue-600 col-span-2 lg:col-span-1"
        >
          <Card
            className={`border-slate-200 dark:border-slate-800 shadow-none transition-colors ${
              hppStatusFilter === "price_drift" ? "ring-2 ring-amber-600" : "hover:bg-slate-50 dark:hover:bg-slate-900"
            }`}
          >
            <CardContent className="p-3.5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-rose-600" />
                <span>Harga Bahan Naik (&ge;5%)</span>
              </div>
              <div className="text-lg font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-0.5">
                {summary?.price_drift_menus_count ?? 0}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Klik untuk cek menu terdampak
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* Filters */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-none">
        <CardContent className="p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="relative lg:col-span-2">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  effectiveAnonymized
                    ? "Cari kode anonim atau kategori..."
                    : "Cari nama menu, kode anonim, SKU, kategori..."
                }
                className="pl-8 h-10 sm:h-9 text-xs"
                aria-label="Cari menu"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter kategori menu"
              className="h-10 sm:h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="all">Semua Kategori</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <select
                value={hppStatusFilter}
                onChange={(e) => setHppStatusFilter(e.target.value)}
                aria-label="Filter status food cost"
                className="h-10 sm:h-9 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="all">Semua Status Food Cost</option>
                <option value="ideal">Ideal (&le;35%)</option>
                <option value="moderate">Sedang (35% - 45%)</option>
                <option value="high">Tinggi (&gt;45%)</option>
                <option value="price_drift">Harga Bahan Naik (&ge;5%)</option>
                <option value="missing_hpp">Belum Ada HPP</option>
                <option value="no_price">Belum Ada Harga Jual</option>
              </select>

              {hasFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-10 sm:h-9 px-2.5 text-xs shrink-0"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Data Surface: Loading / Error / Empty / Data */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-none overflow-hidden">
        {isLoading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Memuat database menu dan perhitungan HPP...</span>
          </div>
        ) : isError ? (
          <div className="py-10 px-4 flex flex-col items-center justify-center gap-2 text-center">
            <AlertCircle className="w-6 h-6 text-rose-600" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Gagal memuat database menu dan HPP.
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Periksa koneksi server lalu coba muat ulang data.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Coba Lagi
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-3">
            <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
            {hasFilters ? (
              <>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Tidak ada menu yang sesuai filter
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Ubah kata kunci pencarian atau reset filter untuk melihat semua menu.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                  Reset Filter
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Database Menu / Produk masih kosong
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                  Tambahkan menu secara manual, tarik daftar produk dari histori Transaksi Masuk (POS), atau import file CSV daftar menu dan HPP.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={openCreateModal}
                    disabled={effectiveAnonymized}
                    className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tambah Menu Pertama
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => posImportMutation.mutate()}
                    disabled={posImportMutation.isPending || isLockedReadOnly}
                    className="gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tarik dari POS
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isLockedReadOnly}
                    onClick={() => setImportCsvOpen(true)}
                    className="gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import CSV
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                  <tr>
                    <th className="w-9 px-2 py-2.5" aria-label="Expand resep" />
                    <th className="text-left px-3 py-2.5 font-semibold">
                      {effectiveAnonymized ? "Kode Anonim Menu" : "Nama Menu / Produk"}
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold">Kategori</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Harga Jual</th>
                    <th className="text-right px-3 py-2.5 font-semibold">
                      {quickEditMode ? "HPP Manual & Mode" : "HPP / Food Cost"}
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">Food Cost %</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Margin Kotor</th>
                    <th className="text-right px-3 py-2.5 font-semibold">
                      {quickEditMode ? "Aktif" : "Aksi"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pagedItems.map((menu) => {
                    const isExpanded = !!expandedIds[menu.id];
                    const fcBadge = getFoodCostBadge(menu.food_cost_status);
                    const qRow = getQuickRow(menu);
                    const isDirty = !!quickEdits[menu.id];

                    return (
                      <React.Fragment key={menu.id}>
                        <tr
                          className={`hover:bg-slate-50/70 dark:hover:bg-slate-900/40 ${
                            isDirty ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                          }`}
                        >
                          <td className="px-2 py-2.5 text-center">
                            {(menu.ingredient_count > 0 || (menu.other_fee && menu.other_fee > 0)) && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(menu.id)}
                                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                                aria-label={`Lihat rincian resep ${menu.display_name}`}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {menu.display_name}
                              </span>
                              {!effectiveAnonymized && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                                  {menu.anonymous_name}
                                </span>
                              )}
                              {!menu.is_active && (
                                <Badge variant="outline" className="text-[10px] text-slate-600">
                                  Nonaktif
                                </Badge>
                              )}
                              {menu.has_price_drift && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 gap-1"
                                >
                                  <TrendingUp className="w-3 h-3" />
                                  Bahan +{menu.max_ingredient_increase_pct}%
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              Satuan: {menu.unit}
                              {!effectiveAnonymized && menu.sku ? ` | SKU: ${menu.sku}` : ""}
                              {menu.product_group ? ` | Grup: ${menu.product_group}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline" className="text-[10px] font-medium">
                              {menu.category}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
                            {quickEditMode ? (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={qRow.selling_price}
                                onChange={(e) =>
                                  setQuickField(menu, "selling_price", e.target.value)
                                }
                                aria-label={`Harga jual ${menu.display_name}`}
                                className="h-8 w-28 ml-auto text-right text-xs tabular-nums"
                              />
                            ) : menu.selling_price > 0 ? (
                              formatRupiah(menu.selling_price)
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {quickEditMode ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={qRow.hpp_manual}
                                  onChange={(e) =>
                                    setQuickField(menu, "hpp_manual", e.target.value)
                                  }
                                  aria-label={`HPP manual ${menu.display_name}`}
                                  className="h-8 w-28 text-right text-xs tabular-nums"
                                />
                                <select
                                  value={qRow.hpp_mode}
                                  onChange={(e) =>
                                    setQuickField(
                                      menu,
                                      "hpp_mode",
                                      e.target.value as MenuHppMode
                                    )
                                  }
                                  aria-label={`Mode HPP ${menu.display_name}`}
                                  className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 text-[11px]"
                                >
                                  <option value="auto">Auto</option>
                                  <option value="manual">Manual</option>
                                  <option value="recipe">Resep</option>
                                </select>
                              </div>
                            ) : (
                              <>
                                <div className="font-semibold text-slate-900 dark:text-slate-100">
                                  {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                                  {menu.active_hpp_source === "recipe"
                                    ? `Resep (${menu.ingredient_count} bahan${menu.other_fee > 0 ? " + lain" : ""})`
                                    : "Input Manual"}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="inline-flex flex-col items-center gap-0.5">
                              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                                {menu.selling_price > 0 && menu.effective_hpp > 0
                                  ? `${menu.food_cost_pct.toFixed(1)}%`
                                  : "-"}
                              </span>
                              <Badge variant="outline" className={`text-[10px] ${fcBadge.className}`}>
                                {fcBadge.label}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <div
                              className={`font-semibold ${
                                menu.gross_margin >= 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-rose-700 dark:text-rose-400"
                              }`}
                            >
                              {menu.selling_price > 0 ? formatRupiah(menu.gross_margin) : "-"}
                            </div>
                            {menu.selling_price > 0 && (
                              <div className="text-[10px] text-slate-600 dark:text-slate-400">
                                {menu.margin_pct.toFixed(1)}%
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {quickEditMode ? (
                              <input
                                type="checkbox"
                                checked={qRow.is_active}
                                onChange={(e) =>
                                  setQuickField(menu, "is_active", e.target.checked)
                                }
                                aria-label={`Status aktif ${menu.display_name}`}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600"
                              />
                            ) : (
                              <div className="inline-flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditModal(menu)}
                                  disabled={effectiveAnonymized}
                                  aria-label={`Edit ${menu.display_name}`}
                                  className="h-8 w-8 p-0 text-slate-600 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </Button>
                                {isAdmin && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={isLockedReadOnly}
                                    onClick={() => setDeleteTarget(menu)}
                                    aria-label={`Hapus ${menu.display_name}`}
                                    className="h-8 w-8 p-0 text-slate-600 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>

                        {isExpanded && (menu.ingredients.length > 0 || (menu.other_fee && menu.other_fee > 0)) && (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/60">
                            <td colSpan={8} className="px-8 py-3">
                              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex flex-wrap items-center justify-between gap-2">
                                <span>
                                  Komposisi Bahan Resep ({menu.ingredients.length} item, total HPP resep{" "}
                                  {formatRupiah(menu.recipe_hpp)})
                                </span>
                                {menu.other_fee > 0 && (
                                  <span className="text-[10px] text-slate-500 font-normal">
                                    Bahan: {formatRupiah(menu.subtotal_ingredients ?? (menu.recipe_hpp - menu.other_fee))} + Biaya Lain: {formatRupiah(menu.other_fee)}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                {menu.ingredients.map((ing, idx) => (
                                  <div
                                    key={ing.id || idx}
                                    className="flex items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300 border-b border-slate-200/70 dark:border-slate-800 pb-1 last:border-0"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium">{ing.ingredient_name}</span>
                                      <span className="text-slate-600 dark:text-slate-400">
                                        {ing.qty} {ing.unit}
                                        {ing.yield_factor !== 1 ? ` (pembagi ${ing.yield_factor})` : ""}
                                      </span>
                                      {ing.price_drift_alert && ing.price_change_pct != null && (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 text-[10px] font-medium">
                                          <TrendingUp className="w-3 h-3" />
                                          Naik +{ing.price_change_pct}%
                                          {ing.master_prev_price != null && ing.master_latest_price != null
                                            ? ` (${formatRupiah(ing.master_prev_price)} -> ${formatRupiah(ing.master_latest_price)})`
                                            : ""}
                                        </span>
                                      )}
                                    </div>
                                    <div className="tabular-nums font-medium shrink-0">
                                      {formatRupiah(ing.line_cost || 0)}
                                    </div>
                                  </div>
                                ))}

                                {menu.other_fee > 0 && (
                                  <div className="flex items-center justify-between gap-2 text-[11px] text-amber-700 dark:text-amber-400 border-t border-dashed border-slate-300 dark:border-slate-700 pt-1 mt-1 font-medium">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold">+ Biaya Lainnya</span>
                                      {menu.other_fee_description && (
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                                          ({menu.other_fee_description})
                                        </span>
                                      )}
                                    </div>
                                    <div className="tabular-nums font-semibold shrink-0">
                                      {formatRupiah(menu.other_fee)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Reflow Cards */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {pagedItems.map((menu) => {
                const fcBadge = getFoodCostBadge(menu.food_cost_status);
                const isExpanded = !!expandedIds[menu.id];
                const qRow = getQuickRow(menu);

                return (
                  <div key={menu.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 break-words">
                          {menu.display_name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {menu.category}
                          </Badge>
                          {!effectiveAnonymized && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                              {menu.anonymous_name}
                            </span>
                          )}
                          <Badge variant="outline" className={`text-[10px] ${fcBadge.className}`}>
                            {fcBadge.label}
                          </Badge>
                          {menu.has_price_drift && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                            >
                              Bahan +{menu.max_ingredient_increase_pct}%
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {menu.selling_price > 0 ? formatRupiah(menu.selling_price) : "-"}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          per {menu.unit}
                        </div>
                      </div>
                    </div>

                    {quickEditMode ? (
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 p-2.5 text-xs">
                        <div>
                          <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Harga Jual
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={qRow.selling_price}
                            onChange={(e) =>
                              setQuickField(menu, "selling_price", e.target.value)
                            }
                            className="h-9 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                            HPP Manual
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={qRow.hpp_manual}
                            onChange={(e) =>
                              setQuickField(menu, "hpp_manual", e.target.value)
                            }
                            className="h-9 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Mode HPP
                          </label>
                          <select
                            value={qRow.hpp_mode}
                            onChange={(e) =>
                              setQuickField(menu, "hpp_mode", e.target.value as MenuHppMode)
                            }
                            className="h-9 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs"
                          >
                            <option value="auto">Auto</option>
                            <option value="manual">Manual</option>
                            <option value="recipe">Resep</option>
                          </select>
                        </div>
                        <div className="flex items-end pb-1.5">
                          <label className="inline-flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={qRow.is_active}
                              onChange={(e) =>
                                setQuickField(menu, "is_active", e.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                            <span>Aktif</span>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/70 p-2 text-xs tabular-nums">
                        <div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">HPP</div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">
                            Food Cost
                          </div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {menu.selling_price > 0 && menu.effective_hpp > 0
                              ? `${menu.food_cost_pct.toFixed(1)}%`
                              : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">
                            Margin
                          </div>
                          <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                            {menu.selling_price > 0 ? formatRupiah(menu.gross_margin) : "-"}
                          </div>
                        </div>
                      </div>
                    )}

                    {(menu.ingredient_count > 0 || (menu.other_fee && menu.other_fee > 0)) && (
                      <div>
                        <button
                          type="button"
                          onClick={() => toggleExpand(menu.id)}
                          className="min-h-[44px] w-full flex items-center justify-between px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                          aria-expanded={isExpanded}
                        >
                          <span>
                            Resep ({menu.ingredient_count} bahan{menu.other_fee > 0 ? " + biaya lain" : ""})
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-1 pl-2 text-[11px] text-slate-700 dark:text-slate-300">
                            {menu.ingredients.map((ing, idx) => (
                              <div key={ing.id || idx} className="flex justify-between gap-2">
                                <span>
                                  {ing.ingredient_name} ({ing.qty} {ing.unit})
                                  {ing.price_drift_alert && ing.price_change_pct != null
                                    ? ` [+${ing.price_change_pct}%]`
                                    : ""}
                                </span>
                                <span className="tabular-nums font-medium shrink-0">
                                  {formatRupiah(ing.line_cost || 0)}
                                </span>
                              </div>
                            ))}
                            {menu.other_fee > 0 && (
                              <div className="flex justify-between gap-2 text-amber-700 dark:text-amber-400 font-medium border-t border-dashed border-slate-200 dark:border-slate-800 pt-1 mt-1">
                                <span>
                                  + Biaya Lainnya
                                  {menu.other_fee_description ? ` (${menu.other_fee_description})` : ""}
                                </span>
                                <span className="tabular-nums font-semibold shrink-0">
                                  {formatRupiah(menu.other_fee)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {!quickEditMode && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(menu)}
                          disabled={effectiveAnonymized}
                          className="flex-1 min-h-[44px] text-xs gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Menu</span>
                        </Button>
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isLockedReadOnly}
                            onClick={() => setDeleteTarget(menu)}
                            className="min-h-[44px] min-w-[44px] text-rose-700 border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-900"
                            aria-label={`Hapus ${menu.display_name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                <span>
                  Halaman {safePage} dari {totalPages} ({items.length} menu)
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8 px-2.5 text-xs gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Sebelumnya</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-8 px-2.5 text-xs gap-1"
                  >
                    <span>Berikutnya</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Form Modal */}
      <MenuFormDialog
        open={formOpen}
        onOpenChange={(val) => {
          setFormOpen(val);
          if (!val) setEditingMenu(null);
        }}
        editingMenu={editingMenu}
        masterItems={masterItems}
        units={units}
        existingCategories={categories}
        isSubmitting={isMutating}
        onSubmit={(payload) => {
          if (editingMenu) {
            updateMutation.mutate({ id: editingMenu.id, payload });
          } else {
            createMutation.mutate(payload);
          }
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Menu / Produk</DialogTitle>
            <DialogDescription>
              Hapus <strong>{deleteTarget?.display_name}</strong> beserta rincian resepnya dari database? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus Menu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={importCsvOpen} onOpenChange={setImportCsvOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Menu &amp; HPP dari CSV</DialogTitle>
            <DialogDescription>
              Unggah file CSV dengan kolom seperti Nama Menu, Kategori, Harga Jual, HPP (atau Food Cost), dan Kode Anonim (opsional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2 text-slate-700 dark:text-slate-300">
              <div className="font-semibold">Format header yang didukung:</div>
              <div className="font-mono text-[11px]">
                Nama Menu, Kode Anonim, SKU, Kategori, Grup Produk, Satuan, Harga Jual, HPP, Catatan
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="h-8 text-xs gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Unduh Template CSV</span>
              </Button>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-700 dark:text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-medium file:bg-white file:text-slate-700 hover:file:bg-slate-50"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={updateExistingCsv}
                onChange={(e) => setUpdateExistingCsv(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Perbarui harga &amp; HPP jika nama menu sudah ada</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportCsvOpen(false)}
              disabled={csvImportMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => csvImportMutation.mutate()}
              disabled={!csvFile || csvImportMutation.isPending}
            >
              {csvImportMutation.isPending ? "Mengimpor..." : "Import Sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Anonymize Codes Dialog */}
      <Dialog open={anonymizeDialogOpen} onOpenChange={setAnonymizeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Atur Kode Nama Anonim</DialogTitle>
            <DialogDescription>
              Buat atau perbarui kode anonim berurutan untuk seluruh menu di database (contoh: MENU-001, MENU-002).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="anon-prefix" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Prefix Kode Anonim
              </label>
              <Input
                id="anon-prefix"
                value={anonPrefix}
                onChange={(e) => setAnonPrefix(e.target.value)}
                placeholder="MENU"
                className="h-9 text-xs font-mono uppercase"
                maxLength={20}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveCustomAnon}
                onChange={(e) => setPreserveCustomAnon(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Pertahankan kode anonim yang sudah ada (hanya isi yang kosong)</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAnonymizeDialogOpen(false)}
              disabled={batchAnonMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => batchAnonMutation.mutate()}
              disabled={!anonPrefix.trim() || batchAnonMutation.isPending}
            >
              {batchAnonMutation.isPending ? "Memproses..." : "Terapkan Kode Anonim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Anonymized Read-Only Link Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Link Presentasi Anonim (Read-Only)</DialogTitle>
            <DialogDescription>
              Bagikan data menu, HPP, dan Food Cost % ke pihak luar tanpa membocorkan nama menu asli, SKU, atau nama bahan baku.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="share-expiry" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Masa Berlaku Link
              </label>
              <select
                id="share-expiry"
                value={shareExpireHours}
                onChange={(e) => setShareExpireHours(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
              >
                <option value={24}>24 Jam (1 Hari)</option>
                <option value={72}>72 Jam (3 Hari)</option>
                <option value={168}>168 Jam (7 Hari)</option>
              </select>
            </div>

            {generatedShareUrl && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30 p-3 space-y-2">
                <div className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Link Read-Only Siap Dibagikan</span>
                </div>
                <Input
                  readOnly
                  value={generatedShareUrl}
                  className="h-8 text-[11px] font-mono bg-white dark:bg-slate-900"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(generatedShareUrl);
                    toast.success("Link presentasi disalin.");
                  }}
                  className="h-8 text-xs gap-1.5 w-full"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Link</span>
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShareDialogOpen(false)}
            >
              Tutup
            </Button>
            <Button
              type="button"
              onClick={() => shareTokenMutation.mutate()}
              disabled={shareTokenMutation.isPending}
            >
              {shareTokenMutation.isPending ? "Membuat..." : "Generate Link Anonim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkRowImportDialog<BulkMenuRow>
        isOpen={bulkFormOpen}
        onClose={() => setBulkFormOpen(false)}
        title="Tambah Menu Produk Masal (Form Tabel)"
        description="Input banyak menu sekaligus atau tempel (paste) baris data dari Excel/Google Sheets. Resep bahan bisa dilengkapi kemudian pada masing-masing menu."
        columns={menuBulkColumns}
        createEmptyRow={createEmptyMenuRow}
        requiredKey="name"
        showUpdateExistingToggle={true}
        isSubmitting={bulkFormCreateMutation.isPending}
        submitLabel="Simpan Semua Menu"
        onSubmit={async (rows, updateExisting) => {
          await bulkFormCreateMutation.mutateAsync({ rows, updateExisting });
        }}
      />
    </div>
  );
};
