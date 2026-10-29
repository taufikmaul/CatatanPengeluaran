import React, { useState, useMemo } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PieChart as PieIcon, BookOpen, Layers } from "lucide-react";

interface CategoryDonutChartProps {
  categoryData: Record<string, number>;
  totalAmount: number;
  perAccountGroup?: Record<string, number>;
  accountingBreakdown?: Array<{
    account_code: string;
    account_name: string;
    account_group: string;
    report_type: string;
    category: string;
    total: number;
    percentage: number;
  }>;
}

interface ChartCategoryItem {
  name: string;
  value: number;
  percentage: string;
  group?: string;
  code?: string;
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

const GROUP_COLORS: Record<string, string> = {
  HPP: "#f59e0b",
  OPEX: "#2563eb",
  ASSET: "#8b5cf6",
  CASH_TRANSFER: "#10b981",
};

export const CategoryDonutChart: React.FC<CategoryDonutChartProps> = ({
  categoryData,
  totalAmount,
  perAccountGroup = {},
  accountingBreakdown = [],
}) => {
  const [viewMode, setViewMode] = useState<"category" | "coa">("category");
  const [hoveredItem, setHoveredItem] = useState<ChartCategoryItem | null>(null);

  const rawCategoryData: ChartCategoryItem[] = useMemo(() => {
    return Object.entries(categoryData)
      .map(([name, value]) => ({
        name,
        value: Math.round(value),
        percentage: totalAmount > 0 ? ((value / totalAmount) * 100).toFixed(1) : "0",
      }))
      .sort((a, b) => b.value - a.value);
  }, [categoryData, totalAmount]);

  const coaChartData: ChartCategoryItem[] = useMemo(() => {
    const total = Object.values(perAccountGroup).reduce((acc, v) => acc + v, 0);
    return Object.entries(perAccountGroup)
      .filter(([, v]) => v > 0)
      .map(([grp, val]) => {
        const label =
          grp === "HPP"
            ? "HPP (Pokok)"
            : grp === "OPEX"
            ? "OPEX (Operasional)"
            : grp === "ASSET"
            ? "Aset Tetap (Capex)"
            : grp === "CASH_TRANSFER"
            ? "Kliring Kasir"
            : grp;
        return {
          name: label,
          group: grp,
          value: Math.round(val),
          percentage: total > 0 ? ((val / total) * 100).toFixed(1) : "0",
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [perAccountGroup]);

  const activeChartData = viewMode === "coa" && coaChartData.length > 0 ? coaChartData : rawCategoryData;
  const activeTotal =
    viewMode === "coa" && coaChartData.length > 0
      ? Object.values(perAccountGroup).reduce((acc, v) => acc + v, 0)
      : totalAmount;

  if (activeChartData.length === 0) {
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm md:text-base font-semibold text-slate-800 flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-blue-600" />
              <span>{viewMode === "coa" ? "Distribusi Akun (COA)" : "Distribusi Kategori"}</span>
            </CardTitle>
            <span className="text-xs font-semibold text-slate-500 tabular-nums">
              {formatRupiah(activeTotal)}
            </span>
          </div>

          {/* Toggle View Mode */}
          {coaChartData.length > 0 && (
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl text-[11px] font-medium self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setViewMode("category");
                  setHoveredItem(null);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
                  viewMode === "category"
                    ? "bg-white text-slate-900 shadow-2xs font-semibold"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Kategori</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("coa");
                  setHoveredItem(null);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
                  viewMode === "coa"
                    ? "bg-white text-blue-700 shadow-2xs font-semibold"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <BookOpen className="w-3 h-3" />
                <span>Akun (COA)</span>
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-5 pt-0 flex-1 flex flex-col justify-between">
        <div className="h-52 w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={activeChartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
                onMouseEnter={(_, index) => setHoveredItem(activeChartData[index])}
                onMouseLeave={() => setHoveredItem(null)}
              >
                {activeChartData.map((entry, index) => {
                  const isHovered = hoveredItem?.name === entry.name;
                  const fillColor =
                    viewMode === "coa" && entry.group && GROUP_COLORS[entry.group]
                      ? GROUP_COLORS[entry.group]
                      : COLORS[index % COLORS.length];

                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={fillColor}
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
                <span className="text-xs font-bold text-slate-700">
                  {viewMode === "coa" ? `${activeChartData.length} Kelompok` : `${activeChartData.length} Kat`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Legend List with on-hover Rupiah value */}
        {viewMode === "coa" && accountingBreakdown.length > 0 ? (
          <div className="space-y-1.5 mt-2 pt-2 border-t border-slate-100 max-h-44 overflow-y-auto">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
              Rincian Akun Buku Besar (COA):
            </div>
            {accountingBreakdown.map((item) => (
              <div
                key={item.category}
                className="flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                title={`${item.account_code} - ${item.account_name}: ${formatRupiah(item.total)}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 h-4 border-slate-200 bg-slate-50 text-slate-700">
                    {item.account_code}
                  </Badge>
                  <span className="truncate font-medium text-slate-700 text-[11px]">
                    {item.category}
                  </span>
                </div>
                <div className="text-right shrink-0 flex items-center gap-1.5">
                  <span className="font-semibold text-slate-800 tabular-nums text-[11px]">
                    {formatRupiah(item.total)}
                  </span>
                  <Badge
                    className={`text-[8px] py-0 px-1 h-3.5 ${
                      item.account_group === "HPP"
                        ? "bg-amber-100 text-amber-900 border-amber-200"
                        : item.account_group === "OPEX"
                        ? "bg-blue-100 text-blue-900 border-blue-200"
                        : item.account_group === "ASSET"
                        ? "bg-purple-100 text-purple-900 border-purple-200"
                        : "bg-emerald-100 text-emerald-900 border-emerald-200"
                    }`}
                  >
                    {item.account_group}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 pt-2 border-t border-slate-100 max-h-40 overflow-y-auto">
            {activeChartData.map((item, index) => {
              const isHovered = hoveredItem?.name === item.name;
              const color =
                viewMode === "coa" && item.group && GROUP_COLORS[item.group]
                  ? GROUP_COLORS[item.group]
                  : COLORS[index % COLORS.length];

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
                      style={{ backgroundColor: color }}
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
                    <span className="group-hover:hidden text-slate-500 font-medium tabular-nums text-xs">
                      {item.percentage}%
                    </span>
                    <span className="hidden group-hover:inline-flex items-center gap-1 font-bold text-blue-600 tabular-nums text-[11px] animate-in fade-in duration-150">
                      <span>{formatRupiah(item.value)}</span>
                      <span className="text-[10px] text-slate-500 font-normal">({item.percentage}%)</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
