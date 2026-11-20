import React, { useState } from "react";
import { SalesImportPreview } from "@/types";
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
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface SalesImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
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
  const [isCommitting, setIsCommitting] = useState(false);
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [showAuditDetails, setShowAuditDetails] = useState(false);

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setShowAuditDetails(false);
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
    await runPreview(selected, sourceType);
  };

  const runPreview = async (targetFile: File, src: string) => {
    setIsLoadingPreview(true);
    try {
      const res = await previewSalesImport(targetFile, src);
      setPreview(res);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal membaca file laporan");
      setPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleCommit = async () => {
    if (!file) return;
    setIsCommitting(true);
    try {
      const res = await commitSalesImport(file, sourceType, skipDuplicates, includeVoid);
      toast.success(
        `Berhasil impor ${res.inserted_paid} transaksi masuk` +
          (res.inserted_void > 0 ? ` (${res.inserted_void} void dicatat)` : "") +
          (res.duplicate_count > 0 ? `, ${res.duplicate_count} duplikat dilewati` : "")
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
                  if (file) runPreview(file, next);
                }}
              >
                <option value="auto">Auto-detect (POS / Transaction Import.csv)</option>
                <option value="pos">POS / Transaction Import (Multi-channel &amp; Rekening)</option>
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
                  <div className="text-[11px] text-slate-500">Transaksi Baru (Dibayar)</div>
                  <div className="text-base font-semibold text-emerald-700 tabular-nums">
                    {preview.new_paid_count} struk
                  </div>
                  <div className="text-[11px] text-slate-400">{preview.total_items} item</div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-500">Bersih Diterima</div>
                  <div className="text-base font-semibold text-slate-900 tabular-nums">
                    {formatRupiah(preview.total_net_received)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Fee: {formatRupiah(preview.total_platform_fee)}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-500">Status Void</div>
                  <div className="text-base font-semibold text-amber-700 tabular-nums">
                    {preview.new_void_count} struk
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {formatRupiah(preview.total_void_amount)}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/70">
                  <div className="text-[11px] text-slate-500">Duplikat (Sudah Ada)</div>
                  <div className="text-base font-semibold text-slate-700 tabular-nums">
                    {preview.duplicate_count} struk
                  </div>
                  <div className="text-[11px] text-slate-400">Otomatis dilewati</div>
                </div>
              </div>

              {/* Audit & Verifikasi Data */}
              {preview.audit && (
                <>
                  {preview.audit.total_findings === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        <strong>Verifikasi Audit:</strong> Lolos pengecekan integritas data (0 anomali/kejanggalan).
                      </span>
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
                            <div className="text-xs font-semibold flex items-center gap-1.5">
                              <span>Audit &amp; Verifikasi Integritas Data</span>
                              <span className="text-[11px] font-normal text-slate-600">
                                ({preview.audit.total_findings} catatan temuan)
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600">
                              {preview.audit.has_blocking_errors
                                ? "Terdapat error kritis yang harus diperbaiki sebelum transaksi dapat disimpan."
                                : "Terdapat data anomali atau rekening yang belum terdaftar. Harap tinjau catatan berikut."}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
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
                            onClick={() => setShowAuditDetails(!showAuditDetails)}
                            className="h-6 px-2 text-[11px] text-slate-700 hover:text-slate-900 hover:bg-black/5 gap-1"
                          >
                            {showAuditDetails ? "Tutup Rincian" : "Lihat Rincian"}
                            {showAuditDetails ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {showAuditDetails && (
                        <div className="mt-2.5 pt-2 border-t border-slate-200/80 max-h-48 overflow-y-auto space-y-1.5 pr-1">
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

                            return (
                              <div
                                key={idx}
                                className="flex items-start gap-2 bg-white/90 rounded border border-slate-200 p-2 text-xs text-slate-800"
                              >
                                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeStyle}`}
                                  >
                                    {isErr ? "Error" : isWarn ? "Peringatan" : "Info"}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                                    {categoryMap[finding.category] || finding.category}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 leading-relaxed">
                                  {finding.message}
                                </div>
                              </div>
                            );
                          })}
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
                        <span className="text-slate-500">({stat.count})</span>:{" "}
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
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-2.5 py-1.5 font-medium">Receipt</th>
                          <th className="text-left px-2.5 py-1.5 font-medium">Tipe Order</th>
                          <th className="text-left px-2.5 py-1.5 font-medium">Rekening</th>
                          <th className="text-right px-2.5 py-1.5 font-medium">Bersih</th>
                          <th className="text-center px-2.5 py-1.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.sample_rows.map((r, i) => (
                          <tr key={`${r.receipt_no}-${i}`}>
                            <td className="px-2.5 py-1.5 font-mono text-[11px]">
                              {r.receipt_no || "-"}
                              <span className="text-slate-400 ml-1">({r.item_count} item)</span>
                            </td>
                            <td className="px-2.5 py-1.5">
                              {r.order_type}
                              <span className="text-slate-400 block text-[10px]">
                                {r.payment_method}
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5">
                              {r.bank_account_name ? (
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {r.bank_account_name}
                                </Badge>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
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
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Semua transaksi pada file ini sudah pernah diimpor sebelumnya.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="text-[11px] text-slate-500">
            {preview?.audit?.has_blocking_errors ? (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Perbaiki error kritis di atas sebelum menyimpan data.
              </span>
            ) : preview?.audit && preview.audit.warning_count > 0 ? (
              <span className="text-amber-700 flex items-center gap-1">
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
