import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

interface CsvTemplateImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  templateColumns: string[];
  onDownloadTemplate: () => Promise<void>;
  onImportCsv: (file: File, updateExisting: boolean) => Promise<void>;
  isImporting?: boolean;
  showUpdateExistingToggle?: boolean;
}

export const CsvTemplateImportDialog: React.FC<CsvTemplateImportDialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  templateColumns,
  onDownloadTemplate,
  onImportCsv,
  isImporting = false,
  showUpdateExistingToggle = true,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setUpdateExisting(true);
    }
  }, [isOpen]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await onDownloadTemplate();
      toast.success("Template CSV berhasil diunduh.");
    } catch {
      toast.error("Gagal mengunduh template CSV.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error("Pilih file CSV terlebih dahulu.");
      return;
    }
    await onImportCsv(file, updateExisting);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleImport} className="space-y-4 text-xs">
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800">1. Unduh Template CSV</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDownloading}
                onClick={handleDownload}
                className="h-8 text-xs gap-1.5 bg-white"
              >
                <Download className="w-3.5 h-3.5" />
                {isDownloading ? "Mengunduh..." : "Unduh Template CSV"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {templateColumns.map((col) => (
                <Badge
                  key={col}
                  variant="outline"
                  className="text-[10px] font-normal bg-white text-slate-700 border-slate-300"
                >
                  {col}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="font-bold text-slate-800 block">
              2. Unggah File CSV yang Sudah Diisi
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 border border-slate-200 rounded-xl p-1.5 bg-white"
            />
            {file && (
              <p className="text-[11px] text-emerald-700 font-medium">
                File terpilih: {file.name}
              </p>
            )}
          </div>

          {showUpdateExistingToggle && (
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span>Perbarui data jika nama sudah terdaftar</span>
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Batal
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!file || isImporting}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              {isImporting ? "Mengimpor..." : "Import CSV Sekarang"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
