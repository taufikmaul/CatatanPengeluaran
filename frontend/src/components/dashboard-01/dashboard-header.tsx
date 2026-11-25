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
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { BackgroundQueuePopover } from "@/components/common/BackgroundQueuePopover";

export interface DashboardHeaderProps {
  activeTab: "overview" | "transactions" | "incoming" | "accounting" | "laporan-umum" | "master" | "menus" | "suppliers" | "supplier-detail" | "inventaris" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "requests" | "approval" | "purchasing" | "gudang" | "config" | "ai-chat";
  month: number;
  monthEnd?: number;
  year: number;
  onMonthChange: (month: number, monthEnd?: number) => void;
  onPeriodChange?: (monthStart: number, monthEnd: number, year: number) => void;
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
  monthEnd,
  year,
  onMonthChange,
  onPeriodChange,
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
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const { state: sidebarState, isMobile } = useSidebar();
  const isSidebarExpanded = sidebarState === "expanded";

  const effectiveMonthEnd = monthEnd || month;
  const now = new Date();
  const currentRealMonth = now.getMonth() + 1;
  const currentRealYear = now.getFullYear();

  const setPeriod = (start: number, end: number, yr: number = year) => {
    const s = Math.min(start, end);
    const e = Math.max(start, end);
    if (onPeriodChange) {
      onPeriodChange(s, e, yr);
    } else {
      onMonthChange(s, e);
      if (yr !== year) onYearChange(yr);
    }
  };

  const handleMonthGridClick = (mNum: number) => {
    if (rangeAnchor === null) {
      setRangeAnchor(mNum);
      setPeriod(mNum, mNum, year);
    } else {
      setPeriod(rangeAnchor, mNum, year);
      setRangeAnchor(null);
    }
  };

  const titleMap: Record<string, string> = {
    overview: "Overview & Analisis Keuangan",
    transactions: "Daftar Transaksi & Peringkat Belanja",
    incoming: "Daftar Transaksi Masuk (POS & Platform)",
    accounting: "Laporan & Analisis Akuntansi",
    "laporan-umum": "Laporan Umum Operasional",
    master: "Katalog Master Item",
    menus: "Database Menu / Produk & HPP",
    suppliers: "Master Supplier / Toko & Kurir",
    "supplier-detail": "Detail Toko & Histori Belanja",
    inventaris: "Inventaris Aset Tetap & Penyusutan",
    "tukar-cash-ongkir": "Tukar Cash & Ongkir Kurir",
    talangan: "Daftar Talangan (Reimbursement)",
    unpaid: "Daftar Tagihan Belum Lunas (Tempo)",
    requests: "Pengajuan Belanja",
    approval: "Approval Belanja (Manager / Owner)",
    purchasing: "Purchasing & Order Supplier",
    gudang: "Gudang & Penerimaan Barang",
    config: "Konfigurasi Sistem",
    "ai-chat": "Asisten AI Keuangan",
  };

  const breadcrumbMap: Record<string, { hub: string; sub: string }> = {
    overview: { hub: "Kas & Pengeluaran", sub: "Overview Kas" },
    transactions: { hub: "Kas & Pengeluaran", sub: "Semua Transaksi" },
    unpaid: { hub: "Kas & Pengeluaran", sub: "Tagihan Belum Lunas" },
    talangan: { hub: "Kas & Pengeluaran", sub: "Talangan Staff" },
    "tukar-cash-ongkir": { hub: "Kas & Pengeluaran", sub: "Kurir & Kasir" },
    incoming: { hub: "Kas & Pengeluaran", sub: "Uang Masuk POS" },
    requests: { hub: "Alur Pengadaan", sub: "Pengajuan Belanja" },
    approval: { hub: "Alur Pengadaan", sub: "Approval Owner" },
    purchasing: { hub: "Alur Pengadaan", sub: "Pemesanan PO" },
    gudang: { hub: "Alur Pengadaan", sub: "Penerimaan Gudang" },
    master: { hub: "Katalog & Margin", sub: "Item & Satuan" },
    menus: { hub: "Katalog & Margin", sub: "Menu & Resep HPP" },
    suppliers: { hub: "Katalog & Margin", sub: "Supplier & Toko" },
    "supplier-detail": { hub: "Katalog & Margin", sub: "Detail Toko" },
    inventaris: { hub: "Katalog & Margin", sub: "Inventaris Aset" },
    accounting: { hub: "Laporan & Kontrol", sub: "Laporan Akuntansi" },
    "laporan-umum": { hub: "Laporan & Kontrol", sub: "Laporan Umum" },
    config: { hub: "Laporan & Kontrol", sub: "Pengaturan Sistem" },
    "ai-chat": { hub: "Asisten AI", sub: "Tanya Data Keuangan" },
  };

  const currentBreadcrumb = breadcrumbMap[activeTab] || { hub: "Dashboard", sub: titleMap[activeTab] || "Overview" };

  const currentYear = new Date().getFullYear();
  const availableYears = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  const totalAlerts = unpaidCount + reimburseCount;

  const roleBadgeMap: Record<string, { label: string; color: string }> = {
    admin: { label: "👑 Owner", color: "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300" },
    purchasing: { label: "🛒 Purchasing", color: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300" },
    warehouse: { label: "📦 Gudang", color: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300" },
    staff: { label: "👨‍🍳 Staf Dapur", color: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300" },
    admin_input: { label: "📝 Admin Input", color: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-zinc-800 dark:text-zinc-300" },
  };

  const currentRoleBadge = roleBadgeMap[userRole || "admin"] || roleBadgeMap.admin;
  const canAddExpense = !userRole || userRole === "admin" || userRole === "admin_input" || userRole === "purchasing";
  const canViewAlerts = !userRole || userRole === "admin" || userRole === "admin_input" || userRole === "purchasing";
  const isOwnerRole = !userRole || userRole === "admin";

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-[var(--ledger-hairline)] bg-white/90 px-3 sm:px-5 backdrop-blur-md transition-colors duration-150 dark:bg-slate-900/90 md:px-6">
      {/* Left: Sidebar Trigger & Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger
              aria-label={
                isMobile
                  ? "Buka menu navigasi"
                  : isSidebarExpanded
                  ? "Lipat sidebar"
                  : "Buka sidebar"
              }
              className="h-9 w-9 shrink-0 rounded-xl border border-[var(--ledger-hairline)] bg-[var(--ledger-surface)] text-slate-700 hover:bg-[var(--ledger-recessed)] hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
            >
              {isMobile ? (
                <PanelLeft className="h-4 w-4" />
              ) : isSidebarExpanded ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </SidebarTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" sideOffset={8} hidden={isMobile}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">
                {isSidebarExpanded ? "Lipat sidebar" : "Buka sidebar"}
              </span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ⌘B
              </kbd>
            </div>
          </TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="hidden h-5 shrink-0 bg-[var(--ledger-hairline)] sm:block" />
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-[var(--ledger-muted)] hidden lg:inline shrink-0">
            {currentBreadcrumb.hub}
          </span>
          <span className="text-slate-300 dark:text-slate-700 hidden lg:inline text-xs font-bold">/</span>
          <h1 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 leading-tight truncate">
            {currentBreadcrumb.sub}
          </h1>
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold hidden xl:inline-flex shrink-0 ${currentRoleBadge.color}`}
          >
            {currentRoleBadge.label}
          </Badge>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Multi-Month Range & Year Picker Popover */}
        <Popover open={isPeriodOpen} onOpenChange={setIsPeriodOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2 sm:px-3 rounded-xl border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 gap-1 sm:gap-1.5 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              {month === effectiveMonthEnd ? (
                <>
                  <span className="hidden sm:inline">
                    {MONTH_NAMES[month - 1]} {year}
                  </span>
                  <span className="sm:hidden text-[11px]">
                    {MONTH_NAMES[month - 1].slice(0, 3)} '{String(year).slice(-2)}
                  </span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">
                    {MONTH_NAMES[month - 1].slice(0, 3)} - {MONTH_NAMES[effectiveMonthEnd - 1].slice(0, 3)} {year}
                  </span>
                  <span className="sm:hidden text-[11px]">
                    {MONTH_NAMES[month - 1].slice(0, 3)}-{MONTH_NAMES[effectiveMonthEnd - 1].slice(0, 3)} '{String(year).slice(-2)}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1 py-0 h-4 font-mono hidden md:inline-flex bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-none"
                  >
                    {Math.abs(effectiveMonthEnd - month) + 1} bln
                  </Badge>
                </>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[330px] sm:w-[380px] rounded-2xl border border-slate-200 dark:border-slate-800 p-3 sm:p-4 shadow-xl bg-white dark:bg-slate-900"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 mb-2.5">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Filter Periode Laporan & Data
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Pilih satu bulan atau rentang multi-bulan (mis. Jan - Jul)
                </p>
              </div>
              <Badge
                variant="outline"
                className="text-[11px] font-mono font-semibold bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800"
              >
                {month === effectiveMonthEnd
                  ? `${MONTH_NAMES[month - 1]} ${year}`
                  : `${MONTH_NAMES[month - 1].slice(0, 3)} - ${MONTH_NAMES[effectiveMonthEnd - 1].slice(0, 3)} ${year}`}
              </Badge>
            </div>

            {/* Quick Presets */}
            <div className="mb-3">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">
                Preset Cepat
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(currentRealMonth, currentRealMonth, currentRealYear)}
                >
                  Bulan Ini
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => {
                    const prevMonth = currentRealMonth === 1 ? 12 : currentRealMonth - 1;
                    const prevYear = currentRealMonth === 1 ? currentRealYear - 1 : currentRealYear;
                    setPeriod(prevMonth, prevMonth, prevYear);
                  }}
                >
                  Bulan Lalu
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(1, 3, year)}
                >
                  Q1 (Jan-Mar)
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(4, 6, year)}
                >
                  Q2 (Apr-Jun)
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(7, 9, year)}
                >
                  Q3 (Jul-Sep)
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(10, 12, year)}
                >
                  Q4 (Okt-Des)
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(1, 6, year)}
                >
                  Semester 1
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setPeriod(7, 12, year)}
                >
                  Semester 2
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 col-span-2 sm:col-span-2"
                  onClick={() => setPeriod(1, 12, year)}
                >
                  1 Tahun Penuh (Jan - Des)
                </Button>
              </div>
            </div>

            {/* Dari Bulan / Sampai Bulan Dropdowns */}
            <div className="grid grid-cols-2 gap-2 mb-3 bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  Dari Bulan
                </label>
                <select
                  value={month}
                  onChange={(e) => {
                    const newStart = parseInt(e.target.value, 10);
                    const newEnd = Math.max(newStart, effectiveMonthEnd);
                    setPeriod(newStart, newEnd, year);
                  }}
                  className="w-full h-8 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-2 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {idx + 1}. {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  Sampai Bulan
                </label>
                <select
                  value={effectiveMonthEnd}
                  onChange={(e) => {
                    const newEnd = parseInt(e.target.value, 10);
                    const newStart = Math.min(month, newEnd);
                    setPeriod(newStart, newEnd, year);
                  }}
                  className="w-full h-8 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-2 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {idx + 1}. {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interactive 12-Month Range Grid */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
                  Pilih Pada Grid Bulan {rangeAnchor !== null && "(Pilih Bulan Akhir...)"}
                </span>
                {rangeAnchor !== null && (
                  <button
                    type="button"
                    onClick={() => setRangeAnchor(null)}
                    className="text-[10px] text-rose-500 hover:underline font-semibold"
                  >
                    Batal
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {MONTH_NAMES.map((mName, idx) => {
                  const mNum = idx + 1;
                  const isRangeStart = mNum === month;
                  const isRangeEnd = mNum === effectiveMonthEnd;
                  const isInRange = mNum >= month && mNum <= effectiveMonthEnd;
                  const isAnchor = mNum === rangeAnchor;

                  let styleClass = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";
                  if (isAnchor) {
                    styleClass = "bg-amber-500 text-white border-amber-600 font-bold ring-2 ring-amber-300 animate-pulse";
                  } else if (isRangeStart && isRangeEnd) {
                    styleClass = "bg-blue-600 text-white border-blue-600 font-bold shadow-xs";
                  } else if (isRangeStart || isRangeEnd) {
                    styleClass = "bg-blue-600 text-white border-blue-600 font-bold";
                  } else if (isInRange) {
                    styleClass = "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900 font-semibold";
                  }

                  return (
                    <button
                      key={mName}
                      type="button"
                      onClick={() => handleMonthGridClick(mNum)}
                      className={`text-xs py-1.5 px-1 rounded-lg border text-center transition-all ${styleClass}`}
                    >
                      {mName.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Year Selector & Done Button */}
            <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mr-1">Tahun:</span>
                {availableYears.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => {
                      if (onPeriodChange) {
                        onPeriodChange(month, effectiveMonthEnd, yr);
                      } else {
                        onYearChange(yr);
                      }
                    }}
                    className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                      yr === year
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                className="h-7 px-3 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => setIsPeriodOpen(false)}
              >
                Tutup
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Operational Alerts / Notifications Popover */}
        {canViewAlerts && (
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
                <span className="text-[10px] text-slate-500 font-medium">
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
        )}

        {/* Background Action Queue Popover (Owner only) */}
        {isOwnerRole && <BackgroundQueuePopover />}

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

        {/* Primary Action Button (Desktop/Tablet only, on mobile FAB is used) */}
        {canAddExpense && (
          <Button
            onClick={onOpenAddExpense}
            size="sm"
            className="hidden sm:inline-flex h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Catat Pengeluaran</span>
          </Button>
        )}
      </div>
    </header>
  );
}
