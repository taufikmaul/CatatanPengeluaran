import React, { useMemo, useState } from "react";
import {
  SalesImportEditableRow,
  SalesImportPreview,
  SalesImportRowOverride,
} from "@/types";
import { previewSalesImport, commitSalesImport, downloadIncomingTxTemplateCsv } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  RotateCcw,
  ArrowLeft,
  Save,
} from "lucide-react";

interface SalesImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

interface RowEditDraft {
  receipt_no: string;
  transaction_date: string;
  order_type: string;
  payment_method: string;
  bank_account_id: string;
  gross_sales: string;
  discount_amount: string;
  platform_fee: string;
  status: string;
  notes: string;
  exclude: boolean;
}

export const SalesImportModal: React.FC<SalesImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<string>("auto");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [includeVoid, setIncludeVoid] = useState(true);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isUpdatingPreview, setIsUpdatingPreview] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [showAuditDetails, setShowAuditDetails] = useState(false);

  const [overrides, setOverrides] = useState<Record<string, SalesImportRowOverride>>({});
  const [editingTxIndex, setEditingTxIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<RowEditDraft | null>(null);
  const [applyAccountToMatching, setApplyAccountToMatching] = useState(false);
  const [bulkAccountSelection, setBulkAccountSelection] = useState<Record<string, string>>({});

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setShowAuditDetails(false);
    setOverrides({});
    setEditingTxIndex(null);
    setEditDraft(null);
    setApplyAccountToMatching(false);
    setBulkAccountSelection({});
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      toast.error("Harap unggah file berformat .csv");
      return;
    }
    setFile(selected);
    setPreview(null);
    setOverrides({});
    setEditingTxIndex(null);
    setEditDraft(null);
    setBulkAccountSelection({});
    await runPreview(selected, sourceType, {}, false);
  };

  const runPreview = async (
    targetFile: File,
    src: string,
    nextOverrides: Record<string, SalesImportRowOverride> = overrides,
    isIncrementalUpdate = false
  ) => {
    if (isIncrementalUpdate) {
      setIsUpdatingPreview(true);
    } else {
      setIsLoadingPreview(true);
    }
    try {
      const res = await previewSalesImport(targetFile, src, nextOverrides);
      setPreview(res);
      return res;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal membaca file laporan");
      if (!isIncrementalUpdate) {
        setPreview(null);
      }
      return null;
    } finally {
      if (isIncrementalUpdate) {
        setIsUpdatingPreview(false);
      } else {
        setIsLoadingPreview(false);
      }
    }
  };

  const availableAccounts = preview?.available_accounts || [];

  const unregisteredAccountGroups = useMemo(() => {
    const findings = preview?.audit?.findings || [];
    const groups: Record<string, { rawValue: string; txIndices: number[] }> = {};
    for (const f of findings) {
      if (f.category === "account_mapping" && f.tx_index !== null && f.tx_index !== undefined) {
        const key = (f.raw_value || "(Belum terpetakan)").trim();
        if (!groups[key]) {
          groups[key] = { rawValue: key, txIndices: [] };
        }
        if (!groups[key].txIndices.includes(f.tx_index)) {
          groups[key].txIndices.push(f.tx_index);
        }
      }
    }
    return Object.values(groups);
  }, [preview?.audit?.findings]);

  const editingRowData: SalesImportEditableRow | null = useMemo(() => {
    if (editingTxIndex === null || !preview?.editable_rows) return null;
    return preview.editable_rows[String(editingTxIndex)] || null;
  }, [editingTxIndex, preview?.editable_rows]);

  const editingRowFindings = useMemo(() => {
    if (editingTxIndex === null || !preview?.audit?.findings) return [];
    return preview.audit.findings.filter((f) => f.tx_index === editingTxIndex);
  }, [editingTxIndex, preview?.audit?.findings]);

  const matchingAccountGroupForEditingRow = useMemo(() => {
    if (editingTxIndex === null) return null;
    const accFinding = editingRowFindings.find((f) => f.category === "account_mapping");
    if (!accFinding) return null;
    const key = (accFinding.raw_value || "(Belum terpetakan)").trim();
    const grp = unregisteredAccountGroups.find((g) => g.rawValue === key);
    if (!grp || grp.txIndices.length <= 1) return null;
    return grp;
  }, [editingTxIndex, editingRowFindings, unregisteredAccountGroups]);

  const openRowEditor = (txIndex: number) => {
    const row = preview?.editable_rows?.[String(txIndex)];
    if (!row) {
      toast.error("Detail baris tidak ditemukan untuk diedit.");
      return;
    }
    setShowAuditDetails(true);
    setEditingTxIndex(txIndex);
    setApplyAccountToMatching(false);
    setEditDraft({
      receipt_no: row.receipt_no || "",
      transaction_date: row.transaction_date || "",
      order_type: row.order_type || "",
      payment_method: row.payment_method || "",
      bank_account_id: row.bank_account_id ? String(row.bank_account_id) : "",
      gross_sales: String(row.gross_sales ?? 0),
      discount_amount: String(row.discount_amount ?? 0),
      platform_fee: String(row.platform_fee ?? 0),
      status: row.status || "paid",
      notes: row.notes || "",
      exclude: Boolean(row.is_excluded),
    });
  };

  const closeRowEditor = () => {
    setEditingTxIndex(null);
    setEditDraft(null);
    setApplyAccountToMatching(false);
  };

  const handleSaveRowEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || editingTxIndex === null || !editDraft) return;

    const gross = Number(editDraft.gross_sales);
    const disc = Number(editDraft.discount_amount);
    const fee = Number(editDraft.platform_fee);

    if (!editDraft.exclude) {
      if (Number.isNaN(gross) || gross < 0) {
        toast.error("Penjualan kotor harus berupa angka 0 atau lebih.");
        return;
      }
      if (Number.isNaN(disc) || disc < 0) {
        toast.error("Diskon harus berupa angka 0 atau lebih.");
        return;
      }
      if (Number.isNaN(fee) || fee < 0) {
        toast.error("Fee platform harus berupa angka 0 atau lebih.");
        return;
      }
    }

    const rowOverride: SalesImportRowOverride = {
      receipt_no: editDraft.receipt_no.trim(),
      transaction_date: editDraft.transaction_date || undefined,
      order_type: editDraft.order_type.trim(),
      payment_method: editDraft.payment_method.trim(),
      gross_sales: gross,
      discount_amount: disc,
      platform_fee: fee,
      status: editDraft.status,
      notes: editDraft.notes.trim(),
      exclude: editDraft.exclude,
    };

    if (editDraft.bank_account_id) {
      rowOverride.bank_account_id = Number(editDraft.bank_account_id);
    }

    const nextOverrides: Record<string, SalesImportRowOverride> = {
      ...overrides,
      [String(editingTxIndex)]: rowOverride,
    };

    let bulkCount = 0;
    if (
      applyAccountToMatching &&
      editDraft.bank_account_id &&
      matchingAccountGroupForEditingRow
    ) {
      const targetAccId = Number(editDraft.bank_account_id);
      for (const idx of matchingAccountGroupForEditingRow.txIndices) {
        if (idx === editingTxIndex) continue;
        nextOverrides[String(idx)] = {
          ...(nextOverrides[String(idx)] || {}),
          bank_account_id: targetAccId,
        };
        bulkCount += 1;
      }
    }

    const updated = await runPreview(file, sourceType, nextOverrides, true);
    if (updated) {
      setOverrides(nextOverrides);
      closeRowEditor();
      toast.success(
        bulkCount > 0
          ? `Perubahan disimpan dan rekening diterapkan ke ${bulkCount + 1} struk.`
          : "Perubahan baris berhasil disimpan dan diaudit ulang."
      );
    }
  };

  const handleResetSingleRow = async (txIndex: number) => {
    if (!file) return;
    const nextOverrides = { ...overrides };
    delete nextOverrides[String(txIndex)];
    const updated = await runPreview(file, sourceType, nextOverrides, true);
    if (updated) {
      setOverrides(nextOverrides);
      closeRowEditor();
      toast.success("Perubahan pada baris dikembalikan ke data CSV asli.");
    }
  };

  const handleResetAllOverrides = async () => {
    if (!file) return;
    const updated = await runPreview(file, sourceType, {}, true);
    if (updated) {
      setOverrides({});
      setBulkAccountSelection({});
      closeRowEditor();
      toast.success("Semua penyesuaian manual telah dikembalikan ke data CSV asli.");
    }
  };

  const handleBulkRemapAccount = async (rawValue: string, txIndices: number[]) => {
    if (!file) return;
    const selectedAccId = bulkAccountSelection[rawValue];
    if (!selectedAccId) {
      toast.error("Pilih rekening tujuan terlebih dahulu.");
      return;
    }
    const accIdNum = Number(selectedAccId);
    const nextOverrides: Record<string, SalesImportRowOverride> = { ...overrides };
    for (const idx of txIndices) {
      nextOverrides[String(idx)] = {
        ...(nextOverrides[String(idx)] || {}),
        bank_account_id: accIdNum,
      };
    }
    const updated = await runPreview(file, sourceType, nextOverrides, true);
    if (updated) {
      setOverrides(nextOverrides);
      toast.success(`Rekening tujuan berhasil diterapkan ke ${txIndices.length} struk.`);
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setIsCommitting(true);
    try {
      const res = await commitSalesImport(
        file,
        sourceType,
        skipDuplicates,
        includeVoid,
        overrides
      );
      toast.success(
        `Berhasil impor ${res.inserted_paid} transaksi masuk` +
          (res.inserted_void > 0 ? ` (${res.inserted_void} void dicatat)` : "") +
          (res.duplicate_count > 0 ? `, ${res.duplicate_count} duplikat dilewati` : "") +
          (res.excluded_count && res.excluded_count > 0
            ? `, ${res.excluded_count} baris diabaikan`
            : "")
      );
      onImportSuccess();
      handleReset();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan transaksi masuk");
    } finally {
      setIsCommitting(false);
    }
  };

  const computedDraftNetReceived = useMemo(() => {
    if (!editDraft) return 0;
    if (editDraft.status !== "paid") return 0;
    const g = Math.max(0, Number(editDraft.gross_sales) || 0);
    const d = Math.max(0, Number(editDraft.discount_amount) || 0);
    const f = Math.max(0, Number(editDraft.platform_fee) || 0);
    return Math.max(0, Math.max(0, g - d) - f);
  }, [editDraft]);

  const overrideCount = Object.keys(overrides).length;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleReset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            Import Laporan Transaksi Masuk (POS / Platform)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-100 flex items-center justify-between gap-3 text-xs text-blue-900">
            <span>
              Mendukung format <strong>Transaction Import.csv</strong> maupun ekspor laporan langsung dari POS (Moka, Olsera) tanpa perlu penyesuaian manual.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await downloadIncomingTxTemplateCsv();
                  toast.success("Template Transaction Import.csv berhasil diunduh.");
                } catch {
                  toast.error("Gagal mengunduh template CSV.");
                }
              }}
              className="shrink-0 h-7 text-xs bg-white text-blue-700 hover:bg-blue-50 border-blue-200 gap-1.5 shadow-2xs"
            >
              <Download className="w-3 h-3 text-blue-600" />
              Unduh Template
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">
                Sumber Laporan
              </label>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={sourceType}
                onChange={(e) => {
                  const next = e.target.value;
                  setSourceType(next);
                  setOverrides({});
                  closeRowEditor();
                  if (file) runPreview(file, next, {}, false);
                }}
              >
                <option value="auto">Auto-detect (POS / Cakeflow / Transaction Import.csv)</option>
                <option value="pos">POS / Transaction Import (Multi-channel &amp; Rekening)</option>
                <option value="cakeflow">Cakeflow / Custom Cake</option>
                <option value="gofood">GoFood</option>
                <option value="grabfood">GrabFood</option>
                <option value="shopeefood">ShopeeFood</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">
                File CSV Laporan
              </label>
              <label className="flex items-center justify-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-xs text-slate-700">
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate">{file ? file.name : "Pilih file .csv..."}</span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          {isLoadingPreview && (
            <div className="py-8 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Menganalisis struktur laporan &amp; mencocokkan rekening...
            </div>
          )}

          {preview && !isLoadingPreview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-600">Transaksi Baru (Dibayar)</div>
                  <div className="text-base font-semibold text-emerald-700 tabular-nums">
                    {preview.new_paid_count} struk
                  </div>
                  <div className="text-[11px] text-slate-500">{preview.total_items} item</div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-600">Bersih Diterima</div>
                  <div className="text-base font-semibold text-slate-900 tabular-nums">
                    {formatRupiah(preview.total_net_received)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Fee: {formatRupiah(preview.total_platform_fee)}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-600">Status Void</div>
                  <div className="text-base font-semibold text-amber-700 tabular-nums">
                    {preview.new_void_count} struk
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatRupiah(preview.total_void_amount)}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-600">Duplikat (Sudah Ada)</div>
                  <div className="text-base font-semibold text-slate-700 tabular-nums">
                    {preview.duplicate_count} struk
                  </div>
                  <div className="text-[11px] text-slate-500">Otomatis dilewati</div>
                </div>
              </div>

              {/* Audit & Verifikasi Data */}
              {preview.audit && (
                <>
                  {preview.audit.total_findings === 0 && editingTxIndex === null ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>
                          <strong>Verifikasi Audit:</strong> Lolos pengecekan integritas data (0 anomali/kejanggalan).
                        </span>
                      </div>
                      {overrideCount > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-emerald-800">
                            {overrideCount} baris disesuaikan
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUpdatingPreview}
                            onClick={handleResetAllOverrides}
                            className="h-6 px-2 text-[11px] bg-white border-emerald-300 text-emerald-900 hover:bg-emerald-100 gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reset Edit
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`rounded-lg border p-3 ${
                        preview.audit.has_blocking_errors
                          ? "bg-rose-50/70 border-rose-200 text-rose-950"
                          : "bg-amber-50/70 border-amber-200 text-amber-950"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-start sm:items-center gap-2">
                          {preview.audit.has_blocking_errors ? (
                            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5 sm:mt-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                          )}
                          <div>
                            <div className="text-xs font-semibold flex flex-wrap items-center gap-1.5">
                              <span>Audit &amp; Verifikasi Integritas Data</span>
                              <span className="text-[11px] font-normal text-slate-700">
                                ({preview.audit.total_findings} catatan temuan)
                              </span>
                              {isUpdatingPreview && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-normal text-slate-600">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Mengaudit ulang...
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-700">
                              {preview.audit.has_blocking_errors
                                ? "Terdapat error kritis yang harus diperbaiki sebelum transaksi dapat disimpan."
                                : "Terdapat data anomali atau rekening yang belum terdaftar. Anda dapat mengedit data bermasalah langsung di bawah."}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {preview.audit.error_count > 0 && (
                            <Badge
                              variant="outline"
                              className="bg-rose-100 text-rose-800 border-rose-300 text-[10px] px-1.5 py-0"
                            >
                              {preview.audit.error_count} Error
                            </Badge>
                          )}
                          {preview.audit.warning_count > 0 && (
                            <Badge
                              variant="outline"
                              className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] px-1.5 py-0"
                            >
                              {preview.audit.warning_count} Peringatan
                            </Badge>
                          )}
                          {preview.audit.info_count > 0 && (
                            <Badge
                              variant="outline"
                              className="bg-blue-100 text-blue-800 border-blue-300 text-[10px] px-1.5 py-0"
                            >
                              {preview.audit.info_count} Info
                            </Badge>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (showAuditDetails && editingTxIndex !== null) {
                                closeRowEditor();
                              }
                              setShowAuditDetails(!showAuditDetails);
                            }}
                            className="h-7 px-2 text-[11px] text-slate-800 hover:text-slate-950 hover:bg-black/5 gap-1"
                          >
                            {showAuditDetails ? "Tutup Rincian" : "Lihat & Edit"}
                            {showAuditDetails ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {overrideCount > 0 && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/80 border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700">
                          <span>
                            <strong>{preview.edited_count ?? overrideCount}</strong> baris disesuaikan manual
                            {preview.excluded_count && preview.excluded_count > 0
                              ? `, ${preview.excluded_count} baris diabaikan`
                              : ""}
                            .
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isUpdatingPreview}
                            onClick={handleResetAllOverrides}
                            className="h-6 px-2 text-[11px] text-slate-700 hover:text-slate-950 gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reset Semua Edit
                          </Button>
                        </div>
                      )}

                      {showAuditDetails && (
                        <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 space-y-2.5">
                          {editingTxIndex !== null && editDraft ? (
                            <form
                              onSubmit={handleSaveRowEdit}
                              className="rounded-md bg-white border border-slate-200 p-3 space-y-3 text-xs text-slate-800"
                            >
                              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={closeRowEditor}
                                    className="h-7 px-2 text-xs text-slate-700 hover:text-slate-950 gap-1"
                                  >
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                    Kembali
                                  </Button>
                                  <div className="font-semibold text-slate-900 truncate">
                                    Edit Transaksi{" "}
                                    <span className="font-mono">
                                      {editingRowData?.receipt_no || `#${editingTxIndex + 1}`}
                                    </span>
                                  </div>
                                </div>
                                {overrides[String(editingTxIndex)] && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={isUpdatingPreview}
                                    onClick={() => handleResetSingleRow(editingTxIndex)}
                                    className="h-7 px-2 text-[11px] text-slate-600 hover:text-slate-900 gap-1"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    Reset Baris
                                  </Button>
                                )}
                              </div>

                              {editingRowFindings.length > 0 && (
                                <div className="rounded bg-amber-50 border border-amber-200 p-2 space-y-1 text-[11px] text-amber-950">
                                  {editingRowFindings.map((f, i) => (
                                    <div key={i} className="leading-snug">
                                      {f.message}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editDraft.exclude}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, exclude: e.target.checked })
                                  }
                                  className="rounded border-slate-300"
                                />
                                <span>Abaikan / lewati baris ini saat impor</span>
                              </label>

                              {!editDraft.exclude && (
                                <>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    <div>
                                      <label
                                        htmlFor="import-edit-receipt"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        No Receipt / Struk
                                      </label>
                                      <input
                                        id="import-edit-receipt"
                                        type="text"
                                        value={editDraft.receipt_no}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, receipt_no: e.target.value })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-date"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Tanggal Transaksi
                                      </label>
                                      <input
                                        id="import-edit-date"
                                        type="date"
                                        value={editDraft.transaction_date}
                                        onChange={(e) =>
                                          setEditDraft({
                                            ...editDraft,
                                            transaction_date: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-account"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Rekening Tujuan
                                      </label>
                                      <select
                                        id="import-edit-account"
                                        value={editDraft.bank_account_id}
                                        onChange={(e) =>
                                          setEditDraft({
                                            ...editDraft,
                                            bank_account_id: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      >
                                        <option value="">
                                          {availableAccounts.length > 0
                                            ? "-- Pilih Rekening Terdaftar --"
                                            : "Belum ada rekening di Rekening Setup"}
                                        </option>
                                        {availableAccounts.map((acc) => (
                                          <option key={acc.id} value={String(acc.id)}>
                                            {acc.name} ({acc.bank_name})
                                          </option>
                                        ))}
                                      </select>
                                      {editingRowData?.raw_bank_account_name &&
                                        !editDraft.bank_account_id && (
                                          <p className="mt-0.5 text-[10px] text-amber-800">
                                            Nilai CSV saat ini: {editingRowData.raw_bank_account_name}
                                          </p>
                                        )}
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-status"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Status Transaksi
                                      </label>
                                      <select
                                        id="import-edit-status"
                                        value={editDraft.status}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, status: e.target.value })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      >
                                        <option value="paid">Dibayar</option>
                                        <option value="void">Void</option>
                                        <option value="cancelled">Batal</option>
                                      </select>
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-order-type"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Tipe Order
                                      </label>
                                      <input
                                        id="import-edit-order-type"
                                        type="text"
                                        value={editDraft.order_type}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, order_type: e.target.value })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-payment"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Metode Pembayaran
                                      </label>
                                      <input
                                        id="import-edit-payment"
                                        type="text"
                                        value={editDraft.payment_method}
                                        onChange={(e) =>
                                          setEditDraft({
                                            ...editDraft,
                                            payment_method: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-gross"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Penjualan Kotor (Rp)
                                      </label>
                                      <input
                                        id="import-edit-gross"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={editDraft.gross_sales}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, gross_sales: e.target.value })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-discount"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Diskon (Rp)
                                      </label>
                                      <input
                                        id="import-edit-discount"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={editDraft.discount_amount}
                                        onChange={(e) =>
                                          setEditDraft({
                                            ...editDraft,
                                            discount_amount: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div>
                                      <label
                                        htmlFor="import-edit-fee"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Fee Platform (Rp)
                                      </label>
                                      <input
                                        id="import-edit-fee"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={editDraft.platform_fee}
                                        onChange={(e) =>
                                          setEditDraft({
                                            ...editDraft,
                                            platform_fee: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>

                                    <div className="flex flex-col justify-end">
                                      <div className="text-[11px] font-medium text-slate-600 mb-1">
                                        Bersih Diterima (Otomatis)
                                      </div>
                                      <div className="h-8 rounded-md bg-slate-50 border border-slate-200 px-2.5 flex items-center text-xs font-semibold text-emerald-700 tabular-nums">
                                        {formatRupiah(computedDraftNetReceived)}
                                      </div>
                                    </div>

                                    <div className="sm:col-span-2">
                                      <label
                                        htmlFor="import-edit-notes"
                                        className="block text-[11px] font-medium text-slate-700 mb-1"
                                      >
                                        Catatan
                                      </label>
                                      <input
                                        id="import-edit-notes"
                                        type="text"
                                        value={editDraft.notes}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, notes: e.target.value })
                                        }
                                        placeholder="Opsional"
                                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>
                                  </div>

                                  {matchingAccountGroupForEditingRow && editDraft.bank_account_id && (
                                    <label className="flex items-start gap-2 rounded bg-blue-50 border border-blue-200 p-2 text-[11px] text-blue-900 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={applyAccountToMatching}
                                        onChange={(e) =>
                                          setApplyAccountToMatching(e.target.checked)
                                        }
                                        className="rounded border-blue-300 mt-0.5"
                                      />
                                      <span>
                                        Terapkan rekening tujuan ini juga ke semua{" "}
                                        <strong>
                                          {matchingAccountGroupForEditingRow.txIndices.length} struk
                                        </strong>{" "}
                                        dengan rekening{" "}
                                        <strong>
                                          &apos;{matchingAccountGroupForEditingRow.rawValue}&apos;
                                        </strong>
                                        .
                                      </span>
                                    </label>
                                  )}
                                </>
                              )}

                              <div className="flex items-center justify-end gap-2 pt-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={closeRowEditor}
                                  className="h-8 text-xs"
                                >
                                  Batal
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={isUpdatingPreview}
                                  className="h-8 text-xs gap-1.5"
                                >
                                  {isUpdatingPreview ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Save className="w-3.5 h-3.5" />
                                  )}
                                  Simpan Perubahan
                                </Button>
                              </div>
                            </form>
                          ) : (
                            <>
                              {unregisteredAccountGroups.length > 0 && (
                                <div className="rounded-md bg-white border border-amber-200 p-2.5 space-y-2">
                                  <div className="text-[11px] font-semibold text-slate-800">
                                    Perbaikan Cepat Rekening Tujuan
                                  </div>
                                  {availableAccounts.length === 0 ? (
                                    <div className="text-[11px] text-slate-600">
                                      Belum ada rekening aktif di Rekening Setup. Tambahkan rekening terlebih dahulu atau edit baris secara manual.
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {unregisteredAccountGroups.map((grp) => (
                                        <div
                                          key={grp.rawValue}
                                          className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs"
                                        >
                                          <div className="flex-1 min-w-0 text-slate-800">
                                            <span className="font-medium">
                                              &apos;{grp.rawValue}&apos;
                                            </span>{" "}
                                            <span className="text-slate-600">
                                              ({grp.txIndices.length} struk)
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1.5 shrink-0">
                                            <select
                                              aria-label={`Pilih rekening pengganti untuk ${grp.rawValue}`}
                                              value={bulkAccountSelection[grp.rawValue] || ""}
                                              onChange={(e) =>
                                                setBulkAccountSelection((prev) => ({
                                                  ...prev,
                                                  [grp.rawValue]: e.target.value,
                                                }))
                                              }
                                              className="h-7 rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-900 max-w-[190px]"
                                            >
                                              <option value="">Pilih rekening tujuan...</option>
                                              {availableAccounts.map((acc) => (
                                                <option key={acc.id} value={String(acc.id)}>
                                                  {acc.name}
                                                </option>
                                              ))}
                                            </select>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              disabled={
                                                isUpdatingPreview ||
                                                !bulkAccountSelection[grp.rawValue]
                                              }
                                              onClick={() =>
                                                handleBulkRemapAccount(
                                                  grp.rawValue,
                                                  grp.txIndices
                                                )
                                              }
                                              className="h-7 px-2.5 text-[11px] bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                                            >
                                              Terapkan
                                            </Button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                                {preview.audit.findings.map((finding, idx) => {
                                  const isErr = finding.level === "error";
                                  const isWarn = finding.level === "warning";
                                  const badgeStyle = isErr
                                    ? "bg-rose-100 text-rose-800 border-rose-200"
                                    : isWarn
                                    ? "bg-amber-100 text-amber-800 border-amber-200"
                                    : "bg-blue-100 text-blue-800 border-blue-200";

                                  const categoryMap: Record<string, string> = {
                                    missing_field: "Data Kosong",
                                    financial_anomaly: "Anomali Finansial",
                                    date_anomaly: "Anomali Tanggal",
                                    account_mapping: "Rekening Tujuan",
                                    duplicate: "Duplikasi",
                                  };

                                  const canEditFinding =
                                    finding.tx_index !== null &&
                                    finding.tx_index !== undefined &&
                                    Boolean(preview.editable_rows?.[String(finding.tx_index)]);

                                  return (
                                    <div
                                      key={idx}
                                      className="flex flex-col sm:flex-row sm:items-start gap-2 bg-white/95 rounded border border-slate-200 p-2 text-xs text-slate-800"
                                    >
                                      <div className="flex items-start gap-2 flex-1 min-w-0">
                                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                          <span
                                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeStyle}`}
                                          >
                                            {isErr ? "Error" : isWarn ? "Peringatan" : "Info"}
                                          </span>
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                                            {categoryMap[finding.category] || finding.category}
                                          </span>
                                        </div>
                                        <div className="flex-1 min-w-0 leading-relaxed">
                                          {finding.message}
                                        </div>
                                      </div>
                                      {canEditFinding && (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={isUpdatingPreview}
                                          onClick={() => openRowEditor(finding.tx_index!)}
                                          aria-label={`Edit data ${finding.receipt_no || "baris"}`}
                                          className="h-7 px-2.5 text-[11px] shrink-0 self-end sm:self-start gap-1 border-slate-300 text-slate-800 hover:bg-slate-50"
                                        >
                                          <Pencil className="w-3 h-3" />
                                          Edit
                                        </Button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {Object.keys(preview.channel_breakdown).length > 0 && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-medium text-slate-700 mb-2">
                    Ringkasan per Tipe Order
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(preview.channel_breakdown).map(([ch, stat]) => (
                      <div
                        key={ch}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200"
                      >
                        <span className="font-medium text-slate-800">{ch}</span>{" "}
                        <span className="text-slate-600">({stat.count})</span>:{" "}
                        <span className="font-semibold text-emerald-700 tabular-nums">
                          {formatRupiah(stat.net_received)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.sample_rows.length > 0 && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-700">
                    Preview Baris Pertama ({preview.sample_rows.length} dari{" "}
                    {preview.new_paid_count + preview.new_void_count} transaksi baru)
                  </div>
                  <div className="max-h-48 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-2.5 py-1.5 font-medium">Receipt</th>
                          <th className="text-left px-2.5 py-1.5 font-medium">Tipe Order</th>
                          <th className="text-left px-2.5 py-1.5 font-medium">Rekening</th>
                          <th className="text-right px-2.5 py-1.5 font-medium">Bersih</th>
                          <th className="text-center px-2.5 py-1.5 font-medium">Status</th>
                          <th className="text-right px-2.5 py-1.5 font-medium">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.sample_rows.map((r, i) => (
                          <tr key={`${r.receipt_no}-${i}`}>
                            <td className="px-2.5 py-1.5 font-mono text-[11px]">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span>{r.receipt_no || "-"}</span>
                                <span className="text-slate-500">({r.item_count} item)</span>
                                {r.is_edited && (
                                  <Badge
                                    variant="outline"
                                    className="bg-blue-50 text-blue-700 border-blue-200 text-[9px] px-1 py-0 font-sans"
                                  >
                                    Diedit
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-2.5 py-1.5">
                              {r.order_type}
                              <span className="text-slate-500 block text-[10px]">
                                {r.payment_method}
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5">
                              {r.bank_account_name ? (
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {r.bank_account_name}
                                </Badge>
                              ) : (
                                <span className="text-slate-500 italic text-[11px]">
                                  Belum terpetakan
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">
                              {formatRupiah(r.net_received)}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              {r.status === "paid" ? (
                                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                                  Dibayar
                                </Badge>
                              ) : (
                                <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                                  Void
                                </Badge>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 text-right">
                              {r.tx_index !== undefined &&
                                preview.editable_rows?.[String(r.tx_index)] && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={isUpdatingPreview}
                                    onClick={() => openRowEditor(r.tx_index!)}
                                    aria-label={`Edit baris ${r.receipt_no || i + 1}`}
                                    className="h-6 px-2 text-[11px] text-slate-700 hover:text-slate-950 gap-1"
                                  >
                                    <Pencil className="w-3 h-3" />
                                    Edit
                                  </Button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Lewati transaksi duplikat (No Receipt sama)
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeVoid}
                    onChange={(e) => setIncludeVoid(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Catat transaksi Void sebagai arsip (nominal 0)
                </label>
              </div>
            </div>
          )}

          {preview && preview.new_paid_count === 0 && preview.duplicate_count > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Semua transaksi pada file ini sudah pernah diimpor sebelumnya.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="text-[11px] text-slate-600">
            {preview?.audit?.has_blocking_errors ? (
              <span className="text-rose-700 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Perbaiki error kritis di atas sebelum menyimpan data.
              </span>
            ) : preview?.audit && preview.audit.warning_count > 0 ? (
              <span className="text-amber-800 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {preview.audit.warning_count} catatan peringatan audit terdeteksi.
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button variant="outline" onClick={onClose}>
              Tutup
            </Button>
            <Button
              disabled={
                !preview ||
                isCommitting ||
                isUpdatingPreview ||
                Boolean(preview.audit?.has_blocking_errors) ||
                (preview.new_paid_count === 0 && (!includeVoid || preview.new_void_count === 0))
              }
              onClick={handleCommit}
              className="gap-1.5"
            >
              {isCommitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Simpan {preview ? preview.new_paid_count + (includeVoid ? preview.new_void_count : 0) : 0}{" "}
              Transaksi
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
