import React, { useState } from "react";
import { MasterItem, MasterItemPackaging } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { formatConversionQty } from "@/lib/packagingConversion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { Plus, Trash2, Star, ArrowRight, ChevronDown } from "lucide-react";

export interface EditablePackagingVariant {
  localId: string;
  id?: number;
  label: string;
  purchase_unit: string;
  retail_qty: string;
  retail_unit: string;
  per_retail_qty: string;
  per_retail_unit: string;
  manual_base_qty: string;
  use_manual_total: boolean;
  keywords: string;
  is_default: boolean;
  is_active: boolean;
  last_unit_price?: number | null;
}

interface UnitSpec {
  family: "mass" | "volume" | "length" | "count" | "egg" | "sheet";
  canonical: string;
  factorToBase: number;
  baseUnit: string;
}

const UNIT_FAMILY_MAP: Record<string, UnitSpec> = {
  gram: { family: "mass", canonical: "Gram", factorToBase: 1, baseUnit: "Gram" },
  gr: { family: "mass", canonical: "Gram", factorToBase: 1, baseUnit: "Gram" },
  g: { family: "mass", canonical: "Gram", factorToBase: 1, baseUnit: "Gram" },
  grams: { family: "mass", canonical: "Gram", factorToBase: 1, baseUnit: "Gram" },
  ons: { family: "mass", canonical: "Ons", factorToBase: 100, baseUnit: "Gram" },
  oz: { family: "mass", canonical: "Ons", factorToBase: 100, baseUnit: "Gram" },
  kg: { family: "mass", canonical: "Kg", factorToBase: 1000, baseUnit: "Gram" },
  kilogram: { family: "mass", canonical: "Kg", factorToBase: 1000, baseUnit: "Gram" },

  ml: { family: "volume", canonical: "ml", factorToBase: 1, baseUnit: "ml" },
  cc: { family: "volume", canonical: "ml", factorToBase: 1, baseUnit: "ml" },
  l: { family: "volume", canonical: "Liter", factorToBase: 1000, baseUnit: "ml" },
  lt: { family: "volume", canonical: "Liter", factorToBase: 1000, baseUnit: "ml" },
  ltr: { family: "volume", canonical: "Liter", factorToBase: 1000, baseUnit: "ml" },
  liter: { family: "volume", canonical: "Liter", factorToBase: 1000, baseUnit: "ml" },

  cm: { family: "length", canonical: "cm", factorToBase: 1, baseUnit: "cm" },
  m: { family: "length", canonical: "Meter", factorToBase: 100, baseUnit: "cm" },
  meter: { family: "length", canonical: "Meter", factorToBase: 100, baseUnit: "cm" },

  pcs: { family: "count", canonical: "Pcs", factorToBase: 1, baseUnit: "Pcs" },
  pc: { family: "count", canonical: "Pcs", factorToBase: 1, baseUnit: "Pcs" },
  buah: { family: "count", canonical: "Pcs", factorToBase: 1, baseUnit: "Pcs" },
  lusin: { family: "count", canonical: "Lusin", factorToBase: 12, baseUnit: "Pcs" },
  lsn: { family: "count", canonical: "Lusin", factorToBase: 12, baseUnit: "Pcs" },
  kodi: { family: "count", canonical: "Kodi", factorToBase: 20, baseUnit: "Pcs" },
  gross: { family: "count", canonical: "Gross", factorToBase: 144, baseUnit: "Pcs" },

  butir: { family: "egg", canonical: "Butir", factorToBase: 1, baseUnit: "Butir" },
  tray: { family: "egg", canonical: "Tray", factorToBase: 30, baseUnit: "Butir" },

  lembar: { family: "sheet", canonical: "Lembar", factorToBase: 1, baseUnit: "Lembar" },
  lbr: { family: "sheet", canonical: "Lembar", factorToBase: 1, baseUnit: "Lembar" },
};

function lookupUnitSpec(raw: string): UnitSpec | null {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_FAMILY_MAP[cleaned] || null;
}

export function suggestBaseUnitFromUnit(rawUnit: string): string | null {
  return lookupUnitSpec(rawUnit)?.baseUnit || null;
}

export function convertQtyBetweenUnits(
  qty: number,
  fromUnit: string,
  toUnit: string
): number | null {
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const fromClean = fromUnit.trim().toLowerCase();
  const toClean = toUnit.trim().toLowerCase();
  if (!fromClean || !toClean) return null;
  if (fromClean === toClean) {
    return Math.round(qty * 10000) / 10000;
  }

  const fromSpec = lookupUnitSpec(fromUnit);
  const toSpec = lookupUnitSpec(toUnit);
  if (!fromSpec || !toSpec || fromSpec.family !== toSpec.family) {
    return null;
  }
  const value = (qty * fromSpec.factorToBase) / toSpec.factorToBase;
  return Math.round(value * 10000) / 10000;
}

function decomposePerRetail(
  baseQty: number,
  retailQty: number,
  baseUnit: string
): { perQty: string; perUnit: string } {
  if (!(baseQty > 0)) {
    return { perQty: "", perUnit: baseUnit || "Gram" };
  }
  const safeRetail = retailQty > 0 ? retailQty : 1;
  const perBase = Math.round((baseQty / safeRetail) * 10000) / 10000;
  const spec = lookupUnitSpec(baseUnit);

  if (spec?.canonical === "Gram" && perBase >= 1000 && Math.abs(perBase % 1000) < 1e-6) {
    return { perQty: String(Math.round(perBase / 1000)), perUnit: "Kg" };
  }
  if (spec?.canonical === "ml" && perBase >= 1000 && Math.abs(perBase % 1000) < 1e-6) {
    return { perQty: String(Math.round(perBase / 1000)), perUnit: "Liter" };
  }
  return { perQty: String(perBase), perUnit: baseUnit || "Gram" };
}

export function computeVariantBaseQty(
  variant: EditablePackagingVariant,
  itemBaseUnit: string
): number {
  if (variant.use_manual_total) {
    const manual = Number(variant.manual_base_qty);
    return Number.isFinite(manual) && manual > 0 ? Math.round(manual * 10000) / 10000 : 0;
  }

  const rQty = Number(variant.retail_qty) || 1;
  const pQty = Number(variant.per_retail_qty);
  if (!(rQty > 0 && pQty > 0)) {
    const manual = Number(variant.manual_base_qty);
    return Number.isFinite(manual) && manual > 0 ? Math.round(manual * 10000) / 10000 : 0;
  }

  const effectiveBase = itemBaseUnit.trim() || suggestBaseUnitFromUnit(variant.per_retail_unit) || "";
  if (!effectiveBase) return 0;

  const convertedPer = convertQtyBetweenUnits(pQty, variant.per_retail_unit, effectiveBase);
  if (convertedPer === null) {
    const manual = Number(variant.manual_base_qty);
    return Number.isFinite(manual) && manual > 0 ? Math.round(manual * 10000) / 10000 : 0;
  }

  return Math.round(rQty * convertedPer * 10000) / 10000;
}

export function createDefaultPackagingVariant(opts?: {
  purchaseUnit?: string;
  retailUnit?: string;
  perRetailQty?: string;
  perRetailUnit?: string;
  isDefault?: boolean;
}): EditablePackagingVariant {
  const pUnit = opts?.purchaseUnit?.trim() || "Box";
  const rUnit = opts?.retailUnit?.trim() || pUnit;
  const perUnit = opts?.perRetailUnit?.trim() || suggestBaseUnitFromUnit(pUnit) || "Gram";
  const directConverted =
    !opts?.perRetailQty && suggestBaseUnitFromUnit(pUnit)
      ? convertQtyBetweenUnits(1, pUnit, perUnit)
      : null;

  return {
    localId: `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    purchase_unit: pUnit,
    retail_qty: "1",
    retail_unit: rUnit,
    per_retail_qty:
      opts?.perRetailQty ??
      (directConverted && directConverted > 0 ? (perUnit === "Gram" && pUnit === "Kg" ? "1" : String(directConverted)) : ""),
    per_retail_unit:
      opts?.perRetailUnit || (pUnit === "Kg" ? "Kg" : pUnit === "Liter" ? "Liter" : perUnit),
    manual_base_qty: "",
    use_manual_total: false,
    keywords: "",
    is_default: opts?.isDefault ?? true,
    is_active: true,
    last_unit_price: null,
  };
}

export function toEditableVariants(
  packagings: MasterItemPackaging[] | undefined,
  fallbackItem?: Partial<MasterItem>
): EditablePackagingVariant[] {
  if (packagings && packagings.length > 0) {
    return packagings.map((p, idx) => {
      const rQty = p.retail_qty ?? 1;
      const bQty = p.base_qty ?? 0;
      const bUnit = p.base_unit || fallbackItem?.satuan_resep || "Gram";
      const { perQty, perUnit } = decomposePerRetail(bQty, rQty, bUnit);
      return {
        localId: `pkg-${p.id || idx}-${idx}`,
        id: p.id,
        label: p.label || "",
        purchase_unit: p.purchase_unit || "Pcs",
        retail_qty: String(rQty),
        retail_unit: p.retail_unit || p.purchase_unit || "Pcs",
        per_retail_qty: perQty,
        per_retail_unit: perUnit,
        manual_base_qty: bQty > 0 ? String(bQty) : "",
        use_manual_total: false,
        keywords: p.keywords || "",
        is_default: Boolean(p.is_default),
        is_active: p.is_active !== false,
        last_unit_price: p.last_unit_price ?? null,
      };
    });
  }

  if (fallbackItem) {
    const pUnit = fallbackItem.satuan_beli || "Box";
    const rUnit = fallbackItem.satuan_ecer || pUnit;
    const bUnit = fallbackItem.satuan_resep || suggestBaseUnitFromUnit(pUnit) || "Gram";
    const bQty = Number(fallbackItem.konversi_resep) || 0;
    const { perQty, perUnit } = decomposePerRetail(bQty, 1, bUnit);
    return [
      {
        localId: `pkg-legacy-${fallbackItem.id || "new"}`,
        label: "",
        purchase_unit: pUnit,
        retail_qty: "1",
        retail_unit: rUnit,
        per_retail_qty: perQty,
        per_retail_unit: perUnit,
        manual_base_qty: bQty > 0 ? String(bQty) : "",
        use_manual_total: false,
        keywords: "",
        is_default: true,
        is_active: true,
        last_unit_price: null,
      },
    ];
  }

  return [createDefaultPackagingVariant()];
}

export function formatAutoVariantLabel(
  variant: EditablePackagingVariant,
  computedBaseQty: number,
  baseUnit: string
): string {
  const pUnit = variant.purchase_unit.trim() || "Pcs";
  const rQty = Math.max(0.0001, Number(variant.retail_qty) || 1);
  const rUnit = variant.retail_unit.trim() || pUnit;
  const pQty = Number(variant.per_retail_qty) || 0;
  const pPerUnit = variant.per_retail_unit.trim();

  if (rQty > 1 || rUnit.toLowerCase() !== pUnit.toLowerCase()) {
    if (pQty > 0 && pPerUnit) {
      return `${pUnit} (${formatConversionQty(rQty)} ${rUnit} @ ${formatConversionQty(pQty)}${pPerUnit})`;
    }
    return `${pUnit} (${formatConversionQty(rQty)} ${rUnit})`;
  }
  if (computedBaseQty > 0 && baseUnit) {
    return `${pUnit} (${formatConversionQty(computedBaseQty)} ${baseUnit})`;
  }
  return pUnit;
}

export function buildItemUnitPayload(
  variants: EditablePackagingVariant[],
  itemBaseUnit: string
): {
  satuan_beli: string;
  satuan_ecer: string;
  tipe_satuan: "keduanya" | "paket" | "ecer";
  isi_paket: string;
  satuan_resep: string | null;
  konversi_resep: number | null;
  packagings: MasterItemPackaging[];
} {
  const cleanBaseUnit = itemBaseUnit.trim();
  const activeVariants = variants.filter((v) => v.purchase_unit.trim());
  const defaultVar =
    activeVariants.find((v) => v.is_default) || activeVariants[0] || variants[0];

  const satuanBeli = defaultVar?.purchase_unit.trim() || "Pcs";
  const satuanEcer = defaultVar?.retail_unit.trim() || satuanBeli;

  const hasAnyDefault = activeVariants.some((v) => v.is_default);

  const packagings: MasterItemPackaging[] = [];
  for (let idx = 0; idx < activeVariants.length; idx++) {
    const v = activeVariants[idx];
    const pUnit = v.purchase_unit.trim();
    const rQty = Math.max(0.0001, Number(v.retail_qty) || 1);
    const rUnit = v.retail_unit.trim() || pUnit;
    const bQty = computeVariantBaseQty(v, cleanBaseUnit);
    if (!cleanBaseUnit || !(bQty > 0)) continue;

    const autoLabel = v.label.trim() || formatAutoVariantLabel(v, bQty, cleanBaseUnit);
    packagings.push({
      label: autoLabel.slice(0, 120),
      purchase_unit: pUnit,
      retail_qty: rQty,
      retail_unit: rUnit,
      base_qty: bQty,
      base_unit: cleanBaseUnit,
      keywords: v.keywords.trim(),
      is_default: hasAnyDefault ? v.is_default : idx === 0,
      is_active: v.is_active !== false,
    });
  }

  const defaultPkg = packagings.find((p) => p.is_default) || packagings[0];
  const defaultComputedBase = defaultPkg
    ? defaultPkg.base_qty
    : defaultVar
    ? computeVariantBaseQty(defaultVar, cleanBaseUnit)
    : 0;

  const hasMultiVariant = packagings.length > 1;
  const hasRetailTier =
    Boolean(defaultVar) &&
    ((Number(defaultVar.retail_qty) || 1) > 1 ||
      (defaultVar.retail_unit.trim() || satuanBeli).toLowerCase() !== satuanBeli.toLowerCase());

  const tipeSatuan: "keduanya" | "paket" | "ecer" =
    hasMultiVariant || hasRetailTier ? "keduanya" : "paket";

  const summaryParts = activeVariants
    .map((v) => {
      const bQty = computeVariantBaseQty(v, cleanBaseUnit);
      const rQty = Number(v.retail_qty) || 1;
      const rUnit = v.retail_unit.trim() || v.purchase_unit.trim();
      const pQty = Number(v.per_retail_qty) || 0;
      const pPerUnit = v.per_retail_unit.trim();
      if (pQty > 0 && pPerUnit) {
        return rQty > 1 || rUnit.toLowerCase() !== v.purchase_unit.trim().toLowerCase()
          ? `${formatConversionQty(rQty)} ${rUnit} @ ${formatConversionQty(pQty)} ${pPerUnit}`
          : `${formatConversionQty(pQty)} ${pPerUnit}`;
      }
      if (bQty > 0 && cleanBaseUnit) {
        return `${formatConversionQty(bQty)} ${cleanBaseUnit}`;
      }
      return "";
    })
    .filter(Boolean);

  return {
    satuan_beli: satuanBeli,
    satuan_ecer: satuanEcer,
    tipe_satuan: tipeSatuan,
    isi_paket: summaryParts.slice(0, 2).join(" | ").slice(0, 120),
    satuan_resep: cleanBaseUnit || null,
    konversi_resep:
      cleanBaseUnit && defaultComputedBase > 0 ? defaultComputedBase : null,
    packagings,
  };
}

interface PackagingVariantsEditorProps {
  variants: EditablePackagingVariant[];
  onChange: (next: EditablePackagingVariant[]) => void;
  baseUnit: string;
  onAutoSuggestBaseUnit?: (unit: string) => void;
  units: string[];
  perRetailUnits: string[];
}

export const PackagingVariantsEditor: React.FC<PackagingVariantsEditorProps> = ({
  variants,
  onChange,
  baseUnit,
  onAutoSuggestBaseUnit,
  units,
  perRetailUnits,
}) => {
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<string, boolean>>({});

  const handleAddVariant = () => {
    const first = variants[0];
    const nextRow = createDefaultPackagingVariant({
      purchaseUnit: first?.purchase_unit || "Box",
      retailUnit: "Pcs",
      perRetailQty: "",
      perRetailUnit: baseUnit.trim() || first?.per_retail_unit || "Gram",
      isDefault: variants.length === 0,
    });
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

  const handlePerUnitChange = (v: EditablePackagingVariant, nextPerUnit: string) => {
    updateRow(v.localId, { per_retail_unit: nextPerUnit, use_manual_total: false });
    if (!baseUnit.trim() && onAutoSuggestBaseUnit) {
      const suggested = suggestBaseUnitFromUnit(nextPerUnit);
      if (suggested) onAutoSuggestBaseUnit(suggested);
    }
  };

  return (
    <div className="pt-3 border-t border-border/70 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-foreground block">
            Kemasan &amp; Konversi Beli
          </span>
          <span className="text-[11px] text-muted-foreground">
            Isi satuan beli, jumlah eceran, dan ukuran per ecer — total satuan resep dihitung otomatis.
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
          Tambah Kemasan
        </Button>
      </div>

      <div className="space-y-2.5">
        {variants.map((v, idx) => {
          const rQty = Number(v.retail_qty) || 1;
          const pQty = Number(v.per_retail_qty) || 0;
          const pUnit = v.purchase_unit.trim() || "Beli";
          const rUnit = v.retail_unit.trim() || pUnit;
          const effectiveBase =
            baseUnit.trim() || suggestBaseUnitFromUnit(v.per_retail_unit) || "";
          const converted =
            pQty > 0 && effectiveBase
              ? convertQtyBetweenUnits(pQty, v.per_retail_unit, effectiveBase)
              : null;
          const needsManual =
            v.use_manual_total || (pQty > 0 && Boolean(effectiveBase) && converted === null);
          const computedBase = computeVariantBaseQty(v, effectiveBase);

          const unitCost =
            v.last_unit_price && v.last_unit_price > 0 && computedBase > 0
              ? v.last_unit_price / computedBase
              : null;

          const hasCustomDetails = Boolean(v.keywords.trim() || v.label.trim());
          const isAdvancedOpen = Boolean(expandedAdvanced[v.localId]);

          return (
            <div
              key={v.localId}
              className="rounded-lg border border-border/80 bg-background p-3 space-y-2.5"
            >
              {/* Card Header: Live Formula Preview + Actions */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[11px] min-w-0 flex-wrap">
                  {variants.length > 1 && (
                    <span className="inline-flex items-center justify-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                      #{idx + 1}
                    </span>
                  )}
                  <span className="font-medium text-foreground">1 {pUnit}</span>
                  {(rQty > 1 || rUnit.toLowerCase() !== pUnit.toLowerCase()) && (
                    <>
                      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-foreground tabular-nums">
                        {formatConversionQty(rQty)} {rUnit}
                      </span>
                    </>
                  )}
                  {pQty > 0 && v.per_retail_unit && (
                    <span className="text-muted-foreground tabular-nums">
                      @ {formatConversionQty(pQty)} {v.per_retail_unit}
                    </span>
                  )}
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  {computedBase > 0 && effectiveBase ? (
                    <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatConversionQty(computedBase)} {effectiveBase}
                    </strong>
                  ) : (
                    <span className="text-muted-foreground">isi ukuran</span>
                  )}
                  {unitCost !== null && effectiveBase && (
                    <span className="text-muted-foreground">
                      ({formatRupiah(unitCost)}/{effectiveBase})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedAdvanced((prev) => ({
                        ...prev,
                        [v.localId]: !isAdvancedOpen,
                      }))
                    }
                    className={`h-7 px-2 rounded-md border text-[11px] inline-flex items-center gap-1 transition-colors ${
                      hasCustomDetails || isAdvancedOpen
                        ? "border-border bg-muted/60 text-foreground"
                        : "border-border/70 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>Label &amp; Struk</span>
                    {hasCustomDetails && !isAdvancedOpen && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${
                        isAdvancedOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {variants.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateRow(v.localId, { is_default: true })}
                        title={v.is_default ? "Kemasan default" : "Jadikan default"}
                        className={`h-7 px-2 rounded-md border text-[11px] inline-flex items-center gap-1 transition-colors ${
                          v.is_default
                            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-semibold"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Star className="w-3 h-3" />
                        <span>{v.is_default ? "Default" : "Set Default"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => removeRow(v.localId)}
                        aria-label="Hapus kemasan"
                        title="Hapus kemasan"
                        className="h-7 w-7 rounded-md border border-border inline-flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 3 Core Packaging Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-3 space-y-1 min-w-0">
                  <label className="text-[11px] font-medium text-muted-foreground block">
                    Satuan Beli
                  </label>
                  <AdaptiveSelect
                    value={v.purchase_unit}
                    onValueChange={(val) => {
                      const prevP = v.purchase_unit.trim();
                      const syncRetail =
                        !v.retail_unit.trim() ||
                        (v.retail_unit === prevP && (Number(v.retail_qty) || 1) === 1);
                      const spec = suggestBaseUnitFromUnit(val);
                      updateRow(v.localId, {
                        purchase_unit: val,
                        ...(syncRetail ? { retail_unit: val } : {}),
                        ...(!v.per_retail_qty && spec
                          ? {
                              per_retail_unit:
                                val === "Kg" ? "Kg" : val === "Liter" ? "Liter" : spec,
                            }
                          : {}),
                      });
                    }}
                    options={units}
                    creatable={true}
                    creatablePrefix="Satuan"
                    placeholder="Dus / Pouch..."
                  />
                </div>

                <div className="sm:col-span-4 space-y-1 min-w-0">
                  <label className="text-[11px] font-medium text-muted-foreground block">
                    Isi per 1 {pUnit}
                  </label>
                  <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-1.5">
                    <Input
                      type="number"
                      min={0.0001}
                      step="any"
                      placeholder="1"
                      value={v.retail_qty}
                      onChange={(e) => updateRow(v.localId, { retail_qty: e.target.value })}
                      className="h-9 text-xs tabular-nums px-2"
                    />
                    <AdaptiveSelect
                      value={v.retail_unit}
                      onValueChange={(val) => updateRow(v.localId, { retail_unit: val })}
                      options={units}
                      creatable={true}
                      creatablePrefix="Satuan"
                      placeholder="Pouch..."
                    />
                  </div>
                </div>

                <div className="sm:col-span-5 space-y-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground truncate">
                      Ukuran / 1 {rUnit}
                    </label>
                    {!needsManual && (
                      <button
                        type="button"
                        onClick={() =>
                          updateRow(v.localId, {
                            use_manual_total: true,
                            manual_base_qty: computedBase > 0 ? String(computedBase) : v.manual_base_qty,
                          })
                        }
                        className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                      >
                        Input total manual
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(92px,1fr)] gap-1.5">
                    <Input
                      type="number"
                      min={0.0001}
                      step="any"
                      placeholder="2 / 480 / 900"
                      value={v.per_retail_qty}
                      onChange={(e) => {
                        const nextVal = e.target.value;
                        updateRow(v.localId, {
                          per_retail_qty: nextVal,
                          use_manual_total: false,
                        });
                        if (Number(nextVal) > 0 && !baseUnit.trim() && onAutoSuggestBaseUnit) {
                          const suggested = suggestBaseUnitFromUnit(v.per_retail_unit);
                          if (suggested) onAutoSuggestBaseUnit(suggested);
                        }
                      }}
                      className="h-9 text-xs tabular-nums"
                    />
                    <AdaptiveSelect
                      value={v.per_retail_unit}
                      onValueChange={(val) => handlePerUnitChange(v, val)}
                      options={perRetailUnits}
                      creatable={true}
                      creatablePrefix="Satuan"
                      placeholder="Kg / Gram..."
                    />
                  </div>
                </div>
              </div>

              {/* Manual Total Fallback (only when unit cannot auto-convert or manually toggled) */}
              {needsManual && (
                <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                  <label className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Total Resep / 1 {pUnit}:
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0.0001}
                      step="any"
                      placeholder="mis. 16000"
                      value={v.manual_base_qty}
                      onChange={(e) =>
                        updateRow(v.localId, {
                          manual_base_qty: e.target.value,
                          use_manual_total: true,
                        })
                      }
                      className="h-8 w-32 text-xs tabular-nums"
                    />
                    <span className="text-xs font-medium text-foreground">
                      {effectiveBase || "Satuan Resep"}
                    </span>
                  </div>
                  {converted !== null && (
                    <button
                      type="button"
                      onClick={() => updateRow(v.localId, { use_manual_total: false })}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline ml-auto"
                    >
                      Kembali hitung otomatis
                    </button>
                  )}
                </div>
              )}

              {/* Optional Label & Receipt Keywords Drawer */}
              {isAdvancedOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border/60">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Nama Varian (Opsional — otomatis jika kosong)
                    </label>
                    <Input
                      placeholder={formatAutoVariantLabel(v, computedBase, effectiveBase)}
                      value={v.label}
                      onChange={(e) => updateRow(v.localId, { label: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground block">
                      Kata Kunci Struk / AI (Opsional)
                    </label>
                    <Input
                      placeholder="pisahkan koma: klg, kaleng, 480g"
                      value={v.keywords}
                      onChange={(e) => updateRow(v.localId, { keywords: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
