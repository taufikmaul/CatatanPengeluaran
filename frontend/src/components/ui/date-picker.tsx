import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateInput } from "@/components/ui/date-input";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  /** Nilai tanggal saat ini (Date atau string YYYY-MM-DD) */
  value?: Date | string;
  /** Callback saat nilai tanggal berubah */
  onChange?: (date: Date) => void;
  /** Teks placeholder */
  placeholder?: string;
  /** Custom class untuk trigger button */
  className?: string;
  /** Ukuran tombol */
  size?: "default" | "sm" | "lg";
  /** Alignment popover */
  align?: "start" | "center" | "end";
  /** Locale */
  locale?: string;
  /** Apakah disabled */
  disabled?: boolean;
  /** Format input tanggal */
  dateFormat?: "dmy" | "mdy";
}

const PRESETS = [
  { name: "today", label: "Hari Ini", offset: 0 },
  { name: "yesterday", label: "Kemarin", offset: -1 },
  { name: "tomorrow", label: "Besok", offset: 1 },
];

const parseDate = (val?: Date | string): Date => {
  if (!val) return new Date();
  if (typeof val === "string") {
    const parts = val.split("-").map((p) => parseInt(p, 10));
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  return val;
};

const formatDate = (date: Date, locale: string = "id-ID"): string => {
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  placeholder = "Pilih tanggal",
  className,
  size = "sm",
  align = "start",
  locale = "id-ID",
  disabled = false,
  dateFormat = "dmy",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => parseDate(value));

  useEffect(() => {
    if (value) {
      setSelectedDate(parseDate(value));
    }
  }, [value]);

  const openedDateRef = useRef<Date>(selectedDate);

  const applyPreset = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    setSelectedDate(d);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          disabled={disabled}
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
              {value ? formatDate(selectedDate, locale) : placeholder}
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
        <div className="p-3 space-y-3">
          {/* Top Bar with manual DateInput & quick buttons */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <DateInput
              value={selectedDate}
              dateFormat={dateFormat}
              onChange={(d) => setSelectedDate(d)}
            />
            <div className="flex items-center gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyPreset(p.offset)}
                  className="px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Calendar Single Mode */}
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => {
                if (d) setSelectedDate(d);
              }}
              defaultMonth={selectedDate}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-3 bg-slate-50/80 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedDate(openedDateRef.current);
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
              onChange?.(selectedDate);
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

DatePicker.displayName = "DatePicker";
