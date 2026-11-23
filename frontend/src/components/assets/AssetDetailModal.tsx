import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  getAssetDetail,
  updateAsset,
  disposeAsset,
  addAssetMaintenance,
} from "@/lib/api";
import { FixedAsset } from "@/types";
import { formatDateId, formatRupiah, toIsoDate } from "@/lib/formatters";
import { DataTable } from "@/components/common/DataTable";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef } from "@tanstack/react-table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Save,
  Wrench,
  QrCode,
  TrendingDown,
  Trash2,
  Printer,
  ExternalLink,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

interface AssetDetailModalProps {
  assetId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenPrintLabel: (assets: FixedAsset[]) => void;
  canManageAccounting: boolean;
}

export const AssetDetailModal: React.FC<AssetDetailModalProps> = ({
  assetId,
  isOpen,
  onClose,
  onOpenPrintLabel,
  canManageAccounting,
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("info");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["asset-detail", assetId],
    queryFn: () => getAssetDetail(assetId!),
    enabled: isOpen && assetId !== null,
  });

  const asset = data?.asset;

  // Edit form states
  const [name, setName] = useState("");
  const [assetGroup, setAssetGroup] = useState("Mesin & Peralatan Dapur");
  const [brandModel, setBrandModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [location, setLocation] = useState("");
  const [picName, setPicName] = useState("");
  const [condition, setCondition] = useState("Baik");
  const [statusVal, setStatusVal] = useState("Aktif");
  const [warrantyMonths, setWarrantyMonths] = useState(0);
  const [warrantyNotes, setWarrantyNotes] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState(48);
  const [salvageValue, setSalvageValue] = useState(0);
  const [capStatus, setCapStatus] = useState("capitalized");
  const [isCapOverridden, setIsCapOverridden] = useState(false);
  const [notes, setNotes] = useState("");

  // Maintenance form
  const [mDate, setMDate] = useState(new Date().toISOString().split("T")[0]);
  const [mType, setMType] = useState("Perbaikan");
  const [mVendor, setMVendor] = useState("");
  const [mCost, setMCost] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mNextDate, setMNextDate] = useState("");
  const [mCreateExpense, setMCreateExpense] = useState(true);

  // Dispose form
  const [showDispose, setShowDispose] = useState(false);
  const [dDate, setDDate] = useState(new Date().toISOString().split("T")[0]);
  const [dType, setDType] = useState("rusak");
  const [dProceeds, setDProceeds] = useState("0");
  const [dNotes, setDNotes] = useState("");

  useEffect(() => {
    if (asset) {
      setName(asset.name);
      setAssetGroup(asset.asset_group);
      setBrandModel(asset.brand_model || "");
      setSerialNumber(asset.serial_number || "");
      setLocation(asset.location || "Dapur Produksi");
      setPicName(asset.pic_name || "-");
      setCondition(asset.condition || "Baik");
      setStatusVal(asset.status || "Aktif");
      setWarrantyMonths(asset.warranty_months || 0);
      setWarrantyNotes(asset.warranty_notes || "");
      setUsefulLifeMonths(asset.useful_life_months || 48);
      setSalvageValue(asset.salvage_value || 0);
      setCapStatus(asset.capitalization_status || "capitalized");
      setIsCapOverridden(Boolean(asset.is_capitalization_overridden));
      setNotes(asset.notes || "");
    }
  }, [asset]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateAsset(asset!.id, {
        name,
        asset_group: assetGroup,
        brand_model: brandModel,
        serial_number: serialNumber,
        location,
        pic_name: picName,
        condition,
        status: statusVal,
        warranty_months: Number(warrantyMonths || 0),
        warranty_notes: warrantyNotes,
        useful_life_months: Number(usefulLifeMonths || 0),
        salvage_value: Number(salvageValue || 0),
        capitalization_status: capStatus,
        is_capitalization_overridden: isCapOverridden,
        notes,
      }),
    onSuccess: () => {
      toast.success("Data inventaris aset berhasil diperbarui.");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memperbarui data aset.");
    },
  });

  const maintMutation = useMutation({
    mutationFn: () =>
      addAssetMaintenance(asset!.id, {
        maintenance_date: mDate,
        maintenance_type: mType,
        vendor_name: mVendor.trim() || "-",
        cost: Number(mCost || 0),
        description: mDesc.trim() || mType,
        next_service_date: mNextDate || null,
        create_expense: mCreateExpense && Number(mCost || 0) > 0,
      }),
    onSuccess: () => {
      toast.success("Catatan maintenance berhasil ditambahkan.");
      setMDesc("");
      setMCost("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mencatat maintenance.");
    },
  });

  const disposeMutation = useMutation({
    mutationFn: () =>
      disposeAsset(asset!.id, {
        disposed_at: dDate,
        disposal_type: dType,
        disposal_proceeds: Number(dProceeds || 0),
        disposal_notes: dNotes,
      }),
    onSuccess: () => {
      toast.success("Pelepasan / penghapusan aset tercatat sesuai SAK EMKM.");
      setShowDispose(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mencatat pelepasan aset.");
    },
  });

  type DepRow = NonNullable<FixedAsset["depreciation_schedule"]>[number];
  const depreciationColumns = useMemo<ColumnDef<DataGridFeatures, DepRow>[]>(
    () => [
      {
        accessorKey: "period",
        id: "period",
        header: ({ column }) => <DataGridColumnHeader title="Bulan Ke" column={column} />,
        cell: ({ row }) => <span className="font-mono">{row.original.period}</span>,
        size: 85,
      },
      {
        accessorKey: "period_label",
        id: "period_label",
        header: () => <span>Periode</span>,
        cell: ({ row }) => <span>{row.original.period_label}</span>,
        size: 130,
      },
      {
        accessorKey: "depreciation_amount",
        id: "depreciation_amount",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Beban Susut"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums whitespace-nowrap">
            {formatRupiah(row.original.depreciation_amount)}
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: "accumulated_depreciation",
        id: "accumulated_depreciation",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Akumulasi"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-amber-800 whitespace-nowrap">
            {formatRupiah(row.original.accumulated_depreciation)}
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: "net_book_value",
        id: "net_book_value",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Nilai Buku"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-semibold whitespace-nowrap">
            {formatRupiah(row.original.net_book_value)}
          </div>
        ),
        size: 120,
      },
    ],
    []
  );

  const labelUrl =
    asset && typeof window !== "undefined"
      ? `${window.location.origin}/app/inventaris/label/${asset.qr_token}`
      : "";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base font-bold">
            <span>{asset ? asset.name : "Detail Aset Inventaris"}</span>
            {asset && (
              <Badge className="font-mono text-xs bg-slate-900 text-white hover:bg-slate-900">
                {asset.asset_code}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Informasi detail inventaris, garansi, penyusutan SAK EMKM, label QR, dan riwayat maintenance.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !asset ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            Memuat detail aset...
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid grid-cols-4 w-full h-9">
              <TabsTrigger value="info" className="text-xs">Identitas</TabsTrigger>
              <TabsTrigger value="accounting" className="text-xs">Penyusutan</TabsTrigger>
              <TabsTrigger value="maintenance" className="text-xs">
                Servis ({asset.maintenance_count})
              </TabsTrigger>
              <TabsTrigger value="label" className="text-xs">Label QR</TabsTrigger>
            </TabsList>

            {/* Tab 1: Identitas & Edit */}
            <TabsContent value="info" className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Nama Aset *</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-xs" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Kelompok Aset</label>
                  <select value={assetGroup} onChange={(e) => setAssetGroup(e.target.value)} className="w-full h-9 px-2.5 text-xs rounded-md border border-input bg-white">
                    <option value="Mesin & Peralatan Dapur">Mesin & Peralatan Dapur</option>
                    <option value="Pendingin & Showcase">Pendingin & Showcase</option>
                    <option value="Elektronik & POS">Elektronik & POS</option>
                    <option value="Furnitur & Rak">Furnitur & Rak</option>
                    <option value="Kendaraan Operasional">Kendaraan Operasional</option>
                    <option value="Perlengkapan Kecil">Perlengkapan Kecil</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Merk / Model</label>
                  <Input value={brandModel} onChange={(e) => setBrandModel(e.target.value)} placeholder="mis: Gea Expo 1200" className="h-9 text-xs" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Nomor Seri (SN)</label>
                  <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="SN-..." className="h-9 text-xs font-mono" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Lokasi Penempatan</label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} className="h-9 text-xs" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Penanggung Jawab (PIC)</label>
                  <Input value={picName} onChange={(e) => setPicName(e.target.value)} className="h-9 text-xs" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Kondisi Fisik</label>
                  <select value={condition} onChange={(e) => setCondition(e.target.value)} className="w-full h-9 px-2.5 text-xs rounded-md border border-input bg-white">
                    <option value="Baik">Baik</option>
                    <option value="Perlu Servis">Perlu Servis</option>
                    <option value="Rusak">Rusak</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Status Operasional</label>
                  <select value={statusVal} onChange={(e) => setStatusVal(e.target.value)} className="w-full h-9 px-2.5 text-xs rounded-md border border-input bg-white">
                    <option value="Aktif">Aktif</option>
                    <option value="Dalam Perbaikan">Dalam Perbaikan</option>
                    <option value="Disimpan">Disimpan</option>
                    <option value="Dihapuskan">Dihapuskan</option>
                    <option value="Dijual">Dijual</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Garansi (Bulan) — <span className="font-normal text-slate-500">{asset.warranty_status}</span>
                  </label>
                  <Input type="number" min={0} value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value || 0))} className="h-9 text-xs" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Catatan Garansi</label>
                  <Input value={warrantyNotes} onChange={(e) => setWarrantyNotes(e.target.value)} placeholder="Garansi resmi / toko..." className="h-9 text-xs" />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Catatan Tambahan</label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-xs" />
              </div>
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                  <Save className="w-3.5 h-3.5" />
                  {updateMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </div>
            </TabsContent>

            {/* Tab 2: Akuntansi & Penyusutan */}
            <TabsContent value="accounting" className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Harga Perolehan</span>
                  <strong className="text-sm text-slate-900 tabular-nums">{formatRupiah(asset.acquisition_cost || 0)}</strong>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Penyusutan / Bulan</span>
                  <strong className="text-sm text-slate-900 tabular-nums">{formatRupiah(asset.monthly_depreciation || 0)}</strong>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <span className="text-amber-800 block">Akum. Penyusutan</span>
                  <strong className="text-sm text-amber-900 tabular-nums">{formatRupiah(asset.accumulated_depreciation || 0)}</strong>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-emerald-800 block">Nilai Buku Bersih</span>
                  <strong className="text-sm text-emerald-900 tabular-nums">{formatRupiah(asset.net_book_value || 0)}</strong>
                </div>
              </div>

              {canManageAccounting && (
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <TrendingDown className="w-4 h-4 text-blue-600" />
                      Parameter Penyusutan SAK EMKM
                    </span>
                    <Badge variant="outline" className="text-[11px] bg-white">
                      TCO (Beli + Servis): {formatRupiah(asset.total_cost_of_ownership || 0)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Perlakuan Akuntansi</label>
                      <select
                        value={capStatus}
                        onChange={(e) => {
                          setCapStatus(e.target.value);
                          setIsCapOverridden(true);
                        }}
                        className="w-full h-9 px-2.5 text-xs rounded-md border border-input bg-white"
                      >
                        <option value="capitalized">Kapitalisasi Neraca (1-2100)</option>
                        <option value="expensed_low_value">Nilai Rendah / Beban Langsung (6-2200)</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Masa Manfaat (Bulan)</label>
                      <Input type="number" min={0} value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(Number(e.target.value || 0))} className="h-9 text-xs bg-white" />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Nilai Residu (Rp)</label>
                      <Input type="number" min={0} value={salvageValue} onChange={(e) => setSalvageValue(Number(e.target.value || 0))} className="h-9 text-xs bg-white" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={isCapOverridden} onChange={(e) => setIsCapOverridden(e.target.checked)} className="w-4 h-4 rounded" />
                    <span>Kunci perlakuan kapitalisasi (jangan ubah otomatis saat Analisa Ulang Aset)</span>
                  </label>
                  <div className="flex flex-wrap justify-between gap-2">
                    {!asset.disposed_at && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowDispose((v) => !v)} className="text-rose-700 border-rose-200 hover:bg-rose-50 gap-1.5">
                        <Trash2 className="w-3.5 h-3.5" />
                        Pelepasan / Penghapusan Aset
                      </Button>
                    )}
                    <Button type="button" size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white ml-auto">
                      <Save className="w-3.5 h-3.5" />
                      Simpan Parameter
                    </Button>
                  </div>
                </div>
              )}

              {showDispose && (
                <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/50 space-y-2.5">
                  <p className="font-bold text-rose-900">Catat Pelepasan / Penghapusan Aset</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Tanggal Pelepasan</label>
                      <DatePicker value={dDate} onChange={(d) => setDDate(toIsoDate(d))} className="w-full h-9 text-xs bg-white" />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Jenis Pelepasan</label>
                      <select value={dType} onChange={(e) => setDType(e.target.value)} className="w-full h-9 px-2.5 text-xs rounded-md border border-input bg-white">
                        <option value="rusak">Rusak Total (Write-off)</option>
                        <option value="hilang">Hilang</option>
                        <option value="dijual">Dijual</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Hasil Penjualan (Rp)</label>
                      <Input type="number" min={0} value={dProceeds} onChange={(e) => setDProceeds(e.target.value)} className="h-9 text-xs bg-white" />
                    </div>
                  </div>
                  <Input value={dNotes} onChange={(e) => setDNotes(e.target.value)} placeholder="Alasan / keterangan pelepasan aset..." className="h-9 text-xs bg-white" />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowDispose(false)}>Batal</Button>
                    <Button type="button" size="sm" disabled={disposeMutation.isPending} onClick={() => disposeMutation.mutate()} className="bg-rose-600 hover:bg-rose-700 text-white">
                      {disposeMutation.isPending ? "Memproses..." : "Konfirmasi Pelepasan"}
                    </Button>
                  </div>
                </div>
              )}

              {asset.depreciation_schedule && asset.depreciation_schedule.length > 0 && (
                <DataTable
                  columns={depreciationColumns}
                  data={asset.depreciation_schedule}
                  getRowId={(r) => String(r.period)}
                  defaultPageSize={10}
                  scrollAreaClassName="max-h-[260px]"
                  containerClassName="rounded-xl"
                  headerClassName="px-3 py-2 bg-slate-50"
                  header={
                    <div className="font-bold text-slate-800 text-xs">
                      Jadwal Penyusutan Bulanan ({asset.depreciation_schedule.length} Bulan)
                    </div>
                  }
                />
              )}
            </TabsContent>

            {/* Tab 3: Maintenance */}
            <TabsContent value="maintenance" className="space-y-3 text-xs">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  maintMutation.mutate();
                }}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5"
              >
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-600" />
                  Tambah Catatan Maintenance / Servis
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Tanggal</label>
                    <DatePicker value={mDate} onChange={(d) => setMDate(toIsoDate(d))} className="w-full h-9 text-xs bg-white" />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Jenis</label>
                    <select value={mType} onChange={(e) => setMType(e.target.value)} className="w-full h-9 px-2 text-xs rounded-md border border-input bg-white">
                      <option value="Servis Rutin">Servis Rutin</option>
                      <option value="Perbaikan">Perbaikan</option>
                      <option value="Ganti Sparepart">Ganti Sparepart</option>
                      <option value="Klaim Garansi">Klaim Garansi</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Teknisi / Vendor</label>
                    <Input value={mVendor} onChange={(e) => setMVendor(e.target.value)} placeholder="Nama teknisi" className="h-9 text-xs bg-white" />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Biaya (Rp)</label>
                    <Input type="number" min={0} value={mCost} onChange={(e) => setMCost(e.target.value)} placeholder="0" className="h-9 text-xs bg-white" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="Detail perbaikan / sparepart yang diganti *" className="h-9 text-xs bg-white" required />
                  <DatePicker value={mNextDate} onChange={(d) => setMNextDate(toIsoDate(d))} placeholder="Jadwal servis berikutnya" className="w-full h-9 text-xs bg-white" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                    <input type="checkbox" checked={mCreateExpense} onChange={(e) => setMCreateExpense(e.target.checked)} className="w-4 h-4 rounded" />
                    <span>Catat otomatis ke Pengeluaran Maintenance (6-2000)</span>
                  </label>
                  <Button type="submit" size="sm" disabled={maintMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    {maintMutation.isPending ? "Menyimpan..." : "Simpan Servis"}
                  </Button>
                </div>
              </form>

              {asset.maintenances.length === 0 ? (
                <div className="py-8 text-center text-slate-500">
                  Belum ada riwayat servis atau perawatan untuk aset ini.
                </div>
              ) : (
                <div className="space-y-2">
                  {asset.maintenances.map((mt) => (
                    <div key={mt.id} className="p-3 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{mt.maintenance_type}</Badge>
                          <span className="font-bold text-slate-900">{formatDateId(mt.maintenance_date)}</span>
                          <span className="text-slate-500">• {mt.vendor_name}</span>
                        </div>
                        <p className="text-slate-700">{mt.description}</p>
                        {mt.next_service_date && (
                          <p className="text-[11px] text-amber-700">Servis berikut: {formatDateId(mt.next_service_date)}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-slate-900 tabular-nums">{formatRupiah(mt.cost || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Tab 4: Label QR */}
            <TabsContent value="label" className="space-y-4 text-xs">
              <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="p-3 bg-white border-2 border-slate-800 rounded-xl shrink-0">
                  <QRCodeSVG value={labelUrl} size={128} level="M" />
                </div>
                <div className="space-y-2 text-center sm:text-left">
                  <div className="inline-flex items-center gap-1.5 text-blue-700 font-bold">
                    <QrCode className="w-4 h-4" />
                    <span>{asset.asset_code}</span>
                  </div>
                  <p className="font-bold text-sm text-slate-900">{asset.name}</p>
                  <p className="text-slate-600">
                    Tempelkan stiker QR ini pada unit fisik di <strong>{asset.location}</strong> untuk melihat spesifikasi, garansi, dan riwayat servis saat di-scan.
                  </p>
                  <div className="flex flex-wrap justify-center sm:justify-start gap-2 pt-1">
                    <Button type="button" size="sm" onClick={() => onOpenPrintLabel([asset])} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                      <Printer className="w-3.5 h-3.5" />
                      Cetak Label Stiker
                    </Button>
                    <a
                      href={labelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium"
                    >
                      Buka Halaman Scan
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
