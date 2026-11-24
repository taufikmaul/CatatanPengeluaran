import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Percent,
  Copy,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Wallet,
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
  const [prevMonthEndingCash, setPrevMonthEndingCash] = useState<number | null>(null);
  const [prevMonthInfo, setPrevMonthInfo] = useState<{ month: number; year: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedYear(initialYear);
      setSelectedMonth(initialMonth);
    }
  }, [isOpen, initialYear, initialMonth]);

  const fetchBudget = async (year: number, month: number) => {
    setIsLoading(true);
    try {
      const data = await getMonthlyBudget(year, month);
      setTotalBudget(data.total_budget || 0);
      setPercentages(data.category_percentages || {});
      setCategories(data.valid_categories || []);
      setIsCustom(Boolean(data.is_custom));
      setPrevMonthEndingCash(
        data.previous_month_ending_balance !== undefined &&
          data.previous_month_ending_balance !== null
          ? data.previous_month_ending_balance
          : 0
      );
      if (data.previous_month && data.previous_month_year) {
        setPrevMonthInfo({
          month: data.previous_month,
          year: data.previous_month_year,
        });
      } else {
        const pm = month === 1 ? 12 : month - 1;
        const py = month === 1 ? year - 1 : year;
        setPrevMonthInfo({ month: pm, year: py });
      }
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

  const totalAllocatedPercentage = useMemo(() => {
    return Object.values(percentages).reduce(
      (sum, val) => sum + (Number(val) || 0),
      0
    );
  }, [percentages]);

  const totalAllocatedRupiah = useMemo(() => {
    return Math.round((totalBudget * totalAllocatedPercentage) / 100);
  }, [totalBudget, totalAllocatedPercentage]);

  const remainingPercentage =
    Math.round((100 - totalAllocatedPercentage) * 10) / 10;
  const remainingRupiah = Math.max(0, totalBudget - totalAllocatedRupiah);

  const isOverAllocated = totalAllocatedPercentage > 100;
  const isExactAllocated = Math.abs(totalAllocatedPercentage - 100) < 0.01;

  const handlePercentageChange = (cat: string, value: string) => {
    const num = Math.max(0, Math.min(100, parseFloat(value) || 0));
    setPercentages((prev) => ({
      ...prev,
      [cat]: num,
    }));
  };

  const handleDistributeRemaining = () => {
    if (remainingPercentage <= 0) {
      toast.info("Tidak ada sisa persentase untuk dibagikan.");
      return;
    }
    const emptyCats = categories.filter(
      (c) => !percentages[c] || percentages[c] === 0
    );
    const targetCats = emptyCats.length > 0 ? emptyCats : categories;
    if (targetCats.length === 0) return;

    const share =
      Math.round((remainingPercentage / targetCats.length) * 10) / 10;
    setPercentages((prev) => {
      const updated = { ...prev };
      targetCats.forEach((c) => {
        updated[c] = Math.round(((updated[c] || 0) + share) * 10) / 10;
      });
      return updated;
    });
    toast.success(
      `Sisa ${remainingPercentage}% dibagikan ke ${targetCats.length} kategori.`
    );
  };

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

  const handleResetPercentages = () => {
    setPercentages({});
    toast.info("Alokasi persentase di-reset ke 0%.");
  };

  const handleCopyPrevious = async (useCashBalance: boolean = false) => {
    setIsCopying(true);
    try {
      const res = await copyMonthlyBudget(
        selectedYear,
        selectedMonth,
        undefined,
        undefined,
        useCashBalance
      );
      setTotalBudget(res.total_budget || 0);
      setPercentages(res.category_percentages || {});
      setIsCustom(true);
      toast.success(
        res.message ||
          (useCashBalance
            ? "Berhasil menggunakan kas akhir bulan lalu."
            : "Berhasil menyalin anggaran dari bulan sebelumnya.")
      );
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal menyalin anggaran");
    } finally {
      setIsCopying(false);
    }
  };

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

      toast.success(res.message || "Anggaran bulanan berhasil disimpan.");
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
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0 rounded-xl border-border bg-background">
        {/* Header with Month Selector */}
        <div className="px-5 py-4 border-b border-border/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-7">
            <div>
              <DialogHeader className="text-left space-y-1">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold tracking-tight text-foreground">
                    Setup Anggaran Bulanan
                  </DialogTitle>
                  <Badge variant="outline" className="text-[10px] px-2 py-0">
                    {isCustom ? "Kustom Bulan Ini" : "Standar Global"}
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Tentukan plafon keseluruhan, lalu atur alokasi persentase per kategori dengan preview nominal Rupiah otomatis.
                </DialogDescription>
              </DialogHeader>
            </div>

            {/* Month-Year Navigator */}
            <div className="flex items-center border border-border rounded-md p-0.5 self-start sm:self-auto">
              <button
                type="button"
                onClick={handlePrevMonth}
                disabled={isLoading}
                aria-label="Bulan sebelumnya"
                className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-3 text-center min-w-[120px]">
                <span className="text-xs font-semibold text-foreground block leading-tight">
                  {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                </span>
              </div>
              <button
                type="button"
                onClick={handleNextMonth}
                disabled={isLoading}
                aria-label="Bulan berikutnya"
                className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Body (Zero Nested Card, Hairline Sections) */}
        <div className="p-5 space-y-5">
          {/* Step 1: Overall Budget (Rupiah) */}
          <div className="space-y-2.5 pb-4 border-b border-border/70">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">
                1. Anggaran Keseluruhan ({MONTH_NAMES[selectedMonth - 1]}{" "}
                {selectedYear})
              </label>
              <span className="text-xs font-bold text-foreground tabular-nums">
                {formatRupiah(totalBudget)}
              </span>
            </div>

            <InputGroup className="h-10">
              <InputGroupAddon align="inline-start" className="pl-3 pr-1">
                <InputGroupText className="text-xs font-semibold">Rp</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                step="any"
                min="0"
                value={totalBudget || ""}
                onChange={(e) =>
                  setTotalBudget(Math.max(0, Number(e.target.value) || 0))
                }
                placeholder="Contoh: 25000000"
                className="text-sm font-semibold tabular-nums pl-1.5"
              />
              {totalBudget > 0 && (
                <InputGroupAddon align="inline-end" className="pr-2">
                  <InputGroupButton
                    size="xs"
                    onClick={() => setTotalBudget(0)}
                    className="text-xs text-muted-foreground"
                  >
                    Reset 0
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            {/* Opsi Gunakan Akhir Kas Bulan Lalu */}
            {prevMonthEndingCash !== null && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-xs">
                <div className="text-muted-foreground">
                  Akhir Kas{" "}
                  {prevMonthInfo
                    ? `${MONTH_NAMES[prevMonthInfo.month - 1]} ${prevMonthInfo.year}`
                    : "Bulan Lalu"}
                  :{" "}
                  <strong className="text-foreground tabular-nums">
                    {formatRupiah(prevMonthEndingCash)}
                  </strong>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const amount = Math.max(0, prevMonthEndingCash);
                    setTotalBudget(amount);
                    toast.success(
                      `Kas awal bulanan diset ke akhir kas bulan lalu (${formatRupiah(
                        amount
                      )})`
                    );
                  }}
                  className="h-7 text-[11px] font-medium px-2.5 self-start sm:self-auto"
                >
                  Gunakan Kas Akhir
                </Button>
              </div>
            )}
          </div>

          {/* Allocation Health Strip */}
          <div className="space-y-2.5 pb-4 border-b border-border/70">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  Total Alokasi:{" "}
                  <span
                    className={
                      isOverAllocated
                        ? "text-rose-600 font-bold"
                        : isExactAllocated
                        ? "text-emerald-600 font-bold"
                        : "text-amber-600 font-bold"
                    }
                  >
                    {totalAllocatedPercentage}%
                  </span>
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatRupiah(totalAllocatedRupiah)}
                </span>
              </div>

              <div>
                {isOverAllocated ? (
                  <span className="text-rose-600 font-semibold flex items-center gap-1 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Kelebihan{" "}
                    {Math.round((totalAllocatedPercentage - 100) * 10) / 10}% (
                    {formatRupiah(totalAllocatedRupiah - totalBudget)})
                  </span>
                ) : isExactAllocated ? (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Alokasi Pas 100%
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[11px]">
                    Sisa belum dialokasi:{" "}
                    <strong className="text-foreground">
                      {remainingPercentage}% ({formatRupiah(remainingRupiah)})
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* Progress Visual Bar */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden flex">
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
                  className="h-7 text-[11px] px-2.5 font-medium"
                >
                  <Percent className="w-3 h-3 mr-1" />
                  Bagi Rata Sisa{" "}
                  {remainingPercentage > 0 ? `(${remainingPercentage}%)` : ""}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleEvenAll}
                  className="h-7 text-[11px] px-2.5 font-medium"
                >
                  Bagi Rata Semua
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetPercentages}
                  className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyPrevious(false)}
                  disabled={isCopying}
                  title="Salin plafon dan alokasi persentase kategori bulan lalu"
                  className="h-7 text-[11px] px-2.5 font-medium"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {isCopying ? "Menyalin..." : "Salin Bulan Lalu"}
                </Button>

                {prevMonthEndingCash !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyPrevious(true)}
                    disabled={isCopying}
                    title="Gunakan saldo akhir kas riil bulan lalu sebagai kas awal bulan ini"
                    className="h-7 text-[11px] px-2.5 font-medium"
                  >
                    <Wallet className="w-3 h-3 mr-1" />
                    Salin + Pakai Kas Akhir
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Step 2: Per Category Percentage Setup with Live Rupiah Preview (Flat Hairline Rows) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">
                2. Alokasi Anggaran Per Kategori (%) &amp; Preview Rupiah
              </label>
              <span className="text-[11px] text-muted-foreground">
                Isi persentase alokasi untuk tiap kategori
              </span>
            </div>

            <div className="divide-y divide-border/60 border-y border-border/60">
              {categories.map((cat) => {
                const pctVal = percentages[cat] || 0;
                const rupiahVal =
                  totalBudget > 0 ? Math.round((totalBudget * pctVal) / 100) : 0;
                const spent = currentSpending[cat] || 0;

                return (
                  <div
                    key={cat}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span
                        className="text-xs font-medium text-foreground block truncate"
                        title={cat}
                      >
                        {cat}
                      </span>
                      {spent > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          Aktual: {formatRupiah(spent)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-semibold text-foreground tabular-nums min-w-[90px] text-right">
                        {formatRupiah(rupiahVal)}
                      </span>
                      <InputGroup className="h-8 w-24">
                        <InputGroupInput
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={percentages[cat] ?? ""}
                          onChange={(e) =>
                            handlePercentageChange(cat, e.target.value)
                          }
                          placeholder="0"
                          className="text-xs font-semibold tabular-nums text-right pr-1"
                        />
                        <InputGroupAddon align="inline-end" className="pr-2">
                          <InputGroupText className="text-xs">%</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-border/80 bg-background flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-9 px-4 text-xs"
          >
            Batal
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="h-9 px-5 text-xs font-semibold"
          >
            {isSaving
              ? "Menyimpan..."
              : `Simpan Anggaran ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
