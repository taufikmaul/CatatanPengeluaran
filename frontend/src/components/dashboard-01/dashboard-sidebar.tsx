import React from "react";
import {
  Upload,
  LogOut,
  Moon,
  Sun,
  ChevronUp,
  Wallet,
  Home,
  ShieldAlert,
  PackageCheck,
  ShoppingBag,
  Scale,
  MessageSquareText,
  ListChecks,
  X,
  type LucideIcon,
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
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatRupiah } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export type DashboardTab =
  | "overview"
  | "transactions"
  | "incoming"
  | "accounting"
  | "laporan-umum"
  | "master"
  | "menus"
  | "suppliers"
  | "supplier-detail"
  | "inventaris"
  | "tukar-cash-ongkir"
  | "talangan"
  | "unpaid"
  | "requests"
  | "approval"
  | "purchasing"
  | "gudang"
  | "config"
  | "ai-chat";

export type SelectableDashboardTab = Exclude<DashboardTab, "supplier-detail">;

export interface DashboardSidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: SelectableDashboardTab) => void;
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

interface SidebarNavItemConfig {
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  isActive?: boolean;
  badgeCount?: number;
  badgeTone?: "rose" | "amber";
  size?: "default" | "sm";
  onClick: () => void;
}

function SidebarTooltipBody({
  title,
  subtitle,
  badgeCount = 0,
  badgeTone = "rose",
}: {
  title: string;
  subtitle: string;
  badgeCount?: number;
  badgeTone?: "rose" | "amber";
}) {
  const pillClass =
    badgeTone === "amber"
      ? "bg-amber-700 text-white dark:bg-amber-500 dark:text-slate-950"
      : "bg-rose-600 text-white dark:bg-rose-500 dark:text-white";

  return (
    <div className="flex max-w-[220px] flex-col gap-0.5 py-0.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-popover-foreground">
          {title}
        </span>
        {badgeCount > 0 && (
          <span
            className={cn(
              "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums",
              pillClass
            )}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </div>
      <span className="text-[11px] leading-snug text-muted-foreground">
        {subtitle}
      </span>
    </div>
  );
}

function SidebarNavItem({ item }: { item: SidebarNavItemConfig }) {
  const Icon = item.icon;
  const badgeCount = item.badgeCount ?? 0;
  const formattedCount = badgeCount > 99 ? "99+" : String(badgeCount);

  const expandedBadgeClass =
    item.badgeTone === "amber"
      ? "bg-amber-100 text-amber-900 border border-amber-200/80 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-800/70"
      : "bg-rose-100 text-rose-800 border border-rose-200/80 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-800/70";

  const collapsedBadgeClass =
    item.badgeTone === "amber"
      ? "bg-amber-700 text-white dark:bg-amber-500 dark:text-slate-950"
      : "bg-rose-600 text-white dark:bg-rose-500 dark:text-white";

  return (
    <SidebarMenuItem>
      {/* Left spine indicator marks the active route in both expanded and collapsed rails */}
      {item.isActive && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-3 top-1/2 z-10 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-blue-600 dark:bg-blue-400"
        />
      )}

      <SidebarMenuButton
        size={item.size ?? "default"}
        isActive={Boolean(item.isActive)}
        onClick={item.onClick}
        aria-label={
          badgeCount > 0 ? `${item.label} (${badgeCount} perlu perhatian)` : item.label
        }
        tooltip={{
          children: (
            <SidebarTooltipBody
              title={item.label}
              subtitle={item.subtitle}
              badgeCount={badgeCount}
              badgeTone={item.badgeTone}
            />
          ),
        }}
        className={cn(
          "border max-md:h-11",
          item.size === "sm" ? "text-[13px]" : "text-[13.5px]",
          item.isActive
            ? "border-blue-200/90 bg-blue-50/90 font-semibold text-blue-700 shadow-[0_1px_2px_rgba(29,78,216,0.06)] hover:bg-blue-50 hover:text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-950/75 dark:hover:text-blue-200"
            : "border-transparent font-medium text-[var(--ledger-muted)] hover:bg-[var(--ledger-recessed)] hover:text-[var(--ledger-ink)]"
        )}
      >
        <Icon
          strokeWidth={item.isActive ? 2.1 : 1.8}
          className={cn(
            "transition-colors duration-150",
            item.isActive
              ? "text-blue-600 dark:text-blue-400"
              : "text-slate-500 group-hover/menu-item:text-[var(--ledger-ink)] dark:text-slate-400"
          )}
        />
        <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
          {item.label}
        </span>
        {badgeCount > 0 && (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-none group-data-[collapsible=icon]:hidden",
              expandedBadgeClass
            )}
          >
            {formattedCount}
          </span>
        )}
      </SidebarMenuButton>

      {/* Preserves pending counts when collapsed without overflowing the 40x40 tile */}
      {badgeCount > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -right-0.5 -top-1 z-20 hidden h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums leading-none ring-2 ring-[var(--ledger-surface)] group-data-[collapsible=icon]:flex",
            collapsedBadgeClass
          )}
        >
          {formattedCount}
        </span>
      )}
    </SidebarMenuItem>
  );
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
  unpaidCount = 0,
  reimbursePendingCount = 0,
  pendingApprovalCount = 0,
  purchasingReadyCount = 0,
  username,
  onLogout,
  isDarkMode,
  onToggleDarkMode,
}: DashboardSidebarProps) {
  const { setOpenMobile, isMobile, state } = useSidebar();
  const isCollapsedDesktop = state === "collapsed" && !isMobile;

  const handleSelectTab = (tab: SelectableDashboardTab) => {
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

  const homeTab: SelectableDashboardTab = isStaff
    ? "requests"
    : isWarehouse
    ? "gudang"
    : isPurchasing
    ? "purchasing"
    : "overview";

  const userInitials = (username || roleLabel || "HC")
    .slice(0, 2)
    .toUpperCase();

  const budgetLimitNumber = monthlyBudgetLimit || 0;
  const safeBudgetPct = Math.min(Math.max(budgetUsedPct || 0, 0), 100);

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

  const isGovernanceActive = ["accounting", "laporan-umum", "config"].includes(activeTab);

  const totalCashflowBadge = (unpaidCount || 0) + (reimbursePendingCount || 0);
  const totalProcurementBadge =
    (pendingApprovalCount || 0) + (purchasingReadyCount || 0);

  const operationalItems: SidebarNavItemConfig[] = [
    {
      id: "cashflow",
      label: "Kas & Pengeluaran",
      subtitle: "Transaksi, Tempo, Talangan, Kasir, Uang Masuk",
      icon: Wallet,
      isActive: isCashflowActive,
      badgeCount: totalCashflowBadge,
      badgeTone: "rose",
      onClick: () =>
        handleSelectTab(
          isCashflowActive ? (activeTab as SelectableDashboardTab) : "transactions"
        ),
    },
    {
      id: "procurement",
      label: "Alur Pengadaan",
      subtitle: "Pengajuan Staf, Approval Owner, PO, Gudang",
      icon: ShoppingBag,
      isActive: isProcurementActive,
      badgeCount: totalProcurementBadge,
      badgeTone: "amber",
      onClick: () =>
        handleSelectTab(
          isProcurementActive
            ? (activeTab as SelectableDashboardTab)
            : isOwner
            ? "approval"
            : isPurchasing
            ? "purchasing"
            : isWarehouse
            ? "gudang"
            : "requests"
        ),
    },
  ];

  const businessItems: SidebarNavItemConfig[] = [];
  if (isOwner || isPurchasing || isWarehouse || isAdminInput) {
    businessItems.push({
      id: "catalog",
      label: "Katalog & Margin",
      subtitle: "Item Bahan, Menu HPP, Supplier, Inventaris Aset",
      icon: PackageCheck,
      isActive: isCatalogActive,
      onClick: () =>
        handleSelectTab(
          isCatalogActive
            ? (activeTab as SelectableDashboardTab)
            : isWarehouse
            ? "inventaris"
            : "master"
        ),
    });

    if (isOwner || canManageConfig) {
      businessItems.push({
        id: "governance",
        label: "Laporan & Kontrol",
        subtitle: "Akuntansi SAK EMKM, Laporan Umum, Pengaturan",
        icon: Scale,
        isActive: isGovernanceActive,
        onClick: () =>
          handleSelectTab(
            isGovernanceActive
              ? (activeTab as SelectableDashboardTab)
              : isOwner
              ? "accounting"
              : "config"
          ),
      });
    }

    if (userRole === "admin") {
      businessItems.push({
        id: "ai-chat",
        label: "Asisten AI",
        subtitle: "Tanya data keuangan dan transaksi lewat chat",
        icon: MessageSquareText,
        isActive: activeTab === "ai-chat",
        onClick: () => handleSelectTab("ai-chat"),
      });
    }
  }

  const utilityItems: SidebarNavItemConfig[] = [];
  if (isOwner) {
    utilityItems.push({
      id: "import-csv",
      label: "Import CSV",
      subtitle: "Unggah mutasi atau daftar belanja massal",
      icon: Upload,
      size: "sm",
      onClick: handleOpenImport,
    });

    if (onOpenDataHygiene) {
      utilityItems.push({
        id: "data-hygiene",
        label: "Rapikan Data",
        subtitle: "Cek kesehatan dan standarisasi satuan transaksi",
        icon: ListChecks,
        size: "sm",
        onClick: () => {
          onOpenDataHygiene();
          if (isMobile) setOpenMobile(false);
        },
      });
    }

    if (onOpenAuditDuplicates) {
      utilityItems.push({
        id: "audit-duplicates",
        label: "Audit Duplikat",
        subtitle: "Deteksi entri ganda berdasarkan nama, tanggal, nominal",
        icon: ShieldAlert,
        size: "sm",
        onClick: () => {
          onOpenAuditDuplicates();
          if (isMobile) setOpenMobile(false);
        },
      });
    }
  }

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-[var(--ledger-hairline)]"
    >
      {/* Brand Header: exact h-16 (64px) height aligns hairline flush with DashboardHeader */}
      <SidebarHeader className="h-16 shrink-0 flex-row items-center justify-between gap-2 overflow-hidden border-b border-[var(--ledger-hairline)] bg-[var(--ledger-surface)] px-3 py-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => handleSelectTab(homeTab)}
              aria-label="Historycake Bakery, kembali ke beranda"
              className="group/brand ledger-press flex min-w-0 flex-1 items-center rounded-[10px] p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ledger-surface)] dark:focus-visible:ring-blue-400 group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:flex-none"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-rose-200/90 bg-rose-50 text-sm font-bold tracking-tight text-rose-700 transition-colors duration-150 select-none group-hover/brand:border-rose-300 group-hover/brand:bg-rose-100/80 dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-300 dark:group-hover/brand:border-rose-700">
                HC
              </div>
              <div className="ml-3 flex min-w-0 flex-1 flex-col overflow-hidden whitespace-nowrap transition-[opacity,margin] duration-150 group-data-[collapsible=icon]:hidden">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold tracking-tight text-[var(--ledger-ink)]">
                    Historycake
                  </span>
                  <Badge
                    variant="outline"
                    className="rounded-md border-rose-200 bg-rose-50/90 px-1.5 py-0 text-[10px] font-semibold text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-300"
                  >
                    Bakery
                  </Badge>
                </div>
                <span className="truncate text-[11px] font-medium text-[var(--ledger-muted)]">
                  Catatan Pengeluaran
                </span>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            sideOffset={16}
            hidden={!isCollapsedDesktop}
          >
            <SidebarTooltipBody
              title="Historycake Bakery"
              subtitle="Catatan Pengeluaran"
            />
          </TooltipContent>
        </Tooltip>

        {isMobile && (
          <button
            type="button"
            onClick={() => setOpenMobile(false)}
            aria-label="Tutup menu navigasi"
            className="ledger-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ledger-hairline)] text-[var(--ledger-muted)] hover:bg-[var(--ledger-recessed)] hover:text-[var(--ledger-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </SidebarHeader>

      {/* Main Navigation */}
      <SidebarContent className="gap-0 bg-[var(--ledger-surface)] px-3 py-3">
        {/* Group 1: Operasional & Keuangan */}
        <SidebarGroup>
          <SidebarGroupLabel className="mb-1">Operasional</SidebarGroupLabel>
          <SidebarMenu className="gap-1.5">
            {operationalItems.map((item) => (
              <SidebarNavItem key={item.id} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Group 2: Bisnis & Kontrol */}
        {businessItems.length > 0 && (
          <>
            <SidebarSeparator className="mx-auto my-2.5 hidden h-[1px] w-6 bg-slate-200/90 dark:bg-slate-800 group-data-[collapsible=icon]:block" />
            <SidebarGroup className="mt-5 group-data-[collapsible=icon]:mt-0">
              <SidebarGroupLabel className="mb-1">
                Bisnis &amp; Kontrol
              </SidebarGroupLabel>
              <SidebarMenu className="gap-1.5">
                {businessItems.map((item) => (
                  <SidebarNavItem key={item.id} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}

        {/* Group 3: Utilitas Data & Import */}
        {utilityItems.length > 0 && (
          <>
            <SidebarSeparator className="mx-auto my-2.5 hidden h-[1px] w-6 bg-slate-200/90 dark:bg-slate-800 group-data-[collapsible=icon]:block" />
            <SidebarGroup className="mt-5 group-data-[collapsible=icon]:mt-0">
              <SidebarGroupLabel className="mb-1">Utilitas</SidebarGroupLabel>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:gap-1.5">
                {utilityItems.map((item) => (
                  <SidebarNavItem key={item.id} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {/* Sidebar Footer */}
      <SidebarFooter className="shrink-0 gap-0 border-t border-[var(--ledger-hairline)] bg-[var(--ledger-surface)] p-3">
        {/* Real Budget Widget (when configured, expanded only) */}
        {budgetLimitNumber > 0 && (
          <div className="mb-3 space-y-2 rounded-xl border border-[var(--ledger-hairline)] bg-[var(--ledger-recessed)] p-3 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--ledger-ink)]">
                <Wallet className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Anggaran Bulan Ini</span>
              </div>
              <span className="font-bold tabular-nums text-slate-700 dark:text-slate-300">
                {safeBudgetPct.toFixed(0)}%
              </span>
            </div>
            <Progress value={safeBudgetPct} className="h-1.5" />
            <div className="flex items-center justify-between text-[11px] font-medium tabular-nums text-slate-600 dark:text-slate-300">
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
                  className="border border-transparent hover:bg-[var(--ledger-recessed)] data-[state=open]:border-[var(--ledger-hairline)] data-[state=open]:bg-[var(--ledger-recessed)] max-md:h-12"
                  tooltip={{
                    children: (
                      <SidebarTooltipBody
                        title={
                          username ||
                          (userRole === "admin_input" ? "Admin Input" : "Owner")
                        }
                        subtitle={`${roleLabel} · Menu akun & tema`}
                      />
                    ),
                  }}
                >
                  <Avatar className="h-8 w-8 shrink-0 rounded-lg border border-blue-200/80 dark:border-blue-800/70">
                    <AvatarFallback className="rounded-lg bg-blue-50 text-xs font-bold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left text-xs leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold text-[var(--ledger-ink)]">
                      {username ||
                        (userRole === "admin_input" ? "Admin Input" : "Owner")}
                    </span>
                    <span className="truncate text-[11px] text-[var(--ledger-muted)]">
                      {roleLabel}
                    </span>
                  </div>
                  <ChevronUp className="ml-auto h-4 w-4 text-[var(--ledger-muted)] group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isCollapsedDesktop ? "right" : "top"}
                sideOffset={isCollapsedDesktop ? 16 : 8}
                align="end"
                className="w-56 rounded-xl border border-[var(--ledger-hairline)] bg-popover p-1.5 shadow-lg"
              >
                <DropdownMenuLabel className="px-2 py-1.5 text-xs">
                  <div className="font-semibold text-[var(--ledger-ink)]">
                    Akun Aktif
                  </div>
                  <div className="text-[11px] font-normal text-[var(--ledger-muted)]">
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
                      <Sun className="h-4 w-4 text-amber-500" />
                      <span>Mode Terang</span>
                    </>
                  ) : (
                    <>
                      <Moon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      <span>Mode Gelap</span>
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href={getHubUrl()}
                    className="flex cursor-pointer items-center gap-2 rounded-lg text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Home className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span>Kembali ke HCTeams Hub</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="cursor-pointer gap-2 rounded-lg text-xs text-rose-700 focus:bg-rose-50 focus:text-rose-700 dark:text-rose-400 dark:focus:bg-rose-950/40"
                >
                  <LogOut className="h-4 w-4" />
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
