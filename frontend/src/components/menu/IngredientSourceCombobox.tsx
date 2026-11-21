import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  IngredientCostGroup,
  MasterItem,
  MenuItemType,
  MenuProduct,
} from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { Check, ChevronsUpDown, Layers, Package, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IngredientSourceValue {
  master_item_id: number | null;
  sub_menu_id: number | null;
}

interface IngredientSourceComboboxProps {
  value: IngredientSourceValue;
  onChange: (next: IngredientSourceValue) => void;
  masterItems: MasterItem[];
  menuOptions: MenuProduct[];
  excludeMenuId?: number;
  costGroup: IngredientCostGroup;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

type FlatOption =
  | { kind: "submenu"; menu: MenuProduct }
  | { kind: "master"; item: MasterItem };

const PACKAGING_KEYWORDS = [
  "kemasan",
  "packaging",
  "box",
  "dus",
  "kardus",
  "mika",
  "pita",
  "ribbon",
  "stiker",
  "sticker",
  "segel",
  "plastik",
  "paper",
  "bag",
  "tas",
  "cup",
  "botol",
  "jar",
  "toples",
  "cake board",
  "alas",
  "kartu",
  "card",
  "hangtag",
  "sendok",
  "garpu",
  "tissue",
];

function isLikelyPackaging(item: MasterItem): boolean {
  const hay = `${item.category || ""} ${item.item_name || ""}`.toLowerCase();
  return PACKAGING_KEYWORDS.some((kw) => hay.includes(kw));
}

function getItemTypeBadgeLabel(itemType: MenuItemType): string {
  if (itemType === "prepared") return "Prepared";
  if (itemType === "bundle") return "Bundling";
  return "Menu Jual";
}

export const IngredientSourceCombobox: React.FC<IngredientSourceComboboxProps> = ({
  value,
  onChange,
  masterItems,
  menuOptions,
  excludeMenuId,
  costGroup,
  placeholder,
  className,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedMaster = useMemo(() => {
    if (value.master_item_id === null || value.master_item_id === undefined) return null;
    return masterItems.find((m) => m.id === value.master_item_id) || null;
  }, [value.master_item_id, masterItems]);

  const selectedSubMenu = useMemo(() => {
    if (value.sub_menu_id === null || value.sub_menu_id === undefined) return null;
    return menuOptions.find((m) => m.id === value.sub_menu_id) || null;
  }, [value.sub_menu_id, menuOptions]);

  const filteredSubMenus = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = menuOptions.filter((m) => {
      if (excludeMenuId !== undefined && m.id === excludeMenuId) return false;
      if (costGroup === "packaging" && m.item_type !== "prepared") return false;
      if (!q) return true;
      const hay = [
        m.name,
        m.anonymous_name,
        m.category,
        m.item_type,
        m.batch_yield_unit || m.unit,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const typeWeight: Record<MenuItemType, number> = {
      prepared: 0,
      finished: 1,
      bundle: 2,
    };
    return [...candidates].sort((a, b) => {
      const wa = typeWeight[a.item_type || "finished"] ?? 9;
      const wb = typeWeight[b.item_type || "finished"] ?? 9;
      if (wa !== wb) return wa - wb;
      return a.name.localeCompare(b.name, "id");
    });
  }, [menuOptions, excludeMenuId, costGroup, query]);

  const filteredMasterItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = masterItems.filter((item) => {
      if (!q) return true;
      const hay = [
        item.item_name,
        item.category,
        item.satuan_beli,
        item.satuan_ecer,
        item.aliases,
        item.default_supplier || item.last_supplier || item.supplier,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    if (costGroup === "packaging") {
      return [...filtered].sort((a, b) => {
        const pa = isLikelyPackaging(a) ? 0 : 1;
        const pb = isLikelyPackaging(b) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.item_name.localeCompare(b.item_name, "id");
      });
    }
    return filtered;
  }, [masterItems, costGroup, query]);

  const flatOptions = useMemo<FlatOption[]>(() => {
    const list: FlatOption[] = [];
    if (costGroup === "packaging") {
      for (const item of filteredMasterItems) {
        list.push({ kind: "master", item });
      }
      for (const menu of filteredSubMenus) {
        list.push({ kind: "submenu", menu });
      }
    } else {
      for (const menu of filteredSubMenus) {
        list.push({ kind: "submenu", menu });
      }
      for (const item of filteredMasterItems) {
        list.push({ kind: "master", item });
      }
    }
    return list;
  }, [costGroup, filteredMasterItems, filteredSubMenus]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(-1);
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const target = listRef.current.querySelector(
        `[data-option-idx="${highlightedIndex}"]`
      ) as HTMLElement | null;
      if (target) {
        target.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  const selectOption = (opt: FlatOption) => {
    if (opt.kind === "master") {
      onChange({ master_item_id: opt.item.id, sub_menu_id: null });
    } else {
      onChange({ master_item_id: null, sub_menu_id: opt.menu.id });
    }
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatOptions.length === 0) return;
      setHighlightedIndex((prev) =>
        prev < flatOptions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatOptions.length === 0) return;
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : flatOptions.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && flatOptions[highlightedIndex]) {
        selectOption(flatOptions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const defaultPlaceholder =
    placeholder ||
    (costGroup === "packaging"
      ? "Pilih Kemasan (Master Item)..."
      : "Pilih Bahan / Sub-Resep...");

  const hasSelection = Boolean(selectedMaster || selectedSubMenu);

  const renderMasterRow = (item: MasterItem, flatIdx: number) => {
    const isSelected = selectedMaster?.id === item.id;
    const isHighlighted = highlightedIndex === flatIdx;
    return (
      <button
        key={`master-${item.id}`}
        data-option-idx={flatIdx}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => selectOption({ kind: "master", item })}
        onMouseEnter={() => setHighlightedIndex(flatIdx)}
        className={cn(
          "w-full text-left px-2.5 py-2 text-xs flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
          isHighlighted
            ? "bg-blue-50 dark:bg-blue-950/50 text-blue-950 dark:text-blue-100"
            : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-900 dark:text-slate-100",
          isSelected && "font-semibold bg-blue-50 dark:bg-blue-950/70"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isSelected && (
              <Check className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0" />
            )}
            <span className="truncate">{item.item_name}</span>
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
            {item.category || "Bahan Kue"} | Beli: {item.satuan_beli || "-"}
            {item.satuan_ecer && item.satuan_ecer !== item.satuan_beli
              ? ` | Ecer: ${item.satuan_ecer}`
              : ""}
          </div>
        </div>
        {item.last_unit_price > 0 && (
          <div className="text-right shrink-0">
            <span className="text-xs font-semibold tabular-nums text-blue-700 dark:text-blue-300">
              {formatRupiah(item.last_unit_price)}
            </span>
            <span className="block text-[10px] text-slate-600 dark:text-slate-400">
              /{item.satuan_beli || "satuan"}
            </span>
          </div>
        )}
      </button>
    );
  };

  const renderSubMenuRow = (menu: MenuProduct, flatIdx: number) => {
    const isSelected = selectedSubMenu?.id === menu.id;
    const isHighlighted = highlightedIndex === flatIdx;
    const unitLabel = menu.batch_yield_unit || menu.unit || "Porsi";
    const unitCost =
      menu.item_type === "prepared"
        ? menu.core_unit_hpp ?? menu.effective_hpp
        : menu.effective_hpp;

    return (
      <button
        key={`sub-${menu.id}`}
        data-option-idx={flatIdx}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => selectOption({ kind: "submenu", menu })}
        onMouseEnter={() => setHighlightedIndex(flatIdx)}
        className={cn(
          "w-full text-left px-2.5 py-2 text-xs flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
          isHighlighted
            ? "bg-amber-50 dark:bg-amber-950/40 text-slate-900 dark:text-slate-100"
            : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-900 dark:text-slate-100",
          isSelected && "font-semibold bg-amber-50 dark:bg-amber-950/60"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isSelected && (
              <Check className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
            )}
            <span className="truncate">{menu.name}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                menu.item_type === "prepared"
                  ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800"
                  : "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
              )}
            >
              {getItemTypeBadgeLabel(menu.item_type || "finished")}
            </Badge>
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
            {menu.category} | Hasil: {menu.batch_yield_qty || 1} {unitLabel}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs font-semibold tabular-nums text-amber-800 dark:text-amber-300">
            {unitCost > 0 ? formatRupiah(unitCost) : "-"}
          </span>
          <span className="block text-[10px] text-slate-600 dark:text-slate-400">
            /{unitLabel}
          </span>
        </div>
      </button>
    );
  };

  let runningIdx = 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-label={defaultPlaceholder}
          className={cn(
            "h-9 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs text-left flex items-center justify-between gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 disabled:pointer-events-none transition-colors",
            hasSelection
              ? "text-slate-900 dark:text-slate-100 font-medium"
              : "text-slate-600 dark:text-slate-400",
            className
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
            {selectedSubMenu ? (
              <>
                <Layers className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
                <span className="truncate">{selectedSubMenu.name}</span>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 shrink-0 font-normal">
                  ({getItemTypeBadgeLabel(selectedSubMenu.item_type || "finished")})
                </span>
              </>
            ) : selectedMaster ? (
              <>
                <span className="truncate">{selectedMaster.item_name}</span>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 shrink-0 font-normal">
                  ({selectedMaster.satuan_beli || selectedMaster.satuan_ecer || "-"}
                  {selectedMaster.last_unit_price > 0
                    ? `, ${formatRupiah(selectedMaster.last_unit_price)}`
                    : ""}
                  )
                </span>
              </>
            ) : (
              <span className="truncate text-slate-600 dark:text-slate-400">
                {defaultPlaceholder}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {hasSelection && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Hapus pilihan sumber bahan"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ master_item_id: null, sub_menu_id: null });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange({ master_item_id: null, sub_menu_id: null });
                  }
                }}
                className="p-0.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronsUpDown className="w-3.5 h-3.5 text-slate-500" />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="z-[70] w-[320px] sm:w-[410px] p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl space-y-2"
      >
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              costGroup === "packaging"
                ? "Cari box, mika, pita, stiker, botol..."
                : "Cari bahan mentah atau sub-resep prepared..."
            }
            className="h-9 pl-8 pr-7 text-xs bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
              aria-label="Hapus pencarian"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-1 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1.5">
          <button
            type="button"
            onClick={() => {
              onChange({ master_item_id: null, sub_menu_id: null });
              setOpen(false);
            }}
            className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <Package className="w-3 h-3" />
            <span>Input Manual (Tanpa Master)</span>
          </button>
          <span className="tabular-nums">{flatOptions.length} pilihan</span>
        </div>

        <div
          ref={listRef}
          role="listbox"
          className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-md border border-slate-200 dark:border-slate-800"
        >
          {flatOptions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
              <p>Tidak ditemukan sumber untuk &quot;{query}&quot;</p>
              <button
                type="button"
                onClick={() => {
                  onChange({ master_item_id: null, sub_menu_id: null });
                  setOpen(false);
                }}
                className="text-xs text-blue-700 dark:text-blue-400 underline font-medium"
              >
                Isi nama &amp; harga secara manual
              </button>
            </div>
          ) : costGroup === "packaging" ? (
            <>
              {filteredMasterItems.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    Master Item (Kemasan Diutamakan)
                  </div>
                  {filteredMasterItems.map((item) => renderMasterRow(item, runningIdx++))}
                </div>
              )}
              {filteredSubMenus.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
                    Prepared Terkait
                  </div>
                  {filteredSubMenus.map((menu) => renderSubMenuRow(menu, runningIdx++))}
                </div>
              )}
            </>
          ) : (
            <>
              {filteredSubMenus.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
                    Sub-Resep (Prepared) &amp; Produk Lain ({filteredSubMenus.length})
                  </div>
                  {filteredSubMenus.map((menu) => renderSubMenuRow(menu, runningIdx++))}
                </div>
              )}
              {filteredMasterItems.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    Bahan Mentah Master Item ({filteredMasterItems.length})
                  </div>
                  {filteredMasterItems.map((item) => renderMasterRow(item, runningIdx++))}
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
