import React from "react";
import { MasterItemPackaging } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { formatConversionQty } from "@/lib/packagingConversion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { Plus, Trash2, Star, ArrowRight } from "lucide-react";

export interface EditablePackagingVariant {
  localId: string;
  id?: number;
  label: string;
  purchase_unit: string;
  retail_qty: string;
  retail_unit: string;
  base_qty: string;
  base_unit: string;
  keywords: string;
  is_default: boolean;
  is_active: boolean;
  last_unit_price?: number | null;
}

export function toEditableVariants(
  packagings: MasterItemPackaging[] | undefined
): EditablePackagingVariant[] {
  if (!packagings || packagings.length === 0) return [];
  return packagings.map((p, idx) => ({
    localId: `pkg-${p.id || idx}-${idx}`,
    id: p.id,
    label: p.label || "",
    purchase_unit: p.purchase_unit || "Pcs",
    retail_qty: String(p.retail_qty ?? 1),
    retail_unit: p.retail_unit || p.purchase_unit || "Pcs",
    base_qty: String(p.base_qty ?? ""),
    base_unit: p.base_unit || "Gram",
    keywords: p.keywords || "",
    is_default: Boolean(p.is_default),
    is_active: p.is_active !== false,
    last_unit_price: p.last_unit_price ?? null,
  }));
}

export function toApiPackagingsPayload(
  rows: EditablePackagingVariant[]
): MasterItemPackaging[] {
  return rows
    .filter(
      (r) =>
        r.purchase_unit.trim() &&
        r.base_unit.trim() &&
        Number(r.base_qty) > 0 &&
        Number(r.retail_qty || 1) > 0
    )
    .map((r, idx, arr) => {
      const pUnit = r.purchase_unit.trim();
      const rQty = Math.max(0.0001, Number(r.retail_qty) || 1);
      const rUnit = r.retail_unit.trim() || pUnit;
      const bQty = Number(r.base_qty);
      const bUnit = r.base_unit.trim();
      const autoLabel =
        r.label.trim() ||
        `${pUnit} (${formatConversionQty(rQty)} ${rUnit} = ${formatConversionQty(bQty)} ${bUnit})`;
      const hasAnyDefault = arr.some((x) => x.is_default);
      return {
        label: autoLabel.slice(0, 120),
        purchase_unit: pUnit,
        retail_qty: rQty,
        retail_unit: rUnit,
        base_qty: bQty,
        base_unit: bUnit,
        keywords: r.keywords.trim(),
        is_default: hasAnyDefault ? r.is_default : idx === 0,
        is_active: r.is_active !== false,
      };
    });
}

interface PackagingVariantsEditorProps {
  variants: EditablePackagingVariant[];
  onChange: (next: EditablePackagingVariant[]) => void;
  units: string[];
  recipeUnits: string[];
  defaultPurchaseUnit: string;
  defaultRetailUnit: string;
  defaultBaseUnit: string;
  defaultBaseQty: string;
}

export const PackagingVariantsEditor: React.FC<PackagingVariantsEditorProps> = ({
  variants,
  onChange,
  units,
  recipeUnits,
  defaultPurchaseUnit,
  defaultRetailUnit,
  defaultBaseUnit,
  defaultBaseQty,
}) => {
  const handleAddVariant = () => {
    const baseU = defaultBaseUnit.trim() || variants[0]?.base_unit || "Gram";
    const pUnit = defaultPurchaseUnit.trim() || "Box";
    const rUnit = defaultRetailUnit.trim() || "Pcs";
    const bQtyNum = Number(defaultBaseQty);
    const nextRow: EditablePackagingVariant = {
      localId: `pkg-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: "",
      purchase_unit: pUnit,
      retail_qty: "1",
      retail_unit: rUnit,
      base_qty: variants.length === 0 && bQtyNum > 0 ? String(bQtyNum) : "",
      base_unit: baseU,
      keywords: "",
      is_default: variants.length === 0,
      is_active: true,
    };
    onChange([...variants, nextRow]);
  };

  const updateRow = (localId: string, patch: Partial<EditablePackagingVariant>) => {
    onChange(
      variants.map((v) => {
        if (patch.is_default) {
          return v.localId === localId
            ? { ...v, ...patch, is_default: true }
            : { ...v, is_default: false };
        }
        return v.localId === localId ? { ...v, ...patch } : v;
      })
    );
  };

  const removeRow = (localId: string) => {
    const filtered = variants.filter((v) => v.localId !== localId);
    if (filtered.length > 0 && !filtered.some((v) => v.is_default)) {
      filtered[0] = { ...filtered[0], is_default: true };
    }
    onChange(filtered);
  };

  return (
    <div className="pt-3 border-t border-border/70 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-foreground block">
            Varian Kemasan Bertingkat (Multi-Kemasan)
          </span>
          <span className="text-[11px] text-muted-foreground">
            Opsional untuk item dengan beberapa kemasan (mis. Karton Pouch 8x2kg vs Karton Kaleng 24x480g).
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddVariant}
          className="h-7 px-2.5 text-[11px] gap-1 shrink-0"
        >
          <Plus className="w-3 h-3" />
          Tambah Varian
        </Button>
      </div>

      {variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
          Belum ada varian kemasan tambahan. Item menggunakan konversi tunggal di atas.
        </div>
      ) : (
        <div className="space-y-2.5">
          {variants.map((v) => {
            const rQty = Number(v.retail_qty) || 1;
            const bQty = Number(v.base_qty) || 0;
            const unitCost =
              v.last_unit_price && v.last_unit_price > 0 && bQty > 0
                ? v.last_unit_price / bQty
                : null;
            return (
              <div
                key={v.localId}
                className="rounded-lg border border-border/80 bg-background p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Input
                    placeholder="Nama varian (mis. Karton Kaleng 24x480g)"
                    value={v.label}
                    onChange={(e) => updateRow(v.localId, { label: e.target.value })}
                    className="h-8 text-xs font-medium flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => updateRow(v.localId, { is_default: true })}
                    title={v.is_default ? "Varian default" : "Jadikan varian default"}
                    className={`h-8 px-2 rounded-md border text-[11px] inline-flex items-center gap-1 transition-colors shrink-0 ${
                      v.is_default
                        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-semibold"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Star className="w-3 h-3" />
                    {v.is_default ? "Default" : "Set Default"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(v.localId)}
                    title="Hapus varian kemasan"
                    className="h-8 w-8 rounded-md border border-border inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/50 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Satuan Beli
                    </label>
                    <AdaptiveSelect
                      value={v.purchase_unit}
                      onValueChange={(val) => updateRow(v.localId, { purchase_unit: val })}
                      options={units}
                      creatable={true}
                      creatablePrefix="Satuan"
                      placeholder="Karton..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Isi Ecer / 1 Beli
                    </label>
                    <Input
                      type="number"
                      min={0.0001}
                      step="any"
                      placeholder="24"
                      value={v.retail_qty}
                      onChange={(e) => updateRow(v.localId, { retail_qty: e.target.value })}
                      className="h-9 text-xs tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Satuan Ecer
                    </label>
                    <AdaptiveSelect
                      value={v.retail_unit}
                      onValueChange={(val) => updateRow(v.localId, { retail_unit: val })}
                      options={units}
                      creatable={true}
                      creatablePrefix="Satuan"
                      placeholder="Kaleng..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Total Resep
                    </label>
                    <Input
                      type="number"
                      min={0.0001}
                      step="any"
                      placeholder="11520"
                      value={v.base_qty}
                      onChange={(e) => updateRow(v.localId, { base_qty: e.target.value })}
                      className="h-9 text-xs tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Satuan Resep
                    </label>
                    <AdaptiveSelect
                      value={v.base_unit}
                      onValueChange={(val) => updateRow(v.localId, { base_unit: val })}
                      options={recipeUnits}
                      creatable={true}
                      creatablePrefix="Satuan"
                      placeholder="Gram..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center pt-0.5">
                  <Input
                    placeholder="Kata kunci struk (pisahkan koma: klg, kaleng, 480g)"
                    value={v.keywords}
                    onChange={(e) => updateRow(v.localId, { keywords: e.target.value })}
                    className="h-7 text-[11px]"
                  />
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium justify-start sm:justify-end">
                    <span>1 {v.purchase_unit || "Beli"}</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span>
                      {formatConversionQty(rQty)} {v.retail_unit || v.purchase_unit}
                    </span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <strong className="tabular-nums">
                      {bQty > 0 ? `${formatConversionQty(bQty)} ${v.base_unit || ""}` : "—"}
                    </strong>
                    {unitCost !== null && (
                      <span className="text-muted-foreground font-normal">
                        ({formatRupiah(unitCost)}/{v.base_unit})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
