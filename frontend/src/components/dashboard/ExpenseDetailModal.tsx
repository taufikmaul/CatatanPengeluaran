import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Expense, ExpenseLog, ExpensePayment } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink, copyToClipboard } from "@/lib/telegram";
import {
  getExpensePaymentBreakdown,
  isCodExpense,
  isReimbursementExpense,
  hasInstallmentHistory,
} from "@/lib/paymentStatus";
import { getExpenseLogs, getExpensePayments, settleReimbursements } from "@/lib/api";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExternalLink,
  Copy,
  Check,
  Calendar,
  Store,
  Receipt,
  Tag,
  CreditCard,
  Clock,
  CheckCircle2,
  CheckCheck,
  FileText,
  LineChart,
  Edit2,
  Briefcase,
  AlertCircle,
  HelpCircle,
  Laptop,
  User as UserIcon,
  History,
  Activity,
  ArrowRight,
  Package,
} from "lucide-react";

interface ExpenseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  onEditExpense?: (expense: Expense) => void;
  onInspectItemPrice?: (itemName: string, itemId?: number | null) => void;
  onOpenPaymentModal?: (expense: Expense, mode?: "full" | "percent" | "amount") => void;
}

export const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
  isOpen,
  onClose,
  expense,
  onEditExpense,
  onInspectItemPrice,
  onOpenPaymentModal,
}) => {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<ExpenseLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [payments, setPayments] = useState<ExpensePayment[]>(expense?.payments || []);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [isSettleLoading, setIsSettleLoading] = useState(false);

  useEffect(() => {
    if (isOpen && expense?.id) {
      setIsLoadingLogs(true);
      getExpenseLogs(expense.id)
        .then((data) => setLogs(data || []))
        .catch(() => setLogs([]))
        .finally(() => setIsLoadingLogs(false));

      setIsLoadingPayments(true);
      getExpensePayments(expense.id)
        .then((data) => setPayments(data || []))
        .catch(() => setPayments(expense.payments || []))
        .finally(() => setIsLoadingPayments(false));
    } else {
      setLogs([]);
      setPayments([]);
    }
  }, [isOpen, expense?.id, expense?.payments]);

  if (!expense) return null;

  const handleSettleReimbursement = async (action: "mark_reimbursed" | "unmark") => {
    if (!expense) return;
    try {
      setIsSettleLoading(true);
      await settleReimbursements({
        expense_ids: [expense.id],
        action,
      });
      toast.success(
        action === "mark_reimbursed"
          ? `Talangan "${expense.item_name}" berhasil ditandai sudah diganti.`
          : `Status penggantian talangan dibatalkan.`
      );
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["reimbursements-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });

      // Update local state and refetch payments
      expense.reimbursed_at = action === "mark_reimbursed" ? new Date().toISOString() : null;
      const newPayments = await getExpensePayments(expense.id);
      setPayments(newPayments || []);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal mengubah status penggantian talangan");
    } finally {
      setIsSettleLoading(false);
    }
  };

  const tgInfo = parseTelegramLink(expense.msg_link);
  const catColor = getCategoryColor(expense.category);
  const bd = getExpensePaymentBreakdown(expense);
  const isLunas = bd.isPaid;
  const isCod = isCodExpense(expense);
  const hasInstallments = hasInstallmentHistory({ payments });
  const hasDpHistory =
    payments.some((p) => p.payment_type === "dp") ||
    (expense.payments_count || 0) > 1 ||
    Boolean(expense.dp_type || (expense.dp_percent && Number(expense.dp_percent) > 0));

  const formatActorLabel = (actor: string) => {
    if (!actor) return "Sistem";
    if (actor.startsWith("telegram:")) {
      const tgId = actor.replace("telegram:", "");
      return `Telegram (User #${tgId})`;
    }
    if (actor === "dashboard:admin") return "Web Dashboard (Admin)";
    if (actor === "dashboard:admin_input") return "Web Dashboard (Admin Input)";
    if (actor.startsWith("dashboard:")) return `Web Dashboard (${actor.replace("dashboard:", "")})`;
    if (actor === "import:csv") return "Impor CSV";
    if (actor === "sync:sheets") return "Sinkronisasi Sheets";
    if (actor === "system") return "Sistem Otomatis";
    return actor;
  };

  const formatFieldLabel = (field: string) => {
    const map: Record<string, string> = {
      pay_status: "Status Bayar",
      total_price: "Total Harga",
      unit_price: "Harga Satuan",
      qty: "Jumlah (Qty)",
      item_name: "Nama Barang",
      supplier: "Toko / Supplier",
      category: "Kategori",
      expense_date: "Tanggal Nota",
      notes: "Catatan",
      invoice_number: "No. Invoice",
      is_reimbursement: "Status Reimburse",
      reimbursed_at: "Waktu Ganti Talangan",
    };
    return map[field] || field;
  };

  const formatValue = (field: string, val: any) => {
    if (val === null || val === undefined || val === "") return "-";
    if (field.includes("price") || field === "total_price" || field === "unit_price") {
      const num = Number(val);
      return !isNaN(num) ? formatRupiah(num) : String(val);
    }
    if (field === "is_reimbursement") {
      return val === true || val === "true" ? "Ya (Ditalangi)" : "Tidak (Reguler)";
    }
    return String(val);
  };

  const handleCopyLink = async () => {
    if (!tgInfo.url) return;
    const ok = await copyToClipboard(tgInfo.url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEdit = () => {
    onClose();
    if (onEditExpense) {
      onEditExpense(expense);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 sm:p-7">
        <DialogHeader className="mb-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-slate-700" />
              <DialogTitle className="text-lg font-bold text-slate-900">
                Detail Transaksi
              </DialogTitle>
              <Badge variant="outline" className="font-mono text-xs text-slate-500">
                #{expense.id}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                  isLunas
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : bd.isDp
                    ? "bg-amber-50 text-amber-800 border-amber-300"
                    : "bg-rose-50 text-rose-700 border-rose-200"
                }`}
              >
                {isLunas ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Lunas</span>
                  </>
                ) : bd.isDp ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-amber-700" />
                    <span>DP {Math.round(bd.progressPct)}%</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5 text-rose-600" />
                    <span>Belum Lunas</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* ── KOTAK CROSS CHECK TELEGRAM CHAT (Highlight Section) ── */}
        <div className="mt-2">
          {tgInfo.isUrl ? (
            <div className="p-4 bg-gradient-to-r from-sky-50 via-blue-50/70 to-indigo-50/50 border border-sky-200/90 rounded-2xl shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#229ED9] text-white flex items-center justify-center shrink-0 shadow-sm shadow-sky-500/20">
                    <TelegramIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-sky-950">
                        Chat Telegram Tersambung
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-sky-100 text-sky-800 rounded-md border border-sky-200">
                        {tgInfo.badgeLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-sky-700 mt-0.5">
                      {expense.user_name ? `Nota ini dikirim oleh ${expense.user_name}. ` : ""}
                      Klik tombol di bawah untuk cross check langsung dengan pesan & foto nota asli.
                    </p>
                  </div>
                </div>
              </div>

              {/* URL Display Box */}
              <div className="p-2.5 bg-white/90 border border-sky-100 rounded-xl flex items-center justify-between gap-2 mb-3">
                <span className="text-[11px] font-mono text-slate-600 truncate select-all">
                  {tgInfo.url}
                </span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  title="Salin tautan Telegram"
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600 font-semibold">Tersalin!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Salin</span>
                    </>
                  )}
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <a
                  href={tgInfo.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#229ED9] hover:bg-[#1d8ec4] text-white text-xs font-semibold shadow-sm transition-all active:scale-[0.99]"
                >
                  <TelegramIcon className="w-4 h-4" />
                  <span>Buka Pesan di Telegram</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </a>
              </div>
            </div>
          ) : tgInfo.sourceType === "telegram_private" ? (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                <TelegramIcon className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <span className="font-semibold text-slate-800 block">
                  Dicatat via Private Chat Telegram
                </span>
                <p className="text-slate-500 text-[11px] mt-0.5">
                  Transaksi ini dikirim melalui percakapan pribadi langsung dengan bot (bukan dalam grup/topik publik), sehingga tidak memiliki tautan web publik.
                </p>
              </div>
            </div>
          ) : tgInfo.sourceType === "web" ? (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <Laptop className="w-3.5 h-3.5" />
              </div>
              <div className="text-xs">
                <span className="font-semibold text-slate-800">
                  Dicatat via Web Dashboard
                </span>
                <span className="text-slate-500 text-[11px] block">
                  Data pengeluaran dimasukkan secara langsung melalui formulir dashboard.
                </span>
              </div>
            </div>
          ) : tgInfo.sourceType === "csv" ? (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div className="text-xs">
                <span className="font-semibold text-slate-800">
                  Diimpor dari File CSV
                </span>
                <span className="text-slate-500 text-[11px] block">
                  Data pengeluaran dimasukkan melalui fitur migrasi/impor spreadsheet.
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── RINCIAN BARANG & BIAYA ── */}
        <div className="space-y-4 pt-1">
          {/* Item Name & Price History trigger */}
          <div className="p-4 bg-slate-50/80 border border-slate-100 rounded-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Nama Barang / Keperluan
                </span>
                <div className="text-base font-bold text-slate-900 leading-snug">
                  {expense.item_name}
                </div>
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${catColor.bg} ${catColor.border}`}
                  >
                    {expense.category || "Operasional"}
                  </span>
                  {expense.is_reimbursement && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      <Briefcase className="w-3 h-3 text-amber-600" />
                      <span>Reimbursement (Ditalangi)</span>
                    </span>
                  )}
                </div>
              </div>

              {onInspectItemPrice && (
                <button
                  type="button"
                  onClick={() => onInspectItemPrice(expense.item_name, expense.master_item_id)}
                  title="Lihat riwayat harga & perbandingan toko"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-blue-600 hover:bg-blue-50/50 hover:border-blue-200 shadow-sm transition-all shrink-0"
                >
                  <LineChart className="w-3.5 h-3.5" />
                  <span>Riwayat Harga</span>
                </button>
              )}
            </div>

            {/* Total Highlight */}
            <div className="mt-4 pt-3 border-t border-slate-200/70 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 font-medium block">
                  Total Biaya Transaksi
                </span>
                <span className="text-xs text-slate-500">
                  {expense.qty} {expense.unit || "Pcs"} x {formatRupiah(expense.unit_price)}
                  {Number(expense.shipping_fee) > 0 ? ` + Ongkir ${formatRupiah(expense.shipping_fee)}` : ""}
                  {Number(expense.tax) > 0 ? ` + Pajak ${formatRupiah(expense.tax)}` : ""}
                  {Number(expense.other_fee) > 0 ? ` + Biaya Lain ${formatRupiah(expense.other_fee)}` : ""}
                  {Number(expense.discount) > 0 ? ` - Diskon ${formatRupiah(expense.discount)}` : ""}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xl font-extrabold text-slate-900 tabular-nums">
                  {formatRupiah(expense.total_price)}
                </span>
              </div>
            </div>

            {/* Ringkasan Status Pembayaran / DP */}
            {hasDpHistory && bd.isPaid ? (
              <div className="mt-3 pt-3 border-t border-emerald-200/80 space-y-1.5 text-xs bg-emerald-50/70 p-2.5 rounded-xl">
                <div className="flex items-center justify-between text-emerald-900 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Status Transaksi:</span>
                  </span>
                  <span className="font-bold text-emerald-700">Lunas (DP Telah Dilunasi)</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>Total Tagihan:</span>
                  <span className="font-bold text-slate-800 tabular-nums">{formatRupiah(bd.total)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-800">
                  <span>Track Record Pelunasan:</span>
                  <span className="font-semibold">{payments.length > 0 ? `${payments.length} tahap pembayaran` : "Tercatat lunas"}</span>
                </div>
              </div>
            ) : bd.isDp ? (
              <div className="mt-3 pt-3 border-t border-amber-200/80 space-y-1.5 text-xs bg-amber-50/70 p-2.5 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Sudah Dibayar (DP / Termin):</span>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    {formatRupiah(bd.paid)} ({bd.progressPct}%)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Sisa Pelunasan:</span>
                  <span className="font-bold text-rose-700 tabular-nums">
                    {formatRupiah(bd.remaining)}
                  </span>
                </div>
                {expense.due_date && expense.due_date !== "-" && (
                  <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1 border-t border-amber-200/60">
                    <span>Jatuh Tempo Pelunasan:</span>
                    <span className="font-semibold text-amber-900">{formatDateId(expense.due_date)}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Grid Informasi Detail */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Toko / Supplier */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <Store className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-500 text-[11px] block font-medium">Toko / Supplier</span>
                <span className="font-semibold text-slate-800 text-xs">
                  {expense.supplier || "-"}
                </span>
              </div>
            </div>

            {/* No. Invoice */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <Receipt className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-500 text-[11px] block font-medium">No. Invoice / Nota</span>
                <span className="font-semibold text-slate-800 text-xs font-mono">
                  {expense.invoice_number && expense.invoice_number !== "-"
                    ? `#${expense.invoice_number}`
                    : "-"}
                </span>
              </div>
            </div>

            {/* Tanggal Nota */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-500 text-[11px] block font-medium">Tanggal Transaksi</span>
                <span className="font-semibold text-slate-800 text-xs">
                  {formatDateId(expense.expense_date, true)}
                </span>
              </div>
            </div>

            {/* Metode Bayar */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <CreditCard className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-500 text-[11px] block font-medium">Metode Pembayaran</span>
                <span className="font-semibold text-slate-800 text-xs">
                  {expense.pay_method || "Tunai"}
                </span>
              </div>
            </div>

            {/* Penginput Invoice / Nota */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5 sm:col-span-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 text-[11px] block font-medium">Diinput Oleh</span>
                  {expense.user_name ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      User Terdaftar
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                      Web Dashboard / Import
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-bold text-slate-900 text-sm">
                    {expense.user_name || "Tanpa Atribusi User"}
                  </span>
                  {expense.user_id && (
                    <span className="text-[11px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                      User #{expense.user_id}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Rincian Biaya Tambahan & Diskon jika ada */}
            {(Number(expense.shipping_fee || 0) > 0 ||
              Number(expense.tax || 0) > 0 ||
              Number(expense.other_fee || 0) > 0 ||
              Number(expense.discount || 0) > 0) && (
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl sm:col-span-2">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-2">
                  Komponen Ongkir, Pajak, Biaya Lain & Diskon
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-500 block font-medium">Ongkir</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupiah(expense.shipping_fee || 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-500 block font-medium">Pajak</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupiah(expense.tax || 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-500 block font-medium">Biaya Lain</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupiah(expense.other_fee || 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-500 block font-medium">Diskon</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">
                      {Number(expense.discount || 0) > 0 ? `-${formatRupiah(expense.discount || 0)}` : "Rp 0"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Status Jatuh Tempo jika Hutang */}
            {!isLunas && expense.due_date && expense.due_date !== "-" && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 sm:col-span-2">
                <Clock className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-rose-700 text-[11px] block font-semibold">Jatuh Tempo Pembayaran</span>
                  <span className="font-bold text-rose-900 text-xs">
                    {formatDateId(expense.due_date, true)}
                  </span>
                </div>
              </div>
            )}

            {/* Status Transaksi COD */}
            {isCod && (
              <div
                className={`p-3.5 border rounded-2xl flex items-start justify-between gap-3 sm:col-span-2 ${
                  bd.isPaid
                    ? "bg-emerald-50/70 border-emerald-200/90 text-emerald-950"
                    : "bg-amber-50/70 border-amber-200/90 text-amber-950"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <Package
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      bd.isPaid ? "text-emerald-600" : "text-amber-600"
                    }`}
                  />
                  <div className="text-xs">
                    <span className="font-bold block">
                      {bd.isPaid ? "Transaksi COD Selesai (Kasir)" : "Transaksi COD (Menunggu Kurir)"}
                    </span>
                    <p className="text-[11px] mt-0.5 opacity-90">
                      {bd.isPaid
                        ? "Barang COD telah tiba di kasir dan pembayaran telah dilunasi."
                        : "Barang dibeli via COD. Pembayaran dilakukan oleh kasir saat paket diantar kurir."}
                    </p>
                  </div>
                </div>

                {!bd.isPaid && onOpenPaymentModal && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpenPaymentModal(expense, "full")}
                    className="h-7 px-3 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shrink-0 shadow-2xs"
                  >
                    Bayar COD Kasir
                  </Button>
                )}
              </div>
            )}

            {/* Status Reimbursement Detail */}
            {expense.is_reimbursement && (
              <div
                className={`p-3.5 border rounded-2xl flex items-start justify-between gap-3 sm:col-span-2 ${
                  expense.reimbursed_at
                    ? "bg-purple-50/70 border-purple-200/90 text-purple-950"
                    : "bg-amber-50/70 border-amber-200/90 text-amber-950"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <Briefcase
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      expense.reimbursed_at ? "text-purple-600" : "text-amber-600"
                    }`}
                  />
                  <div className="text-xs">
                    <span className="font-bold block">
                      {expense.reimbursed_at
                        ? "Talangan Karyawan Telah Diganti"
                        : "Uang Talangan Belum Diganti"}
                    </span>
                    <p className="text-[11px] mt-0.5 opacity-90">
                      {expense.reimbursed_at
                        ? `Telah diganti oleh Owner/Admin pada ${formatDateId(expense.reimbursed_at, true)}.`
                        : "Karyawan menggunakan uang pribadi untuk pembelian ini. Perlu diganti oleh Owner/Admin."}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {expense.reimbursed_at ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isSettleLoading}
                      onClick={() => handleSettleReimbursement("unmark")}
                      className="h-7 px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 border-rose-300 rounded-lg"
                    >
                      {isSettleLoading ? "Memproses..." : "Batalkan Ganti"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSettleLoading}
                      onClick={() => handleSettleReimbursement("mark_reimbursed")}
                      className="h-7 px-3 text-[11px] font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-2xs"
                    >
                      {isSettleLoading ? "Menyimpan..." : "Ganti Talangan"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Catatan Tambahan */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5 sm:col-span-2">
              <FileText className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="w-full">
                <span className="text-slate-500 text-[11px] block font-medium">Catatan / Keterangan</span>
                <p className="font-normal text-slate-700 text-xs mt-0.5 whitespace-pre-wrap">
                  {expense.notes && expense.notes !== "-" ? expense.notes : "Tidak ada catatan."}
                </p>
              </div>
            </div>

            {/* Track Record Pembayaran & Pelunasan */}
            <div className="p-3.5 bg-slate-50/90 border border-slate-200/90 rounded-2xl sm:col-span-2">
              <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>Track Record Pembayaran & Pelunasan</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {expense.is_reimbursement ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold ${
                        expense.reimbursed_at
                          ? "bg-purple-50 text-purple-800 border-purple-300"
                          : "bg-amber-50 text-amber-800 border-amber-300"
                      }`}
                    >
                      {expense.reimbursed_at ? "💼 Talangan Diganti" : "💼 Ditalangi (Belum Diganti)"}
                    </Badge>
                  ) : isCod ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold ${
                        bd.isPaid
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                          : "bg-amber-50 text-amber-800 border-amber-300"
                      }`}
                    >
                      {bd.isPaid ? "📦 COD Dilunasi" : "📦 COD (Belum Bayar)"}
                    </Badge>
                  ) : hasInstallments ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold ${
                        bd.isPaid
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                          : "bg-blue-50 text-blue-800 border-blue-300"
                      }`}
                    >
                      {bd.isPaid ? "Termin Lunas" : `Termin Terbayar ${bd.progressPct}%`}
                    </Badge>
                  ) : bd.isPaid ? (
                    <Badge variant="outline" className="text-[10px] font-bold bg-emerald-50 text-emerald-800 border-emerald-300">
                      {hasDpHistory ? "Lunas (DP + Pelunasan)" : "Lunas Penuh"}
                    </Badge>
                  ) : bd.isDp ? (
                    <Badge variant="outline" className="text-[10px] font-bold bg-amber-50 text-amber-800 border-amber-300">
                      DP Terbayar {bd.progressPct}%
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-bold bg-rose-50 text-rose-800 border-rose-300">
                      Belum Lunas
                    </Badge>
                  )}
                  {onOpenPaymentModal && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenPaymentModal(expense, bd.isDp ? "full" : "percent")}
                      className="h-7 px-2.5 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-300 rounded-lg shadow-2xs"
                    >
                      {bd.remaining > 0 ? (isCod ? "Bayar COD" : hasInstallments ? "Bayar Termin" : "Catat Pelunasan") : "Kelola Riwayat"}
                    </Button>
                  )}
                </div>
              </div>

              {isLoadingPayments ? (
                <div className="text-center py-3 text-xs text-slate-400">Memuat track record pembayaran...</div>
              ) : payments.length > 0 ? (
                <div className="space-y-2">
                  {payments.map((p, idx) => {
                    const isReimbursement = p.payment_type === "reimbursement";
                    const isSettlement = p.payment_type === "settlement";
                    const isDp = p.payment_type === "dp";
                    const isInstallment = p.payment_type === "installment";

                    let typeLabel = `Tahap #${idx + 1}`;
                    let badgeClass = "bg-slate-50 text-slate-800 border-slate-300";
                    let cardBorderClass = "border-slate-200";

                    if (isReimbursement) {
                      typeLabel = "Penggantian Talangan";
                      badgeClass = "bg-purple-50 text-purple-800 border-purple-300";
                      cardBorderClass = "border-purple-200";
                    } else if (isSettlement) {
                      typeLabel = isCod
                        ? "Pelunasan COD (Kasir)"
                        : hasInstallments
                        ? "Pelunasan Akhir (Termin)"
                        : hasDpHistory
                        ? "Pelunasan Akhir (DP)"
                        : "Pelunasan Akhir";
                      badgeClass = "bg-emerald-50 text-emerald-800 border-emerald-300";
                      cardBorderClass = "border-emerald-200";
                    } else if (isDp) {
                      typeLabel = "DP Awal";
                      badgeClass = "bg-amber-50 text-amber-800 border-amber-300";
                      cardBorderClass = "border-amber-200";
                    } else if (isInstallment) {
                      const instIdx = payments.filter((item, i) => i <= idx && item.payment_type === "installment").length;
                      typeLabel = `Termin #${instIdx}`;
                      badgeClass = "bg-blue-50 text-blue-800 border-blue-300";
                      cardBorderClass = "border-blue-200";
                    }

                    return (
                      <div
                        key={p.id}
                        className={`p-2.5 rounded-xl border text-xs bg-white shadow-2xs ${cardBorderClass}`}
                      >
                        <div className="flex items-center justify-between gap-1 flex-wrap mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeClass}`}>
                              {typeLabel}
                            </span>
                            <span className="font-extrabold text-slate-900 tabular-nums">
                              {formatRupiah(p.amount)}
                            </span>
                            {p.dp_percent !== null && p.dp_percent !== undefined && (
                              <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                                ({p.dp_percent}%)
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-medium inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {formatDateId(p.payment_date)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 mt-1">
                          <span className="inline-flex items-center gap-1">
                            {isReimbursement ? (
                              <Briefcase className="w-3 h-3 text-purple-600" />
                            ) : isCod ? (
                              <Package className="w-3 h-3 text-amber-600" />
                            ) : (
                              <CreditCard className="w-3 h-3 text-slate-400" />
                            )}
                            <span>{p.pay_method}</span>
                            {p.bank_account_name && (
                              <span className="text-slate-500 font-medium">({p.bank_account_name})</span>
                            )}
                          </span>
                          {p.reference_no && (
                            <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">
                              Ref: {p.reference_no}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">
                            Dicatat oleh: {formatActorLabel(p.actor)}
                          </span>
                        </div>

                        {p.notes && p.notes !== "-" && (
                          <p className="mt-1 text-[11px] text-slate-600 italic bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                            {p.notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : bd.isPaid ? (
                <div className="p-3 rounded-xl border border-emerald-200 bg-white text-xs space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Pembayaran Penuh (Lunas Langsung)</span>
                    </span>
                    <span className="font-extrabold text-emerald-800 tabular-nums">
                      {formatRupiah(expense.total_price)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5 border-t border-emerald-100">
                    <span>Tanggal: {formatDateId(expense.expense_date)}</span>
                    <span>Metode: {expense.pay_method || "Tunai"}</span>
                    <span>Status: Lunas 100%</span>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-dashed border-slate-300 bg-white text-center text-xs text-slate-500">
                  <span>Belum ada pembayaran yang tercatat untuk tagihan ini.</span>
                  {expense.due_date && expense.due_date !== "-" && (
                    <div className="text-[11px] text-rose-600 font-semibold mt-0.5">
                      Jatuh Tempo: {formatDateId(expense.due_date)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Riwayat Log & Perubahan Data (Audit Trail) */}
            <div className="p-3.5 bg-slate-50/80 border border-slate-200/90 rounded-2xl sm:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <History className="w-4 h-4 text-indigo-600" />
                  <span>Riwayat Perubahan & Log Aksi</span>
                </div>
                <Badge variant="outline" className="text-[10px] font-medium bg-white text-slate-600">
                  {isLoadingLogs ? "Memuat..." : `${logs.length} catatan`}
                </Badge>
              </div>

              {isLoadingLogs ? (
                <div className="text-center py-3 text-xs text-slate-400">Memuat log aktivitas...</div>
              ) : logs.length === 0 ? (
                <div className="text-center py-2 text-xs text-slate-400">Belum ada riwayat perubahan yang tercatat.</div>
              ) : (
                <div className="space-y-2 mt-2 max-h-56 overflow-y-auto pr-1">
                  {logs.map((log) => {
                    let parsed: any = null;
                    try {
                      parsed = log.details ? JSON.parse(log.details) : null;
                    } catch {}

                    const actionColor =
                      log.action === "CREATE"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : log.action === "DELETE"
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : log.action === "STATUS_CHANGE"
                        ? "bg-purple-50 text-purple-700 border-purple-200"
                        : "bg-blue-50 text-blue-700 border-blue-200";

                    const actionLabel =
                      log.action === "CREATE"
                        ? "Dicatat Baru"
                        : log.action === "DELETE"
                        ? "Dihapus"
                        : log.action === "STATUS_CHANGE"
                        ? "Status Berubah"
                        : "Data Diedit";

                    return (
                      <div
                        key={log.id}
                        className="bg-white border border-slate-200/70 rounded-xl p-2.5 text-xs shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-1 flex-wrap mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${actionColor}`}>
                              {actionLabel}
                            </span>
                            <span className="text-[11px] font-medium text-slate-700">
                              {formatActorLabel(log.actor)}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {formatDateId(log.created_at, true)}
                          </span>
                        </div>

                        {/* Rincian perubahan jika ada diff */}
                        {parsed?.changes && Object.keys(parsed.changes).length > 0 && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1">
                            {Object.entries(parsed.changes).map(([field, diff]: [string, any]) => (
                              <div
                                key={field}
                                className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50/70 px-2 py-0.5 rounded"
                              >
                                <span className="font-semibold text-slate-700">
                                  {formatFieldLabel(field)}:
                                </span>
                                <span className="line-through text-slate-400">
                                  {formatValue(field, diff.old)}
                                </span>
                                <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="font-semibold text-slate-900">
                                  {formatValue(field, diff.new)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Keterangan create awal jika tidak ada diff */}
                        {log.action === "CREATE" && parsed && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            Dicatat untuk {parsed.item_name || "Barang"} senilai {formatRupiah(parsed.total_price || 0)} ({parsed.supplier || "-"})
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Timestamp Info */}
          <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 pt-1">
            <span>
              Waktu dicatat: {expense.created_at ? formatDateId(expense.created_at, true) : "-"}
            </span>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="flex items-center justify-between gap-2 pt-4 mt-2 border-t border-slate-100">
          <div>
            {tgInfo.isUrl && tgInfo.url && (
              <a
                href={tgInfo.url || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-sky-700 hover:text-sky-800 hover:bg-sky-50 transition-colors"
              >
                <TelegramIcon className="w-3.5 h-3.5 text-[#229ED9]" />
                <span>Buka Telegram</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-xl text-xs h-9 px-4"
            >
              Tutup
            </Button>
            <Button
              type="button"
              onClick={handleEdit}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-9 px-4 font-semibold flex items-center gap-1.5"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Edit Transaksi</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
