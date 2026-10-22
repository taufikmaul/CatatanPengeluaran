import React from "react";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent } from "@/lib/../components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Wallet, Receipt, AlertCircle, Layers } from "lucide-react";

interface StatCardsProps {
  totalLunas: number;
  totalPengeluaran: number;
  expenseCount: number;
  unpaidCount: number;
  unpaidTotal: number;
  categoryCount: number;
  monthName: string;
  year: number;
  onFilterUnpaid?: () => void;
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
  onFilterUnpaid,
}) => {
  const cards = [
    {
      title: "Total Lunas",
      value: formatRupiah(totalLunas),
      subtext: `${monthName} ${year}`,
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

  return (
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

                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-lg md:text-2xl font-bold tracking-tight tabular-nums ${card.textColor}`}>
                      {card.value}
                    </span>
                    {card.badge && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-medium">
                        {card.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] md:text-xs text-slate-400 font-medium">
                    {card.subtext}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
};
