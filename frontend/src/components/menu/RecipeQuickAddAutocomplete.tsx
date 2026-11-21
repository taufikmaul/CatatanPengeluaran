import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  IngredientCostGroup,
  MasterItem,
  MenuItemType,
  MenuProduct,
} from "@/types";
import { formatRupiah } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  Check,
  CornerDownLeft,
  Layers,
  Package,
  Plus,
  Search,
  Utensils,
  X,
} from "lucide-react";

export type QuickAddTargetMode = "auto" | "ingredient" | "packaging";

export type QuickAddSelection =
  | {
      kind: "master";
      item: MasterItem;
      targetGroup: IngredientCostGroup;
    }
  | {
      kind: "submenu";
      menu: MenuProduct;
      targetGroup: IngredientCostGroup;
    }
  | {
      kind: "manual";
      name: string;
      targetGroup: IngredientCostGroup;
    };

export interface RecipeQuickAddAutocompleteProps {
  masterItems: MasterItem[];
  menuOptions: MenuProduct[];
  excludeMenuId?: number;
  existingMasterCounts: Map<number, number>;
  existingSubMenuCounts: Map<number, number>;
  onAddItem: (selection: QuickAddSelection) => void;
  lastAddedNotice?: { label: string; group: IngredientCostGroup } | null;
}

export const PACKAGING_KEYWORDS = [
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
] as const;

export function isLikelyPackagingText(text: string): boolean {
  const hay = text.toLowerCase();
  return PACKAGING_KEYWORDS.some((kw) => hay.includes(kw));
}

export function isLikelyPackagingMaster(item: MasterItem): boolean {
  const hay = `${item.category || ""} ${item.item_name || ""}`.toLowerCase();
  return PACKAGING_KEYWORDS.some((kw) => hay.includes(kw));
}

function getItemTypeLabel(itemType: MenuItemType): string {
  if (itemType === "prepared") return "Prepared";
  if (itemType === "bundle") return "Bundling";
  return "Menu Jual";
}

function scoreTextMatch(
  name: string,
  metadataHay: string,
  rawQuery: string
): number | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 10;

  const nameLower = name.toLowerCase();
  const fullHay = `${nameLower} ${metadataHay.toLowerCase()}`;
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.every((t) => fullHay.includes(t))) {
    return null;
  }

  if (nameLower === q) return 0;
  if (nameLower.startsWith(q)) return 1;
  if (nameLower.split(/[\s/\-_()]+/).some((w) => w.startsWith(q))) return 2;
  if (nameLower.includes(q)) return 3;
  if (terms.every((t) => nameLower.includes(t))) return 4;
  return 5;
}

type DropdownOption =
  | {
      id: string;
      kind: "master";
      item: MasterItem;
      targetGroup: IngredientCostGroup;
      isPkgMaster: boolean;
    }
  | {
      id: string;
      kind: "submenu";
      menu: MenuProduct;
      targetGroup: IngredientCostGroup;
    }
  | {
      id: string;
      kind: "manual";
      name: string;
      targetGroup: IngredientCostGroup;
    };

const MAX_DB_OPTIONS = 40;

export const RecipeQuickAddAutocomplete: React.FC<
  RecipeQuickAddAutocompleteProps
> = ({
  masterItems,
  menuOptions,
  excludeMenuId,
  existingMasterCounts,
  existingSubMenuCounts,
  onAddItem,
  lastAddedNotice,
}) => {
  const [targetMode, setTargetMode] = useState<QuickAddTargetMode>("auto");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const inputId = useId();

  useEffect(() => {
    const handlePointerDownOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDownOutside);
    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside);
    };
  }, []);

  const { dbOptions, totalMatchedCount } = useMemo(() => {
    const trimmed = query.trim();
    const candidates: Array<{
      opt: DropdownOption;
      score: number;
      modePriority: number;
      sortName: string;
    }> = [];

    for (const menu of menuOptions) {
      if (excludeMenuId !== undefined && menu.id === excludeMenuId) continue;
      if (targetMode === "packaging" && menu.item_type !== "prepared") {
        continue;
      }

      const metaHay = [
        menu.anonymous_name,
        menu.category,
        menu.item_type,
        menu.batch_yield_unit || menu.unit,
      ]
        .filter(Boolean)
        .join(" ");

      const score = scoreTextMatch(menu.name, metaHay, trimmed);
      if (score === null) continue;

      const targetGroup: IngredientCostGroup =
        targetMode === "packaging" ? "packaging" : "ingredient";

      let modePriority = 1;
      if (targetMode === "auto") {
        modePriority = menu.item_type === "prepared" ? 0 : 2;
      } else if (targetMode === "ingredient") {
        modePriority = menu.item_type === "prepared" ? 0 : 1;
      } else {
        modePriority = 2;
      }

      candidates.push({
        opt: {
          id: `sub-${menu.id}`,
          kind: "submenu",
          menu,
          targetGroup,
        },
        score,
        modePriority,
        sortName: menu.name,
      });
    }

    for (const item of masterItems) {
      const isPkgMaster = isLikelyPackagingMaster(item);
      const metaHay = [
        item.category,
        item.satuan_beli,
        item.satuan_ecer,
        item.aliases,
        item.default_supplier || item.last_supplier || item.supplier,
      ]
        .filter(Boolean)
        .join(" ");

      const score = scoreTextMatch(item.item_name, metaHay, trimmed);
      if (score === null) continue;

      const targetGroup: IngredientCostGroup =
        targetMode === "auto"
          ? isPkgMaster
            ? "packaging"
            : "ingredient"
          : targetMode;

      let modePriority = 1;
      if (targetMode === "packaging") {
        modePriority = isPkgMaster ? 0 : 1;
      } else if (targetMode === "ingredient") {
        modePriority = isPkgMaster ? 2 : 0;
      } else {
        modePriority = 1;
      }

      candidates.push({
        opt: {
          id: `master-${item.id}`,
          kind: "master",
          item,
          targetGroup,
          isPkgMaster,
        },
        score,
        modePriority,
        sortName: item.item_name,
      });
    }

    candidates.sort((a, b) => {
      if (trimmed) {
        if (a.score !== b.score) return a.score - b.score;
        if (a.modePriority !== b.modePriority) {
          return a.modePriority - b.modePriority;
        }
      } else {
        if (a.modePriority !== b.modePriority) {
          return a.modePriority - b.modePriority;
        }
      }
      return a.sortName.localeCompare(b.sortName, "id");
    });

    return {
      dbOptions: candidates.slice(0, MAX_DB_OPTIONS).map((c) => c.opt),
      totalMatchedCount: candidates.length,
    };
  }, [masterItems, menuOptions, excludeMenuId, targetMode, query]);

  const manualOptions = useMemo<DropdownOption[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (targetMode === "auto") {
      const predicted: IngredientCostGroup = isLikelyPackagingText(trimmed)
        ? "packaging"
        : "ingredient";
      const alternate: IngredientCostGroup =
        predicted === "packaging" ? "ingredient" : "packaging";
      return [
        {
          id: `manual-${predicted}`,
          kind: "manual",
          name: trimmed,
          targetGroup: predicted,
        },
        {
          id: `manual-${alternate}`,
          kind: "manual",
          name: trimmed,
          targetGroup: alternate,
        },
      ];
    }

    return [
      {
        id: `manual-${targetMode}`,
        kind: "manual",
        name: trimmed,
        targetGroup: targetMode,
      },
    ];
  }, [query, targetMode]);

  const options = useMemo<DropdownOption[]>(
    () => [...dbOptions, ...manualOptions],
    [dbOptions, manualOptions]
  );

  useEffect(() => {
    setHighlightedIndex(options.length > 0 ? 0 : -1);
  }, [query, targetMode, options.length]);

  useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-option-idx="${highlightedIndex}"]`
    ) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [open, highlightedIndex]);

  const selectOption = (opt: DropdownOption) => {
    if (opt.kind === "master") {
      onAddItem({
        kind: "master",
        item: opt.item,
        targetGroup: opt.targetGroup,
      });
    } else if (opt.kind === "submenu") {
      onAddItem({
        kind: "submenu",
        menu: opt.menu,
        targetGroup: opt.targetGroup,
      });
    } else {
      onAddItem({
        kind: "manual",
        name: opt.name,
        targetGroup: opt.targetGroup,
      });
    }

    setQuery("");
    setOpen(false);
    setHighlightedIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        if (highlightedIndex < 0 && options.length > 0) {
          setHighlightedIndex(0);
        }
        return;
      }
      if (options.length === 0) return;
      setHighlightedIndex((prev) =>
        prev < options.length - 1 ? prev + 1 : 0
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        if (options.length > 0) {
          setHighlightedIndex(options.length - 1);
        }
        return;
      }
      if (options.length === 0) return;
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : options.length - 1
      );
      return;
    }

    if (e.key === "Enter") {
      // Never submit the parent dialog form from inside the quick-add search box.
      e.preventDefault();
      e.stopPropagation();
      const chosen =
        options[highlightedIndex >= 0 ? highlightedIndex : 0] || null;
      if (open && chosen) {
        selectOption(chosen);
      } else if (!open && query.trim().length > 0 && chosen) {
        selectOption(chosen);
      } else {
        setOpen(true);
        if (options.length > 0 && highlightedIndex < 0) {
          setHighlightedIndex(0);
        }
      }
      return;
    }

    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const activeOptionId =
    open && highlightedIndex >= 0 && options[highlightedIndex]
      ? `${listboxId}-opt-${highlightedIndex}`
      : undefined;

  const modeButtons: Array<{
    value: QuickAddTargetMode;
    label: string;
  }> = [
    { value: "auto", label: "Auto" },
    { value: "ingredient", label: "Bahan" },
    { value: "packaging", label: "Kemasan" },
  ];

  const truncatedCount = Math.max(0, totalMatchedCount - dbOptions.length);

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-blue-200/90 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-2.5 transition-colors focus-within:border-blue-400 dark:focus-within:border-blue-700"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <label
          htmlFor={inputId}
          className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5"
        >
          <Search className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300 shrink-0" />
          <span>Cari &amp; Tambah Bahan / Kemasan (Tekan Enter)</span>
        </label>

        <div
          className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-0.5 self-start sm:self-auto"
          role="group"
          aria-label="Target kelompok item"
        >
          {modeButtons.map((btn) => {
            const active = targetMode === btn.value;
            return (
              <button
                key={btn.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTargetMode(btn.value);
                  setOpen(true);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "relative px-2.5 py-1.5 sm:py-1 text-[11px] font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
                  active
                    ? "text-white"
                    : "text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="quickadd-mode-pill"
                    transition={{ type: "spring", stiffness: 500, damping: 36 }}
                    className={cn(
                      "absolute inset-0 rounded-md",
                      btn.value === "packaging"
                        ? "bg-amber-700"
                        : "bg-blue-700"
                    )}
                  />
                )}
                <span className="relative z-10">{btn.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative rounded-lg transition-shadow focus-within:ring-2 focus-within:ring-blue-500/20">
        <Search className="w-4 h-4 text-slate-600 dark:text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10" />
        <Input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          value={query}
          onFocus={() => {
            setOpen(true);
            if (options.length > 0 && highlightedIndex < 0) {
              setHighlightedIndex(0);
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Ketik nama bahan, sub-resep prepared, atau kemasan... lalu Enter"
          className="h-10 sm:h-9 pl-9 pr-24 sm:pr-28 text-xs bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 focus-visible:ring-1 focus-visible:ring-blue-600"
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setOpen(true);
                inputRef.current?.focus();
              }}
              aria-label="Bersihkan pencarian"
              className="h-7 w-7 sm:h-6 sm:w-6 inline-flex items-center justify-center rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-[10px] font-medium text-slate-700 dark:text-slate-300">
            <CornerDownLeft className="w-2.5 h-2.5" />
            <span>Enter</span>
          </kbd>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Hasil pencarian bahan dan kemasan"
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.99 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-lg max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
            >
            {options.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-600 dark:text-slate-400">
                Belum ada data Master Item atau Sub-Resep. Ketik nama bahan atau
                kemasan lalu tekan Enter untuk menambahkan secara manual.
              </div>
            ) : (
              <>
                {options.map((opt, idx) => {
                  const isHighlighted = idx === highlightedIndex;
                  const targetIsPkg = opt.targetGroup === "packaging";

                  if (opt.kind === "submenu") {
                    const menu = opt.menu;
                    const countInList = existingSubMenuCounts.get(menu.id) || 0;
                    const unitLabel =
                      menu.batch_yield_unit || menu.unit || "Porsi";
                    const unitCost =
                      menu.item_type === "prepared"
                        ? menu.core_unit_hpp ?? menu.effective_hpp
                        : menu.effective_hpp;

                    return (
                      <button
                        key={opt.id}
                        id={`${listboxId}-opt-${idx}`}
                        data-option-idx={idx}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        onClick={() => selectOption(opt)}
                        className={cn(
                          "w-full min-h-[44px] sm:min-h-[40px] text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
                          isHighlighted
                            ? "bg-blue-50 dark:bg-blue-950/60 text-slate-950 dark:text-slate-50"
                            : "hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-900 dark:text-slate-100"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Layers className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
                            <span className="font-medium truncate">
                              {menu.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800"
                            >
                              {getItemTypeLabel(menu.item_type || "finished")}
                            </Badge>
                            {countInList > 0 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800"
                              >
                                Di daftar ({countInList})
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                            {menu.category} | Hasil: {menu.batch_yield_qty || 1}{" "}
                            {unitLabel}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0",
                              targetIsPkg
                                ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                                : "bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800"
                            )}
                          >
                            {targetIsPkg ? "Ke Kemasan" : "Ke Bahan"}
                          </Badge>
                          <div className="text-right min-w-[68px]">
                            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {unitCost > 0 ? formatRupiah(unitCost) : "-"}
                            </span>
                            <span className="block text-[10px] text-slate-600 dark:text-slate-400">
                              /{unitLabel}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  }

                  if (opt.kind === "master") {
                    const item = opt.item;
                    const countInList = existingMasterCounts.get(item.id) || 0;
                    const hasMasterRecipe = Boolean(
                      item.satuan_resep &&
                        item.konversi_resep !== null &&
                        item.konversi_resep !== undefined &&
                        item.konversi_resep > 0
                    );
                    const recipeUnitPrice = hasMasterRecipe
                      ? item.recipe_unit_price ??
                        (item.last_unit_price > 0 && item.konversi_resep
                          ? item.last_unit_price / item.konversi_resep
                          : 0)
                      : 0;
                    return (
                      <button
                        key={opt.id}
                        id={`${listboxId}-opt-${idx}`}
                        data-option-idx={idx}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        onClick={() => selectOption(opt)}
                        className={cn(
                          "w-full min-h-[44px] sm:min-h-[40px] text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
                          isHighlighted
                            ? "bg-blue-50 dark:bg-blue-950/60 text-slate-950 dark:text-slate-50"
                            : "hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-900 dark:text-slate-100"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {opt.isPkgMaster ? (
                              <Package className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
                            ) : (
                              <Utensils className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300 shrink-0" />
                            )}
                            <span className="font-medium truncate">
                              {item.item_name}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0",
                                opt.isPkgMaster
                                  ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800"
                                  : "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
                              )}
                            >
                              {opt.isPkgMaster ? "Kemasan" : "Bahan"}
                            </Badge>
                            {countInList > 0 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800"
                              >
                                Di daftar ({countInList})
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                            {item.category || "Master Item"} | Beli:{" "}
                            {item.satuan_beli || "-"}
                            {hasMasterRecipe
                              ? ` | 1 ${item.satuan_beli || "unit"} = ${item.konversi_resep} ${item.satuan_resep}`
                              : item.satuan_ecer &&
                                item.satuan_ecer !== item.satuan_beli
                              ? ` | Ecer: ${item.satuan_ecer}`
                              : ""}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0",
                              targetIsPkg
                                ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                                : "bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800"
                            )}
                          >
                            {targetIsPkg ? "Ke Kemasan" : "Ke Bahan"}
                          </Badge>
                          <div className="text-right min-w-[78px]">
                            <span className="font-semibold tabular-nums text-blue-700 dark:text-blue-300">
                              {item.last_unit_price > 0
                                ? formatRupiah(item.last_unit_price)
                                : "-"}
                            </span>
                            <span className="block text-[10px] text-slate-600 dark:text-slate-400">
                              /{item.satuan_beli || "satuan"}
                            </span>
                            {hasMasterRecipe && recipeUnitPrice > 0 && (
                              <span className="block text-[10px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {formatRupiah(recipeUnitPrice)}/{item.satuan_resep}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={opt.id}
                      id={`${listboxId}-opt-${idx}`}
                      data-option-idx={idx}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => selectOption(opt)}
                      className={cn(
                        "w-full min-h-[44px] sm:min-h-[40px] text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
                        isHighlighted
                          ? "bg-blue-50 dark:bg-blue-950/60 text-slate-950 dark:text-slate-50"
                          : "hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-900 dark:text-slate-100"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Plus className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300 shrink-0" />
                        <span className="truncate font-medium">
                          Tambah manual &quot;{opt.name}&quot; sebagai{" "}
                          {targetIsPkg ? "Kemasan" : "Bahan Resep"}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0 shrink-0",
                          targetIsPkg
                            ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                            : "bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800"
                        )}
                      >
                        {targetIsPkg ? "Ke Kemasan" : "Ke Bahan"}
                      </Badge>
                    </button>
                  );
                })}

                {truncatedCount > 0 && (
                  <div className="px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 text-center">
                    Menampilkan {MAX_DB_OPTIONS} teratas dari{" "}
                    {totalMatchedCount} hasil. Ketik lebih spesifik untuk
                    menyaring.
                  </div>
                )}
              </>
            )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {lastAddedNotice && (
          <motion.div
            key={`${lastAddedNotice.group}-${lastAddedNotice.label}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            aria-live="polite"
            className={cn(
              "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border",
              lastAddedNotice.group === "packaging"
                ? "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900"
                : "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900"
            )}
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              Ditambahkan ke{" "}
              {lastAddedNotice.group === "packaging"
                ? "Kemasan & Packaging"
                : "Bahan Resep"}
              : <strong>{lastAddedNotice.label}</strong>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
