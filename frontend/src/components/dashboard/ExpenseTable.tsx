import React, { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Expense } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DataGrid,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import {
  ColumnDef,
  PaginationState,
  useTable,
} from "@tanstack/react-table";
import {
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  Inbox,
  Repeat,
  LineChart,
  Eye,
  ExternalLink,
  User as UserIcon,
  Briefcase,
  History,
  ShieldAlert,
  Sparkles,
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
  onInspectItemPrice?: (itemName: string, itemId?: number | null) => void;
  onDeleteExpense: (expenseId: number) => void;
  onViewExpense?: (expense: Expense) => void;
  onOpenActivityLog?: () => void;
  onOpenAuditDuplicates?: () => void;
  onOpenDataHygiene?: () => void;
  canDelete?: boolean;
  highlightedExpenseId?: number | null;
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
  onOpenActivityLog,
  onOpenAuditDuplicates,
  onOpenDataHygiene,
  canDelete = true,
  highlightedExpenseId,
}) => {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    if (confirm("Apakah Anda yakin ingin menghapus catatan pengeluaran ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
    }
  };

  // ReUI DataGrid Columns definition
  const columns = useMemo<ColumnDef<DataGridFeatures, Expense>[]>(
    () => [
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => (
          <DataGridColumnHeader title="Tanggal" column={column} />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
            {formatDateId(row.original.expense_date)}
          </span>
        ),
        size: 110,
        enableSorting: true,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => (
          <DataGridColumnHeader title="Toko & Penginput" column={column} />
        ),
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="max-w-[170px] lg:max-w-[240px] 2xl:max-w-[320px]">
              <div className="truncate font-medium text-slate-800 dark:text-slate-200">
                {e.supplier || "-"}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-normal mt-0.5 flex-wrap">
                {e.invoice_number && e.invoice_number !== "-" && (
                  <span className="font-mono text-slate-600 dark:text-slate-400 bg-slate-100/90 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200/60 dark:border-slate-700 shrink-0">
                    #{e.invoice_number}
                  </span>
                )}
                {e.user_name ? (
                  <span
                    title={`Diinput oleh ${e.user_name}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800 font-medium text-[10px] truncate max-w-[130px] shrink-0"
                  >
                    <UserIcon className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                    <span className="truncate">{e.user_name}</span>
                  </span>
                ) : (
                  <span
                    title="Diinput via Web Dashboard / Import"
                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-slate-500 shrink-0"
                  >
                    <span className="opacity-70">Web/Import</span>
                  </span>
                )}
              </div>
            </div>
          );
        },
        size: 180,
        enableSorting: true,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Barang / Deskripsi" column={column} />
        ),
        cell: ({ row }) => {
          const e = row.original;
          const tgMeta = parseTelegramLink(e.msg_link);
          return (
            <div className="max-w-[200px] lg:max-w-[320px] 2xl:max-w-[450px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => onInspectItemPrice?.(e.item_name, e.master_item_id)}
                  title="Klik untuk lihat riwayat harga & perbandingan toko"
                  className="text-left font-semibold text-slate-800 dark:text-slate-100 hover:text-blue-600 hover:underline inline-flex items-center gap-1 max-w-full truncate"
                >
                  <span className="truncate">{e.item_name}</span>
                  <LineChart className="w-3 h-3 text-slate-400 hover:text-blue-500 shrink-0" />
                </button>
                {highlightedExpenseId === e.id && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 shrink-0 animate-pulse">
                    Terpilih
                  </span>
                )}
                {e.is_reimbursement && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
                    <Briefcase className="w-2.5 h-2.5" />
                    <span>Reimburse</span>
                  </span>
                )}
                {tgMeta.isUrl && (
                  <a
                    href={tgMeta.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    title={`Buka pesan Telegram (${tgMeta.badgeLabel}) untuk cross check`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 border border-sky-200 dark:border-sky-800 transition-colors shrink-0"
                  >
                    <TelegramIcon className="w-2.5 h-2.5 text-[#229ED9]" />
                    <span>Telegram</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                  </a>
                )}
              </div>
              {e.notes && e.notes !== "-" && (
                <div className="text-[11px] text-slate-500 font-normal truncate mt-0.5">
                  {e.notes}
                </div>
              )}
            </div>
          );
        },
        size: 240,
        enableSorting: true,
      },
      {
        accessorKey: "category",
        id: "category",
        header: ({ column }) => (
          <DataGridColumnHeader title="Kategori" column={column} />
        ),
        cell: ({ row }) => {
          const catColor = getCategoryColor(row.original.category);
          return (
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${catColor.bg} ${catColor.border}`}
            >
              {row.original.category || "Operasional"}
            </span>
          );
        },
        size: 130,
        enableSorting: true,
      },
      {
        accessorKey: "qty",
        id: "qty",
        header: ({ column }) => (
          <DataGridColumnHeader title="Qty" column={column} className="justify-end text-right" />
        ),
        cell: ({ row }) => (
          <div className="text-right text-slate-700 dark:text-slate-300 tabular-nums font-medium whitespace-nowrap">
            <span>{row.original.qty}</span>
            <span className="text-[11px] text-slate-500 font-normal ml-1">
              {row.original.unit || "Pcs"}
            </span>
          </div>
        ),
        size: 80,
      },
      {
        accessorKey: "unit_price",
        id: "unit_price",
        header: ({ column }) => (
          <DataGridColumnHeader title="Harga Satuan" column={column} className="justify-end text-right" />
        ),
        cell: ({ row }) => (
          <div className="text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
            {formatRupiah(row.original.unit_price)}
          </div>
        ),
        size: 110,
        enableSorting: true,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: ({ column }) => (
          <DataGridColumnHeader title="Total" column={column} className="justify-end text-right" />
        ),
        cell: ({ row }) => (
          <div className="text-right text-slate-900 dark:text-slate-100 font-bold tabular-nums whitespace-nowrap">
            {formatRupiah(row.original.total_price)}
          </div>
        ),
        size: 120,
        enableSorting: true,
      },
      {
        accessorKey: "pay_status",
        id: "pay_status",
        header: ({ column }) => (
          <DataGridColumnHeader title="Status" column={column} className="justify-center text-center" />
        ),
        cell: ({ row }) => {
          const isLunas = (row.original.pay_status || "").toLowerCase().includes("lunas");
          return (
            <div className="text-center whitespace-nowrap">
              <button
                onClick={() => onToggleStatus(row.original)}
                title="Klik untuk ubah status pembayaran"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-95 ${
                  isLunas
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100"
                }`}
              >
                {isLunas ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Lunas</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 animate-pulse" />
                    <span>Hutang</span>
                  </>
                )}
              </button>
              {row.original.pay_method && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  {row.original.pay_method}
                </div>
              )}
            </div>
          );
        },
        size: 110,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const e = row.original;
          const tgMeta = parseTelegramLink(e.msg_link);
          return (
            <div className="flex items-center justify-center gap-1">
              {onViewExpense && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onViewExpense(e)}
                  className="h-7 w-7 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800"
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
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-[#229ED9] hover:bg-sky-50 dark:hover:bg-slate-800 transition-colors"
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
                  className="h-7 w-7 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-800"
                  title="Beli Lagi (Catat ulang untuk hari ini)"
                >
                  <Repeat className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEditExpense(e)}
                className="h-7 w-7 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800"
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
                  className="h-7 w-7 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800"
                  title="Hapus data"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          );
        },
        size: 130,
      },
    ],
    [onToggleStatus, onEditExpense, onRepeatExpense, onInspectItemPrice, onViewExpense, canDelete, deletingId, highlightedExpenseId]
  );

  const pagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: 20,
    }),
    [page]
  );

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: expenses,
    manualPagination: true,
    manualSorting: false,
    rowCount: totalCount,
    getRowId: (row: Expense) => String(row.id),
    state: {
      pagination,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      onPageChange(next.pageIndex + 1);
    },
  });

  useEffect(() => {
    if (!highlightedExpenseId) return;

    const timer = setTimeout(() => {
      const rowEl = document.querySelector<HTMLElement>(`tr[data-row-id="${highlightedExpenseId}"]`);
      const cardEl = document.getElementById(`expense-row-${highlightedExpenseId}`);
      const target = rowEl || cardEl;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ring-2", "ring-blue-500", "bg-blue-50/80", "dark:bg-blue-950/60");
        const clearTimer = setTimeout(() => {
          target.classList.remove("ring-2", "ring-blue-500", "bg-blue-50/80", "dark:bg-blue-950/60");
        }, 4000);
        return () => clearTimeout(clearTimer);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [highlightedExpenseId, expenses]);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-12 text-center shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center mx-auto mb-3">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
          Tidak ada transaksi ditemukan
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
          Coba sesuaikan filter bulan, tahun, atau kata kunci pencarian Anda untuk melihat catatan pengeluaran.
        </p>
      </div>
    );
  }

  return (
    <DataGrid
      table={table}
      recordCount={totalCount}
      isLoading={isLoading}
      tableLayout={{ columnsResizable: true }}
    >
      <Card className="w-full gap-0 p-0 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden bg-white dark:bg-slate-900">
        <CardHeader className="flex flex-row items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Daftar Transaksi
            </CardTitle>
            <Badge variant="secondary" className="text-xs tabular-nums font-semibold">
              {totalCount} item
            </Badge>
          </div>
          <CardAction className="flex items-center gap-2">
            {onOpenDataHygiene && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenDataHygiene}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Cek kesehatan & rapikan data transaksi secara otomatis"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Rapikan Data</span>
              </Button>
            )}
            {onOpenAuditDuplicates && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenAuditDuplicates}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Audit Duplikat</span>
              </Button>
            )}
            {onOpenActivityLog && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenActivityLog}
                className="h-8 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <History className="w-3.5 h-3.5 text-indigo-600" />
                <span>Log Aktivitas Belanja</span>
              </Button>
            )}
            <span className="text-xs text-slate-500 font-medium hidden sm:inline">
              Halaman {page} dari {totalPages}
            </span>
          </CardAction>
        </CardHeader>

        {/* Desktop View Table via ReUI DataGrid */}
        <CardContent className="p-0 hidden md:block">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </CardContent>

        {/* Mobile View: Cards */}
        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {expenses.map((e) => {
            const catColor = getCategoryColor(e.category);
            const isLunas = (e.pay_status || "").toLowerCase().includes("lunas");
            const tgMeta = parseTelegramLink(e.msg_link);

            return (
              <div
                key={e.id}
                id={`expense-row-${e.id}`}
                className={cn(
                  "p-4 space-y-3 transition-all",
                  highlightedExpenseId === e.id
                    ? "bg-blue-50/80 dark:bg-blue-950/60 ring-2 ring-blue-500 rounded-xl"
                    : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {formatDateId(e.expense_date)}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug flex items-center gap-1.5 flex-wrap">
                      <span>{e.item_name}</span>
                      {highlightedExpenseId === e.id && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 shrink-0 animate-pulse">
                          Terpilih
                        </span>
                      )}
                    </h4>
                    {e.notes && e.notes !== "-" && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {e.notes}
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold border shrink-0 ${catColor.bg} ${catColor.border}`}
                  >
                    {e.category || "Operasional"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 block font-medium">Toko / Supplier</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                      {e.supplier || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 block font-medium">Qty & Satuan</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {e.qty} {e.unit || "Pcs"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 block font-medium">Harga Satuan</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatRupiah(e.unit_price)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 block font-medium">Total Nominal</span>
                    <span className="font-bold text-slate-950 dark:text-white text-sm">
                      {formatRupiah(e.total_price)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => onToggleStatus(e)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border ${
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
                          <Clock className="w-3.5 h-3.5 text-rose-600" />
                          <span>Hutang</span>
                        </>
                      )}
                    </button>

                    {e.is_reimbursement && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        <Briefcase className="w-3 h-3" />
                        <span>Reimburse</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {onViewExpense && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onViewExpense(e)}
                        className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600"
                        title="Lihat detail transaksi"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    )}

                    {onInspectItemPrice && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onInspectItemPrice(e.item_name, e.master_item_id)}
                        className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600"
                        title="Riwayat harga barang"
                      >
                        <LineChart className="w-4 h-4" />
                      </Button>
                    )}

                    {onRepeatExpense && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onRepeatExpense(e)}
                        className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-emerald-600"
                        title="Beli Lagi"
                      >
                        <Repeat className="w-4 h-4" />
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onEditExpense(e)}
                      className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-blue-600"
                      title="Edit transaksi"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>

                    {canDelete && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleDelete(e.id)}
                        disabled={deletingId === e.id}
                        className="min-h-[44px] min-w-[44px] rounded-xl border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600"
                        title="Hapus data"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <CardFooter className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 bg-slate-50/50 dark:bg-slate-900/50">
          <DataGridPagination />
        </CardFooter>
      </Card>
    </DataGrid>
  );
};
