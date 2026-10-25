import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Percent,
  Copy,
  RotateCcw,
  Sparkles,
  Calendar,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Sliders,
  ArrowRight,
} from "lucide-react";
import { formatRupiah } from "@/lib/formatters";
import { getMonthlyBudget, saveMonthlyBudget, copyMonthlyBudget } from "@/lib/api";
import { toast } from "sonner";

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

interface BudgetSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialYear: number;
  initialMonth: number;
  onBudgetUpdated?: () => void;
  currentSpending?: Record<string, number>;
}

export const BudgetSetupDialog: React.FC<BudgetSetupDialogProps> = ({
  isOpen,
  onClose,
  initialYear,
  initialMonth,
  onBudgetUpdated,
  currentSpending = {},
}) => {
  const [selectedYear, setSelectedYear] = useState<number>(initialYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(initialMonth);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isCopying, setIsCopying] = useState<boolean>(false);

  const [totalBudget, setTotalBudget] = useState<number>(0);
  const [percentages, setPercentages] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [isCustom, setIsCustom] = useState<boolean>(false);

  // Sync initial props when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedYear(initialYear);
      setSelectedMonth(initialMonth);
    }
  }, [isOpen, initialYear, initialMonth]);

  // Fetch budget for the selected month/year
  const fetchBudget = async (year: number, month: number) => {
    setIsLoading(true);
    try {
      const data = await getMonthlyBudget(year, month);
      setTotalBudget(data.total_budget || 0);
      setPercentages(data.category_percentages || {});
      setCategories(data.valid_categories || []);
      setIsCustom(Boolean(data.is_custom));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal memuat anggaran bulanan");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBudget(selectedYear, selectedMonth);
    }
  }, [isOpen, selectedYear, selectedMonth]);

  // Navigate months
  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  // Calculations
  const totalAllocatedPercentage = useMemo(() => {
    return Object.values(percentages).reduce(
      (sum, val) => sum + (Number(val) || 0),
      0
    );
  }, [percentages]);

  const totalAllocatedRupiah = useMemo(() => {
    return Math.round((totalBudget * totalAllocatedPercentage) / 100);
  }, [totalBudget, totalAllocatedPercentage]);

  const remainingPercentage = Math.round((100 - totalAllocatedPercentage) * 10) / 10;
  const remainingRupiah = Math.max(0, totalBudget - totalAllocatedRupiah);

  const isOverAllocated = totalAllocatedPercentage > 100;
  const isExactAllocated = Math.abs(totalAllocatedPercentage - 100) < 0.01;

  // Handle category percentage change
  const handlePercentageChange = (cat: string, value: string) => {
    const num = Math.max(0, Math.min(100, parseFloat(value) || 0));
    setPercentages((prev) => ({
      ...prev,
      [cat]: num,
    }));
  };

  // Quick preset total budget additions
  const handleAddBudget = (amount: number) => {
    setTotalBudget((prev) => Math.max(0, prev + amount));
  };

  // Distribute remaining % evenly among categories with 0% or all
  const handleDistributeRemaining = () => {
    if (remainingPercentage <= 0) {
      toast.info("Tidak ada sisa persentase untuk dibagikan.");
      return;
    }
    const emptyCats = categories.filter((c) => !percentages[c] || percentages[c] === 0);
    const targetCats = emptyCats.length > 0 ? emptyCats : categories;
    if (targetCats.length === 0) return;

    const share = Math.round((remainingPercentage / targetCats.length) * 10) / 10;
    setPercentages((prev) => {
      const updated = { ...prev };
      targetCats.forEach((c) => {
        updated[c] = Math.round(((updated[c] || 0) + share) * 10) / 10;
      });
      return updated;
    });
    toast.success(`Sisa ${remainingPercentage}% dibagikan ke ${targetCats.length} kategori.`);
  };

  // Distribute all categories equally to 100%
  const handleEvenAll = () => {
    if (categories.length === 0) return;
    const share = Math.round((100 / categories.length) * 10) / 10;
    const updated: Record<string, number> = {};
    categories.forEach((c) => {
      updated[c] = share;
    });
    setPercentages(updated);
    toast.info(`Persentase dibagi rata (${share}% per kategori).`);
  };

  // Reset all percentages
  const handleResetPercentages = () => {
    setPercentages({});
    toast.info("Alokasi persentase di-reset ke 0%.");
  };

  // Copy from previous month
  const handleCopyPrevious = async () => {
    setIsCopying(true);
    try {
      const res = await copyMonthlyBudget(selectedYear, selectedMonth);
      setTotalBudget(res.total_budget || 0);
      setPercentages(res.category_percentages || {});
      setIsCustom(true);
      toast.success(res.message || "Berhasil menyalin anggaran dari bulan sebelumnya!");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal menyalin anggaran");
    } finally {
      setIsCopying(false);
    }
  };

  // Save budget
  const handleSave = async () => {
    if (totalBudget < 0) {
      toast.error("Total anggaran tidak boleh bernilai negatif");
      return;
    }
    setIsSaving(true);
    try {
      const cleanPcts: Record<string, number> = {};
      Object.entries(percentages).forEach(([k, v]) => {
        if (v > 0) cleanPcts[k] = v;
      });

      const res = await saveMonthlyBudget({
        year: selectedYear,
        month: selectedMonth,
        total_budget: totalBudget,
        category_percentages: cleanPcts,
      });

      toast.success(res.message || "Anggaran bulanan berhasil disimpan!");
      setIsCustom(true);
      if (onBudgetUpdated) {
        onBudgetUpdated();
      }
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan anggaran");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0 rounded-2xl border-slate-200">
        {/* Header with Month Selector */}
        <div className="p-5 md:p-6 border-b border-slate-100 bg-slate-50/70">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <DialogHeader className="text-left space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <Target className="w-4 h-4" />
                  </div>
                  <DialogTitle className="text-base md:text-lg font-bold text-slate-900">
                    Setup Anggaran Bulanan
                  </DialogTitle>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      isCustom
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {isCustom ? "Kustom Bulan Ini" : "Standar Global"}
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-slate-500">
                  Tentukan plafon keseluruhan, lalu atur alokasi persentase per kategori dengan preview nominal Rupiah otomatis.
                </DialogDescription>
              </DialogHeader>
            </div>

            {/* Month-Year Navigator */}
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs self-start sm:self-auto">
              <button
                type="button"
                onClick={handlePrevMonth}
                disabled={isLoading}
                aria-label="Bulan sebelumnya"
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-3 text-center min-w-[130px]">
                <span className="text-xs font-bold text-slate-800 block leading-tight">
                  {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                </span>
                <span className="text-[10px] text-slate-400">Pilih Bulan</span>
              </div>
              <button
                type="button"
                onClick={handleNextMonth}
                disabled={isLoading}
                aria-label="Bulan berikutnya"
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 md:p-6 space-y-6">
          {/* Step 1: Overall Budget (Rupiah) */}
          <div className="p-4 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center">
                  1
                </span>
                Anggaran Keseluruhan ({MONTH_NAMES[selectedMonth - 1]} {selectedYear})
              </label>
              <span className="text-xs font-bold text-emerald-800 tabular-nums">
                {formatRupiah(totalBudget)}
              </span>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                Rp
              </span>
              <Input
                type="number"
                step="any"
                min="0"
                value={totalBudget || ""}
                onChange={(e) => setTotalBudget(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Contoh: 25000000"
                className="pl-10 h-11 text-sm font-semibold rounded-xl bg-white border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[11px] font-medium text-emerald-800 mr-1">Tambah Cepat:</span>
              <button
                type="button"
                onClick={() => handleAddBudget(1_000_000)}
                className="text-[11px] font-semibold bg-white text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
              >
                +1 Jt
              </button>
              <button
                type="button"
                onClick={() => handleAddBudget(5_000_000)}
                className="text-[11px] font-semibold bg-white text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
              >
                +5 Jt
              </button>
              <button
                type="button"
                onClick={() => handleAddBudget(10_000_000)}
                className="text-[11px] font-semibold bg-white text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
              >
                +10 Jt
              </button>
              <button
                type="button"
                onClick={() => setTotalBudget(0)}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 ml-auto"
              >
                Reset 0
              </button>
            </div>
          </div>

          {/* Allocation Health Bar */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800">
                  Total Alokasi:{" "}
                  <span
                    className={
                      isOverAllocated
                        ? "text-rose-600 font-extrabold"
                        : isExactAllocated
                        ? "text-emerald-600 font-extrabold"
                        : "text-amber-600 font-extrabold"
                    }
                  >
                    {totalAllocatedPercentage}%
                  </span>
                </span>
                <span className="text-slate-400">•</span>
                <span className="font-semibold text-slate-700 tabular-nums">
                  {formatRupiah(totalAllocatedRupiah)}
                </span>
              </div>

              <div>
                {isOverAllocated ? (
                  <span className="text-rose-600 font-semibold flex items-center gap-1 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Kelebihan {Math.round((totalAllocatedPercentage - 100) * 10) / 10}% (
                    {formatRupiah(totalAllocatedRupiah - totalBudget)})
                  </span>
                ) : isExactAllocated ? (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Alokasi Pas 100%
                  </span>
                ) : (
                  <span className="text-amber-700 font-medium text-[11px]">
                    Sisa belum dialokasi:{" "}
                    <strong>
                      {remainingPercentage}% ({formatRupiah(remainingRupiah)})
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* Progress Visual Bar */}
            <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all duration-300 ${
                  isOverAllocated
                    ? "bg-rose-500"
                    : isExactAllocated
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                }`}
                style={{ width: `${Math.min(100, totalAllocatedPercentage)}%` }}
              />
            </div>

            {/* Helper Action Buttons */}
            <div className="flex items-center justify-between pt-1 flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDistributeRemaining}
                  disabled={remainingPercentage <= 0}
                  className="h-7 text-[11px] rounded-lg px-2.5 font-medium border-slate-200"
                >
                  <Sparkles className="w-3 h-3 text-amber-500 mr-1" />
                  Bagi Rata Sisa {remainingPercentage > 0 ? `(${remainingPercentage}%)` : ""}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleEvenAll}
                  className="h-7 text-[11px] rounded-lg px-2.5 font-medium border-slate-200"
                >
                  Bagi Rata Semua
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetPercentages}
                  className="h-7 text-[11px] rounded-lg px-2 text-slate-500 hover:text-slate-800"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyPrevious}
                disabled={isCopying}
                className="h-7 text-[11px] rounded-lg px-2.5 font-medium border-sky-200 text-sky-800 hover:bg-sky-50"
              >
                <Copy className="w-3 h-3 text-sky-600 mr-1" />
                {isCopying ? "Menyalin..." : "Salin Bulan Lalu"}
              </Button>
            </div>
          </div>

          {/* Step 2: Per Category Percentage Setup with Live Rupiah Preview */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center">
                  2
                </span>
                Alokasi Anggaran Per Kategori (%) & Preview Rupiah
              </label>
              <span className="text-[11px] text-slate-400">
                Isi persentase alokasi untuk tiap kategori
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {categories.map((cat) => {
                const pctVal = percentages[cat] || 0;
                const rupiahVal = totalBudget > 0 ? Math.round((totalBudget * pctVal) / 100) : 0;
                const spent = currentSpending[cat] || 0;

                return (
                  <div
                    key={cat}
                    className={`p-3 rounded-xl border transition-all ${
                      pctVal > 0
                        ? "border-slate-300 bg-white shadow-2xs"
                        : "border-slate-200/70 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-slate-800 truncate" title={cat}>
                        {cat}
                      </span>
                      {spent > 0 && (
                        <span className="text-[10px] text-slate-400 shrink-0">
                          Aktual: {formatRupiah(spent)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Percentage Input */}
                      <div className="relative w-28 shrink-0">
                        <Input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={percentages[cat] ?? ""}
                          onChange={(e) => handlePercentageChange(cat, e.target.value)}
                          placeholder="0"
                          className="h-8 text-xs font-bold text-slate-900 pr-6 rounded-lg bg-white"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                          %
                        </span>
                      </div>

                      {/* Live Rupiah Preview */}
                      <div className="flex-1 bg-slate-100/80 rounded-lg px-2.5 py-1.5 flex items-center justify-between min-w-0">
                        <span className="text-[10px] font-medium text-slate-500 truncate mr-1">
                          Preview Rp:
                        </span>
                        <span className="text-xs font-bold text-slate-900 tabular-nums truncate">
                          {formatRupiah(rupiahVal)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 md:p-5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs rounded-xl"
          >
            Batal
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold px-4 h-9 gap-1.5"
          >
            {isSaving ? "Menyimpan..." : `Simpan Anggaran ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
