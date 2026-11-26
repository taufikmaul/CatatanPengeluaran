import React from "react";
import { PurchaseRequest } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HighlightText } from "@/components/common/HighlightText";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import {
  Check,
  X,
  Edit2,
  Trash2,
  ChevronDown,
  User,
  Calendar,
  Layers,
  Store,
  Copy,
  Clock,
  CheckCircle2,
  Truck,
  PackageCheck,
  XCircle,
  FileText,
  Send,
} from "lucide-react";

interface RequestCardProps {
  request: PurchaseRequest;
  isExpanded: boolean;
  onToggleExpand: () => void;
  showApprovalActions?: boolean;
  isApproving?: boolean;
  isSubmittingDraft?: boolean;
  onApprove?: (req: PurchaseRequest) => void;
  onReject?: (req: PurchaseRequest) => void;
  onSubmitDraft?: (req: PurchaseRequest) => void;
  onEdit?: (req: PurchaseRequest) => void;
  onDelete?: (req: PurchaseRequest) => void;
  onDuplicate?: (req: PurchaseRequest) => void;
}

export const RequestStatusBadge: React.FC<{ status: PurchaseRequest["status"] }> = ({
  status,
}) => {
  switch (status) {
    case "DRAFT":
      return (
        <Badge
          variant="outline"
          className="text-zinc-700 border-zinc-400 border-dashed bg-zinc-100 dark:text-zinc-200 dark:border-zinc-600 dark:bg-zinc-800/80 text-[11px] inline-flex items-center gap-1"
        >
          <FileText className="w-3 h-3" aria-hidden="true" /> Draft
        </Badge>
      );
    case "PENDING":
      return (
        <Badge
          variant="outline"
          className="text-amber-800 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40 text-[11px] inline-flex items-center gap-1"
        >
          <Clock className="w-3 h-3" aria-hidden="true" /> Menunggu Approval
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge className="bg-emerald-700 text-white text-[11px] inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Disetujui (Siap Beli)
        </Badge>
      );
    case "PARTIAL_ORDERED":
    case "ORDERED":
      return (
        <Badge className="bg-blue-700 text-white text-[11px] inline-flex items-center gap-1">
          <Truck className="w-3 h-3" aria-hidden="true" /> Sedang Dipesan
        </Badge>
      );
    case "RECEIVED":
      return (
        <Badge className="bg-purple-700 text-white text-[11px] inline-flex items-center gap-1">
          <PackageCheck className="w-3 h-3" aria-hidden="true" /> Diterima Gudang
        </Badge>
      );
    case "FULFILLED":
      return (
        <Badge className="bg-zinc-700 text-white text-[11px] inline-flex items-center gap-1">
          <Check className="w-3 h-3" aria-hidden="true" /> Selesai
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge
          variant="outline"
          className="border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 text-[11px] inline-flex items-center gap-1"
        >
          <XCircle className="w-3 h-3" aria-hidden="true" /> Ditolak
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge variant="outline" className="text-zinc-600 border-zinc-300 text-[11px]">
          Dibatalkan
        </Badge>
      );
    default:
      return null;
  }
};

export const RequestCard: React.FC<RequestCardProps> = ({
  request: req,
  isExpanded,
  onToggleExpand,
  showApprovalActions = false,
  isApproving = false,
  isSubmittingDraft = false,
  onApprove,
  onReject,
  onSubmitDraft,
  onEdit,
  onDelete,
  onDuplicate,
}) => {
  const isDraft = req.status === "DRAFT";
  const isPending = req.status === "PENDING";
  const isEditable = isDraft || isPending;
  const isRejected = req.status === "REJECTED";
  const isUrgent = req.urgency === "URGENT";
  const itemCount = req.items?.length || 0;

  const totalEstimated = (req.items || []).reduce(
    (sum, it) =>
      it.order_status === "CANCELLED"
        ? sum
        : sum + (it.estimated_price ? it.estimated_price * it.qty : 0),
    0
  );

  return (
    <div
      className={`rounded-2xl border bg-white dark:bg-zinc-900 transition-all shadow-sm overflow-hidden ${
        isUrgent && isPending
          ? "border-rose-300 dark:border-rose-900/70"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {/* Header Card */}
      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950/50 px-2 py-0.5 rounded-md">
              {req.request_number || `#REQ-${req.id}`}
            </span>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              <HighlightText text={req.title || req.item_name || "Request Belanja"} />
            </h3>
            {isUrgent && (
              <Badge className="bg-rose-700 text-white text-[10px] font-bold">
                URGENT
              </Badge>
            )}
            <RequestStatusBadge status={req.status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
              <HighlightText text={req.requester_name || "Staf"} />
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
              {formatDateId(req.request_date)}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-zinc-800 dark:text-zinc-200">
              <Layers className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              {isDraft ? `${itemCount} Item` : `${itemCount || 1} Item`}
            </span>
            {totalEstimated > 0 && (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                Est. Total: {formatRupiah(totalEstimated)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-center shrink-0">
          {showApprovalActions && isPending && onApprove && onReject && (
            <>
              <Button
                size="sm"
                onClick={() => onApprove(req)}
                disabled={isApproving}
                className="h-10 sm:h-9 px-3.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl flex items-center gap-1.5 font-semibold"
              >
                <Check className="w-3.5 h-3.5" /> Setujui
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReject(req)}
                className="h-10 sm:h-9 px-3 text-xs text-rose-700 border-rose-300 dark:text-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl flex items-center gap-1.5 font-semibold"
              >
                <X className="w-3.5 h-3.5" /> Tolak
              </Button>
            </>
          )}

          {isDraft && onSubmitDraft && itemCount > 0 && (
            <Button
              size="sm"
              onClick={() => onSubmitDraft(req)}
              disabled={isSubmittingDraft}
              className="h-10 sm:h-9 px-3.5 text-xs bg-amber-700 hover:bg-amber-800 text-white rounded-xl inline-flex items-center gap-1.5 font-semibold"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSubmittingDraft ? "Mengirim..." : "Ajukan"}</span>
            </Button>
          )}

          {!isDraft && onDuplicate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDuplicate(req)}
              title="Ulangi isi barang dari request ini"
              className="h-10 sm:h-8 px-2.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 rounded-lg inline-flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Ulangi</span>
            </Button>
          )}

          {isEditable && onEdit && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Ubah ${req.title}`}
              onClick={() => onEdit(req)}
              className="h-10 sm:h-8 w-10 sm:w-8 p-0 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 rounded-lg"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
          )}

          {isEditable && onDelete && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Hapus ${req.title}`}
              onClick={() => onDelete(req)}
              className="h-10 sm:h-8 w-10 sm:w-8 p-0 text-zinc-500 hover:text-rose-700 rounded-lg"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            aria-label={isExpanded ? "Tutup rincian" : "Lihat rincian"}
            onClick={onToggleExpand}
            className="h-10 sm:h-8 w-10 sm:w-8 p-0 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 rounded-lg"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </Button>
        </div>
      </div>

      {/* Catatan Pengajuan */}
      {req.notes && req.notes !== "-" && (
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-700 dark:text-zinc-300 border-b border-zinc-100 dark:border-zinc-800">
          <strong>Catatan Pengajuan:</strong> {req.notes}
        </div>
      )}

      {/* Alasan Penolakan */}
      {isRejected && req.reject_reason && (
        <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300 border-b border-rose-200 dark:border-rose-900/40">
          <strong>Alasan Penolakan:</strong> {req.reject_reason}
        </div>
      )}

      {/* Info Reviewer */}
      {req.reviewer_name && req.reviewed_at && (
        <div className="px-4 py-1.5 bg-zinc-50/60 dark:bg-zinc-950/60 text-[11px] text-zinc-600 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
          Direview oleh <strong>{req.reviewer_name}</strong> pada{" "}
          {new Date(req.reviewed_at).toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </div>
      )}

      {/* Breakdown Item */}
      {isExpanded && (
        <div className="p-4 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {req.items && req.items.length > 0 ? (
              req.items.map((it) => {
                const isCancelled = it.order_status === "CANCELLED";
                return (
                  <div
                    key={it.id}
                    className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                      isCancelled
                        ? "border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/40 opacity-75"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`font-bold text-zinc-900 dark:text-zinc-100 ${
                            isCancelled ? "line-through" : ""
                          }`}
                        >
                          <HighlightText text={it.item_name} />
                        </span>
                        <span className="ml-2 font-semibold text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950 px-1.5 py-0.5 rounded text-[11px]">
                          {it.qty} {it.unit}
                        </span>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isCancelled ? (
                          <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 dark:bg-rose-950/50 dark:text-rose-300 px-1.5 py-0.5 rounded">
                            Tidak Tersedia
                          </span>
                        ) : it.order_status === "ORDERED" ? (
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 dark:text-blue-300 px-1.5 py-0.5 rounded">
                            Dipesan
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-600 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 px-1.5 py-0.5 rounded">
                            Menunggu Order
                          </span>
                        )}

                        {it.receiving_status === "SESUAI" && (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                            Diterima Sesuai
                          </span>
                        )}
                        {it.receiving_status === "KURANG" && (
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 px-1.5 py-0.5 rounded">
                            Kurang ({it.qty_received} {it.unit})
                          </span>
                        )}
                        {it.receiving_status === "LEBIH" && (
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 dark:text-blue-300 px-1.5 py-0.5 rounded">
                            Lebih ({it.qty_received} {it.unit})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                      {it.supplier_name && it.supplier_name !== "-" && (
                        <span className="inline-flex items-center gap-1">
                          <Store className="w-3 h-3 text-zinc-500" aria-hidden="true" />
                          {it.supplier_name}
                        </span>
                      )}
                      {it.estimated_price && it.estimated_price > 0 && (
                        <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                          Est: {formatRupiah(it.estimated_price * it.qty)}
                        </span>
                      )}
                      {it.expired_date && (
                        <span className="text-purple-700 dark:text-purple-300 font-medium">
                          Exp: {it.expired_date}
                        </span>
                      )}
                    </div>

                    {it.notes && it.notes !== "-" && (
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950 px-2 py-1 rounded">
                        Catatan: {it.notes}
                      </div>
                    )}
                  </div>
                );
              })
            ) : isDraft ? (
              <div className="p-3 text-xs text-zinc-600 dark:text-zinc-400">
                Belum ada barang di draft ini. Klik ikon Ubah untuk menambahkan daftar belanja.
              </div>
            ) : (
              <div className="p-3 text-xs text-zinc-600 dark:text-zinc-400">
                {req.item_name} - {req.qty} {req.unit}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
