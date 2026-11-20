import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getIncomingTransactions,
  getBankAccounts,
  reassignIncomingTxBankAccount,
  deleteIncomingTransaction,
  downloadIncomingTxTemplateCsv,
  exportIncomingTransactionsCsv,
  bulkCreateIncomingTransactions,
  importIncomingTransactionsCsv,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SalesImportModal } from "./SalesImportModal";
import { IncomingAnalyticsPanel } from "./IncomingAnalyticsPanel";
import { BankTransferPanel } from "./BankTransferPanel";
import { ReconciliationPanel } from "./ReconciliationPanel";
import { IncomingTransactionFormModal } from "./IncomingTransactionFormModal";
import {
  BulkRowImportDialog,
  type BulkRowColumn,
} from "@/components/common/BulkRowImportDialog";
import { CsvTemplateImportDialog } from "@/components/common/CsvTemplateImportDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  CheckCircle2,
  TrendingUp,
  ArrowRightLeft,
  GitCompareArrows,
  Plus,
  Table2,
  FileSpreadsheet,
  Download,
  Pencil,
} from "lucide-react";
import type { IncomingTransaction, BulkIncomingTxRow } from "@/types";

interface IncomingTransactionsTabProps {
  isAdmin: boolean;
}

export const IncomingTransactionsTab: React.FC<IncomingTransactionsTabProps> = ({
  isAdmin,
}) => {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<IncomingTransaction | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [csvTemplateOpen, setCsvTemplateOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [subTab, setSubTab] = useState<string>("list");
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

  const bulkMutation = useMutation({
    mutationFn: ({
      rows,
      updateExisting,
    }: {
      rows: BulkIncomingTxRow[];
      updateExisting: boolean;
    }) => bulkCreateIncomingTransactions(rows, updateExisting),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success(res.message || "Transaksi masal berhasil diproses");
      setBulkDialogOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan transaksi masal");
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: ({
      file,
      updateExisting,
    }: {
      file: File;
      updateExisting: boolean;
    }) => importIncomingTransactionsCsv(file, updateExisting),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      if (res.audit && res.audit.warning_count > 0) {
        toast.warning(
          res.message || `Import CSV selesai dengan ${res.audit.warning_count} catatan audit`,
          {
            description:
              "Ditemukan transaksi dengan potensi anomali nominal, tanggal, atau rekening belum terdaftar.",
          }
        );
      } else {
        toast.success(res.message || "Import CSV selesai");
      }
      setCsvTemplateOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengimpor file CSV");
    },
  });

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      await exportIncomingTransactionsCsv({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        order_type: orderType !== "all" ? orderType : undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        bank_account_id:
          bankAccountId !== "all" ? Number(bankAccountId) : undefined,
        search: search.trim() || undefined,
      });
      toast.success("File CSV transaksi masuk berhasil diunduh.");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal mengekspor file CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleEditTx = (tx: IncomingTransaction) => {
    setEditingTx(tx);
    setFormOpen(true);
  };

  const handleAddSingleTx = () => {
    setEditingTx(null);
    setFormOpen(true);
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const transactions = data?.transactions || [];
  const summary = data?.summary;
  const orderTypes = data?.facets?.order_types || [];
  const paymentMethods = data?.facets?.payment_methods || [];

  const incomingBulkColumns: BulkRowColumn<BulkIncomingTxRow>[] = useMemo(
    () => [
      {
        key: "transaction_date",
        label: "Tanggal *",
        type: "date",
        required: true,
        widthClass: "w-32",
      },
      {
        key: "transaction_time",
        label: "Jam",
        type: "text",
        placeholder: "12:30",
        widthClass: "w-24",
      },
      {
        key: "receipt_no",
        label: "No Struk",
        type: "text",
        placeholder: "POS-001",
        widthClass: "w-32",
      },
      {
        key: "order_no",
        label: "No Order",
        type: "text",
        placeholder: "ORD-001",
        widthClass: "w-32",
      },
      {
        key: "order_type",
        label: "Tipe Order *",
        type: "select",
        options: [
          { value: "Take Away", label: "Take Away" },
          { value: "Dine In", label: "Dine In" },
          { value: "Delivery Toko", label: "Delivery Toko" },
          { value: "GoFood", label: "GoFood" },
          { value: "GoFood Integrasi", label: "GoFood Integrasi" },
          { value: "GrabFood", label: "GrabFood" },
          { value: "ShopeeFood", label: "ShopeeFood" },
          { value: "WhatsApp / Titip", label: "WhatsApp / Titip" },
          { value: "Lainnya", label: "Lainnya" },
        ],
        widthClass: "w-36",
      },
      {
        key: "payment_method",
        label: "Metode Bayar *",
        type: "select",
        options: [
          { value: "Tunai", label: "Tunai" },
          { value: "QRIS", label: "QRIS" },
          { value: "BCA Transfer", label: "BCA Transfer" },
          { value: "Mandiri", label: "Mandiri" },
          { value: "EDC", label: "EDC" },
          { value: "GoFood Integrasi", label: "GoFood Integrasi" },
          { value: "GrabFood", label: "GrabFood" },
          { value: "ShopeeFood", label: "ShopeeFood" },
          { value: "ShopeePay", label: "ShopeePay" },
          { value: "Lainnya", label: "Lainnya" },
        ],
        widthClass: "w-36",
      },
      {
        key: "bank_account_name",
        label: "Rekening Tujuan",
        type: "select",
        options: [
          { value: "", label: "-- Otomatis --" },
          ...accounts.map((a) => ({ value: a.name, label: a.name })),
        ],
        widthClass: "w-40",
      },
      { key: "customer_name", label: "Pelanggan", type: "text", widthClass: "w-32" },
      { key: "cashier_name", label: "Kasir", type: "text", widthClass: "w-28" },
      {
        key: "gross_sales",
        label: "Kotor (Rp) *",
        type: "number",
        required: true,
        min: 0,
        widthClass: "w-28",
      },
      {
        key: "discount_amount",
        label: "Diskon (Rp)",
        type: "number",
        min: 0,
        widthClass: "w-24",
      },
      {
        key: "platform_fee",
        label: "Fee Platform (Rp)",
        type: "number",
        min: 0,
        widthClass: "w-28",
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "paid", label: "Dibayar (Paid)" },
          { value: "void", label: "Void / Batal" },
        ],
        widthClass: "w-32",
      },
      { key: "notes", label: "Catatan", type: "text", widthClass: "w-36" },
    ],
    [accounts]
  );

  const createEmptyIncomingRow = (): BulkIncomingTxRow => ({
    transaction_date: new Date().toISOString().split("T")[0],
    transaction_time: "",
    receipt_no: "",
    order_no: "",
    order_type: "Take Away",
    payment_method: "Tunai",
    bank_account_name: "",
    customer_name: "",
    cashier_name: "",
    gross_sales: 0,
    discount_amount: 0,
    platform_fee: 0,
    status: "paid",
    notes: "",
  });

  return (
    <div className="space-y-4">
      {/* Compact Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {summary?.paid_count || 0} Transaksi Masuk
          </Badge>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Total Bersih: <strong className="text-emerald-700 dark:text-emerald-400 font-bold">{formatRupiah(summary?.net_received || 0)}</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isExporting}
            className="gap-1.5 h-8 text-xs bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
            title="Download CSV transaksi sesuai filter yang aktif"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            {isExporting ? "Mengekspor..." : "Export CSV"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCsvTemplateOpen(true)}
            className="gap-1.5 h-8 text-xs bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
            title="Import file CSV dengan opsi perbarui data yang sudah ada"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            Import CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="gap-1.5 h-8 text-xs bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
            title="Import laporan riwayat penjualan POS Moka / Olsera multi-baris"
          >
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            Import POS
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkDialogOpen(true)}
            className="gap-1.5 h-8 text-xs bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs"
            title="Input banyak transaksi sekaligus atau paste dari Excel/Sheets"
          >
            <Table2 className="w-3.5 h-3.5 text-indigo-600" />
            Input Masal
          </Button>

          <Button
            onClick={handleAddSingleTx}
            size="sm"
            className="gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-2xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Satuan
          </Button>
        </div>
      </div>

      <Tabs value={subTab} onValueChange={setSubTab} className="w-full space-y-4">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto p-1 gap-1 bg-slate-100 rounded-xl border border-slate-200/70">
          <TabsTrigger value="list" className="gap-1.5 py-2 text-xs font-medium rounded-lg">
            <Receipt className="w-3.5 h-3.5 text-blue-600" />
            <span>Daftar Transaksi</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5 py-2 text-xs font-medium rounded-lg">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span>Radar Menu &amp; Jam Sibuk</span>
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5 py-2 text-xs font-medium rounded-lg">
            <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
            <span>Transfer Rekening</span>
          </TabsTrigger>
          <TabsTrigger value="reconcile" className="gap-1.5 py-2 text-xs font-medium rounded-lg">
            <GitCompareArrows className="w-3.5 h-3.5 text-indigo-600" />
            <span>Rekonsiliasi</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4 mt-0">

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
                  <th className="w-16 px-2 py-2.5 text-center font-medium">Aksi</th>
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
                          {tx.reconciled_at && (
                            <div className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-blue-700">
                              <CheckCircle2 className="w-3 h-3" /> Cocok
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditTx(tx)}
                              className="p-1 text-slate-400 hover:text-blue-600 transition-colors rounded hover:bg-slate-100"
                              aria-label={`Edit transaksi ${tx.receipt_no || tx.id}`}
                              title="Edit Transaksi"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Hapus transaksi ${tx.receipt_no || tx.id}?`)) {
                                    deleteMutation.mutate(tx.id);
                                  }
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded hover:bg-slate-100"
                                aria-label="Hapus transaksi"
                                title="Hapus Transaksi"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && tx.items.length > 0 && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={9} className="px-6 py-2.5">
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
        </TabsContent>

        <TabsContent value="analytics" className="mt-0">
          <IncomingAnalyticsPanel startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="transfers" className="mt-0">
          <BankTransferPanel accounts={accounts} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="reconcile" className="mt-0">
          <ReconciliationPanel accounts={accounts} />
        </TabsContent>
      </Tabs>

      <SalesImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImportSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
        }}
      />

      <IncomingTransactionFormModal
        isOpen={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingTx(null);
        }}
        initialData={editingTx}
        accounts={accounts}
        orderTypeOptions={orderTypes}
        paymentMethodOptions={paymentMethods}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
          queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
        }}
      />

      <BulkRowImportDialog<BulkIncomingTxRow>
        isOpen={bulkDialogOpen}
        onClose={() => setBulkDialogOpen(false)}
        title="Input Transaksi Masuk Masal (Form Tabel)"
        description="Input banyak transaksi sekaligus atau tempel (paste) langsung dari Excel / Google Sheets. Aktifkan opsi 'Perbarui jika data sudah ada' untuk menimpa data no receipt yang cocok."
        columns={incomingBulkColumns}
        createEmptyRow={createEmptyIncomingRow}
        requiredKey="gross_sales"
        showUpdateExistingToggle={true}
        isSubmitting={bulkMutation.isPending}
        submitLabel="Simpan Semua Transaksi"
        onSubmit={async (rows, updateExisting) => {
          await bulkMutation.mutateAsync({ rows, updateExisting });
        }}
      />

      <CsvTemplateImportDialog
        isOpen={csvTemplateOpen}
        onClose={() => setCsvTemplateOpen(false)}
        title="Import Transaksi Masuk via Template CSV"
        description="Unduh template CSV resmi, isi data transaksi masuk (separator koma atau titik koma didukung), lalu unggah kembali. Opsi perbarui data akan menimpa data transaksi yang nomor struk/receipt-nya sama."
        templateColumns={[
          "No Receipt",
          "No Order",
          "Tanggal",
          "Jam",
          "Tipe Order",
          "Metode Bayar",
          "Rekening Tujuan",
          "Nama Pelanggan",
          "Nama Kasir",
          "Penjualan Kotor",
          "Diskon",
          "Fee Platform",
          "Status",
          "Catatan",
        ]}
        showUpdateExistingToggle={true}
        isImporting={csvImportMutation.isPending}
        onDownloadTemplate={downloadIncomingTxTemplateCsv}
        onImportCsv={async (file, updateExisting) => {
          await csvImportMutation.mutateAsync({ file, updateExisting });
        }}
      />
    </div>
  );
};
