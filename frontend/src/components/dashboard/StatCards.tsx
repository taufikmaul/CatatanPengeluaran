import React from "react";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Wallet,
  Receipt,
  AlertCircle,
  Layers,
  TrendingUp,
  TrendingDown,
  Target,
  Tag,
  ArrowLeftRight,
  Truck,
  BookOpen,
  Package,
  Building2,
  Landmark,
} from "lucide-react";

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
  reimbursePendingCount?: number;
  reimbursePendingTotal?: number;
  totalTukarCash?: number;
  tukarCashCount?: number;
  totalOngkir?: number;
  ongkirCount?: number;
  ongkirReimburseCount?: number;
  ongkirReimburseTotal?: number;
  onFilterUnpaid?: () => void;
  onFilterReimburse?: () => void;
  onOpenBudgetSettings?: () => void;
  onOpenTukarCashOngkir?: (subType?: "all" | "tukar_cash" | "ongkir") => void;
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
  perAccountGroup = {},
  accountingBreakdown = [],
  reimbursePendingCount = 0,
  reimbursePendingTotal = 0,
  totalTukarCash = 0,
  tukarCashCount = 0,
  totalOngkir = 0,
  ongkirCount = 0,
  ongkirReimburseCount = 0,
  ongkirReimburseTotal = 0,
  onFilterUnpaid,
  onFilterReimburse,
  onOpenBudgetSettings,
  onOpenTukarCashOngkir,
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

      {/* Ringkasan Akuntansi Standar (HPP vs OPEX vs Capex Aset) */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-2xl p-4 md:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 backdrop-blur-md rounded-xl text-amber-300">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs md:text-sm font-bold text-white">Klasifikasi Akuntansi (SAK EMKM)</span>
                <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/30 text-[10px] font-semibold">
                  Bagan Akun (COA)
                </Badge>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Pemisahan Harga Pokok Penjualan (HPP), Beban Operasional (OPEX), dan Belanja Modal (Aset)
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Beban Laba Rugi Riil</span>
            <span className="text-sm md:text-base font-bold text-amber-300 tabular-nums">
              {formatRupiah((perAccountGroup["HPP"] || 0) + (perAccountGroup["OPEX"] || 0))}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* HPP Card */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-1.5 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-amber-300 text-xs font-semibold">
                <Package className="w-3.5 h-3.5" />
                <span>HPP / Biaya Pokok</span>
              </div>
              <Badge className="bg-amber-500/20 text-amber-200 border-amber-500/30 text-[9px] py-0 px-1.5 h-4">
                Laba Rugi (HPP)
              </Badge>
            </div>
            <div className="text-lg md:text-xl font-bold tracking-tight text-white tabular-nums">
              {formatRupiah(perAccountGroup["HPP"] || 0)}
            </div>
            <p className="text-[10px] text-slate-300 leading-tight">
              Bahan baku kue, minuman, kemasan, topper & ongkir kirim.
            </p>
          </div>

          {/* OPEX Card */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-1.5 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sky-300 text-xs font-semibold">
                <Building2 className="w-3.5 h-3.5" />
                <span>Beban Operasional</span>
              </div>
              <Badge className="bg-sky-500/20 text-sky-200 border-sky-500/30 text-[9px] py-0 px-1.5 h-4">
                Laba Rugi (OPEX)
              </Badge>
            </div>
            <div className="text-lg md:text-xl font-bold tracking-tight text-white tabular-nums">
              {formatRupiah(perAccountGroup["OPEX"] || 0)}
            </div>
            <p className="text-[10px] text-slate-300 leading-tight">
              Listrik, gas, galon, kebersihan, ATK & pemeliharaan toko.
            </p>
          </div>

          {/* Aset Tetap / Capex Card */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-1.5 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-purple-300 text-xs font-semibold">
                <Landmark className="w-3.5 h-3.5" />
                <span>Aset Tetap (Capex)</span>
              </div>
              <Badge className="bg-purple-500/20 text-purple-200 border-purple-500/30 text-[9px] py-0 px-1.5 h-4">
                Neraca (Aset)
              </Badge>
            </div>
            <div className="text-lg md:text-xl font-bold tracking-tight text-white tabular-nums">
              {formatRupiah(perAccountGroup["ASSET"] || 0)}
            </div>
            <p className="text-[10px] text-purple-200/90 leading-tight">
              {(perAccountGroup["ASSET"] || 0) > 0
                ? "Peralatan tahan lama (mixer, oven, showcase). Tidak memotong laba langsung."
                : "Tidak ada belanja aset baru bulan ini."}
            </p>
          </div>
        </div>
      </div>

      {/* 2 Card Terpisah: Tukar Cash & Ongkir Kurir */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        {/* Card 1: Tukar Cash (Tarik Tunai Karyawan) */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Card
            onClick={() => onOpenTukarCashOngkir?.("tukar_cash")}
            className="relative overflow-hidden border-indigo-200/90 bg-gradient-to-br from-indigo-50/50 via-white to-white hover:border-indigo-300 transition-all cursor-pointer hover:shadow-md group"
          >
            <CardContent className="p-4 md:p-5 relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
                    <ArrowLeftRight className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800">Tukar Cash (Tarik Tunai)</span>
                    <p className="text-[10px] text-slate-500">Mutasi kasir via transfer rekening</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold">
                  Kasir ⇄ Rekening
                </Badge>
              </div>

              <div className="space-y-1.5 mt-2">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-lg md:text-2xl font-bold tracking-tight tabular-nums text-indigo-900">
                    {formatRupiah(totalTukarCash)}
                  </span>
                  <span className="text-xs text-indigo-700 font-semibold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                    Buka Rincian &rarr;
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {tukarCashCount > 0
                    ? `${tukarCashCount} transaksi tarik tunai kasir (netral, tidak membebani OPEX toko)`
                    : "Belum ada mutasi tarik tunai bulan ini"}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Card 2: Biaya Ongkir & Kurir */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
        >
          <Card
            onClick={() => onOpenTukarCashOngkir?.("ongkir")}
            className="relative overflow-hidden border-sky-200/90 bg-gradient-to-br from-sky-50/50 via-white to-white hover:border-sky-300 transition-all cursor-pointer hover:shadow-md group"
          >
            <CardContent className="p-4 md:p-5 relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-sky-50 text-sky-700">
                    <Truck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800">Biaya Ongkir & Kurir</span>
                    <p className="text-[10px] text-slate-500">GoSend, GrabExpress, Lalamove, J&T</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200 font-semibold">
                  Logistik Toko
                </Badge>
              </div>

              <div className="space-y-1.5 mt-2">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-lg md:text-2xl font-bold tracking-tight tabular-nums text-sky-900">
                    {formatRupiah(totalOngkir)}
                  </span>
                  <span className="text-xs text-sky-700 font-semibold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                    Buka Rincian &rarr;
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {ongkirCount > 0
                    ? `${ongkirCount} pengiriman${
                        ongkirReimburseCount > 0
                          ? ` • ${ongkirReimburseCount} talangan e-wallet: ${formatRupiah(ongkirReimburseTotal)}`
                          : ""
                      }`
                    : "Belum ada catatan ongkir bulan ini"}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
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
