import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getUnpaidSummary, settleUnpaidExpenses, getBankAccounts } from "@/lib/api";
import { Expense, UnpaidSummaryResponse, UnpaidSupplierSummary } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import {
  getDueUrgencyInfo,
  getExpensePaymentBreakdown,
  isDpStatus,
  isPaidStatus,
} from "@/lib/paymentStatus";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { DpPaymentModal } from "./DpPaymentModal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Store,
  Receipt,
  Search,
  Plus,
  Trash2,
  Edit2,
  Eye,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  AlertCircle,
  Building2,
  CalendarClock,
  ArrowUpDown,
  Wallet,
  History,
  Percent,
} from "lucide-react";

interface UnpaidTabProps {
  currentMonth: number;
  currentYear: number;
  onEditExpense: (expense: Expense) => void;
  onViewExpense?: (expense: Expense) => void;
  onDeleteExpense: (id: number) => void;
  onAddNewUnpaid?: () => void;
  onAddNewDp?: () => void;
  canDelete?: boolean;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export const UnpaidTab: React.FC<UnpaidTabProps> = ({
  currentMonth,
  currentYear,
  onEditExpense,
  onViewExpense,
  onDeleteExpense,
  onAddNewUnpaid,
  onAddNewDp,
  canDelete = false,
}) => {
  const queryClient = useQueryClient();

  // Filters
  const [statusTab, setStatusTab] = useState<"unpaid" | "dp" | "overdue" | "soon" | "paid" | "all">("unpaid");
  const [isAllPeriods, setIsAllPeriods] = useState<boolean>(true);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("due_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [page, setPage] = useState<number>(1);
  const perPage = 25;

  // Batch selection & modal states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [settleBankAccountId, setSettleBankAccountId] = useState<string>("");
  const [isSuppliersExpanded, setIsSuppliersExpanded] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // DP & Pelunasan Modal state
  const [paymentModalExpense, setPaymentModalExpense] = useState<Expense | null>(null);
  const [paymentModalMode, setPaymentModalMode] = useState<"full" | "percent" | "amount">("percent");

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", "active"],
    queryFn: () => getBankAccounts(true),
  });

  // 1. Fetch Ringkasan Belum Lunas, DP & Tempo Terdekat
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    refetch: refetchSummary,
  } = useQuery<UnpaidSummaryResponse>({
    queryKey: [
      "unpaid-summary",
      isAllPeriods ? null : selectedMonth,
      isAllPeriods ? null : selectedYear,
      selectedSupplierId,
    ],
    queryFn: () =>
      getUnpaidSummary({
        month: isAllPeriods ? null : selectedMonth,
        year: isAllPeriods ? null : selectedYear,
        supplierId: selectedSupplierId,
      }),
  });

  // 2. Fetch Daftar Transaksi Belum Lunas & DP Terpaginasi
  const {
    data: expensesData,
    isLoading: isExpensesLoading,
    isError: isExpensesError,
    refetch: refetchExpenses,
  } = useQuery({
    queryKey: [
      "expenses-unpaid",
      page,
      perPage,
      isAllPeriods ? null : selectedMonth,
      isAllPeriods ? null : selectedYear,
      statusTab,
      selectedSupplierId,
      search,
      sortBy,
      sortOrder,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        special_type: "unpaid",
        sort_by: sortBy,
        sort_order: sortOrder,
      });

      if (!isAllPeriods) {
        params.append("month", String(selectedMonth));
        params.append("year", String(selectedYear));
      }

      if (statusTab === "unpaid" || statusTab === "overdue" || statusTab === "soon") {
        params.append("status", "Belum Lunas");
      } else if (statusTab === "dp") {
        params.append("status", "DP / Sebagian");
      } else if (statusTab === "paid") {
        params.append("status", "Lunas");
      }

      if (selectedSupplierId !== null) {
        params.append("supplier_id", String(selectedSupplierId));
      }

      if (search.trim()) {
        params.append("search", search.trim());
      }

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
  });

  const rawExpenses: Expense[] = expensesData?.data || [];
  const totalItems: number = expensesData?.total || 0;
  const totalPages: number = expensesData?.total_pages || 1;

  // Filter client-side untuk tab overdue / soon agar presisi dengan tanggal lokal
  const expenses = useMemo(() => {
    if (statusTab === "overdue") {
      return rawExpenses.filter((e) => getDueUrgencyInfo(e.due_date).urgency === "overdue");
    }
    if (statusTab === "soon") {
      return rawExpenses.filter((e) => {
        const u = getDueUrgencyInfo(e.due_date).urgency;
        return u === "soon" || u === "today";
      });
    }
    return rawExpenses;
  }, [rawExpenses, statusTab]);

  // 3. Settle Mutation (Lunasi Sisa / Batalkan Lunas)
  const settleMutation = useMutation({
    mutationFn: settleUnpaidExpenses,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });

      if (data.action === "mark_paid") {
        toast.success(`Berhasil melunasi ${data.updated_count} transaksi.`);
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
        });
      } else {
        toast.info(`Status pelunasan ${data.updated_count} transaksi dikembalikan.`);
      }
      setSelectedIds([]);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memproses pelunasan transaksi.");
    },
  });

  const handleTogglePaid = (expense: Expense) => {
    const isCurrentlyPaid = isPaidStatus(expense.pay_status);
    const action = isCurrentlyPaid ? "mark_unpaid" : "mark_paid";
    settleMutation.mutate({
      expense_ids: [expense.id],
      action,
      bank_account_id:
        action === "mark_paid" && settleBankAccountId ? Number(settleBankAccountId) : undefined,
    });
  };

  const handleSettleSupplierAll = (supplierGroup: UnpaidSupplierSummary) => {
    if (supplierGroup.unpaid_count === 0) return;
    const confirmMsg = `Lunasi sisa ${supplierGroup.unpaid_count} tagihan ke ${supplierGroup.supplier_name} senilai ${formatRupiah(supplierGroup.unpaid_total)}?`;
    if (!window.confirm(confirmMsg)) return;

    api
      .get(
        `/expenses?status=Belum Lunas&special_type=unpaid&supplier_id=${
          supplierGroup.supplier_id ?? ""
        }&supplier=${encodeURIComponent(supplierGroup.supplier_name)}&per_page=100`
      )
      .then((res) => {
        const ids = (res.data?.data || []).map((e: Expense) => e.id);
        if (ids.length === 0) {
          toast.error("Tidak ada transaksi belum lunas yang dapat diproses.");
          return;
        }
        settleMutation.mutate({
          expense_ids: ids,
          action: "mark_paid",
          bank_account_id: settleBankAccountId ? Number(settleBankAccountId) : undefined,
        });
      })
      .catch(() => {
        toast.error("Gagal mengambil data tagihan supplier.");
      });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(expenses.map((e) => e.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchSettle = (action: "mark_paid" | "mark_unpaid") => {
    if (selectedIds.length === 0) return;
    settleMutation.mutate({
      expense_ids: selectedIds,
      action,
      bank_account_id:
        action === "mark_paid" && settleBankAccountId ? Number(settleBankAccountId) : undefined,
    });
  };

  const selectedNominal = useMemo(() => {
    return expenses
      .filter((e) => selectedIds.includes(e.id))
      .reduce((sum, e) => {
        const bd = getExpensePaymentBreakdown(e);
        return sum + (bd.isPaid ? bd.total : bd.remaining);
      }, 0);
  }, [expenses, selectedIds]);

  const handleDelete = (id: number) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus catatan tagihan ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
      setTimeout(() => setDeletingId(null), 1000);
    }
  };

  const openPaymentModal = (expense: Expense, mode: "full" | "percent" | "amount") => {
    setPaymentModalMode(mode);
    setPaymentModalExpense(expense);
  };

  const getInitials = (name: string) => {
    return (name || "HC")
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  const nearestDue = summaryData?.nearest_due;
  const activeUnpaidCount = summaryData?.total_unpaid_count ?? summaryData?.unpaid_count ?? 0;
  const activeUnpaidTotal = summaryData?.total_unpaid_nominal ?? summaryData?.unpaid_total ?? 0;
  const activeOverdueTotal = summaryData?.overdue_nominal ?? summaryData?.overdue_total ?? 0;
  const dpCount = summaryData?.dp_count ?? 0;
  const dpPaidNominal = summaryData?.dp_paid_nominal ?? 0;
  const dpRemainingNominal = summaryData?.dp_remaining_nominal ?? 0;
  const activeSuppliersCount =
    summaryData?.by_supplier?.filter((s) => s.unpaid_count > 0).length || 0;

  return (
    <div className="space-y-5">
      {/* 1. Compact Action Bar */}
      {(onAddNewDp || onAddNewUnpaid) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Monitoring Tagihan:
            </span>
            {activeUnpaidCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-rose-800 border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
              >
                {activeUnpaidCount} Tagihan Aktif
              </Badge>
            )}
            {dpCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-amber-800 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
              >
                {dpCount} Berstatus DP
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onAddNewDp && (
              <Button
                onClick={onAddNewDp}
                size="sm"
                className="bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-semibold h-9 px-3.5 gap-1.5 shadow-xs"
              >
                <Percent className="w-3.5 h-3.5" />
                <span>+ Invoice DP</span>
              </Button>
            )}
            {onAddNewUnpaid && (
              <Button
                onClick={onAddNewUnpaid}
                size="sm"
                className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold h-9 px-3.5 gap-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Tagihan Baru</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Summary Error Banner */}
      {isSummaryError && (
        <div
          role="alert"
          className="p-4 rounded-2xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Gagal memuat ringkasan tagihan belum lunas dan DP.</span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => refetchSummary()}>
            Muat Ulang Ringkasan
          </Button>
        </div>
      )}

      {/* 2. KPI Cards: 4 Ringkasan Utama */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total Sisa Tagihan */}
        <Card
          onClick={() => {
            setStatusTab("unpaid");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusTab === "unpaid"
              ? "ring-2 ring-rose-500 border-rose-300 bg-rose-50/40 dark:bg-rose-950/20"
              : "hover:border-rose-300 dark:hover:border-rose-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Total Sisa Tagihan
              </span>
              <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 flex items-center justify-center">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">
                  {formatRupiah(activeUnpaidTotal)}
                </div>
              )}
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {activeUnpaidCount}
                </span>{" "}
                tagihan aktif di {activeSuppliersCount} toko
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Tagihan DP Berjalan */}
        <Card
          onClick={() => {
            setStatusTab("dp");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusTab === "dp"
              ? "ring-2 ring-amber-500 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"
              : "hover:border-amber-300 dark:hover:border-amber-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Tagihan DP Berjalan
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                  {formatRupiah(dpRemainingNominal)}
                </div>
              )}
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                <span className="font-bold text-slate-900 dark:text-slate-100">{dpCount}</span>{" "}
                invoice DP (sudah dibayar {formatRupiah(dpPaidNominal)})
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Tempo Paling Dekat */}
        <Card className="border border-amber-200/90 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 rounded-2xl shadow-xs">
          <CardContent className="p-4 sm:p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                Tempo Paling Dekat
              </span>
              {nearestDue && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 font-bold ${
                    nearestDue.is_overdue || nearestDue.urgency === "overdue"
                      ? "bg-rose-100 text-rose-800 border-rose-300"
                      : nearestDue.is_today || nearestDue.urgency === "today"
                      ? "bg-amber-700 text-white border-amber-800"
                      : "bg-amber-100 text-amber-900 border-amber-300"
                  }`}
                >
                  {nearestDue.is_overdue || nearestDue.urgency === "overdue"
                    ? `Lewat ${Math.abs(nearestDue.days_left ?? 0)} Hari`
                    : nearestDue.is_today || nearestDue.urgency === "today"
                    ? "Hari Ini"
                    : `${nearestDue.days_left ?? 0} Hari Lagi`}
                </Badge>
              )}
            </div>

            <div className="mt-2 min-w-0">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : nearestDue ? (
                <div>
                  <div className="text-base sm:text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatDateId(nearestDue.parsed_due_date || nearestDue.due_date)}
                  </div>
                  <div className="text-[11px] text-slate-700 dark:text-slate-200 font-medium truncate mt-0.5">
                    <span className="font-bold text-amber-800 dark:text-amber-300">
                      {nearestDue.supplier}
                    </span>{" "}
                    ({formatRupiah(nearestDue.remaining_amount ?? nearestDue.total_price)})
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                    {nearestDue.item_name}
                    {isDpStatus(nearestDue.pay_status) ? " (DP)" : ""}
                  </div>
                </div>
              ) : (
                <div className="py-1">
                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Semua Aman
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                    Tidak ada tempo pelunasan aktif
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Lewat Jatuh Tempo */}
        <Card
          onClick={() => {
            setStatusTab("overdue");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusTab === "overdue"
              ? "ring-2 ring-red-500 border-red-300 bg-red-50/40 dark:bg-red-950/20"
              : "hover:border-red-300 dark:hover:border-red-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Lewat Jatuh Tempo
              </span>
              <div className="w-8 h-8 rounded-xl bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums">
                  {formatRupiah(activeOverdueTotal)}
                </div>
              )}
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                <span className="font-bold text-red-700 dark:text-red-400">
                  {summaryData?.overdue_count || 0}
                </span>{" "}
                tagihan melewati tempo
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Rekap Saldo Tagihan per Toko / Supplier */}
      {summaryData && summaryData.by_supplier && summaryData.by_supplier.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Store className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Rekap Sisa Tagihan per Toko / Supplier
              </h3>
              <Badge variant="outline" className="text-[10px] text-slate-700 dark:text-slate-300 border-slate-300">
                {summaryData.by_supplier.length} Toko
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSuppliersExpanded((prev) => !prev)}
              className="min-h-[38px] text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 gap-1 px-2.5"
            >
              <span>{isSuppliersExpanded ? "Tutup Rekap" : "Buka Rekap"}</span>
              {isSuppliersExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>

          {isSuppliersExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
              {summaryData.by_supplier.map((supplierGroup) => {
                const isSelected =
                  supplierGroup.supplier_id !== null &&
                  selectedSupplierId === supplierGroup.supplier_id;
                const hasUnpaid = supplierGroup.unpaid_count > 0;
                const supDpCount = supplierGroup.dp_count ?? 0;

                return (
                  <div
                    key={supplierGroup.supplier_id ?? supplierGroup.supplier_name}
                    className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                      isSelected
                        ? "border-rose-400 bg-rose-50/50 dark:bg-rose-950/30 ring-1 ring-rose-400"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white text-xs font-bold text-rose-700">
                          <AvatarFallback>{getInitials(supplierGroup.supplier_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                              {supplierGroup.supplier_name}
                            </span>
                            {supplierGroup.has_overdue && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 font-bold border-red-300 text-red-800 bg-red-50"
                              >
                                Lewat Tempo
                              </Badge>
                            )}
                          </div>
                          {supplierGroup.nearest_due_date ? (
                            <div className="text-[11px] text-amber-800 dark:text-amber-300 font-medium truncate">
                              Tempo: {formatDateId(supplierGroup.nearest_due_date)}
                              {supplierGroup.nearest_days_left !== null && (
                                <span className="ml-1 text-slate-600 dark:text-slate-300">
                                  (
                                  {supplierGroup.nearest_days_left < 0
                                    ? `Lewat ${Math.abs(supplierGroup.nearest_days_left)}h`
                                    : supplierGroup.nearest_days_left === 0
                                    ? "Hari Ini"
                                    : `${supplierGroup.nearest_days_left}h lagi`}
                                  )
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                              Belum ada tanggal tempo
                            </div>
                          )}
                        </div>
                      </div>

                      {supplierGroup.supplier_id !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSupplierId(isSelected ? null : supplierGroup.supplier_id);
                            setPage(1);
                          }}
                          className={`min-h-[34px] text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors shrink-0 ${
                            isSelected
                              ? "bg-rose-700 text-white border-rose-700"
                              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
                          }`}
                          title="Filter data khusus toko ini"
                        >
                          {isSelected ? "Filter Aktif" : "Filter"}
                        </button>
                      )}
                    </div>

                    <div className="bg-white dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800 rounded-lg p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300 text-[11px]">
                          Sisa Kewajiban:
                        </span>
                        <span
                          className={`font-bold tabular-nums ${
                            hasUnpaid
                              ? "text-rose-700 dark:text-rose-400"
                              : "text-slate-500"
                          }`}
                        >
                          {formatRupiah(supplierGroup.unpaid_total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                        <span>Tagihan Aktif:</span>
                        <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                          {supplierGroup.unpaid_count} nota
                          {supDpCount > 0 ? ` (${supDpCount} DP)` : ""}
                        </span>
                      </div>
                    </div>

                    {hasUnpaid && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSettleSupplierAll(supplierGroup)}
                        disabled={settleMutation.isPending}
                        className="w-full min-h-[40px] sm:min-h-[34px] text-[11px] font-semibold rounded-lg border-rose-300 text-rose-800 bg-rose-50/70 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-200 dark:bg-rose-950/40 gap-1.5"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-rose-700 dark:text-rose-300" />
                        <span>Lunasi Sisa ({formatRupiah(supplierGroup.unpaid_total)})</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. Filter & Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tab Pills */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/90 dark:bg-slate-800/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setStatusTab("unpaid");
                setPage(1);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "unpaid"
                  ? "bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 shadow-2xs"
                  : "text-slate-700 dark:text-slate-300 hover:text-slate-950"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Belum Lunas & DP</span>
              {activeUnpaidCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 font-bold">
                  {activeUnpaidCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("dp");
                setPage(1);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "dp"
                  ? "bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 shadow-2xs"
                  : "text-slate-700 dark:text-slate-300 hover:text-slate-950"
              }`}
            >
              <Wallet className="w-3.5 h-3.5 text-amber-600" />
              <span>DP / Sebagian</span>
              {dpCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 font-bold">
                  {dpCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("overdue");
                setPage(1);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "overdue"
                  ? "bg-white dark:bg-slate-900 text-red-700 dark:text-red-300 shadow-2xs"
                  : "text-slate-700 dark:text-slate-300 hover:text-slate-950"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
              <span>Lewat Tempo</span>
              {summaryData && summaryData.overdue_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 font-bold">
                  {summaryData.overdue_count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("soon");
                setPage(1);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "soon"
                  ? "bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 shadow-2xs"
                  : "text-slate-700 dark:text-slate-300 hover:text-slate-950"
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
              <span>≤ 7 Hari</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("paid");
                setPage(1);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "paid"
                  ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                  : "text-slate-700 dark:text-slate-300 hover:text-slate-950"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Sudah Lunas</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("all");
                setPage(1);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "all"
                  ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-2xs"
                  : "text-slate-700 dark:text-slate-300 hover:text-slate-950"
              }`}
            >
              <span>Semua</span>
            </button>
          </div>

          {/* Periode Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isAllPeriods ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setIsAllPeriods((prev) => !prev);
                setPage(1);
              }}
              className="min-h-[40px] rounded-xl text-xs font-medium px-3 gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{isAllPeriods ? "Semua Waktu (Aktif)" : "Bulan Tertentu"}</span>
            </Button>

            {!isAllPeriods && (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(Number(e.target.value));
                    setPage(1);
                  }}
                  aria-label="Pilih bulan"
                  className="h-10 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(Number(e.target.value));
                    setPage(1);
                  }}
                  aria-label="Pilih tahun"
                  className="h-10 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                >
                  {[selectedYear - 1, selectedYear, selectedYear + 1].map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Search, Supplier Filter & Sort */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari barang, supplier/toko, nota, atau catatan..."
              className="pl-9 h-10 text-xs rounded-xl bg-slate-50/70 dark:bg-slate-800/60 border-slate-300 dark:border-slate-700"
            />
          </div>

          <div className="sm:w-56 shrink-0">
            <select
              value={selectedSupplierId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedSupplierId(val ? Number(val) : null);
                setPage(1);
              }}
              aria-label="Filter toko atau supplier"
              className="w-full h-10 px-3 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
            >
              <option value="">Semua Toko / Supplier</option>
              {summaryData?.by_supplier?.map((s) => (
                <option key={s.supplier_id ?? s.supplier_name} value={s.supplier_id ?? ""}>
                  {s.supplier_name} {s.unpaid_count > 0 ? `(${s.unpaid_count} aktif)` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:w-52 shrink-0 flex items-center gap-1.5">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              aria-label="Urutkan daftar"
              className="w-full h-10 px-3 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium"
            >
              <option value="due_date">Urutkan: Jatuh Tempo</option>
              <option value="expense_date">Urutkan: Tanggal Transaksi</option>
              <option value="total_price">Urutkan: Nominal</option>
              <option value="supplier">Urutkan: Nama Toko</option>
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              className="h-10 w-10 p-0 rounded-xl border-slate-300 dark:border-slate-700 shrink-0"
              title={`Urutan: ${sortOrder === "asc" ? "Menaik" : "Menurun"}`}
              aria-label="Ubah arah urutan"
            >
              <ArrowUpDown className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </Button>
          </div>
        </div>
      </div>

      {/* 5. Batch Action Toolbar */}
      {selectedIds.length > 0 && (
        <div className="bg-rose-700 text-white rounded-2xl p-4 shadow-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <CheckCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-sm">{selectedIds.length} Tagihan Terpilih</div>
              <div className="text-xs text-rose-100 tabular-nums">
                Total Sisa Pelunasan: <span className="font-bold">{formatRupiah(selectedNominal)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bankAccounts.length > 0 && (
              <select
                value={settleBankAccountId}
                onChange={(e) => setSettleBankAccountId(e.target.value)}
                className="h-10 rounded-xl bg-white text-slate-900 px-2.5 text-xs font-medium"
                aria-label="Rekening Pembayar"
              >
                <option value="">Rekening Pembayar (Opsional)</option>
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={String(acc.id)}>
                    {acc.name} ({acc.account_code})
                  </option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              onClick={() => handleBatchSettle("mark_paid")}
              disabled={settleMutation.isPending}
              className="bg-white text-rose-800 hover:bg-rose-50 rounded-xl font-bold text-xs min-h-[40px] px-3.5 gap-1.5 shadow-xs"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span>Lunasi Sisa ({selectedIds.length})</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
              className="text-white hover:bg-white/15 rounded-xl text-xs min-h-[40px] px-3"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* 6. Data View (Loading / Error / Empty / Mobile Cards + Desktop Table) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {isExpensesLoading ? (
          <div className="p-6 space-y-3" aria-label="Memuat daftar tagihan">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Memuat daftar tagihan belum lunas dan DP...
            </div>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : isExpensesError ? (
          <div role="alert" className="p-10 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
            <div>
              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Gagal Memuat Daftar Tagihan
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                Terjadi gangguan saat mengambil data tagihan dari server.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchExpenses()}>
              Coba Lagi
            </Button>
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 mx-auto flex items-center justify-center">
              <Receipt className="w-7 h-7" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Tidak ada data tagihan
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-sm mx-auto">
                {search.trim()
                  ? `Tidak ada transaksi yang cocok dengan kata kunci "${search}".`
                  : statusTab === "dp"
                  ? "Belum ada invoice dengan skema DP / cicilan sebagian."
                  : statusTab === "unpaid"
                  ? "Semua tagihan operasional dan tempo toko telah lunas."
                  : statusTab === "overdue"
                  ? "Tidak ada tagihan yang melewati batas jatuh tempo."
                  : "Belum ada catatan tagihan pada filter periode ini."}
              </p>
            </div>
            {(onAddNewDp || onAddNewUnpaid) && !search.trim() && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {onAddNewDp && (
                  <Button
                    size="sm"
                    onClick={onAddNewDp}
                    className="bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs min-h-[40px]"
                  >
                    <Percent className="w-3.5 h-3.5 mr-1.5" />
                    Catat Invoice DP
                  </Button>
                )}
                {onAddNewUnpaid && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAddNewUnpaid}
                    className="rounded-xl text-xs min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Catat Tagihan Baru
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Card Layout (< md) */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {expenses.map((expense) => {
                const isSelected = selectedIds.includes(expense.id);
                const bd = getExpensePaymentBreakdown(expense);
                const dueInfo = getDueUrgencyInfo(expense.due_date);
                const catColor = getCategoryColor(expense.category);
                const tgLink = parseTelegramLink(expense.msg_link);

                return (
                  <div
                    key={expense.id}
                    className={`p-4 space-y-3 ${
                      isSelected
                        ? "bg-rose-50/50 dark:bg-rose-950/20"
                        : dueInfo.urgency === "overdue" && !bd.isPaid
                        ? "bg-red-50/30 dark:bg-red-950/10"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleSelect(expense.id)}
                          aria-label={`Pilih transaksi #${expense.id}`}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                            {expense.item_name}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium">{expense.supplier || "Tanpa Supplier"}</span>
                            <span>{formatDateId(expense.expense_date)}</span>
                          </div>
                        </div>
                      </div>

                      {bd.isPaid ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-2 py-0.5 font-bold border-emerald-300 text-emerald-800 bg-emerald-50 shrink-0"
                        >
                          Lunas
                        </Badge>
                      ) : bd.isDp ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-2 py-0.5 font-bold border-amber-300 text-amber-900 bg-amber-50 shrink-0"
                        >
                          DP {Math.round(bd.progressPct)}%
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-2 py-0.5 font-bold border-rose-300 text-rose-800 bg-rose-50 shrink-0"
                        >
                          Belum Lunas
                        </Badge>
                      )}
                    </div>

                    {/* Nominal & DP Progress */}
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          {bd.isPaid ? "Total Invoice" : "Sisa Pelunasan"}
                        </span>
                        <span
                          className={`text-base font-extrabold tabular-nums ${
                            bd.isPaid
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-700 dark:text-rose-400"
                          }`}
                        >
                          {formatRupiah(bd.isPaid ? bd.total : bd.remaining)}
                        </span>
                      </div>

                      {(bd.isDp || bd.paid > 0) && !bd.isPaid && (
                        <>
                          <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${Math.min(100, bd.progressPct)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-700 dark:text-slate-200 tabular-nums">
                            <span>Sudah DP: {formatRupiah(bd.paid)}</span>
                            <span>Total: {formatRupiah(bd.total)}</span>
                          </div>
                        </>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-700/70 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                          >
                            {expense.category || "Umum"}
                          </Badge>
                          <span className="text-slate-600 dark:text-slate-300">
                            {expense.qty} {expense.unit || "pcs"}
                          </span>
                        </div>
                        {!bd.isPaid && (
                          <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${dueInfo.badgeClass}`}>
                            {expense.due_date && expense.due_date !== "-"
                              ? `${formatDateId(expense.due_date)} (${dueInfo.label})`
                              : dueInfo.label}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Mobile Actions (>= 44px tap targets) */}
                    <div className="flex flex-wrap items-center gap-2">
                      {!bd.isPaid ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              openPaymentModal(expense, bd.isDp ? "full" : "percent")
                            }
                            className="flex-1 min-h-[44px] text-xs font-bold rounded-xl bg-amber-700 hover:bg-amber-800 text-white"
                          >
                            <Wallet className="w-3.5 h-3.5 mr-1.5" />
                            <span>{bd.isDp ? "Bayar / Lunasi" : "Bayar DP"}</span>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleTogglePaid(expense)}
                            disabled={settleMutation.isPending}
                            className="min-h-[44px] px-3.5 text-xs font-bold rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            <span>Lunasi</span>
                          </Button>
                        </>
                      ) : (
                        <>
                          {(expense.payments_count || 0) > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPaymentModal(expense, "full")}
                              className="flex-1 min-h-[44px] text-xs font-semibold rounded-xl"
                            >
                              <History className="w-3.5 h-3.5 mr-1.5" />
                              <span>Riwayat ({expense.payments_count})</span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTogglePaid(expense)}
                            disabled={settleMutation.isPending}
                            className="min-h-[44px] px-3.5 text-xs font-semibold rounded-xl"
                          >
                            Batal Lunas
                          </Button>
                        </>
                      )}

                      <div className="flex items-center gap-1 ml-auto">
                        {tgLink?.isUrl && tgLink.url && (
                          <a
                            href={tgLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border border-blue-200 bg-blue-50 text-blue-700"
                            title="Buka pesan nota di Telegram"
                          >
                            <TelegramIcon className="w-4 h-4" />
                          </a>
                        )}
                        {onViewExpense && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onViewExpense(expense)}
                            className="min-h-[44px] min-w-[44px] p-0 rounded-xl"
                            aria-label="Lihat detail"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onEditExpense(expense)}
                          className="min-h-[44px] min-w-[44px] p-0 rounded-xl"
                          aria-label="Edit transaksi"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(expense.id)}
                            disabled={deletingId === expense.id}
                            className="min-h-[44px] min-w-[44px] p-0 rounded-xl text-rose-700 border-rose-200"
                            aria-label="Hapus transaksi"
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

            {/* Desktop Table View (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 dark:bg-slate-800/70 border-b border-slate-200/90 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-3.5 w-10">
                      <Checkbox
                        checked={
                          expenses.length > 0 &&
                          expenses.every((e) => selectedIds.includes(e.id))
                        }
                        onCheckedChange={handleSelectAll}
                        aria-label="Pilih semua baris"
                      />
                    </th>
                    <th className="py-3 px-3 font-semibold">Tanggal</th>
                    <th className="py-3 px-3 font-semibold">Tempo Pelunasan</th>
                    <th className="py-3 px-3 font-semibold">Toko / Supplier</th>
                    <th className="py-3 px-3 font-semibold">Barang & Kategori</th>
                    <th className="py-3 px-3 font-semibold text-right">Tagihan & DP</th>
                    <th className="py-3 px-3 font-semibold text-center">Status</th>
                    <th className="py-3 px-3 font-semibold text-center">Nota</th>
                    <th className="py-3 px-3 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {expenses.map((expense) => {
                    const isSelected = selectedIds.includes(expense.id);
                    const bd = getExpensePaymentBreakdown(expense);
                    const dueInfo = getDueUrgencyInfo(expense.due_date);
                    const catColor = getCategoryColor(expense.category);
                    const tgLink = parseTelegramLink(expense.msg_link);

                    return (
                      <tr
                        key={expense.id}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                          isSelected
                            ? "bg-rose-50/40 dark:bg-rose-950/20"
                            : dueInfo.urgency === "overdue" && !bd.isPaid
                            ? "bg-red-50/20 dark:bg-red-950/10"
                            : ""
                        }`}
                      >
                        <td className="py-3 px-3.5">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleSelect(expense.id)}
                            aria-label={`Pilih transaksi #${expense.id}`}
                          />
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatDateId(expense.expense_date)}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            ID: #{expense.id}
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {bd.isPaid ? (
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              {expense.due_date && expense.due_date !== "-"
                                ? formatDateId(expense.due_date)
                                : "Selesai"}
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                                {formatDateId(expense.due_date)}
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-2 py-0.5 rounded-md ${dueInfo.badgeClass}`}
                              >
                                {dueInfo.label}
                              </Badge>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span
                              className="truncate max-w-[150px] lg:max-w-[190px]"
                              title={expense.supplier}
                            >
                              {expense.supplier || "Tanpa Supplier"}
                            </span>
                          </div>
                          {expense.invoice_number && expense.invoice_number !== "-" && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono mt-0.5">
                              No: {expense.invoice_number}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div
                            className="font-medium text-slate-900 dark:text-slate-100 max-w-[190px] truncate"
                            title={expense.item_name}
                          >
                            {expense.item_name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                            >
                              {expense.category || "Umum"}
                            </Badge>
                            <span className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                              {expense.qty} {expense.unit || "pcs"}
                            </span>
                          </div>
                          {expense.notes && expense.notes !== "-" && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 italic mt-0.5 truncate max-w-[190px]">
                              {expense.notes}
                            </div>
                          )}
                        </td>

                        {/* Tagihan & DP Breakdown */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {bd.isPaid ? (
                            <div>
                              <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm">
                                {formatRupiah(bd.total)}
                              </div>
                              {(expense.payments_count || 0) > 0 && (
                                <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                  {expense.payments_count}x pembayaran
                                </div>
                              )}
                            </div>
                          ) : bd.isDp || bd.paid > 0 ? (
                            <div className="space-y-1 min-w-[145px]">
                              <div className="font-bold text-rose-700 dark:text-rose-400 tabular-nums text-sm">
                                Sisa {formatRupiah(bd.remaining)}
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-amber-500"
                                  style={{ width: `${Math.min(100, bd.progressPct)}%` }}
                                />
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                                DP {formatRupiah(bd.paid)} / {formatRupiah(bd.total)}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm">
                                {formatRupiah(bd.total)}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                                @{formatRupiah(expense.unit_price)}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Status Bayar */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {bd.isPaid ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] px-2 py-0.5 font-bold border-emerald-300 text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Lunas
                            </Badge>
                          ) : bd.isDp ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] px-2 py-0.5 font-bold border-amber-300 text-amber-900 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                            >
                              <Wallet className="w-3 h-3 mr-1" />
                              DP {Math.round(bd.progressPct)}%
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[11px] px-2 py-0.5 font-bold border-rose-300 text-rose-800 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
                            >
                              <Clock className="w-3 h-3 mr-1" />
                              Belum Lunas
                            </Badge>
                          )}
                        </td>

                        {/* Nota / Telegram Link */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {tgLink?.isUrl && tgLink.url ? (
                            <a
                              href={tgLink.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300 hover:underline px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800"
                              title="Buka pesan nota di Telegram"
                            >
                              <TelegramIcon className="w-3.5 h-3.5 text-blue-600" />
                              <span>Nota</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-80" />
                            </a>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">-</span>
                          )}
                        </td>

                        {/* Aksi */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {!bd.isPaid ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    openPaymentModal(expense, bd.isDp ? "full" : "percent")
                                  }
                                  className="h-8 px-2.5 text-[11px] font-bold rounded-lg bg-amber-700 hover:bg-amber-800 text-white shadow-2xs"
                                  title={
                                    bd.isDp
                                      ? "Catat cicilan atau pelunasan sisa DP"
                                      : "Catat pembayaran DP atau cicilan"
                                  }
                                >
                                  <Wallet className="w-3 h-3 mr-1" />
                                  {bd.isDp ? "Bayar / Lunasi" : "DP"}
                                </Button>

                                <Button
                                  size="sm"
                                  onClick={() => handleTogglePaid(expense)}
                                  disabled={settleMutation.isPending}
                                  className="h-8 px-2.5 text-[11px] font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white shadow-2xs"
                                  title="Langsung lunasi seluruh sisa tagihan"
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Lunas
                                </Button>
                              </>
                            ) : (
                              <>
                                {(expense.payments_count || 0) > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openPaymentModal(expense, "full")}
                                    className="h-8 px-2.5 text-[11px] font-semibold rounded-lg border-slate-300 text-slate-700 dark:text-slate-200"
                                    title="Lihat riwayat DP dan pelunasan"
                                  >
                                    <History className="w-3 h-3 mr-1" />
                                    Riwayat
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTogglePaid(expense)}
                                  disabled={settleMutation.isPending}
                                  className="h-8 px-2.5 text-[11px] font-bold rounded-lg border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                                  title="Batalkan status Lunas"
                                >
                                  Batal
                                </Button>
                              </>
                            )}

                            {onViewExpense && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onViewExpense(expense)}
                                className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 dark:text-slate-300 rounded-lg"
                                title="Lihat Detail"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onEditExpense(expense)}
                              className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 dark:text-slate-300 rounded-lg"
                              title="Edit Transaksi"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>

                            {canDelete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDelete(expense.id)}
                                disabled={deletingId === expense.id}
                                className="h-8 w-8 p-0 text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg"
                                title="Hapus Transaksi"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* 7. Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs">
            <span className="text-slate-600 dark:text-slate-300">
              Menampilkan {expenses.length} dari {totalItems} total tagihan
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[38px] rounded-lg text-xs"
              >
                Sebelumnya
              </Button>
              <span className="px-2 font-medium text-slate-800 dark:text-slate-200">
                Halaman {page} dari {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-[38px] rounded-lg text-xs"
              >
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 8. DP & Pelunasan Modal */}
      <DpPaymentModal
        isOpen={Boolean(paymentModalExpense)}
        onClose={() => setPaymentModalExpense(null)}
        expense={paymentModalExpense}
        bankAccounts={bankAccounts}
        initialMode={paymentModalMode}
        onPaymentUpdated={(updated) => setPaymentModalExpense(updated)}
      />
    </div>
  );
};
