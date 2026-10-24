import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MasterItem } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatRupiah } from "@/lib/formatters";
import { toast } from "sonner";
import {
  PackageCheck,
  Plus,
  Sparkles,
  Trash2,
  Edit3,
  Search,
  FileText,
  Check,
  X,
  RefreshCw,
  DatabaseZap,
  LineChart,
} from "lucide-react";

interface MasterItemsTabProps {
  categories: string[];
  onInspectItemPrice?: (itemName: string, itemId?: number) => void;
}

export const MasterItemsTab: React.FC<MasterItemsTabProps> = ({
  categories,
  onInspectItemPrice,
}) => {
  const queryClient = useQueryClient();

  // Form states for single add
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState(categories[0] || "Bahan Kue");
  const [aliases, setAliases] = useState("");
  const [defaultSupplier, setDefaultSupplier] = useState("");
  const [satuanBeli, setSatuanBeli] = useState("Box");
  const [tipeSatuan, setTipeSatuan] = useState<"keduanya" | "paket" | "ecer">("keduanya");
  const [isiPaket, setIsiPaket] = useState("");
  const [satuanEcer, setSatuanEcer] = useState("Pouch");

  // Bulk import state
  const [showBulkBox, setShowBulkBox] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkCategory, setBulkCategory] = useState(categories[0] || "Bahan Kue");

  // Search & filter
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    item_name: "",
    category: "",
    aliases: "",
    default_supplier: "",
    satuan_beli: "Pcs",
    tipe_satuan: "keduanya" as "keduanya" | "paket" | "ecer",
    isi_paket: "",
    satuan_ecer: "Pcs",
  });

  const { data: masterRes, isLoading } = useQuery<{
    ok: boolean;
    data: MasterItem[];
    total: number;
  }>({
    queryKey: ["master-items"],
    queryFn: async () => (await api.get("/master-items")).data,
  });

  const masterItems = masterRes?.data || [];

  const filteredItems = useMemo(() => {
    return masterItems.filter((item) => {
      if (filterCat && item.category !== filterCat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.item_name.toLowerCase().includes(q) ||
          (item.aliases || "").toLowerCase().includes(q) ||
          (item.default_supplier || "").toLowerCase().includes(q) ||
          (item.satuan_beli || "").toLowerCase().includes(q) ||
          (item.isi_paket || "").toLowerCase().includes(q) ||
          (item.satuan_ecer || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [masterItems, filterCat, search]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["master-items"] });
    queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["report"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      return (
        await api.post("/master-items", {
          item_name: itemName,
          category,
          aliases,
          default_supplier: defaultSupplier || "-",
          satuan_beli: satuanBeli || "Pcs",
          tipe_satuan: tipeSatuan,
          isi_paket: isiPaket,
          satuan_ecer: satuanEcer || "Pcs",
        })
      ).data;
    },
    onSuccess: () => {
      toast.success("Item baku berhasil disimpan!");
      setItemName("");
      setAliases("");
      setDefaultSupplier("");
      setIsiPaket("");
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan item baku");
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      return (
        await api.post("/master-items/bulk", {
          raw_text: bulkText,
          default_category: bulkCategory,
        })
      ).data;
    },
    onSuccess: (res) => {
      toast.success(
        `Berhasil memproses daftar! (+${res.added} baru, ${res.updated} diperbarui)`
      );
      setBulkText("");
      setShowBulkBox(false);
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengimpor daftar item");
    },
  });

  const syncExistingMutation = useMutation({
    mutationFn: async () => {
      return (await api.post("/master-items/sync-existing")).data;
    },
    onSuccess: (res) => {
      if (res.matched_count > 0) {
        toast.success(
          `✨ ${res.matched_count} transaksi lama berhasil dicocokkan ke Nama Item Baku!`
        );
      } else {
        toast.info("Semua transaksi sudah sesuai atau belum ada yang cocok.");
      }
      invalidateAll();
    },
    onError: () => {
      toast.error("Gagal mencocokkan transaksi lama");
    },
  });

  const importHistoryMutation = useMutation({
    mutationFn: async () => {
      return (await api.post("/master-items/import-from-history")).data;
    },
    onSuccess: (res) => {
      if (res.added > 0) {
        toast.success(
          `⚡ Berhasil menarik ${res.added} nama barang unik dari histori transaksi!`
        );
      } else {
        toast.info("Semua barang di histori transaksi sudah terdaftar di Master Item.");
      }
      invalidateAll();
    },
    onError: () => {
      toast.error("Gagal menarik data dari histori transaksi");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => {
      return (await api.put(`/master-items/${id}`, payload)).data;
    },
    onSuccess: () => {
      toast.success("Item baku diperbarui");
      setEditingId(null);
      invalidateAll();
    },
    onError: () => {
      toast.error("Gagal memperbarui item baku");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return (await api.delete(`/master-items/${id}`)).data;
    },
    onSuccess: () => {
      toast.success("Item baku dihapus");
      invalidateAll();
    },
  });

  const startEdit = (item: MasterItem) => {
    setEditingId(item.id);
    setEditForm({
      item_name: item.item_name,
      category: item.category,
      aliases: item.aliases || "",
      default_supplier: item.default_supplier === "-" ? "" : item.default_supplier,
      satuan_beli: item.satuan_beli || "Pcs",
      tipe_satuan: item.tipe_satuan || "keduanya",
      isi_paket: item.isi_paket || "",
      satuan_ecer: item.satuan_ecer || "Pcs",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Card className="border-slate-200/90 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-3xl shadow-sm overflow-hidden">
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-blue-200" />
              <h2 className="text-lg font-bold">Katalog Nama Item Baku (Master Item)</h2>
            </div>
            <p className="text-xs text-blue-100 max-w-2xl leading-relaxed">
              Setiap pengeluaran baru dari <strong>Scan Struk, Voice Note, /catat, maupun Web</strong> otomatis dicocokkan ke nama baku di bawah ini. Jika nama di struk agak berbeda (mis. <em>"Terigu Cakra 1kg"</em>), sistem akan menyamakannya ke nama baku dan mencatat nama asli struk di kolom Keterangan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              disabled={importHistoryMutation.isPending}
              onClick={() => importHistoryMutation.mutate()}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-white/15 hover:bg-white/25 text-white border border-white/20"
            >
              <DatabaseZap className="w-3.5 h-3.5" />
              {importHistoryMutation.isPending
                ? "Menarik..."
                : "⚡ Tarik dari Histori Transaksi"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowBulkBox((v) => !v)}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-white/15 hover:bg-white/25 text-white border border-white/20"
            >
              <FileText className="w-3.5 h-3.5" />
              {showBulkBox ? "Tutup Paste Massal" : "Paste Daftar Item Massal"}
            </Button>
            <Button
              size="sm"
              disabled={syncExistingMutation.isPending || masterItems.length === 0}
              onClick={() => syncExistingMutation.mutate()}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-white text-blue-700 hover:bg-blue-50 shadow-xs"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncExistingMutation.isPending ? "animate-spin" : ""}`}
              />
              Cocokkan Data Lama ({masterItems.length} item)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Paste Box */}
      {showBulkBox && (
        <Card className="border-blue-200 bg-blue-50/40 rounded-2xl shadow-xs">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  Paste Daftar Nama Item Sekaligus (1 Baris = 1 Item)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Format per baris:{" "}
                  <code className="bg-white px-1.5 py-0.5 rounded border text-slate-700">
                    Nama Baku | Kategori | Alias | Toko | Satuan Beli | Tipe (keduanya/paket/ecer) | Isi Paket | Satuan Ecer
                  </code>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Kategori Default:</span>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <textarea
              rows={6}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={
                "Contoh:\nSusu Carnation | Bahan Kue | carnation pouch, skm carnation | Toko Makmur | Box | keduanya | 6 pouch @ 2kg | Pouch\nTepung Terigu Cakra | Bahan Kue | cakra kembar, terigu cakra | Toko Roti | Sak | keduanya | 25 kg | Kg\nBox Kue 20x20 | Kemasan | dus 20x20, kotak kue 20 | Toko Plastik | Bal | paket | isi 100 pcs | Pcs"
              }
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkBox(false)}
                className="rounded-xl text-xs"
              >
                Batal
              </Button>
              <Button
                size="sm"
                disabled={!bulkText.trim() || bulkMutation.isPending}
                onClick={() => bulkMutation.mutate()}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold px-4"
              >
                {bulkMutation.isPending ? "Menyimpan..." : "Simpan Semua ke Katalog"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Add Single Item Form */}
      <Card className="border-slate-200/90 bg-white rounded-2xl shadow-xs">
        <CardContent className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!itemName.trim()) return;
              addMutation.mutate();
            }}
            className="space-y-3"
          >
            {/* Baris 1: Nama, Kategori, Tipe Satuan, Satuan Beli, Toko */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Nama Item Baku *
                </label>
                <Input
                  placeholder="Contoh: Susu Carnation"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Kategori Default
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Tipe Satuan
                </label>
                <select
                  value={tipeSatuan}
                  onChange={(e) => setTipeSatuan(e.target.value as any)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  <option value="keduanya">Paket & Ecer</option>
                  <option value="paket">Hanya Paket</option>
                  <option value="ecer">Hanya Ecer</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Satuan Beli / Kemasan
                </label>
                <Input
                  placeholder="mis: Box, Pcs, Kg"
                  value={satuanBeli}
                  onChange={(e) => setSatuanBeli(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Toko Default
                </label>
                <Input
                  placeholder="Opsional"
                  value={defaultSupplier}
                  onChange={(e) => setDefaultSupplier(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                />
              </div>
            </div>

            {/* Baris 2: Isi Paket/Kemasan, Satuan Ecer, Alias di Struk, Tombol */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-1 border-t border-slate-100">
              <div className="md:col-span-4">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Isi Kemasan / Paket (Detail)
                </label>
                <Input
                  placeholder="Contoh: 1 box isi 6 pouch 2kg, atau 25 kg"
                  value={isiPaket}
                  onChange={(e) => setIsiPaket(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Satuan Eceran
                </label>
                <Input
                  placeholder="mis: Pouch, Kaleng, Kg"
                  value={satuanEcer}
                  onChange={(e) => setSatuanEcer(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                  disabled={tipeSatuan === "paket"}
                />
              </div>

              <div className="md:col-span-4">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Kata Kunci / Alias di Struk (Opsional)
                </label>
                <Input
                  placeholder="Pisahkan koma: carnation pouch, skm carnation"
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={addMutation.isPending || !itemName.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-9 px-3.5 text-xs font-semibold gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Item
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Filter & Table List */}
      <Card className="border-slate-200/90 bg-white rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Cari nama item baku atau kata kunci alias..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl bg-slate-50/70"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium"
            >
              <option value="">Semua Kategori ({masterItems.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Nama Item Baku</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Satuan & Kemasan</th>
                <th className="py-3 px-4">Kata Kunci / Alias Struk</th>
                <th className="py-3 px-4">Toko Default</th>
                <th className="py-3 px-4 text-right">Harga Terakhir</th>
                <th className="py-3 px-4 text-center">Transaksi</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    Memuat katalog item baku...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    Belum ada item baku yang terdaftar. Tambahkan di atas atau klik{" "}
                    <strong>"Paste Daftar Item Massal"</strong>.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isEditing = editingId === item.id;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {isEditing ? (
                          <Input
                            value={editForm.item_name}
                            onChange={(e) =>
                              setEditForm({ ...editForm, item_name: e.target.value })
                            }
                            className="h-8 text-xs rounded-lg"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onInspectItemPrice?.(item.item_name, item.id)}
                            className="hover:text-blue-600 hover:underline inline-flex items-center gap-1.5 text-left"
                            title="Klik untuk lihat riwayat harga & perbandingan toko"
                          >
                            <span>{item.item_name}</span>
                            <LineChart className="w-3 h-3 text-slate-300" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isEditing ? (
                          <select
                            value={editForm.category}
                            onChange={(e) =>
                              setEditForm({ ...editForm, category: e.target.value })
                            }
                            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                          >
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-medium">
                            {item.category}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isEditing ? (
                          <div className="space-y-1.5 min-w-[210px]">
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <label className="text-[10px] text-slate-500 block">Tipe</label>
                                <select
                                  value={editForm.tipe_satuan}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, tipe_satuan: e.target.value as any })
                                  }
                                  className="h-7 w-full rounded border border-slate-200 bg-white px-1.5 text-[11px]"
                                >
                                  <option value="keduanya">Paket & Ecer</option>
                                  <option value="paket">Hanya Paket</option>
                                  <option value="ecer">Hanya Ecer</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 block">Satuan Beli</label>
                                <Input
                                  value={editForm.satuan_beli}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, satuan_beli: e.target.value })
                                  }
                                  placeholder="Box / Pcs"
                                  className="h-7 text-[11px] rounded px-1.5"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <label className="text-[10px] text-slate-500 block">Isi Paket</label>
                                <Input
                                  value={editForm.isi_paket}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, isi_paket: e.target.value })
                                  }
                                  placeholder="mis. 6 pouch @ 2kg"
                                  className="h-7 text-[11px] rounded px-1.5"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 block">Satuan Ecer</label>
                                <Input
                                  value={editForm.satuan_ecer}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, satuan_ecer: e.target.value })
                                  }
                                  placeholder="mis. Pouch"
                                  className="h-7 text-[11px] rounded px-1.5"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5 min-w-[140px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-800 text-xs">
                                {item.satuan_beli || "Pcs"}
                              </span>
                              {item.tipe_satuan === "keduanya" ? (
                                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                                  Paket & Ecer
                                </Badge>
                              ) : item.tipe_satuan === "paket" ? (
                                <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                                  Paket
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                                  Ecer
                                </Badge>
                              )}
                            </div>
                            {item.isi_paket && (
                              <div className="text-[11px] text-slate-500 font-normal">
                                Isi: <span className="text-slate-700 font-medium">{item.isi_paket}</span>
                              </div>
                            )}
                            {item.tipe_satuan === "keduanya" && item.satuan_ecer && item.satuan_ecer !== item.satuan_beli && (
                              <div className="text-[10px] text-slate-400">
                                Ecer: <span className="text-slate-600 font-medium">{item.satuan_ecer}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {isEditing ? (
                          <Input
                            value={editForm.aliases}
                            onChange={(e) =>
                              setEditForm({ ...editForm, aliases: e.target.value })
                            }
                            placeholder="alias1, alias2"
                            className="h-8 text-xs rounded-lg"
                          />
                        ) : item.aliases ? (
                          <div className="flex flex-wrap gap-1">
                            {item.aliases.split(",").map((a) => (
                              <span
                                key={a}
                                className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]"
                              >
                                {a.trim()}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {isEditing ? (
                          <Input
                            value={editForm.default_supplier}
                            onChange={(e) =>
                              setEditForm({ ...editForm, default_supplier: e.target.value })
                            }
                            className="h-8 text-xs rounded-lg"
                          />
                        ) : (
                          item.last_supplier || item.default_supplier || "-"
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold tabular-nums text-emerald-700">
                        {item.last_unit_price > 0 ? formatRupiah(item.last_unit_price) : "-"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant="secondary" className="text-[10px]">
                          {item.tx_count}x
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                updateMutation.mutate({ id: item.id, payload: editForm })
                              }
                              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                              className="h-7 w-7 p-0 text-slate-400 hover:bg-slate-100"
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(item)}
                              className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                              title="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(item.id)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
