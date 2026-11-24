import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, settleReimbursements, getReimbursementSummary, getBankAccounts, getGroupedExpenses } from "@/lib/api";
import { Expense, ExpenseInvoiceGroup, ExpenseInvoiceListResponse, ExpenseUser, ReimbursementSummaryResponse, ReimbursementUserSummary } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import {
  ExpenseViewMode,
  InvoiceFeeFooter,
  InvoiceViewModeToggle,
  getInvoiceItemSummaryText,
} from "@/components/common/InvoiceGroupShared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DataTable } from "@/components/common/DataTable";
import {
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef, ExpandedState, PaginationState, useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  HandCoins,
  CheckCircle2,
  Clock,
  Search,
  RotateCcw,
  Plus,
  Trash2,
  Edit2,
  Eye,
  ExternalLink,
  Users,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Calendar,
  AlertCircle,
  FileCheck2,
  Filter,
  CheckCheck,
  Undo2,
  Receipt,
  Wallet,
  Truck,
  ShoppingBag,
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

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

type PeriodMode = "all" | "month" | "custom";

const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

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
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "reimbursed">("pending");
  // Default "all" agar owner bisa langsung lihat seluruh talangan tertunda
  const [periodMode, setPeriodMode] = useState<PeriodMode>("all");
  const [customStart, setCustomStart] = useState<string>(() => toIsoDate(new Date(currentYear, currentMonth - 1, 1)));
  const [customEnd, setCustomEnd] = useState<string>(() => toIsoDate(new Date()));
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedMonthEnd, setSelectedMonthEnd] = useState<number>(currentMonthEnd || currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [talanganType, setTalanganType] = useState<"all" | "belanja" | "ongkir">("all");
  const [viewMode, setViewMode] = useState<ExpenseViewMode>("grouped");
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [mobileExpandedKeys, setMobileExpandedKeys] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);

  const isGroupedMode = viewMode === "grouped";

  React.useEffect(() => {
    setSelectedMonth(currentMonth);
    setSelectedMonthEnd(currentMonthEnd || currentMonth);
    setSelectedYear(currentYear);
  }, [currentMonth, currentMonthEnd, currentYear]);

  // Selection states for batch action
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [settleBankAccountId, setSettleBankAccountId] = useState<string>("");

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", "active"],
    queryFn: () => getBankAccounts(true),
  });
  const [isUsersExpanded, setIsUsersExpanded] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleViewModeChange = (nextMode: ExpenseViewMode) => {
    setViewMode(nextMode);
    setPage(1);
    setExpanded({});
    setMobileExpandedKeys({});
    setSelectedIds([]);
  };

  // Parameter periode efektif yang dikirim ke API
  const isCustomRangeInvalid =
    periodMode === "custom" && !!customStart && !!customEnd && customStart > customEnd;
  const rangeStart = periodMode === "custom" && !isCustomRangeInvalid ? customStart || null : null;
  const rangeEnd = periodMode === "custom" && !isCustomRangeInvalid ? customEnd || null : null;
  const monthParam = periodMode === "month" ? selectedMonth : null;
  const monthEndParam = periodMode === "month" ? selectedMonthEnd : null;
  const yearParam = periodMode === "month" ? selectedYear : null;

  // 1. Fetch Ringkasan Talangan (Summary KPI + User breakdown)
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
  } = useQuery<ReimbursementSummaryResponse>({
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

  // 2. Fetch Data Talangan Terpaginasi (Flat & Grouped Per Invoice)
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
      search,
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

      if (search.trim()) {
        params.append("search", search.trim());
      }

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
  });

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
      search,
      talanganType,
    ],
    enabled: !isCustomRangeInvalid && isGroupedMode,
    queryFn: () => {
      return getGroupedExpenses({
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
        search: search.trim() || undefined,
      });
    },
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

  const isTalanganOngkirItem = (e: Expense) =>
    (e.category || "").toLowerCase() === "ongkir" ||
    (e.item_name || "").toLowerCase().startsWith("ongkir") ||
    Boolean(
      e.supplier &&
        ["gosend", "grabexpress", "lalamove", "maxim", "sicepat", "j&t"].some((k) =>
          e.supplier!.toLowerCase().includes(k)
        )
    );

  // 3. Settle Mutation (Mark / Unmark Reimbursed)
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
        toast.success(`Berhasil menandai ${data.updated_count} talangan telah diganti!`);
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
        });
      } else {
        toast.info(`Status penggantian ${data.updated_count} talangan dibatalkan.`);
      }
      setSelectedIds([]);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memproses status talangan.");
    },
  });

  // Handle single item settlement toggle
  const handleToggleReimbursed = (expense: Expense) => {
    if (!isSettleAllowed) {
      toast.error("Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan.");
      return;
    }
    const isCurrentlyReimbursed = !!expense.reimbursed_at;
    const action = isCurrentlyReimbursed ? "unmark" : "mark_reimbursed";
    settleMutation.mutate({
      expense_ids: [expense.id],
      action,
      bank_account_id: action === "mark_reimbursed" && settleBankAccountId ? Number(settleBankAccountId) : undefined,
    });
  };

  // Handle invoice-group settlement toggle (pays all pending items in invoice, or unmarks all if already settled)
  const handleToggleGroupReimbursed = (group: ExpenseInvoiceGroup) => {
    if (!isSettleAllowed) {
      toast.error("Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan.");
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

  // Handle settle all for a specific user
  const handleSettleUserPending = (userGroup: ReimbursementUserSummary) => {
    if (!isSettleAllowed) {
      toast.error("Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan.");
      return;
    }
    if (userGroup.pending_count === 0) return;
    const confirmMsg = `Ganti semua ${userGroup.pending_count} talangan milik ${userGroup.user_name} senilai ${formatRupiah(userGroup.pending_total)}?`;
    if (!window.confirm(confirmMsg)) return;

    // Ambil semua expense pending milik user ini dari query expenses atau fetch
    const typeParam = talanganType !== "belanja" ? `&include_ongkir=true&talangan_type=${talanganType}` : `&talangan_type=belanja`;
    api
      .get(`/expenses?is_reimbursement=true&reimbursed_status=pending&special_type=talangan&user_id=${userGroup.user_id ?? ""}&per_page=100${typeParam}`)
      .then((res) => {
        const ids = (res.data?.data || []).map((e: Expense) => e.id);
        if (ids.length === 0) {
          toast.error("Tidak ada item talangan pending yang dapat diproses.");
          return;
        }
        settleMutation.mutate({
          expense_ids: ids,
          action: "mark_reimbursed",
        });
      })
      .catch(() => {
        toast.error("Gagal mengambil data talangan user.");
      });
  };

  const getGroupSelectableIds = (group: ExpenseInvoiceGroup): number[] => {
    if (statusFilter !== "reimbursed") {
      const pendingIds = group.items.filter((it) => !it.reimbursed_at).map((it) => it.id);
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

  // Handle batch selection
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(allVisibleSelectableIds);
    } else {
      setSelectedIds([]);
    }
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
      const merged = new Set([...prev, ...ids]);
      return Array.from(merged);
    });
  };

  const handleBatchSettle = (action: "mark_reimbursed" | "unmark") => {
    if (!isSettleAllowed) {
      toast.error("Akses ditolak: Admin Input tidak memiliki izin untuk menyetujui penggantian talangan.");
      return;
    }
    if (selectedIds.length === 0) return;
    settleMutation.mutate({
      expense_ids: selectedIds,
      action,
      bank_account_id: action === "mark_reimbursed" && settleBankAccountId ? Number(settleBankAccountId) : undefined,
    });
  };

  // Total nominal selected
  const selectedNominal = useMemo(() => {
    const sourceItems = isGroupedMode
      ? invoiceGroups.flatMap((grp) => grp.items)
      : expenses;
    const selectedSet = new Set(selectedIds);
    return sourceItems
      .filter((e) => selectedSet.has(e.id))
      .reduce((sum, e) => sum + (e.total_price || 0), 0);
  }, [isGroupedMode, invoiceGroups, expenses, selectedIds]);

  // Handle delete confirmation
  const handleDelete = (id: number) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus catatan talangan ini?")) {
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
              onCheckedChange={handleSelectAll}
              aria-label="Pilih semua di halaman ini"
            />
          </div>
        ),
        cell: ({ row }) => {
          const e = row.original;
          const isChecked = selectedIds.includes(e.id);
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => handleToggleSelect(e.id)}
                aria-label={`Pilih talangan #${e.id}`}
              />
            </div>
          );
        },
        size: 44,
        enableSorting: false,
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="whitespace-nowrap text-slate-700 dark:text-slate-300">
              <span className="font-medium">{formatDateId(e.expense_date)}</span>
              <div className="text-[10px] text-slate-400">ID #{e.id}</div>
            </div>
          );
        },
        size: 110,
      },
      {
        accessorKey: "user_name",
        id: "user_name",
        header: ({ column }) => <DataGridColumnHeader title="Karyawan" column={column} />,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 text-[10px] font-bold">
                <AvatarFallback>{getInitials(e.user_name || "HC")}</AvatarFallback>
              </Avatar>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[120px]">
                {e.user_name || "Web / Kasir"}
              </span>
            </div>
          );
        },
        size: 150,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Barang / Keperluan" column={column} />
        ),
        cell: ({ row }) => {
          const e = row.original;
          const isOngkir =
            (e.category || "").toLowerCase() === "ongkir" ||
            (e.item_name || "").toLowerCase().startsWith("ongkir") ||
            (e.supplier && ["gosend", "grabexpress", "lalamove", "maxim", "sicepat", "j&t"].some(k => e.supplier.toLowerCase().includes(k)));
          return (
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight flex items-center gap-1.5 flex-wrap">
                {isOngkir ? (
                  <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                    <Truck className="w-2.5 h-2.5 text-sky-600 dark:text-sky-400" />
                    Ongkir Kurir
                  </Badge>
                ) : (
                  <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                    <ShoppingBag className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                    Belanja
                  </Badge>
                )}
                <span>{e.item_name}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {e.category && (
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 font-medium text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                  >
                    {e.category}
                  </Badge>
                )}
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {e.qty} {e.unit || "Pcs"}
                </span>
              </div>
            </div>
          );
        },
        size: 230,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => <DataGridColumnHeader title="Toko / Supplier" column={column} />,
        cell: ({ row }) => (
          <span className="truncate block max-w-[130px] text-slate-600 dark:text-slate-400">
            {row.original.supplier || "-"}
          </span>
        ),
        size: 135,
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
              <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatRupiah(e.total_price)}
              </div>
              <div className="text-[10px] text-slate-400">{e.pay_method || "Tunai"}</div>
            </div>
          );
        },
        size: 120,
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
                className="text-[10px] font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 gap-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Sudah Diganti</span>
              </Badge>
              {e.reimbursed_at && (
                <div className="text-[10px] text-slate-400 tabular-nums">
                  {formatDateId(e.reimbursed_at)}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1 whitespace-nowrap">
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1"
              >
                <Clock className="w-3 h-3" />
                <span>Belum Diganti</span>
              </Badge>
              {isSettleAllowed && (
                <button
                  type="button"
                  onClick={() => handleToggleReimbursed(e)}
                  disabled={settleMutation.isPending}
                  className="text-[10px] font-semibold text-purple-700 hover:text-purple-800 dark:text-purple-300 underline block"
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
        id: "notes",
        header: () => <span>Ket / Nota</span>,
        cell: ({ row }) => {
          const e = row.original;
          const tgLink = parseTelegramLink(e.msg_link);
          return (
            <div className="text-slate-500 dark:text-slate-400">
              {e.invoice_number && e.invoice_number !== "-" && (
                <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                  #{e.invoice_number}
                </div>
              )}
              <span className="truncate block max-w-[125px] text-[11px]">
                {e.notes && e.notes !== "-" ? e.notes : "-"}
              </span>
              {tgLink?.isUrl && tgLink.url && (
                <a
                  href={tgLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline mt-0.5"
                >
                  <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                  <span>Telegram</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
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
          const e = row.original;
          return (
            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
              {onViewExpense && (
                <button
                  type="button"
                  onClick={() => onViewExpense(e)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
                  title="Lihat Detail Nota"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onEditExpense(e)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors"
                title="Edit Data"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  disabled={deletingId === e.id}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50"
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        },
        size: 110,
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
    state: {
      pagination: talanganPagination,
    },
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
                aria-label={isExpanded ? "Tutup rincian item talangan" : "Lihat rincian item talangan"}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-600"
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
        size: 40,
        enableSorting: false,
        meta: {
          expandedContent: (group: ExpenseInvoiceGroup) => (
            <div className="bg-slate-50/90 dark:bg-slate-900/70 px-4 sm:px-6 py-3 border-t border-slate-200/70 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Receipt className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" />
                  <span>Rincian Item Talangan ({group.items.length} item)</span>
                  {group.invoice_number && group.invoice_number !== "-" && (
                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                      #{group.invoice_number}
                    </Badge>
                  )}
                  {group.group_key.startsWith("grp:") && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-purple-700 border-purple-200 dark:text-purple-300 dark:border-purple-800">
                      Grup Multi-Item
                    </Badge>
                  )}
                  {group.group_key.startsWith("tg:") && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-sky-700 border-sky-200 dark:text-sky-300 dark:border-sky-800">
                      Grup Telegram
                    </Badge>
                  )}
                </div>
                {isSettleAllowed && group.items.some((it) => !it.reimbursed_at) && group.items.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleToggleGroupReimbursed(group)}
                    disabled={settleMutation.isPending}
                    className="h-7 text-[11px] rounded-lg px-2.5 font-semibold text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800"
                  >
                    Tandai Semua Diganti
                  </Button>
                )}
              </div>

              <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-950/60 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/60">
                      <th className="text-left py-2 px-3">Barang / Keperluan</th>
                      <th className="text-left py-2 px-3">Kategori</th>
                      <th className="text-right py-2 px-3">Qty</th>
                      <th className="text-right py-2 px-3">Harga</th>
                      <th className="text-left py-2 px-3">Status Ganti</th>
                      <th className="text-center py-2 px-3">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.items.map((item) => {
                      const itemOngkir = isTalanganOngkirItem(item);
                      const isDone = !!item.reimbursed_at;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                              {itemOngkir ? (
                                <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                                  <Truck className="w-2.5 h-2.5" />
                                  Ongkir
                                </Badge>
                              ) : (
                                <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                                  <ShoppingBag className="w-2.5 h-2.5" />
                                  Belanja
                                </Badge>
                              )}
                              <span>{item.item_name}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                            {item.category || "-"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {item.qty} {item.unit || "Pcs"}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatRupiah(item.total_price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {isDone ? (
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Sudah Diganti</span>
                                </Badge>
                                {isSettleAllowed && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReimbursed(item)}
                                    disabled={settleMutation.isPending}
                                    className="text-[10px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 underline"
                                  >
                                    Batal
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1"
                                >
                                  <Clock className="w-3 h-3" />
                                  <span>Belum Diganti</span>
                                </Badge>
                                {isSettleAllowed && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReimbursed(item)}
                                    disabled={settleMutation.isPending}
                                    className="text-[10px] font-semibold text-purple-700 hover:text-purple-900 dark:text-purple-300 underline"
                                  >
                                    Diganti
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                              {onViewExpense && (
                                <button
                                  type="button"
                                  onClick={() => onViewExpense(item)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 dark:text-slate-400 dark:hover:text-blue-300 dark:hover:bg-blue-950/50 transition-colors"
                                  aria-label={`Lihat detail ${item.item_name}`}
                                  title="Lihat Detail Nota"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onEditExpense(item)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 dark:text-slate-400 dark:hover:text-amber-300 dark:hover:bg-amber-950/50 transition-colors"
                                aria-label={`Edit ${item.item_name}`}
                                title="Edit Data"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(item.id)}
                                  disabled={deletingId === item.id}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-300 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50"
                                  aria-label={`Hapus ${item.item_name}`}
                                  title="Hapus"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
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
                onCheckedChange={handleSelectAll}
                aria-label="Pilih semua invoice di halaman ini"
              />
            </div>
          );
        },
        cell: ({ row }) => {
          const grp = row.original;
          const selectableIds = getGroupSelectableIds(grp);
          const allChecked =
            selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
          const someChecked =
            !allChecked && selectableIds.some((id) => selectedIds.includes(id));
          return (
            <div className="flex justify-center">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={() => handleToggleSelectGroup(grp)}
                aria-label={`Pilih invoice talangan ${grp.supplier || grp.user_name || grp.group_key}`}
              />
            </div>
          );
        },
        size: 44,
        enableSorting: false,
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => {
          const grp = row.original;
          return (
            <div className="whitespace-nowrap text-slate-700 dark:text-slate-300">
              <span className="font-medium">{formatDateId(grp.expense_date)}</span>
              <div className="text-[10px] text-slate-600 dark:text-slate-400">
                {grp.items_count > 1 ? `${grp.items_count} item` : `ID #${grp.items[0]?.id ?? "-"}`}
              </div>
            </div>
          );
        },
        size: 112,
      },
      {
        accessorKey: "user_name",
        id: "user_name",
        header: ({ column }) => <DataGridColumnHeader title="Karyawan" column={column} />,
        cell: ({ row }) => {
          const grp = row.original;
          return (
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 text-[10px] font-bold">
                <AvatarFallback>{getInitials(grp.user_name || "HC")}</AvatarFallback>
              </Avatar>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[120px]">
                {grp.user_name || "Web / Kasir"}
              </span>
            </div>
          );
        },
        size: 150,
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
              <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight flex items-center gap-1.5 flex-wrap">
                {hasOngkir && !hasBelanja ? (
                  <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                    <Truck className="w-2.5 h-2.5 text-sky-600 dark:text-sky-400" />
                    Ongkir Kurir
                  </Badge>
                ) : hasOngkir && hasBelanja ? (
                  <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                    <Receipt className="w-2.5 h-2.5" />
                    Belanja &amp; Ongkir
                  </Badge>
                ) : (
                  <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800 text-[9px] px-1.5 py-0 font-semibold gap-1 shrink-0">
                    <ShoppingBag className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                    Belanja
                  </Badge>
                )}
                <span className="truncate max-w-[185px]">{summary.title}</span>
                {summary.extraCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 font-semibold text-purple-700 bg-purple-50 dark:bg-purple-950/60 dark:text-purple-300"
                  >
                    +{summary.extraCount} item
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {distinctCategories.map((cat) => (
                  <Badge
                    key={cat}
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 font-medium text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                  >
                    {cat}
                  </Badge>
                ))}
                <span className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
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
        header: ({ column }) => <DataGridColumnHeader title="Toko / Supplier" column={column} />,
        cell: ({ row }) => (
          <span className="truncate block max-w-[130px] text-slate-700 dark:text-slate-300">
            {row.original.supplier || "-"}
          </span>
        ),
        size: 135,
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
          const extraFees = (grp.shipping_fee || 0) + (grp.tax || 0) + (grp.other_fee || 0);
          return (
            <div className="text-right">
              <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatRupiah(grp.total_amount)}
              </div>
              <div className="text-[10px] text-slate-600 dark:text-slate-400">
                {grp.pay_method || "Tunai"}
                {(extraFees > 0 || grp.discount > 0) && " · incl biaya/diskon"}
              </div>
            </div>
          );
        },
        size: 135,
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
                  className="text-[10px] font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Sudah Diganti</span>
                </Badge>
                {latestReimbursedAt && (
                  <div className="text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">
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
                  className="text-[10px] font-semibold text-sky-700 border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800 gap-1"
                >
                  <Clock className="w-3 h-3" />
                  <span>
                    Sebagian Diganti ({doneCount}/{totalCount})
                  </span>
                </Badge>
                <div className="text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">
                  Sisa {formatRupiah(pendingNominal)}
                </div>
                {isSettleAllowed && (
                  <button
                    type="button"
                    onClick={() => handleToggleGroupReimbursed(grp)}
                    disabled={settleMutation.isPending}
                    className="text-[10px] font-semibold text-purple-700 hover:text-purple-900 dark:text-purple-300 underline block"
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
                className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1"
              >
                <Clock className="w-3 h-3" />
                <span>Belum Diganti</span>
              </Badge>
              {isSettleAllowed && (
                <button
                  type="button"
                  onClick={() => handleToggleGroupReimbursed(grp)}
                  disabled={settleMutation.isPending}
                  className="text-[10px] font-semibold text-purple-700 hover:text-purple-900 dark:text-purple-300 underline block"
                >
                  Tandai Diganti
                </button>
              )}
            </div>
          );
        },
        size: 165,
      },
      {
        id: "notes",
        header: () => <span>Ket / Nota</span>,
        cell: ({ row }) => {
          const grp = row.original;
          const rawLink = grp.msg_link || grp.items.find((it) => it.msg_link)?.msg_link;
          const tgLink = parseTelegramLink(rawLink);
          const firstNote = grp.items.find((it) => it.notes && it.notes !== "-")?.notes;
          return (
            <div className="text-slate-600 dark:text-slate-400">
              {grp.invoice_number && grp.invoice_number !== "-" && (
                <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                  #{grp.invoice_number}
                </div>
              )}
              <span className="truncate block max-w-[125px] text-[11px]">
                {firstNote || "-"}
              </span>
              {tgLink?.isUrl && tgLink.url && (
                <a
                  href={tgLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-400 hover:underline mt-0.5"
                >
                  <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                  <span>Telegram</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
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
            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
              {onViewExpense && firstItem && (
                <button
                  type="button"
                  onClick={() => onViewExpense(firstItem)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 dark:text-slate-400 dark:hover:text-blue-300 dark:hover:bg-blue-950/50 transition-colors"
                  aria-label="Lihat detail nota"
                  title="Lihat Detail Nota"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              )}
              {isSingle && firstItem ? (
                <>
                  <button
                    type="button"
                    onClick={() => onEditExpense(firstItem)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 dark:text-slate-400 dark:hover:text-amber-300 dark:hover:bg-amber-950/50 transition-colors"
                    aria-label="Edit data"
                    title="Edit Data"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(firstItem.id)}
                      disabled={deletingId === firstItem.id}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-300 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50"
                      aria-label="Hapus item"
                      title="Hapus"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={row.getToggleExpandedHandler()}
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/40 transition-colors"
                  title="Lihat rincian item untuk edit / hapus per item"
                >
                  {isExpanded ? "Tutup" : `Item (${grp.items.length})`}
                </button>
              )}
            </div>
          );
        },
        size: 115,
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

  return (
    <div className="space-y-6">
      {/* 1. Compact Action Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Talangan Tim:
          </span>
          {summaryData && summaryData.pending_count > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
            >
              {summaryData.pending_count} Perlu Diganti
            </Badge>
          )}
        </div>

        {onAddNewTalangan && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={onAddNewTalangan}
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold h-9 px-3.5 gap-1.5 shadow-xs shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Talangan Baru</span>
            </Button>
          </div>
        )}
      </div>

      {!isSettleAllowed && (
        <div className="flex items-center gap-2.5 p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-2xl text-amber-900 dark:text-amber-200 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>Mode Lihat Talangan:</strong> Role Admin Input hanya memiliki akses untuk mencatat dan melihat data talangan. Persetujuan dan pelunasan penggantian talangan ("Ganti Semua") hanya dapat dilakukan oleh Owner / Super Admin.
          </span>
        </div>
      )}

      {/* 2. KPI Cards: Ringkasan Status Talangan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Belum Diganti (Pending) */}
        <Card
          onClick={() => {
            setStatusFilter("pending");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusFilter === "pending"
              ? "ring-2 ring-amber-500 border-amber-300 bg-amber-50/40 dark:bg-amber-950/20"
              : "hover:border-amber-300 dark:hover:border-amber-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Belum Diganti (Pending)
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                  {formatRupiah(summaryData?.pending_total || 0)}
                </div>
              )}
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {summaryData?.pending_count || 0}
                  </span>{" "}
                  nota perlu diganti
                </span>
                {(summaryData?.ongkir_pending_count || 0) > 0 && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Belanja: {formatRupiah(summaryData?.belanja_pending_total || 0)} • Ongkir: {formatRupiah(summaryData?.ongkir_pending_total || 0)}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Sudah Diganti (Selesai) */}
        <Card
          onClick={() => {
            setStatusFilter("reimbursed");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusFilter === "reimbursed"
              ? "ring-2 ring-emerald-500 border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20"
              : "hover:border-emerald-300 dark:hover:border-emerald-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Sudah Diganti (Lunas)
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatRupiah(summaryData?.reimbursed_total || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.reimbursed_count || 0}
                </span>{" "}
                nota telah diselesaikan
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Total Keseluruhan */}
        <Card
          onClick={() => {
            setStatusFilter("all");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusFilter === "all"
              ? "ring-2 ring-purple-500 border-purple-300 bg-purple-50/40 dark:bg-purple-950/20"
              : "hover:border-purple-300 dark:hover:border-purple-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Total Seluruh Talangan
              </span>
              <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(summaryData?.total_nominal || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.total_count || 0}
                </span>{" "}
                total nota tercatat
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Karyawan Terlibat */}
        <Card className="border rounded-2xl shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Karyawan Menalangi
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-16 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {summaryData?.by_user?.length || 0} Orang
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {summaryData?.by_user?.filter((u) => u.pending_count > 0).length || 0}
                </span>{" "}
                orang menunggu ganti
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Rekap Saldo Talangan per Karyawan */}
      {summaryData && summaryData.by_user && summaryData.by_user.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                Rekap Saldo Talangan per Karyawan
              </h3>
              <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-200">
                {summaryData.by_user.length} Anggota
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsUsersExpanded((prev) => !prev)}
              className="h-8 text-xs text-slate-500 hover:text-slate-800 gap-1 px-2"
            >
              <span>{isUsersExpanded ? "Tutup Rekap" : "Buka Rekap"}</span>
              {isUsersExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {isUsersExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
              {summaryData.by_user.map((userGroup) => {
                const isSelected = selectedUserId === userGroup.user_id;
                const hasPending = userGroup.pending_count > 0;

                return (
                  <div
                    key={userGroup.user_id ?? "unknown"}
                    className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                      isSelected
                        ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/30 ring-1 ring-purple-400"
                        : "border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white text-xs font-bold text-purple-700">
                          <AvatarFallback>{getInitials(userGroup.user_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {userGroup.user_name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {userGroup.telegram_id ? `@ID: ${userGroup.telegram_id}` : "Input Web / Kasir"}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUserId(isSelected ? null : userGroup.user_id);
                          setPage(1);
                        }}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                          isSelected
                            ? "bg-purple-600 text-white border-purple-600"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                        }`}
                        title="Filter data khusus karyawan ini"
                      >
                        {isSelected ? "Filter Aktif" : "Filter"}
                      </button>
                    </div>

                    <div className="bg-white dark:bg-slate-950/50 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-2.5 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 text-[11px] font-medium">
                          {statusFilter === "reimbursed" ? "Sudah Diganti:" : "Belum Diganti:"}
                        </span>
                        <span
                          className={`font-bold tabular-nums text-sm ${
                            statusFilter === "reimbursed"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : hasPending
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-slate-400"
                          }`}
                        >
                          {formatRupiah(
                            statusFilter === "reimbursed"
                              ? userGroup.reimbursed_total
                              : userGroup.pending_total
                          )}
                        </span>
                      </div>

                      {/* Rincian Keterangan Terpisah: Belanja vs Ongkir */}
                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        {/* Box Belanja */}
                        <div className="rounded-lg bg-slate-50/80 dark:bg-slate-900/60 p-2 border border-slate-200/60 dark:border-slate-800/80 flex flex-col justify-between">
                          <div className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-400 font-semibold">
                            <ShoppingBag className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
                            <span className="truncate">Belanja</span>
                          </div>
                          <div className="mt-1 font-bold text-xs text-slate-900 dark:text-slate-100 tabular-nums truncate">
                            {formatRupiah(
                              statusFilter === "reimbursed"
                                ? userGroup.belanja_reimbursed_total || 0
                                : userGroup.belanja_pending_total || 0
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {statusFilter === "reimbursed"
                              ? `${userGroup.belanja_reimbursed_count || 0} nota lunas`
                              : `${userGroup.belanja_pending_count || 0} nota pending`}
                          </div>
                        </div>

                        {/* Box Ongkir */}
                        <div className="rounded-lg bg-sky-50/60 dark:bg-sky-950/30 p-2 border border-sky-200/60 dark:border-sky-900/50 flex flex-col justify-between">
                          <div className="flex items-center gap-1 text-[10px] text-sky-800 dark:text-sky-300 font-semibold">
                            <Truck className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                            <span className="truncate">Ongkir Kurir</span>
                          </div>
                          <div className="mt-1 font-bold text-xs text-sky-950 dark:text-sky-200 tabular-nums truncate">
                            {formatRupiah(
                              statusFilter === "reimbursed"
                                ? userGroup.ongkir_reimbursed_total || 0
                                : userGroup.ongkir_pending_total || 0
                            )}
                          </div>
                          <div className="text-[10px] text-sky-700/70 dark:text-sky-400/70 mt-0.5">
                            {statusFilter === "reimbursed"
                              ? `${userGroup.ongkir_reimbursed_count || 0} trip lunas`
                              : `${userGroup.ongkir_pending_count || 0} trip pending`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                        <span>Total Riwayat Nota:</span>
                        <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                          {userGroup.pending_count} pending / {userGroup.total_count} total
                        </span>
                      </div>
                    </div>

                    {hasPending && isSettleAllowed && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSettleUserPending(userGroup)}
                        disabled={settleMutation.isPending}
                        className="w-full h-8 text-[11px] font-semibold rounded-lg border-amber-300 text-amber-800 bg-amber-50/60 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40 gap-1.5"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-amber-600" />
                        <span>Ganti Semua ({formatRupiah(userGroup.pending_total)})</span>
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
        {/* Row 1: Status Tabs & Periode */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tab Pills */}
          <div className="flex items-center gap-1.5 bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("pending");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === "pending"
                  ? "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Belum Diganti</span>
              {summaryData && summaryData.pending_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold">
                  {summaryData.pending_count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusFilter("reimbursed");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === "reimbursed"
                  ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Sudah Diganti</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === "all"
                  ? "bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <span>Semua</span>
            </button>
          </div>

          {/* Periode Controls */}
          <div className="flex flex-col items-stretch gap-1.5 md:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={periodMode}
                  onChange={(e) => {
                    setPeriodMode(e.target.value as PeriodMode);
                    setPage(1);
                    setSelectedIds([]);
                  }}
                  aria-label="Periode talangan"
                  className="h-9 pl-8 pr-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  <option value="all">Semua Waktu</option>
                  <option value="month">Bulan Tertentu</option>
                  <option value="custom">Rentang Tanggal</option>
                </select>
              </div>

              {periodMode === "month" && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedMonth}
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      setSelectedMonth(m);
                      setSelectedMonthEnd(m);
                      setPage(1);
                    }}
                    aria-label="Bulan"
                    className="h-9 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-500"
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
                    aria-label="Tahun"
                    className="h-9 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-500"
                  >
                    {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {periodMode === "custom" && (
                <DateRangePicker
                  initialDateFrom={customStart}
                  initialDateTo={customEnd}
                  onUpdate={({ range }) => {
                    if (range.from) {
                      setCustomStart(toIsoDate(range.from));
                    }
                    if (range.to) {
                      setCustomEnd(toIsoDate(range.to));
                    } else if (range.from) {
                      setCustomEnd(toIsoDate(range.from));
                    }
                    setPage(1);
                    setSelectedIds([]);
                  }}
                />
              )}
            </div>

            {isCustomRangeInvalid && (
              <p role="alert" className="text-[11px] font-medium text-red-600 dark:text-red-400">
                Tanggal awal tidak boleh setelah tanggal akhir.
              </p>
            )}
          </div>
        </div>

        {/* Row 2: Search, User Selector & Reset */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
          <div className="relative w-full sm:flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nama barang, toko, catatan, no nota..."
              className="h-9.5 pl-9 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Filter Karyawan */}
            <select
              value={selectedUserId !== null ? String(selectedUserId) : ""}
              onChange={(e) => {
                setSelectedUserId(e.target.value ? Number(e.target.value) : null);
                setPage(1);
              }}
              className="h-9.5 px-3 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden w-full sm:w-44"
            >
              <option value="">Semua Karyawan</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            {/* Filter Jenis Talangan */}
            <div className="inline-flex p-1 bg-slate-100/90 dark:bg-slate-800/80 rounded-xl text-xs font-semibold shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTalanganType("all");
                  setPage(1);
                  setSelectedIds([]);
                }}
                className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                  talanganType === "all"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
                title="Tampilkan semua talangan (Belanja dan Ongkir)"
              >
                <span>Semua Jenis</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTalanganType("belanja");
                  setPage(1);
                  setSelectedIds([]);
                }}
                className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                  talanganType === "belanja"
                    ? "bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-2xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
                title="Hanya tampilkan talangan belanja barang / operasional"
              >
                <ShoppingBag className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                <span>Belanja</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTalanganType("ongkir");
                  setPage(1);
                  setSelectedIds([]);
                }}
                className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                  talanganType === "ongkir"
                    ? "bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-2xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
                title="Hanya tampilkan talangan ongkir kurir (GoSend, GrabExpress, dsb)"
              >
                <Truck className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                <span>Ongkir</span>
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter("pending");
                setPeriodMode("all");
                setSelectedUserId(null);
                setTalanganType("all");
                setSearch("");
                setPage(1);
                setExpanded({});
                setMobileExpandedKeys({});
                setSelectedIds([]);
              }}
              title="Reset Filter"
              className="h-9.5 px-3 rounded-xl text-xs text-slate-600 hover:text-slate-900 border-slate-200 shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 5. Batch Action Toolbar (muncul jika ada item yang dicentang) */}
      {selectedIds.length > 0 && (
        <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 text-xs text-purple-900 dark:text-purple-200">
            <span className="font-bold bg-purple-200 dark:bg-purple-900/60 px-2 py-0.5 rounded-md tabular-nums">
              {selectedIds.length}
            </span>
            <span>item talangan dipilih</span>
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              ({formatRupiah(selectedNominal)})
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {!isSettleAllowed ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium px-2.5 py-1 bg-amber-50 dark:bg-amber-950/50 rounded-lg border border-amber-200 dark:border-amber-900">
                Persetujuan pelunasan hanya oleh Owner
              </span>
            ) : (
              <>
                {bankAccounts.length > 0 && (
                  <select
                    value={settleBankAccountId}
                    onChange={(e) => setSettleBankAccountId(e.target.value)}
                    className="h-8.5 rounded-xl border border-slate-200 bg-white text-slate-800 px-2.5 text-xs font-medium"
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
                  onClick={() => handleBatchSettle("mark_reimbursed")}
                  disabled={settleMutation.isPending}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold h-8.5 px-3.5 gap-1.5 shadow-xs"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Tandai Sudah Diganti</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBatchSettle("unmark")}
                  disabled={settleMutation.isPending}
                  className="rounded-xl text-xs font-semibold h-8.5 px-3.5 gap-1.5 text-slate-700 dark:text-slate-300"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Batal Ganti</span>
                </Button>
              </>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
              className="h-8.5 text-xs text-slate-600 hover:text-slate-900 px-2.5"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* 6. Data Table / Mobile Invoice Cards */}
      {activeIsError && !activeIsLoading ? (
        <Card className="border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 rounded-2xl">
          <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
                  Gagal memuat data talangan
                </p>
                <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                  Periksa koneksi server lalu coba muat ulang daftar talangan.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <InvoiceViewModeToggle mode={viewMode} onChange={handleViewModeChange} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (isGroupedMode ? refetchGrouped() : refetchExpenses())}
                className="min-h-[44px] sm:min-h-0 h-9 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border-rose-200 text-rose-800 hover:bg-rose-100"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Muat Ulang
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          table={(isGroupedMode ? groupedTalanganTable : talanganTable) as any}
          recordCount={totalInvoicesOrItems}
          isLoading={activeIsLoading}
          scrollAreaClassName="min-h-[260px]"
          tableWrapperClassName="hidden md:block"
          header={
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  Daftar Talangan Karyawan
                </span>
                <Badge variant="secondary" className="text-xs tabular-nums font-semibold">
                  {isGroupedMode
                    ? `${totalInvoicesOrItems} invoice (${totalGroupChildItems} item)`
                    : `${totalInvoicesOrItems} item`}
                </Badge>
              </div>
              <InvoiceViewModeToggle mode={viewMode} onChange={handleViewModeChange} />
            </div>
          }
          emptyState={
            <div className="py-10 text-center px-4 space-y-5">
              <div className="flex justify-center">
                <InvoiceViewModeToggle mode={viewMode} onChange={handleViewModeChange} />
              </div>
              <div className="flex flex-col items-center justify-center gap-2.5 max-w-sm mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 flex items-center justify-center">
                  <FileCheck2 className="w-6 h-6" />
                </div>
                <div className="font-bold text-sm text-slate-800 dark:text-slate-200">
                  Tidak Ada Data Talangan
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 text-center">
                  {statusFilter === "pending"
                    ? "Hebat! Semua talangan karyawan pada filter ini sudah diganti lunas."
                    : "Belum ada catatan pengeluaran talangan yang sesuai dengan filter yang Anda pilih."}
                </p>
                {onAddNewTalangan && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onAddNewTalangan}
                    className="mt-2 text-xs rounded-xl min-h-[44px] sm:min-h-0 h-9 gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Input Talangan Baru</span>
                  </Button>
                )}
              </div>
            </div>
          }
        >
          {/* Mobile Reflow Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
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
                    <div key={grp.group_key} className="p-3.5 space-y-3 bg-white dark:bg-slate-950">
                      <div className="flex items-start gap-2.5">
                        <div className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center shrink-0">
                          <Checkbox
                            checked={allChecked ? true : someChecked ? "indeterminate" : false}
                            onCheckedChange={() => handleToggleSelectGroup(grp)}
                            aria-label={`Pilih invoice talangan ${grp.supplier || grp.user_name || grp.group_key}`}
                          />
                        </div>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                {hasOngkir && !hasBelanja ? (
                                  <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 text-[10px] px-1.5 py-0 font-semibold gap-1">
                                    <Truck className="w-2.5 h-2.5" />
                                    Ongkir
                                  </Badge>
                                ) : hasOngkir && hasBelanja ? (
                                  <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 text-[10px] px-1.5 py-0 font-semibold gap-1">
                                    <Receipt className="w-2.5 h-2.5" />
                                    Belanja &amp; Ongkir
                                  </Badge>
                                ) : (
                                  <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 text-[10px] px-1.5 py-0 font-semibold gap-1">
                                    <ShoppingBag className="w-2.5 h-2.5" />
                                    Belanja
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 tabular-nums">
                                  {grp.items_count} item
                                </Badge>
                                {grp.invoice_number && grp.invoice_number !== "-" && (
                                  <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                                    #{grp.invoice_number}
                                  </span>
                                )}
                              </div>
                              <div className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                                {summary.title}
                                {summary.extraCount > 0 && (
                                  <span className="ml-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                                    +{summary.extraCount} item lainnya
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="font-bold text-sm text-slate-950 dark:text-white tabular-nums">
                                {formatRupiah(grp.total_amount)}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                {grp.pay_method || "Tunai"}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {grp.user_name || "Web / Kasir"}
                              </span>
                              <span>·</span>
                              <span>{grp.supplier || "-"}</span>
                              <span>·</span>
                              <span className="tabular-nums">{formatDateId(grp.expense_date)}</span>
                            </div>
                            {tgLink?.isUrl && tgLink.url && (
                              <a
                                href={tgLink.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-400 underline"
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
                                className="text-[11px] font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Sudah Diganti</span>
                              </Badge>
                            ) : isPartial ? (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-sky-700 border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800 gap-1"
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>
                                  Sebagian ({doneItems.length}/{grp.items.length})
                                </span>
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1"
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
                                  className="min-h-[44px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                                >
                                  {isPartial ? "Lunasi Sisa" : "Tandai Diganti"}
                                </Button>
                              )}
                              {onViewExpense && firstItem && grp.items.length === 1 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onViewExpense(firstItem)}
                                  className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl text-slate-700 dark:text-slate-300"
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
                                className="min-h-[44px] px-3 rounded-xl text-xs font-semibold gap-1"
                              >
                                <span>{isMobileExpanded ? "Tutup" : `Rincian (${grp.items.length})`}</span>
                                {isMobileExpanded ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>

                          {isMobileExpanded && (
                            <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 p-3 space-y-2.5">
                              <div className="space-y-2">
                                {grp.items.map((item) => {
                                  const isDone = !!item.reimbursed_at;
                                  return (
                                    <div
                                      key={item.id}
                                      className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 p-2.5 space-y-2"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                                            {item.item_name}
                                          </div>
                                          <div className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums mt-0.5">
                                            {item.category ? `${item.category} · ` : ""}
                                            {item.qty} {item.unit || "Pcs"}
                                          </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <div className="font-bold text-xs text-slate-900 dark:text-slate-100 tabular-nums">
                                            {formatRupiah(item.total_price)}
                                          </div>
                                          <div className="text-[10px] font-semibold mt-0.5">
                                            {isDone ? (
                                              <span className="text-emerald-700 dark:text-emerald-400">
                                                Sudah Diganti
                                              </span>
                                            ) : (
                                              <span className="text-amber-700 dark:text-amber-400">
                                                Belum Diganti
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                                        {isSettleAllowed && (
                                          <button
                                            type="button"
                                            onClick={() => handleToggleReimbursed(item)}
                                            disabled={settleMutation.isPending}
                                            className="min-h-[44px] px-2.5 text-xs font-semibold text-purple-700 dark:text-purple-300 underline"
                                          >
                                            {isDone ? "Batal Ganti" : "Tandai Diganti"}
                                          </button>
                                        )}
                                        <div className="flex items-center gap-1 ml-auto">
                                          {onViewExpense && (
                                            <button
                                              type="button"
                                              onClick={() => onViewExpense(item)}
                                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300"
                                              aria-label={`Detail ${item.item_name}`}
                                            >
                                              <Eye className="w-4 h-4" />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => onEditExpense(item)}
                                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-300"
                                            aria-label={`Edit ${item.item_name}`}
                                          >
                                            <Edit2 className="w-4 h-4" />
                                          </button>
                                          {canDelete && (
                                            <button
                                              type="button"
                                              onClick={() => handleDelete(item.id)}
                                              disabled={deletingId === item.id}
                                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-300 disabled:opacity-50"
                                              aria-label={`Hapus ${item.item_name}`}
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <InvoiceFeeFooter group={grp} compact />
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
                    <div key={e.id} className="p-3.5 space-y-2.5 bg-white dark:bg-slate-950">
                      <div className="flex items-start gap-2.5">
                        <div className="min-h-[44px] min-w-[44px] -ml-2 -mt-2 flex items-center justify-center shrink-0">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => handleToggleSelect(e.id)}
                            aria-label={`Pilih talangan ${e.item_name}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                {isOngkir ? (
                                  <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 text-[10px] px-1.5 py-0 font-semibold">
                                    Ongkir Kurir
                                  </Badge>
                                ) : (
                                  <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 text-[10px] px-1.5 py-0 font-semibold">
                                    Belanja
                                  </Badge>
                                )}
                                {e.category && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    {e.category}
                                  </Badge>
                                )}
                              </div>
                              <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                {e.item_name}
                              </div>
                              <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                                {e.user_name || "Web / Kasir"} · {e.supplier || "-"} ·{" "}
                                {formatDateId(e.expense_date)}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-sm text-slate-950 dark:text-white tabular-nums">
                                {formatRupiah(e.total_price)}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                                {e.qty} {e.unit || "Pcs"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                            {isReimbursed ? (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Sudah Diganti</span>
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1"
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>Belum Diganti</span>
                              </Badge>
                            )}

                            <div className="flex items-center gap-1 ml-auto">
                              {isSettleAllowed && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isReimbursed ? "outline" : "default"}
                                  onClick={() => handleToggleReimbursed(e)}
                                  disabled={settleMutation.isPending}
                                  className={
                                    isReimbursed
                                      ? "min-h-[44px] px-3 rounded-xl text-xs"
                                      : "min-h-[44px] px-3 rounded-xl text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                                  }
                                >
                                  {isReimbursed ? "Batal Ganti" : "Tandai Diganti"}
                                </Button>
                              )}
                              {onViewExpense && (
                                <button
                                  type="button"
                                  onClick={() => onViewExpense(e)}
                                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300"
                                  aria-label={`Detail ${e.item_name}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onEditExpense(e)}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-600 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-300"
                                aria-label={`Edit ${e.item_name}`}
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(e.id)}
                                  disabled={deletingId === e.id}
                                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-300 disabled:opacity-50"
                                  aria-label={`Hapus ${e.item_name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
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
      )}
    </div>
  );
};
