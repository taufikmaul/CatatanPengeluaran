import React, { useState } from "react";
import { ItemSuggestion, PurchaseRequest, PurchaseRequestFormData } from "@/types";
import { usePurchaseRequestWorkflow } from "@/components/requests/usePurchaseRequestWorkflow";
import { RequestCard } from "@/components/requests/RequestCard";
import { PurchaseRequestDrawer } from "@/components/forms/PurchaseRequestDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ShoppingBag,
  Plus,
  Clock,
  ShoppingBasket,
  Truck,
  CheckCircle2,
  Search,
  AlertCircle,
} from "lucide-react";

interface StaffRequestsPageProps {
  categories?: string[];
  itemSuggestions?: ItemSuggestion[];
  currentUser?: string;
}

export const StaffRequestsPage: React.FC<StaffRequestsPageProps> = ({
  categories = [],
  itemSuggestions = [],
  currentUser = "",
}) => {
  const [activeStatusTab, setActiveStatusTab] = useState<string>("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedRequests, setExpandedRequests] = useState<Record<number, boolean>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);

  const {
    requests,
    recentRequests,
    isLoadingRequests,
    isErrorRequests,
    stats,
    createMutation,
    updateMutation,
    submitDraftMutation,
    deleteMutation,
  } = usePurchaseRequestWorkflow({
    enableRequests: true,
    statusFilter: activeStatusTab,
    urgencyFilter,
    searchQuery,
  });

  const handleOpenNewRequest = () => {
    setEditingRequest(null);
    setIsDrawerOpen(true);
  };

  const handleDuplicateRequest = (req: PurchaseRequest) => {
    setEditingRequest({
      ...req,
      id: 0,
      status: "PENDING",
      request_date: new Date().toISOString().split("T")[0],
    });
    setIsDrawerOpen(true);
  };

  const handleDrawerSubmit = (data: PurchaseRequestFormData, requestId?: number) => {
    if (requestId && requestId > 0) {
      updateMutation.mutate(
        { id: requestId, data },
        {
          onSuccess: () => {
            setIsDrawerOpen(false);
            setEditingRequest(null);
          },
        }
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => {
          setIsDrawerOpen(false);
          setEditingRequest(null);
        },
      });
    }
  };

  return (
    <div className="space-y-3 max-w-6xl mx-auto pb-8">
      {/* Action Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {stats.total} Total Pengajuan
          </Badge>
          {stats.pending > 0 && (
            <Badge className="text-xs bg-amber-500 text-white font-semibold">
              {stats.pending} Menunggu Approval
            </Badge>
          )}
        </div>

        <Button
          onClick={handleOpenNewRequest}
          size="sm"
          className="h-9 px-3.5 text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white rounded-xl flex items-center gap-1.5 shadow-xs shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Ajukan Belanja</span>
        </Button>
      </div>

      {/* Ringkasan Status Pengajuan */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          onClick={() => setActiveStatusTab("PENDING")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "PENDING"
              ? "border-amber-600 bg-amber-50/50 dark:bg-amber-950/20 ring-1 ring-amber-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-amber-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Menunggu Approval
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

        <Card
          onClick={() => setActiveStatusTab("APPROVED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "APPROVED"
              ? "border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Disetujui
            </span>
            <ShoppingBasket className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {stats.approved}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">
              Siap beli
            </span>
          </div>
        </Card>

        <Card
          onClick={() => setActiveStatusTab("ORDERED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "ORDERED"
              ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Sedang Dipesan
            </span>
            <Truck className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
              {stats.ordered}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">
              Di supplier
            </span>
          </div>
        </Card>

        <Card
          onClick={() => setActiveStatusTab("RECEIVED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeStatusTab === "RECEIVED"
              ? "border-purple-600 bg-purple-50/50 dark:bg-purple-950/20 ring-1 ring-purple-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-purple-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Diterima / Selesai
            </span>
            <CheckCircle2 className="w-4 h-4 text-purple-700 dark:text-purple-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {stats.received + stats.fulfilled}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">
              Tiba di gudang
            </span>
          </div>
        </Card>
      </div>

      {/* Filter & Pencarian */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: "ALL", label: "Semua" },
            { id: "DRAFT", label: stats.draft > 0 ? `Draft (${stats.draft})` : "Draft" },
            { id: "PENDING", label: "Menunggu" },
            { id: "APPROVED", label: "Disetujui" },
            { id: "ORDERED", label: "Dipesan" },
            { id: "RECEIVED", label: "Diterima" },
            { id: "REJECTED", label: "Ditolak" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveStatusTab(tab.id)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                activeStatusTab === tab.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 md:w-64">
            <Search
              className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari barang / pemohon..."
              className="pl-8 h-10 sm:h-9 text-xs bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg"
            />
          </div>

          <select
            aria-label="Filter tingkat urgensi"
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="h-10 sm:h-9 px-2.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300 font-medium"
          >
            <option value="ALL">Semua Urgensi</option>
            <option value="URGENT">Urgent</option>
            <option value="NORMAL">Biasa</option>
          </select>
        </div>
      </div>

      {/* Daftar Pengajuan */}
      <div className="space-y-3">
        {isLoadingRequests ? (
          <div className="py-16 text-center text-zinc-600 dark:text-zinc-400 text-xs">
            Memuat daftar pengajuan belanja...
          </div>
        ) : isErrorRequests ? (
          <div
            role="alert"
            className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Gagal memuat daftar pengajuan belanja. Muat ulang halaman untuk mencoba lagi.</span>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-14 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                {activeStatusTab === "DRAFT"
                  ? "Belum Ada Draft Belanja"
                  : "Belum Ada Pengajuan Belanja"}
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto mt-1">
                {activeStatusTab === "DRAFT" && !searchQuery
                  ? "Daftar belanja yang disimpan sebagai draft akan tampil di sini sebelum dikirim untuk approval."
                  : activeStatusTab !== "ALL" || searchQuery
                  ? "Tidak ada pengajuan yang cocok dengan filter saat ini."
                  : "Mulai catat kebutuhan bahan dapur atau toko dengan tombol Ajukan Belanja Baru."}
              </p>
            </div>
            <Button
              onClick={handleOpenNewRequest}
              className="h-10 px-4 text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white rounded-xl inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Ajukan Belanja Baru
            </Button>
          </div>
        ) : (
          requests.map((req) => (
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
              isSubmittingDraft={submitDraftMutation.isPending}
              onSubmitDraft={(r) => submitDraftMutation.mutate(r.id)}
              onEdit={(r) => {
                setEditingRequest(r);
                setIsDrawerOpen(true);
              }}
              onDelete={(r) => {
                if (confirm(`Hapus pengajuan "${r.title}"?`)) {
                  deleteMutation.mutate(r.id);
                }
              }}
              onDuplicate={handleDuplicateRequest}
            />
          ))
        )}
      </div>

      {/* Modal Form Request Belanja (Quick Add) */}
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
        recentRequests={recentRequests}
        categories={categories}
        currentUser={currentUser}
      />
    </div>
  );
};
