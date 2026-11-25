import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ReceiptText,
  CalendarClock,
  HandCoins,
  ArrowLeftRight,
  ArrowDownToLine,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CashflowExportDialog } from "./CashflowExportDialog";

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
  currentMonth?: number;
  currentMonthEnd?: number;
  currentYear?: number;
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
  currentMonth,
  currentMonthEnd,
  currentYear,
  children,
}) => {
  const isStaff = userRole === "staff";
  const isWarehouse = userRole === "warehouse";
  const [isExportDialogOpen, setIsExportDialogOpen] = useState<boolean>(false);

  return (
    <div className="space-y-3.5">
      {/* Top Bar: Editorial Hairline Sub-Navigation & Quick Action Export */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[color:var(--ledger-hairline)]">
        <nav
          aria-label="Sub-navigasi kas dan pengeluaran"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar -mb-px"
        >
          {/* Tab 1: Semua Transaksi */}
          {!isStaff && (
            <button
              type="button"
              onClick={() => onSubTabChange("transactions")}
              aria-current={activeSubTab === "transactions" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "transactions"
                  ? "border-blue-600 text-slate-900 dark:border-blue-400 dark:text-slate-100"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <ReceiptText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Semua Transaksi</span>
            </button>
          )}

          {/* Tab 2: Belum Lunas (Tempo / DP) */}
          {!isStaff && !isWarehouse && (
            <button
              type="button"
              onClick={() => onSubTabChange("unpaid")}
              aria-current={activeSubTab === "unpaid" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "unpaid"
                  ? "border-[var(--signal-unpaid)] text-[var(--signal-unpaid)]"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <CalendarClock className="w-3.5 h-3.5 text-[var(--signal-unpaid)]" />
              <span>Belum Lunas</span>
              {unpaidCount > 0 && (
                <span className="ml-0.5 text-[10px] font-mono-ledger tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--signal-unpaid-soft)] text-[var(--signal-unpaid)] font-bold">
                  {unpaidCount}
                </span>
              )}
            </button>
          )}

          {/* Tab 3: Talangan Karyawan */}
          <button
            type="button"
            onClick={() => onSubTabChange("talangan")}
            aria-current={activeSubTab === "talangan" ? "page" : undefined}
            className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
              activeSubTab === "talangan"
                ? "border-[var(--signal-talangan)] text-[var(--signal-talangan)]"
                : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            )}
          >
            <HandCoins className="w-3.5 h-3.5 text-[var(--signal-talangan)]" />
            <span>Talangan Staff</span>
            {reimburseCount > 0 && (
              <span className="ml-0.5 text-[10px] font-mono-ledger tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--signal-talangan-soft)] text-[var(--signal-talangan)] font-bold">
                {reimburseCount}
              </span>
            )}
          </button>

          {/* Tab 4: Tukar Cash & Ongkir Kurir */}
          {!isStaff && (
            <button
              type="button"
              onClick={() => onSubTabChange("cash-delivery")}
              aria-current={activeSubTab === "cash-delivery" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "cash-delivery"
                  ? "border-blue-600 text-slate-900 dark:border-blue-400 dark:text-slate-100"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Kurir &amp; Kasir</span>
            </button>
          )}

          {/* Tab 5: Transaksi Masuk (POS / Bank) */}
          {!isStaff && !isWarehouse && (
            <button
              type="button"
              onClick={() => onSubTabChange("incoming")}
              aria-current={activeSubTab === "incoming" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "incoming"
                  ? "border-[var(--signal-cleared)] text-[var(--signal-cleared)]"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <ArrowDownToLine className="w-3.5 h-3.5 text-[var(--signal-cleared)]" />
              <span>Uang Masuk</span>
            </button>
          )}
        </nav>

        {/* Quick Action: Export Cashflow CSV */}
        {!isStaff && (
          <div className="flex items-center gap-2 shrink-0 pb-1.5 sm:pb-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExportDialogOpen(true)}
              className="min-h-[34px] px-2.5 rounded-lg text-xs font-semibold gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)] hover:border-[var(--signal-cleared)] hover:text-[var(--signal-cleared)] ledger-press"
              title="Export Arus Kas Harian (Cash In, Cash Out, Saldo Harian)"
            >
              <Download className="w-3.5 h-3.5 text-[var(--signal-cleared)]" />
              <span>Export Cashflow</span>
            </Button>
          </div>
        )}
      </div>

      <CashflowExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        initialMonth={currentMonth}
        initialMonthEnd={currentMonthEnd}
        initialYear={currentYear}
      />

      {/* Main Content Area */}
      <div className="min-h-[450px]">
        {children}
      </div>
    </div>
  );
};

