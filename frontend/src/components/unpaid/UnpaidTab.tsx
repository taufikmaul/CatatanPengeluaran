import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  getBankAccounts,
  getGroupedExpenses,
  getUnpaidSummary,
  settleUnpaidExpenses,
} from "@/lib/api";
import {
  Expense,
  ExpenseInvoiceGroup,
  ExpenseInvoiceListResponse,
  UnpaidSummaryResponse,
  UnpaidSupplierSummary,
} from "@/types";
import { formatDateId, formatRupiah, getCategoryColor, toIsoDate } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import {
  getDueUrgencyInfo,
  getExpensePaymentBreakdown,
  isDpStatus,
  isPaidStatus,
} from "@/lib/paymentStatus";
import { cn } from "@/lib/utils";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { DpPaymentModal } from "./DpPaymentModal";
import {
  ExpenseViewMode,
  InvoiceFeeFooter,
  InvoiceViewModeToggle,
  getInvoiceItemSummaryText,
} from "@/components/common/InvoiceGroupShared";
import {
  LedgerBatchDock,
  LedgerConfirmDialog,
  LedgerMetricStrip,
  LedgerStateBlock,
  LedgerStatusTabs,
  type LedgerStatusTabOption,
} from "@/components/common/LedgerPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/common/DataTable";
import { SearchMinCharHint } from "@/components/common/HighlightText";
import { getEffectiveSearchQuery } from "@/lib/searchHighlight";
import {
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef, ExpandedState, PaginationState, useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Edit2,
  ExternalLink,
  Eye,
  History,
  Percent,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

interface UnpaidTabProps {
  currentMonth: number;
  currentYear: number;
  currentMonthEnd?: number;
  onEditExpense: (expense: Expense) => void;
  onViewExpense?: (expense: Expense) => void;
  onDeleteExpense: (id: number) => void;
  onAddNewUnpaid?: () => void;
  onAddNewDp?: () => void;
  canDelete?: boolean;
}

type UnpaidStatusTab = "unpaid" | "dp" | "overdue" | "soon" | "paid" | "all";
type PeriodMode = "all" | "month" | "custom";

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

function getInitials(name: string): string {
  return (name || "HC")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function renderInvoiceStatusBadge(group: ExpenseInvoiceGroup, compact = false) {
  const pad = compact ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2 py-0.5";
  if (group.is_paid) {
    return (
      <Badge
        variant="outline"
        className={cn(
          pad,
          "font-semibold border-emerald-300 text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 shrink-0"
        )}
      >
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Lunas
      </Badge>
    );
  }
  if (group.is_dp) {
    return (
      <Badge
        variant="outline"
        className={cn(
          pad,
          "font-semibold border-amber-300 text-amber-900 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 shrink-0"
        )}
      >
        <Wallet className="w-3 h-3 mr-1" />
        DP {Math.round(group.payment_progress_pct)}%
      </Badge>
    );
  }
  if (group.is_mixed_pay_status) {
    return (
      <Badge
        variant="outline"
        className={cn(
          pad,
          "font-semibold border-amber-300 text-amber-900 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 shrink-0"
        )}
      >
        <Clock className="w-3 h-3 mr-1" />
        Sebagian Lunas
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        pad,
        "font-semibold border-rose-300 text-rose-800 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800 shrink-0"
      )}
    >
      <Clock className="w-3 h-3 mr-1" />
      Belum Lunas
    </Badge>
  );
}

function renderExpenseStatusBadge(
  bd: ReturnType<typeof getExpensePaymentBreakdown>,
  compact = false
) {
  const pad = compact ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2 py-0.5";
  if (bd.isPaid) {
    return (
      <Badge
        variant="outline"
        className={cn(
          pad,
          "font-semibold border-emerald-300 text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 shrink-0"
        )}
      >
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Lunas
      </Badge>
    );
  }
  if (bd.isDp) {
    return (
      <Badge
        variant="outline"
        className={cn(
          pad,
          "font-semibold border-amber-300 text-amber-900 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 shrink-0"
        )}
      >
        <Wallet className="w-3 h-3 mr-1" />
        DP {Math.round(bd.progressPct)}%
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        pad,
        "font-semibold border-rose-300 text-rose-800 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800 shrink-0"
      )}
    >
      <Clock className="w-3 h-3 mr-1" />
      Belum Lunas
    </Badge>
  );
}

export const UnpaidTab: React.FC<UnpaidTabProps> = ({
  currentMonth,
  currentYear,
  currentMonthEnd,
  onEditExpense,
  onViewExpense,
  onDeleteExpense,
  onAddNewUnpaid,
  onAddNewDp,
  canDelete = false,
}) => {
  const queryClient = useQueryClient();

  // Filters & view state
  const [statusTab, setStatusTab] = useState<UnpaidStatusTab>("unpaid");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("all");
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedMonthEnd, setSelectedMonthEnd] = useState<number>(
    currentMonthEnd || currentMonth
  );
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [customStart, setCustomStart] = useState<string>(() =>
    toIsoDate(new Date(currentYear, currentMonth - 1, 1))
  );
  const [customEnd, setCustomEnd] = useState<string>(() => toIsoDate(new Date()));
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [search, setSearch] = useState<string>("");
  const effectiveSearch = useMemo(() => getEffectiveSearchQuery(search), [search]);
  const [sortBy, setSortBy] = useState<string>("due_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  React.useEffect(() => {
    setSelectedMonth(currentMonth);
    setSelectedMonthEnd(currentMonthEnd || currentMonth);
    setSelectedYear(currentYear);
  }, [currentMonth, currentMonthEnd, currentYear]);

  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);
  const [viewMode, setViewMode] = useState<ExpenseViewMode>("grouped");
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [mobileExpandedKeys, setMobileExpandedKeys] = useState<Record<string, boolean>>({});
  const isGroupedMode = viewMode === "grouped";

  // Batch selection & confirmation states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [settleBankAccountId, setSettleBankAccountId] = useState<string>("");
  const [isSuppliersExpanded, setIsSuppliersExpanded] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmSupplierGroup, setConfirmSupplierGroup] =
    useState<UnpaidSupplierSummary | null>(null);
  const [supplierSettleBankId, setSupplierSettleBankId] = useState<string>("");

  // DP & Pelunasan Modal state
  const [paymentModalExpense, setPaymentModalExpense] = useState<Expense | null>(null);
  const [paymentModalInvoiceGroup, setPaymentModalInvoiceGroup] =
    useState<ExpenseInvoiceGroup | null>(null);
  const [paymentModalMode, setPaymentModalMode] = useState<"full" | "percent" | "amount">(
    "percent"
  );

  const toggleMobileExpand = (key: string) => {
    setMobileExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", "active"],
    queryFn: () => getBankAccounts(true),
  });

  // Effective period params
  const isCustomRangeInvalid =
    periodMode === "custom" && !!customStart && !!customEnd && customStart > customEnd;
  const rangeStart =
    periodMode === "custom" && !isCustomRangeInvalid ? customStart || null : null;
  const rangeEnd =
    periodMode === "custom" && !isCustomRangeInvalid ? customEnd || null : null;
  const monthParam = periodMode === "month" ? selectedMonth : null;
  const monthEndParam = periodMode === "month" ? selectedMonthEnd : null;
  const yearParam = periodMode === "month" ? selectedYear : null;

  // 1. Summary KPI + supplier breakdown
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    refetch: refetchSummary,
  } = useQuery<UnpaidSummaryResponse>({
    queryKey: [
      "unpaid-summary",
      monthParam,
      yearParam,
      rangeStart,
      rangeEnd,
      selectedSupplierId,
    ],
    enabled: !isCustomRangeInvalid,
    queryFn: () =>
      getUnpaidSummary({
        month: monthParam,
        year: yearParam,
        startDate: rangeStart,
        endDate: rangeEnd,
        supplierId: selectedSupplierId,
      }),
  });

  // 2a. Flat item list
  const {
    data: expensesData,
    isLoading: isFlatExpensesLoading,
    isError: isFlatExpensesError,
    refetch: refetchFlatExpenses,
  } = useQuery({
    queryKey: [
      "expenses-unpaid",
      page,
      perPage,
      monthParam,
      monthEndParam,
      yearParam,
      rangeStart,
      rangeEnd,
      statusTab,
      selectedSupplierId,
      effectiveSearch,
      sortBy,
      sortOrder,
    ],
    enabled: !isCustomRangeInvalid && !isGroupedMode,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        special_type: "unpaid",
        sort_by: sortBy,
        sort_order: sortOrder,
      });

      if (periodMode === "month") {
        params.append("month", String(selectedMonth));
        if (selectedMonthEnd && selectedMonthEnd !== selectedMonth) {
          params.append("month_end", String(selectedMonthEnd));
        }
        params.append("year", String(selectedYear));
      } else if (periodMode === "custom") {
        if (rangeStart) params.append("start_date", rangeStart);
        if (rangeEnd) params.append("end_date", rangeEnd);
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

      if (effectiveSearch) {
        params.append("search", effectiveSearch);
      }

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
  });

  // 2b. Grouped per invoice list
  const {
    data: groupedData,
    isLoading: isGroupedExpensesLoading,
    isError: isGroupedExpensesError,
    refetch: refetchGroupedExpenses,
  } = useQuery<ExpenseInvoiceListResponse>({
    queryKey: [
      "expenses-unpaid-grouped",
      page,
      perPage,
      monthParam,
      monthEndParam,
      yearParam,
      rangeStart,
      rangeEnd,
      statusTab,
      selectedSupplierId,
      effectiveSearch,
      sortBy,
      sortOrder,
    ],
    enabled: !isCustomRangeInvalid && isGroupedMode,
    queryFn: () => {
      let apiStatus: string | undefined;
      let dueUrgency: string | undefined;
      if (statusTab === "unpaid") apiStatus = "Belum Lunas";
      else if (statusTab === "overdue") {
        apiStatus = "Belum Lunas";
        dueUrgency = "overdue";
      } else if (statusTab === "soon") {
        apiStatus = "Belum Lunas";
        dueUrgency = "soon";
      } else if (statusTab === "dp") apiStatus = "DP / Sebagian";
      else if (statusTab === "paid") apiStatus = "Lunas";

      return getGroupedExpenses({
        page,
        per_page: perPage,
        special_type: "unpaid",
        sort_by: sortBy,
        sort_order: sortOrder,
        due_urgency: dueUrgency,
        month: periodMode === "month" ? selectedMonth : null,
        month_end:
          periodMode === "month" && selectedMonthEnd !== selectedMonth
            ? selectedMonthEnd
            : null,
        year: periodMode === "month" ? selectedYear : null,
        start_date: periodMode === "custom" ? rangeStart : null,
        end_date: periodMode === "custom" ? rangeEnd : null,
        status: apiStatus,
        supplier_id: selectedSupplierId,
        search: effectiveSearch || undefined,
      });
    },
  });

  const isExpensesLoading = isGroupedMode
    ? isGroupedExpensesLoading
    : isFlatExpensesLoading;
  const isExpensesError = isGroupedMode ? isGroupedExpensesError : isFlatExpensesError;
  const refetchExpenses = isGroupedMode ? refetchGroupedExpenses : refetchFlatExpenses;

  const invoiceGroups: ExpenseInvoiceGroup[] = groupedData?.data || [];
  const rawExpenses: Expense[] = expensesData?.data || [];
  const totalItems: number = isGroupedMode
    ? groupedData?.total || 0
    : expensesData?.total || 0;
  const totalGroupChildItems: number = groupedData?.total_items || 0;

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

  // 3. Settle mutation
  const settleMutation = useMutation({
    mutationFn: settleUnpaidExpenses,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });

      if (data.action === "mark_paid") {
        toast.success(`Berhasil melunasi ${data.updated_count} transaksi.`);
        confetti({
          particleCount: 45,
          spread: 55,
          origin: { y: 0.75 },
        });
      } else {
        toast.info(`Status pelunasan ${data.updated_count} transaksi dikembalikan.`);
      }
      setSelectedIds([]);
      setConfirmSupplierGroup(null);
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
        action === "mark_paid" && settleBankAccountId
          ? Number(settleBankAccountId)
          : undefined,
    });
  };

  const getGroupActionableIds = (group: ExpenseInvoiceGroup): number[] => {
    if (statusTab === "paid" || group.is_paid) {
      return group.items.map((it) => it.id);
    }
    const unpaidIds = group.items
      .filter((it) => !isPaidStatus(it.pay_status))
      .map((it) => it.id);
    return unpaidIds.length > 0 ? unpaidIds : group.items.map((it) => it.id);
  };

  const handleToggleGroupPaid = (group: ExpenseInvoiceGroup) => {
    const action = group.is_paid ? "mark_unpaid" : "mark_paid";
    const targetIds = getGroupActionableIds(group);
    if (targetIds.length === 0) return;
    settleMutation.mutate({
      expense_ids: targetIds,
      action,
      bank_account_id:
        action === "mark_paid" && settleBankAccountId
          ? Number(settleBankAccountId)
          : undefined,
    });
  };

  const executeSettleSupplierAll = () => {
    if (!confirmSupplierGroup || confirmSupplierGroup.unpaid_count === 0) return;
    const supplierGroup = confirmSupplierGroup;
    const chosenBankId = supplierSettleBankId || settleBankAccountId;

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
          setConfirmSupplierGroup(null);
          return;
        }
        settleMutation.mutate({
          expense_ids: ids,
          action: "mark_paid",
          bank_account_id: chosenBankId ? Number(chosenBankId) : undefined,
        });
      })
      .catch(() => {
        toast.error("Gagal mengambil data tagihan supplier.");
      });
  };

  const allVisibleSelectableIds = useMemo(() => {
    if (isGroupedMode) {
      return Array.from(
        new Set(invoiceGroups.flatMap((g) => getGroupActionableIds(g)))
      );
    }
    return expenses.map((e) => e.id);
  }, [isGroupedMode, invoiceGroups, expenses, statusTab]);

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? allVisibleSelectableIds : []);
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectGroup = (group: ExpenseInvoiceGroup) => {
    const groupIds = getGroupActionableIds(group);
    if (groupIds.length === 0) return;
    const allSelected = groupIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => {
      if (allSelected) {
        return prev.filter((id) => !groupIds.includes(id));
      }
      return Array.from(new Set([...prev, ...groupIds]));
    });
  };

  const handleBatchSettle = (action: "mark_paid" | "mark_unpaid") => {
    if (selectedIds.length === 0) return;
    settleMutation.mutate({
      expense_ids: selectedIds,
      action,
      bank_account_id:
        action === "mark_paid" && settleBankAccountId
          ? Number(settleBankAccountId)
          : undefined,
    });
  };

  const selectedNominal = useMemo(() => {
    const pool = isGroupedMode
      ? Array.from(
          new Map(
            invoiceGroups.flatMap((g) => g.items).map((it) => [it.id, it])
          ).values()
        )
      : expenses;
    return pool
      .filter((e) => selectedIds.includes(e.id))
      .reduce((sum, e) => {
        const bd = getExpensePaymentBreakdown(e);
        return sum + (bd.isPaid ? bd.total : bd.remaining);
      }, 0);
  }, [isGroupedMode, invoiceGroups, expenses, selectedIds]);

  const executeDeleteExpense = () => {
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    setDeletingId(id);
    setConfirmDeleteId(null);
    onDeleteExpense(id);
    window.setTimeout(() => setDeletingId(null), 1000);
  };

  const openPaymentModal = (expense: Expense, mode: "full" | "percent" | "amount") => {
    setPaymentModalInvoiceGroup(null);
    setPaymentModalMode(mode);
    setPaymentModalExpense(expense);
  };

  const openGroupPaymentModal = (
    group: ExpenseInvoiceGroup,
    mode: "full" | "percent" | "amount"
  ) => {
    const unpaidItems = group.items.filter((it) => !isPaidStatus(it.pay_status));
    if (unpaidItems.length === 1) {
      openPaymentModal(unpaidItems[0], mode);
      return;
    }
    if (group.items.length === 1) {
      openPaymentModal(group.items[0], mode);
      return;
    }
    setPaymentModalExpense(null);
    setPaymentModalMode(mode);
    setPaymentModalInvoiceGroup(group);
  };

  const handleResetFilters = () => {
    setStatusTab("unpaid");
    setPeriodMode("all");
    setSelectedSupplierId(null);
    setSearch("");
    setSortBy("due_date");
    setSortOrder("asc");
    setPage(1);
    setExpanded({});
    setMobileExpandedKeys({});
    setSelectedIds([]);
  };

  const hasActiveFilters =
    statusTab !== "unpaid" ||
    periodMode !== "all" ||
    selectedSupplierId !== null ||
    search.trim() !== "" ||
    sortBy !== "due_date" ||
    sortOrder !== "asc";

  const nearestDue = summaryData?.nearest_due;
  const activeUnpaidCount =
    summaryData?.total_unpaid_count ?? summaryData?.unpaid_count ?? 0;
  const activeUnpaidTotal =
    summaryData?.total_unpaid_nominal ?? summaryData?.unpaid_total ?? 0;
  const activeOverdueTotal =
    summaryData?.overdue_nominal ?? summaryData?.overdue_total ?? 0;
  const dpCount = summaryData?.dp_count ?? 0;
  const dpPaidNominal = summaryData?.dp_paid_nominal ?? 0;
  const dpRemainingNominal = summaryData?.dp_remaining_nominal ?? 0;
  const activeSuppliersCount =
    summaryData?.by_supplier?.filter((s) => s.unpaid_count > 0).length || 0;

  const yearOptions = useMemo(() => {
    const yrs = new Set([
      currentYear - 2,
      currentYear - 1,
      currentYear,
      currentYear + 1,
      selectedYear,
    ]);
    return Array.from(yrs)
      .sort((a, b) => a - b)
      .map((yr) => ({ value: String(yr), label: String(yr) }));
  }, [currentYear, selectedYear]);

  const monthOptions = useMemo(
    () => MONTH_NAMES.map((name, idx) => ({ value: String(idx + 1), label: name })),
    []
  );

  const supplierOptions = useMemo(() => {
    const list = summaryData?.by_supplier || [];
    return [
      { value: "", label: "Semua Toko / Supplier" },
      ...list
        .filter((s) => s.supplier_id !== null)
        .map((s) => ({
          value: String(s.supplier_id),
          label: s.supplier_name,
          sublabel:
            s.unpaid_count > 0
              ? `${s.unpaid_count} nota · Sisa ${formatRupiah(s.unpaid_total)}`
              : "Lunas",
        })),
    ];
  }, [summaryData?.by_supplier]);

  const statusTabsList = useMemo<LedgerStatusTabOption<UnpaidStatusTab>[]>(
    () => [
      { value: "unpaid", label: "Belum Lunas & DP", count: activeUnpaidCount },
      { value: "dp", label: "DP / Sebagian", count: dpCount },
      {
        value: "overdue",
        label: "Lewat Tempo",
        count: summaryData?.overdue_count || 0,
      },
      { value: "soon", label: "≤ 7 Hari", count: summaryData?.due_soon_count || 0 },
      { value: "paid", label: "Sudah Lunas" },
      { value: "all", label: "Semua" },
    ],
    [activeUnpaidCount, dpCount, summaryData?.overdue_count, summaryData?.due_soon_count]
  );

  const groupedUnpaidColumns = useMemo<ColumnDef<DataGridFeatures, ExpenseInvoiceGroup>[]>(
    () => [
      {
        id: "expand",
        header: () => null,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                row.getToggleExpandedHandler()();
              }}
              aria-expanded={row.getIsExpanded()}
              aria-label={
                row.getIsExpanded()
                  ? "Tutup rincian item tagihan"
                  : `Lihat ${row.original.items_count} item tagihan`
              }
              className="mx-auto inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-[var(--ledger-recessed)] text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          ) : null,
        size: 36,
        enableSorting: false,
        meta: {
          expandedContent: (group: ExpenseInvoiceGroup) => (
            <div className="ledger-recessed-band px-3.5 py-2.5 border-t border-[color:var(--ledger-hairline)] space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ledger-ink)]">
                  <Receipt className="w-3.5 h-3.5 text-[var(--signal-unpaid)]" />
                  <span>Rincian Item Tagihan ({group.items.length} item)</span>
                  {group.invoice_number && group.invoice_number !== "-" && (
                    <span className="font-mono-ledger text-[11px] text-[var(--ledger-muted)]">
                      #{group.invoice_number}
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto border-y border-[color:var(--ledger-hairline)]">
                <table className="w-full text-xs">
                  <thead className="border-b border-[color:var(--ledger-hairline)] text-[11px] text-[var(--ledger-muted)]">
                    <tr>
                      <th className="py-1.5 px-2 text-left font-semibold w-8">#</th>
                      <th className="py-1.5 px-2 text-left font-semibold">
                        Barang &amp; Kategori
                      </th>
                      <th className="py-1.5 px-2 text-right font-semibold">Qty</th>
                      <th className="py-1.5 px-2 text-right font-semibold">
                        Harga Satuan
                      </th>
                      <th className="py-1.5 px-2 text-right font-semibold">
                        Tagihan / Sisa
                      </th>
                      <th className="py-1.5 px-2 text-center font-semibold">Status</th>
                      <th className="py-1.5 px-2 text-center font-semibold">Aksi Item</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--ledger-hairline)]">
                    {group.items.map((it, idx) => {
                      const bd = getExpensePaymentBreakdown(it);
                      const catColor = getCategoryColor(it.category);
                      return (
                        <tr key={it.id} className="ledger-hover-surface">
                          <td className="py-1.5 px-2 font-mono-ledger text-[var(--ledger-muted)]">
                            {idx + 1}
                          </td>
                          <td className="py-1.5 px-2 min-w-[200px]">
                            <div className="font-semibold text-[var(--ledger-ink)]">
                              {it.item_name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                              >
                                {it.category || "Umum"}
                              </Badge>
                              {it.notes && it.notes !== "-" && (
                                <span className="text-[11px] text-[var(--ledger-muted)]">
                                  {it.notes}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap text-[var(--ledger-muted)]">
                            {it.qty} {it.unit || "Pcs"}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap text-[var(--ledger-muted)]">
                            {formatRupiah(it.unit_price)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                            {bd.isPaid ? (
                              <span className="font-bold text-[var(--ledger-ink)]">
                                {formatRupiah(bd.total)}
                              </span>
                            ) : bd.paid > 0 ? (
                              <div>
                                <div className="font-bold text-[var(--signal-unpaid)]">
                                  Sisa {formatRupiah(bd.remaining)}
                                </div>
                                <div className="text-[10px] text-[var(--ledger-muted)]">
                                  DP {formatRupiah(bd.paid)} / {formatRupiah(bd.total)}
                                </div>
                              </div>
                            ) : (
                              <span className="font-bold text-[var(--ledger-ink)]">
                                {formatRupiah(bd.total)}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-center whitespace-nowrap">
                            {renderExpenseStatusBadge(bd, true)}
                          </td>
                          <td className="py-1.5 px-2 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {!bd.isPaid ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      openPaymentModal(it, bd.isDp ? "full" : "percent")
                                    }
                                    className="h-7 px-2 text-[10px] font-semibold border-amber-300 text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
                                  >
                                    {bd.isDp ? "Bayar" : "DP"}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleTogglePaid(it)}
                                    disabled={settleMutation.isPending}
                                    className="h-7 px-2 text-[10px] font-semibold border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/40"
                                  >
                                    Lunas
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTogglePaid(it)}
                                  disabled={settleMutation.isPending}
                                  className="h-7 px-2 text-[10px] font-semibold"
                                >
                                  Batal
                                </Button>
                              )}
                              {onViewExpense && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => onViewExpense(it)}
                                  className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                                  aria-label={`Lihat detail ${it.item_name}`}
                                  title="Lihat Detail"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => onEditExpense(it)}
                                className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                                aria-label={`Edit ${it.item_name}`}
                                title="Edit Item"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              {canDelete && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setConfirmDeleteId(it.id)}
                                  disabled={deletingId === it.id}
                                  className="h-7 w-7 text-[var(--signal-unpaid)] hover:bg-[var(--signal-unpaid-soft)]"
                                  aria-label={`Hapus ${it.item_name}`}
                                  title="Hapus Item"
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

              <InvoiceFeeFooter group={group} showPaymentSummary={!group.is_paid} />
            </div>
          ),
        },
      },
      {
        id: "select",
        header: () => {
          const allSelected =
            allVisibleSelectableIds.length > 0 &&
            allVisibleSelectableIds.every((id) => selectedIds.includes(id));
          const someSelected =
            allVisibleSelectableIds.some((id) => selectedIds.includes(id)) && !allSelected;
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(chk) => handleSelectAll(Boolean(chk))}
                aria-label="Pilih semua invoice"
              />
            </div>
          );
        },
        cell: ({ row }) => {
          const g = row.original;
          const groupIds = getGroupActionableIds(g);
          const allSelected =
            groupIds.length > 0 && groupIds.every((id) => selectedIds.includes(id));
          const someSelected =
            groupIds.some((id) => selectedIds.includes(id)) && !allSelected;
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={() => handleToggleSelectGroup(g)}
                aria-label={`Pilih invoice ${
                  g.invoice_number !== "-" ? g.invoice_number : g.supplier
                }`}
              />
            </div>
          );
        },
        size: 36,
        enableSorting: false,
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: () => <span>Tanggal</span>,
        cell: ({ row }) => {
          const g = row.original;
          return (
            <div className="whitespace-nowrap">
              <div className="font-semibold text-[var(--ledger-ink)] tabular-nums text-xs">
                {formatDateId(g.expense_date)}
              </div>
              <div className="text-[11px] text-[var(--ledger-muted)] font-mono-ledger">
                {g.items_count > 1
                  ? `${g.items_count} item`
                  : `#${g.items[0]?.id ?? "-"}`}
              </div>
            </div>
          );
        },
        size: 84,
      },
      {
        accessorKey: "due_date",
        id: "due_date",
        header: () => <span>Tempo</span>,
        cell: ({ row }) => {
          const g = row.original;
          const dueInfo = getDueUrgencyInfo(g.due_date);
          return g.is_paid ? (
            <span className="text-xs font-medium text-[var(--ledger-muted)] whitespace-nowrap tabular-nums">
              {g.due_date && g.due_date !== "-" ? formatDateId(g.due_date) : "Selesai"}
            </span>
          ) : (
            <div className="space-y-1 whitespace-nowrap">
              <div className="font-bold text-[var(--ledger-ink)] text-xs tabular-nums">
                {formatDateId(g.due_date)}
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${dueInfo.badgeClass}`}
              >
                {dueInfo.label}
              </Badge>
            </div>
          );
        },
        size: 146,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: () => <span>Toko &amp; Nota</span>,
        cell: ({ row }) => {
          const g = row.original;
          const tgLink = parseTelegramLink(g.msg_link);
          return (
            <div>
              <div className="font-semibold text-[var(--ledger-ink)] flex items-center gap-1.5 text-xs">
                <Building2 className="w-3.5 h-3.5 text-[var(--ledger-muted)] shrink-0" />
                <span className="truncate max-w-[122px] xl:max-w-[165px]" title={g.supplier}>
                  {g.supplier || "Tanpa Supplier"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-[var(--ledger-muted)]">
                {g.invoice_number && g.invoice_number !== "-" && (
                  <span className="font-mono-ledger">#{g.invoice_number}</span>
                )}
                {g.items_count > 1 && (
                  <span className="font-medium text-[var(--ledger-ink)]">
                    {g.items_count} item
                  </span>
                )}
                {tgLink?.isUrl && tgLink.url && (
                  <a
                    href={tgLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300 hover:underline rounded-sm"
                    title="Buka pesan nota di Telegram"
                  >
                    <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                    <span>Nota</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-80" />
                  </a>
                )}
              </div>
            </div>
          );
        },
        size: 148,
      },
      {
        id: "item_summary",
        header: () => <span>Barang &amp; Kategori</span>,
        cell: ({ row }) => {
          const g = row.original;
          const summary = getInvoiceItemSummaryText(g);
          const catColor = getCategoryColor(g.primary_category);
          const extraCats = Math.max(0, (g.categories?.length || 1) - 1);
          return (
            <div>
              <button
                type="button"
                onClick={row.getToggleExpandedHandler()}
                className="font-medium text-xs text-[var(--ledger-ink)] max-w-[138px] xl:max-w-[190px] truncate text-left hover:underline block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                title={summary.title}
              >
                {summary.title}
                {summary.extraCount > 0 ? ` +${summary.extraCount} lainnya` : ""}
              </button>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                >
                  {g.primary_category || "Umum"}
                </Badge>
                {extraCats > 0 && (
                  <span className="text-[10px] font-semibold text-[var(--ledger-muted)]">
                    +{extraCats} kategori
                  </span>
                )}
              </div>
            </div>
          );
        },
        size: 150,
      },
      {
        accessorKey: "total_amount",
        id: "total_amount",
        header: () => <div className="text-right w-full">Tagihan &amp; DP</div>,
        cell: ({ row }) => {
          const g = row.original;
          const totalPaymentsCount = g.items.reduce(
            (sum, it) => sum + (it.payments_count || 0),
            0
          );
          return (
            <div className="text-right whitespace-nowrap">
              {g.is_paid ? (
                <div>
                  <div className="font-bold text-[var(--ledger-ink)] tabular-nums text-xs sm:text-sm">
                    {formatRupiah(g.total_amount)}
                  </div>
                  {totalPaymentsCount > 0 && (
                    <div className="text-[11px] text-[var(--signal-cleared)]">
                      {totalPaymentsCount}x pembayaran
                    </div>
                  )}
                </div>
              ) : g.is_dp || g.paid_amount > 0 ? (
                <div className="space-y-1">
                  <div className="font-bold text-[var(--signal-unpaid)] tabular-nums text-xs sm:text-sm">
                    Sisa {formatRupiah(g.remaining_amount)}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-600"
                      style={{ width: `${Math.min(100, g.payment_progress_pct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--ledger-muted)] tabular-nums">
                    DP {formatRupiah(g.paid_amount)} / {formatRupiah(g.total_amount)}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-bold text-[var(--ledger-ink)] tabular-nums text-xs sm:text-sm">
                    {formatRupiah(g.total_amount)}
                  </div>
                  {g.items_count > 1 && (
                    <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                      {g.items_count} item gabungan
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        },
        size: 164,
      },
      {
        accessorKey: "pay_status",
        id: "pay_status",
        header: () => <div className="text-center w-full">Status</div>,
        cell: ({ row }) => (
          <div className="text-center whitespace-nowrap">
            {renderInvoiceStatusBadge(row.original, true)}
          </div>
        ),
        size: 114,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const g = row.original;
          const single = g.items_count === 1 ? g.items[0] : null;
          const hasAnyPayments = g.items.some((it) => (it.payments_count || 0) > 0);
          return (
            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
              {!g.is_paid ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openGroupPaymentModal(g, g.is_dp ? "full" : "percent")}
                    className="h-7 px-2 text-[11px] font-semibold rounded-md bg-amber-700 hover:bg-amber-800 text-white ledger-press"
                    title={
                      g.is_dp
                        ? "Catat cicilan atau pelunasan sisa DP invoice"
                        : "Catat pembayaran DP atau cicilan invoice"
                    }
                  >
                    <Wallet className="w-3 h-3 mr-1" />
                    {g.is_dp ? "Bayar" : "DP"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleToggleGroupPaid(g)}
                    disabled={settleMutation.isPending}
                    className="h-7 px-2 text-[11px] font-semibold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white ledger-press"
                    title="Langsung lunasi seluruh item dalam invoice ini"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Lunas
                  </Button>
                </>
              ) : (
                <>
                  {hasAnyPayments && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openGroupPaymentModal(g, "full")}
                      className="h-7 px-2 text-[11px] font-semibold rounded-md"
                      title="Lihat riwayat DP dan pelunasan"
                    >
                      <History className="w-3 h-3 mr-1" />
                      Riwayat
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleToggleGroupPaid(g)}
                    disabled={settleMutation.isPending}
                    className="h-7 px-2 text-[11px] font-semibold rounded-md"
                    title="Batalkan status Lunas"
                  >
                    Batal
                  </Button>
                </>
              )}

              {single ? (
                <>
                  {onViewExpense && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onViewExpense(single)}
                      className="h-7 w-7 p-0 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] rounded-md"
                      aria-label={`Lihat detail ${single.item_name}`}
                      title="Lihat Detail"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onEditExpense(single)}
                    className="h-7 w-7 p-0 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] rounded-md"
                    aria-label={`Edit ${single.item_name}`}
                    title="Edit Transaksi"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  {canDelete && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(single.id)}
                      disabled={deletingId === single.id}
                      className="h-7 w-7 p-0 text-[var(--signal-unpaid)] hover:bg-[var(--signal-unpaid-soft)] rounded-md"
                      aria-label={`Hapus ${single.item_name}`}
                      title="Hapus Transaksi"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={row.getToggleExpandedHandler()}
                  aria-expanded={row.getIsExpanded()}
                  className="h-7 px-2 text-[11px] font-semibold rounded-md"
                  title="Buka atau tutup rincian item"
                >
                  {row.getIsExpanded() ? "Tutup" : `Items (${g.items_count})`}
                </Button>
              )}
            </div>
          );
        },
        size: 258,
      },
    ],
    [
      allVisibleSelectableIds,
      selectedIds,
      settleMutation.isPending,
      onViewExpense,
      onEditExpense,
      canDelete,
      deletingId,
      statusTab,
    ]
  );

  const unpaidColumns = useMemo<ColumnDef<DataGridFeatures, Expense>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <div className="flex justify-center">
            <Checkbox
              checked={
                expenses.length > 0 && expenses.every((e) => selectedIds.includes(e.id))
              }
              onCheckedChange={handleSelectAll}
              aria-label="Pilih semua baris"
            />
          </div>
        ),
        cell: ({ row }) => {
          const expense = row.original;
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={selectedIds.includes(expense.id)}
                onCheckedChange={() => handleToggleSelect(expense.id)}
                aria-label={`Pilih transaksi #${expense.id}`}
              />
            </div>
          );
        },
        size: 36,
        enableSorting: false,
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => {
          const expense = row.original;
          return (
            <div className="whitespace-nowrap">
              <div className="font-semibold text-[var(--ledger-ink)] tabular-nums text-xs">
                {formatDateId(expense.expense_date)}
              </div>
              <div className="text-[11px] text-[var(--ledger-muted)] font-mono-ledger">
                #{expense.id}
              </div>
            </div>
          );
        },
        size: 88,
      },
      {
        accessorKey: "due_date",
        id: "due_date",
        header: ({ column }) => (
          <DataGridColumnHeader title="Tempo" column={column} />
        ),
        cell: ({ row }) => {
          const expense = row.original;
          const bd = getExpensePaymentBreakdown(expense);
          const dueInfo = getDueUrgencyInfo(expense.due_date);
          return bd.isPaid ? (
            <span className="text-xs font-medium text-[var(--ledger-muted)] whitespace-nowrap tabular-nums">
              {expense.due_date && expense.due_date !== "-"
                ? formatDateId(expense.due_date)
                : "Selesai"}
            </span>
          ) : (
            <div className="space-y-1 whitespace-nowrap">
              <div className="font-bold text-[var(--ledger-ink)] text-xs tabular-nums">
                {formatDateId(expense.due_date)}
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${dueInfo.badgeClass}`}
              >
                {dueInfo.label}
              </Badge>
            </div>
          );
        },
        size: 146,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => (
          <DataGridColumnHeader title="Toko &amp; Nota" column={column} />
        ),
        cell: ({ row }) => {
          const expense = row.original;
          const tgLink = parseTelegramLink(expense.msg_link);
          return (
            <div>
              <div className="font-semibold text-[var(--ledger-ink)] flex items-center gap-1.5 text-xs">
                <Building2 className="w-3.5 h-3.5 text-[var(--ledger-muted)] shrink-0" />
                <span
                  className="truncate max-w-[128px] xl:max-w-[175px]"
                  title={expense.supplier}
                >
                  {expense.supplier || "Tanpa Supplier"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-[var(--ledger-muted)]">
                {expense.invoice_number && expense.invoice_number !== "-" && (
                  <span className="font-mono-ledger">#{expense.invoice_number}</span>
                )}
                {tgLink?.isUrl && tgLink.url && (
                  <a
                    href={tgLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300 hover:underline rounded-sm"
                    title="Buka pesan nota di Telegram"
                  >
                    <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                    <span>Nota</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-80" />
                  </a>
                )}
              </div>
            </div>
          );
        },
        size: 160,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Barang & Kategori" column={column} />
        ),
        cell: ({ row }) => {
          const expense = row.original;
          const catColor = getCategoryColor(expense.category);
          return (
            <div>
              <div
                className="font-medium text-xs text-[var(--ledger-ink)] max-w-[155px] xl:max-w-[190px] truncate"
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
                <span className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                  {expense.qty} {expense.unit || "pcs"}
                </span>
              </div>
              {expense.notes && expense.notes !== "-" && (
                <div className="text-[11px] text-[var(--ledger-muted)] italic mt-0.5 truncate max-w-[155px]">
                  {expense.notes}
                </div>
              )}
            </div>
          );
        },
        size: 170,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Tagihan & DP"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const expense = row.original;
          const bd = getExpensePaymentBreakdown(expense);
          return (
            <div className="text-right whitespace-nowrap">
              {bd.isPaid ? (
                <div>
                  <div className="font-bold text-[var(--ledger-ink)] tabular-nums text-xs sm:text-sm">
                    {formatRupiah(bd.total)}
                  </div>
                  {(expense.payments_count || 0) > 0 && (
                    <div className="text-[11px] text-[var(--signal-cleared)]">
                      {expense.payments_count}x pembayaran
                    </div>
                  )}
                </div>
              ) : bd.isDp || bd.paid > 0 ? (
                <div className="space-y-1">
                  <div className="font-bold text-[var(--signal-unpaid)] tabular-nums text-xs sm:text-sm">
                    Sisa {formatRupiah(bd.remaining)}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-600"
                      style={{ width: `${Math.min(100, bd.progressPct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--ledger-muted)] tabular-nums">
                    DP {formatRupiah(bd.paid)} / {formatRupiah(bd.total)}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-bold text-[var(--ledger-ink)] tabular-nums text-xs sm:text-sm">
                    {formatRupiah(bd.total)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    @{formatRupiah(expense.unit_price)}
                  </div>
                </div>
              )}
            </div>
          );
        },
        size: 164,
      },
      {
        accessorKey: "pay_status",
        id: "pay_status",
        header: () => <div className="text-center w-full">Status</div>,
        cell: ({ row }) => (
          <div className="text-center whitespace-nowrap">
            {renderExpenseStatusBadge(getExpensePaymentBreakdown(row.original), true)}
          </div>
        ),
        size: 114,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const expense = row.original;
          const bd = getExpensePaymentBreakdown(expense);
          return (
            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
              {!bd.isPaid ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openPaymentModal(expense, bd.isDp ? "full" : "percent")}
                    className="h-7 px-2 text-[11px] font-semibold rounded-md bg-amber-700 hover:bg-amber-800 text-white ledger-press"
                  >
                    <Wallet className="w-3 h-3 mr-1" />
                    {bd.isDp ? "Bayar" : "DP"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleTogglePaid(expense)}
                    disabled={settleMutation.isPending}
                    className="h-7 px-2 text-[11px] font-semibold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white ledger-press"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Lunas
                  </Button>
                </>
              ) : (
                <>
                  {(expense.payments_count || 0) > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openPaymentModal(expense, "full")}
                      className="h-7 px-2 text-[11px] font-semibold rounded-md"
                    >
                      <History className="w-3 h-3 mr-1" />
                      Riwayat
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleTogglePaid(expense)}
                    disabled={settleMutation.isPending}
                    className="h-7 px-2 text-[11px] font-semibold rounded-md"
                  >
                    Batal
                  </Button>
                </>
              )}
              {onViewExpense && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onViewExpense(expense)}
                  className="h-7 w-7 p-0 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] rounded-md"
                  aria-label={`Lihat detail ${expense.item_name}`}
                  title="Lihat Detail"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onEditExpense(expense)}
                className="h-7 w-7 p-0 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] rounded-md"
                aria-label={`Edit ${expense.item_name}`}
                title="Edit Transaksi"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
              {canDelete && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(expense.id)}
                  disabled={deletingId === expense.id}
                  className="h-7 w-7 p-0 text-[var(--signal-unpaid)] hover:bg-[var(--signal-unpaid-soft)] rounded-md"
                  aria-label={`Hapus ${expense.item_name}`}
                  title="Hapus Transaksi"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          );
        },
        size: 258,
      },
    ],
    [
      expenses,
      selectedIds,
      settleMutation.isPending,
      onViewExpense,
      onEditExpense,
      canDelete,
      deletingId,
    ]
  );

  const unpaidPagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: perPage,
    }),
    [page, perPage]
  );

  const unpaidTable = useTable({
    features: dataGridFeatures,
    columns: unpaidColumns,
    data: expenses,
    manualPagination: true,
    rowCount: totalItems,
    getRowId: (row: Expense) => String(row.id),
    state: { pagination: unpaidPagination },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(unpaidPagination) : updater;
      if (next.pageSize !== perPage) {
        setPerPage(next.pageSize);
        setPage(1);
      } else {
        setPage(next.pageIndex + 1);
      }
    },
  });

  const groupedUnpaidTable = useTable({
    features: dataGridFeatures,
    columns: groupedUnpaidColumns,
    data: invoiceGroups,
    manualPagination: true,
    autoResetExpanded: false,
    rowCount: totalItems,
    getRowId: (row: ExpenseInvoiceGroup) => row.group_key,
    getRowCanExpand: (row) => row.original.items.length > 0,
    state: {
      pagination: unpaidPagination,
      expanded,
    },
    onExpandedChange: setExpanded,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(unpaidPagination) : updater;
      if (next.pageSize !== perPage) {
        setPerPage(next.pageSize);
        setPage(1);
      } else {
        setPage(next.pageIndex + 1);
      }
    },
  });

  const overdueShare = Math.min(activeOverdueTotal, activeUnpaidTotal);
  const currentUnpaidShare = Math.max(0, activeUnpaidTotal - overdueShare);

  const ledgerEmptyDescription = search.trim()
    ? `Tidak ada transaksi yang cocok dengan kata kunci "${search}".`
    : statusTab === "dp"
    ? "Belum ada invoice dengan skema DP atau cicilan sebagian pada filter ini."
    : statusTab === "unpaid"
    ? "Semua tagihan operasional dan tempo toko telah lunas."
    : statusTab === "overdue"
    ? "Tidak ada tagihan yang melewati batas jatuh tempo."
    : "Belum ada catatan tagihan pada filter periode ini.";

  return (
    <div className="space-y-3.5 pb-6">
      {/* 1. Editorial Action Header (Flat on Canvas) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
            Buku Tagihan &amp; Tempo Supplier
          </h2>
          <p className="text-xs text-[var(--ledger-muted)] tabular-nums">
            {activeUnpaidCount > 0
              ? `${activeUnpaidCount} tagihan aktif di ${activeSuppliersCount} toko${
                  dpCount > 0 ? `, ${dpCount} berstatus DP` : ""
                }`
              : "Tidak ada tagihan aktif yang menunggu pelunasan"}
          </p>
        </div>

        {(onAddNewDp || onAddNewUnpaid) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onAddNewDp && (
              <Button
                type="button"
                onClick={onAddNewDp}
                size="sm"
                className="min-h-[40px] sm:min-h-[36px] bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold px-3.5 gap-1.5 ledger-press"
              >
                <Percent className="w-3.5 h-3.5" />
                <span>Invoice DP</span>
              </Button>
            )}
            {onAddNewUnpaid && (
              <Button
                type="button"
                onClick={onAddNewUnpaid}
                size="sm"
                className="min-h-[40px] sm:min-h-[36px] bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-semibold px-3.5 gap-1.5 ledger-press"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tagihan Baru</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Summary Error Strip (Non-Card Alert) */}
      {isSummaryError && (
        <div
          role="alert"
          className="border-l-2 border-[var(--signal-unpaid)] signal-surface-unpaid px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs text-[var(--ledger-ink)]"
        >
          <span>Gagal memuat ringkasan tagihan belum lunas dan DP dari server.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refetchSummary()}
            className="min-h-[36px]"
          >
            Muat Ulang Ringkasan
          </Button>
        </div>
      )}

      {/* 2. Unified Hairline KPI Strip (Zero Nested Cards) */}
      <LedgerMetricStrip
        isLoading={isSummaryLoading}
        primary={{
          label: "Total Sisa Tagihan",
          value: formatRupiah(activeUnpaidTotal),
          valueClassName: "text-[var(--signal-unpaid)]",
          subtext: `${activeUnpaidCount} tagihan aktif di ${activeSuppliersCount} toko`,
          active: statusTab === "unpaid",
          accentTone: "unpaid",
          onClick: () => {
            setStatusTab("unpaid");
            setPage(1);
          },
          segments: [
            {
              key: "overdue",
              label: "Lewat Tempo",
              value: overdueShare,
              displayValue: formatRupiah(overdueShare),
              colorClass: "bg-rose-700 dark:bg-rose-500",
            },
            {
              key: "current",
              label: "Belum Tempo",
              value: currentUnpaidShare,
              displayValue: formatRupiah(currentUnpaidShare),
              colorClass: "bg-amber-600 dark:bg-amber-400",
            },
          ],
        }}
        supporting={[
          {
            key: "dp",
            label: "Tagihan DP Berjalan",
            value: formatRupiah(dpRemainingNominal),
            valueClassName: "text-[var(--signal-dp)]",
            subtext: `${dpCount} invoice (sudah DP ${formatRupiah(dpPaidNominal)})`,
            active: statusTab === "dp",
            accentTone: "dp",
            onClick: () => {
              setStatusTab("dp");
              setPage(1);
            },
          },
          {
            key: "nearest-due",
            label: "Tempo Paling Dekat",
            value: nearestDue
              ? formatDateId(nearestDue.parsed_due_date || nearestDue.due_date)
              : "Tidak Ada",
            valueClassName: nearestDue
              ? "text-[var(--ledger-ink)]"
              : "text-[var(--signal-cleared)]",
            badge: nearestDue
              ? {
                  text:
                    nearestDue.is_overdue || nearestDue.urgency === "overdue"
                      ? `Lewat ${Math.abs(nearestDue.days_left ?? 0)}h`
                      : nearestDue.is_today || nearestDue.urgency === "today"
                      ? "Hari Ini"
                      : `${nearestDue.days_left ?? 0}h lagi`,
                  className:
                    nearestDue.is_overdue || nearestDue.urgency === "overdue"
                      ? "bg-[var(--signal-unpaid-soft)] text-[var(--signal-unpaid)]"
                      : "bg-[var(--signal-dp-soft)] text-[var(--signal-dp)]",
                }
              : undefined,
            subtext: nearestDue ? (
              <span className="block truncate">
                <strong className="font-semibold text-[var(--ledger-ink)]">
                  {nearestDue.supplier}
                </strong>{" "}
                ({formatRupiah(nearestDue.remaining_amount ?? nearestDue.total_price)})
              </span>
            ) : (
              "Tidak ada tempo pelunasan aktif"
            ),
            active: statusTab === "soon",
            accentTone: "dp",
            onClick: nearestDue
              ? () => {
                  const isOver =
                    nearestDue.is_overdue || nearestDue.urgency === "overdue";
                  setStatusTab(isOver ? "overdue" : "soon");
                  setPage(1);
                }
              : undefined,
          },
          {
            key: "overdue",
            label: "Lewat Jatuh Tempo",
            value: formatRupiah(activeOverdueTotal),
            valueClassName: "text-[var(--signal-unpaid)]",
            subtext: `${summaryData?.overdue_count || 0} tagihan melewati tempo`,
            active: statusTab === "overdue",
            accentTone: "unpaid",
            onClick: () => {
              setStatusTab("overdue");
              setPage(1);
            },
          },
        ]}
      />

      {/* 3. Flat Supplier Liability Directory (Zero Nested Cards) */}
      {summaryData && summaryData.by_supplier && summaryData.by_supplier.length > 0 && (
        <section aria-label="Rekap sisa tagihan per toko" className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="text-sm font-bold text-[var(--ledger-ink)] truncate">
                Rekap Sisa Tagihan per Toko
              </h3>
              <span className="text-xs text-[var(--ledger-muted)] tabular-nums shrink-0">
                {summaryData.by_supplier.length} toko
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsSuppliersExpanded((prev) => !prev)}
              aria-expanded={isSuppliersExpanded}
              className="min-h-[38px] text-xs font-medium text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] gap-1 px-2.5"
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
            <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden divide-y divide-[color:var(--ledger-hairline)]">
              {summaryData.by_supplier.map((supplierGroup) => {
                const isSelected =
                  supplierGroup.supplier_id !== null &&
                  selectedSupplierId === supplierGroup.supplier_id;
                const hasUnpaid = supplierGroup.unpaid_count > 0;
                const supDpCount = supplierGroup.dp_count ?? 0;

                return (
                  <div
                    key={supplierGroup.supplier_id ?? supplierGroup.supplier_name}
                      className={cn(
                        "px-3.5 py-2 grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center transition-colors",
                        isSelected
                          ? "signal-surface-unpaid"
                          : "ledger-hover-recessed"
                      )}
                    >
                      {/* Supplier Identity */}
                      <div className="lg:col-span-5 flex items-center gap-2.5 min-w-0">
                        <div
                          aria-hidden="true"
                          className="w-8 h-8 rounded-lg bg-[var(--ledger-recessed)] text-[var(--signal-unpaid)] text-xs font-bold flex items-center justify-center shrink-0"
                        >
                        {getInitials(supplierGroup.supplier_name)}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[var(--ledger-ink)] truncate">
                            {supplierGroup.supplier_name}
                          </span>
                          {supplierGroup.has_overdue && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--signal-unpaid-soft)] text-[var(--signal-unpaid)] shrink-0">
                              Lewat Tempo
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--ledger-muted)] tabular-nums truncate">
                          {supplierGroup.nearest_due_date ? (
                            <>
                              Tempo terdekat {formatDateId(supplierGroup.nearest_due_date)}
                              {supplierGroup.nearest_days_left !== null && (
                                <span className="ml-1">
                                  (
                                  {supplierGroup.nearest_days_left < 0
                                    ? `lewat ${Math.abs(supplierGroup.nearest_days_left)} hari`
                                    : supplierGroup.nearest_days_left === 0
                                    ? "hari ini"
                                    : `${supplierGroup.nearest_days_left} hari lagi`}
                                  )
                                </span>
                              )}
                            </>
                          ) : (
                            "Belum ada tanggal tempo"
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Invoice & DP Count */}
                    <div className="lg:col-span-2 flex items-center justify-between lg:block text-xs tabular-nums">
                      <span className="lg:hidden text-[var(--ledger-muted)]">
                        Tagihan Aktif
                      </span>
                      <div>
                        <span className="font-semibold text-[var(--ledger-ink)]">
                          {supplierGroup.unpaid_count} nota
                        </span>
                        {supDpCount > 0 && (
                          <span className="text-[11px] text-[var(--signal-dp)] ml-1.5 font-medium">
                            ({supDpCount} DP)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Remaining Amount */}
                    <div className="lg:col-span-2 flex items-center justify-between lg:block lg:text-right tabular-nums">
                      <span className="lg:hidden text-xs text-[var(--ledger-muted)]">
                        Sisa Kewajiban
                      </span>
                      <span
                        className={cn(
                          "text-sm font-bold",
                          hasUnpaid
                            ? "text-[var(--signal-unpaid)]"
                            : "text-[var(--ledger-muted)]"
                        )}
                      >
                        {formatRupiah(supplierGroup.unpaid_total)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="lg:col-span-3 flex flex-wrap items-center justify-end gap-2">
                      {supplierGroup.supplier_id !== null && (
                        <Button
                          type="button"
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelectedSupplierId(
                              isSelected ? null : supplierGroup.supplier_id
                            );
                            setPage(1);
                          }}
                          className={cn(
                            "min-h-[44px] sm:min-h-[34px] px-3 text-xs font-semibold rounded-lg ledger-press",
                            isSelected && "bg-rose-700 hover:bg-rose-800 text-white"
                          )}
                        >
                          {isSelected ? "Filter Aktif" : "Filter"}
                        </Button>
                      )}
                      {hasUnpaid && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSupplierSettleBankId(settleBankAccountId);
                            setConfirmSupplierGroup(supplierGroup);
                          }}
                          disabled={settleMutation.isPending}
                          className="min-h-[44px] sm:min-h-[34px] px-3 text-xs font-semibold rounded-lg border-rose-300 text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/40 gap-1.5 ledger-press"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>Lunasi Semua</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 4. Status Tabs + Unified Ledger Table Container (Single Surface) */}
      <section aria-label="Daftar tagihan belum lunas" className="space-y-2">
        <LedgerStatusTabs
          tabs={statusTabsList}
          value={statusTab}
          onChange={(next) => {
            setStatusTab(next);
            setPage(1);
            setSelectedIds([]);
          }}
          layoutId="unpaid-status-underline"
          accentClassName="bg-[var(--signal-unpaid)]"
          ariaLabel="Filter status tagihan"
        />

        <DataTable
          table={(isGroupedMode ? groupedUnpaidTable : unpaidTable) as any}
          recordCount={totalItems}
          isLoading={isExpensesLoading}
          searchQuery={search}
          tableLayout={{ dense: true, columnsResizable: true }}
          containerClassName="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] shadow-none overflow-hidden"
          headerClassName="border-b border-[color:var(--ledger-hairline)] p-3 sm:px-3.5 sm:py-2.5 space-y-2"
          footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
          tableWrapperClassName="hidden md:block"
          header={
            <div className="space-y-2">
              {/* Row A: Ledger Title & View Mode Switch */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-[var(--ledger-ink)]">
                    Daftar Tagihan
                  </h3>
                  <span className="text-xs font-mono-ledger tabular-nums text-[var(--ledger-muted)]">
                    {isGroupedMode
                      ? `${totalItems} invoice (${totalGroupChildItems} item)`
                      : `${totalItems} item`}
                  </span>
                </div>
                <InvoiceViewModeToggle
                  mode={viewMode}
                  onChange={(m) => {
                    setViewMode(m);
                    setPage(1);
                    setSelectedIds([]);
                  }}
                />
              </div>

              {/* Row B: Integrated Search & Adaptive Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-2 items-center">
                <div className="xl:col-span-3 min-w-0">
                  <InputGroup className="h-9 bg-[var(--ledger-surface)]">
                    <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                      <Search className="size-3.5 text-[var(--ledger-muted)]" />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Cari barang, toko, no nota, atau catatan..."
                      aria-label="Cari tagihan"
                      className="h-9 text-xs"
                    />
                    {search.length > 0 && (
                      <InputGroupAddon align="inline-end" className="pr-1.5">
                        <InputGroupButton
                          size="icon-xs"
                          aria-label="Bersihkan kata kunci"
                          onClick={() => {
                            setSearch("");
                            setPage(1);
                          }}
                        >
                          <X className="size-3" />
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  <SearchMinCharHint query={search} />
                </div>

                <div className="xl:col-span-3">
                  <AdaptiveSelect
                    value={selectedSupplierId !== null ? String(selectedSupplierId) : ""}
                    onValueChange={(val) => {
                      setSelectedSupplierId(val ? Number(val) : null);
                      setPage(1);
                    }}
                    options={supplierOptions}
                    placeholder="Semua Toko / Supplier"
                    searchPlaceholder="Cari nama toko..."
                    aria-label="Filter toko atau supplier"
                  />
                </div>

                <div className="xl:col-span-3 flex flex-wrap items-center gap-1.5">
                  <div className="flex-1 min-w-[135px]">
                    <AdaptiveSelect
                      value={periodMode}
                      onValueChange={(val) => {
                        setPeriodMode(val as PeriodMode);
                        setPage(1);
                        setSelectedIds([]);
                      }}
                      options={[
                        { value: "all", label: "Semua Waktu" },
                        { value: "month", label: "Bulan Tertentu" },
                        { value: "custom", label: "Rentang Tanggal" },
                      ]}
                      aria-label="Periode tagihan"
                    />
                  </div>

                  {periodMode === "month" && (
                    <>
                      <div className="w-[120px]">
                        <AdaptiveSelect
                          value={String(selectedMonth)}
                          onValueChange={(val) => {
                            const m = Number(val);
                            setSelectedMonth(m);
                            setSelectedMonthEnd(m);
                            setPage(1);
                          }}
                          options={monthOptions}
                          searchPlaceholder="Cari bulan..."
                          aria-label="Pilih bulan"
                        />
                      </div>
                      <div className="w-[88px]">
                        <AdaptiveSelect
                          value={String(selectedYear)}
                          onValueChange={(val) => {
                            setSelectedYear(Number(val));
                            setPage(1);
                          }}
                          options={yearOptions}
                          aria-label="Pilih tahun"
                        />
                      </div>
                    </>
                  )}

                  {periodMode === "custom" && (
                    <DateRangePicker
                      initialDateFrom={customStart}
                      initialDateTo={customEnd}
                      onUpdate={({ range }) => {
                        if (range.from) setCustomStart(toIsoDate(range.from));
                        if (range.to) setCustomEnd(toIsoDate(range.to));
                        else if (range.from) setCustomEnd(toIsoDate(range.from));
                        setPage(1);
                        setSelectedIds([]);
                      }}
                    />
                  )}
                </div>

                <div className="xl:col-span-3 flex items-center gap-1.5 min-w-0">
                  <div className="flex-1 min-w-0">
                    <AdaptiveSelect
                      value={sortBy}
                      onValueChange={(val) => {
                        setSortBy(val);
                        setPage(1);
                      }}
                      options={[
                        { value: "due_date", label: "Urut: Jatuh Tempo" },
                        { value: "expense_date", label: "Urut: Tgl Nota" },
                        { value: "total_price", label: "Urut: Nominal" },
                        { value: "supplier", label: "Urut: Nama Toko" },
                      ]}
                      aria-label="Urutkan daftar"
                    />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
                    }
                    className="h-9 w-9 p-0 shrink-0 rounded-md"
                    aria-label={`Ubah arah urutan (saat ini ${
                      sortOrder === "asc" ? "menaik" : "menurun"
                    })`}
                    title={`Urutan: ${sortOrder === "asc" ? "Menaik" : "Menurun"}`}
                  >
                    {sortOrder === "asc" ? (
                      <ArrowUpNarrowWide className="w-4 h-4" />
                    ) : (
                      <ArrowDownWideNarrow className="w-4 h-4" />
                    )}
                  </Button>

                  {hasActiveFilters && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleResetFilters}
                      className="h-9 w-9 p-0 shrink-0 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      aria-label="Reset semua filter"
                      title="Reset Filter"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {isCustomRangeInvalid && (
                <p
                  role="alert"
                  className="text-xs font-medium text-[var(--signal-unpaid)]"
                >
                  Tanggal awal tidak boleh setelah tanggal akhir.
                </p>
              )}
            </div>
          }
          emptyState={
            isExpensesError ? (
              <LedgerStateBlock
                variant="error"
                title="Gagal Memuat Daftar Tagihan"
                description="Terjadi gangguan saat mengambil data tagihan dari server. Periksa koneksi lalu coba muat ulang."
                actions={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => refetchExpenses()}
                    className="min-h-[40px] sm:min-h-[36px] gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Muat Ulang</span>
                  </Button>
                }
              />
            ) : (
              <LedgerStateBlock
                variant="empty"
                icon={<Receipt className="w-7 h-7" />}
                title="Tidak Ada Data Tagihan"
                description={ledgerEmptyDescription}
                actions={
                  <>
                    {hasActiveFilters && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleResetFilters}
                        className="min-h-[40px] sm:min-h-[36px] gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset Filter</span>
                      </Button>
                    )}
                    {onAddNewDp && !search.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={onAddNewDp}
                        className="min-h-[40px] sm:min-h-[36px] bg-amber-700 hover:bg-amber-800 text-white gap-1.5"
                      >
                        <Percent className="w-3.5 h-3.5" />
                        <span>Catat Invoice DP</span>
                      </Button>
                    )}
                    {onAddNewUnpaid && !search.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onAddNewUnpaid}
                        className="min-h-[40px] sm:min-h-[36px] gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Catat Tagihan Baru</span>
                      </Button>
                    )}
                  </>
                }
              />
            )
          }
        >
          {/* Mobile Flat Hairline Rows (< md, Zero Nested Cards) */}
          <div className="md:hidden divide-y divide-[color:var(--ledger-hairline)]">
            {isGroupedMode
              ? invoiceGroups.map((g) => {
                  const groupIds = getGroupActionableIds(g);
                  const isSelected =
                    groupIds.length > 0 &&
                    groupIds.every((id) => selectedIds.includes(id));
                  const dueInfo = getDueUrgencyInfo(g.due_date);
                  const catColor = getCategoryColor(g.primary_category);
                  const tgLink = parseTelegramLink(g.msg_link);
                  const summary = getInvoiceItemSummaryText(g);
                  const isExpanded = Boolean(mobileExpandedKeys[g.group_key]);

                  return (
                    <div
                      key={g.group_key}
                      className={cn(
                        "p-3 space-y-2 transition-colors",
                        isSelected
                          ? "signal-surface-unpaid"
                          : dueInfo.urgency === "overdue" && !g.is_paid
                          ? "signal-surface-unpaid-subtle"
                          : ""
                      )}
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2 min-w-0">
                          <div className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center shrink-0">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleToggleSelectGroup(g)}
                              aria-label={`Pilih invoice ${g.supplier}`}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-[var(--ledger-ink)] leading-snug">
                              {summary.title}
                              {summary.extraCount > 0 && (
                                <span className="text-[var(--signal-unpaid)] ml-1 text-xs font-semibold">
                                  +{summary.extraCount} lainnya
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--ledger-muted)] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-medium text-[var(--ledger-ink)]">
                                {g.supplier || "Tanpa Supplier"}
                              </span>
                              <span className="tabular-nums">
                                {formatDateId(g.expense_date)}
                              </span>
                              {g.invoice_number && g.invoice_number !== "-" && (
                                <span className="font-mono-ledger text-[10px]">
                                  #{g.invoice_number}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {renderInvoiceStatusBadge(g, true)}
                      </div>

                      {/* Flat Nominal & DP Strip (No Box Wrapper) */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-[var(--ledger-muted)]">
                            {g.is_paid ? "Total Invoice" : "Sisa Pelunasan"}
                          </span>
                          <span
                            className={cn(
                              "text-base font-bold tabular-nums",
                              g.is_paid
                                ? "text-[var(--signal-cleared)]"
                                : "text-[var(--signal-unpaid)]"
                            )}
                          >
                            {formatRupiah(
                              g.is_paid ? g.total_amount : g.remaining_amount
                            )}
                          </span>
                        </div>

                        {(g.is_dp || g.paid_amount > 0) && !g.is_paid && (
                          <div className="space-y-1">
                            <div className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-600"
                                style={{
                                  width: `${Math.min(100, g.payment_progress_pct)}%`,
                                }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-[var(--ledger-muted)] tabular-nums">
                              <span>Terbayar: {formatRupiah(g.paid_amount)}</span>
                              <span>Total: {formatRupiah(g.total_amount)}</span>
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                            >
                              {g.primary_category || "Umum"}
                            </Badge>
                            <span className="text-[var(--ledger-muted)]">
                              {g.items_count} item
                            </span>
                          </div>
                          {!g.is_paid && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-2 py-0.5 ${dueInfo.badgeClass}`}
                            >
                              {g.due_date && g.due_date !== "-"
                                ? `${formatDateId(g.due_date)} (${dueInfo.label})`
                                : dueInfo.label}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Mobile Actions (>= 44px tap targets) */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {!g.is_paid ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                openGroupPaymentModal(g, g.is_dp ? "full" : "percent")
                              }
                              className="flex-1 min-h-[44px] text-xs font-semibold rounded-lg bg-amber-700 hover:bg-amber-800 text-white ledger-press"
                            >
                              <Wallet className="w-3.5 h-3.5 mr-1.5" />
                              <span>{g.is_dp ? "Bayar / Lunasi" : "Bayar DP"}</span>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleToggleGroupPaid(g)}
                              disabled={settleMutation.isPending}
                              className="min-h-[44px] px-3.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white ledger-press"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              <span>Lunasi</span>
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleGroupPaid(g)}
                            disabled={settleMutation.isPending}
                            className="flex-1 min-h-[44px] px-3.5 text-xs font-semibold rounded-lg"
                          >
                            Batal Lunas
                          </Button>
                        )}

                        {tgLink?.isUrl && tgLink.url && (
                          <a
                            href={tgLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--ledger-hairline)] text-blue-700 dark:text-blue-300"
                            aria-label="Buka pesan nota di Telegram"
                            title="Buka pesan nota di Telegram"
                          >
                            <TelegramIcon className="w-4 h-4" />
                          </a>
                        )}

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleMobileExpand(g.group_key)}
                          aria-expanded={isExpanded}
                          className="min-h-[44px] px-3 text-xs font-semibold rounded-lg gap-1"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-4 h-4" />
                              <span>Tutup</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-4 h-4" />
                              <span>Items ({g.items_count})</span>
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Mobile Expanded Indented Ledger Sub-list (Zero Inner Cards) */}
                      {isExpanded && (
                        <div className="mt-1.5 pl-2.5 border-l-2 border-[color:var(--ledger-hairline)] divide-y divide-[color:var(--ledger-hairline)]">
                          {g.items.map((it) => {
                            const bd = getExpensePaymentBreakdown(it);
                            return (
                              <div key={it.id} className="py-2 space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-xs text-[var(--ledger-ink)]">
                                      {it.item_name}
                                    </div>
                                    <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums mt-0.5">
                                      {it.qty} {it.unit || "Pcs"} ×{" "}
                                      {formatRupiah(it.unit_price)} ({it.category})
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="font-bold text-xs text-[var(--ledger-ink)] tabular-nums">
                                      {formatRupiah(bd.isPaid ? bd.total : bd.remaining)}
                                    </div>
                                    <div className="text-[10px] text-[var(--ledger-muted)]">
                                      {bd.isPaid
                                        ? "Lunas"
                                        : bd.isDp
                                        ? `DP ${Math.round(bd.progressPct)}%`
                                        : "Belum Lunas"}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-end gap-1.5">
                                  {!bd.isPaid && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        openPaymentModal(
                                          it,
                                          bd.isDp ? "full" : "percent"
                                        )
                                      }
                                      className="min-h-[44px] px-3 rounded-lg text-xs font-semibold text-amber-900 border-amber-300 dark:text-amber-200 dark:border-amber-800"
                                    >
                                      {bd.isDp ? "Bayar Item" : "DP Item"}
                                    </Button>
                                  )}
                                  {onViewExpense && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="outline"
                                      onClick={() => onViewExpense(it)}
                                      className="min-h-[44px] min-w-[44px] rounded-lg"
                                      aria-label={`Detail ${it.item_name}`}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    onClick={() => onEditExpense(it)}
                                    className="min-h-[44px] min-w-[44px] rounded-lg"
                                    aria-label={`Edit ${it.item_name}`}
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </Button>
                                  {canDelete && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="outline"
                                      onClick={() => setConfirmDeleteId(it.id)}
                                      disabled={deletingId === it.id}
                                      className="min-h-[44px] min-w-[44px] rounded-lg text-[var(--signal-unpaid)]"
                                      aria-label={`Hapus ${it.item_name}`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          <div className="pt-2">
                            <InvoiceFeeFooter
                              group={g}
                              showPaymentSummary={!g.is_paid}
                              compact
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              : expenses.map((expense) => {
                  const isSelected = selectedIds.includes(expense.id);
                  const bd = getExpensePaymentBreakdown(expense);
                  const dueInfo = getDueUrgencyInfo(expense.due_date);
                  const catColor = getCategoryColor(expense.category);
                  const tgLink = parseTelegramLink(expense.msg_link);

                  return (
                    <div
                      key={expense.id}
                      className={cn(
                        "p-3 space-y-2 transition-colors",
                        isSelected
                          ? "signal-surface-unpaid"
                          : dueInfo.urgency === "overdue" && !bd.isPaid
                          ? "signal-surface-unpaid-subtle"
                          : ""
                      )}
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2 min-w-0">
                          <div className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center shrink-0">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleToggleSelect(expense.id)}
                              aria-label={`Pilih transaksi #${expense.id}`}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-[var(--ledger-ink)] leading-snug">
                              {expense.item_name}
                            </div>
                            <div className="text-xs text-[var(--ledger-muted)] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-medium text-[var(--ledger-ink)]">
                                {expense.supplier || "Tanpa Supplier"}
                              </span>
                              <span className="tabular-nums">
                                {formatDateId(expense.expense_date)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {renderExpenseStatusBadge(bd, true)}
                      </div>

                      <div className="space-y-2 pt-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-[var(--ledger-muted)]">
                            {bd.isPaid ? "Total Invoice" : "Sisa Pelunasan"}
                          </span>
                          <span
                            className={cn(
                              "text-base font-bold tabular-nums",
                              bd.isPaid
                                ? "text-[var(--signal-cleared)]"
                                : "text-[var(--signal-unpaid)]"
                            )}
                          >
                            {formatRupiah(bd.isPaid ? bd.total : bd.remaining)}
                          </span>
                        </div>

                        {(bd.isDp || bd.paid > 0) && !bd.isPaid && (
                          <div className="space-y-1">
                            <div className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-600"
                                style={{ width: `${Math.min(100, bd.progressPct)}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-[var(--ledger-muted)] tabular-nums">
                              <span>Sudah DP: {formatRupiah(bd.paid)}</span>
                              <span>Total: {formatRupiah(bd.total)}</span>
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 border ${catColor.border} ${catColor.bg}`}
                            >
                              {expense.category || "Umum"}
                            </Badge>
                            <span className="text-[var(--ledger-muted)] tabular-nums">
                              {expense.qty} {expense.unit || "pcs"}
                            </span>
                          </div>
                          {!bd.isPaid && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-2 py-0.5 ${dueInfo.badgeClass}`}
                            >
                              {expense.due_date && expense.due_date !== "-"
                                ? `${formatDateId(expense.due_date)} (${dueInfo.label})`
                                : dueInfo.label}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {!bd.isPaid ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                openPaymentModal(expense, bd.isDp ? "full" : "percent")
                              }
                              className="flex-1 min-h-[44px] text-xs font-semibold rounded-lg bg-amber-700 hover:bg-amber-800 text-white ledger-press"
                            >
                              <Wallet className="w-3.5 h-3.5 mr-1.5" />
                              <span>{bd.isDp ? "Bayar / Lunasi" : "Bayar DP"}</span>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleTogglePaid(expense)}
                              disabled={settleMutation.isPending}
                              className="min-h-[44px] px-3.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white ledger-press"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              <span>Lunasi</span>
                            </Button>
                          </>
                        ) : (
                          <>
                            {(expense.payments_count || 0) > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openPaymentModal(expense, "full")}
                                className="flex-1 min-h-[44px] text-xs font-semibold rounded-lg"
                              >
                                <History className="w-3.5 h-3.5 mr-1.5" />
                                <span>Riwayat ({expense.payments_count})</span>
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleTogglePaid(expense)}
                              disabled={settleMutation.isPending}
                              className="min-h-[44px] px-3.5 text-xs font-semibold rounded-lg"
                            >
                              Batal Lunas
                            </Button>
                          </>
                        )}

                        <div className="flex items-center gap-1.5 ml-auto">
                          {tgLink?.isUrl && tgLink.url && (
                            <a
                              href={tgLink.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--ledger-hairline)] text-blue-700 dark:text-blue-300"
                              aria-label="Buka pesan nota di Telegram"
                              title="Buka pesan nota di Telegram"
                            >
                              <TelegramIcon className="w-4 h-4" />
                            </a>
                          )}
                          {onViewExpense && (
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => onViewExpense(expense)}
                              className="min-h-[44px] min-w-[44px] rounded-lg"
                              aria-label="Lihat detail"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => onEditExpense(expense)}
                            className="min-h-[44px] min-w-[44px] rounded-lg"
                            aria-label="Edit transaksi"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          {canDelete && (
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => setConfirmDeleteId(expense.id)}
                              disabled={deletingId === expense.id}
                              className="min-h-[44px] min-w-[44px] rounded-lg text-[var(--signal-unpaid)]"
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
        </DataTable>
      </section>

      {/* 5. Floating Batch Settlement Dock */}
      <LedgerBatchDock
        selectedCount={selectedIds.length}
        itemLabel="tagihan"
        totalAmount={selectedNominal}
        totalLabel="Total Sisa Pelunasan:"
        bankAccounts={bankAccounts}
        bankAccountId={settleBankAccountId}
        onBankAccountChange={setSettleBankAccountId}
        primaryAction={{
          label: `Lunasi Sisa (${selectedIds.length})`,
          onClick: () => handleBatchSettle("mark_paid"),
          disabled: settleMutation.isPending,
          className: "bg-emerald-700 hover:bg-emerald-800 text-white",
          icon: <CheckCircle2 className="w-4 h-4" />,
        }}
        onClear={() => setSelectedIds([])}
      />

      {/* 6. Accessible Confirmation Dialogs (Replacing window.confirm) */}
      <LedgerConfirmDialog
        open={Boolean(confirmSupplierGroup)}
        onOpenChange={(open) => {
          if (!open) setConfirmSupplierGroup(null);
        }}
        title="Lunasi Seluruh Tagihan Toko?"
        description={
          confirmSupplierGroup
            ? `Lunasi sisa ${confirmSupplierGroup.unpaid_count} tagihan ke ${
                confirmSupplierGroup.supplier_name
              } senilai ${formatRupiah(confirmSupplierGroup.unpaid_total)}?`
            : ""
        }
        confirmLabel="Ya, Lunasi Semua"
        confirmVariant="cleared"
        isPending={settleMutation.isPending}
        bankAccounts={bankAccounts}
        bankAccountId={supplierSettleBankId}
        onBankAccountChange={setSupplierSettleBankId}
        onConfirm={executeSettleSupplierAll}
      />

      <LedgerConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title="Hapus Catatan Tagihan?"
        description="Tindakan ini menghapus catatan tagihan terpilih dari daftar pengeluaran."
        confirmLabel="Hapus Tagihan"
        confirmVariant="destructive"
        onConfirm={executeDeleteExpense}
      />

      {/* 7. DP & Pelunasan Modal */}
      <DpPaymentModal
        isOpen={Boolean(paymentModalExpense || paymentModalInvoiceGroup)}
        onClose={() => {
          setPaymentModalExpense(null);
          setPaymentModalInvoiceGroup(null);
        }}
        expense={paymentModalExpense}
        invoiceGroup={paymentModalInvoiceGroup}
        bankAccounts={bankAccounts}
        initialMode={paymentModalMode}
        onPaymentUpdated={(updated) => setPaymentModalExpense(updated)}
      />
    </div>
  );
};
