import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { FixedAsset } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Copy, Check, ExternalLink, QrCode } from "lucide-react";
import { toast } from "sonner";
import { formatDateId } from "@/lib/formatters";

interface AssetLabelPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: FixedAsset[];
}

export const AssetLabelPrintModal: React.FC<AssetLabelPrintModalProps> = ({
  isOpen,
  onClose,
  assets,
}) => {
  const [layoutMode, setLayoutMode] = useState<"a4" | "thermal">("a4");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const getLabelUrl = (qrToken: string) => {
    if (typeof window === "undefined") return `/app/inventaris/label/${qrToken}`;
    return `${window.location.origin}/app/inventaris/label/${qrToken}`;
  };

  const handleCopyUrl = (asset: FixedAsset) => {
    const url = getLabelUrl(asset.qr_token);
    navigator.clipboard.writeText(url);
    setCopiedId(asset.id);
    toast.success(`Link label ${asset.asset_code} disalin.`);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:shadow-none print:border-0">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <QrCode className="w-5 h-5 text-blue-600" />
            Cetak Label QR Inventaris Aset ({assets.length} Label)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Scan QR pada stiker untuk melihat detail aset, masa garansi, dan riwayat maintenance langsung dari HP.
          </DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 print:hidden">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setLayoutMode("a4")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                layoutMode === "a4"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Grid Stiker A4 (2 Kolom)
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("thermal")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                layoutMode === "thermal"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Thermal Kasir 58mm
            </button>
          </div>

          <Button
            type="button"
            onClick={handlePrint}
            disabled={assets.length === 0}
            className="h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Cetak Sekarang
          </Button>
        </div>

        {assets.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            Tidak ada aset yang dipilih untuk dicetak.
          </div>
        ) : (
          <div
            className={
              layoutMode === "a4"
                ? "grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3"
                : "flex flex-col items-center gap-3 print:items-start"
            }
          >
            {assets.map((asset) => {
              const labelUrl = getLabelUrl(asset.qr_token);
              return (
                <div
                  key={asset.id}
                  className={`border-2 border-slate-800 rounded-xl bg-white text-slate-900 break-inside-avoid ${
                    layoutMode === "thermal" ? "w-[220px] p-3" : "p-3.5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between border-b border-slate-300 pb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700">
                          HISTORYCAKE ASSET
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-900">
                          {asset.asset_code}
                        </span>
                      </div>
                      <p className="text-xs font-bold leading-snug line-clamp-2 text-slate-900">
                        {asset.name}
                      </p>
                      <div className="text-[10px] text-slate-700 space-y-0.5">
                        <div>Lokasi: <strong className="text-slate-900">{asset.location}</strong></div>
                        <div>Beli: {formatDateId(asset.purchase_date)}</div>
                        {asset.serial_number && (
                          <div className="font-mono truncate">SN: {asset.serial_number}</div>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 p-1 bg-white border border-slate-200 rounded-lg">
                      <QRCodeSVG
                        value={labelUrl}
                        size={layoutMode === "thermal" ? 68 : 82}
                        level="M"
                      />
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-dashed border-slate-300 flex items-center justify-between gap-2 text-[10px] text-slate-600 print:hidden">
                    <button
                      type="button"
                      onClick={() => handleCopyUrl(asset)}
                      className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                    >
                      {copiedId === asset.id ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      Salin Link QR
                    </button>
                    <a
                      href={labelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-slate-700 hover:text-blue-700 font-medium"
                    >
                      Buka Halaman Scan
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="print:hidden pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
