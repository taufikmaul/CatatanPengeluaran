import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface DateInputProps {
  value?: Date;
  onChange: (date: Date) => void;
  className?: string;
  dateFormat?: "dmy" | "mdy";
}

interface DateParts {
  day: number;
  month: number;
  year: number;
}

export const DateInput: React.FC<DateInputProps> = ({
  value,
  onChange,
  className,
  dateFormat = "dmy",
}) => {
  const [date, setDate] = React.useState<DateParts>(() => {
    const d = value ? new Date(value) : new Date();
    return {
      day: d.getDate(),
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    };
  });

  const monthRef = useRef<HTMLInputElement | null>(null);
  const dayRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setDate({
        day: d.getDate(),
        month: d.getMonth() + 1,
        year: d.getFullYear(),
      });
    }
  }, [value]);

  const validateDate = (field: keyof DateParts, val: number): boolean => {
    if (
      (field === "day" && (val < 1 || val > 31)) ||
      (field === "month" && (val < 1 || val > 12)) ||
      (field === "year" && (val < 1900 || val > 2100))
    ) {
      return false;
    }

    const newDate = { ...date, [field]: val };
    const d = new Date(newDate.year, newDate.month - 1, newDate.day);
    return (
      d.getFullYear() === newDate.year &&
      d.getMonth() + 1 === newDate.month &&
      d.getDate() === newDate.day
    );
  };

  const handleInputChange =
    (field: keyof DateParts) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const numVal = e.target.value ? Number(e.target.value) : 0;
      const isValid = validateDate(field, numVal);

      const newDate = { ...date, [field]: numVal };
      setDate(newDate);

      if (isValid) {
        onChange(new Date(newDate.year, newDate.month - 1, newDate.day));
      }
    };

  const initialDate = useRef<DateParts>(date);

  const handleBlur = (field: keyof DateParts) => (e: React.FocusEvent<HTMLInputElement>) => {
    if (!e.target.value) {
      setDate(initialDate.current);
      return;
    }

    const numVal = Number(e.target.value);
    const isValid = validateDate(field, numVal);

    if (!isValid) {
      setDate(initialDate.current);
    } else {
      initialDate.current = { ...date, [field]: numVal };
    }
  };

  const handleKeyDown =
    (field: keyof DateParts) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.metaKey || e.ctrlKey) return;

      if (
        !/^[0-9]$/.test(e.key) &&
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Delete",
          "Tab",
          "Backspace",
          "Enter",
        ].includes(e.key)
      ) {
        e.preventDefault();
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        let newDate = { ...date };

        if (field === "day") {
          const daysInMonth = new Date(date.year, date.month, 0).getDate();
          if (date.day >= daysInMonth) {
            newDate = { ...newDate, day: 1, month: (date.month % 12) + 1 };
            if (newDate.month === 1) newDate.year += 1;
          } else {
            newDate.day += 1;
          }
        } else if (field === "month") {
          if (date.month >= 12) {
            newDate = { ...newDate, month: 1, year: date.year + 1 };
          } else {
            newDate.month += 1;
          }
        } else if (field === "year") {
          newDate.year += 1;
        }

        setDate(newDate);
        onChange(new Date(newDate.year, newDate.month - 1, newDate.day));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        let newDate = { ...date };

        if (field === "day") {
          if (date.day <= 1) {
            newDate.month -= 1;
            if (newDate.month <= 0) {
              newDate.month = 12;
              newDate.year -= 1;
            }
            newDate.day = new Date(newDate.year, newDate.month, 0).getDate();
          } else {
            newDate.day -= 1;
          }
        } else if (field === "month") {
          if (date.month <= 1) {
            newDate = { ...newDate, month: 12, year: date.year - 1 };
          } else {
            newDate.month -= 1;
          }
        } else if (field === "year") {
          newDate.year -= 1;
        }

        setDate(newDate);
        onChange(new Date(newDate.year, newDate.month - 1, newDate.day));
      }

      if (e.key === "ArrowRight") {
        if (
          e.currentTarget.selectionStart === e.currentTarget.value.length ||
          (e.currentTarget.selectionStart === 0 &&
            e.currentTarget.selectionEnd === e.currentTarget.value.length)
        ) {
          e.preventDefault();
          if (dateFormat === "dmy") {
            if (field === "day") monthRef.current?.focus();
            if (field === "month") yearRef.current?.focus();
          } else {
            if (field === "month") dayRef.current?.focus();
            if (field === "day") yearRef.current?.focus();
          }
        }
      } else if (e.key === "ArrowLeft") {
        if (
          e.currentTarget.selectionStart === 0 ||
          (e.currentTarget.selectionStart === 0 &&
            e.currentTarget.selectionEnd === e.currentTarget.value.length)
        ) {
          e.preventDefault();
          if (dateFormat === "dmy") {
            if (field === "year") monthRef.current?.focus();
            if (field === "month") dayRef.current?.focus();
          } else {
            if (field === "year") dayRef.current?.focus();
            if (field === "day") monthRef.current?.focus();
          }
        }
      }
    };

  const renderDayInput = () => (
    <input
      type="text"
      ref={dayRef}
      max={31}
      maxLength={2}
      value={date.day.toString().padStart(2, "0")}
      onChange={handleInputChange("day")}
      onKeyDown={handleKeyDown("day")}
      onFocus={(e) => e.target.select()}
      onBlur={handleBlur("day")}
      className="p-0 bg-transparent outline-none w-6 border-none text-center text-xs font-mono text-slate-800 dark:text-slate-200"
      placeholder="DD"
      aria-label="Hari"
    />
  );

  const renderMonthInput = () => (
    <input
      type="text"
      ref={monthRef}
      max={12}
      maxLength={2}
      value={date.month.toString().padStart(2, "0")}
      onChange={handleInputChange("month")}
      onKeyDown={handleKeyDown("month")}
      onFocus={(e) => e.target.select()}
      onBlur={handleBlur("month")}
      className="p-0 bg-transparent outline-none w-6 border-none text-center text-xs font-mono text-slate-800 dark:text-slate-200"
      placeholder="MM"
      aria-label="Bulan"
    />
  );

  const renderYearInput = () => (
    <input
      type="text"
      ref={yearRef}
      max={9999}
      maxLength={4}
      value={date.year.toString()}
      onChange={handleInputChange("year")}
      onKeyDown={handleKeyDown("year")}
      onFocus={(e) => e.target.select()}
      onBlur={handleBlur("year")}
      className="p-0 bg-transparent outline-none w-11 border-none text-center text-xs font-mono text-slate-800 dark:text-slate-200"
      placeholder="YYYY"
      aria-label="Tahun"
    />
  );

  return (
    <div
      className={cn(
        "flex items-center h-8 px-2 border rounded-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs shadow-2xs focus-within:ring-2 focus-within:ring-purple-500",
        className
      )}
    >
      {dateFormat === "dmy" ? (
        <>
          {renderDayInput()}
          <span className="opacity-30 mx-0.5 select-none text-slate-400">/</span>
          {renderMonthInput()}
          <span className="opacity-30 mx-0.5 select-none text-slate-400">/</span>
          {renderYearInput()}
        </>
      ) : (
        <>
          {renderMonthInput()}
          <span className="opacity-30 mx-0.5 select-none text-slate-400">/</span>
          {renderDayInput()}
          <span className="opacity-30 mx-0.5 select-none text-slate-400">/</span>
          {renderYearInput()}
        </>
      )}
    </div>
  );
};

DateInput.displayName = "DateInput";
