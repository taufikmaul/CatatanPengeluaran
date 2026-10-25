import React, { useState, useEffect } from "react";
import { ExpenseLog } from "@/types";
import { getRecentExpenseLogs } from "@/lib/api";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  History,
  Search,
  RefreshCw,
  PlusCircle,
  Edit,
  Trash2,
  CheckCircle2,
  ArrowRight,
  Filter,
} from "lucide-react";

interface ExpenseActivityLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectExpense?: (expenseId: number) => void;
}

export const ExpenseActivityLogModal: React.FC<ExpenseActivityLogModalProps> = ({
  isOpen,
  onClose,
  onSelectExpense,
}) => {
  const [logs, setLogs] = useState<ExpenseLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState<string>("ALL");

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const data = await getRecentExpenseLogs(100);
      setLogs(data || []);
    } catch (err) {
      console.error("Gagal memuat log aktivitas:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen]);

  const formatActorLabel = (actor: string) => {
    if (!actor) return "Sistem";
    if (actor.startsWith("telegram:")) {
      const tgId = actor.replace("telegram:", "");
      return `Telegram (User #${tgId})`;
    }
    if (actor === "dashboard:admin") return "Web Dashboard (Admin)";
    if (actor === "dashboard:admin_input") return "Web Dashboard (Admin Input)";
    if (actor.startsWith("dashboard:")) return `Web Dashboard (${actor.replace("dashboard:", "")})`;
    if (actor === "import:csv") return "Impor CSV";
    if (actor === "sync:sheets") return "Sinkronisasi Sheets";
    if (actor === "system") return "Sistem Otomatis";
    return actor;
  };

  const formatFieldLabel = (field: string) => {
    const map: Record<string, string> = {
      pay_status: "Status Bayar",
      total_price: "Total Harga",
      unit_price: "Harga Satuan",
      qty: "Jumlah (Qty)",
      item_name: "Nama Barang",
      supplier: "Toko / Supplier",
      category: "Kategori",
      expense_date: "Tanggal Nota",
      notes: "Catatan",
      invoice_number: "No. Invoice",
      is_reimbursement: "Status Reimburse",
      reimbursed_at: "Waktu Ganti Talangan",
    };
    return map[field] || field;
  };

  const formatValue = (field: string, val: any) => {
    if (val === null || val === undefined || val === "") return "-";
    if (field.includes("price") || field === "total_price" || field === "unit_price") {
      const num = Number(val);
      return !isNaN(num) ? formatRupiah(num) : String(val);
    }
    if (field === "is_reimbursement") {
      return val === true || val === "true" ? "Ya (Ditalangi)" : "Tidak (Reguler)";
    }
    return String(val);
  };

  const filteredLogs = logs.filter((log) => {
    if (filterAction !== "ALL" && log.action !== filterAction) {
      return false;
    }
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    const actorMatch = log.actor.toLowerCase().includes(query);
    const detailsMatch = log.details?.toLowerCase().includes(query) || false;
    const actionMatch = log.action.toLowerCase().includes(query);
    const idMatch = log.expense_id ? String(log.expense_id).includes(query) : false;
    return actorMatch || detailsMatch || actionMatch || idMatch;
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col rounded-3xl p-6 sm:p-7">
        <DialogHeader className="mb-2 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-600" />
              <DialogTitle className="text-lg font-bold text-slate-900">
                Log Aktivitas & Perubahan Data Belanja
              </DialogTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchLogs}
              disabled={isLoading}
              className="h-8 rounded-xl text-xs gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>Segarkan</span>
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Mencatat setiap aksi penambahan, koreksi nominal/status, dan penghapusan data belanja secara transparan.
          </p>
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-2 my-2 shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari berdasarkan nama barang, aktor, ID..."
              className="pl-8 h-9 text-xs rounded-xl"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "ALL", label: "Semua" },
              { id: "CREATE", label: "Dibuat" },
              { id: "UPDATE", label: "Diedit" },
              { id: "STATUS_CHANGE", label: "Status" },
              { id: "DELETE", label: "Dihapus" },
            ].map((f) => (
              <Button
                key={f.id}
                type="button"
                variant={filterAction === f.id ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterAction(f.id)}
                className={`h-8 rounded-xl text-xs px-2.5 ${
                  filterAction === f.id
                    ? "bg-slate-900 text-white font-semibold"
                    : "text-slate-600 bg-white"
                }`}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Log list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[300px]">
          {isLoading && logs.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-300" />
              Memuat data log aktivitas...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-400 border border-dashed rounded-2xl">
              Tidak ada catatan log yang sesuai dengan filter.
            </div>
          ) : (
            filteredLogs.map((log) => {
              let parsed: any = null;
              try {
                parsed = log.details ? JSON.parse(log.details) : null;
              } catch {}

              const actionColor =
                log.action === "CREATE"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : log.action === "DELETE"
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : log.action === "STATUS_CHANGE"
                  ? "bg-purple-50 text-purple-700 border-purple-200"
                  : "bg-blue-50 text-blue-700 border-blue-200";

              const actionIcon =
                log.action === "CREATE" ? (
                  <PlusCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                ) : log.action === "DELETE" ? (
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                ) : log.action === "STATUS_CHANGE" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                ) : (
                  <Edit className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                );

              const actionLabel =
                log.action === "CREATE"
                  ? "Pencatatan Baru"
                  : log.action === "DELETE"
                  ? "Data Dihapus"
                  : log.action === "STATUS_CHANGE"
                  ? "Status Bayar Diubah"
                  : "Perubahan Data";

              return (
                <div
                  key={log.id}
                  className="bg-white border border-slate-200/90 rounded-2xl p-3 text-xs shadow-xs hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center justify-between gap-1 flex-wrap mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${actionColor}`}>
                        {actionIcon}
                        <span>{actionLabel}</span>
                      </span>
                      {log.expense_id && (
                        <span className="font-mono text-[11px] text-slate-500 font-medium">
                          ID #{log.expense_id}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {formatDateId(log.created_at, true)}
                    </span>
                  </div>

                  {/* Actor tag */}
                  <div className="text-[11px] text-slate-600 mb-1 flex items-center gap-1 font-medium">
                    <span className="text-slate-400">Pelaksana:</span>
                    <span className="text-slate-800 font-semibold">{formatActorLabel(log.actor)}</span>
                  </div>

                  {/* Diff details if available */}
                  {parsed?.changes && Object.keys(parsed.changes).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                        Rincian Nilai yang Diubah:
                      </div>
                      {Object.entries(parsed.changes).map(([field, diff]: [string, any]) => (
                        <div
                          key={field}
                          className="flex items-center gap-1.5 text-[11px] bg-slate-50 px-2 py-1 rounded-lg"
                        >
                          <span className="font-semibold text-slate-700 min-w-[110px]">
                            {formatFieldLabel(field)}:
                          </span>
                          <span className="line-through text-slate-400">
                            {formatValue(field, diff.old)}
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-bold text-slate-900">
                            {formatValue(field, diff.new)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Details for CREATE */}
                  {log.action === "CREATE" && parsed && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-[11px] text-slate-600 flex items-center justify-between flex-wrap gap-1">
                      <div>
                        <span className="font-semibold text-slate-800">{parsed.item_name || "Barang"}</span>
                        {parsed.supplier && parsed.supplier !== "-" && (
                          <span className="text-slate-500"> • {parsed.supplier}</span>
                        )}
                        {parsed.category && (
                          <span className="text-slate-500"> • {parsed.category}</span>
                        )}
                      </div>
                      <div className="font-bold text-slate-900 tabular-nums">
                        {formatRupiah(parsed.total_price || 0)}
                      </div>
                    </div>
                  )}

                  {/* Details for DELETE */}
                  {log.action === "DELETE" && parsed?.deleted_expense && (
                    <div className="mt-1.5 pt-1.5 border-t border-rose-100 text-[11px] text-rose-800 bg-rose-50/50 p-2 rounded-xl">
                      <span className="font-bold">Item yang dihapus:</span> {parsed.deleted_expense.item_name} ({formatRupiah(parsed.deleted_expense.total_price || 0)}) • Toko: {parsed.deleted_expense.supplier || "-"} • Tanggal: {parsed.deleted_expense.expense_date}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-end shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="rounded-xl text-xs h-9 px-4"
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
