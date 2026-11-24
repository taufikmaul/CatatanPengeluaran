import React, { useState, useEffect, useMemo } from "react";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah, toIsoDate } from "@/lib/formatters";
import { DatePicker } from "@/components/ui/date-picker";
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
        const curTime = `${String(now.getHours()).padStart(2, "0")}:${String(
          now.getMinutes()
        ).padStart(2, "0")}`;
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
        toast.success(
          `Transaksi ${receiptNo || `#${initialData.id}`} berhasil diperbarui.`
        );
      } else {
        await createManualIncomingTransaction(payload);
        toast.success("Transaksi masuk satuan berhasil ditambahkan.");
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg =
        err.response?.data?.detail || "Gagal menyimpan transaksi masuk.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const defaultOrderTypes = useMemo(
    () =>
      Array.from(
        new Set([
          "Take Away",
          "Dine In",
          "Cakeflow",
          "GoFood",
          "GrabFood",
          "ShopeeFood",
          "WhatsApp",
          ...orderTypeOptions,
        ])
      ),
    [orderTypeOptions]
  );

  const defaultPaymentMethods = useMemo(
    () =>
      Array.from(
        new Set([
          "Tunai",
          "QRIS",
          "BCA Transfer",
          "Mandiri",
          "EDC",
          "GoFood Integrasi",
          "ShopeePay",
          ...paymentMethodOptions,
        ])
      ),
    [paymentMethodOptions]
  );

  const bankAccountOptions = useMemo(() => {
    return [
      { value: "", label: "-- Otomatis (Sesuai Channel / Saluran) --" },
      ...accounts.map((acc) => ({
        value: String(acc.id),
        label: acc.name,
        sublabel: acc.bank_name,
      })),
    ];
  }, [accounts]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader className="pb-3 border-b border-border/80">
          <DialogTitle className="text-base font-bold tracking-tight text-foreground">
            {isEdit ? "Edit Transaksi Masuk" : "Tambah Transaksi Masuk Satuan"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isEdit
              ? `Perbarui informasi struk/order #${
                  initialData?.receipt_no || initialData?.id
                }`
              : "Input transaksi penjualan kasir atau pesanan masuk secara manual"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2 text-xs">
          {/* Identitas Struk & Tanggal (Flat Grid, Zero Nested Card) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-foreground">
                Tanggal Transaksi <span className="text-rose-500">*</span>
              </Label>
              <DatePicker
                value={date}
                onChange={(d) => setDate(toIsoDate(d))}
                className="w-full h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-time" className="text-xs font-medium text-foreground">
                Waktu / Jam Transaksi
              </Label>
              <Input
                id="tx-time"
                placeholder="Contoh: 13:45"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-receipt" className="text-xs font-medium text-foreground">
                Nomor Struk / Receipt No
              </Label>
              <Input
                id="tx-receipt"
                placeholder="Contoh: POS-001 / RkiNqGO"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-order-no" className="text-xs font-medium text-foreground">
                Nomor Order / Order ID
              </Label>
              <Input
                id="tx-order-no"
                placeholder="Contoh: ORD-001 / F-3429057006"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                className="h-9 text-xs font-mono"
              />
            </div>
          </div>

          {/* Saluran & Pembayaran (Flat Hairline Section + Shadcn AdaptiveSelect) */}
          <div className="pt-4 border-t border-border/70 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="tx-order-type" className="text-xs font-medium text-foreground">
                Tipe Order / Saluran Penjualan <span className="text-rose-500">*</span>
              </Label>
              <AdaptiveSelect
                id="tx-order-type"
                value={orderType}
                onValueChange={setOrderType}
                options={defaultOrderTypes}
                creatable={true}
                creatablePrefix="Saluran"
                placeholder="Pilih atau ketik tipe order..."
                searchPlaceholder="Cari atau ketik saluran..."
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-payment-method" className="text-xs font-medium text-foreground">
                Metode Pembayaran <span className="text-rose-500">*</span>
              </Label>
              <AdaptiveSelect
                id="tx-payment-method"
                value={paymentMethod}
                onValueChange={setPaymentMethod}
                options={defaultPaymentMethods}
                creatable={true}
                creatablePrefix="Metode"
                placeholder="Pilih atau ketik metode bayar..."
                searchPlaceholder="Cari atau ketik metode..."
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-bank-account" className="text-xs font-medium text-foreground">
                Rekening Bank Tujuan
              </Label>
              <AdaptiveSelect
                id="tx-bank-account"
                value={bankAccountId}
                onValueChange={setBankAccountId}
                options={bankAccountOptions}
                placeholder="-- Otomatis (Sesuai Channel / Saluran) --"
                searchPlaceholder="Cari rekening..."
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-status" className="text-xs font-medium text-foreground">
                Status Transaksi
              </Label>
              <AdaptiveSelect
                id="tx-status"
                value={status}
                onValueChange={(val) => setStatus(val as "paid" | "void")}
                options={[
                  { value: "paid", label: "Dibayar (Paid)" },
                  { value: "void", label: "Void / Dibatalkan" },
                ]}
              />
            </div>
          </div>

          {/* Pelanggan & Kasir */}
          <div className="pt-4 border-t border-border/70 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="tx-customer" className="text-xs font-medium text-foreground">
                Nama Pelanggan (Opsional)
              </Label>
              <Input
                id="tx-customer"
                placeholder="Contoh: Ibu Rina"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tx-cashier" className="text-xs font-medium text-foreground">
                Nama Kasir (Opsional)
              </Label>
              <Input
                id="tx-cashier"
                placeholder="Contoh: Kasir 1"
                value={cashierName}
                onChange={(e) => setCashierName(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          {/* Rincian Nominal & Realtime Kalkulasi (Flat Hairline Section + ReUI InputGroup) */}
          <div className="pt-4 border-t border-border/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground text-xs">
                Rincian Nilai Transaksi
              </span>
              {status === "void" && (
                <Badge variant="outline" className="text-[10px]">
                  Transaksi Dibatalkan (Void)
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tx-gross" className="text-xs font-medium text-foreground">
                  Penjualan Kotor <span className="text-rose-500">*</span>
                </Label>
                <InputGroup className="h-9">
                  <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                    <InputGroupText className="text-xs">Rp</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="tx-gross"
                    type="number"
                    min="0"
                    step="any"
                    value={grossSales}
                    onChange={(e) => setGrossSales(e.target.value)}
                    required
                    className="text-xs font-semibold tabular-nums pl-1"
                  />
                </InputGroup>
              </div>

              <div className="space-y-1">
                <Label htmlFor="tx-discount" className="text-xs font-medium text-foreground">
                  Diskon Penjualan
                </Label>
                <InputGroup className="h-9">
                  <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                    <InputGroupText className="text-xs">Rp</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="tx-discount"
                    type="number"
                    min="0"
                    step="any"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="text-xs tabular-nums pl-1"
                  />
                </InputGroup>
              </div>

              <div className="space-y-1">
                <Label htmlFor="tx-fee" className="text-xs font-medium text-foreground">
                  Fee / Komisi Platform
                </Label>
                <InputGroup className="h-9">
                  <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                    <InputGroupText className="text-xs">Rp</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="tx-fee"
                    type="number"
                    min="0"
                    step="any"
                    value={platformFee}
                    onChange={(e) => setPlatformFee(e.target.value)}
                    className="text-xs tabular-nums pl-1"
                  />
                </InputGroup>
              </div>
            </div>

            {/* Live Calculation Hairline Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 py-2 border-y border-border/60 text-xs">
              <div>
                <span className="text-muted-foreground mr-1.5">Penjualan Bersih:</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatRupiah(calculatedNetSales)}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground mr-1.5">Bersih Diterima Toko:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatRupiah(calculatedNetReceived)}
                </span>
              </div>

              {status === "void" && (
                <div>
                  <span className="text-muted-foreground mr-1.5">Nilai Void:</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                    {formatRupiah(calculatedVoidTotal)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Catatan */}
          <div className="space-y-1">
            <Label htmlFor="tx-notes" className="text-xs font-medium text-foreground">
              Catatan Transaksi (Opsional)
            </Label>
            <Textarea
              id="tx-notes"
              placeholder="Catatan promo, kendala kasir, atau penyesuaian..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-xs"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border/70">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
              className="h-9 px-4 text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="h-9 px-5 text-xs font-semibold"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Menyimpan...
                </>
              ) : isEdit ? (
                "Perbarui Transaksi"
              ) : (
                "Simpan Transaksi"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
