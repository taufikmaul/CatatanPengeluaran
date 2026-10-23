import React, { useState } from "react";
import {
  Bell,
  Calendar,
  ChevronDown,
  LogOut,
  Moon,
  Plus,
  Sun,
  AlertTriangle,
  Receipt,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatRupiah } from "@/lib/formatters";

export interface DashboardHeaderProps {
  activeTab: "overview" | "master" | "config";
  month: number;
  year: number;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  onOpenAddExpense: () => void;
  userRole?: string | null;
  unpaidCount?: number;
  unpaidTotal?: number;
  reimburseCount?: number;
  onFilterUnpaid?: () => void;
  onFilterReimburse?: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
}

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function DashboardHeader({
  activeTab,
  month,
  year,
  onMonthChange,
  onYearChange,
  onOpenAddExpense,
  userRole,
  unpaidCount = 0,
  unpaidTotal = 0,
  reimburseCount = 0,
  onFilterUnpaid,
  onFilterReimburse,
  isDarkMode,
  onToggleDarkMode,
  onLogout,
}: DashboardHeaderProps) {
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);

  const titleMap: Record<string, string> = {
    overview: userRole === "admin_input" ? "Pencatatan Transaksi" : "Overview & Analisis",
    master: "Katalog Master Item",
    config: "Konfigurasi Sistem",
  };

  const currentYear = new Date().getFullYear();
  const availableYears = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  const totalAlerts = unpaidCount + reimburseCount;

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-4 md:px-6 transition-all">
      {/* Left: Sidebar Trigger & Page Title */}
      <div className="flex items-center gap-3">
        <SidebarTrigger className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" />
        <Separator orientation="vertical" className="h-5 bg-slate-200 dark:bg-slate-800 hidden sm:block" />
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-base md:text-lg text-slate-900 dark:text-slate-100 leading-tight">
            {titleMap[activeTab] || "Dashboard"}
          </h1>
          {userRole === "admin_input" ? (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 hidden sm:inline-flex"
            >
              Mode Input
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold text-slate-600 border-slate-200 bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 hidden sm:inline-flex"
            >
              {MONTH_NAMES[month - 1]} {year}
            </Badge>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Quick Month & Year Picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 rounded-xl border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 rounded-xl border border-slate-200 dark:border-slate-800 p-2 shadow-lg"
          >
            <DropdownMenuLabel className="text-xs font-semibold px-2 py-1 text-slate-500">
              Pilih Periode Laporan
            </DropdownMenuLabel>
            <div className="grid grid-cols-3 gap-1 p-1">
              {MONTH_NAMES.map((mName, idx) => {
                const mNum = idx + 1;
                const isSelected = mNum === month;
                return (
                  <button
                    key={mName}
                    type="button"
                    onClick={() => onMonthChange(mNum)}
                    className={`text-xs py-1.5 px-1 rounded-lg text-center transition-colors font-medium ${
                      isSelected
                        ? "bg-blue-600 text-white font-semibold"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {mName.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <DropdownMenuSeparator className="my-1.5" />
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-slate-500 font-medium">Tahun</span>
              <div className="flex items-center gap-1">
                {availableYears.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => onYearChange(yr)}
                    className={`text-xs px-2 py-1 rounded-md transition-colors ${
                      yr === year
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Operational Alerts / Notifications Popover */}
        <Popover open={isAlertsOpen} onOpenChange={setIsAlertsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="relative h-9 w-9 p-0 rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              title="Notifikasi & Perhatian"
            >
              <Bell className="w-4 h-4" />
              {totalAlerts > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-xs">
                  {totalAlerts}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-xl space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Perhatian Operasional
              </h2>
              <span className="text-[10px] text-slate-400 font-medium">
                {MONTH_NAMES[month - 1]} {year}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {unpaidCount > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30 p-2.5 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-amber-900 dark:text-amber-200">
                        {unpaidCount} Tagihan Belum Lunas
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        Total {formatRupiah(unpaidTotal)}
                      </div>
                    </div>
                  </div>
                  {onFilterUnpaid && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsAlertsOpen(false);
                        onFilterUnpaid();
                      }}
                      className="w-full h-7 text-[11px] rounded-md border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
                    >
                      Buka Daftar Belum Lunas
                    </Button>
                  )}
                </div>
              ) : null}

              {reimburseCount > 0 ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/30 p-2.5 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <Receipt className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-blue-900 dark:text-blue-200">
                        {reimburseCount} Klaim Reimbursement
                      </div>
                      <div className="text-[11px] text-blue-700 dark:text-blue-300">
                        Menunggu verifikasi pembayaran
                      </div>
                    </div>
                  </div>
                  {onFilterReimburse && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsAlertsOpen(false);
                        onFilterReimburse();
                      }}
                      className="w-full h-7 text-[11px] rounded-md border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-200 dark:hover:bg-blue-900/40"
                    >
                      Tampilkan Klaim Reimburse
                    </Button>
                  )}
                </div>
              ) : null}

              {unpaidCount === 0 && reimburseCount === 0 && (
                <div className="flex items-center gap-2 py-3 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="text-xs">
                    Semua tagihan dan pengeluaran bulan ini dalam kondisi rapi.
                  </span>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Theme Dark/Light Mode Toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleDarkMode}
          className="h-9 w-9 p-0 rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          title={isDarkMode ? "Beralih ke Mode Terang" : "Beralih ke Mode Gelap"}
        >
          {isDarkMode ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600" />
          )}
        </Button>

        {/* Primary Action Button */}
        <Button
          onClick={onOpenAddExpense}
          size="sm"
          className="h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Catat Pengeluaran</span>
          <span className="sm:hidden">Catat</span>
        </Button>
      </div>
    </header>
  );
}
