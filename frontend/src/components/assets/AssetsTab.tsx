import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAssets,
  createAsset,
  syncExistingAssets,
  reanalyzeAssets,
} from "@/lib/api";
import { FixedAsset, AssetReanalyzeResult } from "@/types";
import { formatDateId, formatRupiah } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Boxes,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  TrendingDown,
  Wallet,
  Calculator,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AssetDetailModal } from "./AssetDetailModal";
import { AssetLabelPrintModal } from "./AssetLabelPrintModal";

interface AssetsTabProps {
  isOwner: boolean;
}

export const AssetsTab: React.FC<AssetsTabProps> = ({ isOwner }) => {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [capFilter, setCapFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);
  const [printAssets, setPrintAssets] = useState<FixedAsset[] | null>(null);

  // Analisa Ulang Modal
  const [isReanalyzeOpen, setIsReanalyzeOpen] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");
  const [lifeInput, setLifeInput] = useState("");
  const [lastReanalyzeResult, setLastReanalyzeResult] = useState<AssetReanalyzeResult | null>(null);

  // Add Manual Asset Modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState("Mesin & Peralatan Dapur");
  const [newCost, setNewCost] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newLocation, setNewLocation] = useState("Dapur Produksi");
  const [newVendor, setNewVendor] = useState("");
  const [newWarranty, setNewWarranty] = useState("12");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets", search, statusFilter, capFilter, groupFilter],
    queryFn: () =>
      getAssets({
        search: search || undefined,
        status: statusFilter,
        capitalization_status: capFilter,
        asset_group: groupFilter,
      }),
  });

  const assets = useMemo(() => data?.items || [], [data]);
  const summary = data?.summary;
  const activeThreshold = data?.config?.asset_capitalization_threshold ?? 500000;
  const activeDefaultLife = data?.config?.asset_default_useful_life_months ?? 48;

  const syncMutation = useMutation({
    mutationFn: () => syncExistingAssets(),
    onSuccess: (res) => {
      toast.success(res.message);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal sinkronisasi data Asset.");
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: () =>
      reanalyzeAssets({
        asset_capitalization_threshold: thresholdInput ? Number(thresholdInput) : undefined,
        asset_default_useful_life_months: lifeInput ? Number(lifeInput) : undefined,
      }),
    onSuccess: (res) => {
      setLastReanalyzeResult(res);
      toast.success(res.message);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menganalisa ulang aset.");
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createAsset({
        name: newName.trim(),
        asset_group: newGroup,
        acquisition_cost: Number(newCost || 0),
        purchase_date: newDate,
        location: newLocation.trim() || "Dapur Produksi",
        vendor_name: newVendor.trim() || "-",
        warranty_months: Number(newWarranty || 0),
      }),
    onSuccess: () => {
      toast.success("Aset inventaris berhasil ditambahkan.");
      setIsAddOpen(false);
      setNewName("");
      setNewCost("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menambah aset.");
    },
  });

  const openReanalyzeDialog = () => {
    setThresholdInput(String(activeThreshold));
    setLifeInput(String(activeDefaultLife));
    setLastReanalyzeResult(null);
    setIsReanalyzeOpen(true);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === assets.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(assets.map((a) => a.id));
    }
  };

  const handleOpenBatchPrint = () => {
    const targets =
      selectedIds.length > 0
        ? assets.filter((a) => selectedIds.includes(a.id))
        : assets;
    setPrintAssets(targets);
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-blue-600" />
            Inventaris Aset Tetap &amp; Penyusutan (SAK EMKM)
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Pengeluaran kategori <strong>Asset</strong> otomatis masuk inventaris. Batas kapitalisasi aktif:{" "}
            <strong className="text-slate-900">{formatRupiah(activeThreshold)}</strong>/unit ({activeDefaultLife} bln).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openReanalyzeDialog}
                className="h-9 rounded-xl text-xs font-semibold gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <Calculator className="w-3.5 h-3.5" />
                Analisa Ulang Aset
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="h-9 rounded-xl text-xs font-semibold gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                Sinkron Data Asset
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenBatchPrint}
            disabled={assets.length === 0}
            className="h-9 rounded-xl text-xs font-semibold gap-1.5"
          >
            <QrCode className="w-3.5 h-3.5" />
            Cetak Label QR {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="h-9 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Tambah Aset
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Total Unit Inventaris</span>
              <Boxes className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xl font-bold text-slate-900 tabular-nums">
              {summary?.active_assets ?? 0} <span className="text-xs font-normal text-slate-500">unit aktif</span>
            </p>
            <p className="text-[11px] text-slate-600">
              {summary?.capitalized_count ?? 0} dikapitalisasi • {summary?.low_value_count ?? 0} nilai rendah
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Harga Perolehan (1-2100)</span>
              <Wallet className="w-4 h-4 text-slate-700" />
            </div>
            <p className="text-xl font-bold text-slate-900 tabular-nums">
              {formatRupiah(summary?.total_acquisition_cost ?? 0)}
            </p>
            <p className="text-[11px] text-slate-600">
              Aset tetap aktif di Neraca
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Akum. Penyusutan (1-2190)</span>
              <TrendingDown className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-xl font-bold text-amber-800 tabular-nums">
              {formatRupiah(summary?.total_accumulated_depreciation ?? 0)}
            </p>
            <p className="text-[11px] text-slate-600 tabular-nums">
              Beban susut bulan ini: {formatRupiah(summary?.monthly_depreciation_total ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/40 shadow-xs">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between text-xs text-emerald-800 font-medium">
              <span>Nilai Buku Bersih (NBV)</span>
              <ShieldAlert className="w-4 h-4 text-emerald-700" />
            </div>
            <p className="text-xl font-bold text-emerald-900 tabular-nums">
              {formatRupiah(summary?.total_net_book_value ?? 0)}
            </p>
            <p className="text-[11px] text-slate-700">
              {summary?.warranty_expiring_count ?? 0} garansi segera habis • {summary?.upcoming_service_count ?? 0} perlu servis
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <div className="p-3.5 border-b border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode aset, nama, seri, vendor, lokasi..."
              className="pl-9 h-9 text-xs rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={capFilter}
              onChange={(e) => setCapFilter(e.target.value)}
              className="h-9 px-3 text-xs rounded-xl border border-slate-200 bg-white font-medium text-slate-700"
            >
              <option value="all">Semua Kapitalisasi</option>
              <option value="capitalized">Dikapitalisasi (Disusutkan)</option>
              <option value="expensed_low_value">Nilai Rendah (Langsung Beban)</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 text-xs rounded-xl border border-slate-200 bg-white font-medium text-slate-700"
            >
              <option value="all">Semua Status</option>
              <option value="Aktif">Aktif</option>
              <option value="Dalam Perbaikan">Dalam Perbaikan</option>
              <option value="Disimpan">Disimpan</option>
              <option value="Dihapuskan">Dihapuskan</option>
              <option value="Dijual">Dijual</option>
            </select>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="h-9 px-3 text-xs rounded-xl border border-slate-200 bg-white font-medium text-slate-700"
            >
              <option value="all">Semua Kelompok</option>
              <option value="Mesin & Peralatan Dapur">Mesin & Peralatan Dapur</option>
              <option value="Pendingin & Showcase">Pendingin & Showcase</option>
              <option value="Elektronik & POS">Elektronik & POS</option>
              <option value="Furnitur & Rak">Furnitur & Rak</option>
              <option value="Kendaraan Operasional">Kendaraan Operasional</option>
              <option value="Perlengkapan Kecil">Perlengkapan Kecil</option>
            </select>
          </div>
        </div>

        {/* Content States: Loading / Error / Empty / Table */}
        {isLoading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            Memuat inventaris aset...
          </div>
        ) : isError ? (
          <div className="py-12 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
            <p className="text-xs font-semibold text-slate-800">Gagal memuat data inventaris.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Coba Lagi
            </Button>
          </div>
        ) : assets.length === 0 ? (
          <div className="py-12 text-center space-y-2 text-xs text-slate-500">
            <Boxes className="w-9 h-9 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-700">Belum ada data aset di inventaris.</p>
            <p>Catat pengeluaran berkategori <strong>Asset</strong> atau klik <strong>Sinkron Data Asset</strong> untuk memigrasi transaksi lama.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 w-9">
                      <input
                        type="checkbox"
                        checked={selectedIds.length > 0 && selectedIds.length === assets.length}
                        onChange={toggleSelectAll}
                        aria-label="Pilih semua aset"
                        className="w-4 h-4 rounded"
                      />
                    </th>
                    <th className="py-2.5 px-3 font-semibold">Kode &amp; Nama Aset</th>
                    <th className="py-2.5 px-3 font-semibold">Lokasi &amp; Status</th>
                    <th className="py-2.5 px-3 font-semibold">Garansi &amp; Servis</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Perolehan</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Akum. Susut</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Nilai Buku</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assets.map((ast) => (
                    <tr
                      key={ast.id}
                      onClick={() => setDetailAssetId(ast.id)}
                      className="hover:bg-slate-50/90 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(ast.id)}
                          onChange={() => toggleSelect(ast.id)}
                          aria-label={`Pilih ${ast.asset_code}`}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-slate-900">{ast.asset_code}</span>
                          {ast.capitalization_status === "expensed_low_value" ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-600">
                              Nilai Rendah
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-200 bg-blue-50 text-blue-700">
                              Aset Tetap
                            </Badge>
                          )}
                        </div>
                        <p className="font-semibold text-slate-900 mt-0.5">{ast.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {ast.asset_group} • Beli {formatDateId(ast.purchase_date)}
                        </p>
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-slate-800">{ast.location}</p>
                        <Badge
                          variant="outline"
                          className={`mt-1 text-[10px] ${
                            ast.status === "Aktif"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : ast.status === "Dalam Perbaikan"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-rose-200 bg-rose-50 text-rose-800"
                          }`}
                        >
                          {ast.status} • {ast.condition}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="text-slate-800 font-medium">{ast.warranty_status}</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Wrench className="w-3 h-3" />
                          {ast.maintenance_count} servis
                        </p>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900">
                        {formatRupiah(ast.acquisition_cost || 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-amber-800">
                        {formatRupiah(ast.accumulated_depreciation || 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-800">
                        {formatRupiah(ast.net_book_value || 0)}
                      </td>
                      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPrintAssets([ast])}
                          className="h-8 px-2 text-xs gap-1"
                          title="Cetak Label QR"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {assets.map((ast) => (
                <div
                  key={ast.id}
                  onClick={() => setDetailAssetId(ast.id)}
                  className="p-3.5 space-y-2 active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-bold text-blue-700">{ast.asset_code}</span>
                      <p className="text-sm font-bold text-slate-900 truncate">{ast.name}</p>
                      <p className="text-[11px] text-slate-500">{ast.location} • {ast.status}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrintAssets([ast]);
                      }}
                      className="h-9 px-2.5 shrink-0"
                    >
                      <QrCode className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-slate-600">Perolehan: <strong className="text-slate-900">{formatRupiah(ast.acquisition_cost || 0)}</strong></span>
                    <span className="text-emerald-800 font-bold">NBV: {formatRupiah(ast.net_book_value || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Modal Analisa Ulang Aset */}
      <Dialog open={isReanalyzeOpen} onOpenChange={setIsReanalyzeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-600" />
              Analisa Ulang Aset Tetap
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ubah batas minimal harga kapitalisasi aset lalu evaluasi ulang seluruh data inventaris (kecuali aset yang dikunci manual).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Minimal Harga Kapitalisasi (Rp)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Masa Manfaat Default (Bulan)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={lifeInput}
                  onChange={(e) => setLifeInput(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {lastReanalyzeResult && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1">
                <p className="font-bold">{lastReanalyzeResult.message}</p>
                <p className="text-[11px]">
                  Total Aset Tetap Neraca (1-2100):{" "}
                  <strong>{formatRupiah(lastReanalyzeResult.capitalized_total_before)}</strong> &rarr;{" "}
                  <strong>{formatRupiah(lastReanalyzeResult.capitalized_total_after)}</strong>
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsReanalyzeOpen(false)}>
              Tutup
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={reanalyzeMutation.isPending}
              onClick={() => reanalyzeMutation.mutate()}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reanalyzeMutation.isPending ? "animate-spin" : ""}`} />
              {reanalyzeMutation.isPending ? "Menganalisa..." : "Simpan & Analisa Ulang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Tambah Aset Manual */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Tambah Aset Inventaris</DialogTitle>
            <DialogDescription className="text-xs">
              Daftarkan aset fisik yang sudah dimiliki sebelumnya ke buku inventaris &amp; label QR.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Nama Aset *</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="mis: Oven Deck 2 Loyang" required className="h-9 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Kelompok</label>
                <select value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className="w-full h-9 px-2 text-xs rounded-md border border-input bg-white">
                  <option value="Mesin & Peralatan Dapur">Mesin & Peralatan Dapur</option>
                  <option value="Pendingin & Showcase">Pendingin & Showcase</option>
                  <option value="Elektronik & POS">Elektronik & POS</option>
                  <option value="Furnitur & Rak">Furnitur & Rak</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tanggal Perolehan</label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Harga Perolehan (Rp) *</label>
                <Input type="number" min={0} value={newCost} onChange={(e) => setNewCost(e.target.value)} required className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Garansi (Bulan)</label>
                <Input type="number" min={0} value={newWarranty} onChange={(e) => setNewWarranty(e.target.value)} className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Lokasi</label>
                <Input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Vendor / Toko</label>
                <Input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>Batal</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {createMutation.isPending ? "Menyimpan..." : "Simpan Aset"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modals Detail & Cetak QR */}
      <AssetDetailModal
        assetId={detailAssetId}
        isOpen={detailAssetId !== null}
        onClose={() => setDetailAssetId(null)}
        onOpenPrintLabel={(list) => setPrintAssets(list)}
        canManageAccounting={isOwner}
      />

      <AssetLabelPrintModal
        isOpen={printAssets !== null}
        onClose={() => setPrintAssets(null)}
        assets={printAssets || []}
      />
    </div>
  );
};
