import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ItemPriceHistoryResponse } from "@/types";
import { formatRupiah, formatUnitRupiah, formatDateId } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/common/DataTable";
import { dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef, useTable } from "@tanstack/react-table";
import {
  Award,
  Store,
  TrendingDown,
  TrendingUp,
  History,
  Package,
  LineChart as LineChartIcon,
  Minus,
  ReceiptText,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export type PriceHistoryRecord = NonNullable<ItemPriceHistoryResponse["history"]>[number];

interface PriceHistoryModalProps {
  itemName: string | null;
  itemId?: number | null;
  onClose: () => void;
  onNavigateToExpense?: (record: PriceHistoryRecord) => void;
}

export const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({
  itemName,
  itemId,
  onClose,
  onNavigateToExpense,
}) => {
  const { data, isLoading } = useQuery<ItemPriceHistoryResponse>({
    queryKey: ["price-history", itemId, itemName],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (itemId) params.append("item_id", String(itemId));
      if (itemName) params.append("item_name", itemName);
      const res = await api.get(`/expenses/price-history?${params.toString()}`);
      return res.data;
    },
    enabled: !!(itemName || itemId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const baseUnit = data?.base_unit || null;
  const isBaseUnitMode = Boolean(baseUnit && data?.base_latest_price != null);

  // Urutkan data secara kronologis (dari tanggal terlama ke terbaru, tie-break ID) untuk chart inflasi harga.
  // Bila satuan terkecil/resep sudah disetel, grafik wajib memakai base_unit_price agar antar kemasan setara.
  const { chartData, skippedUnconvertedCount } = useMemo(() => {
    if (!data?.history || data.history.length === 0) {
      return { chartData: [], skippedUnconvertedCount: 0 };
    }

    const withUnitPrice = data.history.filter((h) => (h.unit_price || 0) > 0);
    const validHistory = isBaseUnitMode
      ? withUnitPrice.filter((h) => (h.base_unit_price || 0) > 0)
      : withUnitPrice;
    const skippedCount = isBaseUnitMode ? withUnitPrice.length - validHistory.length : 0;

    if (validHistory.length === 0) {
      return { chartData: [], skippedUnconvertedCount: skippedCount };
    }

    const sorted = [...validHistory].sort((a, b) => {
      const dateDiff =
        new Date(a.expense_date).getTime() - new Date(b.expense_date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.id - b.id;
    });

    const getPlotPrice = (h: PriceHistoryRecord) =>
      isBaseUnitMode ? Number(h.base_unit_price || 0) : Number(h.unit_price || 0);

    const baselinePrice = getPlotPrice(sorted[0]);

    const rows = sorted.map((h, index) => {
      const plotPrice = getPlotPrice(h);
      const diffFromBase = plotPrice - baselinePrice;
      const inflationPct = baselinePrice > 0 ? (diffFromBase / baselinePrice) * 100 : 0;
      const prevPrice = index > 0 ? getPlotPrice(sorted[index - 1]) : plotPrice;
      const diffFromPrev = plotPrice - prevPrice;
      const changeFromPrevPct = prevPrice > 0 ? (diffFromPrev / prevPrice) * 100 : 0;

      return {
        id: h.id,
        date: h.expense_date,
        dayLabel: h.expense_date.split("-").slice(1).join("/"),
        unitPrice: plotPrice,
        displayUnit: isBaseUnitMode ? baseUnit! : h.unit || "Pcs",
        purchaseUnitPrice: h.unit_price,
        purchaseUnit: h.unit || "Pcs",
        baseQty: h.base_qty ?? null,
        supplier: h.supplier,
        qty: h.qty,
        unit: h.unit || "Pcs",
        totalPrice: h.total_price,
        inflationPct: Math.round(inflationPct * 10) / 10,
        diffFromBase,
        changeFromPrevPct: Math.round(changeFromPrevPct * 10) / 10,
        diffFromPrev,
        baselinePrice,
      };
    });

    return { chartData: rows, skippedUnconvertedCount: skippedCount };
  }, [data?.history, isBaseUnitMode, baseUnit]);

  // Metrik total inflasi / kenaikan harga dari pembelian awal ke terakhir
  const inflationStats = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0];
    const last = chartData[chartData.length - 1];
    const diff = last.unitPrice - first.unitPrice;
    const pct = first.unitPrice > 0 ? (diff / first.unitPrice) * 100 : 0;

    return {
      firstPrice: first.unitPrice,
      lastPrice: last.unitPrice,
      firstDate: first.date,
      lastDate: last.date,
      diff,
      pct: Math.round(pct * 10) / 10,
      isInflation: diff > 0,
      isDeflation: diff < 0,
      isStable: diff === 0,
      count: chartData.length,
    };
  }, [chartData]);

  const strokeColor = !inflationStats
    ? "#3b82f6"
    : inflationStats.isInflation
    ? "#f43f5e"
    : inflationStats.isDeflation
    ? "#10b981"
    : "#3b82f6";

  const priceHistoryColumns = useMemo<ColumnDef<DataGridFeatures, PriceHistoryRecord>[]>(
    () => [
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600 dark:text-slate-400">
            {formatDateId(row.original.expense_date)}
          </span>
        ),
        size: 110,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: () => <span>Toko / Supplier</span>,
        cell: ({ row }) => (
          <span className="text-slate-700 dark:text-slate-300 font-medium truncate max-w-[160px] block">
            {row.original.supplier || "-"}
          </span>
        ),
        size: 160,
      },
      {
        id: "qty",
        header: () => <div className="text-right">Qty</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {row.original.qty} {row.original.unit || "Pcs"}
          </div>
        ),
        size: 80,
      },
      {
        accessorKey: "unit_price",
        id: "unit_price",
        header: () => <div className="text-right">Harga Satuan</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums whitespace-nowrap">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {formatRupiah(row.original.unit_price)}
            </div>
            {row.original.base_unit_price != null && row.original.base_unit && (
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {formatUnitRupiah(row.original.base_unit_price)}/{row.original.base_unit}
              </div>
            )}
          </div>
        ),
        size: 115,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: () => <div className="text-right">Total</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {formatRupiah(row.original.total_price)}
          </div>
        ),
        size: 110,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onNavigateToExpense?.(item)}
                className="h-7 px-2.5 text-[11px] font-semibold text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:border-blue-900/60 dark:hover:bg-blue-950/50 rounded-lg gap-1 transition-colors shrink-0"
                title={`Buka transaksi ${item.item_name} di daftar transaksi`}
              >
                <ReceiptText className="w-3.5 h-3.5" />
                <span>Lihat Transaksi</span>
                <ArrowRight className="w-3 h-3 opacity-70" />
              </Button>
            </div>
          );
        },
        size: 140,
      },
    ],
    [onNavigateToExpense]
  );

  const priceHistoryTable = useTable({
    features: dataGridFeatures,
    columns: priceHistoryColumns,
    data: data?.history ?? [],
    getRowId: (row: PriceHistoryRecord) => String(row.id),
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 10,
      },
    },
  });

  return (
    <Dialog open={!!(itemName || itemId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 dark:bg-slate-900 dark:border-slate-800">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="truncate">Riwayat Harga & Perbandingan Toko: {data?.item_name || itemName}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Memuat riwayat harga & perbandingan toko...
          </div>
        ) : !data || data.tx_count === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Belum ada riwayat transaksi untuk barang ini.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 dark:bg-emerald-950/30 dark:border-emerald-800/60">
                <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase">
                  Harga Termurah
                </div>
                <div className="text-sm font-bold text-emerald-800 dark:text-emerald-300 mt-0.5 tabular-nums">
                  {isBaseUnitMode ? (
                    <>
                      {formatUnitRupiah(data.base_min_price)}
                      <span className="text-[10px] font-medium opacity-80 ml-0.5">/{baseUnit}</span>
                    </>
                  ) : (
                    formatRupiah(data.min_price)
                  )}
                </div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                  di {isBaseUnitMode ? data.base_cheapest_supplier || data.cheapest_supplier : data.cheapest_supplier}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200/80 dark:bg-blue-950/30 dark:border-blue-800/60">
                <div className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase">
                  Harga Rata-rata
                </div>
                <div className="text-sm font-bold text-blue-800 dark:text-blue-300 mt-0.5 tabular-nums">
                  {isBaseUnitMode ? (
                    <>
                      {formatUnitRupiah(data.base_avg_price)}
                      <span className="text-[10px] font-medium opacity-80 ml-0.5">/{baseUnit}</span>
                    </>
                  ) : (
                    formatRupiah(data.avg_price)
                  )}
                </div>
                <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
                  dari {data.tx_count} pembelian
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-100/80 border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700">
                <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase">
                  Harga Terakhir
                </div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5 tabular-nums">
                  {isBaseUnitMode ? (
                    <>
                      {formatUnitRupiah(data.base_latest_price)}
                      <span className="text-[10px] font-medium opacity-80 ml-0.5">/{baseUnit}</span>
                    </>
                  ) : (
                    formatRupiah(data.latest_price)
                  )}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  Tertinggi:{" "}
                  {isBaseUnitMode
                    ? `${formatUnitRupiah(data.base_max_price)}/${baseUnit}`
                    : formatRupiah(data.max_price)}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 dark:bg-amber-950/30 dark:border-amber-800/60">
                <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase">
                  Rekomendasi Toko
                </div>
                <div className="text-xs font-bold text-amber-900 dark:text-amber-200 mt-1 truncate">
                  {isBaseUnitMode ? data.base_cheapest_supplier || data.cheapest_supplier : data.cheapest_supplier}
                </div>
                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                  {isBaseUnitMode ? `Paling hemat per ${baseUnit}` : "Paling hemat"}
                </div>
              </div>
            </div>

            {/* ── Chart Inflasi & Tren Harga Satuan ── */}
            <div className="border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 bg-white dark:bg-slate-900/60 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 shrink-0">
                    <LineChartIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                      Grafik Inflasi & Tren Harga Beli
                    </h4>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {isBaseUnitMode
                        ? `Pergerakan harga per ${baseUnit} ${data.item_name || itemName} antar waktu`
                        : `Pergerakan harga satuan ${data.item_name || itemName} antar waktu`}
                    </p>
                  </div>
                </div>

                {/* Status Inflasi Badge */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {isBaseUnitMode && (
                    <Badge
                      variant="outline"
                      className="text-[10px] font-medium px-2 py-0.5 bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700"
                    >
                      Satuan: {baseUnit}
                    </Badge>
                  )}
                  {inflationStats ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold px-2 py-0.5 gap-1 ${
                        inflationStats.isInflation
                          ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                          : inflationStats.isDeflation
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                          : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {inflationStats.isInflation ? (
                        <>
                          <TrendingUp className="w-3 h-3 text-rose-600" />
                          <span>Inflasi +{inflationStats.pct}%</span>
                          <span className="text-[9px] opacity-80">
                            (+{formatUnitRupiah(inflationStats.diff)}
                            {isBaseUnitMode ? `/${baseUnit}` : ""})
                          </span>
                        </>
                      ) : inflationStats.isDeflation ? (
                        <>
                          <TrendingDown className="w-3 h-3 text-emerald-600" />
                          <span>Turun {inflationStats.pct}%</span>
                          <span className="text-[9px] opacity-80">
                            (-{formatUnitRupiah(Math.abs(inflationStats.diff))}
                            {isBaseUnitMode ? `/${baseUnit}` : ""})
                          </span>
                        </>
                      ) : (
                        <>
                          <Minus className="w-3 h-3 text-slate-500" />
                          <span>Harga Stabil (0%)</span>
                        </>
                      )}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-normal text-slate-500 border-slate-200">
                      {chartData.length === 1 ? "1 Catatan Pembelian" : "Belum Cukup Data"}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Chart Visual Canvas */}
              {chartData.length < 2 ? (
                <div className="py-8 text-center text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-950/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-1 px-4">
                  <p className="font-semibold text-slate-700 dark:text-slate-300">
                    {chartData.length === 1
                      ? `Tercatat 1 transaksi pembelian: ${formatUnitRupiah(chartData[0]?.unitPrice || 0)}${
                          isBaseUnitMode ? ` / ${baseUnit}` : ""
                        }`
                      : isBaseUnitMode
                      ? `Belum ada transaksi dengan konversi ke ${baseUnit}.`
                      : "Belum cukup data transaksi."}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {isBaseUnitMode
                      ? `Grafik fluktuasi inflasi per ${baseUnit} akan muncul otomatis setelah minimal 2 pembelian terkonversi ke ${baseUnit}.`
                      : "Grafik fluktuasi inflasi akan muncul otomatis setelah barang ini dibeli minimal 2 kali."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="h-52 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartData}
                        margin={{ top: 10, right: 12, left: -10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorPriceInflation" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={strokeColor} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={strokeColor} stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                        <XAxis
                          dataKey="dayLabel"
                          stroke="#94a3b8"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          domain={["auto", "auto"]}
                          tickFormatter={(val) => {
                            const n = Number(val);
                            if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
                            if (n >= 1000) return `${Math.round(n / 1000)}k`;
                            if (Number.isInteger(n)) return String(n);
                            return String(Number(n.toFixed(2)));
                          }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const p = payload[0].payload;
                              return (
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 shadow-lg text-xs space-y-1 min-w-[205px]">
                                  <div className="flex items-center justify-between text-slate-500 text-[10px] gap-2">
                                    <span>{formatDateId(p.date, true)}</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[110px]">
                                      {p.supplier}
                                    </span>
                                  </div>
                                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                                    {formatUnitRupiah(p.unitPrice)}
                                    <span className="text-[10px] font-normal text-slate-500 ml-1">
                                      / {p.displayUnit}
                                    </span>
                                  </div>
                                  {isBaseUnitMode && (
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                      Beli: {p.qty} {p.purchaseUnit} @ {formatRupiah(p.purchaseUnitPrice)}
                                    </div>
                                  )}
                                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] gap-2">
                                    <span className="text-slate-500">vs Harga Awal:</span>
                                    <span
                                      className={`font-bold tabular-nums ${
                                        p.diffFromBase > 0
                                          ? "text-rose-600 dark:text-rose-400"
                                          : p.diffFromBase < 0
                                          ? "text-emerald-600 dark:text-emerald-400"
                                          : "text-slate-600"
                                      }`}
                                    >
                                      {p.diffFromBase > 0
                                        ? `+${p.inflationPct}% (+${formatUnitRupiah(p.diffFromBase)})`
                                        : p.diffFromBase < 0
                                        ? `${p.inflationPct}% (-${formatUnitRupiah(Math.abs(p.diffFromBase))})`
                                        : "Titik Awal (Baseline)"}
                                    </span>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="unitPrice"
                          stroke={strokeColor}
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#colorPriceInflation)"
                          dot={{ r: 3, fill: strokeColor }}
                          activeDot={{ r: 5, strokeWidth: 1.5, stroke: "#fff" }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {skippedUnconvertedCount > 0 && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {skippedUnconvertedCount} transaksi belum memiliki konversi ke {baseUnit} sehingga tidak diikutkan dalam grafik.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Perbandingan Antar Toko */}
            {data.suppliers_comparison.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Perbandingan Harga {isBaseUnitMode ? `per ${baseUnit}` : "Satuan"} Antar Toko / Supplier
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.suppliers_comparison.map((s, idx) => {
                    const hasSupBase = isBaseUnitMode && s.base_min_price != null;
                    return (
                      <div
                        key={s.supplier}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                          idx === 0
                            ? "bg-emerald-50/40 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
                            : "bg-white border-slate-200/80 dark:bg-slate-900/60 dark:border-slate-800"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                              {s.supplier}
                            </span>
                            {idx === 0 && (
                              <Badge className="bg-emerald-600 text-white text-[9px] px-1.5 py-0 gap-0.5">
                                <Award className="w-2.5 h-2.5" />
                                Termurah
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {s.tx_count}x transaksi • Terakhir {formatDateId(s.last_date)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                            {hasSupBase
                              ? `${formatUnitRupiah(s.base_min_price)}/${baseUnit}`
                              : formatRupiah(s.min_price)}
                          </div>
                          {hasSupBase && s.base_max_price != null && s.base_max_price > (s.base_min_price ?? 0) && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                              s/d {formatUnitRupiah(s.base_max_price)}/{baseUnit}
                            </div>
                          )}
                          {!hasSupBase && s.max_price > s.min_price && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                              s/d {formatRupiah(s.max_price)}
                            </div>
                          )}
                          {hasSupBase && (
                            <div className="text-[9px] text-slate-400 dark:text-slate-500 tabular-nums">
                              Beli: {formatRupiah(s.min_price)}
                              {s.max_price > s.min_price ? ` – ${formatRupiah(s.max_price)}` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Riwayat Transaksi Terakhir */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-500" />
                Riwayat Pembelian Terakhir ({data.history.length} transaksi)
              </h4>
              <DataTable
                table={priceHistoryTable}
                recordCount={data.history.length}
                isLoading={isLoading}
                scrollAreaClassName="max-h-[260px]"
                showPagination={data.history.length > 10}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
