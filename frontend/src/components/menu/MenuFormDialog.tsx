import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatRupiah } from "@/lib/formatters";
import { getMenuConversionHint } from "@/lib/api";
import {
  IngredientCostGroup,
  MasterItem,
  MenuHppMode,
  MenuIngredientInput,
  MenuItemType,
  MenuProduct,
  MenuProductPayload,
  PricingChannelConfig,
} from "@/types";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  Layers,
  Package,
  Percent,
  Plus,
  Settings2,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  IngredientSourceCombobox,
  IngredientSourceValue,
} from "./IngredientSourceCombobox";

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
  units: string[];
  existingCategories: string[];
  isSubmitting: boolean;
  onSubmit: (payload: MenuProductPayload) => void;
}

function emptyIngredientRow(costGroup: IngredientCostGroup): IngredientDraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    cost_group: costGroup,
    master_item_id: null,
    sub_menu_id: null,
    include_sub_packaging: false,
    ingredient_name: "",
    qty: "1",
    unit: costGroup === "packaging" ? "Pcs" : "Gram",
    waste_pct: "0",
    unit_cost_override: "",
    yield_factor: "1",
    notes: "",
  };
}

interface IngredientRowCardProps {
  row: IngredientDraftRow;
  cost: number;
  sourceUnitPrice: number;
  isSubMenu: boolean;
  subMenuType?: MenuItemType;
  masterItems: MasterItem[];
  menuOptions: MenuProduct[];
  excludeMenuId?: number;
  onChangeSource: (rowKey: string, next: IngredientSourceValue) => void;
  onUpdateRow: (rowKey: string, patch: Partial<IngredientDraftRow>) => void;
  onUnitChange: (
    rowKey: string,
    newUnit: string,
    masterId: number | null,
    subMenuId: number | null
  ) => void;
  onRemove: (rowKey: string) => void;
}

const IngredientRowCard: React.FC<IngredientRowCardProps> = ({
  row,
  cost,
  sourceUnitPrice,
  isSubMenu,
  subMenuType,
  masterItems,
  menuOptions,
  excludeMenuId,
  onChangeSource,
  onUpdateRow,
  onUnitChange,
  onRemove,
}) => {
  const isPackaging = row.cost_group === "packaging";

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2.5 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
        <div className="sm:col-span-4">
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
            {isPackaging ? "Sumber Kemasan" : "Sumber Bahan / Sub-Resep"}
          </label>
          <IngredientSourceCombobox
            value={{
              master_item_id: row.master_item_id,
              sub_menu_id: row.sub_menu_id,
            }}
            onChange={(next) => onChangeSource(row.key, next)}
            masterItems={masterItems}
            menuOptions={menuOptions}
            excludeMenuId={excludeMenuId}
            costGroup={row.cost_group}
          />
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
            {isPackaging ? "Nama Kemasan" : "Nama Bahan / Komponen"}
          </label>
          <Input
            value={row.ingredient_name}
            onChange={(e) =>
              onUpdateRow(row.key, { ingredient_name: e.target.value })
            }
            placeholder={isPackaging ? "Contoh: Box Mika 20cm" : "Nama bahan resep"}
            className="h-9 text-xs"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
            Takaran
          </label>
          <Input
            type="number"
            min={0}
            step="any"
            value={row.qty}
            onChange={(e) => onUpdateRow(row.key, { qty: e.target.value })}
            className="h-9 text-xs tabular-nums"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
            Satuan
          </label>
          <Input
            list="menu-unit-list"
            value={row.unit}
            onChange={(e) =>
              onUnitChange(
                row.key,
                e.target.value,
                row.master_item_id,
                row.sub_menu_id
              )
            }
            className="h-9 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
        <div className={isPackaging ? "sm:col-span-4" : "sm:col-span-3"}>
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
            Harga Satuan Override (Rp)
          </label>
          <Input
            type="number"
            min={0}
            step="any"
            value={row.unit_cost_override}
            onChange={(e) =>
              onUpdateRow(row.key, { unit_cost_override: e.target.value })
            }
            placeholder={
              sourceUnitPrice > 0
                ? `Auto: ${formatRupiah(sourceUnitPrice)}`
                : "Isi harga beli"
            }
            className="h-8 text-xs tabular-nums"
          />
        </div>

        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
            Pembagi Kemasan (Yield)
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
            <div className="text-[10px] text-blue-700 dark:text-blue-300 mt-0.5">
              {row.conversion_hint}
            </div>
          )}
        </div>

        {!isPackaging && (
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
              Susut Prep (%)
            </label>
            <Input
              type="number"
              min={0}
              max={99}
              step="any"
              value={row.waste_pct}
              onChange={(e) =>
                onUpdateRow(row.key, { waste_pct: e.target.value })
              }
              className="h-8 text-xs tabular-nums"
            />
          </div>
        )}

        <div
          className={`${
            isPackaging ? "sm:col-span-4" : "sm:col-span-3"
          } flex flex-col items-start sm:items-end justify-center gap-1 pt-2 sm:pt-4`}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-600 dark:text-slate-400">
              Subtotal:
            </span>
            <Badge
              variant="outline"
              className="text-xs font-semibold tabular-nums"
            >
              {formatRupiah(cost)}
            </Badge>
          </div>
          {row.price_drift_alert &&
            row.price_change_pct !== null &&
            row.price_change_pct !== undefined && (
              <div className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 dark:text-rose-400">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span>
                  Naik +{row.price_change_pct}%
                  {row.drift_source ? ` (via ${row.drift_source})` : ""}
                </span>
              </div>
            )}
        </div>

        <div className="sm:col-span-1 flex justify-end pt-2 sm:pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(row.key)}
            aria-label={`Hapus ${row.ingredient_name || "baris"}`}
            className="h-8 w-8 p-0 text-slate-600 hover:text-rose-700"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {isSubMenu && (
        <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-medium">
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
          <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={row.include_sub_packaging}
              onChange={(e) =>
                onUpdateRow(row.key, {
                  include_sub_packaging: e.target.checked,
                })
              }
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
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

  const [laborCost, setLaborCost] = useState("");
  const [otherFee, setOtherFee] = useState("");
  const [otherFeeDescription, setOtherFeeDescription] = useState("");

  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [ingredients, setIngredients] = useState<IngredientDraftRow[]>([]);
  const [showChannelPricing, setShowChannelPricing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setShowChannelPricing(false);
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
      setLaborCost(editingMenu.labor_cost ? String(editingMenu.labor_cost) : "");
      setOtherFee(editingMenu.other_fee ? String(editingMenu.other_fee) : "");
      setOtherFeeDescription(editingMenu.other_fee_description || "");
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
      setCategory(
        initType === "prepared"
          ? "Prepared / Sub-Resep"
          : initType === "bundle"
          ? "Hampers / Bundling"
          : existingCategories[0] || "Cake Ready"
      );
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
      setLaborCost("");
      setOtherFee("");
      setOtherFeeDescription("");
      setNotes("");
      setIsActive(true);
      setIngredients([]);
    }
  }, [open, editingMenu, existingCategories, defaultItemType]);

  const handleSelectItemType = (nextType: MenuItemType) => {
    setItemType(nextType);
    if (!editingMenu) {
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

    const laborNum = Math.max(0, Number(laborCost) || 0);
    const otherFeeNum = Math.max(0, Number(otherFee) || 0);

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
      coreUnitHpp,
      total: totalRecipeHpp,
      rowMap,
    };
  }, [ingredients, masterMap, subMenuMap, laborCost, otherFee, netYieldQty]);

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

  const channelAnalysis = useMemo(() => {
    if (!isSellable || effectiveHpp <= 0 || pricingChannels.length === 0) {
      return [];
    }
    const targetFcNum = Number(targetFoodCostPct);
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
        suggestedPrice = raw >= 500 ? Math.round(raw / 500) * 500 : Math.round(raw);
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
    targetFoodCostPct,
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

  const handleChangeSource = (rowKey: string, next: IngredientSourceValue) => {
    if (next.sub_menu_id !== null) {
      const sub = subMenuMap.get(next.sub_menu_id);
      const nextUnit = sub ? sub.batch_yield_unit || sub.unit || "Gram" : "Gram";
      const defaultIncludePkg = sub ? sub.item_type !== "prepared" : false;
      setIngredients((prev) =>
        prev.map((r) =>
          r.key === rowKey
            ? {
                ...r,
                master_item_id: null,
                sub_menu_id: next.sub_menu_id,
                include_sub_packaging: defaultIncludePkg,
                ingredient_name: sub ? sub.name : r.ingredient_name,
                unit: nextUnit,
                price_drift_alert: sub?.has_price_drift || false,
                price_change_pct: sub?.max_ingredient_increase_pct ?? null,
                drift_source: sub?.has_price_drift ? sub.name : null,
                conversion_hint: undefined,
              }
            : r
        )
      );
      if (sub) {
        void applyConversionHint(rowKey, { subMenuId: sub.id }, nextUnit);
      }
      return;
    }

    if (next.master_item_id !== null) {
      const found = masterMap.get(next.master_item_id);
      const nextUnit = found
        ? found.satuan_ecer || found.satuan_beli || "Gram"
        : "Gram";
      setIngredients((prev) =>
        prev.map((r) =>
          r.key === rowKey
            ? {
                ...r,
                master_item_id: next.master_item_id,
                sub_menu_id: null,
                include_sub_packaging: false,
                ingredient_name: found ? found.item_name : r.ingredient_name,
                unit: nextUnit || r.unit,
                price_drift_alert: false,
                price_change_pct: null,
                master_prev_price: null,
                drift_source: null,
                conversion_hint: undefined,
              }
            : r
        )
      );
      if (found) {
        void applyConversionHint(rowKey, { masterId: found.id }, nextUnit);
      }
      return;
    }

    handleUpdateRow(rowKey, {
      master_item_id: null,
      sub_menu_id: null,
      include_sub_packaging: false,
      conversion_hint: undefined,
    });
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

  const ingredientRows = useMemo(
    () => ingredients.filter((r) => r.cost_group !== "packaging"),
    [ingredients]
  );
  const packagingRows = useMemo(
    () => ingredients.filter((r) => r.cost_group === "packaging"),
    [ingredients]
  );

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
      labor_cost: Math.max(0, Number(laborCost) || 0),
      target_food_cost_pct: targetFcVal,
      shelf_life_days:
        shelfDaysVal !== null && !Number.isNaN(shelfDaysVal) && shelfDaysVal >= 0
          ? Math.round(shelfDaysVal)
          : null,
      storage_method: storageMethod.trim() || null,
      selling_price: sellingPriceNum,
      hpp_manual: hppManualNum,
      hpp_mode: hppMode,
      other_fee: Math.max(0, Number(otherFee) || 0),
      other_fee_description: otherFeeDescription.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
      ingredients: parsedIngredients,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingMenu
              ? "Edit Menu / Resep & HPP"
              : "Tambah Menu, Prepared, atau Bundling"}
          </DialogTitle>
          <DialogDescription>
            Susun bahan resep (termasuk sub-resep prepared), pisahkan biaya kemasan, atur hasil batch, dan pantau margin per channel.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {formError}
            </div>
          )}

          {/* Tipe Item Selector */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Tipe Item
              </span>
              {itemType === "prepared" && (
                <label className="inline-flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={isSellable}
                    onChange={(e) => setIsSellable(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Bisa dijual langsung (Dual-Use: Kondimen / Jar)</span>
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
                    className={`text-left rounded-lg border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      active
                        ? "border-blue-600 bg-blue-50/90 dark:border-blue-400 dark:bg-blue-950/60"
                        : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900"
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold ${
                        active
                          ? "text-blue-900 dark:text-blue-100"
                          : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {opt.title}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Identitas Menu */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="menu-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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

            <div>
              <label
                htmlFor="menu-anon"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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

            <div>
              <label
                htmlFor="menu-category"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Kategori
              </label>
              <Input
                id="menu-category"
                list="menu-category-suggestions"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Contoh: Cake Ready, Prepared / Sub-Resep"
                className="h-9 text-xs"
              />
              <datalist id="menu-category-suggestions">
                {existingCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
                <option value="Cake Ready" />
                <option value="Prepared / Sub-Resep" />
                <option value="Hampers / Bundling" />
                <option value="Minuman" />
                <option value="Pastry" />
                <option value="Dessert Box" />
                <option value="Custom Cake" />
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="menu-sku"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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
              <div>
                <label
                  htmlFor="menu-unit"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Satuan Utama
                </label>
                <Input
                  id="menu-unit"
                  value={unit}
                  onChange={(e) => {
                    const nextU = e.target.value;
                    setUnit(nextU);
                    if (!editingMenu || batchYieldUnit === unit) {
                      setBatchYieldUnit(nextU);
                    }
                  }}
                  placeholder={itemType === "prepared" ? "Gram / ml" : "Porsi / Box"}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Batch Yield, Susut, & Storage */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowBatchOptions((p) => !p)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                aria-expanded={showBatchOptions}
              >
                {showBatchOptions ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>Hasil Batch &amp; Susut Produksi</span>
              </button>
              <span className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                Hasil bersih: <strong>{Number(netYieldQty.toFixed(2))}</strong>{" "}
                {batchYieldUnit || unit} | Modal isi/unit:{" "}
                <strong className="text-blue-700 dark:text-blue-300">
                  {formatRupiah(recipeSummary.coreUnitHpp)}
                </strong>
              </span>
            </div>

            {showBatchOptions && (
              <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label
                      htmlFor="batch-yield-qty"
                      className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Hasil 1 Batch (Qty)
                    </label>
                    <Input
                      id="batch-yield-qty"
                      type="number"
                      min={0.001}
                      step="any"
                      value={batchYieldQty}
                      onChange={(e) => setBatchYieldQty(e.target.value)}
                      className="h-8 text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="batch-yield-unit"
                      className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Satuan Hasil Batch
                    </label>
                    <Input
                      id="batch-yield-unit"
                      list="menu-unit-list"
                      value={batchYieldUnit}
                      onChange={(e) => setBatchYieldUnit(e.target.value)}
                      placeholder="Gram / ml / Slice"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="waste-loss-pct"
                      className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Susut Masak / Panggang (%)
                    </label>
                    <Input
                      id="waste-loss-pct"
                      type="number"
                      min={0}
                      max={99}
                      step="any"
                      value={wasteLossPct}
                      onChange={(e) => setWasteLossPct(e.target.value)}
                      className="h-8 text-xs tabular-nums"
                    />
                  </div>
                </div>

                {itemType === "prepared" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="shelf-life-days"
                        className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Masa Simpan Dapur (Hari, Opsional)
                      </label>
                      <Input
                        id="shelf-life-days"
                        type="number"
                        min={0}
                        value={shelfLifeDays}
                        onChange={(e) => setShelfLifeDays(e.target.value)}
                        placeholder="Contoh: 5"
                        className="h-8 text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="storage-method"
                        className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Cara Penyimpanan (Opsional)
                      </label>
                      <select
                        id="storage-method"
                        value={storageMethod}
                        onChange={(e) => setStorageMethod(e.target.value)}
                        className="h-8 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Tidak ditentukan</option>
                        <option value="Chiller">Chiller (Kulkas)</option>
                        <option value="Freezer">Freezer (Beku)</option>
                        <option value="Suhu Ruang">Suhu Ruang</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Harga Jual & Ringkasan HPP */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {isSellable && (
                <>
                  <div>
                    <label
                      htmlFor="menu-price"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Harga Jual (Rp)
                    </label>
                    <Input
                      id="menu-price"
                      type="number"
                      min={0}
                      step="any"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="0"
                      className="h-9 text-xs tabular-nums bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="menu-target-fc"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Target Food Cost (%)
                    </label>
                    <Input
                      id="menu-target-fc"
                      type="number"
                      min={1}
                      max={99}
                      step="any"
                      value={targetFoodCostPct}
                      onChange={(e) => setTargetFoodCostPct(e.target.value)}
                      placeholder="35"
                      className="h-9 text-xs tabular-nums bg-white dark:bg-slate-950"
                    />
                  </div>
                </>
              )}

              <div className={isSellable ? "" : "sm:col-span-2"}>
                <label
                  htmlFor="menu-hpp-mode"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Sumber Perhitungan HPP
                </label>
                <select
                  id="menu-hpp-mode"
                  value={hppMode}
                  onChange={(e) => setHppMode(e.target.value as MenuHppMode)}
                  className="h-9 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="auto">Otomatis (Resep jika ada, atau Manual)</option>
                  <option value="manual">HPP Manual</option>
                  <option value="recipe">Selalu dari Resep</option>
                </select>
              </div>

              <div className={isSellable ? "" : "sm:col-span-2"}>
                <label
                  htmlFor="menu-hpp-manual"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  HPP Manual (Rp)
                </label>
                <Input
                  id="menu-hpp-manual"
                  type="number"
                  min={0}
                  step="any"
                  value={hppManual}
                  onChange={(e) => setHppManual(e.target.value)}
                  placeholder="0"
                  className="h-9 text-xs tabular-nums bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            {/* Live Financial Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Bahan / Isi
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(recipeSummary.unitIngredientCost)}
                </div>
                {isSellable && sellingPriceNum > 0 && (
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">
                    Food Cost: {pureFoodCostPct.toFixed(1)}%
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Kemasan
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(recipeSummary.subtotalPackaging)}
                </div>
                {isSellable && sellingPriceNum > 0 && (
                  <div className="text-[10px] text-slate-600 dark:text-slate-400">
                    {packagingCostPct.toFixed(1)}% dari jual
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Labor &amp; Lainnya
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(
                    recipeSummary.unitLaborCost + recipeSummary.unitOtherFee
                  )}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Total HPP Efektif
                </div>
                <div className="font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {formatRupiah(effectiveHpp)}
                </div>
                {isSellable && sellingPriceNum > 0 && (
                  <div
                    className={`text-[10px] font-semibold tabular-nums ${
                      foodCostPct <= 35
                        ? "text-emerald-700 dark:text-emerald-400"
                        : foodCostPct <= 45
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-rose-700 dark:text-rose-400"
                    }`}
                  >
                    Total HPP: {foodCostPct.toFixed(1)}%
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  {isSellable ? "Margin Kotor" : "Status"}
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {isSellable
                    ? sellingPriceNum > 0
                      ? formatRupiah(grossMargin)
                      : "-"
                    : "Pemakaian Internal"}
                </div>
              </div>
            </div>

            {/* Multi-Channel Pricing Panel */}
            {isSellable && effectiveHpp > 0 && pricingChannels.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowChannelPricing((p) => !p)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                    aria-expanded={showChannelPricing}
                  >
                    <Percent className="w-3.5 h-3.5" />
                    <span>Kalkulator Net Margin Multi-Channel (GoFood / Grab / Shopee)</span>
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
                      className="h-7 px-2 text-[11px] gap-1 text-slate-700 dark:text-slate-300"
                    >
                      <Settings2 className="w-3 h-3" />
                      <span>Atur Komisi</span>
                    </Button>
                  )}
                </div>

                {showChannelPricing && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
                        <tr>
                          <th className="text-left px-2.5 py-1.5 font-semibold">Channel</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold">Potongan</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold">Net Terima</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold">Net Margin</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold">Saran Harga</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {channelAnalysis.map((ch) => (
                          <tr key={ch.key}>
                            <td className="px-2.5 py-1.5 font-medium text-slate-900 dark:text-slate-100">
                              {ch.name}{" "}
                              <span className="text-slate-600 dark:text-slate-400 font-normal">
                                ({ch.commission_pct}%
                                {ch.fixed_fee > 0 ? ` + ${formatRupiah(ch.fixed_fee)}` : ""})
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {sellingPriceNum > 0 ? formatRupiah(ch.commission) : "-"}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums">
                              {sellingPriceNum > 0 ? formatRupiah(ch.netReceived) : "-"}
                            </td>
                            <td
                              className={`px-2.5 py-1.5 text-right tabular-nums font-semibold ${
                                ch.netMargin >= 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-rose-700 dark:text-rose-400"
                              }`}
                            >
                              {sellingPriceNum > 0
                                ? `${formatRupiah(ch.netMargin)} (${ch.netMarginPct.toFixed(1)}%)`
                                : "-"}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-300">
                              {ch.suggestedPrice ? formatRupiah(ch.suggestedPrice) : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SECTION 1: BAHAN RESEP / ISI PRODUK */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-blue-600" />
                  <span>
                    1. Bahan Resep / Isi Produk ({ingredientRows.length} item)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Pilih bahan mentah dari Master Item atau masukkan Sub-Resep Prepared / menu lain. Biaya bagian ini dihitung per batch lalu dibagi hasil bersih ({Number(netYieldQty.toFixed(2))} {batchYieldUnit || unit}).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setIngredients((prev) => [
                    ...prev,
                    emptyIngredientRow("ingredient"),
                  ])
                }
                className="h-8 text-xs gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Bahan</span>
              </Button>
            </div>

            {ingredientRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-4 px-3 text-center text-xs text-slate-600 dark:text-slate-400">
                Belum ada bahan resep / isi produk. Klik &quot;Tambah Bahan&quot; untuk menyusun komposisi.
              </div>
            ) : (
              <div className="space-y-2">
                {ingredientRows.map((row) => {
                  const calc = recipeSummary.rowMap.get(row.key) || {
                    sourceUnitPrice: 0,
                    cost: 0,
                  };
                  const subMenu =
                    row.sub_menu_id !== null
                      ? subMenuMap.get(row.sub_menu_id)
                      : undefined;
                  return (
                    <IngredientRowCard
                      key={row.key}
                      row={row}
                      cost={calc.cost}
                      sourceUnitPrice={calc.sourceUnitPrice}
                      isSubMenu={row.sub_menu_id !== null}
                      subMenuType={subMenu?.item_type}
                      masterItems={masterItems}
                      menuOptions={allMenus}
                      excludeMenuId={editingMenu?.id}
                      onChangeSource={handleChangeSource}
                      onUpdateRow={handleUpdateRow}
                      onUnitChange={handleUnitChange}
                      onRemove={(key) =>
                        setIngredients((prev) =>
                          prev.filter((r) => r.key !== key)
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: KEMASAN & PACKAGING (DIPISAH DARI BAHAN) */}
          <div className="space-y-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                  <span>
                    2. Kemasan &amp; Packaging ({packagingRows.length} item)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Dipisah dari bahan makanan (box, mika, pita, stiker, kartu ucapan). Dihitung per 1 satuan jual (tidak dibagi batch yield).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setIngredients((prev) => [
                    ...prev,
                    emptyIngredientRow("packaging"),
                  ])
                }
                className="h-8 text-xs gap-1 bg-white dark:bg-slate-900"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Kemasan</span>
              </Button>
            </div>

            {packagingRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-white/70 dark:bg-slate-950/60 py-3.5 px-3 text-center text-xs text-slate-600 dark:text-slate-400">
                Belum ada komponen kemasan terpisah. Tambahkan box, botol, pita, atau stiker jika item ini memakai kemasan.
              </div>
            ) : (
              <div className="space-y-2">
                {packagingRows.map((row) => {
                  const calc = recipeSummary.rowMap.get(row.key) || {
                    sourceUnitPrice: 0,
                    cost: 0,
                  };
                  const subMenu =
                    row.sub_menu_id !== null
                      ? subMenuMap.get(row.sub_menu_id)
                      : undefined;
                  return (
                    <IngredientRowCard
                      key={row.key}
                      row={row}
                      cost={calc.cost}
                      sourceUnitPrice={calc.sourceUnitPrice}
                      isSubMenu={row.sub_menu_id !== null}
                      subMenuType={subMenu?.item_type}
                      masterItems={masterItems}
                      menuOptions={allMenus}
                      excludeMenuId={editingMenu?.id}
                      onChangeSource={handleChangeSource}
                      onUpdateRow={handleUpdateRow}
                      onUnitChange={handleUnitChange}
                      onRemove={(key) =>
                        setIngredients((prev) =>
                          prev.filter((r) => r.key !== key)
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          <datalist id="menu-unit-list">
            {units.map((u) => (
              <option key={u} value={u} />
            ))}
            <option value="Gram" />
            <option value="ml" />
            <option value="Kg" />
            <option value="Liter" />
            <option value="Pcs" />
            <option value="Porsi" />
            <option value="Slice" />
            <option value="Box" />
            <option value="Paket" />
          </datalist>

          {/* SECTION 3: TENAGA KERJA & BIAYA LAINNYA */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                3. Tenaga Kerja (Labor) &amp; Biaya Operasional Batch
              </div>
              <span className="text-[11px] text-slate-600 dark:text-slate-400">
                Opsional per 1 batch (ikut terbagi ke net yield)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start">
              <div className="sm:col-span-4">
                <label
                  htmlFor="recipe-labor-cost"
                  className="block text-[11px] text-slate-700 dark:text-slate-300 mb-0.5 font-medium"
                >
                  Biaya Tenaga Kerja / Labor (Rp)
                </label>
                <Input
                  id="recipe-labor-cost"
                  type="number"
                  min={0}
                  step="any"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs tabular-nums bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-3">
                <label
                  htmlFor="recipe-other-fee"
                  className="block text-[11px] text-slate-700 dark:text-slate-300 mb-0.5 font-medium"
                >
                  Biaya Lainnya (Rp)
                </label>
                <Input
                  id="recipe-other-fee"
                  type="number"
                  min={0}
                  step="any"
                  value={otherFee}
                  onChange={(e) => setOtherFee(e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs tabular-nums bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-5">
                <label
                  htmlFor="recipe-other-fee-desc"
                  className="block text-[11px] text-slate-700 dark:text-slate-300 mb-0.5 font-medium"
                >
                  Keterangan Biaya Lainnya
                </label>
                <Input
                  id="recipe-other-fee-desc"
                  value={otherFeeDescription}
                  onChange={(e) => setOtherFeeDescription(e.target.value)}
                  placeholder="Contoh: Gas oven, listrik mixer, penyusutan"
                  className="h-8 text-xs bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            {!otherFeeDescription && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  "Gas & Listrik Oven",
                  "Penyusutan Peralatan",
                  "Tenaga Dekorasi",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setOtherFeeDescription(chip)}
                    className="px-2 py-0.5 rounded text-[11px] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-600 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div>
              <label
                htmlFor="menu-notes"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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

            <div className="pt-5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  {itemType === "prepared"
                    ? "Resep prepared aktif dipakai"
                    : "Menu aktif dijual"}
                </span>
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Menyimpan..."
                : editingMenu
                ? "Simpan Perubahan"
                : "Simpan Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
