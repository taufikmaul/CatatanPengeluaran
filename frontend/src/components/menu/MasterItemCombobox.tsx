import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MasterItem } from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { Search, ChevronsUpDown, Check, X, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface MasterItemComboboxProps {
  value: number | null;
  onChange: (id: number | null) => void;
  masterItems: MasterItem[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const MasterItemCombobox: React.FC<MasterItemComboboxProps> = ({
  value,
  onChange,
  masterItems,
  placeholder = "Pilih Master Item...",
  className,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedItem = useMemo(() => {
    if (value === null || value === undefined) return null;
    return masterItems.find((m) => m.id === value) || null;
  }, [value, masterItems]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return masterItems;

    return masterItems.filter((item) => {
      const name = item.item_name.toLowerCase();
      const cat = (item.category || "").toLowerCase();
      const unitBeli = (item.satuan_beli || "").toLowerCase();
      const unitEcer = (item.satuan_ecer || "").toLowerCase();
      const aliases = (item.aliases || "").toLowerCase();
      const supplier = (item.default_supplier || item.last_supplier || item.supplier || "").toLowerCase();

      return (
        name.includes(q) ||
        cat.includes(q) ||
        unitBeli.includes(q) ||
        unitEcer.includes(q) ||
        aliases.includes(q) ||
        supplier.includes(q)
      );
    });
  }, [masterItems, query]);

  // Reset search and highlight when popover opens/closes
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(-1);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Auto scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredItems.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredItems.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && filteredItems[highlightedIndex]) {
        onChange(filteredItems[highlightedIndex].id);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-label="Pilih Master Item"
          className={cn(
            "h-8 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs text-left flex items-center justify-between gap-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none transition-colors",
            selectedItem
              ? "text-slate-900 dark:text-slate-100 font-medium"
              : "text-slate-500 dark:text-slate-400",
            className
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
            {selectedItem ? (
              <>
                <span className="truncate">{selectedItem.item_name}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0 font-normal">
                  ({selectedItem.satuan_beli || selectedItem.satuan_ecer || "-"}
                  {selectedItem.last_unit_price > 0
                    ? ` - ${formatRupiah(selectedItem.last_unit_price)}`
                    : ""}
                  )
                </span>
              </>
            ) : (
              <span className="truncate text-slate-500 dark:text-slate-400">
                {placeholder}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {selectedItem && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Hapus pilihan master item"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onChange(null);
                  }
                }}
                className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="z-[70] w-[320px] sm:w-[380px] p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl space-y-2"
      >
        {/* Search Input Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ketik nama bahan, kategori, satuan..."
            className="h-8 pl-8 pr-7 text-xs bg-slate-50 dark:bg-slate-950/70 border-slate-200 dark:border-slate-700"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
              aria-label="Hapus pencarian"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Clear / Manual Option */}
        <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <Package className="w-3 h-3" />
            <span>Input Bahan Manual (Bukan Master Item)</span>
          </button>
          <span>{filteredItems.length} bahan</span>
        </div>

        {/* Filtered Master Items List */}
        <div
          ref={listRef}
          role="listbox"
          className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 rounded-md border border-slate-100 dark:border-slate-800/40"
        >
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <p>Tidak ada Master Item untuk &quot;{query}&quot;</p>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="text-[11px] text-blue-600 dark:text-blue-400 underline font-medium"
              >
                Gunakan sebagai bahan manual
              </button>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = selectedItem?.id === item.id;
              const isHighlighted = highlightedIndex === idx;

              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors",
                    isHighlighted
                      ? "bg-blue-50/80 dark:bg-blue-950/50 text-blue-900 dark:text-blue-100"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-800 dark:text-slate-200",
                    isSelected && "font-semibold bg-blue-50 dark:bg-blue-950/70"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      )}
                      <span className="truncate">{item.item_name}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                      <span>{item.category || "Bahan Kue"}</span>
                      <span>•</span>
                      <span>Beli: {item.satuan_beli || "-"}</span>
                      {item.satuan_ecer && item.satuan_ecer !== item.satuan_beli && (
                        <>
                          <span>•</span>
                          <span>Ecer: {item.satuan_ecer}</span>
                        </>
                      )}
                      {(item.default_supplier || item.last_supplier || item.supplier) && (
                        <>
                          <span>•</span>
                          <span className="truncate">{item.default_supplier || item.last_supplier || item.supplier}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {item.last_unit_price > 0 && (
                    <div className="text-right shrink-0">
                      <span className="text-xs font-semibold tabular-nums text-blue-700 dark:text-blue-300">
                        {formatRupiah(item.last_unit_price)}
                      </span>
                      <span className="block text-[9px] text-slate-400">
                        /{item.satuan_beli || "satuan"}
                      </span>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
