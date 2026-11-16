import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getPurchasingSupplierOptions,
  generatePurchasingWhatsApp,
} from "@/lib/api";
import {
  ItemSuggestion,
  PurchaseRequestItem,
  PurchasingSupplierGroup,
  PurchasingSupplierOption,
} from "@/types";
import { usePurchaseRequestWorkflow } from "@/components/requests/usePurchaseRequestWorkflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/formatters";
import {
  ShoppingBasket,
  Plus,
  Store,
  Phone,
  MapPin,
  MessageCircle,
  CheckCircle2,
  Edit2,
  XCircle,
  Check,
  Search,
  Copy,
  Send,
  AlertCircle,
  Clock,
  Wallet,
} from "lucide-react";

interface PurchasingOrdersPageProps {
  categories?: string[];
  itemSuggestions?: ItemSuggestion[];
}

const PURCHASING_UNITS = [
  "Pcs", "Box", "Kg", "Gram", "Liter", "Pack", "Sak", "Bungkus",
  "Kaleng", "Dus", "Botol", "Bal", "Roll", "Lembar", "Butir", "Ikat",
];

type PurchasingFilter = "ALL" | "UNASSIGNED" | "PENDING" | "ORDERED";

export const PurchasingOrdersPage: React.FC<PurchasingOrdersPageProps> = ({
  categories = [],
  itemSuggestions = [],
}) => {
  const [groupFilter, setGroupFilter] = useState<PurchasingFilter>("ALL");

  // WhatsApp Modal
  const [whatsappModalData, setWhatsappModalData] = useState<{
    supplierName: string;
    supplierPhone?: string;
    text: string;
    items: PurchaseRequestItem[];
  } | null>(null);

  // Assign Registered Supplier Dialog
  const [assignDialogItem, setAssignDialogItem] = useState<PurchaseRequestItem | null>(null);
  const [assignSupplierId, setAssignSupplierId] = useState<number | null>(null);
  const [assignSupplierName, setAssignSupplierName] = useState("");
  const [assignSupplierSearch, setAssignSupplierSearch] = useState("");
  const [showOtherSuppliers, setShowOtherSuppliers] = useState(false);
  const [assignEstimatedPrice, setAssignEstimatedPrice] = useState<number | undefined>(undefined);

  // Koreksi Item Dialog
  const [editPurchasingItem, setEditPurchasingItem] = useState<PurchaseRequestItem | null>(null);
  const [editItemName, setEditItemName] = useState("");
  const [editItemQty, setEditItemQty] = useState<number>(1);
  const [editItemUnit, setEditItemUnit] = useState("Pcs");
  const [editItemPrice, setEditItemPrice] = useState<number | undefined>(undefined);
  const [editItemNotes, setEditItemNotes] = useState("");

  // Barang Tidak Ada / Cancel Dialog
  const [cancelPurchasingTarget, setCancelPurchasingTarget] = useState<PurchaseRequestItem | null>(null);
  const [cancelPurchasingReason, setCancelPurchasingReason] = useState("Stok supplier kosong");

  // Tambah Barang Susulan Dialog
  const [isAddPurchasingOpen, setIsAddPurchasingOpen] = useState(false);
  const [addItemName, setAddItemName] = useState("");
  const [addItemQty, setAddItemQty] = useState<number>(1);
  const [addItemUnit, setAddItemUnit] = useState("Pcs");
  const [addItemCategory, setAddItemCategory] = useState("Bahan Kue");
  const [addItemSupplierId, setAddItemSupplierId] = useState<number | null>(null);
  const [addItemPrice, setAddItemPrice] = useState<number | undefined>(undefined);
  const [addItemNotes, setAddItemNotes] = useState("");
  const [showAddSuggestions, setShowAddSuggestions] = useState(false);

  const {
    queryClient,
    purchasingGroups,
    isLoadingPurchasing,
    isErrorPurchasing,
    suppliers,
    markOrderedMutation,
    assignSupplierMutation,
    updatePurchasingItemMutation,
    cancelPurchasingItemMutation,
    addPurchasingItemMutation,
  } = usePurchaseRequestWorkflow({
    enablePurchasing: true,
    enableSuppliers: true,
  });

  const {
    data: supplierOptionsData,
    isLoading: isLoadingSupplierOptions,
    isError: isErrorSupplierOptions,
  } = useQuery({
    queryKey: ["purchasing-supplier-options", assignDialogItem?.id],
    queryFn: () => getPurchasingSupplierOptions(assignDialogItem!.id),
    enabled: !!assignDialogItem,
  });

  const summary = useMemo(() => {
    let unassignedCount = 0;
    let readyPendingCount = 0;
    let totalEstimated = 0;
    let registeredGroupCount = 0;

    for (const grp of purchasingGroups) {
      const isUnassigned = grp.supplier_name === "Belum Ditentukan";
      if (!isUnassigned) registeredGroupCount += 1;
      for (const it of grp.items) {
        if (isUnassigned) unassignedCount += 1;
        else if (it.order_status === "PENDING") readyPendingCount += 1;
        if (it.estimated_price && it.estimated_price > 0) {
          totalEstimated += it.estimated_price * it.qty;
        }
      }
    }

    return { unassignedCount, readyPendingCount, registeredGroupCount, totalEstimated };
  }, [purchasingGroups]);

  const filteredGroups = useMemo(() => {
    const sorted = [...purchasingGroups].sort((a, b) => {
      const aUn = a.supplier_name === "Belum Ditentukan" ? 1 : 0;
      const bUn = b.supplier_name === "Belum Ditentukan" ? 1 : 0;
      return bUn - aUn;
    });

    if (groupFilter === "ALL") return sorted;
    if (groupFilter === "UNASSIGNED") {
      return sorted.filter((g) => g.supplier_name === "Belum Ditentukan");
    }
    if (groupFilter === "PENDING") {
      return sorted
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => i.order_status === "PENDING"),
        }))
        .filter((g) => g.items.length > 0 && g.supplier_name !== "Belum Ditentukan");
    }
    return sorted
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.order_status === "ORDERED"),
      }))
      .filter((g) => g.items.length > 0);
  }, [purchasingGroups, groupFilter]);

  const openAssignSupplierModal = (item: PurchaseRequestItem) => {
    setAssignDialogItem(item);
    setAssignSupplierId(item.supplier_id ?? null);
    setAssignSupplierName(
      item.supplier_name && item.supplier_name !== "-" ? item.supplier_name : ""
    );
    setAssignSupplierSearch("");
    setShowOtherSuppliers(false);
    setAssignEstimatedPrice(
      item.estimated_price ? Number(item.estimated_price) : undefined
    );
  };

  const openEditPurchasingModal = (item: PurchaseRequestItem) => {
    setEditPurchasingItem(item);
    setEditItemName(item.item_name);
    setEditItemQty(Number(item.qty) || 1);
    setEditItemUnit(item.unit || "Pcs");
    setEditItemPrice(item.estimated_price ? Number(item.estimated_price) : undefined);
    setEditItemNotes(item.notes && item.notes !== "-" ? item.notes : "");
  };

  const openAddPurchasingModal = (presetSupplierId?: number | null) => {
    setAddItemName("");
    setAddItemQty(1);
    setAddItemUnit("Pcs");
    setAddItemCategory(categories[0] || "Bahan Kue");
    setAddItemSupplierId(presetSupplierId ?? null);
    setAddItemPrice(undefined);
    setAddItemNotes("");
    setShowAddSuggestions(false);
    setIsAddPurchasingOpen(true);
  };

  const handleSelectSupplierOption = (sup: PurchasingSupplierOption) => {
    setAssignSupplierId(sup.id);
    setAssignSupplierName(sup.name);
    if (sup.last_unit_price && sup.last_unit_price > 0) {
      setAssignEstimatedPrice(sup.last_unit_price);
    }
  };

  const handleOpenWhatsAppModal = async (group: PurchasingSupplierGroup) => {
    const itemIds = group.items.map((i) => i.id);
    try {
      const res = await generatePurchasingWhatsApp({
        supplier_name: group.supplier_name,
        item_ids: itemIds,
        custom_notes: "",
      });
      setWhatsappModalData({
        supplierName: group.supplier_name,
        supplierPhone: group.supplier_phone,
        text: res.text,
        items: group.items,
      });
    } catch {
      let text = `Halo ${group.supplier_name},\nKami dari Historycake Bakery ingin memesan bahan berikut:\n\n`;
      group.items.forEach((it, idx) => {
        text += `${idx + 1}. ${it.item_name} - ${it.qty} ${it.unit}\n`;
      });
      text += "\nMohon konfirmasi ketersediaan barang dan total harganya. Terima kasih.";
      setWhatsappModalData({
        supplierName: group.supplier_name,
        supplierPhone: group.supplier_phone,
        text,
        items: group.items,
      });
    }
  };

  const handleCopyWhatsAppText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Format pesanan WhatsApp disalin ke clipboard.");
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-16">
      {/* Header Panel Purchasing */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ShoppingBasket className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Panel Pemesanan Purchasing
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              Tentukan supplier terdaftar yang memiliki barang, koreksi ketersediaan atau qty, kirim order WhatsApp, lalu tandai sudah dipesan.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={() => openAddPurchasingModal(null)}
            className="h-10 sm:h-9 px-3.5 text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white rounded-xl flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Tambah Barang Susulan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["purchasing-orders"] })}
            className="h-10 sm:h-9 text-xs rounded-xl"
          >
            Refresh Order
          </Button>
        </div>
      </div>

      {/* Ringkasan Antrean Purchasing */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          onClick={() => setGroupFilter("UNASSIGNED")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            groupFilter === "UNASSIGNED"
              ? "border-amber-600 bg-amber-50/50 dark:bg-amber-950/20 ring-1 ring-amber-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-amber-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Perlu Pilih Supplier
            </span>
            <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-amber-800 dark:text-amber-300 tabular-nums">
              {summary.unassignedCount}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">item</span>
          </div>
        </Card>

        <Card
          onClick={() => setGroupFilter("PENDING")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            groupFilter === "PENDING"
              ? "border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Siap Pesan WA
            </span>
            <MessageCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {summary.readyPendingCount}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">item</span>
          </div>
        </Card>

        <Card
          onClick={() => setGroupFilter("ALL")}
          className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 cursor-pointer hover:border-zinc-400"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Supplier Tujuan
            </span>
            <Store className="w-4 h-4 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {summary.registeredGroupCount}
            </span>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 ml-1.5">toko</span>
          </div>
        </Card>

        <Card className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Estimasi Order
            </span>
            <Wallet className="w-4 h-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <span className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {summary.totalEstimated > 0 ? formatRupiah(summary.totalEstimated) : "Rp 0"}
            </span>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
        {[
          { id: "ALL", label: "Semua Kelompok" },
          { id: "UNASSIGNED", label: "Belum Ada Supplier" },
          { id: "PENDING", label: "Siap Pesan (Belum Ordered)" },
          { id: "ORDERED", label: "Sudah Dipesan" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setGroupFilter(tab.id as PurchasingFilter)}
            className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
              groupFilter === tab.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Daftar Kelompok Supplier */}
      {isLoadingPurchasing ? (
        <div className="py-16 text-center text-zinc-600 dark:text-zinc-400 text-xs">
          Memuat antrean pemesanan per supplier...
        </div>
      ) : isErrorPurchasing ? (
        <div
          role="alert"
          className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Gagal memuat daftar order Purchasing. Coba klik Refresh Order.</span>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="py-14 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Tidak Ada Pesanan pada Tampilan Ini
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">
            {groupFilter !== "ALL"
              ? "Coba pilih filter Semua Kelompok untuk melihat item lain, atau tambahkan barang susulan."
              : "Semua item yang sudah disetujui telah diproses atau belum ada pengajuan baru yang disetujui."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group, groupIdx) => {
            const isUnassigned = group.supplier_name === "Belum Ditentukan";
            const pendingItems = group.items.filter((i) => i.order_status === "PENDING");
            const allGroupItemIds = group.items.map((i) => i.id);

            return (
              <div
                key={`${group.supplier_name}-${groupIdx}`}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
              >
                {/* Header Supplier */}
                <div className="p-4 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200/80 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isUnassigned
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      <Store className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                          {group.supplier_name}
                        </h3>
                        <Badge
                          className={`text-[11px] ${
                            isUnassigned
                              ? "bg-amber-700 text-white"
                              : "bg-emerald-700 text-white"
                          }`}
                        >
                          {group.items.length} Item
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                        {group.supplier_phone && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                            <Phone className="w-3 h-3" aria-hidden="true" /> {group.supplier_phone}
                          </span>
                        )}
                        {group.supplier_address && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" aria-hidden="true" /> {group.supplier_address}
                          </span>
                        )}
                        {isUnassigned && (
                          <span className="text-amber-800 dark:text-amber-300 font-semibold">
                            Pilih supplier terdaftar sebelum memesan
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Aksi Header Supplier */}
                  <div className="flex flex-wrap items-center gap-2">
                    {!isUnassigned && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openAddPurchasingModal(group.supplier_id)}
                          className="h-9 sm:h-8 px-2.5 text-xs font-semibold border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-lg flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" /> Tambah Item
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => handleOpenWhatsAppModal(group)}
                          className="h-9 sm:h-8 px-3 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg flex items-center gap-1.5"
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> Salin Format WA
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (
                              confirm(
                                `Tandai semua item untuk ${group.supplier_name} sebagai SUDAH DIPESAN?`
                              )
                            ) {
                              markOrderedMutation.mutate(allGroupItemIds);
                            }
                          }}
                          disabled={markOrderedMutation.isPending || pendingItems.length === 0}
                          className="h-9 sm:h-8 px-3 text-xs font-semibold text-blue-700 border-blue-200 dark:text-blue-300 dark:border-blue-900/60 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Tandai Sudah Dipesan
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Baris Item per Supplier */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {group.items.map((item) => {
                    const isOrdered = item.order_status === "ORDERED";
                    return (
                      <div
                        key={item.id}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                              {item.item_name}
                            </span>
                            <Badge variant="outline" className="text-xs font-semibold">
                              {item.qty} {item.unit}
                            </Badge>
                            {isOrdered ? (
                              <Badge className="bg-blue-700 text-white text-[10px]">
                                ORDERED
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-amber-800 border-amber-300 dark:text-amber-300 dark:border-amber-800 text-[10px]"
                              >
                                Belum Dipesan
                              </Badge>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-600 dark:text-zinc-400">
                            <span>Kategori: {item.category || "Bahan Kue"}</span>
                            {item.estimated_price && item.estimated_price > 0 && (
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                Est: {formatRupiah(item.estimated_price * item.qty)}
                              </span>
                            )}
                            {item.notes && item.notes !== "-" && (
                              <span className="italic text-zinc-600 dark:text-zinc-400">
                                "{item.notes}"
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-center shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openAssignSupplierModal(item)}
                            className="h-9 sm:h-8 px-2.5 text-xs text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 rounded-lg flex items-center gap-1"
                          >
                            <Store className="w-3.5 h-3.5" />
                            {isUnassigned ? "Pilih Supplier" : "Ubah Supplier"}
                          </Button>

                          {item.receiving_status === "PENDING" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditPurchasingModal(item)}
                                className="h-9 sm:h-8 px-2.5 text-xs text-zinc-700 hover:text-amber-800 dark:text-zinc-300 dark:hover:text-amber-300 rounded-lg flex items-center gap-1"
                              >
                                <Edit2 className="w-3.5 h-3.5" /> Koreksi
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setCancelPurchasingTarget(item);
                                  setCancelPurchasingReason("Stok supplier kosong");
                                }}
                                className="h-9 sm:h-8 px-2.5 text-xs text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 rounded-lg flex items-center gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" /> Tidak Ada
                              </Button>
                            </>
                          )}

                          {!isOrdered && !isUnassigned && (
                            <Button
                              size="sm"
                              onClick={() => markOrderedMutation.mutate([item.id])}
                              disabled={markOrderedMutation.isPending}
                              className="h-9 sm:h-8 px-3 text-xs bg-blue-700 hover:bg-blue-800 text-white rounded-lg flex items-center gap-1 font-semibold"
                            >
                              <Check className="w-3.5 h-3.5" /> Dipesan
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal WhatsApp Order */}
      <Dialog open={!!whatsappModalData} onOpenChange={(open) => !open && setWhatsappModalData(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-lg bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> Format Pesanan Supplier
            </DialogTitle>
          </DialogHeader>

          {whatsappModalData && (
            <div className="py-2 space-y-3">
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                Penerima:{" "}
                <strong className="text-zinc-900 dark:text-zinc-100">
                  {whatsappModalData.supplierName}
                </strong>
                {whatsappModalData.supplierPhone && (
                  <span className="ml-2 font-mono text-emerald-700 dark:text-emerald-400">
                    ({whatsappModalData.supplierPhone})
                  </span>
                )}
              </div>

              <div className="relative">
                <textarea
                  readOnly
                  value={whatsappModalData.text}
                  rows={9}
                  className="w-full text-xs font-mono p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-800 dark:text-zinc-200 resize-none"
                />
                <Button
                  size="sm"
                  onClick={() => handleCopyWhatsAppText(whatsappModalData.text)}
                  className="absolute right-2.5 top-2.5 h-7 px-2.5 text-[11px] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg flex items-center gap-1 shadow"
                >
                  <Copy className="w-3 h-3" /> Salin
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
            <div className="w-full sm:w-auto">
              {whatsappModalData?.supplierPhone && (
                <a
                  href={`https://wa.me/${whatsappModalData.supplierPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                    whatsappModalData.text
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl"
                >
                  <Send className="w-3.5 h-3.5" /> Buka WhatsApp Langsung
                </a>
              )}
            </div>

            <div className="flex items-center gap-2 self-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWhatsappModalData(null)}
                className="h-9 px-3 text-xs rounded-xl"
              >
                Tutup
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (whatsappModalData) {
                    handleCopyWhatsAppText(whatsappModalData.text);
                    setWhatsappModalData(null);
                  }
                }}
                className="h-9 px-4 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl"
              >
                Salin & Tutup
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Pilih Supplier Terdaftar (Berdasarkan Kepemilikan Barang) */}
      <Dialog open={!!assignDialogItem} onOpenChange={(open) => !open && setAssignDialogItem(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-lg max-h-[90dvh] flex flex-col p-0 overflow-hidden bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-left">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 pr-6">
              <Store className="w-5 h-5 text-amber-700 dark:text-amber-400" /> Pilih Supplier Terdaftar
            </DialogTitle>
          </DialogHeader>

          {assignDialogItem && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {assignDialogItem.item_name}
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400 mt-0.5">
                    Jumlah: {assignDialogItem.qty} {assignDialogItem.unit}
                  </div>
                </div>
                {assignSupplierName && (
                  <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 text-[11px] shrink-0">
                    Dipilih: {assignSupplierName}
                  </Badge>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="purchasing-supplier-search"
                  className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                >
                  Cari Supplier Terdaftar
                </label>
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <Input
                    id="purchasing-supplier-search"
                    value={assignSupplierSearch}
                    onChange={(e) => setAssignSupplierSearch(e.target.value)}
                    placeholder="Ketik nama toko terdaftar..."
                    className="pl-8 text-xs h-10 sm:h-9"
                    autoFocus
                  />
                </div>
              </div>

              {isLoadingSupplierOptions ? (
                <div className="py-6 text-center text-xs text-zinc-600 dark:text-zinc-400">
                  Memuat supplier terdaftar yang memiliki barang ini...
                </div>
              ) : isErrorSupplierOptions ? (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800"
                >
                  Gagal memuat daftar supplier. Tutup lalu coba lagi.
                </div>
              ) : (
                (() => {
                  const q = assignSupplierSearch.trim().toLowerCase();
                  const matching = (supplierOptionsData?.matching_suppliers || []).filter(
                    (s) => !q || s.name.toLowerCase().includes(q)
                  );
                  const others = (supplierOptionsData?.other_suppliers || []).filter(
                    (s) => !q || s.name.toLowerCase().includes(q)
                  );
                  const shouldShowOthers =
                    matching.length === 0 || q.length > 0 || showOtherSuppliers;

                  return (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 block">
                          Supplier Punya Barang Ini ({matching.length})
                        </span>

                        {matching.length === 0 ? (
                          <div className="p-3 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400">
                            Belum ada supplier terdaftar yang tercatat memiliki "{assignDialogItem.item_name}". Pilih dari supplier terdaftar lainnya di bawah.
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                            {matching.map((sup) => {
                              const isSelected = assignSupplierId === sup.id;
                              return (
                                <button
                                  key={sup.id}
                                  type="button"
                                  onClick={() => handleSelectSupplierOption(sup)}
                                  className={`w-full text-left p-2.5 min-h-[44px] rounded-xl border transition-colors flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                                    isSelected
                                      ? "border-amber-600 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-600"
                                      : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                        {sup.name}
                                      </span>
                                      {sup.is_default_supplier && (
                                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] px-1.5 py-0">
                                          Default
                                        </Badge>
                                      )}
                                      {sup.tx_count > 0 && (
                                        <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
                                          {sup.tx_count}x beli
                                        </span>
                                      )}
                                    </div>
                                    {(sup.last_date || sup.phone) && (
                                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate mt-0.5">
                                        {sup.last_date ? `Terakhir: ${sup.last_date}` : ""}
                                        {sup.last_date && sup.phone ? " • " : ""}
                                        {sup.phone || ""}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {sup.last_unit_price && sup.last_unit_price > 0 && (
                                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                        ~{formatRupiah(sup.last_unit_price)}
                                      </span>
                                    )}
                                    {isSelected && (
                                      <Check className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {others.length > 0 && (
                        <div className="space-y-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                          {!shouldShowOthers ? (
                            <button
                              type="button"
                              onClick={() => setShowOtherSuppliers(true)}
                              className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:text-amber-800 underline py-1"
                            >
                              Lihat {others.length} supplier terdaftar lainnya
                            </button>
                          ) : (
                            <>
                              <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 block">
                                Supplier Terdaftar Lainnya ({others.length})
                              </span>
                              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
                                {others.map((sup) => {
                                  const isSelected = assignSupplierId === sup.id;
                                  return (
                                    <button
                                      key={sup.id}
                                      type="button"
                                      onClick={() => handleSelectSupplierOption(sup)}
                                      className={`w-full text-left p-2.5 min-h-[44px] rounded-xl border transition-colors flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                                        isSelected
                                          ? "border-amber-600 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-600"
                                          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block truncate">
                                          {sup.name}
                                        </span>
                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                          Belum ada riwayat barang ini
                                        </span>
                                      </div>
                                      {isSelected && (
                                        <Check className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="purchasing-estimated-price"
                  className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                >
                  Estimasi Harga Satuan (Opsional)
                </label>
                <Input
                  id="purchasing-estimated-price"
                  type="number"
                  value={assignEstimatedPrice ?? ""}
                  onChange={(e) =>
                    setAssignEstimatedPrice(e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder="Rp per satuan"
                  className="text-xs h-10 sm:h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignDialogItem(null)}
              className="h-10 sm:h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!assignDialogItem || !assignSupplierId) {
                  toast.error("Pilih supplier dari daftar terdaftar terlebih dahulu");
                  return;
                }
                assignSupplierMutation.mutate(
                  {
                    itemId: assignDialogItem.id,
                    supplierId: assignSupplierId,
                    supplierName: assignSupplierName,
                    estimatedPrice: assignEstimatedPrice,
                  },
                  {
                    onSuccess: () => setAssignDialogItem(null),
                  }
                );
              }}
              disabled={!assignSupplierId || assignSupplierMutation.isPending}
              className="h-10 sm:h-9 px-4 text-xs bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white font-semibold rounded-xl"
            >
              {assignSupplierMutation.isPending ? "Menyimpan..." : "Simpan Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Koreksi Item */}
      <Dialog open={!!editPurchasingItem} onOpenChange={(open) => !open && setEditPurchasingItem(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-amber-700 dark:text-amber-400" /> Koreksi Barang Belanja
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Nama Barang
              </label>
              <Input
                value={editItemName}
                onChange={(e) => setEditItemName(e.target.value)}
                className="text-xs h-10 sm:h-9"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Jumlah (Qty)
                </label>
                <Input
                  type="number"
                  step="any"
                  min="0.1"
                  value={editItemQty}
                  onChange={(e) => setEditItemQty(parseFloat(e.target.value) || 0)}
                  className="text-xs h-10 sm:h-9 font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Satuan
                </label>
                <select
                  value={editItemUnit}
                  onChange={(e) => setEditItemUnit(e.target.value)}
                  className="w-full h-10 sm:h-9 px-2.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md font-semibold"
                >
                  {(PURCHASING_UNITS.includes(editItemUnit)
                    ? PURCHASING_UNITS
                    : [editItemUnit, ...PURCHASING_UNITS]
                  ).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Estimasi Harga Satuan (Opsional)
              </label>
              <Input
                type="number"
                value={editItemPrice ?? ""}
                onChange={(e) =>
                  setEditItemPrice(e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Rp per satuan"
                className="text-xs h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Catatan Koreksi
              </label>
              <Input
                value={editItemNotes}
                onChange={(e) => setEditItemNotes(e.target.value)}
                placeholder="Mis: Stok supplier sisa 3 kg..."
                className="text-xs h-10 sm:h-9"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditPurchasingItem(null)}
              className="h-10 sm:h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!editPurchasingItem) return;
                if (!editItemName.trim() || editItemQty <= 0) {
                  toast.error("Nama barang dan jumlah (> 0) wajib valid.");
                  return;
                }
                updatePurchasingItemMutation.mutate(
                  {
                    itemId: editPurchasingItem.id,
                    data: {
                      item_name: editItemName.trim(),
                      qty: editItemQty,
                      unit: editItemUnit,
                      estimated_price: editItemPrice,
                      notes: editItemNotes.trim() || "-",
                    },
                  },
                  {
                    onSuccess: () => setEditPurchasingItem(null),
                  }
                );
              }}
              disabled={updatePurchasingItemMutation.isPending}
              className="h-10 sm:h-9 px-4 text-xs bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-xl"
            >
              {updatePurchasingItemMutation.isPending ? "Menyimpan..." : "Simpan Koreksi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Barang Tidak Ada / Batalkan */}
      <Dialog open={!!cancelPurchasingTarget} onOpenChange={(open) => !open && setCancelPurchasingTarget(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-700 dark:text-rose-400" /> Barang Tidak Ada / Batalkan
            </DialogTitle>
          </DialogHeader>

          {cancelPurchasingTarget && (
            <div className="py-2 space-y-3">
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
                <div className="font-bold text-zinc-900 dark:text-zinc-100">
                  {cancelPurchasingTarget.item_name}
                </div>
                <div className="text-zinc-600 dark:text-zinc-400 mt-0.5">
                  {cancelPurchasingTarget.qty} {cancelPurchasingTarget.unit}
                  {cancelPurchasingTarget.supplier_name && cancelPurchasingTarget.supplier_name !== "-"
                    ? ` • ${cancelPurchasingTarget.supplier_name}`
                    : ""}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Alasan Ketidaksediaan
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Stok supplier kosong",
                    "Barang tidak tersedia",
                    "Salah input staf",
                    "Diganti item lain",
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCancelPurchasingReason(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                        cancelPurchasingReason === preset
                          ? "border-rose-600 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                          : "border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <Input
                  value={cancelPurchasingReason}
                  onChange={(e) => setCancelPurchasingReason(e.target.value)}
                  placeholder="Tulis alasan singkat..."
                  className="text-xs h-10 sm:h-9 mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelPurchasingTarget(null)}
              className="h-10 sm:h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!cancelPurchasingTarget) return;
                cancelPurchasingItemMutation.mutate(
                  {
                    itemId: cancelPurchasingTarget.id,
                    reason: cancelPurchasingReason.trim() || "Barang tidak tersedia di supplier",
                  },
                  {
                    onSuccess: () => setCancelPurchasingTarget(null),
                  }
                );
              }}
              disabled={cancelPurchasingItemMutation.isPending}
              className="h-10 sm:h-9 px-4 text-xs bg-rose-700 hover:bg-rose-800 text-white font-semibold rounded-xl"
            >
              {cancelPurchasingItemMutation.isPending ? "Memproses..." : "Konfirmasi Tidak Ada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Tambah Barang Susulan */}
      <Dialog open={isAddPurchasingOpen} onOpenChange={setIsAddPurchasingOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-700 dark:text-amber-400" /> Tambah Barang Susulan
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div className="space-y-1 relative">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Nama Barang
              </label>
              <Input
                value={addItemName}
                onChange={(e) => {
                  setAddItemName(e.target.value);
                  setShowAddSuggestions(true);
                }}
                onFocus={() => setShowAddSuggestions(true)}
                onBlur={() => setTimeout(() => setShowAddSuggestions(false), 150)}
                placeholder="Ketik nama barang (Master Item atau barang baru)..."
                className="text-xs h-10 sm:h-9"
                autoFocus
              />
              {showAddSuggestions && addItemName.trim().length >= 1 && (
                (() => {
                  const q = addItemName.trim().toLowerCase();
                  const matches = itemSuggestions
                    .filter(
                      (s) =>
                        s.item_name.toLowerCase().includes(q) ||
                        (s.aliases && s.aliases.toLowerCase().includes(q))
                    )
                    .slice(0, 6);
                  if (matches.length === 0) return null;
                  return (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                      {matches.map((s) => (
                        <button
                          key={s.item_name}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setAddItemName(s.item_name);
                            if (s.satuan_beli) setAddItemUnit(s.satuan_beli);
                            if (s.category) setAddItemCategory(s.category);
                            if (s.last_unit_price > 0) setAddItemPrice(s.last_unit_price);
                            if (s.last_supplier && s.last_supplier !== "-" && !addItemSupplierId) {
                              const supMatch = suppliers.find(
                                (sup) => sup.name.toLowerCase() === s.last_supplier.toLowerCase()
                              );
                              if (supMatch) setAddItemSupplierId(supMatch.id);
                            }
                            setShowAddSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                              {s.item_name}
                            </div>
                            <div className="text-[10px] text-zinc-500 truncate">
                              {s.category} • {s.satuan_beli || "Pcs"}
                              {s.last_supplier && s.last_supplier !== "-" ? ` • ${s.last_supplier}` : ""}
                            </div>
                          </div>
                          {s.last_unit_price > 0 && (
                            <span className="text-[11px] font-semibold text-emerald-700 shrink-0 tabular-nums">
                              ~{formatRupiah(s.last_unit_price)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Jumlah (Qty)
                </label>
                <Input
                  type="number"
                  step="any"
                  min="0.1"
                  value={addItemQty}
                  onChange={(e) => setAddItemQty(parseFloat(e.target.value) || 1)}
                  className="text-xs h-10 sm:h-9 font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Satuan
                </label>
                <select
                  value={addItemUnit}
                  onChange={(e) => setAddItemUnit(e.target.value)}
                  className="w-full h-10 sm:h-9 px-2.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md font-semibold"
                >
                  {PURCHASING_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Kategori
                </label>
                <select
                  value={addItemCategory}
                  onChange={(e) => setAddItemCategory(e.target.value)}
                  className="w-full h-10 sm:h-9 px-2.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md font-semibold"
                >
                  {(categories.length > 0
                    ? categories
                    : ["Bahan Kue", "Bahan Minuman", "Kemasan", "Kebersihan", "Operasional"]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Supplier Terdaftar
                </label>
                <select
                  value={addItemSupplierId ?? ""}
                  onChange={(e) =>
                    setAddItemSupplierId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full h-10 sm:h-9 px-2.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md font-semibold"
                >
                  <option value="">Belum Ditentukan</option>
                  {suppliers.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Estimasi Harga Satuan (Opsional)
              </label>
              <Input
                type="number"
                value={addItemPrice ?? ""}
                onChange={(e) =>
                  setAddItemPrice(e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="Rp per satuan"
                className="text-xs h-10 sm:h-9"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Catatan (Opsional)
              </label>
              <Input
                value={addItemNotes}
                onChange={(e) => setAddItemNotes(e.target.value)}
                placeholder="Mis: Tambahan susulan dari dapur..."
                className="text-xs h-10 sm:h-9"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddPurchasingOpen(false)}
              className="h-10 sm:h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!addItemName.trim() || addItemQty <= 0) {
                  toast.error("Nama barang dan jumlah (> 0) wajib diisi.");
                  return;
                }
                addPurchasingItemMutation.mutate(
                  {
                    item_name: addItemName.trim(),
                    qty: addItemQty,
                    unit: addItemUnit,
                    category: addItemCategory,
                    supplier_id: addItemSupplierId,
                    estimated_price: addItemPrice,
                    notes: addItemNotes.trim() || "-",
                  },
                  {
                    onSuccess: () => setIsAddPurchasingOpen(false),
                  }
                );
              }}
              disabled={addPurchasingItemMutation.isPending}
              className="h-10 sm:h-9 px-4 text-xs bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-xl"
            >
              {addPurchasingItemMutation.isPending ? "Menyimpan..." : "Tambah ke Purchasing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
