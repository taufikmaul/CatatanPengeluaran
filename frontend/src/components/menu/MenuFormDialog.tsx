import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { formatRupiah } from "@/lib/formatters";
import { getMenuConversionHint } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  BatchCostCategory,
  IngredientCostGroup,
  MasterDataOption,
  MasterItem,
  MenuBatchCostItemInput,
  MenuHppMode,
  MenuIngredientInput,
  MenuItemType,
  MenuProduct,
  MenuProductPayload,
  PricingChannelConfig,
} from "@/types";
import {
  ArrowRightLeft,
  Calculator,
  ChevronDown,
  ChevronRight,
  Layers,
  Package,
  Percent,
  Plus,
  Settings2,
  Tags,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  QuickAddSelection,
  RecipeQuickAddAutocomplete,
} from "./RecipeQuickAddAutocomplete";

function roundMenuPrice(raw: number): number {
  return raw >= 500 ? Math.round(raw / 500) * 500 : Math.round(raw);
}

interface IngredientDraftRow {
  key: string;
  cost_group: IngredientCostGroup;
  master_item_id: number | null;
  sub_menu_id: number | null;
  include_sub_packaging: boolean;
  ingredient_name: string;
  qty: string;
  unit: string;
  waste_pct: string;
  unit_cost_override: string;
  yield_factor: string;
  notes: string;
  conversion_hint?: string;
  price_drift_alert?: boolean;
  price_change_pct?: number | null;
  master_prev_price?: number | null;
  drift_source?: string | null;
}

interface BatchCostDraftRow {
  key: string;
  category: BatchCostCategory;
  name: string;
  amount: string;
}

function createBatchCostRow(
  category: BatchCostCategory = "labor",
  name = "",
  amount = ""
): BatchCostDraftRow {
  return {
    key: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    name,
    amount,
  };
}

interface MenuFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingMenu: MenuProduct | null;
  masterItems: MasterItem[];
  allMenus?: MenuProduct[];
  pricingChannels?: PricingChannelConfig[];
  defaultItemType?: MenuItemType;
  isAdmin?: boolean;
  onOpenChannelSettings?: () => void;
  menuCategories?: MasterDataOption[];
  onOpenCategoryManager?: () => void;
  pendingCategorySelection?: string | null;
  onConsumePendingCategory?: () => void;
  units: string[];
  existingCategories: string[];
  isSubmitting: boolean;
  onSubmit: (payload: MenuProductPayload) => void;
}

interface IngredientRowCardProps {
  row: IngredientDraftRow;
  cost: number;
  sourceUnitPrice: number;
  sourceLabel: string;
  isSubMenu: boolean;
  subMenuType?: MenuItemType;
  isRecentlyAdded?: boolean;
  allowToggleCostGroup?: boolean;
  isInvalidForBundle?: boolean;
  unitOptions: string[];
  onUpdateRow: (rowKey: string, patch: Partial<IngredientDraftRow>) => void;
  onUnitChange: (
    rowKey: string,
    newUnit: string,
    masterId: number | null,
    subMenuId: number | null
  ) => void;
  onToggleCostGroup: (rowKey: string) => void;
  onRemove: (rowKey: string) => void;
}

const IngredientRowCard: React.FC<IngredientRowCardProps> = ({
  row,
  cost,
  sourceUnitPrice,
  sourceLabel,
  isSubMenu,
  subMenuType,
  isRecentlyAdded = false,
  allowToggleCostGroup = true,
  isInvalidForBundle = false,
  unitOptions,
  onUpdateRow,
  onUnitChange,
  onToggleCostGroup,
  onRemove,
}) => {
  const isPackaging = row.cost_group === "packaging";

  return (
    <div
      className={cn(
        "py-2.5 space-y-2 transition-colors",
        isInvalidForBundle
          ? "bg-rose-50/40 dark:bg-rose-950/20 px-2 rounded"
          : isRecentlyAdded
          ? "bg-muted/40 px-2 rounded"
          : ""
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 shrink-0"
          >
            {isInvalidForBundle ? `${sourceLabel} (Tidak Valid)` : sourceLabel}
          </Badge>
          <Input
            value={row.ingredient_name}
            onChange={(e) =>
              onUpdateRow(row.key, { ingredient_name: e.target.value })
            }
            aria-label={
              isPackaging
                ? `Nama kemasan ${row.ingredient_name || ""}`.trim()
                : `Nama bahan ${row.ingredient_name || ""}`.trim()
            }
            placeholder={isPackaging ? "Contoh: Box Mika 20cm" : "Nama bahan resep"}
            className="h-8 text-xs font-medium flex-1 min-w-0"
          />
        </div>

        <div className="flex items-center justify-end gap-1 shrink-0">
          {allowToggleCostGroup && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onToggleCostGroup(row.key)}
              aria-label={
                isPackaging
                  ? `Pindahkan ${row.ingredient_name || "item"} ke Bahan Resep`
                  : `Pindahkan ${row.ingredient_name || "item"} ke Kemasan`
              }
              className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowRightLeft className="w-3 h-3 shrink-0" />
              <span>{isPackaging ? "Ke Bahan" : "Ke Kemasan"}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(row.key)}
            aria-label={`Hapus ${row.ingredient_name || "baris"}`}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-start">
        <div className="col-span-1 sm:col-span-2">
          <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">
            Takaran
          </label>
          <Input
            type="number"
            min={0}
            step="any"
            value={row.qty}
            onChange={(e) => onUpdateRow(row.key, { qty: e.target.value })}
            className="h-8 text-xs tabular-nums"
          />
        </div>

        <div className="col-span-1 sm:col-span-2">
          <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">
            Satuan
          </label>
          <AdaptiveSelect
            value={row.unit}
            onValueChange={(nextUnit) =>
              onUnitChange(
                row.key,
                nextUnit,
                row.master_item_id,
                row.sub_menu_id
              )
            }
            options={unitOptions}
            creatable={true}
            creatablePrefix="Satuan"
            placeholder="Satuan..."
            searchPlaceholder="Cari satuan..."
            triggerClassName="h-8"
          />
        </div>

        <div className="col-span-1 sm:col-span-2">
          <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">
            Pembagi (Yield)
          </label>
          <Input
            type="number"
            min={0.0001}
            step="any"
            value={row.yield_factor}
            onChange={(e) =>
              onUpdateRow(row.key, { yield_factor: e.target.value })
            }
            className="h-8 text-xs tabular-nums"
          />
          {row.conversion_hint && (
            <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
              {row.conversion_hint}
            </div>
          )}
        </div>

        {!isPackaging && (
          <div className="col-span-1 sm:col-span-2">
            <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">
              Susut Prep
            </label>
            <InputGroup className="h-8">
              <InputGroupInput
                type="number"
                min={0}
                max={99}
                step="any"
                value={row.waste_pct}
                onChange={(e) =>
                  onUpdateRow(row.key, { waste_pct: e.target.value })
                }
                className="text-xs tabular-nums"
              />
              <InputGroupAddon align="inline-end" className="pr-2">
                <InputGroupText className="text-[11px]">%</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </div>
        )}

        <div
          className={
            isPackaging ? "col-span-2 sm:col-span-3" : "col-span-2 sm:col-span-2"
          }
        >
          <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">
            Override Harga
          </label>
          <InputGroup className="h-8">
            <InputGroupAddon align="inline-start" className="pl-2 pr-1">
              <InputGroupText className="text-[11px]">Rp</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="number"
              min={0}
              step="any"
              value={row.unit_cost_override}
              onChange={(e) =>
                onUpdateRow(row.key, { unit_cost_override: e.target.value })
              }
              placeholder={
                sourceUnitPrice > 0
                  ? `${formatRupiah(sourceUnitPrice)}`
                  : "Auto"
              }
              className="text-xs tabular-nums pl-1"
            />
          </InputGroup>
        </div>

        <div
          className={`${
            isPackaging ? "col-span-2 sm:col-span-3" : "col-span-2 sm:col-span-2"
          } flex flex-col items-start sm:items-end justify-center gap-0.5 pt-1 sm:pt-4`}
        >
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[11px] text-muted-foreground">Subtotal:</span>
            <span className="font-semibold text-foreground tabular-nums">
              {formatRupiah(cost)}
            </span>
          </div>
          {row.price_drift_alert &&
            row.price_change_pct !== null &&
            row.price_change_pct !== undefined && (
              <div className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span>
                  Naik +{row.price_change_pct}%
                  {row.drift_source ? ` (via ${row.drift_source})` : ""}
                </span>
              </div>
            )}
        </div>
      </div>

      {isSubMenu && (
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="inline-flex items-center gap-1.5 font-medium">
            <Layers className="w-3.5 h-3.5" />
            <span>
              Tipe:{" "}
              {subMenuType === "prepared"
                ? "Prepared / Sub-Resep"
                : subMenuType === "bundle"
                ? "Paket Bundling"
                : "Menu Jual"}
            </span>
          </div>
          <label className="inline-flex items-center gap-1.5 text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={row.include_sub_packaging}
              onChange={(e) =>
                onUpdateRow(row.key, {
                  include_sub_packaging: e.target.checked,
                })
              }
              className="h-3.5 w-3.5 rounded border-input"
            />
            <span>Sertakan kemasan sub-produk</span>
          </label>
        </div>
      )}
    </div>
  );
};

export const MenuFormDialog: React.FC<MenuFormDialogProps> = ({
  open,
  onOpenChange,
  editingMenu,
  masterItems,
  allMenus = [],
  pricingChannels = [],
  defaultItemType = "finished",
  isAdmin = false,
  onOpenChannelSettings,
  menuCategories = [],
  onOpenCategoryManager,
  pendingCategorySelection = null,
  onConsumePendingCategory,
  units,
  existingCategories,
  isSubmitting,
  onSubmit,
}) => {
  const [itemType, setItemType] = useState<MenuItemType>("finished");
  const [isSellable, setIsSellable] = useState(true);
  const [name, setName] = useState("");
  const [anonymousName, setAnonymousName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("Cake Ready");
  const [productGroup, setProductGroup] = useState("");
  const [unit, setUnit] = useState("Porsi");

  const [batchYieldQty, setBatchYieldQty] = useState("1");
  const [batchYieldUnit, setBatchYieldUnit] = useState("Porsi");
  const [wasteLossPct, setWasteLossPct] = useState("0");
  const [showBatchOptions, setShowBatchOptions] = useState(false);

  const [shelfLifeDays, setShelfLifeDays] = useState("");
  const [storageMethod, setStorageMethod] = useState("");

  const [sellingPrice, setSellingPrice] = useState("");
  const [targetFoodCostPct, setTargetFoodCostPct] = useState("");
  const [hppManual, setHppManual] = useState("");
  const [hppMode, setHppMode] = useState<MenuHppMode>("auto");

  const [batchCostRows, setBatchCostRows] = useState<BatchCostDraftRow[]>([
    createBatchCostRow("labor", "", ""),
    createBatchCostRow("operational", "", ""),
  ]);

  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [ingredients, setIngredients] = useState<IngredientDraftRow[]>([]);
  const [showChannelPricing, setShowChannelPricing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastAddedNotice, setLastAddedNotice] = useState<{
    label: string;
    group: IngredientCostGroup;
  } | null>(null);
  const [recentlyAddedKey, setRecentlyAddedKey] = useState<string | null>(null);
  const recentTimerRef = useRef<number | null>(null);

  const flashRowHighlight = (rowKey: string) => {
    setRecentlyAddedKey(rowKey);
    if (recentTimerRef.current !== null) {
      window.clearTimeout(recentTimerRef.current);
    }
    recentTimerRef.current = window.setTimeout(() => {
      setRecentlyAddedKey((cur) => (cur === rowKey ? null : cur));
      recentTimerRef.current = null;
    }, 1300);
  };

  useEffect(() => {
    return () => {
      if (recentTimerRef.current !== null) {
        window.clearTimeout(recentTimerRef.current);
      }
    };
  }, []);

  const activeMasterCategories = useMemo(() => {
    if (menuCategories.length > 0) {
      return [...menuCategories]
        .filter((c) => c.is_active)
        .sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            a.name.localeCompare(b.name, "id")
        );
    }
    const fallback =
      existingCategories.length > 0
        ? existingCategories
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
    return fallback.map((catName, idx) => ({
      id: -(idx + 1),
      type: "kategori_menu" as const,
      name: catName,
      description: "",
      sort_order: idx + 1,
      is_active: true,
      is_default: idx === 0,
      usage_count: 0,
    }));
  }, [menuCategories, existingCategories]);

  const categorySelectOptions = useMemo(() => {
    const names = activeMasterCategories.map((c) => c.name);
    const seen = new Set(names.map((n) => n.toLowerCase()));
    const merged = [...names];
    for (const ext of existingCategories) {
      if (ext && !seen.has(ext.toLowerCase())) {
        seen.add(ext.toLowerCase());
        merged.push(ext);
      }
    }
    const cur = category.trim();
    if (cur && !seen.has(cur.toLowerCase())) {
      merged.unshift(cur);
    }
    return merged;
  }, [activeMasterCategories, existingCategories, category]);

  const getDefaultCategoryForType = (typeVal: MenuItemType): string => {
    if (typeVal === "prepared") {
      const prepMatch = activeMasterCategories.find((c) =>
        c.name.toLowerCase().includes("prepared")
      );
      return prepMatch?.name || "Prepared / Sub-Resep";
    }
    if (typeVal === "bundle") {
      const bundleMatch = activeMasterCategories.find(
        (c) =>
          c.name.toLowerCase().includes("hampers") ||
          c.name.toLowerCase().includes("bundl")
      );
      return bundleMatch?.name || "Hampers / Bundling";
    }
    const explicitDefault = activeMasterCategories.find((c) => c.is_default);
    return (
      explicitDefault?.name ||
      activeMasterCategories[0]?.name ||
      existingCategories[0] ||
      "Cake Ready"
    );
  };

  const masterMap = useMemo(() => {
    const map = new Map<number, MasterItem>();
    for (const m of masterItems) map.set(m.id, m);
    return map;
  }, [masterItems]);

  const subMenuMap = useMemo(() => {
    const map = new Map<number, MenuProduct>();
    for (const m of allMenus) map.set(m.id, m);
    return map;
  }, [allMenus]);

  const { existingMasterCounts, existingSubMenuCounts } = useMemo(() => {
    const masterCounts = new Map<number, number>();
    const subCounts = new Map<number, number>();
    for (const row of ingredients) {
      if (row.master_item_id !== null) {
        masterCounts.set(
          row.master_item_id,
          (masterCounts.get(row.master_item_id) || 0) + 1
        );
      }
      if (row.sub_menu_id !== null) {
        subCounts.set(
          row.sub_menu_id,
          (subCounts.get(row.sub_menu_id) || 0) + 1
        );
      }
    }
    return {
      existingMasterCounts: masterCounts,
      existingSubMenuCounts: subCounts,
    };
  }, [ingredients]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setShowChannelPricing(false);
    setLastAddedNotice(null);
    setRecentlyAddedKey(null);
    if (editingMenu) {
      const t = editingMenu.item_type || "finished";
      setItemType(t);
      setIsSellable(editingMenu.is_sellable ?? t !== "prepared");
      setName(editingMenu.name);
      setAnonymousName(editingMenu.anonymous_name || "");
      setSku(editingMenu.sku || "");
      setCategory(editingMenu.category || "Lainnya");
      setProductGroup(editingMenu.product_group || "");
      setUnit(editingMenu.unit || "Porsi");
      setBatchYieldQty(String(editingMenu.batch_yield_qty || 1));
      setBatchYieldUnit(editingMenu.batch_yield_unit || editingMenu.unit || "Porsi");
      setWasteLossPct(String(editingMenu.waste_loss_pct || 0));
      setShowBatchOptions(
        t === "prepared" ||
          (editingMenu.batch_yield_qty || 1) !== 1 ||
          (editingMenu.waste_loss_pct || 0) > 0
      );
      setShelfLifeDays(
        editingMenu.shelf_life_days !== null &&
          editingMenu.shelf_life_days !== undefined
          ? String(editingMenu.shelf_life_days)
          : ""
      );
      setStorageMethod(editingMenu.storage_method || "");
      setSellingPrice(String(editingMenu.selling_price || 0));
      setTargetFoodCostPct(
        editingMenu.target_food_cost_pct !== null &&
          editingMenu.target_food_cost_pct !== undefined
          ? String(editingMenu.target_food_cost_pct)
          : ""
      );
      setHppManual(String(editingMenu.hpp_manual || 0));
      setHppMode(editingMenu.hpp_mode || "auto");
      if (
        Array.isArray(editingMenu.batch_cost_items) &&
        editingMenu.batch_cost_items.length > 0
      ) {
        setBatchCostRows(
          editingMenu.batch_cost_items.map((bc, idx) =>
            createBatchCostRow(
              bc.category === "labor" ? "labor" : "operational",
              bc.name ||
                (bc.category === "labor"
                  ? `Tenaga Kerja #${idx + 1}`
                  : `Biaya Operasional #${idx + 1}`),
              bc.amount ? String(bc.amount) : ""
            )
          )
        );
      } else {
        const legacyRows: BatchCostDraftRow[] = [];
        if (editingMenu.labor_cost && editingMenu.labor_cost > 0) {
          legacyRows.push(
            createBatchCostRow(
              "labor",
              "Tenaga Kerja (Labor)",
              String(editingMenu.labor_cost)
            )
          );
        }
        if (
          (editingMenu.other_fee && editingMenu.other_fee > 0) ||
          (editingMenu.other_fee_description &&
            editingMenu.other_fee_description.trim() !== "")
        ) {
          legacyRows.push(
            createBatchCostRow(
              "operational",
              editingMenu.other_fee_description || "Biaya Operasional Batch",
              editingMenu.other_fee ? String(editingMenu.other_fee) : ""
            )
          );
        }
        if (legacyRows.length === 0) {
          legacyRows.push(
            createBatchCostRow("labor", "", ""),
            createBatchCostRow("operational", "", "")
          );
        }
        setBatchCostRows(legacyRows);
      }
      setNotes(editingMenu.notes || "");
      setIsActive(editingMenu.is_active);
      setIngredients(
        (editingMenu.ingredients || []).map((ing, idx) => ({
          key: `${ing.id || idx}-${Date.now()}`,
          cost_group: ing.cost_group || "ingredient",
          master_item_id: ing.master_item_id ?? null,
          sub_menu_id: ing.sub_menu_id ?? null,
          include_sub_packaging: Boolean(ing.include_sub_packaging),
          ingredient_name: ing.ingredient_name,
          qty: String(ing.qty ?? 1),
          unit: ing.unit || (ing.cost_group === "packaging" ? "Pcs" : "Gram"),
          waste_pct: String(ing.waste_pct ?? 0),
          unit_cost_override:
            ing.unit_cost_override !== null &&
            ing.unit_cost_override !== undefined
              ? String(ing.unit_cost_override)
              : "",
          yield_factor: String(ing.yield_factor ?? 1),
          notes: ing.notes || "",
          price_drift_alert: ing.price_drift_alert,
          price_change_pct: ing.price_change_pct,
          master_prev_price: ing.master_prev_price,
          drift_source: ing.drift_source,
        }))
      );
    } else {
      const initType = defaultItemType || "finished";
      const initUnit =
        initType === "prepared"
          ? "Gram"
          : initType === "bundle"
          ? "Paket"
          : "Porsi";
      setItemType(initType);
      setIsSellable(initType !== "prepared");
      setName("");
      setAnonymousName("");
      setSku("");
      setCategory(getDefaultCategoryForType(initType));
      setProductGroup("");
      setUnit(initUnit);
      setBatchYieldQty(initType === "prepared" ? "1000" : "1");
      setBatchYieldUnit(initUnit);
      setWasteLossPct("0");
      setShowBatchOptions(initType === "prepared");
      setShelfLifeDays("");
      setStorageMethod("");
      setSellingPrice("");
      setTargetFoodCostPct("");
      setHppManual("");
      setHppMode("auto");
      setBatchCostRows([
        createBatchCostRow("labor", "", ""),
        createBatchCostRow("operational", "", ""),
      ]);
      setNotes("");
      setIsActive(true);
      setIngredients([]);
    }
    // Intentionally omit category lists so background refetches never reset unsaved form drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingMenu, defaultItemType]);

  useEffect(() => {
    if (open && pendingCategorySelection) {
      setCategory(pendingCategorySelection);
      onConsumePendingCategory?.();
    }
  }, [open, pendingCategorySelection, onConsumePendingCategory]);

  const handleSelectItemType = (nextType: MenuItemType) => {
    setItemType(nextType);
    if (!editingMenu) {
      const typeDefaults = new Set(
        (["finished", "prepared", "bundle"] as MenuItemType[]).map((t) =>
          getDefaultCategoryForType(t).toLowerCase()
        )
      );
      if (typeDefaults.has(category.trim().toLowerCase())) {
        setCategory(getDefaultCategoryForType(nextType));
      }
      if (nextType === "prepared") {
        setIsSellable(false);
        setShowBatchOptions(true);
        if (unit === "Porsi" || unit === "Paket") {
          setUnit("Gram");
          setBatchYieldUnit("Gram");
        }
        if (batchYieldQty === "1") setBatchYieldQty("1000");
      } else if (nextType === "bundle") {
        setIsSellable(true);
        setShowBatchOptions(false);
        setBatchYieldQty("1");
        if (unit === "Porsi" || unit === "Gram") {
          setUnit("Paket");
          setBatchYieldUnit("Paket");
        }
      } else {
        setIsSellable(true);
        setBatchYieldQty("1");
        if (unit === "Gram" || unit === "Paket") {
          setUnit("Porsi");
          setBatchYieldUnit("Porsi");
        }
      }
    } else if (nextType !== "prepared" && !isSellable) {
      setIsSellable(true);
    }
  };

  const batchYieldNum = Math.max(0.0001, Number(batchYieldQty) || 1);
  const wasteLossNum = Math.min(99, Math.max(0, Number(wasteLossPct) || 0));
  const netYieldQty = Math.max(
    0.0001,
    batchYieldNum * (1 - wasteLossNum / 100)
  );

  const recipeSummary = useMemo(() => {
    let rawBatchIngredients = 0;
    let subtotalPackaging = 0;

    const rowMap = new Map<
      string,
      { sourceUnitPrice: number; cost: number }
    >();

    for (const row of ingredients) {
      const qtyNum = Math.max(0, Number(row.qty) || 0);
      const yieldNum = Math.max(0.0001, Number(row.yield_factor) || 1);
      const rowWaste = Math.min(99, Math.max(0, Number(row.waste_pct) || 0));
      const effectiveQty =
        rowWaste > 0 ? qtyNum / (1 - rowWaste / 100) : qtyNum;

      const overrideVal =
        row.unit_cost_override.trim() !== ""
          ? Number(row.unit_cost_override)
          : null;

      let sourceUnitPrice = 0;
      if (row.sub_menu_id !== null) {
        const sub = subMenuMap.get(row.sub_menu_id);
        if (sub) {
          sourceUnitPrice = row.include_sub_packaging
            ? Number(sub.effective_hpp || 0)
            : Number(sub.core_unit_hpp ?? sub.effective_hpp ?? 0);
        }
      } else if (row.master_item_id !== null) {
        sourceUnitPrice = Number(
          masterMap.get(row.master_item_id)?.last_unit_price || 0
        );
      }

      const unitCost =
        overrideVal !== null && !Number.isNaN(overrideVal)
          ? overrideVal
          : sourceUnitPrice;
      const cost = (effectiveQty / yieldNum) * unitCost;
      rowMap.set(row.key, { sourceUnitPrice, cost });

      if (row.cost_group === "packaging") {
        subtotalPackaging += cost;
      } else {
        rawBatchIngredients += cost;
      }
    }

    let laborNum = 0;
    let otherFeeNum = 0;
    const activeBatchCostItems: Array<{
      key: string;
      category: BatchCostCategory;
      name: string;
      amount: number;
      unitAmount: number;
    }> = [];

    for (const bc of batchCostRows) {
      const amt = Math.max(0, Number(bc.amount) || 0);
      const cleanLabel = bc.name.trim();
      if (bc.category === "labor") {
        laborNum += amt;
      } else {
        otherFeeNum += amt;
      }
      if (amt > 0 || cleanLabel !== "") {
        activeBatchCostItems.push({
          key: bc.key,
          category: bc.category,
          name:
            cleanLabel ||
            (bc.category === "labor"
              ? "Tenaga Kerja (Labor)"
              : "Biaya Operasional Batch"),
          amount: amt,
          unitAmount: amt / netYieldQty,
        });
      }
    }

    const unitIngredientCost = rawBatchIngredients / netYieldQty;
    const unitLaborCost = laborNum / netYieldQty;
    const unitOtherFee = otherFeeNum / netYieldQty;
    const coreUnitHpp = unitIngredientCost + unitLaborCost + unitOtherFee;
    const totalRecipeHpp = coreUnitHpp + subtotalPackaging;

    return {
      rawBatchIngredients,
      unitIngredientCost,
      subtotalPackaging,
      laborNum,
      otherFeeNum,
      unitLaborCost,
      unitOtherFee,
      activeBatchCostItems,
      coreUnitHpp,
      total: totalRecipeHpp,
      rowMap,
    };
  }, [ingredients, masterMap, subMenuMap, batchCostRows, netYieldQty]);

  const sellingPriceNum = isSellable ? Math.max(0, Number(sellingPrice) || 0) : 0;
  const hppManualNum = Math.max(0, Number(hppManual) || 0);
  const hasRecipeData =
    ingredients.length > 0 ||
    recipeSummary.otherFeeNum > 0 ||
    recipeSummary.laborNum > 0;

  const effectiveHpp = useMemo(() => {
    if (hppMode === "manual") return hppManualNum;
    if (hppMode === "recipe") return recipeSummary.total;
    return hasRecipeData ? recipeSummary.total : hppManualNum;
  }, [hppMode, hppManualNum, recipeSummary.total, hasRecipeData]);

  const foodCostPct =
    isSellable && sellingPriceNum > 0 ? (effectiveHpp / sellingPriceNum) * 100 : 0;
  const pureFoodCostPct =
    isSellable && sellingPriceNum > 0
      ? (recipeSummary.unitIngredientCost / sellingPriceNum) * 100
      : 0;
  const packagingCostPct =
    isSellable && sellingPriceNum > 0
      ? (recipeSummary.subtotalPackaging / sellingPriceNum) * 100
      : 0;
  const grossMargin = isSellable ? sellingPriceNum - effectiveHpp : 0;

  const targetFcNum = Number(targetFoodCostPct);
  const suggestedTargetPrice =
    isSellable &&
    targetFoodCostPct.trim() !== "" &&
    !Number.isNaN(targetFcNum) &&
    targetFcNum > 0 &&
    targetFcNum < 95 &&
    effectiveHpp > 0
      ? roundMenuPrice(effectiveHpp / (targetFcNum / 100))
      : null;

  const channelAnalysis = useMemo(() => {
    if (!isSellable || effectiveHpp <= 0 || pricingChannels.length === 0) {
      return [];
    }
    const desiredMarginPct =
      targetFcNum > 0 && targetFcNum < 95
        ? 100 - targetFcNum
        : sellingPriceNum > 0 && grossMargin > 0
        ? (grossMargin / sellingPriceNum) * 100
        : 65;

    return pricingChannels.map((ch) => {
      const commission =
        sellingPriceNum * (ch.commission_pct / 100) + (ch.fixed_fee || 0);
      const netReceived = Math.max(0, sellingPriceNum - commission);
      const totalChannelCost = effectiveHpp + (ch.extra_packaging || 0);
      const netMargin = netReceived - totalChannelCost;
      const netMarginPct =
        sellingPriceNum > 0 ? (netMargin / sellingPriceNum) * 100 : 0;
      const denom = 1 - ch.commission_pct / 100 - desiredMarginPct / 100;
      let suggestedPrice: number | null = null;
      if (denom > 0.05) {
        const raw = (totalChannelCost + (ch.fixed_fee || 0)) / denom;
        suggestedPrice = roundMenuPrice(raw);
      }
      return {
        ...ch,
        commission,
        netReceived,
        netMargin,
        netMarginPct,
        suggestedPrice,
      };
    });
  }, [
    isSellable,
    effectiveHpp,
    pricingChannels,
    sellingPriceNum,
    grossMargin,
    targetFcNum,
  ]);

  const applyConversionHint = async (
    rowKey: string,
    source: { masterId?: number | null; subMenuId?: number | null },
    recipeUnit: string
  ) => {
    if (!source.masterId && !source.subMenuId) return;
    try {
      const res = await getMenuConversionHint({
        masterItemId: source.masterId,
        subMenuId: source.subMenuId,
        recipeUnit,
      });
      setIngredients((prev) =>
        prev.map((r) =>
          r.key === rowKey &&
          r.master_item_id === (source.masterId ?? null) &&
          r.sub_menu_id === (source.subMenuId ?? null)
            ? {
                ...r,
                yield_factor: String(res.yield_factor),
                conversion_hint: res.reason,
              }
            : r
        )
      );
    } catch {
      // Abaikan bila offline; user tetap bisa mengisi pembagi manual
    }
  };

  const handleUpdateRow = (
    rowKey: string,
    patch: Partial<IngredientDraftRow>
  ) => {
    setIngredients((prev) =>
      prev.map((r) => (r.key === rowKey ? { ...r, ...patch } : r))
    );
  };

  const handleUpdateBatchCostRow = (
    rowKey: string,
    patch: Partial<BatchCostDraftRow>
  ) => {
    setBatchCostRows((prev) =>
      prev.map((r) => (r.key === rowKey ? { ...r, ...patch } : r))
    );
  };

  const handleAddBatchCostRow = (
    category: BatchCostCategory = "operational",
    defaultName = ""
  ) => {
    const newRow = createBatchCostRow(category, defaultName, "");
    setBatchCostRows((prev) => [...prev, newRow]);
    flashRowHighlight(newRow.key);
  };

  const handleRemoveBatchCostRow = (rowKey: string) => {
    setBatchCostRows((prev) => {
      if (prev.length <= 1) {
        return prev.map((r) =>
          r.key === rowKey ? { ...r, name: "", amount: "" } : r
        );
      }
      return prev.filter((r) => r.key !== rowKey);
    });
  };

  const handleQuickAddItem = (selection: QuickAddSelection) => {
    const newKey = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setFormError(null);

    if (selection.kind === "master") {
      const item = selection.item;
      const effectiveGroup: IngredientCostGroup =
        itemType === "bundle" ? "packaging" : selection.targetGroup;
      const hasMasterRecipe = Boolean(
        item.satuan_resep &&
          item.konversi_resep !== null &&
          item.konversi_resep !== undefined &&
          item.konversi_resep > 0
      );
      const nextUnit =
        item.satuan_resep ||
        item.satuan_ecer ||
        item.satuan_beli ||
        (effectiveGroup === "packaging" ? "Pcs" : "Gram");

      const newRow: IngredientDraftRow = {
        key: newKey,
        cost_group: effectiveGroup,
        master_item_id: item.id,
        sub_menu_id: null,
        include_sub_packaging: false,
        ingredient_name: item.item_name,
        qty: "1",
        unit: nextUnit,
        waste_pct: "0",
        unit_cost_override: "",
        yield_factor: hasMasterRecipe ? String(item.konversi_resep) : "1",
        notes: "",
        conversion_hint: hasMasterRecipe
          ? `Master Resep: 1 ${item.satuan_beli || "unit"} = ${item.konversi_resep} ${item.satuan_resep}`
          : undefined,
      };

      setIngredients((prev) => [...prev, newRow]);
      flashRowHighlight(newKey);
      setLastAddedNotice({
        label: item.item_name,
        group: effectiveGroup,
      });
      if (!hasMasterRecipe) {
        void applyConversionHint(newKey, { masterId: item.id }, nextUnit);
      }
      return;
    }

    if (selection.kind === "submenu") {
      const sub = selection.menu;
      const subType = sub.item_type || "finished";
      if (itemType === "bundle" && subType !== "finished") {
        setFormError(
          `Paket / Hampers hanya dapat disusun dari Menu Jual yang sudah jadi. "${sub.name}" bertipe ${
            subType === "prepared" ? "Prepared (1/2 jadi)" : "Paket / Bundling"
          }.`
        );
        return;
      }
      if (itemType !== "bundle" && subType !== "prepared") {
        setFormError(
          `Resep ${
            itemType === "prepared" ? "Prepared / Setengah Jadi" : "Menu Jual"
          } tidak boleh disusun dari Menu Jual atau Paket. Hanya Bahan, Kemasan, dan Menu Prepared yang diperbolehkan. "${sub.name}" bertipe ${
            subType === "finished" ? "Menu Jual" : "Paket / Bundling"
          }.`
        );
        return;
      }
      const effectiveGroup: IngredientCostGroup =
        itemType === "bundle" ? "ingredient" : selection.targetGroup;
      const nextUnit = sub.batch_yield_unit || sub.unit || "Porsi";
      const defaultIncludePkg = subType !== "prepared";

      const newRow: IngredientDraftRow = {
        key: newKey,
        cost_group: effectiveGroup,
        master_item_id: null,
        sub_menu_id: sub.id,
        include_sub_packaging: defaultIncludePkg,
        ingredient_name: sub.name,
        qty: "1",
        unit: nextUnit,
        waste_pct: "0",
        unit_cost_override: "",
        yield_factor: "1",
        notes: "",
        price_drift_alert: sub.has_price_drift || false,
        price_change_pct: sub.max_ingredient_increase_pct ?? null,
        drift_source: sub.has_price_drift ? sub.name : null,
      };

      setIngredients((prev) => [...prev, newRow]);
      flashRowHighlight(newKey);
      setLastAddedNotice({
        label: sub.name,
        group: effectiveGroup,
      });
      void applyConversionHint(newKey, { subMenuId: sub.id }, nextUnit);
      return;
    }

    const cleanName = selection.name.trim();
    if (!cleanName) return;

    const effectiveGroup: IngredientCostGroup =
      itemType === "bundle" ? "packaging" : selection.targetGroup;

    const manualRow: IngredientDraftRow = {
      key: newKey,
      cost_group: effectiveGroup,
      master_item_id: null,
      sub_menu_id: null,
      include_sub_packaging: false,
      ingredient_name: cleanName,
      qty: "1",
      unit: effectiveGroup === "packaging" ? "Pcs" : "Gram",
      waste_pct: "0",
      unit_cost_override: "",
      yield_factor: "1",
      notes: "",
    };

    setIngredients((prev) => [...prev, manualRow]);
    flashRowHighlight(newKey);
    setLastAddedNotice({
      label: cleanName,
      group: effectiveGroup,
    });
  };

  const handleToggleCostGroup = (rowKey: string) => {
    if (itemType === "bundle") return;
    setIngredients((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? {
              ...r,
              cost_group: r.cost_group === "packaging" ? "ingredient" : "packaging",
            }
          : r
      )
    );
    flashRowHighlight(rowKey);
  };

  const handleUnitChange = (
    rowKey: string,
    newUnit: string,
    masterId: number | null,
    subMenuId: number | null
  ) => {
    handleUpdateRow(rowKey, { unit: newUnit });
    if ((masterId || subMenuId) && newUnit.trim()) {
      void applyConversionHint(
        rowKey,
        { masterId, subMenuId },
        newUnit.trim()
      );
    }
  };

  const isBundle = itemType === "bundle";

  const ingredientRows = useMemo(
    () => ingredients.filter((r) => r.cost_group !== "packaging"),
    [ingredients]
  );
  const packagingRows = useMemo(
    () => ingredients.filter((r) => r.cost_group === "packaging"),
    [ingredients]
  );

  const invalidBundleRowKeys = useMemo(() => {
    const invalid = new Set<string>();
    for (const row of ingredients) {
      const hasContent =
        row.ingredient_name.trim() !== "" ||
        row.master_item_id !== null ||
        row.sub_menu_id !== null;
      if (!hasContent) continue;

      if (isBundle) {
        if (row.cost_group === "packaging") {
          if (row.sub_menu_id !== null) {
            invalid.add(row.key);
          }
          continue;
        }

        if (row.master_item_id !== null || row.sub_menu_id === null) {
          invalid.add(row.key);
          continue;
        }
        const sub = subMenuMap.get(row.sub_menu_id);
        if (sub && (sub.item_type || "finished") !== "finished") {
          invalid.add(row.key);
        }
      } else {
        if (row.sub_menu_id !== null) {
          const sub = subMenuMap.get(row.sub_menu_id);
          if (sub && (sub.item_type || "finished") !== "prepared") {
            invalid.add(row.key);
          }
        }
      }
    }
    return invalid;
  }, [isBundle, ingredients, subMenuMap]);

  const menuUnitOptions = useMemo(() => {
    return Array.from(
      new Set([
        "Gram",
        "ml",
        "Kg",
        "Liter",
        "Pcs",
        "Porsi",
        "Slice",
        "Box",
        "Paket",
        ...units,
      ])
    );
  }, [units]);

  const renderIngredientRowCard = (row: IngredientDraftRow) => {
    const calc = recipeSummary.rowMap.get(row.key) || {
      sourceUnitPrice: 0,
      cost: 0,
    };
    const subMenu =
      row.sub_menu_id !== null ? subMenuMap.get(row.sub_menu_id) : undefined;
    const sourceLabel =
      row.sub_menu_id !== null
        ? subMenu?.item_type === "prepared"
          ? "Prepared"
          : subMenu?.item_type === "bundle"
          ? "Bundling"
          : "Menu Jual"
        : row.master_item_id !== null
        ? "Master Item"
        : "Manual";

    return (
      <motion.div
        key={row.key}
        layout="position"
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <IngredientRowCard
          row={row}
          cost={calc.cost}
          sourceUnitPrice={calc.sourceUnitPrice}
          sourceLabel={sourceLabel}
          isSubMenu={row.sub_menu_id !== null}
          subMenuType={subMenu?.item_type}
          isRecentlyAdded={recentlyAddedKey === row.key}
          allowToggleCostGroup={!isBundle}
          isInvalidForBundle={invalidBundleRowKeys.has(row.key)}
          unitOptions={menuUnitOptions}
          onUpdateRow={handleUpdateRow}
          onUnitChange={handleUnitChange}
          onToggleCostGroup={handleToggleCostGroup}
          onRemove={(key) =>
            setIngredients((prev) => prev.filter((r) => r.key !== key))
          }
        />
      </motion.div>
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError("Nama menu / produk wajib diisi.");
      return;
    }
    if (batchYieldNum <= 0) {
      setFormError("Hasil 1 batch harus lebih dari 0.");
      return;
    }

    const parsedIngredients: MenuIngredientInput[] = [];
    for (const row of ingredients) {
      const ingName = row.ingredient_name.trim();
      if (!ingName && row.master_item_id === null && row.sub_menu_id === null) {
        continue;
      }

      if (itemType === "bundle") {
        if (row.cost_group === "packaging") {
          if (row.sub_menu_id !== null) {
            setFormError(
              `Kemasan "${ingName || "tanpa nama"}" pada Paket / Hampers harus berupa Master Item kemasan atau kemasan manual (bukan menu atau sub-resep).`
            );
            return;
          }
        } else {
          if (row.master_item_id !== null || row.sub_menu_id === null) {
            setFormError(
              `Paket / Hampers hanya boleh disusun dari Menu Jual yang sudah jadi. Hapus "${ingName || "item"}" dari penyusun (atau masukkan ke Kemasan jika berupa kemasan).`
            );
            return;
          }
          const sub = subMenuMap.get(row.sub_menu_id);
          if (sub && (sub.item_type || "finished") !== "finished") {
            setFormError(
              `Paket / Hampers tidak boleh menggunakan "${sub.name}" karena bukan Menu Jual yang sudah jadi (bukan 1/2 jadi atau paket lain).`
            );
            return;
          }
        }
      } else if (row.sub_menu_id !== null) {
        const sub = subMenuMap.get(row.sub_menu_id);
        if (sub && (sub.item_type || "finished") !== "prepared") {
          setFormError(
            `Resep ${
              itemType === "prepared" ? "Prepared / Setengah Jadi" : "Menu Jual"
            } tidak boleh disusun dari "${sub.name}" karena bertipe ${
              (sub.item_type || "finished") === "finished"
                ? "Menu Jual"
                : "Paket / Hampers"
            }. Hanya Bahan, Kemasan, dan Menu Prepared yang diperbolehkan.`
          );
          return;
        }
      }

      const qtyVal = Number(row.qty);
      const yieldVal = Number(row.yield_factor) || 1;
      const wasteVal = Number(row.waste_pct) || 0;
      if (Number.isNaN(qtyVal) || qtyVal < 0) {
        setFormError(`Qty "${ingName || "tanpa nama"}" tidak valid.`);
        return;
      }
      if (yieldVal <= 0) {
        setFormError(
          `Pembagi kemasan (yield) "${ingName || "tanpa nama"}" harus > 0.`
        );
        return;
      }
      if (Number.isNaN(wasteVal) || wasteVal < 0 || wasteVal >= 100) {
        setFormError(`Susut prep "${ingName || "tanpa nama"}" harus antara 0% - 99%.`);
        return;
      }
      const overrideVal =
        row.unit_cost_override.trim() !== ""
          ? Number(row.unit_cost_override)
          : null;
      if (overrideVal !== null && (Number.isNaN(overrideVal) || overrideVal < 0)) {
        setFormError(`Harga satuan override untuk "${ingName}" tidak valid.`);
        return;
      }
      parsedIngredients.push({
        master_item_id: row.master_item_id,
        sub_menu_id: row.sub_menu_id,
        cost_group: row.cost_group,
        include_sub_packaging:
          row.sub_menu_id !== null ? row.include_sub_packaging : false,
        waste_pct: wasteVal,
        ingredient_name: ingName,
        qty: qtyVal,
        unit: row.unit.trim() || (row.cost_group === "packaging" ? "Pcs" : "Gram"),
        unit_cost_override: overrideVal,
        yield_factor: yieldVal,
        notes: row.notes.trim() || null,
      });
    }

    const targetFcVal =
      targetFoodCostPct.trim() !== "" ? Number(targetFoodCostPct) : null;
    if (
      targetFcVal !== null &&
      (Number.isNaN(targetFcVal) || targetFcVal <= 0 || targetFcVal >= 100)
    ) {
      setFormError("Target Food Cost % harus di antara 1% - 99%.");
      return;
    }

    const shelfDaysVal =
      shelfLifeDays.trim() !== "" ? Number(shelfLifeDays) : null;

    const parsedBatchCosts: MenuBatchCostItemInput[] = [];
    for (const bc of batchCostRows) {
      const cleanBcName = bc.name.trim();
      const rawAmt = bc.amount.trim();
      if (!cleanBcName && rawAmt === "") {
        continue;
      }
      const amtVal = rawAmt === "" ? 0 : Number(rawAmt);
      if (Number.isNaN(amtVal) || amtVal < 0) {
        setFormError(
          `Nominal biaya "${cleanBcName || "Tenaga Kerja / Operasional"}" tidak valid.`
        );
        return;
      }
      if (amtVal <= 0 && !cleanBcName) {
        continue;
      }
      parsedBatchCosts.push({
        category: bc.category,
        name:
          cleanBcName ||
          (bc.category === "labor"
            ? "Tenaga Kerja (Labor)"
            : "Biaya Operasional Batch"),
        amount: amtVal,
      });
    }

    const totalLaborCost = parsedBatchCosts
      .filter((i) => i.category === "labor")
      .reduce((acc, i) => acc + i.amount, 0);
    const totalOtherFee = parsedBatchCosts
      .filter((i) => i.category === "operational")
      .reduce((acc, i) => acc + i.amount, 0);
    const joinedOtherDesc =
      parsedBatchCosts
        .filter((i) => i.category === "operational" && i.name)
        .map((i) => i.name)
        .join(", ")
        .slice(0, 255) || null;

    onSubmit({
      name: cleanName,
      anonymous_name: anonymousName.trim() || null,
      sku: sku.trim() || null,
      category: category.trim() || "Lainnya",
      product_group: productGroup.trim() || null,
      unit: unit.trim() || "Porsi",
      item_type: itemType,
      is_sellable: isSellable,
      batch_yield_qty: batchYieldNum,
      batch_yield_unit: batchYieldUnit.trim() || unit.trim() || "Porsi",
      waste_loss_pct: wasteLossNum,
      labor_cost: totalLaborCost,
      target_food_cost_pct: targetFcVal,
      shelf_life_days:
        shelfDaysVal !== null && !Number.isNaN(shelfDaysVal) && shelfDaysVal >= 0
          ? Math.round(shelfDaysVal)
          : null,
      storage_method: storageMethod.trim() || null,
      selling_price: sellingPriceNum,
      hpp_manual: hppManualNum,
      hpp_mode: hppMode,
      other_fee: totalOtherFee,
      other_fee_description: joinedOtherDesc,
      batch_cost_items: parsedBatchCosts,
      notes: notes.trim() || null,
      is_active: isActive,
      ingredients: parsedIngredients,
    });
  };

  const unitLaborAndOther =
    recipeSummary.unitLaborCost + recipeSummary.unitOtherFee;
  const isManualEffective =
    hppMode === "manual" || (hppMode === "auto" && !hasRecipeData && hppManualNum > 0);
  const compDenominator =
    isSellable && sellingPriceNum > effectiveHpp
      ? sellingPriceNum
      : Math.max(
          effectiveHpp,
          isManualEffective
            ? hppManualNum
            : recipeSummary.unitIngredientCost +
                recipeSummary.subtotalPackaging +
                unitLaborAndOther,
          1
        );
  const hasVisualCost =
    effectiveHpp > 0 || (isSellable && sellingPriceNum > 0);
  const barIngPct = !hasVisualCost
    ? 0
    : isManualEffective
    ? (hppManualNum / compDenominator) * 100
    : (recipeSummary.unitIngredientCost / compDenominator) * 100;
  const barPkgPct =
    !hasVisualCost || isManualEffective
      ? 0
      : (recipeSummary.subtotalPackaging / compDenominator) * 100;
  const barLaborPct =
    !hasVisualCost || isManualEffective
      ? 0
      : (unitLaborAndOther / compDenominator) * 100;
  const barMarginPct =
    hasVisualCost && isSellable && sellingPriceNum > effectiveHpp
      ? (grossMargin / compDenominator) * 100
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-5xl xl:max-w-6xl max-h-[92vh] p-0 gap-0 overflow-hidden rounded-2xl">
        <MotionConfig reducedMotion="user">
          <div className="flex flex-col max-h-[92vh] w-full overflow-hidden">
            {/* Fixed Studio Header */}
            <div className="px-4 sm:px-5 py-3.5 pr-12 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <DialogHeader className="space-y-0.5 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-base font-bold tracking-tight">
                    {editingMenu
                      ? "Edit Menu / Resep & HPP"
                      : "Studio Resep, Prepared & Bundling"}
                  </DialogTitle>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-2 py-0",
                      itemType === "prepared"
                        ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800"
                        : itemType === "bundle"
                        ? "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800"
                        : "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-800"
                    )}
                  >
                    {itemType === "prepared"
                      ? "Prepared"
                      : itemType === "bundle"
                      ? "Bundling"
                      : "Menu Jual"}
                  </Badge>
                </div>
                <DialogDescription className="text-xs">
                  {isBundle
                    ? "Susun Paket / Hampers dari Menu Jual yang sudah jadi, tambahkan kemasan dan biaya lainnya, lalu pantau HPP dan margin secara langsung."
                    : "Cari bahan atau kemasan lalu tekan Enter, pantau komposisi HPP dan margin secara langsung."}
                </DialogDescription>
              </DialogHeader>

              {/* Mobile / Tablet Telemetry Pill */}
              <div className="flex lg:hidden items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs self-start sm:self-center">
                <span className="text-slate-600 dark:text-slate-400">HPP:</span>
                <span className="font-bold tabular-nums text-blue-700 dark:text-blue-300">
                  {formatRupiah(effectiveHpp)}
                </span>
                {isSellable && sellingPriceNum > 0 && (
                  <>
                    <span className="text-slate-400">|</span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        foodCostPct <= 35
                          ? "text-emerald-700 dark:text-emerald-400"
                          : foodCostPct <= 45
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-rose-700 dark:text-rose-400"
                      )}
                    >
                      FC {foodCostPct.toFixed(1)}%
                    </span>
                  </>
                )}
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              {/* Split Studio Body */}
              <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12">
                {/* LEFT STUDIO CANVAS (Zero Nested Card, Hairline Sections) */}
                <div className="lg:col-span-8 lg:min-h-0 lg:overflow-y-auto p-4 sm:p-5 space-y-5">
                  {/* Tipe Item Selector */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        Tipe Item
                      </span>
                      {itemType === "prepared" && (
                        <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer font-medium">
                          <input
                            type="checkbox"
                            checked={isSellable}
                            onChange={(e) => setIsSellable(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-input"
                          />
                          <span>
                            Bisa dijual langsung (Dual-Use: Kondimen / Jar)
                          </span>
                        </label>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(
                        [
                          {
                            value: "finished" as MenuItemType,
                            title: "Menu Jual",
                            desc: "Produk jadi yang dijual ke pelanggan",
                          },
                          {
                            value: "prepared" as MenuItemType,
                            title: "Prepared / Setengah Jadi",
                            desc: "Saus, sponge, ganache untuk dipakai di resep lain",
                          },
                          {
                            value: "bundle" as MenuItemType,
                            title: "Paket / Hampers",
                            desc: "Gabungan beberapa menu jual + box hampers",
                          },
                        ] as const
                      ).map((opt) => {
                        const active = itemType === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleSelectItemType(opt.value)}
                            aria-pressed={active}
                            className={cn(
                              "text-left rounded-md border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                              active
                                ? "border-foreground bg-muted/50"
                                : "border-border bg-background hover:bg-muted/30"
                            )}
                          >
                            <div className="text-xs font-semibold text-foreground">
                              {opt.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {opt.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Identitas & Master Kategori Menu (Zero Nested Card & Zero Quick Pick Chips) */}
                  <div className="pt-4 border-t border-border/70 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label
                          htmlFor="menu-name"
                          className="block text-xs font-medium text-foreground"
                        >
                          Nama Item <span className="text-rose-600">*</span>
                        </label>
                        <Input
                          id="menu-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={
                            itemType === "prepared"
                              ? "Contoh: Ganache Coklat Dark / Saus Caramel"
                              : itemType === "bundle"
                              ? "Contoh: Paket Hampers Lebaran A"
                              : "Contoh: Classic Tiramisu Slice"
                          }
                          className="h-9 text-xs"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor="menu-anon"
                          className="block text-xs font-medium text-foreground"
                        >
                          Kode / Nama Anonim
                        </label>
                        <Input
                          id="menu-anon"
                          value={anonymousName}
                          onChange={(e) => setAnonymousName(e.target.value)}
                          placeholder={
                            itemType === "prepared"
                              ? "Otomatis (PREP-001)"
                              : itemType === "bundle"
                              ? "Otomatis (PKT-001)"
                              : "Otomatis (MENU-001)"
                          }
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                      <div className="sm:col-span-6 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="menu-category"
                            className="block text-xs font-medium text-foreground"
                          >
                            Kategori Menu
                          </label>
                          {isAdmin && onOpenCategoryManager && (
                            <button
                              type="button"
                              onClick={onOpenCategoryManager}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <Tags className="w-3 h-3" />
                              <span>Kelola Master</span>
                            </button>
                          )}
                        </div>
                        <AdaptiveSelect
                          id="menu-category"
                          value={category}
                          onValueChange={setCategory}
                          options={categorySelectOptions}
                          placeholder="Pilih kategori menu..."
                          searchPlaceholder="Cari kategori menu..."
                          creatable={true}
                          creatablePrefix="Kategori"
                        />
                      </div>

                      <div className="sm:col-span-3 space-y-1">
                        <label
                          htmlFor="menu-sku"
                          className="block text-xs font-medium text-foreground"
                        >
                          SKU (Opsional)
                        </label>
                        <Input
                          id="menu-sku"
                          value={sku}
                          onChange={(e) => setSku(e.target.value)}
                          placeholder="HC/..."
                          className="h-9 text-xs font-mono"
                        />
                      </div>

                      <div className="sm:col-span-3 space-y-1">
                        <label
                          htmlFor="menu-unit"
                          className="block text-xs font-medium text-foreground"
                        >
                          Satuan Utama
                        </label>
                        <AdaptiveSelect
                          id="menu-unit"
                          value={unit}
                          onValueChange={(nextU) => {
                            setUnit(nextU);
                            if (!editingMenu || batchYieldUnit === unit) {
                              setBatchYieldUnit(nextU);
                            }
                          }}
                          options={menuUnitOptions}
                          creatable={true}
                          creatablePrefix="Satuan"
                          placeholder={
                            itemType === "prepared" ? "Gram / ml" : "Porsi / Box"
                          }
                          searchPlaceholder="Cari satuan..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Batch Yield, Susut, & Storage (Flat Hairline Section + ReUI InputGroup) */}
                  <div className="pt-4 border-t border-border/70 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowBatchOptions((p) => !p)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"
                        aria-expanded={showBatchOptions}
                      >
                        {showBatchOptions ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>Hasil Batch &amp; Susut Produksi</span>
                      </button>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        Hasil bersih:{" "}
                        <strong className="text-foreground">{Number(netYieldQty.toFixed(2))}</strong>{" "}
                        {batchYieldUnit || unit} | Modal isi/unit:{" "}
                        <strong className="text-foreground">
                          {formatRupiah(recipeSummary.coreUnitHpp)}
                        </strong>
                      </span>
                    </div>

                    <AnimatePresence initial={false}>
                      {showBatchOptions && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-3 pt-2">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label
                                  htmlFor="batch-yield-qty"
                                  className="block text-xs font-medium text-foreground"
                                >
                                  Hasil 1 Batch
                                </label>
                                <InputGroup className="h-9">
                                  <InputGroupInput
                                    id="batch-yield-qty"
                                    type="number"
                                    min={0.001}
                                    step="any"
                                    value={batchYieldQty}
                                    onChange={(e) =>
                                      setBatchYieldQty(e.target.value)
                                    }
                                    className="text-xs tabular-nums"
                                  />
                                  <InputGroupAddon align="inline-end" className="pr-2.5">
                                    <InputGroupText className="text-xs">
                                      {batchYieldUnit || unit}
                                    </InputGroupText>
                                  </InputGroupAddon>
                                </InputGroup>
                              </div>
                              <div className="space-y-1">
                                <label
                                  htmlFor="batch-yield-unit"
                                  className="block text-xs font-medium text-foreground"
                                >
                                  Satuan Hasil Batch
                                </label>
                                <AdaptiveSelect
                                  id="batch-yield-unit"
                                  value={batchYieldUnit}
                                  onValueChange={setBatchYieldUnit}
                                  options={menuUnitOptions}
                                  creatable={true}
                                  creatablePrefix="Satuan"
                                  placeholder="Gram / ml / Slice"
                                  searchPlaceholder="Cari satuan..."
                                />
                              </div>
                              <div className="space-y-1">
                                <label
                                  htmlFor="waste-loss-pct"
                                  className="block text-xs font-medium text-foreground"
                                >
                                  Susut Masak / Panggang
                                </label>
                                <InputGroup className="h-9">
                                  <InputGroupInput
                                    id="waste-loss-pct"
                                    type="number"
                                    min={0}
                                    max={99}
                                    step="any"
                                    value={wasteLossPct}
                                    onChange={(e) =>
                                      setWasteLossPct(e.target.value)
                                    }
                                    className="text-xs tabular-nums"
                                  />
                                  <InputGroupAddon align="inline-end" className="pr-2.5">
                                    <InputGroupText className="text-xs">%</InputGroupText>
                                  </InputGroupAddon>
                                </InputGroup>
                              </div>
                            </div>

                            {itemType === "prepared" && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label
                                    htmlFor="shelf-life-days"
                                    className="block text-xs font-medium text-foreground"
                                  >
                                    Masa Simpan Dapur (Opsional)
                                  </label>
                                  <InputGroup className="h-9">
                                    <InputGroupInput
                                      id="shelf-life-days"
                                      type="number"
                                      min={0}
                                      value={shelfLifeDays}
                                      onChange={(e) =>
                                        setShelfLifeDays(e.target.value)
                                      }
                                      placeholder="Contoh: 5"
                                      className="text-xs tabular-nums"
                                    />
                                    <InputGroupAddon align="inline-end" className="pr-2.5">
                                      <InputGroupText className="text-xs">Hari</InputGroupText>
                                    </InputGroupAddon>
                                  </InputGroup>
                                </div>
                                <div className="space-y-1">
                                  <label
                                    htmlFor="storage-method"
                                    className="block text-xs font-medium text-foreground"
                                  >
                                    Cara Penyimpanan (Opsional)
                                  </label>
                                  <AdaptiveSelect
                                    id="storage-method"
                                    value={storageMethod}
                                    onValueChange={setStorageMethod}
                                    options={[
                                      { value: "", label: "Tidak ditentukan" },
                                      { value: "Chiller", label: "Chiller (Kulkas)" },
                                      { value: "Freezer", label: "Freezer (Beku)" },
                                      { value: "Suhu Ruang", label: "Suhu Ruang" },
                                    ]}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* QUICK-ADD SINGLE SEARCH AUTOCOMPLETE (BAHAN & KEMASAN) */}
                  <RecipeQuickAddAutocomplete
                    masterItems={masterItems}
                    menuOptions={allMenus}
                    parentItemType={itemType}
                    excludeMenuId={editingMenu?.id}
                    existingMasterCounts={existingMasterCounts}
                    existingSubMenuCounts={existingSubMenuCounts}
                    onAddItem={handleQuickAddItem}
                    lastAddedNotice={lastAddedNotice}
                  />

                  {invalidBundleRowKeys.size > 0 && (
                    <div className="py-2.5 border-y border-rose-300 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-rose-700 dark:text-rose-300">
                      <span>
                        {isBundle ? (
                          <>
                            Ditemukan <strong>{invalidBundleRowKeys.size} item</strong> yang bukan Menu Jual. Paket / Hampers hanya memperbolehkan Menu Jual yang sudah jadi sebagai item penyusun.
                          </>
                        ) : (
                          <>
                            Ditemukan <strong>{invalidBundleRowKeys.size} item</strong> bertipe Menu Jual atau Paket. Resep hanya boleh disusun dari Bahan, Kemasan, dan Menu Prepared.
                          </>
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setIngredients((prev) =>
                            prev.filter((r) => !invalidBundleRowKeys.has(r.key))
                          )
                        }
                        className="h-8 text-xs shrink-0"
                      >
                        Hapus item tidak sesuai
                      </Button>
                    </div>
                  )}

                  {/* SECTION 1: BAHAN RESEP / ISI PRODUK (Flat Hairline Ledger) */}
                  <div className="pt-3 border-t border-border/70 space-y-2">
                    <div>
                      <h3 className="text-xs font-semibold text-foreground">
                        {isBundle
                          ? `1. Item Penyusun Paket / Menu Jadi (${ingredientRows.length} item)`
                          : `1. Bahan Resep / Isi Produk (${ingredientRows.length} item)`}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {isBundle
                          ? "Diisi dari Menu Jual yang sudah jadi."
                          : `Dihitung per batch lalu dibagi hasil bersih (${Number(netYieldQty.toFixed(2))} ${batchYieldUnit || unit}).`}
                      </p>
                    </div>

                    {ingredientRows.length === 0 ? (
                      <div className="border border-dashed border-border rounded-lg py-4 px-3 text-center text-xs text-muted-foreground">
                        {isBundle
                          ? "Belum ada menu penyusun paket. Ketik nama Menu Jual di kolom pencarian di atas lalu tekan Enter."
                          : "Belum ada bahan resep. Ketik nama bahan di kolom pencarian di atas lalu tekan Enter."}
                      </div>
                    ) : (
                      <div className="divide-y divide-border/60 border-y border-border/60">
                        <AnimatePresence mode="popLayout" initial={false}>
                          {ingredientRows.map(renderIngredientRowCard)}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>

                  {/* SECTION 2: KEMASAN & PACKAGING (Flat Hairline Ledger) */}
                  <div className="pt-3 border-t border-border/70 space-y-2">
                    <div>
                      <h3 className="text-xs font-semibold text-foreground">
                        2. Kemasan &amp; Packaging ({packagingRows.length} item)
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        Dipisah dari bahan makanan. Dihitung per 1 satuan jual (tidak dibagi batch yield).
                      </p>
                    </div>

                    {packagingRows.length === 0 ? (
                      <div className="border border-dashed border-border rounded-lg py-3.5 px-3 text-center text-xs text-muted-foreground">
                        Belum ada komponen kemasan terpisah. Ketik nama kemasan di kolom pencarian di atas lalu tekan Enter.
                      </div>
                    ) : (
                      <div className="divide-y divide-border/60 border-y border-border/60">
                        <AnimatePresence mode="popLayout" initial={false}>
                          {packagingRows.map(renderIngredientRowCard)}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>

                  {/* SECTION 3: TENAGA KERJA & BIAYA OPERASIONAL BATCH (Flat Hairline Ledger, Zero Presets) */}
                  <div className="pt-3 border-t border-border/70 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                          <span>
                            3. Tenaga Kerja (Labor) &amp; Biaya Operasional Batch
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {recipeSummary.activeBatchCostItems.length} komponen
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Ikut terbagi ke hasil bersih {Number(netYieldQty.toFixed(2))} {batchYieldUnit || unit}.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddBatchCostRow("labor")}
                          className="h-7 px-2.5 text-[11px] gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Tambah Labor</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddBatchCostRow("operational")}
                          className="h-7 px-2.5 text-[11px] gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Tambah Operasional</span>
                        </Button>
                      </div>
                    </div>

                    {(recipeSummary.laborNum > 0 ||
                      recipeSummary.otherFeeNum > 0) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground py-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            Labor Batch:{" "}
                            <strong className="tabular-nums text-foreground">
                              {formatRupiah(recipeSummary.laborNum)}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>
                            Operasional Batch:{" "}
                            <strong className="tabular-nums text-foreground">
                              {formatRupiah(recipeSummary.otherFeeNum)}
                            </strong>
                          </span>
                        </div>
                        <div className="font-semibold tabular-nums text-foreground">
                          Per {batchYieldUnit || unit}: {formatRupiah(unitLaborAndOther)}
                        </div>
                      </div>
                    )}

                    <div className="divide-y divide-border/60 border-y border-border/60">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {batchCostRows.map((bcRow, idx) => {
                          const rowAmt = Math.max(0, Number(bcRow.amount) || 0);
                          const rowUnitAmt = rowAmt / netYieldQty;
                          const isLabor = bcRow.category === "labor";

                          return (
                            <motion.div
                              key={bcRow.key}
                              layout="position"
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{
                                duration: 0.16,
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              className="py-2.5"
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                                <div className="sm:col-span-3 space-y-0.5">
                                  <label
                                    htmlFor={`bc-cat-${bcRow.key}`}
                                    className="block text-[11px] font-medium text-muted-foreground"
                                  >
                                    Jenis Biaya #{idx + 1}
                                  </label>
                                  <AdaptiveSelect
                                    id={`bc-cat-${bcRow.key}`}
                                    value={bcRow.category}
                                    onValueChange={(nextCat) =>
                                      handleUpdateBatchCostRow(bcRow.key, {
                                        category: nextCat as BatchCostCategory,
                                      })
                                    }
                                    options={[
                                      { value: "labor", label: "Tenaga Kerja (Labor)" },
                                      { value: "operational", label: "Biaya Operasional" },
                                    ]}
                                    triggerClassName="h-8"
                                  />
                                </div>

                                <div className="sm:col-span-5 space-y-0.5">
                                  <label
                                    htmlFor={`bc-name-${bcRow.key}`}
                                    className="block text-[11px] font-medium text-muted-foreground"
                                  >
                                    Nama / Rincian Komponen
                                  </label>
                                  <Input
                                    id={`bc-name-${bcRow.key}`}
                                    value={bcRow.name}
                                    onChange={(e) =>
                                      handleUpdateBatchCostRow(bcRow.key, {
                                        name: e.target.value,
                                      })
                                    }
                                    placeholder={
                                      isLabor
                                        ? "Contoh: Tenaga baker, barista, dekorasi"
                                        : "Contoh: Gas oven, listrik mixer, penyusutan"
                                    }
                                    className="h-8 text-xs"
                                  />
                                </div>

                                <div className="sm:col-span-4 space-y-0.5">
                                  <label
                                    htmlFor={`bc-amt-${bcRow.key}`}
                                    className="block text-[11px] font-medium text-muted-foreground"
                                  >
                                    Biaya per Batch
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    <InputGroup className="h-8 flex-1">
                                      <InputGroupAddon align="inline-start" className="pl-2 pr-1">
                                        <InputGroupText className="text-[11px]">Rp</InputGroupText>
                                      </InputGroupAddon>
                                      <InputGroupInput
                                        id={`bc-amt-${bcRow.key}`}
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={bcRow.amount}
                                        onChange={(e) =>
                                          handleUpdateBatchCostRow(bcRow.key, {
                                            amount: e.target.value,
                                          })
                                        }
                                        placeholder="0"
                                        className="text-xs tabular-nums pl-1"
                                      />
                                    </InputGroup>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleRemoveBatchCostRow(bcRow.key)
                                      }
                                      aria-label={`Hapus komponen biaya ${
                                        bcRow.name || idx + 1
                                      }`}
                                      className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-rose-600"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                  {rowAmt > 0 && netYieldQty !== 1 && (
                                    <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                                      Per {batchYieldUnit || unit}:{" "}
                                      <strong className="text-foreground">
                                        {formatRupiah(rowUnitAmt)}
                                      </strong>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Status & Notes (Flat Hairline Section) */}
                  <div className="pt-3 border-t border-border/70 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <div className="space-y-1">
                      <label
                        htmlFor="menu-notes"
                        className="block text-xs font-medium text-foreground"
                      >
                        Catatan (Opsional)
                      </label>
                      <Input
                        id="menu-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Catatan produksi, porsi, atau standar penyajian"
                        className="h-9 text-xs"
                      />
                    </div>

                    <div className="sm:pt-6">
                      <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={(e) => setIsActive(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-input"
                        />
                        <span>
                          {itemType === "prepared"
                            ? "Resep prepared aktif dipakai"
                            : "Menu aktif dijual"}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* RIGHT LIVE TELEMETRY RAIL (Flat Hairline Sections, Zero Nested Card) */}
                <div className="lg:col-span-4 lg:min-h-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-border/80 bg-background p-4 sm:p-5 space-y-5">
                  {/* Live HPP Hero & Animated Cost Composition */}
                  <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-medium text-muted-foreground">
                          Total HPP Efektif /{batchYieldUnit || unit}
                        </div>
                        <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground mt-0.5">
                          {formatRupiah(effectiveHpp)}
                        </div>
                      </div>

                      {!isSellable ? (
                        <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                          Internal Prepared
                        </Badge>
                      ) : sellingPriceNum > 0 ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px] px-2 py-0.5 font-semibold tabular-nums",
                            foodCostPct <= 35
                              ? "text-emerald-700 border-emerald-300 dark:text-emerald-400"
                              : foodCostPct <= 45
                              ? "text-amber-700 border-amber-300 dark:text-amber-400"
                              : "text-rose-700 border-rose-300 dark:text-rose-400"
                          )}
                        >
                          FC {foodCostPct.toFixed(1)}%
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-2 py-0.5 text-muted-foreground">
                          Isi Harga Jual
                        </Badge>
                      )}
                    </div>

                    {/* Animated Stacked Cost Composition Bar */}
                    <div className="space-y-1.5">
                      <div
                        className="h-2 w-full rounded-full bg-muted overflow-hidden flex"
                        role="img"
                        aria-label="Komposisi biaya bahan, kemasan, labor, dan margin"
                      >
                        <motion.div
                          className="h-full bg-blue-600 dark:bg-blue-500"
                          initial={false}
                          animate={{ width: `${barIngPct}%` }}
                          transition={{
                            duration: 0.28,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        />
                        <motion.div
                          className="h-full bg-amber-500 dark:bg-amber-400"
                          initial={false}
                          animate={{ width: `${barPkgPct}%` }}
                          transition={{
                            duration: 0.28,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        />
                        <motion.div
                          className="h-full bg-indigo-600 dark:bg-indigo-400"
                          initial={false}
                          animate={{ width: `${barLaborPct}%` }}
                          transition={{
                            duration: 0.28,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        />
                        <motion.div
                          className="h-full bg-emerald-500 dark:bg-emerald-400"
                          initial={false}
                          animate={{ width: `${barMarginPct}%` }}
                          transition={{
                            duration: 0.28,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        />
                      </div>

                      {isManualEffective && (
                        <div className="text-[10px] text-muted-foreground">
                          Menggunakan HPP Manual ({formatRupiah(hppManualNum)})
                        </div>
                      )}
                    </div>

                    {/* 4-Metric Legend */}
                    <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-border/60 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                          <span>{isBundle ? "Menu Penyusun" : "Bahan / Isi"}</span>
                        </div>
                        <div className="font-semibold tabular-nums text-foreground">
                          {formatRupiah(recipeSummary.unitIngredientCost)}
                        </div>
                        {isSellable && sellingPriceNum > 0 && (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            {pureFoodCostPct.toFixed(1)}% dari jual
                          </div>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          <span>Kemasan</span>
                        </div>
                        <div className="font-semibold tabular-nums text-foreground">
                          {formatRupiah(recipeSummary.subtotalPackaging)}
                        </div>
                        {isSellable && sellingPriceNum > 0 && (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            {packagingCostPct.toFixed(1)}% dari jual
                          </div>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                          <span>Labor &amp; Lainnya</span>
                        </div>
                        <div className="font-semibold tabular-nums text-foreground">
                          {formatRupiah(unitLaborAndOther)}
                        </div>
                        {recipeSummary.activeBatchCostItems.length > 0 && (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            {recipeSummary.activeBatchCostItems.length} komponen batch
                          </div>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          <span>{isSellable ? "Margin Kotor" : "Status"}</span>
                        </div>
                        <div
                          className={cn(
                            "font-semibold tabular-nums",
                            isSellable && sellingPriceNum > 0 && grossMargin < 0
                              ? "text-rose-700 dark:text-rose-400"
                              : "text-foreground"
                          )}
                        >
                          {isSellable
                            ? sellingPriceNum > 0
                              ? formatRupiah(grossMargin)
                              : "-"
                            : "Internal"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pricing & HPP Mode Section (Flat Hairline + ReUI InputGroup + AdaptiveSelect) */}
                  <div className="pt-4 border-t border-border/70 space-y-3">
                    {isSellable && (
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <label
                            htmlFor="menu-price"
                            className="block text-xs font-medium text-foreground"
                          >
                            Harga Jual
                          </label>
                          <InputGroup className="h-9">
                            <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                              <InputGroupText className="text-xs">Rp</InputGroupText>
                            </InputGroupAddon>
                            <InputGroupInput
                              id="menu-price"
                              type="number"
                              min={0}
                              step="any"
                              value={sellingPrice}
                              onChange={(e) => setSellingPrice(e.target.value)}
                              placeholder="0"
                              className="text-xs tabular-nums pl-1 font-semibold"
                            />
                          </InputGroup>
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor="menu-target-fc"
                            className="block text-xs font-medium text-foreground"
                          >
                            Target Food Cost
                          </label>
                          <InputGroup className="h-9">
                            <InputGroupInput
                              id="menu-target-fc"
                              type="number"
                              min={1}
                              max={99}
                              step="any"
                              value={targetFoodCostPct}
                              onChange={(e) =>
                                setTargetFoodCostPct(e.target.value)
                              }
                              placeholder="35"
                              className="text-xs tabular-nums"
                            />
                            <InputGroupAddon align="inline-end" className="pr-2.5">
                              <InputGroupText className="text-xs">%</InputGroupText>
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                      </div>
                    )}

                    {suggestedTargetPrice !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          setSellingPrice(String(suggestedTargetPrice))
                        }
                        className="w-full rounded-md border border-border bg-muted/40 px-2.5 py-2 text-left text-[11px] flex items-center justify-between gap-2 text-foreground hover:bg-muted/70 transition-colors"
                      >
                        <span>
                          Saran Harga (FC {targetFcNum}%):{" "}
                          <strong className="tabular-nums">
                            {formatRupiah(suggestedTargetPrice)}
                          </strong>
                        </span>
                        <span className="font-semibold shrink-0 underline text-blue-600 dark:text-blue-400">
                          Terapkan
                        </span>
                      </button>
                    )}

                    <div className="space-y-2.5">
                      <div className="space-y-1">
                        <label
                          htmlFor="menu-hpp-mode"
                          className="block text-xs font-medium text-foreground"
                        >
                          Sumber Perhitungan HPP
                        </label>
                        <AdaptiveSelect
                          id="menu-hpp-mode"
                          value={hppMode}
                          onValueChange={(val) =>
                            setHppMode(val as MenuHppMode)
                          }
                          options={[
                            {
                              value: "auto",
                              label: "Otomatis (Resep jika ada, atau Manual)",
                            },
                            { value: "manual", label: "HPP Manual" },
                            { value: "recipe", label: "Selalu dari Resep" },
                          ]}
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor="menu-hpp-manual"
                          className="block text-xs font-medium text-foreground"
                        >
                          HPP Manual
                        </label>
                        <InputGroup className="h-9">
                          <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                            <InputGroupText className="text-xs">Rp</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            id="menu-hpp-manual"
                            type="number"
                            min={0}
                            step="any"
                            value={hppManual}
                            onChange={(e) => setHppManual(e.target.value)}
                            placeholder="0"
                            className="text-xs tabular-nums pl-1"
                          />
                        </InputGroup>
                      </div>
                    </div>
                  </div>

                  {/* Multi-Channel Pricing Section (Flat Hairline) */}
                  {isSellable &&
                    effectiveHpp > 0 &&
                    pricingChannels.length > 0 && (
                      <div className="pt-4 border-t border-border/70 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setShowChannelPricing((p) => !p)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:underline"
                            aria-expanded={showChannelPricing}
                          >
                            <Percent className="w-3.5 h-3.5 shrink-0" />
                            <span>Margin Multi-Channel</span>
                            {showChannelPricing ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {isAdmin && onOpenChannelSettings && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={onOpenChannelSettings}
                              className="h-7 px-2 text-[11px] gap-1 text-muted-foreground"
                            >
                              <Settings2 className="w-3 h-3" />
                              <span>Atur Komisi</span>
                            </Button>
                          )}
                        </div>

                        <AnimatePresence initial={false}>
                          {showChannelPricing && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{
                                duration: 0.16,
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              className="overflow-hidden"
                            >
                              <div className="overflow-x-auto border-y border-border/70">
                                <table className="w-full text-[11px]">
                                  <thead className="text-muted-foreground border-b border-border/60">
                                    <tr>
                                      <th className="text-left py-1.5 font-medium">
                                        Channel
                                      </th>
                                      <th className="text-right py-1.5 font-medium">
                                        Net Margin
                                      </th>
                                      <th className="text-right py-1.5 font-medium">
                                        Saran
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/50">
                                    {channelAnalysis.map((ch) => (
                                      <tr key={ch.key}>
                                        <td className="py-1.5 font-medium text-foreground">
                                          <div>{ch.name}</div>
                                          <div className="text-[10px] text-muted-foreground font-normal tabular-nums">
                                            Komisi {ch.commission_pct}%
                                            {ch.fixed_fee > 0
                                              ? ` + ${formatRupiah(ch.fixed_fee)}`
                                              : ""}
                                          </div>
                                        </td>
                                        <td
                                          className={cn(
                                            "py-1.5 text-right tabular-nums font-semibold",
                                            ch.netMargin >= 0
                                              ? "text-emerald-700 dark:text-emerald-400"
                                              : "text-rose-700 dark:text-rose-400"
                                          )}
                                        >
                                          {sellingPriceNum > 0 ? (
                                            <>
                                              <div>
                                                {formatRupiah(ch.netMargin)}
                                              </div>
                                              <div className="text-[10px] font-normal">
                                                ({ch.netMarginPct.toFixed(1)}%)
                                              </div>
                                            </>
                                          ) : (
                                            "-"
                                          )}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                                          {ch.suggestedPrice
                                            ? formatRupiah(ch.suggestedPrice)
                                            : "-"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                </div>
              </div>

              {/* Fixed Studio Footer */}
              <div className="px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shrink-0 space-y-2">
                {formError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                    {formError}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                    Komposisi:{" "}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {ingredientRows.length}{" "}
                      {isBundle ? "menu jadi" : "bahan"}
                    </strong>{" "}
                    |{" "}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {packagingRows.length} kemasan
                    </strong>
                    {recipeSummary.activeBatchCostItems.length > 0 && (
                      <>
                        {" "}
                        |{" "}
                        <strong className="text-slate-900 dark:text-slate-100">
                          {recipeSummary.activeBatchCostItems.length} biaya batch
                        </strong>
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      disabled={isSubmitting}
                      className="h-9 text-xs"
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="h-9 text-xs px-4"
                    >
                      {isSubmitting
                        ? "Menyimpan..."
                        : editingMenu
                        ? "Simpan Perubahan"
                        : "Simpan Item"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </MotionConfig>
      </DialogContent>
    </Dialog>
  );
};
