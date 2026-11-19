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
    <div className="space-y-4">
      {/* Header Hub */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Laporan &amp; Kontrol Manajemen
              </h1>
              <Badge variant="outline" className="text-[10px] font-semibold text-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700">
                Audit &amp; Kepatuhan
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Laporan keuangan standar SAK EMKM, audit data duplikat, perapian data otomatis, dan konfigurasi sistem
            </p>
          </div>
        </div>

        {/* Quick Utility Buttons for Owner */}
        {isOwner && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {onOpenDataHygiene && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenDataHygiene}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
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
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
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
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-500" />
                <span>Import CSV</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Sub-Pills Navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800 rounded-2xl overflow-x-auto no-scrollbar">
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

      {/* Main Content Area */}
      <div className="min-h-[450px]">
        {children}
      </div>
    </div>
  );
};
