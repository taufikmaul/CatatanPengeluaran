import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BankAccount } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

const LEDGER_EASE = [0.23, 1, 0.32, 1] as const;

export interface LedgerCompositionSegment {
  key: string;
  label: string;
  value: number;
  displayValue: string;
  colorClass: string;
}

export interface LedgerSupportingMetric {
  key: string;
  label: string;
  value: string;
  subtext: React.ReactNode;
  badge?: {
    text: string;
    className?: string;
  };
  active?: boolean;
  onClick?: () => void;
  accentTone?: "unpaid" | "dp" | "cleared" | "talangan" | "neutral";
  valueClassName?: string;
}

interface LedgerMetricStripProps {
  primary: {
    label: string;
    value: string;
    subtext: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
    accentTone?: "unpaid" | "talangan";
    valueClassName?: string;
    segments?: LedgerCompositionSegment[];
  };
  supporting: LedgerSupportingMetric[];
  isLoading?: boolean;
}

const ACTIVE_BAR_CLASS: Record<string, string> = {
  unpaid: "bg-[var(--signal-unpaid)]",
  dp: "bg-[var(--signal-dp)]",
  cleared: "bg-[var(--signal-cleared)]",
  talangan: "bg-[var(--signal-talangan)]",
  neutral: "bg-[var(--ledger-ink)]",
};

const ACTIVE_TINT_CLASS: Record<string, string> = {
  unpaid: "signal-surface-unpaid",
  dp: "signal-surface-dp",
  cleared: "signal-surface-cleared",
  talangan: "signal-surface-talangan",
  neutral: "ledger-recessed-band",
};

/**
 * Unified asymmetric summary strip separated exclusively by 1px hairline rules
 * so KPI metrics never sit inside stacked cards or nested icon boxes.
 */
export const LedgerMetricStrip: React.FC<LedgerMetricStripProps> = ({
  primary,
  supporting,
  isLoading = false,
}) => {
  const segments = (primary.segments || []).filter((s) => s.value > 0);
  const totalSegmentValue = segments.reduce((sum, s) => sum + s.value, 0);
  const primaryTone = primary.accentTone || "unpaid";

  const PrimaryTag = primary.onClick ? "button" : "div";

  return (
    <section
      aria-label="Ringkasan nominal utama"
      className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[color:var(--ledger-hairline)]">
        {/* Focal Cell */}
        <PrimaryTag
          {...(primary.onClick
            ? {
                type: "button" as const,
                onClick: primary.onClick,
                "aria-pressed": Boolean(primary.active),
              }
            : {})}
          className={cn(
            "lg:col-span-5 relative px-3.5 py-2.5 sm:px-4 sm:py-3 text-left flex flex-col justify-between gap-2 transition-colors",
            primary.onClick &&
              "cursor-pointer ledger-hover-recessed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            primary.active && ACTIVE_TINT_CLASS[primaryTone]
          )}
        >
          {primary.active && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-0 top-0 h-[2.5px]",
                ACTIVE_BAR_CLASS[primaryTone]
              )}
            />
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--ledger-muted)]">
                {primary.label}
              </span>
              {primary.active && (
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-md",
                    primaryTone === "talangan"
                      ? "bg-[var(--signal-talangan-soft)] text-[var(--signal-talangan)]"
                      : "bg-[var(--signal-unpaid-soft)] text-[var(--signal-unpaid)]"
                  )}
                >
                  Filter Aktif
                </span>
              )}
            </div>

            {isLoading ? (
              <Skeleton className="h-9 w-48 rounded-md" />
            ) : (
              <div
                className={cn(
                  "text-[clamp(1.55rem,2.4vw,2.2rem)] font-bold tracking-tight tabular-nums leading-none",
                  primary.valueClassName || "text-[var(--ledger-ink)]"
                )}
              >
                {primary.value}
              </div>
            )}

            <div className="text-xs text-[var(--ledger-muted)] tabular-nums">
              {primary.subtext}
            </div>
          </div>

          {!isLoading && totalSegmentValue > 0 && (
            <div className="space-y-1 pt-0.5">
              <div
                aria-hidden="true"
                className="h-1.5 w-full rounded-full bg-[var(--ledger-recessed)] overflow-hidden flex"
              >
                {segments.map((seg) => (
                  <div
                    key={seg.key}
                    className={cn("h-full transition-all duration-300", seg.colorClass)}
                    style={{ width: `${(seg.value / totalSegmentValue) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--ledger-muted)] tabular-nums">
                {segments.map((seg) => (
                  <span key={seg.key} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn("w-2 h-2 rounded-full shrink-0", seg.colorClass)}
                    />
                    <span>{seg.label}:</span>
                    <strong className="font-semibold text-[var(--ledger-ink)]">
                      {seg.displayValue}
                    </strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </PrimaryTag>

        {/* Supporting Metrics Strip */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
          {supporting.map((item) => {
            const tone = item.accentTone || "neutral";
            const WrapperTag = item.onClick ? "button" : "div";

            return (
              <WrapperTag
                key={item.key}
                {...(item.onClick
                  ? {
                      type: "button" as const,
                      onClick: item.onClick,
                      "aria-pressed": Boolean(item.active),
                    }
                  : {})}
                className={cn(
                  "relative px-3.5 py-2.5 sm:px-4 sm:py-3 text-left flex flex-col justify-between gap-1.5 transition-colors min-w-0",
                  item.onClick &&
                    "cursor-pointer ledger-hover-recessed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  item.active && ACTIVE_TINT_CLASS[tone]
                )}
              >
                {item.active && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-x-0 top-0 h-[2.5px]",
                      ACTIVE_BAR_CLASS[tone]
                    )}
                  />
                )}

                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ledger-muted)] leading-snug">
                    {item.label}
                  </span>
                  {item.badge && (
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0",
                        item.badge.className
                      )}
                    >
                      {item.badge.text}
                    </span>
                  )}
                </div>

                <div className="space-y-1 min-w-0">
                  {isLoading ? (
                    <Skeleton className="h-7 w-28 rounded-md" />
                  ) : (
                    <div
                      className={cn(
                        "text-lg sm:text-xl font-bold tracking-tight tabular-nums truncate",
                        item.valueClassName || "text-[var(--ledger-ink)]"
                      )}
                    >
                      {item.value}
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--ledger-muted)] leading-snug">
                    {item.subtext}
                  </div>
                </div>
              </WrapperTag>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export interface LedgerStatusTabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface LedgerStatusTabsProps<T extends string> {
  tabs: LedgerStatusTabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  layoutId: string;
  accentClassName?: string;
  ariaLabel?: string;
}

export function LedgerStatusTabs<T extends string>({
  tabs,
  value,
  onChange,
  layoutId,
  accentClassName = "bg-[var(--ledger-ink)]",
  ariaLabel = "Filter status data",
}: LedgerStatusTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex items-center gap-1 border-b border-[color:var(--ledger-hairline)] overflow-x-auto no-scrollbar"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-3 min-h-[44px] sm:min-h-[38px] text-xs font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
              isActive
                ? "text-[var(--ledger-ink)]"
                : "text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={cn(
                  "text-[11px] font-mono-ledger tabular-nums px-1.5 py-0.5 rounded-md",
                  isActive
                    ? "bg-[var(--ledger-recessed)] text-[var(--ledger-ink)] font-bold"
                    : "text-[var(--ledger-muted)]"
                )}
              >
                {tab.count}
              </span>
            )}
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={{ duration: 0.18, ease: LEDGER_EASE }}
                className={cn("absolute inset-x-2 bottom-0 h-[2px] rounded-full", accentClassName)}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

interface LedgerBatchDockProps {
  selectedCount: number;
  itemLabel: string;
  totalAmount: number;
  totalLabel: string;
  bankAccounts: BankAccount[];
  bankAccountId: string;
  onBankAccountChange: (val: string) => void;
  primaryAction: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
    icon?: React.ReactNode;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: React.ReactNode;
  };
  onClear: () => void;
  blockedMessage?: string;
}

/**
 * Sticky floating settlement dock (the sole glass/elevated surface on the screen)
 * so batch clearing remains effortless during long scroll sessions without layout shift.
 */
export const LedgerBatchDock: React.FC<LedgerBatchDockProps> = ({
  selectedCount,
  itemLabel,
  totalAmount,
  totalLabel,
  bankAccounts,
  bankAccountId,
  onBankAccountChange,
  primaryAction,
  secondaryAction,
  onClear,
  blockedMessage,
}) => {
  const bankOptions = React.useMemo(
    () => [
      { value: "", label: "Rekening Pembayar (Opsional)" },
      ...bankAccounts.map((acc) => ({
        value: String(acc.id),
        label: `${acc.name} (${acc.account_code})`,
        sublabel: acc.bank_name,
      })),
    ],
    [bankAccounts]
  );

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.18, ease: LEDGER_EASE }}
          role="region"
          aria-label="Aksi pilihan massal"
          className="sticky bottom-2.5 z-30 rounded-xl border border-[color:var(--ledger-hairline)] ledger-surface-dock backdrop-blur-md shadow-lg px-3.5 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-bold text-[var(--ledger-ink)] tabular-nums">
              {selectedCount} {itemLabel} terpilih
            </span>
            <span className="text-xs text-[var(--ledger-muted)] tabular-nums">
              {totalLabel}{" "}
              <strong className="font-bold text-[var(--ledger-ink)]">
                {formatRupiah(totalAmount)}
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {blockedMessage ? (
              <span className="text-xs font-medium text-[var(--signal-dp)]">
                {blockedMessage}
              </span>
            ) : (
              <>
                {bankAccounts.length > 0 && (
                  <div className="w-full sm:w-56">
                    <AdaptiveSelect
                      value={bankAccountId}
                      onValueChange={onBankAccountChange}
                      options={bankOptions}
                      placeholder="Rekening Pembayar (Opsional)"
                      searchPlaceholder="Cari rekening..."
                      aria-label="Rekening Pembayar"
                      triggerClassName="h-9"
                    />
                  </div>
                )}

                <Button
                  type="button"
                  size="sm"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  className={cn(
                    "min-h-[40px] sm:min-h-[36px] px-3.5 text-xs font-semibold rounded-lg gap-1.5 ledger-press",
                    primaryAction.className
                  )}
                >
                  {primaryAction.icon}
                  <span>{primaryAction.label}</span>
                </Button>

                {secondaryAction && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={secondaryAction.onClick}
                    disabled={secondaryAction.disabled}
                    className="min-h-[40px] sm:min-h-[36px] px-3 text-xs font-semibold rounded-lg gap-1.5 ledger-press"
                  >
                    {secondaryAction.icon}
                    <span>{secondaryAction.label}</span>
                  </Button>
                )}
              </>
            )}

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClear}
              className="min-h-[40px] sm:min-h-[36px] px-3 text-xs font-medium text-[var(--ledger-muted)] hover:text-[var(--ledger-ink)]"
            >
              Batal
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface LedgerConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive" | "cleared";
  isPending?: boolean;
  bankAccounts?: BankAccount[];
  bankAccountId?: string;
  onBankAccountChange?: (val: string) => void;
  onConfirm: () => void;
}

export const LedgerConfirmDialog: React.FC<LedgerConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  isPending = false,
  bankAccounts = [],
  bankAccountId = "",
  onBankAccountChange,
  onConfirm,
}) => {
  const bankOptions = React.useMemo(
    () => [
      { value: "", label: "Otomatis / Tanpa pilih rekening" },
      ...bankAccounts.map((acc) => ({
        value: String(acc.id),
        label: `${acc.name} (${acc.account_code})`,
        sublabel: acc.bank_name,
      })),
    ],
    [bankAccounts]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] p-4 sm:p-5">
        <DialogHeader className="text-left space-y-1">
          <DialogTitle className="text-base font-bold text-[var(--ledger-ink)]">
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--ledger-muted)] leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>

        {onBankAccountChange && bankAccounts.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-[color:var(--ledger-hairline)]">
            <label className="text-xs font-medium text-[var(--ledger-ink)] block">
              Rekening Sumber Dana (Opsional)
            </label>
            <AdaptiveSelect
              value={bankAccountId}
              onValueChange={onBankAccountChange}
              options={bankOptions}
              placeholder="Otomatis / Tanpa pilih rekening"
              searchPlaceholder="Cari rekening..."
              aria-label="Rekening Sumber Dana"
            />
          </div>
        )}

        <DialogFooter className="pt-2.5 border-t border-[color:var(--ledger-hairline)] flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="min-h-[40px] sm:min-h-[36px] text-xs font-semibold rounded-lg"
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            variant={confirmVariant === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              "min-h-[40px] sm:min-h-[36px] text-xs font-semibold rounded-lg gap-1.5 ledger-press",
              confirmVariant === "cleared" &&
                "bg-emerald-700 hover:bg-emerald-800 text-white"
            )}
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              confirmVariant === "cleared" && <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            <span>{confirmLabel}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface LedgerStateBlockProps {
  variant: "error" | "empty";
  title: string;
  description: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export const LedgerStateBlock: React.FC<LedgerStateBlockProps> = ({
  variant,
  title,
  description,
  icon,
  actions,
}) => {
  return (
    <div
      role={variant === "error" ? "alert" : undefined}
      className="py-8 px-4 text-center space-y-2.5"
    >
      <div
        className={cn(
          "mx-auto flex items-center justify-center",
          variant === "error"
            ? "text-[var(--signal-unpaid)]"
            : "text-[var(--ledger-muted)]"
        )}
      >
        {icon || <AlertCircle className="w-7 h-7" />}
      </div>
      <div className="space-y-1 max-w-md mx-auto">
        <h4 className="text-sm font-bold text-[var(--ledger-ink)]">{title}</h4>
        <p className="text-xs text-[var(--ledger-muted)] leading-relaxed">{description}</p>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {actions}
        </div>
      )}
    </div>
  );
};
