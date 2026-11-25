import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Scale,
  BarChart3,
  Sparkles,
  ShieldAlert,
  Settings,
  Upload,
} from "lucide-react";

export type GovernanceSubTab = "accounting" | "laporan-umum" | "config";

export interface GovernanceHubViewProps {
  activeSubTab: GovernanceSubTab;
  onSubTabChange: (tab: GovernanceSubTab) => void;
  onOpenDataHygiene?: () => void;
  onOpenAuditDuplicates?: () => void;
  onOpenImport?: () => void;
  canManageConfig?: boolean;
  userRole?: string | null;
  children: React.ReactNode;
}

export const GovernanceHubView: React.FC<GovernanceHubViewProps> = ({
  activeSubTab,
  onSubTabChange,
  onOpenDataHygiene,
  onOpenAuditDuplicates,
  onOpenImport,
  canManageConfig = false,
  userRole,
  children,
}) => {
  const isOwner = !userRole || userRole === "admin";

  return (
    <div className="space-y-3.5">
      {/* Editorial Hairline Sub-Navigation & Owner Utilities */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[color:var(--ledger-hairline)]">
        <nav
          aria-label="Sub-navigasi laporan dan pengaturan"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar -mb-px"
        >
          {/* Tab 1: Laporan Akuntansi */}
          {isOwner && (
            <button
              type="button"
              onClick={() => onSubTabChange("accounting")}
              aria-current={activeSubTab === "accounting" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "accounting"
                  ? "border-blue-600 text-[var(--ledger-ink)] dark:border-blue-400"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <Scale className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Laporan Akuntansi</span>
            </button>
          )}

          {/* Tab 2: Laporan Umum */}
          {isOwner && (
            <button
              type="button"
              onClick={() => onSubTabChange("laporan-umum")}
              aria-current={activeSubTab === "laporan-umum" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "laporan-umum"
                  ? "border-emerald-600 text-[var(--ledger-ink)] dark:border-emerald-400"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <BarChart3 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Laporan Umum</span>
            </button>
          )}

          {/* Tab 3: Pengaturan Sistem */}
          {canManageConfig && (
            <button
              type="button"
              onClick={() => onSubTabChange("config")}
              aria-current={activeSubTab === "config" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "config"
                  ? "border-[var(--ledger-ink)] text-[var(--ledger-ink)]"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <Settings className="w-3.5 h-3.5 text-[var(--ledger-muted)]" />
              <span>Pengaturan Sistem</span>
            </button>
          )}
        </nav>

        {/* Quick Utility Buttons for Owner */}
        {isOwner && (
          <div className="flex items-center gap-1.5 pb-1.5 shrink-0 flex-wrap">
            {onOpenDataHygiene && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenDataHygiene}
                className="h-8 rounded-lg text-xs gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Rapikan Data</span>
              </Button>
            )}

            {onOpenAuditDuplicates && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenAuditDuplicates}
                className="h-8 rounded-lg text-xs gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Audit Duplikat</span>
              </Button>
            )}

            {onOpenImport && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenImport}
                className="h-8 rounded-lg text-xs gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <Upload className="w-3.5 h-3.5 text-[var(--ledger-muted)]" />
                <span>Import CSV</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="min-h-[450px]">
        {children}
      </div>
    </div>
  );
};
