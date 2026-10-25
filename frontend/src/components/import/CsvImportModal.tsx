import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (!selected.name.endsWith(".csv")) {
        toast.error("Harap pilih file dengan format .csv");
        return;
      }
      setFile(selected);
      setImportResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("skip_duplicates", String(skipDuplicates));

    try {
      const res = await api.post("/import/csv", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult(res.data.result);
      toast.success(`Berhasil mengimpor ${res.data.result.inserted_count} baris data!`);
      onImportSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal mengimpor file CSV");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    window.open("/api/v1/import/template", "_blank");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            Import Data CSV
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Download Template Bar */}
          <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs">
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <FileText className="w-4 h-4 text-slate-500" />
              <span>Format Kolom Standar (15 Kolom)</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              className="h-7 text-xs rounded-lg gap-1 border-slate-200"
            >
              <Download className="w-3 h-3" />
              Template
            </Button>
          </div>

          {/* Upload Dropzone */}
          <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 transition-colors rounded-2xl p-6 text-center cursor-pointer relative bg-slate-50/40">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-700">
              {file ? file.name : "Klik atau seret file CSV ke sini"}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Maksimal 10MB per file</p>
          </div>

          {/* Options */}
          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            <span>Abaikan data duplikat (otomatis dilewati jika transaksi sama)</span>
          </label>

          {/* Result Summary */}
          {importResult && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs space-y-1.5 text-emerald-800">
              <div className="font-semibold flex items-center gap-1.5 text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Hasil Impor CSV
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center font-medium">
                <div className="bg-white/80 p-2 rounded-xl">
                  <div className="text-base font-bold text-emerald-700">{importResult.inserted_count}</div>
                  <div className="text-[10px] text-slate-500">Tersimpan</div>
                </div>
                <div className="bg-white/80 p-2 rounded-xl">
                  <div className="text-base font-bold text-amber-700">{importResult.duplicate_count}</div>
                  <div className="text-[10px] text-slate-500">Duplikat</div>
                </div>
                <div className="bg-white/80 p-2 rounded-xl">
                  <div className="text-base font-bold text-rose-700">{importResult.failed_count}</div>
                  <div className="text-[10px] text-slate-500">Gagal</div>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={onClose} className="rounded-xl text-xs h-9">
              Tutup
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-9 px-4 font-semibold"
            >
              {isUploading ? "Mengunggah..." : "Mulai Impor"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
