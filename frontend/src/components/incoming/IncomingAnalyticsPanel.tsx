import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from "recharts";
import { getIncomingAnalytics } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/common/DataTable";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef } from "@tanstack/react-table";
import {
  Loader2,
  AlertCircle,
  TrendingUp,
  Clock,
  Award,
  AlertTriangle,
  BarChart3,
  Layers,
  RotateCcw,
} from "lucide-react";
import type { IncomingAnalyticsProductRow, IncomingAnalyticsRadarPoint } from "@/types";

interface IncomingAnalyticsPanelProps {
  startDate?: string;
  endDate?: string;
}

const formatQty = (val: number): string => {
  if (!Number.isFinite(val)) return "0";
  return Number.isInteger(val) ? val.toLocaleString("id-ID") : val.toLocaleString("id-ID", { maximumFractionDigits: 2 });
};

interface RadarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: IncomingAnalyticsRadarPoint }>;
}

const RadarMenuTooltip: React.FC<RadarTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm text-xs max-w-[260px]">
      <div className="font-semibold text-slate-900 leading-snug">{pt.product_name}</div>
      <div className="text-[11px] text-slate-500 mb-1.5">{pt.category}</div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
            Qty Terjual
          </span>
          <span className="font-semibold text-slate-900">
            {formatQty(pt.total_qty)} pcs ({pt.qty_score}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            Omset Net
          </span>
          <span className="font-semibold text-emerald-700">
            {formatRupiah(pt.net_sales)} ({pt.revenue_score}%)
          </span>
        </div>
      </div>
    </div>
  );
};

interface ProductRankTableProps {
  title: string;
  subtitle: string;
  mode: "qty" | "revenue";
  rows: IncomingAnalyticsProductRow[];
}

const ProductRankTable: React.FC<ProductRankTableProps> = ({ title, subtitle, mode, rows }) => {
  const maxVal = Math.max(
    ...rows.map((r) => (mode === "qty" ? r.total_qty : r.net_sales)),
    1
  );

  const columns = useMemo<ColumnDef<DataGridFeatures, IncomingAnalyticsProductRow>[]>(
    () => [
      {
        id: "rank",
        header: () => <span>#</span>,
        cell: ({ row }) => (
          <span className="text-slate-500 font-mono tabular-nums">{row.index + 1}</span>
        ),
        size: 40,
        enableSorting: false,
      },
      {
        accessorKey: "product_name",
        id: "product_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Menu & Channel" column={column} />
        ),
        cell: ({ row }) => {
          const p = row.original;
          const primaryVal = mode === "qty" ? p.total_qty : p.net_sales;
          const barWidth = Math.max(4, Math.round((primaryVal / maxVal) * 100));
          const orderTypes = p.order_types || [];
          return (
            <div>
              <div className="font-medium text-slate-900 leading-snug">{p.product_name}</div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[11px] text-slate-500">{p.category}</span>
                {orderTypes.slice(0, 3).map((ot) => {
                  const isCf = ot.toLowerCase().replace(/[\s_-]+/g, "").includes("cakeflow");
                  return (
                    <span
                      key={ot}
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        isCf
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                    >
                      {ot}
                    </span>
                  );
                })}
              </div>
              <div className="mt-1.5 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    mode === "qty" ? "bg-blue-600" : "bg-emerald-600"
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        },
        size: 240,
      },
      {
        accessorKey: mode === "qty" ? "total_qty" : "net_sales",
        id: "primary_metric",
        header: ({ column }) => (
          <DataGridColumnHeader
            title={mode === "qty" ? "Qty (Pcs)" : "Omset Net"}
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const p = row.original;
          const sharePct = mode === "qty" ? (p.qty_share_pct ?? 0) : (p.revenue_share_pct ?? 0);
          return (
            <div className="text-right tabular-nums whitespace-nowrap">
              <div
                className={`font-semibold ${
                  mode === "qty" ? "text-blue-700" : "text-emerald-700"
                }`}
              >
                {mode === "qty" ? formatQty(p.total_qty) : formatRupiah(p.net_sales)}
              </div>
              <div className="text-[10px] text-slate-500">{sharePct}% porsi</div>
            </div>
          );
        },
        size: 120,
      },
      {
        accessorKey: mode === "qty" ? "net_sales" : "total_qty",
        id: "secondary_metric",
        header: ({ column }) => (
          <DataGridColumnHeader
            title={mode === "qty" ? "Omset Net" : "Qty (Pcs)"}
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="text-right tabular-nums text-slate-700 whitespace-nowrap">
              <div className="font-medium">
                {mode === "qty" ? formatRupiah(p.net_sales) : `${formatQty(p.total_qty)} pcs`}
              </div>
              {p.avg_price !== undefined && p.avg_price > 0 && (
                <div className="text-[10px] text-slate-500">
                  avg {formatRupiah(p.avg_price)}
                </div>
              )}
            </div>
          );
        },
        size: 120,
      },
    ],
    [mode, maxVal]
  );

  return (
    <Card className="border-slate-200 shadow-xs overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              {mode === "qty" ? (
                <Award className="w-4 h-4 text-blue-600 shrink-0" />
              ) : (
                <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
              {title}
            </CardTitle>
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <Badge variant="outline" className="text-[11px] font-medium text-slate-600 shrink-0">
            {rows.length} menu
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-slate-500">
            Belum ada data menu pada periode dan filter tipe order ini.
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r, i) => `${mode}-${r.product_name}-${i}`}
            defaultPageSize={10}
            containerClassName="border-0 rounded-none shadow-none border-t border-slate-200"
          />
        )}
      </CardContent>
    </Card>
  );
};

export const IncomingAnalyticsPanel: React.FC<IncomingAnalyticsPanelProps> = ({
  startDate,
  endDate,
}) => {
  const [selectedOrderType, setSelectedOrderType] = useState<string>("all");
  const [radarBasis, setRadarBasis] = useState<"qty" | "revenue">("qty");

  const { data: analytics, isLoading, isError, refetch } = useQuery({
    queryKey: ["incoming-analytics", { startDate, endDate, orderType: selectedOrderType }],
    queryFn: () =>
      getIncomingAnalytics({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        order_type: selectedOrderType !== "all" ? selectedOrderType : undefined,
        top_limit: 15,
      }),
  });

  const rawRadarData = useMemo(() => {
    if (!analytics) return [];
    return radarBasis === "qty"
      ? analytics.radar_by_qty || []
      : analytics.radar_by_revenue || [];
  }, [analytics, radarBasis]);

  // Recharts PolarAngleAxis membutuhkan kategori dataKey yang unik agar Radar tidak menghasilkan koordinat NaN.
  const { radarChartData, radarLabelByKey } = useMemo(() => {
    const usedLabels = new Map<string, number>();
    const labelMap = new Map<string, string>();
    const normalized = rawRadarData.map((pt, idx) => {
      const baseLabel = (pt.label || pt.product_name || `Menu ${idx + 1}`).trim();
      const normKey = baseLabel.toLowerCase();
      const count = (usedLabels.get(normKey) ?? 0) + 1;
      usedLabels.set(normKey, count);
      const displayLabel = count === 1 ? baseLabel : `${baseLabel} #${count}`;
      const axisKey = `${idx}::${pt.product_name || baseLabel}`;
      labelMap.set(axisKey, displayLabel);

      const qtyScore = Number(pt.qty_score);
      const revScore = Number(pt.revenue_score);
      return {
        ...pt,
        axis_key: axisKey,
        display_label: displayLabel,
        qty_score: Number.isFinite(qtyScore) ? Math.max(0, Math.min(100, qtyScore)) : 0,
        revenue_score: Number.isFinite(revScore) ? Math.max(0, Math.min(100, revScore)) : 0,
      };
    });
    return { radarChartData: normalized, radarLabelByKey: labelMap };
  }, [rawRadarData]);

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        Memuat statistik radar menu (Top Qty &amp; Omset), kontribusi channel, dan jam sibuk...
      </div>
    );
  }

  if (isError || !analytics) {
    return (
      <div className="py-10 flex flex-col items-center justify-center gap-2.5 text-center">
        <AlertCircle className="w-6 h-6 text-rose-600" />
        <p className="text-sm font-medium text-slate-800">
          Gagal memuat statistik radar menu dan jam sibuk.
        </p>
        <p className="text-xs text-slate-500">
          Periksa koneksi server lalu muat ulang data analitik.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" />
          Muat Ulang
        </Button>
      </div>
    );
  }

  const summary = analytics.summary || {
    total_paid_tx: 0,
    total_qty: 0,
    total_net_sales: 0,
    total_net_received: 0,
    unique_products: 0,
    cakeflow_tx_count: 0,
    cakeflow_qty: 0,
    cakeflow_net_sales: 0,
    cakeflow_net_received: 0,
    unscheduled_time_count: 0,
  };

  const topByQty = analytics.top_products_by_qty || analytics.top_products || [];
  const topByRevenue = analytics.top_products_by_revenue || analytics.top_products || [];
  const byChannel = analytics.by_channel || [];
  const availableOrderTypes = analytics.available_order_types || [];

  const maxHourCount = Math.max(...analytics.peak_hours.map((h) => h.total_count), 1);
  const maxCatSales = Math.max(...analytics.categories.map((c) => c.net_sales), 1);
  const maxChannelSales = Math.max(...byChannel.map((c) => c.net_received), 1);

  const cakeflowSharePct =
    summary.total_net_received > 0
      ? ((summary.cakeflow_net_received / summary.total_net_received) * 100).toFixed(1)
      : "0.0";
  const topChannel = byChannel[0];

  const isEmpty = summary.total_paid_tx === 0 && topByQty.length === 0;

  return (
    <div className="space-y-3">
      {/* Filter Bar per Tipe Order (Channel) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white border border-slate-200 rounded-xl p-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-700">Filter Tipe Order:</span>
          <select
            aria-label="Filter tipe order untuk radar menu"
            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            value={selectedOrderType}
            onChange={(e) => setSelectedOrderType(e.target.value)}
          >
            <option value="all">Semua Tipe Order (Termasuk Cake Flow)</option>
            {availableOrderTypes.map((ot) => (
              <option key={ot} value={ot}>
                {ot}
              </option>
            ))}
          </select>
          {selectedOrderType !== "all" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedOrderType("all")}
              className="h-9 text-xs text-blue-700 hover:text-blue-800 hover:bg-blue-50 gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Semua Channel
            </Button>
          )}
        </div>
        <div className="text-[11px] text-slate-600">
          {startDate && endDate
            ? `Periode: ${startDate} s/d ${endDate}`
            : "Periode: Seluruh data transaksi masuk lunas"}
        </div>
      </div>

      {isEmpty ? (
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="py-12 px-4 text-center space-y-2">
            <BarChart3 className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-800">
              Belum ada transaksi dibayar untuk dianalisis
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {selectedOrderType !== "all"
                ? `Tidak ditemukan transaksi lunas untuk tipe order "${selectedOrderType}" pada periode ini.`
                : "Impor laporan POS, Cake Flow, atau tambahkan transaksi masuk lunas agar Radar Menu Top Qty dan Omset dapat dihitung."}
            </p>
            {selectedOrderType !== "all" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedOrderType("all")}
                className="mt-2"
              >
                Tampilkan Semua Tipe Order
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-3.5">
                <div className="text-[11px] text-slate-600">Total Volume Terjual</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums mt-0.5">
                  {formatQty(summary.total_qty)} pcs
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {summary.unique_products} menu unik • {summary.total_paid_tx} transaksi
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-3.5">
                <div className="text-[11px] text-slate-600">Total Omset Net</div>
                <div className="text-lg font-semibold text-emerald-700 tabular-nums mt-0.5">
                  {formatRupiah(summary.total_net_sales)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Bersih diterima: {formatRupiah(summary.total_net_received)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-200/80 bg-amber-50/30 shadow-xs">
              <CardContent className="p-3.5">
                <div className="text-[11px] text-amber-900 font-medium">Kontribusi Cake Flow</div>
                <div className="text-lg font-semibold text-amber-800 tabular-nums mt-0.5">
                  {formatRupiah(summary.cakeflow_net_received)}
                </div>
                <div className="text-[11px] text-amber-800/80 mt-0.5">
                  {summary.cakeflow_tx_count} order • {formatQty(summary.cakeflow_qty)} pcs ({cakeflowSharePct}%)
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-3.5">
                <div className="text-[11px] text-slate-600">Tipe Order Terbesar</div>
                <div className="text-lg font-semibold text-slate-900 truncate mt-0.5">
                  {topChannel ? topChannel.channel : "-"}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {topChannel
                    ? `${formatRupiah(topChannel.net_received)} (${topChannel.revenue_share_pct}%)`
                    : "Belum ada data"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Radar Menu Visual + Kontribusi Tipe Order */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card className="border-slate-200 shadow-xs lg:col-span-3">
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
                      Radar Menu: Perbandingan Volume Qty vs Omset Net
                    </CardTitle>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Skala indeks relatif 0 sampai 100 terhadap menu tertinggi pada kelompok Top 8.
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Pilih basis pemeringkatan radar menu"
                    className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start sm:self-auto"
                  >
                    <button
                      type="button"
                      aria-pressed={radarBasis === "qty"}
                      onClick={() => setRadarBasis("qty")}
                      className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        radarBasis === "qty"
                          ? "bg-white text-blue-700 shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Basis Top Qty
                    </button>
                    <button
                      type="button"
                      aria-pressed={radarBasis === "revenue"}
                      onClick={() => setRadarBasis("revenue")}
                      className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        radarBasis === "revenue"
                          ? "bg-white text-emerald-700 shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Basis Top Omset
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {radarChartData.length >= 3 ? (
                  <>
                    <div className="w-full h-[310px] sm:h-[330px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          key={radarBasis}
                          cx="50%"
                          cy="50%"
                          outerRadius="68%"
                          margin={{ top: 18, right: 28, bottom: 18, left: 28 }}
                          data={radarChartData}
                        >
                          <PolarGrid stroke="#e2e8f0" />
                          <PolarAngleAxis
                            dataKey="axis_key"
                            tickFormatter={(val: string) => radarLabelByKey.get(val) ?? val}
                            tick={{ fill: "#334155", fontSize: 11 }}
                          />
                          <PolarRadiusAxis
                            angle={67.5}
                            domain={[0, 100]}
                            tick={{ fill: "#64748b", fontSize: 10 }}
                            tickCount={5}
                            axisLine={false}
                          />
                          <Radar
                            name="Indeks Qty"
                            dataKey="qty_score"
                            stroke="#2563eb"
                            fill="#2563eb"
                            fillOpacity={0.22}
                            strokeWidth={2}
                            dot={{ r: 3, fill: "#2563eb", stroke: "#ffffff", strokeWidth: 1.5 }}
                            activeDot={{ r: 5, fill: "#2563eb", stroke: "#ffffff", strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                          <Radar
                            name="Indeks Omset"
                            dataKey="revenue_score"
                            stroke="#059669"
                            fill="#059669"
                            fillOpacity={0.22}
                            strokeWidth={2}
                            dot={{ r: 3, fill: "#059669", stroke: "#ffffff", strokeWidth: 1.5 }}
                            activeDot={{ r: 5, fill: "#059669", stroke: "#ffffff", strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                          <Tooltip content={<RadarMenuTooltip />} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-[11px] text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
                        Indeks Qty (Volume Terjual)
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
                        Indeks Omset Net (Rupiah)
                      </span>
                    </div>
                  </>
                ) : radarChartData.length === 0 ? (
                  <div className="py-10 px-4 text-center text-xs text-slate-500">
                    Belum ada data rincian menu pada periode dan filter ini. Tambahkan item transaksi atau ubah filter tipe order untuk menampilkan Radar Menu.
                  </div>
                ) : (
                  <div className="space-y-3 py-2">
                    <p className="text-xs text-slate-500">
                      Grafik radar membutuhkan minimal 3 menu unik. Menampilkan perbandingan langsung Qty dan Omset:
                    </p>
                    {radarChartData.map((pt) => (
                      <div key={pt.axis_key} className="space-y-1 text-xs border-b border-slate-100 pb-2 last:border-0">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-slate-900">{pt.product_name}</span>
                          <span className="tabular-nums text-slate-600">
                            {formatQty(pt.total_qty)} pcs • {formatRupiah(pt.net_sales)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-600" style={{ width: `${pt.qty_score}%` }} />
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-600" style={{ width: `${pt.revenue_score}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Kontribusi per Tipe Order (Channel) termasuk Cake Flow */}
            <Card className="border-slate-200 shadow-xs lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-600 shrink-0" />
                  Kontribusi Tipe Order &amp; Cake Flow
                </CardTitle>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Seluruh channel transaksi masuk lunas yang masuk ke statistik &amp; akuntansi.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {byChannel.map((ch) => {
                  const barW = Math.max(4, Math.round((ch.net_received / maxChannelSales) * 100));
                  return (
                    <div key={ch.channel} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium text-slate-900 truncate">{ch.channel}</span>
                          {ch.is_cakeflow && (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-800 border-amber-200 text-[10px] px-1.5 py-0 shrink-0"
                            >
                              Cake Flow
                            </Badge>
                          )}
                        </div>
                        <span className="font-semibold text-slate-900 tabular-nums shrink-0">
                          {formatRupiah(ch.net_received)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                        <span>
                          {ch.tx_count} order • {formatQty(ch.total_qty)} pcs
                        </span>
                        <span>{ch.revenue_share_pct}% omset</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            ch.is_cakeflow ? "bg-amber-500" : "bg-blue-600"
                          }`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Dual Ranking Tables: Top Qty vs Top Omset */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ProductRankTable
              title="Top 15 Menu Berdasarkan Qty"
              subtitle="Urutan menu dengan jumlah unit terjual terbanyak (termasuk order Cake Flow)."
              mode="qty"
              rows={topByQty}
            />
            <ProductRankTable
              title="Top 15 Menu Berdasarkan Omset"
              subtitle="Urutan menu dengan kontribusi omset net terbesar (termasuk order Cake Flow)."
              mode="revenue"
              rows={topByRevenue}
            />
          </div>

          {/* Jam Sibuk Order + Kontribusi Kategori Produk */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-slate-200 shadow-xs">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                    Radar Jam Sibuk Order
                  </span>
                  <span className="text-[11px] font-normal text-slate-500">
                    Toko vs Online vs Cake Flow
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {analytics.peak_hours.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    Belum ada data jam transaksi pada periode ini.
                  </div>
                ) : (
                  analytics.peak_hours.map((h) => {
                    const cfCount = h.cakeflow_count || 0;
                    const offlineW = Math.round((h.offline_count / maxHourCount) * 100);
                    const onlineW = Math.round((h.online_count / maxHourCount) * 100);
                    const cfW = Math.round((cfCount / maxHourCount) * 100);
                    return (
                      <div key={h.hour} className="flex items-center gap-2.5 text-xs">
                        <span className="w-11 font-mono text-[11px] text-slate-600 shrink-0">
                          {h.label}
                        </span>
                        <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden flex">
                          <div
                            className="bg-blue-600 h-full"
                            style={{ width: `${offlineW}%` }}
                            title={`Toko / Offline: ${h.offline_count} order`}
                          />
                          <div
                            className="bg-emerald-500 h-full"
                            style={{ width: `${onlineW}%` }}
                            title={`Online Delivery: ${h.online_count} order`}
                          />
                          <div
                            className="bg-amber-500 h-full"
                            style={{ width: `${cfW}%` }}
                            title={`Cake Flow: ${cfCount} order`}
                          />
                        </div>
                        <span className="w-14 text-right font-medium text-slate-700 tabular-nums shrink-0">
                          {h.total_count} tx
                        </span>
                        <span className="w-24 text-right text-[11px] text-slate-600 tabular-nums shrink-0 hidden sm:inline">
                          {formatRupiah(h.net_received)}
                        </span>
                      </div>
                    );
                  })
                )}
                {analytics.peak_hours.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[11px] text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" />
                      Take Away / Toko
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                      Online Delivery
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
                      Cake Flow
                    </span>
                  </div>
                )}
                {summary.unscheduled_time_count > 0 && (
                  <p className="text-[11px] text-slate-500 pt-1">
                    Catatan: {summary.unscheduled_time_count} transaksi tidak memiliki jam transaksi sehingga tidak dipetakan ke grafik jam, namun tetap masuk dalam perhitungan Radar Menu dan Akuntansi.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="border-slate-200 shadow-xs">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                    Kontribusi Kategori Produk
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {analytics.categories.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      Belum ada data kategori produk.
                    </div>
                  ) : (
                    analytics.categories.map((c) => {
                      const w = Math.max(4, Math.round((c.net_sales / maxCatSales) * 100));
                      const isCfCat = c.category.toLowerCase().replace(/[\s_-]+/g, "").includes("cakeflow");
                      return (
                        <div key={c.category} className="space-y-1 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium text-slate-800">
                              {c.category}{" "}
                              <span className="text-slate-500 font-normal">
                                ({formatQty(c.total_qty)} pcs)
                              </span>
                            </span>
                            <span className="font-semibold text-slate-900 tabular-nums shrink-0">
                              {formatRupiah(c.net_sales)}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isCfCat ? "bg-amber-500" : "bg-emerald-600"
                              }`}
                              style={{ width: `${w}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              {analytics.void_by_channel.length > 0 && (
                <Card className="border-amber-200 bg-amber-50/40 shadow-xs">
                  <CardContent className="p-3.5">
                    <div className="text-xs font-semibold text-amber-900 flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Ringkasan Void per Channel
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {analytics.void_by_channel.map((v) => (
                        <Badge
                          key={v.channel}
                          variant="outline"
                          className="bg-white border-amber-200 text-amber-900 text-[11px]"
                        >
                          {v.channel}: {v.count} struk ({formatRupiah(v.amount)})
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
