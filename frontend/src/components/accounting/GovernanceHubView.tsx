import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Scale,
  Sparkles,
  ShieldAlert,
  Settings,
  Upload,
} from "lucide-react";

export type GovernanceSubTab = "accounting" | "config";

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
    <div className="space-y-3">
      {/* Sub-Pills Navigation & Owner Utilities */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-x-auto no-scrollbar">
          {/* Tab 1: Laporan Akuntansi */}
          {isOwner && (
            <Button
              variant={activeSubTab === "accounting" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onSubTabChange("accounting")}
              className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
                activeSubTab === "accounting"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
              }`}
            >
              <Scale className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Laporan Akuntansi</span>
            </Button>
          )}

          {/* Tab 2: Pengaturan Sistem */}
          {canManageConfig && (
            <Button
              variant={activeSubTab === "config" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onSubTabChange("config")}
              className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
                activeSubTab === "config"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
              }`}
            >
              <Settings className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
              <span>Pengaturan Sistem</span>
            </Button>
          )}
        </div>

        {/* Quick Utility Buttons for Owner */}
        {isOwner && (
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {onOpenDataHygiene && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenDataHygiene}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span>Rapikan Data</span>
              </Button>
            )}

            {onOpenAuditDuplicates && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenAuditDuplicates}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                <span>Audit Duplikat</span>
              </Button>
            )}

            {onOpenImport && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenImport}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                <Upload className="w-3.5 h-3.5 text-slate-500" />
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
