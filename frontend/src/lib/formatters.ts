/**
 * Format angka ke format mata uang Rupiah Indonesia (Rp 1.500.000)
 */
export function formatRupiah(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return "Rp 0";
  }
  const num = Math.round(Number(amount));
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Format tanggal ISO (2026-10-22) ke format bahasa Indonesia (22 Okt 2026)
 */
export function formatDateId(dateStr: string | null | undefined, includeDay: boolean = false): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    const options: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(includeDay ? { weekday: "short" } : {}),
    };
    return new Intl.DateTimeFormat("id-ID", options).format(d);
  } catch {
    return dateStr;
  }
}

/**
 * Dapatkan warna badge untuk kategori pengeluaran
 */
export function getCategoryColor(category: string): { bg: string; text: string; border: string } {
  const cat = (category || "").toLowerCase();
  if (cat.includes("bahan")) {
    return { bg: "bg-amber-50 text-amber-700", text: "text-amber-700", border: "border-amber-200" };
  }
  if (cat.includes("kemasan") || cat.includes("packaging")) {
    return { bg: "bg-blue-50 text-blue-700", text: "text-blue-700", border: "border-blue-200" };
  }
  if (cat.includes("operasional")) {
    return { bg: "bg-emerald-50 text-emerald-700", text: "text-emerald-700", border: "border-emerald-200" };
  }
  if (cat.includes("alat") || cat.includes("peralatan")) {
    return { bg: "bg-purple-50 text-purple-700", text: "text-purple-700", border: "border-purple-200" };
  }
  if (cat.includes("gaji") || cat.includes("sdm")) {
    return { bg: "bg-rose-50 text-rose-700", text: "text-rose-700", border: "border-rose-200" };
  }
  if (cat.includes("marketing") || cat.includes("iklan")) {
    return { bg: "bg-pink-50 text-pink-700", text: "text-pink-700", border: "border-pink-200" };
  }
  return { bg: "bg-slate-100 text-slate-700", text: "text-slate-700", border: "border-slate-200" };
}
