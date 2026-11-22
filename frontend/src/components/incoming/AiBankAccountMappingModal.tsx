import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  applyAiIncomingBankMapping,
  previewAiIncomingBankMapping,
} from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Landmark,
  Loader2,
  RefreshCw,
  Route,
} from "lucide-react";
import type {
  AiAccountMappingConfidence,
  AiAccountMappingScope,
  AiBankAccountMappingPreview,
  BankAccount,
} from "@/types";

interface AiBankAccountMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: BankAccount[];
  isAdmin: boolean;
  filters: {
    startDate?: string;
    endDate?: string;
    orderType?: string;
    statusFilter?: string;
    search?: string;
  };
  onApplied: () => void;
}

const CONFIDENCE_META: Record<
  AiAccountMappingConfidence,
  { label: string; className: string }
> = {
  high: {
    label: "Tinggi",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  medium: {
    label: "Sedang",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  low: {
    label: "Rendah",
    className: "bg-slate-100 text-slate-700 border-slate-300",
  },
};

export const AiBankAccountMappingModal: React.FC<AiBankAccountMappingModalProps> = ({
  isOpen,
  onClose,
  accounts,
  isAdmin,
  filters,
  onApplied,
}) => {
  const [scope, setScope] = useState<AiAccountMappingScope>("unmapped");
  const [preview, setPreview] = useState<AiBankAccountMappingPreview | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, number | null>>({});
  const [checkedGroups, setCheckedGroups] = useState<Record<string, boolean>>({});
  const [saveChannelMappings, setSaveChannelMappings] = useState<boolean>(isAdmin);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active !== false),
    [accounts]
  );

  const filterPayload = useMemo(
    () => ({
      start_date: filters.startDate || undefined,
      end_date: filters.endDate || undefined,
      order_type:
        filters.orderType && filters.orderType !== "all"
          ? filters.orderType
          : undefined,
      status:
        filters.statusFilter && filters.statusFilter !== "all"
          ? filters.statusFilter
          : undefined,
      search: filters.search?.trim() || undefined,
    }),
    [filters]
  );

  const previewMutation = useMutation({
    mutationFn: (targetScope: AiAccountMappingScope) =>
      previewAiIncomingBankMapping({
        ...filterPayload,
        scope: targetScope,
      }),
    onSuccess: (res) => {
      setPreview(res);
      setErrorMessage(null);
      const nextAccs: Record<string, number | null> = {};
      const nextChecked: Record<string, boolean> = {};
      for (const s of res.suggestions) {
        nextAccs[s.group_key] = s.suggested_bank_account_id;
        nextChecked[s.group_key] = s.suggested_bank_account_id !== null;
      }
      setSelectedAccounts(nextAccs);
      setCheckedGroups(nextChecked);
    },
    onError: (err: any) => {
      const detail =
        err?.response?.data?.detail ||
        "Gagal menganalisis pemetaan rekening tujuan. Periksa koneksi lalu coba lagi.";
      setErrorMessage(detail);
      setPreview(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: applyAiIncomingBankMapping,
    onSuccess: (res) => {
      toast.success(res.message || "Rekening tujuan berhasil diterapkan.");
      onApplied();
      onClose();
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.detail || "Gagal menerapkan pemetaan rekening tujuan."
      );
    },
  });

  useEffect(() => {
    if (isOpen) {
      setSaveChannelMappings(isAdmin);
      setErrorMessage(null);
      previewMutation.mutate(scope);
    } else {
      setPreview(null);
      setErrorMessage(null);
    }
    // Jalankan analisis ulang saat modal dibuka atau cakupan berubah
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scope]);

  const suggestions = preview?.suggestions || [];

  const applicableMappings = useMemo(() => {
    return suggestions
      .filter((s) => checkedGroups[s.group_key] && selectedAccounts[s.group_key])
      .map((s) => ({
        group_key: s.group_key,
        order_type: s.order_type,
        payment_method: s.payment_method,
        bank_account_id: Number(selectedAccounts[s.group_key]),
        tx_count: s.tx_count,
      }));
  }, [suggestions, checkedGroups, selectedAccounts]);

  const totalSelectedTransactions = useMemo(
    () => applicableMappings.reduce((acc, item) => acc + item.tx_count, 0),
    [applicableMappings]
  );

  const selectableGroupKeys = useMemo(
    () =>
      suggestions
        .filter((s) => selectedAccounts[s.group_key] !== null)
        .map((s) => s.group_key),
    [suggestions, selectedAccounts]
  );

  const allSelectableChecked =
    selectableGroupKeys.length > 0 &&
    selectableGroupKeys.every((k) => checkedGroups[k]);

  const handleToggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = { ...checkedGroups };
    for (const key of selectableGroupKeys) {
      next[key] = checked;
    }
    setCheckedGroups(next);
  };

  const handleAccountChange = (groupKey: string, value: string) => {
    const accId = value ? Number(value) : null;
    setSelectedAccounts((prev) => ({ ...prev, [groupKey]: accId }));
    setCheckedGroups((prev) => ({ ...prev, [groupKey]: accId !== null }));
  };

  const handleApply = () => {
    if (applicableMappings.length === 0) {
      toast.warning("Pilih minimal satu kombinasi yang sudah memiliki rekening tujuan.");
      return;
    }
    applyMutation.mutate({
      ...filterPayload,
      scope,
      mappings: applicableMappings.map((m) => ({
        order_type: m.order_type,
        payment_method: m.payment_method,
        bank_account_id: m.bank_account_id,
      })),
      save_channel_mappings: isAdmin && saveChannelMappings,
    });
  };

  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filters.startDate && filters.endDate) {
      parts.push(`Periode ${filters.startDate} s/d ${filters.endDate}`);
    } else if (filters.startDate) {
      parts.push(`Mulai ${filters.startDate}`);
    } else if (filters.endDate) {
      parts.push(`Sampai ${filters.endDate}`);
    }
    if (filters.orderType && filters.orderType !== "all") {
      parts.push(`Tipe: ${filters.orderType}`);
    }
    if (filters.statusFilter && filters.statusFilter !== "all") {
      parts.push(`Status: ${filters.statusFilter === "paid" ? "Dibayar" : "Void"}`);
    }
    if (filters.search?.trim()) {
      parts.push(`Cari: "${filters.search.trim()}"`);
    }
    return parts.length > 0 ? parts.join(" | ") : "Seluruh transaksi tanpa filter tanggal";
  }, [filters]);

  const isBusy = previewMutation.isPending || applyMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !applyMutation.isPending && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-slate-200 bg-white">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-4 border-b border-slate-200 space-y-2 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pr-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
                <Route className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-slate-900">
                  Set Rekening Tujuan dengan AI
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-600 mt-0.5">
                  AI mencocokkan kombinasi tipe order dan metode pembayaran ke rekening aktif sebelum diterapkan.
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <div
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 self-start"
              role="radiogroup"
              aria-label="Cakupan transaksi"
            >
              <button
                type="button"
                role="radio"
                aria-checked={scope === "unmapped"}
                disabled={isBusy}
                onClick={() => setScope("unmapped")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  scope === "unmapped"
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Belum Dipetakan
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "all"}
                disabled={isBusy}
                onClick={() => setScope("all")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  scope === "all"
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Semua Transaksi Filter
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-600">
                Cakupan: <strong className="font-medium text-slate-800">{activeFilterSummary}</strong>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => previewMutation.mutate(scope)}
                disabled={isBusy}
                className="h-8 px-2.5 text-xs gap-1.5 border-slate-200 text-slate-700"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${previewMutation.isPending ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Analisis Ulang
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Main Scrollable Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
          {previewMutation.isPending ? (
            <div className="py-14 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-6 h-6 text-blue-700 animate-spin" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-800">
                  Menganalisis tipe order, metode pembayaran, dan daftar rekening...
                </p>
                <p className="text-xs text-slate-600">
                  Mengelompokkan transaksi dan memeriksa pola rekening historis.
                </p>
              </div>
            </div>
          ) : errorMessage ? (
            <div className="py-10 px-4 rounded-lg border border-rose-200 bg-rose-50/70 flex flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="w-6 h-6 text-rose-700" aria-hidden="true" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm font-semibold text-rose-900">Analisis Gagal Dijalankan</p>
                <p className="text-xs text-rose-800">{errorMessage}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => previewMutation.mutate(scope)}
                className="h-9 px-4 text-xs bg-white border-rose-300 text-rose-800 hover:bg-rose-50"
              >
                Coba Lagi
              </Button>
            </div>
          ) : preview && !preview.has_active_accounts ? (
            <div className="py-10 px-4 rounded-lg border border-amber-200 bg-amber-50 flex flex-col items-center justify-center gap-2 text-center">
              <Landmark className="w-6 h-6 text-amber-800" aria-hidden="true" />
              <p className="text-sm font-semibold text-amber-900">Belum Ada Rekening Aktif</p>
              <p className="text-xs text-amber-800 max-w-md">
                Tambahkan minimal satu rekening bank, kas tunai, atau akun platform di menu Pengaturan Rekening terlebih dahulu sebelum menjalankan pemetaan otomatis.
              </p>
            </div>
          ) : preview && suggestions.length === 0 ? (
            <div className="py-12 px-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2.5 text-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-700" aria-hidden="true" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm font-semibold text-slate-900">
                  {scope === "unmapped"
                    ? "Semua transaksi sudah terpetakan"
                    : "Tidak ada transaksi pada filter ini"}
                </p>
                <p className="text-xs text-slate-600">
                  {scope === "unmapped"
                    ? "Tidak ditemukan transaksi tanpa rekening tujuan pada filter aktif. Anda dapat meninjau ulang seluruh transaksi jika ingin memeriksa pemetaan yang sudah ada."
                    : "Ubah rentang tanggal atau filter lainnya untuk memilih transaksi yang ingin dipetakan."}
                </p>
              </div>
              {scope === "unmapped" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScope("all")}
                  className="mt-1 h-9 px-3 text-xs bg-white border-slate-300 text-slate-800"
                >
                  Tinjau Semua Transaksi Filter
                </Button>
              )}
            </div>
          ) : preview ? (
            <>
              {/* Engine & Summary Info Bar */}
              <div
                className={`rounded-lg border px-3.5 py-2.5 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${
                  preview.engine === "ai"
                    ? "bg-blue-50/70 border-blue-200 text-slate-800"
                    : "bg-amber-50 border-amber-200 text-amber-950"
                }`}
              >
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-current" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">
                      {preview.engine === "ai"
                        ? "Rekomendasi AI siap ditinjau"
                        : "Menggunakan pencocokan aturan lokal"}
                      {preview.model ? ` (${preview.model})` : ""}
                    </div>
                    <p className="text-[11px] opacity-90 mt-0.5">
                      {preview.fallback_reason
                        ? preview.fallback_reason
                        : `Ditemukan ${preview.total_groups} kombinasi tipe order dan metode bayar mencakup ${preview.total_transactions} transaksi. Periksa dan ubah pilihan bila diperlukan sebelum diterapkan.`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <Badge variant="outline" className="bg-white text-slate-800 border-slate-300 text-[11px] font-medium">
                    {applicableMappings.length}/{preview.total_groups} grup dipilih
                  </Badge>
                </div>
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <tr>
                      <th className="w-10 px-3 py-2.5 text-center">
                        <Checkbox
                          checked={allSelectableChecked}
                          disabled={selectableGroupKeys.length === 0}
                          onCheckedChange={(v) => handleToggleAll(Boolean(v))}
                          aria-label="Pilih semua kombinasi"
                        />
                      </th>
                      <th className="text-left px-3 py-2.5 font-semibold">Tipe Order &amp; Metode Bayar</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Transaksi</th>
                      <th className="text-left px-3 py-2.5 font-semibold w-[230px]">Rekening Tujuan</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Keyakinan &amp; Alasan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {suggestions.map((s) => {
                      const chosenId = selectedAccounts[s.group_key];
                      const isChecked = !!checkedGroups[s.group_key];
                      const conf = CONFIDENCE_META[s.confidence] || CONFIDENCE_META.medium;
                      return (
                        <tr
                          key={s.group_key}
                          className={isChecked ? "bg-white hover:bg-slate-50/70" : "bg-slate-50/40 text-slate-500"}
                        >
                          <td className="px-3 py-3 text-center align-top">
                            <Checkbox
                              checked={isChecked}
                              disabled={!chosenId}
                              onCheckedChange={(v) =>
                                setCheckedGroups((prev) => ({
                                  ...prev,
                                  [s.group_key]: Boolean(v),
                                }))
                              }
                              aria-label={`Pilih ${s.order_type} ${s.payment_method}`}
                            />
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className="text-[11px] font-medium text-slate-800 border-slate-300 bg-white">
                                {s.order_type}
                              </Badge>
                              <span className="text-slate-700 font-medium">{s.payment_method}</span>
                            </div>
                            {s.current_account_names.length > 0 && (
                              <div className="text-[11px] text-slate-500 mt-1">
                                Saat ini: {s.current_account_names.join(", ")}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right align-top tabular-nums">
                            <div className="font-semibold text-slate-900">{s.tx_count} struk</div>
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              {formatRupiah(s.total_net_received)}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <select
                              aria-label={`Rekening tujuan untuk ${s.order_type} ${s.payment_method}`}
                              value={chosenId ? String(chosenId) : ""}
                              onChange={(e) => handleAccountChange(s.group_key, e.target.value)}
                              className="w-full h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              <option value="">-- Jangan dipetakan --</option>
                              {activeAccounts.map((acc) => (
                                <option key={acc.id} value={String(acc.id)}>
                                  {acc.name} ({acc.bank_name})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Badge variant="outline" className={`text-[10px] font-semibold ${conf.className}`}>
                              Keyakinan {conf.label}
                            </Badge>
                            <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                              {s.reason}
                            </p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards */}
              <div className="md:hidden space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 min-h-[44px]">
                    <Checkbox
                      checked={allSelectableChecked}
                      disabled={selectableGroupKeys.length === 0}
                      onCheckedChange={(v) => handleToggleAll(Boolean(v))}
                    />
                    <span>Pilih semua ({selectableGroupKeys.length})</span>
                  </label>
                </div>

                {suggestions.map((s) => {
                  const chosenId = selectedAccounts[s.group_key];
                  const isChecked = !!checkedGroups[s.group_key];
                  const conf = CONFIDENCE_META[s.confidence] || CONFIDENCE_META.medium;
                  return (
                    <div
                      key={s.group_key}
                      className={`rounded-lg border p-3.5 space-y-2.5 ${
                        isChecked ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-start gap-2.5 cursor-pointer min-w-0">
                          <Checkbox
                            className="mt-0.5"
                            checked={isChecked}
                            disabled={!chosenId}
                            onCheckedChange={(v) =>
                              setCheckedGroups((prev) => ({
                                ...prev,
                                [s.group_key]: Boolean(v),
                              }))
                            }
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className="text-[11px] font-medium text-slate-800 border-slate-300 bg-white">
                                {s.order_type}
                              </Badge>
                              <span className="text-xs font-semibold text-slate-900 break-words">
                                {s.payment_method}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600 mt-1 tabular-nums">
                              {s.tx_count} struk • {formatRupiah(s.total_net_received)}
                            </div>
                          </div>
                        </label>
                        <Badge variant="outline" className={`text-[10px] font-semibold shrink-0 ${conf.className}`}>
                          {conf.label}
                        </Badge>
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor={`ai-acc-mobile-${s.group_key}`}
                          className="block text-[11px] font-medium text-slate-700"
                        >
                          Rekening Tujuan
                        </label>
                        <select
                          id={`ai-acc-mobile-${s.group_key}`}
                          value={chosenId ? String(chosenId) : ""}
                          onChange={(e) => handleAccountChange(s.group_key, e.target.value)}
                          className="w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        >
                          <option value="">-- Jangan dipetakan --</option>
                          {activeAccounts.map((acc) => (
                            <option key={acc.id} value={String(acc.id)}>
                              {acc.name} ({acc.bank_name})
                            </option>
                          ))}
                        </select>
                      </div>

                      <p className="text-[11px] text-slate-600 leading-relaxed">{s.reason}</p>
                    </div>
                  );
                })}
              </div>

              {/* Admin option: persist channel_mappings */}
              {isAdmin && suggestions.length > 0 && (
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={saveChannelMappings}
                    onCheckedChange={(v) => setSaveChannelMappings(Boolean(v))}
                  />
                  <div className="text-xs text-slate-700">
                    <span className="font-medium text-slate-900 block">
                      Simpan juga ke aturan mapping rekening
                    </span>
                    <span className="text-[11px] text-slate-600 block mt-0.5">
                      Menambahkan metode pembayaran yang tidak bentrok ke pengaturan rekening agar import POS berikutnya otomatis terarah.
                    </span>
                  </div>
                </label>
              )}
            </>
          ) : null}
        </div>

        {/* Sticky Footer */}
        <DialogFooter className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs text-slate-600 text-left">
            {applicableMappings.length > 0 ? (
              <span>
                Siap memperbarui{" "}
                <strong className="font-semibold text-slate-900 tabular-nums">
                  {totalSelectedTransactions} transaksi
                </strong>{" "}
                dari {applicableMappings.length} kombinasi.
              </span>
            ) : (
              <span>Belum ada kombinasi yang dipilih untuk diterapkan.</span>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={applyMutation.isPending}
              className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 text-xs flex-1 sm:flex-initial"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={isBusy || applicableMappings.length === 0}
              className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white gap-1.5 flex-1 sm:flex-initial"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Menerapkan...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Terapkan ke {totalSelectedTransactions} Transaksi
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
