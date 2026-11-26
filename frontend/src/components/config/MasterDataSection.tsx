import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MasterDataOption } from "@/types";
import {
  getMasterData,
  createMasterData,
  updateMasterData,
  deleteMasterData,
  resetMasterDataDefaults,
} from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { HighlightText, SearchMinCharHint } from "@/components/common/HighlightText";
import { getEffectiveSearchQuery } from "@/lib/searchHighlight";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CreditCard,
  Tag,
  Package,
  Plus,
  Search,
  Pencil,
  Trash2,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Check,
  BookOpen,
  UtensilsCrossed,
} from "lucide-react";

type MasterDataType = "kategori" | "metode_bayar" | "satuan" | "kategori_menu";

interface MasterDataSectionProps {
  onRefreshConfig?: () => void;
}

const TYPE_CONFIG: Record<
  MasterDataType,
  {
    label: string;
    singular: string;
    icon: React.ElementType;
    description: string;
    placeholder: string;
    defaultDesc: string;
    color: string;
  }
> = {
  metode_bayar: {
    label: "Metode Bayar",
    singular: "Metode Pembayaran",
    icon: CreditCard,
    description:
      "Daftar metode pembayaran transaksi (Tunai, Transfer Bank, QRIS, dll). Opsi aktif otomatis muncul pada form transaksi dan filter.",
    placeholder: "Contoh: QRIS, BCA Transfer, ShopeePay",
    defaultDesc: "Pembayaran melalui...",
    color: "emerald",
  },
  kategori: {
    label: "Kategori Pengeluaran",
    singular: "Kategori",
    icon: Tag,
    description:
      "Kategori pengelompokan biaya toko dan anggaran bulanan. Sinkron langsung dengan target budget dan chart analitik.",
    placeholder: "Contoh: Bahan Packaging, Promosi, Event",
    defaultDesc: "Pengeluaran untuk keperluan...",
    color: "blue",
  },
  satuan: {
    label: "Satuan Ukuran & Kemasan",
    singular: "Satuan",
    icon: Package,
    description:
      "Daftar satuan beli kemasan dan eceran (Pcs, Box, Kg, Liter, dll). Digunakan di Master Barang dan Form Input Transaksi.",
    placeholder: "Contoh: Pail, Jar, Rim, Butir",
    defaultDesc: "Satuan kemasan untuk...",
    color: "indigo",
  },
  kategori_menu: {
    label: "Kategori Menu",
    singular: "Kategori Menu",
    icon: UtensilsCrossed,
    description:
      "Master kategori untuk mengelompokkan Menu Jual, Prepared / Sub-Resep, dan Paket Bundling. Perubahan nama otomatis menyinkronkan menu terkait.",
    placeholder: "Contoh: Seasonal Cake, Signature Cookies, Coffee",
    defaultDesc: "Kelompok menu untuk...",
    color: "amber",
  },
};

export const MasterDataSection: React.FC<MasterDataSectionProps> = ({ onRefreshConfig }) => {
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<MasterDataType>("kategori");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog Add / Edit State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterDataOption | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    sort_order: 1,
    is_default: false,
    is_active: true,
    account_code: "",
    account_name: "",
    account_group: "",
    report_type: "",
  });

  // Dialog Delete State
  const [deletingItem, setDeletingItem] = useState<MasterDataOption | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Fetch Master Data
  const { data: allItems = [], isLoading, refetch } = useQuery({
    queryKey: ["masterData"],
    queryFn: () => getMasterData(),
  });

  // Mutasi Tambah
  const createMutation = useMutation({
    mutationFn: createMasterData,
    onSuccess: (res) => {
      toast.success(res.message || "Opsi baru berhasil ditambahkan!");
      setIsDialogOpen(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      onRefreshConfig?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menambahkan opsi.");
    },
  });

  // Mutasi Update
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => updateMasterData(id, payload),
    onSuccess: (res) => {
      toast.success(res.message || "Opsi berhasil diperbarui!");
      setIsDialogOpen(false);
      setEditingItem(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      onRefreshConfig?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui opsi.");
    },
  });

  // Mutasi Hapus
  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) => deleteMasterData(id, force),
    onSuccess: (res) => {
      toast.success(res.message || "Opsi berhasil dihapus!");
      setIsDeleteOpen(false);
      setDeletingItem(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      onRefreshConfig?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus opsi.");
    },
  });

  // Mutasi Reset Bawaan
  const resetMutation = useMutation({
    mutationFn: (type: string) => resetMasterDataDefaults(type),
    onSuccess: (res) => {
      toast.success(res.message || "Opsi bawaan berhasil dipulihkan!");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      onRefreshConfig?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memulihkan opsi bawaan.");
    },
  });

  const effectiveSearchQuery = useMemo(
    () => getEffectiveSearchQuery(searchQuery),
    [searchQuery]
  );

  // Filter items by type and search
  const currentItems = useMemo(() => {
    return allItems
      .filter((it) => it.type === activeType)
      .filter((it) => {
        if (!effectiveSearchQuery) return true;
        const q = effectiveSearchQuery.toLowerCase();
        return (
          it.name.toLowerCase().includes(q) ||
          (it.description || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [allItems, activeType, effectiveSearchQuery]);

  // Counts for tabs
  const counts = useMemo(() => {
    const res: Record<MasterDataType, { total: number; active: number; inUse: number }> = {
      kategori: { total: 0, active: 0, inUse: 0 },
      metode_bayar: { total: 0, active: 0, inUse: 0 },
      satuan: { total: 0, active: 0, inUse: 0 },
      kategori_menu: { total: 0, active: 0, inUse: 0 },
    };
    allItems.forEach((it) => {
      const t = it.type as MasterDataType;
      if (res[t]) {
        res[t].total += 1;
        if (it.is_active) res[t].active += 1;
        if (it.usage_count > 0) res[t].inUse += 1;
      }
    });
    return res;
  }, [allItems]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setFormData({
      name: "",
      description: "",
      sort_order: (currentItems.length > 0 ? Math.max(...currentItems.map((i) => i.sort_order)) : 0) + 1,
      is_default: false,
      is_active: true,
      account_code: "",
      account_name: "",
      account_group: activeType === "kategori" ? "HPP" : activeType === "metode_bayar" ? "KAS" : "",
      report_type: activeType === "kategori" ? "LABA_RUGI" : activeType === "metode_bayar" ? "NERACA" : "",
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (item: MasterDataOption) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || "",
      sort_order: item.sort_order,
      is_default: item.is_default,
      is_active: item.is_active,
      account_code: item.account_code || "",
      account_name: item.account_name || "",
      account_group: item.account_group || "",
      report_type: item.report_type || "",
    });
    setIsDialogOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Nama opsi tidak boleh kosong.");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim(),
      sort_order: Number(formData.sort_order) || 0,
      is_default: formData.is_default,
      is_active: formData.is_active,
      account_code: formData.account_code.trim() || null,
      account_name: formData.account_name.trim() || null,
      account_group: formData.account_group.trim() || null,
      report_type: formData.report_type.trim() || null,
    };

    if (editingItem) {
      updateMutation.mutate({
        id: editingItem.id,
        payload,
      });
    } else {
      createMutation.mutate({
        type: activeType,
        ...payload,
      });
    }
  };

  const handleToggleActive = (item: MasterDataOption) => {
    updateMutation.mutate({
      id: item.id,
      payload: { is_active: !item.is_active },
    });
  };

  const handleOpenDelete = (item: MasterDataOption) => {
    setDeletingItem(item);
    setIsDeleteOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!deletingItem) return;
    deleteMutation.mutate({ id: deletingItem.id });
  };

  const handleResetDefaults = () => {
    if (
      window.confirm(
        `Pulihkan opsi bawaan untuk ${TYPE_CONFIG[activeType].label}? Opsi bawaan yang terhapus akan dikembalikan.`
      )
    ) {
      resetMutation.mutate(activeType);
    }
  };

  const ActiveIcon = TYPE_CONFIG[activeType].icon;

  return (
    <div className="space-y-5">
      {/* Type Switcher Bar */}
      <div className="bg-slate-50/80 p-1.5 rounded-2xl border border-slate-200/90 flex flex-wrap gap-1.5">
        {(Object.keys(TYPE_CONFIG) as MasterDataType[]).map((t) => {
          const cfg = TYPE_CONFIG[t];
          const Icon = cfg.icon;
          const isActive = activeType === t;
          const count = counts[t];

          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setActiveType(t);
                setSearchQuery("");
              }}
              className={`flex-1 min-w-[180px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/70"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                <span>{cfg.label}</span>
              </div>
              <Badge
                variant={isActive ? "secondary" : "outline"}
                className="text-[10px] font-mono px-1.5 py-0 h-5"
              >
                {count.active} aktif
              </Badge>
            </button>
          );
        })}
      </div>

      {/* Main Container Card */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="p-4 md:p-5 pb-3 border-b border-slate-100 bg-white">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-sm md:text-base font-semibold text-slate-900 flex items-center gap-2">
                <ActiveIcon className="w-4 h-4 text-blue-600" />
                Master Data {TYPE_CONFIG[activeType].label}
              </CardTitle>
              <p className="text-xs text-slate-500 leading-relaxed">
                {TYPE_CONFIG[activeType].description}
              </p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-center shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefaults}
                disabled={resetMutation.isPending}
                className="rounded-xl text-xs h-9 border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5 font-medium"
                title="Pulihkan opsi default yang hilang"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Pulihkan Default</span>
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleOpenAdd}
                className="rounded-xl text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 font-semibold shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah {TYPE_CONFIG[activeType].singular}</span>
              </Button>
            </div>
          </div>

          {/* Search bar & quick filter */}
          <div className="pt-3 flex items-start gap-2">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Cari nama ${TYPE_CONFIG[activeType].singular.toLowerCase()}...`}
                  className="h-9 pl-8 text-xs rounded-xl"
                />
              </div>
              <SearchMinCharHint query={searchQuery} />
            </div>
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="text-xs h-9 text-slate-500"
              >
                Reset
              </Button>
            )}
            <span className="text-[11px] text-slate-500 ml-auto hidden sm:inline">
              Menampilkan {currentItems.length} opsi ({counts[activeType].active} aktif)
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Memuat master data {TYPE_CONFIG[activeType].label.toLowerCase()}...
            </div>
          ) : currentItems.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-xs text-slate-500 font-medium">
                {effectiveSearchQuery
                  ? `Tidak ada opsi yang cocok dengan pencarian "${effectiveSearchQuery}"`
                  : `Belum ada master data untuk ${TYPE_CONFIG[activeType].label}`}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefaults}
                className="text-xs rounded-xl gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Pulihkan Daftar Default
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {currentItems.map((item, idx) => {
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 md:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      item.is_active ? "bg-white hover:bg-slate-50/60" : "bg-slate-50/40 opacity-75"
                    }`}
                  >
                    {/* Item info */}
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-[11px] font-mono text-slate-400 w-5 pt-0.5 shrink-0 text-right">
                        {item.sort_order || idx + 1}
                      </span>
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-xs md:text-sm font-semibold truncate ${
                              item.is_active ? "text-slate-900" : "text-slate-500 line-through"
                            }`}
                          >
                            <HighlightText text={item.name} query={effectiveSearchQuery} />
                          </span>

                          {item.is_default && (
                            <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[10px] font-medium gap-1 px-1.5 py-0 h-4.5">
                              <Check className="w-2.5 h-2.5" />
                              Bawaan (Default)
                            </Badge>
                          )}

                          {!item.is_active && (
                            <Badge variant="outline" className="text-slate-400 border-slate-200 text-[10px] py-0 h-4.5">
                              Non-aktif
                            </Badge>
                          )}

                          {item.usage_count > 0 ? (
                            <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-mono">
                              {item.usage_count}{" "}
                              {activeType === "kategori_menu" ? "menu" : "transaksi"}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-600 italic">
                              Belum digunakan
                            </span>
                          )}

                          {item.account_code && (
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px] bg-sky-50 text-sky-800 border-sky-200 px-1.5 py-0 h-4.5"
                              title={`Akun: ${item.account_code} - ${item.account_name || item.name}`}
                            >
                              COA: {item.account_code}
                            </Badge>
                          )}

                          {item.account_group && (
                            <Badge
                              variant="secondary"
                              className={`text-[9px] font-semibold px-1.5 py-0 h-4.5 uppercase ${
                                item.account_group === "HPP"
                                  ? "bg-amber-100 text-amber-900 border-amber-200"
                                  : item.account_group === "OPEX"
                                  ? "bg-slate-100 text-slate-800 border-slate-200"
                                  : item.account_group === "ASSET"
                                  ? "bg-purple-100 text-purple-900 border-purple-200"
                                  : item.account_group === "CASH_TRANSFER"
                                  ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                                  : "bg-blue-100 text-blue-900 border-blue-200"
                              }`}
                            >
                              {item.account_group}
                            </Badge>
                          )}
                        </div>

                        {item.description ? (
                          <p className="text-[11px] text-slate-500 truncate max-w-xl">
                            {item.description}
                            {item.account_name && item.account_name !== item.name && (
                              <span className="text-slate-400 ml-1.5 font-normal">
                                • {item.account_name}
                              </span>
                            )}
                          </p>
                        ) : item.account_name ? (
                          <p className="text-[11px] text-slate-500 truncate max-w-xl">
                            Akun Standar: {item.account_name}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic">Tanpa keterangan</p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(item)}
                        className={`text-xs h-8 px-2.5 rounded-lg font-medium ${
                          item.is_active
                            ? "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                        }`}
                        title={item.is_active ? "Nonaktifkan opsi ini" : "Aktifkan kembali opsi ini"}
                      >
                        {item.is_active ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <XCircle className="w-3.5 h-3.5" /> Non-aktif
                          </span>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(item)}
                        className="text-xs h-8 px-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50"
                        title="Edit opsi"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenDelete(item)}
                        className="text-xs h-8 px-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title="Hapus opsi"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Add / Edit (Zero Nested Card, Hairline Sections) */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-xl">
          <DialogHeader className="pb-2 border-b border-border/80">
            <DialogTitle className="text-base font-bold tracking-tight text-foreground">
              {editingItem
                ? `Edit ${TYPE_CONFIG[activeType].singular}`
                : `Tambah ${TYPE_CONFIG[activeType].singular} Baru`}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground block">
                Nama {TYPE_CONFIG[activeType].singular} *
              </label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={TYPE_CONFIG[activeType].placeholder}
                className="h-9 text-xs"
                autoFocus
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground block">
                Deskripsi / Keterangan (Opsional)
              </label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={TYPE_CONFIG[activeType].defaultDesc}
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Urutan Tampilan
                </label>
                <Input
                  type="number"
                  min="1"
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData({ ...formData, sort_order: parseInt(e.target.value, 10) || 1 })
                  }
                  className="h-9 text-xs tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Status Opsi
                </label>
                <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-input"
                  />
                  <span className="text-xs font-medium text-foreground">Aktif Digunakan</span>
                </label>
              </div>
            </div>

            {/* Pemetaan Akuntansi (COA) Khusus Kategori & Metode Bayar (Flat Hairline Section) */}
            {(activeType === "kategori" || activeType === "metode_bayar") && (
              <div className="pt-3 border-t border-border/70 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Pemetaan Akuntansi Standar (Chart of Accounts / COA)
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {activeType === "kategori"
                      ? "Hubungkan kategori ini dengan kode akun buku besar untuk integrasi Laporan Laba Rugi dan Neraca."
                      : "Hubungkan metode pembayaran ini dengan akun kas/bank pada Neraca."}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      Kode Akun (COA)
                    </label>
                    <Input
                      value={formData.account_code}
                      onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                      placeholder={activeType === "kategori" ? "Contoh: 5-1100" : "Contoh: 1-1110"}
                      className="h-9 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      Kelompok Akun
                    </label>
                    <AdaptiveSelect
                      value={formData.account_group}
                      onValueChange={(val) =>
                        setFormData({ ...formData, account_group: val })
                      }
                      options={[
                        { value: "", label: "Pilih Kelompok..." },
                        { value: "HPP", label: "HPP (Harga Pokok Penjualan / Bahan Baku)" },
                        { value: "OPEX", label: "OPEX (Beban Operasional & Umum)" },
                        { value: "ASSET", label: "ASSET (Aset Tetap / Peralatan Tahan Lama)" },
                        { value: "CASH_TRANSFER", label: "CASH_TRANSFER (Mutasi / Kliring Kas)" },
                        { value: "KAS", label: "KAS (Kas Tunai Kasir)" },
                        { value: "BANK", label: "BANK (Kas Rekening Bank)" },
                        { value: "HUTANG", label: "HUTANG (Hutang Usaha / Supplier)" },
                      ]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      Nama Akun Standar
                    </label>
                    <Input
                      value={formData.account_name}
                      onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                      placeholder="Contoh: Beban Pokok Bahan Baku Kue"
                      className="h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      Masuk ke Laporan
                    </label>
                    <AdaptiveSelect
                      value={formData.report_type}
                      onValueChange={(val) =>
                        setFormData({ ...formData, report_type: val })
                      }
                      options={[
                        { value: "", label: "Pilih Laporan..." },
                        { value: "LABA_RUGI", label: "Laba Rugi (Income Statement)" },
                        { value: "NERACA", label: "Neraca (Balance Sheet)" },
                        { value: "ARUS_KAS", label: "Arus Kas (Cash Flow)" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Default Checkbox */}
            {activeType !== "kategori" && (
              <label className="flex items-start gap-2.5 pt-3 border-t border-border/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="w-3.5 h-3.5 rounded border-input mt-0.5"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-foreground block">
                    Jadikan Pilihan Bawaan (Default)
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {activeType === "kategori_menu"
                      ? "Opsi ini otomatis terpilih terlebih dahulu saat membuat menu / resep baru."
                      : "Opsi ini otomatis terpilih terlebih dahulu saat membuat transaksi baru."}
                  </p>
                </div>
              </label>
            )}

            <DialogFooter className="pt-3 border-t border-border/70 gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsDialogOpen(false)}
                className="h-9 px-4 text-xs"
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="h-9 px-5 text-xs font-semibold"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Menyimpan..."
                  : editingItem
                  ? "Simpan Perubahan"
                  : "Tambahkan Opsi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Konfirmasi Hapus */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm md:text-base font-semibold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Hapus {TYPE_CONFIG[activeType].singular}?
            </DialogTitle>
          </DialogHeader>

          {deletingItem && (
            <div className="space-y-3 pt-1 text-xs">
              <p className="text-slate-600">
                Apakah Anda yakin ingin menghapus <strong>"{deletingItem.name}"</strong> dari master data{" "}
                {TYPE_CONFIG[activeType].label}?
              </p>

              {deletingItem.usage_count > 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                    <Info className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      Sedang Dipakai ({deletingItem.usage_count}{" "}
                      {activeType === "kategori_menu" ? "menu" : "transaksi"})
                    </span>
                  </div>
                  <p className="text-amber-900 text-[11px] leading-relaxed">
                    Opsi ini masih digunakan oleh data yang ada. Sebaiknya <strong>nonaktifkan</strong> opsi
                    ini daripada menghapusnya, agar data yang ada tetap utuh dan opsi tidak muncul lagi
                    pada penginputan baru.
                  </p>
                </div>
              ) : (
                <p className="text-slate-500 text-[11px]">
                  Opsi ini belum digunakan dalam transaksi manapun dan aman untuk dihapus.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteOpen(false)}
              className="rounded-xl text-xs"
            >
              Batal
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
              className="rounded-xl text-xs font-semibold"
            >
              {deleteMutation.isPending ? "Menghapus..." : "Tetap Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
