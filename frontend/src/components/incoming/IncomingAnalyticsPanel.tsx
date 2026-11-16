import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getIncomingAnalytics } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, TrendingUp, Clock, Award, AlertTriangle } from "lucide-react";

interface IncomingAnalyticsPanelProps {
  startDate?: string;
  endDate?: string;
}

export const IncomingAnalyticsPanel: React.FC<IncomingAnalyticsPanelProps> = ({
  startDate,
  endDate,
}) => {
  const { data: analytics, isLoading, isError } = useQuery({
    queryKey: ["incoming-analytics", { startDate, endDate }],
    queryFn: () =>
      getIncomingAnalytics({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      }),
  });

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Memuat radar menu terlaris &amp; jam sibuk...
      </div>
    );
  }

  if (isError || !analytics) {
    return (
      <div className="py-10 flex flex-col items-center justify-center gap-2 text-center">
        <AlertCircle className="w-6 h-6 text-rose-500" />
        <p className="text-sm text-slate-600">Gagal memuat analitik produk &amp; jam sibuk.</p>
      </div>
    );
  }

  const maxHourCount = Math.max(...analytics.peak_hours.map((h) => h.total_count), 1);
  const maxCatSales = Math.max(...analytics.categories.map((c) => c.net_sales), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Produk Terlaris */}
        <Card className="border-slate-200 shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-600" />
              Top 15 Menu Terlaris
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {analytics.top_products.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Belum ada data item penjualan.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-y border-slate-200 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">Produk</th>
                      <th className="text-right px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium">Omzet Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.top_products.map((p, idx) => (
                      <tr key={p.product_name} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{p.product_name}</div>
                          <div className="text-[10px] text-slate-400">{p.category}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">
                          {p.total_qty}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">
                          {formatRupiah(p.net_sales)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Jam Sibuk Toko + Kategori */}
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  Radar Jam Sibuk Order
                </span>
                <span className="text-[11px] font-normal text-slate-500">
                  Offline vs Online Delivery
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {analytics.peak_hours.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  Belum ada data waktu transaksi.
                </div>
              ) : (
                analytics.peak_hours.map((h) => {
                  const offlineW = Math.round((h.offline_count / maxHourCount) * 100);
                  const onlineW = Math.round((h.online_count / maxHourCount) * 100);
                  return (
                    <div key={h.hour} className="flex items-center gap-2.5 text-xs">
                      <span className="w-11 font-mono text-[11px] text-slate-500 shrink-0">
                        {h.label}
                      </span>
                      <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden flex">
                        <div
                          className="bg-blue-600 h-full"
                          style={{ width: `${offlineW}%` }}
                          title={`Offline: ${h.offline_count} order`}
                        />
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${onlineW}%` }}
                          title={`Online: ${h.online_count} order`}
                        />
                      </div>
                      <span className="w-16 text-right font-medium text-slate-700 tabular-nums shrink-0">
                        {h.total_count} tx
                      </span>
                      <span className="w-24 text-right text-[11px] text-slate-500 tabular-nums shrink-0 hidden sm:inline">
                        {formatRupiah(h.net_received)}
                      </span>
                    </div>
                  );
                })
              )}
              {analytics.peak_hours.length > 0 && (
                <div className="flex items-center gap-4 pt-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" />
                    Take Away / Toko
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                    GoFood / GrabFood / ShopeeFood / Marketplace
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Kontribusi Kategori Produk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {analytics.categories.map((c) => {
                const w = Math.max(4, Math.round((c.net_sales / maxCatSales) * 100));
                return (
                  <div key={c.category} className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-800">
                        {c.category}{" "}
                        <span className="text-slate-400 font-normal">({c.total_qty} pcs)</span>
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {formatRupiah(c.net_sales)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="bg-emerald-600 h-full" style={{ width: `${w}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {analytics.void_by_channel.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/40 shadow-xs">
              <CardContent className="p-3.5">
                <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Ringkasan Void per Channel
                </div>
                <div className="flex flex-wrap gap-2">
                  {analytics.void_by_channel.map((v) => (
                    <Badge
                      key={v.channel}
                      variant="outline"
                      className="bg-white border-amber-200 text-amber-800 text-[11px]"
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
    </div>
  );
};
