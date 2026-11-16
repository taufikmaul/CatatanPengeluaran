import React, { useState, useMemo, useRef, useEffect } from "react";
import { PurchaseRequest, PurchaseRequestFormData, PurchaseRequestItemFormData, ItemSuggestion } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/formatters";
import { getCategoryFormProfile } from "@/lib/categoryFormConfig";
import {
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  Search,
  User,
  Clock,
  AlertCircle,
  FileText,
  X,
  CornerDownLeft,
  CheckCircle2,
  RotateCcw,
  Store,
} from "lucide-react";

interface PurchaseRequestDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PurchaseRequestFormData, requestId?: number) => void;
  initialData?: PurchaseRequest | null;
  isSubmitting?: boolean;
  itemSuggestions?: ItemSuggestion[];
  recentRequests?: PurchaseRequest[];
  categories?: string[];
  currentUser?: string;
}

const COMMON_UNITS = [
  "Pcs", "Box", "Kg", "Gram", "Liter", "Pack", "Sak", "Bungkus",
  "Kaleng", "Dus", "Botol", "Bal", "Roll", "Lembar", "Butir", "Ikat"
];

const UNIT_ALIASES: Record<string, string> = {
  pcs: "Pcs",
  pc: "Pcs",
  buah: "Pcs",
  bh: "Pcs",
  biji: "Pcs",
  box: "Box",
  kotak: "Box",
  kg: "Kg",
  kilo: "Kg",
  kilogram: "Kg",
  g: "Gram",
  gr: "Gram",
  gram: "Gram",
  l: "Liter",
  ltr: "Liter",
  liter: "Liter",
  pack: "Pack",
  pak: "Pack",
  sak: "Sak",
  karung: "Sak",
  bungkus: "Bungkus",
  bks: "Bungkus",
  kaleng: "Kaleng",
  klg: "Kaleng",
  dus: "Dus",
  karton: "Dus",
  ktn: "Dus",
  botol: "Botol",
  btl: "Botol",
  bal: "Bal",
  roll: "Roll",
  rol: "Roll",
  lembar: "Lembar",
  lbr: "Lembar",
  butir: "Butir",
  btr: "Butir",
  ikat: "Ikat",
  ikt: "Ikat",
  lusin: "Lusin",
  lsn: "Lusin",
  pouch: "Pouch",
  set: "Set",
};

interface ParsedQuickInput {
  itemQuery: string;
  qty: number;
  unit: string | null;
  hasInlineModifier: boolean;
}

function parseNumericToken(token: string): number {
  const num = parseFloat(token.replace(",", "."));
  return Number.isFinite(num) && num > 0 ? Number(num.toFixed(2)) : 1;
}

/**
 * Memisahkan qty & satuan inline dari input cepat (mis. "3 kg gula pasir", "tepung x5")
 * tanpa memecah nama produk master yang memang mengandung ukuran (mis. "Gas LPG 12kg").
 */
function parseInlineQtyAndUnit(
  rawInput: string,
  itemSuggestions: ItemSuggestion[]
): ParsedQuickInput {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { itemQuery: "", qty: 1, unit: null, hasInlineModifier: false };
  }

  const lower = trimmed.toLowerCase();
  const hasDirectSuggestionMatch = itemSuggestions.some(
    (s) =>
      s.item_name.toLowerCase().includes(lower) ||
      (s.aliases && s.aliases.toLowerCase().includes(lower))
  );

  // 1. Prefix dengan satuan eksplisit: "3 kg gula pasir" atau "2.5ltr susu"
  const prefixUnitMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)\s+(.+)$/);
  if (prefixUnitMatch) {
    const canonicalUnit = UNIT_ALIASES[prefixUnitMatch[2].toLowerCase()];
    const qty = parseNumericToken(prefixUnitMatch[1]);
    if (canonicalUnit && prefixUnitMatch[3].trim()) {
      return {
        itemQuery: prefixUnitMatch[3].trim(),
        qty,
        unit: canonicalUnit,
        hasInlineModifier: true,
      };
    }
  }

  // 2. Prefix pengali: "5x tepung" atau "5 x tepung"
  const prefixMulMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*[xX*]\s+(.+)$/) ||
    trimmed.match(/^(\d+(?:[.,]\d+)?)[xX]\s+(.+)$/);
  if (prefixMulMatch && prefixMulMatch[2].trim()) {
    return {
      itemQuery: prefixMulMatch[2].trim(),
      qty: parseNumericToken(prefixMulMatch[1]),
      unit: null,
      hasInlineModifier: true,
    };
  }

  // 3. Prefix angka polos: "5 telur ayam"
  const prefixNumMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (prefixNumMatch) {
    const qty = parseNumericToken(prefixNumMatch[1]);
    const rest = prefixNumMatch[2].trim();
    if (qty < 10000 && /[a-zA-Z]/.test(rest)) {
      return {
        itemQuery: rest,
        qty,
        unit: null,
        hasInlineModifier: true,
      };
    }
  }

  // Suffix hanya diproses jika input mentah bukan bagian dari nama Master Item (mis. "Gas LPG 12kg")
  if (!hasDirectSuggestionMatch) {
    // 4. Suffix pengali: "tepung x5" atau "tepung x 5"
    const suffixMulMatch = trimmed.match(/^(.+?)\s+[xX*]\s*(\d+(?:[.,]\d+)?)$/) ||
      trimmed.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)[xX]$/);
    if (suffixMulMatch && suffixMulMatch[1].trim()) {
      return {
        itemQuery: suffixMulMatch[1].trim(),
        qty: parseNumericToken(suffixMulMatch[2]),
        unit: null,
        hasInlineModifier: true,
      };
    }

    // 5. Suffix angka + satuan: "gula pasir 3 kg"
    const suffixUnitMatch = trimmed.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)$/);
    if (suffixUnitMatch) {
      const canonicalUnit = UNIT_ALIASES[suffixUnitMatch[3].toLowerCase()];
      if (canonicalUnit && suffixUnitMatch[1].trim()) {
        return {
          itemQuery: suffixUnitMatch[1].trim(),
          qty: parseNumericToken(suffixUnitMatch[2]),
          unit: canonicalUnit,
          hasInlineModifier: true,
        };
      }
    }

    // 6. Suffix angka polos: "telur 5"
    const suffixNumMatch = trimmed.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);
    if (suffixNumMatch) {
      const qty = parseNumericToken(suffixNumMatch[2]);
      const namePart = suffixNumMatch[1].trim();
      if (qty < 1000 && /[a-zA-Z]/.test(namePart)) {
        return {
          itemQuery: namePart,
          qty,
          unit: null,
          hasInlineModifier: true,
        };
      }
    }
  }

  return { itemQuery: trimmed, qty: 1, unit: null, hasInlineModifier: false };
}

function buildItemFromSuggestion(
  s: ItemSuggestion,
  qty = 1,
  unitOverride?: string | null
): PurchaseRequestItemFormData {
  const category = s.category || "Bahan Kue";
  const profile = getCategoryFormProfile(category);
  return {
    item_name: s.item_name,
    qty,
    unit: unitOverride || s.satuan_beli || profile.defaultUnit || "Pcs",
    category,
    estimated_price: s.last_unit_price > 0 ? s.last_unit_price : undefined,
    supplier_name: s.last_supplier && s.last_supplier !== "-" ? s.last_supplier : "-",
    notes: "",
  };
}

function buildQuickItem(
  rawName: string,
  itemSuggestions: ItemSuggestion[],
  qty = 1,
  unitOverride?: string | null
): PurchaseRequestItemFormData {
  const cleanName = rawName.trim();
  const exactMatch = itemSuggestions.find(
    (s) => s.item_name.trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (exactMatch) {
    return buildItemFromSuggestion(exactMatch, qty, unitOverride);
  }
  return {
    item_name: cleanName,
    qty,
    unit: unitOverride || "Pcs",
    category: "Bahan Kue",
    notes: "",
  };
}

function filterQuickSuggestions(query: string, itemSuggestions: ItemSuggestion[]): ItemSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...itemSuggestions]
      .sort((a, b) => (b.tx_count || 0) - (a.tx_count || 0))
      .slice(0, 6);
  }

  return itemSuggestions
    .filter(
      (s) =>
        s.item_name.toLowerCase().includes(q) ||
        (s.aliases && s.aliases.toLowerCase().includes(q))
    )
    .sort((a, b) => {
      const aStarts = a.item_name.toLowerCase().startsWith(q) ? 1 : 0;
      const bStarts = b.item_name.toLowerCase().startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      const aMaster = a.is_master ? 1 : 0;
      const bMaster = b.is_master ? 1 : 0;
      if (aMaster !== bMaster) return bMaster - aMaster;
      return (b.tx_count || 0) - (a.tx_count || 0);
    })
    .slice(0, 8);
}

function mergeShoppingItems(
  currentItems: PurchaseRequestItemFormData[],
  incomingItems: PurchaseRequestItemFormData[]
): PurchaseRequestItemFormData[] {
  const next = currentItems.map((it) => ({ ...it }));
  for (const incoming of incomingItems) {
    const cleanName = incoming.item_name.trim();
    if (!cleanName) continue;
    const existingIdx = next.findIndex(
      (it) =>
        it.item_name.trim().toLowerCase() === cleanName.toLowerCase() &&
        !(it.notes || "").trim() &&
        !(incoming.notes || "").trim()
    );
    if (existingIdx !== -1) {
      next[existingIdx] = {
        ...next[existingIdx],
        qty: Number((next[existingIdx].qty + incoming.qty).toFixed(2)),
      };
    } else {
      next.push({ ...incoming, item_name: cleanName });
    }
  }
  return next;
}

export const PurchaseRequestDrawer: React.FC<PurchaseRequestDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isSubmitting = false,
  itemSuggestions = [],
  recentRequests = [],
  categories = [
    "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor",
    "Kemasan", "Operasional", "Topper & Mainan", "Renovasi"
  ],
  currentUser = "",
}) => {
  const [title, setTitle] = useState("Request Belanja");
  const [urgency, setUrgency] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [requesterName, setRequesterName] = useState(currentUser || "Staf Dapur");
  const [generalNotes, setGeneralNotes] = useState("");
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split("T")[0]);

  // List of items
  const [items, setItems] = useState<PurchaseRequestItemFormData[]>([]);

  // Quick add autocomplete state
  const [quickQuery, setQuickQuery] = useState("");
  const [isQuickDropdownOpen, setIsQuickDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [lastAddedNotice, setLastAddedNotice] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{
    label: string;
    previousItems: PurchaseRequestItemFormData[];
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const quickInputRef = useRef<HTMLInputElement>(null);
  const skipNextFocusOpenRef = useRef(false);
  const blurTimeoutRef = useRef<number | null>(null);

  // Sync initialData and reset quick input state when modal opens/changes
  useEffect(() => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    skipNextFocusOpenRef.current = false;

    if (initialData) {
      setTitle(initialData.title || "Request Belanja");
      setUrgency(initialData.urgency || "NORMAL");
      setRequesterName(initialData.requester_name || currentUser || "Staf Dapur");
      setGeneralNotes(initialData.notes === "-" ? "" : initialData.notes);
      setRequestDate(initialData.request_date || new Date().toISOString().split("T")[0]);

      if (initialData.items && initialData.items.length > 0) {
        setItems(
          initialData.items.map((i) => ({
            id: i.id,
            item_name: i.item_name,
            qty: i.qty,
            unit: i.unit || "Pcs",
            category: i.category || "Bahan Kue",
            estimated_price: i.estimated_price || undefined,
            supplier_name: i.supplier_name || "-",
            notes: i.notes === "-" ? "" : i.notes,
          }))
        );
      } else if (initialData.item_name) {
        setItems([
          {
            item_name: initialData.item_name,
            qty: initialData.qty || 1,
            unit: initialData.unit || "Pcs",
            category: initialData.category || "Bahan Kue",
            estimated_price: initialData.estimated_price || undefined,
            notes: initialData.notes === "-" ? "" : initialData.notes,
          },
        ]);
      } else {
        setItems([]);
      }
    } else {
      setTitle("Request Belanja");
      setUrgency("NORMAL");
      setRequesterName(currentUser || "Staf Dapur");
      setGeneralNotes("");
      setRequestDate(new Date().toISOString().split("T")[0]);
      setItems([]);
    }

    setQuickQuery("");
    setIsQuickDropdownOpen(false);
    setHighlightedIndex(-1);
    setLastAddedNotice(null);
    setUndoState(null);
    setValidationError(null);
  }, [initialData, isOpen, currentUser]);

  const parsedQuickInput = useMemo(
    () => parseInlineQtyAndUnit(quickQuery, itemSuggestions),
    [quickQuery, itemSuggestions]
  );

  const matchedSuggestions = useMemo(
    () => filterQuickSuggestions(parsedQuickInput.itemQuery, itemSuggestions),
    [parsedQuickInput.itemQuery, itemSuggestions]
  );

  const hasExactSuggestionMatch = useMemo(() => {
    const q = parsedQuickInput.itemQuery.trim().toLowerCase();
    if (!q) return false;
    return itemSuggestions.some((s) => s.item_name.trim().toLowerCase() === q);
  }, [parsedQuickInput.itemQuery, itemSuggestions]);

  const quickAddChips = useMemo(() => {
    if (itemSuggestions.length > 0) {
      return [...itemSuggestions]
        .sort((a, b) => (b.tx_count || 0) - (a.tx_count || 0))
        .slice(0, 6)
        .map((s) => s.item_name);
    }
    return getCategoryFormProfile("Bahan Kue").quickItemChips?.slice(0, 6) || [];
  }, [itemSuggestions]);

  const usableRecentRequests = useMemo(
    () =>
      recentRequests
        .filter((r) => (r.items && r.items.length > 0) || Boolean(r.item_name))
        .slice(0, 3),
    [recentRequests]
  );

  const footerSummary = useMemo(() => {
    const validItems = items.filter((i) => i.item_name.trim().length > 0);
    let estimatedTotal = 0;
    let pricedCount = 0;
    const supplierSet = new Set<string>();

    for (const it of validItems) {
      if (it.estimated_price && it.estimated_price > 0) {
        estimatedTotal += it.estimated_price * (it.qty || 1);
        pricedCount += 1;
      }
      const sup = (it.supplier_name || "").trim();
      if (sup && sup !== "-") {
        supplierSet.add(sup);
      }
    }

    return {
      totalItems: validItems.length,
      estimatedTotal,
      pricedCount,
      suppliers: Array.from(supplierSet),
    };
  }, [items]);

  const focusQuickInput = (openDropdownOnFocus = false) => {
    if (!openDropdownOnFocus && document.activeElement !== quickInputRef.current) {
      skipNextFocusOpenRef.current = true;
    }
    quickInputRef.current?.focus();
    requestAnimationFrame(() => {
      if (!openDropdownOnFocus && document.activeElement !== quickInputRef.current) {
        skipNextFocusOpenRef.current = true;
      }
      quickInputRef.current?.focus();
    });
  };

  const addItemToShoppingList = (nextItem: PurchaseRequestItemFormData) => {
    const cleanName = nextItem.item_name.trim();
    if (!cleanName) return;

    const existingIdx = items.findIndex(
      (it) =>
        it.item_name.trim().toLowerCase() === cleanName.toLowerCase() &&
        !(it.notes || "").trim()
    );

    if (existingIdx !== -1) {
      const current = items[existingIdx];
      const nextQty = Number((current.qty + nextItem.qty).toFixed(2));
      setItems((prev) => {
        const updated = [...prev];
        if (updated[existingIdx]) {
          updated[existingIdx] = {
            ...updated[existingIdx],
            qty: Number((updated[existingIdx].qty + nextItem.qty).toFixed(2)),
          };
        }
        return updated;
      });
      setLastAddedNotice(`Jumlah diperbarui: ${current.item_name} (${nextQty} ${current.unit})`);
    } else {
      setItems((prev) => [...prev, { ...nextItem, item_name: cleanName }]);
      setLastAddedNotice(`Masuk daftar: ${cleanName} (${nextItem.qty} ${nextItem.unit})`);
    }

    setUndoState(null);
    setValidationError(null);
    setQuickQuery("");
    setHighlightedIndex(-1);
    setIsQuickDropdownOpen(false);
    focusQuickInput();
  };

  const handleApplyRecentRequest = (req: PurchaseRequest) => {
    const sourceItems: PurchaseRequestItemFormData[] =
      req.items && req.items.length > 0
        ? req.items.map((i) => {
            const matched = itemSuggestions.find(
              (s) => s.item_name.trim().toLowerCase() === i.item_name.trim().toLowerCase()
            );
            return {
              item_name: i.item_name,
              qty: i.qty || 1,
              unit: i.unit || matched?.satuan_beli || "Pcs",
              category: i.category || matched?.category || "Bahan Kue",
              estimated_price:
                i.estimated_price ||
                (matched && matched.last_unit_price > 0 ? matched.last_unit_price : undefined),
              supplier_name:
                i.supplier_name && i.supplier_name !== "-"
                  ? i.supplier_name
                  : matched?.last_supplier && matched.last_supplier !== "-"
                  ? matched.last_supplier
                  : "-",
              notes: i.notes && i.notes !== "-" ? i.notes : "",
            };
          })
        : req.item_name
        ? [
            buildQuickItem(
              req.item_name,
              itemSuggestions,
              req.qty || 1,
              req.unit || undefined
            ),
          ]
        : [];

    if (sourceItems.length === 0) return;

    const previousSnapshot = items.map((it) => ({ ...it }));
    setItems((prev) => mergeShoppingItems(prev, sourceItems));
    setUndoState({
      label: `Diisi ${sourceItems.length} barang dari "${req.title || "Belanja Rutin"}"`,
      previousItems: previousSnapshot,
    });
    setLastAddedNotice(null);
    setValidationError(null);
    focusQuickInput();
  };

  const handleUndo = () => {
    if (!undoState) return;
    setItems(undoState.previousItems);
    setUndoState(null);
    setLastAddedNotice("Perubahan dikembalikan.");
    focusQuickInput();
  };

  const handleQuickAddAction = () => {
    if (isQuickDropdownOpen && highlightedIndex >= 0 && matchedSuggestions[highlightedIndex]) {
      addItemToShoppingList(
        buildItemFromSuggestion(
          matchedSuggestions[highlightedIndex],
          parsedQuickInput.qty,
          parsedQuickInput.unit
        )
      );
      return;
    }
    if (parsedQuickInput.itemQuery.length > 0) {
      addItemToShoppingList(
        buildQuickItem(
          parsedQuickInput.itemQuery,
          itemSuggestions,
          parsedQuickInput.qty,
          parsedQuickInput.unit
        )
      );
      return;
    }
    focusQuickInput();
  };

  const submitCurrentRequest = () => {
    if (isSubmitting) return;

    const validItems = items.filter((i) => i.item_name.trim().length > 0);
    if (validItems.length === 0) {
      setValidationError("Tambahkan minimal 1 barang ke daftar belanja sebelum mengirim.");
      focusQuickInput();
      return;
    }

    const payload: PurchaseRequestFormData = {
      title: title.trim() || "Request Belanja",
      urgency,
      requester_name: requesterName.trim() || "Staf Toko",
      notes: generalNotes.trim() || "-",
      request_date: requestDate,
      items: validItems,
      // Fallback ringkasan single-item untuk kompatibilitas
      item_name: validItems[0].item_name,
      qty: validItems[0].qty,
      unit: validItems[0].unit,
      category: validItems[0].category,
    };

    onSubmit(payload, initialData?.id);
  };

  const handleQuickKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submitCurrentRequest();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isQuickDropdownOpen) {
        setIsQuickDropdownOpen(true);
        setHighlightedIndex(matchedSuggestions.length > 0 ? 0 : -1);
        return;
      }
      if (matchedSuggestions.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % matchedSuggestions.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isQuickDropdownOpen) {
        setIsQuickDropdownOpen(true);
        setHighlightedIndex(matchedSuggestions.length - 1);
        return;
      }
      if (matchedSuggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev <= 0 ? matchedSuggestions.length - 1 : prev - 1
        );
      }
      return;
    }

    if (e.key === "Escape") {
      if (isQuickDropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsQuickDropdownOpen(false);
        setHighlightedIndex(-1);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleQuickAddAction();
    }
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitCurrentRequest();
    }
  };

  const handleRemoveItemRow = (idx: number) => {
    const target = items[idx];
    const previousSnapshot = items.map((it) => ({ ...it }));
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setUndoState({
      label: `Dihapus: ${target?.item_name || `baris ${idx + 1}`}`,
      previousItems: previousSnapshot,
    });
    setLastAddedNotice(null);
  };

  const handleUpdateItem = (idx: number, field: keyof PurchaseRequestItemFormData, val: any) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: val };
      return updated;
    });
  };

  const handleStepQty = (idx: number, delta: number) => {
    setItems((prev) => {
      const updated = [...prev];
      const nextQty = Math.max(0.1, Number((updated[idx].qty + delta).toFixed(2)));
      updated[idx] = { ...updated[idx], qty: nextQty };
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCurrentRequest();
  };

  const showQuickDropdown =
    isQuickDropdownOpen &&
    (matchedSuggestions.length > 0 || parsedQuickInput.itemQuery.length > 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          if (!initialData) {
            e.preventDefault();
            focusQuickInput();
          }
        }}
        className="w-[calc(100vw-1rem)] sm:w-[95vw] sm:max-w-3xl lg:max-w-5xl max-h-[94dvh] flex flex-col p-0 overflow-hidden bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl sm:rounded-3xl"
      >
        <DialogHeader className="px-4 sm:px-6 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 shrink-0 text-left">
          <div className="flex items-center gap-3 pr-7">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center font-bold shrink-0">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {initialData ? "Edit Daftar Belanja" : "Listing Request Belanja"}
              </DialogTitle>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Catat beberapa barang kebutuhan dapur atau toko dalam 1 pengajuan untuk diteruskan ke Purchasing.
              </p>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            {/* Header Data: Judul, Pemohon, Urgensi & Catatan Umum */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 bg-zinc-50/70 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200/80 dark:border-zinc-800">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-zinc-500" /> Keperluan / Judul
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Mis: Bahan Roti Manis / Stok Mingguan"
                  className="h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-zinc-500" /> Pemohon (Staf/Bagian)
                </label>
                <Input
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Misal: Dapur / Siti"
                  className="h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" /> Tingkat Urgensi
                </label>
                <div className="grid grid-cols-2 gap-1.5 h-11 sm:h-10">
                  <button
                    type="button"
                    onClick={() => setUrgency("NORMAL")}
                    className={`rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                      urgency === "NORMAL"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                    <span>Biasa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgency("URGENT")}
                    className={`rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                      urgency === "URGENT"
                        ? "border-rose-600 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 ring-1 ring-rose-500"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-600" />
                    <span>Urgent</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                  Catatan Pengajuan (Opsional)
                </label>
                <Input
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Mis: Untuk produksi akhir pekan..."
                  className="h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                />
              </div>
            </div>

            {/* Quick Add Form: 1 Input Autocomplete + Smart Qty/Satuan + Enter -> Fokus Tetap di Input */}
            <div className="p-3.5 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="quick-item-autocomplete"
                  className="text-xs font-bold text-zinc-900 dark:text-zinc-100"
                >
                  Quick Add Daftar Belanja
                </label>
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
                  Enter masuk daftar, Ctrl/⌘+Enter kirim
                </span>
              </div>

              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search
                      className="w-4 h-4 text-zinc-500 dark:text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <Input
                      id="quick-item-autocomplete"
                      ref={quickInputRef}
                      type="text"
                      role="combobox"
                      aria-expanded={showQuickDropdown}
                      aria-autocomplete="list"
                      aria-controls="quick-item-listbox"
                      aria-activedescendant={
                        highlightedIndex >= 0 && matchedSuggestions[highlightedIndex]
                          ? `quick-suggestion-${highlightedIndex}`
                          : undefined
                      }
                      value={quickQuery}
                      onChange={(e) => {
                        setQuickQuery(e.target.value);
                        setIsQuickDropdownOpen(true);
                        setHighlightedIndex(-1);
                        if (validationError) setValidationError(null);
                      }}
                      onFocus={() => {
                        if (blurTimeoutRef.current !== null) {
                          window.clearTimeout(blurTimeoutRef.current);
                          blurTimeoutRef.current = null;
                        }
                        if (skipNextFocusOpenRef.current) {
                          skipNextFocusOpenRef.current = false;
                          return;
                        }
                        setIsQuickDropdownOpen(true);
                      }}
                      onBlur={() => {
                        blurTimeoutRef.current = window.setTimeout(() => {
                          setIsQuickDropdownOpen(false);
                          setHighlightedIndex(-1);
                          blurTimeoutRef.current = null;
                        }, 150);
                      }}
                      onKeyDown={handleQuickKeyDown}
                      placeholder='Ketik barang atau qty (mis. "3 kg gula pasir", "tepung x5") + Enter...'
                      className="h-11 sm:h-10 pl-9 pr-9 text-xs sm:text-sm rounded-xl bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 font-medium text-zinc-900 dark:text-zinc-100 focus-visible:ring-amber-600"
                    />
                    {quickQuery.length > 0 && (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Hapus kata pencarian"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuickQuery("");
                          setHighlightedIndex(-1);
                          setIsQuickDropdownOpen(true);
                          focusQuickInput();
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <Button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleQuickAddAction}
                    disabled={!parsedQuickInput.itemQuery && highlightedIndex < 0}
                    className="h-11 sm:h-10 px-4 text-xs font-semibold bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-xl shrink-0 flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah</span>
                  </Button>
                </div>

                {/* Autocomplete Dropdown */}
                {showQuickDropdown && (
                  <div
                    id="quick-item-listbox"
                    role="listbox"
                    className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-64 overflow-y-auto py-1 divide-y divide-zinc-100 dark:divide-zinc-800"
                  >
                    {parsedQuickInput.hasInlineModifier && parsedQuickInput.itemQuery && (
                      <div className="px-3.5 py-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50/90 dark:bg-amber-950/50 flex items-center justify-between gap-2">
                        <span>
                          Qty terdeteksi: {parsedQuickInput.qty}{" "}
                          {parsedQuickInput.unit ? parsedQuickInput.unit : "(sesuai satuan barang)"}
                        </span>
                        <span className="truncate">Cari: "{parsedQuickInput.itemQuery}"</span>
                      </div>
                    )}

                    {matchedSuggestions.map((s, sIdx) => {
                      const isHighlighted = highlightedIndex === sIdx;
                      const previewUnit = parsedQuickInput.unit || s.satuan_beli || "Pcs";
                      return (
                        <button
                          key={`${s.item_name}-${s.is_master}-${sIdx}`}
                          id={`quick-suggestion-${sIdx}`}
                          role="option"
                          aria-selected={isHighlighted}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            addItemToShoppingList(
                              buildItemFromSuggestion(
                                s,
                                parsedQuickInput.qty,
                                parsedQuickInput.unit
                              )
                            )
                          }
                          className={`w-full text-left px-3.5 py-2.5 min-h-[44px] text-xs flex items-center justify-between gap-2 transition-colors ${
                            isHighlighted
                              ? "bg-amber-100 dark:bg-amber-950/70"
                              : "hover:bg-amber-50 dark:hover:bg-amber-950/30"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {s.item_name}
                              {parsedQuickInput.hasInlineModifier && (
                                <span className="ml-1.5 font-semibold text-amber-800 dark:text-amber-300">
                                  ({parsedQuickInput.qty} {previewUnit})
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                              {s.category || "Bahan Kue"} • {s.satuan_beli || "Pcs"}
                              {s.last_supplier && s.last_supplier !== "-" ? ` • Biasa di: ${s.last_supplier}` : ""}
                            </p>
                          </div>
                          {s.last_unit_price > 0 && (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                              ~{formatRupiah(s.last_unit_price * parsedQuickInput.qty)}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {parsedQuickInput.itemQuery.length > 0 && !hasExactSuggestionMatch && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                          addItemToShoppingList(
                            buildQuickItem(
                              parsedQuickInput.itemQuery,
                              itemSuggestions,
                              parsedQuickInput.qty,
                              parsedQuickInput.unit
                            )
                          )
                        }
                        className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-xs bg-zinc-50/80 dark:bg-zinc-950/60 hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                          + Tambah "{parsedQuickInput.itemQuery}" ({parsedQuickInput.qty}{" "}
                          {parsedQuickInput.unit || "Pcs"}) sebagai barang baru
                        </span>
                        <span className="text-[11px] text-zinc-600 dark:text-zinc-400 shrink-0">
                          Enter
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Chips untuk sekali tap tanpa mengetik */}
              {quickAddChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mr-1">
                    Sering dibeli:
                  </span>
                  {quickAddChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addItemToShoppingList(buildQuickItem(chip, itemSuggestions))}
                      className="min-h-[36px] sm:min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-zinc-900 border border-amber-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              )}

              {/* Isi Cepat dari Request Sebelumnya (Belanja Rutin) */}
              {!initialData && usableRecentRequests.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-amber-200/70 dark:border-amber-900/40">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 mr-1">
                    Belanja rutin:
                  </span>
                  {usableRecentRequests.map((req) => {
                    const itemCount = req.items?.length || (req.item_name ? 1 : 0);
                    return (
                      <button
                        key={req.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleApplyRecentRequest(req)}
                        className="min-h-[36px] sm:min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-100/80 dark:bg-zinc-900 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-300 hover:bg-amber-200/80 dark:hover:bg-amber-950/60 transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                      >
                        <RotateCcw className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>
                          {req.title || "Request Belanja"} ({itemCount} item)
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Feedback & Undo bar */}
              {undoState && (
                <div
                  aria-live="polite"
                  className="text-xs font-medium text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                >
                  <span>{undoState.label}</span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleUndo}
                    className="inline-flex items-center gap-1 font-bold text-amber-800 dark:text-amber-300 hover:underline px-2 py-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    Urungkan
                  </button>
                </div>
              )}

              {lastAddedNotice && !undoState && (
                <p
                  aria-live="polite"
                  className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{lastAddedNotice}</span>
                </p>
              )}

              {validationError && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl px-3 py-2 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{validationError}</span>
                </p>
              )}
            </div>

            {/* List Item Belanja */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span>Daftar Barang Belanjaan</span>
                  <Badge variant="outline" className="text-[11px] px-2 py-0.5 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                    {items.length} Item
                  </Badge>
                </span>
              </div>

              {items.length === 0 ? (
                <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl p-6 text-center bg-zinc-50/50 dark:bg-zinc-900/30 space-y-1">
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Daftar belanja masih kosong.
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Ketik nama barang (atau qty + satuan) di kolom Quick Add di atas lalu tekan Enter, atau pilih dari Belanja Rutin.
                  </p>
                </div>
              ) : (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800/80 bg-white dark:bg-zinc-900">
                  {items.map((item, idx) => {
                    const rowProfile = getCategoryFormProfile(item.category || "Bahan Kue");
                    const baseUnits = rowProfile.allowedUnits || COMMON_UNITS;
                    const rowUnits = baseUnits.includes(item.unit)
                      ? baseUnits
                      : [item.unit, ...baseUnits];

                    return (
                      <div key={idx} className="p-3 sm:p-3.5 space-y-2 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/60 transition-colors">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          {/* Nomor & Nama Barang */}
                          <div className="col-span-10 sm:col-span-5 flex items-center gap-2 min-w-0">
                            <span className="w-5 text-center text-xs font-mono font-bold text-zinc-500 shrink-0">
                              {idx + 1}.
                            </span>
                            <Input
                              value={item.item_name}
                              onChange={(e) => handleUpdateItem(idx, "item_name", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
                              }}
                              aria-label={`Nama barang baris ${idx + 1}`}
                              className="h-11 sm:h-9 text-xs rounded-xl bg-white dark:bg-zinc-950 border-zinc-300 dark:border-zinc-700 font-semibold"
                            />
                          </div>

                          {/* Tombol Hapus pada Mobile */}
                          <div className="col-span-2 sm:hidden flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus ${item.item_name || `baris ${idx + 1}`}`}
                              onClick={() => handleRemoveItemRow(idx)}
                              className="h-11 w-11 p-0 text-zinc-500 hover:text-rose-700 rounded-xl"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>

                          {/* Kategori */}
                          <div className="col-span-12 sm:col-span-3">
                            <select
                              aria-label={`Kategori ${item.item_name}`}
                              value={item.category || "Bahan Kue"}
                              onChange={(e) => {
                                const nextCat = e.target.value;
                                const nextProf = getCategoryFormProfile(nextCat);
                                handleUpdateItem(idx, "category", nextCat);
                                if (nextProf.defaultUnit) {
                                  handleUpdateItem(idx, "unit", nextProf.defaultUnit);
                                }
                              }}
                              className="w-full h-11 sm:h-9 px-2.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-xl font-semibold text-zinc-800 dark:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                            >
                              {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Qty Stepper */}
                          <div className="col-span-6 sm:col-span-2 flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Kurangi jumlah ${item.item_name}`}
                              onClick={() => handleStepQty(idx, -1)}
                              className="h-11 sm:h-9 w-9 p-0 rounded-xl shrink-0 border-zinc-300 dark:border-zinc-700"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </Button>
                            <Input
                              type="number"
                              step="any"
                              min="0.1"
                              aria-label={`Jumlah ${item.item_name}`}
                              value={item.qty}
                              onChange={(e) =>
                                handleUpdateItem(idx, "qty", parseFloat(e.target.value) || 1)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
                              }}
                              className="h-11 sm:h-9 px-1.5 text-xs rounded-xl text-center font-bold tabular-nums"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Tambah jumlah ${item.item_name}`}
                              onClick={() => handleStepQty(idx, 1)}
                              className="h-11 sm:h-9 w-9 p-0 rounded-xl shrink-0 border-zinc-300 dark:border-zinc-700"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>

                          {/* Satuan & Hapus Desktop */}
                          <div className="col-span-6 sm:col-span-2 flex items-center gap-1.5">
                            <select
                              aria-label={`Satuan ${item.item_name}`}
                              value={item.unit}
                              onChange={(e) => handleUpdateItem(idx, "unit", e.target.value)}
                              className="w-full h-11 sm:h-9 px-2 text-xs bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-xl font-semibold text-zinc-800 dark:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                            >
                              {rowUnits.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus ${item.item_name || `baris ${idx + 1}`}`}
                              onClick={() => handleRemoveItemRow(idx)}
                              className="hidden sm:inline-flex h-9 w-9 p-0 text-zinc-500 hover:text-rose-700 rounded-xl shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Catatan / Keterangan per Item */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:pl-7">
                          <Input
                            value={item.notes || ""}
                            onChange={(e) => handleUpdateItem(idx, "notes", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
                            }}
                            placeholder={
                              rowProfile.notesPlaceholder ||
                              "Catatan tambahan (merek, ukuran kemasan, spesifikasi)..."
                            }
                            className="h-9 text-xs rounded-xl bg-zinc-50/70 dark:bg-zinc-950/70 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
                          />
                          {item.supplier_name && item.supplier_name !== "-" && (
                            <Badge variant="outline" className="text-[11px] shrink-0 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700">
                              Toko: {item.supplier_name}
                            </Badge>
                          )}
                          {item.estimated_price && item.estimated_price > 0 && (
                            <Badge variant="outline" className="text-[11px] shrink-0 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900 tabular-nums">
                              ~{formatRupiah(item.estimated_price * (item.qty || 1))}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sticky Footer Submit */}
          <div className="px-4 sm:px-6 py-3 border-t border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/80 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>
                Total <strong>{footerSummary.totalItems}</strong> barang
              </span>
              {footerSummary.estimatedTotal > 0 && (
                <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  Est. ~{formatRupiah(footerSummary.estimatedTotal)}
                  {footerSummary.pricedCount < footerSummary.totalItems && (
                    <span className="font-normal text-zinc-600 dark:text-zinc-400 ml-1">
                      ({footerSummary.pricedCount}/{footerSummary.totalItems} ada harga)
                    </span>
                  )}
                </span>
              )}
              {footerSummary.suppliers.length > 0 && (
                <span
                  title={footerSummary.suppliers.join(", ")}
                  className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300"
                >
                  <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {footerSummary.suppliers.length === 1
                    ? footerSummary.suppliers[0]
                    : `${footerSummary.suppliers.length} supplier`}
                </span>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="h-11 sm:h-10 px-4 text-xs font-semibold rounded-xl"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-11 sm:h-10 px-5 text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white rounded-xl shadow-xs flex items-center gap-2"
              >
                <span>{isSubmitting ? "Menyimpan..." : "Kirim Daftar Belanja"}</span>
                {!isSubmitting && (
                  <kbd className="hidden sm:inline-block text-[10px] font-mono bg-amber-800/80 text-amber-50 px-1.5 py-0.5 rounded">
                    Ctrl/⌘+↵
                  </kbd>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
