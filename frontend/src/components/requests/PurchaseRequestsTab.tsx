import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPurchaseRequests,
  getPurchaseRequestStats,
  createPurchaseRequest,
  updatePurchaseRequest,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  fulfillPurchaseRequest,
  deletePurchaseRequest,
  getPurchasingOrders,
  assignPurchasingSupplier,
  generatePurchasingWhatsApp,
  markPurchasingOrdered,
  getWarehouseIncoming,
  receiveWarehouseItem,
  getSuppliers,
} from "@/lib/api";
import {
  PurchaseRequest,
  PurchaseRequestFormData,
  PurchaseRequestItem,
  PurchasingSupplierGroup,
  ItemSuggestion,
  WarehouseReceiveItemInput,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { PurchaseRequestDrawer } from "@/components/forms/PurchaseRequestDrawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ShoppingBag,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  Check,
  X,
  Trash2,
  Edit2,
  ShoppingBasket,
  ChevronRight,
  ChevronDown,
  User,
  Tag,
  Calendar,
  Copy,
  MessageCircle,
  Truck,
  PackageCheck,
  Store,
  Phone,
  MapPin,
  ExternalLink,
  Layers,
  Send,
  Sparkles,
} from "lucide-react";

interface PurchaseRequestsTabProps {
  categories?: string[];
  itemSuggestions?: ItemSuggestion[];
  isAdmin?: boolean;
  currentUser?: string;
  userRole?: string;
}

type MainTab = "staf" | "purchasing" | "gudang";

export const PurchaseRequestsTab: React.FC<PurchaseRequestsTabProps> = ({
  categories = [],
  itemSuggestions = [],
  isAdmin = true,
  currentUser = "",
  userRole = "admin",
}) => {
  const queryClient = useQueryClient();

  // Role booleans
  const isStaffRole = userRole === "staff";
  const isPurchasingRole = userRole === "purchasing";
  const isWarehouseRole = userRole === "warehouse";
  const isOwnerAdmin = !userRole || userRole === "admin";
  const isAdminInput = userRole === "admin_input";

  // Main 3 Workflow Tabs: Staf (Pengajuan), Purchasing (Pemesanan), Gudang (Penerimaan)
  const getDefaultTab = (role?: string): MainTab => {
    if (role === "purchasing") return "purchasing";
    if (role === "warehouse") return "gudang";
    return "staf";
  };

  const [activeMainTab, setActiveMainTab] = useState<MainTab>(() => getDefaultTab(userRole));

  React.useEffect(() => {
    if (userRole === "purchasing") setActiveMainTab("purchasing");
    else if (userRole === "warehouse") setActiveMainTab("gudang");
    else if (userRole === "staff" || userRole === "admin_input") setActiveMainTab("staf");
  }, [userRole]);

  React.useEffect(() => {
    if (isAdminInput && activeMainTab === "gudang") {
      setActiveMainTab("staf");
    }
  }, [isAdminInput, activeMainTab]);

  // Sub-filter for Staf Tab
  const [activeStatusTab, setActiveStatusTab] = useState<string>("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedRequests, setExpandedRequests] = useState<Record<number, boolean>>({});

  // Drawer / Form state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);

  // Reject Dialog state
  const [rejectDialogItem, setRejectDialogItem] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Purchasing Tab state
  const [whatsappModalData, setWhatsappModalData] = useState<{
    supplierName: string;
    supplierPhone?: string;
    text: string;
    items: PurchaseRequestItem[];
  } | null>(null);
  const [customOrderNote, setCustomOrderNote] = useState("");

  // Supplier Assign Dialog state
  const [assignDialogItem, setAssignDialogItem] = useState<PurchaseRequestItem | null>(null);
  const [assignSupplierName, setAssignSupplierName] = useState("");
  const [assignEstimatedPrice, setAssignEstimatedPrice] = useState<number | undefined>(undefined);

  // Warehouse Tab state
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [warehouseStatusFilter, setWarehouseStatusFilter] = useState<"ALL" | "PENDING" | "RECEIVED">("ALL");
  const [receiveDialogItem, setReceiveDialogItem] = useState<PurchaseRequestItem | null>(null);
  const [receiveQty, setReceiveQty] = useState<number>(0);
  const [receiveExpDate, setReceiveExpDate] = useState<string>("");
  const [receiveInspector, setReceiveInspector] = useState<string>(currentUser || "Staf Gudang");
  const [receiveNotes, setReceiveNotes] = useState<string>("");

  // ==========================================
  // QUERIES
  // ==========================================

  // 1. Staf requests query
  const { data: requestData, isLoading: isLoadingRequests } = useQuery({
    queryKey: ["purchase-requests", activeStatusTab, urgencyFilter, searchQuery],
    queryFn: () =>
      getPurchaseRequests({
        status: activeStatusTab === "ALL" ? undefined : activeStatusTab,
        urgency: urgencyFilter === "ALL" ? undefined : urgencyFilter,
        search: searchQuery || undefined,
        limit: 100,
      }),
  });

  const { data: statsData } = useQuery({
    queryKey: ["purchase-request-stats"],
    queryFn: getPurchaseRequestStats,
  });

  // 2. Purchasing orders query
  const { data: purchasingGroups, isLoading: isLoadingPurchasing } = useQuery({
    queryKey: ["purchasing-orders"],
    queryFn: getPurchasingOrders,
    enabled: activeMainTab === "purchasing",
  });

  // 3. Warehouse incoming query
  const { data: warehouseItems, isLoading: isLoadingWarehouse } = useQuery({
    queryKey: ["warehouse-incoming", warehouseSearch],
    queryFn: () => getWarehouseIncoming(warehouseSearch),
    enabled: activeMainTab === "gudang" && !isAdminInput,
  });

  // 4. Suppliers lookup query for quick assign
  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers-lookup"],
    queryFn: () => getSuppliers({ limit: 100, is_active: true }),
    staleTime: 60_000,
  });

  const requests = requestData?.items || [];
  const stats = statsData || requestData?.stats || {
    total: 0,
    pending: 0,
    approved: 0,
    ordered: 0,
    received: 0,
    fulfilled: 0,
    rejected: 0,
    urgent_pending: 0,
  };

  // Toggle accordion item
  const toggleRequestExpand = (id: number) => {
    setExpandedRequests((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ==========================================
  // MUTATIONS
  // ==========================================

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
    queryClient.invalidateQueries({ queryKey: ["purchasing-orders"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-incoming"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: PurchaseRequestFormData) => createPurchaseRequest(data),
    onSuccess: () => {
      invalidateAll();
      toast.success("Pengajuan belanja berhasil dikirim!");
      setIsDrawerOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal membuat pengajuan belanja");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PurchaseRequestFormData }) =>
      updatePurchaseRequest(id, data),
    onSuccess: () => {
      invalidateAll();
      toast.success("Pengajuan belanja berhasil diperbarui!");
      setIsDrawerOpen(false);
      setEditingRequest(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memperbarui pengajuan");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvePurchaseRequest(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Request belanja disetujui! Telah diteruskan ke menu Purchasing.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyetujui request");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      rejectPurchaseRequest(id, reason),
    onSuccess: () => {
      invalidateAll();
      toast.success("Request belanja telah ditolak.");
      setRejectDialogItem(null);
      setRejectReason("");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menolak request");
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: (id: number) => fulfillPurchaseRequest(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Belanjaan ditandai sudah terbeli!");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menandai belanjaan");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePurchaseRequest(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Request belanja berhasil dihapus.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menghapus request");
    },
  });

  // Purchasing: Mark Ordered Mutation
  const markOrderedMutation = useMutation({
    mutationFn: (itemIds: number[]) => markPurchasingOrdered(itemIds),
    onSuccess: (data) => {
      invalidateAll();
      toast.success(`${data.updated_count} item berhasil ditandai SUDAH DIPESAN (ORDERED).`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menandai item sudah dipesan");
    },
  });

  // Purchasing: Assign Supplier Mutation
  const assignSupplierMutation = useMutation({
    mutationFn: ({
      itemId,
      supplierName,
      estimatedPrice,
    }: {
      itemId: number;
      supplierName: string;
      estimatedPrice?: number;
    }) =>
      assignPurchasingSupplier(itemId, {
        supplier_name: supplierName,
        estimated_price: estimatedPrice,
      }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Supplier belanja berhasil disimpan!");
      setAssignDialogItem(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menetapkan supplier");
    },
  });

  // Warehouse: Receive Item Mutation
  const receiveItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: WarehouseReceiveItemInput }) =>
      receiveWarehouseItem(itemId, data),
    onSuccess: (item) => {
      invalidateAll();
      const statusText =
        item.receiving_status === "SESUAI"
          ? "✅ Jumlah Sesuai"
          : item.receiving_status === "KURANG"
          ? "⚠️ Jumlah Kurang"
          : "ℹ️ Jumlah Lebih";
      toast.success(`Barang ${item.item_name} berhasil diterima! (${statusText})`);
      setReceiveDialogItem(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mencatat penerimaan barang");
    },
  });

  // Handlers
  const handleDrawerSubmit = (data: PurchaseRequestFormData, requestId?: number) => {
    if (requestId) {
      updateMutation.mutate({ id: requestId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleConfirmReject = () => {
    if (!rejectDialogItem) return;
    rejectMutation.mutate({
      id: rejectDialogItem.id,
      reason: rejectReason.trim() || "Ditolak oleh admin",
    });
  };

  // Open WhatsApp Order Modal
  const handleOpenWhatsAppModal = async (group: PurchasingSupplierGroup) => {
    const itemIds = group.items.map((i) => i.id);
    try {
      const res = await generatePurchasingWhatsApp({
        supplier_name: group.supplier_name,
        item_ids: itemIds,
        custom_notes: customOrderNote,
      });
      setWhatsappModalData({
        supplierName: group.supplier_name,
        supplierPhone: group.supplier_phone,
        text: res.text,
        items: group.items,
      });
    } catch {
      // Fallback client-side template
      let text = `Halo ${group.supplier_name},\nKami dari Historycake Bakery ingin memesan bahan berikut:\n\n`;
      group.items.forEach((it, idx) => {
        text += `${idx + 1}. ${it.item_name} - ${it.qty} ${it.unit}\n`;
      });
      text += `\nMohon konfirmasi ketersediaan barang dan total harganya. Terima kasih! 🙏`;
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
    toast.success("Format pesanan WhatsApp berhasil disalin ke clipboard!");
  };

  // Open Warehouse Receive Dialog
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
      toast.error("Jumlah diterima harus lebih dari 0");
      return;
    }
    receiveItemMutation.mutate({
      itemId: receiveDialogItem.id,
      data: {
        qty_received: receiveQty,
        expired_date: receiveExpDate || undefined,
        received_by: receiveInspector.trim() || "Staf Gudang",
        receiving_notes: receiveNotes.trim() || "-",
      },
    });
  };

  // Filter warehouse items
  const filteredWarehouseItems = (warehouseItems || []).filter((item) => {
    if (warehouseStatusFilter === "PENDING") {
      return item.receiving_status === "PENDING";
    }
    if (warehouseStatusFilter === "RECEIVED") {
      return item.receiving_status !== "PENDING";
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* 1. Header Bar dengan Tab Navigasi 3 Peran */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Alur Request & Belanja Terpadu
            </h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Kolaborasi 3 peran: Staf mengajukan multi-item, Purchasing memesan ke Supplier via WA, dan Gudang memeriksa fisik & Exp Date.
          </p>
        </div>

        {activeMainTab === "staf" && (
          <Button
            onClick={() => {
              setEditingRequest(null);
              setIsDrawerOpen(true);
            }}
            className="h-10 px-4 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-md shadow-amber-500/20 flex items-center gap-2 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" /> Ajukan Belanja Baru
          </Button>
        )}
      </div>

      {/* 2. Three Main Operational Tabs (Staf, Purchasing, Gudang) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1.5 bg-zinc-100/90 dark:bg-zinc-950/80 rounded-2xl border border-zinc-200 dark:border-zinc-800">
        {/* Tab 1: Pengajuan (Staf) */}
        <button
          onClick={() => setActiveMainTab("staf")}
          className={`flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all ${
            activeMainTab === "staf"
              ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-800 font-bold"
              : "text-zinc-600 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-900/50 font-medium"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                activeMainTab === "staf"
                  ? "bg-amber-500 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold leading-tight">1. Pengajuan Belanja</div>
              <div className="text-[10px] text-zinc-400">Listing Kebutuhan Staf</div>
            </div>
          </div>
          {stats.pending > 0 && (
            <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] px-2 py-0.5">
              {stats.pending} Pending
            </Badge>
          )}
        </button>

        {/* Tab 2: Purchasing */}
        <button
          onClick={() => {
            if (isStaffRole || isWarehouseRole) {
              toast.info("Menu Purchasing khusus untuk bagian Purchasing atau Owner.");
              return;
            }
            setActiveMainTab("purchasing");
          }}
          className={`flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all ${
            activeMainTab === "purchasing"
              ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-800 font-bold"
              : "text-zinc-600 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-900/50 font-medium"
          } ${isStaffRole || isWarehouseRole ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                activeMainTab === "purchasing"
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              <ShoppingBasket className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold leading-tight">2. Bagian Purchasing</div>
              <div className="text-[10px] text-zinc-400">
                {isStaffRole || isWarehouseRole ? "Khusus Purchasing" : "Pemesanan & Format WA"}
              </div>
            </div>
          </div>
          {stats.approved > 0 && (
            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-2 py-0.5">
              {stats.approved} Siap Beli
            </Badge>
          )}
        </button>

        {/* Tab 3: Gudang */}
        {!isAdminInput && (
          <button
            onClick={() => {
              if (isStaffRole || isPurchasingRole) {
                toast.info("Menu Gudang khusus untuk petugas Gudang atau Owner.");
                return;
              }
              setActiveMainTab("gudang");
            }}
            className={`flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all ${
              activeMainTab === "gudang"
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-800 font-bold"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-900/50 font-medium"
            } ${isStaffRole || isPurchasingRole ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  activeMainTab === "gudang"
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                <PackageCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold leading-tight">3. Bagian Gudang</div>
                <div className="text-[10px] text-zinc-400">
                  {isStaffRole || isPurchasingRole ? "Khusus Gudang" : "Pemeriksaan & Exp Date"}
                </div>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-zinc-300 dark:border-zinc-700">
              Penerimaan Fisik
            </Badge>
          </button>
        )}
      </div>

      {/* ======================================================== */}
      {/* 3. WORKFLOW TAB 1: PENGAJUAN BELANJA (STAF)              */}
      {/* ======================================================== */}
      {activeMainTab === "staf" && (
        <div className="space-y-5">
          {/* Stat Cards Ringkas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <Card
              onClick={() => setActiveStatusTab("PENDING")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeStatusTab === "PENDING"
                  ? "border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 ring-1 ring-amber-500"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-amber-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Menunggu Approval</span>
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.pending}</span>
                {stats.urgent_pending > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    {stats.urgent_pending} Urgent
                  </Badge>
                )}
              </div>
            </Card>

            <Card
              onClick={() => setActiveStatusTab("APPROVED")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeStatusTab === "APPROVED"
                  ? "border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-500"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Siap Dibelanjakan</span>
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <ShoppingBasket className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.approved}</span>
                <span className="text-[11px] text-zinc-500 ml-1.5">Disetujui</span>
              </div>
            </Card>

            <Card
              onClick={() => setActiveStatusTab("ORDERED")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeStatusTab === "ORDERED"
                  ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 ring-1 ring-blue-500"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Dalam Pemesanan</span>
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center">
                  <Truck className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.ordered}</span>
                <span className="text-[11px] text-zinc-500 ml-1.5">Ordered</span>
              </div>
            </Card>

            <Card
              onClick={() => setActiveStatusTab("FULFILLED")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeStatusTab === "FULFILLED"
                  ? "border-zinc-600 bg-zinc-50/40 dark:bg-zinc-800/20 ring-1 ring-zinc-500"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Sudah Terbeli</span>
                <div className="w-7 h-7 rounded-lg bg-zinc-500/10 text-zinc-600 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.fulfilled}</span>
                <span className="text-[11px] text-zinc-500 ml-1.5">Selesai</span>
              </div>
            </Card>
          </div>

          {/* Filter Bar & Search */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
            {/* Status Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              {[
                { id: "ALL", label: "Semua" },
                { id: "PENDING", label: "Menunggu" },
                { id: "APPROVED", label: "Siap Beli" },
                { id: "ORDERED", label: "Dipesan" },
                { id: "RECEIVED", label: "Diterima" },
                { id: "FULFILLED", label: "Selesai" },
                { id: "REJECTED", label: "Ditolak" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveStatusTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                    activeStatusTab === tab.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search & Urgency */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 md:w-64">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-3 pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari barang / pemohon..."
                  className="pl-8 h-9 text-xs bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg"
                />
              </div>

              <select
                value={urgencyFilter}
                onChange={(e) => setUrgencyFilter(e.target.value)}
                className="h-9 px-2.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none text-zinc-700 dark:text-zinc-300"
              >
                <option value="ALL">Semua Urgensi</option>
                <option value="URGENT">🔴 Mendesak</option>
                <option value="NORMAL">🟢 Biasa</option>
              </select>
            </div>
          </div>

          {/* List Request Belanja (Multi-Item Accordion Cards) */}
          <div className="space-y-3">
            {isLoadingRequests ? (
              <div className="py-16 text-center text-zinc-400 text-xs">
                Memuat daftar request belanja...
              </div>
            ) : requests.length === 0 ? (
              <div className="py-16 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
                  <ShoppingBag className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Belum Ada Request Belanja
                </h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
                  {activeStatusTab !== "ALL" || searchQuery
                    ? "Tidak ada data yang cocok dengan filter yang dipilih."
                    : "Semua kebutuhan belanja toko sudah terpenuhi. Klik tombol di atas untuk membuat listing belanja baru."}
                </p>
              </div>
            ) : (
              requests.map((req) => {
                const isPending = req.status === "PENDING";
                const isApproved = req.status === "APPROVED";
                const isOrdered = req.status === "ORDERED" || req.status === "PARTIAL_ORDERED";
                const isReceived = req.status === "RECEIVED";
                const isFulfilled = req.status === "FULFILLED";
                const isRejected = req.status === "REJECTED";
                const isUrgent = req.urgency === "URGENT";
                const isExpanded = expandedRequests[req.id] ?? true;

                // Hitung total estimasi harga items
                const totalEstimated = req.items?.reduce(
                  (sum, it) => sum + (it.estimated_price ? it.estimated_price * it.qty : 0),
                  0
                );

                return (
                  <div
                    key={req.id}
                    className={`rounded-2xl border bg-white dark:bg-zinc-900 transition-all shadow-sm overflow-hidden ${
                      isUrgent && isPending
                        ? "border-rose-300 dark:border-rose-900/60 bg-rose-50/10 dark:bg-rose-950/10"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    {/* Header Request Card */}
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md">
                            {req.request_number || `#REQ-${req.id}`}
                          </span>
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {req.title || req.item_name || "Request Belanja"}
                          </h3>

                          {/* Urgency Badge */}
                          {isUrgent && (
                            <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider">
                              🔴 Mendesak
                            </Badge>
                          )}

                          {/* Status Badge */}
                          {isPending && (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
                              ⏳ Menunggu Approval
                            </Badge>
                          )}
                          {isApproved && (
                            <Badge className="bg-emerald-600 text-white text-[10px]">
                              ✅ Disetujui (Siap Dipesan)
                            </Badge>
                          )}
                          {isOrdered && (
                            <Badge className="bg-blue-600 text-white text-[10px]">
                              🚚 Sedang Dipesan
                            </Badge>
                          )}
                          {isReceived && (
                            <Badge className="bg-purple-600 text-white text-[10px]">
                              📦 Diterima Gudang
                            </Badge>
                          )}
                          {isFulfilled && (
                            <Badge className="bg-zinc-700 text-white text-[10px]">
                              🎉 Selesai
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge variant="outline" className="border-rose-300 text-rose-600 text-[10px]">
                              ❌ Ditolak
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-zinc-400" />
                            {req.requester_name || "Staf"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                            {formatDateId(req.request_date)}
                          </span>
                          <span className="flex items-center gap-1 font-semibold text-zinc-700 dark:text-zinc-300">
                            <Layers className="w-3.5 h-3.5 text-amber-500" />
                            {req.items?.length || 1} Item Belanja
                          </span>
                          {totalEstimated && totalEstimated > 0 ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Total Est: {formatRupiah(totalEstimated)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Header Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        {/* Approval buttons for Admin */}
                        {isPending && isAdmin && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => approveMutation.mutate(req.id)}
                              disabled={approveMutation.isPending}
                              className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1 font-semibold"
                            >
                              <Check className="w-3.5 h-3.5" /> Setujui
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRejectDialogItem(req);
                                setRejectReason("");
                              }}
                              className="h-8 px-3 text-xs text-rose-600 border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" /> Tolak
                            </Button>
                          </>
                        )}

                        {/* Quick switch to purchasing tab if approved */}
                        {isApproved && (
                          <Button
                            size="sm"
                            onClick={() => setActiveMainTab("purchasing")}
                            className="h-8 px-3 text-xs bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/20 rounded-lg flex items-center gap-1 font-semibold"
                          >
                            Pesan via Purchasing <ChevronRight className="w-3 h-3" />
                          </Button>
                        )}

                        {/* Edit & Delete for Pending */}
                        {isPending && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingRequest(req);
                              setIsDrawerOpen(true);
                            }}
                            className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Hapus request belanja ini?")) {
                              deleteMutation.mutate(req.id);
                            }
                          }}
                          className="h-8 w-8 p-0 text-zinc-400 hover:text-rose-600 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>

                        {/* Accordion toggle button */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleRequestExpand(req.id)}
                          className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-700 rounded-lg"
                        >
                          <ChevronDown
                            className={`w-4 h-4 transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </Button>
                      </div>
                    </div>

                    {/* Catatan Request jika ada */}
                    {req.notes && req.notes !== "-" && (
                      <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-600 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                        💬 <strong>Catatan Pengajuan:</strong> {req.notes}
                      </div>
                    )}

                    {/* Alasan Ditolak */}
                    {isRejected && req.reject_reason && (
                      <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-600 dark:text-rose-400 border-b border-rose-200 dark:border-rose-900/40">
                        ❌ <strong>Alasan Penolakan:</strong> {req.reject_reason}
                      </div>
                    )}

                    {/* Breakdown Daftar Item (Expandable) */}
                    {isExpanded && (
                      <div className="p-4 bg-zinc-50/50 dark:bg-zinc-950/40">
                        <div className="text-xs font-semibold text-zinc-500 mb-2.5 flex items-center justify-between">
                          <span>Daftar Barang Belanjaan:</span>
                          <span className="text-[11px] font-normal text-zinc-400">
                            Status Pemesanan & Penerimaan Fisik
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {req.items && req.items.length > 0 ? (
                            req.items.map((it) => (
                              <div
                                key={it.id}
                                className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs space-y-1.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                                      {it.item_name}
                                    </span>
                                    <span className="ml-2 font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded text-[11px]">
                                      {it.qty} {it.unit}
                                    </span>
                                  </div>

                                  {/* Item Status Badges */}
                                  <div className="flex flex-col items-end gap-1">
                                    {it.order_status === "ORDERED" ? (
                                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
                                        🚚 Dipesan
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                                        ⏳ Menunggu Order
                                      </span>
                                    )}

                                    {/* Receiving status */}
                                    {it.receiving_status === "SESUAI" && (
                                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
                                        ✅ Diterima Sesuai
                                      </span>
                                    )}
                                    {it.receiving_status === "KURANG" && (
                                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded">
                                        ⚠️ Kurang ({it.qty_received} {it.unit})
                                      </span>
                                    )}
                                    {it.receiving_status === "LEBIH" && (
                                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
                                        ℹ️ Lebih ({it.qty_received} {it.unit})
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                                  {it.supplier_name && it.supplier_name !== "-" && (
                                    <span className="flex items-center gap-1">
                                      <Store className="w-3 h-3 text-zinc-400" />
                                      {it.supplier_name}
                                    </span>
                                  )}
                                  {it.estimated_price && it.estimated_price > 0 && (
                                    <span>
                                      Est: {formatRupiah(it.estimated_price * it.qty)}
                                    </span>
                                  )}
                                  {it.expired_date && (
                                    <span className="text-purple-600 dark:text-purple-400 font-medium">
                                      Exp: {it.expired_date}
                                    </span>
                                  )}
                                </div>

                                {it.notes && it.notes !== "-" && (
                                  <div className="text-[11px] text-zinc-500 italic bg-zinc-50 dark:bg-zinc-950 p-1.5 rounded">
                                    Note: {it.notes}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-xs text-zinc-400">
                              {req.item_name} - {req.qty} {req.unit}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. WORKFLOW TAB 2: PURCHASING (PEMESANAN PER SUPPLIER)    */}
      {/* ======================================================== */}
      {activeMainTab === "purchasing" && (
        <div className="space-y-5">
          {/* Purchasing Info Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                <ShoppingBasket className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Panel Pemesanan Purchasing
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Semua barang belanja yang sudah disetujui otomatis dikelompokkan per Supplier. Salin teks pemesanan ke WhatsApp dengan 1 klik.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["purchasing-orders"] })}
                className="h-8 text-xs rounded-lg"
              >
                Refresh Order
              </Button>
            </div>
          </div>

          {/* Grouped Supplier Cards */}
          {isLoadingPurchasing ? (
            <div className="py-16 text-center text-zinc-400 text-xs">
              Memuat data kelompok supplier...
            </div>
          ) : !purchasingGroups || purchasingGroups.length === 0 ? (
            <div className="py-16 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Tidak Ada Pesanan Tertunda
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
                Semua barang yang disetujui sudah dipesan ke supplier, atau belum ada pengajuan belanja yang disetujui.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {purchasingGroups.map((group, groupIdx) => {
                const isUnassigned = group.supplier_name === "Belum Ditentukan";
                const pendingItems = group.items.filter((i) => i.order_status === "PENDING");
                const allGroupItemIds = group.items.map((i) => i.id);

                return (
                  <div
                    key={groupIdx}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
                  >
                    {/* Supplier Header */}
                    <div className="p-4 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200/80 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                            isUnassigned
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-emerald-500/10 text-emerald-600"
                          }`}
                        >
                          <Store className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                              {group.supplier_name}
                            </h3>
                            <Badge
                              className={`text-[10px] ${
                                isUnassigned
                                  ? "bg-amber-500 text-white"
                                  : "bg-emerald-600 text-white"
                              }`}
                            >
                              {group.total_items} Item
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-500 mt-0.5">
                            {group.supplier_phone && (
                              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                <Phone className="w-3 h-3" /> {group.supplier_phone}
                              </span>
                            )}
                            {group.supplier_address && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> {group.supplier_address}
                              </span>
                            )}
                            {isUnassigned && (
                              <span className="text-amber-600 text-xs font-semibold">
                                ⚠️ Perlu ditentukan supplier sebelum dipesan
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Purchasing Header Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        {!isUnassigned && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleOpenWhatsAppModal(group)}
                              className="h-8 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 shadow-sm"
                            >
                              <MessageCircle className="w-3.5 h-3.5" /> Salin Format WA / Email
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Tandai semua item untuk ${group.supplier_name} sebagai SUDAH DIPESAN (ORDERED)?`
                                  )
                                ) {
                                  markOrderedMutation.mutate(allGroupItemIds);
                                }
                              }}
                              disabled={markOrderedMutation.isPending || pendingItems.length === 0}
                              className="h-8 px-3 text-xs font-semibold text-blue-600 border-blue-200 dark:border-blue-900/60 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Tandai Sudah Dipesan
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Table / List Items for this Supplier */}
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {group.items.map((item) => {
                        const isOrdered = item.order_status === "ORDERED";

                        return (
                          <div
                            key={item.id}
                            className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                                  {item.item_name}
                                </span>
                                <Badge variant="outline" className="text-xs font-semibold">
                                  {item.qty} {item.unit}
                                </Badge>
                                {isOrdered ? (
                                  <Badge className="bg-blue-600 text-white text-[10px]">
                                    🚚 ORDERED
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
                                    ⏳ Belum Dipesan
                                  </Badge>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                                <span>Kategori: {item.category || "Bahan Kue"}</span>
                                {item.estimated_price && item.estimated_price > 0 && (
                                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                    Est: {formatRupiah(item.estimated_price * item.qty)}
                                  </span>
                                )}
                                {item.notes && item.notes !== "-" && (
                                  <span className="italic text-zinc-400">"{item.notes}"</span>
                                )}
                              </div>
                            </div>

                            {/* Item Actions */}
                            <div className="flex items-center gap-2 self-end sm:self-center">
                              {/* Ganti / Tentukan Supplier */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setAssignDialogItem(item);
                                  setAssignSupplierName(
                                    item.supplier_name && item.supplier_name !== "-"
                                      ? item.supplier_name
                                      : ""
                                  );
                                  setAssignEstimatedPrice(
                                    item.estimated_price ? Number(item.estimated_price) : undefined
                                  );
                                }}
                                className="h-8 px-2.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg flex items-center gap-1"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                {isUnassigned ? "Pilih Supplier" : "Ubah Supplier"}
                              </Button>

                              {/* Single item mark ordered */}
                              {!isOrdered && !isUnassigned && (
                                <Button
                                  size="sm"
                                  onClick={() => markOrderedMutation.mutate([item.id])}
                                  disabled={markOrderedMutation.isPending}
                                  className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 font-semibold"
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
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. WORKFLOW TAB 3: GUDANG (PENERIMAAN & EXP DATE)         */}
      {/* ======================================================== */}
      {activeMainTab === "gudang" && !isAdminInput && (
        <div className="space-y-5">
          {/* Warehouse Header Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <PackageCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Pemeriksaan Fisik Kedatangan Gudang
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Periksa barang yang tiba dari supplier: cek jumlah (sesuai, kurang, atau lebih), catat tanggal expired (Exp Date), dan simpan bukti terima.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["warehouse-incoming"] })}
              className="h-8 text-xs rounded-lg self-start sm:self-auto"
            >
              Refresh Daftar
            </Button>
          </div>

          {/* Search & Status Filter Gudang */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              {[
                { id: "ALL", label: "Semua Kedatangan" },
                { id: "PENDING", label: "Menunggu Pemeriksaan" },
                { id: "RECEIVED", label: "Sudah Diperiksa" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setWarehouseStatusFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    warehouseStatusFilter === f.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-3 pointer-events-none" />
              <Input
                value={warehouseSearch}
                onChange={(e) => setWarehouseSearch(e.target.value)}
                placeholder="Cari barang / supplier..."
                className="pl-8 h-9 text-xs bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg"
              />
            </div>
          </div>

          {/* Warehouse Items Table/Cards */}
          {isLoadingWarehouse ? (
            <div className="py-16 text-center text-zinc-400 text-xs">
              Memuat data kedatangan barang...
            </div>
          ) : filteredWarehouseItems.length === 0 ? (
            <div className="py-16 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
                <PackageCheck className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Tidak Ada Kedatangan Barang
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
                Semua pesanan yang tiba telah diperiksa gudang, atau belum ada pesanan yang berstatus ORDERED.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredWarehouseItems.map((item) => {
                const isChecked = item.receiving_status !== "PENDING";
                const isSesuai = item.receiving_status === "SESUAI";
                const isKurang = item.receiving_status === "KURANG";
                const isLebih = item.receiving_status === "LEBIH";

                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-2xl border bg-white dark:bg-zinc-900 shadow-sm transition-all space-y-3 ${
                      !isChecked
                        ? "border-blue-200 dark:border-blue-900/50 bg-blue-50/10 dark:bg-blue-950/10"
                        : isKurang
                        ? "border-amber-200 dark:border-amber-900/40 bg-amber-50/10"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {item.item_name}
                          </h4>
                          <Badge variant="outline" className="text-xs font-semibold">
                            Pesanan: {item.qty} {item.unit}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                          <Store className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Supplier: {item.supplier_name || "-"}</span>
                        </div>
                      </div>

                      {/* Status Kesesuaian Badge */}
                      <div>
                        {!isChecked ? (
                          <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">
                            📦 Menunggu Fisik
                          </Badge>
                        ) : isSesuai ? (
                          <Badge className="bg-emerald-600 text-white text-[10px]">
                            🟢 Sesuai ({item.qty_received} {item.unit})
                          </Badge>
                        ) : isKurang ? (
                          <Badge className="bg-amber-500 text-white text-[10px]">
                            🟡 Kurang ({item.qty_received} {item.unit})
                          </Badge>
                        ) : isLebih ? (
                          <Badge className="bg-blue-600 text-white text-[10px]">
                            🔵 Lebih ({item.qty_received} {item.unit})
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    {/* Exp Date & Received Info */}
                    <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-100 dark:border-zinc-800 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Tanggal Expired:</span>
                        {item.expired_date ? (
                          <span className="font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {item.expired_date}
                          </span>
                        ) : (
                          <span className="text-zinc-400 italic">Belum diinput</span>
                        )}
                      </div>

                      {isChecked && (
                        <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                          <span>Diperiksa oleh: {item.received_by || "Gudang"}</span>
                          {item.received_at && (
                            <span>{new Date(item.received_at).toLocaleDateString("id-ID")}</span>
                          )}
                        </div>
                      )}

                      {item.receiving_notes && item.receiving_notes !== "-" && (
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-400 italic pt-1">
                          📝 {item.receiving_notes}
                        </div>
                      )}
                    </div>

                    {/* Action Button */}
                    <div className="flex items-center justify-end pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleOpenReceiveDialog(item)}
                        className={`h-8 px-3 text-xs font-semibold rounded-lg flex items-center gap-1.5 ${
                          !isChecked
                            ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                            : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
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
        </div>
      )}

      {/* ======================================================== */}
      {/* 6. MODALS & DIALOGS                                      */}
      {/* ======================================================== */}

      {/* Drawer / Modal Form Request Belanja (Multi-Item) */}
      <PurchaseRequestDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingRequest(null);
        }}
        onSubmit={handleDrawerSubmit}
        initialData={editingRequest}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        itemSuggestions={itemSuggestions}
        categories={categories}
        currentUser={currentUser}
      />

      {/* Dialog Tolak Request */}
      <Dialog open={!!rejectDialogItem} onOpenChange={(open) => !open && setRejectDialogItem(null)}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-500" /> Tolak Request Belanja
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Apakah Anda yakin ingin menolak pengajuan belanja{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">
                "{rejectDialogItem?.title || rejectDialogItem?.item_name}"
              </strong>
              ? Berikan alasan singkat:
            </p>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Misal: Stok di gudang masih ada 3 sak..."
              className="text-xs h-10"
              autoFocus
            />
          </div>
          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectDialogItem(null)}
              className="h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmReject}
              disabled={rejectMutation.isPending}
              className="h-9 px-4 text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl"
            >
              {rejectMutation.isPending ? "Menolak..." : "Ya, Tolak Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Format WhatsApp / Email Purchasing */}
      <Dialog open={!!whatsappModalData} onOpenChange={(open) => !open && setWhatsappModalData(null)}>
        <DialogContent className="max-w-lg bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-500" /> Format WhatsApp Pemesanan Supplier
            </DialogTitle>
          </DialogHeader>

          {whatsappModalData && (
            <div className="py-2 space-y-3">
              <div className="text-xs text-zinc-500">
                Penerima: <strong className="text-zinc-900 dark:text-zinc-100">{whatsappModalData.supplierName}</strong>
                {whatsappModalData.supplierPhone && (
                  <span className="ml-2 font-mono text-emerald-600">({whatsappModalData.supplierPhone})</span>
                )}
              </div>

              {/* Teks preview kotak copy */}
              <div className="relative">
                <textarea
                  readOnly
                  value={whatsappModalData.text}
                  rows={9}
                  className="w-full text-xs font-mono p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none text-zinc-800 dark:text-zinc-200 resize-none"
                />
                <Button
                  size="sm"
                  onClick={() => handleCopyWhatsAppText(whatsappModalData.text)}
                  className="absolute right-2.5 top-2.5 h-7 px-2.5 text-[11px] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg flex items-center gap-1 shadow"
                >
                  <Copy className="w-3 h-3" /> Salin Teks
                </Button>
              </div>

              <p className="text-[11px] text-zinc-400">
                💡 Setelah menyalin teks atau membuka WhatsApp, jangan lupa klik <strong>"Tandai Sudah Dipesan"</strong> agar pesanan masuk ke antrean pemeriksaan gudang.
              </p>
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
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-9 px-3.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow"
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
                className="h-9 px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl"
              >
                Salin & Tutup
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Penetapan Supplier (Assign Supplier) */}
      <Dialog open={!!assignDialogItem} onOpenChange={(open) => !open && setAssignDialogItem(null)}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Store className="w-5 h-5 text-amber-500" /> Tentukan Supplier Barang
            </DialogTitle>
          </DialogHeader>

          {assignDialogItem && (
            <div className="py-2 space-y-4">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs">
                <div className="font-bold text-zinc-900 dark:text-zinc-100">
                  {assignDialogItem.item_name}
                </div>
                <div className="text-zinc-500 mt-0.5">
                  Jumlah: {assignDialogItem.qty} {assignDialogItem.unit}
                </div>
              </div>

              {/* Nama Supplier Input / Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Nama Supplier / Toko
                </label>
                <Input
                  value={assignSupplierName}
                  onChange={(e) => setAssignSupplierName(e.target.value)}
                  placeholder="Misal: Toko Makmur, Sumber Harum, Agen Telur..."
                  className="text-xs h-9"
                  autoFocus
                />
                {/* Suggestions pill */}
                {suppliersData?.items && suppliersData.items.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                    <span className="text-[10px] text-zinc-400">Pilih cepat:</span>
                    {suppliersData.items.slice(0, 5).map((sup) => (
                      <button
                        key={sup.id}
                        type="button"
                        onClick={() => setAssignSupplierName(sup.name)}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-zinc-700 dark:text-zinc-300 transition-colors"
                      >
                        {sup.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Estimasi Harga per Unit */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Estimasi Harga Satuan (Opsional)
                </label>
                <Input
                  type="number"
                  value={assignEstimatedPrice || ""}
                  onChange={(e) => setAssignEstimatedPrice(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Rp per satuan"
                  className="text-xs h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignDialogItem(null)}
              className="h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!assignDialogItem) return;
                if (!assignSupplierName.trim()) {
                  toast.error("Nama supplier tidak boleh kosong");
                  return;
                }
                assignSupplierMutation.mutate({
                  itemId: assignDialogItem.id,
                  supplierName: assignSupplierName.trim(),
                  estimatedPrice: assignEstimatedPrice,
                });
              }}
              disabled={assignSupplierMutation.isPending}
              className="h-9 px-4 text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl"
            >
              {assignSupplierMutation.isPending ? "Menyimpan..." : "Simpan Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Pemeriksaan Gudang & Exp Date */}
      <Dialog open={!!receiveDialogItem} onOpenChange={(open) => !open && setReceiveDialogItem(null)}>
        <DialogContent className="max-w-md bg-white dark:bg-zinc-950 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-blue-500" /> Pemeriksaan Fisik Barang Gudang
            </DialogTitle>
          </DialogHeader>

          {receiveDialogItem && (
            <div className="py-2 space-y-4">
              {/* Header Info Barang */}
              <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100">
                    {receiveDialogItem.item_name}
                  </span>
                  <Badge variant="outline" className="font-semibold text-blue-600 border-blue-200">
                    Dipesan: {receiveDialogItem.qty} {receiveDialogItem.unit}
                  </Badge>
                </div>
                <div className="text-zinc-500 text-[11px]">
                  Supplier: {receiveDialogItem.supplier_name || "-"}
                </div>
              </div>

              {/* Input Qty Diterima dengan Live Evaluation */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Jumlah Diterima ({receiveDialogItem.unit})
                  </label>
                  {/* Live Status Badge */}
                  {receiveQty > 0 && (
                    <div>
                      {receiveQty === receiveDialogItem.qty && (
                        <Badge className="bg-emerald-600 text-white text-[10px]">
                          🟢 Sesuai (Pas {receiveQty} {receiveDialogItem.unit})
                        </Badge>
                      )}
                      {receiveQty < receiveDialogItem.qty && (
                        <Badge className="bg-amber-500 text-white text-[10px]">
                          🟡 Kurang (Selisih {receiveDialogItem.qty - receiveQty} {receiveDialogItem.unit})
                        </Badge>
                      )}
                      {receiveQty > receiveDialogItem.qty && (
                        <Badge className="bg-blue-600 text-white text-[10px]">
                          🔵 Lebih (Selisih +{receiveQty - receiveDialogItem.qty} {receiveDialogItem.unit})
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
                    className="text-xs h-10 font-bold"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReceiveQty(receiveDialogItem.qty)}
                    className="h-10 text-xs px-3 font-semibold text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 shrink-0"
                  >
                    Pas ({receiveDialogItem.qty})
                  </Button>
                </div>
              </div>

              {/* Tanggal Kedaluwarsa (Expired Date) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-purple-500" />
                  Tanggal Kedaluwarsa (Exp Date)
                </label>
                <Input
                  type="date"
                  value={receiveExpDate}
                  onChange={(e) => setReceiveExpDate(e.target.value)}
                  className="text-xs h-10"
                />
                <span className="text-[10px] text-zinc-400">
                  Wajib diperhatikan untuk bahan baku kue & produk yang memiliki masa simpan.
                </span>
              </div>

              {/* Nama Pemeriksa */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Nama Petugas Gudang
                </label>
                <Input
                  value={receiveInspector}
                  onChange={(e) => setReceiveInspector(e.target.value)}
                  placeholder="Misal: Budi / Staf Gudang"
                  className="text-xs h-9"
                />
              </div>

              {/* Catatan Kondisi Barang */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Catatan Kondisi Fisik Barang
                </label>
                <Input
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  placeholder="Misal: Kemasan rapi, segel utuh, kardus bagus..."
                  className="text-xs h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReceiveDialogItem(null)}
              className="h-9 px-3 text-xs rounded-xl"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSubmitReceive}
              disabled={receiveItemMutation.isPending}
              className="h-9 px-4 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
            >
              {receiveItemMutation.isPending ? "Menyimpan..." : "Simpan Penerimaan Gudang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
