import React, { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { Expense, ExpenseFormData, ItemSuggestion } from "@/types";
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
import { Sparkles, CalendarClock, Store } from "lucide-react";

interface ExpenseFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ExpenseFormData, expenseId?: number) => void;
  categories: string[];
  initialData?: Expense | null;
  repeatData?: Expense | null;
  isSubmitting?: boolean;
  itemSuggestions?: ItemSuggestion[];
  supplierSuggestions?: string[];
}

export const ExpenseFormDrawer: React.FC<ExpenseFormDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  categories,
  initialData,
  repeatData,
  isSubmitting = false,
  itemSuggestions = [],
  supplierSuggestions = [],
}) => {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    defaultValues: {
      expense_date: new Date().toISOString().split("T")[0],
      supplier: "-",
      item_name: "",
      qty: 1,
      category: "Bahan Kue",
      unit_price: 0,
      tax: 0,
      discount: 0,
      total_price: 0,
      pay_method: "Transfer",
      pay_status: "Lunas",
      due_date: "-",
      notes: "-",
    },
  });

  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedSuggestionHint, setSelectedSuggestionHint] = useState<ItemSuggestion | null>(null);

  const itemNameVal = watch("item_name") || "";
  const supplierVal = watch("supplier") || "";
  const qty = watch("qty") || 0;
  const unitPrice = watch("unit_price") || 0;
  const tax = watch("tax") || 0;
  const discount = watch("discount") || 0;
  const payStatus = watch("pay_status") || "Lunas";

  // Filter suggestions based on input
  const filteredItemSuggestions = useMemo(() => {
    const q = itemNameVal.trim().toLowerCase();
    if (!q) return itemSuggestions.slice(0, 8);
    return itemSuggestions
      .filter(
        (s) =>
          s.item_name.toLowerCase().includes(q) ||
          (s.aliases && s.aliases.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [itemNameVal, itemSuggestions]);

  // Auto-calculate total price when components change
  useEffect(() => {
    const calc = Number(qty) * Number(unitPrice) + Number(tax) - Number(discount);
    setValue("total_price", Math.max(0, calc));
  }, [qty, unitPrice, tax, discount, setValue]);

  // Set form values when editing or repeating an order
  useEffect(() => {
    setSelectedSuggestionHint(null);
    if (initialData) {
      reset({
        expense_date: initialData.expense_date,
        supplier: initialData.supplier || "-",
        item_name: initialData.item_name || "",
        qty: initialData.qty || 1,
        category: initialData.category || categories[0] || "Bahan Kue",
        unit_price: initialData.unit_price || 0,
        tax: initialData.tax || 0,
        discount: initialData.discount || 0,
        total_price: initialData.total_price || 0,
        pay_method: initialData.pay_method || "Transfer",
        pay_status: initialData.pay_status || "Lunas",
        due_date: initialData.due_date || "-",
        notes: initialData.notes || "-",
      });
    } else if (repeatData) {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: repeatData.supplier || "-",
        item_name: repeatData.item_name || "",
        qty: repeatData.qty || 1,
        category: repeatData.category || categories[0] || "Bahan Kue",
        unit_price: repeatData.unit_price || 0,
        tax: repeatData.tax || 0,
        discount: repeatData.discount || 0,
        total_price: repeatData.total_price || 0,
        pay_method: repeatData.pay_method || "Transfer",
        pay_status: "Lunas",
        due_date: "-",
        notes: "-",
      });
    } else {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: "-",
        item_name: "",
        qty: 1,
        category: categories[0] || "Bahan Kue",
        unit_price: 0,
        tax: 0,
        discount: 0,
        total_price: 0,
        pay_method: "Transfer",
        pay_status: "Lunas",
        due_date: "-",
        notes: "-",
      });
    }
  }, [initialData, repeatData, reset, categories, isOpen]);

  const handleSelectSuggestion = (s: ItemSuggestion) => {
    setValue("item_name", s.item_name, { shouldValidate: true });
    if (s.category && categories.includes(s.category)) {
      setValue("category", s.category);
    }
    if (s.last_supplier && s.last_supplier !== "-" && (!supplierVal || supplierVal === "-")) {
      setValue("supplier", s.last_supplier);
    }
    if (s.last_unit_price > 0 && (!unitPrice || Number(unitPrice) === 0)) {
      setValue("unit_price", s.last_unit_price);
    }
    setSelectedSuggestionHint(s);
    setShowItemDropdown(false);
  };

  const handleFormSubmit = (data: ExpenseFormData) => {
    onSubmit(data, initialData ? initialData.id : undefined);
    onClose();
  };

  const calculatedTotal = watch("total_price");
  const isUnpaid = payStatus.toLowerCase().includes("belum") || payStatus.toLowerCase().includes("hutang");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span>🎂</span>
            {initialData
              ? "Edit Catatan Pengeluaran"
              : repeatData
              ? `Beli Lagi: ${repeatData.item_name}`
              : "Tambah Catatan Pengeluaran"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Tanggal Nota
              </label>
              <Input
                type="date"
                {...register("expense_date", { required: true })}
                className="h-10 text-xs rounded-xl"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Kategori
              </label>
              <select
                {...register("category")}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium focus:ring-2 focus:ring-blue-500"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Nama Barang + Autocomplete Master Item & Histori */}
          <div className="relative">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-600">
                Nama Barang / Keperluan *
              </label>
              {selectedSuggestionHint && selectedSuggestionHint.last_unit_price > 0 && (
                <button
                  type="button"
                  onClick={() => setValue("unit_price", selectedSuggestionHint.last_unit_price)}
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 font-medium"
                >
                  <Sparkles className="w-3 h-3" />
                  Harga terakhir: {formatRupiah(selectedSuggestionHint.last_unit_price)}
                </button>
              )}
            </div>
            <Input
              placeholder="Ketik atau pilih dari Master Item (mis: Tepung Terigu Cakra)"
              autoComplete="off"
              {...register("item_name", { required: "Nama barang wajib diisi" })}
              onFocus={() => setShowItemDropdown(true)}
              onBlur={() => setTimeout(() => setShowItemDropdown(false), 180)}
              className="h-10 text-xs rounded-xl"
            />
            {errors.item_name && (
              <span className="text-[11px] text-red-500">{errors.item_name.message}</span>
            )}

            {/* Dropdown Autocomplete */}
            {showItemDropdown && filteredItemSuggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
                {filteredItemSuggestions.map((s) => (
                  <button
                    key={`${s.item_name}-${s.is_master}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(s);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-blue-50/60 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-800 truncate">
                          {s.item_name}
                        </span>
                        {s.is_master && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 border-blue-200 bg-blue-50 text-blue-700 font-semibold"
                          >
                            Baku
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>{s.category}</span>
                        {s.last_supplier && s.last_supplier !== "-" && (
                          <span>• {s.last_supplier}</span>
                        )}
                      </div>
                    </div>
                    {s.last_unit_price > 0 && (
                      <span className="text-[11px] font-bold text-emerald-700 shrink-0 tabular-nums">
                        {formatRupiah(s.last_unit_price)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Toko / Supplier + Datalist Autocomplete */}
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1 flex items-center gap-1">
              <Store className="w-3 h-3 text-slate-400" />
              Toko / Supplier
            </label>
            <Input
              placeholder="Contoh: Toko Bahan Roti Makmur"
              list="supplier-suggestions-list"
              {...register("supplier")}
              className="h-10 text-xs rounded-xl"
            />
            {supplierSuggestions.length > 0 && (
              <datalist id="supplier-suggestions-list">
                {supplierSuggestions.map((sup) => (
                  <option key={sup} value={sup} />
                ))}
              </datalist>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Qty
              </label>
              <Input
                type="number"
                step="any"
                {...register("qty", { valueAsNumber: true })}
                className="h-10 text-xs rounded-xl"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Harga Satuan (Rp)
              </label>
              <Input
                type="number"
                step="any"
                {...register("unit_price", { valueAsNumber: true })}
                className="h-10 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Pajak & Diskon */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Pajak / Ongkir (+) Rp
              </label>
              <Input
                type="number"
                step="any"
                {...register("tax", { valueAsNumber: true })}
                className="h-9 text-xs rounded-xl"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Diskon / Potongan (-) Rp
              </label>
              <Input
                type="number"
                step="any"
                {...register("discount", { valueAsNumber: true })}
                className="h-9 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Calculated Total Highlight Box */}
          <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-2xl flex items-center justify-between">
            <span className="text-xs font-medium text-blue-900">Total Pengeluaran</span>
            <span className="text-base font-bold text-blue-700 tabular-nums">
              {formatRupiah(calculatedTotal)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Metode Bayar
              </label>
              <select
                {...register("pay_method")}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="Transfer">Transfer</option>
                <option value="Tunai">Tunai</option>
                <option value="QRIS">QRIS</option>
                <option value="Debit">Debit</option>
                <option value="Kredit">Kartu Kredit</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                Status Pembayaran
              </label>
              <select
                {...register("pay_status")}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="Lunas">Lunas</option>
                <option value="Belum Lunas">Belum Lunas (Hutang)</option>
              </select>
            </div>
          </div>

          {/* Jatuh Tempo (Tampil menonjol saat Belum Lunas) */}
          {isUnpaid && (
            <div className="p-3 bg-rose-50/60 border border-rose-200/80 rounded-2xl">
              <label className="text-xs font-semibold text-rose-800 flex items-center gap-1.5 mb-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-rose-600" />
                Tanggal Jatuh Tempo Tagihan (untuk Reminder Otomatis)
              </label>
              <Input
                type="date"
                {...register("due_date")}
                className="h-9 text-xs rounded-xl bg-white border-rose-200"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              Catatan Tambahan
            </label>
            <Input
              placeholder="Keterangan pengeluaran..."
              {...register("notes")}
              className="h-10 text-xs rounded-xl"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-xl text-xs h-10 px-4"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-10 px-5 font-semibold"
            >
              {isSubmitting ? "Menyimpan..." : initialData ? "Simpan Perubahan" : "Tambah Catatan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
