import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getIncomingTransactions,
  getBankAccounts,
  reassignIncomingTxBankAccount,
  deleteIncomingTransaction,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SalesImportModal } from "./SalesImportModal";
import { toast } from "sonner";
import {
  Upload,
  Search,
  ChevronDown,
  ChevronRight,
  Trash2,
  Loader2,
  AlertCircle,
  Receipt,
  Landmark,
} from "lucide-react";

interface IncomingTransactionsTabProps {
  isAdmin: boolean;
}

export const IncomingTransactionsTab: React.FC<IncomingTransactionsTabProps> = ({
  isAdmin,
}) => {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [orderType, setOrderType] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bankAccountId, setBankAccountId] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => getBankAccounts(false),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      "incoming-transactions",
      { startDate, endDate, orderType, statusFilter, bankAccountId, search },
    ],
    queryFn: () =>
      getIncomingTransactions({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        order_type: orderType !== "all" ? orderType : undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        bank_account_id:
          bankAccountId !== "all" ? Number(bankAccountId) : undefined,
        search: search.trim() || undefined,
        limit: 200,
      }),
  });

  const reassignMutation = useMutation({
    mutationFn: ({ txId, accId }: { txId: number; accId: number | null }) =>
      reassignIncomingTxBankAccount(txId, accId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success("Rekening tujuan diperbarui");
    },
    onError: () => toast.error("Gagal memperbarui rekening tujuan"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteIncomingTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success("Transaksi dihapus");
    },
    onError: () => toast.error("Gagal menghapus transaksi"),
  });

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const transactions = data?.transactions || [];
  const summary = data?.summary;
  const orderTypes = data?.facets?.order_types || [];

  return (
    <div className="space-y-4">
      {/* Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Daftar Transaksi Masuk</h2>
          <p className="text-xs text-slate-500">
            Pantau omzet penjualan dari POS, GoFood, GrabFood, ShopeeFood, dan rekening tujuan.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)} size="sm" className="gap-1.5 self-start sm:self-auto">
          <Upload className="w-4 h-4" />
          Import Laporan POS / Platform
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="text-[11px] text-slate-500">Penjualan Kotor (Dibayar)</div>
            <div className="text-lg font-semibold text-slate-900 tabular-nums mt-0.5">
              {formatRupiah(summary?.gross_sales || 0)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {summary?.paid_count || 0} transaksi berhasil
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="text-[11px] text-slate-500">Diskon &amp; Fee Platform</div>
            <div className="text-lg font-semibold text-rose-700 tabular-nums mt-0.5">
              -{formatRupiah((summary?.discount_amount || 0) + (summary?.platform_fee || 0))}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Diskon {formatRupiah(summary?.discount_amount || 0)} • Fee{" "}
              {formatRupiah(summary?.platform_fee || 0)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="text-[11px] text-slate-500">Bersih Diterima</div>
            <div className="text-lg font-semibold text-emerald-700 tabular-nums mt-0.5">
              {formatRupiah(summary?.net_received || 0)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Net Sales: {formatRupiah(summary?.net_sales || 0)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="text-[11px] text-slate-500">Void / Dibatalkan</div>
            <div className="text-lg font-semibold text-amber-700 tabular-nums mt-0.5">
              {summary?.void_count || 0} struk
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Nilai batal: {formatRupiah(summary?.cancellation_total || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-slate-200 shadow-xs">
        <CardContent className="p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div className="relative lg:col-span-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Cari No Receipt, Order ID, Pelanggan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
            >
              <option value="all">Semua Tipe Order</option>
              {orderTypes.map((ot) => (
                <option key={ot} value={ot}>
                  {ot}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
            >
              <option value="all">Semua Rekening</option>
              <option value="0">Belum Terpetakan</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={String(acc.id)}>
                  {acc.name}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Semua Status</option>
              <option value="paid">Dibayar</option>
              <option value="void">Void / Batal</option>
            </select>

            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 text-xs"
                aria-label="Tanggal mulai"
              />
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 text-xs"
                aria-label="Tanggal selesai"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Memuat transaksi masuk...
          </div>
        ) : isError ? (
          <div className="py-10 flex flex-col items-center justify-center gap-2 text-center">
            <AlertCircle className="w-6 h-6 text-rose-500" />
            <p className="text-sm text-slate-600">Gagal memuat daftar transaksi masuk.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Coba Lagi
            </Button>
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center px-4">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">Belum ada transaksi masuk</p>
            <p className="text-xs text-slate-500 mt-1">
              Klik tombol <strong>Import Laporan POS / Platform</strong> untuk mengunggah file CSV
              dari POS.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-2.5" />
                  <th className="text-left px-3 py-2.5 font-medium">Tanggal &amp; Struk</th>
                  <th className="text-left px-3 py-2.5 font-medium">Tipe Order &amp; Bayar</th>
                  <th className="text-left px-3 py-2.5 font-medium">Rekening Tujuan</th>
                  <th className="text-right px-3 py-2.5 font-medium">Kotor</th>
                  <th className="text-right px-3 py-2.5 font-medium">Diskon / Fee</th>
                  <th className="text-right px-3 py-2.5 font-medium">Bersih Diterima</th>
                  <th className="text-center px-3 py-2.5 font-medium">Status</th>
                  {isAdmin && <th className="w-10 px-2 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx) => {
                  const isExpanded = !!expandedIds[tx.id];
                  return (
                    <React.Fragment key={tx.id}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="px-2 py-2.5 text-center">
                          {tx.items.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(tx.id)}
                              className="p-1 rounded hover:bg-slate-200/60 text-slate-500"
                              aria-label="Lihat rincian item"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-900">
                            {tx.transaction_date}{" "}
                            <span className="text-slate-400 font-normal">
                              {tx.transaction_time || ""}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {tx.receipt_no || "-"}
                            {tx.order_no ? ` • ${tx.order_no}` : ""}
                          </div>
                          {tx.customer_name && (
                            <div className="text-[11px] text-slate-500">{tx.customer_name}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className="text-[10px] font-medium">
                            {tx.order_type}
                          </Badge>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {tx.payment_method} • {tx.items.length} item
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <Landmark className="w-3 h-3 text-slate-400 shrink-0" />
                            <select
                              className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700 max-w-[150px]"
                              value={tx.bank_account_id ? String(tx.bank_account_id) : ""}
                              onChange={(e) =>
                                reassignMutation.mutate({
                                  txId: tx.id,
                                  accId: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                            >
                              <option value="">-- Belum dipetakan --</option>
                              {accounts.map((acc) => (
                                <option key={acc.id} value={String(acc.id)}>
                                  {acc.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {formatRupiah(tx.gross_sales)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">
                          {tx.discount_amount + tx.platform_fee > 0
                            ? `-${formatRupiah(tx.discount_amount + tx.platform_fee)}`
                            : "-"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                          {tx.status === "paid"
                            ? formatRupiah(tx.net_received)
                            : formatRupiah(0)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {tx.status === "paid" ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                              Dibayar
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                              Void
                            </Badge>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Hapus transaksi ${tx.receipt_no || tx.id}?`)) {
                                  deleteMutation.mutate(tx.id);
                                }
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600"
                              aria-label="Hapus transaksi"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>

                      {isExpanded && tx.items.length > 0 && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={isAdmin ? 9 : 8} className="px-6 py-2.5">
                            <div className="text-[11px] font-medium text-slate-600 mb-1.5">
                              Rincian Produk ({tx.items.length} item)
                            </div>
                            <div className="space-y-1">
                              {tx.items.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex items-center justify-between text-[11px] text-slate-700 border-b border-slate-200/60 pb-1 last:border-0"
                                >
                                  <div>
                                    <span className="font-medium">{it.product_name}</span>
                                    {it.sku && (
                                      <span className="text-slate-400 ml-1.5 font-mono">
                                        [{it.sku}]
                                      </span>
                                    )}
                                    {it.modifier && (
                                      <span className="text-slate-500 block">
                                        + {it.modifier}
                                      </span>
                                    )}
                                  </div>
                                  <div className="tabular-nums text-right shrink-0 ml-4">
                                    {it.qty} × {formatRupiah(it.unit_price + it.extra_price)} ={" "}
                                    <span className="font-medium">
                                      {formatRupiah(it.gross_amount)}
                                    </span>
                                    {it.discount_amount > 0 && (
                                      <span className="text-rose-600 ml-1.5">
                                        (-{formatRupiah(it.discount_amount)})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SalesImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImportSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
        }}
      />
    </div>
  );
};
