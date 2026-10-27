import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupplierAuditDuplicates, mergeSuppliers } from "@/lib/api";
import { SupplierDuplicateGroup } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Store,
  RefreshCw,
  GitMerge,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Phone,
  MapPin,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";

interface AuditSupplierDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  canDelete: boolean;
}

export const AuditSupplierDuplicatesModal: React.FC<AuditSupplierDuplicatesModalProps> = ({
  isOpen,
  onClose,
  canDelete,
}) => {
  const queryClient = useQueryClient();
  const [selectedTargets, setSelectedTargets] = useState<Record<number, number>>({});

  const {
    data: clusters = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<SupplierDuplicateGroup[]>({
    queryKey: ["supplier-audit-duplicates"],
    queryFn: () => getSupplierAuditDuplicates(0.75),
    enabled: isOpen,
  });

  const mergeMutation = useMutation({
    mutationFn: ({ targetId, sourceIds }: { targetId: number; sourceIds: number[] }) =>
      mergeSuppliers(targetId, sourceIds),
    onSuccess: (data) => {
      toast.success(
        `Berhasil menggabungkan ${data.merged_supplier_count} supplier ke ${data.target_supplier_name} (${data.expenses_transferred} transaksi dialihkan).`
      );
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-audit-duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menggabungkan supplier.");
    },
  });

  const handleMergeCluster = (clusterIndex: number, cluster: SupplierDuplicateGroup) => {
    if (!canDelete) {
      toast.error("Tindakan penggabungan supplier hanya dapat dilakukan oleh Owner.");
      return;
    }

    const allCandidates = [cluster.primary, ...cluster.duplicates];
    const targetId = selectedTargets[clusterIndex] ?? cluster.suggested_primary_id;
    const sourceIds = allCandidates
      .filter((c) => c.id !== targetId)
      .map((c) => c.id);

    if (sourceIds.length === 0) {
      toast.error("Pilih minimal satu supplier untuk digabung.");
      return;
    }

    mergeMutation.mutate({ targetId, sourceIds });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Audit Duplikat Toko / Supplier
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Deteksi toko dengan kemiripan nama atau variasi ejaan. Gabungkan ke satu data baku untuk menjaga konsistensi.
                </DialogDescription>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
              className="gap-2 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
              Pindai Ulang
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!canDelete && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                Anda login sebagai <strong>Admin Input</strong>. Peninjauan audit dapat dilakukan, namun aksi <strong>Penggabungan (Merge)</strong> hanya dapat dieksekusi oleh <strong>Owner</strong>.
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
              Memindai kemiripan nama supplier di database...
            </div>
          ) : clusters.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Tidak Ditemukan Indikasi Duplikat
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                Semua master toko/supplier saat ini memiliki nama yang unik dan tidak menunjukkan kemiripan mencurigakan.
              </p>
            </div>
          ) : (
            clusters.map((cluster, idx) => {
              const allCandidates = [cluster.primary, ...cluster.duplicates];
              const currentTargetId = selectedTargets[idx] ?? cluster.suggested_primary_id;
              const targetItem = allCandidates.find((c) => c.id === currentTargetId) || allCandidates[0];

              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                        Kelompok Potensi Duplikat #{idx + 1}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[10px] text-slate-500">
                      {allCandidates.length} nama serupa
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pilih toko yang menjadi <strong>Target Utama (dipertahankan)</strong>:
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {allCandidates.map((cand) => {
                        const isTarget = cand.id === currentTargetId;
                        const isPrimary = cand.id === cluster.suggested_primary_id;

                        return (
                          <div
                            key={cand.id}
                            onClick={() => setSelectedTargets((prev) => ({ ...prev, [idx]: cand.id }))}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                              isTarget
                                ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-500"
                                : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/40"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                                  {cand.name}
                                </span>
                                {isPrimary && (
                                  <Badge className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200">
                                    Saran Sistem
                                  </Badge>
                                )}
                              </div>
                              <input
                                type="radio"
                                name={`cluster-target-${idx}`}
                                checked={isTarget}
                                onChange={() => setSelectedTargets((prev) => ({ ...prev, [idx]: cand.id }))}
                                className="mt-0.5 text-blue-600 focus:ring-blue-500"
                              />
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                              <span>
                                Transaksi: <strong>{cand.transaction_count}</strong>
                              </span>
                              <span>•</span>
                              <span>
                                Belanja: <strong>{formatRupiah(cand.total_spent)}</strong>
                              </span>
                            </div>

                            {cand.phone && (
                              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                                <Phone className="w-2.5 h-2.5" />
                                <span>{cand.phone}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <div>
                      <span>
                        Hasil penggabungan: Transaksi belanja dari toko lain akan dialihkan ke{" "}
                        <strong className="text-slate-800 dark:text-slate-200">{targetItem.name}</strong>, nama toko lain disimpan sebagai alias.
                      </span>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleMergeCluster(idx, cluster)}
                      disabled={!canDelete || mergeMutation.isPending}
                      className="ml-3 gap-1.5 shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                    >
                      <GitMerge className="w-3.5 h-3.5" />
                      Gabungkan
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
