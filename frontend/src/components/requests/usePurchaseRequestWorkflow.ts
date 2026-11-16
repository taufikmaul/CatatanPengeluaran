import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  addPurchasingItem,
  updatePurchasingItem,
  cancelPurchasingItem,
  markPurchasingOrdered,
  getWarehouseIncoming,
  receiveWarehouseItem,
  getSuppliers,
} from "@/lib/api";
import {
  PurchaseRequestFormData,
  PurchasingItemCreateInput,
  PurchasingItemUpdateInput,
  WarehouseReceiveItemInput,
} from "@/types";

export interface UsePurchaseRequestWorkflowOptions {
  enableRequests?: boolean;
  enablePurchasing?: boolean;
  enableWarehouse?: boolean;
  enableSuppliers?: boolean;
  statusFilter?: string;
  urgencyFilter?: string;
  searchQuery?: string;
  warehouseSearch?: string;
}

export function usePurchaseRequestWorkflow(options: UsePurchaseRequestWorkflowOptions = {}) {
  const {
    enableRequests = false,
    enablePurchasing = false,
    enableWarehouse = false,
    enableSuppliers = false,
    statusFilter = "ALL",
    urgencyFilter = "ALL",
    searchQuery = "",
    warehouseSearch = "",
  } = options;

  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-requests"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-requests-recent"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-request-stats"] });
    queryClient.invalidateQueries({ queryKey: ["purchasing-orders"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-incoming"] });
  };

  const requestsQuery = useQuery({
    queryKey: ["purchase-requests", statusFilter, urgencyFilter, searchQuery],
    queryFn: () =>
      getPurchaseRequests({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        urgency: urgencyFilter === "ALL" ? undefined : urgencyFilter,
        search: searchQuery || undefined,
        limit: 100,
      }),
    enabled: enableRequests,
  });

  const statsQuery = useQuery({
    queryKey: ["purchase-request-stats"],
    queryFn: getPurchaseRequestStats,
  });

  const recentRequestsQuery = useQuery({
    queryKey: ["purchase-requests-recent"],
    queryFn: () => getPurchaseRequests({ limit: 5 }),
    staleTime: 60_000,
    enabled: enableRequests,
  });

  const purchasingQuery = useQuery({
    queryKey: ["purchasing-orders"],
    queryFn: getPurchasingOrders,
    enabled: enablePurchasing,
  });

  const warehouseQuery = useQuery({
    queryKey: ["warehouse-incoming", warehouseSearch],
    queryFn: () => getWarehouseIncoming(warehouseSearch),
    enabled: enableWarehouse,
  });

  const suppliersQuery = useQuery({
    queryKey: ["suppliers-lookup"],
    queryFn: () => getSuppliers({ limit: 200, is_active: true }),
    staleTime: 60_000,
    enabled: enableSuppliers,
  });

  const createMutation = useMutation({
    mutationFn: (data: PurchaseRequestFormData) => createPurchaseRequest(data),
    onSuccess: () => {
      invalidateAll();
      toast.success("Pengajuan belanja berhasil dikirim!");
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
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memperbarui pengajuan");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvePurchaseRequest(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Request belanja disetujui dan diteruskan ke Purchasing.");
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
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menolak request");
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: (id: number) => fulfillPurchaseRequest(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Belanjaan ditandai selesai!");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menandai selesai");
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

  const markOrderedMutation = useMutation({
    mutationFn: (itemIds: number[]) => markPurchasingOrdered(itemIds),
    onSuccess: (data) => {
      invalidateAll();
      toast.success(`${data.updated_count} item ditandai sudah dipesan (ORDERED).`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menandai item sudah dipesan");
    },
  });

  const assignSupplierMutation = useMutation({
    mutationFn: ({
      itemId,
      supplierId,
      supplierName,
      estimatedPrice,
    }: {
      itemId: number;
      supplierId: number;
      supplierName: string;
      estimatedPrice?: number;
    }) =>
      assignPurchasingSupplier(itemId, {
        supplier_id: supplierId,
        supplier_name: supplierName,
        estimated_price: estimatedPrice,
      }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Supplier terdaftar berhasil ditetapkan!");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menetapkan supplier");
    },
  });

  const updatePurchasingItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: PurchasingItemUpdateInput }) =>
      updatePurchasingItem(itemId, data),
    onSuccess: () => {
      invalidateAll();
      toast.success("Koreksi barang berhasil disimpan.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan koreksi barang");
    },
  });

  const cancelPurchasingItemMutation = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: number; reason: string }) =>
      cancelPurchasingItem(itemId, reason),
    onSuccess: () => {
      invalidateAll();
      toast.success("Barang ditandai tidak ada dan dikeluarkan dari antrean order.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal membatalkan item");
    },
  });

  const addPurchasingItemMutation = useMutation({
    mutationFn: (data: PurchasingItemCreateInput) => addPurchasingItem(data),
    onSuccess: () => {
      invalidateAll();
      toast.success("Barang susulan berhasil ditambahkan ke antrean Purchasing.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menambahkan barang susulan");
    },
  });

  const receiveItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: WarehouseReceiveItemInput }) =>
      receiveWarehouseItem(itemId, data),
    onSuccess: (item) => {
      invalidateAll();
      const statusText =
        item.receiving_status === "SESUAI"
          ? "Jumlah Sesuai"
          : item.receiving_status === "KURANG"
          ? "Jumlah Kurang"
          : "Jumlah Lebih";
      toast.success(`Barang ${item.item_name} berhasil diterima (${statusText}).`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mencatat penerimaan barang");
    },
  });

  const stats = statsQuery.data || requestsQuery.data?.stats || {
    total: 0,
    pending: 0,
    approved: 0,
    ordered: 0,
    received: 0,
    fulfilled: 0,
    rejected: 0,
    urgent_pending: 0,
  };

  return {
    queryClient,
    invalidateAll,
    requests: requestsQuery.data?.items || [],
    isLoadingRequests: requestsQuery.isLoading,
    isErrorRequests: requestsQuery.isError,
    recentRequests: recentRequestsQuery.data?.items || requestsQuery.data?.items || [],
    stats,
    purchasingGroups: purchasingQuery.data || [],
    isLoadingPurchasing: purchasingQuery.isLoading,
    isErrorPurchasing: purchasingQuery.isError,
    warehouseItems: warehouseQuery.data || [],
    isLoadingWarehouse: warehouseQuery.isLoading,
    isErrorWarehouse: warehouseQuery.isError,
    suppliers: suppliersQuery.data?.items || [],
    createMutation,
    updateMutation,
    approveMutation,
    rejectMutation,
    fulfillMutation,
    deleteMutation,
    markOrderedMutation,
    assignSupplierMutation,
    updatePurchasingItemMutation,
    cancelPurchasingItemMutation,
    addPurchasingItemMutation,
    receiveItemMutation,
  };
}
