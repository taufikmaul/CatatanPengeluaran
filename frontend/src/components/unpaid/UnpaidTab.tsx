import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getUnpaidSummary, settleUnpaidExpenses } from "@/lib/api";
import { Expense, UnpaidSummaryResponse, UnpaidSupplierSummary } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
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
  Filter,
} from "lucide-react";

interface UnpaidTabProps {
  currentMonth: number;
  currentYear: number;
  onEditExpense: (expense: Expense) => void;
  onViewExpense?: (expense: Expense) => void;
  onDeleteExpense: (id: number) => void;
  onAddNewUnpaid?: () => void;
  canDelete?: boolean;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

function getDueUrgencyInfo(dueStr?: string | null): {
  daysLeft: number | null;
  label: string;
  badgeClass: string;
  urgency: "overdue" | "today" | "soon" | "upcoming" | "none";
} {
  if (!dueStr || dueStr === "-" || dueStr.trim() === "") {
    return {
      daysLeft: null,
      label: "Tanpa Tempo",
      badgeClass: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
      urgency: "none",
    };
  }

  let targetDate: Date | null = null;
  const isoMatch = dueStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    targetDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  } else {
    const slashMatch = dueStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (slashMatch) {
      targetDate = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
    } else {
      const parsed = new Date(dueStr);
      if (!isNaN(parsed.getTime())) targetDate = parsed;
    }
  }

  if (!targetDate) {
    return {
      daysLeft: null,
      label: dueStr,
      badgeClass: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
      urgency: "none",
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return {
      daysLeft: diffDays,
      label: `Lewat ${absDays} Hari`,
      badgeClass: "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 font-bold",
      urgency: "overdue",
    };
  } else if (diffDays === 0) {
    return {
      daysLeft: 0,
      label: "Jatuh Tempo Hari Ini!",
      badgeClass: "bg-amber-500 text-white border-amber-600 animate-pulse font-bold",
      urgency: "today",
    };
  } else if (diffDays <= 7) {
    return {
      daysLeft: diffDays,
      label: `${diffDays} Hari Lagi`,
      badgeClass: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 font-semibold",
      urgency: "soon",
    };
  } else {
    return {
      daysLeft: diffDays,
      label: `${diffDays} Hari Lagi`,
      badgeClass: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-medium",
      urgency: "upcoming",
    };
  }
}

export const UnpaidTab: React.FC<UnpaidTabProps> = ({
  currentMonth,
  currentYear,
  onEditExpense,
  onViewExpense,
  onDeleteExpense,
  onAddNewUnpaid,
  canDelete = false,
}) => {
  const queryClient = useQueryClient();

  // Filters
  const [statusTab, setStatusTab] = useState<"unpaid" | "overdue" | "soon" | "paid" | "all">("unpaid");
  const [isAllPeriods, setIsAllPeriods] = useState<boolean>(true); // Default true agar owner langsung melihat semua hutang aktif
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("due_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [page, setPage] = useState<number>(1);
  const perPage = 25;

  // Batch selection states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isSuppliersExpanded, setIsSuppliersExpanded] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 1. Fetch Ringkasan Belum Lunas & Tempo Terdekat
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
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

  // 2. Fetch Daftar Transaksi Belum Lunas Terpaginasi
  const {
    data: expensesData,
    isLoading: isExpensesLoading,
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

      // Filter status
      if (statusTab === "unpaid" || statusTab === "overdue" || statusTab === "soon") {
        params.append("status", "Belum Lunas");
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

  // Filter client-side jika tab = "overdue" atau "soon" untuk presisi ekstra
  const expenses = useMemo(() => {
    if (statusTab === "overdue") {
      return rawExpenses.filter((e) => {
        const info = getDueUrgencyInfo(e.due_date);
        return info.urgency === "overdue";
      });
    }
    if (statusTab === "soon") {
      return rawExpenses.filter((e) => {
        const info = getDueUrgencyInfo(e.due_date);
        return info.urgency === "soon" || info.urgency === "today";
      });
    }
    return rawExpenses;
  }, [rawExpenses, statusTab]);

  // 3. Settle Mutation (Mark Paid)
  const settleMutation = useMutation({
    mutationFn: settleUnpaidExpenses,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });

      if (data.action === "mark_paid") {
        toast.success(`Berhasil menandai ${data.updated_count} transaksi telah lunas!`);
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
        });
      } else {
        toast.info(`Status pelunasan ${data.updated_count} transaksi diubah.`);
      }
      setSelectedIds([]);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memproses pelunasan transaksi.");
    },
  });

  // Handle single item settlement
  const handleTogglePaid = (expense: Expense) => {
    const isCurrentlyPaid = (expense.pay_status || "").toLowerCase().includes("lunas");
    const action = isCurrentlyPaid ? "mark_unpaid" : "mark_paid";
    settleMutation.mutate({
      expense_ids: [expense.id],
      action,
    });
  };

  // Handle settle all for a specific supplier
  const handleSettleSupplierAll = (supplierGroup: UnpaidSupplierSummary) => {
    if (supplierGroup.unpaid_count === 0) return;
    const confirmMsg = `Lunasi semua ${supplierGroup.unpaid_count} tagihan ke ${supplierGroup.supplier_name} senilai ${formatRupiah(supplierGroup.unpaid_total)}?`;
    if (!window.confirm(confirmMsg)) return;

    api
      .get(`/expenses?status=Belum Lunas&special_type=unpaid&supplier_id=${supplierGroup.supplier_id ?? ""}&supplier=${encodeURIComponent(supplierGroup.supplier_name)}&per_page=100`)
      .then((res) => {
        const ids = (res.data?.data || []).map((e: Expense) => e.id);
        if (ids.length === 0) {
          toast.error("Tidak ada transaksi belum lunas yang dapat diproses.");
          return;
        }
        settleMutation.mutate({
          expense_ids: ids,
          action: "mark_paid",
        });
      })
      .catch(() => {
        toast.error("Gagal mengambil data tagihan supplier.");
      });
  };

  // Selection handlers
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
    });
  };

  const selectedNominal = useMemo(() => {
    return expenses
      .filter((e) => selectedIds.includes(e.id))
      .reduce((sum, e) => sum + (e.total_price || 0), 0);
  }, [expenses, selectedIds]);

  const handleDelete = (id: number) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus catatan tagihan ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
      setTimeout(() => setDeletingId(null), 1000);
    }
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

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
            <CalendarClock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Daftar Tagihan Belum Lunas (Tempo)
              </h2>
              {summaryData && summaryData.unpaid_count > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold text-rose-700 border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                >
                  {summaryData.unpaid_count} Belum Dibayar
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pantau kewajiban hutang ke supplier/toko, prioritaskan tanggal jatuh tempo terdekat, dan kelola pelunasan secara tepat waktu.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onAddNewUnpaid && (
            <Button
              onClick={onAddNewUnpaid}
              className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold h-10 px-4 gap-2 shadow-xs shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Catat Tagihan Baru</span>
            </Button>
          )}
        </div>
      </div>

      {/* 2. KPI Cards: 4 Ringkasan Utama & Tempo Terdekat */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total Belum Lunas */}
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
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Total Belum Lunas
              </span>
              <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 flex items-center justify-center">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                  {formatRupiah(summaryData?.unpaid_total || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.unpaid_count || 0}
                </span>{" "}
                tagihan aktif
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: JATUH TEMPO TERDEKAT (Highlight Spesial Permintaan User) */}
        <Card
          className="border border-amber-200/90 dark:border-amber-900/60 bg-linear-to-br from-amber-50/70 via-white to-amber-50/30 dark:from-amber-950/30 dark:via-slate-900 dark:to-amber-950/10 rounded-2xl shadow-xs relative overflow-hidden"
        >
          <CardContent className="p-4 sm:p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Tempo Paling Dekat
              </span>
              {nearestDue && (
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1.5 py-0 font-bold ${
                    nearestDue.urgency === "overdue"
                      ? "bg-rose-100 text-rose-700 border-rose-300"
                      : nearestDue.urgency === "today"
                      ? "bg-amber-500 text-white border-amber-600 animate-pulse"
                      : "bg-amber-100 text-amber-800 border-amber-300"
                  }`}
                >
                  {nearestDue.urgency === "overdue"
                    ? `Lewat ${Math.abs(nearestDue.days_left)} Hari`
                    : nearestDue.urgency === "today"
                    ? "HARI INI"
                    : `${nearestDue.days_left} Hari Lagi`}
                </Badge>
              )}
            </div>

            <div className="mt-2 min-w-0">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : nearestDue ? (
                <div>
                  <div className="text-base sm:text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatDateId(nearestDue.parsed_due_date)}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium truncate mt-0.5">
                    <span className="font-bold text-amber-700 dark:text-amber-400">
                      {nearestDue.supplier}
                    </span>{" "}
                    • {formatRupiah(nearestDue.total_price)}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {nearestDue.item_name}
                  </div>
                </div>
              ) : (
                <div className="py-1">
                  <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Semua Aman
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Tidak ada tempo pembayaran dekat
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Sudah Lewat Tempo (Overdue) */}
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
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
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
                <div className="text-lg sm:text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums">
                  {formatRupiah(summaryData?.overdue_total || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-red-600 dark:text-red-400">
                  {summaryData?.overdue_count || 0}
                </span>{" "}
                tagihan terlewat
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Toko / Supplier Menagih */}
        <Card className="border rounded-2xl shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Toko / Supplier
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 flex items-center justify-center">
                <Store className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-16 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {summaryData?.by_supplier?.filter((s) => s.unpaid_count > 0).length || 0} Toko
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.total_count || 0}
                </span>{" "}
                total transaksi tercatat
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Rekap Saldo Tagihan per Toko / Supplier */}
      {summaryData && summaryData.by_supplier && summaryData.by_supplier.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                Rekap Saldo Tagihan per Toko / Supplier
              </h3>
              <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-200">
                {summaryData.by_supplier.length} Toko
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSuppliersExpanded((prev) => !prev)}
              className="h-8 text-xs text-slate-500 hover:text-slate-800 gap-1 px-2"
            >
              <span>{isSuppliersExpanded ? "Tutup Rekap" : "Buka Rekap"}</span>
              {isSuppliersExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {isSuppliersExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
              {summaryData.by_supplier.map((supplierGroup) => {
                const isSelected = selectedSupplierId === supplierGroup.supplier_id;
                const hasUnpaid = supplierGroup.unpaid_count > 0;

                return (
                  <div
                    key={supplierGroup.supplier_id ?? supplierGroup.supplier_name}
                    className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                      isSelected
                        ? "border-rose-400 bg-rose-50/50 dark:bg-rose-950/30 ring-1 ring-rose-400"
                        : "border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white text-xs font-bold text-rose-700">
                          <AvatarFallback>{getInitials(supplierGroup.supplier_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                              {supplierGroup.supplier_name}
                            </span>
                            {supplierGroup.has_overdue && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 font-bold border-red-300 text-red-700 bg-red-50"
                              >
                                Lewat Tempo
                              </Badge>
                            )}
                          </div>
                          {supplierGroup.nearest_due_date ? (
                            <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium truncate">
                              Tempo: {formatDateId(supplierGroup.nearest_due_date)}
                              {supplierGroup.nearest_days_left !== null && (
                                <span className="ml-1 text-slate-500">
                                  ({supplierGroup.nearest_days_left < 0
                                    ? `Lewat ${Math.abs(supplierGroup.nearest_days_left)}h`
                                    : supplierGroup.nearest_days_left === 0
                                    ? "Hari Ini"
                                    : `${supplierGroup.nearest_days_left}h lagi`})
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-400 truncate">
                              Belum ada tanggal tempo
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSupplierId(isSelected ? null : supplierGroup.supplier_id);
                          setPage(1);
                        }}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors shrink-0 ${
                          isSelected
                            ? "bg-rose-600 text-white border-rose-600"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                        }`}
                        title="Filter data khusus toko ini"
                      >
                        {isSelected ? "Filter Aktif" : "Filter"}
                      </button>
                    </div>

                    <div className="bg-white dark:bg-slate-950/50 border border-slate-200/60 dark:border-slate-800/80 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 text-[11px]">Belum Lunas:</span>
                        <span
                          className={`font-bold tabular-nums ${
                            hasUnpaid ? "text-rose-600 dark:text-rose-400" : "text-slate-400"
                          }`}
                        >
                          {formatRupiah(supplierGroup.unpaid_total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Jumlah Nota:</span>
                        <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                          {supplierGroup.unpaid_count} belum lunas / {supplierGroup.total_count} total
                        </span>
                      </div>
                    </div>

                    {hasUnpaid && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSettleSupplierAll(supplierGroup)}
                        disabled={settleMutation.isPending}
                        className="w-full h-8 text-[11px] font-semibold rounded-lg border-rose-300 text-rose-800 bg-rose-50/60 hover:bg-rose-100 hover:text-rose-900 dark:border-rose-800 dark:text-rose-300 dark:bg-rose-950/40 gap-1.5"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-rose-600" />
                        <span>Lunasi Semua ({formatRupiah(supplierGroup.unpaid_total)})</span>
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
        {/* Row 1: Status Tabs & Periode Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tab Pills */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setStatusTab("unpaid");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "unpaid"
                  ? "bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Belum Lunas</span>
              {summaryData && summaryData.unpaid_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 font-bold">
                  {summaryData.unpaid_count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("overdue");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "overdue"
                  ? "bg-white dark:bg-slate-900 text-red-700 dark:text-red-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              <span>Lewat Tempo</span>
              {summaryData && summaryData.overdue_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 font-bold">
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "soon"
                  ? "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
              <span>≤ 7 Hari</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusTab("paid");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "paid"
                  ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusTab === "all"
                  ? "bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
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
              className="h-9 rounded-xl text-xs font-medium px-3 gap-1.5"
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
                  className="h-9 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden"
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
                  className="h-9 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden"
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
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari barang, supplier/toko, nota, atau catatan..."
              className="pl-9 h-9.5 text-xs rounded-xl bg-slate-50/70 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700"
            />
          </div>

          {/* Supplier Dropdown */}
          <div className="sm:w-56 shrink-0">
            <select
              value={selectedSupplierId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedSupplierId(val ? Number(val) : null);
                setPage(1);
              }}
              className="w-full h-9.5 px-3 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden"
            >
              <option value="">Semua Toko / Supplier</option>
              {summaryData?.by_supplier?.map((s) => (
                <option key={s.supplier_id ?? s.supplier_name} value={s.supplier_id ?? ""}>
                  {s.supplier_name} {s.unpaid_count > 0 ? `(${s.unpaid_count} tempo)` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By Dropdown */}
          <div className="sm:w-52 shrink-0 flex items-center gap-1.5">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              className="w-full h-9.5 px-3 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden"
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
              className="h-9.5 w-9.5 p-0 rounded-xl border-slate-200 dark:border-slate-700 shrink-0"
              title={`Urutan: ${sortOrder === "asc" ? "Menaik (A-Z / Terdekat)" : "Menurun (Z-A / Terjauh)"}`}
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
            </Button>
          </div>
        </div>
      </div>

      {/* 5. Batch Action Toolbar (Muncul saat ada item dipilih) */}
      {selectedIds.length > 0 && (
        <div className="bg-linear-to-r from-rose-600 to-amber-600 text-white rounded-2xl p-4 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <CheckCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-sm">
                {selectedIds.length} Transaksi Terpilih
              </div>
              <div className="text-xs text-rose-100">
                Total Nominal: <span className="font-bold">{formatRupiah(selectedNominal)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleBatchSettle("mark_paid")}
              disabled={settleMutation.isPending}
              className="bg-white text-rose-700 hover:bg-rose-50 rounded-xl font-bold text-xs h-9 px-3 gap-1.5 shadow-xs"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Tandai Sudah Lunas ({selectedIds.length})</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
              className="text-white hover:bg-white/10 rounded-xl text-xs h-9 px-3"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* 6. Data Table & List View */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {isExpensesLoading ? (
          <div className="p-8 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40 rounded-lg" />
              <Skeleton className="h-5 w-24 rounded-lg" />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
              <Receipt className="w-7 h-7" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">
                Tidak ada data tagihan
              </h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {search.trim()
                  ? `Tidak ada transaksi yang cocok dengan kata kunci "${search}".`
                  : statusTab === "unpaid"
                  ? "Hebat! Semua tagihan operasional dan tempo toko telah lunas."
                  : statusTab === "overdue"
                  ? "Aman! Tidak ada tagihan yang melewati batas jatuh tempo."
                  : "Belum ada catatan tagihan pada filter periode ini."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200/90 dark:border-slate-800 text-slate-500 dark:text-slate-400">
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
                  <th className="py-3 px-3 font-semibold">Jatuh Tempo</th>
                  <th className="py-3 px-3 font-semibold">Toko / Supplier</th>
                  <th className="py-3 px-3 font-semibold">Barang & Kategori</th>
                  <th className="py-3 px-3 font-semibold text-right">Nominal</th>
                  <th className="py-3 px-3 font-semibold text-center">Status</th>
                  <th className="py-3 px-3 font-semibold text-center">Nota / Chat</th>
                  <th className="py-3 px-3 font-semibold text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {expenses.map((expense) => {
                  const isSelected = selectedIds.includes(expense.id);
                  const isPaid = (expense.pay_status || "").toLowerCase().includes("lunas");
                  const dueInfo = getDueUrgencyInfo(expense.due_date);
                  const catColor = getCategoryColor(expense.category);
                  const tgLink = parseTelegramLink(expense.msg_link);

                  return (
                    <tr
                      key={expense.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected
                          ? "bg-rose-50/40 dark:bg-rose-950/20"
                          : dueInfo.urgency === "overdue"
                          ? "bg-red-50/20 dark:bg-red-950/10"
                          : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3.5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleSelect(expense.id)}
                          aria-label={`Pilih transaksi #${expense.id}`}
                        />
                      </td>

                      {/* Tanggal Transaksi */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {formatDateId(expense.expense_date)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          ID: #{expense.id}
                        </div>
                      </td>

                      {/* Jatuh Tempo & Urgensi (Highlight) */}
                      <td className="py-3 px-3 whitespace-nowrap">
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
                      </td>

                      {/* Toko / Supplier */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[150px] sm:max-w-[200px]" title={expense.supplier}>
                            {expense.supplier || "Tanpa Supplier"}
                          </span>
                        </div>
                        {expense.invoice_number && expense.invoice_number !== "-" && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            No: {expense.invoice_number}
                          </div>
                        )}
                      </td>

                      {/* Barang & Kategori */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100 max-w-[200px] truncate" title={expense.item_name}>
                          {expense.item_name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-[9px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                          >
                            {expense.category || "Umum"}
                          </Badge>
                          <span className="text-[10px] text-slate-400 tabular-nums">
                            {expense.qty} {expense.unit || "pcs"}
                          </span>
                        </div>
                        {expense.notes && (
                          <div className="text-[10px] text-slate-400 italic mt-0.5 truncate max-w-[200px]">
                            {expense.notes}
                          </div>
                        )}
                      </td>

                      {/* Nominal */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm">
                          {formatRupiah(expense.total_price)}
                        </div>
                        <div className="text-[10px] text-slate-400 tabular-nums">
                          @{formatRupiah(expense.unit_price)}
                        </div>
                      </td>

                      {/* Status Bayar */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {isPaid ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-2 py-0.5 font-bold border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Lunas
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-2 py-0.5 font-bold border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
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
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline px-2 py-1 rounded-lg bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800"
                            title="Buka pesan nota di Telegram"
                          >
                            <TelegramIcon className="w-3.5 h-3.5 text-blue-500" />
                            <span>Nota</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                          </a>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>

                      {/* Aksi */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {/* Tombol Lunas / Batal Lunas */}
                          <Button
                            size="sm"
                            variant={isPaid ? "outline" : "default"}
                            onClick={() => handleTogglePaid(expense)}
                            disabled={settleMutation.isPending}
                            className={`h-7 px-2.5 text-[10px] font-bold rounded-lg ${
                              isPaid
                                ? "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                                : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
                            }`}
                            title={isPaid ? "Ubah status ke Belum Lunas" : "Tandai sudah lunas"}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            {isPaid ? "Batal" : "Lunas"}
                          </Button>

                          {/* Detail */}
                          {onViewExpense && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onViewExpense(expense)}
                              className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900 rounded-lg"
                              title="Lihat Detail"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {/* Edit */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onEditExpense(expense)}
                            className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900 rounded-lg"
                            title="Edit Transaksi"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>

                          {/* Delete */}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(expense.id)}
                              disabled={deletingId === expense.id}
                              className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg"
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
        )}

        {/* 7. Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-xs">
            <span className="text-slate-500">
              Menampilkan {expenses.length} dari {totalItems} total tagihan
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 rounded-lg text-xs"
              >
                Sebelumnya
              </Button>
              <span className="px-2 font-medium text-slate-700 dark:text-slate-300">
                Halaman {page} dari {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-8 rounded-lg text-xs"
              >
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
