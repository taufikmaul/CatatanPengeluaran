import { MasterItemPackaging } from "@/types";

export interface PackagingConversionPreview {
  packaging_id: number | null;
  retail_qty: number | null;
  retail_unit: string | null;
  base_qty: number | null;
  base_unit: string | null;
  base_unit_price: number | null;
}

const METRIC_TO_BASE: Record<string, { unit: string; mult: number }> = {
  kg: { unit: "Gram", mult: 1000 },
  kilo: { unit: "Gram", mult: 1000 },
  kilogram: { unit: "Gram", mult: 1000 },
  ons: { unit: "Gram", mult: 100 },
  g: { unit: "Gram", mult: 1 },
  gr: { unit: "Gram", mult: 1 },
  gram: { unit: "Gram", mult: 1 },
  liter: { unit: "ml", mult: 1000 },
  ltr: { unit: "ml", mult: 1000 },
  lt: { unit: "ml", mult: 1000 },
  l: { unit: "ml", mult: 1000 },
  ml: { unit: "ml", mult: 1 },
  cc: { unit: "ml", mult: 1 },
  lusin: { unit: "Pcs", mult: 12 },
  kodi: { unit: "Pcs", mult: 20 },
  gross: { unit: "Pcs", mult: 144 },
  tray: { unit: "Butir", mult: 30 },
};

export function computeLiveConversionPreview(params: {
  qty: number;
  unit: string;
  unitPrice: number;
  selectedPackaging?: MasterItemPackaging | null;
  legacySatuanBeli?: string;
  legacySatuanEcer?: string;
  legacySatuanResep?: string | null;
  legacyKonversiResep?: number | null;
}): PackagingConversionPreview {
  const safeQty = params.qty > 0 ? params.qty : 1;
  const safePrice = params.unitPrice > 0 ? params.unitPrice : 0;
  const unitClean = (params.unit || "Pcs").trim() || "Pcs";

  if (params.selectedPackaging && params.selectedPackaging.base_qty > 0) {
    const p = params.selectedPackaging;
    const retailQty = Number((safeQty * (p.retail_qty || 1)).toFixed(4));
    const baseQty = Number((safeQty * p.base_qty).toFixed(4));
    const baseUnitPrice =
      safePrice > 0 ? Number((safePrice / p.base_qty).toFixed(2)) : null;
    return {
      packaging_id: p.id ?? null,
      retail_qty: retailQty,
      retail_unit: p.retail_unit,
      base_qty: baseQty,
      base_unit: p.base_unit,
      base_unit_price: baseUnitPrice,
    };
  }

  if (
    params.legacySatuanResep &&
    params.legacyKonversiResep &&
    params.legacyKonversiResep > 0 &&
    (!params.legacySatuanBeli ||
      unitClean.toLowerCase() === params.legacySatuanBeli.toLowerCase())
  ) {
    const baseQty = Number((safeQty * params.legacyKonversiResep).toFixed(4));
    const baseUnitPrice =
      safePrice > 0
        ? Number((safePrice / params.legacyKonversiResep).toFixed(2))
        : null;
    return {
      packaging_id: null,
      retail_qty: safeQty,
      retail_unit: params.legacySatuanEcer || unitClean,
      base_qty: baseQty,
      base_unit: params.legacySatuanResep,
      base_unit_price: baseUnitPrice,
    };
  }

  const metric = METRIC_TO_BASE[unitClean.toLowerCase()];
  if (metric) {
    const baseQty = Number((safeQty * metric.mult).toFixed(4));
    const baseUnitPrice =
      safePrice > 0 ? Number((safePrice / metric.mult).toFixed(2)) : null;
    return {
      packaging_id: null,
      retail_qty: safeQty,
      retail_unit: unitClean,
      base_qty: baseQty,
      base_unit: metric.unit,
      base_unit_price: baseUnitPrice,
    };
  }

  return {
    packaging_id: null,
    retail_qty: null,
    retail_unit: null,
    base_qty: null,
    base_unit: null,
    base_unit_price: null,
  };
}

export function formatConversionQty(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

export function shouldShowRetailTier(params: {
  qty: number;
  unit: string;
  retailQty: number | null | undefined;
  retailUnit: string | null | undefined;
  baseUnit: string | null | undefined;
}): boolean {
  if (
    params.retailQty === null ||
    params.retailQty === undefined ||
    !(params.retailQty > 0) ||
    !params.retailUnit?.trim()
  ) {
    return false;
  }
  const qtySafe = params.qty > 0 ? params.qty : 1;
  const retailClean = params.retailUnit.trim().toLowerCase();
  const unitClean = (params.unit || "").trim().toLowerCase();
  const baseClean = (params.baseUnit || "").trim().toLowerCase();

  if (Math.abs(params.retailQty - qtySafe) <= 1e-6) return false;
  if (retailClean === unitClean) return false;
  if (baseClean && retailClean === baseClean) return false;
  return true;
}
