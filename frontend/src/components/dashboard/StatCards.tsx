import React from "react";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Wallet, Receipt, AlertCircle, Layers, TrendingUp, TrendingDown, Target, Tag } from "lucide-react";

interface StatCardsProps {
  totalLunas: number;
  totalPengeluaran: number;
  expenseCount: number;
  unpaidCount: number;
  unpaidTotal: number;
  categoryCount: number;
  monthName: string;
  year: number;
  prevMonthName?: string | null;
  prevTotalLunas?: number;
  prevTotalPengeluaran?: number;
  momLunasChangePct?: number | null;
  momTotalChangePct?: number | null;
  monthlyBudgetLimit?: number;
  budgetUsedPct?: number | null;
  categoryBudgets?: Record<string, number>;
  categoryBudgetPercentages?: Record<string, number>;
  isCustomBudget?: boolean;
  perKategori?: Record<string, number>;
  reimbursePendingCount?: number;
  reimbursePendingTotal?: number;
  onFilterUnpaid?: () => void;
  onFilterReimburse?: () => void;
  onOpenBudgetSettings?: () => void;
}

export const StatCards: React.FC<StatCardsProps> = ({
  totalLunas,
  totalPengeluaran,
  expenseCount,
  unpaidCount,
  unpaidTotal,
  categoryCount,
  monthName,
  year,
  prevMonthName,
  prevTotalLunas = 0,
  prevTotalPengeluaran = 0,
  momLunasChangePct,
  momTotalChangePct,
  monthlyBudgetLimit = 0,
  budgetUsedPct,
  categoryBudgets = {},
  categoryBudgetPercentages = {},
  isCustomBudget = false,
  perKategori = {},
  reimbursePendingCount = 0,
  reimbursePendingTotal = 0,
  onFilterUnpaid,
  onFilterReimburse,
  onOpenBudgetSettings,
}) => {
  const renderMomBadge = (pct?: number | null, prevVal?: number) => {
    if (pct === undefined || pct === null) return null;
    const isUp = pct > 0;
    const isZero = pct === 0;
    const IconTrend = isUp ? TrendingUp : TrendingDown;
    const badgeColor = isZero
      ? "bg-slate-100 text-slate-600 border-slate-200"
      : isUp
      ? "bg-amber-50 text-amber-700 border-amber-200/80"
      : "bg-emerald-50 text-emerald-700 border-emerald-200/80";

    return (
      <span
        title={prevVal ? `Bulan ${prevMonthName || "lalu"}: ${formatRupiah(prevVal)}` : undefined}
        className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${badgeColor}`}
      >
        {!isZero && <IconTrend className="w-2.5 h-2.5" />}
        {isUp ? `+${pct}%` : `${pct}%`} vs {prevMonthName ? prevMonthName.slice(0, 3) : "bln lalu"}
      </span>
    );
  };

  const cards = [
    {
      title: "Total Lunas",
      value: formatRupiah(totalLunas),
      subtext: `${monthName} ${year}`,
      momBadge: renderMomBadge(momLunasChangePct, prevTotalLunas),
      icon: Wallet,
      color: "emerald",
      bgGradient: "from-emerald-500/10 via-emerald-500/5 to-transparent",
      iconBg: "bg-emerald-50 text-emerald-600",
      textColor: "text-emerald-700",
    },
    {
      title: "Total Transaksi",
      value: `${expenseCount} item`,
      subtext: `Total ${formatRupiah(totalPengeluaran)}`,
      momBadge: renderMomBadge(momTotalChangePct, prevTotalPengeluaran),
      icon: Receipt,
      color: "blue",
      bgGradient: "from-blue-500/10 via-blue-500/5 to-transparent",
      iconBg: "bg-blue-50 text-blue-600",
      textColor: "text-blue-700",
    },
    {
      title: "Belum Lunas",
      value: formatRupiah(unpaidTotal),
      subtext: `${unpaidCount} tagihan pending`,
      icon: AlertCircle,
      color: "rose",
      bgGradient: "from-rose-500/10 via-rose-500/5 to-transparent",
      iconBg: "bg-rose-50 text-rose-600",
      textColor: "text-rose-700",
      badge: unpaidCount > 0 ? "Perlu Dibayar" : undefined,
      onClick: onFilterUnpaid,
    },
    {
      title: "Kategori Aktif",
      value: `${categoryCount} kategori`,
      subtext: "Distribusi pengeluaran",
      icon: Layers,
      color: "amber",
      bgGradient: "from-amber-500/10 via-amber-500/5 to-transparent",
      iconBg: "bg-amber-50 text-amber-600",
      textColor: "text-amber-700",
    },
  ];

  const catBudgetEntries = Object.entries(categoryBudgets).filter(([, limit]) => limit > 0);
  const sumCatBudgets = catBudgetEntries.reduce((acc, [, limit]) => acc + limit, 0);
  const effectiveTotalBudget = monthlyBudgetLimit > 0 ? monthlyBudgetLimit : sumCatBudgets;

  const hasBudget = effectiveTotalBudget > 0 || catBudgetEntries.length > 0;
  const pct =
    budgetUsedPct ??
    (effectiveTotalBudget > 0
      ? Math.round((totalPengeluaran / effectiveTotalBudget) * 1000) / 10
      : 0);
  const clampedPct = Math.min(100, Math.max(0, pct));
  const isOverBudget = pct >= 95;
  const isWarningBudget = pct >= 75 && pct < 95;

  const barColor = isOverBudget
    ? "bg-rose-500"
    : isWarningBudget
    ? "bg-amber-500"
    : "bg-emerald-500";

  return (
    <div className="space-y-3">
      {/* Banner Notifikasi Reimbursement / Talangan Pending */}
      {reimbursePendingCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          onClick={onFilterReimburse}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-purple-50/90 border border-purple-200 rounded-2xl cursor-pointer hover:border-purple-300 transition-all shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white rounded-xl shadow-2xs text-purple-700">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-purple-900 flex items-center gap-2">
                <span>{reimbursePendingCount} Pengeluaran Talangan Belum Diganti</span>
                <span className="bg-purple-200/80 text-purple-800 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                  Perlu Reimburse
                </span>
              </p>
              <p className="text-[11px] text-purple-700 mt-0.5">
                Total talangan pending: <span className="font-semibold text-purple-950">{formatRupiah(reimbursePendingTotal)}</span>.
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-purple-700 bg-white px-3 py-1.5 rounded-xl border border-purple-200 self-start sm:self-auto hover:bg-purple-50">
            Lihat Data Talangan
          </span>
        </motion.div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
            >
              <Card
                onClick={card.onClick}
                className={`relative overflow-hidden border-slate-200/80 bg-white hover:border-slate-300 transition-all ${
                  card.onClick ? "cursor-pointer hover:shadow-md active:scale-[0.99]" : ""
                }`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${card.bgGradient} pointer-events-none`} />
                <CardContent className="p-4 md:p-5 relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-500">{card.title}</span>
                    <div className={`p-2 rounded-xl ${card.iconBg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-lg md:text-2xl font-bold tracking-tight tabular-nums ${card.textColor}`}>
                        {card.value}
                      </span>
                      {card.badge && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-medium">
                          {card.badge}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <p className="text-[11px] md:text-xs text-slate-500 font-medium">
                        {card.subtext}
                      </p>
                      {card.momBadge}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Monthly Budget Alert Progress Bar (Overall + Per Category) */}
      {hasBudget ? (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  isOverBudget
                    ? "bg-rose-50 text-rose-600"
                    : isWarningBudget
                    ? "bg-amber-50 text-amber-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                <Target className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">
                    Anggaran Keseluruhan ({monthName} {year})
                  </span>
                  {isCustomBudget && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                      Kustom Bulan Ini
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 font-semibold ${
                      isOverBudget
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : isWarningBudget
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    {pct}% Terpakai
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Terpakai <strong>{formatRupiah(totalPengeluaran)}</strong> dari plafon{" "}
                  <strong>{formatRupiah(effectiveTotalBudget)}</strong>
                  {effectiveTotalBudget >= totalPengeluaran
                    ? ` • Sisa ${formatRupiah(effectiveTotalBudget - totalPengeluaran)}`
                    : ` • Melebihi batas ${formatRupiah(totalPengeluaran - effectiveTotalBudget)}!`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-64 shrink-0">
              <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${clampedPct}%` }}
                />
              </div>
              {onOpenBudgetSettings && (
                <button
                  type="button"
                  onClick={onOpenBudgetSettings}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline shrink-0 inline-flex items-center gap-1"
                >
                  <Target className="w-3 h-3" />
                  Atur Anggaran
                </button>
              )}
            </div>
          </div>

          {/* Breakdown Anggaran Per Kategori */}
          {catBudgetEntries.length > 0 && (
            <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {catBudgetEntries.map(([catName, catLimit]) => {
                const used = perKategori[catName] || 0;
                const catPct = Math.round((used / catLimit) * 1000) / 10;
                const clampedCat = Math.min(100, Math.max(0, catPct));
                const isCatOver = catPct >= 95;
                const isCatWarn = catPct >= 75 && catPct < 95;
                const allocatedPct = categoryBudgetPercentages[catName];
                const catBarColor = isCatOver
                  ? "bg-rose-500"
                  : isCatWarn
                  ? "bg-amber-500"
                  : "bg-emerald-500";

                return (
                  <div
                    key={catName}
                    className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-slate-700 truncate">
                          {catName}
                        </span>
                        {allocatedPct !== undefined && allocatedPct > 0 && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200/70 text-slate-600 font-medium shrink-0">
                            {allocatedPct}%
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold tabular-nums shrink-0 ${
                          isCatOver
                            ? "text-rose-600"
                            : isCatWarn
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {catPct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${catBarColor}`}
                        style={{ width: `${clampedCat}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 tabular-nums">
                      <span>{formatRupiah(used)}</span>
                      <span>/ {formatRupiah(catLimit)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        onOpenBudgetSettings && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onOpenBudgetSettings}
              className="text-[11px] text-slate-500 hover:text-blue-600 inline-flex items-center gap-1 font-medium transition-colors"
            >
              <Target className="w-3 h-3" />
              Atur Target Anggaran (Keseluruhan & Per Kategori)
            </button>
          </div>
        )
      )}
    </div>
  );
};
