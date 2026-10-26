import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getExpenseAuditDuplicates } from "@/lib/api";
import { ExpenseDuplicatePair } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Trash2,
  Calendar,
  Layers,
  ArrowRight,
  EyeOff,
  User as UserIcon,
  Store,
  Tag,
  CheckCircle2,
  Clock,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface AuditDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMonth: number;
  currentYear: number;
  onDeleteExpense: (id: number) => void;
  canDelete: boolean;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const IGNORED_STORAGE_KEY = "catpen_ignored_expense_duplicates";

export const AuditDuplicatesModal: React.FC<AuditDuplicatesModalProps> = ({
  isOpen,
  onClose,
  currentMonth,
  currentYear,
  onDeleteExpense,
  canDelete,
}) => {
  const queryClient = useQueryClient();

  const [minSimilarity, setMinSimilarity] = useState<number>(0.90);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [filterPeriod, setFilterPeriod] = useState<"current_month" | "all_time">("current_month");

  // Ignored pairs persisted in localStorage
  const [ignoredPairKeys, setIgnoredPairKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(IGNORED_STORAGE_KEY);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch {
      // fallback
    }
    return new Set();
  });

  const saveIgnoredKeys = (newKeys: Set<string>) => {
    setIgnoredPairKeys(newKeys);
    try {
      localStorage.setItem(IGNORED_STORAGE_KEY, JSON.stringify(Array.from(newKeys)));
    } catch {
      // ignore
    }
  };

  const handleIgnorePair = (idA: number, idB: number) => {
    const key = `${Math.min(idA, idB)}-${Math.max(idA, idB)}`;
    const next = new Set(ignoredPairKeys);
    next.add(key);
    saveIgnoredKeys(next);
    toast.info("Pasangan transaksi ditandai sebagai bukan duplikat.");
  };

  const handleResetIgnored = () => {
    saveIgnoredKeys(new Set());
    toast.success("Daftar abaikan berhasil direset.");
  };

  const monthParam = filterPeriod === "current_month" ? selectedMonth : undefined;
  const yearParam = filterPeriod === "current_month" ? selectedYear : undefined;

  const {
    data: auditData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["expense-audit-duplicates", minSimilarity, monthParam, yearParam],
    queryFn: () =>
      getExpenseAuditDuplicates({
        min_similarity: minSimilarity,
        month: monthParam,
        year: yearParam,
      }),
    enabled: isOpen,
    staleTime: 1000 * 30, // 30 detik
  });

  const activePairs = useMemo(() => {
    if (!auditData?.pairs) return [];
    return auditData.pairs.filter((p) => {
      const key = `${Math.min(p.expense_a.id, p.expense_b.id)}-${Math.max(p.expense_a.id, p.expense_b.id)}`;
      return !ignoredPairKeys.has(key);
    });
  }, [auditData, ignoredPairKeys]);

  const activeWaste = useMemo(() => {
    const seen = new Set<number>();
    let sum = 0;
    for (const p of activePairs) {
      if (!seen.has(p.suggested_delete_id)) {
        seen.add(p.suggested_delete_id);
        sum += p.total_price;
      }
    }
    return sum;
  }, [activePairs]);

  const handleDelete = (idToDelete: number, keepItemName: string) => {
    if (!canDelete) {
      toast.error("Hanya Owner / Admin Utama yang dapat menghapus transaksi belanja.");
      return;
    }

    if (
      confirm(
        `Hapus transaksi duplikat #${idToDelete} dan pertahankan data lainnya? Tindakan ini akan menghapus entri belanja tersebut.`
      )
    ) {
      onDeleteExpense(idToDelete);
      queryClient.invalidateQueries({ queryKey: ["expense-audit-duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        {/* Header */}
        <DialogHeader className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-3 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/80 dark:border-amber-900/60 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>Audit Duplikat Data Pengeluaran</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                  >
                    Auto Scan
                  </Badge>
                </DialogTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Mendeteksi transaksi kembar: <strong className="font-semibold text-slate-700 dark:text-slate-300">Nama mirip ≥{Math.round(minSimilarity * 100)}% + Tanggal sama + Nominal sama</strong>.
                </p>
              </div>
            </div>

            {/* Quick Action Refresh */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading || isRefetching}
                className="h-8 rounded-lg text-xs gap-1.5 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
                <span>Pindai Ulang</span>
              </Button>
            </div>
          </div>

          {/* Sub Toolbar Controls (Filter Period & Threshold) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Period selection */}
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium text-slate-600 dark:text-slate-400">Periode:</span>
                <select
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value as any)}
                  className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-800 dark:text-slate-200"
                >
                  <option value="current_month">Bulan Terpilih</option>
                  <option value="all_time">Semua Waktu (Seluruh Database)</option>
                </select>
              </div>

              {filterPeriod === "current_month" && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs font-medium text-slate-800 dark:text-slate-200"
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs font-medium text-slate-800 dark:text-slate-200"
                  >
                    {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Similarity Threshold selector */}
              <div className="flex items-center gap-1.5 ml-0 sm:ml-2">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium text-slate-600 dark:text-slate-400">Kemiripan:</span>
                <select
                  value={minSimilarity}
                  onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                  className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-800 dark:text-slate-200"
                >
                  <option value={0.90}>Standar (≥ 90% - Rekomendasi)</option>
                  <option value={0.95}>Ketat (≥ 95% kemiripan)</option>
                  <option value={1.00}>Identik (100% sama persis)</option>
                  <option value={0.80}>Sensitif / Luas (≥ 80%)</option>
                </select>
              </div>
            </div>

            {/* Counts Badge */}
            <div className="flex items-center gap-2">
              {ignoredPairKeys.size > 0 && (
                <button
                  type="button"
                  onClick={handleResetIgnored}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                >
                  Tampilkan {ignoredPairKeys.size} diabaikan
                </button>
              )}
              <Badge
                variant={activePairs.length > 0 ? "destructive" : "secondary"}
                className="text-xs py-1 px-2.5 font-semibold"
              >
                {activePairs.length} Potensi Duplikat
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Potential Waste Summary Banner (if duplicates exist) */}
        {activePairs.length > 0 && (
          <div className="px-5 py-3 bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                Ditemukan <strong>{activePairs.length} pasangan transaksi kembar</strong> yang berpotensi menyebabkan pencatatan pengeluaran ganda.
              </span>
            </div>
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-200 shrink-0">
              Potensi Pengeluaran Ganda: <span className="text-rose-600 dark:text-rose-400 font-bold tabular-nums">{formatRupiah(activeWaste)}</span>
            </div>
          </div>
        )}

        {/* Content Body - Scrollable */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 bg-slate-50/50 dark:bg-slate-950/40">
          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Memindai catatan pengeluaran...
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Mencocokkan tanggal transaksi, kesamaan nominal, dan kemiripan nama barang (≥{Math.round(minSimilarity * 100)}%)...
              </p>
            </div>
          ) : activePairs.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Data Bersih! Tidak Ditemukan Transaksi Duplikat
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Semua transaksi pada periode ini unik. Tidak ada catatan dengan kesamaan tanggal, nominal, dan nama barang ≥{Math.round(minSimilarity * 100)}%.
              </p>
            </div>
          ) : (
            activePairs.map((pair) => {
              const itemA = pair.expense_a;
              const itemB = pair.expense_b;
              const isItemASuggestedKeep = pair.suggested_keep_id === itemA.id;

              return (
                <div
                  key={`${itemA.id}-${itemB.id}`}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                >
                  {/* Top Match Criteria Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold">
                        <Sparkles className="w-3 h-3 mr-1" />
                        {pair.similarity_pct}% Kemiripan Nama
                      </Badge>
                      <Badge variant="outline" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        <Calendar className="w-3 h-3 mr-1 text-slate-400" />
                        Tanggal: {formatDateId(pair.expense_date)}
                      </Badge>
                      <Badge variant="outline" className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        Nominal: {formatRupiah(pair.total_price)}
                      </Badge>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleIgnorePair(itemA.id, itemB.id)}
                      className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 font-medium transition-colors"
                      title="Sembunyikan dari audit duplikat"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Bukan Duplikat</span>
                    </button>
                  </div>

                  {/* Side-by-Side Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Card Transaksi A */}
                    <div
                      className={`rounded-xl p-3 border space-y-2 transition-all ${
                        isItemASuggestedKeep
                          ? "bg-slate-50/80 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700"
                          : "bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-slate-700 dark:text-slate-300">
                            Transaksi #{itemA.id}
                          </span>
                          {isItemASuggestedKeep ? (
                            <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
                              Disarankan Simpan
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
                              Potensi Duplikat
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatRupiah(itemA.total_price)}
                        </span>
                      </div>

                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {itemA.item_name}
                      </div>

                      <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                        <div className="flex items-center gap-1 truncate">
                          <Store className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemA.supplier || "-"}</span>
                        </div>
                        <div className="flex items-center gap-1 truncate">
                          <Tag className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemA.category || "Operasional"}</span>
                        </div>
                        <div className="flex items-center gap-1 truncate">
                          <Clock className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemA.created_at ? formatDateId(itemA.created_at) : formatDateId(itemA.expense_date)}</span>
                        </div>
                        <div className="flex items-center gap-1 truncate">
                          <UserIcon className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemA.user_name || "System"}</span>
                        </div>
                      </div>

                      {/* Action for Item A */}
                      <div className="pt-2 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(itemA.id, itemB.item_name)}
                          disabled={!canDelete}
                          className="h-7 px-2.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 gap-1 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus #{itemA.id}</span>
                        </Button>
                      </div>
                    </div>

                    {/* Card Transaksi B */}
                    <div
                      className={`rounded-xl p-3 border space-y-2 transition-all ${
                        !isItemASuggestedKeep
                          ? "bg-slate-50/80 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700"
                          : "bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-slate-700 dark:text-slate-300">
                            Transaksi #{itemB.id}
                          </span>
                          {!isItemASuggestedKeep ? (
                            <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
                              Disarankan Simpan
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
                              Potensi Duplikat
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatRupiah(itemB.total_price)}
                        </span>
                      </div>

                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {itemB.item_name}
                      </div>

                      <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                        <div className="flex items-center gap-1 truncate">
                          <Store className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemB.supplier || "-"}</span>
                        </div>
                        <div className="flex items-center gap-1 truncate">
                          <Tag className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemB.category || "Operasional"}</span>
                        </div>
                        <div className="flex items-center gap-1 truncate">
                          <Clock className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemB.created_at ? formatDateId(itemB.created_at) : formatDateId(itemB.expense_date)}</span>
                        </div>
                        <div className="flex items-center gap-1 truncate">
                          <UserIcon className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{itemB.user_name || "System"}</span>
                        </div>
                      </div>

                      {/* Action for Item B */}
                      <div className="pt-2 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(itemB.id, itemA.item_name)}
                          disabled={!canDelete}
                          className="h-7 px-2.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 gap-1 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus #{itemB.id}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Audit ini membandingkan seluruh data belanja aktif untuk mencegah pelaporan ganda pada sistem akuntansi.
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 rounded-xl text-xs px-4"
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
