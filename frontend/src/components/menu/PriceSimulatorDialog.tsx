import React, { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { MasterItemCombobox } from "./MasterItemCombobox";
import { simulateMenuPriceImpact } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import {
  FoodCostStatus,
  MasterItem,
  PriceAdjustmentInput,
  PriceSimulationResponse,
} from "@/types";
import {
  AlertCircle,
  Loader2,
  Plus,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
} from "lucide-react";

interface AdjustmentDraftRow {
  key: string;
  master_item_id: number | null;
  mode: "pct" | "new_price";
  value: string;
}

interface PriceSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masterItems: MasterItem[];
}

function createDraftRow(): AdjustmentDraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    master_item_id: null,
    mode: "pct",
    value: "15",
  };
}

function getStatusBadge(status: FoodCostStatus): { label: string; className: string } {
  switch (status) {
    case "ideal":
      return {
        label: "Ideal",
        className:
          "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "moderate":
      return {
        label: "Sedang",
        className:
          "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
      };
    case "high":
      return {
        label: "Tinggi",
        className:
          "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
      };
    case "not_sellable":
      return {
        label: "Internal",
        className:
          "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
      };
    default:
      return {
        label: "Belum Lengkap",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

export const PriceSimulatorDialog: React.FC<PriceSimulatorDialogProps> = ({
  open,
  onOpenChange,
  masterItems,
}) => {
  const [rows, setRows] = useState<AdjustmentDraftRow[]>([createDraftRow()]);
  const [result, setResult] = useState<PriceSimulationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const masterMap = useMemo(() => {
    const map = new Map<number, MasterItem>();
    for (const m of masterItems) map.set(m.id, m);
    return map;
  }, [masterItems]);

  const simMutation = useMutation({
    mutationFn: (adjustments: PriceAdjustmentInput[]) =>
      simulateMenuPriceImpact(adjustments),
    onSuccess: (res) => {
      setResult(res);
    },
  });

  const handleRunSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    const valid: PriceAdjustmentInput[] = [];
    for (const r of rows) {
      if (r.master_item_id === null) continue;
      const numVal = Number(r.value);
      if (Number.isNaN(numVal)) {
        setValidationError("Nilai perubahan harga harus berupa angka yang valid.");
        return;
      }
      if (r.mode === "new_price" && numVal < 0) {
        setValidationError("Harga baru simulasi tidak boleh negatif.");
        return;
      }
      valid.push({
        master_item_id: r.master_item_id,
        mode: r.mode,
        value: numVal,
      });
    }
    if (valid.length === 0) {
      setValidationError("Pilih minimal satu Master Item bahan untuk disimulasikan.");
      return;
    }
    simMutation.mutate(valid);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValidationError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            <span>Simulasi Kenaikan Harga Bahan (What-If Simulator)</span>
          </DialogTitle>
          <DialogDescription>
            Uji dampak perubahan harga bahan baku terhadap seluruh sub-resep prepared, menu jual, dan paket bundling tanpa mengubah database asli.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleRunSimulation} className="space-y-4">
          {validationError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {validationError}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Daftar Skenario Perubahan Harga Bahan
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((prev) => [...prev, createDraftRow()])}
                className="h-8 text-xs gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Bahan</span>
              </Button>
            </div>

            <div className="space-y-2">
              {rows.map((row) => {
                const selectedMaster =
                  row.master_item_id !== null
                    ? masterMap.get(row.master_item_id)
                    : undefined;
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5"
                  >
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Bahan Baku / Kemasan
                      </label>
                      <MasterItemCombobox
                        value={row.master_item_id}
                        onChange={(mid) => {
                          const m = mid ? masterMap.get(mid) : undefined;
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key
                                ? {
                                    ...r,
                                    master_item_id: mid,
                                    value:
                                      r.mode === "new_price" && m?.last_unit_price
                                        ? String(m.last_unit_price)
                                        : r.value,
                                  }
                                : r
                            )
                          );
                        }}
                        masterItems={masterItems}
                        placeholder="Pilih Master Item..."
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Mode Simulasi
                      </label>
                      <select
                        value={row.mode}
                        onChange={(e) => {
                          const nextMode = e.target.value as "pct" | "new_price";
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key
                                ? {
                                    ...r,
                                    mode: nextMode,
                                    value:
                                      nextMode === "new_price"
                                        ? String(selectedMaster?.last_unit_price || 0)
                                        : "15",
                                  }
                                : r
                            )
                          );
                        }}
                        className="h-8 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="pct">Perubahan Persen (%)</option>
                        <option value="new_price">Harga Baru (Rp)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {row.mode === "pct" ? "Persen (+/- %)" : "Harga Baru (Rp)"}
                      </label>
                      <Input
                        type="number"
                        step="any"
                        value={row.value}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key ? { ...r, value: e.target.value } : r
                            )
                          )
                        }
                        className="h-8 text-xs tabular-nums bg-white dark:bg-slate-950"
                      />
                    </div>

                    <div className="sm:col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rows.length <= 1}
                        onClick={() =>
                          setRows((prev) => prev.filter((r) => r.key !== row.key))
                        }
                        aria-label="Hapus baris simulasi"
                        className="h-8 w-8 p-0 text-slate-600 hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Simulasi menelusuri rantai sub-resep hingga menu jual dan paket hampers.
            </p>
            <Button
              type="submit"
              disabled={simMutation.isPending}
              className="h-9 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {simMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Menghitung Dampak...</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Simulasikan Dampak</span>
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Results Surface: Loading / Error / Empty / Data */}
        {simMutation.isPending ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Menghitung ulang seluruh resep dan margin terdampak...</span>
          </div>
        ) : simMutation.isError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Gagal menjalankan simulasi harga. Periksa kembali input dan koneksi server lalu coba lagi.
            </span>
          </div>
        ) : result ? (
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[11px] text-slate-600 dark:text-slate-400">Total Terdampak</div>
                <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {result.summary.total_affected} item
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[11px] text-slate-600 dark:text-slate-400">Sub-Resep Prepared</div>
                <div className="text-base font-bold tabular-nums text-amber-800 dark:text-amber-300">
                  {result.summary.affected_prepared_count} item
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[11px] text-slate-600 dark:text-slate-400">Menu &amp; Paket Jual</div>
                <div className="text-base font-bold tabular-nums text-blue-700 dark:text-blue-300">
                  {result.summary.affected_menu_count} item
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[11px] text-slate-600 dark:text-slate-400">Masuk Food Cost Tinggi</div>
                <div className="text-base font-bold tabular-nums text-rose-700 dark:text-rose-400">
                  {result.summary.newly_high_fc_count} menu
                </div>
              </div>
            </div>

            {result.affected_items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-600 dark:text-slate-400">
                Tidak ada menu atau sub-resep yang HPP-nya berubah dari skenario ini. Kemungkinan bahan belum dipakai di resep atau memakai harga override manual.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Menu / Sub-Resep</th>
                      <th className="text-right px-3 py-2 font-semibold">HPP Lama</th>
                      <th className="text-right px-3 py-2 font-semibold">HPP Simulasi</th>
                      <th className="text-right px-3 py-2 font-semibold">Selisih</th>
                      <th className="text-center px-3 py-2 font-semibold">Status Baru</th>
                      <th className="text-right px-3 py-2 font-semibold">Saran Harga Jual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {result.affected_items.map((it) => {
                      const st = getStatusBadge(it.new_status);
                      return (
                        <tr key={it.menu_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {it.name}
                            </div>
                            <div className="text-[10px] text-slate-600 dark:text-slate-400">
                              {it.item_type === "prepared"
                                ? "Prepared"
                                : it.item_type === "bundle"
                                ? "Bundling"
                                : "Menu Jual"}{" "}
                              | /{it.unit}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {formatRupiah(it.old_hpp)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {formatRupiah(it.new_hpp)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums font-semibold ${
                              it.delta_hpp > 0
                                ? "text-rose-700 dark:text-rose-400"
                                : "text-emerald-700 dark:text-emerald-400"
                            }`}
                          >
                            {it.delta_hpp > 0 ? "+" : ""}
                            {formatRupiah(it.delta_hpp)}
                            {it.delta_hpp_pct !== null ? (
                              <span className="block text-[10px] font-normal">
                                ({it.delta_hpp_pct > 0 ? "+" : ""}
                                {it.delta_hpp_pct}%)
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.is_sellable && it.selling_price > 0 ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span className="tabular-nums font-medium">
                                  {it.old_food_cost_pct}% &rarr; {it.new_food_cost_pct}%
                                </span>
                                <Badge variant="outline" className={`text-[10px] ${st.className}`}>
                                  {st.label}
                                </Badge>
                              </div>
                            ) : (
                              <Badge variant="outline" className={`text-[10px] ${st.className}`}>
                                {st.label}
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {it.suggested_selling_price ? (
                              <div>
                                <div className="font-semibold text-blue-700 dark:text-blue-300">
                                  {formatRupiah(it.suggested_selling_price)}
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-400">
                                  Saat ini: {formatRupiah(it.selling_price)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-600 dark:text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
