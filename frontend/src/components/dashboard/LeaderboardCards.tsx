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
import { motion } from "framer-motion";
import {
  ShoppingBag,
  TrendingUp,
  Flame,
  Store,
  CheckCircle2,
} from "lucide-react";

type ThemeColor = "blue" | "emerald" | "rose" | "purple";

const THEME_STYLES: Record<
  ThemeColor,
  {
    badge: string;
    hoverText: string;
    valueText: string;
    barColor: string;
  }
> = {
  blue: {
    badge: "text-blue-700 border-blue-200 bg-blue-50/70 dark:text-blue-300 dark:border-blue-800 dark:bg-blue-950/40",
    hoverText: "group-hover:text-blue-600 dark:group-hover:text-blue-400",
    valueText: "text-blue-700 dark:text-blue-400",
    barColor: "bg-blue-600 dark:bg-blue-400",
  },
  emerald: {
    badge: "text-emerald-700 border-emerald-200 bg-emerald-50/70 dark:text-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/40",
    hoverText: "group-hover:text-emerald-700 dark:group-hover:text-emerald-400",
    valueText: "text-[var(--signal-cleared)]",
    barColor: "bg-emerald-600 dark:bg-emerald-400",
  },
  rose: {
    badge: "text-rose-700 border-rose-200 bg-rose-50/70 dark:text-rose-300 dark:border-rose-800 dark:bg-rose-950/40",
    hoverText: "group-hover:text-rose-600 dark:group-hover:text-rose-400",
    valueText: "text-[var(--signal-unpaid)]",
    barColor: "bg-rose-600 dark:bg-rose-400",
  },
  purple: {
    badge: "text-purple-700 border-purple-200 bg-purple-50/70 dark:text-purple-300 dark:border-purple-800 dark:bg-purple-950/40",
    hoverText: "group-hover:text-purple-700 dark:group-hover:text-purple-400",
    valueText: "text-[var(--signal-talangan)]",
    barColor: "bg-[#5B3EAE] dark:bg-[#AD9CFF]",
  },
};

// ── 1. Reusable Rank Badge (Consistent across all cards) ──
const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-amber-400 text-amber-950">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-bold text-[10px] bg-amber-700/85 text-amber-100">
        3
      </span>
    );
  }
  return (
    <span className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full font-semibold text-[10px] bg-[var(--ledger-recessed)] text-[var(--ledger-muted)]">
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
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <RankBadge rank={rank} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p
              className={`font-semibold text-[var(--ledger-ink)] truncate leading-tight ${theme.hoverText} transition-colors`}
              title={title}
            >
              {title}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--ledger-muted)]">
              {badgeText && (
                <span className="bg-[var(--ledger-recessed)] text-[var(--ledger-ink)] px-1.5 py-0.2 rounded font-medium truncate max-w-[110px]">
                  {badgeText}
                </span>
              )}
              {badgeText && subText && <span>•</span>}
              {subText && <span className="truncate">{subText}</span>}
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className={`font-bold block tabular-nums leading-tight ${theme.valueText}`}>
            {primaryValue}
          </span>
          {secondaryValue && (
            <span className="text-[10px] text-[var(--ledger-muted)] tabular-nums block mt-0.5">
              {secondaryValue}
            </span>
          )}
        </div>
      </div>

      <div className="w-full bg-[var(--ledger-recessed)] rounded-full h-1 overflow-hidden">
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
    <div className="space-y-3">
      {/* ── Executive KPI Summary Strip (Unified Single Hairline Strip) ── */}
      {summaryMetrics && (
        <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-[color:var(--ledger-hairline)]">
          <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 space-y-0.5 min-w-0">
            <span className="text-xs font-semibold text-[var(--ledger-muted)] block truncate">
              Rata-rata / Hari
            </span>
            <p className="text-base md:text-lg font-bold text-[var(--ledger-ink)] tabular-nums truncate">
              {formatRupiah(summaryMetrics.daily_average)}
            </p>
            <p className="text-[11px] text-[var(--ledger-muted)] truncate">
              {summaryMetrics.active_days_count} hari belanja aktif
            </p>
          </div>

          <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 space-y-0.5 min-w-0">
            <span className="text-xs font-semibold text-[var(--ledger-muted)] block truncate">
              Rata-rata / Transaksi
            </span>
            <p className="text-base md:text-lg font-bold text-[var(--signal-cleared)] tabular-nums truncate">
              {formatRupiah(summaryMetrics.average_per_transaction)}
            </p>
            <p className="text-[11px] text-[var(--ledger-muted)] truncate">
              Rerata nota belanja
            </p>
          </div>

          <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 space-y-0.5 min-w-0">
            <span className="text-xs font-semibold text-[var(--ledger-muted)] block truncate">
              Ragam Item Unik
            </span>
            <p className="text-base md:text-lg font-bold text-[var(--ledger-ink)] tabular-nums truncate">
              {summaryMetrics.unique_items_count}{" "}
              <span className="text-xs font-medium text-[var(--ledger-muted)]">macam</span>
            </p>
            <p className="text-[11px] text-[var(--ledger-muted)] truncate">
              Dari {summaryMetrics.unique_suppliers_count} supplier
            </p>
          </div>

          <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 space-y-0.5 min-w-0">
            <span className="text-xs font-semibold text-[var(--ledger-muted)] block truncate">
              Transaksi Terbesar
            </span>
            <p className="text-base md:text-lg font-bold text-[var(--signal-talangan)] tabular-nums truncate">
              {summaryMetrics.max_single_transaction
                ? formatRupiah(summaryMetrics.max_single_transaction.amount)
                : "-"}
            </p>
            <p
              className="text-[11px] text-[var(--ledger-muted)] truncate"
              title={summaryMetrics.max_single_transaction?.item_name}
            >
              {summaryMetrics.max_single_transaction
                ? summaryMetrics.max_single_transaction.item_name
                : "Belum ada transaksi"}
            </p>
          </div>
        </div>
      )}

      {/* Leaderboard Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Top Sering Dibeli */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Card className="h-full flex flex-col justify-between border-[color:var(--ledger-hairline)] shadow-none bg-[var(--ledger-surface)] overflow-hidden">
            <div>
              <CardHeader className="px-3.5 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col justify-center gap-1">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                    <ShoppingBag className="w-3 h-3 shrink-0" />
                    <span>Frekuensi</span>
                  </span>
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-xs font-bold text-[var(--ledger-ink)] leading-snug">
                    Top Sering Dibeli
                  </CardTitle>
                  <p className="text-[10px] text-[var(--ledger-muted)] font-medium truncate mt-0.5">
                    Frekuensi belanja terbanyak
                  </p>
                </div>
              </CardHeader>

              <CardContent className="p-3.5 space-y-3">
                {topFrequentItems.length === 0 ? (
                  <div className="text-center py-6 text-[var(--ledger-muted)] space-y-1">
                    <ShoppingBag className="w-6 h-6 mx-auto mb-1 opacity-50" />
                    <p className="text-xs font-medium text-[var(--ledger-ink)]">Belum ada data barang</p>
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.04 }}
        >
          <Card className="h-full flex flex-col justify-between border-[color:var(--ledger-hairline)] shadow-none bg-[var(--ledger-surface)] overflow-hidden">
            <div>
              <CardHeader className="px-3.5 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col justify-center gap-1">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--signal-cleared)]">
                    <TrendingUp className="w-3 h-3 shrink-0" />
                    <span>Belanja</span>
                  </span>
                  <div className="flex items-center bg-[var(--ledger-recessed)] border border-[color:var(--ledger-hairline)] p-0.5 rounded-md text-[10px] font-semibold shrink-0 h-5">
                    <button
                      type="button"
                      onClick={() => setExpensiveMode("total")}
                      className={`px-1.5 rounded-[4px] transition-all h-4 flex items-center ${
                        expensiveMode === "total"
                          ? "bg-[var(--ledger-surface)] text-[var(--signal-cleared)] shadow-2xs font-bold"
                          : "text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      }`}
                      title="Urut berdasarkan total pengeluaran"
                    >
                      Total
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpensiveMode("unit")}
                      className={`px-1.5 rounded-[4px] transition-all h-4 flex items-center ${
                        expensiveMode === "unit"
                          ? "bg-[var(--ledger-surface)] text-[var(--signal-cleared)] shadow-2xs font-bold"
                          : "text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                      }`}
                      title="Urut berdasarkan harga satuan"
                    >
                      Satuan
                    </button>
                  </div>
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-xs font-bold text-[var(--ledger-ink)] leading-snug">
                    Top Item Termahal
                  </CardTitle>
                  <p className="text-[10px] text-[var(--ledger-muted)] font-medium truncate mt-0.5">
                    Pengeluaran paling besar
                  </p>
                </div>
              </CardHeader>

              <CardContent className="p-3.5 space-y-3">
                {expensiveMode === "total" ? (
                  topExpensiveItems.length === 0 ? (
                    <div className="text-center py-6 text-[var(--ledger-muted)] space-y-1">
                      <TrendingUp className="w-6 h-6 mx-auto mb-1 opacity-50" />
                      <p className="text-xs font-medium text-[var(--ledger-ink)]">Belum ada pengeluaran</p>
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
                  <div className="text-center py-6 text-[var(--ledger-muted)] space-y-1">
                    <TrendingUp className="w-6 h-6 mx-auto mb-1 opacity-50" />
                    <p className="text-xs font-medium text-[var(--ledger-ink)]">Belum ada data harga satuan</p>
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.08 }}
        >
          <Card className="h-full flex flex-col justify-between border-[color:var(--ledger-hairline)] shadow-none bg-[var(--ledger-surface)] overflow-hidden">
            <div>
              <CardHeader className="px-3.5 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col justify-center gap-1">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--signal-unpaid)]">
                    <Flame className="w-3 h-3 shrink-0" />
                    <span>Spike Alert</span>
                  </span>
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-xs font-bold text-[var(--ledger-ink)] leading-snug">
                    Top Naik Drastis
                  </CardTitle>
                  <p className="text-[10px] text-[var(--ledger-muted)] font-medium truncate mt-0.5">
                    Lonjakan harga beli bahan
                  </p>
                </div>
              </CardHeader>

              <CardContent className="p-3.5 space-y-3">
                {topPriceSpikes.length === 0 ? (
                  <div className="text-center py-6 text-[var(--ledger-muted)] space-y-1">
                    <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-[var(--signal-cleared)]" />
                    <p className="text-xs font-semibold text-[var(--signal-cleared)]">Harga Bahan Stabil</p>
                    <p className="text-[10px] text-[var(--ledger-muted)] max-w-[190px] mx-auto leading-relaxed">
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.12 }}
        >
          <Card className="h-full flex flex-col justify-between border-[color:var(--ledger-hairline)] shadow-none bg-[var(--ledger-surface)] overflow-hidden">
            <div>
              <CardHeader className="px-3.5 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col justify-center gap-1">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--signal-talangan)]">
                    <Store className="w-3 h-3 shrink-0" />
                    <span>Mitra Toko</span>
                  </span>
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-xs font-bold text-[var(--ledger-ink)] leading-snug">
                    Top Toko &amp; Mitra
                  </CardTitle>
                  <p className="text-[10px] text-[var(--ledger-muted)] font-medium truncate mt-0.5">
                    Alokasi belanja per mitra
                  </p>
                </div>
              </CardHeader>

              <CardContent className="p-3.5 space-y-3">
                {topSuppliers.length === 0 ? (
                  <div className="text-center py-6 text-[var(--ledger-muted)] space-y-1">
                    <Store className="w-6 h-6 mx-auto mb-1 opacity-50" />
                    <p className="text-xs font-medium text-[var(--ledger-ink)]">Belum ada data supplier</p>
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
