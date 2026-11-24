import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BankAccount, BankAccountType } from "@/types";
import {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getMasterData,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Card3D, Card3DItem } from "@/components/velora/3d-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
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
  {
    label: string;
    icon: React.ElementType;
    badgeClass: string;
    cardSurface: string;
    chipClass: string;
    accentLine: string;
  }
> = {
  bank: {
    label: "Rekening Bank",
    icon: Landmark,
    badgeClass: "bg-blue-500/20 text-blue-100 border-blue-300/30",
    cardSurface:
      "bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 border-blue-400/25",
    chipClass: "bg-blue-400/20 text-blue-100 border-blue-300/30",
    accentLine: "from-blue-400/40 via-sky-300/20 to-transparent",
  },
  cash: {
    label: "Kas Tunai",
    icon: Banknote,
    badgeClass: "bg-emerald-500/20 text-emerald-100 border-emerald-300/30",
    cardSurface:
      "bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 border-emerald-400/25",
    chipClass: "bg-emerald-400/20 text-emerald-100 border-emerald-300/30",
    accentLine: "from-emerald-400/40 via-teal-300/20 to-transparent",
  },
  ewallet: {
    label: "E-Wallet / QRIS",
    icon: Smartphone,
    badgeClass: "bg-amber-500/20 text-amber-100 border-amber-300/30",
    cardSurface:
      "bg-gradient-to-br from-amber-950 via-stone-900 to-neutral-900 border-amber-400/25",
    chipClass: "bg-amber-400/20 text-amber-100 border-amber-300/30",
    accentLine: "from-amber-400/40 via-orange-300/20 to-transparent",
  },
  aggregator: {
    label: "Dompet Platform",
    icon: Wallet,
    badgeClass: "bg-zinc-500/25 text-zinc-100 border-zinc-300/30",
    cardSurface:
      "bg-gradient-to-br from-zinc-900 via-slate-900 to-neutral-900 border-zinc-400/25",
    chipClass: "bg-zinc-400/20 text-zinc-100 border-zinc-300/30",
    accentLine: "from-zinc-300/35 via-slate-300/15 to-transparent",
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

  const { data: masterPayMethods = [] } = useQuery({
    queryKey: ["master-data", "metode_bayar"],
    queryFn: () => getMasterData("metode_bayar"),
  });

  const coaOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    map.set("1-1110", "Kas Tunai Kasir");
    map.set("1-1120", "Bank Operasional");
    map.set("1-1121", "QRIS Settlement");
    map.set("1-1122", "EDC Debit");
    map.set("1-1130", "Dompet Platform (GoBiz / Grab / Shopee)");
    masterPayMethods.forEach((m) => {
      if (m.account_code && m.account_code.startsWith("1-")) {
        map.set(m.account_code, m.account_name || m.name);
      }
    });
    return Array.from(map.entries()).map(([code, label]) => ({ code, label }));
  }, [masterPayMethods]);

  const [customCoaMode, setCustomCoaMode] = useState(false);

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
    setCustomCoaMode(false);
    setDialogOpen(true);
  };

  const openEdit = (acc: BankAccount) => {
    setEditing(acc);
    const code = acc.account_code || DEFAULT_COA_BY_TYPE[acc.account_type] || "1-1120";
    setCustomCoaMode(!coaOptions.some((o) => o.code === code));
    setForm({
      name: acc.name,
      bank_name: acc.bank_name,
      account_number: acc.account_number || "",
      account_holder: acc.account_holder || "",
      account_type: acc.account_type,
      account_code: code,
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
          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
            <div className="text-left sm:text-right sm:mr-1">
              <div className="text-[11px] text-slate-500">Total Estimasi Saldo Aktif</div>
              <div className="text-sm font-semibold text-slate-900 tabular-nums">
                {formatRupiah(totalEstimatedBalance)}
              </div>
            </div>
            <Button onClick={openCreate} size="sm" className="gap-1.5 min-h-[36px]">
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 py-1">
              {accounts.map((acc) => {
                const meta = ACCOUNT_TYPE_META[acc.account_type] || ACCOUNT_TYPE_META.bank;
                const Icon = meta.icon;
                const surfaceClass = acc.is_active
                  ? meta.cardSurface
                  : "bg-gradient-to-br from-slate-700 via-slate-800 to-slate-800 border-slate-500/40";

                return (
                  <Card3D
                    key={acc.id}
                    maxTilt={8}
                    perspective={1100}
                    className="w-full"
                    cardClassName={`rounded-2xl border p-5 text-white shadow-md transition-shadow duration-200 hover:shadow-xl ${surfaceClass}`}
                  >
                    {/* Clipped decorative sheen layer at base depth so Card3DItem layers stay 3D */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-black/25" />
                      <div
                        className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${meta.accentLine}`}
                      />
                      <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full border border-white/[0.07]" />
                      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full border border-white/[0.06]" />
                    </div>

                    {/* Top Row: Identity & Actions */}
                    <div className="relative flex items-start justify-between gap-2">
                      <Card3DItem depth={36} className="flex items-start gap-3 min-w-0">
                        <div
                          className={`p-2.5 rounded-xl border shrink-0 shadow-sm ${
                            acc.is_active
                              ? meta.chipClass
                              : "bg-slate-600/50 text-slate-200 border-slate-400/30"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-base text-white leading-snug truncate">
                            {acc.name}
                          </h4>
                          <p className="text-xs text-slate-300 mt-0.5 truncate">
                            {acc.bank_name}
                            {acc.account_holder ? ` (${acc.account_holder})` : ""}
                          </p>
                        </div>
                      </Card3DItem>

                      <Card3DItem depth={44} className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 sm:h-8 sm:w-8 rounded-lg text-slate-200 hover:text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                          onClick={() => openEdit(acc)}
                          aria-label={`Edit ${acc.name}`}
                          title={`Edit ${acc.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 sm:h-8 sm:w-8 rounded-lg text-slate-300 hover:text-rose-200 hover:bg-rose-500/25 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                          onClick={() => {
                            if (confirm(`Hapus rekening "${acc.name}"?`)) {
                              deleteMutation.mutate(acc.id);
                            }
                          }}
                          aria-label={`Hapus ${acc.name}`}
                          title={`Hapus ${acc.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </Card3DItem>
                    </div>

                    {/* Metadata Badges & Account Number */}
                    <Card3DItem depth={24} className="relative mt-3.5 flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-medium ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </Badge>
                      {acc.is_default && (
                        <Badge className="bg-white text-slate-900 hover:bg-white text-[10px] font-semibold px-1.5 py-0">
                          Default
                        </Badge>
                      )}
                      {acc.account_code && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono bg-white/10 text-slate-100 border-white/20"
                        >
                          COA {acc.account_code}
                        </Badge>
                      )}
                    </Card3DItem>

                    {acc.account_number && (
                      <Card3DItem depth={28} className="relative mt-2.5">
                        <p className="font-mono text-xs tracking-wider text-slate-200 tabular-nums truncate">
                          {acc.account_number}
                        </p>
                      </Card3DItem>
                    )}

                    {/* Floating Balance Plate */}
                    <Card3DItem
                      depth={55}
                      className="relative mt-4 rounded-xl bg-black/25 border border-white/15 p-3.5 shadow-lg"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-300">
                          Estimasi Saldo
                        </span>
                        <span className="text-lg sm:text-xl font-bold text-white tabular-nums tracking-tight">
                          {formatRupiah(acc.estimated_balance)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-3 pt-2.5 border-t border-white/10 text-xs">
                        <div className="min-w-0">
                          <span className="text-slate-300 block text-[11px]">Saldo Awal</span>
                          <span className="font-medium text-slate-100 tabular-nums truncate block">
                            {formatRupiah(acc.opening_balance)}
                          </span>
                        </div>
                        <div className="min-w-0 text-right">
                          <span className="text-slate-300 block text-[11px]">
                            Masuk ({acc.tx_count} tx)
                          </span>
                          <span className="font-medium text-emerald-300 tabular-nums truncate block">
                            +{formatRupiah(acc.total_incoming)}
                          </span>
                        </div>
                      </div>
                    </Card3DItem>

                    {/* Footer: Channel Mappings & Status */}
                    <Card3DItem
                      depth={28}
                      className="relative mt-4 flex items-center justify-between gap-2 flex-wrap"
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {acc.channel_mappings.length > 0 ? (
                          acc.channel_mappings.map((ch) => (
                            <Badge
                              key={ch}
                              variant="secondary"
                              className="text-[10px] font-medium bg-white/15 text-slate-100 hover:bg-white/20 border border-white/15"
                            >
                              {ch}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[11px] text-slate-300 italic">
                            Belum ada mapping channel
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium shrink-0">
                        {acc.is_active ? (
                          <span className="text-emerald-300 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Aktif
                          </span>
                        ) : (
                          <span className="text-slate-200 inline-flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" /> Nonaktif
                          </span>
                        )}
                      </span>
                    </Card3DItem>
                  </Card3D>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader className="pb-2 border-b border-border/80">
            <DialogTitle className="text-base font-bold tracking-tight text-foreground">
              {editing ? "Edit Rekening" : "Tambah Rekening Baru"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Nama Rekening / Akun *
                </label>
                <Input
                  placeholder="cth. BCA Operasional"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Tipe Akun *
                </label>
                <AdaptiveSelect
                  value={form.account_type}
                  onValueChange={(val) => {
                    const nextType = val as BankAccountType;
                    setForm({
                      ...form,
                      account_type: nextType,
                      account_code:
                        DEFAULT_COA_BY_TYPE[nextType] || form.account_code,
                    });
                  }}
                  options={[
                    { value: "bank", label: "Rekening Bank" },
                    { value: "cash", label: "Kas Tunai" },
                    { value: "ewallet", label: "E-Wallet / QRIS" },
                    {
                      value: "aggregator",
                      label: "Dompet Platform (GoBiz/Grab/Shopee)",
                    },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Nama Bank / Provider *
                </label>
                <Input
                  placeholder="cth. BCA, Mandiri, Cash, GoBiz"
                  value={form.bank_name}
                  onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Nomor Rekening / ID
                </label>
                <Input
                  placeholder="Opsional"
                  value={form.account_number}
                  onChange={(e) =>
                    setForm({ ...form, account_number: e.target.value })
                  }
                  className="h-9 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Kode Akun COA
                </label>
                <AdaptiveSelect
                  value={form.account_code}
                  onValueChange={(val) =>
                    setForm({ ...form, account_code: val })
                  }
                  options={coaOptions.map((o) => ({
                    value: o.code,
                    label: `${o.code} (${o.label})`,
                  }))}
                  searchable={true}
                  creatable={true}
                  creatablePrefix="Kode COA"
                  placeholder="Pilih atau ketik kode COA..."
                  searchPlaceholder="Cari atau ketik kode COA..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Atas Nama
                </label>
                <Input
                  placeholder="cth. History Cake"
                  value={form.account_holder}
                  onChange={(e) =>
                    setForm({ ...form, account_holder: e.target.value })
                  }
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground block">
                  Saldo Awal
                </label>
                <InputGroup className="h-9">
                  <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
                    <InputGroupText className="text-xs">Rp</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    type="number"
                    value={form.opening_balance}
                    onChange={(e) =>
                      setForm({ ...form, opening_balance: e.target.value })
                    }
                    className="text-xs tabular-nums pl-1"
                  />
                </InputGroup>
              </div>
            </div>

            <div className="pt-3 border-t border-border/70 space-y-2">
              <label className="text-xs font-medium text-foreground block">
                Auto-Mapping Metode Bayar / Tipe Order POS
              </label>

              {form.channel_mappings.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.channel_mappings.map((ch) => (
                    <Badge
                      key={ch}
                      variant="secondary"
                      className="text-xs font-medium gap-1 pr-1"
                    >
                      <span>{ch}</span>
                      <button
                        type="button"
                        onClick={() => toggleChannel(ch)}
                        aria-label={`Hapus channel ${ch}`}
                        className="p-0.5 rounded hover:bg-muted-foreground/20"
                      >
                        <XCircle className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <InputGroup className="h-9">
                <InputGroupInput
                  placeholder="Ketik nama channel POS (mis. QRIS, GoFood Integrasi) lalu Enter..."
                  value={form.custom_channel}
                  onChange={(e) =>
                    setForm({ ...form, custom_channel: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomChannel();
                    }
                  }}
                  className="text-xs"
                />
                <InputGroupAddon align="inline-end" className="pr-1.5">
                  <InputGroupButton
                    onClick={addCustomChannel}
                    disabled={!form.custom_channel.trim()}
                    className="font-semibold text-blue-600 dark:text-blue-400"
                  >
                    Tambah
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div className="flex items-center gap-5 pt-2 border-t border-border/70">
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) =>
                    setForm({ ...form, is_default: e.target.checked })
                  }
                  className="w-3.5 h-3.5 rounded border-input"
                />
                Jadikan rekening default
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="w-3.5 h-3.5 rounded border-input"
                />
                Aktif
              </label>
            </div>
          </div>

          <DialogFooter className="pt-3 border-t border-border/70">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              className="h-9 px-4 text-xs"
            >
              Batal
            </Button>
            <Button
              size="sm"
              disabled={
                !form.name.trim() ||
                !form.bank_name.trim() ||
                saveMutation.isPending
              }
              onClick={() => saveMutation.mutate()}
              className="h-9 px-5 text-xs font-semibold"
            >
              {saveMutation.isPending && (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              )}
              Simpan Rekening
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
