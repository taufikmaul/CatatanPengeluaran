import React, { useMemo, useState } from "react";
import { ItemSuggestion, PurchaseRequest, PurchaseRequestFormData } from "@/types";
import { usePurchaseRequestWorkflow } from "@/components/requests/usePurchaseRequestWorkflow";
import { RequestCard } from "@/components/requests/RequestCard";
import { PurchaseRequestDrawer } from "@/components/forms/PurchaseRequestDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/formatters";
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  AlertCircle,
  Wallet,
} from "lucide-react";

interface ApprovalBelanjaPageProps {
  categories?: string[];
  itemSuggestions?: ItemSuggestion[];
  currentUser?: string;
}

const REJECT_PRESETS = [
  "Stok di gudang masih cukup",
  "Estimasi harga terlalu tinggi",
  "Ditunda ke periode berikutnya",
  "Salah input barang / jumlah",
];

export const ApprovalBelanjaPage: React.FC<ApprovalBelanjaPageProps> = ({
  categories = [],
  itemSuggestions = [],
  currentUser = "",
}) => {
  const [viewMode, setViewMode] = useState<"PENDING" | "HISTORY">("PENDING");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRequests, setExpandedRequests] = useState<Record<number, boolean>>({});

  // Reject dialog state
  const [rejectTarget, setRejectTarget] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("Stok di gudang masih cukup");

  // Edit pending request before approving
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);

  const {
    requests,
    recentRequests,
    isLoadingRequests,
    isErrorRequests,
    stats,
    approveMutation,
    rejectMutation,
    updateMutation,
    deleteMutation,
  } = usePurchaseRequestWorkflow({
    enableRequests: true,
    statusFilter: viewMode === "PENDING" ? "PENDING" : "ALL",
    searchQuery,
  });

  const displayedRequests = useMemo(() => {
    const base =
      viewMode === "PENDING"
        ? requests.filter((r) => r.status === "PENDING")
        : requests.filter((r) => r.status !== "PENDING" && r.status !== "DRAFT");

    // Prioritaskan URGENT di antrean approval
    if (viewMode === "PENDING") {
      return [...base].sort((a, b) => {
        const aUrgent = a.urgency === "URGENT" ? 1 : 0;
        const bUrgent = b.urgency === "URGENT" ? 1 : 0;
        if (aUrgent !== bUrgent) return bUrgent - aUrgent;
        return b.id - a.id;
      });
    }
    return base;
  }, [requests, viewMode]);

  const pendingEstimatedTotal = useMemo(() => {
    return requests
      .filter((r) => r.status === "PENDING")
      .reduce(
        (acc, req) =>
          acc +
          (req.items || []).reduce(
            (s, it) => s + (it.estimated_price ? it.estimated_price * it.qty : 0),
            0
          ),
        0
      );
  }, [requests]);

  const handleConfirmReject = () => {
    if (!rejectTarget) return;
    rejectMutation.mutate(
      {
        id: rejectTarget.id,
        reason: rejectReason.trim() || "Ditolak oleh Manager / Owner",
      },
      {
        onSuccess: () => {
          setRejectTarget(null);
          setRejectReason("Stok di gudang masih cukup");
        },
      }
    );
  };

  const handleEditSubmit = (data: PurchaseRequestFormData, requestId?: number) => {
    if (!requestId) return;
    updateMutation.mutate(
      { id: requestId, data },
      {
        onSuccess: () => {
          setEditingRequest(null);
        },
      }
    );
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-16">
      {/* Header Manager / Owner Approval */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Approval Belanja (Manager / Owner)
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              Tinjau pengajuan belanja dari tim, koreksi bila perlu, lalu setujui untuk diteruskan ke Purchasing atau tolak dengan alasan.
            </p>
          </div>
        </div>
      </div>

      {/* Ringkasan Keputusan */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/15">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Antrean Approval
            </span>
            <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {stats.pending}
            </span>
            {stats.urgent_pending > 0 && (
              <Badge className="bg-rose-700 text-white text-[10px] px-1.5 py-0">
                {stats.urgent_pending} Urgent
              </Badge>
            )}
          </div>
        </Card>

        <Card className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Estimasi Nilai Pending
            </span>
            <Wallet className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {pendingEstimatedTotal > 0 ? formatRupiah(pendingEstimatedTotal) : "Rp 0"}
            </span>
          </div>
        </Card>

        <Card className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Disetujui (Siap Beli)
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {stats.approved}
            </span>
          </div>
        </Card>

        <Card className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Ditolak
            </span>
            <XCircle className="w-4 h-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">
              {stats.rejected}
            </span>
          </div>
        </Card>
      </div>

      {/* View Mode & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode("PENDING")}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
              viewMode === "PENDING"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <span>Antrean Menunggu Approval</span>
            {stats.pending > 0 && (
              <Badge className="bg-amber-700 text-white text-[10px] px-1.5 py-0">
                {stats.pending}
              </Badge>
            )}
          </button>

          <button
            type="button"
            onClick={() => setViewMode("HISTORY")}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === "HISTORY"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            Riwayat Keputusan
          </button>
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari pengajuan, pemohon, atau barang..."
            className="pl-8 h-10 sm:h-9 text-xs bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg"
          />
        </div>
      </div>

      {/* Daftar Antrean / Riwayat */}
      <div className="space-y-3">
        {isLoadingRequests ? (
          <div className="py-16 text-center text-zinc-600 dark:text-zinc-400 text-xs">
            Memuat antrean approval belanja...
          </div>
        ) : isErrorRequests ? (
          <div
            role="alert"
            className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Gagal memuat antrean approval. Muat ulang halaman untuk mencoba lagi.</span>
          </div>
        ) : displayedRequests.length === 0 ? (
          <div className="py-14 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {viewMode === "PENDING"
                ? "Semua Pengajuan Sudah Diproses"
                : "Belum Ada Riwayat Keputusan"}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">
              {viewMode === "PENDING"
                ? "Tidak ada pengajuan belanja yang menunggu persetujuan saat ini."
                : "Pengajuan yang sudah disetujui atau ditolak akan tampil di sini."}
            </p>
          </div>
        ) : (
          displayedRequests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              isExpanded={expandedRequests[req.id] ?? true}
              onToggleExpand={() =>
                setExpandedRequests((prev) => ({
                  ...prev,
                  [req.id]: !(prev[req.id] ?? true),
                }))
              }
              showApprovalActions={true}
              isApproving={approveMutation.isPending}
              onApprove={(r) => approveMutation.mutate(r.id)}
              onReject={(r) => {
                setRejectTarget(r);
                setRejectReason("Stok di gudang masih cukup");
              }}
              onEdit={(r) => setEditingRequest(r)}
              onDelete={(r) => {
                if (confirm(`Hapus pengajuan "${r.title}"?`)) {
                  deleteMutation.mutate(r.id);
                }
              }}
            />
          ))
        )}
      </div>

      {/* Modal Tolak Pengajuan */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-700 dark:text-rose-400" /> Tolak Request Belanja
            </DialogTitle>
          </DialogHeader>

          {rejectTarget && (
            <div className="py-2 space-y-3">
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
                Tolak pengajuan{" "}
                <strong className="text-zinc-900 dark:text-zinc-100">
                  "{rejectTarget.title || rejectTarget.item_name}"
                </strong>{" "}
                dari {rejectTarget.requester_name}? Pilih atau tulis alasan:
              </p>

              <div className="flex flex-wrap gap-1.5">
                {REJECT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRejectReason(preset)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                      rejectReason === preset
                        ? "border-rose-600 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Alasan penolakan..."
                className="text-xs h-10 sm:h-9"
                autoFocus
              />
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectTarget(null)}
              className="h-10 sm:h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmReject}
              disabled={rejectMutation.isPending}
              className="h-10 sm:h-9 px-4 text-xs bg-rose-700 hover:bg-rose-800 text-white font-semibold rounded-xl"
            >
              {rejectMutation.isPending ? "Menolak..." : "Konfirmasi Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Koreksi Request Sebelum Approval */}
      <PurchaseRequestDrawer
        isOpen={!!editingRequest}
        onClose={() => setEditingRequest(null)}
        onSubmit={handleEditSubmit}
        initialData={editingRequest}
        isSubmitting={updateMutation.isPending}
        itemSuggestions={itemSuggestions}
        recentRequests={recentRequests}
        categories={categories}
        currentUser={currentUser}
      />
    </div>
  );
};
