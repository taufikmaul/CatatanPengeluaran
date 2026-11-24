import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Check, ChevronDown, Search, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOptionItem {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  keywords?: string;
}

export interface AdaptiveSelectProps {
  value: string;
  onValueChange: (val: string) => void;
  options: Array<string | SelectOptionItem>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Force searchable combobox even if options <= 10 */
  searchable?: boolean;
  /** Allow typing and selecting a custom value not in options (automatically enables searchable mode) */
  creatable?: boolean;
  creatablePrefix?: string;
  /** Allow clearing value back to empty string */
  allowClear?: boolean;
  clearValue?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  id?: string;
  "aria-label"?: string;
}

const EMPTY_SENTINEL = "__ADAPTIVE_EMPTY_VALUE__";

export const AdaptiveSelect: React.FC<AdaptiveSelectProps> = ({
  value,
  onValueChange,
  options,
  placeholder = "Pilih...",
  searchPlaceholder = "Cari pilihan...",
  emptyText = "Tidak ditemukan.",
  searchable,
  creatable = false,
  creatablePrefix = "Gunakan",
  allowClear = false,
  clearValue = "",
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  id,
  "aria-label": ariaLabel,
}) => {
  const normalizedOptions = useMemo<SelectOptionItem[]>(() => {
    const seen = new Set<string>();
    const list: SelectOptionItem[] = [];
    for (const opt of options) {
      const item: SelectOptionItem =
        typeof opt === "string" ? { value: opt, label: opt } : opt;
      if (!seen.has(item.value)) {
        seen.add(item.value);
        list.push(item);
      }
    }
    return list;
  }, [options]);

  const useSearchableMode =
    creatable || searchable === true || (searchable !== false && normalizedOptions.length > 10);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(() => {
    return normalizedOptions.find((o) => o.value === value) || null;
  }, [normalizedOptions, value]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((item) => {
      return (
        item.label.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q) ||
        (item.sublabel && item.sublabel.toLowerCase().includes(q)) ||
        (item.keywords && item.keywords.toLowerCase().includes(q))
      );
    });
  }, [normalizedOptions, query]);

  const canCreateCustom = useMemo(() => {
    if (!creatable) return false;
    const clean = query.trim();
    if (!clean) return false;
    return !normalizedOptions.some(
      (o) =>
        o.value.toLowerCase() === clean.toLowerCase() ||
        o.label.toLowerCase() === clean.toLowerCase()
    );
  }, [creatable, query, normalizedOptions]);

  useEffect(() => {
    if (open && useSearchableMode) {
      setQuery("");
      const currentIdx = normalizedOptions.findIndex((o) => o.value === value);
      setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [open, useSearchableMode, normalizedOptions, value]);

  useEffect(() => {
    if (!open || !useSearchableMode) return;
    if (highlightedIndex >= 0 && listRef.current) {
      const target = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      if (target) {
        target.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, open, useSearchableMode]);

  // Mode 1: Standard Shadcn Select for <= 10 options (when not creatable/forced searchable)
  if (!useSearchableMode) {
    const safeValue = value === "" ? EMPTY_SENTINEL : value;
    const hasEmptyOption = normalizedOptions.some((o) => o.value === "");

    return (
      <Select
        value={
          normalizedOptions.some((o) => o.value === value)
            ? safeValue
            : hasEmptyOption && !value
            ? EMPTY_SENTINEL
            : undefined
        }
        onValueChange={(next) => {
          onValueChange(next === EMPTY_SENTINEL ? "" : next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-label={ariaLabel}
          className={cn(
            "h-9 w-full rounded-md border-input bg-background px-3 text-xs font-medium shadow-xs focus:ring-1 focus:ring-ring focus:ring-offset-0",
            className,
            triggerClassName
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={cn("z-[80]", contentClassName)}>
          {normalizedOptions.map((item) => {
            const itemVal = item.value === "" ? EMPTY_SENTINEL : item.value;
            return (
              <SelectItem
                key={itemVal}
                value={itemVal}
                className="text-xs py-1.5 cursor-pointer"
              >
                <span className="truncate">{item.label}</span>
                {item.sublabel && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {item.sublabel}
                  </span>
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  // Mode 2: Shadcn Popover + ReUI InputGroup Searchable Combobox (> 10 options or creatable)
  const totalSelectableCount = filteredOptions.length + (canCreateCustom ? 1 : 0);

  const handleSelectValue = (nextVal: string) => {
    onValueChange(nextVal);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalSelectableCount === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % totalSelectableCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalSelectableCount === 0) return;
      setHighlightedIndex((prev) =>
        prev - 1 >= 0 ? prev - 1 : totalSelectableCount - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        handleSelectValue(filteredOptions[highlightedIndex].value);
      } else if (canCreateCustom) {
        handleSelectValue(query.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const displayLabel = selectedOption
    ? selectedOption.label
    : value && value !== clearValue
    ? value
    : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel || placeholder}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            displayLabel ? "text-foreground font-medium" : "text-muted-foreground",
            className,
            triggerClassName
          )}
        >
          <span className="truncate text-left flex-1">
            {displayLabel || placeholder}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {allowClear && displayLabel && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Reset pilihan"
                onClick={(e) => {
                  e.stopPropagation();
                  onValueChange(clearValue);
                }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className={cn(
          "z-[80] w-[var(--radix-popover-trigger-width)] min-w-[240px] p-1.5 bg-popover text-popover-foreground border border-border shadow-lg rounded-lg space-y-1.5",
          contentClassName
        )}
      >
        <InputGroup className="h-8 bg-muted/40">
          <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
            <Search className="size-3.5 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="h-8 text-xs px-1.5"
          />
          {query.length > 0 && (
            <InputGroupAddon align="inline-end" className="pr-1.5">
              <InputGroupButton
                size="icon-xs"
                aria-label="Bersihkan pencarian"
                onClick={() => {
                  setQuery("");
                  setHighlightedIndex(0);
                  searchInputRef.current?.focus();
                }}
              >
                <X className="size-3" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <div
          ref={listRef}
          role="listbox"
          className="max-h-56 overflow-y-auto divide-y divide-border/40 rounded-md"
        >
          {filteredOptions.length === 0 && !canCreateCustom ? (
            <div className="py-4 px-2 text-center text-xs text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            <>
              {filteredOptions.map((item, idx) => {
                const isSelected = item.value === value;
                const isHighlighted = highlightedIndex === idx;
                return (
                  <button
                    key={item.value || EMPTY_SENTINEL}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectValue(item.value)}
                    className={cn(
                      "w-full text-left px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 rounded-sm transition-colors",
                      isHighlighted
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/60"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate",
                            isSelected ? "font-semibold" : "font-normal"
                          )}
                        >
                          {item.label}
                        </span>
                        {item.badge && (
                          <span className="text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground font-medium shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.sublabel && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {item.sublabel}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
                    )}
                  </button>
                );
              })}

              {canCreateCustom && (
                <button
                  type="button"
                  role="option"
                  aria-selected={highlightedIndex === filteredOptions.length}
                  onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectValue(query.trim())}
                  className={cn(
                    "w-full text-left px-2.5 py-2 text-xs flex items-center gap-1.5 rounded-sm font-medium text-blue-600 dark:text-blue-400",
                    highlightedIndex === filteredOptions.length
                      ? "bg-accent"
                      : "hover:bg-accent/60"
                  )}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {creatablePrefix} &quot;{query.trim()}&quot;
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const SearchableSelect: React.FC<AdaptiveSelectProps> = (props) => (
  <AdaptiveSelect {...props} searchable={true} />
);
