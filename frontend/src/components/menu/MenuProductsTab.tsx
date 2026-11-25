import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  anonymizeAllMenus,
  api,
  bulkCreateMenus,
  bulkUpdateMenus,
  cloneMenu,
  createMenu,
  createMenuShareToken,
  deleteMenu,
  downloadMenusCsv,
  downloadMenusJson,
  downloadMenusTemplateCsv,
  getMasterData,
  getMenuPricingChannels,
  getMenuUsages,
  getMenus,
  getMenusJsonPayload,
  importMenusCsv,
  importMenusFromPos,
  setMenuAnonymizeLock,
  updateMenu,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  FoodCostStatus,
  MasterItem,
  MenuHppMode,
  MenuItemType,
  MenuProduct,
  MenuProductPayload,
  SubMenuBreakdownItem,
} from "@/types";
import { MenuFormDialog } from "./MenuFormDialog";
import { PriceSimulatorDialog } from "./PriceSimulatorDialog";
import { CloneScaleDialog } from "./CloneScaleDialog";
import { PricingChannelsDialog } from "./PricingChannelsDialog";
import { MenuCategoriesDialog } from "./MenuCategoriesDialog";
import {
  BulkRowImportDialog,
  type BulkRowColumn,
} from "@/components/common/BulkRowImportDialog";
import { DataTable } from "@/components/common/DataTable";
import {
  LedgerMetricStrip,
  LedgerStateBlock,
  LedgerStatusTabs,
} from "@/components/common/LedgerPrimitives";
import {
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef, PaginationState, useTable } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  Layers,
  Link2,
  Loader2,
  Lock,
  Package,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Table2,
  Tags,
  Trash2,
  TrendingUp,
  Unlock,
  Upload,
  X,
} from "lucide-react";

interface MenuProductsTabProps {
  isAdmin: boolean;
  units: string[];
}

interface QuickEditRow {
  selling_price: string;
  hpp_manual: string;
  hpp_mode: MenuHppMode;
  is_active: boolean;
}

const PAGE_SIZE = 25;

function getFoodCostBadge(status: FoodCostStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "ideal":
      return {
        label: "Ideal",
        className:
          "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "moderate":
      return {
        label: "Sedang",
        className:
          "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
      };
    case "high":
      return {
        label: "Tinggi",
        className:
          "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
      };
    case "not_sellable":
      return {
        label: "Internal (Prepared)",
        className:
          "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
      };
    case "no_price":
      return {
        label: "Belum Ada Harga",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
    default:
      return {
        label: "Belum Ada HPP",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

function getItemTypeMeta(itemType: MenuItemType): {
  label: string;
  className: string;
} {
  if (itemType === "prepared") {
    return {
      label: "Prepared",
      className:
        "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
    };
  }
  if (itemType === "bundle") {
    return {
      label: "Bundling",
      className:
        "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800",
    };
  }
  return {
    label: "Menu Jual",
    className:
      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  };
}

interface MenuItemBadgesProps {
  menu: MenuProduct;
  effectiveAnonymized: boolean;
  onOpenUsages: (menu: MenuProduct) => void;
}

const MenuItemBadges: React.FC<MenuItemBadgesProps> = ({
  menu,
  effectiveAnonymized,
  onOpenUsages,
}) => {
  const typeMeta = getItemTypeMeta(menu.item_type || "finished");
  return (
    <>
      {menu.item_type && menu.item_type !== "finished" && (
        <Badge variant="outline" className={`text-[10px] ${typeMeta.className}`}>
          {typeMeta.label}
        </Badge>
      )}
      {menu.item_type === "prepared" && menu.is_sellable && (
        <Badge
          variant="outline"
          className="text-[10px] bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800"
        >
          Jual Langsung
        </Badge>
      )}
      {!effectiveAnonymized && (
        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
          {menu.anonymous_name}
        </span>
      )}
      {(menu.used_in_count || 0) > 0 && (
        <button
          type="button"
          onClick={() => onOpenUsages(menu)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          title="Lihat resep yang memakai item ini"
        >
          <Layers className="w-2.5 h-2.5" />
          <span>Dipakai di {menu.used_in_count} resep</span>
        </button>
      )}
      {!menu.is_active && (
        <Badge variant="outline" className="text-[10px] text-slate-600">
          Nonaktif
        </Badge>
      )}
      {menu.has_price_drift && (
        <Badge
          variant="outline"
          className="text-[10px] bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 gap-1"
        >
          <TrendingUp className="w-3 h-3" />
          Bahan +{menu.max_ingredient_increase_pct}%
        </Badge>
      )}
    </>
  );
};

function renderSubBreakdownTree(
  rows: SubMenuBreakdownItem[],
  depth = 1
): React.ReactNode {
  if (!rows || rows.length === 0) return null;
  return (
    <div
      className="mt-1 space-y-1 border-l-2 border-amber-300 dark:border-amber-700 pl-2.5"
      style={{ marginLeft: depth > 1 ? 8 : 4 }}
    >
      {rows.map((sub, idx) => (
        <div key={`${sub.id || idx}-${depth}`} className="space-y-0.5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{sub.ingredient_name}</span>
              {sub.cost_group === "packaging" && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                >
                  Kemasan
                </Badge>
              )}
              {sub.sub_menu_id != null && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300"
                >
                  Sub-Resep
                </Badge>
              )}
              <span className="text-slate-600 dark:text-slate-400">
                {sub.qty} {sub.unit}
                {sub.yield_factor !== 1 ? ` (/${sub.yield_factor})` : ""}
              </span>
              {sub.price_drift_alert && sub.price_change_pct != null && (
                <span className="text-[10px] font-medium text-rose-700 dark:text-rose-400">
                  +{sub.price_change_pct}%
                </span>
              )}
            </div>
            <span className="tabular-nums font-medium shrink-0">
              {formatRupiah(sub.line_cost || 0)}
            </span>
          </div>
          {sub.sub_menu_breakdown &&
            sub.sub_menu_breakdown.length > 0 &&
            renderSubBreakdownTree(sub.sub_menu_breakdown, depth + 1)}
        </div>
      ))}
    </div>
  );
}

interface MenuExpandedRecipePanelProps {
  menu: MenuProduct;
  expandedSubIds: Record<string, boolean>;
  onToggleSub: (key: string) => void;
}

const MenuExpandedRecipePanel: React.FC<MenuExpandedRecipePanelProps> = ({
  menu,
  expandedSubIds,
  onToggleSub,
}) => {
  const ingredientRows = (menu.ingredients || []).filter(
    (i) => i.cost_group !== "packaging"
  );
  const packagingRows = (menu.ingredients || []).filter(
    (i) => i.cost_group === "packaging"
  );
  const hasBatchMeta =
    (menu.batch_yield_qty || 1) !== 1 ||
    (menu.waste_loss_pct || 0) > 0 ||
    menu.shelf_life_days != null ||
    Boolean(menu.storage_method);

  return (
    <div className="space-y-3 text-[11px]">
      {hasBatchMeta && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-700 dark:text-slate-300">
          <span>
            Hasil Batch: <strong>{menu.batch_yield_qty} {menu.batch_yield_unit}</strong>
          </span>
          {(menu.waste_loss_pct || 0) > 0 && (
            <span>
              | Susut {menu.waste_loss_pct}% (Bersih: {menu.net_yield_qty}{" "}
              {menu.batch_yield_unit})
            </span>
          )}
          {menu.shelf_life_days != null && (
            <span>| Masa simpan: {menu.shelf_life_days} hari</span>
          )}
          {menu.storage_method && <span>| Simpan: {menu.storage_method}</span>}
        </div>
      )}

      {/* 1. Bahan Resep / Sub-Resep */}
      <div className="space-y-1.5">
        <div className="font-semibold text-slate-800 dark:text-slate-200 flex flex-wrap items-center justify-between gap-2">
          <span>
            Bahan Resep / Isi Produk ({ingredientRows.length} item)
          </span>
          <span className="text-slate-600 dark:text-slate-400 font-normal tabular-nums">
            Per unit: {formatRupiah(menu.subtotal_ingredients ?? 0)}
            {(menu.batch_yield_qty || 1) !== 1 && menu.raw_batch_ingredients != null
              ? ` (Batch: ${formatRupiah(menu.raw_batch_ingredients)})`
              : ""}
          </span>
        </div>

        {ingredientRows.length === 0 ? (
          <div className="text-slate-600 dark:text-slate-400 italic">
            Tidak ada bahan makanan.
          </div>
        ) : (
          <div className="space-y-1.5">
            {ingredientRows.map((ing, idx) => {
              const subKey = `${menu.id}-${ing.id || idx}`;
              const hasBreakdown =
                Array.isArray(ing.sub_menu_breakdown) &&
                ing.sub_menu_breakdown.length > 0;
              const isSubOpen = !!expandedSubIds[subKey];

              return (
                <div
                  key={ing.id || idx}
                  className="border-b border-slate-200/70 dark:border-slate-800 pb-1.5 last:border-0"
                >
                  <div className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-300">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      {hasBreakdown && (
                        <button
                          type="button"
                          onClick={() => onToggleSub(subKey)}
                          aria-expanded={isSubOpen}
                          aria-label={`Rincian sub-resep ${ing.ingredient_name}`}
                          className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-amber-800 dark:text-amber-300"
                        >
                          {isSubOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <span className="font-medium">{ing.ingredient_name}</span>
                      {ing.sub_menu_id != null && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 gap-1"
                        >
                          <Layers className="w-2.5 h-2.5" />
                          <span>Sub-Resep</span>
                        </Badge>
                      )}
                      <span className="text-slate-600 dark:text-slate-400">
                        {ing.qty} {ing.unit}
                        {ing.yield_factor !== 1 ? ` (pembagi ${ing.yield_factor})` : ""}
                        {(ing.waste_pct || 0) > 0 ? ` (susut ${ing.waste_pct}%)` : ""}
                      </span>
                      {ing.price_drift_alert && ing.price_change_pct != null && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 text-[10px] font-medium">
                          <TrendingUp className="w-3 h-3" />
                          Naik +{ing.price_change_pct}%
                          {ing.drift_source ? ` (via ${ing.drift_source})` : ""}
                        </span>
                      )}
                    </div>
                    <div className="tabular-nums font-medium shrink-0">
                      {formatRupiah(ing.line_cost || 0)}
                    </div>
                  </div>
                  {hasBreakdown &&
                    isSubOpen &&
                    renderSubBreakdownTree(ing.sub_menu_breakdown || [])}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Kemasan & Packaging */}
      {packagingRows.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-dashed border-amber-300 dark:border-amber-800">
          <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" />
              <span>Kemasan &amp; Packaging ({packagingRows.length} item)</span>
            </span>
            <span className="tabular-nums">
              {formatRupiah(menu.subtotal_packaging ?? 0)}
            </span>
          </div>
          <div className="space-y-1">
            {packagingRows.map((pkg, idx) => (
              <div
                key={pkg.id || idx}
                className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-300"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{pkg.ingredient_name}</span>
                  <span className="text-slate-600 dark:text-slate-400">
                    {pkg.qty} {pkg.unit}
                    {pkg.yield_factor !== 1 ? ` (pembagi ${pkg.yield_factor})` : ""}
                  </span>
                  {pkg.price_drift_alert && pkg.price_change_pct != null && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 text-[10px] font-medium">
                      Naik +{pkg.price_change_pct}%
                    </span>
                  )}
                </div>
                <span className="tabular-nums font-medium shrink-0">
                  {formatRupiah(pkg.line_cost || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Labor & Biaya Operasional Batch (Multi-Komponen) */}
      {((menu.batch_cost_items && menu.batch_cost_items.length > 0) ||
        (menu.labor_cost || 0) > 0 ||
        (menu.other_fee || 0) > 0) && (
        <div className="space-y-1.5 pt-2 border-t border-dashed border-slate-300 dark:border-slate-700">
          <div className="font-semibold text-slate-800 dark:text-slate-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              Tenaga Kerja (Labor) &amp; Biaya Operasional Batch
              {menu.batch_cost_items && menu.batch_cost_items.length > 0
                ? ` (${menu.batch_cost_items.length} komponen)`
                : ""}
            </span>
            <span className="text-slate-600 dark:text-slate-400 font-normal tabular-nums">
              Per unit:{" "}
              {formatRupiah(
                (menu.unit_labor_cost ?? menu.labor_cost ?? 0) +
                  (menu.unit_other_fee ?? menu.other_fee ?? 0)
              )}
              {(menu.batch_yield_qty || 1) !== 1
                ? ` (Batch: ${formatRupiah(
                    (menu.labor_cost || 0) + (menu.other_fee || 0)
                  )})`
                : ""}
            </span>
          </div>

          {menu.batch_cost_items && menu.batch_cost_items.length > 0 ? (
            <div className="space-y-1">
              {menu.batch_cost_items.map((bc, idx) => (
                <div
                  key={`${bc.category}-${idx}`}
                  className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-300"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={
                        bc.category === "labor"
                          ? "text-[9px] px-1.5 py-0 bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800"
                          : "text-[9px] px-1.5 py-0 bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                      }
                    >
                      {bc.category === "labor" ? "Labor" : "Operasional"}
                    </Badge>
                    <span className="font-medium">{bc.name}</span>
                    {(menu.batch_yield_qty || 1) !== 1 && (
                      <span className="text-slate-600 dark:text-slate-400">
                        (batch {formatRupiah(bc.amount || 0)})
                      </span>
                    )}
                  </div>
                  <span className="tabular-nums font-medium shrink-0">
                    {formatRupiah(bc.unit_amount ?? bc.amount ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {(menu.labor_cost || 0) > 0 && (
                <div className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-300 font-medium">
                  <span>
                    + Tenaga Kerja (Labor)
                    {(menu.batch_yield_qty || 1) !== 1 ? " per unit" : ""}
                  </span>
                  <span className="tabular-nums font-semibold">
                    {formatRupiah(menu.unit_labor_cost ?? menu.labor_cost ?? 0)}
                  </span>
                </div>
              )}
              {(menu.other_fee || 0) > 0 && (
                <div className="flex items-center justify-between gap-2 text-amber-800 dark:text-amber-300 font-medium">
                  <span>
                    + Biaya Lainnya
                    {menu.other_fee_description
                      ? ` (${menu.other_fee_description})`
                      : ""}
                  </span>
                  <span className="tabular-nums font-semibold">
                    {formatRupiah(menu.unit_other_fee ?? menu.other_fee ?? 0)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const MenuProductsTab: React.FC<MenuProductsTabProps> = ({
  isAdmin,
  units,
}) => {
  const queryClient = useQueryClient();

  const [anonymizeMode, setAnonymizeMode] = useState(false);
  const [itemTypeFilter, setItemTypeFilter] = useState<"all" | MenuItemType>("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [hppStatusFilter, setHppStatusFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [expandedSubIds, setExpandedSubIds] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Quick-edit massal state
  const [quickEditMode, setQuickEditMode] = useState(false);
  const [quickEdits, setQuickEdits] = useState<Record<number, QuickEditRow>>({});

  // Modal states
  const [formOpen, setFormOpen] = useState(false);
  const [defaultFormItemType, setDefaultFormItemType] =
    useState<MenuItemType>("finished");
  const [editingMenu, setEditingMenu] = useState<MenuProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuProduct | null>(null);
  const [cloneTarget, setCloneTarget] = useState<MenuProduct | null>(null);
  const [usageTarget, setUsageTarget] = useState<MenuProduct | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [pendingCategorySelection, setPendingCategorySelection] = useState<
    string | null
  >(null);

  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [bulkFormOpen, setBulkFormOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  type BulkMenuRow = {
    name: string;
    sku: string;
    category: string;
    product_group: string;
    unit: string;
    selling_price: number;
    hpp_manual: number;
    hpp_mode: MenuHppMode;
    notes: string;
    is_active: boolean;
  };

  const [updateExistingCsv, setUpdateExistingCsv] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [anonymizeDialogOpen, setAnonymizeDialogOpen] = useState(false);
  const [anonPrefix, setAnonPrefix] = useState("MENU");
  const [preserveCustomAnon, setPreserveCustomAnon] = useState(false);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareExpireHours, setShareExpireHours] = useState(24);
  const [generatedShareUrl, setGeneratedShareUrl] = useState("");

  const {
    data: menuRes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [
      "menus",
      { search, categoryFilter, hppStatusFilter, itemTypeFilter, anonymizeMode },
    ],
    queryFn: () =>
      getMenus({
        search: search.trim() || undefined,
        category: categoryFilter !== "all" ? categoryFilter : undefined,
        hpp_status: hppStatusFilter !== "all" ? hppStatusFilter : undefined,
        item_type: itemTypeFilter !== "all" ? itemTypeFilter : undefined,
        anonymize: anonymizeMode,
      }),
  });

  const { data: menuCategories = [] } = useQuery({
    queryKey: ["menu-categories"],
    queryFn: () => getMasterData("kategori_menu"),
  });

  const { data: masterItemsRes } = useQuery<{ ok: boolean; data: MasterItem[] }>({
    queryKey: ["master-items"],
    queryFn: async () => (await api.get("/master-items")).data,
    enabled: formOpen || simulatorOpen,
  });

  const { data: allMenusRes } = useQuery({
    queryKey: ["menus-all-for-recipe"],
    queryFn: () => getMenus({ anonymize: false }),
    enabled: formOpen,
  });

  const { data: pricingChannelsRes } = useQuery({
    queryKey: ["menu-pricing-channels"],
    queryFn: () => getMenuPricingChannels(),
    enabled: formOpen || channelSettingsOpen,
  });

  const isLockedReadOnly = !!menuRes?.anonymize_locked;
  const effectiveAnonymized =
    isLockedReadOnly || !!menuRes?.anonymized || anonymizeMode;

  const {
    data: usagesRes,
    isLoading: usagesLoading,
    isError: usagesError,
    refetch: refetchUsages,
  } = useQuery({
    queryKey: ["menu-usages", usageTarget?.id, effectiveAnonymized],
    queryFn: () => getMenuUsages(usageTarget!.id, effectiveAnonymized),
    enabled: !!usageTarget,
  });

  const masterItems = masterItemsRes?.data || [];
  const items = menuRes?.items || [];
  const allMenusForRecipe = allMenusRes?.items || items;
  const pricingChannels = pricingChannelsRes?.channels || [];
  const summary = menuRes?.summary;
  const categories = useMemo(() => {
    const activeMaster = [...menuCategories]
      .filter((c) => c.is_active)
      .sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.name.localeCompare(b.name, "id")
      )
      .map((c) => c.name);
    const seen = new Set(activeMaster.map((n) => n.toLowerCase()));
    const merged = [...activeMaster];
    for (const cat of menuRes?.categories || []) {
      if (cat && !seen.has(cat.toLowerCase())) {
        seen.add(cat.toLowerCase());
        merged.push(cat);
      }
    }
    return merged;
  }, [menuCategories, menuRes?.categories]);

  const menuUnitOptions = Array.from(
    new Set(["Porsi", "Cup", "Box", "Pcs", "Pack", "Gram", "Paket", ...units])
  ).map((u) => ({ value: u, label: u }));

  const menuCategoryOptions = useMemo(() => {
    const base =
      categories.length > 0
        ? categories
        : [
            "Cake Ready",
            "Custom Cake",
            "Slice & Dessert Box",
            "Pastry & Bakery",
            "Minuman",
            "Prepared / Sub-Resep",
            "Hampers / Bundling",
            "Lainnya",
          ];
    return base.map((c) => ({ value: c, label: c }));
  }, [categories]);

  const defaultBulkCategory =
    menuCategories.find((c) => c.is_active && c.is_default)?.name ||
    menuCategoryOptions[0]?.value ||
    "Cake Ready";

  const menuBulkColumns: BulkRowColumn<BulkMenuRow>[] = [
    { key: "name", label: "Nama Menu *", type: "text", required: true, placeholder: "Kopi Susu Gula Aren", widthClass: "min-w-[180px]" },
    { key: "sku", label: "SKU / Kode", type: "text", placeholder: "KSGA-01", widthClass: "min-w-[110px]" },
    { key: "category", label: "Kategori", type: "select", widthClass: "min-w-[150px]", options: menuCategoryOptions },
    { key: "product_group", label: "Grup Produk", type: "text", placeholder: "Signature", widthClass: "min-w-[120px]" },
    { key: "unit", label: "Satuan", type: "select", widthClass: "min-w-[100px]", options: menuUnitOptions },
    { key: "selling_price", label: "Harga Jual (Rp)", type: "number", min: 0, widthClass: "min-w-[130px]" },
    { key: "hpp_manual", label: "HPP Manual (Rp)", type: "number", min: 0, widthClass: "min-w-[130px]" },
    {
      key: "hpp_mode",
      label: "Mode HPP",
      type: "select",
      widthClass: "min-w-[110px]",
      options: [
        { value: "manual", label: "Manual" },
        { value: "recipe", label: "Resep" },
      ],
    },
    { key: "notes", label: "Catatan", type: "text", placeholder: "Opsional", widthClass: "min-w-[130px]" },
    { key: "is_active", label: "Aktif", type: "checkbox", widthClass: "w-[70px]" },
  ];

  const createEmptyMenuRow = (): BulkMenuRow => ({
    name: "",
    sku: "",
    category: defaultBulkCategory,
    product_group: "",
    unit: "Porsi",
    selling_price: 0,
    hpp_manual: 0,
    hpp_mode: "manual",
    notes: "",
    is_active: true,
  });

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, hppStatusFilter, itemTypeFilter]);

  useEffect(() => {
    if (isLockedReadOnly) {
      setAnonymizeMode(true);
      setQuickEditMode(false);
      setQuickEdits({});
    }
  }, [isLockedReadOnly]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const invalidateMenus = () => {
    queryClient.invalidateQueries({ queryKey: ["menus"] });
    queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: MenuProductPayload) => createMenu(payload),
    onSuccess: (created) => {
      toast.success(`Item "${created.name}" berhasil ditambahkan.`);
      setFormOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menambahkan menu.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MenuProductPayload }) =>
      updateMenu(id, payload),
    onSuccess: (updated) => {
      toast.success(`Item "${updated.name}" berhasil diperbarui.`);
      setFormOpen(false);
      setEditingMenu(null);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui menu.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMenu(id),
    onSuccess: () => {
      toast.success("Item berhasil dihapus.");
      setDeleteTarget(null);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus menu.");
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (args: {
      menuId: number;
      newName: string;
      scaleFactor: number;
      scalePackaging: boolean;
    }) =>
      cloneMenu(args.menuId, {
        new_name: args.newName,
        scale_factor: args.scaleFactor,
        scale_packaging: args.scalePackaging,
      }),
    onSuccess: (cloned) => {
      toast.success(`Resep "${cloned.name}" berhasil diduplikasi.`);
      setCloneTarget(null);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menduplikasi resep.");
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: () => {
      const updates = Object.entries(quickEdits).map(([idStr, draft]) => ({
        id: Number(idStr),
        selling_price: Math.max(0, Number(draft.selling_price) || 0),
        hpp_manual: Math.max(0, Number(draft.hpp_manual) || 0),
        hpp_mode: draft.hpp_mode,
        is_active: draft.is_active,
      }));
      return bulkUpdateMenus(updates);
    },
    onSuccess: (res) => {
      toast.success(`${res.updated_count} menu berhasil diperbarui sekaligus.`);
      setQuickEdits({});
      setQuickEditMode(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan quick-edit massal.");
    },
  });

  const bulkFormCreateMutation = useMutation({
    mutationFn: ({ rows, updateExisting }: { rows: BulkMenuRow[]; updateExisting: boolean }) =>
      bulkCreateMenus(
        rows.map((r) => ({
          name: r.name.trim(),
          sku: r.sku.trim() || undefined,
          category: r.category.trim() || "Lainnya",
          product_group: r.product_group.trim() || undefined,
          unit: r.unit || "Porsi",
          selling_price: Math.max(0, Number(r.selling_price) || 0),
          hpp_manual: Math.max(0, Number(r.hpp_manual) || 0),
          hpp_mode: r.hpp_mode || "manual",
          notes: r.notes.trim() || undefined,
          is_active: Boolean(r.is_active),
          ingredients: [],
        })),
        updateExisting
      ),
    onSuccess: (res) => {
      toast.success(res.message || `+${res.added} menu ditambahkan, ${res.updated} diperbarui.`);
      setBulkFormOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan menu masal.");
    },
  });

  const posImportMutation = useMutation({
    mutationFn: () => importMenusFromPos(),
    onSuccess: (res) => {
      if (res.total_pos_products === 0) {
        toast.info("Belum ada data item di Transaksi Masuk (POS) untuk ditarik.");
      } else if (res.added > 0) {
        toast.success(
          `${res.added} menu baru ditarik dari histori POS (${res.skipped} sudah terdaftar).`
        );
      } else {
        toast.info("Semua produk dari histori POS sudah terdaftar di database menu.");
      }
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menarik data menu dari POS.");
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: () => {
      if (!csvFile) throw new Error("Pilih file CSV terlebih dahulu.");
      return importMenusCsv(csvFile, updateExistingCsv);
    },
    onSuccess: (res) => {
      toast.success(
        `Import CSV selesai: +${res.added} baru, ${res.updated} diperbarui, ${res.skipped} dilewati.`
      );
      setCsvFile(null);
      setImportCsvOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengimpor file CSV menu.");
    },
  });

  const batchAnonMutation = useMutation({
    mutationFn: () => anonymizeAllMenus(anonPrefix, preserveCustomAnon),
    onSuccess: (res) => {
      toast.success(
        `${res.updated_count} kode nama anonim berhasil diperbarui dengan prefix ${anonPrefix.toUpperCase()}.`
      );
      setAnonymizeDialogOpen(false);
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui kode nama anonim.");
    },
  });

  const lockMutation = useMutation({
    mutationFn: (locked: boolean) => setMenuAnonymizeLock(locked),
    onSuccess: (res) => {
      if (res.anonymize_locked) {
        setAnonymizeMode(true);
        setQuickEditMode(false);
        setQuickEdits({});
        toast.success("Mode Anonim Read-Only dikunci. Semua perubahan data dinonaktifkan.");
      } else {
        toast.success("Kunci Mode Anonim Read-Only dibuka.");
      }
      invalidateMenus();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengubah status kunci mode anonim.");
    },
  });

  const shareTokenMutation = useMutation({
    mutationFn: () => createMenuShareToken(shareExpireHours),
    onSuccess: (res) => {
      const fullUrl = `${window.location.origin}${res.share_path}`;
      setGeneratedShareUrl(fullUrl);
      toast.success("Link presentasi anonim read-only berhasil dibuat.");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal membuat link presentasi.");
    },
  });

  const currentFilterParams = {
    search: search.trim() || undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    hpp_status: hppStatusFilter !== "all" ? hppStatusFilter : undefined,
    item_type: itemTypeFilter !== "all" ? itemTypeFilter : undefined,
    anonymize: effectiveAnonymized,
  };

  const handleExportCsv = async () => {
    try {
      await downloadMenusCsv(currentFilterParams);
      toast.success(
        effectiveAnonymized
          ? "File CSV (Mode Anonim) berhasil diunduh."
          : "File CSV database menu berhasil diunduh."
      );
    } catch {
      toast.error("Gagal mengunduh file CSV menu.");
    }
  };

  const handleExportJson = async () => {
    try {
      await downloadMenusJson(currentFilterParams);
      toast.success(
        effectiveAnonymized
          ? "File JSON (Mode Anonim) berhasil diunduh."
          : "File JSON database menu berhasil diunduh."
      );
    } catch {
      toast.error("Gagal mengunduh file JSON menu.");
    }
  };

  const handleCopyJson = async () => {
    try {
      const payload = await getMenusJsonPayload(currentFilterParams);
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(
        effectiveAnonymized
          ? "JSON anonim disalin ke clipboard."
          : "JSON database menu disalin ke clipboard."
      );
    } catch {
      toast.error("Gagal menyalin JSON ke clipboard.");
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadMenusTemplateCsv();
      toast.success("Template CSV siap isi berhasil diunduh.");
    } catch {
      toast.error("Gagal mengunduh template CSV.");
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSubExpand = (key: string) => {
    setExpandedSubIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openCreateModal = (initialType: MenuItemType = "finished") => {
    if (effectiveAnonymized) {
      toast.info("Matikan atau buka kunci Mode Anonim terlebih dahulu untuk menambah menu.");
      return;
    }
    setDefaultFormItemType(initialType);
    setEditingMenu(null);
    setFormOpen(true);
  };

  const openEditModal = (menu: MenuProduct) => {
    if (effectiveAnonymized) {
      toast.info("Matikan atau buka kunci Mode Anonim terlebih dahulu untuk mengedit menu.");
      return;
    }
    setDefaultFormItemType(menu.item_type || "finished");
    setEditingMenu(menu);
    setFormOpen(true);
  };

  const getQuickRow = (menu: MenuProduct): QuickEditRow => {
    return (
      quickEdits[menu.id] || {
        selling_price: String(menu.selling_price || 0),
        hpp_manual: String(menu.hpp_manual || 0),
        hpp_mode: menu.hpp_mode,
        is_active: menu.is_active,
      }
    );
  };

  const setQuickField = <K extends keyof QuickEditRow>(
    menu: MenuProduct,
    field: K,
    value: QuickEditRow[K]
  ) => {
    setQuickEdits((prev) => {
      const base = prev[menu.id] || {
        selling_price: String(menu.selling_price || 0),
        hpp_manual: String(menu.hpp_manual || 0),
        hpp_mode: menu.hpp_mode,
        is_active: menu.is_active,
      };
      return {
        ...prev,
        [menu.id]: { ...base, [field]: value },
      };
    });
  };

  const dirtyCount = Object.keys(quickEdits).length;

  const hasFilters = Boolean(
    search.trim() ||
      categoryFilter !== "all" ||
      hppStatusFilter !== "all" ||
      itemTypeFilter !== "all"
  );

  const resetFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setHppStatusFilter("all");
    setItemTypeFilter("all");
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;
  const displayedTotal = useMemo(() => summary?.total_menus || 0, [summary]);

  const menuColumns = useMemo<ColumnDef<DataGridFeatures, MenuProduct>[]>(
    () => [
      {
        id: "expand",
        header: () => null,
        cell: ({ row }) => {
          const menu = row.original;
          return row.getCanExpand() ? (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
              aria-label={`Lihat rincian resep ${menu.display_name}`}
              aria-expanded={row.getIsExpanded()}
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : null;
        },
        size: 38,
        enableSorting: false,
        meta: {
          expandedContent: (menu: MenuProduct) => (
            <div className="bg-slate-50/80 dark:bg-slate-900/60 px-8 py-3">
              <MenuExpandedRecipePanel
                menu={menu}
                expandedSubIds={expandedSubIds}
                onToggleSub={toggleSubExpand}
              />
            </div>
          ),
        },
      },
      {
        accessorKey: "display_name",
        id: "display_name",
        header: ({ column }) => (
          <DataGridColumnHeader
            title={effectiveAnonymized ? "Kode Anonim Menu" : "Nama Menu / Produk"}
            column={column}
          />
        ),
        cell: ({ row }) => {
          const menu = row.original;
          const unitLabel = menu.batch_yield_unit || menu.unit;
          return (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {menu.display_name}
                </span>
                <MenuItemBadges
                  menu={menu}
                  effectiveAnonymized={effectiveAnonymized}
                  onOpenUsages={(m) => setUsageTarget(m)}
                />
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Satuan: {menu.unit}
                {menu.item_type === "prepared" && (menu.batch_yield_qty || 1) > 1
                  ? ` | Batch: ${menu.batch_yield_qty} ${unitLabel}`
                  : ""}
                {!effectiveAnonymized && menu.sku ? ` | SKU: ${menu.sku}` : ""}
                {menu.product_group ? ` | Grup: ${menu.product_group}` : ""}
              </div>
            </div>
          );
        },
        size: 215,
      },
      {
        accessorKey: "category",
        id: "category",
        header: ({ column }) => <DataGridColumnHeader title="Kategori" column={column} />,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] font-medium">
            {row.original.category}
          </Badge>
        ),
        size: 110,
      },
      {
        accessorKey: "selling_price",
        id: "selling_price",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Harga Jual"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const menu = row.original;
          const qRow = getQuickRow(menu);
          return (
            <div className="text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
              {quickEditMode ? (
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={qRow.selling_price}
                  onChange={(e) => setQuickField(menu, "selling_price", e.target.value)}
                  aria-label={`Harga jual ${menu.display_name}`}
                  className="h-8 w-28 ml-auto text-right text-xs tabular-nums"
                />
              ) : !menu.is_sellable ? (
                <span className="text-[11px] text-slate-600 dark:text-slate-400 font-normal">
                  Pemakaian Internal
                </span>
              ) : menu.selling_price > 0 ? (
                formatRupiah(menu.selling_price)
              ) : (
                "-"
              )}
            </div>
          );
        },
        size: 115,
      },
      {
        accessorKey: "effective_hpp",
        id: "effective_hpp",
        header: ({ column }) => (
          <DataGridColumnHeader
            title={quickEditMode ? "HPP Manual & Mode" : "HPP / Food Cost"}
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const menu = row.original;
          const qRow = getQuickRow(menu);
          const unitLabel = menu.batch_yield_unit || menu.unit;
          return (
            <div className="text-right tabular-nums">
              {quickEditMode ? (
                <div className="flex items-center justify-end gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={qRow.hpp_manual}
                    onChange={(e) => setQuickField(menu, "hpp_manual", e.target.value)}
                    aria-label={`HPP manual ${menu.display_name}`}
                    className="h-8 w-28 text-right text-xs tabular-nums"
                  />
                  <select
                    value={qRow.hpp_mode}
                    onChange={(e) =>
                      setQuickField(menu, "hpp_mode", e.target.value as MenuHppMode)
                    }
                    aria-label={`Mode HPP ${menu.display_name}`}
                    className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 text-[11px]"
                  >
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                    <option value="recipe">Resep</option>
                  </select>
                </div>
              ) : (
                <>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                  </div>
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">
                    {menu.active_hpp_source === "recipe"
                      ? (menu.subtotal_packaging || 0) > 0
                        ? `Bahan ${formatRupiah(menu.subtotal_ingredients || 0)} + Kemasan ${formatRupiah(menu.subtotal_packaging || 0)}`
                        : (menu.batch_yield_qty || 1) > 1
                        ? `/${unitLabel} (Batch ${menu.batch_yield_qty})`
                        : `Resep (${menu.ingredient_count} bahan${menu.other_fee > 0 ? " + lain" : ""})`
                      : "Input Manual"}
                  </div>
                </>
              )}
            </div>
          );
        },
        size: 165,
      },
      {
        accessorKey: "food_cost_pct",
        id: "food_cost_pct",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Food Cost %"
            column={column}
            className="justify-center text-center"
          />
        ),
        cell: ({ row }) => {
          const menu = row.original;
          const fcBadge = getFoodCostBadge(menu.food_cost_status);
          return (
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {menu.is_sellable && menu.selling_price > 0 && menu.effective_hpp > 0
                  ? `${menu.food_cost_pct.toFixed(1)}%`
                  : "-"}
              </span>
              <Badge variant="outline" className={`text-[10px] ${fcBadge.className}`}>
                {fcBadge.label}
              </Badge>
            </div>
          );
        },
        size: 100,
      },
      {
        accessorKey: "gross_margin",
        id: "gross_margin",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Margin Kotor"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const menu = row.original;
          return (
            <div className="text-right tabular-nums">
              <div
                className={`font-semibold ${
                  !menu.is_sellable
                    ? "text-slate-600 dark:text-slate-400"
                    : menu.gross_margin >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-700 dark:text-rose-400"
                }`}
              >
                {menu.is_sellable && menu.selling_price > 0
                  ? formatRupiah(menu.gross_margin)
                  : "-"}
              </div>
              {menu.is_sellable && menu.selling_price > 0 && (
                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                  {menu.margin_pct.toFixed(1)}%
                </div>
              )}
            </div>
          );
        },
        size: 108,
      },
      {
        id: "actions",
        header: () => (
          <div className="text-right w-full">{quickEditMode ? "Aktif" : "Aksi"}</div>
        ),
        cell: ({ row }) => {
          const menu = row.original;
          const qRow = getQuickRow(menu);
          return (
            <div className="flex justify-end">
              {quickEditMode ? (
                <input
                  type="checkbox"
                  checked={qRow.is_active}
                  onChange={(e) => setQuickField(menu, "is_active", e.target.checked)}
                  aria-label={`Status aktif ${menu.display_name}`}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
              ) : (
                <div className="inline-flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCloneTarget(menu)}
                    disabled={effectiveAnonymized}
                    aria-label={`Duplikasi ${menu.display_name}`}
                    title="Duplikasi & Skala Resep"
                    className="h-8 w-8 p-0 text-slate-600 hover:text-indigo-700 dark:text-slate-400 dark:hover:text-indigo-300"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(menu)}
                    disabled={effectiveAnonymized}
                    aria-label={`Edit ${menu.display_name}`}
                    className="h-8 w-8 p-0 text-slate-600 hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isLockedReadOnly}
                      onClick={() => setDeleteTarget(menu)}
                      aria-label={`Hapus ${menu.display_name}`}
                      className="h-8 w-8 p-0 text-slate-600 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        },
        size: 115,
      },
    ],
    [
      effectiveAnonymized,
      quickEditMode,
      quickEdits,
      isAdmin,
      isLockedReadOnly,
      expandedSubIds,
    ]
  );

  const menuPagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, safePage - 1),
      pageSize,
    }),
    [safePage, pageSize]
  );

  const menuTable = useTable({
    features: dataGridFeatures,
    columns: menuColumns,
    data: items,
    getRowId: (row: MenuProduct) => String(row.id),
    getRowCanExpand: (row) => {
      const m = row.original;
      return Boolean(
        m.ingredient_count > 0 ||
          (m.other_fee && m.other_fee > 0) ||
          (m.labor_cost && m.labor_cost > 0)
      );
    },
    state: {
      pagination: menuPagination,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(menuPagination) : updater;
      if (next.pageSize !== pageSize) {
        setPageSize(next.pageSize);
        setPage(1);
      } else {
        setPage(next.pageIndex + 1);
      }
    },
  });

  return (
    <div className="space-y-3">
      {/* 1. Editorial Header Strip */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-2.5">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
              Katalog Menu &amp; Margin HPP
            </h2>
            {effectiveAnonymized && (
              <Badge className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-[10px] font-semibold gap-1 px-2 py-0.5 rounded-md">
                {isLockedReadOnly && <Lock className="w-3 h-3" />}
                {isLockedReadOnly ? "Anonim Terkunci" : "Mode Anonim"}
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--ledger-muted)] tabular-nums">
            {displayedTotal} produk terdaftar • {summary?.finished_count ?? 0} Menu Jual,{" "}
            {summary?.prepared_count ?? 0} Prepared, {summary?.bundle_count ?? 0} Bundling
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start lg:self-center">
          {/* Master Kategori Menu */}
          {isAdmin && !effectiveAnonymized && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCategoryManagerOpen(true)}
              className="h-8 rounded-lg text-xs gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
            >
              <Tags className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <span>Kategori Menu</span>
            </Button>
          )}
          {/* Simulasi Harga Bahan */}
          {!effectiveAnonymized && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSimulatorOpen(true)}
              disabled={items.length === 0 && itemTypeFilter === "all"}
              className="h-8 rounded-lg text-xs gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Simulasi Harga</span>
            </Button>
          )}
          {/* 1. Mode Anonim & Proteksi */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={effectiveAnonymized ? "default" : "outline"}
                size="sm"
                className={`h-8 rounded-lg text-xs gap-1.5 ${
                  effectiveAnonymized
                    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                    : "border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
                }`}
                aria-pressed={effectiveAnonymized}
              >
                {effectiveAnonymized ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>{isLockedReadOnly ? "Anonim Terkunci" : "Mode Anonim: Aktif"}</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Mode Anonim</span>
                  </>
                )}
                <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]">
              <DropdownMenuLabel className="text-[11px] font-semibold text-[var(--ledger-muted)] px-2 py-1">
                Privasi &amp; Proteksi Menu
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={isLockedReadOnly}
                onClick={() => {
                  const next = !anonymizeMode;
                  setAnonymizeMode(next);
                  if (next) {
                    setQuickEditMode(false);
                    setQuickEdits({});
                  }
                }}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                {effectiveAnonymized ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-blue-500" />
                    <div>
                      <div className="font-medium">Tampilkan Nama Asli</div>
                      <div className="text-[10px] text-slate-400">Nonaktifkan samaran menu</div>
                    </div>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                    <div>
                      <div className="font-medium">Aktifkan Nama Anonim</div>
                      <div className="text-[10px] text-slate-400">Samarkan nama produk &amp; resep</div>
                    </div>
                  </>
                )}
              </DropdownMenuItem>

              {isAdmin && (
                <>
                  <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                  <DropdownMenuItem
                    onClick={() => {
                      setGeneratedShareUrl("");
                      setShareDialogOpen(true);
                    }}
                    className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                  >
                    <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                    <div>
                      <div className="font-medium">Link Berbagi Anonim</div>
                      <div className="text-[10px] text-slate-400">Bagi link baca tanpa login</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isLockedReadOnly}
                    onClick={() => setAnonymizeDialogOpen(true)}
                    className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                  >
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    <div>
                      <div className="font-medium">Atur Format Kode</div>
                      <div className="text-[10px] text-slate-400">Prefix MENU-001 &amp; garam acak</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={lockMutation.isPending}
                    onClick={() => lockMutation.mutate(!isLockedReadOnly)}
                    className={`text-xs gap-2 py-2 cursor-pointer rounded-lg ${
                      isLockedReadOnly ? "text-amber-600 focus:text-amber-700" : ""
                    }`}
                  >
                    {isLockedReadOnly ? (
                      <>
                        <Unlock className="w-3.5 h-3.5 text-amber-600" />
                        <div>
                          <div className="font-medium text-amber-600 dark:text-amber-400">Buka Kunci Read-Only</div>
                          <div className="text-[10px] text-slate-400">Izinkan pengeditan menu kembali</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5 text-amber-600" />
                        <div>
                          <div className="font-medium">Kunci Read-Only Global</div>
                          <div className="text-[10px] text-slate-400">Bekukan data agar tidak bisa diedit</div>
                        </div>
                      </>
                    )}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 2. Quick-Edit Mode */}
          <Button
            type="button"
            variant={quickEditMode ? "default" : "outline"}
            size="sm"
            disabled={effectiveAnonymized || items.length === 0}
            onClick={() => {
              if (quickEditMode) {
                setQuickEditMode(false);
                setQuickEdits({});
              } else {
                setQuickEditMode(true);
              }
            }}
            className="h-9 rounded-xl text-xs gap-1.5"
          >
            <PencilLine className="w-3.5 h-3.5" />
            <span>{quickEditMode ? "Keluar Quick-Edit" : "Quick-Edit Massal"}</span>
          </Button>

          {/* 3. Input & POS Masal */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={effectiveAnonymized || isLockedReadOnly}
                  className="h-9 rounded-xl text-xs gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Input &amp; POS</span>
                  <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5 shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                  Input Masal &amp; Integrasi
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setBulkFormOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <Table2 className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <div className="font-medium">Tambah Masal</div>
                    <div className="text-[10px] text-slate-400">Spreadsheet input multi-menu</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setImportCsvOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  <div>
                    <div className="font-medium">Import CSV</div>
                    <div className="text-[10px] text-slate-400">Unggah file template CSV</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                <DropdownMenuItem
                  disabled={posImportMutation.isPending}
                  onClick={() => posImportMutation.mutate()}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-indigo-500 ${posImportMutation.isPending ? "animate-spin" : ""}`}
                  />
                  <div>
                    <div className="font-medium">
                      {posImportMutation.isPending ? "Mengambil..." : "Tarik dari POS"}
                    </div>
                    <div className="text-[10px] text-slate-400">Sinkron menu dari mesin kasir</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
                <DropdownMenuItem
                  onClick={() => setChannelSettingsOpen(true)}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <Settings2 className="w-3.5 h-3.5 text-amber-600" />
                  <div>
                    <div className="font-medium">Atur Komisi Channel</div>
                    <div className="text-[10px] text-slate-400">GoFood, GrabFood, ShopeeFood</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 4. Export Data */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={items.length === 0}
                className="h-9 rounded-xl text-xs gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
                <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5 shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
              <DropdownMenuLabel className="text-[11px] font-semibold text-slate-400 px-2 py-1">
                Format Unduhan
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={handleExportCsv}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <div>
                  <div className="font-medium">{effectiveAnonymized ? "Export CSV (Anonim)" : "Export CSV"}</div>
                  <div className="text-[10px] text-slate-400">Tabel Excel / Spreadsheet</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportJson}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <FileJson className="w-3.5 h-3.5 text-amber-500" />
                <div>
                  <div className="font-medium">{effectiveAnonymized ? "Export JSON (Anonim)" : "Export JSON"}</div>
                  <div className="text-[10px] text-slate-400">File JSON terstruktur</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 border-slate-100 dark:border-slate-800" />
              <DropdownMenuItem
                onClick={handleCopyJson}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <Copy className="w-3.5 h-3.5 text-blue-500" />
                <div>
                  <div className="font-medium">Salin JSON ke Clipboard</div>
                  <div className="text-[10px] text-slate-400">Copy data mentah ke clipboard</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 5. Tambah Prepared & Primary Action: Tambah Menu */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openCreateModal("prepared")}
            disabled={effectiveAnonymized}
            className="h-9 rounded-xl text-xs font-medium gap-1.5 border-amber-300 text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>+ Prepared</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => openCreateModal("finished")}
            disabled={effectiveAnonymized}
            className="h-9 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Menu</span>
          </Button>
        </div>
      </div>

      {/* Mode Anonim Privacy Notice */}
      {effectiveAnonymized && (
        <div className="rounded-xl border border-slate-300 bg-slate-900 text-slate-100 dark:border-slate-700 dark:bg-slate-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div>
            <strong>{isLockedReadOnly ? "Proteksi Mode Anonim Read-Only Terkunci:" : "Mode Anonim aktif:"}</strong>{" "}
            Nama asli menu, SKU, catatan, dan nama bahan resep disembunyikan oleh server (menjadi kode MENU-001 &amp; Bahan #1).
            {isLockedReadOnly
              ? " Semua aksi ubah/hapus/import dinonaktifkan sampai Owner membuka kunci."
              : ""}
          </div>
          {!isLockedReadOnly ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAnonymizeMode(false)}
              className="h-8 text-xs shrink-0 self-start sm:self-auto"
            >
              Kembali ke Nama Asli
            </Button>
          ) : isAdmin ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => lockMutation.mutate(false)}
              disabled={lockMutation.isPending}
              className="h-8 text-xs shrink-0 self-start sm:self-auto gap-1"
            >
              <Unlock className="w-3.5 h-3.5" />
              Buka Kunci
            </Button>
          ) : null}
        </div>
      )}

      {/* Quick-Edit Massal Action Bar */}
      {quickEditMode && !effectiveAnonymized && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div className="text-blue-900 dark:text-blue-200">
            <strong>Mode Quick-Edit Massal aktif:</strong> Ubah Harga Jual, HPP Manual, Mode HPP, atau Status Aktif langsung pada tabel di bawah lalu simpan sekaligus.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickEdits({});
                setQuickEditMode(false);
              }}
              className="h-9 text-xs gap-1 bg-white dark:bg-slate-900"
            >
              <X className="w-3.5 h-3.5" />
              <span>Batal</span>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={dirtyCount === 0 || bulkUpdateMutation.isPending}
              onClick={() => bulkUpdateMutation.mutate()}
              className="h-9 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {bulkUpdateMutation.isPending
                  ? "Menyimpan..."
                  : `Simpan Perubahan (${dirtyCount})`}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* 2. Unified Asymmetric Metric Strip (Zero Nested Cards) */}
      <LedgerMetricStrip
        isLoading={isLoading && !summary}
        primary={{
          label: "Rata-rata Food Cost & Margin",
          value:
            summary && summary.avg_food_cost_pct > 0
              ? `${summary.avg_food_cost_pct}% Food Cost`
              : `${summary?.total_menus ?? 0} Menu`,
          valueClassName: "text-[var(--ledger-ink)]",
          subtext:
            summary && summary.avg_margin_pct > 0
              ? `Rata-rata margin kotor ${summary.avg_margin_pct}% dari ${summary.total_menus} produk`
              : `${summary?.finished_count ?? 0} Menu, ${summary?.prepared_count ?? 0} Prepared, ${summary?.bundle_count ?? 0} Bundling`,
          active: hppStatusFilter === "all",
          onClick: () => setHppStatusFilter("all"),
          segments:
            summary &&
            (summary.ideal_count || 0) + (summary.moderate_count || 0) + (summary.high_count || 0) > 0
              ? [
                  {
                    key: "ideal",
                    label: "Ideal",
                    value: summary.ideal_count || 0,
                    displayValue: `${summary.ideal_count || 0}`,
                    colorClass: "bg-emerald-600 dark:bg-emerald-400",
                  },
                  {
                    key: "moderate",
                    label: "Sedang",
                    value: summary.moderate_count || 0,
                    displayValue: `${summary.moderate_count || 0}`,
                    colorClass: "bg-amber-500 dark:bg-amber-400",
                  },
                  {
                    key: "high",
                    label: "Tinggi",
                    value: summary.high_count || 0,
                    displayValue: `${summary.high_count || 0}`,
                    colorClass: "bg-rose-600 dark:bg-rose-400",
                  },
                ]
              : undefined,
        }}
        supporting={[
          {
            key: "missing-hpp",
            label: "Belum Memiliki HPP",
            value: `${summary?.missing_hpp_count ?? 0} Item`,
            valueClassName:
              (summary?.missing_hpp_count ?? 0) > 0
                ? "text-[var(--signal-dp)]"
                : "text-[var(--ledger-ink)]",
            subtext: "Klik untuk filter item tanpa HPP",
            active: hppStatusFilter === "missing_hpp",
            accentTone: "dp",
            onClick: () =>
              setHppStatusFilter((prev) =>
                prev === "missing_hpp" ? "all" : "missing_hpp"
              ),
          },
          {
            key: "high-fc",
            label: "Food Cost Tinggi (>45%)",
            value: `${summary?.high_count ?? 0} Item`,
            valueClassName:
              (summary?.high_count ?? 0) > 0
                ? "text-[var(--signal-unpaid)]"
                : "text-[var(--signal-cleared)]",
            subtext: `Ideal: ${summary?.ideal_count ?? 0} • Sedang: ${summary?.moderate_count ?? 0}`,
            active: hppStatusFilter === "high",
            accentTone: "unpaid",
            onClick: () =>
              setHppStatusFilter((prev) => (prev === "high" ? "all" : "high")),
          },
          {
            key: "price-drift",
            label: "Harga Bahan Naik (≥5%)",
            value: `${summary?.price_drift_menus_count ?? 0} Item`,
            valueClassName:
              (summary?.price_drift_menus_count ?? 0) > 0
                ? "text-[var(--signal-unpaid)]"
                : "text-[var(--ledger-ink)]",
            subtext: "Termasuk rambatan sub-resep",
            active: hppStatusFilter === "price_drift",
            accentTone: "unpaid",
            onClick: () =>
              setHppStatusFilter((prev) =>
                prev === "price_drift" ? "all" : "price_drift"
              ),
          },
        ]}
      />

      {/* 3. Type Tabs + Unified Ledger Surface */}
      <section aria-label="Daftar menu dan resep HPP" className="space-y-2">
        <LedgerStatusTabs
          tabs={[
            { value: "all", label: "Semua Item", count: summary?.total_menus },
            { value: "finished", label: "Menu Jual", count: summary?.finished_count },
            { value: "prepared", label: "Prepared / Setengah Jadi", count: summary?.prepared_count },
            { value: "bundle", label: "Paket / Bundling", count: summary?.bundle_count },
          ]}
          value={itemTypeFilter}
          onChange={(next) => setItemTypeFilter(next)}
          layoutId="menu-type-underline"
          ariaLabel="Filter tipe menu dan resep"
        />

        <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
          <div className="p-3 sm:px-3.5 sm:py-2.5 border-b border-[color:var(--ledger-hairline)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="relative lg:col-span-2 min-w-0">
                <Search className="w-3.5 h-3.5 text-[var(--ledger-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    effectiveAnonymized
                      ? "Cari kode anonim atau kategori..."
                      : "Cari nama menu, prepared, kode anonim, SKU..."
                  }
                  className="pl-8 h-9 text-xs rounded-lg bg-[var(--ledger-surface)] border-[color:var(--ledger-hairline)]"
                  aria-label="Cari menu"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter kategori menu"
                className="h-9 rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] px-2.5 text-xs text-[var(--ledger-ink)]"
              >
                <option value="all">Semua Kategori</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <select
                  value={hppStatusFilter}
                  onChange={(e) => setHppStatusFilter(e.target.value)}
                  aria-label="Filter status food cost"
                  className="h-9 flex-1 min-w-0 rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] px-2.5 text-xs text-[var(--ledger-ink)]"
                >
                  <option value="all">Semua Status Food Cost</option>
                  <option value="ideal">Ideal (&le;35%)</option>
                  <option value="moderate">Sedang (35% - 45%)</option>
                  <option value="high">Tinggi (&gt;45%)</option>
                  <option value="not_sellable">Pemakaian Internal (Prepared)</option>
                  <option value="price_drift">Harga Bahan Naik (&ge;5%)</option>
                  <option value="missing_hpp">Belum Ada HPP</option>
                  <option value="no_price">Belum Ada Harga Jual</option>
                </select>

                {hasFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    className="h-9 px-2.5 text-xs shrink-0 text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs text-[var(--ledger-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memuat database menu dan perhitungan HPP...</span>
            </div>
          ) : isError ? (
            <LedgerStateBlock
              variant="error"
              title="Gagal memuat database menu dan HPP"
              description="Periksa koneksi server lalu coba muat ulang data."
              actions={
                <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                  Coba Lagi
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <LedgerStateBlock
              variant="empty"
              icon={<BookOpen className="w-7 h-7" />}
              title={hasFilters ? "Tidak ada item yang sesuai filter" : "Database Menu / Produk masih kosong"}
              description={
                hasFilters
                  ? "Ubah kata kunci pencarian atau reset filter untuk melihat semua menu dan prepared."
                  : "Tambahkan menu atau resep prepared secara manual, tarik daftar produk dari histori Transaksi Masuk (POS), atau import file CSV."
              }
              actions={
                hasFilters ? (
                  <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                    Reset Filter
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => openCreateModal("finished")}
                      disabled={effectiveAnonymized}
                      className="gap-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 rounded-lg text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Tambah Menu Pertama
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => posImportMutation.mutate()}
                      disabled={posImportMutation.isPending || isLockedReadOnly}
                      className="gap-1.5 rounded-lg text-xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Tarik dari POS
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isLockedReadOnly}
                      onClick={() => setImportCsvOpen(true)}
                      className="gap-1.5 rounded-lg text-xs"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import CSV
                    </Button>
                  </>
                )
              }
            />
          ) : (
            <DataTable
              table={menuTable}
              recordCount={items.length}
              containerClassName="border-0 rounded-none shadow-none"
              footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
              tableWrapperClassName="hidden md:block"
            >
            {/* Mobile Reflow Cards */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {pagedItems.map((menu) => {
                const fcBadge = getFoodCostBadge(menu.food_cost_status);
                const isExpanded = !!expandedIds[menu.id];
                const qRow = getQuickRow(menu);
                const hasExpandable =
                  menu.ingredient_count > 0 ||
                  (menu.other_fee && menu.other_fee > 0) ||
                  (menu.labor_cost && menu.labor_cost > 0);

                return (
                  <div key={menu.id} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 break-words">
                          {menu.display_name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {menu.category}
                          </Badge>
                          <MenuItemBadges
                            menu={menu}
                            effectiveAnonymized={effectiveAnonymized}
                            onOpenUsages={(m) => setUsageTarget(m)}
                          />
                          <Badge variant="outline" className={`text-[10px] ${fcBadge.className}`}>
                            {fcBadge.label}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {!menu.is_sellable
                            ? "Internal"
                            : menu.selling_price > 0
                            ? formatRupiah(menu.selling_price)
                            : "-"}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          per {menu.batch_yield_unit || menu.unit}
                        </div>
                      </div>
                    </div>

                    {quickEditMode ? (
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 p-2.5 text-xs">
                        <div>
                          <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Harga Jual
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={qRow.selling_price}
                            onChange={(e) =>
                              setQuickField(menu, "selling_price", e.target.value)
                            }
                            className="h-9 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                            HPP Manual
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={qRow.hpp_manual}
                            onChange={(e) =>
                              setQuickField(menu, "hpp_manual", e.target.value)
                            }
                            className="h-9 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Mode HPP
                          </label>
                          <select
                            value={qRow.hpp_mode}
                            onChange={(e) =>
                              setQuickField(menu, "hpp_mode", e.target.value as MenuHppMode)
                            }
                            className="h-9 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs"
                          >
                            <option value="auto">Auto</option>
                            <option value="manual">Manual</option>
                            <option value="recipe">Resep</option>
                          </select>
                        </div>
                        <div className="flex items-end pb-1.5">
                          <label className="inline-flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={qRow.is_active}
                              onChange={(e) =>
                                setQuickField(menu, "is_active", e.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                            <span>Aktif</span>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/70 p-2 text-xs tabular-nums">
                        <div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">HPP</div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">
                            Food Cost
                          </div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {menu.is_sellable && menu.selling_price > 0 && menu.effective_hpp > 0
                              ? `${menu.food_cost_pct.toFixed(1)}%`
                              : "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">
                            Margin
                          </div>
                          <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                            {menu.is_sellable && menu.selling_price > 0
                              ? formatRupiah(menu.gross_margin)
                              : "-"}
                          </div>
                        </div>
                      </div>
                    )}

                    {hasExpandable && (
                      <div>
                        <button
                          type="button"
                          onClick={() => toggleExpand(menu.id)}
                          className="min-h-[44px] w-full flex items-center justify-between px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                          aria-expanded={isExpanded}
                        >
                          <span>
                            Resep ({menu.ingredient_count} item
                            {(menu.subtotal_packaging || 0) > 0 ? " + kemasan" : ""}
                            {menu.other_fee > 0 ? " + lain" : ""})
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-2.5">
                            <MenuExpandedRecipePanel
                              menu={menu}
                              expandedSubIds={expandedSubIds}
                              onToggleSub={toggleSubExpand}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {!quickEditMode && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(menu)}
                          disabled={effectiveAnonymized}
                          className="flex-1 min-h-[44px] text-xs gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setCloneTarget(menu)}
                          disabled={effectiveAnonymized}
                          className="min-h-[44px] min-w-[44px] text-xs gap-1"
                          aria-label={`Duplikasi ${menu.display_name}`}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isLockedReadOnly}
                            onClick={() => setDeleteTarget(menu)}
                            className="min-h-[44px] min-w-[44px] text-rose-700 border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-900"
                            aria-label={`Hapus ${menu.display_name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </DataTable>
          )}
        </div>
      </section>

      {/* Form Modal */}
      <MenuFormDialog
        open={formOpen}
        onOpenChange={(val) => {
          setFormOpen(val);
          if (!val) setEditingMenu(null);
        }}
        editingMenu={editingMenu}
        masterItems={masterItems}
        allMenus={allMenusForRecipe}
        pricingChannels={pricingChannels}
        defaultItemType={defaultFormItemType}
        isAdmin={isAdmin}
        onOpenChannelSettings={() => setChannelSettingsOpen(true)}
        menuCategories={menuCategories}
        onOpenCategoryManager={
          isAdmin ? () => setCategoryManagerOpen(true) : undefined
        }
        pendingCategorySelection={pendingCategorySelection}
        onConsumePendingCategory={() => setPendingCategorySelection(null)}
        units={units}
        existingCategories={categories}
        isSubmitting={isMutating}
        onSubmit={(payload) => {
          if (editingMenu) {
            updateMutation.mutate({ id: editingMenu.id, payload });
          } else {
            createMutation.mutate(payload);
          }
        }}
      />

      {/* What-If Price Simulator */}
      <PriceSimulatorDialog
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
        masterItems={masterItems}
      />

      {/* Clone & Scale Dialog */}
      <CloneScaleDialog
        open={!!cloneTarget}
        onOpenChange={(o) => !o && setCloneTarget(null)}
        sourceMenu={cloneTarget}
        isSubmitting={cloneMutation.isPending}
        onConfirm={(args) => cloneMutation.mutate(args)}
      />

      {/* Pricing Channels Settings */}
      <PricingChannelsDialog
        open={channelSettingsOpen}
        onOpenChange={setChannelSettingsOpen}
        channels={pricingChannels}
      />

      {/* Master Kategori Menu CRUD Dialog */}
      <MenuCategoriesDialog
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        onCategoryCreated={(catName) => {
          if (formOpen) {
            setPendingCategorySelection(catName);
          }
        }}
      />

      {/* Where-Used Dialog */}
      <Dialog open={!!usageTarget} onOpenChange={(o) => !o && setUsageTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-700 dark:text-amber-300" />
              <span>Pemakaian &quot;{usageTarget?.display_name}&quot;</span>
            </DialogTitle>
            <DialogDescription>
              Daftar menu jual atau sub-resep lain yang memakai item ini sebagai bahan penyusun.
            </DialogDescription>
          </DialogHeader>

          {usagesLoading ? (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memuat daftar resep pemakai...</span>
            </div>
          ) : usagesError ? (
            <div className="py-6 text-center space-y-2 text-xs">
              <AlertCircle className="w-5 h-5 text-rose-600 mx-auto" />
              <p className="text-slate-800 dark:text-slate-200">
                Gagal memuat daftar pemakaian resep.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetchUsages()}
              >
                Coba Lagi
              </Button>
            </div>
          ) : !usagesRes?.usages || usagesRes.usages.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-600 dark:text-slate-400">
              Item ini belum dipakai di resep menu mana pun.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
              {usagesRes.usages.map((u) => (
                <div
                  key={u.menu_id}
                  className="p-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {u.name}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400">
                      {u.category} | Pakai {u.qty} {u.unit}
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatRupiah(u.line_cost)}
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-400">
                      {u.cost_share_pct}% dari HPP
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUsageTarget(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Menu / Produk</DialogTitle>
            <DialogDescription>
              Hapus <strong>{deleteTarget?.display_name}</strong> beserta rincian resepnya dari database? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Menghapus..." : "Hapus Menu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={importCsvOpen} onOpenChange={setImportCsvOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Menu &amp; HPP dari CSV</DialogTitle>
            <DialogDescription>
              Unggah file CSV dengan kolom seperti Nama Menu, Kategori, Harga Jual, HPP (atau Food Cost), dan Kode Anonim (opsional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2 text-slate-700 dark:text-slate-300">
              <div className="font-semibold">Format header yang didukung:</div>
              <div className="font-mono text-[11px]">
                Nama Menu, Kode Anonim, SKU, Kategori, Grup Produk, Satuan, Harga Jual, HPP, Catatan
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="h-8 text-xs gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Unduh Template CSV</span>
              </Button>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-700 dark:text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-medium file:bg-white file:text-slate-700 hover:file:bg-slate-50"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={updateExistingCsv}
                onChange={(e) => setUpdateExistingCsv(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Perbarui harga &amp; HPP jika nama menu sudah ada</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportCsvOpen(false)}
              disabled={csvImportMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => csvImportMutation.mutate()}
              disabled={!csvFile || csvImportMutation.isPending}
            >
              {csvImportMutation.isPending ? "Mengimpor..." : "Import Sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Anonymize Codes Dialog */}
      <Dialog open={anonymizeDialogOpen} onOpenChange={setAnonymizeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Atur Kode Nama Anonim</DialogTitle>
            <DialogDescription>
              Buat atau perbarui kode anonim berurutan untuk seluruh menu di database (contoh: MENU-001, MENU-002).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="anon-prefix" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Prefix Kode Anonim
              </label>
              <Input
                id="anon-prefix"
                value={anonPrefix}
                onChange={(e) => setAnonPrefix(e.target.value)}
                placeholder="MENU"
                className="h-9 text-xs font-mono uppercase"
                maxLength={20}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveCustomAnon}
                onChange={(e) => setPreserveCustomAnon(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Pertahankan kode anonim yang sudah ada (hanya isi yang kosong)</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAnonymizeDialogOpen(false)}
              disabled={batchAnonMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => batchAnonMutation.mutate()}
              disabled={!anonPrefix.trim() || batchAnonMutation.isPending}
            >
              {batchAnonMutation.isPending ? "Memproses..." : "Terapkan Kode Anonim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Anonymized Read-Only Link Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Link Presentasi Anonim (Read-Only)</DialogTitle>
            <DialogDescription>
              Bagikan data menu, HPP, dan Food Cost % ke pihak luar tanpa membocorkan nama menu asli, SKU, atau nama bahan baku.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="share-expiry" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Masa Berlaku Link
              </label>
              <select
                id="share-expiry"
                value={shareExpireHours}
                onChange={(e) => setShareExpireHours(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
              >
                <option value={24}>24 Jam (1 Hari)</option>
                <option value={72}>72 Jam (3 Hari)</option>
                <option value={168}>168 Jam (7 Hari)</option>
              </select>
            </div>

            {generatedShareUrl && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30 p-3 space-y-2">
                <div className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Link Read-Only Siap Dibagikan</span>
                </div>
                <Input
                  readOnly
                  value={generatedShareUrl}
                  className="h-8 text-[11px] font-mono bg-white dark:bg-slate-900"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(generatedShareUrl);
                    toast.success("Link presentasi disalin.");
                  }}
                  className="h-8 text-xs gap-1.5 w-full"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Link</span>
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShareDialogOpen(false)}
            >
              Tutup
            </Button>
            <Button
              type="button"
              onClick={() => shareTokenMutation.mutate()}
              disabled={shareTokenMutation.isPending}
            >
              {shareTokenMutation.isPending ? "Membuat..." : "Generate Link Anonim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkRowImportDialog<BulkMenuRow>
        isOpen={bulkFormOpen}
        onClose={() => setBulkFormOpen(false)}
        title="Tambah Menu Produk Masal (Form Tabel)"
        description="Input banyak menu sekaligus atau tempel (paste) baris data dari Excel/Google Sheets. Resep bahan bisa dilengkapi kemudian pada masing-masing menu."
        columns={menuBulkColumns}
        createEmptyRow={createEmptyMenuRow}
        requiredKey="name"
        showUpdateExistingToggle={true}
        isSubmitting={bulkFormCreateMutation.isPending}
        submitLabel="Simpan Semua Menu"
        onSubmit={async (rows, updateExisting) => {
          await bulkFormCreateMutation.mutateAsync({ rows, updateExisting });
        }}
      />
    </div>
  );
};
