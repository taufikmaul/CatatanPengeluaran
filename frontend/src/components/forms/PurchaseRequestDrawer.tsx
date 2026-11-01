import React, { useState, useMemo, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { PurchaseRequest, PurchaseRequestFormData, ItemSuggestion } from "@/types";
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
import {
  ShoppingBag,
  Package,
  AlertCircle,
  CheckCircle2,
  Minus,
  Plus,
  Search,
  Sparkles,
  Tag,
  User,
  Clock,
  Check,
} from "lucide-react";

interface PurchaseRequestDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PurchaseRequestFormData, requestId?: number) => void;
  initialData?: PurchaseRequest | null;
  isSubmitting?: boolean;
  itemSuggestions?: ItemSuggestion[];
  categories?: string[];
  currentUser?: string;
}

const COMMON_UNITS = [
  "Pcs", "Box", "Kg", "Gram", "Liter", "Pack", "Sak", "Bungkus",
  "Kaleng", "Dus", "Botol", "Bal", "Roll", "Lembar", "Butir", "Ikat"
];

export const PurchaseRequestDrawer: React.FC<PurchaseRequestDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isSubmitting = false,
  itemSuggestions = [],
  categories = [
    "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor",
    "Kemasan", "Operasional", "Topper & Mainan", "Renovasi",
    "Asset", "Iuran", "Tukar Cash", "Ongkir",
    "Gaji", "Sewa", "Marketing", "Software", "Maintenance"
  ],
  currentUser = "",
}) => {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PurchaseRequestFormData>({
    defaultValues: {
      item_name: "",
      qty: 1,
      unit: "Pcs",
      category: "Bahan Kue",
      estimated_price: undefined,
      urgency: "NORMAL",
      notes: "",
      requester_name: currentUser || "Staf Toko",
      request_date: new Date().toISOString().split("T")[0],
    },
  });

  const itemNameVal = watch("item_name");
  const qtyVal = watch("qty") || 1;
  const unitVal = watch("unit") || "Pcs";
  const urgencyVal = watch("urgency") || "NORMAL";
  const categoryVal = watch("category");
  const estPriceVal = watch("estimated_price");

  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedSuggestionHint, setSelectedSuggestionHint] = useState<ItemSuggestion | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync initialData when editing
  useEffect(() => {
    if (initialData) {
      reset({
        item_name: initialData.item_name,
        qty: initialData.qty,
        unit: initialData.unit || "Pcs",
        category: initialData.category || "Bahan Kue",
        estimated_price: initialData.estimated_price || undefined,
        urgency: initialData.urgency || "NORMAL",
        notes: initialData.notes === "-" ? "" : initialData.notes,
        requester_name: initialData.requester_name || currentUser || "Staf Toko",
        request_date: initialData.request_date || new Date().toISOString().split("T")[0],
      });
      setSelectedSuggestionHint(null);
    } else {
      reset({
        item_name: "",
        qty: 1,
        unit: "Pcs",
        category: "Bahan Kue",
        estimated_price: undefined,
        urgency: "NORMAL",
        notes: "",
        requester_name: currentUser || "Staf Toko",
        request_date: new Date().toISOString().split("T")[0],
      });
      setSelectedSuggestionHint(null);
    }
  }, [initialData, isOpen, reset, currentUser]);

  // Autocomplete matching
  const filteredSuggestions = useMemo(() => {
    if (!itemNameVal || itemNameVal.length < 2) return [];
    const q = itemNameVal.toLowerCase().trim();
    return itemSuggestions
      .filter((s) => s.item_name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [itemNameVal, itemSuggestions]);

  // Handle outside click for autocomplete dropdown
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowItemDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleSelectSuggestion = (s: ItemSuggestion) => {
    setValue("item_name", s.item_name, { shouldValidate: true });
    if (s.category) setValue("category", s.category);
    if (s.satuan_beli) setValue("unit", s.satuan_beli);
    if (s.last_unit_price && s.last_unit_price > 0) {
      setValue("estimated_price", s.last_unit_price);
    }
    setSelectedSuggestionHint(s);
    setShowItemDropdown(false);
  };

  const handleFormSubmit = (data: PurchaseRequestFormData) => {
    onSubmit(data, initialData?.id);
  };

  const stepQty = (delta: number) => {
    const current = Number(qtyVal) || 1;
    const next = Math.max(1, current + delta);
    setValue("qty", next);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg w-full max-h-[92vh] flex flex-col p-0 overflow-hidden bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {initialData ? "Edit Request Belanja" : "Ajukan Request Belanja"}
              </DialogTitle>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Kebutuhan belanja operasional toko & dapur agar cepat disetujui.
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* 1. Nama Barang */}
          <div className="space-y-1.5 relative" ref={dropdownRef}>
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
              <span>Nama Barang / Bahan *</span>
              {selectedSuggestionHint && (
                <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Cocok dari Master Data
                </span>
              )}
            </label>
            <div className="relative">
              <Input
                {...register("item_name", { required: "Nama barang wajib diisi" })}
                placeholder="Misal: Tepung Terigu Cakra, Keju Kraft..."
                className="pr-10 h-11 text-sm bg-white dark:bg-zinc-900 focus-visible:ring-amber-500 border-zinc-300 dark:border-zinc-700"
                autoComplete="off"
                onFocus={() => {
                  if (filteredSuggestions.length > 0) setShowItemDropdown(true);
                }}
                onChange={(e) => {
                  setValue("item_name", e.target.value);
                  setShowItemDropdown(true);
                  if (selectedSuggestionHint && selectedSuggestionHint.item_name !== e.target.value) {
                    setSelectedSuggestionHint(null);
                  }
                }}
              />
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-3.5 pointer-events-none" />
            </div>
            {errors.item_name && (
              <p className="text-xs text-rose-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {errors.item_name.message}
              </p>
            )}

            {/* Dropdown Suggestions */}
            {showItemDropdown && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden py-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {filteredSuggestions.map((s) => (
                  <button
                    key={s.item_name}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-amber-50/70 dark:hover:bg-amber-950/30 transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                        {s.item_name}
                      </p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Kategori: {s.category || "Bahan Kue"} • Satuan: {s.satuan_beli || "Pcs"}
                      </p>
                    </div>
                    {s.last_unit_price > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700">
                        ~{formatRupiah(s.last_unit_price)}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 2. Jumlah & Satuan (Easy Stepper) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Jumlah (Qty) *
              </label>
              <div className="flex items-center border border-zinc-300 dark:border-zinc-700 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 h-11 focus-within:ring-2 focus-within:ring-amber-500">
                <button
                  type="button"
                  onClick={() => stepQty(-1)}
                  className="w-10 h-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  step="any"
                  min="0.1"
                  value={qtyVal}
                  onChange={(e) => setValue("qty", parseFloat(e.target.value) || 1)}
                  className="w-full text-center font-bold text-sm bg-transparent outline-none text-zinc-900 dark:text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => stepQty(1)}
                  className="w-10 h-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Satuan *
              </label>
              <select
                {...register("unit")}
                value={unitVal}
                onChange={(e) => setValue("unit", e.target.value)}
                className="w-full h-11 px-3 text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-zinc-100"
              >
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Tingkat Urgensi (Pill Buttons Besar) */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-400" /> Tingkat Kebutuhan / Urgensi *
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setValue("urgency", "NORMAL")}
                className={`py-3 px-3.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                  urgencyVal === "NORMAL"
                    ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/20"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                }`}
              >
                <div>
                  <p className="text-xs font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Biasa
                  </p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Stok rutin, dibeli sesuai jadwal
                  </p>
                </div>
                {urgencyVal === "NORMAL" && <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={() => setValue("urgency", "URGENT")}
                className={`py-3 px-3.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                  urgencyVal === "URGENT"
                    ? "border-rose-500 bg-rose-50/70 dark:bg-rose-950/30 text-rose-900 dark:text-rose-100 ring-2 ring-rose-500/20"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                }`}
              >
                <div>
                  <p className="text-xs font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> Mendesak
                  </p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Habis mendadak / order urgent
                  </p>
                </div>
                {urgencyVal === "URGENT" && <Check className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
              </button>
            </div>
          </div>

          {/* 4. Estimasi Harga (Opsional) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Perkiraan Harga Satuan (Opsional)
              </label>
              {selectedSuggestionHint?.last_unit_price ? (
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  💡 Terakhir: {formatRupiah(selectedSuggestionHint.last_unit_price)}
                </span>
              ) : null}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-3 text-xs font-semibold text-zinc-400">
                Rp
              </span>
              <Input
                type="number"
                placeholder="0"
                value={estPriceVal || ""}
                onChange={(e) => setValue("estimated_price", e.target.value ? parseFloat(e.target.value) : undefined)}
                className="pl-9 h-11 text-sm bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 focus-visible:ring-amber-500"
              />
            </div>
            {estPriceVal && Number(estPriceVal) > 0 && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
                <span>Perkiraan Total:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {formatRupiah((Number(estPriceVal) || 0) * (Number(qtyVal) || 1))}
                </span>
              </p>
            )}
          </div>

          {/* 5. Catatan & Pemohon */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-zinc-400" /> Nama Pemohon
              </label>
              <Input
                {...register("requester_name")}
                placeholder="Misal: Dapur Utama / Siti"
                className="h-10 text-xs bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-zinc-400" /> Kategori
              </label>
              <select
                {...register("category")}
                value={categoryVal || "Bahan Kue"}
                onChange={(e) => setValue("category", e.target.value)}
                className="w-full h-10 px-3 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-zinc-100"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Catatan Kebutuhan
            </label>
            <textarea
              {...register("notes")}
              rows={2}
              placeholder="Contoh: Sisa tinggal 1 bungkus, butuh untuk orderan hari Sabtu..."
              className="w-full p-3 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-zinc-100 resize-none"
            />
          </div>

          {/* Footer Submit Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-11 px-4 text-xs font-medium rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-11 px-5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-md shadow-amber-500/20"
            >
              {isSubmitting ? "Menyimpan..." : initialData ? "Simpan Perubahan" : "🚀 Kirim Pengajuan Belanja"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
