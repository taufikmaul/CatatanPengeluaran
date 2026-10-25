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
  Calendar,
  Receipt,
  Layers,
  CheckCircle2,
} from "lucide-react";

type ThemeColor = "blue" | "emerald" | "rose" | "purple";

const THEME_STYLES: Record<
  ThemeColor,
  {
    headerBg: string;
    iconBg: string;
    badge: string;
    hoverText: string;
    valueText: string;
    barColor: string;
    pillBg: string;
  }
> = {
  blue: {
    headerBg: "from-blue-50/70 to-transparent",
    iconBg: "bg-blue-100 text-blue-700",
    badge: "text-blue-700 border-blue-200 bg-blue-50/70",
    hoverText: "group-hover:text-blue-600",
    valueText: "text-blue-600",
    barColor: "bg-blue-500",
    pillBg: "bg-blue-50 text-blue-700",
  },
  emerald: {
    headerBg: "from-emerald-50/70 to-transparent",
    iconBg: "bg-emerald-100 text-emerald-700",
    badge: "text-emerald-700 border-emerald-200 bg-emerald-50/70",
    hoverText: "group-hover:text-emerald-700",
    valueText: "text-emerald-700",
    barColor: "bg-emerald-500",
    pillBg: "bg-emerald-50 text-emerald-700",
  },
  rose: {
    headerBg: "from-rose-50/70 to-transparent",
    iconBg: "bg-rose-100 text-rose-700",
    badge: "text-rose-700 border-rose-200 bg-rose-50/70",
    hoverText: "group-hover:text-rose-600",
    valueText: "text-rose-600",
    barColor: "bg-rose-500",
    pillBg: "bg-rose-50 text-rose-700",
  },
  purple: {
    headerBg: "from-purple-50/70 to-transparent",
    iconBg: "bg-purple-100 text-purple-700",
    badge: "text-purple-700 border-purple-200 bg-purple-50/70",
    hoverText: "group-hover:text-purple-700",
    valueText: "text-purple-700",
    barColor: "bg-purple-500",
    pillBg: "bg-purple-50 text-purple-700",
  },
};

// ── 1. Reusable Rank Badge (Consistent across all cards) ──
const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-amber-400 text-amber-950 shadow-xs ring-1 ring-amber-200">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-slate-300 text-slate-800 shadow-xs ring-1 ring-slate-200">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-amber-700/80 text-amber-100 shadow-xs ring-1 ring-amber-600/30">
        3
      </span>
    );
  }
  return (
    <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-semibold text-[10px] bg-slate-100 text-slate-600">
      {rank}
    </span>
  );
};

// ── 2. Unified Single Reusable Row Component ──
interface LeaderboardRowProps {
  rank: number;
  title: string;
  badgeText?: string;
  subText?: string;
  primaryValue: string;
  secondaryValue?: string;
  progressPercent: number;
  color: ThemeColor;
}

const LeaderboardRow: React.FC<LeaderboardRowProps> = ({
  rank,
  title,
  badgeText,
  subText,
  primaryValue,
  secondaryValue,
  progressPercent,
  color,
}) => {
  const theme = THEME_STYLES[color];
  const safePercent = Math.min(100, Math.max(8, Math.round(progressPercent)));

  return (
    <div className="group space-y-1.5">
      <div className="flex items-start justify-between gap-2 text-xs">
        {/* Left: Rank + Title + (Category/Entity Badge & Meta) */}
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <RankBadge rank={rank} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p
              className={`font-semibold text-slate-800 truncate leading-tight ${theme.hoverText} transition-colors`}
              title={title}
            >
              {title}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              {badgeText && (
                <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium truncate max-w-[110px]">
                  {badgeText}
                </span>
              )}
              {badgeText && subText && <span>•</span>}
              {subText && <span className="truncate">{subText}</span>}
            </div>
          </div>
        </div>

        {/* Right: Primary Metric + Secondary Sub-metric */}
        <div className="text-right shrink-0">
          <span className={`font-bold block tabular-nums leading-tight ${theme.valueText}`}>
            {primaryValue}
          </span>
          {secondaryValue && (
            <span className="text-[10px] text-slate-500 tabular-nums block mt-0.5">
              {secondaryValue}
            </span>
          )}
        </div>
      </div>

      {/* Unified Progress Bar */}
      <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
        <div
          className={`${theme.barColor} h-full rounded-full transition-all duration-500`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
    </div>
  );
};

// ── 3. Main Leaderboard Grid Container ──
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
  // Mode switcher for Card 2: "total" (Total Belanja) vs "unit" (Harga Satuan)
  const [expensiveMode, setExpensiveMode] = useState<"total" | "unit">("total");

  // Denominators for progress bars
  const maxFreqCount = topFrequentItems[0]?.count || 1;
  const maxExpenseTotal = topExpensiveItems[0]?.total_spent || 1;
  const maxUnitPrice = topUnitPriceItems[0]?.unit_price || 1;
  const maxSpikePercent = topPriceSpikes[0]?.percent_change || 100;
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
              <p className="text-[10px] text-slate-500">
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
              <p className="text-[10px] text-slate-500">Rerata nota belanja</p>
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
              <p className="text-[10px] text-slate-500">
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
              <p
                className="text-[10px] text-slate-500 truncate"
                title={summaryMetrics.max_single_transaction?.item_name}
              >
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

      {/* Leaderboard Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Top Sering Dibeli */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-blue-50/70 to-transparent min-h-[68px] flex justify-center">
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl shrink-0 bg-blue-100 text-blue-700">
                      <ShoppingBag className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight truncate">
                        Top Sering Dibeli
                      </CardTitle>
                      <p className="text-[10px] text-slate-500 font-medium truncate">
                        Frekuensi belanja terbanyak
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold px-2 py-0.5 shrink-0 text-blue-700 border-blue-200 bg-blue-50/70"
                  >
                    Frekuensi
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3.5">
                {topFrequentItems.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 space-y-1">
                    <ShoppingBag className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    <p className="text-xs font-medium">Belum ada data barang</p>
                    <p className="text-[10px]">Transaksi akan muncul di sini</p>
                  </div>
                ) : (
                  topFrequentItems.map((item, idx) => (
                    <LeaderboardRow
                      key={`freq-${item.item_name}-${idx}`}
                      rank={idx + 1}
                      title={item.item_name}
                      badgeText={item.category}
                      subText={`${item.total_qty} unit`}
                      primaryValue={`${item.count}x`}
                      secondaryValue={formatRupiah(item.total_spent)}
                      progressPercent={(item.count / maxFreqCount) * 100}
                      color="blue"
                    />
                  ))
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>

        {/* Card 2: Top Item Termahal */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50/70 to-transparent min-h-[68px] flex justify-center">
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl shrink-0 bg-emerald-100 text-emerald-700">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight truncate">
                        Top Item Termahal
                      </CardTitle>
                      <p className="text-[10px] text-slate-500 font-medium truncate">
                        Pengeluaran paling besar
                      </p>
                    </div>
                  </div>

                  {/* Mode switcher toggle with same 24px height as Badge */}
                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[10px] font-semibold shrink-0 h-6">
                    <button
                      onClick={() => setExpensiveMode("total")}
                      className={`px-2 py-0.5 rounded-md transition-all h-5 flex items-center ${
                        expensiveMode === "total"
                          ? "bg-white text-emerald-700 shadow-xs font-bold"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                      title="Urut berdasarkan total pengeluaran"
                    >
                      Total
                    </button>
                    <button
                      onClick={() => setExpensiveMode("unit")}
                      className={`px-2 py-0.5 rounded-md transition-all h-5 flex items-center ${
                        expensiveMode === "unit"
                          ? "bg-white text-emerald-700 shadow-xs font-bold"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                      title="Urut berdasarkan harga satuan"
                    >
                      Satuan
                    </button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3.5">
                {expensiveMode === "total" ? (
                  topExpensiveItems.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 space-y-1">
                      <TrendingUp className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                      <p className="text-xs font-medium">Belum ada pengeluaran</p>
                      <p className="text-[10px]">Data belanja akan muncul di sini</p>
                    </div>
                  ) : (
                    topExpensiveItems.map((item, idx) => (
                      <LeaderboardRow
                        key={`exp-total-${item.item_name}-${idx}`}
                        rank={idx + 1}
                        title={item.item_name}
                        badgeText={item.category}
                        subText={`${item.percentage}% budget • ${item.count}x beli`}
                        primaryValue={formatRupiah(item.total_spent)}
                        secondaryValue={`@${formatRupiah(item.max_unit_price)}`}
                        progressPercent={(item.total_spent / maxExpenseTotal) * 100}
                        color="emerald"
                      />
                    ))
                  )
                ) : topUnitPriceItems.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 space-y-1">
                    <TrendingUp className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    <p className="text-xs font-medium">Belum ada data harga satuan</p>
                    <p className="text-[10px]">Data harga satuan akan muncul di sini</p>
                  </div>
                ) : (
                  topUnitPriceItems.map((item, idx) => (
                    <LeaderboardRow
                      key={`exp-unit-${item.item_name}-${idx}`}
                      rank={idx + 1}
                      title={item.item_name}
                      badgeText={item.supplier}
                      subText={item.category}
                      primaryValue={formatRupiah(item.unit_price)}
                      secondaryValue="/ unit"
                      progressPercent={(item.unit_price / maxUnitPrice) * 100}
                      color="emerald"
                    />
                  ))
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>

        {/* Card 3: Top Kenaikan Harga */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-rose-50/70 to-transparent min-h-[68px] flex justify-center">
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl shrink-0 bg-rose-100 text-rose-700">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight truncate">
                        Top Naik Drastis
                      </CardTitle>
                      <p className="text-[10px] text-slate-500 font-medium truncate">
                        Lonjakan harga beli bahan
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold px-2 py-0.5 shrink-0 text-rose-700 border-rose-200 bg-rose-50/70"
                  >
                    Spike Alert
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3.5">
                {topPriceSpikes.length === 0 ? (
                  <div className="text-center py-7 text-slate-500 space-y-1.5">
                    <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-1">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-semibold text-emerald-700">Harga Bahan Stabil</p>
                    <p className="text-[10px] text-slate-500 max-w-[190px] mx-auto leading-relaxed">
                      Tidak terdeteksi lonjakan harga bahan di periode {monthName} {year}
                    </p>
                  </div>
                ) : (
                  topPriceSpikes.map((item, idx) => (
                    <LeaderboardRow
                      key={`spike-${item.item_name}-${idx}`}
                      rank={idx + 1}
                      title={item.item_name}
                      badgeText={item.supplier !== "-" ? item.supplier : item.category}
                      subText={`${formatRupiah(item.previous_price)} ➔ ${formatRupiah(item.current_price)}`}
                      primaryValue={`+${item.percent_change}%`}
                      secondaryValue={`+${formatRupiah(item.diff_price)}`}
                      progressPercent={(item.percent_change / maxSpikePercent) * 100}
                      color="rose"
                    />
                  ))
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>

        {/* Card 4: Top Toko & Supplier */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <Card className="h-full flex flex-col justify-between border-slate-200/80 shadow-xs hover:border-slate-300 transition-all bg-white overflow-hidden">
            <div>
              <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-gradient-to-r from-purple-50/70 to-transparent min-h-[68px] flex justify-center">
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-xl shrink-0 bg-purple-100 text-purple-700">
                      <Store className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold text-slate-800 leading-tight truncate">
                        Top Toko & Mitra
                      </CardTitle>
                      <p className="text-[10px] text-slate-500 font-medium truncate">
                        Alokasi belanja per mitra
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold px-2 py-0.5 shrink-0 text-purple-700 border-purple-200 bg-purple-50/70"
                  >
                    Mitra Toko
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3.5">
                {topSuppliers.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 space-y-1">
                    <Store className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    <p className="text-xs font-medium">Belum ada data supplier</p>
                    <p className="text-[10px]">Data mitra belanja akan muncul di sini</p>
                  </div>
                ) : (
                  topSuppliers.map((supplier, idx) => (
                    <LeaderboardRow
                      key={`sup-${supplier.supplier}-${idx}`}
                      rank={idx + 1}
                      title={supplier.supplier}
                      badgeText={`${supplier.percentage}% budget`}
                      subText={`${supplier.count} nota transaksi`}
                      primaryValue={formatRupiah(supplier.total_spent)}
                      secondaryValue={`${supplier.count} nota`}
                      progressPercent={(supplier.total_spent / maxSupplierTotal) * 100}
                      color="purple"
                    />
                  ))
                )}
              </CardContent>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};
