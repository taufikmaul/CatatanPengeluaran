import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Pencil, Receipt, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/formatters";
import { createManualIncomingTransaction, updateIncomingTransaction } from "@/lib/api";
import type { IncomingTransaction, BankAccount, ManualIncomingTxFormData } from "@/types";

interface IncomingTransactionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: IncomingTransaction | null;
  accounts: BankAccount[];
  orderTypeOptions?: string[];
  paymentMethodOptions?: string[];
  onSuccess: () => void;
}

export const IncomingTransactionFormModal: React.FC<IncomingTransactionFormModalProps> = ({
  isOpen,
  onClose,
  initialData,
  accounts,
  orderTypeOptions = [],
  paymentMethodOptions = [],
  onSuccess,
}) => {
  const isEdit = Boolean(initialData);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [orderType, setOrderType] = useState("Take Away");
  const [paymentMethod, setPaymentMethod] = useState("Tunai");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [cashierName, setCashierName] = useState("");
  const [grossSales, setGrossSales] = useState<string>("0");
  const [discountAmount, setDiscountAmount] = useState<string>("0");
  const [platformFee, setPlatformFee] = useState<string>("0");
  const [status, setStatus] = useState<"paid" | "void">("paid");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setDate(initialData.transaction_date || "");
        setTime(initialData.transaction_time || "");
        setReceiptNo(initialData.receipt_no || "");
        setOrderNo(initialData.order_no || "");
        setOrderType(initialData.order_type || "Take Away");
        setPaymentMethod(initialData.payment_method || "Tunai");
        setBankAccountId(
          initialData.bank_account_id ? String(initialData.bank_account_id) : ""
        );
        setCustomerName(initialData.customer_name || "");
        setCashierName(initialData.cashier_name || "");
        setGrossSales(String(initialData.gross_sales ?? 0));
        setDiscountAmount(String(initialData.discount_amount ?? 0));
        setPlatformFee(String(initialData.platform_fee ?? 0));
        setStatus(initialData.status === "void" ? "void" : "paid");
        setNotes(initialData.notes || "");
      } else {
        const today = new Date().toISOString().split("T")[0];
        const now = new Date();
        const curTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        setDate(today);
        setTime(curTime);
        setReceiptNo("");
        setOrderNo("");
        setOrderType("Take Away");
        setPaymentMethod("Tunai");
        setBankAccountId("");
        setCustomerName("");
        setCashierName("");
        setGrossSales("0");
        setDiscountAmount("0");
        setPlatformFee("0");
        setStatus("paid");
        setNotes("");
      }
    }
  }, [isOpen, initialData]);

  const numGross = Math.max(0, parseFloat(grossSales) || 0);
  const numDiscount = Math.max(0, parseFloat(discountAmount) || 0);
  const numFee = Math.max(0, parseFloat(platformFee) || 0);
  const isPaid = status === "paid";
  const calculatedNetSales = isPaid ? Math.max(0, numGross - numDiscount) : 0;
  const calculatedNetReceived = isPaid ? Math.max(0, calculatedNetSales - numFee) : 0;
  const calculatedVoidTotal = !isPaid ? Math.max(0, numGross - numDiscount) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      toast.error("Tanggal transaksi wajib diisi.");
      return;
    }
    if (numGross < 0) {
      toast.error("Penjualan kotor tidak boleh negatif.");
      return;
    }

    const payload: ManualIncomingTxFormData = {
      transaction_date: date,
      transaction_time: time.trim() || undefined,
      receipt_no: receiptNo.trim() || undefined,
      order_no: orderNo.trim() || undefined,
      order_type: orderType.trim() || "Take Away",
      payment_method: paymentMethod.trim() || "Tunai",
      bank_account_id: bankAccountId ? Number(bankAccountId) : null,
      customer_name: customerName.trim() || undefined,
      cashier_name: cashierName.trim() || undefined,
      gross_sales: numGross,
      discount_amount: numDiscount,
      platform_fee: numFee,
      status,
      notes: notes.trim() || undefined,
    };

    setIsSubmitting(true);
    try {
      if (isEdit && initialData) {
        await updateIncomingTransaction(initialData.id, payload);
        toast.success(`Transaksi ${receiptNo || `#${initialData.id}`} berhasil diperbarui.`);
      } else {
        await createManualIncomingTransaction(payload);
        toast.success("Transaksi masuk satuan berhasil ditambahkan.");
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.detail || "Gagal menyimpan transaksi masuk.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const defaultOrderTypes = Array.from(
    new Set(["Take Away", "Dine In", "GoFood", "GrabFood", "ShopeeFood", "WhatsApp", ...orderTypeOptions])
  );

  const defaultPaymentMethods = Array.from(
    new Set(["Tunai", "QRIS", "BCA Transfer", "Mandiri", "EDC", "GoFood Integrasi", "ShopeePay", ...paymentMethodOptions])
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              {isEdit ? <Pencil className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">
                {isEdit ? "Edit Transaksi Masuk" : "Tambah Transaksi Masuk Satuan"}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {isEdit
                  ? `Perbarui informasi struk/order #${initialData?.receipt_no || initialData?.id}`
                  : "Input transaksi penjualan kasir atau pesanan masuk secara manual"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1 text-xs">
          {/* Identitas Struk & Tanggal */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60">
            <div className="space-y-1.5">
              <Label htmlFor="tx-date" className="text-xs font-medium text-slate-700">
                Tanggal Transaksi <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="h-8 text-xs bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-time" className="text-xs font-medium text-slate-700">
                Waktu / Jam Transaksi
              </Label>
              <Input
                id="tx-time"
                placeholder="Contoh: 13:45"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-8 text-xs bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-receipt" className="text-xs font-medium text-slate-700">
                Nomor Struk / Receipt No
              </Label>
              <Input
                id="tx-receipt"
                placeholder="Contoh: POS-001 / RkiNqGO"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                className="h-8 text-xs font-mono bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-order-no" className="text-xs font-medium text-slate-700">
                Nomor Order / Order ID
              </Label>
              <Input
                id="tx-order-no"
                placeholder="Contoh: ORD-001 / F-3429057006"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                className="h-8 text-xs font-mono bg-white"
              />
            </div>
          </div>

          {/* Saluran & Pembayaran */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60">
            <div className="space-y-1.5">
              <Label htmlFor="tx-order-type" className="text-xs font-medium text-slate-700">
                Tipe Order / Saluran Penjualan <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="tx-order-type"
                list="incoming-order-types"
                placeholder="Pilih atau ketik tipe order"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
                required
                className="h-8 text-xs bg-white"
              />
              <datalist id="incoming-order-types">
                {defaultOrderTypes.map((ot) => (
                  <option key={ot} value={ot} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-payment-method" className="text-xs font-medium text-slate-700">
                Metode Pembayaran <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="tx-payment-method"
                list="incoming-payment-methods"
                placeholder="Pilih atau ketik metode bayar"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                required
                className="h-8 text-xs bg-white"
              />
              <datalist id="incoming-payment-methods">
                {defaultPaymentMethods.map((pm) => (
                  <option key={pm} value={pm} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-bank-account" className="text-xs font-medium text-slate-700">
                Rekening Bank Tujuan
              </Label>
              <select
                id="tx-bank-account"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- Otomatis (Sesuai Channel / Saluran) --</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={String(acc.id)}>
                    {acc.name} ({acc.bank_name})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-status" className="text-xs font-medium text-slate-700">
                Status Transaksi
              </Label>
              <select
                id="tx-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "paid" | "void")}
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              >
                <option value="paid">Dibayar (Paid)</option>
                <option value="void">Void / Dibatalkan</option>
              </select>
            </div>
          </div>

          {/* Pelanggan & Kasir */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tx-customer" className="text-xs font-medium text-slate-700">
                Nama Pelanggan (Opsional)
              </Label>
              <Input
                id="tx-customer"
                placeholder="Contoh: Ibu Rina"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-8 text-xs bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-cashier" className="text-xs font-medium text-slate-700">
                Nama Kasir (Opsional)
              </Label>
              <Input
                id="tx-cashier"
                placeholder="Contoh: Kasir 1"
                value={cashierName}
                onChange={(e) => setCashierName(e.target.value)}
                className="h-8 text-xs bg-white"
              />
            </div>
          </div>

          {/* Rincian Nominal & Realtime Kalkulasi */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-blue-600" />
                Rincian Nilai Transaksi
              </span>
              {status === "void" && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                  Transaksi Dibatalkan (Void)
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <Label htmlFor="tx-gross" className="text-[11px] font-medium text-slate-600">
                  Penjualan Kotor (Rp) <span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="tx-gross"
                  type="number"
                  min="0"
                  step="any"
                  value={grossSales}
                  onChange={(e) => setGrossSales(e.target.value)}
                  required
                  className="h-8 text-xs font-mono bg-white text-right"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="tx-discount" className="text-[11px] font-medium text-slate-600">
                  Diskon Penjualan (Rp)
                </Label>
                <Input
                  id="tx-discount"
                  type="number"
                  min="0"
                  step="any"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="h-8 text-xs font-mono bg-white text-right"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="tx-fee" className="text-[11px] font-medium text-slate-600">
                  Fee / Komisi Platform (Rp)
                </Label>
                <Input
                  id="tx-fee"
                  type="number"
                  min="0"
                  step="any"
                  value={platformFee}
                  onChange={(e) => setPlatformFee(e.target.value)}
                  className="h-8 text-xs font-mono bg-white text-right"
                />
              </div>
            </div>

            {/* Live Calculation Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/80">
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[10px] text-slate-500">Penjualan Bersih (Net)</div>
                <div className="text-xs font-semibold text-slate-800 tabular-nums">
                  {formatRupiah(calculatedNetSales)}
                </div>
              </div>

              <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="text-[10px] text-emerald-700 font-medium">Bersih Diterima Toko</div>
                <div className="text-xs font-bold text-emerald-800 tabular-nums">
                  {formatRupiah(calculatedNetReceived)}
                </div>
              </div>

              {status === "void" && (
                <div className="col-span-2 sm:col-span-1 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="text-[10px] text-amber-700 font-medium">Nilai Void / Batal</div>
                  <div className="text-xs font-bold text-amber-800 tabular-nums">
                    {formatRupiah(calculatedVoidTotal)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Catatan */}
          <div className="space-y-1.5">
            <Label htmlFor="tx-notes" className="text-xs font-medium text-slate-700">
              Catatan Transaksi (Opsional)
            </Label>
            <Textarea
              id="tx-notes"
              placeholder="Catatan promo, kendala kasir, atau penyesuaian..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-xs bg-white"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
              className="h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Menyimpan...
                </>
              ) : isEdit ? (
                <>
                  <Pencil className="w-3.5 h-3.5" />
                  Perbarui Transaksi
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Simpan Transaksi
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
