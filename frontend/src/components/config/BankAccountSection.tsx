import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BankAccount, BankAccountType } from "@/types";
import {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Landmark,
  Wallet,
  Banknote,
  Smartphone,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";

const ACCOUNT_TYPE_META: Record<
  BankAccountType,
  { label: string; icon: React.ElementType; badgeClass: string }
> = {
  bank: {
    label: "Rekening Bank",
    icon: Landmark,
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  cash: {
    label: "Kas Tunai",
    icon: Banknote,
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  ewallet: {
    label: "E-Wallet / QRIS",
    icon: Smartphone,
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  aggregator: {
    label: "Dompet Platform",
    icon: Wallet,
    badgeClass: "bg-slate-100 text-slate-700 border-slate-300",
  },
};

const SUGGESTED_POS_CHANNELS = [
  "Cash",
  "QRIS",
  "Transfer",
  "GoFood Integrasi",
  "GrabFood Integrasi",
  "ShopeeFood",
  "Shopee",
  "Tokped/Tiktok",
  "Cakeflow",
];

interface FormState {
  name: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  account_type: BankAccountType;
  account_code: string;
  opening_balance: string;
  channel_mappings: string[];
  custom_channel: string;
  notes: string;
  is_default: boolean;
  is_active: boolean;
}

const DEFAULT_COA_BY_TYPE: Record<BankAccountType, string> = {
  cash: "1-1110",
  bank: "1-1120",
  ewallet: "1-1121",
  aggregator: "1-1130",
};

const EMPTY_FORM: FormState = {
  name: "",
  bank_name: "",
  account_number: "",
  account_holder: "",
  account_type: "bank",
  account_code: "1-1120",
  opening_balance: "0",
  channel_mappings: [],
  custom_channel: "",
  notes: "",
  is_default: false,
  is_active: true,
};

export const BankAccountSection: React.FC = () => {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: accounts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => getBankAccounts(false),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        bank_name: form.bank_name.trim(),
        account_number: form.account_number.trim() || undefined,
        account_holder: form.account_holder.trim() || undefined,
        account_type: form.account_type,
        account_code: form.account_code.trim() || DEFAULT_COA_BY_TYPE[form.account_type],
        opening_balance: Number(form.opening_balance) || 0,
        channel_mappings: form.channel_mappings,
        notes: form.notes.trim() || undefined,
        is_default: form.is_default,
        is_active: form.is_active,
      };
      if (editing) {
        return updateBankAccount(editing.id, payload);
      }
      return createBankAccount(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success(editing ? "Rekening berhasil diperbarui" : "Rekening baru ditambahkan");
      setDialogOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan rekening");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBankAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success("Rekening berhasil dihapus");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menghapus rekening");
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (acc: BankAccount) => {
    setEditing(acc);
    setForm({
      name: acc.name,
      bank_name: acc.bank_name,
      account_number: acc.account_number || "",
      account_holder: acc.account_holder || "",
      account_type: acc.account_type,
      account_code: acc.account_code || DEFAULT_COA_BY_TYPE[acc.account_type] || "1-1120",
      opening_balance: String(acc.opening_balance || 0),
      channel_mappings: acc.channel_mappings || [],
      custom_channel: "",
      notes: acc.notes || "",
      is_default: acc.is_default,
      is_active: acc.is_active,
    });
    setDialogOpen(true);
  };

  const toggleChannel = (ch: string) => {
    setForm((prev) => {
      const exists = prev.channel_mappings.includes(ch);
      return {
        ...prev,
        channel_mappings: exists
          ? prev.channel_mappings.filter((c) => c !== ch)
          : [...prev.channel_mappings, ch],
      };
    });
  };

  const addCustomChannel = () => {
    const val = form.custom_channel.trim();
    if (!val) return;
    if (!form.channel_mappings.includes(val)) {
      setForm((prev) => ({
        ...prev,
        channel_mappings: [...prev.channel_mappings, val],
        custom_channel: "",
      }));
    } else {
      setForm((prev) => ({ ...prev, custom_channel: "" }));
    }
  };

  const totalEstimatedBalance = accounts
    .filter((a) => a.is_active)
    .reduce((sum, a) => sum + (a.estimated_balance || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-blue-600" />
              Rekening Setup &amp; Mapping Channel POS
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Atur rekening bank, kas tunai, dan dompet platform agar setiap transaksi masuk dari
              POS otomatis terarah ke rekening yang tepat.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block mr-2">
              <div className="text-[11px] text-slate-500">Total Estimasi Saldo Aktif</div>
              <div className="text-sm font-semibold text-slate-900 tabular-nums">
                {formatRupiah(totalEstimatedBalance)}
              </div>
            </div>
            <Button onClick={openCreate} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              Tambah Rekening
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="py-10 flex items-center justify-center text-slate-500 gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Memuat daftar rekening...
            </div>
          ) : isError ? (
            <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
              <AlertCircle className="w-6 h-6 text-rose-500" />
              <p className="text-sm text-slate-600">Gagal memuat data rekening.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Coba Lagi
              </Button>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/60 px-4">
              <Landmark className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">Belum ada rekening terdaftar</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Tambahkan rekening seperti <strong>Kas Tunai Toko</strong>,{" "}
                <strong>BCA Operasional</strong>, atau <strong>GoBiz / ShopeeFood Wallet</strong>{" "}
                beserta mapping metode bayar POS-nya.
              </p>
              <Button onClick={openCreate} size="sm" variant="outline" className="mt-3 gap-1.5">
                <Plus className="w-4 h-4" />
                Buat Rekening Pertama
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {accounts.map((acc) => {
                const meta = ACCOUNT_TYPE_META[acc.account_type] || ACCOUNT_TYPE_META.bank;
                const Icon = meta.icon;
                return (
                  <div
                    key={acc.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      acc.is_active
                        ? "bg-white border-slate-200"
                        : "bg-slate-50/70 border-slate-200/70 opacity-75"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="p-2 rounded-lg bg-slate-100 text-slate-700 shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="font-semibold text-sm text-slate-900 truncate">
                              {acc.name}
                            </h4>
                            {acc.is_default && (
                              <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0">
                                Default
                              </Badge>
                            )}
                            <Badge variant="outline" className={`text-[10px] ${meta.badgeClass}`}>
                              {meta.label}
                            </Badge>
                            {acc.account_code && (
                              <Badge variant="outline" className="text-[10px] font-mono bg-slate-50 text-slate-600">
                                COA {acc.account_code}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {acc.bank_name}
                            {acc.account_number ? ` • ${acc.account_number}` : ""}
                            {acc.account_holder ? ` (${acc.account_holder})` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-500 hover:text-slate-900"
                          onClick={() => openEdit(acc)}
                          aria-label={`Edit ${acc.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-400 hover:text-rose-600"
                          onClick={() => {
                            if (confirm(`Hapus rekening "${acc.name}"?`)) {
                              deleteMutation.mutate(acc.id);
                            }
                          }}
                          aria-label={`Hapus ${acc.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Saldo Awal</span>
                        <span className="font-medium text-slate-700 tabular-nums">
                          {formatRupiah(acc.opening_balance)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Masuk ({acc.tx_count} tx)
                        </span>
                        <span className="font-medium text-emerald-700 tabular-nums">
                          +{formatRupiah(acc.total_incoming)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Estimasi Saldo</span>
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {formatRupiah(acc.estimated_balance)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1 flex-wrap">
                        {acc.channel_mappings.length > 0 ? (
                          acc.channel_mappings.map((ch) => (
                            <Badge
                              key={ch}
                              variant="secondary"
                              className="text-[10px] font-normal bg-slate-100 text-slate-700"
                            >
                              {ch}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            Belum ada mapping channel
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        {acc.is_active ? (
                          <span className="text-emerald-600 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Aktif
                          </span>
                        ) : (
                          <span className="text-slate-400 inline-flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Nonaktif
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Rekening" : "Tambah Rekening Baru"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Nama Rekening / Akun *
                </label>
                <Input
                  placeholder="cth. BCA Operasional"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Tipe Akun *
                </label>
                <select
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={form.account_type}
                  onChange={(e) => {
                    const nextType = e.target.value as BankAccountType;
                    setForm({
                      ...form,
                      account_type: nextType,
                      account_code: DEFAULT_COA_BY_TYPE[nextType] || form.account_code,
                    });
                  }}
                >
                  <option value="bank">Rekening Bank</option>
                  <option value="cash">Kas Tunai</option>
                  <option value="ewallet">E-Wallet / QRIS</option>
                  <option value="aggregator">Dompet Platform (GoBiz/Grab/Shopee)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Nama Bank / Provider *
                </label>
                <Input
                  placeholder="cth. BCA, Mandiri, Cash, GoBiz"
                  value={form.bank_name}
                  onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Nomor Rekening / ID
                </label>
                <Input
                  placeholder="Opsional"
                  value={form.account_number}
                  onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Kode Akun COA
                </label>
                <Input
                  placeholder="cth. 1-1120"
                  className="font-mono"
                  value={form.account_code}
                  onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Atas Nama
                </label>
                <Input
                  placeholder="cth. History Cake"
                  value={form.account_holder}
                  onChange={(e) => setForm({ ...form, account_holder: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Saldo Awal (Rp)
                </label>
                <Input
                  type="number"
                  value={form.opening_balance}
                  onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1.5">
                Auto-Mapping Metode Bayar / Tipe Order POS
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUGGESTED_POS_CHANNELS.map((ch) => {
                  const selected = form.channel_mappings.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                        selected
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {ch}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Tambah nama channel lain..."
                  value={form.custom_channel}
                  onChange={(e) => setForm({ ...form, custom_channel: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomChannel();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={addCustomChannel}>
                  Tambah
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-5 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="rounded border-slate-300"
                />
                Jadikan rekening default
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-slate-300"
                />
                Aktif
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={!form.name.trim() || !form.bank_name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Simpan Rekening
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
