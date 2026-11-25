import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChefHat,
  Download,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  Wallet,
  Warehouse,
} from "lucide-react";
import {
  exportHppCsv,
  exportMaterialsCsv,
  exportSalesCsv,
  exportShippingCsv,
  getHppReport,
  getMaterialsReport,
  getSalesReport,
  getShippingReport,
} from "@/lib/api";
import { formatDateId, formatRupiah } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  GeneralReportSubTab,
  HppReportResponse,
  MaterialItemRow,
  MaterialsReportResponse,
  MenuEngineeringRow,
  SalesChannelRow,
  SalesReportResponse,
  ShippingCourierRow,
  ShippingReportResponse,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/common/DataTable";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { toast } from "sonner";

export interface GeneralReportsTabProps {
  currentMonth: number;
  currentMonthEnd?: number;
  currentYear: number;
  onMonthChange: (m: number) => void;
  onYearChange: (y: number) => void;
}

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

const SUB_TABS: Array<{
  id: GeneralReportSubTab;
  label: string;
  phase2?: boolean;
}> = [
  { id: "omset", label: "Omset & Channel" },
  { id: "bahan", label: "Bahan & Harga" },
  { id: "ongkir", label: "Ongkir & Kurir" },
  { id: "hpp", label: "HPP & Menu" },
  { id: "anggaran", label: "Anggaran & Hutang", phase2: true },
  { id: "gudang", label: "Gudang & Aset", phase2: true },
];

function classificationStyle(cls: MenuEngineeringRow["classification"]): string {
  switch (cls) {
    case "Star":
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "Plowhorse":
      return "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
    case "Puzzle":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
    default:
      return "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
  }
}

function ReportLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Memuat laporan umum">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] p-4 space-y-2.5"
          >
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        {[1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

function ReportErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/20 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">
            Gagal memuat data laporan
          </h3>
          <p className="text-xs text-[var(--ledger-muted)]">{message}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="min-h-[44px] sm:min-h-[36px] shrink-0 gap-1.5 border-[color:var(--ledger-hairline)]"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Muat Ulang</span>
      </Button>
    </div>
  );
}

function ReportEmptyBlock({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] p-8 text-center space-y-2">
      <div className="mx-auto w-10 h-10 rounded-full bg-[var(--ledger-recessed)] flex items-center justify-center text-[var(--ledger-muted)]">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">{title}</h3>
      <p className="text-xs text-[var(--ledger-muted)] max-w-md mx-auto">{description}</p>
    </div>
  );
}

export const GeneralReportsTab: React.FC<GeneralReportsTabProps> = ({
  currentMonth,
  currentMonthEnd,
  currentYear,
  onMonthChange,
  onYearChange,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<GeneralReportSubTab>("omset");
  const [searchTerm, setSearchTerm] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const effectiveMonthEnd = currentMonthEnd || currentMonth;
  const periodLabel =
    effectiveMonthEnd !== currentMonth
      ? `${MONTH_NAMES[currentMonth - 1]} s/d ${MONTH_NAMES[effectiveMonthEnd - 1]} ${currentYear}`
      : `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

  const queryParams = useMemo(
    () => ({
      month: currentMonth,
      monthEnd: effectiveMonthEnd,
      year: currentYear,
    }),
    [currentMonth, effectiveMonthEnd, currentYear]
  );

  // Query Omset & Channel
  const salesQuery = useQuery<SalesReportResponse>({
    queryKey: ["general-report-sales", currentYear, currentMonth, effectiveMonthEnd],
    queryFn: () => getSalesReport(queryParams),
    enabled: activeSubTab === "omset",
    staleTime: 60 * 1000,
  });

  // Query Bahan & Harga
  const materialsQuery = useQuery<MaterialsReportResponse>({
    queryKey: ["general-report-materials", currentYear, currentMonth, effectiveMonthEnd],
    queryFn: () => getMaterialsReport(queryParams),
    enabled: activeSubTab === "bahan",
    staleTime: 60 * 1000,
  });

  // Query Ongkir & Kurir
  const shippingQuery = useQuery<ShippingReportResponse>({
    queryKey: ["general-report-shipping", currentYear, currentMonth, effectiveMonthEnd],
    queryFn: () => getShippingReport(queryParams),
    enabled: activeSubTab === "ongkir",
    staleTime: 60 * 1000,
  });

  // Query HPP & Menu Engineering
  const hppQuery = useQuery<HppReportResponse>({
    queryKey: ["general-report-hpp", currentYear, currentMonth, effectiveMonthEnd],
    queryFn: () => getHppReport(queryParams),
    enabled: activeSubTab === "hpp",
    staleTime: 60 * 1000,
  });

  const activeQuery =
    activeSubTab === "omset"
      ? salesQuery
      : activeSubTab === "bahan"
      ? materialsQuery
      : activeSubTab === "ongkir"
      ? shippingQuery
      : activeSubTab === "hpp"
      ? hppQuery
      : null;

  const isPhase2Tab = activeSubTab === "anggaran" || activeSubTab === "gudang";

  const handleExportCsv = async () => {
    if (isPhase2Tab) return;
    setIsExporting(true);
    try {
      if (activeSubTab === "omset") {
        await exportSalesCsv(queryParams);
      } else if (activeSubTab === "bahan") {
        await exportMaterialsCsv(queryParams);
      } else if (activeSubTab === "ongkir") {
        await exportShippingCsv(queryParams);
      } else if (activeSubTab === "hpp") {
        await exportHppCsv(queryParams);
      }
      toast.success("Berkas CSV berhasil diunduh");
    } catch {
      toast.error("Gagal mengunduh berkas CSV");
    } finally {
      setIsExporting(false);
    }
  };

  // Filtered rows for Bahan & HPP
  const filteredMaterialItems = useMemo(() => {
    const items = materialsQuery.data?.items || [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.item_name.toLowerCase().includes(q) ||
        (it.supplier || "").toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q)
    );
  }, [materialsQuery.data, searchTerm]);

  const filteredHppMenus = useMemo(() => {
    const menus = hppQuery.data?.menus || [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return menus;
    return menus.filter(
      (m) =>
        m.menu_name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.classification.toLowerCase().includes(q)
    );
  }, [hppQuery.data, searchTerm]);

  // Column definitions
  const salesChannelColumns = useMemo<ColumnDef<DataGridFeatures, SalesChannelRow>[]>(
    () => [
      {
        accessorKey: "channel",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Channel" />,
        cell: ({ row }) => (
          <span className="font-semibold text-xs text-[var(--ledger-ink)]">
            {row.original.channel}
          </span>
        ),
      },
      {
        accessorKey: "order_count",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Order" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {row.original.order_count} trx
          </span>
        ),
      },
      {
        accessorKey: "gross_sales",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Gross Omset" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.gross_sales)}
          </span>
        ),
      },
      {
        accessorKey: "discount_amount",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Diskon" />,
        cell: ({ row }) => (
          <div className="tabular-nums text-xs text-[var(--ledger-muted)]">
            {formatRupiah(row.original.discount_amount)}
            {row.original.discount_rate != null && (
              <span className="ml-1 text-[11px]">({row.original.discount_rate}%)</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "net_sales",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Net Omset" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-semibold text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.net_sales)}
          </span>
        ),
      },
      {
        accessorKey: "platform_fee",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Fee Platform" />,
        cell: ({ row }) => (
          <div className="tabular-nums text-xs text-[var(--ledger-muted)]">
            {formatRupiah(row.original.platform_fee)}
            {row.original.platform_fee_rate != null && (
              <span className="ml-1 text-[11px]">({row.original.platform_fee_rate}%)</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "net_received",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Net Diterima" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-bold text-xs text-emerald-700 dark:text-emerald-400">
            {formatRupiah(row.original.net_received)}
          </span>
        ),
      },
      {
        accessorKey: "aov",
        header: ({ column }) => <DataGridColumnHeader column={column} title="AOV" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.aov)}
          </span>
        ),
      },
    ],
    []
  );

  const materialColumns = useMemo<ColumnDef<DataGridFeatures, MaterialItemRow>[]>(
    () => [
      {
        accessorKey: "item_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Bahan / Item" />,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-semibold text-xs text-[var(--ledger-ink)]">
              {row.original.item_name}
            </div>
            <div className="text-[11px] text-[var(--ledger-muted)]">
              {row.original.category}
              {row.original.supplier ? ` (${row.original.supplier})` : ""}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "total_qty",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Volume Beli" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {row.original.total_qty} {row.original.unit}
          </span>
        ),
      },
      {
        accessorKey: "total_spend",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Belanja Netto" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-semibold text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.total_spend)}
          </span>
        ),
      },
      {
        accessorKey: "wap",
        header: ({ column }) => <DataGridColumnHeader column={column} title="WAP / Satuan" />,
        cell: ({ row }) => (
          <div className="space-y-0.5 tabular-nums">
            <div className="text-xs font-medium text-[var(--ledger-ink)]">
              {formatRupiah(row.original.wap)}/{row.original.unit}
            </div>
            {row.original.recipe_unit_cost != null && row.original.recipe_unit && (
              <div className="text-[11px] text-[var(--ledger-muted)]">
                {formatRupiah(row.original.recipe_unit_cost)}/{row.original.recipe_unit}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "price_drift_pct",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Perubahan Harga" />,
        cell: ({ row }) => {
          const pct = row.original.price_drift_pct;
          if (pct == null) {
            return <span className="text-xs text-[var(--ledger-muted)]">Belum ada pembanding</span>;
          }
          if (row.original.is_drifting) {
            return (
              <Badge
                variant="outline"
                className="gap-1 border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 tabular-nums"
              >
                <ArrowUpRight className="w-3 h-3" />
                +{pct}% (Naik)
              </Badge>
            );
          }
          return (
            <span
              className={cn(
                "tabular-nums text-xs font-medium",
                pct < 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-[var(--ledger-muted)]"
              )}
            >
              {pct > 0 ? `+${pct}%` : `${pct}%`}
            </span>
          );
        },
      },
    ],
    []
  );

  const shippingColumns = useMemo<ColumnDef<DataGridFeatures, ShippingCourierRow>[]>(
    () => [
      {
        accessorKey: "courier",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Kurir / Ekspedisi" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-xs text-[var(--ledger-ink)]">
              {row.original.courier}
            </span>
            {row.original.is_subscribed && (
              <Badge
                variant="outline"
                className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                Langganan
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: "trip_count",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Trip" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {row.original.trip_count} trip
          </span>
        ),
      },
      {
        accessorKey: "total_cost",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Total Biaya" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-semibold text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.total_cost)}
          </span>
        ),
      },
      {
        accessorKey: "avg_cost_per_trip",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Rata-rata / Trip" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.avg_cost_per_trip)}
          </span>
        ),
      },
      {
        accessorKey: "talangan_cost",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Talangan" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-muted)]">
            {formatRupiah(row.original.talangan_cost)}
          </span>
        ),
      },
      {
        accessorKey: "share_pct",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Porsi" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs font-medium text-[var(--ledger-ink)]">
            {row.original.share_pct}%
          </span>
        ),
      },
    ],
    []
  );

  const hppColumns = useMemo<ColumnDef<DataGridFeatures, MenuEngineeringRow>[]>(
    () => [
      {
        accessorKey: "menu_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Menu" />,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-semibold text-xs text-[var(--ledger-ink)] flex items-center gap-1.5">
              <span>{row.original.menu_name}</span>
              {row.original.has_price_drift && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  Bahan Naik
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-[var(--ledger-muted)]">{row.original.category}</div>
          </div>
        ),
      },
      {
        accessorKey: "selling_price",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Harga Jual" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.selling_price)}
          </span>
        ),
      },
      {
        accessorKey: "effective_hpp",
        header: ({ column }) => <DataGridColumnHeader column={column} title="HPP Efektif" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-medium text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.effective_hpp)}
          </span>
        ),
      },
      {
        accessorKey: "food_cost_pct",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Food Cost %" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {row.original.food_cost_pct != null ? `${row.original.food_cost_pct}%` : "-"}
          </span>
        ),
      },
      {
        accessorKey: "contribution_margin",
        header: ({ column }) => <DataGridColumnHeader column={column} title="CM / Unit" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-semibold text-xs text-[var(--ledger-ink)]">
            {formatRupiah(row.original.contribution_margin)}
          </span>
        ),
      },
      {
        accessorKey: "qty_sold",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Terjual" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--ledger-ink)]">
            {row.original.qty_sold} pcs
          </span>
        ),
      },
      {
        accessorKey: "classification",
        header: ({ column }) => <DataGridColumnHeader column={column} title="Kuadran" />,
        cell: ({ row }) => (
          <Badge variant="outline" className={classificationStyle(row.original.classification)}>
            {row.original.classification}
          </Badge>
        ),
      },
    ],
    []
  );

  const yearsList = useMemo(() => {
    const base = new Date().getFullYear();
    return [base - 2, base - 1, base, base + 1];
  }, []);

  return (
    <div className="space-y-4">
      {/* Header & Filter Bar */}
      <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
            Laporan Umum Operasional
          </h2>
          <p className="text-xs text-[var(--ledger-muted)]">
            Periode aktif: <span className="font-semibold text-[var(--ledger-ink)]">{periodLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="general-report-month">
            Pilih Bulan
          </label>
          <select
            id="general-report-month"
            value={currentMonth}
            onChange={(e) => onMonthChange(Number(e.target.value))}
            className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] px-2.5 text-xs font-medium text-[var(--ledger-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={name} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="general-report-year">
            Pilih Tahun
          </label>
          <select
            id="general-report-year"
            value={currentYear}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] px-2.5 text-xs font-medium text-[var(--ledger-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {yearsList.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          {!isPhase2Tab && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => activeQuery?.refetch()}
                disabled={Boolean(activeQuery?.isFetching)}
                className="min-h-[44px] sm:min-h-[36px] gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", activeQuery?.isFetching && "animate-spin")}
                />
                <span>Muat Ulang</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={isExporting || Boolean(activeQuery?.isLoading)}
                className="min-h-[44px] sm:min-h-[36px] gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isExporting ? "Mengunduh..." : "Export CSV"}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Sub-Tabs Navigation */}
      <div className="border-b border-[color:var(--ledger-hairline)]">
        <nav
          aria-label="Kategori Laporan Umum"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar -mb-px"
        >
          {SUB_TABS.map((tab) => {
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveSubTab(tab.id);
                  setSearchTerm("");
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                  active
                    ? "border-[var(--ledger-ink)] text-[var(--ledger-ink)]"
                    : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                )}
              >
                <span>{tab.label}</span>
                {tab.phase2 && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--ledger-recessed)] text-[var(--ledger-muted)]">
                    Tahap 2
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: OMSET & CHANNEL */}
      {activeSubTab === "omset" && (
        <div className="space-y-4">
          {salesQuery.isLoading ? (
            <ReportLoadingSkeleton />
          ) : salesQuery.isError ? (
            <ReportErrorBlock
              message="Terjadi kendala saat mengambil data omset penjualan."
              onRetry={() => salesQuery.refetch()}
            />
          ) : !salesQuery.data || (salesQuery.data.total_orders === 0 && salesQuery.data.void_count === 0) ? (
            <ReportEmptyBlock
              icon={ShoppingBag}
              title="Belum ada transaksi penjualan pada periode ini"
              description={`Tidak ditemukan catatan penjualan masuk untuk periode ${periodLabel}. Pilih bulan lain atau import data POS terlebih dahulu.`}
            />
          ) : (
            <>
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">Net Omset</div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(salesQuery.data.total_net_sales)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] flex items-center gap-1.5 flex-wrap">
                    <span>Gross: {formatRupiah(salesQuery.data.total_gross_sales)}</span>
                    {salesQuery.data.mom_growth_pct != null && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-0.5 text-[10px] tabular-nums",
                          salesQuery.data.mom_growth_pct >= 0
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                        )}
                      >
                        {salesQuery.data.mom_growth_pct >= 0 ? (
                          <ArrowUpRight className="w-3 h-3" />
                        ) : (
                          <ArrowDownRight className="w-3 h-3" />
                        )}
                        {salesQuery.data.mom_growth_pct > 0 ? "+" : ""}
                        {salesQuery.data.mom_growth_pct}% MoM
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">Net Diterima</div>
                  <div className="text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {formatRupiah(salesQuery.data.total_net_received)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    Fee platform: {formatRupiah(salesQuery.data.total_platform_fee)}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Rata-rata Order (AOV)
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(salesQuery.data.total_aov)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    {salesQuery.data.total_orders} order, {formatRupiah(salesQuery.data.daily_avg_net_sales)}/hari
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Pembatalan / Void
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {salesQuery.data.void_count} trx
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    Nominal: {formatRupiah(salesQuery.data.void_nominal)}
                    {salesQuery.data.void_rate_pct != null ? ` (${salesQuery.data.void_rate_pct}%)` : ""}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)] flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">
                    Performa per Channel Penjualan
                  </h3>
                  <span className="text-xs text-[var(--ledger-muted)] tabular-nums">
                    {salesQuery.data.channels.length} channel
                  </span>
                </div>
                <DataTable
                  columns={salesChannelColumns}
                  data={salesQuery.data.channels}
                  getRowId={(r) => r.channel}
                  defaultPageSize={10}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2"
                />
              </div>

              {salesQuery.data.daily.length > 0 && (
                <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)]">
                    <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">
                      Ringkasan Harian ({salesQuery.data.daily.length} hari aktif)
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[var(--ledger-recessed)] text-[var(--ledger-muted)]">
                        <tr>
                          <th className="text-left font-semibold px-4 py-2.5">Tanggal</th>
                          <th className="text-right font-semibold px-4 py-2.5">Order</th>
                          <th className="text-right font-semibold px-4 py-2.5">Gross</th>
                          <th className="text-right font-semibold px-4 py-2.5">Net Sales</th>
                          <th className="text-right font-semibold px-4 py-2.5">Net Diterima</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--ledger-hairline)]">
                        {salesQuery.data.daily.slice(-14).map((d) => (
                          <tr key={d.date} className="hover:bg-[var(--ledger-recessed)]/50 transition-colors">
                            <td className="px-4 py-2 font-medium text-[var(--ledger-ink)]">
                              {formatDateId(d.date)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-[var(--ledger-ink)]">
                              {d.order_count}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-[var(--ledger-muted)]">
                              {formatRupiah(d.gross_sales)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-semibold text-[var(--ledger-ink)]">
                              {formatRupiah(d.net_sales)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatRupiah(d.net_received)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: BAHAN & HARGA */}
      {activeSubTab === "bahan" && (
        <div className="space-y-4">
          {materialsQuery.isLoading ? (
            <ReportLoadingSkeleton />
          ) : materialsQuery.isError ? (
            <ReportErrorBlock
              message="Terjadi kendala saat mengambil data belanja bahan baku."
              onRetry={() => materialsQuery.refetch()}
            />
          ) : !materialsQuery.data || materialsQuery.data.items.length === 0 ? (
            <ReportEmptyBlock
              icon={Package}
              title="Belum ada belanja bahan baku pada periode ini"
              description={`Tidak ada transaksi bahan baku atau kemasan untuk periode ${periodLabel}.`}
            />
          ) : (
            <>
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Total Belanja Bahan Netto
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(materialsQuery.data.total_spend)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    Bruto: {formatRupiah(materialsQuery.data.total_bruto)}
                    {materialsQuery.data.material_to_sales_pct != null
                      ? ` (${materialsQuery.data.material_to_sales_pct}% omset)`
                      : ""}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">Supplier Aktif</div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {materialsQuery.data.unique_suppliers} toko
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)]">
                    {materialsQuery.data.items.length} jenis item dibeli
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Kenaikan Harga (&ge;5%)
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {materialsQuery.data.drifting_items} item
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)]">
                    Dibanding WAP periode sebelumnya
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Selisih Penerimaan Gudang
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {materialsQuery.data.discrepancy_count} catatan
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)]">
                    Status KURANG, LEBIH, atau RUSAK
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">
                    Rincian Harga Rata-rata Tertimbang (WAP) Bahan
                  </h3>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]" />
                    <Input
                      type="search"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Cari item atau supplier..."
                      aria-label="Cari item atau supplier bahan"
                      className="pl-8 min-h-[44px] sm:min-h-[34px] text-xs bg-[var(--ledger-surface)] border-[color:var(--ledger-hairline)]"
                    />
                  </div>
                </div>
                <DataTable
                  columns={materialColumns}
                  data={filteredMaterialItems}
                  getRowId={(r, i) => `${r.item_name}-${i}`}
                  defaultPageSize={15}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: ONGKIR & KURIR */}
      {activeSubTab === "ongkir" && (
        <div className="space-y-4">
          {shippingQuery.isLoading ? (
            <ReportLoadingSkeleton />
          ) : shippingQuery.isError ? (
            <ReportErrorBlock
              message="Terjadi kendala saat mengambil data laporan ongkir."
              onRetry={() => shippingQuery.refetch()}
            />
          ) : !shippingQuery.data ||
            (shippingQuery.data.ongkir_trip_count === 0 && shippingQuery.data.freight_in_count === 0) ? (
            <ReportEmptyBlock
              icon={Truck}
              title="Belum ada transaksi ongkir pada periode ini"
              description={`Tidak ada pengeluaran kurir mandiri maupun freight-in pada periode ${periodLabel}.`}
            />
          ) : (
            <>
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Total Biaya Logistik
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(shippingQuery.data.total_shipping_cost)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    {shippingQuery.data.shipping_to_sales_pct != null
                      ? `${shippingQuery.data.shipping_to_sales_pct}% dari omset bersih`
                      : "Gabungan kurir mandiri + freight-in"}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Ongkir Kurir Mandiri
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(shippingQuery.data.ongkir_mandiri_total)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    {shippingQuery.data.ongkir_trip_count} trip, rata-rata{" "}
                    {formatRupiah(shippingQuery.data.avg_cost_per_trip)}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Freight-In (Ongkir Belanja)
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(shippingQuery.data.freight_in_total)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    {shippingQuery.data.freight_in_count} nota supplier
                    {shippingQuery.data.freight_in_to_material_pct != null
                      ? ` (${shippingQuery.data.freight_in_to_material_pct}% belanja)`
                      : ""}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Talangan Ongkir
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(shippingQuery.data.talangan_total)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    Belum diganti: {formatRupiah(shippingQuery.data.talangan_pending_total)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)] flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">
                    Breakdown per Kurir Mandiri
                  </h3>
                  <span className="text-xs text-[var(--ledger-muted)] tabular-nums">
                    {shippingQuery.data.couriers.length} kurir
                  </span>
                </div>
                <DataTable
                  columns={shippingColumns}
                  data={shippingQuery.data.couriers}
                  getRowId={(r) => r.courier}
                  defaultPageSize={10}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: HPP & MENU ENGINEERING */}
      {activeSubTab === "hpp" && (
        <div className="space-y-4">
          {hppQuery.isLoading ? (
            <ReportLoadingSkeleton />
          ) : hppQuery.isError ? (
            <ReportErrorBlock
              message="Terjadi kendala saat menghitung laporan HPP dan Menu Engineering."
              onRetry={() => hppQuery.refetch()}
            />
          ) : !hppQuery.data || hppQuery.data.menus.length === 0 ? (
            <ReportEmptyBlock
              icon={ChefHat}
              title="Belum ada data menu jual untuk dianalisis"
              description="Tambahkan menu jual di Katalog Menu Produk untuk melihat Food Cost %, HPP teoritis, dan kuadran Menu Engineering."
            />
          ) : (
            <>
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    HPP Teoritis Penjualan
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(hppQuery.data.theoretical_hpp_total)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    {hppQuery.data.theoretical_food_cost_pct != null
                      ? `${hppQuery.data.theoretical_food_cost_pct}% dari net omset`
                      : "Berdasarkan resep menu terjual"}
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    HPP Pembelian (Belanja Bahan)
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(hppQuery.data.actual_purchase_hpp)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)]">
                    Berbasis belanja periode (non-opname)
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Selisih Belanja vs Teoritis
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {formatRupiah(hppQuery.data.hpp_variance_amount)}
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)] tabular-nums">
                    Batas populer: {hppQuery.data.popularity_threshold} pcs
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">
                    Menu POS Belum Terpetakan
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                    {hppQuery.data.unmatched_items.length} produk
                  </div>
                  <div className="text-[11px] text-[var(--ledger-muted)]">
                    Batas CM: {formatRupiah(hppQuery.data.cm_threshold)}
                  </div>
                </div>
              </div>

              {hppQuery.data.unmatched_items.length > 0 && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 flex items-start gap-2.5 text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-[var(--ledger-ink)]">
                      {hppQuery.data.unmatched_items.length} item POS belum cocok dengan nama Menu Produk
                    </div>
                    <p className="text-[var(--ledger-muted)]">
                      {hppQuery.data.unmatched_items.slice(0, 8).join(", ")}
                      {hppQuery.data.unmatched_items.length > 8
                        ? ` (+${hppQuery.data.unmatched_items.length - 8} lainnya)`
                        : ""}
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-[var(--ledger-ink)]">
                      Matriks Menu Engineering (Kasavana-Smith)
                    </h3>
                    <p className="text-[11px] text-[var(--ledger-muted)]">
                      {hppQuery.data.hpp_basis_note}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]" />
                    <Input
                      type="search"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Cari nama menu atau kuadran..."
                      aria-label="Cari nama menu atau kuadran"
                      className="pl-8 min-h-[44px] sm:min-h-[34px] text-xs bg-[var(--ledger-surface)] border-[color:var(--ledger-hairline)]"
                    />
                  </div>
                </div>
                <DataTable
                  columns={hppColumns}
                  data={filteredHppMenus}
                  getRowId={(r) => String(r.menu_id)}
                  defaultPageSize={15}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 5 & 6: PHASE 2 HONEST PLACEHOLDER */}
      {/* TODO: Phase 2 — Hubungkan tab Anggaran & Aging Hutang serta Gudang & Aset setelah Step 6 dan Step 7 diimplementasikan */}
      {activeSubTab === "anggaran" && (
        <ReportEmptyBlock
          icon={Wallet}
          title="Laporan Anggaran & Aging Hutang (Tahap 2)"
          description="Laporan realisasi anggaran per kategori, run-rate akhir bulan, serta aging hutang jatuh tempo dijadwalkan pada tahap pengembangan berikutnya."
        />
      )}

      {activeSubTab === "gudang" && (
        <ReportEmptyBlock
          icon={Warehouse}
          title="Laporan Pengadaan Gudang & Aset (Tahap 2)"
          description="Laporan lead time pengadaan, item mendekati kedaluwarsa, serta jadwal servis aset dijadwalkan pada tahap pengembangan berikutnya."
        />
      )}
    </div>
  );
};
