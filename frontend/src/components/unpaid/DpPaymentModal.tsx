import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BankAccount, Expense, ExpensePayment } from "@/types";
import { deleteExpensePayment, getExpensePayments, recordExpensePayment } from "@/lib/api";
import { formatDateId, formatRupiah, toIsoDate } from "@/lib/formatters";
import { DatePicker } from "@/components/ui/date-picker";
import {
  getDueUrgencyInfo,
  getEndOfMonthDate,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  Loader2,
  Percent,
  Trash2,
  Wallet,
  Package,
  Briefcase,
} from "lucide-react";

interface DpPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  bankAccounts?: BankAccount[];
  initialMode?: "full" | "percent" | "amount";
  onPaymentUpdated?: (updated: Expense) => void;
}

const DP_PRESET_PERCENTS = [20, 30, 50, 70];
const PAYMENT_METHODS = ["Transfer", "Tunai", "QRIS", "Debit", "Kredit"];

export const DpPaymentModal: React.FC<DpPaymentModalProps> = ({
  isOpen,
  onClose,
  expense,
  bankAccounts = [],
  initialMode = "percent",
  onPaymentUpdated,
}) => {
  const queryClient = useQueryClient();

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
    if (!expense) {
      return { total: 0, paid: 0, remaining: 0, progressPct: 0, isPaid: false, isDp: false };
    }
    return getExpensePaymentBreakdown(expense);
  }, [expense]);

  useEffect(() => {
    if (!isOpen || !expense) return;
    const bd = getExpensePaymentBreakdown(expense);
    const defaultMode = bd.isDp ? "full" : initialMode;
    setPayMode(defaultMode);
    setPercentVal(50);
    setAmountVal(defaultMode === "full" ? bd.remaining : Math.round(bd.total * 0.5));
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPayMethod(
      expense.pay_method && expense.pay_method !== "Tempo / Tagihan"
        ? expense.pay_method
        : "Transfer"
    );
    setBankAccountId(expense.bank_account_id ? String(expense.bank_account_id) : "");
    setDueDate(
      expense.due_date && expense.due_date !== "-"
        ? expense.due_date.slice(0, 10)
        : getTempoQuickDate(14)
    );
    setReferenceNo("");
    setNotes("");
    setFormError(null);
  }, [isOpen, expense, initialMode]);

  const {
    data: payments = [],
    isLoading: isPaymentsLoading,
    isError: isPaymentsError,
    refetch: refetchPayments,
  } = useQuery<ExpensePayment[]>({
    queryKey: ["expense-payments", expense?.id],
    queryFn: () => getExpensePayments(expense!.id),
    enabled: isOpen && Boolean(expense?.id),
  });

  // Hitung nominal bayar aktual berdasarkan mode
  const payAmountNow = useMemo(() => {
    if (!expense || breakdown.remaining <= 0) return 0;
    if (payMode === "full") return breakdown.remaining;
    if (payMode === "percent") {
      const pct = Math.max(0, Math.min(100, Number(percentVal || 0)));
      const raw = Math.round(breakdown.total * (pct / 100));
      return Math.min(breakdown.remaining, raw);
    }
    return Math.max(0, Number(amountVal || 0));
  }, [expense, breakdown, payMode, percentVal, amountVal]);

  const remainingAfterPay = Math.max(0, breakdown.remaining - payAmountNow);
  const willBeFull = remainingAfterPay <= 1;
  const effectivePctOfTotal =
    breakdown.total > 0 ? Math.round((payAmountNow / breakdown.total) * 1000) / 10 : 0;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
    queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
    queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
    queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["report"] });
    queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["supplier"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    if (expense?.id) {
      queryClient.invalidateQueries({ queryKey: ["expense-payments", expense.id] });
    }
  };

  const isCod = isCodExpense(expense);
  const hasInst = hasInstallmentHistory({ payments });

  const recordMutation = useMutation({
    mutationFn: () => {
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

      return recordExpensePayment(expense!.id, {
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
    },
    onSuccess: (updatedExpense) => {
      invalidateAll();
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
    mutationFn: (paymentId: number) => deleteExpensePayment(expense!.id, paymentId),
    onSuccess: (updatedExpense) => {
      invalidateAll();
      if (onPaymentUpdated) onPaymentUpdated(updatedExpense);
      toast.info("Riwayat pembayaran dihapus dan sisa tagihan diperbarui.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menghapus riwayat pembayaran.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!expense) return;

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

  if (!expense) return null;

  const dueInfo = getDueUrgencyInfo(expense.due_date);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[95vw] sm:max-w-2xl max-h-[92dvh] flex flex-col p-0 overflow-hidden rounded-2xl sm:rounded-3xl border-slate-200 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-900">
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 shrink-0 text-left">
          <div className="flex flex-wrap items-start justify-between gap-2 pr-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  {isCod ? (
                    <Package className="w-5 h-5 text-amber-600 shrink-0" />
                  ) : (
                    <Wallet className="w-5 h-5 text-amber-600 shrink-0" />
                  )}
                  <span>
                    {isCod
                      ? "Pelunasan COD / Bayar di Kasir"
                      : breakdown.isDp
                      ? "DP & Pelunasan Tagihan"
                      : "Cicilan & Pelunasan Hutang (Termin)"}
                  </span>
                </DialogTitle>
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                >
                  #{expense.id}
                </Badge>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 truncate">
                {expense.item_name}
                {expense.supplier && expense.supplier !== "-" ? ` (${expense.supplier})` : ""}
              </p>
            </div>

            {!breakdown.isPaid && (
              <Badge variant="outline" className={`text-[11px] px-2 py-0.5 ${dueInfo.badgeClass}`}>
                {dueInfo.label}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          {/* Progress Summary Card */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block">
                  Total Nilai Invoice
                </span>
                <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(breakdown.total)}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block">
                  Sudah Dibayar (DP / Termin)
                </span>
                <span className="text-sm sm:text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatRupiah(breakdown.paid)}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block">
                  Sisa Pelunasan
                </span>
                <span
                  className={`text-sm sm:text-base font-extrabold tabular-nums ${
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
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <span>Progres Pembayaran</span>
                <span className="tabular-nums">{breakdown.progressPct}% Terbayar</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    breakdown.isPaid
                      ? "bg-emerald-600"
                      : breakdown.paid > 0
                      ? "bg-amber-500"
                      : "bg-slate-400"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, breakdown.progressPct))}%` }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-200/80 dark:border-slate-700/80">
              <span>Tanggal Nota: {formatDateId(expense.expense_date)}</span>
              {expense.invoice_number && expense.invoice_number !== "-" && (
                <span className="font-mono">No. Invoice: {expense.invoice_number}</span>
              )}
              {expense.due_date && expense.due_date !== "-" && (
                <span>Tempo Saat Ini: {formatDateId(expense.due_date)}</span>
              )}
            </div>
          </div>

          {/* Payment Form (only if remaining > 0) */}
          {breakdown.remaining > 0 ? (
            <form id="dp-payment-form" onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                  Pilih Jenis Pembayaran
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPayMode("percent");
                      setFormError(null);
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      payMode === "percent"
                        ? "bg-amber-700 text-white border-amber-800 shadow-xs"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Percent className="w-3.5 h-3.5" />
                    <span>DP / Persentase (%)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPayMode("amount");
                      setFormError(null);
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      payMode === "amount"
                        ? "bg-amber-700 text-white border-amber-800 shadow-xs"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Nominal Angka (Rp)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPayMode("full");
                      setFormError(null);
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      payMode === "full"
                        ? "bg-emerald-700 text-white border-emerald-800 shadow-xs"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Lunasi Sisa</span>
                  </button>
                </div>
              </div>

              {/* Mode Input */}
              {payMode === "percent" && (
                <div className="p-3.5 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Persentase Pembayaran dari Total Invoice
                    </span>
                    <span className="text-xs font-bold text-amber-900 dark:text-amber-200 tabular-nums">
                      = {formatRupiah(payAmountNow)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {DP_PRESET_PERCENTS.map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setPercentVal(pct)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold border transition-colors ${
                          Number(percentVal) === pct
                            ? "bg-amber-700 text-white border-amber-800"
                            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        {pct}%
                      </button>
                    ))}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        step="1"
                        value={percentVal}
                        onChange={(e) => setPercentVal(Number(e.target.value))}
                        aria-label="Persentase DP kustom"
                        className="w-20 h-10 text-xs font-bold text-center rounded-xl bg-white dark:bg-slate-900"
                      />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">%</span>
                    </div>
                  </div>
                </div>
              )}

              {payMode === "amount" && (
                <div className="p-3.5 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Nominal Pembayaran (bisa ketik rumus, misal 500k)
                    </label>
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                      ({effectivePctOfTotal}% dari invoice)
                    </span>
                  </div>
                  <InlineMathInput
                    value={amountVal}
                    onChange={(val) => {
                      setAmountVal(val);
                      setFormError(null);
                    }}
                    className="h-11 text-sm font-bold rounded-xl bg-white dark:bg-slate-900 tabular-nums"
                    placeholder={`Maksimal ${formatRupiah(breakdown.remaining)}`}
                  />
                </div>
              )}

              {/* Preview Box */}
              <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 block">
                    Dibayar Sekarang
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatRupiah(payAmountNow)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 block">
                    Sisa Setelah Bayar
                  </span>
                  <span className="font-bold text-rose-700 dark:text-rose-400 tabular-nums">
                    {formatRupiah(remainingAfterPay)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 block">
                    Status Setelah Simpan
                  </span>
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

              {/* Tempo Waktu Pelunasan (bila masih ada sisa) */}
              {!willBeFull && (
                <div className="p-3.5 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-bold text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                      <CalendarClock className="w-4 h-4 text-rose-700 dark:text-rose-400" />
                      <span>Tempo Waktu Pelunasan Sisa</span>
                    </label>
                    <span className="text-[11px] font-medium text-rose-800 dark:text-rose-300">
                      Sisa: {formatRupiah(remainingAfterPay)}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <DatePicker
                      value={dueDate}
                      onChange={(d) => setDueDate(toIsoDate(d))}
                      className="h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-slate-900 border-rose-300 dark:border-rose-700 sm:w-44"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { label: "+7 Hari", val: getTempoQuickDate(7, paymentDate) },
                        { label: "+14 Hari", val: getTempoQuickDate(14, paymentDate) },
                        { label: "+30 Hari", val: getTempoQuickDate(30, paymentDate) },
                        { label: "Akhir Bulan", val: getEndOfMonthDate(paymentDate) },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setDueDate(preset.val)}
                          className={`min-h-[38px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                            dueDate === preset.val
                              ? "bg-rose-700 text-white border-rose-800"
                              : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-rose-200 dark:border-rose-800 hover:bg-rose-100"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Payment Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-1">
                    Tanggal Bayar
                  </label>
                  <DatePicker
                    value={paymentDate}
                    onChange={(d) => setPaymentDate(toIsoDate(d))}
                    className="w-full h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-1">
                    Metode Pembayaran
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="h-11 sm:h-10 w-full rounded-xl border border-input bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>

                {bankAccounts.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-1">
                      Rekening Sumber Dana
                    </label>
                    <select
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      className="h-11 sm:h-10 w-full rounded-xl border border-input bg-white dark:bg-slate-900 px-3 text-xs font-medium text-slate-800 dark:text-slate-200"
                    >
                      <option value="">Otomatis (Sesuai Mapping Metode)</option>
                      {bankAccounts.map((acc) => (
                        <option key={acc.id} value={String(acc.id)}>
                          {acc.name} ({acc.account_code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-1">
                    No. Referensi / Bukti (Opsional)
                  </label>
                  <Input
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="Contoh: TRF-BCA-1102"
                    className="h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-slate-900"
                  />
                </div>

                <div className={bankAccounts.length > 0 ? "sm:col-span-2" : ""}>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-1">
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
                    className="h-11 sm:h-10 text-xs rounded-xl bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-200 text-xs flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}
            </form>
          ) : (
            <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/20 flex items-center gap-3 text-xs text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <div>
                <div className="font-bold">Tagihan Ini Sudah Lunas</div>
                <div className="text-[11px] mt-0.5">
                  Seluruh nilai invoice telah dibayar. Anda tetap dapat meninjau atau menghapus riwayat pembayaran di bawah bila ada kesalahan input.
                </div>
              </div>
            </div>
          )}

          {/* Payment History Timeline */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <History className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                <span>Riwayat Pembayaran ({payments.length})</span>
              </h4>
            </div>

            {isPaymentsLoading ? (
              <div className="space-y-2" aria-label="Memuat riwayat pembayaran">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : isPaymentsError ? (
              <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center justify-between gap-2">
                <span>Gagal memuat riwayat pembayaran.</span>
                <Button type="button" size="sm" variant="outline" onClick={() => refetchPayments()}>
                  Coba Lagi
                </Button>
              </div>
            ) : payments.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-600 dark:text-slate-300">
                Belum ada pembayaran DP atau cicilan yang tercatat untuk tagihan ini.
              </div>
            ) : (
              <div className="space-y-2">
                {payments.map((p, idx) => {
                  let typeLabel = `Tahap #${idx + 1}`;
                  let typeClass = "bg-slate-50 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200";

                  if (p.payment_type === "reimbursement") {
                    typeLabel = "Penggantian Talangan";
                    typeClass = "bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-800";
                  } else if (p.payment_type === "settlement") {
                    typeLabel = isCod ? "Pelunasan COD (Kasir)" : hasInst ? "Pelunasan Akhir (Termin)" : "Pelunasan";
                    typeClass = "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800";
                  } else if (p.payment_type === "dp") {
                    typeLabel = "DP Awal";
                    typeClass = "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800";
                  } else if (p.payment_type === "installment") {
                    const instIdx = payments.filter((item, i) => i <= idx && item.payment_type === "installment").length;
                    typeLabel = `Termin #${instIdx}`;
                    typeClass = "bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800";
                  }

                  return (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] font-bold ${typeClass}`}>
                            {typeLabel}
                          </Badge>
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                            {formatRupiah(p.amount)}
                          </span>
                          {p.dp_percent !== null && p.dp_percent !== undefined && (
                            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                              ({p.dp_percent}%)
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDateId(p.payment_date)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {p.pay_method}
                            {p.bank_account_name ? ` (${p.bank_account_name})` : ""}
                          </span>
                          {p.reference_no && <span className="font-mono">Ref: {p.reference_no}</span>}
                        </div>
                        {p.notes && p.notes !== "-" && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 italic">
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
                            deletePaymentMutation.mutate(p.id);
                          }
                        }}
                        className="min-h-[40px] sm:min-h-[34px] px-2.5 text-rose-700 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40 rounded-lg shrink-0 self-end sm:self-center"
                        title="Hapus pembayaran ini"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        <span className="text-[11px] font-semibold">Hapus</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 shrink-0 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {breakdown.remaining > 0 ? (
              <>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 block">
                  {willBeFull ? "Pelunasan Penuh" : "Pembayaran DP / Termin"}
                </span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
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
              className="min-h-[44px] sm:min-h-[40px] px-4 rounded-xl text-xs font-semibold"
            >
              Tutup
            </Button>
            {breakdown.remaining > 0 && (
              <Button
                type="submit"
                form="dp-payment-form"
                disabled={recordMutation.isPending || payAmountNow <= 0}
                className={`min-h-[44px] sm:min-h-[40px] px-5 rounded-xl text-xs font-bold text-white shadow-xs ${
                  willBeFull
                    ? "bg-emerald-700 hover:bg-emerald-800"
                    : "bg-amber-700 hover:bg-amber-800"
                }`}
              >
                {recordMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
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
