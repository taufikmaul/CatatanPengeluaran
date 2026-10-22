import React from "react";
import { UnpaidExpenseItem } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Check,
  Store,
  ChevronRight,
} from "lucide-react";

interface UnpaidOrdersCardProps {
  unpaidList?: UnpaidExpenseItem[];
  onMarkPaid?: (id: number) => void;
  onViewAll?: () => void;
}

export const UnpaidOrdersCard: React.FC<UnpaidOrdersCardProps> = ({
  unpaidList = [],
  onMarkPaid,
  onViewAll,
}) => {
  const totalNominal = unpaidList.reduce((sum, item) => sum + (item.nominal || 0), 0);

  // Helper to determine due date urgency status
  const getDueStatus = (dueDateStr?: string) => {
    if (!dueDateStr || dueDateStr === "-" || dueDateStr.trim() === "") {
      return { label: "Tanpa Tempo", color: "bg-slate-100 text-slate-600 border-slate-200" };
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Parse date (supports YYYY-MM-DD or DD/MM/YYYY)
      let due: Date | null = null;
      if (dueDateStr.includes("-")) {
        due = new Date(dueDateStr);
      } else if (dueDateStr.includes("/")) {
        const parts = dueDateStr.split("/");
        if (parts.length === 3) {
          due = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        }
      }

      if (due && !isNaN(due.getTime())) {
        due.setHours(0, 0, 0, 0);
        const diffTime = due.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          return {
            label: `Lewat ${Math.abs(diffDays)} Hari!`,
            color: "bg-rose-100 text-rose-800 border-rose-300 font-bold",
            isUrgent: true,
          };
        } else if (diffDays === 0) {
          return {
            label: "Jatuh Tempo Hari Ini",
            color: "bg-amber-100 text-amber-800 border-amber-300 font-bold",
            isUrgent: true,
          };
        } else if (diffDays <= 3) {
          return {
            label: `${diffDays} Hari Lagi`,
            color: "bg-amber-50 text-amber-700 border-amber-200 font-semibold",
          };
        }
      }
    } catch {
      // Fallback
    }

    return {
      label: `Tempo: ${dueDateStr}`,
      color: "bg-blue-50 text-blue-700 border-blue-200",
    };
  };

  return (
    <Card className="h-full flex flex-col border-slate-200 shadow-xs bg-white overflow-hidden">
      <CardHeader className="p-4 md:p-5 pb-3 border-b border-slate-100 bg-gradient-to-r from-rose-50/60 to-transparent">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-700 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm md:text-base font-bold text-slate-800 flex items-center gap-2">
                Orderan Perlu Pelunasan
              </CardTitle>
              <p className="text-[11px] text-slate-400 font-medium truncate">
                Tagihan hutang belanja & jatuh tempo
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-xs md:text-sm font-bold text-rose-600 block tabular-nums">
              {formatRupiah(totalNominal)}
            </span>
            <span className="text-[10px] text-slate-400 font-medium">
              {unpaidList.length} tagihan pending
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-5 flex-1 flex flex-col justify-between">
        {unpaidList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-700">Semua Tagihan Lunas!</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Tidak ada orderan pending di periode ini.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {unpaidList.map((item, idx) => {
              const status = getDueStatus(item.tempo);
              return (
                <div
                  key={`unpaid-${item.id || idx}-${item.barang}`}
                  className="p-3 rounded-xl border border-slate-200/90 hover:border-slate-300 bg-slate-50/40 hover:bg-white transition-all space-y-2 shadow-2xs group"
                >
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-800 text-xs md:text-sm truncate">
                          {item.barang}
                        </span>
                        {item.kategori && (
                          <span className="text-[10px] bg-slate-200/80 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                            {item.kategori}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
                        {item.supplier && item.supplier !== "-" && (
                          <span className="flex items-center gap-1 text-slate-600 truncate">
                            <Store className="w-3 h-3 text-slate-400 shrink-0" />
                            {item.supplier}
                          </span>
                        )}
                        {item.tanggal && (
                          <span>• Tgl: {item.tanggal}</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold text-rose-600 text-xs md:text-sm block tabular-nums">
                        {formatRupiah(item.nominal)}
                      </span>
                    </div>
                  </div>

                  {/* Due Date & Action Strip */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-2 py-0.5 border ${status.color}`}
                      >
                        {status.label}
                      </Badge>
                      {item.tempo && item.tempo !== "-" && (
                        <span className="text-slate-400 font-mono text-[10px] hidden sm:inline">
                          ({item.tempo})
                        </span>
                      )}
                    </div>

                    {item.id && onMarkPaid && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onMarkPaid(item.id!)}
                        className="h-6 px-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 rounded-lg gap-1 transition-all"
                        title="Tandai pembayaran ini sebagai Lunas"
                      >
                        <Check className="w-3 h-3" />
                        Lunaskan
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {unpaidList.length > 0 && onViewAll && (
          <div className="pt-3 border-t border-slate-100 mt-2 text-center">
            <button
              onClick={onViewAll}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors inline-flex items-center gap-1"
            >
              Lihat di Tabel Transaksi Belum Lunas
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
