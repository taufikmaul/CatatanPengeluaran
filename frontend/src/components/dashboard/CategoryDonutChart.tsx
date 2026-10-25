import React, { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PieChart as PieIcon } from "lucide-react";

interface CategoryDonutChartProps {
  categoryData: Record<string, number>;
  totalAmount: number;
}

interface ChartCategoryItem {
  name: string;
  value: number;
  percentage: string;
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
  "#14b8a6", // teal-500
  "#6366f1", // indigo-500
  "#d946ef", // fuchsia-500
];

export const CategoryDonutChart: React.FC<CategoryDonutChartProps> = ({
  categoryData,
  totalAmount,
}) => {
  const [hoveredItem, setHoveredItem] = useState<ChartCategoryItem | null>(null);

  const chartData: ChartCategoryItem[] = Object.entries(categoryData)
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
    <Card className="h-full flex flex-col border-slate-200 shadow-xs">
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
                onMouseEnter={(_, index) => setHoveredItem(chartData[index])}
                onMouseLeave={() => setHoveredItem(null)}
              >
                {chartData.map((entry, index) => {
                  const isHovered = hoveredItem?.name === entry.name;
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                      opacity={hoveredItem === null || isHovered ? 1 : 0.45}
                      className="transition-opacity duration-200 cursor-pointer"
                    />
                  );
                })}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as ChartCategoryItem;
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

          {/* Dynamic Interactive Center Badge */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-all">
            {hoveredItem ? (
              <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-150 px-2 text-center">
                <span className="text-[10px] text-slate-500 font-medium truncate max-w-[85px]">
                  {hoveredItem.name}
                </span>
                <span className="text-xs font-bold text-slate-800 tabular-nums leading-tight">
                  {formatRupiah(hoveredItem.value)}
                </span>
                <span className="text-[10px] font-semibold text-blue-600 tabular-nums">
                  {hoveredItem.percentage}%
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center">
                <span className="text-[11px] text-slate-500 font-medium">Total</span>
                <span className="text-xs font-bold text-slate-700">{chartData.length} Kat</span>
              </div>
            )}
          </div>
        </div>

        {/* Legend List with on-hover Rupiah value */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 pt-2 border-t border-slate-100 max-h-40 overflow-y-auto">
          {chartData.map((item, index) => {
            const isHovered = hoveredItem?.name === item.name;
            return (
              <div
                key={item.name}
                onMouseEnter={() => setHoveredItem(item)}
                onMouseLeave={() => setHoveredItem(null)}
                className={`group flex items-center justify-between gap-1.5 text-xs py-1 px-1.5 -mx-1.5 rounded-lg transition-all cursor-pointer ${
                  isHovered ? "bg-slate-100/80 shadow-xs" : "hover:bg-slate-50"
                }`}
                title={`${item.name}: ${formatRupiah(item.value)} (${item.percentage}%)`}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover:scale-125"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span
                    className={`truncate font-medium transition-colors ${
                      isHovered ? "text-slate-900 font-semibold" : "text-slate-600"
                    }`}
                  >
                    {item.name}
                  </span>
                </div>

                <div className="text-right shrink-0">
                  {/* Default State: Percentage */}
                  <span className="group-hover:hidden text-slate-500 font-medium tabular-nums text-xs">
                    {item.percentage}%
                  </span>
                  {/* Hover State: Rupiah Value + Percentage */}
                  <span className="hidden group-hover:inline-flex items-center gap-1 font-bold text-blue-600 tabular-nums text-[11px] animate-in fade-in duration-150">
                    <span>{formatRupiah(item.value)}</span>
                    <span className="text-[10px] text-slate-500 font-normal">({item.percentage}%)</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
