import React, { useState } from "react";
import { Expense } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink, copyToClipboard } from "@/lib/telegram";
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
  FileText,
  LineChart,
  Edit2,
  Briefcase,
  AlertCircle,
  HelpCircle,
  Laptop,
} from "lucide-react";

interface ExpenseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  onEditExpense?: (expense: Expense) => void;
  onInspectItemPrice?: (itemName: string) => void;
}

export const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
  isOpen,
  onClose,
  expense,
  onEditExpense,
  onInspectItemPrice,
}) => {
  const [copied, setCopied] = useState(false);

  if (!expense) return null;

  const tgInfo = parseTelegramLink(expense.msg_link);
  const catColor = getCategoryColor(expense.category);
  const isLunas = (expense.pay_status || "").toLowerCase().includes("lunas");

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
              <span className="text-xl">🧾</span>
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
                    : "bg-rose-50 text-rose-700 border-rose-200"
                }`}
              >
                {isLunas ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Lunas</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
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
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
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
                <span className="text-slate-400 text-[11px] block">
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
                <span className="text-slate-400 text-[11px] block">
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
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
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
                  onClick={() => onInspectItemPrice(expense.item_name)}
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
                <span className="text-xs text-slate-400">
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
          </div>

          {/* Grid Informasi Detail */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Toko / Supplier */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <Store className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">Toko / Supplier</span>
                <span className="font-semibold text-slate-800 text-xs">
                  {expense.supplier || "-"}
                </span>
              </div>
            </div>

            {/* No. Invoice */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <Receipt className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">No. Invoice / Nota</span>
                <span className="font-semibold text-slate-800 text-xs font-mono">
                  {expense.invoice_number && expense.invoice_number !== "-"
                    ? `#${expense.invoice_number}`
                    : "-"}
                </span>
              </div>
            </div>

            {/* Tanggal Nota */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">Tanggal Transaksi</span>
                <span className="font-semibold text-slate-800 text-xs">
                  {formatDateId(expense.expense_date, true)}
                </span>
              </div>
            </div>

            {/* Metode Bayar */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5">
              <CreditCard className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">Metode Pembayaran</span>
                <span className="font-semibold text-slate-800 text-xs">
                  {expense.pay_method || "Tunai"}
                </span>
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
                    <span className="text-[10px] text-slate-400 block font-medium">🚚 Ongkir</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupiah(expense.shipping_fee || 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block font-medium">🏛️ Pajak</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupiah(expense.tax || 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block font-medium">⚙️ Biaya Lain</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupiah(expense.other_fee || 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block font-medium">🏷️ Diskon</span>
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

            {/* Status Reimbursement Detail */}
            {expense.is_reimbursement && (
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl flex items-start gap-2.5 sm:col-span-2">
                <Briefcase className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-semibold text-amber-900 block">Status Reimbursement</span>
                  <p className="text-amber-800 text-[11px] mt-0.5">
                    {expense.reimbursed_at
                      ? `Telah diganti oleh Owner/Admin pada ${formatDateId(expense.reimbursed_at, true)}.`
                      : "Uang talangan belum diganti. Dapat diselesaikan melalui laporan reimbursement Telegram."}
                  </p>
                </div>
              </div>
            )}

            {/* Catatan Tambahan */}
            <div className="p-3 bg-white border border-slate-200/90 rounded-2xl flex items-start gap-2.5 sm:col-span-2">
              <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="w-full">
                <span className="text-slate-400 text-[11px] block font-medium">Catatan / Keterangan</span>
                <p className="font-normal text-slate-700 text-xs mt-0.5 whitespace-pre-wrap">
                  {expense.notes && expense.notes !== "-" ? expense.notes : "Tidak ada catatan."}
                </p>
              </div>
            </div>
          </div>

          {/* Sync Status Info */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
            <span>
              Waktu dicatat: {expense.created_at ? formatDateId(expense.created_at, true) : "-"}
            </span>
            <span>
              Google Sheets: {expense.sheets_synced ? "✓ Tersinkron" : "Belum sync"}
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
