import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSupplierById,
  updateSupplier,
  deleteSupplier,
  getSupplierExpenses,
  getSupplierTopItems,
  getSupplierPriciestItems,
  createSupplierExpense,
  deleteSupplierExpense,
  updateSupplierExpensePayStatus,
} from "@/lib/api";
import {
  SupplierDetail,
  SupplierTopItem,
  SupplierPriciestItem,
  Expense,
  ExpenseFormData,
} from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DataGrid,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Filters } from "@/components/reui/filters/filters";
import type { FilterField, FilterQuery, FilterNode } from "@/components/reui/filters/filters-types";
import { createFilterQuery, createFilterRule, isFilterRule } from "@/components/reui/filters/filters-query";
import { ColumnDef, useTable, PaginationState } from "@tanstack/react-table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Store,
  Phone,
  MapPin,
  Tag,
  FileText,
  Calendar,
  DollarSign,
  ShoppingBag,
  TrendingUp,
  Award,
  Sparkles,
  Plus,
  Trash2,
  Edit3,
  Search,
  Filter,
  CheckCircle2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  GitMerge,
  CreditCard,
  AlertCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { SupplierItemAuditDialog } from "./SupplierItemAuditDialog";

interface SupplierDetailPageProps {
  supplierId: number;
  onBack: () => void;
  canDelete: boolean;
  categories: string[];
  paymentMethods?: string[];
  units?: string[];
}

export const SupplierDetailPage: React.FC<SupplierDetailPageProps> = ({
  supplierId,
  onBack,
  canDelete,
  categories,
  paymentMethods = ["Tunai", "Transfer", "QRIS", "Debit", "Kredit"],
  units = ["Pcs", "Box", "Pouch", "Kg", "Dus", "Kaleng", "Pack", "Sak", "Bal", "Botol", "Tray", "Liter", "Gram"],
}) => {
  const queryClient = useQueryClient();

  // State filter & pagination riwayat
  const [page, setPage] = useState(1);
  const [searchCategory, setSearchCategory] = useState("");
  const [searchPayStatus, setSearchPayStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Modal edit supplier
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  // Modal audit duplikat item toko
  const [isItemAuditOpen, setIsItemAuditOpen] = useState(false);

  // Modal tambah catatan belanja
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newQty, setNewQty] = useState<number>(1);
  const [newUnit, setNewUnit] = useState("Pcs");
  const [newUnitPrice, setNewUnitPrice] = useState<number>(0);
  const [newTotalPrice, setNewTotalPrice] = useState<number>(0);
  const [newCategory, setNewCategory] = useState(categories[0] || "Operasional");
  const [newPayMethod, setNewPayMethod] = useState("Tunai");
  const [newPayStatus, setNewPayStatus] = useState("Lunas");
  const [newInvoiceNumber, setNewInvoiceNumber] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newExpenseDate, setNewExpenseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [newNotes, setNewNotes] = useState("");

  // Query Detail Supplier
  const {
    data: supplier,
    isLoading: isSupplierLoading,
    refetch: refetchSupplier,
  } = useQuery<SupplierDetail>({
    queryKey: ["supplier", supplierId],
    queryFn: () => getSupplierById(supplierId),
  });

  // Query Top Items
  const { data: topItems = [], isLoading: isTopLoading } = useQuery<
    SupplierTopItem[]
  >({
    queryKey: ["supplier-top-items", supplierId],
    queryFn: () => getSupplierTopItems(supplierId, 8),
  });

  // Query Priciest Items
  const { data: priciestItems = [], isLoading: isPriciestLoading } = useQuery<
    SupplierPriciestItem[]
  >({
    queryKey: ["supplier-priciest-items", supplierId],
    queryFn: () => getSupplierPriciestItems(supplierId, 8),
  });

  // Query History Belanja
  const {
    data: expenseData,
    isLoading: isExpensesLoading,
    refetch: refetchExpenses,
  } = useQuery({
    queryKey: [
      "supplier-expenses",
      supplierId,
      page,
      searchCategory,
      searchPayStatus,
      startDate,
      endDate,
    ],
    queryFn: () =>
      getSupplierExpenses(supplierId, {
        category: searchCategory || undefined,
        pay_status: searchPayStatus || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page,
        limit: 15,
      }),
  });

  // Mutations
  const updatePayStatusMutation = useMutation({
    mutationFn: ({
      expenseId,
      payStatus,
    }: {
      expenseId: number;
      payStatus: string;
    }) => updateSupplierExpensePayStatus(supplierId, expenseId, payStatus),
    onSuccess: () => {
      toast.success("Status pembayaran tagihan berhasil diubah.");
      refetchSupplier();
      refetchExpenses();
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mengubah status tagihan.");
    },
  });
  const updateMutation = useMutation({
    mutationFn: (payload: any) => updateSupplier(supplierId, payload),
    onSuccess: () => {
      toast.success("Informasi toko berhasil diperbarui.");
      setIsEditOpen(false);
      refetchSupplier();
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui toko.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSupplier(supplierId),
    onSuccess: () => {
      toast.success("Supplier berhasil dihapus.");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      onBack();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus supplier.");
    },
  });

  const addExpenseMutation = useMutation({
    mutationFn: (payload: ExpenseFormData) =>
      createSupplierExpense(supplierId, payload),
    onSuccess: () => {
      toast.success("Catatan belanja berhasil ditambahkan.");
      setIsAddExpenseOpen(false);
      resetExpenseForm();
      refetchExpenses();
      refetchSupplier();
      queryClient.invalidateQueries({ queryKey: ["supplier-top-items", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menambah catatan belanja.");
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (expenseId: number) => deleteSupplierExpense(supplierId, expenseId),
    onSuccess: () => {
      toast.success("Catatan belanja berhasil dihapus.");
      refetchExpenses();
      refetchSupplier();
      queryClient.invalidateQueries({ queryKey: ["supplier-top-items", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus catatan.");
    },
  });

  const openEditModal = () => {
    if (!supplier) return;
    setEditName(supplier.name);
    setEditPhone(supplier.phone || "");
    setEditAddress(supplier.address || "");
    setEditAliases(supplier.aliases || "");
    setEditNotes(supplier.notes || "");
    setEditIsActive(supplier.is_active);
    setIsEditOpen(true);
  };

  const resetExpenseForm = () => {
    setNewItemName("");
    setNewQty(1);
    setNewUnit("Pcs");
    setNewUnitPrice(0);
    setNewTotalPrice(0);
    setNewCategory(categories[0] || "Operasional");
    setNewPayMethod("Tunai");
    setNewPayStatus("Lunas");
    setNewInvoiceNumber("");
    setNewDueDate("");
    setNewExpenseDate(new Date().toISOString().split("T")[0]);
    setNewNotes("");
  };

  const handleUnitPriceChange = (price: number) => {
    setNewUnitPrice(price);
    setNewTotalPrice(price * newQty);
  };

  const handleQtyChange = (qty: number) => {
    setNewQty(qty);
    setNewTotalPrice(newUnitPrice * qty);
  };

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) {
      toast.error("Nama barang wajib diisi.");
      return;
    }
    const total = newTotalPrice > 0 ? newTotalPrice : newUnitPrice * newQty;
    addExpenseMutation.mutate({
      expense_date: newExpenseDate,
      supplier: supplier?.name || "",
      supplier_id: supplierId,
      item_name: newItemName.trim(),
      qty: newQty,
      unit: newUnit,
      unit_price: newUnitPrice,
      total_price: total,
      tax: 0,
      discount: 0,
      category: newCategory,
      pay_method: newPayMethod,
      pay_status: newPayStatus,
      invoice_number: newInvoiceNumber.trim() || "-",
      due_date: newPayStatus !== "Lunas" && newDueDate ? newDueDate : "-",
      notes: newNotes.trim() || "-",
    });
  };

  const supplierExpenseFilterFields = useMemo<FilterField[]>(
    () => [
      {
        id: "category",
        label: "Kategori",
        type: "select",
        options: categories.map((c) => ({ label: c, value: c })),
      },
      {
        id: "pay_status",
        label: "Status Bayar",
        type: "select",
        options: [
          { label: "Semua Status", value: "" },
          { label: "Belum Lunas / Tempo", value: "unpaid" },
          { label: "Lunas", value: "Lunas" },
        ],
      },
      {
        id: "start_date",
        label: "Dari Tanggal (YYYY-MM-DD)",
        type: "text",
      },
      {
        id: "end_date",
        label: "Sampai Tanggal (YYYY-MM-DD)",
        type: "text",
      },
    ],
    [categories]
  );

  const supplierExpenseFilterQuery = useMemo(() => {
    const rules = [];
    if (searchCategory) {
      rules.push(createFilterRule({ id: "rule-cat", path: ["category"], operator: "is", value: searchCategory }));
    }
    if (searchPayStatus) {
      rules.push(createFilterRule({ id: "rule-pay-status", path: ["pay_status"], operator: "is", value: searchPayStatus }));
    }
    if (startDate) {
      rules.push(createFilterRule({ id: "rule-start", path: ["start_date"], operator: "is", value: startDate }));
    }
    if (endDate) {
      rules.push(createFilterRule({ id: "rule-end", path: ["end_date"], operator: "is", value: endDate }));
    }
    return createFilterQuery(rules, "and");
  }, [searchCategory, searchPayStatus, startDate, endDate]);

  const handleSupplierExpenseQueryChange = (nextQuery: FilterQuery) => {
    let nextCat = "";
    let nextPay = "";
    let nextStart = "";
    let nextEnd = "";
    const traverse = (nodes: FilterNode[]) => {
      for (const node of nodes) {
        if (isFilterRule(node)) {
          if (node.path[0] === "category") nextCat = String(node.value ?? "");
          if (node.path[0] === "pay_status") nextPay = String(node.value ?? "");
          if (node.path[0] === "start_date") nextStart = String(node.value ?? "");
          if (node.path[0] === "end_date") nextEnd = String(node.value ?? "");
        } else if (node.rules) {
          traverse(node.rules);
        }
      }
    };
    if (nextQuery?.rules) traverse(nextQuery.rules);
    setSearchCategory(nextCat);
    setSearchPayStatus(nextPay);
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setPage(1);
  };

  const supplierExpenseColumns = useMemo<ColumnDef<DataGridFeatures, Expense>[]>(
    () => {
      const cols: ColumnDef<DataGridFeatures, Expense>[] = [
        {
          accessorKey: "expense_date",
          id: "expense_date",
          header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
          cell: ({ row }) => (
            <span className="whitespace-nowrap text-slate-600 dark:text-slate-400">
              {formatDateId(row.original.expense_date)}
            </span>
          ),
          size: 110,
        },
        {
          accessorKey: "item_name",
          id: "item_name",
          header: ({ column }) => <DataGridColumnHeader title="Nama Barang" column={column} />,
          cell: ({ row }) => {
            const exp = row.original;
            return (
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {exp.item_name}
                </span>
                {exp.notes && exp.notes !== "-" && (
                  <span className="block text-[10px] font-normal text-slate-400">
                    {exp.notes}
                  </span>
                )}
              </div>
            );
          },
          size: 200,
        },
        {
          accessorKey: "category",
          id: "category",
          header: () => <span>Kategori</span>,
          cell: ({ row }) => (
            <Badge variant="outline" className="text-[10px] font-normal">
              {row.original.category}
            </Badge>
          ),
          size: 120,
        },
        {
          id: "qty",
          header: () => <div className="text-right">Qty</div>,
          cell: ({ row }) => {
            const exp = row.original;
            return (
              <div className="text-right tabular-nums">
                {exp.qty} {exp.unit || "Pcs"}
              </div>
            );
          },
          size: 90,
        },
        {
          accessorKey: "unit_price",
          id: "unit_price",
          header: () => <div className="text-right">Harga Satuan</div>,
          cell: ({ row }) => (
            <div className="text-right tabular-nums text-slate-600 dark:text-slate-400">
              {formatRupiah(row.original.unit_price)}
            </div>
          ),
          size: 110,
        },
        {
          accessorKey: "total_price",
          id: "total_price",
          header: () => <div className="text-right">Total</div>,
          cell: ({ row }) => (
            <div className="text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {formatRupiah(row.original.total_price)}
            </div>
          ),
          size: 120,
        },
        {
          accessorKey: "pay_method",
          id: "pay_method",
          header: () => <span>Metode</span>,
          cell: ({ row }) => (
            <span className="text-slate-600 dark:text-slate-400">
              {row.original.pay_method}
            </span>
          ),
          size: 90,
        },
        {
          accessorKey: "pay_status",
          id: "pay_status",
          header: () => <span>Status Bayar</span>,
          cell: ({ row }) => {
            const exp = row.original;
            const isLunas = exp.pay_status?.toLowerCase() === "lunas";
            return (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <Badge
                  variant={isLunas ? "default" : "destructive"}
                  className={
                    isLunas
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 text-[10px]"
                      : "text-[10px]"
                  }
                >
                  {exp.pay_status}
                </Badge>
                {!isLunas && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          `Tandai transaksi '${exp.item_name}' (${formatRupiah(
                            exp.total_price
                          )}) sebagai Lunas?`
                        )
                      ) {
                        updatePayStatusMutation.mutate({
                          expenseId: exp.id,
                          payStatus: "Lunas",
                        });
                      }
                    }}
                    className="h-6 px-1.5 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded font-medium gap-0.5"
                    title="Tandai lunas"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Lunas
                  </Button>
                )}
              </div>
            );
          },
          size: 140,
        },
      ];

      if (canDelete) {
        cols.push({
          id: "actions",
          header: () => <div className="text-right">Aksi</div>,
          cell: ({ row }) => {
            const exp = row.original;
            return (
              <div className="flex items-center justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Hapus catatan belanja '${exp.item_name}'?`)) {
                      deleteExpenseMutation.mutate(exp.id);
                    }
                  }}
                  className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  title="Hapus transaksi"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          },
          size: 60,
        });
      }

      return cols;
    },
    [canDelete, deleteExpenseMutation, updatePayStatusMutation]
  );

  const supplierExpensePagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: 15,
    }),
    [page]
  );

  const supplierExpenseTable = useTable({
    features: dataGridFeatures,
    columns: supplierExpenseColumns,
    data: expenseData?.data ?? [],
    manualPagination: true,
    rowCount: expenseData?.total ?? 0,
    getRowId: (row: Expense) => String(row.id),
    state: {
      pagination: supplierExpensePagination,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(supplierExpensePagination) : updater;
      setPage(next.pageIndex + 1);
    },
  });

  if (isSupplierLoading) {
    return (
      <div className="py-24 text-center text-slate-500 text-sm">
        Memuat detail toko...
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="py-24 text-center space-y-3">
        <Store className="w-10 h-10 mx-auto text-slate-400" />
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">
          Supplier Tidak Ditemukan
        </h3>
        <Button variant="outline" size="sm" onClick={onBack}>
          Kembali ke Daftar
        </Button>
      </div>
    );
  }

  // Cari max frekuensi untuk bar perbandingan
  const maxPurchaseCount = topItems.length > 0 ? Math.max(...topItems.map((i) => i.purchase_count)) : 1;

  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-9 px-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </Button>

          <div className="h-4 w-px bg-slate-200 dark:border-slate-800" />

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {supplier.name}
              </h1>
              <Badge
                variant={supplier.is_active ? "default" : "secondary"}
                className={
                  supplier.is_active
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 text-[10px]"
                    : "text-[10px]"
                }
              >
                {supplier.is_active ? "Aktif" : "Nonaktif"}
              </Badge>
            </div>
            {supplier.aliases && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Alias: {supplier.aliases}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openEditModal}
            className="h-9 rounded-xl gap-1.5 text-xs font-medium"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit Info Toko
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsItemAuditOpen(true)}
            className="h-9 rounded-xl gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40 border-amber-200 dark:border-amber-800 shadow-sm"
          >
            <GitMerge className="w-3.5 h-3.5" />
            Audit Item Toko
          </Button>

          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (
                  confirm(
                    `Hapus supplier '${supplier.name}'? Seluruh riwayat transaksi belanja tetap tersimpan di database.`
                  )
                ) {
                  deleteMutation.mutate();
                }
              }}
              className="h-9 rounded-xl gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 dark:border-rose-900/50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => setIsAddExpenseOpen(true)}
            className="h-9 rounded-xl gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Tambah Belanja
          </Button>
        </div>
      </div>

      {/* Info Kontak & Catatan */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex items-start gap-3">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 shrink-0">
            <Phone className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Nomor Telepon / WhatsApp
            </span>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate mt-0.5">
              {supplier.phone || "-"}
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex items-start gap-3">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Alamat Toko
            </span>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate mt-0.5">
              {supplier.address || "-"}
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex items-start gap-3">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Catatan Khusus
            </span>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate mt-0.5">
              {supplier.notes || "-"}
            </p>
          </div>
        </div>
      </div>

      {/* Ringkasan Statistik Lifetime */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Belanja (Lifetime)
          </span>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {formatRupiah(supplier.total_spent)}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Frekuensi Belanja
          </span>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {supplier.transaction_count}{" "}
            <span className="text-xs font-normal text-slate-500">transaksi</span>
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Rata-rata per Nota
          </span>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {formatRupiah(supplier.avg_per_transaction)}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Terakhir Belanja
          </span>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1">
            {supplier.last_expense_date
              ? formatDateId(supplier.last_expense_date)
              : "-"}
          </p>
        </div>

        <div
          className={`p-4 rounded-2xl border shadow-sm space-y-1 ${
            (supplier.unpaid_bills_count || 0) > 0
              ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50"
              : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Tagihan Belum Lunas
            </span>
            {(supplier.unpaid_bills_count || 0) > 0 ? (
              <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">
                {supplier.unpaid_bills_count} Nota
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 h-4 text-emerald-600 dark:text-emerald-400 border-emerald-200"
              >
                Lunas
              </Badge>
            )}
          </div>
          <p
            className={`text-lg font-bold tabular-nums ${
              (supplier.unpaid_bills_count || 0) > 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-slate-900 dark:text-slate-100"
            }`}
          >
            {formatRupiah(supplier.unpaid_bills_total || 0)}
          </p>
          <span className="text-[10px] text-slate-400 block truncate">
            {(supplier.unpaid_bills_count || 0) > 0
              ? "Perlu pembayaran segera"
              : "Tidak ada tagihan tertunda"}
          </span>
        </div>
      </div>

      {/* Section Tagihan Belum Lunas */}
      {supplier.unpaid_bills && supplier.unpaid_bills.length > 0 && (
        <div className="p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300 shrink-0">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Daftar Tagihan Supplier Belum Lunas
                  </h3>
                  <Badge variant="destructive" className="text-[10px]">
                    {supplier.unpaid_bills.length} Tagihan Aktif
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Total kewajiban pembayaran yang belum diselesaikan:{" "}
                  <span className="font-bold text-rose-600 dark:text-rose-400">
                    {formatRupiah(supplier.unpaid_bills_total)}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-amber-200/80 dark:border-amber-900/40 bg-white dark:bg-slate-900 shadow-xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Tanggal Belanja</th>
                  <th className="py-2.5 px-3">Nama Barang</th>
                  <th className="py-2.5 px-3">No. Invoice / Nota</th>
                  <th className="py-2.5 px-3">Jatuh Tempo</th>
                  <th className="py-2.5 px-3 text-right">Nominal Tagihan</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Aksi Cepat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {supplier.unpaid_bills.map((bill) => (
                  <tr
                    key={bill.id}
                    className="hover:bg-amber-50/30 dark:hover:bg-amber-950/10 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatDateId(bill.expense_date)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                        {bill.item_name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {bill.category}{" "}
                        {bill.notes && bill.notes !== "-" ? `• ${bill.notes}` : ""}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {bill.invoice_number && bill.invoice_number !== "-"
                        ? bill.invoice_number
                        : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {bill.due_date && bill.due_date !== "-"
                        ? formatDateId(bill.due_date)
                        : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                      {formatRupiah(bill.total_price)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge
                        variant="outline"
                        className="text-[10px] text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        {bill.pay_status}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatePayStatusMutation.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Tandai tagihan '${bill.item_name}' (${formatRupiah(
                                bill.total_price
                              )}) sebagai Lunas?`
                            )
                          ) {
                            updatePayStatusMutation.mutate({
                              expenseId: bill.id,
                              payStatus: "Lunas",
                            });
                          }
                        }}
                        className="h-7 px-2.5 text-[11px] font-semibold text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-950/50 gap-1 rounded-lg shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Tandai Lunas
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grid: Top Item Sering Dibeli & Item Paling Mahal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Top Item Sering Dibeli */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Item Paling Sering Dibeli
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Berdasarkan frekuensi transaksi di toko ini
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                Top {topItems.length}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsItemAuditOpen(true)}
                className="h-6 px-2 text-[10px] text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg gap-1 font-medium"
                title="Pindai item duplikat toko ini"
              >
                <GitMerge className="w-3 h-3" />
                Audit Duplikat
              </Button>
            </div>
          </div>

          {isTopLoading ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Memuat data...
            </div>
          ) : topItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Belum ada riwayat pembelian barang di toko ini.
            </div>
          ) : (
            <div className="space-y-3">
              {topItems.map((item, idx) => {
                const pct = Math.round((item.purchase_count / maxPurchaseCount) * 100);
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {item.item_name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1.5 py-0 shrink-0"
                        >
                          {item.category}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {item.purchase_count}x
                        </span>{" "}
                        <span className="text-[10px] text-slate-500">
                          ({item.total_qty} {item.unit})
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar Frekuensi */}
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Total Belanja: {formatRupiah(item.total_spent)}</span>
                      <span>Proporsi: {pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card 2: Item Paling Mahal */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Item Paling Mahal
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Berdasarkan harga satuan tertinggi yang pernah dicatat
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">
              Tertinggi
            </Badge>
          </div>

          {isPriciestLoading ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Memuat data...
            </div>
          ) : priciestItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Belum ada riwayat harga di toko ini.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {priciestItems.map((item, idx) => (
                <div
                  key={idx}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                      {item.item_name}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span>{item.category}</span>
                      {item.last_purchase_date && (
                        <>
                          <span>•</span>
                          <span>Tercatat: {formatDateId(item.last_purchase_date)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-bold text-rose-600 dark:text-rose-400 text-sm">
                      {formatRupiah(item.max_unit_price)}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      per {item.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Riwayat Belanja di Toko Ini */}
      <DataGrid
        table={supplierExpenseTable}
        recordCount={expenseData?.total || 0}
        isLoading={isExpensesLoading}
        tableLayout={{ columnsResizable: true }}
      >
        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Riwayat Belanja di {supplier.name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Total {expenseData?.total || 0} transaksi tercatat
              </p>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <Filters
                variant="advanced"
                advancedMode="popover"
                advancedAlign="end"
                reorderable
                fields={supplierExpenseFilterFields}
                query={supplierExpenseFilterQuery}
                onQueryChange={handleSupplierExpenseQueryChange}
                className="[--filter-field-width:9rem] [--filter-operator-width:6.5rem] [--filter-value-width:11rem]"
              />

              <select
                value={searchCategory}
                onChange={(e) => {
                  setSearchCategory(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 text-slate-700 dark:text-slate-300 font-medium"
              >
                <option value="">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={searchPayStatus}
                onChange={(e) => {
                  setSearchPayStatus(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 text-slate-700 dark:text-slate-300 font-medium"
              >
                <option value="">Semua Status Bayar</option>
                <option value="unpaid">Belum Lunas / Tempo</option>
                <option value="Lunas">Lunas</option>
              </select>

              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs rounded-xl w-32"
              />
              <span className="text-xs text-slate-400">-</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs rounded-xl w-32"
              />

              {(searchCategory || searchPayStatus || startDate || endDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchCategory("");
                    setSearchPayStatus("");
                    setStartDate("");
                    setEndDate("");
                    setPage(1);
                  }}
                  className="h-8 text-xs text-slate-500"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          <DataGridScrollArea className="min-h-[250px]">
            <DataGridTable />
          </DataGridScrollArea>

          <DataGridPagination />
        </Card>
      </DataGrid>

      {/* Modal Edit Informasi Toko */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Edit Informasi Toko</DialogTitle>
            <DialogDescription className="text-xs">
              Perbarui rincian kontak, alamat, atau alias pencocokan otomatis.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({
                name: editName,
                phone: editPhone,
                address: editAddress,
                aliases: editAliases,
                notes: editNotes,
                is_active: editIsActive,
              });
            }}
            className="space-y-3.5 text-xs"
          >
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Nama Toko / Supplier *
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Contoh: TBK Sumber Makmur"
                required
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  No. Telp / WhatsApp
                </label>
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="08xxxxxxxx"
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Status
                </label>
                <select
                  value={editIsActive ? "active" : "inactive"}
                  onChange={(e) => setEditIsActive(e.target.value === "active")}
                  className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Alamat Toko
              </label>
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="Jl. Merdeka No. 123"
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Alias (pisahkan koma)
              </label>
              <Input
                value={editAliases}
                onChange={(e) => setEditAliases(e.target.value)}
                placeholder="sumber makmur, makmur jaya, tbk sm"
                className="h-9 text-xs"
              />
              <span className="text-[10px] text-slate-400">
                Nama alternatif yang sering diketik di bot Telegram agar otomatis cocok.
              </span>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Catatan
              </label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Catatan rekening, jam operasional, dll."
                rows={2}
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={updateMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Simpan Perubahan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Tambah Catatan Belanja di Toko Ini */}
      <Dialog open={isAddExpenseOpen} onOpenChange={setIsAddExpenseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Tambah Belanja di {supplier.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Catatan belanja baru akan langsung otomatis terhubung ke supplier ini.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateExpense} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Tanggal Belanja *
                </label>
                <Input
                  type="date"
                  value={newExpenseDate}
                  onChange={(e) => setNewExpenseDate(e.target.value)}
                  required
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Kategori *
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Nama Barang *
              </label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Contoh: Tepung Cakra 1kg"
                required
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Qty
                </label>
                <Input
                  type="number"
                  step="any"
                  min="0.01"
                  value={newQty}
                  onChange={(e) => handleQtyChange(parseFloat(e.target.value) || 0)}
                  required
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Satuan
                </label>
                <Input
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="Pcs/Kg/Pack"
                  className="h-9 text-xs"
                  list="supplier-units"
                />
                <datalist id="supplier-units">
                  {units.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Harga Satuan
                </label>
                <Input
                  type="number"
                  min="0"
                  value={newUnitPrice}
                  onChange={(e) => handleUnitPriceChange(parseFloat(e.target.value) || 0)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Total Biaya (Rp) *
                </label>
                <Input
                  type="number"
                  min="0"
                  value={newTotalPrice}
                  onChange={(e) => setNewTotalPrice(parseFloat(e.target.value) || 0)}
                  required
                  className="h-9 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Metode Bayar
                </label>
                <select
                  value={newPayMethod}
                  onChange={(e) => setNewPayMethod(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs"
                >
                  {paymentMethods.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Status Pembayaran *
                </label>
                <select
                  value={newPayStatus}
                  onChange={(e) => setNewPayStatus(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  <option value="Lunas">Lunas</option>
                  <option value="Belum Lunas">Belum Lunas (Tempo)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  No. Invoice / Nota
                </label>
                <Input
                  value={newInvoiceNumber}
                  onChange={(e) => setNewInvoiceNumber(e.target.value)}
                  placeholder="Contoh: INV/2026/001"
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            {newPayStatus !== "Lunas" && (
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1 text-rose-600 dark:text-rose-400">
                  Tanggal Jatuh Tempo *
                </label>
                <Input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  required={newPayStatus !== "Lunas"}
                  className="h-9 text-xs border-rose-300 dark:border-rose-900"
                />
              </div>
            )}

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Keterangan / Catatan
              </label>
              <Input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Catatan belanja tambahan..."
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddExpenseOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={addExpenseMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Simpan Belanja
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Audit Duplikat Item Toko */}
      <SupplierItemAuditDialog
        supplierId={supplierId}
        supplierName={supplier.name}
        isOpen={isItemAuditOpen}
        onClose={() => setIsItemAuditOpen(false)}
        onSuccess={() => {
          refetchSupplier();
          refetchExpenses();
          queryClient.invalidateQueries({ queryKey: ["supplier-top-items", supplierId] });
          queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items", supplierId] });
        }}
      />
    </div>
  );
};
