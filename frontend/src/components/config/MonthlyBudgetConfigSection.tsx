import React, { useState, useEffect } from "react";
import { SystemConfig } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getMonthlyBudget, saveMonthlyBudget, copyMonthlyBudget } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { toast } from "sonner";
import {
  Save,
  Target,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Percent,
  Copy,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface MonthlyBudgetConfigSectionProps {
  config: SystemConfig | null;
  onRefreshConfig: () => void;
}

export const MonthlyBudgetConfigSection: React.FC<MonthlyBudgetConfigSectionProps> = ({
  config,
  onRefreshConfig,
}) => {
  const now = new Date();
  const [budgetYear, setBudgetYear] = useState<number>(now.getFullYear());
  const [budgetMonth, setBudgetMonth] = useState<number>(now.getMonth() + 1);
  const [isMonthBudgetLoading, setIsMonthBudgetLoading] = useState(false);
  const [monthTotalBudget, setMonthTotalBudget] = useState<number>(0);
  const [categoryPercentages, setCategoryPercentages] = useState<Record<string, number>>({});
  const [isMonthCustom, setIsMonthCustom] = useState<boolean>(false);
  const [isSavingMonthBudget, setIsSavingMonthBudget] = useState<boolean>(false);
  const [isCopyingMonthBudget, setIsCopyingMonthBudget] = useState<boolean>(false);

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

  const fetchMonthBudgetData = async (y: number, m: number) => {
    setIsMonthBudgetLoading(true);
    try {
      const data = await getMonthlyBudget(y, m);
      setMonthTotalBudget(data.total_budget || 0);
      setCategoryPercentages(data.category_percentages || {});
      setIsMonthCustom(Boolean(data.is_custom));
    } catch (err: any) {
      console.error("Gagal memuat anggaran bulan:", err);
    } finally {
      setIsMonthBudgetLoading(false);
    }
  };

  useEffect(() => {
    fetchMonthBudgetData(budgetYear, budgetMonth);
  }, [budgetYear, budgetMonth]);

  const handlePrevBudgetMonth = () => {
    if (budgetMonth === 1) {
      setBudgetMonth(12);
      setBudgetYear((y) => y - 1);
    } else {
      setBudgetMonth((m) => m - 1);
    }
  };

  const handleNextBudgetMonth = () => {
    if (budgetMonth === 12) {
      setBudgetMonth(1);
      setBudgetYear((y) => y + 1);
    } else {
      setBudgetMonth((m) => m + 1);
    }
  };

  const totalAllocatedPercentage = Object.values(categoryPercentages).reduce(
    (acc, val) => acc + (Number(val) || 0),
    0
  );
  const totalAllocatedRupiah = Math.round((monthTotalBudget * totalAllocatedPercentage) / 100);
  const remainingPercentage = Math.round((100 - totalAllocatedPercentage) * 10) / 10;
  const remainingRupiah = Math.max(0, monthTotalBudget - totalAllocatedRupiah);
  const isOverAllocated = totalAllocatedPercentage > 100;
  const isExactAllocated = Math.abs(totalAllocatedPercentage - 100) < 0.01;

  const handlePercentageChange = (cat: string, val: string) => {
    const num = Math.max(0, Math.min(100, parseFloat(val) || 0));
    setCategoryPercentages((prev) => ({
      ...prev,
      [cat]: num,
    }));
  };

  const handleDistributeRemainingPercentages = () => {
    if (remainingPercentage <= 0) {
      toast.info("Tidak ada sisa persentase untuk dibagikan.");
      return;
    }
    const cats = config?.valid_categories || [];
    const emptyCats = cats.filter((c) => !categoryPercentages[c] || categoryPercentages[c] === 0);
    const targetCats = emptyCats.length > 0 ? emptyCats : cats;
    if (targetCats.length === 0) return;

    const share = Math.round((remainingPercentage / targetCats.length) * 10) / 10;
    setCategoryPercentages((prev) => {
      const updated = { ...prev };
      targetCats.forEach((c) => {
        updated[c] = Math.round(((updated[c] || 0) + share) * 10) / 10;
      });
      return updated;
    });
    toast.success(`Sisa ${remainingPercentage}% dibagikan ke ${targetCats.length} kategori.`);
  };

  const handleEvenAllPercentages = () => {
    const cats = config?.valid_categories || [];
    if (cats.length === 0) return;
    const share = Math.round((100 / cats.length) * 10) / 10;
    const updated: Record<string, number> = {};
    cats.forEach((c) => {
      updated[c] = share;
    });
    setCategoryPercentages(updated);
    toast.info(`Persentase dibagi rata (${share}% per kategori).`);
  };

  const handleResetCategoryPercentages = () => {
    setCategoryPercentages({});
    toast.info("Alokasi persentase di-reset ke 0%.");
  };

  const handleCopyFromPreviousMonth = async () => {
    setIsCopyingMonthBudget(true);
    try {
      const res = await copyMonthlyBudget(budgetYear, budgetMonth);
      setMonthTotalBudget(res.total_budget || 0);
      setCategoryPercentages(res.category_percentages || {});
      setIsMonthCustom(true);
      toast.success(res.message || "Berhasil menyalin anggaran dari bulan sebelumnya!");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal menyalin anggaran");
    } finally {
      setIsCopyingMonthBudget(false);
    }
  };

  const handleSaveMonthBudgetOnly = async () => {
    setIsSavingMonthBudget(true);
    try {
      const cleanPcts: Record<string, number> = {};
      Object.entries(categoryPercentages).forEach(([k, v]) => {
        if (v > 0) cleanPcts[k] = v;
      });

      const res = await saveMonthlyBudget({
        year: budgetYear,
        month: budgetMonth,
        total_budget: monthTotalBudget,
        category_percentages: cleanPcts,
      });

      setIsMonthCustom(true);
      toast.success(res.message || `Anggaran ${MONTH_NAMES[budgetMonth - 1]} ${budgetYear} berhasil disimpan!`);
      onRefreshConfig();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan anggaran bulanan");
    } finally {
      setIsSavingMonthBudget(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="p-4 md:p-5 pb-3 bg-slate-50/60 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm md:text-base font-semibold text-slate-900 flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-600" />
              Target Anggaran Bulanan & Alokasi Kategori (%)
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Setup per bulan dengan persentase kategori & preview rupiah otomatis. Tiap bulan bisa disetup berbeda.
            </p>
          </div>

          {/* Month-Year Navigator */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Badge
              variant="outline"
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                isMonthCustom
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {isMonthCustom ? "Kustom Bulan Ini" : "Standar Global"}
            </Badge>

            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={handlePrevBudgetMonth}
                disabled={isMonthBudgetLoading}
                aria-label="Bulan sebelumnya"
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="px-2.5 text-center min-w-[110px]">
                <span className="text-xs font-bold text-slate-800 block leading-tight">
                  {MONTH_NAMES[budgetMonth - 1]} {budgetYear}
                </span>
              </div>
              <button
                type="button"
                onClick={handleNextBudgetMonth}
                disabled={isMonthBudgetLoading}
                aria-label="Bulan berikutnya"
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-5 space-y-5">
        {/* Step 1: Overall Budget (Rupiah) */}
        <div className="p-3.5 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                1
              </span>
              Plafon Anggaran Keseluruhan ({MONTH_NAMES[budgetMonth - 1]} {budgetYear})
            </label>
            <span className="text-xs font-bold text-emerald-800 tabular-nums">
              {formatRupiah(monthTotalBudget)}
            </span>
          </div>

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
              Rp
            </span>
            <Input
              type="number"
              step="any"
              min="0"
              value={monthTotalBudget || ""}
              onChange={(e) => {
                const val = Math.max(0, Number(e.target.value) || 0);
                setMonthTotalBudget(val);
              }}
              placeholder="Contoh: 25000000"
              className="pl-10 h-10 text-xs font-semibold rounded-xl bg-white border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500"
            />
          </div>

          {/* Quick Presets */}
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="text-[11px] font-medium text-emerald-800 mr-1">Tambah Cepat:</span>
            <button
              type="button"
              onClick={() => {
                setMonthTotalBudget((prev) => prev + 1_000_000);
              }}
              className="text-[10px] font-semibold bg-white text-emerald-800 px-2 py-0.5 rounded-lg border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
            >
              +1 Jt
            </button>
            <button
              type="button"
              onClick={() => {
                setMonthTotalBudget((prev) => prev + 5_000_000);
              }}
              className="text-[10px] font-semibold bg-white text-emerald-800 px-2 py-0.5 rounded-lg border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
            >
              +5 Jt
            </button>
            <button
              type="button"
              onClick={() => {
                setMonthTotalBudget((prev) => prev + 10_000_000);
              }}
              className="text-[10px] font-semibold bg-white text-emerald-800 px-2 py-0.5 rounded-lg border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
            >
              +10 Jt
            </button>
            <button
              type="button"
              onClick={() => {
                setMonthTotalBudget(0);
              }}
              className="text-[10px] font-semibold bg-white text-rose-700 px-2 py-0.5 rounded-lg border border-rose-200 hover:bg-rose-50 transition-colors ml-auto"
            >
              Reset 0
            </button>
          </div>
        </div>

        {/* Step 2: Category Allocation (%) */}
        <div className="space-y-3 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                  2
                </span>
                Distribusi Persentase per Kategori Belanja
              </label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Nilai rupiah tiap kategori dihitung otomatis dari (Plafon Bulan Ini × %).
              </p>
            </div>

            {/* Total Percentage Gauge */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500">Total Dialokasikan:</span>
              <Badge
                className={`text-xs font-bold tabular-nums px-2.5 py-0.5 ${
                  isOverAllocated
                    ? "bg-rose-600 text-white"
                    : isExactAllocated
                    ? "bg-emerald-600 text-white"
                    : "bg-blue-600 text-white"
                }`}
              >
                {totalAllocatedPercentage}% / 100%
              </Badge>
            </div>
          </div>

          {/* Allocation Warning or Sisa Banner */}
          {isOverAllocated ? (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong>Alokasi Melebihi 100%!</strong> Total alokasi Anda mencapai{" "}
                {totalAllocatedPercentage}% ({formatRupiah(totalAllocatedRupiah)}). Kurangi persentase
                kategori sebesar {Math.round((totalAllocatedPercentage - 100) * 10) / 10}% (kelebihan{" "}
                {formatRupiah(totalAllocatedRupiah - monthTotalBudget)}) agar pas 100%.
              </div>
            </div>
          ) : isExactAllocated ? (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Sempurna!</strong> Alokasi persentase pas 100% (
                {formatRupiah(totalAllocatedRupiah)}).
              </span>
            </div>
          ) : (
            <div className="p-2.5 bg-blue-50/70 border border-blue-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-blue-900">
              <div className="flex items-center gap-2">
                <Percent className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>
                  Sisa belum dialokasikan: <strong>{remainingPercentage}%</strong> (
                  {formatRupiah(remainingRupiah)})
                </span>
              </div>
              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={handleDistributeRemainingPercentages}
                  className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-2xs"
                >
                  Bagikan Sisa Rata
                </button>
              </div>
            </div>
          )}

          {/* Helper Buttons: Bagi Rata, Copy Bulan Lalu, Reset */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleEvenAllPercentages}
                className="text-[11px] h-7.5 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-100 gap-1"
              >
                <Percent className="w-3 h-3 text-blue-600" /> Bagi Rata Semua
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyFromPreviousMonth}
                disabled={isCopyingMonthBudget || isMonthBudgetLoading}
                className="text-[11px] h-7.5 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-100 gap-1"
              >
                <Copy className="w-3 h-3 text-indigo-600" /> Salin dari Bulan Lalu
              </Button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetCategoryPercentages}
              className="text-[11px] h-7.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 gap-1 ml-auto"
            >
              <RotateCcw className="w-3 h-3" /> Reset ke 0%
            </Button>
          </div>

          {/* Grid Kategori & Persentase */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
            {(config?.valid_categories || []).map((cat) => {
              const pctVal = categoryPercentages[cat] || 0;
              const rupiahVal =
                monthTotalBudget > 0 ? Math.round((monthTotalBudget * pctVal) / 100) : 0;

              return (
                <div
                  key={cat}
                  className={`p-3 rounded-xl border transition-all ${
                    pctVal > 0
                      ? "bg-white border-blue-200/90 shadow-2xs"
                      : "bg-slate-50/60 border-slate-200/60 opacity-80 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 truncate" title={cat}>
                      {cat}
                    </span>
                    <span className="text-[11px] font-bold text-blue-700 tabular-nums">
                      {formatRupiah(rupiahVal)}
                    </span>
                  </div>

                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={categoryPercentages[cat] ?? ""}
                      onChange={(e) => handlePercentageChange(cat, e.target.value)}
                      placeholder="0"
                      className="h-8 text-xs font-semibold pr-7 rounded-lg text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                      %
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Button: Simpan Anggaran Bulan Ini */}
        <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            Perubahan persentase & plafon bulan{" "}
            <strong>
              {MONTH_NAMES[budgetMonth - 1]} {budgetYear}
            </strong>{" "}
            akan langsung disimpan ke database anggaran bulanan.
          </p>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveMonthBudgetOnly}
            disabled={isSavingMonthBudget || isMonthBudgetLoading}
            className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold px-4 h-9 gap-1.5 shadow-2xs shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            {isSavingMonthBudget
              ? "Menyimpan..."
              : `Simpan Anggaran ${MONTH_NAMES[budgetMonth - 1]} ${budgetYear}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
