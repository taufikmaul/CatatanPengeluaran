import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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

interface AssetLabelCardProps {
  asset: FixedAsset;
  labelUrl: string;
  layoutMode: "a4" | "thermal";
  isCopied?: boolean;
  onCopyUrl?: (asset: FixedAsset) => void;
  showActions?: boolean;
}

const AssetLabelCard: React.FC<AssetLabelCardProps> = ({
  asset,
  labelUrl,
  layoutMode,
  isCopied = false,
  onCopyUrl,
  showActions = false,
}) => {
  const isThermal = layoutMode === "thermal";

  const headerBlock = (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-300 pb-1">
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700 truncate">
        HISTORYCAKE ASSET
      </span>
      <span className="text-[10px] font-mono font-bold text-slate-900 shrink-0">
        {asset.asset_code}
      </span>
    </div>
  );

  return (
    <div
      className={`border-2 border-slate-800 rounded-xl bg-white text-slate-900 break-inside-avoid ${
        isThermal ? "w-[220px] p-3" : "p-3.5 h-full"
      }`}
      style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      {isThermal && <div className="mb-1.5">{headerBlock}</div>}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {!isThermal && headerBlock}
          <p className="text-xs font-bold leading-snug line-clamp-2 text-slate-900">
            {asset.name}
          </p>
          <div className="text-[10px] text-slate-700 space-y-0.5">
            <div className="truncate">
              Lokasi: <strong className="text-slate-900">{asset.location}</strong>
            </div>
            <div>Beli: {formatDateId(asset.purchase_date)}</div>
            {asset.serial_number && (
              <div className="font-mono truncate">SN: {asset.serial_number}</div>
            )}
          </div>
        </div>

        <div className="shrink-0 p-1 bg-white border border-slate-200 rounded-lg">
          <QRCodeSVG
            value={labelUrl}
            size={isThermal ? 64 : 82}
            level="M"
          />
        </div>
      </div>

      {showActions && onCopyUrl && (
        <div className="mt-2 pt-1.5 border-t border-dashed border-slate-300 flex items-center justify-between gap-2 text-[10px] text-slate-600 print:hidden">
          <button
            type="button"
            onClick={() => onCopyUrl(asset)}
            className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
          >
            {isCopied ? (
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
      )}
    </div>
  );
};

export const AssetLabelPrintModal: React.FC<AssetLabelPrintModalProps> = ({
  isOpen,
  onClose,
  assets,
}) => {
  const [layoutMode, setLayoutMode] = useState<"a4" | "thermal">("a4");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    document.body.classList.add("printing-asset-labels");
    return () => {
      document.body.classList.remove("printing-asset-labels");
    };
  }, [isOpen]);

  const assetRows = useMemo(() => {
    const rows: FixedAsset[][] = [];
    for (let i = 0; i < assets.length; i += 2) {
      rows.push(assets.slice(i, i + 2));
    }
    return rows;
  }, [assets]);

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

  const printPortal =
    isOpen && assets.length > 0 && typeof document !== "undefined"
      ? createPortal(
          <div className="asset-label-print-root hidden print:block bg-white text-slate-900">
            {layoutMode === "a4" ? (
              <div>
                {assetRows.map((row, rowIdx) => (
                  <div
                    key={row.map((a) => a.id).join("-")}
                    className={`grid grid-cols-2 gap-3 items-stretch break-inside-avoid ${
                      rowIdx < assetRows.length - 1 ? "mb-3" : ""
                    }`}
                    style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
                  >
                    {row.map((asset) => (
                      <AssetLabelCard
                        key={asset.id}
                        asset={asset}
                        labelUrl={getLabelUrl(asset.qr_token)}
                        layoutMode="a4"
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {assets.map((asset, idx) => (
                  <div
                    key={asset.id}
                    className={`break-inside-avoid ${
                      idx < assets.length - 1 ? "mb-3" : ""
                    }`}
                    style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
                  >
                    <AssetLabelCard
                      asset={asset}
                      labelUrl={getLabelUrl(asset.qr_token)}
                      layoutMode="thermal"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto print:hidden">
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
                  ? "grid grid-cols-1 sm:grid-cols-2 gap-4"
                  : "flex flex-col items-center gap-3"
              }
            >
              {assets.map((asset) => (
                <AssetLabelCard
                  key={asset.id}
                  asset={asset}
                  labelUrl={getLabelUrl(asset.qr_token)}
                  layoutMode={layoutMode}
                  isCopied={copiedId === asset.id}
                  onCopyUrl={handleCopyUrl}
                  showActions
                />
              ))}
            </div>
          )}

          <DialogFooter className="print:hidden pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {printPortal}
    </>
  );
};
