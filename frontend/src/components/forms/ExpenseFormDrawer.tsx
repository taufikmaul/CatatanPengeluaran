import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Expense, ExpenseFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/formatters";

interface ExpenseFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ExpenseFormData, expenseId?: number) => void;
  categories: string[];
  initialData?: Expense | null;
  isSubmitting?: boolean;
}

export const ExpenseFormDrawer: React.FC<ExpenseFormDrawerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  categories,
  initialData,
  isSubmitting = false,
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
      category: "Bahan Baku",
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

  const qty = watch("qty") || 0;
  const unitPrice = watch("unit_price") || 0;
  const tax = watch("tax") || 0;
  const discount = watch("discount") || 0;

  // Auto-calculate total price when components change
  useEffect(() => {
    const calc = Number(qty) * Number(unitPrice) + Number(tax) - Number(discount);
    setValue("total_price", Math.max(0, calc));
  }, [qty, unitPrice, tax, discount, setValue]);

  // Set form values when editing
  useEffect(() => {
    if (initialData) {
      reset({
        expense_date: initialData.expense_date,
        supplier: initialData.supplier || "-",
        item_name: initialData.item_name || "",
        qty: initialData.qty || 1,
        category: initialData.category || "Bahan Baku",
        unit_price: initialData.unit_price || 0,
        tax: initialData.tax || 0,
        discount: initialData.discount || 0,
        total_price: initialData.total_price || 0,
        pay_method: initialData.pay_method || "Transfer",
        pay_status: initialData.pay_status || "Lunas",
        due_date: initialData.due_date || "-",
        notes: initialData.notes || "-",
      });
    } else {
      reset({
        expense_date: new Date().toISOString().split("T")[0],
        supplier: "-",
        item_name: "",
        qty: 1,
        category: categories[0] || "Bahan Baku",
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
  }, [initialData, reset, categories, isOpen]);

  const handleFormSubmit = (data: ExpenseFormData) => {
    onSubmit(data, initialData ? initialData.id : undefined);
    onClose();
  };

  const calculatedTotal = watch("total_price");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span>🎂</span>
            {initialData ? "Edit Catatan Pengeluaran" : "Tambah Catatan Pengeluaran"}
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

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              Nama Barang / Keperluan *
            </label>
            <Input
              placeholder="Contoh: Tepung Terigu Cakra 25kg"
              {...register("item_name", { required: "Nama barang wajib diisi" })}
              className="h-10 text-xs rounded-xl"
            />
            {errors.item_name && (
              <span className="text-[11px] text-red-500">{errors.item_name.message}</span>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              Toko / Supplier
            </label>
            <Input
              placeholder="Contoh: Toko Bahan Roti Makmur"
              {...register("supplier")}
              className="h-10 text-xs rounded-xl"
            />
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
