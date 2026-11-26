import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  getBankAccounts,
  getGroupedExpenses,
  getReimbursementSummary,
  settleReimbursements,
} from "@/lib/api";
import {
  Expense,
  ExpenseInvoiceGroup,
  ExpenseInvoiceListResponse,
  ExpenseUser,
  ReimbursementSummaryResponse,
  ReimbursementUserSummary,
} from "@/types";
import { formatDateId, formatRupiah, toIsoDate } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
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
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Edit2,
  ExternalLink,
  Eye,
  FileCheck2,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  Undo2,
  X,
} from "lucide-react";

interface TalanganTabProps {
  currentMonth: number;
  currentYear: number;
  currentMonthEnd?: number;
  users?: ExpenseUser[];
  onEditExpense: (expense: Expense) => void;
  onViewExpense?: (expense: Expense) => void;
  onDeleteExpense: (id: number) => void;
  onAddNewTalangan?: () => void;
  canDelete?: boolean;
  canSettle?: boolean;
  userRole?: string;
}

type TalanganStatusFilter = "pending" | "reimbursed" | "all";
type TalanganTypeFilter = "all" | "belanja" | "ongkir";
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

function isTalanganOngkirItem(e: Expense): boolean {
  return (
    (e.category || "").toLowerCase() === "ongkir" ||
    (e.item_name || "").toLowerCase().startsWith("ongkir") ||
    Boolean(
      e.supplier &&
        ["gosend", "grabexpress", "lalamove", "maxim", "sicepat", "j&t"].some((k) =>
          e.supplier!.toLowerCase().includes(k)
        )
    )
  );
}

function renderTalanganTypeBadge(hasOngkir: boolean, hasBelanja: boolean, compact = false) {
  const sizeCls = compact ? "text-[10px] px-1.5 py-0" : "text-[9px] px-1.5 py-0";
  if (hasOngkir && !hasBelanja) {
    return (
      <Badge
        className={cn(
          sizeCls,
          "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800 font-semibold gap-1 shrink-0"
        )}
      >
        <Truck className="w-2.5 h-2.5 text-sky-600 dark:text-sky-400" />
        Ongkir Kurir
      </Badge>
    );
  }
  if (hasOngkir && hasBelanja) {
    return (
      <Badge
        className={cn(
          sizeCls,
          "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800 font-semibold gap-1 shrink-0"
        )}
      >
        <Receipt className="w-2.5 h-2.5" />
        Belanja &amp; Ongkir
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(
        sizeCls,
        "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800 font-semibold gap-1 shrink-0"
      )}
    >
      <ShoppingBag className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
      Belanja
    </Badge>
  );
}

export const TalanganTab: React.FC<TalanganTabProps> = ({
  currentMonth,
  currentYear,
  currentMonthEnd,
  users = [],
  onEditExpense,
  onViewExpense,
  onDeleteExpense,
  onAddNewTalangan,
  canDelete = false,
  canSettle = true,
  userRole,
}) => {
  const queryClient = useQueryClient();
  const isSettleAllowed = canSettle && userRole !== "admin_input";

  // Filter states
  const [statusFilter, setStatusFilter] = useState<TalanganStatusFilter>("pending");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("all");
  const [customStart, setCustomStart] = useState<string>(() =>
    toIsoDate(new Date(currentYear, currentMonth - 1, 1))
  );
  const [customEnd, setCustomEnd] = useState<string>(() => toIsoDate(new Date()));
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedMonthEnd, setSelectedMonthEnd] = useState<number>(
    currentMonthEnd || currentMonth
  );
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [talanganType, setTalanganType] = useState<TalanganTypeFilter>("all");
  const [viewMode, setViewMode] = useState<ExpenseViewMode>("grouped");
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [mobileExpandedKeys, setMobileExpandedKeys] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState<string>("");
  const effectiveSearch = useMemo(() => getEffectiveSearchQuery(search), [search]);
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);

  const isGroupedMode = viewMode === "grouped";

  React.useEffect(() => {
    setSelectedMonth(currentMonth);
    setSelectedMonthEnd(currentMonthEnd || currentMonth);
    setSelectedYear(currentYear);
  }, [currentMonth, currentMonthEnd, currentYear]);

  // Batch selection & confirmation states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [settleBankAccountId, setSettleBankAccountId] = useState<string>("");
  const [isUsersExpanded, setIsUsersExpanded] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmUserGroup, setConfirmUserGroup] =
    useState<ReimbursementUserSummary | null>(null);
  const [userSettleBankId, setUserSettleBankId] = useState<string>("");

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", "active"],
    queryFn: () => getBankAccounts(true),
  });

  const handleViewModeChange = (nextMode: ExpenseViewMode) => {
    setViewMode(nextMode);
    setPage(1);
    setExpanded({});
    setMobileExpandedKeys({});
    setSelectedIds([]);
  };

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

  // 1. Summary KPI + user breakdown
  const { data: summaryData, isLoading: isSummaryLoading } =
    useQuery<ReimbursementSummaryResponse>({
      queryKey: [
        "talangan-summary",
        monthParam,
        yearParam,
        rangeStart,
        rangeEnd,
        selectedUserId,
        talanganType,
      ],
      queryFn: () =>
        getReimbursementSummary({
          month: monthParam,
          year: yearParam,
          startDate: rangeStart,
          endDate: rangeEnd,
          userId: selectedUserId,
          includeOngkir: talanganType !== "belanja",
          talanganType,
        }),
      enabled: !isCustomRangeInvalid,
    });

  // 2a. Flat item list
  const {
    data: expensesData,
    isLoading: isExpensesLoading,
    isError: isExpensesError,
    refetch: refetchExpenses,
  } = useQuery({
    queryKey: [
      "expenses-talangan",
      page,
      perPage,
      monthParam,
      monthEndParam,
      yearParam,
      rangeStart,
      rangeEnd,
      statusFilter,
      selectedUserId,
      effectiveSearch,
      talanganType,
    ],
    enabled: !isCustomRangeInvalid && !isGroupedMode,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        is_reimbursement: "true",
        special_type: "talangan",
      });

      if (talanganType !== "belanja") {
        params.append("include_ongkir", "true");
      }
      params.append("talangan_type", talanganType);

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

      if (statusFilter === "pending") {
        params.append("reimbursed_status", "pending");
      } else if (statusFilter === "reimbursed") {
        params.append("reimbursed_status", "reimbursed");
      }

      if (selectedUserId !== null) {
        params.append("user_id", String(selectedUserId));
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
    isLoading: isGroupedLoading,
    isError: isGroupedError,
    refetch: refetchGrouped,
  } = useQuery<ExpenseInvoiceListResponse>({
    queryKey: [
      "expenses-talangan-grouped",
      page,
      perPage,
      monthParam,
      monthEndParam,
      yearParam,
      rangeStart,
      rangeEnd,
      statusFilter,
      selectedUserId,
      effectiveSearch,
      talanganType,
    ],
    enabled: !isCustomRangeInvalid && isGroupedMode,
    queryFn: () =>
      getGroupedExpenses({
        page,
        per_page: perPage,
        is_reimbursement: true,
        special_type: "talangan",
        include_ongkir: talanganType !== "belanja",
        talangan_type: talanganType,
        month: periodMode === "month" ? selectedMonth : undefined,
        month_end:
          periodMode === "month" && selectedMonthEnd && selectedMonthEnd !== selectedMonth
            ? selectedMonthEnd
            : undefined,
        year: periodMode === "month" ? selectedYear : undefined,
        start_date: periodMode === "custom" && rangeStart ? rangeStart : undefined,
        end_date: periodMode === "custom" && rangeEnd ? rangeEnd : undefined,
        reimbursed_status: statusFilter !== "all" ? statusFilter : undefined,
        user_id: selectedUserId !== null ? selectedUserId : undefined,
        search: effectiveSearch || undefined,
      }),
  });

  const expenses: Expense[] = expensesData?.data || [];
  const invoiceGroups: ExpenseInvoiceGroup[] = groupedData?.data || [];
  const activeIsLoading = isGroupedMode ? isGroupedLoading : isExpensesLoading;
  const activeIsError = isGroupedMode ? isGroupedError : isExpensesError;
  const totalInvoicesOrItems: number = isGroupedMode
    ? groupedData?.total || 0
    : expensesData?.total || 0;
  const totalGroupChildItems: number = isGroupedMode
    ? groupedData?.total_items || 0
    : expensesData?.total || 0;

  // 3. Settle Mutation
  const settleMutation = useMutation({
    mutationFn: settleReimbursements,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["auth-status"] });

      if (data.action === "mark_reimbursed") {
        toast.success(`Berhasil menandai ${data.updated_count} talangan telah diganti.`);
        confetti({
          particleCount: 45,
          spread: 55,
          origin: { y: 0.75 },
        });
      } else {
        toast.info(`Status penggantian ${data.updated_count} talangan dibatalkan.`);
      }
      setSelectedIds([]);
      setConfirmUserGroup(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memproses status talangan.");
    },
  });

  const handleToggleReimbursed = (expense: Expense) => {
    if (!isSettleAllowed) {
      toast.error(
        "Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan."
      );
      return;
    }
    const isCurrentlyReimbursed = !!expense.reimbursed_at;
    const action = isCurrentlyReimbursed ? "unmark" : "mark_reimbursed";
    settleMutation.mutate({
      expense_ids: [expense.id],
      action,
      bank_account_id:
        action === "mark_reimbursed" && settleBankAccountId
          ? Number(settleBankAccountId)
          : undefined,
    });
  };

  const handleToggleGroupReimbursed = (group: ExpenseInvoiceGroup) => {
    if (!isSettleAllowed) {
      toast.error(
        "Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan."
      );
      return;
    }
    const pendingItems = group.items.filter((it) => !it.reimbursed_at);
    const isAllReimbursed = pendingItems.length === 0;
    const targetIds = isAllReimbursed
      ? group.items.map((it) => it.id)
      : pendingItems.map((it) => it.id);
    if (targetIds.length === 0) return;
    const action = isAllReimbursed ? "unmark" : "mark_reimbursed";
    settleMutation.mutate({
      expense_ids: targetIds,
      action,
      bank_account_id:
        action === "mark_reimbursed" && settleBankAccountId
          ? Number(settleBankAccountId)
          : undefined,
    });
  };

  const executeSettleUserPending = () => {
    if (!confirmUserGroup || confirmUserGroup.pending_count === 0) return;
    if (!isSettleAllowed) {
      toast.error(
        "Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan."
      );
      setConfirmUserGroup(null);
      return;
    }
    const userGroup = confirmUserGroup;
    const chosenBankId = userSettleBankId || settleBankAccountId;
    const typeParam =
      talanganType !== "belanja"
        ? `&include_ongkir=true&talangan_type=${talanganType}`
        : `&talangan_type=belanja`;

    api
      .get(
        `/expenses?is_reimbursement=true&reimbursed_status=pending&special_type=talangan&user_id=${
          userGroup.user_id ?? ""
        }&per_page=100${typeParam}`
      )
      .then((res) => {
        const ids = (res.data?.data || []).map((e: Expense) => e.id);
        if (ids.length === 0) {
          toast.error("Tidak ada item talangan pending yang dapat diproses.");
          setConfirmUserGroup(null);
          return;
        }
        settleMutation.mutate({
          expense_ids: ids,
          action: "mark_reimbursed",
          bank_account_id: chosenBankId ? Number(chosenBankId) : undefined,
        });
      })
      .catch(() => {
        toast.error("Gagal mengambil data talangan karyawan.");
      });
  };

  const getGroupSelectableIds = (group: ExpenseInvoiceGroup): number[] => {
    if (statusFilter !== "reimbursed") {
      const pendingIds = group.items
        .filter((it) => !it.reimbursed_at)
        .map((it) => it.id);
      if (pendingIds.length > 0) return pendingIds;
    }
    return group.items.map((it) => it.id);
  };

  const allVisibleSelectableIds = useMemo(() => {
    if (!isGroupedMode) return expenses.map((e) => e.id);
    const idSet = new Set<number>();
    for (const grp of invoiceGroups) {
      for (const id of getGroupSelectableIds(grp)) {
        idSet.add(id);
      }
    }
    return Array.from(idSet);
  }, [isGroupedMode, expenses, invoiceGroups, statusFilter]);

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? allVisibleSelectableIds : []);
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectGroup = (group: ExpenseInvoiceGroup) => {
    const ids = getGroupSelectableIds(group);
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const allChecked = ids.every((id) => prev.includes(id));
      if (allChecked) {
        const removeSet = new Set(ids);
        return prev.filter((id) => !removeSet.has(id));
      }
      return Array.from(new Set([...prev, ...ids]));
    });
  };

  const handleBatchSettle = (action: "mark_reimbursed" | "unmark") => {
    if (!isSettleAllowed) {
      toast.error(
        "Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan."
      );
      return;
    }
    if (selectedIds.length === 0) return;
    settleMutation.mutate({
      expense_ids: selectedIds,
      action,
      bank_account_id:
        action === "mark_reimbursed" && settleBankAccountId
          ? Number(settleBankAccountId)
          : undefined,
    });
  };

  const selectedNominal = useMemo(() => {
    const sourceItems = isGroupedMode
      ? invoiceGroups.flatMap((grp) => grp.items)
      : expenses;
    const selectedSet = new Set(selectedIds);
    return sourceItems
      .filter((e) => selectedSet.has(e.id))
      .reduce((sum, e) => sum + (e.total_price || 0), 0);
  }, [isGroupedMode, invoiceGroups, expenses, selectedIds]);

  const executeDeleteExpense = () => {
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    setDeletingId(id);
    setConfirmDeleteId(null);
    onDeleteExpense(id);
    window.setTimeout(() => setDeletingId(null), 1000);
  };

  const handleResetFilters = () => {
    setStatusFilter("pending");
    setPeriodMode("all");
    setSelectedUserId(null);
    setTalanganType("all");
    setSearch("");
    setPage(1);
    setExpanded({});
    setMobileExpandedKeys({});
    setSelectedIds([]);
  };

  const hasActiveFilters =
    statusFilter !== "pending" ||
    periodMode !== "all" ||
    selectedUserId !== null ||
    talanganType !== "all" ||
    search.trim() !== "";

  const talanganColumns = useMemo<ColumnDef<DataGridFeatures, Expense>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <div className="flex justify-center">
            <Checkbox
              checked={
                expenses.length > 0 && selectedIds.length === expenses.length
                  ? true
                  : selectedIds.length > 0
                  ? "indeterminate"
                  : false
              }
              onCheckedChange={(chk) => handleSelectAll(Boolean(chk))}
              aria-label="Pilih semua di halaman ini"
            />
          </div>
        ),
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={selectedIds.includes(e.id)}
                onCheckedChange={() => handleToggleSelect(e.id)}
                aria-label={`Pilih talangan #${e.id}`}
              />
            </div>
          );
        },
        size: 38,
        enableSorting: false,
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="whitespace-nowrap">
              <div className="font-semibold text-[var(--ledger-ink)] tabular-nums text-xs">
                {formatDateId(e.expense_date)}
              </div>
              <div className="text-[10px] text-[var(--ledger-muted)] font-mono-ledger">
                #{e.id}
              </div>
            </div>
          );
        },
        size: 96,
      },
      {
        accessorKey: "user_name",
        id: "user_name",
        header: ({ column }) => <DataGridColumnHeader title="Karyawan" column={column} />,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex items-center gap-2">
              <div
                aria-hidden="true"
                className="h-6 w-6 rounded-md bg-[var(--signal-talangan-soft)] text-[var(--signal-talangan)] text-[10px] font-bold flex items-center justify-center shrink-0"
              >
                {getInitials(e.user_name || "HC")}
              </div>
              <span className="font-semibold text-xs text-[var(--ledger-ink)] truncate max-w-[95px] xl:max-w-[130px]">
                {e.user_name || "Web / Kasir"}
              </span>
            </div>
          );
        },
        size: 145,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Barang / Keperluan" column={column} />
        ),
        cell: ({ row }) => {
          const e = row.original;
          const isOngkir = isTalanganOngkirItem(e);
          return (
            <div>
              <div className="font-semibold text-xs text-[var(--ledger-ink)] leading-tight flex items-center gap-1.5 flex-wrap">
                {renderTalanganTypeBadge(isOngkir, !isOngkir)}
                <span className="truncate max-w-[160px] xl:max-w-[210px]" title={e.item_name}>
                  {e.item_name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {e.category && (
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 font-medium text-[var(--ledger-muted)] border-[color:var(--ledger-hairline)]"
                  >
                    {e.category}
                  </Badge>
                )}
                <span className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                  {e.qty} {e.unit || "Pcs"}
                </span>
              </div>
            </div>
          );
        },
        size: 265,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => (
          <DataGridColumnHeader title="Toko &amp; Nota" column={column} />
        ),
        cell: ({ row }) => {
          const e = row.original;
          const tgLink = parseTelegramLink(e.msg_link);
          return (
            <div className="space-y-0.5">
              <div
                className="truncate max-w-[135px] xl:max-w-[165px] font-medium text-xs text-[var(--ledger-ink)]"
                title={e.supplier || "-"}
              >
                {e.supplier || "-"}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-[var(--ledger-muted)]">
                {e.invoice_number && e.invoice_number !== "-" && (
                  <span className="font-mono-ledger text-[var(--ledger-ink)]">
                    #{e.invoice_number}
                  </span>
                )}
                {tgLink?.isUrl && tgLink.url && (
                  <a
                    href={tgLink.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                  >
                    <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                    <span>Nota</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              {e.notes && e.notes !== "-" && (
                <span className="truncate block max-w-[135px] text-[10.5px] text-[var(--ledger-muted)] italic">
                  {e.notes}
                </span>
              )}
            </div>
          );
        },
        size: 175,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Nominal"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="text-right">
              <div className="font-bold text-xs sm:text-sm text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(e.total_price)}
              </div>
              <div className="text-[10px] text-[var(--ledger-muted)]">
                {e.pay_method || "Tunai"}
              </div>
            </div>
          );
        },
        size: 138,
      },
      {
        accessorKey: "reimbursed_at",
        id: "reimbursed_at",
        header: () => <span>Status Ganti</span>,
        cell: ({ row }) => {
          const e = row.original;
          const isReimbursed = !!e.reimbursed_at;
          return isReimbursed ? (
            <div className="space-y-0.5 whitespace-nowrap">
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 gap-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Sudah Diganti</span>
              </Badge>
              {e.reimbursed_at && (
                <div className="text-[10px] text-[var(--ledger-muted)] tabular-nums">
                  {formatDateId(e.reimbursed_at)}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1 whitespace-nowrap">
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-amber-900 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 gap-1"
              >
                <Clock className="w-3 h-3" />
                <span>Belum Diganti</span>
              </Badge>
              {isSettleAllowed && (
                <button
                  type="button"
                  onClick={() => handleToggleReimbursed(e)}
                  disabled={settleMutation.isPending}
                  className="text-[11px] font-semibold text-[var(--signal-talangan)] hover:underline block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  Tandai Diganti
                </button>
              )}
            </div>
          );
        },
        size: 145,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex items-center justify-center gap-0.5 whitespace-nowrap">
              {onViewExpense && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onViewExpense(e)}
                  className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                  aria-label={`Lihat detail ${e.item_name}`}
                  title="Lihat Detail Nota"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => onEditExpense(e)}
                className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                aria-label={`Edit ${e.item_name}`}
                title="Edit Data"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
              {canDelete && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setConfirmDeleteId(e.id)}
                  disabled={deletingId === e.id}
                  className="h-7 w-7 text-[var(--signal-unpaid)] hover:bg-[var(--signal-unpaid-soft)]"
                  aria-label={`Hapus ${e.item_name}`}
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          );
        },
        size: 120,
      },
    ],
    [
      expenses,
      selectedIds,
      isSettleAllowed,
      settleMutation.isPending,
      onViewExpense,
      onEditExpense,
      canDelete,
      deletingId,
    ]
  );

  const talanganPagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: perPage,
    }),
    [page, perPage]
  );

  const talanganTable = useTable({
    features: dataGridFeatures,
    columns: talanganColumns,
    data: expenses,
    manualPagination: true,
    rowCount: expensesData?.total || 0,
    getRowId: (row: Expense) => String(row.id),
    state: { pagination: talanganPagination },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(talanganPagination) : updater;
      if (next.pageSize !== perPage) {
        setPerPage(next.pageSize);
        setPage(1);
      } else {
        setPage(next.pageIndex + 1);
      }
    },
  });

  const groupedTalanganColumns = useMemo<ColumnDef<DataGridFeatures, ExpenseInvoiceGroup>[]>(
    () => [
      {
        id: "expand",
        header: () => <span className="sr-only">Rincian Item</span>,
        cell: ({ row }) => {
          const isExpanded = row.getIsExpanded();
          return (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={row.getToggleExpandedHandler()}
                aria-expanded={isExpanded}
                aria-label={
                  isExpanded
                    ? "Tutup rincian item talangan"
                    : "Lihat rincian item talangan"
                }
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] hover:bg-[var(--ledger-recessed)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            </div>
          );
        },
        size: 36,
        enableSorting: false,
        meta: {
          expandedContent: (group: ExpenseInvoiceGroup) => (
            <div className="ledger-recessed-band px-3.5 py-2.5 border-t border-[color:var(--ledger-hairline)] space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ledger-ink)] flex-wrap">
                  <Receipt className="w-3.5 h-3.5 text-[var(--signal-talangan)]" />
                  <span>Rincian Item Talangan ({group.items.length} item)</span>
                  {group.invoice_number && group.invoice_number !== "-" && (
                    <span className="font-mono-ledger text-[11px] text-[var(--ledger-muted)]">
                      #{group.invoice_number}
                    </span>
                  )}
                  {group.group_key.startsWith("grp:") && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 text-purple-800 border-purple-200 dark:text-purple-200 dark:border-purple-800"
                    >
                      Grup Multi-Item
                    </Badge>
                  )}
                  {group.group_key.startsWith("tg:") && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 text-sky-800 border-sky-200 dark:text-sky-200 dark:border-sky-800"
                    >
                      Grup Telegram
                    </Badge>
                  )}
                </div>
                {isSettleAllowed &&
                  group.items.some((it) => !it.reimbursed_at) &&
                  group.items.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleGroupReimbursed(group)}
                      disabled={settleMutation.isPending}
                      className="h-7 text-[11px] rounded-md px-2.5 font-semibold text-emerald-800 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-200 dark:border-emerald-800 dark:hover:bg-emerald-950/40"
                    >
                      Tandai Semua Diganti
                    </Button>
                  )}
              </div>

              <div className="overflow-x-auto border-y border-[color:var(--ledger-hairline)]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[color:var(--ledger-hairline)] text-[11px] font-semibold text-[var(--ledger-muted)]">
                      <th className="text-left py-1.5 px-2">Barang / Keperluan</th>
                      <th className="text-left py-1.5 px-2">Kategori</th>
                      <th className="text-right py-1.5 px-2">Qty</th>
                      <th className="text-right py-1.5 px-2">Harga</th>
                      <th className="text-left py-1.5 px-2">Status Ganti</th>
                      <th className="text-center py-1.5 px-2">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--ledger-hairline)]">
                    {group.items.map((item) => {
                      const itemOngkir = isTalanganOngkirItem(item);
                      const isDone = !!item.reimbursed_at;
                      return (
                        <tr
                          key={item.id}
                          className="ledger-hover-surface"
                        >
                          <td className="py-1.5 px-2">
                            <div className="font-semibold text-[var(--ledger-ink)] flex items-center gap-1.5 flex-wrap">
                              {renderTalanganTypeBadge(itemOngkir, !itemOngkir)}
                              <span>{item.item_name}</span>
                            </div>
                          </td>
                          <td className="py-1.5 px-2 text-[var(--ledger-muted)]">
                            {item.category || "-"}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-[var(--ledger-muted)] whitespace-nowrap">
                            {item.qty} {item.unit || "Pcs"}
                          </td>
                          <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-[var(--ledger-ink)] whitespace-nowrap">
                            {formatRupiah(item.total_price)}
                          </td>
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            {isDone ? (
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Sudah Diganti</span>
                                </Badge>
                                {isSettleAllowed && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReimbursed(item)}
                                    disabled={settleMutation.isPending}
                                    className="text-[10px] font-medium text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] underline"
                                  >
                                    Batal
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold text-amber-900 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 gap-1"
                                >
                                  <Clock className="w-3 h-3" />
                                  <span>Belum Diganti</span>
                                </Badge>
                                {isSettleAllowed && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReimbursed(item)}
                                    disabled={settleMutation.isPending}
                                    className="text-[10px] font-semibold text-[var(--signal-talangan)] hover:underline"
                                  >
                                    Diganti
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 px-2">
                            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                              {onViewExpense && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => onViewExpense(item)}
                                  className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                                  aria-label={`Lihat detail ${item.item_name}`}
                                  title="Lihat Detail Nota"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => onEditExpense(item)}
                                className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                                aria-label={`Edit ${item.item_name}`}
                                title="Edit Data"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              {canDelete && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setConfirmDeleteId(item.id)}
                                  disabled={deletingId === item.id}
                                  className="h-7 w-7 text-[var(--signal-unpaid)] hover:bg-[var(--signal-unpaid-soft)]"
                                  aria-label={`Hapus ${item.item_name}`}
                                  title="Hapus"
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

              <InvoiceFeeFooter group={group} compact={false} />
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
            !allSelected &&
            allVisibleSelectableIds.some((id) => selectedIds.includes(id));
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(chk) => handleSelectAll(Boolean(chk))}
                aria-label="Pilih semua invoice di halaman ini"
              />
            </div>
          );
        },
        cell: ({ row }) => {
          const grp = row.original;
          const selectableIds = getGroupSelectableIds(grp);
          const allChecked =
            selectableIds.length > 0 &&
            selectableIds.every((id) => selectedIds.includes(id));
          const someChecked =
            !allChecked && selectableIds.some((id) => selectedIds.includes(id));
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={() => handleToggleSelectGroup(grp)}
                aria-label={`Pilih invoice talangan ${
                  grp.supplier || grp.user_name || grp.group_key
                }`}
              />
            </div>
          );
        },
        size: 38,
        enableSorting: false,
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => {
          const grp = row.original;
          return (
            <div className="whitespace-nowrap">
              <div className="font-semibold text-[var(--ledger-ink)] tabular-nums text-xs">
                {formatDateId(grp.expense_date)}
              </div>
              <div className="text-[10px] text-[var(--ledger-muted)] font-mono-ledger">
                {grp.items_count > 1
                  ? `${grp.items_count} item`
                  : `#${grp.items[0]?.id ?? "-"}`}
              </div>
            </div>
          );
        },
        size: 96,
      },
      {
        accessorKey: "user_name",
        id: "user_name",
        header: ({ column }) => <DataGridColumnHeader title="Karyawan" column={column} />,
        cell: ({ row }) => {
          const grp = row.original;
          return (
            <div className="flex items-center gap-2">
              <div
                aria-hidden="true"
                className="h-6 w-6 rounded-md bg-[var(--signal-talangan-soft)] text-[var(--signal-talangan)] text-[10px] font-bold flex items-center justify-center shrink-0"
              >
                {getInitials(grp.user_name || "HC")}
              </div>
              <span className="font-semibold text-xs text-[var(--ledger-ink)] truncate max-w-[105px] xl:max-w-[140px]">
                {grp.user_name || "Web / Kasir"}
              </span>
            </div>
          );
        },
        size: 140,
      },
      {
        id: "item_summary",
        header: () => <span>Barang / Keperluan</span>,
        cell: ({ row }) => {
          const grp = row.original;
          const summary = getInvoiceItemSummaryText(grp);
          const hasOngkir = grp.items.some(isTalanganOngkirItem);
          const hasBelanja = grp.items.some((it) => !isTalanganOngkirItem(it));
          const distinctCategories = Array.from(
            new Set(grp.items.map((it) => it.category).filter(Boolean))
          ).slice(0, 2);

          return (
            <div>
              <div className="font-semibold text-xs text-[var(--ledger-ink)] leading-tight flex items-center gap-1.5 flex-wrap">
                {renderTalanganTypeBadge(hasOngkir, hasBelanja)}
                <span className="truncate max-w-[185px] xl:max-w-[240px]" title={summary.title}>
                  {summary.title}
                </span>
                {summary.extraCount > 0 && (
                  <span className="text-xs font-semibold text-[var(--signal-talangan)]">
                    +{summary.extraCount} item
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {distinctCategories.map((cat) => (
                  <Badge
                    key={cat}
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 font-medium text-[var(--ledger-muted)] border-[color:var(--ledger-hairline)]"
                  >
                    {cat}
                  </Badge>
                ))}
                <span className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                  {grp.items.length === 1
                    ? `${grp.items[0].qty} ${grp.items[0].unit || "Pcs"}`
                    : `${grp.items_count} item dalam 1 invoice`}
                </span>
              </div>
            </div>
          );
        },
        size: 245,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => (
          <DataGridColumnHeader title="Toko &amp; Nota" column={column} />
        ),
        cell: ({ row }) => {
          const grp = row.original;
          const rawLink = grp.msg_link || grp.items.find((it) => it.msg_link)?.msg_link;
          const tgLink = parseTelegramLink(rawLink);
          const firstNote = grp.items.find((it) => it.notes && it.notes !== "-")?.notes;
          return (
            <div className="space-y-0.5">
              <div
                className="truncate max-w-[155px] xl:max-w-[185px] font-medium text-xs text-[var(--ledger-ink)]"
                title={grp.supplier || "-"}
              >
                {grp.supplier || "-"}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-[var(--ledger-muted)]">
                {grp.invoice_number && grp.invoice_number !== "-" && (
                  <span className="font-mono-ledger text-[var(--ledger-ink)]">
                    #{grp.invoice_number}
                  </span>
                )}
                {tgLink?.isUrl && tgLink.url && (
                  <a
                    href={tgLink.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                  >
                    <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                    <span>Nota</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
              {firstNote && (
                <span className="truncate block max-w-[155px] text-[10.5px] text-[var(--ledger-muted)] italic">
                  {firstNote}
                </span>
              )}
            </div>
          );
        },
        size: 175,
      },
      {
        accessorKey: "total_amount",
        id: "total_amount",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Total Invoice"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const grp = row.original;
          const extraFees =
            (grp.shipping_fee || 0) + (grp.tax || 0) + (grp.other_fee || 0);
          return (
            <div className="text-right">
              <div className="font-bold text-xs sm:text-sm text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(grp.total_amount)}
              </div>
              <div className="text-[10px] text-[var(--ledger-muted)]">
                {grp.pay_method || "Tunai"}
                {(extraFees > 0 || grp.discount > 0) && ", termasuk biaya/diskon"}
              </div>
            </div>
          );
        },
        size: 138,
      },
      {
        id: "reimbursed_at",
        header: () => <span>Status Ganti</span>,
        cell: ({ row }) => {
          const grp = row.original;
          const totalCount = grp.items.length;
          const doneItems = grp.items.filter((it) => !!it.reimbursed_at);
          const pendingItems = grp.items.filter((it) => !it.reimbursed_at);
          const doneCount = doneItems.length;
          const isAllReimbursed = totalCount > 0 && pendingItems.length === 0;
          const isPartial = doneCount > 0 && pendingItems.length > 0;
          const latestReimbursedAt = doneItems
            .map((it) => it.reimbursed_at)
            .filter(Boolean)
            .sort()
            .slice(-1)[0];

          if (isAllReimbursed) {
            return (
              <div className="space-y-0.5 whitespace-nowrap">
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Sudah Diganti</span>
                </Badge>
                {latestReimbursedAt && (
                  <div className="text-[10px] text-[var(--ledger-muted)] tabular-nums">
                    {formatDateId(latestReimbursedAt)}
                  </div>
                )}
              </div>
            );
          }

          if (isPartial) {
            const pendingNominal = pendingItems.reduce(
              (sum, it) => sum + (it.total_price || 0),
              0
            );
            return (
              <div className="space-y-1 whitespace-nowrap">
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold text-sky-800 border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-800 gap-1"
                >
                  <Clock className="w-3 h-3" />
                  <span>
                    Sebagian Diganti ({doneCount}/{totalCount})
                  </span>
                </Badge>
                <div className="text-[10px] text-[var(--ledger-muted)] tabular-nums">
                  Sisa {formatRupiah(pendingNominal)}
                </div>
                {isSettleAllowed && (
                  <button
                    type="button"
                    onClick={() => handleToggleGroupReimbursed(grp)}
                    disabled={settleMutation.isPending}
                    className="text-[11px] font-semibold text-[var(--signal-talangan)] hover:underline block"
                  >
                    Lunasi Sisa
                  </button>
                )}
              </div>
            );
          }

          return (
            <div className="space-y-1 whitespace-nowrap">
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-amber-900 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 gap-1"
              >
                <Clock className="w-3 h-3" />
                <span>Belum Diganti</span>
              </Badge>
              {isSettleAllowed && (
                <button
                  type="button"
                  onClick={() => handleToggleGroupReimbursed(grp)}
                  disabled={settleMutation.isPending}
                  className="text-[11px] font-semibold text-[var(--signal-talangan)] hover:underline block"
                >
                  Tandai Diganti
                </button>
              )}
            </div>
          );
        },
        size: 140,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const grp = row.original;
          const firstItem = grp.items[0];
          const isSingle = grp.items.length === 1;
          const isExpanded = row.getIsExpanded();
          return (
            <div className="flex items-center justify-center gap-0.5 whitespace-nowrap">
              {onViewExpense && firstItem && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onViewExpense(firstItem)}
                  className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                  aria-label="Lihat detail nota"
                  title="Lihat Detail Nota"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              )}
              {isSingle && firstItem ? (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onEditExpense(firstItem)}
                    className="h-7 w-7 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                    aria-label={`Edit ${firstItem.item_name}`}
                    title="Edit Data"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  {canDelete && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(firstItem.id)}
                      disabled={deletingId === firstItem.id}
                      className="h-7 w-7 text-[var(--signal-unpaid)] hover:bg-[var(--signal-unpaid-soft)]"
                      aria-label={`Hapus ${firstItem.item_name}`}
                      title="Hapus"
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
                  aria-expanded={isExpanded}
                  className="h-7 px-2 text-[11px] font-semibold rounded-md"
                  title="Lihat rincian item untuk edit atau hapus per item"
                >
                  {isExpanded ? "Tutup" : `Items (${grp.items.length})`}
                </Button>
              )}
            </div>
          );
        },
        size: 118,
      },
    ],
    [
      invoiceGroups,
      selectedIds,
      allVisibleSelectableIds,
      isSettleAllowed,
      settleMutation.isPending,
      onViewExpense,
      onEditExpense,
      canDelete,
      deletingId,
      statusFilter,
    ]
  );

  const groupedTalanganTable = useTable({
    features: dataGridFeatures,
    columns: groupedTalanganColumns,
    data: invoiceGroups,
    manualPagination: true,
    rowCount: totalInvoicesOrItems,
    getRowId: (row: ExpenseInvoiceGroup) => row.group_key,
    getRowCanExpand: (row) => (row.original.items?.length || 0) > 0,
    autoResetExpanded: false,
    state: {
      pagination: talanganPagination,
      expanded,
    },
    onExpandedChange: setExpanded,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(talanganPagination) : updater;
      if (next.pageSize !== perPage) {
        setPerPage(next.pageSize);
        setPage(1);
      } else {
        setPage(next.pageIndex + 1);
      }
    },
  });

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

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      map.set(String(u.id), u.name);
    });
    (summaryData?.by_user || []).forEach((u) => {
      if (u.user_id !== null && u.user_id !== undefined && !map.has(String(u.user_id))) {
        map.set(String(u.user_id), u.user_name || `User #${u.user_id}`);
      }
    });
    return [
      { value: "", label: "Semua Karyawan" },
      ...Array.from(map.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [users, summaryData?.by_user]);

  const statusTabsList = useMemo<LedgerStatusTabOption<TalanganStatusFilter>[]>(
    () => [
      {
        value: "pending",
        label: "Belum Diganti",
        count: summaryData?.pending_count || 0,
      },
      {
        value: "reimbursed",
        label: "Sudah Diganti",
        count: summaryData?.reimbursed_count || 0,
      },
      { value: "all", label: "Semua", count: summaryData?.total_count || 0 },
    ],
    [
      summaryData?.pending_count,
      summaryData?.reimbursed_count,
      summaryData?.total_count,
    ]
  );

  const pendingBelanja = summaryData?.belanja_pending_total || 0;
  const pendingOngkir = summaryData?.ongkir_pending_total || 0;
  const pendingEmployeesCount =
    summaryData?.by_user?.filter((u) => u.pending_count > 0).length || 0;

  return (
    <div className="space-y-3.5 pb-6">
      {/* 1. Editorial Action Header (Flat on Canvas) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
            Buku Talangan &amp; Penggantian Karyawan
          </h2>
          <p className="text-xs text-[var(--ledger-muted)] tabular-nums">
            {summaryData && summaryData.pending_count > 0
              ? `${summaryData.pending_count} nota perlu diganti untuk ${pendingEmployeesCount} karyawan`
              : "Semua talangan tercatat"}
          </p>
        </div>

        {onAddNewTalangan && (
          <Button
            type="button"
            onClick={onAddNewTalangan}
            size="sm"
            className="min-h-[40px] sm:min-h-[36px] bg-[#5B3EAE] hover:bg-[#493091] text-white rounded-lg text-xs font-semibold px-3.5 gap-1.5 shrink-0 ledger-press"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Talangan Baru</span>
          </Button>
        )}
      </div>

      {/* Role Read-Only Notice (Hairline Strip, Zero Card) */}
      {!isSettleAllowed && (
        <div className="border-l-2 border-amber-600 signal-surface-dp px-3.5 py-2.5 flex items-start gap-2 text-xs text-[var(--ledger-ink)]">
          <AlertCircle className="w-4 h-4 shrink-0 text-[var(--signal-dp)] mt-0.5" />
          <span>
            <strong className="font-semibold">Mode Lihat Talangan:</strong> Role Admin Input
            hanya memiliki akses untuk mencatat dan melihat data talangan. Persetujuan
            penggantian dilakukan oleh Owner.
          </span>
        </div>
      )}

      {/* 2. Unified Hairline KPI Strip (Zero Nested Cards) */}
      <LedgerMetricStrip
        isLoading={isSummaryLoading}
        primary={{
          label: "Belum Diganti (Pending)",
          value: formatRupiah(summaryData?.pending_total || 0),
          valueClassName: "text-[var(--signal-dp)]",
          subtext: `${summaryData?.pending_count || 0} nota perlu diganti`,
          active: statusFilter === "pending",
          accentTone: "talangan",
          onClick: () => {
            setStatusFilter("pending");
            setPage(1);
          },
          segments: [
            {
              key: "belanja",
              label: "Belanja",
              value: pendingBelanja,
              displayValue: formatRupiah(pendingBelanja),
              colorClass: "bg-[#5B3EAE] dark:bg-[#AD9CFF]",
            },
            {
              key: "ongkir",
              label: "Ongkir Kurir",
              value: pendingOngkir,
              displayValue: formatRupiah(pendingOngkir),
              colorClass: "bg-sky-600 dark:bg-sky-400",
            },
          ],
        }}
        supporting={[
          {
            key: "reimbursed",
            label: "Sudah Diganti (Lunas)",
            value: formatRupiah(summaryData?.reimbursed_total || 0),
            valueClassName: "text-[var(--signal-cleared)]",
            subtext: `${summaryData?.reimbursed_count || 0} nota diselesaikan`,
            active: statusFilter === "reimbursed",
            accentTone: "cleared",
            onClick: () => {
              setStatusFilter("reimbursed");
              setPage(1);
            },
          },
          {
            key: "all-talangan",
            label: "Total Seluruh Talangan",
            value: formatRupiah(summaryData?.total_nominal || 0),
            subtext: `${summaryData?.total_count || 0} total nota tercatat`,
            active: statusFilter === "all",
            accentTone: "talangan",
            onClick: () => {
              setStatusFilter("all");
              setPage(1);
            },
          },
          {
            key: "employees",
            label: "Karyawan Menalangi",
            value: `${summaryData?.by_user?.length || 0} Orang`,
            subtext: `${pendingEmployeesCount} orang menunggu ganti`,
          },
        ]}
      />

      {/* 3. Flat Staff Balance Directory (Collapses 4 Nested Card Levels -> 1 Hairline List) */}
      {summaryData && summaryData.by_user && summaryData.by_user.length > 0 && (
        <section aria-label="Rekap saldo talangan per karyawan" className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="text-sm font-bold text-[var(--ledger-ink)] truncate">
                Rekap Saldo per Karyawan
              </h3>
              <span className="text-xs text-[var(--ledger-muted)] tabular-nums shrink-0">
                {summaryData.by_user.length} anggota
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsUsersExpanded((prev) => !prev)}
              aria-expanded={isUsersExpanded}
              className="min-h-[38px] text-xs font-medium text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] gap-1 px-2.5"
            >
              <span>{isUsersExpanded ? "Tutup Rekap" : "Buka Rekap"}</span>
              {isUsersExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>

          {isUsersExpanded && (
            <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden divide-y divide-[color:var(--ledger-hairline)]">
              {summaryData.by_user.map((userGroup) => {
                const isSelected = selectedUserId === userGroup.user_id;
                const hasPending = userGroup.pending_count > 0;
                const isReimbursedView = statusFilter === "reimbursed";

                const belanjaAmt = isReimbursedView
                  ? userGroup.belanja_reimbursed_total || 0
                  : userGroup.belanja_pending_total || 0;
                const ongkirAmt = isReimbursedView
                  ? userGroup.ongkir_reimbursed_total || 0
                  : userGroup.ongkir_pending_total || 0;
                const belanjaCnt = isReimbursedView
                  ? userGroup.belanja_reimbursed_count || 0
                  : userGroup.belanja_pending_count || 0;
                const ongkirCnt = isReimbursedView
                  ? userGroup.ongkir_reimbursed_count || 0
                  : userGroup.ongkir_pending_count || 0;
                const splitTotal = belanjaAmt + ongkirAmt;
                const mainTotal = isReimbursedView
                  ? userGroup.reimbursed_total
                  : userGroup.pending_total;

                return (
                  <div
                    key={userGroup.user_id ?? "unknown"}
                      className={cn(
                        "px-3.5 py-2 grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center transition-colors",
                        isSelected
                          ? "signal-surface-talangan"
                          : "ledger-hover-recessed"
                      )}
                    >
                      {/* Staff Identity */}
                      <div className="lg:col-span-3 flex items-center gap-2.5 min-w-0">
                        <div
                          aria-hidden="true"
                          className="w-8 h-8 rounded-lg bg-[var(--ledger-recessed)] text-[var(--signal-talangan)] text-xs font-bold flex items-center justify-center shrink-0"
                        >
                        {getInitials(userGroup.user_name)}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-semibold text-sm text-[var(--ledger-ink)] truncate">
                          {userGroup.user_name}
                        </div>
                        <div className="text-xs text-[var(--ledger-muted)] truncate">
                          {userGroup.telegram_id
                            ? `Telegram ID ${userGroup.telegram_id}`
                            : "Input Web / Kasir"}{" "}
                          ({userGroup.pending_count} pending / {userGroup.total_count} total)
                        </div>
                      </div>
                    </div>

                    {/* Inline Belanja vs Ongkir Split (No Nested Boxes) */}
                    <div className="lg:col-span-4 space-y-1.5 min-w-0">
                      {splitTotal > 0 && (
                        <div
                          aria-hidden="true"
                          className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden flex"
                        >
                          <div
                            className="h-full bg-[#5B3EAE] dark:bg-[#AD9CFF]"
                            style={{ width: `${(belanjaAmt / splitTotal) * 100}%` }}
                          />
                          <div
                            className="h-full bg-sky-600 dark:bg-sky-400"
                            style={{ width: `${(ongkirAmt / splitTotal) * 100}%` }}
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
                        <span className="inline-flex items-center gap-1 text-[var(--ledger-muted)]">
                          <ShoppingBag className="w-3 h-3 text-[var(--signal-talangan)] shrink-0" />
                          <span>Belanja:</span>
                          <strong className="font-semibold text-[var(--ledger-ink)]">
                            {formatRupiah(belanjaAmt)}
                          </strong>
                          <span className="text-[11px]">({belanjaCnt})</span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-[var(--ledger-muted)]">
                          <Truck className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                          <span>Ongkir:</span>
                          <strong className="font-semibold text-[var(--ledger-ink)]">
                            {formatRupiah(ongkirAmt)}
                          </strong>
                          <span className="text-[11px]">({ongkirCnt})</span>
                        </span>
                      </div>
                    </div>

                    {/* Primary Balance Figure */}
                    <div className="lg:col-span-2 flex items-center justify-between lg:block lg:text-right tabular-nums">
                      <span className="lg:hidden text-xs text-[var(--ledger-muted)]">
                        {isReimbursedView ? "Sudah Diganti" : "Belum Diganti"}
                      </span>
                      <div>
                        <div className="hidden lg:block text-[10px] font-medium text-[var(--ledger-muted)]">
                          {isReimbursedView ? "Sudah Diganti" : "Belum Diganti"}
                        </div>
                        <span
                          className={cn(
                            "text-sm font-bold",
                            isReimbursedView
                              ? "text-[var(--signal-cleared)]"
                              : hasPending
                              ? "text-[var(--signal-dp)]"
                              : "text-[var(--ledger-muted)]"
                          )}
                        >
                          {formatRupiah(mainTotal)}
                        </span>
                      </div>
                    </div>

                    {/* Row Actions */}
                    <div className="lg:col-span-3 flex flex-wrap items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedUserId(isSelected ? null : userGroup.user_id);
                          setPage(1);
                        }}
                        className={cn(
                          "min-h-[44px] sm:min-h-[34px] px-3 text-xs font-semibold rounded-lg ledger-press",
                          isSelected &&
                            "bg-[#5B3EAE] hover:bg-[#493091] text-white"
                        )}
                      >
                        {isSelected ? "Filter Aktif" : "Filter"}
                      </Button>

                      {hasPending && isSettleAllowed && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setUserSettleBankId(settleBankAccountId);
                            setConfirmUserGroup(userGroup);
                          }}
                          disabled={settleMutation.isPending}
                          className="min-h-[44px] sm:min-h-[34px] px-3 text-xs font-semibold rounded-lg border-amber-300 text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40 gap-1.5 ledger-press"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>Ganti Semua</span>
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
      <section aria-label="Daftar transaksi talangan" className="space-y-2">
        <LedgerStatusTabs
          tabs={statusTabsList}
          value={statusFilter}
          onChange={(next) => {
            setStatusFilter(next);
            setPage(1);
            setSelectedIds([]);
          }}
          layoutId="talangan-status-underline"
          accentClassName="bg-[var(--signal-talangan)]"
          ariaLabel="Filter status talangan"
        />

        <DataTable
          table={(isGroupedMode ? groupedTalanganTable : talanganTable) as any}
          recordCount={totalInvoicesOrItems}
          isLoading={activeIsLoading}
          searchQuery={search}
          tableLayout={{ dense: true, columnsResizable: true }}
          containerClassName="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] shadow-none overflow-hidden"
          headerClassName="border-b border-[color:var(--ledger-hairline)] p-3 sm:px-3.5 sm:py-2.5 space-y-2"
          footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
          tableWrapperClassName="hidden md:block"
          header={
            <div className="space-y-2">
              {/* Row A: Title + View Switch */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-[var(--ledger-ink)]">
                    Daftar Talangan Karyawan
                  </h3>
                  <span className="text-xs font-mono-ledger tabular-nums text-[var(--ledger-muted)]">
                    {isGroupedMode
                      ? `${totalInvoicesOrItems} invoice (${totalGroupChildItems} item)`
                      : `${totalInvoicesOrItems} item`}
                  </span>
                </div>
                <InvoiceViewModeToggle
                  mode={viewMode}
                  onChange={handleViewModeChange}
                />
              </div>

              {/* Row B: Integrated Search, Employee, Type & Period Controls */}
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
                      placeholder="Cari nama barang, toko, catatan, atau no nota..."
                      aria-label="Cari talangan"
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

                <div className="xl:col-span-2">
                  <AdaptiveSelect
                    value={selectedUserId !== null ? String(selectedUserId) : ""}
                    onValueChange={(val) => {
                      setSelectedUserId(val ? Number(val) : null);
                      setPage(1);
                    }}
                    options={userOptions}
                    placeholder="Semua Karyawan"
                    searchPlaceholder="Cari karyawan..."
                    aria-label="Filter karyawan"
                  />
                </div>

                {/* Type Segmented Control (Concentric Radius) */}
                <div className="xl:col-span-4 flex items-center min-w-0">
                  <div
                    role="group"
                    aria-label="Jenis talangan"
                    className="inline-flex w-full sm:w-auto p-0.5 rounded-lg bg-[var(--ledger-recessed)] border border-[color:var(--ledger-hairline)] text-xs font-semibold"
                  >
                    <button
                      type="button"
                      aria-pressed={talanganType === "all"}
                      onClick={() => {
                        setTalanganType("all");
                        setPage(1);
                        setSelectedIds([]);
                      }}
                      className={cn(
                        "flex-1 sm:flex-initial px-2.5 h-8 rounded-[6px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        talanganType === "all"
                          ? "bg-[var(--ledger-surface)] text-[var(--ledger-ink)] shadow-2xs"
                          : "text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      )}
                    >
                      Semua Jenis
                    </button>
                    <button
                      type="button"
                      aria-pressed={talanganType === "belanja"}
                      onClick={() => {
                        setTalanganType("belanja");
                        setPage(1);
                        setSelectedIds([]);
                      }}
                      className={cn(
                        "flex-1 sm:flex-initial px-2.5 h-8 rounded-[6px] whitespace-nowrap inline-flex items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        talanganType === "belanja"
                          ? "bg-[var(--ledger-surface)] text-[var(--signal-talangan)] shadow-2xs"
                          : "text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      )}
                    >
                      <ShoppingBag className="w-3 h-3" />
                      <span>Belanja</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={talanganType === "ongkir"}
                      onClick={() => {
                        setTalanganType("ongkir");
                        setPage(1);
                        setSelectedIds([]);
                      }}
                      className={cn(
                        "flex-1 sm:flex-initial px-2.5 h-8 rounded-[6px] whitespace-nowrap inline-flex items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        talanganType === "ongkir"
                          ? "bg-[var(--ledger-surface)] text-sky-700 dark:text-sky-300 shadow-2xs"
                          : "text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      )}
                    >
                      <Truck className="w-3 h-3" />
                      <span>Ongkir</span>
                    </button>
                  </div>
                </div>

                <div className="xl:col-span-3 flex flex-wrap items-center gap-1.5">
                  <div className="flex-1 min-w-[130px]">
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
                      aria-label="Periode talangan"
                    />
                  </div>

                  {periodMode === "month" && (
                    <>
                      <div className="w-[116px]">
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
                      <div className="w-[86px]">
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
            activeIsError ? (
              <LedgerStateBlock
                variant="error"
                title="Gagal Memuat Data Talangan"
                description="Periksa koneksi server lalu muat ulang daftar talangan."
                actions={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      isGroupedMode ? refetchGrouped() : refetchExpenses()
                    }
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
                icon={<FileCheck2 className="w-7 h-7" />}
                title="Tidak Ada Data Talangan"
                description={
                  statusFilter === "pending"
                    ? "Semua talangan karyawan pada filter ini sudah diganti."
                    : "Belum ada catatan pengeluaran talangan yang sesuai dengan filter yang Anda pilih."
                }
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
                    {onAddNewTalangan && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onAddNewTalangan}
                        className="min-h-[40px] sm:min-h-[36px] gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Input Talangan Baru</span>
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
              ? invoiceGroups.map((grp) => {
                  const summary = getInvoiceItemSummaryText(grp);
                  const selectableIds = getGroupSelectableIds(grp);
                  const allChecked =
                    selectableIds.length > 0 &&
                    selectableIds.every((id) => selectedIds.includes(id));
                  const someChecked =
                    !allChecked && selectableIds.some((id) => selectedIds.includes(id));
                  const doneItems = grp.items.filter((it) => !!it.reimbursed_at);
                  const pendingItems = grp.items.filter((it) => !it.reimbursed_at);
                  const isAllDone = grp.items.length > 0 && pendingItems.length === 0;
                  const isPartial = doneItems.length > 0 && pendingItems.length > 0;
                  const isMobileExpanded = !!mobileExpandedKeys[grp.group_key];
                  const hasOngkir = grp.items.some(isTalanganOngkirItem);
                  const hasBelanja = grp.items.some((it) => !isTalanganOngkirItem(it));
                  const firstItem = grp.items[0];
                  const rawLink =
                    grp.msg_link || grp.items.find((it) => it.msg_link)?.msg_link;
                  const tgLink = parseTelegramLink(rawLink);

                  return (
                    <div
                      key={grp.group_key}
                      className={cn(
                        "p-3 space-y-2 transition-colors",
                        allChecked && "signal-surface-talangan"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center shrink-0">
                          <Checkbox
                            checked={
                              allChecked
                                ? true
                                : someChecked
                                ? "indeterminate"
                                : false
                            }
                            onCheckedChange={() => handleToggleSelectGroup(grp)}
                            aria-label={`Pilih invoice talangan ${
                              grp.supplier || grp.user_name || grp.group_key
                            }`}
                          />
                        </div>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                {renderTalanganTypeBadge(hasOngkir, hasBelanja, true)}
                                <span className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                                  {grp.items_count} item
                                </span>
                                {grp.invoice_number && grp.invoice_number !== "-" && (
                                  <span className="font-mono-ledger text-[10px] text-[var(--ledger-muted)]">
                                    #{grp.invoice_number}
                                  </span>
                                )}
                              </div>
                              <div className="font-bold text-sm text-[var(--ledger-ink)] leading-snug">
                                {summary.title}
                                {summary.extraCount > 0 && (
                                  <span className="ml-1.5 text-xs font-semibold text-[var(--signal-talangan)]">
                                    +{summary.extraCount} item lainnya
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="font-bold text-sm text-[var(--ledger-ink)] tabular-nums">
                                {formatRupiah(grp.total_amount)}
                              </div>
                              <div className="text-[11px] text-[var(--ledger-muted)]">
                                {grp.pay_method || "Tunai"}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ledger-muted)]">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                              <span className="font-semibold text-[var(--ledger-ink)]">
                                {grp.user_name || "Web / Kasir"}
                              </span>
                              <span>{grp.supplier || "-"}</span>
                              <span className="tabular-nums">
                                {formatDateId(grp.expense_date)}
                              </span>
                            </div>
                            {tgLink?.isUrl && tgLink.url && (
                              <a
                                href={tgLink.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 underline"
                              >
                                <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                                <span>Telegram</span>
                              </a>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                            {isAllDone ? (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Sudah Diganti</span>
                              </Badge>
                            ) : isPartial ? (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-sky-800 border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-800 gap-1"
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>
                                  Sebagian ({doneItems.length}/{grp.items.length})
                                </span>
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-amber-900 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 gap-1"
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>Belum Diganti</span>
                              </Badge>
                            )}

                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isSettleAllowed && !isAllDone && (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleToggleGroupReimbursed(grp)}
                                  disabled={settleMutation.isPending}
                                  className="min-h-[44px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold ledger-press"
                                >
                                  {isPartial ? "Lunasi Sisa" : "Tandai Diganti"}
                                </Button>
                              )}
                              {onViewExpense && firstItem && grp.items.length === 1 && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={() => onViewExpense(firstItem)}
                                  className="min-h-[44px] min-w-[44px] rounded-lg"
                                  aria-label="Lihat detail talangan"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setMobileExpandedKeys((prev) => ({
                                    ...prev,
                                    [grp.group_key]: !prev[grp.group_key],
                                  }))
                                }
                                aria-expanded={isMobileExpanded}
                                className="min-h-[44px] px-3 rounded-lg text-xs font-semibold gap-1"
                              >
                                <span>
                                  {isMobileExpanded
                                    ? "Tutup"
                                    : `Rincian (${grp.items.length})`}
                                </span>
                                {isMobileExpanded ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* Indented Mobile Sub-list (Zero Inner Cards) */}
                          {isMobileExpanded && (
                            <div className="mt-1.5 pl-2.5 border-l-2 border-[color:var(--ledger-hairline)] divide-y divide-[color:var(--ledger-hairline)]">
                              {grp.items.map((item) => {
                                const isDone = !!item.reimbursed_at;
                                return (
                                  <div key={item.id} className="py-2 space-y-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="font-semibold text-xs text-[var(--ledger-ink)]">
                                          {item.item_name}
                                        </div>
                                        <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums mt-0.5">
                                          {item.category ? `${item.category}, ` : ""}
                                          {item.qty} {item.unit || "Pcs"}
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <div className="font-bold text-xs text-[var(--ledger-ink)] tabular-nums">
                                          {formatRupiah(item.total_price)}
                                        </div>
                                        <div className="text-[10px] font-semibold mt-0.5">
                                          {isDone ? (
                                            <span className="text-[var(--signal-cleared)]">
                                              Sudah Diganti
                                            </span>
                                          ) : (
                                            <span className="text-[var(--signal-dp)]">
                                              Belum Diganti
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                                      {isSettleAllowed && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={() => handleToggleReimbursed(item)}
                                          disabled={settleMutation.isPending}
                                          className="min-h-[44px] px-3 rounded-lg text-xs font-semibold text-[var(--signal-talangan)]"
                                        >
                                          {isDone ? "Batal Ganti" : "Tandai Diganti"}
                                        </Button>
                                      )}
                                      <div className="flex items-center gap-1.5 ml-auto">
                                        {onViewExpense && (
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant="outline"
                                            onClick={() => onViewExpense(item)}
                                            className="min-h-[44px] min-w-[44px] rounded-lg"
                                            aria-label={`Detail ${item.item_name}`}
                                          >
                                            <Eye className="w-4 h-4" />
                                          </Button>
                                        )}
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="outline"
                                          onClick={() => onEditExpense(item)}
                                          className="min-h-[44px] min-w-[44px] rounded-lg"
                                          aria-label={`Edit ${item.item_name}`}
                                        >
                                          <Edit2 className="w-4 h-4" />
                                        </Button>
                                        {canDelete && (
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant="outline"
                                            onClick={() => setConfirmDeleteId(item.id)}
                                            disabled={deletingId === item.id}
                                            className="min-h-[44px] min-w-[44px] rounded-lg text-[var(--signal-unpaid)]"
                                            aria-label={`Hapus ${item.item_name}`}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              <div className="pt-2">
                                <InvoiceFeeFooter group={grp} compact />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              : expenses.map((e) => {
                  const isChecked = selectedIds.includes(e.id);
                  const isReimbursed = !!e.reimbursed_at;
                  const isOngkir = isTalanganOngkirItem(e);
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "p-3 space-y-2 transition-colors",
                        isChecked && "signal-surface-talangan"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center shrink-0">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => handleToggleSelect(e.id)}
                            aria-label={`Pilih talangan ${e.item_name}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                {renderTalanganTypeBadge(isOngkir, !isOngkir, true)}
                                {e.category && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0"
                                  >
                                    {e.category}
                                  </Badge>
                                )}
                              </div>
                              <div className="font-bold text-sm text-[var(--ledger-ink)]">
                                {e.item_name}
                              </div>
                              <div className="text-xs text-[var(--ledger-muted)] mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                                <span className="font-semibold text-[var(--ledger-ink)]">
                                  {e.user_name || "Web / Kasir"}
                                </span>
                                <span>{e.supplier || "-"}</span>
                                <span className="tabular-nums">
                                  {formatDateId(e.expense_date)}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-sm text-[var(--ledger-ink)] tabular-nums">
                                {formatRupiah(e.total_price)}
                              </div>
                              <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                                {e.qty} {e.unit || "Pcs"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                            {isReimbursed ? (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-emerald-800 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800 gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Sudah Diganti</span>
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-amber-900 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 gap-1"
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>Belum Diganti</span>
                              </Badge>
                            )}

                            <div className="flex items-center gap-1.5 ml-auto">
                              {isSettleAllowed && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isReimbursed ? "outline" : "default"}
                                  onClick={() => handleToggleReimbursed(e)}
                                  disabled={settleMutation.isPending}
                                  className={
                                    isReimbursed
                                      ? "min-h-[44px] px-3 rounded-lg text-xs"
                                      : "min-h-[44px] px-3 rounded-lg text-xs bg-emerald-700 hover:bg-emerald-800 text-white ledger-press"
                                  }
                                >
                                  {isReimbursed ? "Batal Ganti" : "Tandai Diganti"}
                                </Button>
                              )}
                              {onViewExpense && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={() => onViewExpense(e)}
                                  className="min-h-[44px] min-w-[44px] rounded-lg"
                                  aria-label={`Detail ${e.item_name}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                onClick={() => onEditExpense(e)}
                                className="min-h-[44px] min-w-[44px] rounded-lg"
                                aria-label={`Edit ${e.item_name}`}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              {canDelete && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={() => setConfirmDeleteId(e.id)}
                                  disabled={deletingId === e.id}
                                  className="min-h-[44px] min-w-[44px] rounded-lg text-[var(--signal-unpaid)]"
                                  aria-label={`Hapus ${e.item_name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
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
        itemLabel="talangan"
        totalAmount={selectedNominal}
        totalLabel="Total Penggantian:"
        bankAccounts={bankAccounts}
        bankAccountId={settleBankAccountId}
        onBankAccountChange={setSettleBankAccountId}
        blockedMessage={
          !isSettleAllowed
            ? "Persetujuan pelunasan hanya oleh Owner"
            : undefined
        }
        primaryAction={{
          label: `Tandai Sudah Diganti (${selectedIds.length})`,
          onClick: () => handleBatchSettle("mark_reimbursed"),
          disabled: settleMutation.isPending,
          className: "bg-emerald-700 hover:bg-emerald-800 text-white",
          icon: <CheckCheck className="w-4 h-4" />,
        }}
        secondaryAction={{
          label: "Batal Ganti",
          onClick: () => handleBatchSettle("unmark"),
          disabled: settleMutation.isPending,
          icon: <Undo2 className="w-4 h-4" />,
        }}
        onClear={() => setSelectedIds([])}
      />

      {/* 6. Accessible Confirmation Dialogs */}
      <LedgerConfirmDialog
        open={Boolean(confirmUserGroup)}
        onOpenChange={(open) => {
          if (!open) setConfirmUserGroup(null);
        }}
        title="Ganti Seluruh Talangan Karyawan?"
        description={
          confirmUserGroup
            ? `Ganti semua ${confirmUserGroup.pending_count} talangan milik ${
                confirmUserGroup.user_name
              } senilai ${formatRupiah(confirmUserGroup.pending_total)}?`
            : ""
        }
        confirmLabel="Ya, Tandai Diganti"
        confirmVariant="cleared"
        isPending={settleMutation.isPending}
        bankAccounts={bankAccounts}
        bankAccountId={userSettleBankId}
        onBankAccountChange={setUserSettleBankId}
        onConfirm={executeSettleUserPending}
      />

      <LedgerConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title="Hapus Catatan Talangan?"
        description="Tindakan ini menghapus catatan talangan terpilih dari daftar pengeluaran."
        confirmLabel="Hapus Talangan"
        confirmVariant="destructive"
        onConfirm={executeDeleteExpense}
      />
    </div>
  );
};
