import React, { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Expense, MonthlyReport } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DataGrid,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
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
  Eye,
  ExternalLink,
  Tag,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Sparkles,
  Info,
  Calendar,
} from "lucide-react";

interface TukarCashOngkirTabProps {
  currentMonth: number;
  currentYear: number;
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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [page, setPage] = useState<number>(1);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedMonth(currentMonth);
    setSelectedYear(currentYear);
    setPage(1);
  }, [currentMonth, currentYear]);

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
      selectedMonth,
      selectedYear,
      filterType,
      search,
      statusFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: "30",
        month: String(selectedMonth),
        year: String(selectedYear),
        special_type: specialTypeParam,
      });
      if (search.trim()) params.append("search", search.trim());
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
          <span className="font-mono text-[11px] text-slate-600 whitespace-nowrap">
            {formatDateId(row.original.expense_date)}
          </span>
        ),
        size: 110,
      },
      {
        id: "type",
        header: () => <span>Jenis</span>,
        cell: ({ row }) => {
          const type = getItemType(row.original);
          const isTukar = type === "tukar_cash";
          return isTukar ? (
            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 gap-1 text-[10px] font-semibold py-0.5 whitespace-nowrap">
              <ArrowLeftRight className="w-3 h-3 text-indigo-600" />
              Tukar Cash
            </Badge>
          ) : (
            <Badge className="bg-sky-50 text-sky-700 border-sky-200 gap-1 text-[10px] font-semibold py-0.5 whitespace-nowrap">
              <Truck className="w-3 h-3 text-sky-600" />
              Ongkir Kurir
            </Badge>
          );
        },
        size: 130,
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
              <div className="font-semibold text-slate-900 group-hover/item:text-blue-600 max-w-xs truncate transition-colors">
                {e.item_name}
              </div>
              {e.notes && e.notes !== "-" && (
                <div className="text-[11px] text-slate-500 max-w-xs truncate mt-0.5">
                  {e.notes}
                </div>
              )}
              {e.invoice_number && e.invoice_number !== "-" && (
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  Ref/Inv: {e.invoice_number}
                </div>
              )}
            </div>
          );
        },
        size: 220,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: () => <span>Supplier / Provider</span>,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-700 font-medium">
            {row.original.supplier || "-"}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "pay_method",
        id: "pay_method",
        header: () => <span>Metode Bayar</span>,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="whitespace-nowrap flex items-center gap-1">
              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-medium">
                {e.pay_method}
              </span>
              {e.is_reimbursement && (
                <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[9px] font-bold">
                  Reimburse
                </span>
              )}
            </div>
          );
        },
        size: 130,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: () => <div className="text-right">Nominal</div>,
        cell: ({ row }) => (
          <div className="text-right font-bold text-slate-900 tabular-nums whitespace-nowrap text-xs">
            {formatRupiah(row.original.total_price)}
          </div>
        ),
        size: 120,
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
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1 font-semibold">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Lunas
                  </Badge>
                ) : (
                  <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] gap-1 font-semibold">
                    <Clock className="w-3 h-3 text-rose-600" />
                    Pending
                  </Badge>
                )}
              </button>
            </div>
          );
        },
        size: 110,
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
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  title="Buka pesan Telegram asli"
                >
                  <TelegramIcon className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => onEditExpense(e)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Edit"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  disabled={deletingId === e.id}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        },
        size: 100,
      },
    ],
    [canDelete, deletingId, onEditExpense, onToggleStatus, onViewExpense]
  );

  const cashDeliveryPagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: 30,
    }),
    [page]
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
      setPage(next.pageIndex + 1);
    },
  });

  return (
    <div className="space-y-4">
      {/* 4 Kartu KPI Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* KPI 1: Tukar Cash */}
        <Card className="border-indigo-200/80 dark:border-indigo-900/50 bg-white dark:bg-slate-900 shadow-2xs rounded-xl">
          <CardContent className="p-3 sm:p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total Tukar Cash</span>
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
              {formatRupiah(totalTukarCash)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
              <span>{tukarCashCount} transaksi</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-indigo-50/50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800">
                Kasir ⇄ Rekening
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Total Biaya Ongkir */}
        <Card className="border-sky-200/80 dark:border-sky-900/50 bg-white dark:bg-slate-900 shadow-2xs rounded-xl">
          <CardContent className="p-3 sm:p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total Biaya Ongkir</span>
              <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
                <Truck className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
              {formatRupiah(totalOngkir)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
              <span>{ongkirCount} trip</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-sky-50/50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800">
                Operasional
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Ongkir Ditalangi (Reimburse) */}
        <Card className="border-purple-200/80 dark:border-purple-900/50 bg-white dark:bg-slate-900 shadow-2xs rounded-xl">
          <CardContent className="p-3 sm:p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ongkir Ditalangi</span>
              <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                <Tag className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg sm:text-xl font-bold tracking-tight text-purple-900 dark:text-purple-200 tabular-nums">
              {formatRupiah(ongkirReimburseTotal)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
              <span>{ongkirReimburseCount} via GoPay/OVO</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50/50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                Perlu Reimburse
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Ongkir Tunai Kasir */}
        <Card className="border-emerald-200/80 dark:border-emerald-900/50 bg-white dark:bg-slate-900 shadow-2xs rounded-xl">
          <CardContent className="p-3 sm:p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ongkir Tunai Kasir</span>
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <Wallet className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg sm:text-xl font-bold tracking-tight text-emerald-900 dark:text-emerald-200 tabular-nums">
              {formatRupiah(ongkirTunaiTotal)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
              <span>Langsung dari kasir</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-50/50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                Cash Kasir
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rekap Ongkir per Kurir */}
      {reportData?.ongkir_by_courier && reportData.ongkir_by_courier.length > 0 && (
        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs rounded-xl">
          <CardContent className="p-3 sm:p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Rekap Biaya per Kurir (Bulan Ini)
                </h3>
              </div>
              <span className="text-[11px] text-slate-500">
                {reportData.ongkir_by_courier.length} layanan kurir
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {reportData.ongkir_by_courier.map((c) => (
                <div
                  key={c.courier_name}
                  className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {c.courier_name}
                    </span>
                    {c.is_subscribed && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-200 bg-amber-50 text-amber-800 shrink-0">
                        Langganan
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatRupiah(c.total_amount)}
                  </div>
                  <div className="text-[10px] text-slate-500 tabular-nums">
                    {c.trip_count} trip • rata-rata {formatRupiah(c.avg_per_trip)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter Bar & Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Segmented Button Tipe Filter */}
          <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setFilterType("all");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterType === "all"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs font-bold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Semua ({tukarCashCount + ongkirCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterType("tukar_cash");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                filterType === "tukar_cash"
                  ? "bg-white dark:bg-slate-700 text-indigo-900 dark:text-indigo-300 shadow-2xs font-bold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Tukar Cash ({tukarCashCount})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterType("ongkir");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                filterType === "ongkir"
                  ? "bg-white dark:bg-slate-700 text-sky-900 dark:text-sky-300 shadow-2xs font-bold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Ongkir Kurir ({ongkirCount})</span>
            </button>
          </div>

          {/* Action Buttons & Quick Refresh */}
          <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
            {onAddNewExpense && (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onAddNewExpense("ongkir")}
                  className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs h-9 px-3 font-semibold gap-1.5 shadow-xs"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>+ Ongkir</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onAddNewExpense("tukar_cash")}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs h-9 px-3 font-semibold gap-1.5 shadow-xs"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>+ Tukar Cash</span>
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="text-xs h-9 rounded-xl gap-1.5 border-slate-200 dark:border-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Input Search, Filters, & Status */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-1">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Cari nama karyawan, driver, no. resi, bank transfer, invoice..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 h-10 text-xs rounded-xl"
            />
          </div>
          <div className="flex items-center gap-2">
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
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
            >
              <option value="">Semua Status Bayar</option>
              <option value="Lunas">Hanya Lunas</option>
              <option value="Belum Lunas">Belum Lunas / Pending</option>
            </select>
          </div>
        </div>
      </div>

      {/* ReUI DataGrid Data Transaksi */}
      <DataGrid
        table={cashDeliveryTable}
        recordCount={totalCount}
        isLoading={isLoading}
        tableLayout={{ columnsResizable: true }}
      >
        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
          <DataGridScrollArea className="min-h-[300px]">
            <DataGridTable />
          </DataGridScrollArea>

          <DataGridPagination />
        </Card>
      </DataGrid>
    </div>
  );
};
