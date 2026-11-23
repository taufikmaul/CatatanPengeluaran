import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Check,
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

export interface Preset {
  name: string;
  label: string;
}

const PRESETS: Preset[] = [
  { name: "today", label: "Hari Ini" },
  { name: "yesterday", label: "Kemarin" },
  { name: "last7", label: "7 Hari Terakhir" },
  { name: "last14", label: "14 Hari Terakhir" },
  { name: "last30", label: "30 Hari Terakhir" },
  { name: "thisWeek", label: "Minggu Ini" },
  { name: "lastWeek", label: "Minggu Lalu" },
  { name: "thisMonth", label: "Bulan Ini" },
  { name: "lastMonth", label: "Bulan Lalu" },
];

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

  // Sync saat initial prop berubah dari luar
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

  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(undefined);
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

  const getPresetRange = (presetName: string): DateRange => {
    const preset = PRESETS.find(({ name }) => name === presetName);
    if (!preset) throw new Error(`Unknown preset: ${presetName}`);
    const from = new Date();
    const to = new Date();
    const dayOfWeek = from.getDay(); // 0 is Sunday
    const distanceToMonday = (dayOfWeek + 6) % 7; // Monday as 0

    switch (preset.name) {
      case "today":
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        break;
      case "yesterday":
        from.setDate(from.getDate() - 1);
        from.setHours(0, 0, 0, 0);
        to.setDate(to.getDate() - 1);
        to.setHours(23, 59, 59, 999);
        break;
      case "last7":
        from.setDate(from.getDate() - 6);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        break;
      case "last14":
        from.setDate(from.getDate() - 13);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        break;
      case "last30":
        from.setDate(from.getDate() - 29);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        break;
      case "thisWeek":
        from.setDate(from.getDate() - distanceToMonday);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        break;
      case "lastWeek":
        from.setDate(from.getDate() - distanceToMonday - 7);
        from.setHours(0, 0, 0, 0);
        to.setDate(from.getDate() + 6);
        to.setHours(23, 59, 59, 999);
        break;
      case "thisMonth":
        from.setDate(1);
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        break;
      case "lastMonth":
        from.setMonth(from.getMonth() - 1);
        from.setDate(1);
        from.setHours(0, 0, 0, 0);
        to.setDate(0); // last day of prev month
        to.setHours(23, 59, 59, 999);
        break;
    }

    return { from, to };
  };

  const applyPreset = (presetName: string) => {
    const newRange = getPresetRange(presetName);
    setRange(newRange);
    setSelectedPreset(presetName);
  };

  const checkPresetMatch = () => {
    for (const p of PRESETS) {
      const pRange = getPresetRange(p.name);
      if (
        range.from.toDateString() === pRange.from.toDateString() &&
        range.to?.toDateString() === pRange.to?.toDateString()
      ) {
        setSelectedPreset(p.name);
        return;
      }
    }
    setSelectedPreset(undefined);
  };

  const resetToOpened = () => {
    if (openedRangeRef.current) setRange(openedRangeRef.current);
    setRangeCompare(openedRangeCompareRef.current);
  };

  useEffect(() => {
    if (isOpen) {
      openedRangeRef.current = range;
      openedRangeCompareRef.current = rangeCompare;
      checkPresetMatch();
    }
  }, [isOpen]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={cn(
            "h-9 px-3 rounded-xl text-xs font-medium justify-between gap-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800",
            className
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <CalendarIcon className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
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
          <div className="text-slate-400 -mr-1">
            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        className="w-auto p-0 rounded-2xl shadow-xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row">
          {/* Main Content Area */}
          <div className="p-3 space-y-3">
            {/* Top Bar: Manual Date Inputs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <DateInput
                  value={range.from}
                  dateFormat={dateFormat}
                  onChange={(d) => {
                    const toDate = range.to && d > range.to ? d : range.to;
                    setRange({ from: d, to: toDate });
                    setSelectedPreset(undefined);
                  }}
                />
                <span className="text-xs text-slate-400 font-medium">s.d.</span>
                <DateInput
                  value={range.to || range.from}
                  dateFormat={dateFormat}
                  onChange={(d) => {
                    const fromDate = d < range.from ? d : range.from;
                    setRange({ from: fromDate, to: d });
                    setSelectedPreset(undefined);
                  }}
                />
              </div>

              {/* Mobile Presets Dropdown */}
              {isSmallScreen && (
                <Select
                  value={selectedPreset}
                  onValueChange={(val) => applyPreset(val)}
                >
                  <SelectTrigger className="h-8 text-xs rounded-lg w-full">
                    <SelectValue placeholder="Pilihan Cepat..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p) => (
                      <SelectItem key={p.name} value={p.name} className="text-xs">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Optional Compare Feature */}
            {showCompare && (
              <div className="flex items-center justify-between py-1 px-1 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
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
                  <Label className="text-xs text-slate-600 dark:text-slate-300">
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
                    setSelectedPreset(undefined);
                  }
                }}
                numberOfMonths={isSmallScreen ? 1 : 2}
                defaultMonth={range.from}
              />
            </div>
          </div>

          {/* Desktop Presets Sidebar */}
          {!isSmallScreen && (
            <div className="border-l border-slate-100 dark:border-slate-800 p-3 bg-slate-50/60 dark:bg-slate-950/40 flex flex-col justify-between w-40 shrink-0">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 px-2 block mb-1">
                  Pilihan Cepat
                </span>
                {PRESETS.map((p) => {
                  const isSelected = selectedPreset === p.name;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p.name)}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between",
                        isSelected
                          ? "bg-purple-100 text-purple-900 font-semibold dark:bg-purple-950/60 dark:text-purple-300"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                      )}
                    >
                      <span>{p.label}</span>
                      {isSelected && <Check className="w-3 h-3 text-purple-600 dark:text-purple-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 p-3 bg-slate-50/80 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              resetToOpened();
              setIsOpen(false);
            }}
            className="h-8 px-3 text-xs text-slate-600 dark:text-slate-400"
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
            className="h-8 px-4 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-xs"
          >
            Terapkan
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

DateRangePicker.displayName = "DateRangePicker";
