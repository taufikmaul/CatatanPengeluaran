import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPurchaseRequests,
  getPurchaseRequestStats,
  createPurchaseRequest,
  updatePurchaseRequest,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  fulfillPurchaseRequest,
  deletePurchaseRequest,
} from "@/lib/api";
import { PurchaseRequest, PurchaseRequestFormData, ItemSuggestion } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { PurchaseRequestDrawer } from "@/components/forms/PurchaseRequestDrawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ShoppingBag,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Filter,
  Check,
  X,
  Trash2,
  Edit2,
  ShoppingBasket,
  ChevronRight,
  User,
  Tag,
  Calendar,
} from "lucide-react";

interface PurchaseRequestsTabProps {
  categories?: string[];
  itemSuggestions?: ItemSuggestion[];
  isAdmin?: boolean;
  currentUser?: string;
}

export const PurchaseRequestsTab: React.FC<PurchaseRequestsTabProps> = ({
  categories = [],
  itemSuggestions = [],
  isAdmin = true,
  currentUser = "",
}) => {
  const queryClient = useQueryClient();

  const [activeStatusTab, setActiveStatusTab] = useState<string>("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);

  // Reject Dialog state
  const [rejectDialogItem, setRejectDialogItem] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Queries
  const { data: requestData, isLoading } = useQuery({
    queryKey: ["purchase-requests", activeStatusTab, urgencyFilter, searchQuery],
    queryFn: () =>
      getPurchaseRequests({
        status: activeStatusTab === "ALL" ? undefined : activeStatusTab,
        urgency: urgencyFilter === "ALL" ? undefined : urgencyFilter,
        search: searchQuery || undefined,
        limit: 100,
      }),
  });

  const { data: statsData } = useQuery({
    queryKey: ["purchase-request-stats"],
    queryFn: getPurchaseRequestStats,
  });

  const requests = requestData?.items || [];
  const stats = statsData || requestData?.stats || {
    total: 0,
    pending: 0,
    approved: 0,
    fulfilled: 0,
    rejected: 0,
    urgent_pending: 0,
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: PurchaseRequestFormData) => createPurchaseRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
      toast.success("Pengajuan belanja berhasil dikirim!");
      setIsDrawerOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal membuat pengajuan belanja");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PurchaseRequestFormData }) =>
      updatePurchaseRequest(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      toast.success("Pengajuan belanja berhasil diperbarui!");
      setIsDrawerOpen(false);
      setEditingRequest(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memperbarui pengajuan");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvePurchaseRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
      toast.success("Request belanja disetujui! Siap dibeli.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyetujui request");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      rejectPurchaseRequest(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
      toast.success("Request belanja telah ditolak.");
      setRejectDialogItem(null);
      setRejectReason("");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menolak request");
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: (id: number) => fulfillPurchaseRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
      toast.success("Belanjaan ditandai sudah dibeli!");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menandai belanjaan");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePurchaseRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
      toast.success("Request belanja berhasil dihapus.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menghapus request");
    },
  });

  const handleDrawerSubmit = (data: PurchaseRequestFormData, requestId?: number) => {
    if (requestId) {
      updateMutation.mutate({ id: requestId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleConfirmReject = () => {
    if (!rejectDialogItem) return;
    rejectMutation.mutate({
      id: rejectDialogItem.id,
      reason: rejectReason.trim() || "Ditolak oleh admin",
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Request Belanja (Kebutuhan Toko)
            </h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Ajukan kebutuhan bahan dapur sebelum habis, disetujui owner, dan terhubung ke pengeluaran.
          </p>
        </div>

        <Button
          onClick={() => {
            setEditingRequest(null);
            setIsDrawerOpen(true);
          }}
          className="h-10 px-4 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-md shadow-amber-500/20 flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Ajukan Belanja Baru
        </Button>
      </div>

      {/* 2. Stat Cards Ringkas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <Card
          onClick={() => setActiveStatusTab("PENDING")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "PENDING"
              ? "border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 ring-1 ring-amber-500"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-amber-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Menunggu Approval</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.pending}</span>
            {stats.urgent_pending > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {stats.urgent_pending} Urgent
              </Badge>
            )}
          </div>
        </Card>

        <Card
          onClick={() => setActiveStatusTab("APPROVED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "APPROVED"
              ? "border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-500"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Siap Dibelanjakan</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <ShoppingBasket className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.approved}</span>
            <span className="text-[11px] text-zinc-500 ml-1.5">Disetujui</span>
          </div>
        </Card>

        <Card
          onClick={() => setActiveStatusTab("FULFILLED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "FULFILLED"
              ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 ring-1 ring-blue-500"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Sudah Terbeli</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.fulfilled}</span>
            <span className="text-[11px] text-zinc-500 ml-1.5">Selesai</span>
          </div>
        </Card>

        <Card
          onClick={() => setActiveStatusTab("REJECTED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "REJECTED"
              ? "border-rose-500 bg-rose-50/40 dark:bg-rose-950/20 ring-1 ring-rose-500"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-rose-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Ditolak</span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">{stats.rejected}</span>
            <span className="text-[11px] text-zinc-500 ml-1.5">Tidak disetujui</span>
          </div>
        </Card>
      </div>

      {/* 3. Filter Bar & Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {[
            { id: "ALL", label: "Semua" },
            { id: "PENDING", label: "Menunggu" },
            { id: "APPROVED", label: "Siap Beli" },
            { id: "FULFILLED", label: "Selesai" },
            { id: "REJECTED", label: "Ditolak" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveStatusTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                activeStatusTab === tab.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Urgency */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 md:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-3 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari barang / pemohon..."
              className="pl-8 h-9 text-xs bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg"
            />
          </div>

          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="h-9 px-2.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none text-zinc-700 dark:text-zinc-300"
          >
            <option value="ALL">Semua Urgensi</option>
            <option value="URGENT">🔴 Mendesak</option>
            <option value="NORMAL">🟢 Biasa</option>
          </select>
        </div>
      </div>

      {/* 4. Request List (Cards / Checklist) */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="py-16 text-center text-zinc-400 text-xs">
            Memuat daftar request belanja...
          </div>
        ) : requests.length === 0 ? (
          <div className="py-16 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Belum Ada Request Belanja
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
              {activeStatusTab !== "ALL" || searchQuery
                ? "Tidak ada data yang cocok dengan filter yang dipilih."
                : "Semua kebutuhan belanja toko sudah terpenuhi. Klik tombol di atas untuk mengajukan kebutuhan baru."}
            </p>
          </div>
        ) : (
          requests.map((req) => {
            const isPending = req.status === "PENDING";
            const isApproved = req.status === "APPROVED";
            const isFulfilled = req.status === "FULFILLED";
            const isRejected = req.status === "REJECTED";
            const isUrgent = req.urgency === "URGENT";

            return (
              <div
                key={req.id}
                className={`p-4 rounded-xl border bg-white dark:bg-zinc-900 transition-all shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isUrgent && isPending
                    ? "border-rose-300 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                {/* Left: Detail Barang */}
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-zinc-400">#REQ-{req.id}</span>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      {req.item_name}
                    </h3>
                    <Badge variant="outline" className="text-xs font-bold bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5">
                      {req.qty} {req.unit}
                    </Badge>
                    {isUrgent && (
                      <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider">
                        🔴 Mendesak
                      </Badge>
                    )}
                    {isApproved && (
                      <Badge className="bg-emerald-500 text-white text-[10px]">
                        ✅ Disetujui
                      </Badge>
                    )}
                    {isFulfilled && (
                      <Badge className="bg-blue-500 text-white text-[10px]">
                        🛒 Sudah Terbeli
                      </Badge>
                    )}
                    {isRejected && (
                      <Badge variant="outline" className="border-rose-300 text-rose-600 text-[10px]">
                        ❌ Ditolak
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-zinc-400" />
                      {req.requester_name || "Staf"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                      {formatDateId(req.request_date)}
                    </span>
                    {req.category && (
                      <span className="flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-zinc-400" />
                        {req.category}
                      </span>
                    )}
                    {req.estimated_price && req.estimated_price > 0 && (
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        Est: {formatRupiah(req.estimated_price * req.qty)}
                      </span>
                    )}
                  </div>

                  {req.notes && req.notes !== "-" && (
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950 p-2 rounded-lg border border-zinc-100 dark:border-zinc-800/80">
                      📝 {req.notes}
                    </p>
                  )}

                  {isRejected && req.reject_reason && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 italic">
                      Alasan tolak: {req.reject_reason}
                    </p>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  {/* Actions for PENDING */}
                  {isPending && isAdmin && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(req.id)}
                        disabled={approveMutation.isPending}
                        className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1 font-semibold"
                      >
                        <Check className="w-3.5 h-3.5" /> Setujui
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejectDialogItem(req);
                          setRejectReason("");
                        }}
                        className="h-8 px-3 text-xs text-rose-600 border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" /> Tolak
                      </Button>
                    </>
                  )}

                  {/* Actions for APPROVED */}
                  {isApproved && (
                    <Button
                      size="sm"
                      onClick={() => fulfillMutation.mutate(req.id)}
                      disabled={fulfillMutation.isPending}
                      className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 font-semibold"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Tandai Terbeli
                    </Button>
                  )}

                  {/* Edit & Delete */}
                  {isPending && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingRequest(req);
                        setIsDrawerOpen(true);
                      }}
                      className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Hapus request belanja ini?")) {
                        deleteMutation.mutate(req.id);
                      }
                    }}
                    className="h-8 w-8 p-0 text-zinc-400 hover:text-rose-600 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Drawer / Modal Form Request Belanja */}
      <PurchaseRequestDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingRequest(null);
        }}
        onSubmit={handleDrawerSubmit}
        initialData={editingRequest}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        itemSuggestions={itemSuggestions}
        categories={categories}
        currentUser={currentUser}
      />

      {/* Dialog Tolak Request */}
      <Dialog open={!!rejectDialogItem} onOpenChange={(open) => !open && setRejectDialogItem(null)}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-500" /> Tolak Request Belanja
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Apakah Anda yakin ingin menolak pengajuan belanja{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">
                "{rejectDialogItem?.item_name}"
              </strong>
              ? Berikan alasan singkat:
            </p>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Misal: Stok di gudang masih ada 3 sak..."
              className="text-xs h-10"
              autoFocus
            />
          </div>
          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectDialogItem(null)}
              className="h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmReject}
              disabled={rejectMutation.isPending}
              className="h-9 px-4 text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl"
            >
              {rejectMutation.isPending ? "Menolak..." : "Ya, Tolak Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
