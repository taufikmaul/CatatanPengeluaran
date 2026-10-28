import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, enqueueMergeMasterItems, enqueueBatchMergeMasterItems } from "@/lib/api";
import {
  MasterItem,
  DuplicatePair,
  MasterItemAuditResponse,
  MasterItemMergeRequest,
} from "@/types";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { formatRupiah } from "@/lib/formatters";
import { toast } from "sonner";
import {
  PackageCheck,
  Plus,
  Trash2,
  Edit3,
  Search,
  FileText,
  Check,
  X,
  RefreshCw,
  DatabaseZap,
  LineChart,
  GitMerge,
  SearchCheck,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

interface MasterItemsTabProps {
  categories: string[];
  units?: string[];
  onInspectItemPrice?: (itemName: string, itemId?: number) => void;
}

export const MasterItemsTab: React.FC<MasterItemsTabProps> = ({
  categories,
  units = [
    "Pcs", "Box", "Bungkus", "Pack", "Pouch", "Kg", "Gram", "Dus",
    "Kaleng", "Sak", "Bal", "Botol", "Tray", "Liter", "Roll", "Lembar",
    "Meter", "Ikat", "Butir", "Trans", "Trip"
  ],
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

  // Audit & Merge state
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditMinScore, setAuditMinScore] = useState(0.70);
  const [ignoredPairKeys, setIgnoredPairKeys] = useState<Set<string>>(new Set());

  // Manual table selection for merge
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Merge modal dialog state
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeItemsList, setMergeItemsList] = useState<MasterItem[]>([]);
  const [targetItemId, setTargetItemId] = useState<number | null>(null);
  const [customMergeName, setCustomMergeName] = useState("");
  const [customMergeCategory, setCustomMergeCategory] = useState("");
  const [customMergeSupplier, setCustomMergeSupplier] = useState("");
  const [mergeAliasesOption, setMergeAliasesOption] = useState(true);
  const [updateExpensesOption, setUpdateExpensesOption] = useState(true);
  const [runMergeInBackground, setRunMergeInBackground] = useState(false);

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
    queryClient.invalidateQueries({ queryKey: ["master-items-audit"] });
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

  // Audit Duplikat Query
  const {
    data: auditRes,
    isLoading: isAuditing,
    refetch: refetchAudit,
  } = useQuery<MasterItemAuditResponse>({
    queryKey: ["master-items-audit", auditMinScore],
    queryFn: async () =>
      (await api.get(`/master-items/audit-duplicates?min_score=${auditMinScore}`)).data,
    enabled: showAuditModal,
  });

  // Merge Items Mutation (Instant)
  const mergeMutation = useMutation({
    mutationFn: async (payload: MasterItemMergeRequest) => {
      return (await api.post("/master-items/merge", payload)).data;
    },
    onSuccess: (res) => {
      toast.success(res.message || "Berhasil menggabungkan item!");
      setMergeDialogOpen(false);
      setSelectedIds([]);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["master-items-audit"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menggabungkan item baku");
    },
  });

  // Batch Merge Mutation (Background Queue)
  const batchMergeMutation = useMutation({
    mutationFn: async (merges: any[]) => {
      return await enqueueBatchMergeMasterItems(merges);
    },
    onSuccess: (data) => {
      toast.success(
        `Tugas penggabungan massal berhasil didaftarkan ke antrean latar belakang (#${data.id}).`
      );
      setShowAuditModal(false);
      queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal mendaftarkan penggabungan massal");
    },
  });

  const handleBatchMergeAllSuggested = () => {
    if (auditPairs.length === 0) return;
    const count = auditPairs.length;
    if (
      !confirm(
        `Gabungkan ${count} pasang item duplikat sekaligus sesuai rekomendasi sistem? Tugas ini akan dieksekusi secara asinkron di antrean latar belakang.`
      )
    ) {
      return;
    }

    const merges = auditPairs.map((pair) => {
      const isAPrimary = pair.suggested_primary_id === pair.item_a.id;
      const target = isAPrimary ? pair.item_a : pair.item_b;
      const source = isAPrimary ? pair.item_b : pair.item_a;
      return {
        target_item_id: target.id,
        source_item_ids: [source.id],
        custom_name: target.item_name,
        custom_category: target.category,
        custom_supplier: target.default_supplier === "-" ? undefined : target.default_supplier,
        merge_aliases: true,
        update_expenses: true,
      };
    });

    batchMergeMutation.mutate(merges);
  };

  const openMergeDialogForItems = (items: MasterItem[], defaultPrimaryId?: number) => {
    if (items.length < 2) return;
    setMergeItemsList(items);

    const primary =
      (defaultPrimaryId ? items.find((i) => i.id === defaultPrimaryId) : null) ||
      [...items].sort((a, b) => (b.tx_count || 0) - (a.tx_count || 0))[0] ||
      items[0];

    setTargetItemId(primary.id);
    setCustomMergeName(primary.item_name);
    setCustomMergeCategory(primary.category || categories[0] || "Bahan Kue");
    setCustomMergeSupplier(primary.default_supplier === "-" ? "" : primary.default_supplier || "");
    setMergeAliasesOption(true);
    setUpdateExpensesOption(true);
    setRunMergeInBackground(false);
    setMergeDialogOpen(true);
  };

  const handleSelectPrimaryTarget = (item: MasterItem) => {
    setTargetItemId(item.id);
    setCustomMergeName(item.item_name);
    if (item.category) setCustomMergeCategory(item.category);
    if (item.default_supplier && item.default_supplier !== "-") {
      setCustomMergeSupplier(item.default_supplier);
    }
  };

  const handleExecuteMerge = async () => {
    if (!targetItemId) {
      toast.error("Pilih salah satu item sebagai item baku utama!");
      return;
    }
    const sourceIds = mergeItemsList.map((i) => i.id).filter((id) => id !== targetItemId);
    if (sourceIds.length === 0) {
      toast.error("Minimal harus ada satu item duplikat yang digabungkan!");
      return;
    }

    const payload: MasterItemMergeRequest = {
      target_item_id: targetItemId,
      source_item_ids: sourceIds,
      custom_name: customMergeName.trim() || undefined,
      custom_category: customMergeCategory.trim() || undefined,
      custom_supplier: customMergeSupplier.trim() || undefined,
      merge_aliases: mergeAliasesOption,
      update_expenses: updateExpensesOption,
    };

    if (runMergeInBackground) {
      try {
        const job = await enqueueMergeMasterItems(payload);
        toast.success(`Penggabungan item didaftarkan ke antrean latar belakang (#${job.id}).`);
        setMergeDialogOpen(false);
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      } catch (err: any) {
        toast.error(err.response?.data?.detail || "Gagal mendaftarkan tugas penggabungan");
      }
    } else {
      mergeMutation.mutate(payload);
    }
  };

  const toggleSelectItem = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredItems.map((i) => i.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const auditPairs = useMemo(() => {
    if (!auditRes?.pairs) return [];
    return auditRes.pairs.filter((p) => {
      const key = `${Math.min(p.item_a.id, p.item_b.id)}-${Math.max(p.item_a.id, p.item_b.id)}`;
      return !ignoredPairKeys.has(key);
    });
  }, [auditRes, ignoredPairKeys]);

  const ignorePair = (itemAId: number, itemBId: number) => {
    const key = `${Math.min(itemAId, itemBId)}-${Math.max(itemAId, itemBId)}`;
    setIgnoredPairKeys((prev) => new Set([...prev, key]));
  };

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

  const [tablePagination, setTablePagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

  const masterFilterFields: FilterField[] = useMemo(
    () => [
      {
        id: "category",
        label: "Kategori",
        type: "select",
        options: categories.map((c) => ({ label: c, value: c })),
      },
      {
        id: "tipe_satuan",
        label: "Tipe Satuan",
        type: "select",
        options: [
          { label: "Paket & Ecer", value: "keduanya" },
          { label: "Hanya Paket", value: "paket" },
          { label: "Hanya Ecer", value: "ecer" },
        ],
      },
    ],
    [categories]
  );

  const masterFilterQuery = useMemo(() => {
    const rules = [];
    if (filterCat) {
      rules.push(createFilterRule({ id: "rule-cat", path: ["category"], operator: "is", value: filterCat }));
    }
    return createFilterQuery(rules, "and");
  }, [filterCat]);

  const handleMasterQueryChange = (nextQuery: FilterQuery) => {
    let newCat = "";
    const traverse = (nodes: FilterNode[]) => {
      for (const node of nodes) {
        if (isFilterRule(node)) {
          if (node.path[0] === "category") newCat = String(node.value ?? "");
        } else if (node.rules) {
          traverse(node.rules);
        }
      }
    };
    if (nextQuery?.rules) traverse(nextQuery.rules);
    setFilterCat(newCat);
  };

  const masterColumns = useMemo<ColumnDef<DataGridFeatures, MasterItem>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <div className="w-10 text-center">
            <input
              type="checkbox"
              aria-label="Pilih semua item yang tampil"
              checked={
                filteredItems.length > 0 &&
                filteredItems.every((i) => selectedIds.includes(i.id))
              }
              onChange={handleToggleSelectAllVisible}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
            />
          </div>
        ),
        cell: ({ row }) => {
          const item = row.original;
          const isSelected = selectedIds.includes(item.id);
          return (
            <div className="w-10 text-center">
              <input
                type="checkbox"
                aria-label={`Pilih ${item.item_name}`}
                checked={isSelected}
                onChange={() => toggleSelectItem(item.id)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
              />
            </div>
          );
        },
        size: 50,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => <DataGridColumnHeader title="Nama Item Baku" column={column} />,
        cell: ({ row }) => {
          const item = row.original;
          const isEditing = editingId === item.id;
          return isEditing ? (
            <Input
              value={editForm.item_name}
              onChange={(e) => setEditForm({ ...editForm, item_name: e.target.value })}
              className="h-8 text-xs rounded-lg"
            />
          ) : (
            <button
              type="button"
              onClick={() => onInspectItemPrice?.(item.item_name, item.id)}
              className="hover:text-blue-600 hover:underline inline-flex items-center gap-1.5 text-left font-semibold text-slate-900"
              title="Klik untuk lihat riwayat harga & perbandingan toko"
            >
              <span>{item.item_name}</span>
              <LineChart className="w-3 h-3 text-slate-300" />
            </button>
          );
        },
        size: 200,
        enableSorting: true,
      },
      {
        accessorKey: "category",
        id: "category",
        header: ({ column }) => <DataGridColumnHeader title="Kategori" column={column} />,
        cell: ({ row }) => {
          const item = row.original;
          const isEditing = editingId === item.id;
          return isEditing ? (
            <select
              value={editForm.category}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
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
          );
        },
        size: 130,
        enableSorting: true,
      },
      {
        id: "satuan",
        header: () => <span>Satuan & Kemasan</span>,
        cell: ({ row }) => {
          const item = row.original;
          const isEditing = editingId === item.id;
          if (isEditing) {
            return (
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
                    <select
                      value={editForm.satuan_beli}
                      onChange={(e) =>
                        setEditForm({ ...editForm, satuan_beli: e.target.value })
                      }
                      className="h-7 w-full rounded border border-slate-200 bg-white px-1 text-[11px]"
                    >
                      {units.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-[10px] text-slate-500 block">Turunan / Isi Paket</label>
                    <Input
                      value={editForm.isi_paket}
                      onChange={(e) =>
                        setEditForm({ ...editForm, isi_paket: e.target.value })
                      }
                      placeholder="mis. 1Kg, 500g"
                      className="h-7 text-[11px] rounded px-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block">Satuan Ecer</label>
                    <select
                      value={editForm.satuan_ecer}
                      onChange={(e) =>
                        setEditForm({ ...editForm, satuan_ecer: e.target.value })
                      }
                      className="h-7 w-full rounded border border-slate-200 bg-white px-1 text-[11px]"
                    >
                      {units.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          }
          return (
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
                <div className="text-[11px] text-slate-500 font-normal flex items-center gap-1 flex-wrap pt-0.5">
                  <span className="text-[10px] text-slate-400">Turunan:</span>
                  {item.isi_paket.split(/[,;]\s*/).filter(Boolean).map((p, i) => (
                    <span key={i} className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 text-[10px] font-medium border border-blue-200">
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {item.tipe_satuan === "keduanya" && item.satuan_ecer && item.satuan_ecer !== item.satuan_beli && (
                <div className="text-[10px] text-slate-500">
                  Ecer: <span className="text-slate-600 font-medium">{item.satuan_ecer}</span>
                </div>
              )}
            </div>
          );
        },
        size: 190,
      },
      {
        accessorKey: "aliases",
        id: "aliases",
        header: ({ column }) => <DataGridColumnHeader title="Kata Kunci / Alias Struk" column={column} />,
        cell: ({ row }) => {
          const item = row.original;
          const isEditing = editingId === item.id;
          if (isEditing) {
            return (
              <Input
                value={editForm.aliases}
                onChange={(e) =>
                  setEditForm({ ...editForm, aliases: e.target.value })
                }
                placeholder="alias1, alias2"
                className="h-8 text-xs rounded-lg"
              />
            );
          }
          return item.aliases ? (
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
          );
        },
        size: 170,
      },
      {
        accessorKey: "default_supplier",
        id: "default_supplier",
        header: ({ column }) => <DataGridColumnHeader title="Toko Default" column={column} />,
        cell: ({ row }) => {
          const item = row.original;
          const isEditing = editingId === item.id;
          if (isEditing) {
            return (
              <Input
                value={editForm.default_supplier}
                onChange={(e) =>
                  setEditForm({ ...editForm, default_supplier: e.target.value })
                }
                className="h-8 text-xs rounded-lg"
              />
            );
          }
          return <span>{item.last_supplier || item.default_supplier || "-"}</span>;
        },
        size: 140,
        enableSorting: true,
      },
      {
        accessorKey: "last_unit_price",
        id: "last_unit_price",
        header: ({ column }) => <DataGridColumnHeader title="Harga Terakhir" column={column} className="justify-end text-right" />,
        cell: ({ row }) => (
          <div className="text-right font-semibold tabular-nums text-emerald-700">
            {row.original.last_unit_price > 0 ? formatRupiah(row.original.last_unit_price) : "-"}
          </div>
        ),
        size: 120,
        enableSorting: true,
      },
      {
        accessorKey: "tx_count",
        id: "tx_count",
        header: ({ column }) => <DataGridColumnHeader title="Transaksi" column={column} className="justify-center text-center" />,
        cell: ({ row }) => (
          <div className="text-center">
            <Badge variant="secondary" className="text-[10px]">
              {row.original.tx_count}x
            </Badge>
          </div>
        ),
        size: 90,
        enableSorting: true,
      },
      {
        id: "actions",
        header: () => <div className="text-right">Aksi</div>,
        cell: ({ row }) => {
          const item = row.original;
          const isEditing = editingId === item.id;
          if (isEditing) {
            return (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    updateMutation.mutate({ id: item.id, payload: editForm })
                  }
                  className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50"
                  title="Simpan"
                >
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                  className="h-7 w-7 p-0 text-slate-500 hover:bg-slate-100"
                  title="Batal"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          }
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedIds((prev) =>
                    prev.includes(item.id) ? prev : [...prev, item.id]
                  );
                  toast.info(
                    `'${item.item_name}' ditandai. Centang item lain di tabel untuk digabungkan.`
                  );
                }}
                className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                title="Pilih untuk digabung"
              >
                <GitMerge className="w-3.5 h-3.5" />
              </Button>
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
                className="h-7 w-7 p-0 text-slate-500 hover:text-rose-600"
                title="Hapus"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        },
        size: 110,
      },
    ],
    [filteredItems, selectedIds, editingId, editForm, categories, handleToggleSelectAllVisible, toggleSelectItem, onInspectItemPrice, updateMutation, deleteMutation]
  );

  const masterTable = useTable({
    features: dataGridFeatures,
    columns: masterColumns,
    data: filteredItems,
    rowCount: filteredItems.length,
    getRowId: (row) => String(row.id),
    state: {
      pagination: tablePagination,
    },
    onPaginationChange: setTablePagination,
  });

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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowAuditModal(true);
                refetchAudit();
              }}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-amber-400/20 hover:bg-amber-400/30 text-amber-100 border border-amber-300/30 shadow-xs"
            >
              <SearchCheck className="w-3.5 h-3.5 text-amber-300" />
              Audit Item Duplikat
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
                  <FileText className="w-4 h-4 text-blue-600" />
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
                <select
                  value={satuanBeli}
                  onChange={(e) => setSatuanBeli(e.target.value)}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
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
                  Turunan / Isi Kemasan (Pisahkan Koma)
                </label>
                <Input
                  placeholder="Contoh: 1Kg, 500g atau 1 box isi 6 pouch 2kg"
                  value={isiPaket}
                  onChange={(e) => setIsiPaket(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Satuan Eceran
                </label>
                <select
                  value={satuanEcer}
                  onChange={(e) => setSatuanEcer(e.target.value)}
                  disabled={tipeSatuan === "paket"}
                  className="h-9 w-full rounded-xl border border-input bg-background px-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
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

      {/* Filter & ReUI DataGrid List */}
      <DataGrid
        table={masterTable}
        recordCount={filteredItems.length}
        isLoading={isLoading}
        tableLayout={{ columnsResizable: true }}
      >
        <Card className="border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Cari nama item baku atau kata kunci alias..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs rounded-xl bg-slate-50/70 dark:bg-slate-800/70"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filters
                variant="advanced"
                advancedMode="popover"
                advancedAlign="end"
                reorderable
                fields={masterFilterFields}
                query={masterFilterQuery}
                onQueryChange={handleMasterQueryChange}
                className="[--filter-field-width:9rem] [--filter-operator-width:6.5rem] [--filter-value-width:11rem]"
              />
              <select
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
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

          {/* Selected Items Merge Action Bar */}
          {selectedIds.length > 0 && (
            <div className="bg-blue-50/80 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900 px-4 py-2.5 flex items-center justify-between gap-3 text-xs animate-in fade-in">
              <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-medium">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>
                  <strong>{selectedIds.length}</strong> item dipilih
                  {selectedIds.length < 2 && (
                    <span className="text-slate-500 font-normal ml-1">
                      (Pilih minimal 2 item untuk digabungkan)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={selectedIds.length < 2}
                  onClick={() => {
                    const selectedItems = masterItems.filter((m) =>
                      selectedIds.includes(m.id)
                    );
                    openMergeDialogForItems(selectedItems);
                  }}
                  className="h-8 rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  Gabungkan ({selectedIds.length}) Jadi 1 Item
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds([])}
                  className="h-8 rounded-xl text-xs text-slate-600 hover:text-slate-900"
                >
                  Batal
                </Button>
              </div>
            </div>
          )}

          <CardContent className="p-0">
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </CardContent>

          <CardFooter className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 bg-slate-50/50 dark:bg-slate-900/50">
            <DataGridPagination />
          </CardFooter>
        </Card>
      </DataGrid>

      {/* Floating Action Bar ketika item dipilih */}
      {selectedIds.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-4 border border-slate-700/80 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold">
              <strong>{selectedIds.length} item</strong> dipilih
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                const selectedItems = masterItems.filter((m) =>
                  selectedIds.includes(m.id)
                );
                openMergeDialogForItems(selectedItems);
              }}
              className="rounded-xl text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
            >
              <GitMerge className="w-3.5 h-3.5" />
              Gabungkan Jadi 1 Item
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
              className="rounded-xl text-xs text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* Dialog Audit Duplikat Item Master */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
                  <SearchCheck className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Audit Duplikat Katalog Item Baku
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 mt-0.5">
                    Deteksi otomatis item yang sama namun berbeda awalan/akhiran akibat input scan AI atau variasi penulisan.
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Sub-toolbar controls */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/60">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">Tingkat Kemiripan:</span>
                <select
                  value={auditMinScore}
                  onChange={(e) => setAuditMinScore(parseFloat(e.target.value))}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium"
                >
                  <option value={0.80}>Ketat (80% kemiripan)</option>
                  <option value={0.70}>Normal (70% kemiripan - Rekomendasi)</option>
                  <option value={0.60}>Sensitif / Luas (60% kemiripan)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                {auditPairs.length > 0 && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleBatchMergeAllSuggested}
                    disabled={batchMergeMutation.isPending}
                    className="h-8 rounded-lg text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
                    title="Gabungkan semua rekomendasi item duplikat sekaligus secara asinkron di antrean latar belakang"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    {batchMergeMutation.isPending
                      ? "Mendaftarkan..."
                      : `Gabungkan Semua (${auditPairs.length} Pasang) di Antrean`}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchAudit()}
                  disabled={isAuditing}
                  className="h-8 rounded-lg text-xs gap-1.5"
                >
                  <RefreshCw className={`w-3 h-3 ${isAuditing ? "animate-spin" : ""}`} />
                  Pindai Ulang
                </Button>
                <Badge variant="secondary" className="text-xs py-1 px-2.5 font-semibold">
                  {auditPairs.length} Potensi Duplikat
                </Badge>
              </div>
            </div>
          </DialogHeader>

          {/* Dialog Body - Scrollable */}
          <div className="p-6 overflow-y-auto space-y-4 flex-1 bg-slate-50/30">
            {isAuditing ? (
              <div className="py-16 text-center space-y-3">
                <RefreshCw className="w-7 h-7 text-blue-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-800">
                  Sedang menganalisis katalog item baku...
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Mencocokkan kemiripan teks, susunan kata, awalan/akhiran, dan riwayat transaksi...
                </p>
              </div>
            ) : auditPairs.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">
                  Katalog Rapi! Tidak Ada Duplikat
                </h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Tidak ditemukan item ganda atau variasi awalan/akhiran yang mencurigakan pada tingkat sensitivitas saat ini.
                </p>
              </div>
            ) : (
              auditPairs.map((pair) => {
                const isItemAPrimary = pair.suggested_primary_id === pair.item_a.id;
                return (
                  <div
                    key={`${pair.item_a.id}-${pair.item_b.id}`}
                    className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-3 hover:border-slate-300 transition-colors"
                  >
                    {/* Header info */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-[11px] font-medium bg-amber-50 text-amber-800 border-amber-200"
                        >
                          {pair.reason}
                        </Badge>
                      </div>
                      <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                        {Math.round(pair.similarity_score * 100)}% Kemiripan
                      </Badge>
                    </div>

                    {/* Comparison 2 Items */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Item A */}
                      <div
                        className={`p-3 rounded-xl border transition-all text-xs space-y-1.5 ${
                          isItemAPrimary
                            ? "border-blue-300 bg-blue-50/20 shadow-xs"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 text-sm">
                            {pair.item_a.item_name}
                          </span>
                          {isItemAPrimary && (
                            <Badge className="bg-blue-600 text-white text-[10px] font-medium">
                              ⭐ Disarankan Utama
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {pair.item_a.category}
                          </Badge>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Satuan: <strong>{pair.item_a.satuan_beli || "Pcs"}</strong>
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Toko: <strong>{pair.item_a.default_supplier || "-"}</strong>
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-2">
                          <span className="text-slate-500">
                            Riwayat:{" "}
                            <strong className="text-slate-800">{pair.item_a.tx_count}x transaksi</strong>
                          </span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {pair.item_a.last_unit_price > 0
                              ? formatRupiah(pair.item_a.last_unit_price)
                              : "-"}
                          </span>
                        </div>
                      </div>

                      {/* Item B */}
                      <div
                        className={`p-3 rounded-xl border transition-all text-xs space-y-1.5 ${
                          !isItemAPrimary
                            ? "border-blue-300 bg-blue-50/20 shadow-xs"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 text-sm">
                            {pair.item_b.item_name}
                          </span>
                          {!isItemAPrimary && (
                            <Badge className="bg-blue-600 text-white text-[10px] font-medium">
                              ⭐ Disarankan Utama
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {pair.item_b.category}
                          </Badge>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Satuan: <strong>{pair.item_b.satuan_beli || "Pcs"}</strong>
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">
                            Toko: <strong>{pair.item_b.default_supplier || "-"}</strong>
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-2">
                          <span className="text-slate-500">
                            Riwayat:{" "}
                            <strong className="text-slate-800">{pair.item_b.tx_count}x transaksi</strong>
                          </span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {pair.item_b.last_unit_price > 0
                              ? formatRupiah(pair.item_b.last_unit_price)
                              : "-"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => ignorePair(pair.item_a.id, pair.item_b.id)}
                        className="text-slate-400 hover:text-slate-700 text-xs h-8"
                      >
                        Abaikan
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          openMergeDialogForItems(
                            [pair.item_a, pair.item_b],
                            pair.suggested_primary_id
                          )
                        }
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold gap-1.5 h-8 rounded-xl shadow-xs"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        Gabungkan Jadi 1 Item
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAuditModal(false)}
              className="rounded-xl text-xs"
            >
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Konfirmasi & Eksekusi Merge Item */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-6 overflow-y-auto rounded-2xl">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                <GitMerge className="w-4 h-4" />
              </div>
              <DialogTitle className="text-base font-bold text-slate-900">
                Gabungkan Item Baku
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500">
              Pilih satu item baku utama yang dipertahankan. Item lainnya akan dilebur, riwayat transaksi dialihkan, dan namanya dicatat ke kata kunci alias.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2 text-xs">
            {/* Step 1: Pilih Item Utama */}
            <div className="space-y-2">
              <label className="font-semibold text-slate-700 block">
                1. Pilih Item Utama yang Dipertahankan:
              </label>
              <div className="space-y-2">
                {mergeItemsList.map((item) => {
                  const isSelected = targetItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectPrimaryTarget(item)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                        isSelected
                          ? "border-blue-500 bg-blue-50/30 ring-1 ring-blue-500"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name="primary_item"
                        checked={isSelected}
                        onChange={() => handleSelectPrimaryTarget(item)}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{item.item_name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {item.category}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                          <span>Toko: <strong>{item.default_supplier || "-"}</strong></span>
                          <span>Satuan: <strong>{item.satuan_beli || "Pcs"}</strong></span>
                          <span>Transaksi: <strong className="text-blue-700">{item.tx_count}x</strong></span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Sesuaikan Nama Baku & Kategori Hasil Gabungan */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="font-semibold text-slate-700 block">
                2. Sesuaikan Data Akhir Hasil Gabungan:
              </label>

              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Nama Baku Akhir *
                </label>
                <Input
                  value={customMergeName}
                  onChange={(e) => setCustomMergeName(e.target.value)}
                  className="h-9 text-xs rounded-xl"
                  placeholder="Nama baku yang akan digunakan di semua transaksi"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Kategori
                  </label>
                  <select
                    value={customMergeCategory}
                    onChange={(e) => setCustomMergeCategory(e.target.value)}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Toko Default
                  </label>
                  <Input
                    value={customMergeSupplier}
                    onChange={(e) => setCustomMergeSupplier(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                    placeholder="Nama toko"
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Opsi Gabung & Alias */}
            <div className="space-y-2 pt-2 border-t border-slate-100 bg-slate-50/70 p-3 rounded-xl border border-slate-200/60">
              <span className="font-semibold text-slate-800 block text-[11px]">
                Opsi Sinkronisasi & Otomasi AI:
              </span>
              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={mergeAliasesOption}
                  onChange={(e) => setMergeAliasesOption(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>Tambahkan nama item lain ke Kata Kunci / Alias Struk</strong>
                  <br />
                  <span className="text-slate-500 text-[10px]">
                    Scan AI di masa depan yang membaca variasi nama ini akan otomatis disamakan ke item baku utama ini.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={updateExpensesOption}
                  onChange={(e) => setUpdateExpensesOption(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>Alihkan semua riwayat transaksi ke item utama ini</strong>
                  <br />
                  <span className="text-slate-500 text-[10px]">
                    Nama asli di nota belanja fisik tetap tersimpan aman di kolom Catatan/Keterangan.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700 pt-1 border-t border-slate-200/50">
                <input
                  type="checkbox"
                  checked={runMergeInBackground}
                  onChange={(e) => setRunMergeInBackground(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <strong>Jalankan di antrean latar belakang (Background Action)</strong>
                  <br />
                  <span className="text-slate-500 text-[10px]">
                    Proses penggabungan berjalan secara asinkron tanpa menunggu di browser, ideal jika transaksi sangat banyak.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeDialogOpen(false)}
              className="rounded-xl text-xs"
            >
              Batal
            </Button>
            <Button
              size="sm"
              disabled={mergeMutation.isPending || !customMergeName.trim()}
              onClick={handleExecuteMerge}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold gap-1.5 px-4"
            >
              <GitMerge className="w-3.5 h-3.5" />
              {mergeMutation.isPending ? "Menggabungkan..." : "Ya, Gabungkan Sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
