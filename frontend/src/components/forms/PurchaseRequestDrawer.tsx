import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  PurchaseRequest,
  PurchaseRequestFormData,
  PurchaseRequestItemFormData,
  ItemSuggestion,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { formatRupiah } from "@/lib/formatters";
import { getCategoryFormProfile } from "@/lib/categoryFormConfig";
import {
  Plus,
  Minus,
  Trash2,
  Search,
  AlertCircle,
  X,
  CornerDownLeft,
  CheckCircle2,
  RotateCcw,
  Store,
  Save,
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

  const prefixMulMatch =
    trimmed.match(/^(\d+(?:[.,]\d+)?)\s*[xX*]\s+(.+)$/) ||
    trimmed.match(/^(\d+(?:[.,]\d+)?)[xX]\s+(.+)$/);
  if (prefixMulMatch && prefixMulMatch[2].trim()) {
    return {
      itemQuery: prefixMulMatch[2].trim(),
      qty: parseNumericToken(prefixMulMatch[1]),
      unit: null,
      hasInlineModifier: true,
    };
  }

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

  if (!hasDirectSuggestionMatch) {
    const suffixMulMatch =
      trimmed.match(/^(.+?)\s+[xX*]\s*(\d+(?:[.,]\d+)?)$/) ||
      trimmed.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)[xX]$/);
    if (suffixMulMatch && suffixMulMatch[1].trim()) {
      return {
        itemQuery: suffixMulMatch[1].trim(),
        qty: parseNumericToken(suffixMulMatch[2]),
        unit: null,
        hasInlineModifier: true,
      };
    }

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

function filterQuickSuggestions(
  query: string,
  itemSuggestions: ItemSuggestion[]
): ItemSuggestion[] {
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

export const PurchaseRequestDrawer: React.FC<PurchaseRequestDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isSubmitting = false,
  itemSuggestions = [],
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
  const [requestDate, setRequestDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const [items, setItems] = useState<PurchaseRequestItemFormData[]>([]);

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
      setRequestDate(
        initialData.request_date || new Date().toISOString().split("T")[0]
      );

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
      } else if (
        initialData.item_name &&
        initialData.item_name !== "Draft Belanja"
      ) {
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
      setLastAddedNotice(
        `Jumlah diperbarui: ${current.item_name} (${nextQty} ${current.unit})`
      );
    } else {
      setItems((prev) => [...prev, { ...nextItem, item_name: cleanName }]);
      setLastAddedNotice(
        `Masuk daftar: ${cleanName} (${nextItem.qty} ${nextItem.unit})`
      );
    }

    setUndoState(null);
    setValidationError(null);
    setQuickQuery("");
    setHighlightedIndex(-1);
    setIsQuickDropdownOpen(false);
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
    if (
      isQuickDropdownOpen &&
      highlightedIndex >= 0 &&
      matchedSuggestions[highlightedIndex]
    ) {
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

  const submitCurrentRequest = (
    targetStatus: "DRAFT" | "PENDING" = "PENDING"
  ) => {
    if (isSubmitting) return;

    const validItems = items.filter((i) => i.item_name.trim().length > 0);
    if (targetStatus === "PENDING" && validItems.length === 0) {
      setValidationError(
        "Tambahkan minimal 1 barang ke daftar belanja sebelum mengirim."
      );
      focusQuickInput();
      return;
    }

    const hasDraftMetadata =
      (title.trim().length > 0 && title.trim() !== "Request Belanja") ||
      generalNotes.trim().length > 0;
    if (
      targetStatus === "DRAFT" &&
      validItems.length === 0 &&
      !hasDraftMetadata
    ) {
      setValidationError(
        "Isi judul khusus, catatan, atau tambahkan minimal 1 barang untuk menyimpan draft."
      );
      focusQuickInput();
      return;
    }

    const firstItem = validItems[0];
    const payload: PurchaseRequestFormData = {
      title: title.trim() || "Request Belanja",
      urgency,
      requester_name: requesterName.trim() || "Staf Toko",
      notes: generalNotes.trim() || "-",
      request_date: requestDate,
      status: targetStatus,
      items: validItems,
      item_name: firstItem ? firstItem.item_name : "Draft Belanja",
      qty: firstItem ? firstItem.qty : 1,
      unit: firstItem ? firstItem.unit : "Pcs",
      category: firstItem ? firstItem.category : undefined,
    };

    onSubmit(
      payload,
      initialData?.id && initialData.id > 0 ? initialData.id : undefined
    );
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
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === "Enter" &&
      !e.nativeEvent.isComposing
    ) {
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

  const handleUpdateItem = (
    idx: number,
    field: keyof PurchaseRequestItemFormData,
    val: any
  ) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: val };
      return updated;
    });
  };

  const handleStepQty = (idx: number, delta: number) => {
    setItems((prev) => {
      const updated = [...prev];
      const nextQty = Math.max(
        0.1,
        Number((updated[idx].qty + delta).toFixed(2))
      );
      updated[idx] = { ...updated[idx], qty: nextQty };
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCurrentRequest("PENDING");
  };

  const isEditingExisting = Boolean(initialData?.id && initialData.id > 0);
  const isEditingDraft = isEditingExisting && initialData?.status === "DRAFT";
  const canSaveAsDraft = !isEditingExisting || isEditingDraft;
  const primarySubmitLabel =
    isEditingExisting && !isEditingDraft
      ? "Simpan Perubahan"
      : "Kirim Daftar Belanja";
  const showQuickDropdown =
    isQuickDropdownOpen &&
    (matchedSuggestions.length > 0 || parsedQuickInput.itemQuery.length > 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          if (!isEditingExisting) {
            e.preventDefault();
            focusQuickInput();
          }
        }}
        className="w-[calc(100vw-1rem)] sm:w-[95vw] sm:max-w-3xl lg:max-w-5xl max-h-[94dvh] flex flex-col p-0 overflow-hidden bg-background border-border shadow-xl rounded-xl"
      >
        <DialogHeader className="px-4 sm:px-6 py-3.5 border-b border-border/80 bg-background shrink-0 text-left">
          <div className="pr-7">
            <div className="flex items-center gap-2 flex-wrap">
              <DialogTitle className="text-base font-bold tracking-tight text-foreground">
                {isEditingDraft
                  ? "Edit Draft Belanja"
                  : isEditingExisting
                  ? "Edit Daftar Belanja"
                  : "Listing Request Belanja"}
              </DialogTitle>
              {isEditingDraft && (
                <Badge variant="outline" className="text-[11px]">
                  Draft
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Catat beberapa barang kebutuhan dapur atau toko dalam 1 pengajuan untuk diteruskan ke Purchasing.
            </p>
          </div>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
            {/* Header Data: Judul, Pemohon, Urgensi & Catatan Umum (Flat Hairline Section) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pb-4 border-b border-border/70">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Keperluan / Judul
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Mis: Bahan Roti Manis / Stok Mingguan"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Pemohon (Staf/Bagian)
                </label>
                <Input
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Misal: Dapur / Siti"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Tingkat Urgensi
                </label>
                <AdaptiveSelect
                  value={urgency}
                  onValueChange={(val) =>
                    setUrgency(val as "NORMAL" | "URGENT")
                  }
                  options={[
                    { value: "NORMAL", label: "Biasa (Normal)" },
                    { value: "URGENT", label: "Urgent / Mendesak" },
                  ]}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Catatan Pengajuan (Opsional)
                </label>
                <Input
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Mis: Untuk produksi akhir pekan..."
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Quick Add Bar using ReUI InputGroup (Zero Nested Card & Zero Quick Pick Chips) */}
            <div className="space-y-2 pb-4 border-b border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="quick-item-autocomplete"
                  className="text-xs font-semibold text-foreground"
                >
                  Tambah Barang ke Daftar Belanja
                </label>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
                  Enter masuk daftar, Ctrl/⌘+Enter kirim
                </span>
              </div>

              <div className="relative">
                <InputGroup className="h-10">
                  <InputGroupAddon align="inline-start" className="pl-3 pr-1">
                    <Search className="size-4 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="quick-item-autocomplete"
                    ref={quickInputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={showQuickDropdown}
                    aria-autocomplete="list"
                    aria-controls="quick-item-listbox"
                    aria-activedescendant={
                      highlightedIndex >= 0 &&
                      matchedSuggestions[highlightedIndex]
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
                    className="text-xs sm:text-sm"
                  />
                  {quickQuery.length > 0 && (
                    <InputGroupAddon align="inline-end" className="pr-1">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="Hapus kata pencarian"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuickQuery("");
                          setHighlightedIndex(-1);
                          setIsQuickDropdownOpen(true);
                          focusQuickInput();
                        }}
                      >
                        <X className="size-3.5" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                  <InputGroupAddon align="inline-end" className="pr-1.5">
                    <InputGroupButton
                      size="sm"
                      variant="default"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleQuickAddAction}
                      disabled={
                        !parsedQuickInput.itemQuery && highlightedIndex < 0
                      }
                      className="h-7 px-3 text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah</span>
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>

                {/* Autocomplete Dropdown */}
                {showQuickDropdown && (
                  <div
                    id="quick-item-listbox"
                    role="listbox"
                    className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto py-1 divide-y divide-border/50"
                  >
                    {parsedQuickInput.hasInlineModifier &&
                      parsedQuickInput.itemQuery && (
                        <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground bg-muted/40 flex items-center justify-between gap-2">
                          <span>
                            Qty terdeteksi: {parsedQuickInput.qty}{" "}
                            {parsedQuickInput.unit
                              ? parsedQuickInput.unit
                              : "(sesuai satuan barang)"}
                          </span>
                          <span className="truncate">
                            Cari: &quot;{parsedQuickInput.itemQuery}&quot;
                          </span>
                        </div>
                      )}

                    {matchedSuggestions.map((s, sIdx) => {
                      const isHighlighted = highlightedIndex === sIdx;
                      const previewUnit =
                        parsedQuickInput.unit || s.satuan_beli || "Pcs";
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
                          className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                            isHighlighted ? "bg-accent" : "hover:bg-accent/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {s.item_name}
                              {parsedQuickInput.hasInlineModifier && (
                                <span className="ml-1.5 font-semibold text-blue-600 dark:text-blue-400">
                                  ({parsedQuickInput.qty} {previewUnit})
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {s.category || "Bahan Kue"} •{" "}
                              {s.satuan_beli || "Pcs"}
                              {s.last_supplier && s.last_supplier !== "-"
                                ? ` • Biasa di: ${s.last_supplier}`
                                : ""}
                            </p>
                          </div>
                          {s.last_unit_price > 0 && (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                              ~
                              {formatRupiah(
                                s.last_unit_price * parsedQuickInput.qty
                              )}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {parsedQuickInput.itemQuery.length > 0 &&
                      !hasExactSuggestionMatch && (
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
                          className="w-full text-left px-3 py-2 text-xs hover:bg-accent/60 flex items-center justify-between gap-2"
                        >
                          <span className="font-medium text-foreground">
                            + Tambah &quot;{parsedQuickInput.itemQuery}&quot; (
                            {parsedQuickInput.qty}{" "}
                            {parsedQuickInput.unit || "Pcs"}) sebagai barang baru
                          </span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            Enter
                          </span>
                        </button>
                      )}
                  </div>
                )}
              </div>

              {/* Feedback & Undo bar */}
              {undoState && (
                <div
                  aria-live="polite"
                  className="text-xs text-foreground flex items-center justify-between gap-2 pt-1"
                >
                  <span>{undoState.label}</span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleUndo}
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    Urungkan
                  </button>
                </div>
              )}

              {lastAddedNotice && !undoState && (
                <p
                  aria-live="polite"
                  className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{lastAddedNotice}</span>
                </p>
              )}

              {validationError && (
                <p
                  role="alert"
                  className="text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{validationError}</span>
                </p>
              )}
            </div>

            {/* List Item Belanja (Flat Hairline Ledger Rows) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                  <span>Daftar Barang Belanjaan</span>
                  <Badge variant="outline" className="text-[11px] px-2 py-0">
                    {items.length} Item
                  </Badge>
                </span>
              </div>

              {items.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-6 text-center space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Daftar belanja masih kosong.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ketik nama barang (atau qty + satuan) di kolom pencarian di atas lalu tekan Enter.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/70 border-y border-border/70">
                  {items.map((item, idx) => {
                    const rowProfile = getCategoryFormProfile(
                      item.category || "Bahan Kue"
                    );
                    const baseUnits = rowProfile.allowedUnits || COMMON_UNITS;
                    const rowUnits = baseUnits.includes(item.unit)
                      ? baseUnits
                      : [item.unit, ...baseUnits];

                    return (
                      <div key={idx} className="py-3 space-y-2">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          {/* Nomor & Nama Barang */}
                          <div className="col-span-10 sm:col-span-5 flex items-center gap-2 min-w-0">
                            <span className="w-5 text-center text-xs font-mono text-muted-foreground shrink-0">
                              {idx + 1}.
                            </span>
                            <Input
                              value={item.item_name}
                              onChange={(e) =>
                                handleUpdateItem(
                                  idx,
                                  "item_name",
                                  e.target.value
                                )
                              }
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  !e.metaKey &&
                                  !e.ctrlKey
                                )
                                  e.preventDefault();
                              }}
                              aria-label={`Nama barang baris ${idx + 1}`}
                              className="h-9 text-xs font-medium"
                            />
                          </div>

                          {/* Tombol Hapus pada Mobile */}
                          <div className="col-span-2 sm:hidden flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus ${
                                item.item_name || `baris ${idx + 1}`
                              }`}
                              onClick={() => handleRemoveItemRow(idx)}
                              className="h-9 w-9 p-0 text-muted-foreground hover:text-rose-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>

                          {/* Kategori (Shadcn AdaptiveSelect) */}
                          <div className="col-span-12 sm:col-span-3">
                            <AdaptiveSelect
                              aria-label={`Kategori ${item.item_name}`}
                              value={item.category || "Bahan Kue"}
                              onValueChange={(nextCat) => {
                                const nextProf =
                                  getCategoryFormProfile(nextCat);
                                handleUpdateItem(idx, "category", nextCat);
                                if (nextProf.defaultUnit) {
                                  handleUpdateItem(
                                    idx,
                                    "unit",
                                    nextProf.defaultUnit
                                  );
                                }
                              }}
                              options={categories}
                              placeholder="Kategori..."
                              searchPlaceholder="Cari kategori..."
                            />
                          </div>

                          {/* Qty Stepper (ReUI InputGroup) */}
                          <div className="col-span-6 sm:col-span-2">
                            <InputGroup className="h-9">
                              <InputGroupAddon
                                align="inline-start"
                                className="pl-1 pr-0"
                              >
                                <InputGroupButton
                                  size="icon-xs"
                                  aria-label={`Kurangi jumlah ${item.item_name}`}
                                  onClick={() => handleStepQty(idx, -1)}
                                >
                                  <Minus className="size-3" />
                                </InputGroupButton>
                              </InputGroupAddon>
                              <InputGroupInput
                                type="number"
                                step="any"
                                min="0.1"
                                aria-label={`Jumlah ${item.item_name}`}
                                value={item.qty}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    idx,
                                    "qty",
                                    parseFloat(e.target.value) || 1
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "Enter" &&
                                    !e.metaKey &&
                                    !e.ctrlKey
                                  )
                                    e.preventDefault();
                                }}
                                className="px-1 text-xs text-center font-semibold tabular-nums"
                              />
                              <InputGroupAddon
                                align="inline-end"
                                className="pr-1 pl-0"
                              >
                                <InputGroupButton
                                  size="icon-xs"
                                  aria-label={`Tambah jumlah ${item.item_name}`}
                                  onClick={() => handleStepQty(idx, 1)}
                                >
                                  <Plus className="size-3" />
                                </InputGroupButton>
                              </InputGroupAddon>
                            </InputGroup>
                          </div>

                          {/* Satuan & Hapus Desktop */}
                          <div className="col-span-6 sm:col-span-2 flex items-center gap-1.5">
                            <AdaptiveSelect
                              aria-label={`Satuan ${item.item_name}`}
                              value={item.unit}
                              onValueChange={(nextUnit) =>
                                handleUpdateItem(idx, "unit", nextUnit)
                              }
                              options={rowUnits}
                              placeholder="Satuan"
                              searchPlaceholder="Cari satuan..."
                              creatable={true}
                              creatablePrefix="Satuan"
                            />

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Hapus ${
                                item.item_name || `baris ${idx + 1}`
                              }`}
                              onClick={() => handleRemoveItemRow(idx)}
                              className="hidden sm:inline-flex h-8 w-8 p-0 text-muted-foreground hover:text-rose-600 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Catatan / Keterangan per Item */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:pl-7">
                          <Input
                            value={item.notes || ""}
                            onChange={(e) =>
                              handleUpdateItem(idx, "notes", e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                !e.metaKey &&
                                !e.ctrlKey
                              )
                                e.preventDefault();
                            }}
                            placeholder={
                              rowProfile.notesPlaceholder ||
                              "Catatan tambahan (merek, ukuran kemasan, spesifikasi)..."
                            }
                            className="h-8 text-xs text-muted-foreground flex-1"
                          />
                          {item.supplier_name && item.supplier_name !== "-" && (
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              Toko: {item.supplier_name}
                            </span>
                          )}
                          {item.estimated_price && item.estimated_price > 0 && (
                            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                              ~
                              {formatRupiah(
                                item.estimated_price * (item.qty || 1)
                              )}
                            </span>
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
          <div className="px-4 sm:px-6 py-3 border-t border-border/80 bg-background shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Total <strong className="text-foreground">{footerSummary.totalItems}</strong> barang
              </span>
              {footerSummary.estimatedTotal > 0 && (
                <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  Est. ~{formatRupiah(footerSummary.estimatedTotal)}
                  {footerSummary.pricedCount < footerSummary.totalItems && (
                    <span className="font-normal text-muted-foreground ml-1">
                      ({footerSummary.pricedCount}/{footerSummary.totalItems} ada harga)
                    </span>
                  )}
                </span>
              )}
              {footerSummary.suppliers.length > 0 && (
                <span
                  title={footerSummary.suppliers.join(", ")}
                  className="inline-flex items-center gap-1"
                >
                  <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {footerSummary.suppliers.length === 1
                    ? footerSummary.suppliers[0]
                    : `${footerSummary.suppliers.length} supplier`}
                </span>
              )}
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="h-9 px-4 text-xs font-medium"
              >
                Batal
              </Button>
              {canSaveAsDraft && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => submitCurrentRequest("DRAFT")}
                  disabled={isSubmitting}
                  className="h-9 px-4 text-xs font-medium flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Simpan Draft</span>
                </Button>
              )}
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-9 px-5 text-xs font-semibold flex items-center gap-2"
              >
                <span>
                  {isSubmitting ? "Menyimpan..." : primarySubmitLabel}
                </span>
                {!isSubmitting && (
                  <kbd className="hidden sm:inline-block text-[10px] font-mono opacity-80 px-1.5 py-0.5 rounded bg-background/20">
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
