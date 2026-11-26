import React, { useState, useEffect, useMemo } from "react";
import { Expense, ItemSuggestion } from "@/types";
import { confirmExpenseUnit } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  computeLiveConversionPreview,
  formatConversionQty,
  shouldShowRetailTier,
} from "@/lib/packagingConversion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, Package } from "lucide-react";

interface ConfirmPackagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  itemSuggestions: ItemSuggestion[];
  units: string[];
  onConfirmed: () => void;
}

export const ConfirmPackagingModal: React.FC<ConfirmPackagingModalProps> = ({
  isOpen,
  onClose,
  expense,
  itemSuggestions,
  units,
  onConfirmed,
}) => {
  const [selectedPkgId, setSelectedPkgId] = useState<number | null>(null);
  const [unit, setUnit] = useState("Pcs");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [isSaving, setIsSaving] = useState(false);

  const matchedSuggestion = useMemo(() => {
    if (!expense) return null;
    if (expense.master_item_id) {
      const byId = itemSuggestions.find((s) => s.id === expense.master_item_id);
      if (byId) return byId;
    }
    const nm = (expense.item_name || "").trim().toLowerCase();
    return itemSuggestions.find((s) => s.item_name.toLowerCase() === nm) || null;
  }, [expense, itemSuggestions]);

  const packagings = useMemo(
    () => (matchedSuggestion?.packagings || []).filter((p) => p.is_active !== false),
    [matchedSuggestion]
  );

  useEffect(() => {
    if (!expense || !isOpen) return;
    setSelectedPkgId(expense.packaging_id ?? null);
    setUnit(expense.unit || "Pcs");
    setQty(String(expense.qty || 1));
    setUnitPrice(String(expense.unit_price || 0));
  }, [expense, isOpen]);

  const selectedPkg = useMemo(
    () => packagings.find((p) => p.id === selectedPkgId) || null,
    [packagings, selectedPkgId]
  );

  const livePreview = useMemo(
    () =>
      computeLiveConversionPreview({
        qty: Number(qty) || 1,
        unit,
        unitPrice: Number(unitPrice) || 0,
        selectedPackaging: selectedPkg,
        legacySatuanBeli: matchedSuggestion?.satuan_beli,
        legacySatuanEcer: matchedSuggestion?.satuan_ecer,
        legacySatuanResep: matchedSuggestion?.satuan_resep,
        legacyKonversiResep: matchedSuggestion?.konversi_resep,
      }),
    [qty, unit, unitPrice, selectedPkg, matchedSuggestion]
  );

  if (!expense) return null;

  const handleConfirm = async () => {
    const qVal = Number(qty);
    const pVal = Number(unitPrice);
    if (!(qVal > 0)) {
      toast.error("Qty harus lebih dari 0.");
      return;
    }
    if (pVal < 0 || Number.isNaN(pVal)) {
      toast.error("Harga satuan tidak valid.");
      return;
    }

    setIsSaving(true);
    try {
      await confirmExpenseUnit(expense.id, {
        master_item_id: matchedSuggestion?.id ?? expense.master_item_id ?? null,
        packaging_id: selectedPkg?.id ?? selectedPkgId ?? null,
        qty: qVal,
        unit: unit.trim() || "Pcs",
        unit_price: pVal,
        retail_qty: livePreview.retail_qty,
        retail_unit: livePreview.retail_unit,
        base_qty: livePreview.base_qty,
        base_unit: livePreview.base_unit,
      });
      toast.success("Varian kemasan berhasil dikonfirmasi.");
      onConfirmed();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Gagal mengonfirmasi kemasan.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-xl p-6">
        <DialogHeader className="pb-3 border-b border-border/70">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-600" />
            <span>Konfirmasi Varian Kemasan</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {expense.item_name} • {expense.supplier} ({expense.expense_date})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {expense.review_warning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>{expense.review_warning}</span>
            </div>
          )}

          {packagings.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground block">
                Pilih Varian Kemasan Terdaftar
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {packagings.map((pkg) => {
                  const active = selectedPkgId === pkg.id;
                  return (
                    <button
                      key={pkg.id || pkg.label}
                      type="button"
                      onClick={() => {
                        setSelectedPkgId(pkg.id ?? null);
                        setUnit(pkg.purchase_unit);
                      }}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                        active
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-input hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-xs font-semibold">{pkg.label}</div>
                      <div className="text-[11px] opacity-80 mt-0.5">
                        1 {pkg.purchase_unit}
                        {shouldShowRetailTier({
                          qty: 1,
                          unit: pkg.purchase_unit,
                          retailQty: pkg.retail_qty,
                          retailUnit: pkg.retail_unit,
                          baseUnit: pkg.base_unit,
                        })
                          ? ` → ${formatConversionQty(pkg.retail_qty)} ${pkg.retail_unit}`
                          : ""}{" "}
                        → {formatConversionQty(pkg.base_qty)} {pkg.base_unit}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground block">Qty</label>
              <Input
                type="number"
                min={0.0001}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-9 text-xs tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground block">Satuan Beli</label>
              <AdaptiveSelect
                value={unit}
                onValueChange={(val) => {
                  setUnit(val);
                  setSelectedPkgId(null);
                }}
                options={units}
                creatable={true}
                creatablePrefix="Satuan"
                placeholder="Satuan..."
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground block">Harga Satuan</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="h-9 text-xs tabular-nums"
              />
            </div>
          </div>

          {livePreview.base_qty !== null && livePreview.base_unit && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 font-medium flex-wrap">
                <span>
                  {formatConversionQty(Number(qty) || 1)} {unit}
                </span>
                {shouldShowRetailTier({
                  qty: Number(qty) || 1,
                  unit,
                  retailQty: livePreview.retail_qty,
                  retailUnit: livePreview.retail_unit,
                  baseUnit: livePreview.base_unit,
                }) && (
                  <>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {formatConversionQty(livePreview.retail_qty)} {livePreview.retail_unit}
                    </span>
                  </>
                )}
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                <strong className="tabular-nums">
                  {formatConversionQty(livePreview.base_qty)} {livePreview.base_unit}
                </strong>
              </div>
              {livePreview.base_unit_price !== null && (
                <span className="font-semibold tabular-nums">
                  {formatRupiah(livePreview.base_unit_price)}/{livePreview.base_unit}
                </span>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-4 border-t border-border/70">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={handleConfirm}
            className="gap-1.5 font-semibold"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isSaving ? "Menyimpan..." : "Konfirmasi & Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
