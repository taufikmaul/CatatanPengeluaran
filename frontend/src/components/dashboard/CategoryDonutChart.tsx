import React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PieChart as PieIcon } from "lucide-react";

interface CategoryDonutChartProps {
  categoryData: Record<string, number>;
  totalAmount: number;
}

const COLORS = [
  "#2563eb", // blue-600
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#64748b", // slate-500
];

export const CategoryDonutChart: React.FC<CategoryDonutChartProps> = ({
  categoryData,
  totalAmount,
}) => {
  const chartData = Object.entries(categoryData)
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      percentage: totalAmount > 0 ? ((value / totalAmount) * 100).toFixed(1) : "0",
    }))
    .sort((a, b) => b.value - a.value);

  if (chartData.length === 0) {
    return (
      <Card className="h-full flex flex-col justify-center items-center p-8 text-center border-slate-200">
        <PieIcon className="w-10 h-10 text-slate-300 mb-2" />
        <p className="text-sm font-medium text-slate-500">Belum ada data pengeluaran di periode ini</p>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col border-slate-200 shadow-sm">
      <CardHeader className="p-4 md:p-5 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base font-semibold text-slate-800 flex items-center gap-2">
            <PieIcon className="w-4 h-4 text-blue-600" />
            Distribusi Kategori
          </CardTitle>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">
            {formatRupiah(totalAmount)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-5 pt-0 flex-1 flex flex-col justify-between">
        <div className="h-52 w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white/95 backdrop-blur-md p-2.5 shadow-lg text-xs">
                        <div className="font-semibold text-slate-800">{data.name}</div>
                        <div className="text-blue-600 font-bold tabular-nums mt-0.5">
                          {formatRupiah(data.value)} ({data.percentage}%)
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Center badge */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[11px] text-slate-400 font-medium">Total</span>
            <span className="text-xs font-bold text-slate-700">{chartData.length} Kat</span>
          </div>
        </div>

        {/* Legend pills */}
        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100 max-h-36 overflow-y-auto">
          {chartData.map((item, index) => (
            <div key={item.name} className="flex items-center gap-2 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: COLORS[index % COLORS.length] }}
              />
              <span className="truncate text-slate-600 font-medium">{item.name}</span>
              <span className="ml-auto text-slate-400 font-medium tabular-nums">{item.percentage}%</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
