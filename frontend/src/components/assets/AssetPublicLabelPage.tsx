import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAssetByQrToken, addAssetMaintenance } from "@/lib/api";
import { formatDateId, formatRupiah, toIsoDate } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Wrench,
  ShieldCheck,
  MapPin,
  Calendar,
  AlertCircle,
  Loader2,
  ArrowLeft,
  UserCheck,
  Package,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

interface AssetPublicLabelPageProps {
  qrToken: string;
  isAuthenticated: boolean;
  onBackToDashboard?: () => void;
}

export const AssetPublicLabelPage: React.FC<AssetPublicLabelPageProps> = ({
  qrToken,
  isAuthenticated,
  onBackToDashboard,
}) => {
  const queryClient = useQueryClient();
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [mDate, setMDate] = useState(new Date().toISOString().split("T")[0]);
  const [mType, setMType] = useState("Servis Rutin");
  const [mVendor, setMVendor] = useState("");
  const [mCost, setMCost] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mNextDate, setMNextDate] = useState("");
  const [mCreateExpense, setMCreateExpense] = useState(true);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["asset-qr-label", qrToken],
    queryFn: () => getAssetByQrToken(qrToken),
    retry: 1,
  });

  const maintMutation = useMutation({
    mutationFn: () => {
      if (!data?.asset) throw new Error("Aset tidak ditemukan");
      return addAssetMaintenance(data.asset.id, {
        maintenance_date: mDate,
        maintenance_type: mType,
        vendor_name: mVendor.trim() || "-",
        cost: Number(mCost || 0),
        description: mDesc.trim() || mType,
        next_service_date: mNextDate || null,
        create_expense: mCreateExpense && Number(mCost || 0) > 0,
      });
    },
    onSuccess: () => {
      toast.success("Catatan maintenance aset berhasil disimpan.");
      setShowMaintForm(false);
      setMDesc("");
      setMCost("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mencatat maintenance.");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
          <p className="text-sm font-medium">Memuat kartu identitas aset...</p>
        </div>
      </div>
    );
  }

  if (isError || !data?.asset) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-rose-200 bg-white">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-rose-600 mx-auto" />
            <h1 className="text-base font-bold text-slate-900">Label Aset Tidak Ditemukan</h1>
            <p className="text-xs text-slate-600">
              Kode QR tidak terdaftar atau aset telah dihapus dari sistem inventaris.
            </p>
            {onBackToDashboard && (
              <Button variant="outline" size="sm" onClick={onBackToDashboard}>
                Kembali ke Dashboard
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const asset = data.asset;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
              Historycake • Kartu Aset Inventaris
            </p>
            <h1 className="text-xl font-bold text-slate-900">{asset.name}</h1>
          </div>
          {onBackToDashboard && (
            <Button variant="outline" size="sm" onClick={onBackToDashboard} className="gap-1.5 text-xs">
              <ArrowLeft className="w-3.5 h-3.5" />
              Dashboard
            </Button>
          )}
        </div>

        {/* Kartu Identitas Utama */}
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="font-mono text-xs bg-slate-900 text-white hover:bg-slate-900">
                {asset.asset_code}
              </Badge>
              <Badge variant="outline" className="text-xs border-slate-300 text-slate-700">
                {asset.asset_group}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs ${
                  asset.status === "Aktif"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : asset.status === "Dalam Perbaikan"
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-rose-300 bg-rose-50 text-rose-800"
                }`}
              >
                Status: {asset.status}
              </Badge>
              <Badge variant="outline" className="text-xs border-slate-200 text-slate-700">
                Kondisi: {asset.condition}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                  <MapPin className="w-3.5 h-3.5" />
                  Lokasi Penempatan
                </div>
                <p className="font-bold text-slate-900 text-sm">{asset.location}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                  <UserCheck className="w-3.5 h-3.5" />
                  Penanggung Jawab (PIC)
                </div>
                <p className="font-bold text-slate-900 text-sm">{asset.pic_name || "-"}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                  <Package className="w-3.5 h-3.5" />
                  Merk / Seri / Vendor
                </div>
                <p className="font-semibold text-slate-900">
                  {asset.brand_model || "-"} {asset.serial_number ? `• SN: ${asset.serial_number}` : ""}
                </p>
                <p className="text-[11px] text-slate-600">Vendor: {asset.vendor_name || "-"}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Garansi & Tanggal Beli
                </div>
                <p className="font-bold text-slate-900">{asset.warranty_status}</p>
                <p className="text-[11px] text-slate-600">
                  Beli: {formatDateId(asset.purchase_date)}
                  {asset.warranty_expiry_date ? ` • s/d ${formatDateId(asset.warranty_expiry_date)}` : ""}
                </p>
              </div>
            </div>

            {asset.notes && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <span className="font-semibold text-slate-900">Catatan Aset:</span> {asset.notes}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ringkasan Akuntansi (khusus Admin login) */}
        {!asset.is_public_view && asset.acquisition_cost !== undefined && (
          <Card className="border-blue-200 bg-white shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-slate-900">
                Data Akuntansi Aset (SAK EMKM — Khusus Admin)
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block">Harga Perolehan</span>
                <strong className="text-slate-900 text-sm tabular-nums">
                  {formatRupiah(asset.acquisition_cost)}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block">Akum. Penyusutan</span>
                <strong className="text-amber-700 text-sm tabular-nums">
                  {formatRupiah(asset.accumulated_depreciation || 0)}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block">Nilai Buku Bersih</span>
                <strong className="text-emerald-700 text-sm tabular-nums">
                  {formatRupiah(asset.net_book_value || 0)}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block">Total Biaya Servis</span>
                <strong className="text-slate-900 text-sm tabular-nums">
                  {formatRupiah(asset.total_maintenance_cost || 0)}
                </strong>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Riwayat Maintenance & Jadwal Servis */}
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-blue-600" />
                Riwayat Maintenance & Servis ({asset.maintenance_count})
              </CardTitle>
              {asset.next_service_date && (
                <p className="text-[11px] text-amber-700 font-medium mt-0.5 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Jadwal servis berikutnya: {formatDateId(asset.next_service_date)}
                </p>
              )}
            </div>
            {isAuthenticated && (
              <Button
                type="button"
                size="sm"
                onClick={() => setShowMaintForm((v) => !v)}
                className="h-8 text-xs rounded-xl gap-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                Catat Servis
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {showMaintForm && isAuthenticated && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  maintMutation.mutate();
                }}
                className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/40 space-y-2.5 text-xs"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Tanggal Servis</label>
                    <DatePicker value={mDate} onChange={(d) => setMDate(toIsoDate(d))} className="w-full h-9 text-xs bg-white" />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Jenis Tindakan</label>
                    <select value={mType} onChange={(e) => setMType(e.target.value)} className="w-full h-9 px-2.5 text-xs rounded-lg border border-input bg-white">
                      <option value="Servis Rutin">Servis Rutin</option>
                      <option value="Perbaikan">Perbaikan</option>
                      <option value="Ganti Sparepart">Ganti Sparepart</option>
                      <option value="Klaim Garansi">Klaim Garansi</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Teknisi / Bengkel</label>
                    <Input value={mVendor} onChange={(e) => setMVendor(e.target.value)} placeholder="mis: Pak Budi Teknisi" className="h-9 text-xs bg-white" />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Biaya (Rp)</label>
                    <Input type="number" min={0} value={mCost} onChange={(e) => setMCost(e.target.value)} placeholder="0 jika klaim garansi" className="h-9 text-xs bg-white" />
                  </div>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Deskripsi Pekerjaan *</label>
                  <Textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} rows={2} placeholder="Detail servis / part yang diganti..." className="text-xs bg-white" required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Jadwal Servis Berikutnya</label>
                    <DatePicker value={mNextDate} onChange={(d) => setMNextDate(toIsoDate(d))} placeholder="Opsional" className="w-full h-9 text-xs bg-white" />
                  </div>
                  <label className="flex items-center gap-2 h-9 px-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer">
                    <input type="checkbox" checked={mCreateExpense} onChange={(e) => setMCreateExpense(e.target.checked)} className="w-4 h-4 rounded" />
                    <span>Catat ke Pengeluaran (Maintenance 6-2000)</span>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowMaintForm(false)}>Batal</Button>
                  <Button type="submit" size="sm" disabled={maintMutation.isPending}>
                    {maintMutation.isPending ? "Menyimpan..." : "Simpan Log Servis"}
                  </Button>
                </div>
              </form>
            )}

            {asset.maintenances.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Belum ada riwayat maintenance untuk aset ini.
              </p>
            ) : (
              <div className="space-y-2.5">
                {asset.maintenances.map((mt) => (
                  <div key={mt.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] bg-white">{mt.maintenance_type}</Badge>
                        <span className="font-bold text-slate-900">{formatDateId(mt.maintenance_date)}</span>
                      </div>
                      {mt.cost !== undefined && mt.cost > 0 && (
                        <span className="font-bold text-slate-900 tabular-nums">{formatRupiah(mt.cost)}</span>
                      )}
                    </div>
                    <p className="text-slate-700">{mt.description}</p>
                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-3">
                      <span>Teknisi: {mt.vendor_name}</span>
                      {mt.next_service_date && (
                        <span>Servis berikut: {formatDateId(mt.next_service_date)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
