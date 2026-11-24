import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: Date;
  to?: Date;
}

export interface DateRangePickerProps {
  /** Callback saat nilai rentang tanggal diperbarui */
  onUpdate?: (values: { range: DateRange; rangeCompare?: DateRange }) => void;
  /** Nilai awal tanggal mulai */
  initialDateFrom?: Date | string;
  /** Nilai awal tanggal akhir */
  initialDateTo?: Date | string;
  /** Nilai awal pembanding */
  initialCompareFrom?: Date | string;
  initialCompareTo?: Date | string;
  /** Posisi popover */
  align?: "start" | "center" | "end";
  /** Locale tampilan tanggal */
  locale?: string;
  /** Tampilkan opsi perbandingan */
  showCompare?: boolean;
  /** Custom trigger class */
  className?: string;
  /** Teks placeholder */
  placeholder?: string;
  /** Ukuran tombol trigger */
  size?: "default" | "sm" | "lg";
  /** Format tanggal input */
  dateFormat?: "dmy" | "mdy";
}

const formatDate = (date: Date, locale: string = "id-ID"): string => {
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const parseDateAdjusted = (dateInput?: Date | string): Date => {
  if (!dateInput) return new Date();
  if (typeof dateInput === "string") {
    const parts = dateInput.split("-").map((p) => parseInt(p, 10));
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const parsed = new Date(dateInput);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return dateInput;
};

const areRangesEqual = (a?: DateRange, b?: DateRange): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.from?.getTime() === b.from?.getTime() && a.to?.getTime() === b.to?.getTime();
};

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  initialDateFrom,
  initialDateTo,
  initialCompareFrom,
  initialCompareTo,
  onUpdate,
  align = "start",
  locale = "id-ID",
  showCompare = false,
  className,
  placeholder = "Pilih rentang tanggal",
  size = "sm",
  dateFormat = "dmy",
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const [range, setRange] = useState<DateRange>(() => ({
    from: initialDateFrom ? parseDateAdjusted(initialDateFrom) : new Date(),
    to: initialDateTo ? parseDateAdjusted(initialDateTo) : initialDateFrom ? parseDateAdjusted(initialDateFrom) : new Date(),
  }));

  const [rangeCompare, setRangeCompare] = useState<DateRange | undefined>(() =>
    initialCompareFrom
      ? {
          from: parseDateAdjusted(initialCompareFrom),
          to: initialCompareTo ? parseDateAdjusted(initialCompareTo) : parseDateAdjusted(initialCompareFrom),
        }
      : undefined
  );

  useEffect(() => {
    if (initialDateFrom) {
      setRange({
        from: parseDateAdjusted(initialDateFrom),
        to: initialDateTo ? parseDateAdjusted(initialDateTo) : parseDateAdjusted(initialDateFrom),
      });
    }
  }, [initialDateFrom, initialDateTo]);

  const openedRangeRef = useRef<DateRange | undefined>(range);
  const openedRangeCompareRef = useRef<DateRange | undefined>(rangeCompare);

  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const resetToOpened = () => {
    if (openedRangeRef.current) setRange(openedRangeRef.current);
    setRangeCompare(openedRangeCompareRef.current);
  };

  useEffect(() => {
    if (isOpen) {
      openedRangeRef.current = range;
      openedRangeCompareRef.current = rangeCompare;
    }
  }, [isOpen]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={cn(
            "h-9 px-3 rounded-md text-xs font-medium justify-between gap-2 border-input bg-background text-foreground shadow-xs hover:bg-accent/50",
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">
              {range.from ? (
                range.to && range.from.toDateString() !== range.to.toDateString() ? (
                  <>
                    {formatDate(range.from, locale)} - {formatDate(range.to, locale)}
                  </>
                ) : (
                  formatDate(range.from, locale)
                )
              ) : (
                placeholder
              )}
            </span>
          </div>
          <div className="text-muted-foreground -mr-1">
            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        className="w-auto p-0 rounded-lg shadow-lg border-border bg-popover overflow-hidden"
      >
        <div className="p-3 space-y-3">
          {/* Top Bar: Manual Date Inputs */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/70">
            <div className="flex items-center gap-1.5">
              <DateInput
                value={range.from}
                dateFormat={dateFormat}
                onChange={(d) => {
                  const toDate = range.to && d > range.to ? d : range.to;
                  setRange({ from: d, to: toDate });
                }}
              />
              <span className="text-xs text-muted-foreground font-medium">s.d.</span>
              <DateInput
                value={range.to || range.from}
                dateFormat={dateFormat}
                onChange={(d) => {
                  const fromDate = d < range.from ? d : range.from;
                  setRange({ from: fromDate, to: d });
                }}
              />
            </div>
          </div>

          {/* Optional Compare Feature */}
          {showCompare && (
            <div className="flex items-center justify-between py-1 px-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!rangeCompare}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      const compFrom = new Date(range.from);
                      compFrom.setFullYear(compFrom.getFullYear() - 1);
                      const compTo = range.to ? new Date(range.to) : new Date(range.from);
                      compTo.setFullYear(compTo.getFullYear() - 1);
                      setRangeCompare({ from: compFrom, to: compTo });
                    } else {
                      setRangeCompare(undefined);
                    }
                  }}
                />
                <Label className="text-xs text-muted-foreground">
                  Bandingkan periode sebelumnya
                </Label>
              </div>
            </div>
          )}

          {/* Calendar Grid */}
          <div className="flex justify-center">
            <Calendar
              mode="range"
              selected={{ from: range.from, to: range.to }}
              onSelect={(val: any) => {
                if (val?.from) {
                  setRange({ from: val.from, to: val?.to });
                }
              }}
              numberOfMonths={isSmallScreen ? 1 : 2}
              defaultMonth={range.from}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 px-3 py-2.5 bg-muted/30 border-t border-border/70">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              resetToOpened();
              setIsOpen(false);
            }}
            className="h-8 px-3 text-xs"
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setIsOpen(false);
              if (
                !areRangesEqual(range, openedRangeRef.current) ||
                !areRangesEqual(rangeCompare, openedRangeCompareRef.current)
              ) {
                onUpdate?.({ range, rangeCompare });
              }
            }}
            className="h-8 px-4 text-xs font-semibold rounded-md"
          >
            Terapkan
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

DateRangePicker.displayName = "DateRangePicker";
