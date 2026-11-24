import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BankAccount, Expense, ExpenseInvoiceGroup, ExpensePayment } from "@/types";
import {
  deleteExpensePayment,
  getExpensePayments,
  recordExpensePayment,
  recordInvoicePayment,
} from "@/lib/api";
import { formatDateId, formatRupiah, toIsoDate } from "@/lib/formatters";
import { DatePicker } from "@/components/ui/date-picker";
import {
  getDueUrgencyInfo,
  getExpensePaymentBreakdown,
  getTempoQuickDate,
  isCodExpense,
  hasInstallmentHistory,
} from "@/lib/paymentStatus";
import { InlineMathInput } from "@/components/forms/expense/InlineMathInput";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Trash2,
} from "lucide-react";

interface DpPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  invoiceGroup?: ExpenseInvoiceGroup | null;
  bankAccounts?: BankAccount[];
  initialMode?: "full" | "percent" | "amount";
  onPaymentUpdated?: (updated: Expense) => void;
  onInvoiceUpdated?: () => void;
}

const PAYMENT_METHODS = ["Transfer", "Tunai", "QRIS", "Debit", "Kredit"];

export const DpPaymentModal: React.FC<DpPaymentModalProps> = ({
  isOpen,
  onClose,
  expense,
  invoiceGroup = null,
  bankAccounts = [],
  initialMode = "percent",
  onPaymentUpdated,
  onInvoiceUpdated,
}) => {
  const queryClient = useQueryClient();

  const isMultiInvoiceMode = Boolean(invoiceGroup && invoiceGroup.items.length > 1);
  const activeSingleExpense =
    expense ||
    (invoiceGroup && invoiceGroup.items.length === 1 ? invoiceGroup.items[0] : null);

  const [payMode, setPayMode] = useState<"full" | "percent" | "amount">(initialMode);
  const [percentVal, setPercentVal] = useState<number>(50);
  const [amountVal, setAmountVal] = useState<number>(0);
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [payMethod, setPayMethod] = useState<string>("Transfer");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const breakdown = useMemo(() => {
    if (isMultiInvoiceMode && invoiceGroup) {
      return {
        total: invoiceGroup.total_amount,
        paid: invoiceGroup.paid_amount,
        remaining: invoiceGroup.remaining_amount,
        progressPct: invoiceGroup.payment_progress_pct,
        isPaid: invoiceGroup.is_paid,
        isDp: invoiceGroup.is_dp,
      };
    }
    if (!activeSingleExpense) {
      return { total: 0, paid: 0, remaining: 0, progressPct: 0, isPaid: false, isDp: false };
    }
    return getExpensePaymentBreakdown(activeSingleExpense);
  }, [isMultiInvoiceMode, invoiceGroup, activeSingleExpense]);

  useEffect(() => {
    if (!isOpen) return;
    if (isMultiInvoiceMode && invoiceGroup) {
      const defaultMode = invoiceGroup.is_dp ? "full" : initialMode;
      setPayMode(defaultMode);
      setPercentVal(50);
      setAmountVal(
        defaultMode === "full"
          ? invoiceGroup.remaining_amount
          : Math.round(invoiceGroup.total_amount * 0.5)
      );
      setPaymentDate(new Date().toISOString().split("T")[0]);
      setPayMethod(
        invoiceGroup.pay_method && invoiceGroup.pay_method !== "Tempo / Tagihan" && !invoiceGroup.pay_method.includes("(+")
          ? invoiceGroup.pay_method
          : "Transfer"
      );
      const firstBankId = invoiceGroup.items.find((it) => it.bank_account_id)?.bank_account_id;
      setBankAccountId(firstBankId ? String(firstBankId) : "");
      setDueDate(
        invoiceGroup.due_date && invoiceGroup.due_date !== "-"
          ? invoiceGroup.due_date.slice(0, 10)
          : getTempoQuickDate(14)
      );
      setReferenceNo("");
      setNotes("");
      setFormError(null);
      return;
    }

    if (!activeSingleExpense) return;
    const bd = getExpensePaymentBreakdown(activeSingleExpense);
    const defaultMode = bd.isDp ? "full" : initialMode;
    setPayMode(defaultMode);
    setPercentVal(50);
    setAmountVal(defaultMode === "full" ? bd.remaining : Math.round(bd.total * 0.5));
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPayMethod(
      activeSingleExpense.pay_method && activeSingleExpense.pay_method !== "Tempo / Tagihan"
        ? activeSingleExpense.pay_method
        : "Transfer"
    );
    setBankAccountId(activeSingleExpense.bank_account_id ? String(activeSingleExpense.bank_account_id) : "");
    setDueDate(
      activeSingleExpense.due_date && activeSingleExpense.due_date !== "-"
        ? activeSingleExpense.due_date.slice(0, 10)
        : getTempoQuickDate(14)
    );
    setReferenceNo("");
    setNotes("");
    setFormError(null);
  }, [isOpen, isMultiInvoiceMode, invoiceGroup, activeSingleExpense, initialMode]);

  const {
    data: singlePayments = [],
    isLoading: isSinglePaymentsLoading,
    isError: isSinglePaymentsError,
    refetch: refetchSinglePayments,
  } = useQuery<ExpensePayment[]>({
    queryKey: ["expense-payments", activeSingleExpense?.id],
    queryFn: () => getExpensePayments(activeSingleExpense!.id),
    enabled: isOpen && !isMultiInvoiceMode && Boolean(activeSingleExpense?.id),
  });

  const {
    data: multiPayments = [],
    isLoading: isMultiPaymentsLoading,
    isError: isMultiPaymentsError,
    refetch: refetchMultiPayments,
  } = useQuery<ExpensePayment[]>({
    queryKey: [
      "invoice-payments",
      invoiceGroup?.group_key,
      invoiceGroup?.items.map((it) => it.id).join(","),
    ],
    queryFn: async () => {
      if (!invoiceGroup) return [];
      const lists = await Promise.all(
        invoiceGroup.items.map((it) => getExpensePayments(it.id))
      );
      return lists
        .flat()
        .sort(
          (a, b) =>
            (a.payment_date || "").localeCompare(b.payment_date || "") ||
            a.id - b.id
        );
    },
    enabled: isOpen && isMultiInvoiceMode && Boolean(invoiceGroup),
  });

  const isPaymentsLoading = isMultiInvoiceMode ? isMultiPaymentsLoading : isSinglePaymentsLoading;
  const isPaymentsError = isMultiInvoiceMode ? isMultiPaymentsError : isSinglePaymentsError;
  const refetchPayments = isMultiInvoiceMode ? refetchMultiPayments : refetchSinglePayments;

  const invoiceItemNameMap = useMemo(() => {
    const map: Record<number, string> = {};
    invoiceGroup?.items.forEach((it) => {
      map[it.id] = it.item_name;
    });
    return map;
  }, [invoiceGroup]);

  const payments = isMultiInvoiceMode ? multiPayments : singlePayments;

  const payAmountNow = useMemo(() => {
    if ((!activeSingleExpense && !isMultiInvoiceMode) || breakdown.remaining <= 0) return 0;
    if (payMode === "full") return breakdown.remaining;
    if (payMode === "percent") {
      const pct = Math.max(0, Math.min(100, Number(percentVal || 0)));
      const raw = Math.round(breakdown.total * (pct / 100));
      return Math.min(breakdown.remaining, raw);
    }
    return Math.max(0, Number(amountVal || 0));
  }, [activeSingleExpense, isMultiInvoiceMode, breakdown, payMode, percentVal, amountVal]);

  const remainingAfterPay = Math.max(0, breakdown.remaining - payAmountNow);
  const willBeFull = remainingAfterPay <= 1;
  const effectivePctOfTotal =
    breakdown.total > 0 ? Math.round((payAmountNow / breakdown.total) * 1000) / 10 : 0;

  const bankAccountOptions = useMemo(() => {
    return [
      { value: "", label: "Otomatis (Sesuai Mapping Metode)" },
      ...bankAccounts.map((acc) => ({
        value: String(acc.id),
        label: `${acc.name} (${acc.account_code})`,
        sublabel: acc.bank_name,
      })),
    ];
  }, [bankAccounts]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
    queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
    queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
    queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
    queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
    queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
    queryClient.invalidateQueries({ queryKey: ["report"] });
    queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["supplier"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    if (activeSingleExpense?.id) {
      queryClient.invalidateQueries({ queryKey: ["expense-payments", activeSingleExpense.id] });
    }
    if (invoiceGroup?.group_key) {
      queryClient.invalidateQueries({ queryKey: ["invoice-payments", invoiceGroup.group_key] });
    }
  };

  const isCod = isMultiInvoiceMode && invoiceGroup
    ? invoiceGroup.items.some((it) => isCodExpense(it))
    : isCodExpense(activeSingleExpense);
  const hasInst = hasInstallmentHistory({ payments });

  const recordMutation = useMutation({
    mutationFn: async (): Promise<{ updated: Expense | Expense[]; isInvoice: boolean }> => {
      const effectivePaymentType = willBeFull
        ? "settlement"
        : breakdown.paid <= 0
        ? breakdown.isDp
          ? "dp"
          : "installment"
        : "installment";

      const defaultNotes = willBeFull
        ? isCod
          ? "Pelunasan COD (Bayar di Kasir)"
          : hasInst
          ? "Pelunasan Akhir (Termin)"
          : breakdown.isDp
          ? "Pelunasan Akhir (Sisa DP)"
          : "Pelunasan sisa tagihan"
        : breakdown.paid <= 0
        ? breakdown.isDp
          ? `DP ${effectivePctOfTotal}%`
          : `Pembayaran Termin #1 (${effectivePctOfTotal}%)`
        : `Pembayaran Termin #${payments.filter((p) => p.payment_type === "installment").length + 1}`;

      if (isMultiInvoiceMode && invoiceGroup) {
        const unpaidIds = invoiceGroup.items
          .filter((it) => getExpensePaymentBreakdown(it).remaining > 0)
          .map((it) => it.id);
        const updatedList = await recordInvoicePayment({
          expense_ids: unpaidIds,
          settle_full: payMode === "full",
          dp_percent: payMode === "percent" ? Number(percentVal) : null,
          amount: payMode === "amount" ? Number(amountVal) : null,
          payment_type: effectivePaymentType,
          payment_date: paymentDate,
          pay_method: payMethod,
          bank_account_id: bankAccountId ? Number(bankAccountId) : null,
          reference_no: referenceNo.trim() || null,
          notes: notes.trim() || defaultNotes,
          due_date: !willBeFull && dueDate ? dueDate : null,
        });
        return { updated: updatedList, isInvoice: true };
      }

      const updatedSingle = await recordExpensePayment(activeSingleExpense!.id, {
        settle_full: payMode === "full",
        dp_percent: payMode === "percent" ? Number(percentVal) : null,
        amount: payMode === "amount" ? Number(amountVal) : null,
        payment_type: effectivePaymentType,
        payment_date: paymentDate,
        pay_method: payMethod,
        bank_account_id: bankAccountId ? Number(bankAccountId) : null,
        reference_no: referenceNo.trim() || null,
        notes: notes.trim() || defaultNotes,
        due_date: !willBeFull && dueDate ? dueDate : null,
      });
      return { updated: updatedSingle, isInvoice: false };
    },
    onSuccess: (res) => {
      invalidateAll();
      if (res.isInvoice) {
        onInvoiceUpdated?.();
        if (willBeFull) {
          toast.success(`Seluruh tagihan invoice (${invoiceGroup?.items_count} item) telah lunas.`);
          confetti({
            particleCount: 55,
            spread: 65,
            origin: { y: 0.7 },
          });
        } else {
          toast.success(
            `Pembayaran ${formatRupiah(payAmountNow)} dicatat ke invoice. Sisa: ${formatRupiah(
              remainingAfterPay
            )}.`
          );
        }
        onClose();
        return;
      }

      const updatedExpense = res.updated as Expense;
      if (onPaymentUpdated) onPaymentUpdated(updatedExpense);

      if (updatedExpense.pay_status === "Lunas") {
        toast.success(`Tagihan "${updatedExpense.item_name}" telah lunas sepenuhnya.`);
        confetti({
          particleCount: 55,
          spread: 65,
          origin: { y: 0.7 },
        });
        onClose();
      } else {
        toast.success(
          `Pembayaran ${formatRupiah(payAmountNow)} dicatat. Sisa tagihan: ${formatRupiah(
            updatedExpense.remaining_amount ?? remainingAfterPay
          )}.`
        );
        onClose();
      }
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || "Gagal mencatat pembayaran DP / pelunasan.";
      setFormError(msg);
      toast.error(msg);
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: ({ expId, paymentId }: { expId: number; paymentId: number }) =>
      deleteExpensePayment(expId, paymentId),
    onSuccess: (updatedExpense) => {
      invalidateAll();
      onInvoiceUpdated?.();
      if (!isMultiInvoiceMode && onPaymentUpdated) onPaymentUpdated(updatedExpense);
      toast.info("Riwayat pembayaran dihapus dan sisa tagihan diperbarui.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menghapus riwayat pembayaran.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!activeSingleExpense && !isMultiInvoiceMode) return;

    if (payAmountNow <= 0) {
      setFormError("Nominal pembayaran harus lebih dari Rp 0.");
      return;
    }
    if (payAmountNow > breakdown.remaining + 1) {
      setFormError(
        `Nominal pembayaran (${formatRupiah(payAmountNow)}) melebihi sisa tagihan (${formatRupiah(
          breakdown.remaining
        )}).`
      );
      return;
    }
    if (!willBeFull && (!dueDate || dueDate === "-")) {
      setFormError("Tentukan tanggal jatuh tempo pelunasan untuk sisa tagihan.");
      return;
    }

    recordMutation.mutate();
  };

  if (!activeSingleExpense && !isMultiInvoiceMode) return null;

  const targetDueStr = isMultiInvoiceMode && invoiceGroup
    ? invoiceGroup.due_date
    : activeSingleExpense?.due_date;
  const targetExpenseDate = isMultiInvoiceMode && invoiceGroup
    ? invoiceGroup.expense_date
    : activeSingleExpense?.expense_date || "";
  const targetInvoiceNo = isMultiInvoiceMode && invoiceGroup
    ? invoiceGroup.invoice_number
    : activeSingleExpense?.invoice_number;
  const dueInfo = getDueUrgencyInfo(targetDueStr);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[95vw] sm:max-w-2xl max-h-[92dvh] flex flex-col p-0 overflow-hidden rounded-xl border-border shadow-xl bg-background">
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 py-3.5 border-b border-border/80 bg-background shrink-0 text-left">
          <div className="flex flex-wrap items-start justify-between gap-2 pr-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base font-bold tracking-tight text-foreground">
                  {isCod
                    ? "Pelunasan COD / Bayar di Kasir"
                    : breakdown.isDp
                    ? "DP & Pelunasan Tagihan"
                    : "Cicilan & Pelunasan Hutang (Termin)"}
                </DialogTitle>
                {isMultiInvoiceMode && invoiceGroup ? (
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {invoiceGroup.invoice_number && invoiceGroup.invoice_number !== "-"
                      ? `#${invoiceGroup.invoice_number}`
                      : `${invoiceGroup.items_count} Item`}
                  </Badge>
                ) : activeSingleExpense ? (
                  <Badge variant="outline" className="font-mono text-[11px]">
                    #{activeSingleExpense.id}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {isMultiInvoiceMode && invoiceGroup
                  ? `${invoiceGroup.supplier && invoiceGroup.supplier !== "-" ? invoiceGroup.supplier : "Invoice Gabungan"} (${invoiceGroup.items_count} item)`
                  : activeSingleExpense
                  ? `${activeSingleExpense.item_name}${
                      activeSingleExpense.supplier && activeSingleExpense.supplier !== "-"
                        ? ` (${activeSingleExpense.supplier})`
                        : ""
                    }`
                  : ""}
              </p>
            </div>

            {!breakdown.isPaid && (
              <Badge variant="outline" className={`text-[11px] px-2 py-0.5 ${dueInfo.badgeClass}`}>
                {dueInfo.label}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable Body (Zero Nested Card, Hairline Sections) */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          {/* Progress Summary Strip */}
          <div className="space-y-3 pb-4 border-b border-border/70">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[11px] font-medium text-muted-foreground block">
                  Total Nilai Invoice
                </span>
                <span className="text-sm sm:text-base font-bold text-foreground tabular-nums">
                  {formatRupiah(breakdown.total)}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-muted-foreground block">
                  Sudah Dibayar (DP / Termin)
                </span>
                <span className="text-sm sm:text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatRupiah(breakdown.paid)}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-muted-foreground block">
                  Sisa Pelunasan
                </span>
                <span
                  className={`text-sm sm:text-base font-bold tabular-nums ${
                    breakdown.remaining > 0
                      ? "text-rose-700 dark:text-rose-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {formatRupiah(breakdown.remaining)}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Progres Pembayaran</span>
                <span className="tabular-nums text-foreground font-semibold">
                  {breakdown.progressPct}% Terbayar
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    breakdown.isPaid
                      ? "bg-emerald-600"
                      : breakdown.paid > 0
                      ? "bg-amber-500"
                      : "bg-muted-foreground"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, breakdown.progressPct))}%` }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>Tanggal Nota: {formatDateId(targetExpenseDate)}</span>
              {targetInvoiceNo && targetInvoiceNo !== "-" && (
                <span className="font-mono">No. Invoice: {targetInvoiceNo}</span>
              )}
              {targetDueStr && targetDueStr !== "-" && (
                <span>Tempo Saat Ini: {formatDateId(targetDueStr)}</span>
              )}
            </div>
          </div>

          {/* Payment Form (only if remaining > 0) */}
          {breakdown.remaining > 0 ? (
            <form id="dp-payment-form" onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground block">
                    Pilih Jenis Pembayaran
                  </label>
                  <AdaptiveSelect
                    value={payMode}
                    onValueChange={(val) => {
                      setPayMode(val as "full" | "percent" | "amount");
                      setFormError(null);
                    }}
                    options={[
                      { value: "percent", label: "DP / Persentase (%)" },
                      { value: "amount", label: "Nominal Angka (Rp)" },
                      { value: "full", label: "Lunasi Seluruh Sisa" },
                    ]}
                  />
                </div>

                {payMode === "percent" ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-foreground">
                        Persentase Pembayaran
                      </label>
                      <span className="text-[11px] font-semibold text-foreground tabular-nums">
                        = {formatRupiah(payAmountNow)}
                      </span>
                    </div>
                    <InputGroup className="h-9">
                      <InputGroupInput
                        type="number"
                        min={1}
                        max={100}
                        step="1"
                        value={percentVal}
                        onChange={(e) => setPercentVal(Number(e.target.value))}
                        aria-label="Persentase DP kustom"
                        className="text-xs font-semibold tabular-nums"
                      />
                      <InputGroupAddon align="inline-end" className="pr-2.5">
                        <InputGroupText className="text-xs">%</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                ) : payMode === "amount" ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-foreground">
                        Nominal Pembayaran
                      </label>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        ({effectivePctOfTotal}% dari invoice)
                      </span>
                    </div>
                    <InlineMathInput
                      value={amountVal}
                      onChange={(val) => {
                        setAmountVal(val);
                        setFormError(null);
                      }}
                      inputClassName="font-semibold"
                      placeholder={`Maksimal ${formatRupiah(breakdown.remaining)}`}
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      Nominal Pelunasan
                    </label>
                    <div className="h-9 px-3 rounded-md border border-input bg-muted/40 flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      <span>Lunas Penuh</span>
                      <span>{formatRupiah(breakdown.remaining)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Hairline Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-y border-border/60 text-xs">
                <div>
                  <span className="text-muted-foreground mr-1.5">Dibayar Sekarang:</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {formatRupiah(payAmountNow)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-1.5">Sisa Setelah Bayar:</span>
                  <span className="font-bold text-rose-700 dark:text-rose-400 tabular-nums">
                    {formatRupiah(remainingAfterPay)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-1.5">Status:</span>
                  <span
                    className={`font-bold ${
                      willBeFull
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {willBeFull ? "Lunas" : "DP / Sebagian"}
                  </span>
                </div>
              </div>

              {/* Payment Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground block">
                    Tanggal Bayar
                  </label>
                  <DatePicker
                    value={paymentDate}
                    onChange={(d) => setPaymentDate(toIsoDate(d))}
                    className="w-full h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground block">
                    Metode Pembayaran
                  </label>
                  <AdaptiveSelect
                    value={payMethod}
                    onValueChange={setPayMethod}
                    options={PAYMENT_METHODS}
                  />
                </div>

                {bankAccounts.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground block">
                      Rekening Sumber Dana
                    </label>
                    <AdaptiveSelect
                      value={bankAccountId}
                      onValueChange={setBankAccountId}
                      options={bankAccountOptions}
                      placeholder="Otomatis (Sesuai Mapping Metode)"
                      searchPlaceholder="Cari rekening..."
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground block">
                    No. Referensi / Bukti (Opsional)
                  </label>
                  <Input
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="Contoh: TRF-BCA-1102"
                    className="h-9 text-xs"
                  />
                </div>

                {!willBeFull && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-rose-700 dark:text-rose-400 block">
                      Tanggal Jatuh Tempo Pelunasan Sisa
                    </label>
                    <DatePicker
                      value={dueDate}
                      onChange={(d) => setDueDate(toIsoDate(d))}
                      className="w-full h-9 text-xs"
                    />
                  </div>
                )}

                <div
                  className={`space-y-1 ${
                    bankAccounts.length > 0 && willBeFull ? "sm:col-span-2" : ""
                  }`}
                >
                  <label className="text-xs font-medium text-foreground block">
                    Catatan Pembayaran
                  </label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      willBeFull
                        ? "Contoh: Pelunasan sisa tagihan"
                        : "Contoh: DP tahap 1, sisa dilunasi saat barang tiba"
                    }
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}
            </form>
          ) : (
            <div className="py-3 border-b border-border/70 flex items-center gap-3 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold">Tagihan Ini Sudah Lunas</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Seluruh nilai invoice telah dibayar. Anda tetap dapat meninjau atau menghapus riwayat pembayaran di bawah bila ada kesalahan input.
                </div>
              </div>
            </div>
          )}

          {/* Payment History Timeline (Flat Hairline Rows) */}
          <div className="space-y-2.5 pt-3 border-t border-border/70">
            <h4 className="text-xs font-semibold text-foreground">
              Riwayat Pembayaran ({payments.length})
            </h4>

            {isPaymentsLoading ? (
              <div className="space-y-2" aria-label="Memuat riwayat pembayaran">
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
              </div>
            ) : isPaymentsError ? (
              <div className="text-rose-600 text-xs flex items-center justify-between gap-2">
                <span>Gagal memuat riwayat pembayaran.</span>
                <Button type="button" size="sm" variant="outline" onClick={() => refetchPayments()}>
                  Coba Lagi
                </Button>
              </div>
            ) : payments.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
                Belum ada pembayaran DP atau cicilan yang tercatat untuk tagihan ini.
              </div>
            ) : (
              <div className="divide-y divide-border/60 border-y border-border/60">
                {payments.map((p, idx) => {
                  let typeLabel = `Tahap #${idx + 1}`;
                  if (p.payment_type === "reimbursement") {
                    typeLabel = "Penggantian Talangan";
                  } else if (p.payment_type === "settlement") {
                    typeLabel = isCod
                      ? "Pelunasan COD (Kasir)"
                      : hasInst
                      ? "Pelunasan Akhir (Termin)"
                      : "Pelunasan";
                  } else if (p.payment_type === "dp") {
                    typeLabel = "DP Awal";
                  } else if (p.payment_type === "installment") {
                    const instIdx = payments.filter(
                      (item, i) => i <= idx && item.payment_type === "installment"
                    ).length;
                    typeLabel = `Termin #${instIdx}`;
                  }

                  return (
                    <div
                      key={p.id}
                      className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] font-medium">
                            {typeLabel}
                          </Badge>
                          <span className="text-xs font-bold text-foreground tabular-nums">
                            {formatRupiah(p.amount)}
                          </span>
                          {p.dp_percent !== null && p.dp_percent !== undefined && (
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              ({p.dp_percent}%)
                            </span>
                          )}
                          {isMultiInvoiceMode && invoiceItemNameMap[p.expense_id] && (
                            <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
                              • {invoiceItemNameMap[p.expense_id]}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDateId(p.payment_date)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {p.pay_method}
                            {p.bank_account_name ? ` (${p.bank_account_name})` : ""}
                          </span>
                          {p.reference_no && (
                            <span className="font-mono">Ref: {p.reference_no}</span>
                          )}
                        </div>
                        {p.notes && p.notes !== "-" && (
                          <p className="text-[11px] text-muted-foreground italic">
                            {p.notes}
                          </p>
                        )}
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={deletePaymentMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Hapus pembayaran ${typeLabel} senilai ${formatRupiah(p.amount)}?`
                            )
                          ) {
                            deletePaymentMutation.mutate({
                              expId: p.expense_id,
                              paymentId: p.id,
                            });
                          }
                        }}
                        className="h-8 px-2.5 text-rose-600 hover:text-rose-700 shrink-0 self-end sm:self-center"
                        title="Hapus pembayaran ini"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        <span className="text-[11px] font-medium">Hapus</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-border/80 bg-background shrink-0 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {breakdown.remaining > 0 ? (
              <>
                <span className="text-[11px] font-medium text-muted-foreground block">
                  {willBeFull ? "Pelunasan Penuh" : "Pembayaran DP / Termin"}
                </span>
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {formatRupiah(payAmountNow)}
                </span>
              </>
            ) : (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Status: Lunas
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-9 px-4 text-xs font-medium"
            >
              Tutup
            </Button>
            {breakdown.remaining > 0 && (
              <Button
                type="submit"
                form="dp-payment-form"
                disabled={recordMutation.isPending || payAmountNow <= 0}
                className="h-9 px-5 text-xs font-semibold"
              >
                {recordMutation.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : willBeFull ? (
                  "Simpan Pelunasan"
                ) : (
                  "Simpan DP / Termin"
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
