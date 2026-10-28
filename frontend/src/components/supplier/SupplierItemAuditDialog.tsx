import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMasterItemAuditDuplicates,
  mergeMasterItems,
  enqueueMergeMasterItems,
  enqueueBatchMergeMasterItems,
  enqueueMasterItemAudit,
} from "@/lib/api";
import {
  DuplicatePair,
  MasterItem,
  MasterItemMergeRequest,
} from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  GitMerge,
  SearchCheck,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  SlidersHorizontal,
  Layers,
  X,
  Store,
} from "lucide-react";

interface SupplierItemAuditDialogProps {
  supplierId: number;
  supplierName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const SupplierItemAuditDialog: React.FC<SupplierItemAuditDialogProps> = ({
  supplierId,
  supplierName,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const queryClient = useQueryClient();

  // Audit filter settings
  const [minScore, setMinScore] = useState(0.70);
  const [strictSupplier, setStrictSupplier] = useState(true);
  const [ignoredPairs, setIgnoredPairs] = useState<Set<string>>(new Set());

  // Merge modal state
  const [activePair, setActivePair] = useState<DuplicatePair | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [mergeAliasesOption, setMergeAliasesOption] = useState(true);
  const [updateExpensesOption, setUpdateExpensesOption] = useState(true);
  const [runInBackground, setRunInBackground] = useState(false);

  // Fetch duplicates for this supplier
  const {
    data: auditData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["supplier-item-audit", supplierId, minScore, strictSupplier],
    queryFn: () =>
      getMasterItemAuditDuplicates({
        supplier_id: supplierId,
        supplier: supplierName,
        min_score: minScore,
        strict_supplier: strictSupplier,
      }),
    enabled: isOpen,
    staleTime: 30000,
  });

  const allPairs: DuplicatePair[] = auditData?.pairs || [];
  const visiblePairs = useMemo<DuplicatePair[]>(() => {
    return allPairs.filter((p: DuplicatePair) => {
      const key = `${Math.min(p.item_a.id, p.item_b.id)}-${Math.max(
        p.item_a.id,
        p.item_b.id
      )}`;
      return !ignoredPairs.has(key);
    });
  }, [allPairs, ignoredPairs]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-item-audit", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["supplier-top-items", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["supplier-expenses", supplierId] });
    queryClient.invalidateQueries({ queryKey: ["master-items"] });
    queryClient.invalidateQueries({ queryKey: ["master-items-audit"] });
    queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    if (onSuccess) onSuccess();
  };

  // Instant Merge Mutation
  const instantMergeMutation = useMutation({
    mutationFn: (payload: MasterItemMergeRequest) => mergeMasterItems(payload),
    onSuccess: (res) => {
      toast.success(res.message || "Item berhasil digabungkan.");
      setActivePair(null);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menggabungkan item.");
    },
  });

  // Background Single Merge Mutation
  const backgroundMergeMutation = useMutation({
    mutationFn: (payload: MasterItemMergeRequest) => enqueueMergeMasterItems(payload),
    onSuccess: (job) => {
      toast.success(
        `Tugas penggabungan item dimasukkan ke antrean latar belakang (#${job.id}).`
      );
      setActivePair(null);
      queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memasukkan tugas ke antrean.");
    },
  });

  // Background Batch Merge Mutation
  const batchMergeMutation = useMutation({
    mutationFn: (merges: any[]) => enqueueBatchMergeMasterItems(merges),
    onSuccess: (job) => {
      toast.success(
        `Penggabungan ${job.payload?.merges?.length || visiblePairs.length} pasang item telah masuk ke antrean latar belakang (#${job.id}).`
      );
      queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mendaftarkan penggabungan massal.");
    },
  });

  // Enqueue Background Audit Mutation
  const backgroundAuditMutation = useMutation({
    mutationFn: () =>
      enqueueMasterItemAudit({
        supplier_id: supplierId,
        supplier: supplierName,
        min_score: minScore,
        strict_supplier: strictSupplier,
      }),
    onSuccess: (job) => {
      toast.success(
        `Audit item toko didaftarkan ke antrean latar belakang (#${job.id}). Anda dapat melihat progresnya di status antrean.`
      );
      queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mendaftarkan audit ke antrean.");
    },
  });

  const openMergeModal = (pair: DuplicatePair) => {
    setActivePair(pair);
    const target =
      pair.suggested_primary_id === pair.item_b.id ? pair.item_b : pair.item_a;
    setMergeTargetId(target.id);
    setCustomName(target.item_name);
    setCustomCategory(target.category);
    setMergeAliasesOption(true);
    setUpdateExpensesOption(true);
    setRunInBackground(false);
  };

  const handleExecuteMerge = () => {
    if (!activePair || !mergeTargetId) return;
    const targetItem =
      mergeTargetId === activePair.item_a.id ? activePair.item_a : activePair.item_b;
    const sourceItem =
      mergeTargetId === activePair.item_a.id ? activePair.item_b : activePair.item_a;

    const payload: MasterItemMergeRequest = {
      target_item_id: targetItem.id,
      source_item_ids: [sourceItem.id],
      custom_name: customName.trim() || targetItem.item_name,
      custom_category: customCategory.trim() || targetItem.category,
      custom_supplier: targetItem.default_supplier || supplierName,
      merge_aliases: mergeAliasesOption,
      update_expenses: updateExpensesOption,
    };

    if (runInBackground) {
      backgroundMergeMutation.mutate(payload);
    } else {
      instantMergeMutation.mutate(payload);
    }
  };

  const handleBatchMergeAll = () => {
    if (visiblePairs.length === 0) return;
    const count = visiblePairs.length;
    if (
      !confirm(
        `Gabungkan ${count} pasang item duplikat sekaligus untuk toko '${supplierName}'? Tugas ini akan dijalankan di antrean latar belakang tanpa mengganggu layar Anda.`
      )
    ) {
      return;
    }

    const merges = visiblePairs.map((p: DuplicatePair) => {
      const targetId = p.suggested_primary_id;
      const target = p.item_a.id === targetId ? p.item_a : p.item_b;
      const source = p.item_a.id === targetId ? p.item_b : p.item_a;
      return {
        target_item_id: target.id,
        source_item_ids: [source.id],
        custom_name: target.item_name,
        custom_category: target.category,
        custom_supplier: target.default_supplier || supplierName,
        merge_aliases: true,
        update_expenses: true,
      };
    });

    batchMergeMutation.mutate(merges);
  };

  const ignorePair = (pair: DuplicatePair) => {
    const key = `${Math.min(pair.item_a.id, pair.item_b.id)}-${Math.max(
      pair.item_a.id,
      pair.item_b.id
    )}`;
    setIgnoredPairs((prev) => new Set([...prev, key]));
    toast.info("Rekomendasi diabaikan untuk sesi ini.");
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          {/* Header */}
          <DialogHeader className="p-6 pb-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <GitMerge className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    Audit Duplikat Item Toko
                    <Badge variant="outline" className="text-xs font-normal border-amber-300 text-amber-800 dark:text-amber-300">
                      {supplierName}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Mendeteksi perbedaan penulisan atau variasi nama barang pada riwayat belanja toko ini.
                  </DialogDescription>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isLoading || isRefetching}
                  className="h-8 px-2.5 text-xs rounded-xl"
                  title="Pindai ulang"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 mr-1.5 ${
                      isRefetching ? "animate-spin" : ""
                    }`}
                  />
                  Refresh
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => backgroundAuditMutation.mutate()}
                  disabled={backgroundAuditMutation.isPending}
                  className="h-8 px-2.5 text-xs rounded-xl text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40 border-blue-200 dark:border-blue-800"
                  title="Jalankan di antrean latar belakang"
                >
                  <Layers className="w-3.5 h-3.5 mr-1.5" />
                  Antrean Audit
                </Button>

                {visiblePairs.length > 0 && (
                  <Button
                    size="sm"
                    onClick={handleBatchMergeAll}
                    disabled={batchMergeMutation.isPending}
                    className="h-8 px-3 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    Gabungkan Semua ({visiblePairs.length})
                  </Button>
                )}
              </div>
            </div>

            {/* Controls Bar */}
            <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Filter mode tabs */}
              <div className="flex items-center gap-1.5 bg-slate-200/60 dark:bg-slate-800/60 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setStrictSupplier(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    strictSupplier
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  Hanya Item Toko Ini
                </button>
                <button
                  type="button"
                  onClick={() => setStrictSupplier(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    !strictSupplier
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  Termasuk Katalog Umum
                </button>
              </div>

              {/* Threshold Slider */}
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-600 dark:text-slate-400 font-medium">
                  Ambang Kemiripan:{" "}
                  <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {Math.round(minScore * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min="0.60"
                  max="0.95"
                  step="0.05"
                  value={minScore}
                  onChange={(e) => setMinScore(parseFloat(e.target.value))}
                  className="w-24 sm:w-32 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
              </div>
            </div>
          </DialogHeader>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {isLoading ? (
              <div className="py-20 text-center space-y-3">
                <RefreshCw className="w-8 h-8 mx-auto text-amber-500 animate-spin" />
                <p className="text-sm text-slate-500">
                  Menganalisis kemiripan nama barang toko {supplierName}...
                </p>
              </div>
            ) : visiblePairs.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 opacity-80" />
                <h3 className="font-semibold text-base text-slate-800 dark:text-slate-200">
                  Tidak Ada Duplikat Terdeteksi
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Semua nama item untuk toko ini terpantau rapi pada ambang kemiripan{" "}
                  {Math.round(minScore * 100)}%. Geser slider ambang ke kiri jika ingin mendeteksi variasi yang lebih longgar.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                  <span>
                    Ditemukan{" "}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {visiblePairs.length} pasang
                    </strong>{" "}
                    potensi item duplikat
                  </span>
                  <span>Rekomendasi nama item utama ditandai bintang</span>
                </div>

                {visiblePairs.map((pair: DuplicatePair, idx: number) => {
                  const isTargetA = pair.suggested_primary_id === pair.item_a.id;
                  const primaryItem = isTargetA ? pair.item_a : pair.item_b;
                  const secondaryItem = isTargetA ? pair.item_b : pair.item_a;

                  const isSubstring = pair.match_type === "substring";
                  const isPrefix = pair.match_type === "prefix_suffix";
                  const isAlias = pair.match_type === "alias";

                  return (
                    <div
                      key={idx}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm space-y-3 transition-all hover:border-slate-300 dark:hover:border-slate-700"
                    >
                      {/* Top Bar Card */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800/80">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={`text-[10px] font-semibold ${
                              pair.similarity_score >= 0.90
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-200"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200"
                            }`}
                          >
                            {Math.round(pair.similarity_score * 100)}% Mirip
                          </Badge>

                          <Badge variant="outline" className="text-[10px] text-slate-600 dark:text-slate-400">
                            {isSubstring
                              ? "Terkandung Utuh"
                              : isPrefix
                              ? "Kumpulan Kata Sama"
                              : isAlias
                              ? "Kata Kunci Alias"
                              : "Kemiripan Teks"}
                          </Badge>

                          {pair.both_in_supplier ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200"
                            >
                              Kedua Item Toko Ini
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200"
                            >
                              1 Item Toko + 1 Katalog
                            </Badge>
                          )}
                        </div>

                        <span className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                          {pair.reason}
                        </span>
                      </div>

                      {/* Items Comparison Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        {/* Item A */}
                        <div
                          className={`p-3 rounded-xl border transition-all ${
                            isTargetA
                              ? "border-emerald-300 dark:border-emerald-800/70 bg-emerald-50/30 dark:bg-emerald-950/10"
                              : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                              Item A (ID: {pair.item_a.id})
                            </span>
                            {isTargetA && (
                              <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1.5 gap-1">
                                <Sparkles className="w-2.5 h-2.5" />
                                Rekomendasi Utama
                              </Badge>
                            )}
                          </div>

                          <h4 className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                            {pair.item_a.item_name}
                          </h4>

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>Kategori: {pair.item_a.category}</span>
                            <span>•</span>
                            <span>{pair.item_a.tx_count}x belanja</span>
                            {pair.item_a.last_unit_price > 0 && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {formatRupiah(pair.item_a.last_unit_price)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Item B */}
                        <div
                          className={`p-3 rounded-xl border transition-all ${
                            !isTargetA
                              ? "border-emerald-300 dark:border-emerald-800/70 bg-emerald-50/30 dark:bg-emerald-950/10"
                              : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                              Item B (ID: {pair.item_b.id})
                            </span>
                            {!isTargetA && (
                              <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1.5 gap-1">
                                <Sparkles className="w-2.5 h-2.5" />
                                Rekomendasi Utama
                              </Badge>
                            )}
                          </div>

                          <h4 className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                            {pair.item_b.item_name}
                          </h4>

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>Kategori: {pair.item_b.category}</span>
                            <span>•</span>
                            <span>{pair.item_b.tx_count}x belanja</span>
                            {pair.item_b.last_unit_price > 0 && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {formatRupiah(pair.item_b.last_unit_price)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => ignorePair(pair)}
                          className="h-8 px-2.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl"
                        >
                          Abaikan
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => openMergeModal(pair)}
                          className="h-8 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm gap-1.5"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Tinjau & Gabungkan
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
            <Button variant="outline" size="sm" onClick={onClose} className="rounded-xl text-xs h-9">
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Eksekusi Penggabungan Item Spesifik */}
      {activePair && (
        <Dialog open={!!activePair} onOpenChange={(open) => !open && setActivePair(null)}>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-blue-600" />
                Gabungkan Item Baku
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Pilih item yang dijadikan target utama. Seluruh riwayat transaksi item duplikat akan dialihkan.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Pilihan Target Item */}
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                  Pilih Item Utama (Target):
                </label>
                <div className="space-y-2">
                  <div
                    onClick={() => {
                      setMergeTargetId(activePair.item_a.id);
                      setCustomName(activePair.item_a.item_name);
                      setCustomCategory(activePair.item_a.category);
                    }}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      mergeTargetId === activePair.item_a.id
                        ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                        {activePair.item_a.item_name}
                      </span>
                      {activePair.suggested_primary_id === activePair.item_a.id && (
                        <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1.5">
                          Disarankan
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      {activePair.item_a.category} • {activePair.item_a.tx_count}x belanja
                    </span>
                  </div>

                  <div
                    onClick={() => {
                      setMergeTargetId(activePair.item_b.id);
                      setCustomName(activePair.item_b.item_name);
                      setCustomCategory(activePair.item_b.category);
                    }}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      mergeTargetId === activePair.item_b.id
                        ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                        {activePair.item_b.item_name}
                      </span>
                      {activePair.suggested_primary_id === activePair.item_b.id && (
                        <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1.5">
                          Disarankan
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      {activePair.item_b.category} • {activePair.item_b.tx_count}x belanja
                    </span>
                  </div>
                </div>
              </div>

              {/* Input Nama Akhir */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nama Akhir Hasil Penggabungan:
                </label>
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                  placeholder="Nama baku item..."
                />
              </div>

              {/* Pilihan Opsi */}
              <div className="space-y-2 pt-1 text-xs">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mergeAliasesOption}
                    onChange={(e) => setMergeAliasesOption(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-600 dark:text-slate-400">
                    Simpan nama lama ke kata kunci alias agar input otomatis struk berikutnya tetap cocok.
                  </span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateExpensesOption}
                    onChange={(e) => setUpdateExpensesOption(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-600 dark:text-slate-400">
                    Alihkan semua riwayat transaksi belanja item duplikat ke item baku ini.
                  </span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-slate-100 dark:border-slate-800">
                  <input
                    type="checkbox"
                    checked={runInBackground}
                    onChange={(e) => setRunInBackground(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">
                    Jalankan di antrean latar belakang (asinkron)
                  </span>
                </label>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActivePair(null)}
                className="rounded-xl text-xs h-9"
              >
                Batal
              </Button>
              <Button
                size="sm"
                onClick={handleExecuteMerge}
                disabled={instantMergeMutation.isPending || backgroundMergeMutation.isPending}
                className="rounded-xl text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                {instantMergeMutation.isPending || backgroundMergeMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <GitMerge className="w-3.5 h-3.5 mr-1.5" />
                )}
                {runInBackground ? "Daftarkan ke Antrean" : "Gabungkan Sekarang"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
