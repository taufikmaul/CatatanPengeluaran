import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BankAccount } from "@/types";
import { getBankTransfers, createBankTransfer, deleteBankTransfer } from "@/lib/api";
import { formatRupiah, toIsoDate } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/common/DataTable";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowRightLeft, Plus, Trash2, Loader2 } from "lucide-react";

interface BankTransferPanelProps {
  accounts: BankAccount[];
  isAdmin: boolean;
}

const TRANSFER_TYPE_LABELS: Record<string, string> = {
  setor_tunai: "Setor Tunai Kasir ke Bank",
  pencairan_platform: "Pencairan Dompet Platform",
  antar_rekening: "Transfer Antar Rekening",
};

export const BankTransferPanel: React.FC<BankTransferPanelProps> = ({
  accounts,
  isAdmin,
}) => {
  const queryClient = useQueryClient();
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split("T")[0]);
  const [transferType, setTransferType] = useState<
    "setor_tunai" | "pencairan_platform" | "antar_rekening"
  >("setor_tunai");
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [adminFee, setAdminFee] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["bank-transfers"],
    queryFn: () => getBankTransfers(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createBankTransfer({
        transfer_date: transferDate,
        from_account_id: Number(fromId),
        to_account_id: Number(toId),
        amount: Number(amount),
        admin_fee: Number(adminFee) || 0,
        transfer_type: transferType,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success("Mutasi transfer antar rekening berhasil dicatat");
      setAmount("");
      setAdminFee("0");
      setNotes("");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mencatat transfer");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBankTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success("Data transfer dihapus");
    },
    onError: () => toast.error("Gagal menghapus data transfer"),
  });

  const activeAccounts = accounts.filter((a) => a.is_active);

  type TransferRow = (typeof transfers)[number];
  const transferColumns = useMemo<ColumnDef<DataGridFeatures, TransferRow>[]>(() => {
    const cols: ColumnDef<DataGridFeatures, TransferRow>[] = [
      {
        accessorKey: "transfer_date",
        id: "transfer_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => (
          <span className="font-medium text-slate-800 whitespace-nowrap">
            {row.original.transfer_date}
          </span>
        ),
        size: 110,
      },
      {
        accessorKey: "transfer_type",
        id: "transfer_type",
        header: ({ column }) => <DataGridColumnHeader title="Jenis" column={column} />,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px]">
            {TRANSFER_TYPE_LABELS[row.original.transfer_type] || row.original.transfer_type}
          </Badge>
        ),
        size: 185,
      },
      {
        id: "route",
        header: () => <span>Dari → Ke</span>,
        cell: ({ row }) => (
          <span>
            <span className="font-medium text-rose-700">{row.original.from_account_name}</span>{" "}
            <span className="text-slate-400">→</span>{" "}
            <span className="font-medium text-emerald-700">{row.original.to_account_name}</span>
          </span>
        ),
        size: 220,
      },
      {
        accessorKey: "amount",
        id: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Nominal"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
            {formatRupiah(row.original.amount)}
          </div>
        ),
        size: 125,
      },
      {
        accessorKey: "admin_fee",
        id: "admin_fee",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Admin"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-slate-500 whitespace-nowrap">
            {row.original.admin_fee > 0 ? formatRupiah(row.original.admin_fee) : "-"}
          </div>
        ),
        size: 100,
      },
      {
        accessorKey: "notes",
        id: "notes",
        header: () => <span>Catatan</span>,
        cell: ({ row }) => (
          <span className="text-slate-500">{row.original.notes || "-"}</span>
        ),
        size: 180,
      },
    ];
    if (isAdmin) {
      cols.push({
        id: "actions",
        header: () => <div className="text-center w-full">Aksi</div>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                if (confirm("Hapus catatan transfer ini?")) {
                  deleteMutation.mutate(row.original.id);
                }
              }}
              className="p-1 text-slate-400 hover:text-rose-600"
              aria-label="Hapus catatan transfer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
        size: 64,
      });
    }
    return cols;
  }, [isAdmin, deleteMutation]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            Catat Setor Tunai / Pencairan Platform / Transfer Antar Rekening
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Tanggal</label>
              <DatePicker
                value={transferDate}
                onChange={(d) => setTransferDate(toIsoDate(d))}
                className="w-full h-9 text-xs"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Jenis Mutasi</label>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs"
                value={transferType}
                onChange={(e) => setTransferType(e.target.value as any)}
              >
                <option value="setor_tunai">Setor Tunai Kasir</option>
                <option value="pencairan_platform">Pencairan Platform</option>
                <option value="antar_rekening">Antar Rekening</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Dari Rekening</label>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                <option value="">-- Pilih Asal --</option>
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={String(acc.id)}>
                    {acc.name} ({formatRupiah(acc.estimated_balance)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Ke Rekening</label>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                <option value="">-- Pilih Tujuan --</option>
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={String(acc.id)}>
                    {acc.name} ({formatRupiah(acc.estimated_balance)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Nominal (Rp)</label>
              <Input
                type="number"
                placeholder="cth. 500000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Biaya Admin</label>
              <Input
                type="number"
                placeholder="0"
                value={adminFee}
                onChange={(e) => setAdminFee(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 mt-3">
            <Input
              placeholder="Catatan (opsional, cth. Setor tunai kasir shift pagi)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9 text-xs flex-1"
            />
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!fromId || !toId || !(Number(amount) > 0) || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Catat Mutasi
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Memuat riwayat transfer...
          </div>
        ) : transfers.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            Belum ada mutasi transfer antar rekening.
          </div>
        ) : (
          <DataTable
            columns={transferColumns}
            data={transfers}
            getRowId={(row) => String(row.id)}
            defaultPageSize={10}
            containerClassName="border-0 rounded-none shadow-none"
          />
        )}
      </Card>
    </div>
  );
};
