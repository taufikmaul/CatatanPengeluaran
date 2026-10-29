import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataHygieneStats, runBulkDataClean } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Package,
  Store,
  Scale,
  CreditCard,
  ShieldCheck,
  Check,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import confetti from "canvas-confetti";

interface DataHygieneModalProps {
  isOpen: boolean;
  onClose: () => void;
  canClean?: boolean;
}

export const DataHygieneModal: React.FC<DataHygieneModalProps> = ({
  isOpen,
  onClose,
  canClean = true,
}) => {
  const queryClient = useQueryClient();

  const {
    data: stats,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["data-hygiene"],
    queryFn: getDataHygieneStats,
    enabled: isOpen,
    staleTime: 10 * 1000,
  });

  const cleanMutation = useMutation({
    mutationFn: runBulkDataClean,
    onSuccess: (res) => {
      toast.success(res.message);
      if (res.total_changes > 0) {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 },
        });
      }
      queryClient.invalidateQueries({ queryKey: ["data-hygiene"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["monthly-report"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
      queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      refetch();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menjalankan pembersihan data.");
    },
  });

  const score = stats?.hygiene_score ?? 100;
  const isClean = stats?.is_clean ?? true;

  const getScoreColor = (s: number) => {
    if (s >= 90) return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (s >= 70) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-rose-600 bg-rose-50 border-rose-200";
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader className="mb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <DialogTitle className="text-base font-bold text-slate-800 dark:text-slate-100">
                Pembersih & Normalisasi Data
              </DialogTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 w-8 p-0 rounded-xl"
              title="Perbarui status"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
            <p className="text-xs text-slate-500 font-medium">Menganalisis kerapian data transaksi...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Score Banner */}
            <div className={`p-4 rounded-2xl border flex items-center justify-between ${getScoreColor(score)}`}>
              <div className="flex items-center gap-3">
                <div className="text-3xl font-extrabold tracking-tight">
                  {score}%
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    {score >= 90 ? "Data Sangat Rapi" : score >= 70 ? "Cukup Rapi, Perlu Penyesuaian" : "Perlu Dinormalisasi"}
                  </h4>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    Dari total {stats?.total_expenses || 0} catatan belanja yang tersimpan
                  </p>
                </div>
              </div>
              {isClean ? (
                <Badge className="bg-emerald-600 text-white gap-1 text-xs px-2.5 py-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Optimal
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-300 text-amber-800 text-xs px-2.5 py-1">
                  Perlu Rapikan
                </Badge>
              )}
            </div>

            {/* Health Breakdown Cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <Package className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Master Item</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Belum terhubung:</span>
                  <span className={`text-xs font-bold tabular-nums ${stats?.unlinked_master_item_count ? "text-amber-600" : "text-emerald-600"}`}>
                    {stats?.unlinked_master_item_count || 0}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <Store className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Supplier Toko</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Belum terhubung:</span>
                  <span className={`text-xs font-bold tabular-nums ${stats?.unlinked_supplier_count ? "text-amber-600" : "text-emerald-600"}`}>
                    {stats?.unlinked_supplier_count || 0}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <Scale className="w-4 h-4 text-violet-600" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Satuan Unit</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Format non-baku:</span>
                  <span className={`text-xs font-bold tabular-nums ${stats?.unnormalized_units_count ? "text-amber-600" : "text-emerald-600"}`}>
                    {stats?.unnormalized_units_count || 0}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <CreditCard className="w-4 h-4 text-teal-600" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Metode Bayar</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">Format non-baku:</span>
                  <span className={`text-xs font-bold tabular-nums ${stats?.unnormalized_pay_methods_count ? "text-amber-600" : "text-emerald-600"}`}>
                    {stats?.unnormalized_pay_methods_count || 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Explanation box */}
            <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 text-[11px] text-slate-600 dark:text-slate-400 space-y-1.5">
              <div className="font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-blue-600" />
                <span>Pembersihan Aman & Otomatis:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-1">
                <li>Nama barang dicocokkan otomatis ke katalog Master Item (nama asli tetap dicatat di kolom catatan).</li>
                <li>Nama toko otomatis diselaraskan ke Master Supplier resmi.</li>
                <li>Satuan barang (kg, KG, pcs, pak) & metode pembayaran (transfer, bca, tunai) distandarisasi ke format baku.</li>
                <li>Tidak ada data transaksi yang dihapus dalam proses ini.</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="rounded-xl text-xs h-9 px-4"
              >
                Tutup
              </Button>
              {canClean && (
                <Button
                  type="button"
                  size="sm"
                  disabled={cleanMutation.isPending || isClean}
                  onClick={() => cleanMutation.mutate()}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-9 px-4 font-semibold gap-1.5 shadow-sm"
                >
                  {cleanMutation.isPending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Sedang Merapikan...</span>
                    </>
                  ) : isClean ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Data Sudah 100% Rapi</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                      <span>⚡ Rapikan Semua Data Sekaligus</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
