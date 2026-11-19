import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PackageCheck,
  BookOpen,
  Store,
  Boxes,
} from "lucide-react";

export type CatalogSubTab = "master" | "menus" | "suppliers" | "supplier-detail" | "inventaris";

export interface CatalogHubViewProps {
  activeSubTab: CatalogSubTab;
  onSubTabChange: (tab: CatalogSubTab) => void;
  userRole?: string | null;
  children: React.ReactNode;
}

export const CatalogHubView: React.FC<CatalogHubViewProps> = ({
  activeSubTab,
  onSubTabChange,
  userRole,
  children,
}) => {
  const isPurchasing = userRole === "purchasing";
  const isWarehouse = userRole === "warehouse";
  const isOwner = !userRole || userRole === "admin";
  const isAdminInput = userRole === "admin_input";

  const isSupplierActive = activeSubTab === "suppliers" || activeSubTab === "supplier-detail";

  return (
    <div className="space-y-4">
      {/* Sub-Pills Navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-x-auto no-scrollbar">
        {/* Tab 1: Master Item Bahan */}
        {(isOwner || isPurchasing || isWarehouse) && (
          <Button
            variant={activeSubTab === "master" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("master")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "master"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <PackageCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Item &amp; Satuan</span>
          </Button>
        )}

        {/* Tab 2: Menu & Resep HPP */}
        {(isOwner || isPurchasing || isAdminInput) && (
          <Button
            variant={activeSubTab === "menus" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("menus")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "menus"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Menu &amp; Resep HPP</span>
          </Button>
        )}

        {/* Tab 3: Master Supplier */}
        {(isOwner || isPurchasing) && (
          <Button
            variant={isSupplierActive ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("suppliers")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              isSupplierActive
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <Store className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Supplier &amp; Toko</span>
          </Button>
        )}

        {/* Tab 4: Inventaris Aset */}
        {(isOwner || isWarehouse || isAdminInput) && (
          <Button
            variant={activeSubTab === "inventaris" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onSubTabChange("inventaris")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeSubTab === "inventaris"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>Inventaris Aset</span>
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
