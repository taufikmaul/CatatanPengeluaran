import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BankAccount, ReconciliationPreview } from "@/types";
import { previewReconciliation, applyReconciliation } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/common/DataTable";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CheckCircle2, Upload, Loader2, GitCompareArrows } from "lucide-react";

interface ReconciliationPanelProps {
  accounts: BankAccount[];
}

export const ReconciliationPanel: React.FC<ReconciliationPanelProps> = ({
  accounts,
}) => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"mutasi_bank" | "settlement_platform">("mutasi_bank");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      toast.error("Harap pilih file berformat .csv");
      return;
    }
    setFile(selected);
    await runPreview(selected, mode, bankAccountId);
  };

  const runPreview = async (
    targetFile: File,
    targetMode: "mutasi_bank" | "settlement_platform",
    accIdStr: string
  ) => {
    setIsPreviewing(true);
    try {
      const res = await previewReconciliation(
        targetFile,
        targetMode,
        accIdStr ? Number(accIdStr) : null
      );
      setPreview(res);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal memproses file rekonsiliasi");
      setPreview(null);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    setIsApplying(true);
    try {
      const res = await applyReconciliation({
        incoming_matches: preview.matched_incoming,
        expense_matches: preview.matched_expenses,
      });
      toast.success(
        `Rekonsiliasi selesai: ${res.reconciled_incoming} transaksi masuk & ${res.reconciled_expenses} pengeluaran ditandai cocok.`
      );
      queryClient.invalidateQueries({ queryKey: ["incoming-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setPreview(null);
      setFile(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal menerapkan rekonsiliasi");
    } finally {
      setIsApplying(false);
    }
  };

  type MatchedIncomingRow = ReconciliationPreview["matched_incoming"][number];
  type MatchedExpenseRow = ReconciliationPreview["matched_expenses"][number];

  const matchedIncomingColumns = useMemo<ColumnDef<DataGridFeatures, MatchedIncomingRow>[]>(
    () => [
      {
        accessorKey: "receipt_no",
        id: "receipt_no",
        header: () => <span>Receipt / Order</span>,
        cell: ({ row }) => (
          <span className="font-mono text-[11px]">
            {row.original.receipt_no || "-"}{" "}
            {row.original.order_no ? `• ${row.original.order_no}` : ""}
          </span>
        ),
        size: 180,
      },
      {
        accessorKey: "order_type",
        id: "order_type",
        header: ({ column }) => <DataGridColumnHeader title="Channel" column={column} />,
        cell: ({ row }) => <span>{row.original.order_type}</span>,
        size: 130,
      },
      {
        accessorKey: "old_net_received",
        id: "old_net_received",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Net POS"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums whitespace-nowrap">
            {formatRupiah(row.original.old_net_received)}
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: "new_platform_fee",
        id: "new_platform_fee",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Fee Baru"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-rose-600 whitespace-nowrap">
            {formatRupiah(row.original.new_platform_fee)}
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: "new_net_received",
        id: "new_net_received",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Net Settlement"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap">
            {formatRupiah(row.original.new_net_received)}
          </div>
        ),
        size: 130,
      },
    ],
    []
  );

  const matchedExpenseColumns = useMemo<ColumnDef<DataGridFeatures, MatchedExpenseRow>[]>(
    () => [
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tgl Belanja" column={column} />,
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.expense_date}</span>,
        size: 110,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Item & Supplier" column={column} />
        ),
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-slate-900">{row.original.item_name}</span>
            <span className="text-slate-400 block text-[11px]">{row.original.supplier}</span>
          </div>
        ),
        size: 200,
      },
      {
        accessorKey: "bank_desc",
        id: "bank_desc",
        header: () => <span>Keterangan Bank</span>,
        cell: ({ row }) => (
          <span className="text-slate-600">{row.original.bank_desc || "-"}</span>
        ),
        size: 200,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Nominal"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right font-semibold tabular-nums whitespace-nowrap">
            {formatRupiah(row.original.total_price)}
          </div>
        ),
        size: 125,
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-blue-600" />
            Rekonsiliasi Mutasi Bank &amp; Settlement Platform (Masuk + Pengeluaran)
          </CardTitle>
          <p className="text-xs text-slate-500">
            Cocokkan mutasi rekening bank (Kredit → Transaksi Masuk, Debit → Pengeluaran) atau
            laporan settlement GoFood/GrabFood/ShopeeFood untuk memperbarui komisi platform secara otomatis.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">
                Jenis File CSV
              </label>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs"
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as "mutasi_bank" | "settlement_platform";
                  setMode(next);
                  if (file) runPreview(file, next, bankAccountId);
                }}
              >
                <option value="mutasi_bank">Mutasi Rekening Bank (Kredit &amp; Debit)</option>
                <option value="settlement_platform">Settlement Platform (GoFood / Grab / ShopeeFood)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">
                Rekening Terkait (Opsional)
              </label>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-xs"
                value={bankAccountId}
                onChange={(e) => {
                  const next = e.target.value;
                  setBankAccountId(next);
                  if (file) runPreview(file, mode, next);
                }}
              >
                <option value="">-- Pertahankan mapping awal --</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={String(acc.id)}>
                    {acc.name} ({acc.account_code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">
                Unggah CSV Mutasi / Settlement
              </label>
              <label className="flex items-center justify-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-xs text-slate-700">
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate">{file ? file.name : "Pilih file .csv..."}</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {isPreviewing && (
        <div className="py-8 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Mencocokkan baris mutasi dengan transaksi masuk &amp; pengeluaran...
        </div>
      )}

      {preview && !isPreviewing && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-500">Total Baris CSV</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">
                  {preview.total_rows}
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/40 shadow-xs">
              <CardContent className="p-3">
                <div className="text-[11px] text-emerald-700">Cocok: Transaksi Masuk</div>
                <div className="text-lg font-semibold text-emerald-700 tabular-nums">
                  {preview.matched_incoming.length}
                </div>
              </CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50/40 shadow-xs">
              <CardContent className="p-3">
                <div className="text-[11px] text-blue-700">Cocok: Pengeluaran</div>
                <div className="text-lg font-semibold text-blue-700 tabular-nums">
                  {preview.matched_expenses.length}
                </div>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/40 shadow-xs">
              <CardContent className="p-3">
                <div className="text-[11px] text-amber-800">Belum Cocok</div>
                <div className="text-lg font-semibold text-amber-800 tabular-nums">
                  {preview.unmatched_rows.length}
                </div>
              </CardContent>
            </Card>
          </div>

          {preview.matched_incoming.length > 0 && (
            <DataTable
              columns={matchedIncomingColumns}
              data={preview.matched_incoming}
              getRowId={(m) => String(m.tx_id)}
              defaultPageSize={10}
              headerClassName="py-2.5 px-4 bg-emerald-50/60 border-b border-emerald-200/70"
              header={
                <h4 className="text-xs font-semibold text-emerald-900">
                  Transaksi Masuk Cocok ({preview.matched_incoming.length})
                </h4>
              }
            />
          )}

          {preview.matched_expenses.length > 0 && (
            <DataTable
              columns={matchedExpenseColumns}
              data={preview.matched_expenses}
              getRowId={(m) => String(m.expense_id)}
              defaultPageSize={10}
              headerClassName="py-2.5 px-4 bg-blue-50/60 border-b border-blue-200/70"
              header={
                <h4 className="text-xs font-semibold text-blue-900">
                  Pengeluaran Cocok ({preview.matched_expenses.length})
                </h4>
              }
            />
          )}

          {preview.unmatched_rows.length > 0 && (
            <Card className="border-slate-200 shadow-xs overflow-hidden">
              <CardHeader className="py-2.5 px-4 bg-amber-50/60 border-b border-amber-200/70">
                <CardTitle className="text-xs font-semibold text-amber-900">
                  Baris Belum Cocok ({preview.unmatched_rows.length})
                </CardTitle>
              </CardHeader>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
                {preview.unmatched_rows.slice(0, 20).map((u) => (
                  <div key={u.row_no} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div>
                      <Badge variant="outline" className="text-[10px] mr-1.5">
                        {u.direction}
                      </Badge>
                      <span className="text-slate-500 mr-1.5">{u.date || "-"}</span>
                      <span className="text-slate-800">{u.description}</span>
                    </div>
                    <span className="font-semibold tabular-nums shrink-0">
                      {formatRupiah(u.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              disabled={
                isApplying ||
                (preview.matched_incoming.length === 0 && preview.matched_expenses.length === 0)
              }
              onClick={handleApply}
              className="gap-1.5"
            >
              {isApplying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Terapkan Rekonsiliasi (
              {preview.matched_incoming.length + preview.matched_expenses.length} item)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
