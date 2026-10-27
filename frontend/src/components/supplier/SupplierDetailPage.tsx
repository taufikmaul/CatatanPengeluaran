import React, { useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

interface SupplierDetailPageProps {
  supplierId: number;
  onBack: () => void;
  canDelete: boolean;
  categories: string[];
}

export const SupplierDetailPage: React.FC<SupplierDetailPageProps> = ({
  supplierId,
  onBack,
  canDelete,
  categories,
}) => {
  const queryClient = useQueryClient();

  // State filter & pagination riwayat
  const [page, setPage] = useState(1);
  const [searchCategory, setSearchCategory] = useState("");
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

  // Modal tambah catatan belanja
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newQty, setNewQty] = useState<number>(1);
  const [newUnit, setNewUnit] = useState("Pcs");
  const [newUnitPrice, setNewUnitPrice] = useState<number>(0);
  const [newTotalPrice, setNewTotalPrice] = useState<number>(0);
  const [newCategory, setNewCategory] = useState(categories[0] || "Operasional");
  const [newPayMethod, setNewPayMethod] = useState("Tunai");
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
      startDate,
      endDate,
    ],
    queryFn: () =>
      getSupplierExpenses(supplierId, {
        category: searchCategory || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page,
        limit: 15,
      }),
  });

  // Mutations
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
      pay_status: "Lunas",
      due_date: "-",
      notes: newNotes.trim() || "-",
    });
  };

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      </div>

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
            <Badge variant="outline" className="text-[10px]">
              Top {topItems.length}
            </Badge>
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
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
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
            <select
              value={searchCategory}
              onChange={(e) => {
                setSearchCategory(e.target.value);
                setPage(1);
              }}
              className="h-8 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 text-slate-700 dark:text-slate-300"
            >
              <option value="">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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

            {(searchCategory || startDate || endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchCategory("");
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

        {/* Tabel Transaksi */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-medium">
                <th className="py-2.5 px-3">Tanggal</th>
                <th className="py-2.5 px-3">Nama Barang</th>
                <th className="py-2.5 px-3">Kategori</th>
                <th className="py-2.5 px-3 text-right">Qty</th>
                <th className="py-2.5 px-3 text-right">Harga Satuan</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-3">Metode</th>
                <th className="py-2.5 px-3">Status</th>
                {canDelete && <th className="py-2.5 px-3 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isExpensesLoading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    Memuat riwayat belanja...
                  </td>
                </tr>
              ) : !expenseData?.data || expenseData.data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    Tidak ada catatan belanja yang sesuai filter.
                  </td>
                </tr>
              ) : (
                expenseData.data.map((exp: Expense) => (
                  <tr key={exp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {formatDateId(exp.expense_date)}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                      {exp.item_name}
                      {exp.notes && exp.notes !== "-" && (
                        <span className="block text-[10px] font-normal text-slate-400">
                          {exp.notes}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {exp.category}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {exp.qty} {exp.unit || "Pcs"}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                      {formatRupiah(exp.unit_price)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatRupiah(exp.total_price)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {exp.pay_method}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge
                        variant={exp.pay_status === "Lunas" ? "default" : "destructive"}
                        className={
                          exp.pay_status === "Lunas"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 text-[10px]"
                            : "text-[10px]"
                        }
                      >
                        {exp.pay_status}
                      </Badge>
                    </td>
                    {canDelete && (
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Hapus catatan belanja '${exp.item_name}'?`)) {
                              deleteExpenseMutation.mutate(exp.id);
                            }
                          }}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginasi Riwayat */}
        {expenseData && expenseData.total_pages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-500">
              Halaman {expenseData.page} dari {expenseData.total_pages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-8 px-2"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(expenseData.total_pages, p + 1))}
                disabled={page >= expenseData.total_pages}
                className="h-8 px-2"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

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
                />
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
                  <option value="Tunai">Tunai</option>
                  <option value="Transfer">Transfer</option>
                  <option value="QRIS">QRIS</option>
                  <option value="Kartu Debit/Kredit">Kartu Debit/Kredit</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Keterangan / Catatan
              </label>
              <Input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="No nota atau catatan belanja tambahan"
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
    </div>
  );
};
