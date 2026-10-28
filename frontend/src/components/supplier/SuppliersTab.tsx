import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  syncSupplierExpenses,
} from "@/lib/api";
import { Supplier, SupplierFormData } from "@/types";
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
  Store,
  Plus,
  Search,
  RefreshCw,
  Edit3,
  Trash2,
  GitMerge,
  Phone,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ArrowDetail,
  ShieldAlert,
  ArrowUpDown,
  FileCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AuditSupplierDuplicatesModal } from "./AuditSupplierDuplicatesModal";

interface SuppliersTabProps {
  onSelectSupplier: (supplierId: number) => void;
  canDelete: boolean;
}

export const SuppliersTab: React.FC<SuppliersTabProps> = ({
  onSelectSupplier,
  canDelete,
}) => {
  const queryClient = useQueryClient();

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("total_spent");
  const [sortOrder, setSortOrder] = useState<string>("desc");
  const [page, setPage] = useState(1);

  // Modal Dialogs
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Form State
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formAliases, setFormAliases] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);

  // Query Data Suppliers
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["suppliers", search, statusFilter, sortBy, sortOrder, page],
    queryFn: () =>
      getSuppliers({
        search: search || undefined,
        is_active:
          statusFilter === "all" ? undefined : statusFilter === "active",
        sort_by: sortBy,
        sort_order: sortOrder,
        page,
        limit: 20,
      }),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload: SupplierFormData) => createSupplier(payload),
    onSuccess: (newSupp) => {
      toast.success(`Supplier '${newSupp.name}' berhasil ditambahkan.`);
      setIsAddOpen(false);
      resetForm();
      refetch();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menambah supplier.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SupplierFormData> }) =>
      updateSupplier(id, payload),
    onSuccess: () => {
      toast.success("Data supplier berhasil diperbarui.");
      setIsEditOpen(false);
      setEditingSupplier(null);
      refetch();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui supplier.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: () => {
      toast.success("Supplier berhasil dihapus. Riwayat belanja tetap aman.");
      refetch();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus supplier.");
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncSupplierExpenses(),
    onSuccess: (res) => {
      toast.success(res.message);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal melakukan sinkronisasi.");
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormPhone("");
    setFormAddress("");
    setFormAliases("");
    setFormNotes("");
    setFormIsActive(true);
  };

  const openAddModal = () => {
    resetForm();
    setIsAddOpen(true);
  };

  const openEditModal = (s: Supplier, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSupplier(s);
    setFormName(s.name);
    setFormPhone(s.phone || "");
    setFormAddress(s.address || "");
    setFormAliases(s.aliases || "");
    setFormNotes(s.notes || "");
    setFormIsActive(s.is_active);
    setIsEditOpen(true);
  };

  const handleDelete = (s: Supplier, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDelete) {
      toast.error("Hanya Owner yang dapat menghapus master supplier.");
      return;
    }
    if (
      confirm(
        `Hapus master supplier '${s.name}'? Seluruh riwayat transaksi belanja tetap tersimpan di database.`
      )
    ) {
      deleteMutation.mutate(s.id);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("Nama supplier wajib diisi.");
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      phone: formPhone.trim(),
      address: formAddress.trim(),
      aliases: formAliases.trim(),
      notes: formNotes.trim(),
      is_active: formIsActive,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier || !formName.trim()) return;
    updateMutation.mutate({
      id: editingSupplier.id,
      payload: {
        name: formName.trim(),
        phone: formPhone.trim(),
        address: formAddress.trim(),
        aliases: formAliases.trim(),
        notes: formNotes.trim(),
        is_active: formIsActive,
      },
    });
  };

  const suppliers = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 20) || 1;

  const supplierFilterFields: FilterField[] = useMemo(
    () => [
      {
        id: "status",
        label: "Status Toko",
        type: "select",
        options: [
          { label: "Semua Status", value: "all" },
          { label: "Aktif", value: "active" },
          { label: "Nonaktif", value: "inactive" },
        ],
      },
      {
        id: "sort_by",
        label: "Urutkan Berdasarkan",
        type: "select",
        options: [
          { label: "Total Belanja", value: "total_spent" },
          { label: "Jumlah Transaksi", value: "transaction_count" },
          { label: "Nama Toko", value: "name" },
          { label: "Terakhir Belanja", value: "last_expense_date" },
          { label: "Waktu Dibuat", value: "created_at" },
        ],
      },
      {
        id: "sort_order",
        label: "Arah Pengurutan",
        type: "select",
        options: [
          { label: "Tinggi ke Rendah / Z-A", value: "desc" },
          { label: "Rendah ke Tinggi / A-Z", value: "asc" },
        ],
      },
    ],
    []
  );

  const supplierFilterQuery = useMemo(() => {
    const rules = [];
    if (statusFilter && statusFilter !== "all") {
      rules.push(createFilterRule({ id: "rule-status", path: ["status"], operator: "is", value: statusFilter }));
    }
    if (sortBy) {
      rules.push(createFilterRule({ id: "rule-sort", path: ["sort_by"], operator: "is", value: sortBy }));
    }
    if (sortOrder) {
      rules.push(createFilterRule({ id: "rule-order", path: ["sort_order"], operator: "is", value: sortOrder }));
    }
    return createFilterQuery(rules, "and");
  }, [statusFilter, sortBy, sortOrder]);

  const handleSupplierQueryChange = (nextQuery: FilterQuery) => {
    let newStatus = "all";
    let newSort = sortBy;
    let newOrder = sortOrder;
    const traverse = (nodes: FilterNode[]) => {
      for (const node of nodes) {
        if (isFilterRule(node)) {
          if (node.path[0] === "status") newStatus = String(node.value ?? "all");
          if (node.path[0] === "sort_by") newSort = String(node.value ?? sortBy);
          if (node.path[0] === "sort_order") newOrder = (String(node.value ?? sortOrder) as "asc" | "desc");
        } else if (node.rules) {
          traverse(node.rules);
        }
      }
    };
    if (nextQuery?.rules) traverse(nextQuery.rules);
    setStatusFilter(newStatus);
    setSortBy(newSort);
    setSortOrder(newOrder);
    setPage(1);
  };

  const supplierColumns = useMemo<ColumnDef<DataGridFeatures, Supplier>[]>(
    () => [
      {
        accessorKey: "name",
        id: "name",
        header: ({ column }) => <DataGridColumnHeader title="Nama Toko / Supplier" column={column} />,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div
              className="cursor-pointer group/name"
              onClick={() => onSelectSupplier(s.id)}
            >
              <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover/name:text-blue-600 transition-colors">
                {s.name}
              </div>
              {s.aliases && (
                <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                  Alias: {s.aliases}
                </div>
              )}
            </div>
          );
        },
        size: 220,
        enableSorting: true,
      },
      {
        id: "contact",
        header: () => <span>Kontak & Alamat</span>,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div>
              {s.phone ? (
                <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <Phone className="w-3 h-3 text-slate-400" />
                  <span>{s.phone}</span>
                </div>
              ) : (
                <span className="text-slate-400">-</span>
              )}
              {s.address && (
                <div className="text-[10px] text-slate-400 truncate max-w-[200px] mt-0.5">
                  {s.address}
                </div>
              )}
            </div>
          );
        },
        size: 190,
      },
      {
        accessorKey: "transaction_count",
        id: "transaction_count",
        header: ({ column }) => <DataGridColumnHeader title="Transaksi" column={column} className="justify-center text-center" />,
        cell: ({ row }) => (
          <div className="text-center">
            <Badge variant="secondary" className="text-[11px] font-semibold tabular-nums">
              {row.original.transaction_count}x
            </Badge>
          </div>
        ),
        size: 100,
        enableSorting: true,
      },
      {
        accessorKey: "total_spent",
        id: "total_spent",
        header: ({ column }) => <DataGridColumnHeader title="Total Belanja" column={column} className="justify-end text-right" />,
        cell: ({ row }) => (
          <div className="text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatRupiah(row.original.total_spent)}
          </div>
        ),
        size: 140,
        enableSorting: true,
      },
      {
        accessorKey: "last_expense_date",
        id: "last_expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Terakhir Belanja" column={column} />,
        cell: ({ row }) => (
          <div className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {row.original.last_expense_date ? formatDateId(row.original.last_expense_date) : "-"}
          </div>
        ),
        size: 130,
        enableSorting: true,
      },
      {
        accessorKey: "is_active",
        id: "is_active",
        header: ({ column }) => <DataGridColumnHeader title="Status" column={column} className="justify-center text-center" />,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="text-center">
              <Badge
                variant={s.is_active ? "default" : "secondary"}
                className={
                  s.is_active
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 text-[10px]"
                    : "text-[10px]"
                }
              >
                {s.is_active ? "Aktif" : "Nonaktif"}
              </Badge>
            </div>
          );
        },
        size: 100,
      },
      {
        id: "actions",
        header: () => <div className="text-right">Aksi</div>,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => openEditModal(s, e)}
                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100"
                title="Edit toko"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </Button>

              {canDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleDelete(s, e)}
                  className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  title="Hapus toko"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-0.5" />

              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectSupplier(s.id)}
                className="h-7 px-2 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg gap-1"
              >
                Detail
                <ArrowDetail className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        },
        size: 120,
      },
    ],
    [onSelectSupplier, canDelete]
  );

  const supplierPagination = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: 20,
    }),
    [page]
  );

  const supplierTable = useTable({
    features: dataGridFeatures,
    columns: supplierColumns,
    data: suppliers,
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    getRowId: (row: Supplier) => String(row.id),
    state: {
      pagination: supplierPagination,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(supplierPagination) : updater;
      setPage(next.pageIndex + 1);
    },
  });

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Master Supplier / Toko
            </h2>
            <Badge variant="outline" className="text-xs">
              {total} Toko Terdaftar
            </Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Kelola data vendor, histori belanja, analisis barang favorit, serta audit toko ganda.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tombol Sync */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="h-9 rounded-xl text-xs gap-1.5"
            title="Hubungkan transaksi belanja lama yang belum memiliki relasi supplier"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`}
            />
            Sync Data Lama
          </Button>

          {/* Tombol Audit Duplikat */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAuditModalOpen(true)}
            className="h-9 rounded-xl text-xs gap-1.5"
          >
            <GitMerge className="w-3.5 h-3.5 text-amber-500" />
            Audit Toko Ganda
          </Button>

          {/* Tombol Tambah Supplier */}
          <Button
            size="sm"
            onClick={openAddModal}
            className="h-9 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Tambah Toko
          </Button>
        </div>
      </div>

      {/* Filter and ReUI DataGrid */}
      <DataGrid
        table={supplierTable}
        recordCount={total}
        isLoading={isLoading}
        tableLayout={{ columnsResizable: true }}
      >
        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Search */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari nama toko, alias, telp, alamat..."
                className="pl-9 h-9 text-xs rounded-xl bg-slate-50/70 dark:bg-slate-800/70"
              />
            </div>

            {/* Filter & Sort Controls */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
              <Filters
                variant="advanced"
                advancedMode="popover"
                advancedAlign="end"
                reorderable
                fields={supplierFilterFields}
                query={supplierFilterQuery}
                onQueryChange={handleSupplierQueryChange}
                className="[--filter-field-width:9rem] [--filter-operator-width:6.5rem] [--filter-value-width:11rem]"
              />

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-slate-700 dark:text-slate-300 font-medium"
              >
                <option value="all">Semua Status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-slate-700 dark:text-slate-300 font-medium"
              >
                <option value="total_spent">Urutkan: Total Belanja</option>
                <option value="transaction_count">Urutkan: Jumlah Transaksi</option>
                <option value="name">Urutkan: Nama Toko</option>
                <option value="last_expense_date">Urutkan: Terakhir Belanja</option>
                <option value="created_at">Urutkan: Waktu Dibuat</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
                  setPage(1);
                }}
                className="h-9 px-2.5 rounded-xl text-xs gap-1 text-slate-600 dark:text-slate-300"
                title="Ubah arah pengurutan"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortOrder === "desc" ? "Z-A" : "A-Z"}
              </Button>
            </div>
          </div>

          <DataGridScrollArea className="min-h-[300px]">
            <DataGridTable />
          </DataGridScrollArea>

          <DataGridPagination />
        </Card>
      </DataGrid>

      {/* Modal Tambah Supplier */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Tambah Toko / Supplier</DialogTitle>
            <DialogDescription className="text-xs">
              Daftarkan vendor atau tempat belanja agar nama toko konsisten.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Nama Toko / Supplier *
              </label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
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
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="08xxxxxxxx"
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Status
                </label>
                <select
                  value={formIsActive ? "active" : "inactive"}
                  onChange={(e) => setFormIsActive(e.target.value === "active")}
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
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                placeholder="Contoh: Pasar Baru Blok B No. 12"
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Alias (pisahkan koma)
              </label>
              <Input
                value={formAliases}
                onChange={(e) => setFormAliases(e.target.value)}
                placeholder="sumber makmur, makmur jaya, tbk sm"
                className="h-9 text-xs"
              />
              <span className="text-[10px] text-slate-400">
                Variasi penulisan nama yang sering dipakai karyawan di chat bot.
              </span>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Catatan
              </label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Nomor rekening transfer, kontak sales, dll."
                rows={2}
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Edit Supplier */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Edit Toko / Supplier</DialogTitle>
            <DialogDescription className="text-xs">
              Perbarui rincian toko atau variasinya.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Nama Toko / Supplier *
              </label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
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
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Status
                </label>
                <select
                  value={formIsActive ? "active" : "inactive"}
                  onChange={(e) => setFormIsActive(e.target.value === "active")}
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
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Alias (pisahkan koma)
              </label>
              <Input
                value={formAliases}
                onChange={(e) => setFormAliases(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Catatan
              </label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
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

      {/* Modal Audit Duplikat */}
      <AuditSupplierDuplicatesModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        canDelete={canDelete}
      />
    </div>
  );
};
