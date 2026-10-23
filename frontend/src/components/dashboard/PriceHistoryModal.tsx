import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ItemPriceHistoryResponse } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Award, Store, TrendingDown, History, Package } from "lucide-react";

interface PriceHistoryModalProps {
  itemName: string | null;
  onClose: () => void;
}

export const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({
  itemName,
  onClose,
}) => {
  const { data, isLoading } = useQuery<ItemPriceHistoryResponse>({
    queryKey: ["price-history", itemName],
    queryFn: async () => {
      const res = await api.get(
        `/expenses/price-history?item_name=${encodeURIComponent(itemName || "")}`
      );
      return res.data;
    },
    enabled: !!itemName,
  });

  return (
    <Dialog open={!!itemName} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <span>Riwayat Harga & Perbandingan Toko: {data?.item_name || itemName}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Memuat riwayat harga & perbandingan toko...
          </div>
        ) : !data || data.tx_count === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Belum ada riwayat transaksi untuk barang ini.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/80">
                <div className="text-[10px] font-semibold text-emerald-700 uppercase">
                  Harga Termurah
                </div>
                <div className="text-sm font-bold text-emerald-800 mt-0.5 tabular-nums">
                  {formatRupiah(data.min_price)}
                </div>
                <div className="text-[10px] text-emerald-600 truncate mt-0.5">
                  di {data.cheapest_supplier}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200/80">
                <div className="text-[10px] font-semibold text-blue-700 uppercase">
                  Harga Rata-rata
                </div>
                <div className="text-sm font-bold text-blue-800 mt-0.5 tabular-nums">
                  {formatRupiah(data.avg_price)}
                </div>
                <div className="text-[10px] text-blue-600 mt-0.5">
                  dari {data.tx_count} pembelian
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-100/80 border border-slate-200">
                <div className="text-[10px] font-semibold text-slate-600 uppercase">
                  Harga Terakhir
                </div>
                <div className="text-sm font-bold text-slate-800 mt-0.5 tabular-nums">
                  {formatRupiah(data.latest_price)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Tertinggi: {formatRupiah(data.max_price)}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80">
                <div className="text-[10px] font-semibold text-amber-700 uppercase">
                  Rekomendasi Toko
                </div>
                <div className="text-xs font-bold text-amber-900 mt-1 truncate">
                  {data.cheapest_supplier}
                </div>
                <div className="text-[10px] text-amber-600 mt-0.5">
                  Paling hemat
                </div>
              </div>
            </div>

            {/* Perbandingan Antar Toko */}
            {data.suppliers_comparison.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-blue-600" />
                  Perbandingan Harga Satuan Antar Toko / Supplier
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.suppliers_comparison.map((s, idx) => (
                    <div
                      key={s.supplier}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                        idx === 0
                          ? "bg-emerald-50/40 border-emerald-200"
                          : "bg-white border-slate-200/80"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {s.supplier}
                          </span>
                          {idx === 0 && (
                            <Badge className="bg-emerald-600 text-white text-[9px] px-1.5 py-0 gap-0.5">
                              <Award className="w-2.5 h-2.5" />
                              Termurah
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {s.tx_count}x transaksi • Terakhir {formatDateId(s.last_date)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-slate-900 tabular-nums">
                          {formatRupiah(s.min_price)}
                        </div>
                        {s.max_price > s.min_price && (
                          <div className="text-[10px] text-slate-400 tabular-nums">
                            s/d {formatRupiah(s.max_price)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Riwayat Transaksi Terakhir */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-500" />
                Riwayat Pembelian Terakhir ({data.history.length} transaksi)
              </h4>
              <div className="border border-slate-200/80 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-100 text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Tanggal</th>
                      <th className="py-2.5 px-3">Toko / Supplier</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Harga Satuan</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.history.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 whitespace-nowrap text-slate-600">
                          {formatDateId(h.expense_date)}
                        </td>
                        <td className="py-2 px-3 text-slate-700 font-medium truncate max-w-[160px]">
                          {h.supplier}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                          {h.qty} {h.unit || "Pcs"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-900">
                          {formatRupiah(h.unit_price)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600">
                          {formatRupiah(h.total_price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
