import React from "react";
import { ExpenseInvoiceGroup } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Layers, List } from "lucide-react";

export type ExpenseViewMode = "grouped" | "items";

export function getInvoiceItemSummaryText(group: ExpenseInvoiceGroup): {
  title: string;
  extraCount: number;
} {
  if (!group.items || group.items.length === 0) {
    return { title: "-", extraCount: 0 };
  }
  if (group.items.length === 1) {
    return { title: group.items[0].item_name || "-", extraCount: 0 };
  }
  const names = group.items
    .slice(0, 2)
    .map((it) => it.item_name)
    .filter(Boolean);
  const extraCount = Math.max(0, group.items.length - 2);
  return {
    title: names.join(", "),
    extraCount,
  };
}

interface ViewModeToggleProps {
  mode: ExpenseViewMode;
  onChange: (next: ExpenseViewMode) => void;
  className?: string;
  mobileFull?: boolean;
}

export const InvoiceViewModeToggle: React.FC<ViewModeToggleProps> = ({
  mode,
  onChange,
  className,
  mobileFull = false,
}) => {
  return (
    <div
      role="group"
      aria-label="Mode tampilan daftar transaksi"
      className={cn(
        "inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80",
        mobileFull && "w-full",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onChange("grouped")}
        aria-pressed={mode === "grouped"}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
          mobileFull ? "flex-1 min-h-[40px]" : "h-7",
          mode === "grouped"
            ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs"
            : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
        )}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span>Per Invoice</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("items")}
        aria-pressed={mode === "items"}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
          mobileFull ? "flex-1 min-h-[40px]" : "h-7",
          mode === "items"
            ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs"
            : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
        )}
      >
        <List className="w-3.5 h-3.5 shrink-0" />
        <span>Per Item</span>
      </button>
    </div>
  );
};

interface InvoiceFeeFooterProps {
  group: ExpenseInvoiceGroup;
  showPaymentSummary?: boolean;
  compact?: boolean;
}

export const InvoiceFeeFooter: React.FC<InvoiceFeeFooterProps> = ({
  group,
  showPaymentSummary = false,
  compact = false,
}) => {
  const hasFeeOrDiscount =
    group.shipping_fee > 0 ||
    group.tax > 0 ||
    group.other_fee > 0 ||
    group.discount > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200/80 dark:border-slate-700/80 pt-2.5 text-xs",
        compact ? "text-[11px]" : "text-xs"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700 dark:text-slate-300 tabular-nums">
        <span>
          Subtotal Barang:{" "}
          <strong className="font-semibold text-slate-900 dark:text-slate-100">
            {formatRupiah(group.subtotal_items)}
          </strong>
        </span>
        {group.shipping_fee > 0 && (
          <span>
            Ongkir:{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              {formatRupiah(group.shipping_fee)}
            </strong>
          </span>
        )}
        {group.tax > 0 && (
          <span>
            Pajak / PPN:{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              {formatRupiah(group.tax)}
            </strong>
          </span>
        )}
        {group.other_fee > 0 && (
          <span>
            Biaya Lain:{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              {formatRupiah(group.other_fee)}
            </strong>
          </span>
        )}
        {group.discount > 0 && (
          <span>
            Diskon:{" "}
            <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
              -{formatRupiah(group.discount)}
            </strong>
          </span>
        )}
        {!hasFeeOrDiscount && group.items_count > 1 && (
          <span className="text-slate-600 dark:text-slate-400">
            Tanpa biaya tambahan / diskon
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums ml-auto">
        {showPaymentSummary && group.paid_amount > 0 && !group.is_paid && (
          <>
            <span className="text-slate-700 dark:text-slate-300">
              Terbayar:{" "}
              <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
                {formatRupiah(group.paid_amount)}
              </strong>
            </span>
            <span className="text-slate-700 dark:text-slate-300">
              Sisa:{" "}
              <strong className="font-bold text-rose-700 dark:text-rose-400">
                {formatRupiah(group.remaining_amount)}
              </strong>
            </span>
          </>
        )}
        <span className="text-slate-800 dark:text-slate-200">
          Total Invoice:{" "}
          <strong className="font-bold text-slate-950 dark:text-white">
            {formatRupiah(group.total_amount)}
          </strong>
        </span>
      </div>
    </div>
  );
};
