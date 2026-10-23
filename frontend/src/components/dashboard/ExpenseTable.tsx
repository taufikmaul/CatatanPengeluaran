import React, { useState } from "react";
import { Expense } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Repeat,
  LineChart,
  Eye,
  ExternalLink,
} from "lucide-react";

interface ExpenseTableProps {
  expenses: Expense[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (newPage: number) => void;
  onToggleStatus: (expense: Expense) => void;
  onEditExpense: (expense: Expense) => void;
  onRepeatExpense?: (expense: Expense) => void;
  onInspectItemPrice?: (itemName: string) => void;
  onDeleteExpense: (expenseId: number) => void;
  onViewExpense?: (expense: Expense) => void;
  canDelete?: boolean;
}

export const ExpenseTable: React.FC<ExpenseTableProps> = ({
  expenses,
  isLoading,
  page,
  totalPages,
  totalCount,
  onPageChange,
  onToggleStatus,
  onEditExpense,
  onRepeatExpense,
  onInspectItemPrice,
  onDeleteExpense,
  onViewExpense,
  canDelete = true,
}) => {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    if (confirm("Apakah Anda yakin ingin menghapus catatan pengeluaran ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-center mb-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-24" />
        </div>
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-12 text-center shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Tidak ada transaksi ditemukan</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Coba sesuaikan filter bulan, tahun, atau kata kunci pencarian Anda untuk melihat catatan pengeluaran.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden flex flex-col">
      {/* Table Header count summary */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Daftar Transaksi</span>
          <Badge variant="secondary" className="text-xs tabular-nums font-semibold">
            {totalCount} item
          </Badge>
        </div>
        <span className="text-xs text-slate-400 font-medium">
          Halaman {page} dari {totalPages}
        </span>
      </div>

      {/* Desktop View Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-100 font-medium">
            <tr>
              <th className="py-3 px-4">Tanggal</th>
              <th className="py-3 px-4">Toko / Supplier</th>
              <th className="py-3 px-4">Barang / Deskripsi</th>
              <th className="py-3 px-4">Kategori</th>
              <th className="py-3 px-4 text-right">Qty</th>
              <th className="py-3 px-4 text-right">Harga Satuan</th>
              <th className="py-3 px-4 text-right">Total</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.map((e) => {
              const catColor = getCategoryColor(e.category);
              const isLunas = (e.pay_status || "").toLowerCase().includes("lunas");
              const tgMeta = parseTelegramLink(e.msg_link);

              return (
                <tr
                  key={e.id}
                  className="hover:bg-slate-50/80 transition-colors group"
                >
                  <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-700">
                    {formatDateId(e.expense_date)}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-slate-600 max-w-[150px] lg:max-w-[220px] 2xl:max-w-[320px] truncate">
                    <div>{e.supplier || "-"}</div>
                    {e.invoice_number && e.invoice_number !== "-" && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        Inv: #{e.invoice_number}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-800 font-semibold max-w-[200px] lg:max-w-[320px] 2xl:max-w-[450px] truncate">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => onInspectItemPrice?.(e.item_name)}
                        title="Klik untuk lihat riwayat harga & perbandingan toko"
                        className="text-left hover:text-blue-600 hover:underline inline-flex items-center gap-1 max-w-full truncate"
                      >
                        <span className="truncate">{e.item_name}</span>
                        <LineChart className="w-3 h-3 text-slate-300 group-hover:text-blue-500 shrink-0" />
                      </button>
                      {e.is_reimbursement && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          💼 Reimburse
                        </span>
                      )}
                      {tgMeta.isUrl && (
                        <a
                          href={tgMeta.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(ev) => ev.stopPropagation()}
                          title={`Buka pesan Telegram (${tgMeta.badgeLabel}) untuk cross check`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 border border-sky-200 transition-colors shrink-0"
                        >
                          <TelegramIcon className="w-2.5 h-2.5 text-[#229ED9]" />
                          <span>Telegram</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      )}
                    </div>
                    {e.notes && e.notes !== "-" && (
                      <div className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                        {e.notes}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${catColor.bg} ${catColor.border}`}
                    >
                      {e.category || "Operasional"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-slate-700 tabular-nums font-medium whitespace-nowrap">
                    <span>{e.qty}</span>
                    <span className="text-[11px] text-slate-400 font-normal ml-1">
                      {e.unit || "Pcs"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600 tabular-nums">
                    {formatRupiah(e.unit_price)}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-900 font-bold tabular-nums">
                    {formatRupiah(e.total_price)}
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <button
                      onClick={() => onToggleStatus(e)}
                      title="Klik untuk ubah status pembayaran"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-95 ${
                        isLunas
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                          : "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
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
                          <span>Hutang</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100">
                      {onViewExpense && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onViewExpense(e)}
                          className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                          title="Lihat detail lengkap transaksi"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {tgMeta.isUrl && (
                        <a
                          href={tgMeta.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(ev) => ev.stopPropagation()}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-[#229ED9] hover:bg-sky-50 transition-colors"
                          title={`Buka pesan di Telegram (${tgMeta.badgeLabel})`}
                        >
                          <TelegramIcon className="w-3.5 h-3.5 text-[#229ED9]" />
                        </a>
                      )}
                      {onRepeatExpense && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRepeatExpense(e)}
                          className="h-7 w-7 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          title="Beli Lagi (Catat ulang untuk hari ini)"
                        >
                          <Repeat className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEditExpense(e)}
                        className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        title="Edit data"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(e.id)}
                          disabled={deletingId === e.id}
                          className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Hapus data"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile View: Cards */}
      <div className="block md:hidden divide-y divide-slate-100">
        {expenses.map((e) => {
          const catColor = getCategoryColor(e.category);
          const isLunas = (e.pay_status || "").toLowerCase().includes("lunas");
          const tgMeta = parseTelegramLink(e.msg_link);

          return (
            <div key={e.id} className="p-3.5 space-y-2 hover:bg-slate-50 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm text-slate-900 leading-tight flex items-center gap-1.5 flex-wrap">
                    <span>{e.item_name}</span>
                    {e.is_reimbursement && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        💼 Reimburse
                      </span>
                    )}
                    {tgMeta.isUrl && (
                      <a
                        href={tgMeta.url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 active:scale-95"
                        title={`Cross check chat Telegram (${tgMeta.badgeLabel})`}
                      >
                        <TelegramIcon className="w-2.5 h-2.5 text-[#229ED9]" />
                        <span>Telegram</span>
                        <ExternalLink className="w-2 h-2 opacity-60" />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {e.supplier || "-"} • {formatDateId(e.expense_date)}
                    {e.invoice_number && e.invoice_number !== "-" && (
                      <span className="text-[10px] text-slate-400 font-mono ml-1.5">
                        #{e.invoice_number}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-sm text-slate-900 tabular-nums">
                    {formatRupiah(e.total_price)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {e.qty} {e.unit || "Pcs"} x {formatRupiah(e.unit_price)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${catColor.bg} ${catColor.border}`}
                >
                  {e.category || "Operasional"}
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onToggleStatus(e)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                      isLunas
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-rose-50 text-rose-700 border-rose-200"
                    }`}
                  >
                    {isLunas ? "Lunas" : "Hutang"}
                  </button>

                  {onViewExpense && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onViewExpense(e)}
                      className="h-7 w-7 text-slate-400 hover:text-blue-600"
                      title="Lihat Detail Transaksi"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  )}

                  {tgMeta.isUrl && (
                    <a
                      href={tgMeta.url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-[#229ED9] hover:bg-sky-50 active:scale-95"
                      title={`Buka Telegram (${tgMeta.badgeLabel})`}
                    >
                      <TelegramIcon className="w-3.5 h-3.5 text-[#229ED9]" />
                    </a>
                  )}

                  {onRepeatExpense && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRepeatExpense(e)}
                      className="h-7 w-7 text-slate-400 hover:text-emerald-600"
                      title="Beli Lagi"
                    >
                      <Repeat className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEditExpense(e)}
                    className="h-7 w-7 text-slate-400 hover:text-blue-600"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(e.id)}
                      className="h-7 w-7 text-slate-400 hover:text-red-600"
                      title="Hapus data"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="p-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 text-xs">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="h-8 gap-1 rounded-xl text-slate-600"
          >
            <ChevronLeft className="w-4 h-4" />
            Sebelumnya
          </Button>

          <span className="text-slate-500 font-medium">
            Halaman {page} dari {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="h-8 gap-1 rounded-xl text-slate-600"
          >
            Berikutnya
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
