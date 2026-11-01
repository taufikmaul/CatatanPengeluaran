import React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { formatRupiah } from "@/lib/formatters";

interface PriceSpikeAlertProps {
  currentPrice: number;
  referencePrice?: number | null;
  itemName?: string;
  referenceLabel?: string;
  onApplyReferencePrice?: (price: number) => void;
}

export const PriceSpikeAlert: React.FC<PriceSpikeAlertProps> = React.memo(({
  currentPrice,
  referencePrice,
  itemName,
  referenceLabel = "harga terakhir",
  onApplyReferencePrice,
}) => {
  if (!referencePrice || referencePrice <= 0 || !currentPrice || currentPrice <= 0) {
    return null;
  }

  const ratio = currentPrice / referencePrice;
  const isSpikeHigh = ratio >= 2.2;
  const isAnomalyLow = ratio <= 0.25;

  if (!isSpikeHigh && !isAnomalyLow) {
    return null;
  }

  const multiplierText = isSpikeHigh
    ? `${ratio >= 9.5 ? Math.round(ratio) : ratio.toFixed(1)}x lebih tinggi`
    : `${(1 / ratio).toFixed(1)}x lebih rendah`;

  const possibleExtraZero =
    Math.abs(currentPrice / 10 - referencePrice) / referencePrice < 0.15 ||
    Math.abs(currentPrice / 100 - referencePrice) / referencePrice < 0.15;

  return (
    <div
      role="alert"
      className={`mt-1.5 p-2.5 rounded-xl border text-xs flex items-start justify-between gap-2.5 transition-all ${
        isSpikeHigh
          ? "bg-amber-50/90 border-amber-300 text-amber-950"
          : "bg-sky-50/90 border-sky-200 text-sky-950"
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle
          className={`w-4 h-4 shrink-0 mt-0.5 ${
            isSpikeHigh ? "text-amber-600" : "text-sky-600"
          }`}
        />
        <div className="min-w-0 leading-snug">
          <p className="font-bold">
            Deteksi Anomali Harga ({multiplierText})
          </p>
          <p className="text-[11px] opacity-90 mt-0.5">
            Harga input <strong>{formatRupiah(currentPrice)}</strong> jauh berbeda dari {referenceLabel}
            {itemName ? ` "${itemName}"` : ""} sebesar{" "}
            <strong>{formatRupiah(referencePrice)}</strong>.{" "}
            {possibleExtraZero
              ? "Periksa apakah kelebihan mengetik angka nol (0)."
              : "Pastikan satuan beli atau nominal sudah benar."}
          </p>
        </div>
      </div>

      {onApplyReferencePrice && (
        <button
          type="button"
          onClick={() => onApplyReferencePrice(referencePrice)}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold shadow-2xs transition-colors"
        >
          <Check className="w-3 h-3 text-emerald-600" />
          <span>Pakai {formatRupiah(referencePrice)}</span>
        </button>
      )}
    </div>
  );
});

PriceSpikeAlert.displayName = "PriceSpikeAlert";
