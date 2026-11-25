import React from "react";
import { cn } from "@/lib/utils";
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
    <div className="space-y-3.5">
      {/* Editorial Hairline Sub-Navigation */}
      <div className="border-b border-[color:var(--ledger-hairline)]">
        <nav
          aria-label="Sub-navigasi katalog dan margin"
          className="flex items-center gap-1 overflow-x-auto no-scrollbar -mb-px"
        >
          {/* Tab 1: Master Item Bahan */}
          {(isOwner || isPurchasing || isWarehouse) && (
            <button
              type="button"
              onClick={() => onSubTabChange("master")}
              aria-current={activeSubTab === "master" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "master"
                  ? "border-blue-600 text-[var(--ledger-ink)] dark:border-blue-400"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <PackageCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Item &amp; Satuan</span>
            </button>
          )}

          {/* Tab 2: Menu & Resep HPP */}
          {(isOwner || isPurchasing || isAdminInput) && (
            <button
              type="button"
              onClick={() => onSubTabChange("menus")}
              aria-current={activeSubTab === "menus" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "menus"
                  ? "border-[var(--signal-cleared)] text-[var(--ledger-ink)]"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <BookOpen className="w-3.5 h-3.5 text-[var(--signal-cleared)]" />
              <span>Menu &amp; Resep HPP</span>
            </button>
          )}

          {/* Tab 3: Master Supplier */}
          {(isOwner || isPurchasing) && (
            <button
              type="button"
              onClick={() => onSubTabChange("suppliers")}
              aria-current={isSupplierActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                isSupplierActive
                  ? "border-[var(--signal-dp)] text-[var(--ledger-ink)]"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <Store className="w-3.5 h-3.5 text-[var(--signal-dp)]" />
              <span>Supplier &amp; Toko</span>
            </button>
          )}

          {/* Tab 4: Inventaris Aset */}
          {(isOwner || isWarehouse || isAdminInput) && (
            <button
              type="button"
              onClick={() => onSubTabChange("inventaris")}
              aria-current={activeSubTab === "inventaris" ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                activeSubTab === "inventaris"
                  ? "border-[var(--signal-talangan)] text-[var(--ledger-ink)]"
                  : "border-transparent text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
              )}
            >
              <Boxes className="w-3.5 h-3.5 text-[var(--signal-talangan)]" />
              <span>Inventaris Aset</span>
            </button>
          )}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="min-h-0">
        {children}
      </div>
    </div>
  );
};
