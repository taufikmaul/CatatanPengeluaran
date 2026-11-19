import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag,
  ShieldCheck,
  ShoppingBasket,
  Truck,
  Plus,
  ArrowRight,
  CheckCircle2,
  Clock,
  Package,
} from "lucide-react";

export type ProcurementStage = "requests" | "approval" | "purchasing" | "gudang";

export interface UnifiedProcurementHubProps {
  activeStage: ProcurementStage;
  onStageChange: (stage: ProcurementStage) => void;
  onOpenCreateRequest?: () => void;
  pendingApprovalCount?: number;
  purchasingReadyCount?: number;
  userRole?: string | null;
  children: React.ReactNode;
}

export const UnifiedProcurementHub: React.FC<UnifiedProcurementHubProps> = ({
  activeStage,
  onStageChange,
  onOpenCreateRequest,
  pendingApprovalCount = 0,
  purchasingReadyCount = 0,
  userRole,
  children,
}) => {
  const isStaff = userRole === "staff";
  const isWarehouse = userRole === "warehouse";
  const isPurchasing = userRole === "purchasing";
  const isOwner = !userRole || userRole === "admin";
  const isAdminInput = userRole === "admin_input";

  return (
    <div className="space-y-4">
      {/* Header Hub */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/40">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Alur Pengadaan &amp; Belanja
              </h1>
              <Badge variant="outline" className="text-[10px] font-semibold text-amber-800 bg-amber-50/60 dark:bg-amber-950/30 dark:text-amber-300 border-amber-200 dark:border-amber-900">
                Unified Pipeline
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pantau siklus barang: Permintaan staf dapur ➔ Approval owner ➔ Order supplier (PO) ➔ Cek fisik gudang
            </p>
          </div>
        </div>

        {/* Quick Action Button */}
        {onOpenCreateRequest && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={onOpenCreateRequest}
              size="sm"
              className="h-9 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs gap-1.5 text-xs px-3.5"
            >
              <Plus className="w-4 h-4" />
              <span>Minta Belanja Baru</span>
            </Button>
          </div>
        )}
      </div>

      {/* Stepper Pipeline Navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800 rounded-2xl overflow-x-auto no-scrollbar">
        {/* Step 1: Pengajuan Staf */}
        <Button
          variant={activeStage === "requests" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onStageChange("requests")}
          className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
            activeStage === "requests"
              ? "bg-white dark:bg-slate-800 text-amber-800 dark:text-amber-300 shadow-xs"
              : "text-slate-600 dark:text-slate-400 hover:text-amber-700 hover:bg-white/60 dark:hover:bg-slate-800/50"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold dark:bg-amber-900/60 dark:text-amber-300">
            1
          </span>
          <span>Pengajuan Belanja</span>
        </Button>

        <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700 shrink-0 hidden md:block" />

        {/* Step 2: Approval Belanja */}
        {(isOwner || isAdminInput) && (
          <>
            <Button
              variant={activeStage === "approval" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onStageChange("approval")}
              className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
                activeStage === "approval"
                  ? "bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-emerald-700 hover:bg-white/60 dark:hover:bg-slate-800/50"
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold dark:bg-emerald-900/60 dark:text-emerald-300">
                2
              </span>
              <span>Approval Owner</span>
              {pendingApprovalCount > 0 && (
                <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-amber-500 text-white font-bold rounded-full">
                  {pendingApprovalCount}
                </Badge>
              )}
            </Button>

            <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700 shrink-0 hidden md:block" />
          </>
        )}

        {/* Step 3: Pemesanan Supplier (Purchasing Orders) */}
        {(isOwner || isPurchasing || isAdminInput) && (
          <>
            <Button
              variant={activeStage === "purchasing" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onStageChange("purchasing")}
              className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
                activeStage === "purchasing"
                  ? "bg-white dark:bg-slate-800 text-blue-800 dark:text-blue-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-blue-700 hover:bg-white/60 dark:hover:bg-slate-800/50"
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold dark:bg-blue-900/60 dark:text-blue-300">
                3
              </span>
              <span>Pemesanan (PO)</span>
              {purchasingReadyCount > 0 && (
                <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-emerald-500 text-white font-bold rounded-full">
                  {purchasingReadyCount}
                </Badge>
              )}
            </Button>

            <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700 shrink-0 hidden md:block" />
          </>
        )}

        {/* Step 4: Penerimaan Gudang */}
        {(isOwner || isWarehouse || isAdminInput) && (
          <Button
            variant={activeStage === "gudang" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onStageChange("gudang")}
            className={`h-9 rounded-xl text-xs font-semibold gap-1.5 shrink-0 transition-all ${
              activeStage === "gudang"
                ? "bg-white dark:bg-slate-800 text-purple-800 dark:text-purple-300 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-purple-700 hover:bg-white/60 dark:hover:bg-slate-800/50"
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-purple-800 text-[10px] font-bold dark:bg-purple-900/60 dark:text-purple-300">
              4
            </span>
            <span>Terima di Gudang</span>
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
