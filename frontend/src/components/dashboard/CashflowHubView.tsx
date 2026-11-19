import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ReceiptText,
  CalendarClock,
  HandCoins,
  ArrowLeftRight,
  ArrowDownToLine,
  Plus,
  Wallet,
  TrendingDown,
  Clock,
  Sparkles,
} from "lucide-react";
import { formatRupiah } from "@/lib/formatters";

export type CashflowSubTab = "transactions" | "unpaid" | "talangan" | "cash-delivery" | "incoming";

export interface CashflowHubViewProps {
  activeSubTab: CashflowSubTab;
  onSubTabChange: (tab: CashflowSubTab) => void;
  onOpenAddExpense: () => void;
  unpaidCount?: number;
  unpaidTotal?: number;
  reimburseCount?: number;
  reimburseTotal?: number;
  totalPengeluaran?: number;
  userRole?: string | null;
  children: React.ReactNode;
}

export const CashflowHubView: React.FC<CashflowHubViewProps> = ({
  activeSubTab,
  onSubTabChange,
  onOpenAddExpense,
  unpaidCount = 0,
  unpaidTotal = 0,
  reimburseCount = 0,
  reimburseTotal = 0,
  totalPengeluaran = 0,
  userRole,
  children,
}) => {
  const isStaff = userRole === "staff";
  const isWarehouse = userRole === "warehouse";

  return (
    <div className="space-y-4">
      {/* Sub-Pills Navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-x-auto no-scrollbar">
        {/* Tab 1: Semua Transaksi */}
        {!isStaff && (
          <Button
            variant={activeSubTab === "transactions" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("transactions")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "transactions"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <ReceiptText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Semua Transaksi</span>
          </Button>
        )}

        {/* Tab 2: Belum Lunas (Tempo / DP) */}
        {!isStaff && !isWarehouse && (
          <Button
            variant={activeSubTab === "unpaid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("unpaid")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "unpaid"
                ? "bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5 text-rose-500" />
            <span>Belum Lunas</span>
            {unpaidCount > 0 && (
              <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-rose-500 text-white font-bold rounded-full">
                {unpaidCount}
              </Badge>
            )}
          </Button>
        )}

        {/* Tab 3: Talangan Karyawan */}
        <Button
          variant={activeSubTab === "talangan" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onSubTabChange("talangan")}
          className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
            activeSubTab === "talangan"
              ? "bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-400 shadow-xs"
              : "text-slate-600 dark:text-slate-400 hover:text-purple-600 hover:bg-white/60 dark:hover:bg-slate-800/50"
          }`}
        >
          <HandCoins className="w-3.5 h-3.5 text-purple-500" />
          <span>Talangan Staff</span>
          {reimburseCount > 0 && (
            <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-purple-500 text-white font-bold rounded-full">
              {reimburseCount}
            </Badge>
          )}
        </Button>

        {/* Tab 4: Tukar Cash & Ongkir Kurir */}
        {!isStaff && (
          <Button
            variant={activeSubTab === "cash-delivery" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("cash-delivery")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "cash-delivery"
                ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
            <span>Kurir &amp; Kasir</span>
          </Button>
        )}

        {/* Tab 5: Transaksi Masuk (POS / Bank) */}
        {!isStaff && !isWarehouse && (
          <Button
            variant={activeSubTab === "incoming" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("incoming")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "incoming"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-emerald-600 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Uang Masuk</span>
          </Button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="min-h-[450px]">
        {children}
      </div>
    </div>
  );
};
