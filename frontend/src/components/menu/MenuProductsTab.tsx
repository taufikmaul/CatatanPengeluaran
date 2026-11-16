import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  anonymizeAllMenus,
  api,
  createMenu,
  deleteMenu,
  downloadMenusCsv,
  getMenus,
  importMenusCsv,
  importMenusFromPos,
  updateMenu,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  FoodCostStatus,
  MasterItem,
  MenuProduct,
  MenuProductPayload,
} from "@/types";
import { MenuFormDialog } from "./MenuFormDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";

interface MenuProductsTabProps {
  isAdmin: boolean;
  units: string[];
}

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

  // Modal states
  const [formOpen, setFormOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuProduct | null>(null);
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [updateExistingCsv, setUpdateExistingCsv] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [anonymizeDialogOpen, setAnonymizeDialogOpen] = useState(false);
  const [anonPrefix, setAnonPrefix] = useState("MENU");
  const [preserveCustomAnon, setPreserveCustomAnon] = useState(false);

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
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus menu.");
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

  const handleExportCsv = async () => {
    try {
      await downloadMenusCsv({
        search: search.trim() || undefined,
        category: categoryFilter !== "all" ? categoryFilter : undefined,
        hpp_status: hppStatusFilter !== "all" ? hppStatusFilter : undefined,
        anonymize: anonymizeMode,
      });
      toast.success(
        anonymizeMode
          ? "File CSV (Mode Anonim) berhasil diunduh."
          : "File CSV database menu berhasil diunduh."
      );
    } catch {
      toast.error("Gagal mengunduh file CSV menu.");
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openCreateModal = () => {
    setEditingMenu(null);
    setFormOpen(true);
  };

  const openEditModal = (menu: MenuProduct) => {
    if (anonymizeMode) {
      toast.info("Matikan Mode Anonim terlebih dahulu untuk mengedit nama dan resep asli.");
      return;
    }
    setEditingMenu(menu);
    setFormOpen(true);
  };

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
      {/* Header & Primary Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Database Menu / Produk &amp; HPP
            </h2>
            <Badge
              variant="outline"
              className="text-[11px] font-semibold border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              {displayedTotal} Menu
            </Badge>
            {anonymizeMode && (
              <Badge className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-[11px] font-semibold">
                Mode Anonim Aktif
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Kelola katalog menu jual, perhitungan HPP / Food Cost (manual atau resep bahan Master Item), dan samarkan identitas produk dengan Mode Anonim saat presentasi atau export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={anonymizeMode ? "default" : "outline"}
            size="sm"
            onClick={() => setAnonymizeMode((prev) => !prev)}
            className={`min-h-[44px] sm:min-h-[36px] text-xs gap-1.5 ${
              anonymizeMode
                ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                : ""
            }`}
            aria-pressed={anonymizeMode}
          >
            {anonymizeMode ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Mode Anonim: Aktif</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Tampilkan Nama Anonim</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnonymizeDialogOpen(true)}
            className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Atur Kode Anonim</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => posImportMutation.mutate()}
            disabled={posImportMutation.isPending}
            className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${posImportMutation.isPending ? "animate-spin" : ""}`}
            />
            <span>Tarik dari POS</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportCsvOpen(true)}
            className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={items.length === 0}
            className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{anonymizeMode ? "Export CSV Anonim" : "Export CSV"}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={openCreateModal}
            disabled={anonymizeMode}
            className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Menu</span>
          </Button>
        </div>
      </div>

      {/* Mode Anonim Privacy Notice */}
      {anonymizeMode && (
        <div className="rounded-xl border border-slate-300 bg-slate-900 text-slate-100 dark:border-slate-700 dark:bg-slate-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div>
            <strong>Mode Anonim aktif:</strong> Nama asli menu, SKU, catatan, dan nama bahan resep disembunyikan oleh server dan diganti menjadi kode anonim (mis. MENU-001) serta Bahan #1.
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAnonymizeMode(false)}
            className="h-8 text-xs shrink-0 self-start sm:self-auto"
          >
            Kembali ke Nama Asli
          </Button>
        </div>
      )}

      {/* Real-Data KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                  anonymizeMode
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
                    disabled={anonymizeMode}
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
                    disabled={posImportMutation.isPending}
                    className="gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tarik dari POS
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
                      {anonymizeMode ? "Kode Anonim Menu" : "Nama Menu / Produk"}
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold">Kategori</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Harga Jual</th>
                    <th className="text-right px-3 py-2.5 font-semibold">HPP / Food Cost</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Food Cost %</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Margin Kotor</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((menu) => {
                    const isExpanded = !!expandedIds[menu.id];
                    const fcBadge = getFoodCostBadge(menu.food_cost_status);
                    return (
                      <React.Fragment key={menu.id}>
                        <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                          <td className="px-2 py-2.5 text-center">
                            {menu.ingredient_count > 0 && (
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
                              {!anonymizeMode && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                                  {menu.anonymous_name}
                                </span>
                              )}
                              {!menu.is_active && (
                                <Badge variant="outline" className="text-[10px] text-slate-600">
                                  Nonaktif
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              Satuan: {menu.unit}
                              {!anonymizeMode && menu.sku ? ` | SKU: ${menu.sku}` : ""}
                              {menu.product_group ? ` | Grup: ${menu.product_group}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline" className="text-[10px] font-medium">
                              {menu.category}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
                            {menu.selling_price > 0 ? formatRupiah(menu.selling_price) : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                            </div>
                            <div className="text-[10px] text-slate-600 dark:text-slate-400">
                              {menu.active_hpp_source === "recipe"
                                ? `Resep (${menu.ingredient_count} bahan)`
                                : "Input Manual"}
                            </div>
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
                            <div className="inline-flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditModal(menu)}
                                disabled={anonymizeMode}
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
                                  onClick={() => {
                                    if (
                                      confirm(`Hapus menu "${menu.display_name}" dari database?`)
                                    ) {
                                      deleteMutation.mutate(menu.id);
                                    }
                                  }}
                                  aria-label={`Hapus ${menu.display_name}`}
                                  className="h-8 w-8 p-0 text-slate-600 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && menu.ingredients.length > 0 && (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/60">
                            <td colSpan={8} className="px-8 py-3">
                              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Komposisi Bahan Resep ({menu.ingredients.length} item, total HPP resep{" "}
                                {formatRupiah(menu.recipe_hpp)})
                              </div>
                              <div className="space-y-1">
                                {menu.ingredients.map((ing, idx) => (
                                  <div
                                    key={ing.id || idx}
                                    className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-300 border-b border-slate-200/70 dark:border-slate-800 pb-1 last:border-0"
                                  >
                                    <div>
                                      <span className="font-medium">{ing.ingredient_name}</span>
                                      <span className="text-slate-600 dark:text-slate-400 ml-2">
                                        {ing.qty} {ing.unit}
                                        {ing.yield_factor !== 1 ? ` (pembagi ${ing.yield_factor})` : ""}
                                      </span>
                                    </div>
                                    <div className="tabular-nums font-medium">
                                      {formatRupiah(ing.line_cost || 0)}
                                    </div>
                                  </div>
                                ))}
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
              {items.map((menu) => {
                const fcBadge = getFoodCostBadge(menu.food_cost_status);
                const isExpanded = !!expandedIds[menu.id];
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
                          {!anonymizeMode && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                              {menu.anonymous_name}
                            </span>
                          )}
                          <Badge variant="outline" className={`text-[10px] ${fcBadge.className}`}>
                            {fcBadge.label}
                          </Badge>
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

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/70 p-2 text-xs tabular-nums">
                      <div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-400">HPP</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-400">Food Cost</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {menu.selling_price > 0 && menu.effective_hpp > 0
                            ? `${menu.food_cost_pct.toFixed(1)}%`
                            : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-400">Margin</div>
                        <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {menu.selling_price > 0 ? formatRupiah(menu.gross_margin) : "-"}
                        </div>
                      </div>
                    </div>

                    {menu.ingredient_count > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => toggleExpand(menu.id)}
                          className="min-h-[44px] w-full flex items-center justify-between px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                          aria-expanded={isExpanded}
                        >
                          <span>Resep ({menu.ingredient_count} bahan)</span>
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
                                </span>
                                <span className="tabular-nums font-medium shrink-0">
                                  {formatRupiah(ing.line_cost || 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(menu)}
                        disabled={anonymizeMode}
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
                          onClick={() => {
                            if (confirm(`Hapus menu "${menu.display_name}"?`)) {
                              deleteMutation.mutate(menu.id);
                            }
                          }}
                          className="min-h-[44px] min-w-[44px] text-rose-700 border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-900"
                          aria-label={`Hapus ${menu.display_name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-1 text-slate-700 dark:text-slate-300">
              <div className="font-semibold">Format header yang didukung:</div>
              <div className="font-mono text-[11px]">
                Nama Menu, Kategori, Harga Jual, HPP, Satuan, Kode Anonim
              </div>
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
    </div>
  );
};
