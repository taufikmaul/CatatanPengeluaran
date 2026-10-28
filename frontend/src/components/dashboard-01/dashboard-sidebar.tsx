import React from "react";
import {
  LayoutDashboard,
  ReceiptText,
  PackageCheck,
  Upload,
  Settings,
  LogOut,
  Moon,
  Sun,
  ChevronUp,
  Wallet,
  Home,
  ArrowLeftRight,
  ShieldAlert,
  Store,
  HandCoins,
  CalendarClock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getHubUrl } from "@/lib/hub";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatRupiah } from "@/lib/formatters";

export interface DashboardSidebarProps {
  activeTab: "overview" | "transactions" | "master" | "suppliers" | "supplier-detail" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "config";
  onTabChange: (tab: "overview" | "transactions" | "master" | "suppliers" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "config") => void;
  onOpenImport: () => void;
  onOpenAuditDuplicates?: () => void;
  userRole?: string | null;
  canManageConfig?: boolean;
  monthlyBudgetLimit?: number | null;
  budgetUsedPct?: number | null;
  totalPengeluaran?: number;
  expenseCount?: number;
  unpaidCount?: number;
  reimbursePendingCount?: number;
  username?: string;
  onLogout: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export function DashboardSidebar({
  activeTab,
  onTabChange,
  onOpenImport,
  onOpenAuditDuplicates,
  userRole,
  canManageConfig = false,
  monthlyBudgetLimit,
  budgetUsedPct = 0,
  totalPengeluaran = 0,
  expenseCount = 0,
  unpaidCount = 0,
  reimbursePendingCount = 0,
  username,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
}: DashboardSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();

  const handleSelectTab = (tab: "overview" | "transactions" | "master" | "suppliers" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "config") => {
    onTabChange(tab);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleOpenImport = () => {
    onOpenImport();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const roleLabel =
    userRole === "admin_input" ? "Admin Input" : "Owner / Admin Utama";
  const userInitials = (username || userRole || "HC")
    .slice(0, 2)
    .toUpperCase();

  const budgetLimitNumber = monthlyBudgetLimit || 0;
  const safeBudgetPct = Math.min(Math.max(budgetUsedPct || 0, 0), 100);

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-200 dark:border-slate-800">
      {/* Brand Header */}
      <SidebarHeader className="p-4 border-b border-slate-200/80 dark:border-slate-800">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-200/80 dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-400 font-bold text-sm tracking-tight select-none">
                HC
              </div>
              <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                    Historycake
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1 py-0 font-semibold border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                  >
                    Bakery
                  </Badge>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Catatan Pengeluaran
                </span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Main Navigation */}
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider px-2">
            Menu Utama
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1 mt-1">
            {/* Overview Keuangan */}
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "overview"}
                onClick={() => handleSelectTab("overview")}
                tooltip="Overview Keuangan"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "overview"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="truncate">Overview Keuangan</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Daftar Transaksi (Halaman / Route Baru) */}
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "transactions"}
                onClick={() => handleSelectTab("transactions")}
                tooltip="Daftar Transaksi & Peringkat Belanja"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "transactions"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <ReceiptText className="w-4 h-4" />
                <span className="truncate">Daftar Transaksi</span>
                {expenseCount > 0 && (
                  <SidebarMenuBadge className="ml-auto text-[10px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-md px-1.5 py-0.5 tabular-nums">
                    {expenseCount}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "master"}
                onClick={() => handleSelectTab("master")}
                tooltip="Master Item & Harga"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "master"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <PackageCheck className="w-4 h-4" />
                <span className="truncate">Master Item</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "suppliers" || activeTab === "supplier-detail"}
                onClick={() => handleSelectTab("suppliers")}
                tooltip="Master Supplier & Toko"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "suppliers" || activeTab === "supplier-detail"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <Store className="w-4 h-4" />
                <span className="truncate">Master Supplier</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "tukar-cash-ongkir"}
                onClick={() => handleSelectTab("tukar-cash-ongkir")}
                tooltip="Tukar Cash & Ongkir Kurir"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "tukar-cash-ongkir"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span className="truncate">Tukar Cash & Ongkir</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "talangan"}
                onClick={() => handleSelectTab("talangan")}
                tooltip="Daftar Talangan (Reimburse Karyawan)"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "talangan"
                    ? "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <HandCoins className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="truncate">Daftar Talangan</span>
                {reimbursePendingCount > 0 && (
                  <SidebarMenuBadge className="ml-auto text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 rounded-md px-1.5 py-0.5 tabular-nums font-bold">
                    {reimbursePendingCount}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Belum Lunas (Tempo Supplier) */}
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "unpaid"}
                onClick={() => handleSelectTab("unpaid")}
                tooltip="Tagihan Belum Lunas & Tempo Terdekat"
                className={`h-9.5 rounded-xl font-medium ${
                  activeTab === "unpaid"
                    ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <CalendarClock className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span className="truncate">Belum Lunas</span>
                {unpaidCount > 0 && (
                  <SidebarMenuBadge className="ml-auto text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 rounded-md px-1.5 py-0.5 tabular-nums font-bold">
                    {unpaidCount}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            {onOpenAuditDuplicates && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => {
                    onOpenAuditDuplicates();
                    if (isMobile) setOpenMobile(false);
                  }}
                  tooltip="Audit Duplikat Data (90% nama + tanggal + nominal)"
                  className="h-9.5 rounded-xl font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                >
                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span className="truncate">Audit Duplikat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {canManageConfig && (
          <SidebarGroup className="mt-2">
            <SidebarGroupLabel className="text-[10px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider px-2">
              Pengaturan & Data
            </SidebarGroupLabel>
            <SidebarMenu className="gap-1 mt-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleOpenImport}
                  tooltip="Import Data CSV"
                  className="h-9.5 rounded-xl font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                >
                  <Upload className="w-4 h-4" />
                  <span className="truncate">Import CSV</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "config"}
                  onClick={() => handleSelectTab("config")}
                  tooltip="Konfigurasi Sistem"
                  className={`h-9.5 rounded-xl font-medium ${
                    activeTab === "config"
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  <span className="truncate">Konfigurasi Sistem</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Sidebar Footer */}
      <SidebarFooter className="p-3 border-t border-slate-200/80 dark:border-slate-800 space-y-3">
        {/* Real Budget Widget (when configured) */}
        {budgetLimitNumber > 0 && (
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 group-data-[collapsible=icon]:hidden space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Wallet className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Anggaran Bulan Ini</span>
              </div>
              <span className="font-bold tabular-nums text-slate-600 dark:text-slate-400">
                {safeBudgetPct.toFixed(0)}%
              </span>
            </div>
            <Progress value={safeBudgetPct} className="h-1.5" />
            <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span>{formatRupiah(totalPengeluaran)}</span>
              <span>Batas {formatRupiah(budgetLimitNumber)}</span>
            </div>
          </div>
        )}

        {/* User Account / Profile Menu */}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-slate-100 dark:data-[state=open]:bg-slate-800 rounded-xl"
                  tooltip={roleLabel}
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-semibold text-xs">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-xs leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {username || (userRole === "admin_input" ? "Admin Input" : "Owner")}
                    </span>
                    <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                      {roleLabel}
                    </span>
                  </div>
                  <ChevronUp className="ml-auto w-4 h-4 text-slate-500 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-56 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md p-1.5"
                align="end"
              >
                <DropdownMenuLabel className="px-2 py-1.5 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Akun Aktif
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    {roleLabel}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onToggleDarkMode}
                  className="cursor-pointer gap-2 rounded-lg text-xs"
                >
                  {isDarkMode ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-500" />
                      <span>Mode Terang</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-slate-600" />
                      <span>Mode Gelap</span>
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href={getHubUrl()}
                    className="flex cursor-pointer items-center gap-2 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Home className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Kembali ke HCTeams Hub</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="cursor-pointer gap-2 rounded-lg text-xs text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Keluar Akun</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
