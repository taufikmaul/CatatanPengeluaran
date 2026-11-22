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
  Sparkles,
  Store,
  HandCoins,
  CalendarClock,
  ShoppingBag,
  Scale,
  ArrowDownToLine,
  BookOpen,
  ShieldCheck,
  ShoppingBasket,
  Truck,
  Boxes,
  MessageSquareText,
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
  activeTab: "overview" | "transactions" | "incoming" | "accounting" | "master" | "menus" | "suppliers" | "supplier-detail" | "inventaris" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "requests" | "approval" | "purchasing" | "gudang" | "config" | "ai-chat";
  onTabChange: (tab: "overview" | "transactions" | "incoming" | "accounting" | "master" | "menus" | "suppliers" | "inventaris" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "requests" | "approval" | "purchasing" | "gudang" | "config" | "ai-chat") => void;
  onOpenImport: () => void;
  onOpenAuditDuplicates?: () => void;
  onOpenDataHygiene?: () => void;
  userRole?: string | null;
  canManageConfig?: boolean;
  monthlyBudgetLimit?: number | null;
  budgetUsedPct?: number | null;
  totalPengeluaran?: number;
  expenseCount?: number;
  unpaidCount?: number;
  reimbursePendingCount?: number;
  pendingApprovalCount?: number;
  purchasingReadyCount?: number;
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
  onOpenDataHygiene,
  userRole,
  canManageConfig = false,
  monthlyBudgetLimit,
  budgetUsedPct = 0,
  totalPengeluaran = 0,
  expenseCount = 0,
  unpaidCount = 0,
  reimbursePendingCount = 0,
  pendingApprovalCount = 0,
  purchasingReadyCount = 0,
  username,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
}: DashboardSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();

  const handleSelectTab = (tab: "overview" | "transactions" | "incoming" | "accounting" | "master" | "menus" | "suppliers" | "inventaris" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "requests" | "approval" | "purchasing" | "gudang" | "config" | "ai-chat") => {
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
    userRole === "staff"
      ? "Staf Dapur"
      : userRole === "purchasing"
      ? "Purchasing"
      : userRole === "warehouse"
      ? "Gudang"
      : userRole === "admin_input"
      ? "Admin Input"
      : "Owner / Admin Utama";

  const isStaff = userRole === "staff";
  const isWarehouse = userRole === "warehouse";
  const isPurchasing = userRole === "purchasing";
  const isAdminInput = userRole === "admin_input";
  const isOwner = !userRole || userRole === "admin";

  const userInitials = (username || roleLabel || "HC")
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

      {/* Main Navigation — 4 Core Hubs */}
      <SidebarContent className="px-2 py-3">
        {/* Hub Active State Calculations */}
        {(() => {
          const isCashflowActive = [
            "overview",
            "transactions",
            "incoming",
            "unpaid",
            "talangan",
            "tukar-cash-ongkir",
          ].includes(activeTab);

          const isProcurementActive = [
            "requests",
            "approval",
            "purchasing",
            "gudang",
          ].includes(activeTab);

          const isCatalogActive = [
            "master",
            "menus",
            "suppliers",
            "supplier-detail",
            "inventaris",
          ].includes(activeTab);

          const isGovernanceActive = [
            "accounting",
            "config",
          ].includes(activeTab);

          const totalCashflowBadge = (unpaidCount || 0) + (reimbursePendingCount || 0);
          const totalProcurementBadge = (pendingApprovalCount || 0) + (purchasingReadyCount || 0);

          return (
            <>
              {/* Group 1: Operasional & Keuangan */}
              <SidebarGroup>
                <SidebarGroupLabel className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wider px-2 mb-1">
                  Operasional
                </SidebarGroupLabel>
                <SidebarMenu className="gap-1">
                  {/* Hub 1: Kas & Pengeluaran */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isCashflowActive}
                      onClick={() =>
                        handleSelectTab(isCashflowActive ? (activeTab as any) : "transactions")
                      }
                      tooltip="Kas & Pengeluaran (Transaksi, Tempo, Talangan, Kasir & Kurir, Uang Masuk)"
                      className={`h-10 rounded-xl font-medium text-sm transition-all ${
                        isCashflowActive
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <Wallet className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span className="truncate">Kas &amp; Pengeluaran</span>
                      {totalCashflowBadge > 0 && (
                        <SidebarMenuBadge className="ml-auto text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 rounded px-1.5 py-0.5 tabular-nums font-bold">
                          {totalCashflowBadge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Hub 2: Alur Pengadaan */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isProcurementActive}
                      onClick={() =>
                        handleSelectTab(
                          isProcurementActive
                            ? (activeTab as any)
                            : isOwner
                            ? "approval"
                            : isPurchasing
                            ? "purchasing"
                            : isWarehouse
                            ? "gudang"
                            : "requests"
                        )
                      }
                      tooltip="Alur Pengadaan & Belanja (Pengajuan Staf, Approval Owner, Pemesanan PO, Penerimaan Gudang)"
                      className={`h-10 rounded-xl font-medium text-sm transition-all ${
                        isProcurementActive
                          ? "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-semibold"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <ShoppingBag className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="truncate">Alur Pengadaan</span>
                      {totalProcurementBadge > 0 && (
                        <SidebarMenuBadge className="ml-auto text-[10px] bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 rounded px-1.5 py-0.5 tabular-nums font-bold">
                          {totalProcurementBadge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>

              {/* Group 2: Bisnis & Manajemen */}
              {(isOwner || isPurchasing || isWarehouse || isAdminInput) && (
                <SidebarGroup className="mt-3">
                  <SidebarGroupLabel className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wider px-2 mb-1">
                    Bisnis &amp; Kontrol
                  </SidebarGroupLabel>
                  <SidebarMenu className="gap-1">
                    {/* Hub 3: Katalog & Margin */}
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={isCatalogActive}
                        onClick={() =>
                          handleSelectTab(
                            isCatalogActive
                              ? (activeTab as any)
                              : isWarehouse
                              ? "inventaris"
                              : "master"
                          )
                        }
                        tooltip="Katalog & Margin Bisnis (Item Bahan, Menu HPP, Supplier, Inventaris Aset)"
                        className={`h-10 rounded-xl font-medium text-sm transition-all ${
                          isCatalogActive
                            ? "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 font-semibold"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <PackageCheck className="w-4 h-4 shrink-0 text-purple-600 dark:text-purple-400" />
                        <span className="truncate">Katalog &amp; Margin</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    {/* Hub 4: Laporan & Kontrol (Owner, Admin Input) */}
                    {(isOwner || canManageConfig) && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={isGovernanceActive}
                          onClick={() =>
                            handleSelectTab(
                              isGovernanceActive
                                ? (activeTab as any)
                                : isOwner
                                ? "accounting"
                                : "config"
                            )
                          }
                          tooltip="Laporan & Kontrol Manajemen (Akuntansi SAK EMKM, AI Insight, Pengaturan)"
                          className={`h-10 rounded-xl font-medium text-sm transition-all ${
                            isGovernanceActive
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 font-semibold"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                        >
                          <Scale className="w-4 h-4 shrink-0 text-slate-700 dark:text-slate-300" />
                          <span className="truncate">Laporan &amp; Kontrol</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}

                    {/* Asisten AI Keuangan (Khusus Owner) */}
                    {userRole === "admin" && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={activeTab === "ai-chat"}
                          onClick={() => handleSelectTab("ai-chat")}
                          tooltip="Asisten AI Keuangan (Tanya data keuangan via chat)"
                          className={`h-10 rounded-xl font-medium text-sm transition-all ${
                            activeTab === "ai-chat"
                              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 font-semibold"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                        >
                          <MessageSquareText className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                          <span className="truncate">Asisten AI</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SidebarGroup>
              )}

              {/* Group 3: Utilitas Data & Import */}
              {isOwner && (
                <SidebarGroup className="mt-3">
                  <SidebarGroupLabel className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wider px-2 mb-1">
                    Utilitas
                  </SidebarGroupLabel>
                  <SidebarMenu className="gap-0.5">
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={handleOpenImport}
                        tooltip="Import Data CSV"
                        className="h-8 rounded-lg font-medium text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      >
                        <Upload className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="truncate">Import CSV</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    {onOpenDataHygiene && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          onClick={() => {
                            onOpenDataHygiene();
                            if (isMobile) setOpenMobile(false);
                          }}
                          tooltip="Cek kesehatan & rapikan data transaksi secara otomatis"
                          className="h-8 rounded-lg font-medium text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        >
                          <Sparkles className="w-3.5 h-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
                          <span className="truncate">Rapikan Data</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}

                    {onOpenAuditDuplicates && (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          onClick={() => {
                            onOpenAuditDuplicates();
                            if (isMobile) setOpenMobile(false);
                          }}
                          tooltip="Audit Duplikat Data (90% nama + tanggal + nominal)"
                          className="h-8 rounded-lg font-medium text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        >
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
                          <span className="truncate">Audit Duplikat</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SidebarGroup>
              )}
            </>
          );
        })()}
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
