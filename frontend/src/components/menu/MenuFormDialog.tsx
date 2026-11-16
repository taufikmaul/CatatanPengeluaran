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
import {
  MasterItem,
  MenuHppMode,
  MenuIngredientInput,
  MenuProduct,
  MenuProductPayload,
} from "@/types";
import { Plus, Trash2, Calculator } from "lucide-react";

interface IngredientDraftRow {
  key: string;
  master_item_id: number | null;
  ingredient_name: string;
  qty: string;
  unit: string;
  unit_cost_override: string;
  yield_factor: string;
  notes: string;
}

interface MenuFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingMenu: MenuProduct | null;
  masterItems: MasterItem[];
  units: string[];
  existingCategories: string[];
  isSubmitting: boolean;
  onSubmit: (payload: MenuProductPayload) => void;
}

function emptyIngredientRow(): IngredientDraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    master_item_id: null,
    ingredient_name: "",
    qty: "1",
    unit: "Gram",
    unit_cost_override: "",
    yield_factor: "1",
    notes: "",
  };
}

export const MenuFormDialog: React.FC<MenuFormDialogProps> = ({
  open,
  onOpenChange,
  editingMenu,
  masterItems,
  units,
  existingCategories,
  isSubmitting,
  onSubmit,
}) => {
  const [name, setName] = useState("");
  const [anonymousName, setAnonymousName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("Cake Ready");
  const [productGroup, setProductGroup] = useState("");
  const [unit, setUnit] = useState("Porsi");
  const [sellingPrice, setSellingPrice] = useState("");
  const [hppManual, setHppManual] = useState("");
  const [hppMode, setHppMode] = useState<MenuHppMode>("auto");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [ingredients, setIngredients] = useState<IngredientDraftRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const masterMap = useMemo(() => {
    const map = new Map<number, MasterItem>();
    for (const m of masterItems) {
      map.set(m.id, m);
    }
    return map;
  }, [masterItems]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (editingMenu) {
      setName(editingMenu.name);
      setAnonymousName(editingMenu.anonymous_name || "");
      setSku(editingMenu.sku || "");
      setCategory(editingMenu.category || "Lainnya");
      setProductGroup(editingMenu.product_group || "");
      setUnit(editingMenu.unit || "Porsi");
      setSellingPrice(String(editingMenu.selling_price || 0));
      setHppManual(String(editingMenu.hpp_manual || 0));
      setHppMode(editingMenu.hpp_mode || "auto");
      setNotes(editingMenu.notes || "");
      setIsActive(editingMenu.is_active);
      setIngredients(
        (editingMenu.ingredients || []).map((ing, idx) => ({
          key: `${ing.id || idx}-${Date.now()}`,
          master_item_id: ing.master_item_id ?? null,
          ingredient_name: ing.ingredient_name,
          qty: String(ing.qty ?? 1),
          unit: ing.unit || "Gram",
          unit_cost_override:
            ing.unit_cost_override !== null && ing.unit_cost_override !== undefined
              ? String(ing.unit_cost_override)
              : "",
          yield_factor: String(ing.yield_factor ?? 1),
          notes: ing.notes || "",
        }))
      );
    } else {
      setName("");
      setAnonymousName("");
      setSku("");
      setCategory(existingCategories[0] || "Cake Ready");
      setProductGroup("");
      setUnit("Porsi");
      setSellingPrice("");
      setHppManual("");
      setHppMode("auto");
      setNotes("");
      setIsActive(true);
      setIngredients([]);
    }
  }, [open, editingMenu, existingCategories]);

  const recipeSummary = useMemo(() => {
    let total = 0;
    const rowCosts = ingredients.map((row) => {
      const qtyNum = Math.max(0, Number(row.qty) || 0);
      const yieldNum = Math.max(0.0001, Number(row.yield_factor) || 1);
      const overrideVal =
        row.unit_cost_override.trim() !== "" ? Number(row.unit_cost_override) : null;
      const masterPrice =
        row.master_item_id !== null
          ? Number(masterMap.get(row.master_item_id)?.last_unit_price || 0)
          : 0;
      const unitCost = overrideVal !== null && !Number.isNaN(overrideVal) ? overrideVal : masterPrice;
      const cost = (qtyNum / yieldNum) * unitCost;
      total += cost;
      return { unitCost, masterPrice, cost };
    });
    return { total: Math.round(total), rowCosts };
  }, [ingredients, masterMap]);

  const sellingPriceNum = Math.max(0, Number(sellingPrice) || 0);
  const hppManualNum = Math.max(0, Number(hppManual) || 0);
  const effectiveHpp = useMemo(() => {
    if (hppMode === "manual") return hppManualNum;
    if (hppMode === "recipe") return recipeSummary.total;
    return ingredients.length > 0 ? recipeSummary.total : hppManualNum;
  }, [hppMode, hppManualNum, recipeSummary.total, ingredients.length]);

  const foodCostPct = sellingPriceNum > 0 ? (effectiveHpp / sellingPriceNum) * 100 : 0;
  const grossMargin = sellingPriceNum - effectiveHpp;

  const handleSelectMasterItem = (rowKey: string, rawId: string) => {
    const mid = rawId ? Number(rawId) : null;
    const found = mid ? masterMap.get(mid) : undefined;
    setIngredients((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
        if (!found) {
          return { ...r, master_item_id: null };
        }
        return {
          ...r,
          master_item_id: found.id,
          ingredient_name: found.item_name,
          unit: found.satuan_ecer || found.satuan_beli || r.unit,
        };
      })
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

    const parsedIngredients: MenuIngredientInput[] = [];
    for (const row of ingredients) {
      const ingName = row.ingredient_name.trim();
      if (!ingName && row.master_item_id === null) continue;
      const qtyVal = Number(row.qty);
      const yieldVal = Number(row.yield_factor) || 1;
      if (Number.isNaN(qtyVal) || qtyVal < 0) {
        setFormError(`Qty bahan "${ingName || "tanpa nama"}" tidak valid.`);
        return;
      }
      if (yieldVal <= 0) {
        setFormError(`Pembagi kemasan (yield) bahan "${ingName || "tanpa nama"}" harus > 0.`);
        return;
      }
      const overrideVal =
        row.unit_cost_override.trim() !== "" ? Number(row.unit_cost_override) : null;
      if (overrideVal !== null && (Number.isNaN(overrideVal) || overrideVal < 0)) {
        setFormError(`Harga satuan override untuk "${ingName}" tidak valid.`);
        return;
      }
      parsedIngredients.push({
        master_item_id: row.master_item_id,
        ingredient_name: ingName,
        qty: qtyVal,
        unit: row.unit.trim() || "Gram",
        unit_cost_override: overrideVal,
        yield_factor: yieldVal,
        notes: row.notes.trim() || null,
      });
    }

    onSubmit({
      name: cleanName,
      anonymous_name: anonymousName.trim() || null,
      sku: sku.trim() || null,
      category: category.trim() || "Lainnya",
      product_group: productGroup.trim() || null,
      unit: unit.trim() || "Porsi",
      selling_price: sellingPriceNum,
      hpp_manual: hppManualNum,
      hpp_mode: hppMode,
      notes: notes.trim() || null,
      is_active: isActive,
      ingredients: parsedIngredients,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingMenu ? "Edit Menu / Produk & HPP" : "Tambah Menu / Produk Baru"}
          </DialogTitle>
          <DialogDescription>
            Atur harga jual, nama anonim (opsional otomatis), dan HPP / Food Cost secara manual atau dari resep bahan Master Item.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {formError}
            </div>
          )}

          {/* Identitas Menu */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="menu-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nama Menu / Produk <span className="text-rose-600">*</span>
              </label>
              <Input
                id="menu-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Classic Tiramisu Slice"
                className="h-9 text-xs"
                required
              />
            </div>

            <div>
              <label htmlFor="menu-anon" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Kode / Nama Anonim
              </label>
              <Input
                id="menu-anon"
                value={anonymousName}
                onChange={(e) => setAnonymousName(e.target.value)}
                placeholder="Kosongkan untuk otomatis (MENU-001)"
                className="h-9 text-xs font-mono"
              />
            </div>

            <div>
              <label htmlFor="menu-category" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Kategori Menu
              </label>
              <Input
                id="menu-category"
                list="menu-category-suggestions"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Contoh: Cake Ready, Minuman"
                className="h-9 text-xs"
              />
              <datalist id="menu-category-suggestions">
                {existingCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
                <option value="Cake Ready" />
                <option value="Minuman" />
                <option value="Pastry" />
                <option value="Dessert Box" />
                <option value="Custom Cake" />
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="menu-sku" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
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
                <label htmlFor="menu-unit" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Satuan Jual
                </label>
                <Input
                  id="menu-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Porsi / Box / Slice"
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Harga Jual & Mode HPP */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="menu-price" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
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
                  className="h-9 text-xs tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="menu-hpp-mode" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Sumber Perhitungan HPP
                </label>
                <select
                  id="menu-hpp-mode"
                  value={hppMode}
                  onChange={(e) => setHppMode(e.target.value as MenuHppMode)}
                  className="h-9 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="auto">Otomatis (Resep jika ada, atau Manual)</option>
                  <option value="manual">HPP Manual</option>
                  <option value="recipe">Selalu dari Resep Bahan</option>
                </select>
              </div>

              <div>
                <label htmlFor="menu-hpp-manual" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  HPP / Food Cost Manual (Rp)
                </label>
                <Input
                  id="menu-hpp-manual"
                  type="number"
                  min={0}
                  step="any"
                  value={hppManual}
                  onChange={(e) => setHppManual(e.target.value)}
                  placeholder="0"
                  className="h-9 text-xs tabular-nums"
                />
              </div>
            </div>

            {/* Live Financial Summary */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">HPP Efektif</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(effectiveHpp)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">Food Cost %</div>
                <div
                  className={`font-semibold tabular-nums ${
                    foodCostPct <= 35
                      ? "text-emerald-700 dark:text-emerald-400"
                      : foodCostPct <= 45
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-rose-700 dark:text-rose-400"
                  }`}
                >
                  {sellingPriceNum > 0 ? `${foodCostPct.toFixed(1)}%` : "-"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">Margin Kotor</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(grossMargin)}
                </div>
              </div>
            </div>
          </div>

          {/* Recipe / BOM Builder */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-blue-600" />
                  <span>Rincian Resep Bahan (Opsional)</span>
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Pilih bahan dari Master Item untuk mengambil harga beli terakhir, atau isi biaya satuan manual. Isi Pembagi Kemasan (Yield) misalnya 1000 jika harga Master Item per Kg dan takaran resep dalam Gram.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIngredients((prev) => [...prev, emptyIngredientRow()])}
                className="h-8 text-xs gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Bahan
              </Button>
            </div>

            {ingredients.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-4 px-3 text-center text-xs text-slate-600 dark:text-slate-400">
                Belum ada rincian bahan resep. HPP akan menggunakan nilai HPP Manual.
              </div>
            ) : (
              <div className="space-y-2">
                {ingredients.map((row, idx) => {
                  const rowCalc = recipeSummary.rowCosts[idx] || {
                    unitCost: 0,
                    masterPrice: 0,
                    cost: 0,
                  };
                  return (
                    <div
                      key={row.key}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2.5 space-y-2"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Master Item (Opsional)
                          </label>
                          <select
                            value={row.master_item_id ?? ""}
                            onChange={(e) => handleSelectMasterItem(row.key, e.target.value)}
                            className="h-8 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs text-slate-900 dark:text-slate-100"
                          >
                            <option value="">Input Bahan Manual</option>
                            {masterItems.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.item_name} ({m.satuan_beli}
                                {m.last_unit_price > 0 ? ` - ${formatRupiah(m.last_unit_price)}` : ""})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Nama Bahan
                          </label>
                          <Input
                            value={row.ingredient_name}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, ingredient_name: e.target.value } : r
                                )
                              )
                            }
                            placeholder="Nama bahan resep"
                            className="h-8 text-xs"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Takaran
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={row.qty}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, qty: e.target.value } : r
                                )
                              )
                            }
                            className="h-8 text-xs tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Satuan
                          </label>
                          <Input
                            list="menu-unit-list"
                            value={row.unit}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, unit: e.target.value } : r
                                )
                              )
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Harga Satuan Override (Rp)
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={row.unit_cost_override}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.key === row.key
                                    ? { ...r, unit_cost_override: e.target.value }
                                    : r
                                )
                              )
                            }
                            placeholder={
                              rowCalc.masterPrice > 0
                                ? `Auto: ${formatRupiah(rowCalc.masterPrice)}`
                                : "Isi harga beli"
                            }
                            className="h-8 text-xs tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Pembagi Kemasan (Yield)
                          </label>
                          <Input
                            type="number"
                            min={0.0001}
                            step="any"
                            value={row.yield_factor}
                            onChange={(e) =>
                              setIngredients((prev) =>
                                prev.map((r) =>
                                  r.key === row.key ? { ...r, yield_factor: e.target.value } : r
                                )
                              )
                            }
                            className="h-8 text-xs tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-4 flex items-center justify-between sm:justify-end gap-2 pt-3 sm:pt-4">
                          <span className="text-[11px] text-slate-600 dark:text-slate-400">
                            Subtotal:
                          </span>
                          <Badge variant="outline" className="text-xs font-semibold tabular-nums">
                            {formatRupiah(rowCalc.cost)}
                          </Badge>
                        </div>

                        <div className="sm:col-span-1 flex justify-end pt-3 sm:pt-4">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setIngredients((prev) => prev.filter((r) => r.key !== row.key))
                            }
                            aria-label="Hapus bahan"
                            className="h-8 w-8 p-0 text-slate-500 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <datalist id="menu-unit-list">
                  {units.map((u) => (
                    <option key={u} value={u} />
                  ))}
                  <option value="Gram" />
                  <option value="ml" />
                  <option value="Pcs" />
                </datalist>
                <div className="flex justify-end text-xs font-semibold text-slate-800 dark:text-slate-200 pt-1">
                  Total HPP Resep: <span className="ml-1.5 tabular-nums">{formatRupiah(recipeSummary.total)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Status & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div>
              <label htmlFor="menu-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Catatan (Opsional)
              </label>
              <Input
                id="menu-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan porsi, packaging, atau margin target"
                className="h-9 text-xs"
              />
            </div>

            <div className="pt-5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Menu aktif dijual</span>
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
              {isSubmitting ? "Menyimpan..." : editingMenu ? "Simpan Perubahan" : "Simpan Menu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
