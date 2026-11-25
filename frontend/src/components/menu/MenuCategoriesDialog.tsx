import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createMasterData,
  deleteMasterData,
  getMasterData,
  resetMasterDataDefaults,
  updateMasterData,
} from "@/lib/api";
import { MasterDataOption } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Tags,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

interface MenuCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCategoryCreated?: (categoryName: string) => void;
}

interface InlineEditDraft {
  name: string;
  description: string;
  sort_order: string;
  is_default: boolean;
}

export const MenuCategoriesDialog: React.FC<MenuCategoriesDialogProps> = ({
  open,
  onOpenChange,
  onCategoryCreated,
}) => {
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<InlineEditDraft>({
    name: "",
    description: "",
    sort_order: "1",
    is_default: false,
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const {
    data: categories = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["menu-categories"],
    queryFn: () => getMasterData("kategori_menu"),
    enabled: open,
  });

  const sortedCategories = useMemo(
    () =>
      [...categories].sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.name.localeCompare(b.name, "id")
      ),
    [categories]
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
    queryClient.invalidateQueries({ queryKey: ["masterData"] });
    queryClient.invalidateQueries({ queryKey: ["menus"] });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const nextSort =
        sortedCategories.length > 0
          ? Math.max(...sortedCategories.map((c) => c.sort_order || 0)) + 1
          : 1;
      return createMasterData({
        type: "kategori_menu",
        name: newName.trim(),
        description: newDesc.trim(),
        sort_order: nextSort,
      });
    },
    onSuccess: (res) => {
      toast.success(
        res.message || `Kategori "${res.item.name}" berhasil ditambahkan.`
      );
      setNewName("");
      setNewDesc("");
      invalidateAll();
      onCategoryCreated?.(res.item.name);
    },
    onError: (err: any) => {
      toast.error(
        err.response?.data?.detail || "Gagal menambahkan kategori menu."
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        name?: string;
        description?: string;
        sort_order?: number;
        is_active?: boolean;
        is_default?: boolean;
      };
    }) => updateMasterData(id, payload),
    onSuccess: (res) => {
      toast.success(
        res.message || `Kategori "${res.item.name}" berhasil diperbarui.`
      );
      setEditingId(null);
      setConfirmDeleteId(null);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(
        err.response?.data?.detail || "Gagal memperbarui kategori menu."
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMasterData(id, false),
    onSuccess: (res) => {
      toast.success(res.message || "Kategori menu berhasil dihapus.");
      setConfirmDeleteId(null);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(
        err.response?.data?.detail || "Gagal menghapus kategori menu."
      );
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetMasterDataDefaults("kategori_menu"),
    onSuccess: (res) => {
      toast.success(
        res.message || "Kategori menu bawaan berhasil dipulihkan."
      );
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(
        err.response?.data?.detail || "Gagal memulihkan kategori default."
      );
    },
  });

  const handleQuickCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || createMutation.isPending) return;
    createMutation.mutate();
  };

  const startEditing = (cat: MasterDataOption) => {
    setConfirmDeleteId(null);
    setEditingId(cat.id);
    setEditDraft({
      name: cat.name,
      description: cat.description || "",
      sort_order: String(cat.sort_order ?? 1),
      is_default: cat.is_default,
    });
  };

  const saveEdit = (catId: number) => {
    const cleanName = editDraft.name.trim();
    if (!cleanName) {
      toast.error("Nama kategori tidak boleh kosong.");
      return;
    }
    updateMutation.mutate({
      id: catId,
      payload: {
        name: cleanName,
        description: editDraft.description.trim(),
        sort_order: Math.max(1, Number(editDraft.sort_order) || 1),
        is_default: editDraft.is_default,
      },
    });
  };

  const isBusy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    resetMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[88vh] p-0 gap-0 overflow-hidden rounded-2xl">
        <MotionConfig reducedMotion="user">
          <div className="flex flex-col max-h-[88vh] w-full overflow-hidden">
          <DialogHeader className="px-5 py-4 pr-12 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Tags className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <span>Master Kategori Menu</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Kelola daftar kategori resmi untuk Menu Jual, Prepared / Sub-Resep, dan Paket Bundling. Mengubah nama kategori otomatis memperbarui menu terkait.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/70 dark:bg-slate-950/60">
            {/* Quick-Create Bar */}
            <form
              onSubmit={handleQuickCreate}
              className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 p-3 shadow-xs space-y-2.5"
            >
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Tambah Kategori Baru
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <div className="sm:col-span-5">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nama kategori (mis. Seasonal Cake)"
                    aria-label="Nama kategori baru"
                    className="h-10 sm:h-9 text-xs"
                  />
                </div>
                <div className="sm:col-span-5">
                  <Input
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Keterangan singkat (opsional)"
                    aria-label="Keterangan kategori baru"
                    className="h-10 sm:h-9 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!newName.trim() || createMutation.isPending}
                    className="w-full h-10 sm:h-9 text-xs gap-1"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>Tambah</span>
                  </Button>
                </div>
              </div>
            </form>

            {/* List State */}
            {isLoading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Memuat daftar master kategori menu...</span>
              </div>
            ) : isError ? (
              <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 p-6 text-center space-y-2 text-xs">
                <AlertCircle className="w-5 h-5 text-rose-600 mx-auto" />
                <p className="text-slate-800 dark:text-slate-200 font-medium">
                  Gagal memuat master kategori menu.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                >
                  Coba Lagi
                </Button>
              </div>
            ) : sortedCategories.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center space-y-2 text-xs">
                <p className="text-slate-600 dark:text-slate-400">
                  Belum ada kategori menu terdaftar. Tambahkan di atas atau pulihkan kategori bawaan.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => resetMutation.mutate()}
                  disabled={resetMutation.isPending}
                  className="gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Pulihkan Kategori Default</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {sortedCategories.map((cat, idx) => {
                    const isEditing = editingId === cat.id;
                    const isConfirmingDelete = confirmDeleteId === cat.id;

                    return (
                      <motion.div
                        key={cat.id ?? `${cat.name}-${idx}`}
                        layout="position"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                          "rounded-xl border p-3 transition-colors",
                          cat.is_active
                            ? "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                            : "border-slate-200/80 dark:border-slate-800/70 bg-slate-100/70 dark:bg-slate-900/40"
                        )}
                      >
                        {isEditing ? (
                          <div className="space-y-2.5">
                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                              <div className="sm:col-span-5">
                                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
                                  Nama Kategori
                                </label>
                                <Input
                                  value={editDraft.name}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      name: e.target.value,
                                    }))
                                  }
                                  className="h-9 text-xs"
                                />
                              </div>
                              <div className="sm:col-span-5">
                                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
                                  Deskripsi
                                </label>
                                <Input
                                  value={editDraft.description}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      description: e.target.value,
                                    }))
                                  }
                                  className="h-9 text-xs"
                                />
                              </div>
                              <div className="sm:col-span-2">
                                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
                                  Urutan
                                </label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={editDraft.sort_order}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      sort_order: e.target.value,
                                    }))
                                  }
                                  className="h-9 text-xs tabular-nums"
                                />
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editDraft.is_default}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      is_default: e.target.checked,
                                    }))
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                                />
                                <span>Jadikan kategori default</span>
                              </label>

                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingId(null)}
                                  className="h-8 text-xs"
                                >
                                  Batal
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={updateMutation.isPending}
                                  onClick={() => saveEdit(cat.id)}
                                  className="h-8 text-xs gap-1"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Simpan</span>
                                </Button>
                              </div>
                            </div>

                            <p className="text-[11px] text-blue-700 dark:text-blue-300">
                              Mengubah nama kategori otomatis memperbarui kategori seluruh menu terkait.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                                    #{cat.sort_order || idx + 1}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-xs font-semibold",
                                      cat.is_active
                                        ? "text-slate-900 dark:text-slate-100"
                                        : "text-slate-600 dark:text-slate-400 line-through"
                                    )}
                                  >
                                    {cat.name}
                                  </span>
                                  {cat.is_default && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                                    >
                                      Default
                                    </Badge>
                                  )}
                                  {!cat.is_active && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 text-slate-600 dark:text-slate-400"
                                    >
                                      Nonaktif
                                    </Badge>
                                  )}
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 font-mono text-slate-700 dark:text-slate-300"
                                  >
                                    {cat.usage_count > 0
                                      ? `${cat.usage_count} menu`
                                      : "Belum dipakai"}
                                  </Badge>
                                </div>
                                {cat.description && (
                                  <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                                    {cat.description}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() =>
                                    updateMutation.mutate({
                                      id: cat.id,
                                      payload: { is_active: !cat.is_active },
                                    })
                                  }
                                  className={cn(
                                    "h-9 sm:h-8 px-2 text-xs gap-1",
                                    cat.is_active
                                      ? "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400"
                                  )}
                                  aria-label={
                                    cat.is_active
                                      ? `Nonaktifkan ${cat.name}`
                                      : `Aktifkan ${cat.name}`
                                  }
                                >
                                  {cat.is_active ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>Aktif</span>
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="w-3.5 h-3.5" />
                                      <span>Nonaktif</span>
                                    </>
                                  )}
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() => startEditing(cat)}
                                  aria-label={`Edit kategori ${cat.name}`}
                                  className="h-9 w-9 sm:h-8 sm:w-8 p-0 text-slate-600 hover:text-blue-700 dark:text-slate-300"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() =>
                                    setConfirmDeleteId((prev) =>
                                      prev === cat.id ? null : cat.id
                                    )
                                  }
                                  aria-label={`Hapus kategori ${cat.name}`}
                                  className="h-9 w-9 sm:h-8 sm:w-8 p-0 text-slate-600 hover:text-rose-700 dark:text-slate-300"
                                >
                                  {isConfirmingDelete ? (
                                    <X className="w-3.5 h-3.5" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </Button>
                              </div>
                            </div>

                            {isConfirmingDelete && (
                              <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                <div className="flex items-start gap-2 text-amber-950 dark:text-amber-200">
                                  <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                                  <span>
                                    {cat.usage_count > 0
                                      ? `Kategori masih dipakai oleh ${cat.usage_count} menu. Sebaiknya nonaktifkan daripada dihapus agar data menu tetap rapi.`
                                      : `Yakin menghapus permanen kategori "${cat.name}"?`}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="h-8 text-xs"
                                  >
                                    Batal
                                  </Button>
                                  {cat.usage_count > 0 ? (
                                    cat.is_active && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={updateMutation.isPending}
                                        onClick={() =>
                                          updateMutation.mutate({
                                            id: cat.id,
                                            payload: { is_active: false },
                                          })
                                        }
                                        className="h-8 text-xs bg-white dark:bg-slate-900"
                                      >
                                        Nonaktifkan Saja
                                      </Button>
                                    )
                                  ) : (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      disabled={deleteMutation.isPending}
                                      onClick={() => deleteMutation.mutate(cat.id)}
                                      className="h-8 text-xs"
                                    >
                                      {deleteMutation.isPending
                                        ? "Menghapus..."
                                        : "Konfirmasi Hapus"}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          <DialogFooter className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex-row items-center justify-between gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => resetMutation.mutate()}
              className="h-9 text-xs gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Pulihkan Default</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs"
            >
              Tutup
            </Button>
          </DialogFooter>
          </div>
        </MotionConfig>
      </DialogContent>
    </Dialog>
  );
};
