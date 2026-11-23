import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { PurchaseRequestItem } from "@/types";
import { usePurchaseRequestWorkflow } from "@/components/requests/usePurchaseRequestWorkflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { toIsoDate } from "@/lib/formatters";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PackageCheck,
  Search,
  Store,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";

interface WarehouseReceivingPageProps {
  currentUser?: string;
}

export const WarehouseReceivingPage: React.FC<WarehouseReceivingPageProps> = ({
  currentUser = "",
}) => {
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [warehouseStatusFilter, setWarehouseStatusFilter] = useState<"ALL" | "PENDING" | "RECEIVED">("PENDING");

  // Receive modal state
  const [receiveDialogItem, setReceiveDialogItem] = useState<PurchaseRequestItem | null>(null);
  const [receiveQty, setReceiveQty] = useState<number>(0);
  const [receiveExpDate, setReceiveExpDate] = useState<string>("");
  const [receiveInspector, setReceiveInspector] = useState<string>(currentUser || "Staf Gudang");
  const [receiveNotes, setReceiveNotes] = useState<string>("");

  const {
    queryClient,
    warehouseItems,
    isLoadingWarehouse,
    isErrorWarehouse,
    receiveItemMutation,
  } = usePurchaseRequestWorkflow({
    enableWarehouse: true,
    warehouseSearch,
  });

  const summary = useMemo(() => {
    let pending = 0;
    let received = 0;
    let variance = 0;
    let missingExp = 0;

    for (const it of warehouseItems) {
      if (it.receiving_status === "PENDING") {
        pending += 1;
      } else {
        received += 1;
        if (it.receiving_status === "KURANG" || it.receiving_status === "LEBIH") {
          variance += 1;
        }
        if (!it.expired_date) {
          missingExp += 1;
        }
      }
    }

    return { pending, received, variance, missingExp };
  }, [warehouseItems]);

  const filteredItems = useMemo(() => {
    return warehouseItems.filter((item) => {
      if (warehouseStatusFilter === "PENDING") return item.receiving_status === "PENDING";
      if (warehouseStatusFilter === "RECEIVED") return item.receiving_status !== "PENDING";
      return true;
    });
  }, [warehouseItems, warehouseStatusFilter]);

  const handleOpenReceiveDialog = (item: PurchaseRequestItem) => {
    setReceiveDialogItem(item);
    setReceiveQty(item.qty_received ?? item.qty);
    setReceiveExpDate(item.expired_date || "");
    setReceiveInspector(currentUser || "Staf Gudang");
    setReceiveNotes(item.receiving_notes === "-" ? "" : item.receiving_notes || "");
  };

  const handleSubmitReceive = () => {
    if (!receiveDialogItem) return;
    if (receiveQty <= 0) {
      toast.error("Jumlah diterima harus lebih dari 0.");
      return;
    }
    receiveItemMutation.mutate(
      {
        itemId: receiveDialogItem.id,
        data: {
          qty_received: receiveQty,
          expired_date: receiveExpDate || undefined,
          received_by: receiveInspector.trim() || "Staf Gudang",
          receiving_notes: receiveNotes.trim() || "-",
        },
      },
      {
        onSuccess: () => setReceiveDialogItem(null),
      }
    );
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-16">
      {/* Action Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {filteredItems.length} Item Kedatangan
          </Badge>
          <span className="text-xs text-zinc-500">
            Pemeriksaan fisik barang &amp; tanggal kadaluarsa
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["warehouse-incoming"] })}
          className="h-9 px-3.5 text-xs font-semibold rounded-xl border-zinc-200 dark:border-zinc-800"
        >
          Refresh Daftar
        </Button>
      </div>

      {/* Ringkasan Penerimaan */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          onClick={() => setWarehouseStatusFilter("PENDING")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            warehouseStatusFilter === "PENDING"
              ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Menunggu Fisik
            </span>
            <Clock className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
              {summary.pending}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">item</span>
          </div>
        </Card>

        <Card
          onClick={() => setWarehouseStatusFilter("RECEIVED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            warehouseStatusFilter === "RECEIVED"
              ? "border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Sudah Diperiksa
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {summary.received}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">item</span>
          </div>
        </Card>

        <Card className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Selisih Qty
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-amber-800 dark:text-amber-300 tabular-nums">
              {summary.variance}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">
              kurang/lebih
            </span>
          </div>
        </Card>

        <Card className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Tanpa Exp Date
            </span>
            <Calendar className="w-4 h-4 text-purple-700 dark:text-purple-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {summary.missingExp}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">item</span>
          </div>
        </Card>
      </div>

      {/* Filter & Pencarian */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: "PENDING", label: "Menunggu Pemeriksaan" },
            { id: "RECEIVED", label: "Sudah Diperiksa" },
            { id: "ALL", label: "Semua Kedatangan" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setWarehouseStatusFilter(f.id as any)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                warehouseStatusFilter === f.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            value={warehouseSearch}
            onChange={(e) => setWarehouseSearch(e.target.value)}
            placeholder="Cari barang atau supplier..."
            className="pl-8 h-10 sm:h-9 text-xs bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg"
          />
        </div>
      </div>

      {/* Daftar Barang Kedatangan */}
      {isLoadingWarehouse ? (
        <div className="py-16 text-center text-zinc-600 dark:text-zinc-400 text-xs">
          Memuat daftar kedatangan barang...
        </div>
      ) : isErrorWarehouse ? (
        <div
          role="alert"
          className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Gagal memuat data kedatangan gudang. Coba klik Refresh Daftar.</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-14 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 flex items-center justify-center mx-auto">
            <PackageCheck className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Tidak Ada Barang untuk Diperiksa
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">
            {warehouseStatusFilter === "PENDING"
              ? "Semua pesanan yang datang sudah diperiksa, atau Purchasing belum menandai pesanan berstatus ORDERED."
              : "Belum ada data penerimaan barang yang cocok dengan pencarian."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredItems.map((item) => {
            const isChecked = item.receiving_status !== "PENDING";
            const isSesuai = item.receiving_status === "SESUAI";
            const isKurang = item.receiving_status === "KURANG";
            const isLebih = item.receiving_status === "LEBIH";

            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border bg-white dark:bg-zinc-900 shadow-sm space-y-3 ${
                  !isChecked
                    ? "border-blue-200 dark:border-blue-900/50"
                    : isKurang
                    ? "border-amber-200 dark:border-amber-900/50"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {item.item_name}
                      </h4>
                      <Badge variant="outline" className="text-xs font-semibold">
                        Dipesan: {item.qty} {item.unit}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                      <Store className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
                      <span>Supplier: {item.supplier_name || "-"}</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {!isChecked ? (
                      <Badge
                        variant="outline"
                        className="text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-800 text-[10px]"
                      >
                        Menunggu Fisik
                      </Badge>
                    ) : isSesuai ? (
                      <Badge className="bg-emerald-700 text-white text-[10px]">
                        Sesuai ({item.qty_received} {item.unit})
                      </Badge>
                    ) : isKurang ? (
                      <Badge className="bg-amber-700 text-white text-[10px]">
                        Kurang ({item.qty_received} {item.unit})
                      </Badge>
                    ) : isLebih ? (
                      <Badge className="bg-blue-700 text-white text-[10px]">
                        Lebih ({item.qty_received} {item.unit})
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-100 dark:border-zinc-800 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Tanggal Expired:</span>
                    {item.expired_date ? (
                      <span className="font-bold text-purple-700 dark:text-purple-300 inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                        {item.expired_date}
                      </span>
                    ) : (
                      <span className="text-zinc-500 italic">Belum diinput</span>
                    )}
                  </div>

                  {isChecked && (
                    <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                      <span>Diperiksa: {item.received_by || "Gudang"}</span>
                      {item.received_at && (
                        <span>{new Date(item.received_at).toLocaleDateString("id-ID")}</span>
                      )}
                    </div>
                  )}

                  {item.receiving_notes && item.receiving_notes !== "-" && (
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400 pt-1">
                      Catatan: {item.receiving_notes}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleOpenReceiveDialog(item)}
                    className={`h-10 sm:h-9 px-3.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 ${
                      !isChecked
                        ? "bg-blue-700 hover:bg-blue-800 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                    }`}
                  >
                    <PackageCheck className="w-3.5 h-3.5" />
                    {isChecked ? "Perbarui Pemeriksaan" : "Periksa & Terima Barang"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Pemeriksaan Fisik & Exp Date */}
      <Dialog open={!!receiveDialogItem} onOpenChange={(open) => !open && setReceiveDialogItem(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-blue-700 dark:text-blue-400" /> Pemeriksaan Fisik Barang
            </DialogTitle>
          </DialogHeader>

          {receiveDialogItem && (
            <div className="py-2 space-y-4">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100">
                    {receiveDialogItem.item_name}
                  </span>
                  <Badge variant="outline" className="font-semibold text-blue-700 border-blue-200 dark:text-blue-300">
                    Dipesan: {receiveDialogItem.qty} {receiveDialogItem.unit}
                  </Badge>
                </div>
                <div className="text-zinc-600 dark:text-zinc-400 text-[11px]">
                  Supplier: {receiveDialogItem.supplier_name || "-"}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Jumlah Diterima ({receiveDialogItem.unit})
                  </label>
                  {receiveQty > 0 && (
                    <div>
                      {receiveQty === receiveDialogItem.qty && (
                        <Badge className="bg-emerald-700 text-white text-[10px]">
                          Sesuai ({receiveQty} {receiveDialogItem.unit})
                        </Badge>
                      )}
                      {receiveQty < receiveDialogItem.qty && (
                        <Badge className="bg-amber-700 text-white text-[10px]">
                          Kurang (-{Number((receiveDialogItem.qty - receiveQty).toFixed(2))} {receiveDialogItem.unit})
                        </Badge>
                      )}
                      {receiveQty > receiveDialogItem.qty && (
                        <Badge className="bg-blue-700 text-white text-[10px]">
                          Lebih (+{Number((receiveQty - receiveDialogItem.qty).toFixed(2))} {receiveDialogItem.unit})
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={receiveQty || ""}
                    onChange={(e) => setReceiveQty(Number(e.target.value))}
                    placeholder="Masukkan jumlah fisik tiba"
                    className="text-xs h-10 font-bold tabular-nums"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReceiveQty(receiveDialogItem.qty)}
                    className="h-10 text-xs px-3 font-semibold text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950 shrink-0"
                  >
                    Pas ({receiveDialogItem.qty})
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" />
                  Tanggal Kedaluwarsa (Exp Date)
                </label>
                <DatePicker
                  value={receiveExpDate}
                  onChange={(d) => setReceiveExpDate(toIsoDate(d))}
                  placeholder="Pilih tanggal kedaluwarsa..."
                  className="w-full text-xs h-10"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Nama Petugas Gudang
                </label>
                <Input
                  value={receiveInspector}
                  onChange={(e) => setReceiveInspector(e.target.value)}
                  placeholder="Misal: Budi / Staf Gudang"
                  className="text-xs h-10 sm:h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Catatan Kondisi Fisik
                </label>
                <Input
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  placeholder="Misal: Kemasan rapi, segel utuh..."
                  className="text-xs h-10 sm:h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReceiveDialogItem(null)}
              className="h-10 sm:h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSubmitReceive}
              disabled={receiveItemMutation.isPending}
              className="h-10 sm:h-9 px-4 text-xs bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-xl"
            >
              {receiveItemMutation.isPending ? "Menyimpan..." : "Simpan Pemeriksaan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
