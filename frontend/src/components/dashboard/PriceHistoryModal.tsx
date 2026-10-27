import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ItemPriceHistoryResponse } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Award,
  Store,
  TrendingDown,
  TrendingUp,
  History,
  Package,
  LineChart as LineChartIcon,
  Minus,
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

interface PriceHistoryModalProps {
  itemName: string | null;
  itemId?: number | null;
  onClose: () => void;
}

export const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({
  itemName,
  itemId,
  onClose,
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
  });

  // Urutkan data secara kronologis (dari tanggal terlama ke terbaru) untuk chart inflasi harga
  const chartData = useMemo(() => {
    if (!data?.history || data.history.length === 0) return [];

    const validHistory = data.history.filter((h) => (h.unit_price || 0) > 0);
    if (validHistory.length === 0) return [];

    const sorted = [...validHistory].sort(
      (a, b) => new Date(a.expense_date).getTime() - new Date(b.expense_date).getTime()
    );

    const baselinePrice = sorted[0].unit_price;

    return sorted.map((h, index) => {
      const diffFromBase = h.unit_price - baselinePrice;
      const inflationPct = baselinePrice > 0 ? (diffFromBase / baselinePrice) * 100 : 0;
      const prevPrice = index > 0 ? sorted[index - 1].unit_price : h.unit_price;
      const diffFromPrev = h.unit_price - prevPrice;
      const changeFromPrevPct = prevPrice > 0 ? (diffFromPrev / prevPrice) * 100 : 0;

      return {
        id: h.id,
        date: h.expense_date,
        dayLabel: h.expense_date.split("-").slice(1).join("/"),
        unitPrice: h.unit_price,
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
  }, [data?.history]);

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
                  {formatRupiah(data.min_price)}
                </div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                  di {data.cheapest_supplier}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200/80 dark:bg-blue-950/30 dark:border-blue-800/60">
                <div className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase">
                  Harga Rata-rata
                </div>
                <div className="text-sm font-bold text-blue-800 dark:text-blue-300 mt-0.5 tabular-nums">
                  {formatRupiah(data.avg_price)}
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
                  {formatRupiah(data.latest_price)}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Tertinggi: {formatRupiah(data.max_price)}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 dark:bg-amber-950/30 dark:border-amber-800/60">
                <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase">
                  Rekomendasi Toko
                </div>
                <div className="text-xs font-bold text-amber-900 dark:text-amber-200 mt-1 truncate">
                  {data.cheapest_supplier}
                </div>
                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                  Paling hemat
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
                      Pergerakan harga satuan {data.item_name || itemName} antar waktu
                    </p>
                  </div>
                </div>

                {/* Status Inflasi Badge */}
                {inflationStats ? (
                  <div className="flex items-center gap-2">
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
                          <span className="text-[9px] opacity-80">(+{formatRupiah(inflationStats.diff)})</span>
                        </>
                      ) : inflationStats.isDeflation ? (
                        <>
                          <TrendingDown className="w-3 h-3 text-emerald-600" />
                          <span>Turun {inflationStats.pct}%</span>
                          <span className="text-[9px] opacity-80">({formatRupiah(inflationStats.diff)})</span>
                        </>
                      ) : (
                        <>
                          <Minus className="w-3 h-3 text-slate-500" />
                          <span>Harga Stabil (0%)</span>
                        </>
                      )}
                    </Badge>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[10px] font-normal text-slate-500 border-slate-200">
                    {chartData.length === 1 ? "1 Catatan Pembelian" : "Belum Cukup Data"}
                  </Badge>
                )}
              </div>

              {/* Chart Visual Canvas */}
              {chartData.length < 2 ? (
                <div className="py-8 text-center text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-950/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-1">
                  <p className="font-semibold text-slate-700 dark:text-slate-300">
                    Tercatat 1 transaksi pembelian: {formatRupiah(chartData[0]?.unitPrice || 0)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Grafik fluktuasi inflasi akan muncul otomatis setelah barang ini dibeli minimal 2 kali.
                  </p>
                </div>
              ) : (
                <div className="h-52 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 10, right: 12, left: -15, bottom: 0 }}
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
                          if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                          if (val >= 1000) return `${Math.round(val / 1000)}k`;
                          return val;
                        }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const p = payload[0].payload;
                            return (
                              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 shadow-lg text-xs space-y-1 min-w-[190px]">
                                <div className="flex items-center justify-between text-slate-500 text-[10px]">
                                  <span>{formatDateId(p.date, true)}</span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[100px]">
                                    {p.supplier}
                                  </span>
                                </div>
                                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                                  {formatRupiah(p.unitPrice)}
                                  <span className="text-[10px] font-normal text-slate-500 ml-1">
                                    / {p.unit}
                                  </span>
                                </div>
                                <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px]">
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
                                      ? `+${p.inflationPct}% (+${formatRupiah(p.diffFromBase)})`
                                      : p.diffFromBase < 0
                                      ? `${p.inflationPct}% (${formatRupiah(p.diffFromBase)})`
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
              )}
            </div>

            {/* Perbandingan Antar Toko */}
            {data.suppliers_comparison.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Perbandingan Harga Satuan Antar Toko / Supplier
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.suppliers_comparison.map((s, idx) => (
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
                          {formatRupiah(s.min_price)}
                        </div>
                        {s.max_price > s.min_price && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                            s/d {formatRupiah(s.max_price)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Riwayat Transaksi Terakhir */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-500" />
                Riwayat Pembelian Terakhir ({data.history.length} transaksi)
              </h4>
              <div className="border border-slate-200/80 dark:border-slate-800 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-100 dark:border-slate-800 text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Tanggal</th>
                      <th className="py-2.5 px-3">Toko / Supplier</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Harga Satuan</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.history.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {formatDateId(h.expense_date)}
                        </td>
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium truncate max-w-[160px]">
                          {h.supplier}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {h.qty} {h.unit || "Pcs"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {formatRupiah(h.unit_price)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          {formatRupiah(h.total_price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
