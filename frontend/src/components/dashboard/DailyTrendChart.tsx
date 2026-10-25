import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

interface DailyTrendChartProps {
  data: Array<{ date: string; total: number; count: number }>;
}

export const DailyTrendChart: React.FC<DailyTrendChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <Card className="h-full flex flex-col justify-center items-center p-8 text-center border-slate-200">
        <TrendingUp className="w-10 h-10 text-slate-300 mb-2" />
        <p className="text-sm font-medium text-slate-500">Belum ada aktivitas transaksi harian</p>
      </Card>
    );
  }

  // Format date labels (e.g. "01", "02")
  const formattedData = data.map((d) => ({
    ...d,
    dayLabel: d.date.split("-")[2] || d.date,
  }));

  return (
    <Card className="h-full flex flex-col border-slate-200 shadow-sm">
      <CardHeader className="p-4 md:p-5 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            Tren Pengeluaran Harian
          </CardTitle>
          <span className="text-xs text-slate-500 font-medium">Bulan Ini</span>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-5 pt-2 flex-1">
        <div className="h-56 md:h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="dayLabel"
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => {
                  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                  if (val >= 1000) return `${Math.round(val / 1000)}k`;
                  return val;
                }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const row = payload[0].payload;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white/95 backdrop-blur-md p-2.5 shadow-lg text-xs">
                        <div className="font-semibold text-slate-700">{formatDateId(row.date, true)}</div>
                        <div className="text-emerald-600 font-bold tabular-nums mt-0.5">
                          {formatRupiah(row.total)}
                        </div>
                        <div className="text-slate-500 text-[10px]">{row.count} transaksi</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#10b981"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#colorTotal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
