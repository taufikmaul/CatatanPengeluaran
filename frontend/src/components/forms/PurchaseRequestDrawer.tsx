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
import {
  ShoppingBag,
  Plus,
  Trash2,
  Search,
  Check,
  User,
  Clock,
  AlertCircle,
  FileText,
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
  const [items, setItems] = useState<PurchaseRequestItemFormData[]>([
    { item_name: "", qty: 1, unit: "Pcs", notes: "", category: "Bahan Kue" },
  ]);

  // Active autocomplete index
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);

  // Sync initialData
  useEffect(() => {
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
      }
    } else {
      setTitle("Request Belanja");
      setUrgency("NORMAL");
      setRequesterName(currentUser || "Staf Dapur");
      setGeneralNotes("");
      setRequestDate(new Date().toISOString().split("T")[0]);
      setItems([
        { item_name: "", qty: 1, unit: "Pcs", notes: "", category: "Bahan Kue" },
      ]);
    }
    setActiveItemIndex(null);
  }, [initialData, isOpen, currentUser]);

  const handleAddItemRow = () => {
    setItems((prev) => [
      ...prev,
      { item_name: "", qty: 1, unit: "Pcs", notes: "", category: "Bahan Kue" },
    ]);
  };

  const handleRemoveItemRow = (idx: number) => {
    if (items.length <= 1) {
      setItems([{ item_name: "", qty: 1, unit: "Pcs", notes: "", category: "Bahan Kue" }]);
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateItem = (idx: number, field: keyof PurchaseRequestItemFormData, val: any) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: val };
      return updated;
    });
  };

  const handleSelectSuggestion = (idx: number, s: ItemSuggestion) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        item_name: s.item_name,
        category: s.category || updated[idx].category || "Bahan Kue",
        unit: s.satuan_beli || updated[idx].unit || "Pcs",
        estimated_price: s.last_unit_price || undefined,
        supplier_name: s.last_supplier && s.last_supplier !== "-" ? s.last_supplier : "-",
      };
      return updated;
    });
    setActiveItemIndex(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Filter baris kosong
    const validItems = items.filter((i) => i.item_name.trim().length > 0);
    if (validItems.length === 0) {
      alert("Harap masukkan minimal 1 barang belanjaan.");
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl w-full max-h-[92vh] flex flex-col p-0 overflow-hidden bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {initialData ? "Edit Daftar Belanja" : "Listing Request Belanja"}
              </DialogTitle>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Catat beberapa barang kebutuhan dapur/toko dalam 1 pengajuan untuk diteruskan ke Purchasing.
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Header Data: Judul, Urgensi & Pemohon */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-zinc-50/60 dark:bg-zinc-900/50 rounded-xl border border-zinc-200/80 dark:border-zinc-800">
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                <FileText className="w-3 h-3 text-zinc-400" /> Keperluan / Judul
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mis: Bahan Roti Manis / Stok Mingguan"
                className="h-9 text-xs bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                <User className="w-3 h-3 text-zinc-400" /> Pemohon (Staf/Bagian)
              </label>
              <Input
                value={requesterName}
                onChange={(e) => setRequesterName(e.target.value)}
                placeholder="Misal: Dapur / Siti"
                className="h-9 text-xs bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-zinc-400" /> Tingkat Urgensi
              </label>
              <div className="grid grid-cols-2 gap-1.5 h-9">
                <button
                  type="button"
                  onClick={() => setUrgency("NORMAL")}
                  className={`rounded-lg text-xs font-semibold flex items-center justify-center gap-1 border transition-all ${
                    urgency === "NORMAL"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100"
                  }`}
                >
                  🟢 Biasa
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency("URGENT")}
                  className={`rounded-lg text-xs font-semibold flex items-center justify-center gap-1 border transition-all ${
                    urgency === "URGENT"
                      ? "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 ring-1 ring-rose-500"
                      : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100"
                  }`}
                >
                  🔴 Urgent
                </button>
              </div>
            </div>
          </div>

          {/* List Item Belanja (Multi-Item Table) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <span>Daftar Barang Belanjaan</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {items.length} Item
                </Badge>
              </span>
              <Button
                type="button"
                size="sm"
                onClick={handleAddItemRow}
                className="h-8 px-2.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Baris
              </Button>
            </div>

            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/80 bg-white dark:bg-zinc-900">
              {items.map((item, idx) => {
                const searchQ = item.item_name.toLowerCase().trim();
                const matchedSuggestions = searchQ.length >= 2
                  ? itemSuggestions
                      .filter((s) => s.item_name.toLowerCase().includes(searchQ))
                      .slice(0, 4)
                  : [];

                return (
                  <div key={idx} className="p-3 space-y-2 relative group hover:bg-zinc-50/50 dark:hover:bg-zinc-900/60 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-center text-xs font-mono font-bold text-zinc-400">
                        {idx + 1}.
                      </span>

                      {/* Input Nama Barang with Autocomplete */}
                      <div className="flex-1 relative">
                        <Input
                          value={item.item_name}
                          onChange={(e) => {
                            handleUpdateItem(idx, "item_name", e.target.value);
                            setActiveItemIndex(idx);
                          }}
                          onFocus={() => setActiveItemIndex(idx)}
                          placeholder="Ketik nama barang (misal: Tepung Cakra)..."
                          className="h-9 text-xs bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 font-semibold"
                        />

                        {/* Autocomplete Dropdown */}
                        {activeItemIndex === idx && matchedSuggestions.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden py-1 divide-y divide-zinc-100 dark:divide-zinc-800">
                            {matchedSuggestions.map((s) => (
                              <button
                                key={s.item_name}
                                type="button"
                                onClick={() => handleSelectSuggestion(idx, s)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-between"
                              >
                                <div>
                                  <p className="font-bold text-zinc-900 dark:text-zinc-100">{s.item_name}</p>
                                  <p className="text-[10px] text-zinc-500">
                                    {s.category || "Bahan Kue"} • {s.satuan_beli || "Pcs"}
                                    {s.last_supplier && s.last_supplier !== "-" ? ` • Biasa di: ${s.last_supplier}` : ""}
                                  </p>
                                </div>
                                {s.last_unit_price > 0 && (
                                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    ~{formatRupiah(s.last_unit_price)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Qty */}
                      <div className="w-20">
                        <Input
                          type="number"
                          step="any"
                          min="0.1"
                          value={item.qty}
                          onChange={(e) => handleUpdateItem(idx, "qty", parseFloat(e.target.value) || 1)}
                          className="h-9 text-xs text-center font-bold"
                        />
                      </div>

                      {/* Unit */}
                      <div className="w-28">
                        <select
                          value={item.unit}
                          onChange={(e) => handleUpdateItem(idx, "unit", e.target.value)}
                          className="w-full h-9 px-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg outline-none font-medium"
                        >
                          {COMMON_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Hapus Baris */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveItemRow(idx)}
                        className="h-9 w-9 p-0 text-zinc-400 hover:text-rose-600 rounded-lg shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Catatan / Keterangan per Item */}
                    <div className="flex items-center gap-2 pl-7">
                      <Input
                        value={item.notes}
                        onChange={(e) => handleUpdateItem(idx, "notes", e.target.value)}
                        placeholder="Catatan tambahan (mis: merek tertentu, ukuran pack, dsb)..."
                        className="h-7 text-[11px] bg-zinc-50/70 dark:bg-zinc-950/70 border-zinc-200 dark:border-zinc-800 text-zinc-600"
                      />
                      {item.supplier_name && item.supplier_name !== "-" && (
                        <Badge variant="outline" className="text-[10px] shrink-0 text-zinc-500">
                          Toko: {item.supplier_name}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddItemRow}
              className="w-full h-9 border-dashed text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah Barang Lain ke Daftar Belanja
            </Button>
          </div>

          {/* Catatan Umum */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
              Catatan Pengajuan Keseluruhan (Opsional)
            </label>
            <Input
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
              placeholder="Contoh: Mohon diproses hari ini karena untuk order weekend..."
              className="h-9 text-xs"
            />
          </div>

          {/* Footer Submit */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              Total {items.filter((i) => i.item_name.trim().length > 0).length} barang akan diajukan.
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="h-10 px-4 text-xs rounded-xl"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-10 px-5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-md shadow-amber-500/20"
              >
                {isSubmitting ? "Menyimpan..." : "🚀 Kirim Daftar Belanja"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
