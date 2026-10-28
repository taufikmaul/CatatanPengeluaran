import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Expense, MonthlyReport, ExpenseUser, UnpaidExpenseItem } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Wallet,
  Receipt,
  AlertCircle,
  CheckCircle2,
  Clock,
  Target,
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  Plus,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Repeat,
  Edit2,
  Trash2,
  ExternalLink,
  User as UserIcon,
  Tag,
  Briefcase,
  LineChart,
  Store,
  Calendar,
  ArrowRight,
  Inbox,
  LayoutDashboard,
  ArrowLeftRight,
  Truck,
} from "lucide-react";

// Sub-components untuk tab Analisis & Grafik
import { AiAnalysisCard } from "@/components/dashboard/AiAnalysisCard";
import { CategoryDonutChart } from "@/components/dashboard/CategoryDonutChart";
import { PaymentMethodChart } from "@/components/dashboard/PaymentMethodChart";
import { DailyTrendChart } from "@/components/dashboard/DailyTrendChart";
import { UnpaidOrdersCard } from "@/components/dashboard/UnpaidOrdersCard";
import { LeaderboardCards } from "@/components/dashboard/LeaderboardCards";

export interface OwnerMobileViewProps {
  activeTab?: string;
  onNavigateTab?: (tab: any) => void;
  reportData?: MonthlyReport;
  expenses: Expense[];
  isExpensesLoading: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (newPage: number) => void;
  onToggleStatus: (expense: Expense) => void;
  onMarkPaidById?: (id: number) => void;
  onEditExpense: (expense: Expense) => void;
  onRepeatExpense?: (expense: Expense) => void;
  onInspectItemPrice?: (itemName: string, itemId?: number | null) => void;
  onDeleteExpense: (expenseId: number) => void;
  onViewExpense?: (expense: Expense) => void;
  canDelete?: boolean;

  // Filter states & handlers
  month: number;
  year: number;
  category: string;
  search: string;
  status: string;
  isReimbursement: boolean | null;
  users?: ExpenseUser[];
  selectedUserId?: number | null;
  categories: string[];

  onCategoryChange: (cat: string) => void;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: string) => void;
  onReimbursementChange: (val: boolean | null) => void;
  onUserChange?: (userId: number | null) => void;
  onResetFilters: () => void;
  onOpenAddExpense: () => void;
  onOpenBudgetSettings?: () => void;
  onOpenTukarCashOngkir?: (subType?: "all" | "tukar_cash" | "ongkir") => void;
  highlightedExpenseId?: number | null;
}

export function OwnerMobileView({
  activeTab = "overview",
  onNavigateTab,
  reportData,
  expenses,
  isExpensesLoading,
  page,
  totalPages,
  totalCount,
  onPageChange,
  onToggleStatus,
  onMarkPaidById,
  onEditExpense,
  onRepeatExpense,
  onInspectItemPrice,
  onDeleteExpense,
  onViewExpense,
  canDelete = true,
  highlightedExpenseId,
  month,
  year,
  category,
  search,
  status,
  isReimbursement,
  users = [],
  selectedUserId,
  categories,
  onCategoryChange,
  onSearchChange,
  onStatusChange,
  onReimbursementChange,
  onUserChange,
  onResetFilters,
  onOpenAddExpense,
  onOpenBudgetSettings,
  onOpenTukarCashOngkir,
}: OwnerMobileViewProps) {
  // Mobile Sub-Tab: "ringkasan" | "transaksi" | "analisis"
  const [mobileTab, setMobileTab] = useState<"ringkasan" | "transaksi" | "analisis">(() =>
    activeTab === "transactions" ? "transaksi" : "ringkasan"
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Sinkronkan tab mobile jika route/activeTab berubah dari luar
  React.useEffect(() => {
    if (activeTab === "transactions") {
      setMobileTab("transaksi");
    } else if (activeTab === "overview" && mobileTab === "transaksi") {
      setMobileTab("ringkasan");
    }
  }, [activeTab]);

  // Scroll & highlight transaksi terpilih jika ada redirect dari riwayat harga
  React.useEffect(() => {
    if (!highlightedExpenseId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`mobile-expense-row-${highlightedExpenseId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-blue-500", "bg-blue-50/80", "dark:bg-blue-950/60");
        const clearTimer = setTimeout(() => {
          el.classList.remove("ring-2", "ring-blue-500", "bg-blue-50/80", "dark:bg-blue-950/60");
        }, 4000);
        return () => clearTimeout(clearTimer);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightedExpenseId, expenses]);

  const totalUnpaidNominal = useMemo(() => {
    return reportData?.list_hutang?.reduce((sum, item) => sum + item.nominal, 0) || 0;
  }, [reportData]);

  const unpaidCount = reportData?.list_hutang?.length || 0;
  const reimburseCount = reportData?.reimburse_pending_count || 0;
  const reimburseTotal = reportData?.reimburse_pending_total || 0;

  // Anggaran
  const monthlyBudgetLimit = reportData?.monthly_budget_limit || 0;
  const totalPengeluaran = reportData?.total_pengeluaran || 0;
  const budgetUsedPct =
    reportData?.budget_used_pct ??
    (monthlyBudgetLimit > 0 ? Math.round((totalPengeluaran / monthlyBudgetLimit) * 100) : 0);
  const sisaBudget = monthlyBudgetLimit > 0 ? monthlyBudgetLimit - totalPengeluaran : 0;

  // MoM Change Helpers
  const renderMomBadge = (pct?: number | null) => {
    if (pct === undefined || pct === null) return null;
    const isUp = pct > 0;
    const isZero = pct === 0;
    const IconTrend = isUp ? TrendingUp : TrendingDown;
    const colorClasses = isZero
      ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
      : isUp
      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/80"
      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80";

    return (
      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${colorClasses}`}>
        {!isZero && <IconTrend className="w-2.5 h-2.5" />}
        {isUp ? `+${pct}%` : `${pct}%`} vs lalu
      </span>
    );
  };

  // Top 4 Kategori dengan nominal dan persentase
  const topCategories = useMemo(() => {
    const perCat = reportData?.per_kategori || {};
    const entries = Object.entries(perCat).filter(([, val]) => val > 0);
    entries.sort((a, b) => b[1] - a[1]);
    const totalAll = totalPengeluaran || 1;
    return entries.slice(0, 4).map(([name, amount]) => ({
      name,
      amount,
      pct: Math.min(100, Math.round((amount / totalAll) * 100)),
    }));
  }, [reportData, totalPengeluaran]);

  // Handler Hapus dengan konfirmasi
  const handleDelete = (id: number) => {
    if (confirm("Hapus catatan pengeluaran ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
    }
  };

  // Quick switch ke transaksi dengan filter khusus
  const handleJumpToUnpaid = () => {
    onStatusChange("Belum Lunas");
    onReimbursementChange(null);
    onNavigateTab?.("transactions");
    setMobileTab("transaksi");
  };

  const handleJumpToReimburse = () => {
    onNavigateTab?.("talangan");
  };

  return (
    <div className="space-y-4 pb-28">
      {/* 1. Mobile Segmented Tab Switcher */}
      <nav
        aria-label="Navigasi Tampilan Mobile Owner"
        className="sticky top-16 z-10 -mx-4 px-4 py-2 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800"
      >
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/80 dark:bg-slate-900 rounded-2xl">
          <button
            type="button"
            onClick={() => {
              onNavigateTab?.("overview");
              setMobileTab("ringkasan");
            }}
            className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              mobileTab === "ringkasan"
                ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span>Ringkasan</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigateTab?.("transactions");
              setMobileTab("transaksi");
            }}
            className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all relative ${
              mobileTab === "transaksi"
                ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Receipt className="w-4 h-4 shrink-0" />
            <span>Transaksi</span>
            {unpaidCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" title="Ada tagihan belum lunas" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigateTab?.("overview");
              setMobileTab("analisis");
            }}
            className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              mobileTab === "analisis"
                ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <LineChart className="w-4 h-4 shrink-0" />
            <span>Analisis</span>
          </button>
        </div>
      </nav>

      {/* Tab: Ringkasan Eksekutif */}
      {mobileTab === "ringkasan" && (
        <div className="space-y-4">
          {/* Action Alert: Hutang Supplier Belum Lunas */}
          {unpaidCount > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/90 dark:border-rose-900/60 shadow-xs space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-rose-900 dark:text-rose-200">
                      {unpaidCount} Tagihan Belum Lunas
                    </h2>
                    <p className="text-base font-extrabold text-rose-700 dark:text-rose-300 tabular-nums">
                      {formatRupiah(totalUnpaidNominal)}
                    </p>
                    <p className="text-[11px] text-rose-600/90 dark:text-rose-400 mt-0.5">
                      Perlu pelunasan ke supplier operasional.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleJumpToUnpaid}
                  className="min-h-[44px] px-3 rounded-xl border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 bg-white dark:bg-rose-900/40 hover:bg-rose-100 text-xs font-bold shrink-0"
                >
                  Lihat Semua
                </Button>
              </div>

              {/* Tampilkan 2 Tagihan Teratas dengan Tombol Lunas Instan */}
              {reportData?.list_hutang && reportData.list_hutang.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-rose-200/60 dark:border-rose-900/40">
                  {reportData.list_hutang.slice(0, 2).map((item) => (
                    <div
                      key={item.id ?? item.barang}
                      className="p-2.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-rose-100 dark:border-rose-950 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          {item.barang}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {item.supplier || "Supplier"} • {formatRupiah(item.nominal)}
                        </p>
                      </div>
                      {item.id && onMarkPaidById && (
                        <Button
                          size="sm"
                          onClick={() => onMarkPaidById(item.id!)}
                          className="min-h-[44px] px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shrink-0 gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Lunas</span>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Alert: Talangan / Reimburse Karyawan Pending */}
          {reimburseCount > 0 && (
            <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200/90 dark:border-purple-900/60 shadow-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/50 shrink-0">
                  <Briefcase className="w-5 h-5 text-purple-700 dark:text-purple-300" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-purple-900 dark:text-purple-200">
                    {reimburseCount} Pengajuan Talangan Karyawan
                  </h2>
                  <p className="text-sm font-extrabold text-purple-800 dark:text-purple-300 tabular-nums">
                    {formatRupiah(reimburseTotal)}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleJumpToReimburse}
                className="min-h-[44px] px-3.5 rounded-xl border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-200 bg-white dark:bg-purple-900/40 hover:bg-purple-100 text-xs font-bold shrink-0"
              >
                Tinjau
              </Button>
            </div>
          )}

          {/* 2 Kartu Angka Utama: Pengeluaran & Lunas */}
          <div className="grid grid-cols-2 gap-3">
            {/* Total Pengeluaran */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total Belanja</span>
                <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                  <Receipt className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatRupiah(totalPengeluaran)}
              </div>
              <div className="flex items-center justify-between gap-1 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-500 font-medium">
                  {reportData?.expense_count || 0} transaksi
                </span>
                {renderMomBadge(reportData?.mom_total_change_pct)}
              </div>
            </div>

            {/* Total Lunas */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Kas Terbayar</span>
                <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                  <Wallet className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {formatRupiah(reportData?.total_lunas || 0)}
              </div>
              <div className="flex items-center justify-between gap-1 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-500 font-medium">Lunas</span>
                {renderMomBadge(reportData?.mom_lunas_change_pct)}
              </div>
            </div>
          </div>

          {/* 2 Kartu Khusus: Tukar Cash & Ongkir Kurir */}
          <div className="grid grid-cols-2 gap-3">
            {/* Tukar Cash */}
            <div
              onClick={() => onOpenTukarCashOngkir?.("tukar_cash")}
              className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/90 dark:border-indigo-800 shadow-2xs space-y-1 cursor-pointer active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-300">Tukar Cash</span>
                <div className="p-1 rounded-lg bg-white dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                  <ArrowLeftRight className="w-3 h-3" />
                </div>
              </div>
              <div className="text-sm sm:text-base font-bold text-indigo-950 dark:text-indigo-200 tabular-nums">
                {formatRupiah(reportData?.total_tukar_cash || 0)}
              </div>
              <div className="text-[10px] text-indigo-700/80 dark:text-indigo-400 font-medium">
                {reportData?.tukar_cash_count || 0} transaksi &rarr;
              </div>
            </div>

            {/* Ongkir & Kurir */}
            <div
              onClick={() => onOpenTukarCashOngkir?.("ongkir")}
              className="p-3.5 rounded-2xl bg-sky-50/70 dark:bg-sky-950/40 border border-sky-200/90 dark:border-sky-800 shadow-2xs space-y-1 cursor-pointer active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-sky-900 dark:text-sky-300">Ongkir & Kurir</span>
                <div className="p-1 rounded-lg bg-white dark:bg-sky-900 text-sky-700 dark:text-sky-300">
                  <Truck className="w-3 h-3" />
                </div>
              </div>
              <div className="text-sm sm:text-base font-bold text-sky-950 dark:text-sky-200 tabular-nums">
                {formatRupiah(reportData?.total_ongkir || 0)}
              </div>
              <div className="text-[10px] text-sky-700/80 dark:text-sky-400 font-medium">
                {reportData?.ongkir_count || 0} trip &rarr;
              </div>
            </div>
          </div>

          {/* Progress Anggaran Bulanan (Jika Aktif) */}
          {monthlyBudgetLimit > 0 ? (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Batas Anggaran ({reportData?.month_name || "Bulan Ini"})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {onOpenBudgetSettings && (
                    <button
                      type="button"
                      onClick={onOpenBudgetSettings}
                      className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                    >
                      Atur
                    </button>
                  )}
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                      budgetUsedPct >= 95
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                        : budgetUsedPct >= 75
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    }`}
                  >
                    {budgetUsedPct}%
                  </span>
                </div>
              </div>

              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    budgetUsedPct >= 95 ? "bg-rose-500" : budgetUsedPct >= 75 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(budgetUsedPct, 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Terpakai {formatRupiah(totalPengeluaran)}</span>
                <span>Limit {formatRupiah(monthlyBudgetLimit)}</span>
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 pt-0.5">
                {sisaBudget >= 0 ? (
                  <span>
                    Sisa anggaran aman: <strong className="text-emerald-600 dark:text-emerald-400">{formatRupiah(sisaBudget)}</strong>
                  </span>
                ) : (
                  <span>
                    Melebihi budget sebesar: <strong className="text-rose-600 dark:text-rose-400">{formatRupiah(Math.abs(sisaBudget))}</strong>
                  </span>
                )}
              </div>
            </div>
          ) : (
            onOpenBudgetSettings && (
              <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    Belum ada anggaran ({reportData?.month_name || "Bulan Ini"})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenBudgetSettings}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  Setup Anggaran
                </button>
              </div>
            )
          )}

          {/* Ringkasan 4 Kategori Terbesar */}
          {topCategories.length > 0 && (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Pos Pengeluaran Terbesar
                </h3>
                <span className="text-[10px] text-slate-500 font-medium">Bulan Ini</span>
              </div>

              <div className="space-y-2.5">
                {topCategories.map((cat) => (
                  <div key={cat.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{cat.name}</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatRupiah(cat.amount)}{" "}
                        <span className="text-[10px] text-slate-500 font-normal">({cat.pct}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all"
                        style={{ width: `${cat.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Jump Buttons */}
          <div className="space-y-2 pt-1">
            <Button
              onClick={() => {
                onNavigateTab?.("transactions");
                setMobileTab("transaksi");
              }}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 text-white font-bold text-xs justify-between px-4 shadow-xs"
            >
              <span>Buka Daftar Transaksi ({reportData?.expense_count || 0} item)</span>
              <ArrowRight className="w-4 h-4" />
            </Button>

            <Button
              variant="outline"
              onClick={() => setMobileTab("analisis")}
              className="w-full min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold justify-between px-4"
            >
              <span className="flex items-center gap-1.5">
                <LineChart className="w-3.5 h-3.5 text-blue-600" />
                <span>Lihat Analisis & Rekomendasi Finansial</span>
              </span>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </Button>
          </div>
        </div>
      )}

      {/* Tab: Daftar Transaksi Mobile */}
      {mobileTab === "transaksi" && (
        <div className="space-y-4">
          {/* Leaderboard & Top Stats Section */}
          <LeaderboardCards
            topFrequentItems={reportData?.top_frequent_items || []}
            topExpensiveItems={reportData?.top_expensive_items || []}
            topUnitPriceItems={reportData?.top_unit_price_items || []}
            topPriceSpikes={reportData?.top_price_spikes || []}
            topSuppliers={reportData?.top_suppliers || []}
            summaryMetrics={reportData?.summary_metrics}
            monthName={reportData?.month_name || "Bulan Ini"}
            year={year}
          />

          {/* Search Bar Mobile */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              placeholder="Cari barang, toko, invoice..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 pr-8 min-h-[44px] rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[32px] flex items-center justify-center text-xs font-bold text-slate-500 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Filter Status Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => onStatusChange("")}
              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors border ${
                status === "" && isReimbursement === null
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"
              }`}
            >
              Semua ({totalCount})
            </button>

            <button
              type="button"
              onClick={() => {
                onStatusChange(status === "Belum Lunas" ? "" : "Belum Lunas");
                if (isReimbursement) onReimbursementChange(null);
              }}
              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors border flex items-center gap-1.5 ${
                status === "Belum Lunas"
                  ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                  : "bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border-slate-200 dark:border-slate-800"
              }`}
            >
              <span>Belum Lunas</span>
              {unpaidCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                  {unpaidCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                onStatusChange(status === "Lunas" ? "" : "Lunas");
                if (isReimbursement) onReimbursementChange(null);
              }}
              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors border ${
                status === "Lunas"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border-slate-200 dark:border-slate-800"
              }`}
            >
              Lunas
            </button>

            <button
              type="button"
              onClick={() => onReimbursementChange(isReimbursement ? null : true)}
              className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors border flex items-center gap-1.5 ${
                isReimbursement
                  ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                  : "bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 border-slate-200 dark:border-slate-800"
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 shrink-0" />
              <span>Talangan</span>
              {reimburseCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300">
                  {reimburseCount}
                </span>
              )}
            </button>

            {/* Toggle Filter Lanjutan */}
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="min-h-[44px] px-3 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1 shrink-0"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Kategori</span>
            </button>
          </div>

          {/* Filter Lanjutan Dropdown Kategori & Penginput */}
          {showAdvancedFilters && (
            <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Pilih Kategori</label>
                <select
                  value={category}
                  onChange={(e) => onCategoryChange(e.target.value)}
                  className="w-full min-h-[44px] mt-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium text-slate-800 dark:text-slate-200"
                >
                  <option value="">Semua Kategori</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {users.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Pilih Penginput</label>
                  <select
                    value={selectedUserId !== null && selectedUserId !== undefined ? String(selectedUserId) : ""}
                    onChange={(e) => onUserChange?.(e.target.value ? Number(e.target.value) : null)}
                    className="w-full min-h-[44px] mt-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-medium text-slate-800 dark:text-slate-200"
                  >
                    <option value="">Semua Penginput</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(category || search || status || isReimbursement || selectedUserId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onResetFilters}
                  className="w-full min-h-[44px] text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Reset Semua Filter
                </Button>
              )}
            </div>
          )}

          {/* Loading State */}
          {isExpensesLoading && (
            <div className="space-y-3 py-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse space-y-3"
                >
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-2/3" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-850 rounded w-1/2" />
                  <div className="h-8 bg-slate-100 dark:bg-slate-850 rounded" />
                </div>
              ))}
            </div>
          )}

          {/* Empty State */}
          {!isExpensesLoading && expenses.length === 0 && (
            <div className="p-8 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center mx-auto">
                <Inbox className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Tidak ada transaksi ditemukan
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Coba sesuaikan kata kunci pencarian atau ubah filter status pembayaran Anda.
              </p>
              {(category || search || status || isReimbursement) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onResetFilters}
                  className="mt-2 min-h-[44px] rounded-xl text-xs font-semibold"
                >
                  Reset Filter
                </Button>
              )}
            </div>
          )}

          {/* Daftar Kartu Transaksi */}
          {!isExpensesLoading && expenses.length > 0 && (
            <div className="space-y-3">
              {expenses.map((e) => {
                const catColor = getCategoryColor(e.category);
                const isLunas = (e.pay_status || "").toLowerCase().includes("lunas");
                const tgMeta = parseTelegramLink(e.msg_link);
                const isHighlighted = highlightedExpenseId === e.id;

                return (
                  <div
                    key={e.id}
                    id={`mobile-expense-row-${e.id}`}
                    className={cn(
                      "p-4 rounded-2xl border shadow-xs space-y-3 transition-all",
                      isHighlighted
                        ? "bg-blue-50/80 dark:bg-blue-950/60 ring-2 ring-blue-500 border-blue-300 dark:border-blue-700"
                        : "bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                    )}
                  >
                    {/* Header: Nama Barang & Badges */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onInspectItemPrice?.(e.item_name, e.master_item_id)}
                            className="font-bold text-sm text-slate-900 dark:text-slate-100 text-left hover:text-blue-600 dark:hover:text-blue-400"
                            title="Klik untuk riwayat harga item ini"
                          >
                            {e.item_name}
                          </button>
                          {isHighlighted && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 animate-pulse">
                              Terpilih
                            </span>
                          )}
                          {e.is_reimbursement && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              <Briefcase className="w-2.5 h-2.5" />
                              <span>Talangan</span>
                            </span>
                          )}
                        </div>

                        {/* Toko, Tanggal, dan Penginput */}
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <Store className="w-3 h-3 text-slate-500" />
                            <span>{e.supplier || "Tanpa Toko"}</span>
                          </span>
                          <span>•</span>
                          <span>{formatDateId(e.expense_date)}</span>
                          {e.invoice_number && e.invoice_number !== "-" && (
                            <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                              #{e.invoice_number}
                            </span>
                          )}
                          {e.user_name && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-900/60">
                              <UserIcon className="w-2.5 h-2.5" />
                              <span>{e.user_name}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Total Nominal */}
                      <div className="text-right shrink-0">
                        <div className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatRupiah(e.total_price)}
                        </div>
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          {e.qty} {e.unit || "Pcs"} × {formatRupiah(e.unit_price)}
                        </div>
                      </div>
                    </div>

                    {/* Kategori Badge & Catatan */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800/80">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${catColor.bg} ${catColor.border} dark:bg-slate-800 dark:border-slate-700`}
                      >
                        {e.category || "Operasional"}
                      </span>
                      {e.notes && e.notes !== "-" && (
                        <span className="text-[11px] text-slate-500 truncate max-w-[200px]" title={e.notes}>
                          {e.notes}
                        </span>
                      )}
                    </div>

                    {/* Baris Tombol Aksi Utama (Semua Memenuhi Standar Tap Target >= 44x44px) */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {/* Toggle Status Lunas / Hutang */}
                      <button
                        type="button"
                        onClick={() => onToggleStatus(e)}
                        className={`min-h-[44px] px-4 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all active:scale-95 ${
                          isLunas
                            ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                        }`}
                      >
                        {isLunas ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>Lunas</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 animate-pulse" />
                            <span>Hutang</span>
                          </>
                        )}
                      </button>

                      {/* Tombol Aksi Tambahan: Telegram, Detail, Beli Lagi, Edit, Delete */}
                      <div className="flex items-center gap-1.5">
                        {/* Telegram Link untuk Cross-check Struk */}
                        {tgMeta.isUrl && (
                          <a
                            href={tgMeta.url!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-[#229ED9] hover:bg-sky-100 flex items-center justify-center gap-1 active:scale-95"
                            title={`Buka pesan Telegram (${tgMeta.badgeLabel})`}
                          >
                            <TelegramIcon className="w-4 h-4 text-[#229ED9]" />
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        )}

                        {/* View Detail Modal */}
                        {onViewExpense && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => onViewExpense(e)}
                            className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600"
                            title="Lihat detail lengkap"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}

                        {/* Repeat Order / Beli Lagi */}
                        {onRepeatExpense && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => onRepeatExpense(e)}
                            className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-emerald-600"
                            title="Beli lagi hari ini"
                          >
                            <Repeat className="w-4 h-4" />
                          </Button>
                        )}

                        {/* Edit Expense */}
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => onEditExpense(e)}
                          className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600"
                          title="Edit transaksi"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>

                        {/* Delete Expense */}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleDelete(e.id)}
                            disabled={deletingId === e.id}
                            className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600 hover:border-rose-200 dark:hover:border-rose-900"
                            title="Hapus transaksi"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Mobile yang Ramah Jempol */}
          {totalPages > 1 && (
            <div className="pt-2 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
                className="flex-1 min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-xs font-bold gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Sebelumnya</span>
              </Button>

              <span className="text-xs font-semibold text-slate-500 tabular-nums whitespace-nowrap">
                {page} / {totalPages}
              </span>

              <Button
                variant="outline"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
                className="flex-1 min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-xs font-bold gap-1"
              >
                <span>Berikutnya</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Analisis & Grafik */}
      {mobileTab === "analisis" && (
        <div className="space-y-5">
          {/* AI Financial Analysis Card */}
          <AiAnalysisCard
            month={month}
            year={year}
            monthName={reportData?.month_name || "Bulan Ini"}
          />

          {/* Donut Chart Kategori */}
          <CategoryDonutChart
            categoryData={reportData?.per_kategori || {}}
            totalAmount={reportData?.total_lunas || 0}
          />

          {/* Chart Metode Pembayaran */}
          <PaymentMethodChart
            paymentData={reportData?.per_metode_bayar || {}}
            totalAmount={reportData?.total_pengeluaran || 0}
          />

          {/* Daily Trend Chart */}
          <DailyTrendChart data={reportData?.daily_chart || []} />

          {/* Unpaid Orders Card */}
          <UnpaidOrdersCard
            unpaidList={reportData?.list_hutang || []}
            onMarkPaid={onMarkPaidById}
            onViewAll={handleJumpToUnpaid}
          />
        </div>
      )}

      {/* Tombol Tambah Transaksi (FAB) */}
      <button
        type="button"
        onClick={onOpenAddExpense}
        aria-label="Catat Pengeluaran Baru"
        className="fixed bottom-6 right-5 z-30 min-h-[50px] px-5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-blue-600/30 active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        <span>Catat Baru</span>
      </button>
    </div>
  );
}
