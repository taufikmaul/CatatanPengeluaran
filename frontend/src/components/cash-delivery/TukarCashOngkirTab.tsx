import React, { useState, useMemo } from "react";
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
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="border border-slate-200/90 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-400/30 text-xs px-2.5 py-0.5">
                Kasir & Logistik
              </Badge>
              <span className="text-xs text-slate-300 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Periode: {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>Rincian Tukar Cash & Ongkir Kurir</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Monitoring khusus transaksi <strong>Tarik Tunai Karyawan (Tukar Cash)</strong> dan <strong>Biaya Pengiriman Kurir (GoSend, Grab, Lalamove, J&T)</strong>. Tukar Cash otomatis dipisahkan dari beban belanja operasional toko.
            </p>
          </div>

          {/* Quick Month/Year Switcher & Action Buttons */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 self-start md:self-auto">
            {onAddNewExpense && (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onAddNewExpense("ongkir")}
                  className="bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs h-9 px-3 font-semibold gap-1.5 shadow-xs"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>+ Ongkir</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onAddNewExpense("tukar_cash")}
                  className="bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs h-9 px-3 font-semibold gap-1.5 shadow-xs"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>+ Tukar Cash</span>
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2 bg-white/10 p-1.5 rounded-2xl border border-white/10">
              <select
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-transparent text-white text-xs font-semibold px-2 py-1.5 rounded-xl border-none outline-none cursor-pointer focus:bg-slate-800"
              >
                {MONTH_NAMES.map((m, idx) => (
                  <option key={m} value={idx + 1} className="bg-slate-900 text-white">
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-transparent text-white text-xs font-semibold px-2 py-1.5 rounded-xl border-none outline-none cursor-pointer focus:bg-slate-800"
              >
                {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                  <option key={y} value={y} className="bg-slate-900 text-white">
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Kartu KPI Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {/* KPI 1: Tukar Cash */}
        <Card className="border-indigo-200/90 bg-gradient-to-br from-indigo-50/60 to-white shadow-2xs">
          <CardContent className="p-4 md:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Total Tukar Cash</span>
              <div className="p-2 rounded-xl bg-indigo-100 text-indigo-700">
                <ArrowLeftRight className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold tracking-tight text-indigo-950 tabular-nums">
              {formatRupiah(totalTukarCash)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
              <span>{tukarCashCount} transaksi</span>
              <Badge variant="outline" className="text-[10px] bg-white text-indigo-700 border-indigo-200">
                Kasir ⇄ Rekening
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Total Biaya Ongkir */}
        <Card className="border-sky-200/90 bg-gradient-to-br from-sky-50/60 to-white shadow-2xs">
          <CardContent className="p-4 md:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Total Biaya Ongkir</span>
              <div className="p-2 rounded-xl bg-sky-100 text-sky-700">
                <Truck className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold tracking-tight text-sky-950 tabular-nums">
              {formatRupiah(totalOngkir)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
              <span>{ongkirCount} pengiriman kurir</span>
              <Badge variant="outline" className="text-[10px] bg-white text-sky-700 border-sky-200">
                Operasional
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Ongkir Ditalangi (Reimburse) */}
        <Card className="border-purple-200/90 bg-gradient-to-br from-purple-50/60 to-white shadow-2xs">
          <CardContent className="p-4 md:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Ongkir Ditalangi</span>
              <div className="p-2 rounded-xl bg-purple-100 text-purple-700">
                <Tag className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold tracking-tight text-purple-950 tabular-nums">
              {formatRupiah(ongkirReimburseTotal)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
              <span>{ongkirReimburseCount} via GoPay/OVO</span>
              <Badge variant="outline" className="text-[10px] bg-white text-purple-700 border-purple-200">
                Perlu Reimburse
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Ongkir Tunai Kasir */}
        <Card className="border-emerald-200/90 bg-gradient-to-br from-emerald-50/60 to-white shadow-2xs">
          <CardContent className="p-4 md:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Ongkir Tunai Kasir</span>
              <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold tracking-tight text-emerald-950 tabular-nums">
              {formatRupiah(ongkirTunaiTotal)}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
              <span>Langsung dari laci kasir</span>
              <Badge variant="outline" className="text-[10px] bg-white text-emerald-700 border-emerald-200">
                Cash Kasir
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info Tip Mutasi Kasir */}
      <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-900 leading-relaxed">
          <strong>Perlakuan Pembukuan:</strong> Transaksi <strong>Tukar Cash</strong> merupakan penukaran uang cash kasir dengan transfer ke rekening owner toko. Karena uang masuk kembali ke rekening owner, transaksi ini adalah mutasi kas internal (net-zero) dan <strong>tidak dimasukkan</strong> ke perhitungan beban belanja belanja riil toko.
        </div>
      </div>

      {/* Filter Bar & Controls */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Segmented Button Tipe Filter */}
          <div className="inline-flex p-1 bg-slate-100 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setFilterType("all");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterType === "all"
                  ? "bg-white text-slate-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
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
                  ? "bg-white text-indigo-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600" />
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
                  ? "bg-white text-sky-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-sky-600" />
              <span>Ongkir Kurir ({ongkirCount})</span>
            </button>
          </div>

          {/* Quick Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="text-xs h-9 rounded-xl gap-1.5 self-end sm:self-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
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
