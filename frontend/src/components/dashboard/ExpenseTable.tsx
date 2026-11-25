import React, { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Expense, ExpenseInvoiceGroup } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import {
  getExpensePaymentBreakdown,
  isPaidStatus,
  isCodExpense,
  isReimbursementExpense,
  hasInstallmentHistory,
} from "@/lib/paymentStatus";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/common/DataTable";
import {
  ExpenseViewMode,
  InvoiceFeeFooter,
  InvoiceViewModeToggle,
  getInvoiceItemSummaryText,
} from "@/components/common/InvoiceGroupShared";
import {
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import {
  ColumnDef,
  ExpandedState,
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
  Package,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Receipt,
} from "lucide-react";

interface ExpenseTableProps {
  expenses: Expense[];
  invoiceGroups?: ExpenseInvoiceGroup[];
  viewMode?: ExpenseViewMode;
  onViewModeChange?: (mode: ExpenseViewMode) => void;
  totalItemsCount?: number;
  isLoading: boolean;
  page: number;
  pageSize?: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newSize: number) => void;
  onToggleStatus: (expense: Expense) => void;
  onToggleInvoiceStatus?: (group: ExpenseInvoiceGroup) => void;
  onEditExpense: (expense: Expense) => void;
  onRepeatExpense?: (expense: Expense) => void;
  onInspectItemPrice?: (itemName: string, itemId?: number | null) => void;
  onDeleteExpense: (expenseId: number) => void;
  onViewExpense?: (expense: Expense) => void;
  onOpenPaymentModal?: (expense: Expense, mode?: "full" | "percent" | "amount") => void;
  onOpenInvoicePaymentModal?: (group: ExpenseInvoiceGroup, mode?: "full" | "percent" | "amount") => void;
  onOpenActivityLog?: () => void;
  onOpenAuditDuplicates?: () => void;
  onOpenDataHygiene?: () => void;
  canDelete?: boolean;
  highlightedExpenseId?: number | null;
  categoryCoaMap?: Record<string, { code: string; name: string; group: string }>;
}

export const ExpenseTable: React.FC<ExpenseTableProps> = ({
  expenses,
  invoiceGroups = [],
  viewMode = "items",
  onViewModeChange,
  totalItemsCount,
  isLoading,
  page,
  pageSize = 25,
  totalPages,
  totalCount,
  onPageChange,
  onPageSizeChange,
  onToggleStatus,
  onToggleInvoiceStatus,
  onEditExpense,
  onRepeatExpense,
  onInspectItemPrice,
  onDeleteExpense,
  onViewExpense,
  onOpenPaymentModal,
  onOpenInvoicePaymentModal,
  onOpenActivityLog,
  onOpenAuditDuplicates,
  onOpenDataHygiene,
  canDelete = true,
  highlightedExpenseId,
  categoryCoaMap,
}) => {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [mobileExpandedKeys, setMobileExpandedKeys] = useState<Record<string, boolean>>({});
  const isGroupedMode = viewMode === "grouped";

  const handleDelete = (id: number) => {
    if (confirm("Apakah Anda yakin ingin menghapus catatan pengeluaran ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
    }
  };

  const toggleMobileExpand = (key: string) => {
    setMobileExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const groupedColumns = useMemo<ColumnDef<DataGridFeatures, ExpenseInvoiceGroup>[]>(
    () => [
      {
        id: "expand",
        header: () => null,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                row.getToggleExpandedHandler()();
              }}
              aria-expanded={row.getIsExpanded()}
              aria-label={
                row.getIsExpanded()
                  ? "Tutup rincian item invoice"
                  : `Lihat ${row.original.items_count} item dalam invoice`
              }
              className="p-1.5 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          ) : null,
        size: 40,
        enableSorting: false,
        meta: {
          expandedContent: (group: ExpenseInvoiceGroup) => (
            <div className="bg-slate-50/90 dark:bg-slate-900/70 px-4 sm:px-6 py-3 border-t border-slate-200/70 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Receipt className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>
                    Rincian Item Invoice ({group.items.length} item)
                  </span>
                  {group.invoice_number && group.invoice_number !== "-" && (
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      #{group.invoice_number}
                    </span>
                  )}
                </div>
                {group.matched_items_count < group.items_count && (
                  <span className="text-[11px] text-slate-600 dark:text-slate-300">
                    {group.matched_items_count} dari {group.items_count} item sesuai filter aktif
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-950/60 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 px-3 text-left font-semibold w-8">#</th>
                      <th className="py-2 px-3 text-left font-semibold">Barang / Deskripsi</th>
                      <th className="py-2 px-3 text-left font-semibold">Kategori</th>
                      <th className="py-2 px-3 text-right font-semibold">Qty</th>
                      <th className="py-2 px-3 text-right font-semibold">Harga Satuan</th>
                      <th className="py-2 px-3 text-right font-semibold">Total Baris</th>
                      <th className="py-2 px-3 text-center font-semibold">Status</th>
                      <th className="py-2 px-3 text-center font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.items.map((it, idx) => {
                      const catColor = getCategoryColor(it.category || "Operasional");
                      const coa = categoryCoaMap?.[it.category || "Operasional"];
                      const bd = getExpensePaymentBreakdown(it);
                      const isCod = isCodExpense(it);
                      const isMatched =
                        group.matched_item_ids.length === 0 ||
                        group.matched_item_ids.includes(it.id);
                      const isItemHighlighted = highlightedExpenseId === it.id;

                      return (
                        <tr
                          key={it.id}
                          id={`expense-row-${it.id}`}
                          className={cn(
                            "transition-colors",
                            isItemHighlighted
                              ? "bg-blue-50/90 dark:bg-blue-950/60"
                              : !isMatched
                              ? "opacity-75 bg-slate-50/40 dark:bg-slate-900/30"
                              : "hover:bg-slate-50/70 dark:hover:bg-slate-900/50"
                          )}
                        >
                          <td className="py-2 px-3 text-slate-500 font-mono tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3 min-w-[190px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => onInspectItemPrice?.(it.item_name, it.master_item_id)}
                                className="text-left font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 hover:underline inline-flex items-center gap-1"
                                title="Klik untuk lihat riwayat harga & perbandingan toko"
                              >
                                <span>{it.item_name}</span>
                                <LineChart className="w-3 h-3 text-slate-500 shrink-0" />
                              </button>
                              {isItemHighlighted && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                                  Terpilih
                                </span>
                              )}
                            </div>
                            {it.notes && it.notes !== "-" && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                                {it.notes}
                              </div>
                            )}
                            {(Number(it.shipping_fee || 0) > 0 ||
                              Number(it.tax || 0) > 0 ||
                              Number(it.other_fee || 0) > 0 ||
                              Number(it.discount || 0) > 0) && (
                              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 tabular-nums">
                                {Number(it.shipping_fee || 0) > 0 && (
                                  <span>Ongkir: {formatRupiah(it.shipping_fee || 0)}</span>
                                )}
                                {Number(it.tax || 0) > 0 && (
                                  <span>Pajak: {formatRupiah(it.tax || 0)}</span>
                                )}
                                {Number(it.other_fee || 0) > 0 && (
                                  <span>Biaya Lain: {formatRupiah(it.other_fee || 0)}</span>
                                )}
                                {Number(it.discount || 0) > 0 && (
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    Diskon: -{formatRupiah(it.discount || 0)}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${catColor.bg} ${catColor.border}`}
                              >
                                {it.category || "Operasional"}
                              </span>
                              {coa?.code && (
                                <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {coa.code}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {it.qty} {it.unit || "Pcs"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {formatRupiah(it.unit_price)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap font-bold text-slate-900 dark:text-slate-100">
                            {formatRupiah(it.total_price)}
                          </td>
                          <td className="py-2 px-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                if ((bd.isDp || isCod) && onOpenPaymentModal) {
                                  onOpenPaymentModal(it, "full");
                                } else {
                                  onToggleStatus(it);
                                }
                              }}
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors",
                                bd.isPaid
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800"
                                  : isCod || bd.isDp
                                  ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800"
                                  : "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800"
                              )}
                            >
                              {bd.isPaid ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Lunas</span>
                                </>
                              ) : isCod ? (
                                <span>COD</span>
                              ) : bd.isDp ? (
                                <span>DP {Math.round(bd.progressPct)}%</span>
                              ) : (
                                <span>Belum Lunas</span>
                              )}
                            </button>
                          </td>
                          <td className="py-2 px-3 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {onViewExpense && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => onViewExpense(it)}
                                  className="h-7 w-7 text-slate-600 hover:text-blue-700"
                                  title="Lihat detail item"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {onRepeatExpense && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => onRepeatExpense(it)}
                                  className="h-7 w-7 text-slate-600 hover:text-emerald-700"
                                  title="Beli lagi item ini"
                                >
                                  <Repeat className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => onEditExpense(it)}
                                className="h-7 w-7 text-slate-600 hover:text-blue-700"
                                title="Edit item"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              {canDelete && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDelete(it.id)}
                                  disabled={deletingId === it.id}
                                  className="h-7 w-7 text-slate-600 hover:text-rose-700"
                                  title="Hapus item"
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

              <InvoiceFeeFooter group={group} showPaymentSummary={!group.is_paid} />
            </div>
          ),
        },
      },
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => (
          <DataGridColumnHeader title="Tanggal" column={column} />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
            {formatDateId(row.original.expense_date)}
          </span>
        ),
        size: 110,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => (
          <DataGridColumnHeader title="Toko & Penginput" column={column} />
        ),
        cell: ({ row }) => {
          const g = row.original;
          return (
            <div className="max-w-[180px] lg:max-w-[250px]">
              <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {g.supplier || "-"}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 font-normal mt-0.5 flex-wrap">
                {g.invoice_number && g.invoice_number !== "-" && (
                  <span className="font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200/80 dark:border-slate-700 shrink-0">
                    #{g.invoice_number}
                  </span>
                )}
                {g.items_count > 1 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-semibold shrink-0">
                    {g.items_count} item
                  </span>
                )}
                {g.user_name ? (
                  <span
                    title={`Diinput oleh ${g.user_name}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 border border-indigo-200/70 dark:border-indigo-800 font-medium text-[10px] truncate max-w-[130px] shrink-0"
                  >
                    <UserIcon className="w-2.5 h-2.5 text-indigo-600 dark:text-indigo-300 shrink-0" />
                    <span className="truncate">{g.user_name}</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-600 dark:text-slate-400 shrink-0">
                    Web/Import
                  </span>
                )}
              </div>
            </div>
          );
        },
        size: 190,
      },
      {
        id: "item_summary",
        header: () => <span>Barang / Ringkasan Nota</span>,
        cell: ({ row }) => {
          const g = row.original;
          const tgMeta = parseTelegramLink(g.msg_link);
          const summary = getInvoiceItemSummaryText(g);
          const single = g.items_count === 1 ? g.items[0] : null;
          const hasHighlighted = Boolean(
            highlightedExpenseId && g.items.some((it) => it.id === highlightedExpenseId)
          );

          return (
            <div className="max-w-[220px] lg:max-w-[330px] 2xl:max-w-[440px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                {single ? (
                  <button
                    type="button"
                    onClick={() => onInspectItemPrice?.(single.item_name, single.master_item_id)}
                    title="Klik untuk lihat riwayat harga & perbandingan toko"
                    className="text-left font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-700 hover:underline inline-flex items-center gap-1 max-w-full truncate"
                  >
                    <span className="truncate">{single.item_name}</span>
                    <LineChart className="w-3 h-3 text-slate-500 shrink-0" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={row.getToggleExpandedHandler()}
                    className="text-left font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-700 inline-flex items-center gap-1.5 max-w-full"
                  >
                    <span className="truncate">{summary.title}</span>
                    {summary.extraCount > 0 && (
                      <span className="text-xs font-bold text-blue-700 dark:text-blue-300 shrink-0">
                        +{summary.extraCount} lainnya
                      </span>
                    )}
                  </button>
                )}

                {hasHighlighted && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700 shrink-0">
                    Terpilih
                  </span>
                )}
                {g.is_reimbursement && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 shrink-0">
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
                    title={`Buka pesan Telegram (${tgMeta.badgeLabel})`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 border border-sky-200 dark:border-sky-800 transition-colors shrink-0"
                  >
                    <TelegramIcon className="w-2.5 h-2.5 text-[#229ED9]" />
                    <span>Telegram</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                  </a>
                )}
              </div>

              {single && single.notes && single.notes !== "-" ? (
                <div className="text-[11px] text-slate-600 dark:text-slate-400 font-normal truncate mt-0.5">
                  {single.notes}
                </div>
              ) : !single ? (
                <div className="text-[11px] text-slate-600 dark:text-slate-400 font-normal truncate mt-0.5">
                  Klik untuk expand {g.items_count} item
                  {g.matched_items_count < g.items_count
                    ? ` (${g.matched_items_count} cocok filter)`
                    : ""}
                </div>
              ) : null}
            </div>
          );
        },
        size: 260,
      },
      {
        id: "category",
        header: () => <span>Kategori</span>,
        cell: ({ row }) => {
          const g = row.original;
          const cat = g.primary_category || "Operasional";
          const catColor = getCategoryColor(cat);
          const coa = categoryCoaMap?.[cat];
          const extraCats = Math.max(0, (g.categories?.length || 1) - 1);
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${catColor.bg} ${catColor.border}`}
              >
                {cat}
              </span>
              {coa?.code && (
                <span
                  className="font-mono text-[9px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                  title={`${coa.code} - ${coa.name} (${coa.group})`}
                >
                  {coa.code}
                </span>
              )}
              {extraCats > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                  +{extraCats}
                </span>
              )}
            </div>
          );
        },
        size: 165,
      },
      {
        id: "qty_summary",
        header: () => <div className="text-right w-full">Jumlah</div>,
        cell: ({ row }) => {
          const g = row.original;
          if (g.items_count === 1 && g.items[0]) {
            const it = g.items[0];
            return (
              <div className="text-right text-slate-700 dark:text-slate-300 tabular-nums font-medium whitespace-nowrap">
                <span>{it.qty}</span>
                <span className="text-[11px] text-slate-600 dark:text-slate-400 font-normal ml-1">
                  {it.unit || "Pcs"}
                </span>
              </div>
            );
          }
          return (
            <div className="text-right text-slate-800 dark:text-slate-200 tabular-nums font-semibold whitespace-nowrap">
              {g.items_count} item
            </div>
          );
        },
        size: 85,
      },
      {
        accessorKey: "total_amount",
        id: "total_amount",
        header: () => <div className="text-right w-full">Total Invoice</div>,
        cell: ({ row }) => {
          const g = row.original;
          const hasFees =
            g.shipping_fee > 0 || g.tax > 0 || g.other_fee > 0 || g.discount > 0;
          return (
            <div className="text-right whitespace-nowrap">
              <div className="text-slate-950 dark:text-slate-100 font-bold tabular-nums">
                {formatRupiah(g.total_amount)}
              </div>
              {!g.is_paid && g.paid_amount > 0 ? (
                <div className="text-[10px] text-rose-700 dark:text-rose-400 tabular-nums font-medium">
                  Sisa {formatRupiah(g.remaining_amount)}
                </div>
              ) : hasFees ? (
                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                  Termasuk biaya/diskon
                </div>
              ) : null}
            </div>
          );
        },
        size: 135,
      },
      {
        accessorKey: "pay_status",
        id: "pay_status",
        header: () => <div className="text-center w-full">Status</div>,
        cell: ({ row }) => {
          const g = row.original;
          const single = g.items_count === 1 ? g.items[0] : null;
          const hasCod = g.items.some((it) => isCodExpense(it));

          return (
            <div className="text-center whitespace-nowrap">
              <button
                type="button"
                onClick={() => {
                  if (single) {
                    if ((g.is_dp || hasCod) && onOpenPaymentModal) {
                      onOpenPaymentModal(single, "full");
                    } else {
                      onToggleStatus(single);
                    }
                  } else if ((g.is_dp || hasCod) && onOpenInvoicePaymentModal) {
                    onOpenInvoicePaymentModal(g, "full");
                  } else if (onToggleInvoiceStatus) {
                    onToggleInvoiceStatus(g);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-95 border",
                  g.is_paid
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                    : hasCod || g.is_dp || g.is_mixed_pay_status
                    ? "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800 hover:bg-amber-100"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800 hover:bg-rose-100"
                )}
              >
                {g.is_paid ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                    <span>Lunas</span>
                  </>
                ) : hasCod ? (
                  <>
                    <Package className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    <span>COD Belum Bayar</span>
                  </>
                ) : g.is_dp ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    <span>DP {Math.round(g.payment_progress_pct)}%</span>
                  </>
                ) : g.is_mixed_pay_status ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    <span>Sebagian Lunas</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
                    <span>Hutang</span>
                  </>
                )}
              </button>

              {g.is_reimbursement && (
                <div className="mt-0.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border",
                      g.reimbursed_status === "reimbursed"
                        ? "bg-purple-100/90 text-purple-900 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200"
                        : "bg-amber-100/90 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200"
                    )}
                  >
                    <Briefcase className="w-2.5 h-2.5 shrink-0" />
                    <span>
                      {g.reimbursed_status === "reimbursed"
                        ? "Talangan Diganti"
                        : g.reimbursed_status === "partial"
                        ? "Sebagian Diganti"
                        : "Ditalangi"}
                    </span>
                  </span>
                </div>
              )}

              {g.pay_method && !hasCod && (
                <div className="text-[10px] text-slate-600 dark:text-slate-400 font-medium mt-0.5">
                  {g.pay_method}
                </div>
              )}
            </div>
          );
        },
        size: 130,
      },
      {
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => {
          const g = row.original;
          const single = g.items_count === 1 ? g.items[0] : null;
          const tgMeta = parseTelegramLink(g.msg_link);

          if (single) {
            return (
              <div className="flex items-center justify-center gap-1">
                {onViewExpense && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onViewExpense(single)}
                    className="h-7 w-7 text-slate-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-slate-800"
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
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-[#229ED9] hover:bg-sky-50 dark:hover:bg-slate-800 transition-colors"
                    title={`Buka pesan di Telegram (${tgMeta.badgeLabel})`}
                  >
                    <TelegramIcon className="w-3.5 h-3.5 text-[#229ED9]" />
                  </a>
                )}
                {onRepeatExpense && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onRepeatExpense(single)}
                    className="h-7 w-7 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-slate-800"
                    title="Beli Lagi (Catat ulang untuk hari ini)"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEditExpense(single)}
                  className="h-7 w-7 text-slate-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-slate-800"
                  title="Edit data"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </Button>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(single.id)}
                    disabled={deletingId === single.id}
                    className="h-7 w-7 text-slate-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-slate-800"
                    title="Hapus data"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            );
          }

          return (
            <div className="flex items-center justify-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={row.getToggleExpandedHandler()}
                aria-expanded={row.getIsExpanded()}
                className="h-7 px-2.5 text-[11px] font-semibold rounded-lg gap-1 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              >
                {row.getIsExpanded() ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    <span>Tutup</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    <span>Items ({g.items_count})</span>
                  </>
                )}
              </Button>
            </div>
          );
        },
        size: 135,
      },
    ],
    [
      categoryCoaMap,
      highlightedExpenseId,
      onInspectItemPrice,
      onOpenPaymentModal,
      onOpenInvoicePaymentModal,
      onToggleStatus,
      onToggleInvoiceStatus,
      onViewExpense,
      onRepeatExpense,
      onEditExpense,
      canDelete,
      deletingId,
    ]
  );

  // ReUI DataGrid Columns definition (Per Item Mode)
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
          const cat = row.original.category || "Operasional";
          const catColor = getCategoryColor(cat);
          const coa = categoryCoaMap?.[cat];
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${catColor.bg} ${catColor.border}`}
              >
                {cat}
              </span>
              {coa?.code && (
                <span
                  className="font-mono text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                  title={`${coa.code} - ${coa.name} (${coa.group})`}
                >
                  {coa.code}
                </span>
              )}
            </div>
          );
        },
        size: 160,
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
          const exp = row.original;
          const bd = getExpensePaymentBreakdown(exp);
          const isCod = isCodExpense(exp);
          const isReimb = isReimbursementExpense(exp);
          const hasInst = hasInstallmentHistory(exp);
          const hasDpSettled =
            bd.isPaid &&
            ((exp.payments_count || 0) > 1 ||
              (exp.payments && exp.payments.some((p) => p.payment_type === "dp")) ||
              Boolean(exp.dp_type || (exp.dp_percent && Number(exp.dp_percent) > 0)));
          const hasInstSettled = bd.isPaid && hasInst;

          return (
            <div className="text-center whitespace-nowrap">
              <button
                onClick={() => {
                  if ((bd.isDp || isCod) && onOpenPaymentModal) {
                    onOpenPaymentModal(exp, isCod ? "full" : "full");
                  } else {
                    onToggleStatus(exp);
                  }
                }}
                title={
                  isCod && !bd.isPaid
                    ? "Klik untuk bayar / lunasi COD di kasir"
                    : bd.isDp
                    ? "Klik untuk catat pelunasan atau cicilan"
                    : "Klik untuk ubah status pembayaran"
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-95 ${
                  bd.isPaid
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                    : isCod
                    ? "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100"
                    : bd.isDp
                    ? "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100"
                }`}
              >
                {bd.isPaid ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Lunas</span>
                  </>
                ) : isCod ? (
                  <>
                    <Package className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>COD Belum Bayar</span>
                  </>
                ) : hasInst ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Termin {Math.round(bd.progressPct)}%</span>
                  </>
                ) : bd.isDp ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>DP {Math.round(bd.progressPct)}%</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                    <span>Hutang</span>
                  </>
                )}
              </button>

              {/* Sub-badge: COD Dilunasi / DP Dilunasi / Termin Lunas */}
              {bd.isPaid && isCod && (
                <div className="mt-0.5">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                    title="Transaksi COD lunas dibayar kasir"
                  >
                    <Package className="w-2.5 h-2.5 shrink-0" />
                    <span>COD Dilunasi</span>
                  </span>
                </div>
              )}

              {hasInstSettled && !isCod && (
                <div className="mt-0.5">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100/90 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
                    title="Hutang bertahap telah lunas seluruh termin"
                  >
                    <History className="w-2.5 h-2.5 shrink-0" />
                    <span>Termin Lunas</span>
                  </span>
                </div>
              )}

              {hasDpSettled && !isCod && !hasInstSettled && (
                <div className="mt-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onViewExpense) {
                        onViewExpense(exp);
                      } else if (onOpenPaymentModal) {
                        onOpenPaymentModal(exp, "full");
                      }
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100/90 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 transition-colors"
                    title="Transaksi DP telah lunas. Klik untuk lihat track record pembayaran"
                  >
                    <History className="w-2.5 h-2.5 shrink-0" />
                    <span>DP Dilunasi</span>
                  </button>
                </div>
              )}

              {/* Status Talangan Sub-badge */}
              {isReimb && (
                <div className="mt-0.5">
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                      exp.reimbursed_at
                        ? "bg-purple-100/90 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300"
                        : "bg-amber-100/90 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300"
                    }`}
                    title={exp.reimbursed_at ? "Uang talangan sudah diganti oleh owner/admin" : "Uang talangan belum diganti"}
                  >
                    <Briefcase className="w-2.5 h-2.5 shrink-0" />
                    <span>{exp.reimbursed_at ? "Talangan Diganti" : "Ditalangi"}</span>
                  </span>
                </div>
              )}

              {exp.pay_method && !isCod && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  {exp.pay_method}
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
      pageSize,
    }),
    [page, pageSize]
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
      if (next.pageSize !== pageSize && onPageSizeChange) {
        onPageSizeChange(next.pageSize);
      } else {
        onPageChange(next.pageIndex + 1);
      }
    },
  });

  const groupedTable = useTable({
    features: dataGridFeatures,
    columns: groupedColumns,
    data: invoiceGroups,
    manualPagination: true,
    manualSorting: false,
    autoResetExpanded: false,
    rowCount: totalCount,
    getRowId: (row: ExpenseInvoiceGroup) => row.group_key,
    getRowCanExpand: (row) => row.original.items.length > 0,
    state: {
      pagination,
      expanded,
    },
    onExpandedChange: setExpanded,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      if (next.pageSize !== pageSize && onPageSizeChange) {
        onPageSizeChange(next.pageSize);
      } else {
        onPageChange(next.pageIndex + 1);
      }
    },
  });

  // Auto-expand grup invoice jika terdapat item yang disorot (mis. dari Riwayat Harga)
  useEffect(() => {
    if (!highlightedExpenseId || !isGroupedMode) return;
    const matchGrp = invoiceGroups.find((g) =>
      g.items.some((it) => it.id === highlightedExpenseId)
    );
    if (!matchGrp) return;
    setExpanded((prev) =>
      prev === true ? true : { ...prev, [matchGrp.group_key]: true }
    );
    setMobileExpandedKeys((prev) => ({ ...prev, [matchGrp.group_key]: true }));
  }, [highlightedExpenseId, isGroupedMode, invoiceGroups]);

  useEffect(() => {
    if (!highlightedExpenseId) return;

    const timer = setTimeout(() => {
      const rowEl = document.querySelector<HTMLElement>(`tr[data-row-id="${highlightedExpenseId}"]`);
      const itemEl = document.getElementById(`expense-row-${highlightedExpenseId}`);
      const target = rowEl || itemEl;
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
  }, [highlightedExpenseId, expenses, invoiceGroups]);

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

  const activeLength = isGroupedMode ? invoiceGroups.length : expenses.length;

  if (activeLength === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-8 text-center shadow-sm space-y-2.5">
        {onViewModeChange && (
          <div className="flex justify-end">
            <InvoiceViewModeToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        )}
        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center mx-auto">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Tidak ada transaksi ditemukan
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
          Coba sesuaikan filter bulan, tahun, atau kata kunci pencarian Anda untuk melihat catatan pengeluaran.
        </p>
      </div>
    );
  }

  const tableHeader = (
    <div className="flex flex-row items-center justify-between flex-wrap gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Daftar Transaksi
        </h3>
        <Badge variant="secondary" className="text-xs tabular-nums font-semibold">
          {isGroupedMode
            ? `${totalCount} invoice${
                totalItemsCount !== undefined ? ` (${totalItemsCount} item)` : ""
              }`
            : `${totalCount} item`}
        </Badge>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {onViewModeChange && (
          <InvoiceViewModeToggle mode={viewMode} onChange={onViewModeChange} />
        )}
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
        <span className="text-xs text-slate-600 dark:text-slate-300 font-medium hidden sm:inline">
          Halaman {page} dari {totalPages}
        </span>
      </div>
    </div>
  );

  return (
    <DataTable
      table={(isGroupedMode ? groupedTable : table) as any}
      recordCount={totalCount}
      isLoading={isLoading}
      header={tableHeader}
      containerClassName="shadow-sm"
      tableWrapperClassName="hidden md:block"
    >
      {/* Mobile View: Invoice Group Cards or Flat Item Cards */}
      <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {isGroupedMode
          ? invoiceGroups.map((g) => {
              const catColor = getCategoryColor(g.primary_category);
              const tgMeta = parseTelegramLink(g.msg_link);
              const summary = getInvoiceItemSummaryText(g);
              const isExpanded = Boolean(mobileExpandedKeys[g.group_key]);
              const single = g.items_count === 1 ? g.items[0] : null;
              const hasCod = g.items.some((it) => isCodExpense(it));
              const hasHighlighted = Boolean(
                highlightedExpenseId &&
                  g.items.some((it) => it.id === highlightedExpenseId)
              );

              return (
                <div
                  key={g.group_key}
                  id={single ? `expense-row-${single.id}` : undefined}
                  className={cn(
                    "p-3 space-y-2 transition-all",
                    hasHighlighted
                      ? "bg-blue-50/80 dark:bg-blue-950/60 ring-2 ring-blue-500 rounded-xl"
                      : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          {formatDateId(g.expense_date)}
                        </span>
                        {g.invoice_number && g.invoice_number !== "-" && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            #{g.invoice_number}
                          </span>
                        )}
                        {g.items_count > 1 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                            {g.items_count} item
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {single ? single.item_name : summary.title}
                        {summary.extraCount > 0 && (
                          <span className="text-blue-700 dark:text-blue-300 ml-1">
                            +{summary.extraCount} lainnya
                          </span>
                        )}
                      </h4>

                      <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {g.supplier || "-"}
                        </span>
                        {g.user_name && (
                          <span className="text-[11px] text-indigo-700 dark:text-indigo-300">
                            • {g.user_name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="font-bold text-slate-950 dark:text-white text-sm tabular-nums">
                        {formatRupiah(g.total_amount)}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${catColor.bg} ${catColor.border}`}
                      >
                        {g.primary_category}
                        {g.categories.length > 1 ? ` +${g.categories.length - 1}` : ""}
                      </span>
                    </div>
                  </div>

                  {/* Status + Expand Items Trigger */}
                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (single) {
                          if ((g.is_dp || hasCod) && onOpenPaymentModal) {
                            onOpenPaymentModal(single, "full");
                          } else {
                            onToggleStatus(single);
                          }
                        } else if ((g.is_dp || hasCod) && onOpenInvoicePaymentModal) {
                          onOpenInvoicePaymentModal(g, "full");
                        } else if (onToggleInvoiceStatus) {
                          onToggleInvoiceStatus(g);
                        }
                      }}
                      className={cn(
                        "min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border",
                        g.is_paid
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                          : g.is_dp || hasCod || g.is_mixed_pay_status
                          ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                          : "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
                      )}
                    >
                      {g.is_paid ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Lunas</span>
                        </>
                      ) : g.is_dp ? (
                        <>
                          <Clock className="w-3.5 h-3.5" />
                          <span>DP {Math.round(g.payment_progress_pct)}%</span>
                        </>
                      ) : g.is_mixed_pay_status ? (
                        <span>Sebagian Lunas</span>
                      ) : (
                        <span>Hutang</span>
                      )}
                    </button>

                    <div className="flex items-center gap-1.5 ml-auto">
                      {tgMeta.isUrl && (
                        <a
                          href={tgMeta.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-[#229ED9]"
                          aria-label="Buka pesan di Telegram"
                        >
                          <TelegramIcon className="w-4 h-4" />
                        </a>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => toggleMobileExpand(g.group_key)}
                        aria-expanded={isExpanded}
                        className="min-h-[44px] px-3 rounded-xl text-xs font-semibold gap-1.5 border-slate-300 dark:border-slate-700"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-4 h-4" />
                            <span>Tutup Items</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4" />
                            <span>Lihat {g.items_count} Item</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Items Inside Mobile Card */}
                  {isExpanded && (
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700 p-3 space-y-2.5">
                      <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                        {g.items.map((it) => {
                          const bd = getExpensePaymentBreakdown(it);
                          return (
                            <div
                              key={it.id}
                              id={single ? undefined : `expense-row-${it.id}`}
                              className="py-2.5 first:pt-0 last:pb-0 space-y-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onInspectItemPrice?.(it.item_name, it.master_item_id)
                                    }
                                    className="font-semibold text-xs text-slate-900 dark:text-slate-100 text-left hover:underline"
                                  >
                                    {it.item_name}
                                  </button>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums mt-0.5">
                                    {it.qty} {it.unit || "Pcs"} × {formatRupiah(it.unit_price)} •{" "}
                                    <span>{it.category}</span>
                                  </div>
                                  {it.notes && it.notes !== "-" && (
                                    <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                                      {it.notes}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-bold text-xs text-slate-900 dark:text-slate-100 tabular-nums">
                                    {formatRupiah(it.total_price)}
                                  </div>
                                  <span
                                    className={cn(
                                      "inline-block text-[10px] font-semibold mt-0.5",
                                      bd.isPaid
                                        ? "text-emerald-700 dark:text-emerald-400"
                                        : "text-rose-700 dark:text-rose-400"
                                    )}
                                  >
                                    {it.pay_status}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-1.5">
                                {onViewExpense && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => onViewExpense(it)}
                                    className="min-h-[44px] min-w-[44px] rounded-xl"
                                    aria-label={`Detail ${it.item_name}`}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                )}
                                {onRepeatExpense && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => onRepeatExpense(it)}
                                    className="min-h-[44px] min-w-[44px] rounded-xl"
                                    aria-label={`Beli lagi ${it.item_name}`}
                                  >
                                    <Repeat className="w-4 h-4" />
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => onEditExpense(it)}
                                  className="min-h-[44px] min-w-[44px] rounded-xl"
                                  aria-label={`Edit ${it.item_name}`}
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                {canDelete && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleDelete(it.id)}
                                    disabled={deletingId === it.id}
                                    className="min-h-[44px] min-w-[44px] rounded-xl text-rose-700 border-rose-200"
                                    aria-label={`Hapus ${it.item_name}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <InvoiceFeeFooter group={g} showPaymentSummary={!g.is_paid} compact />
                    </div>
                  )}
                </div>
              );
            })
          : expenses.map((e) => {
            const catColor = getCategoryColor(e.category);
            const bd = getExpensePaymentBreakdown(e);
            const isLunas = bd.isPaid;
            const tgMeta = parseTelegramLink(e.msg_link);

            return (
              <div
                key={e.id}
                id={`expense-row-${e.id}`}
                className={cn(
                  "p-3 space-y-2 transition-all",
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold border ${catColor.bg} ${catColor.border}`}
                    >
                      {e.category || "Operasional"}
                    </span>
                    {categoryCoaMap?.[e.category || "Operasional"]?.code && (
                      <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {categoryCoaMap[e.category || "Operasional"].code}
                      </span>
                    )}
                  </div>
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
                      onClick={() => {
                        if (bd.isDp && onOpenPaymentModal) {
                          onOpenPaymentModal(e, "full");
                        } else {
                          onToggleStatus(e);
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border ${
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
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>DP {Math.round(bd.progressPct)}%</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-3.5 h-3.5 text-rose-600" />
                          <span>Hutang</span>
                        </>
                      )}
                    </button>

                    {isLunas && ((e.payments_count || 0) > 1 || (e.payments && e.payments.some((p) => p.payment_type === "dp"))) && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <History className="w-3 h-3" />
                        <span>DP Dilunasi</span>
                      </span>
                    )}

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
    </DataTable>
  );
};
