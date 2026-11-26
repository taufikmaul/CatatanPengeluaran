import React, { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Expense, MonthlyReport } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  LedgerMetricStrip,
  LedgerStateBlock,
  LedgerStatusTabs,
} from "@/components/common/LedgerPrimitives";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/common/DataTable";
import { SearchMinCharHint } from "@/components/common/HighlightText";
import { getEffectiveSearchQuery } from "@/lib/searchHighlight";
import {
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { Filters } from "@/components/reui/filters/filters";
import type { FilterField, FilterQuery, FilterNode } from "@/components/reui/filters/filters-types";
import { createFilterQuery, createFilterRule, isFilterRule } from "@/components/reui/filters/filters-query";
import { ColumnDef, useTable, PaginationState } from "@tanstack/react-table";
import {
  ArrowLeftRight,
  Truck,
  Search,
  RotateCcw,
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";

interface TukarCashOngkirTabProps {
  currentMonth: number;
  currentYear: number;
  currentMonthEnd?: number;
  reportData?: MonthlyReport;
  initialType?: "all" | "tukar_cash" | "ongkir";
  onEditExpense: (expense: Expense) => void;
  onViewExpense?: (expense: Expense) => void;
  onToggleStatus: (expense: Expense) => void;
  onDeleteExpense: (id: number) => void;
  onAddNewExpense?: (type: "ongkir" | "tukar_cash") => void;
  canDelete?: boolean;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export const TukarCashOngkirTab: React.FC<TukarCashOngkirTabProps> = ({
  currentMonth,
  currentYear,
  currentMonthEnd,
  reportData,
  initialType = "all",
  onEditExpense,
  onViewExpense,
  onToggleStatus,
  onDeleteExpense,
  onAddNewExpense,
  canDelete = false,
}) => {
  const [filterType, setFilterType] = useState<"all" | "tukar_cash" | "ongkir">(initialType);
  const [search, setSearch] = useState("");
  const effectiveSearch = useMemo(() => getEffectiveSearchQuery(search), [search]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedMonthEnd, setSelectedMonthEnd] = useState<number>(currentMonthEnd || currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isCouriersExpanded, setIsCouriersExpanded] = useState<boolean>(true);

  useEffect(() => {
    setSelectedMonth(currentMonth);
    setSelectedMonthEnd(currentMonthEnd || currentMonth);
    setSelectedYear(currentYear);
    setPage(1);
  }, [currentMonth, currentMonthEnd, currentYear]);

  // Fetch data secara server-side menggunakan special_type
  const specialTypeParam = filterType === "all" ? "cash_or_delivery" : filterType;

  const {
    data: expensesData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [
      "expenses-cash-delivery",
      page,
      perPage,
      selectedMonth,
      selectedMonthEnd,
      selectedYear,
      filterType,
      effectiveSearch,
      statusFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        month: String(selectedMonth),
        year: String(selectedYear),
        special_type: specialTypeParam,
      });
      if (selectedMonthEnd && selectedMonthEnd !== selectedMonth) {
        params.append("month_end", String(selectedMonthEnd));
      }
      if (effectiveSearch) params.append("search", effectiveSearch);
      if (statusFilter) params.append("status", statusFilter);

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
  });

  const expenses: Expense[] = expensesData?.data || [];
  const totalCount: number = expensesData?.total || 0;
  const totalPages: number = expensesData?.total_pages || 1;

  // Helper identifikasi tipe item
  const getItemType = (e: Expense): "tukar_cash" | "ongkir" => {
    const kat = (e.category || "").toLowerCase();
    const item = (e.item_name || "").toLowerCase();
    if (kat.includes("tukar cash") || item.includes("tukar cash") || item.includes("tarik tunai")) {
      return "tukar_cash";
    }
    return "ongkir";
  };

  const handleDelete = (id: number) => {
    if (confirm("Apakah Anda yakin ingin menghapus catatan transaksi ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
      setTimeout(() => refetch(), 500);
    }
  };

  const totalTukarCash = reportData?.total_tukar_cash || 0;
  const tukarCashCount = reportData?.tukar_cash_count || 0;
  const totalOngkir = reportData?.total_ongkir || 0;
  const ongkirCount = reportData?.ongkir_count || 0;
  const ongkirReimburseCount = reportData?.ongkir_reimburse_count || 0;
  const ongkirReimburseTotal = reportData?.ongkir_reimburse_total || 0;
  const ongkirTunaiTotal = Math.max(0, totalOngkir - ongkirReimburseTotal);

  const cashDeliveryFilterFields = useMemo<FilterField[]>(
    () => [
      {
        id: "type",
        label: "Jenis Transaksi",
        type: "select",
        options: [
          { label: "Semua Jenis", value: "all" },
          { label: "Tukar Cash", value: "tukar_cash" },
          { label: "Ongkir Kurir", value: "ongkir" },
        ],
      },
      {
        id: "status",
        label: "Status Bayar",
        type: "select",
        options: [
          { label: "Semua Status", value: "all" },
          { label: "Lunas", value: "Lunas" },
          { label: "Belum Lunas / Pending", value: "Belum Lunas" },
        ],
      },
    ],
    []
  );

  const cashDeliveryFilterQuery = useMemo(() => {
    const rules = [];
    if (filterType && filterType !== "all") {
      rules.push(createFilterRule({ id: "rule-type", path: ["type"], operator: "is", value: filterType }));
    }
    if (statusFilter && statusFilter !== "all") {
      rules.push(createFilterRule({ id: "rule-status", path: ["status"], operator: "is", value: statusFilter }));
    }
    return createFilterQuery(rules, "and");
  }, [filterType, statusFilter]);

  const handleCashDeliveryQueryChange = (nextQuery: FilterQuery) => {
    let nextType: "all" | "tukar_cash" | "ongkir" = "all";
    let nextStatus = "";
    const traverse = (nodes: FilterNode[]) => {
      for (const node of nodes) {
        if (isFilterRule(node)) {
          if (node.path[0] === "type") nextType = (String(node.value ?? "all") as "all" | "tukar_cash" | "ongkir");
          if (node.path[0] === "status") nextStatus = String(node.value ?? "");
        } else if (node.rules) {
          traverse(node.rules);
        }
      }
    };
    if (nextQuery?.rules) traverse(nextQuery.rules);
    setFilterType(nextType);
    setStatusFilter(nextStatus === "all" ? "" : nextStatus);
    setPage(1);
  };

  const cashDeliveryColumns = useMemo<ColumnDef<DataGridFeatures, Expense>[]>(
    () => [
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-[var(--ledger-muted)] whitespace-nowrap">
            {formatDateId(row.original.expense_date)}
          </span>
        ),
        size: 94,
      },
      {
        id: "type",
        header: () => <span>Jenis</span>,
        cell: ({ row }) => {
          const type = getItemType(row.original);
          const isTukar = type === "tukar_cash";
          return isTukar ? (
            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800 gap-1 text-[10px] font-semibold py-0.5 whitespace-nowrap">
              <ArrowLeftRight className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
              Tukar Cash
            </Badge>
          ) : (
            <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800 gap-1 text-[10px] font-semibold py-0.5 whitespace-nowrap">
              <Truck className="w-3 h-3 text-sky-600 dark:text-sky-400" />
              Ongkir Kurir
            </Badge>
          );
        },
        size: 112,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => <DataGridColumnHeader title="Item / Keterangan" column={column} />,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div
              className="cursor-pointer group/item"
              onClick={() => onViewExpense?.(e)}
            >
              <div className="font-semibold text-[var(--ledger-ink)] group-hover/item:text-blue-600 dark:group-hover/item:text-blue-400 max-w-[190px] truncate transition-colors">
                {e.item_name}
              </div>
              {e.notes && e.notes !== "-" && (
                <div className="text-[11px] text-[var(--ledger-muted)] max-w-[190px] truncate mt-0.5">
                  {e.notes}
                </div>
              )}
              {e.invoice_number && e.invoice_number !== "-" && (
                <div className="text-[10px] font-mono text-[var(--ledger-muted)] mt-0.5">
                  Ref/Inv: {e.invoice_number}
                </div>
              )}
            </div>
          );
        },
        size: 198,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: () => <span>Supplier / Provider</span>,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[var(--ledger-ink)] font-medium">
            {row.original.supplier || "-"}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: "pay_method",
        id: "pay_method",
        header: () => <span>Metode Bayar</span>,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="whitespace-nowrap flex items-center gap-1">
              <span className="px-2 py-0.5 rounded-md bg-[var(--ledger-recessed)] text-[var(--ledger-ink)] text-[10px] font-medium">
                {e.pay_method}
              </span>
              {e.is_reimbursement && (
                <span className="px-1.5 py-0.5 rounded-md bg-[var(--signal-talangan-soft)] text-[var(--signal-talangan)] text-[9px] font-bold">
                  Reimburse
                </span>
              )}
            </div>
          );
        },
        size: 115,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: () => <div className="text-right">Nominal</div>,
        cell: ({ row }) => (
          <div className="text-right font-bold text-[var(--ledger-ink)] tabular-nums whitespace-nowrap text-xs">
            {formatRupiah(row.original.total_price)}
          </div>
        ),
        size: 104,
      },
      {
        accessorKey: "pay_status",
        id: "pay_status",
        header: () => <div className="text-center">Status</div>,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="text-center whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
              <button
                type="button"
                onClick={() => onToggleStatus(e)}
                className="inline-flex items-center gap-1 transition-opacity hover:opacity-80"
              >
                {e.pay_status === "Lunas" ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 text-[10px] gap-1 font-semibold">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    Lunas
                  </Badge>
                ) : (
                  <Badge className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 text-[10px] gap-1 font-semibold">
                    <Clock className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                    Pending
                  </Badge>
                )}
              </button>
            </div>
          );
        },
        size: 92,
      },
      {
        id: "actions",
        header: () => <div className="text-center">Aksi</div>,
        cell: ({ row }) => {
          const e = row.original;
          const tgLink = parseTelegramLink(e.msg_link);
          return (
            <div className="flex items-center justify-center gap-1" onClick={(ev) => ev.stopPropagation()}>
              {tgLink?.url && (
                <a
                  href={tgLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg text-[var(--ledger-muted)] hover:text-blue-600 dark:hover:text-blue-400 hover:bg-[var(--ledger-recessed)] transition-colors"
                  title="Buka pesan Telegram asli"
                >
                  <TelegramIcon className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => onEditExpense(e)}
                className="p-1.5 rounded-lg text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] hover:bg-[var(--ledger-recessed)] transition-colors"
                title="Edit"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  disabled={deletingId === e.id}
                  className="p-1.5 rounded-lg text-[var(--ledger-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-[var(--ledger-recessed)] transition-colors disabled:opacity-50"
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        },
        size: 80,
      },
    ],
    [canDelete, deletingId, onEditExpense, onToggleStatus, onViewExpense]
  );

  const cashDeliveryPagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: perPage,
    }),
    [page, perPage]
  );

  const cashDeliveryTable = useTable({
    features: dataGridFeatures,
    columns: cashDeliveryColumns,
    data: expenses,
    manualPagination: true,
    rowCount: totalCount,
    getRowId: (row: Expense) => String(row.id),
    state: {
      pagination: cashDeliveryPagination,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(cashDeliveryPagination) : updater;
      if (next.pageSize !== perPage) {
        setPerPage(next.pageSize);
        setPage(1);
      } else {
        setPage(next.pageIndex + 1);
      }
    },
  });

  const courierSummaryList = reportData?.ongkir_by_courier || [];
  const maxCourierAmount = Math.max(1, ...courierSummaryList.map((c) => c.total_amount || 0));

  return (
    <div className="space-y-3">
      {/* 1. Editorial Header Strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
            Buku Kurir &amp; Tukar Cash Kasir
          </h2>
          <p className="text-xs text-[var(--ledger-muted)] tabular-nums">
            {tukarCashCount + ongkirCount} transaksi tercatat •{" "}
            {courierSummaryList.length} layanan kurir aktif pada{" "}
            {MONTH_NAMES[(selectedMonth || 1) - 1] || ""} {selectedYear}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
          {onAddNewExpense && (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => onAddNewExpense("ongkir")}
                className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 rounded-lg text-xs h-9 px-3 font-semibold gap-1.5 ledger-press"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>+ Ongkir</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onAddNewExpense("tukar_cash")}
                className="rounded-lg text-xs h-9 px-3 font-semibold gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)] ledger-press"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>+ Tukar Cash</span>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="text-xs h-9 rounded-lg gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* 2. Unified Asymmetric Metric Strip (Zero Nested Cards) */}
      <LedgerMetricStrip
        isLoading={isLoading && !reportData}
        primary={{
          label: "Total Biaya Ongkir",
          value: formatRupiah(totalOngkir),
          subtext: `${ongkirCount} trip pengiriman kurir`,
          active: filterType === "ongkir",
          onClick: () => {
            setFilterType((prev) => (prev === "ongkir" ? "all" : "ongkir"));
            setPage(1);
          },
          segments:
            totalOngkir > 0
              ? [
                  {
                    key: "tunai",
                    label: "Tunai Kasir",
                    value: ongkirTunaiTotal,
                    displayValue: formatRupiah(ongkirTunaiTotal),
                    colorClass: "bg-emerald-600 dark:bg-emerald-400",
                  },
                  {
                    key: "reimburse",
                    label: "Ditalangi",
                    value: ongkirReimburseTotal,
                    displayValue: formatRupiah(ongkirReimburseTotal),
                    colorClass: "bg-[#5B3EAE] dark:bg-[#AD9CFF]",
                  },
                ]
              : undefined,
        }}
        supporting={[
          {
            key: "reimburse",
            label: "Ongkir Ditalangi",
            value: formatRupiah(ongkirReimburseTotal),
            valueClassName: "text-[var(--signal-talangan)]",
            subtext: `${ongkirReimburseCount} trip via e-wallet / staf`,
            accentTone: "talangan",
          },
          {
            key: "tunai",
            label: "Ongkir Tunai Kasir",
            value: formatRupiah(ongkirTunaiTotal),
            valueClassName: "text-[var(--signal-cleared)]",
            subtext: "Dibayar langsung dari kasir",
            accentTone: "cleared",
          },
          {
            key: "tukar-cash",
            label: "Total Tukar Cash",
            value: formatRupiah(totalTukarCash),
            subtext: `${tukarCashCount} transaksi kasir ⇄ rekening`,
            active: filterType === "tukar_cash",
            accentTone: "neutral",
            onClick: () => {
              setFilterType((prev) => (prev === "tukar_cash" ? "all" : "tukar_cash"));
              setPage(1);
            },
          },
        ]}
      />

      {/* 3. Flat Courier Breakdown Directory (Zero Nested Cards) */}
      {courierSummaryList.length > 0 && (
        <section aria-label="Rekap biaya per kurir" className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="text-sm font-bold text-[var(--ledger-ink)] truncate">
                Rekap Biaya per Kurir
              </h3>
              <span className="text-xs text-[var(--ledger-muted)] tabular-nums shrink-0">
                {courierSummaryList.length} layanan kurir
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCouriersExpanded((prev) => !prev)}
              aria-expanded={isCouriersExpanded}
              className="min-h-[36px] text-xs font-medium text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)] gap-1 px-2.5"
            >
              <span>{isCouriersExpanded ? "Tutup Rekap" : "Buka Rekap"}</span>
              {isCouriersExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>

          {isCouriersExpanded && (
            <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden divide-y divide-[color:var(--ledger-hairline)]">
              {courierSummaryList.map((c) => {
                const isSelected = search.toLowerCase() === c.courier_name.toLowerCase();
                return (
                  <div
                    key={c.courier_name}
                    className={cn(
                      "px-3.5 py-2 grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center transition-colors",
                      isSelected ? "ledger-recessed-band" : "ledger-hover-recessed"
                    )}
                  >
                    <div className="lg:col-span-4 flex items-center gap-2.5 min-w-0">
                      <div
                        aria-hidden="true"
                        className="w-8 h-8 rounded-lg bg-[var(--ledger-recessed)] text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center shrink-0"
                      >
                        <Truck className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-sm text-[var(--ledger-ink)] truncate">
                            {c.courier_name}
                          </span>
                          {c.is_subscribed && (
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 shrink-0">
                              Langganan
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-[var(--ledger-muted)] tabular-nums">
                          {c.trip_count} trip • rata-rata {formatRupiah(c.avg_per_trip)}
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-5 min-w-0">
                      <div
                        aria-hidden="true"
                        className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden"
                      >
                        <div
                          className="h-full bg-sky-600 dark:bg-sky-400 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, Math.max(6, Math.round((c.total_amount / maxCourierAmount) * 100)))}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="lg:col-span-3 flex items-center justify-between lg:justify-end gap-2 tabular-nums">
                      <span className="text-sm font-bold text-[var(--ledger-ink)]">
                        {formatRupiah(c.total_amount)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setFilterType("ongkir");
                          setSearch(isSelected ? "" : c.courier_name);
                          setPage(1);
                        }}
                        className={cn(
                          "min-h-[36px] sm:min-h-[32px] px-3 text-xs font-semibold rounded-lg ledger-press",
                          isSelected && "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        )}
                      >
                        {isSelected ? "Filter Aktif" : "Filter"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 4. Status Tabs + Unified Ledger Table Container */}
      <section aria-label="Daftar transaksi kurir dan tukar cash" className="space-y-2 min-w-0">
        <LedgerStatusTabs
          tabs={[
            { value: "all", label: "Semua", count: tukarCashCount + ongkirCount },
            { value: "tukar_cash", label: "Tukar Cash", count: tukarCashCount },
            { value: "ongkir", label: "Ongkir Kurir", count: ongkirCount },
          ]}
          value={filterType}
          onChange={(next) => {
            setFilterType(next);
            setPage(1);
          }}
          layoutId="cash-delivery-type-underline"
          ariaLabel="Filter jenis transaksi kurir dan tukar cash"
        />

        <DataTable
          table={cashDeliveryTable}
          recordCount={totalCount}
          isLoading={isLoading}
          searchQuery={search}
          containerClassName="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] shadow-none overflow-hidden"
          headerClassName="border-b border-[color:var(--ledger-hairline)] p-3 sm:px-3.5 sm:py-2.5 space-y-2"
          footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
          tableWrapperClassName="hidden md:block"
          scrollAreaClassName="md:min-h-[300px]"
          emptyMessage={
            <LedgerStateBlock
              variant="empty"
              icon={<Truck className="w-7 h-7" />}
              title="Belum ada transaksi kurir & tukar cash"
              description="Sesuaikan filter pencarian/status atau tambahkan transaksi Ongkir maupun Tukar Cash baru."
            />
          }
          header={
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-[var(--ledger-ink)]">
                    Daftar Kurir &amp; Tukar Cash
                  </h3>
                  <span className="text-xs font-mono-ledger tabular-nums text-[var(--ledger-muted)]">
                    {totalCount} transaksi
                  </span>
                </div>
                {(search || statusFilter || filterType !== "all") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("");
                      setFilterType("all");
                      setPage(1);
                    }}
                    className="h-7 px-2 text-xs text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                  >
                    Reset Filter
                  </Button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <InputGroup className="h-9 bg-[var(--ledger-surface)]">
                    <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                      <Search className="size-3.5 text-[var(--ledger-muted)]" />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="text"
                      placeholder="Cari nama karyawan, driver, no. resi, bank transfer, invoice..."
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      aria-label="Cari transaksi kurir dan tukar cash"
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

                <div className="flex items-center gap-2 shrink-0">
                  <Filters
                    variant="advanced"
                    advancedMode="popover"
                    advancedAlign="end"
                    reorderable
                    fields={cashDeliveryFilterFields}
                    query={cashDeliveryFilterQuery}
                    onQueryChange={handleCashDeliveryQueryChange}
                    className="[--filter-field-width:9rem] [--filter-operator-width:6.5rem] [--filter-value-width:11rem]"
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter status bayar kurir & tukar cash"
                    className="h-9 rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] px-2.5 text-xs font-medium text-[var(--ledger-ink)]"
                  >
                    <option value="">Semua Status Bayar</option>
                    <option value="Lunas">Hanya Lunas</option>
                    <option value="Belum Lunas">Belum Lunas / Pending</option>
                  </select>
                </div>
              </div>
            </div>
          }
        >
          <div className="md:hidden divide-y divide-[color:var(--ledger-hairline)]">
            {expenses.map((e) => {
              const itemType = getItemType(e);
              const isTukar = itemType === "tukar_cash";
              const isLunas = e.pay_status === "Lunas";
              const tgLink = parseTelegramLink(e.msg_link);
              return (
                <div
                  key={e.id}
                  onClick={() => onViewExpense?.(e)}
                  className="p-3.5 hover:bg-[var(--ledger-recessed)]/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            isTukar
                              ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/50 dark:text-sky-300"
                              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300"
                          }`}
                        >
                          {isTukar ? (
                            <ArrowLeftRight className="w-2.5 h-2.5 mr-1 inline" />
                          ) : (
                            <Truck className="w-2.5 h-2.5 mr-1 inline" />
                          )}
                          {isTukar ? "Tukar Cash" : "Ongkir Kurir"}
                        </span>
                        <span className="text-[11px] font-medium tabular-nums text-[var(--ledger-muted)]">
                          {formatDateId(e.expense_date)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[var(--ledger-ink)] truncate">
                        {e.item_name}
                      </p>
                      <p className="text-xs text-[var(--ledger-muted)] truncate">
                        {e.supplier || "-"} · {e.pay_method || "-"}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className="text-sm font-bold font-mono tabular-nums text-[var(--ledger-ink)]">
                        {formatRupiah(e.total_price)}
                      </p>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onToggleStatus(e);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          isLunas
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {isLunas ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        {isLunas ? "Lunas" : "Belum"}
                      </button>
                    </div>
                  </div>
                  <div
                    className="mt-2.5 pt-2 border-t border-[color:var(--ledger-hairline)] flex items-center justify-end gap-1"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    {tgLink?.url && (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      >
                        <a
                          href={tgLink.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Lihat Sumber Telegram"
                        >
                          <TelegramIcon className="w-4 h-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditExpense(e)}
                      className="h-9 w-9 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      title="Edit transaksi"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    {canDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={deletingId === e.id}
                        onClick={() => handleDelete(e.id)}
                        className="h-9 w-9 text-[var(--ledger-muted)] hover:text-red-600"
                        title="Hapus transaksi"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DataTable>
      </section>
    </div>
  );
};
