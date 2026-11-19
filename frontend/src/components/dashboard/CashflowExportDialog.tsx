import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Download, FileSpreadsheet, Loader2, Calendar, Wallet } from "lucide-react";
import { getBankAccounts, exportDailyCashflowCsv } from "@/lib/api";

export interface CashflowExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialMonth?: number;
  initialYear?: number;
}

const MONTH_OPTIONS = [
  { value: 1, label: "Januari" },
  { value: 2, label: "Februari" },
  { value: 3, label: "Maret" },
  { value: 4, label: "April" },
  { value: 5, label: "Mei" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "Agustus" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Desember" },
];

export const CashflowExportDialog: React.FC<CashflowExportDialogProps> = ({
  isOpen,
  onClose,
  initialMonth,
  initialYear,
}) => {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number>(initialMonth || now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(initialYear || now.getFullYear());
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: bankAccounts = [], isLoading: isLoadingAccounts } = useQuery({
    queryKey: ["bank-accounts-active"],
    queryFn: () => getBankAccounts(true),
    staleTime: 60 * 1000,
    enabled: isOpen,
  });

  const yearOptions = [
    now.getFullYear() - 2,
    now.getFullYear() - 1,
    now.getFullYear(),
    now.getFullYear() + 1,
  ];

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    try {
      await exportDailyCashflowCsv({
        month: selectedMonth,
        year: selectedYear,
        bankAccountId: selectedAccountId || undefined,
      });
      onClose();
    } catch (err: any) {
      console.error("Gagal export cashflow:", err);
      setErrorMessage(
        err?.response?.data?.detail || "Gagal mengunduh CSV arus kas. Silakan coba kembali."
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                Export Arus Kas Harian
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                Format: Tanggal, Cash In, Cash Out harian, dan Saldo Berjalan (CSV).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Periode Bulan & Tahun */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Periode Laporan</span>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    Tahun {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Rekening / Akun Kas Filter */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-slate-500" />
              <span>Filter Rekening &amp; Kas</span>
            </Label>
            <select
              value={selectedAccountId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedAccountId(val ? Number(val) : null);
              }}
              disabled={isLoadingAccounts}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="">Semua Rekening &amp; Kas (Konsolidasi)</option>
              {bankAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.bank_name})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">
              Pilih satu rekening jika ingin rekap per kasir atau bank tertentu, atau biarkan konsolidasi untuk seluruh kas usaha.
            </p>
          </div>

          {/* Format Penjelasan */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs space-y-1 text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
              <span>Struktur Kolom CSV:</span>
              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                UTF-8 BOM (Excel Ready)
              </span>
            </div>
            <ul className="list-disc list-inside text-[11px] space-y-0.5 text-slate-500 dark:text-slate-400 mt-1">
              <li>Tanggal transaksi harian</li>
              <li>Kas Masuk (Cash In riil dari penjualan lunas)</li>
              <li>Kas Keluar (Cash Out belanja lunas &amp; DP)</li>
              <li>Arus Kas Bersih harian (Net Cash Flow)</li>
              <li>Saldo Berjalan kumulatif (Running Balance)</li>
            </ul>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isExporting}
            className="text-xs h-9"
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
            className="h-9 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Mengunduh...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Unduh CSV Cashflow</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
