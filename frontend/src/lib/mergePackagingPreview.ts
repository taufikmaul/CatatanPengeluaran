import type { MasterItem } from "@/types";
import { convertQtyBetweenUnits } from "@/components/master/PackagingVariantsEditor";
import { formatConversionQty, shouldShowRetailTier } from "@/lib/packagingConversion";

export interface MergedPackagingPreviewRow {
  key: string;
  label: string;
  formula: string;
  sourceName: string;
  isDefault: boolean;
  isDuplicate: boolean;
}

export interface MergedPackagingPreview {
  rows: MergedPackagingPreviewRow[];
  baseUnit: string;
  incompatibleReason: string | null;
}

interface FlatPackaging {
  label: string;
  purchaseUnit: string;
  retailQty: number;
  retailUnit: string;
  baseQty: number;
  baseUnit: string;
  isDefault: boolean;
  sourceName: string;
}

function flattenItemPackagings(item: MasterItem): FlatPackaging[] {
  if (item.packagings && item.packagings.length > 0) {
    return item.packagings
      .filter((p) => p.is_active !== false)
      .map((p) => ({
        label: p.label,
        purchaseUnit: p.purchase_unit,
        retailQty: Number(p.retail_qty) || 1,
        retailUnit: p.retail_unit || p.purchase_unit,
        baseQty: Number(p.base_qty) || 0,
        baseUnit: p.base_unit,
        isDefault: Boolean(p.is_default),
        sourceName: item.item_name,
      }));
  }
  const baseQty = Number(item.konversi_resep) || 0;
  if (item.satuan_resep && baseQty > 0) {
    const pUnit = item.satuan_beli || "Pcs";
    return [
      {
        label: `${pUnit} (${formatConversionQty(baseQty)} ${item.satuan_resep})`,
        purchaseUnit: pUnit,
        retailQty: 1,
        retailUnit: item.satuan_ecer || pUnit,
        baseQty,
        baseUnit: item.satuan_resep,
        isDefault: true,
        sourceName: item.item_name,
      },
    ];
  }
  return [];
}

export function buildMergedPackagingPreview(
  items: MasterItem[],
  targetId: number | null
): MergedPackagingPreview {
  const target = items.find((i) => i.id === targetId) || items[0];
  if (!target) return { rows: [], baseUnit: "", incompatibleReason: null };

  const ordered = [target, ...items.filter((i) => i.id !== target.id)];
  const targetFlat = flattenItemPackagings(target);
  const baseUnit =
    targetFlat.find((p) => p.isDefault)?.baseUnit ||
    targetFlat[0]?.baseUnit ||
    target.satuan_resep ||
    ordered.flatMap(flattenItemPackagings)[0]?.baseUnit ||
    "";

  const rows: MergedPackagingPreviewRow[] = [];
  const seen = new Map<string, number>();
  let incompatibleReason: string | null = null;

  ordered.forEach((item, itemIdx) => {
    flattenItemPackagings(item).forEach((p, idx) => {
      let baseQty = p.baseQty;
      let rowBaseUnit = p.baseUnit;
      if (baseUnit) {
        const converted = convertQtyBetweenUnits(baseQty, p.baseUnit, baseUnit);
        if (converted === null) {
          incompatibleReason =
            incompatibleReason ||
            `Satuan resep '${p.baseUnit}' pada '${item.item_name}' tidak kompatibel dengan '${baseUnit}' milik item utama.`;
        } else {
          baseQty = converted;
          rowBaseUnit = baseUnit;
        }
      }

      const key = [
        p.purchaseUnit.trim().toLowerCase(),
        Math.round(p.retailQty * 10000) / 10000,
        p.retailUnit.trim().toLowerCase(),
        Math.round(baseQty * 10000) / 10000,
      ].join("|");

      const showRetail = shouldShowRetailTier({
        qty: 1,
        unit: p.purchaseUnit,
        retailQty: p.retailQty,
        retailUnit: p.retailUnit,
        baseUnit: rowBaseUnit,
      });
      const formula = `1 ${p.purchaseUnit}${
        showRetail ? ` → ${formatConversionQty(p.retailQty)} ${p.retailUnit}` : ""
      } → ${formatConversionQty(baseQty)} ${rowBaseUnit}`;

      if (seen.has(key)) {
        rows[seen.get(key) as number].isDuplicate = true;
        return;
      }
      seen.set(key, rows.length);
      rows.push({
        key: `${item.id}-${idx}`,
        label: p.label,
        formula,
        sourceName: item.item_name,
        isDefault: itemIdx === 0 && p.isDefault,
        isDuplicate: false,
      });
    });
  });

  if (rows.length > 0 && !rows.some((r) => r.isDefault)) rows[0].isDefault = true;
  return { rows, baseUnit, incompatibleReason };
}
