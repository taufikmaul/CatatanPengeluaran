import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  auditIncomingDuplicateTransactions,
  deleteIncomingDuplicateTransactions,
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
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  IncomingDuplicateGroup,
  IncomingDuplicateReasonCode,
  IncomingDuplicateSeverity,
} from "@/types";

interface IncomingDuplicatesAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  filters: {
    startDate?: string;
    endDate?: string;
    orderType?: string;
    statusFilter?: string;
    search?: string;
  };
  onDeleted: () => void;
}

const IGNORED_STORAGE_KEY = "catpen_ignored_incoming_duplicate_groups";

const REASON_LABEL: Record<IncomingDuplicateReasonCode, string> = {
  same_receipt_no: "No. Struk Sama",
  same_order_no: "No. Order Sama",
  exact_timestamp_amount: "Jam & Nominal Identik",
  cross_source_match: "Ganda Lintas Sumber",
  same_day_fingerprint: "Pola Harian Identik",
};

const SEVERITY_META: Record<
  IncomingDuplicateSeverity,
  { label: string; className: string }
> = {
  high: {
    label: "Duplikat Pasti",
    className: "bg-rose-50 text-rose-800 border-rose-200",
  },
  medium: {
    label: "Perlu Verifikasi",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

export const IncomingDuplicatesAuditModal: React.FC<IncomingDuplicatesAuditModalProps> = ({
  isOpen,
  onClose,
  isAdmin,
  filters,
  onDeleted,
}) => {
  const [scanScope, setScanScope] = useState<"active_filter" | "all_time">("active_filter");
  const [includeMedium, setIncludeMedium] = useState<boolean>(true);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Record<number, boolean>>({});
  const [ignoredGroupIds, setIgnoredGroupIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(IGNORED_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return new Set(parsed.map(String));
        }
      }
    } catch {
      // Abaikan kegagalan baca localStorage
    }
    return new Set();
  });

  const persistIgnored = (next: Set<string>) => {
    setIgnoredGroupIds(next);
    try {
      localStorage.setItem(IGNORED_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Abaikan kegagalan simpan localStorage
    }
  };

  const queryParams = useMemo(() => {
    if (scanScope === "all_time") {
      return { include_medium: includeMedium };
    }
    return {
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
      include_medium: includeMedium,
    };
  }, [scanScope, includeMedium, filters]);

  const {
    data: auditData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["incoming-audit-duplicates", queryParams],
    queryFn: () => auditIncomingDuplicateTransactions(queryParams),
    enabled: isOpen,
    staleTime: 15 * 1000,
  });

  const visibleGroups = useMemo(() => {
    const groups = auditData?.groups || [];
    return groups.filter((g) => !ignoredGroupIds.has(g.group_id));
  }, [auditData, ignoredGroupIds]);

  const hiddenIgnoredCount = useMemo(() => {
    const groups = auditData?.groups || [];
    return groups.filter((g) => ignoredGroupIds.has(g.group_id)).length;
  }, [auditData, ignoredGroupIds]);

  // Sinkronkan pilihan hapus default setiap kali hasil pindai berubah
  useEffect(() => {
    if (!auditData) return;
    const defaults: Record<number, boolean> = {};
    for (const g of auditData.groups) {
      if (ignoredGroupIds.has(g.group_id)) continue;
      const deleteSet = new Set(g.suggested_delete_ids);
      for (const tx of g.transactions) {
        defaults[tx.id] = deleteSet.has(tx.id) && !tx.reconciled_at;
      }
    }
    setSelectedDeleteIds(defaults);
  }, [auditData, ignoredGroupIds]);

  const deleteMutation = useMutation({
    mutationFn: deleteIncomingDuplicateTransactions,
    onSuccess: (res) => {
      if (res.deleted_count > 0) {
        toast.success(res.message);
        onDeleted();
        refetch();
      } else {
        toast.warning(res.message || "Tidak ada transaksi yang dihapus.");
      }
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.detail || "Gagal menghapus transaksi duplikat."
      );
    },
  });

  const visibleTxById = useMemo(() => {
    const map = new Map<number, IncomingDuplicateGroup["transactions"][number]>();
    for (const g of visibleGroups) {
      for (const tx of g.transactions) {
        map.set(tx.id, tx);
      }
    }
    return map;
  }, [visibleGroups]);

  const checkedIdsList = useMemo(
    () =>
      Object.entries(selectedDeleteIds)
        .filter(([idStr, checked]) => checked && visibleTxById.has(Number(idStr)))
        .map(([idStr]) => Number(idStr)),
    [selectedDeleteIds, visibleTxById]
  );

  const selectedImpactNet = useMemo(() => {
    let total = 0;
    for (const id of checkedIdsList) {
      const tx = visibleTxById.get(id);
      if (tx && tx.status === "paid") {
        total += tx.net_received;
      }
    }
    return total;
  }, [checkedIdsList, visibleTxById]);

  const visibleOverstatedNet = useMemo(
    () =>
      visibleGroups.reduce(
        (sum, g) => sum + Number(g.potential_overstated_net_received || 0),
        0
      ),
    [visibleGroups]
  );

  const visibleDuplicateCount = useMemo(
    () => visibleGroups.reduce((sum, g) => sum + Number(g.duplicate_count || 0), 0),
    [visibleGroups]
  );

  const handleIgnoreGroup = (groupId: string) => {
    const next = new Set(ignoredGroupIds);
    next.add(groupId);
    persistIgnored(next);
    toast.info("Grup ditandai sebagai bukan duplikat.");
  };

  const handleResetIgnored = () => {
    persistIgnored(new Set());
    toast.success("Daftar grup yang diabaikan telah direset.");
  };

  const handleKeepThisRow = (group: IncomingDuplicateGroup, keepId: number) => {
    setSelectedDeleteIds((prev) => {
      const next = { ...prev };
      for (const tx of group.transactions) {
        next[tx.id] = tx.id !== keepId && !tx.reconciled_at;
      }
      return next;
    });
  };

  const handleDeleteSingle = (txId: number, label: string) => {
    if (!isAdmin) return;
    if (
      confirm(
        `Hapus transaksi duplikat #${txId} (${label})? Tindakan ini tidak dapat dibatalkan.`
      )
    ) {
      deleteMutation.mutate({ transaction_ids: [txId], allow_reconciled: false });
    }
  };

  const handleBulkDelete = () => {
    if (!isAdmin || checkedIdsList.length === 0) return;
    // Pastikan tidak menghapus semua transaksi dalam satu grup tanpa disengaja
    const fullySelectedGroups = visibleGroups.filter((g) =>
      g.transactions.every((tx) => selectedDeleteIds[tx.id])
    );
    const warningText =
      fullySelectedGroups.length > 0
        ? `\n\nPerhatian: Pada ${fullySelectedGroups.length} grup, seluruh salinan transaksi terpilih untuk dihapus (tidak ada yang dipertahankan).`
        : "";

    if (
      confirm(
        `Hapus ${checkedIdsList.length} transaksi duplikat terpilih (dampak bersih: ${formatRupiah(selectedImpactNet)})?${warningText}`
      )
    ) {
      deleteMutation.mutate({
        transaction_ids: checkedIdsList,
        allow_reconciled: false,
      });
    }
  };

  const activeFilterText = useMemo(() => {
    if (scanScope === "all_time") {
      return "Seluruh transaksi masuk di database";
    }
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
    return parts.length > 0 ? parts.join(" | ") : "Seluruh transaksi (tanpa filter tanggal)";
  }, [scanScope, filters]);

  const isBusy = isLoading || isFetching || deleteMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !deleteMutation.isPending && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-slate-200 bg-white">
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-4 border-b border-slate-200 space-y-3 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pr-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-slate-900">
                  Analisa Duplikat Transaksi Masuk
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-600 mt-0.5">
                  Mendeteksi struk ganda, nomor order kembar, dan pencatatan dobel berdasarkan waktu, channel, serta nominal.
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                role="radiogroup"
                aria-label="Cakupan pemindaian duplikat"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={scanScope === "active_filter"}
                  disabled={deleteMutation.isPending}
                  onClick={() => setScanScope("active_filter")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    scanScope === "active_filter"
                      ? "bg-white text-slate-900 shadow-2xs border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Filter Aktif
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scanScope === "all_time"}
                  disabled={deleteMutation.isPending}
                  onClick={() => setScanScope("all_time")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    scanScope === "all_time"
                      ? "bg-white text-slate-900 shadow-2xs border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Seluruh Database
                </button>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer px-1">
                <Checkbox
                  checked={includeMedium}
                  onCheckedChange={(v) => setIncludeMedium(Boolean(v))}
                />
                <span>Sertakan dugaan perlu verifikasi</span>
              </label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {hiddenIgnoredCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetIgnored}
                  className="h-8 px-2.5 text-xs text-slate-700 hover:text-slate-900"
                >
                  Tampilkan {hiddenIgnoredCount} diabaikan
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isBusy}
                className="h-8 px-2.5 text-xs gap-1.5 border-slate-200 text-slate-700"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Pindai Ulang
              </Button>
            </div>
          </div>

          <div className="text-[11px] text-slate-600">
            Cakupan pindai: <strong className="font-medium text-slate-800">{activeFilterText}</strong>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {isLoading ? (
            <div className="py-14 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-6 h-6 text-blue-700 animate-spin" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-800">
                  Memindai transaksi masuk untuk mendeteksi data duplikat...
                </p>
                <p className="text-xs text-slate-600">
                  Memeriksa nomor struk, nomor order, waktu transaksi, dan kesamaan nominal.
                </p>
              </div>
            </div>
          ) : isError ? (
            <div className="py-10 px-4 rounded-lg border border-rose-200 bg-rose-50/70 flex flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="w-6 h-6 text-rose-700" aria-hidden="true" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm font-semibold text-rose-900">Pemindaian Duplikat Gagal</p>
                <p className="text-xs text-rose-800">
                  {(error as any)?.response?.data?.detail ||
                    "Terjadi kendala saat menganalisis transaksi masuk. Silakan coba lagi."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="h-9 px-4 text-xs bg-white border-rose-300 text-rose-800 hover:bg-rose-50"
              >
                Coba Lagi
              </Button>
            </div>
          ) : auditData ? (
            <>
              {/* Real Scan Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-600">Transaksi Dipindai</div>
                  <div className="text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {auditData.scanned_transactions} struk
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-600">Duplikat Terdeteksi</div>
                  <div className="text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {visibleGroups.length} grup ({visibleDuplicateCount} entri berlebih)
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-600">Potensi Kelebihan Omset Bersih</div>
                  <div
                    className={`text-base font-semibold tabular-nums mt-0.5 ${
                      visibleOverstatedNet > 0 ? "text-rose-800" : "text-emerald-800"
                    }`}
                  >
                    {formatRupiah(visibleOverstatedNet)}
                  </div>
                </div>
              </div>

              {visibleGroups.length === 0 ? (
                <div className="py-12 px-4 rounded-lg border border-emerald-200 bg-emerald-50/50 flex flex-col items-center justify-center gap-2.5 text-center">
                  <ShieldCheck className="w-8 h-8 text-emerald-700" aria-hidden="true" />
                  <div className="space-y-1 max-w-md">
                    <p className="text-sm font-semibold text-slate-900">
                      Tidak ditemukan transaksi duplikat
                    </p>
                    <p className="text-xs text-slate-600">
                      Dari {auditData.scanned_transactions} transaksi yang dipindai, tidak ada struk ganda atau nomor order kembar yang aktif.
                    </p>
                  </div>
                  {scanScope === "active_filter" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setScanScope("all_time")}
                      className="mt-1 h-9 px-3 text-xs bg-white border-slate-300 text-slate-800"
                    >
                      Pindai Seluruh Database
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3.5">
                  {visibleGroups.map((group) => {
                    const sev = SEVERITY_META[group.severity] || SEVERITY_META.medium;
                    const reasonTag = REASON_LABEL[group.reason_code] || "Duplikat";
                    const allSelectedInGroup = group.transactions.every(
                      (t) => selectedDeleteIds[t.id]
                    );
                    return (
                      <div
                        key={group.group_id}
                        className="rounded-lg border border-slate-200 bg-white overflow-hidden"
                      >
                        {/* Group Header */}
                        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className={`text-[10px] font-semibold ${sev.className}`}>
                                {sev.label}
                              </Badge>
                              <Badge variant="outline" className="text-[10px] font-medium bg-white text-slate-700 border-slate-300">
                                {reasonTag}
                              </Badge>
                              <span className="text-[11px] font-semibold text-rose-800 tabular-nums">
                                Potensi selisih: {formatRupiah(group.potential_overstated_net_received)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-700">{group.reason}</p>
                            {allSelectedInGroup && (
                              <p className="text-[11px] font-medium text-rose-800">
                                Peringatan: Semua baris pada grup ini ditandai hapus. Sisakan minimal satu baris untuk dipertahankan.
                              </p>
                            )}
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleIgnoreGroup(group.group_id)}
                            className="h-8 px-2.5 text-xs text-slate-600 hover:text-slate-900 gap-1 shrink-0 self-start sm:self-center"
                            title="Tandai grup ini bukan duplikat"
                          >
                            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                            Bukan Duplikat
                          </Button>
                        </div>

                        {/* Transaction Comparison Grid */}
                        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {group.transactions.map((tx) => {
                            const isMarkedDelete = !!selectedDeleteIds[tx.id];
                            const isRecommendedKeep = tx.id === group.suggested_keep_id;
                            const isReconciled = !!tx.reconciled_at;
                            return (
                              <div
                                key={tx.id}
                                className={`rounded-lg border p-3 space-y-2 transition-colors ${
                                  isMarkedDelete
                                    ? "border-rose-300 bg-rose-50/40"
                                    : "border-emerald-200 bg-emerald-50/25"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-start gap-2 min-w-0">
                                    {isAdmin && (
                                      <Checkbox
                                        className="mt-0.5"
                                        checked={isMarkedDelete}
                                        disabled={isReconciled}
                                        onCheckedChange={(v) =>
                                          setSelectedDeleteIds((prev) => ({
                                            ...prev,
                                            [tx.id]: Boolean(v),
                                          }))
                                        }
                                        aria-label={`Tandai transaksi #${tx.id} untuk dihapus`}
                                      />
                                    )}
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-mono text-xs font-semibold text-slate-900">
                                          #{tx.id}
                                        </span>
                                        <Badge variant="outline" className="text-[10px] bg-white text-slate-700 border-slate-300 uppercase">
                                          {tx.source_type}
                                        </Badge>
                                        {isMarkedDelete ? (
                                          <Badge variant="outline" className="text-[10px] font-semibold bg-rose-50 text-rose-800 border-rose-200">
                                            Tandai Hapus
                                          </Badge>
                                        ) : (
                                          <Badge variant="outline" className="text-[10px] font-semibold bg-emerald-50 text-emerald-800 border-emerald-200">
                                            {isRecommendedKeep ? "Disarankan Simpan" : "Dipertahankan"}
                                          </Badge>
                                        )}
                                        {isReconciled && (
                                          <Badge variant="outline" className="text-[10px] font-medium bg-blue-50 text-blue-800 border-blue-200 gap-0.5">
                                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                            Terekonsiliasi
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-600 mt-1">
                                        {tx.transaction_date || "-"} {tx.transaction_time || ""}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0 tabular-nums">
                                    <div className="text-xs font-semibold text-slate-900">
                                      {formatRupiah(tx.status === "paid" ? tx.net_received : 0)}
                                    </div>
                                    <div className="text-[11px] text-slate-600">
                                      Kotor {formatRupiah(tx.gross_sales)}
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-700 pt-1.5 border-t border-slate-200/70">
                                  <div className="truncate">
                                    <span className="text-slate-500">Struk:</span>{" "}
                                    <span className="font-mono text-slate-900">{tx.receipt_no || "-"}</span>
                                  </div>
                                  <div className="truncate">
                                    <span className="text-slate-500">Order:</span>{" "}
                                    <span className="font-mono text-slate-900">{tx.order_no || "-"}</span>
                                  </div>
                                  <div className="truncate">
                                    <span className="text-slate-500">Channel:</span>{" "}
                                    <span>{tx.order_type}</span>
                                  </div>
                                  <div className="truncate">
                                    <span className="text-slate-500">Bayar:</span>{" "}
                                    <span>{tx.payment_method}</span>
                                  </div>
                                  <div className="truncate">
                                    <span className="text-slate-500">Rekening:</span>{" "}
                                    <span>{tx.bank_account_name || "Belum dipetakan"}</span>
                                  </div>
                                  <div className="truncate">
                                    <span className="text-slate-500">Item:</span>{" "}
                                    <span>
                                      {tx.item_count} item ({tx.status === "paid" ? "Dibayar" : "Void"})
                                    </span>
                                  </div>
                                  {tx.customer_name && (
                                    <div className="col-span-2 truncate">
                                      <span className="text-slate-500">Pelanggan:</span>{" "}
                                      <span>{tx.customer_name}</span>
                                    </div>
                                  )}
                                </div>

                                {isAdmin && (
                                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70">
                                    {isMarkedDelete ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleKeepThisRow(group, tx.id)}
                                        className="h-8 px-2 text-[11px] text-emerald-800 hover:bg-emerald-50"
                                      >
                                        Pertahankan Baris Ini
                                      </Button>
                                    ) : (
                                      <span className="text-[11px] text-emerald-800 font-medium">
                                        Baris ini akan dipertahankan
                                      </span>
                                    )}

                                    {!isReconciled && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={deleteMutation.isPending}
                                        onClick={() =>
                                          handleDeleteSingle(
                                            tx.id,
                                            tx.receipt_no || tx.order_no || `${tx.order_type} ${tx.payment_method}`
                                          )
                                        }
                                        className="h-8 px-2 text-[11px] text-rose-700 hover:text-rose-900 hover:bg-rose-50 gap-1"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                        Hapus Baris
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs text-slate-600 text-left">
            {!isAdmin ? (
              <span>Mode baca saja. Hanya Owner / Admin Utama yang dapat menghapus transaksi duplikat.</span>
            ) : checkedIdsList.length > 0 ? (
              <span>
                <strong className="font-semibold text-slate-900 tabular-nums">
                  {checkedIdsList.length} transaksi duplikat
                </strong>{" "}
                dipilih untuk dihapus ({formatRupiah(selectedImpactNet)} bersih diterima).
              </span>
            ) : (
              <span>Pilih transaksi duplikat yang ingin dibersihkan.</span>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={deleteMutation.isPending}
              className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 text-xs flex-1 sm:flex-initial"
            >
              Tutup
            </Button>
            {isAdmin && visibleGroups.length > 0 && (
              <Button
                type="button"
                onClick={handleBulkDelete}
                disabled={deleteMutation.isPending || checkedIdsList.length === 0}
                className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 text-xs font-semibold bg-rose-700 hover:bg-rose-800 text-white gap-1.5 flex-1 sm:flex-initial"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Menghapus...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Hapus {checkedIdsList.length} Duplikat Terpilih
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
