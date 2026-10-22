import React, { useState } from "react";
import {
  TopFrequentItem,
  TopExpensiveItem,
  TopUnitPriceItem,
  TopPriceSpikeItem,
  TopSupplierItem,
  SummaryMetrics,
} from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Trophy,
  ShoppingBag,
  TrendingUp,
  Flame,
  Store,
  AlertTriangle,
  ArrowUpRight,
  Sparkles,
  Receipt,
  Calendar,
  Layers,
  CheckCircle2,
  DollarSign,
} from "lucide-react";

interface LeaderboardCardsProps {
  topFrequentItems?: TopFrequentItem[];
  topExpensiveItems?: TopExpensiveItem[];
  topUnitPriceItems?: TopUnitPriceItem[];
  topPriceSpikes?: TopPriceSpikeItem[];
  topSuppliers?: TopSupplierItem[];
  summaryMetrics?: SummaryMetrics;
  monthName: string;
  year: number;
}

export const LeaderboardCards: React.FC<LeaderboardCardsProps> = ({
  topFrequentItems = [],
  topExpensiveItems = [],
  topUnitPriceItems = [],
  topPriceSpikes = [],
  topSuppliers = [],
  summaryMetrics,
  monthName,
  year,
}) => {
  // Tab switcher for Card 2: "total" (Total Pengeluaran) vs "unit" (Harga Satuan Termahal)
  const [expensiveMode, setExpensiveMode] = useState<"total" | "unit">("total");

  // Rank badge styling helper
  const getRankBadge = (rank: number) => {
    switch (rank) {
      case 1:
        return (
          <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[11px] bg-amber-400 text-amber-950 shadow-xs ring-2 ring-amber-200">
            1
          </span>
        );
      case 2:
        return (
          <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[11px] bg-slate-300 text-slate-800 shadow-xs ring-2 ring-slate-200">
            2
          </span>
        );
      case 3:
        return (
          <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[11px] bg-amber-700/80 text-amber-100 shadow-xs ring-2 ring-amber-600/30">
            3
          </span>
        );
      default:
        return (
          <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-semibold text-[11px] bg-slate-100 text-slate-600">
            {rank}
          </span>
        );
    }
  };

  // Find max values for visual proportion progress bars
  const maxFreqCount = topFrequentItems[0]?.count || 1;
  const maxExpenseTotal = topExpensiveItems[0]?.total_spent || 1;
  const maxSupplierTotal = topSuppliers[0]?.total_spent || 1;

  return (
    <div className="space-y-4">
      {/* ── Executive KPI Summary Strip ── */}
      {summaryMetrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-200/80 rounded-2xl p-3.5 flex items-center justify-between">
            <div className="space-y-0.5 min-w-0">
              <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider block">
                Rata-rata / Hari
              </span>
              <p className="text-base md:text-lg font-bold text-slate-900 tabular-nums truncate">
                {formatRupiah(summaryMetrics.daily_average)}
              </p>
              <p className="text-[10px] text-slate-400">
                {summaryMetrics.active_days_count} hari belanja aktif
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-100/70 text-blue-600 shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-200/80 rounded-2xl p-3.5 flex items-center justify-between">
            <div className="space-y-0.5 min-w-0">
              <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
                Rata-rata / Transaksi
              </span>
              <p className="text-base md:text-lg font-bold text-slate-900 tabular-nums truncate">
                {formatRupiah(summaryMetrics.average_per_transaction)}
              </p>
              <p className="text-[10px] text-slate-400">Rerata nota belanja</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-100/70 text-emerald-600 shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-200/80 rounded-2xl p-3.5 flex items-center justify-between">
            <div className="space-y-0.5 min-w-0">
              <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">
                Ragam Item Unik
              </span>
              <p className="text-base md:text-lg font-bold text-slate-900 tabular-nums truncate">
                {summaryMetrics.unique_items_count}{" "}
                <span className="text-xs font-medium text-slate-500">macam</span>
              </p>
              <p className="text-[10px] text-slate-400">
                Dari {summaryMetrics.unique_suppliers_count} supplier
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-100/70 text-amber-600 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border border-purple-200/80 rounded-2xl p-3.5 flex items-center justify-between">
            <div className="space-y-0.5 min-w-0">
              <span className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider block">
                Transaksi Terbesar
              </span>
              <p className="text-base md:text-lg font-bold text-slate-900 tabular-nums truncate">
                {summaryMetrics.max_single_transaction
                  ? formatRupiah(summaryMetrics.max_single_transaction.amount)
                  : "-"}
              </p>
              <p className="text-[10px] text-slate-400 truncate" title={summaryMetrics.max_single_transaction?.item_name}>
                {summaryMetrics.max_single_transaction
                  ? summaryMetrics.max_single_transaction.item_name
                  : "Belum ada transaksi"}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-100/70 text-purple-600 shrink-0">
              <Trophy className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* ── Main Leaderboard Cards Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ── Card 1: Top 5 Sering Dibeli ── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700">
                      <ShoppingBag className="w-4 h-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight">
                        Top Sering Dibeli
                      </CardTitle>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Frekuensi belanja terbanyak
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-semibold text-blue-600 border-blue-200 bg-blue-50/50 px-1.5 py-0">
                    Frekuensi
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                {topFrequentItems.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <ShoppingBag className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    <p className="text-xs">Belum ada data barang di periode ini</p>
                  </div>
                ) : (
                  topFrequentItems.map((item, idx) => {
                    const ratio = Math.max(10, Math.round((item.count / maxFreqCount) * 100));
                    return (
                      <div key={`${item.item_name}-${idx}`} className="group space-y-1">
                        <div className="flex items-start justify-between gap-2 text-xs">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            {getRankBadge(idx + 1)}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-800 truncate leading-tight group-hover:text-blue-600 transition-colors" title={item.item_name}>
                                {item.item_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                                <span className="bg-slate-100 text-slate-600 px-1.5 py-0 rounded font-medium truncate max-w-[90px]">
                                  {item.category}
                                </span>
                                <span>•</span>
                                <span>{item.total_qty} unit</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-blue-600 block tabular-nums">
                              {item.count}x
                            </span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {formatRupiah(item.total_spent)}
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                          <div
                            className="bg-blue-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>

        {/* ── Card 2: Top 5 Belanja Terbesar / Paling Mahal ── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50/50 to-transparent">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight">
                        Top Item Termahal
                      </CardTitle>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Pengeluaran paling menguras kas
                      </p>
                    </div>
                  </div>

                  {/* Mode switcher toggle */}
                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[10px] font-semibold shrink-0">
                    <button
                      onClick={() => setExpensiveMode("total")}
                      className={`px-1.5 py-0.5 rounded-md transition-all ${
                        expensiveMode === "total"
                          ? "bg-white text-emerald-700 shadow-xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                      title="Urutkan berdasarkan total belanja kumulatif"
                    >
                      Total
                    </button>
                    <button
                      onClick={() => setExpensiveMode("unit")}
                      className={`px-1.5 py-0.5 rounded-md transition-all ${
                        expensiveMode === "unit"
                          ? "bg-white text-emerald-700 shadow-xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                      title="Urutkan berdasarkan harga satuan termahal"
                    >
                      Satuan
                    </button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                {expensiveMode === "total" ? (
                  topExpensiveItems.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      <TrendingUp className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                      <p className="text-xs">Belum ada pengeluaran</p>
                    </div>
                  ) : (
                    topExpensiveItems.map((item, idx) => {
                      const ratio = Math.max(10, Math.round((item.total_spent / maxExpenseTotal) * 100));
                      return (
                        <div key={`${item.item_name}-${idx}`} className="group space-y-1">
                          <div className="flex items-start justify-between gap-2 text-xs">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              {getRankBadge(idx + 1)}
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-slate-800 truncate leading-tight group-hover:text-emerald-700 transition-colors" title={item.item_name}>
                                  {item.item_name}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                                  <span className="text-emerald-600 font-semibold">
                                    {item.percentage}% budget
                                  </span>
                                  <span>•</span>
                                  <span>{item.count}x beli</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-bold text-emerald-700 block tabular-nums">
                                {formatRupiah(item.total_spent)}
                              </span>
                              <span className="text-[10px] text-slate-400 tabular-nums">
                                @{formatRupiah(item.max_unit_price)}
                              </span>
                            </div>
                          </div>

                          {/* Progress Bar */}
                          <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )
                ) : (
                  topUnitPriceItems.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      <DollarSign className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                      <p className="text-xs">Belum ada data harga satuan</p>
                    </div>
                  ) : (
                    topUnitPriceItems.map((item, idx) => (
                      <div key={`${item.item_name}-${idx}`} className="group space-y-1">
                        <div className="flex items-start justify-between gap-2 text-xs">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            {getRankBadge(idx + 1)}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-800 truncate leading-tight group-hover:text-emerald-700 transition-colors" title={item.item_name}>
                                {item.item_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                                <span className="bg-slate-100 text-slate-600 px-1.5 py-0 rounded font-medium truncate max-w-[90px]">
                                  {item.supplier}
                                </span>
                                <span>•</span>
                                <span>{item.category}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-emerald-700 block tabular-nums">
                              {formatRupiah(item.unit_price)}
                            </span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              / unit
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>

        {/* ── Card 3: Top 5 Lonjakan Kenaikan Harga (Price Spikes) ── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-rose-50/50 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-rose-100 text-rose-700">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight">
                        Top Naik Drastis
                      </CardTitle>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Lonjakan harga beli bahan
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-semibold text-rose-600 border-rose-200 bg-rose-50/50 px-1.5 py-0">
                    Spike Alert
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                {topPriceSpikes.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 space-y-1.5">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-semibold text-emerald-700">Harga Bahan Stabil</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-[190px] mx-auto">
                      Tidak terdeteksi kenaikan harga satuan bahan di periode {monthName} {year}.
                    </p>
                  </div>
                ) : (
                  topPriceSpikes.map((item, idx) => (
                    <div key={`${item.item_name}-${idx}`} className="group p-2 rounded-xl bg-rose-50/40 border border-rose-100/70 hover:border-rose-200 transition-all space-y-1">
                      <div className="flex items-start justify-between gap-1.5 text-xs">
                        <div className="flex items-start gap-1.5 min-w-0 flex-1">
                          <span className="w-4 h-4 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-rose-200 text-rose-800">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-800 truncate leading-tight group-hover:text-rose-700 transition-colors" title={item.item_name}>
                              {item.item_name}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {item.supplier}
                            </p>
                          </div>
                        </div>
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-bold shrink-0 bg-rose-600 flex items-center gap-0.5">
                          <ArrowUpRight className="w-3 h-3" />
                          +{item.percent_change}%
                        </Badge>
                      </div>

                      {/* Before vs After Price */}
                      <div className="flex items-center justify-between text-[11px] pt-0.5 border-t border-rose-100/60 font-mono">
                        <span className="text-slate-400 line-through">
                          {formatRupiah(item.previous_price)}
                        </span>
                        <span className="font-bold text-rose-700">
                          {formatRupiah(item.current_price)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>

        {/* ── Card 4: Top 5 Toko / Supplier ── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-purple-50/50 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-100 text-purple-700">
                      <Store className="w-4 h-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight">
                        Top Toko & Supplier
                      </CardTitle>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Alokasi belanja per mitra
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-semibold text-purple-600 border-purple-200 bg-purple-50/50 px-1.5 py-0">
                    Vendor
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                {topSuppliers.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Store className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    <p className="text-xs">Belum ada data supplier</p>
                  </div>
                ) : (
                  topSuppliers.map((supplier, idx) => {
                    const ratio = Math.max(10, Math.round((supplier.total_spent / maxSupplierTotal) * 100));
                    return (
                      <div key={`${supplier.supplier}-${idx}`} className="group space-y-1">
                        <div className="flex items-start justify-between gap-2 text-xs">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            {getRankBadge(idx + 1)}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-800 truncate leading-tight group-hover:text-purple-700 transition-colors" title={supplier.supplier}>
                                {supplier.supplier}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                                <span className="text-purple-600 font-semibold">
                                  {supplier.percentage}% budget
                                </span>
                                <span>•</span>
                                <span>{supplier.count} nota</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-purple-700 block tabular-nums">
                              {formatRupiah(supplier.total_spent)}
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                          <div
                            className="bg-purple-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};
