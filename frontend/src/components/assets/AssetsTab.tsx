import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAssets,
  createAsset,
  syncExistingAssets,
  reanalyzeAssets,
  downloadAssetCsvTemplate,
  bulkCreateAssets,
  importAssetsCsv,
} from "@/lib/api";
import {
  BulkRowImportDialog,
  type BulkRowColumn,
} from "@/components/common/BulkRowImportDialog";
import { CsvTemplateImportDialog } from "@/components/common/CsvTemplateImportDialog";
import { DataTable } from "@/components/common/DataTable";
import {
  LedgerMetricStrip,
  LedgerStateBlock,
} from "@/components/common/LedgerPrimitives";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef } from "@tanstack/react-table";
import { Table2, FileSpreadsheet } from "lucide-react";
import { FixedAsset, AssetReanalyzeResult } from "@/types";
import { formatDateId, formatRupiah, toIsoDate } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Boxes,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  TrendingDown,
  Wallet,
  Calculator,
  AlertCircle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { AssetDetailModal } from "./AssetDetailModal";
import { AssetLabelPrintModal } from "./AssetLabelPrintModal";

interface AssetsTabProps {
  isOwner: boolean;
}

export const AssetsTab: React.FC<AssetsTabProps> = ({ isOwner }) => {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [capFilter, setCapFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);
  const [printAssets, setPrintAssets] = useState<FixedAsset[] | null>(null);
  const [isBulkFormOpen, setIsBulkFormOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);

  type BulkAssetRow = {
    name: string;
    asset_group: string;
    brand_model: string;
    serial_number: string;
    purchase_date: string;
    acquisition_cost: number;
    salvage_value: number;
    useful_life_months: number;
    location: string;
    pic_name: string;
    vendor_name: string;
    warranty_months: number;
    condition: string;
    status: string;
    notes: string;
  };

  const assetBulkColumns: BulkRowColumn<BulkAssetRow>[] = [
    { key: "name", label: "Nama Aset *", type: "text", required: true, placeholder: "Oven Deck 2 Loyang", widthClass: "min-w-[180px]" },
    {
      key: "asset_group",
      label: "Kelompok",
      type: "select",
      widthClass: "min-w-[165px]",
      options: [
        { value: "Mesin & Peralatan Dapur", label: "Mesin & Peralatan Dapur" },
        { value: "Pendingin & Showcase", label: "Pendingin & Showcase" },
        { value: "Elektronik & POS", label: "Elektronik & POS" },
        { value: "Furnitur & Rak", label: "Furnitur & Rak" },
        { value: "Kendaraan Operasional", label: "Kendaraan Operasional" },
        { value: "Peralatan Lainnya", label: "Peralatan Lainnya" },
      ],
    },
    { key: "brand_model", label: "Merk / Model", type: "text", placeholder: "Getra RFL-24", widthClass: "min-w-[130px]" },
    { key: "serial_number", label: "No. Seri", type: "text", placeholder: "SN-...", widthClass: "min-w-[120px]" },
    { key: "purchase_date", label: "Tgl Perolehan", type: "date", widthClass: "min-w-[135px]" },
    { key: "acquisition_cost", label: "Harga (Rp) *", type: "number", required: true, min: 0, widthClass: "min-w-[130px]" },
    { key: "salvage_value", label: "Residu (Rp)", type: "number", min: 0, widthClass: "min-w-[115px]" },
    { key: "useful_life_months", label: "Umur (Bln)", type: "number", min: 1, widthClass: "min-w-[95px]" },
    { key: "location", label: "Lokasi", type: "text", placeholder: "Dapur Produksi", widthClass: "min-w-[130px]" },
    { key: "pic_name", label: "PIC", type: "text", placeholder: "Nama PIC", widthClass: "min-w-[110px]" },
    { key: "vendor_name", label: "Vendor / Toko", type: "text", placeholder: "Toko Mesin", widthClass: "min-w-[130px]" },
    { key: "warranty_months", label: "Garansi (Bln)", type: "number", min: 0, widthClass: "min-w-[95px]" },
    {
      key: "condition",
      label: "Kondisi",
      type: "select",
      widthClass: "min-w-[120px]",
      options: [
        { value: "Baik", label: "Baik" },
        { value: "Perlu Servis", label: "Perlu Servis" },
        { value: "Rusak Ringan", label: "Rusak Ringan" },
        { value: "Rusak Berat", label: "Rusak Berat" },
      ],
    },
    {
      key: "status",
      label: "Status",
      type: "select",
      widthClass: "min-w-[130px]",
      options: [
        { value: "Aktif", label: "Aktif" },
        { value: "Dalam Perawatan", label: "Dalam Perawatan" },
        { value: "Tidak Digunakan", label: "Tidak Digunakan" },
      ],
    },
    { key: "notes", label: "Catatan", type: "text", placeholder: "Opsional", widthClass: "min-w-[140px]" },
  ];

  const createEmptyAssetRow = (): BulkAssetRow => ({
    name: "",
    asset_group: "Mesin & Peralatan Dapur",
    brand_model: "",
    serial_number: "",
    purchase_date: new Date().toISOString().split("T")[0],
    acquisition_cost: 0,
    salvage_value: 0,
    useful_life_months: activeDefaultLife || 48,
    location: "Dapur Produksi",
    pic_name: "-",
    vendor_name: "-",
    warranty_months: 12,
    condition: "Baik",
    status: "Aktif",
    notes: "",
  });

  const bulkFormMutation = useMutation({
    mutationFn: (rows: BulkAssetRow[]) =>
      bulkCreateAssets(
        rows.map((r) => ({
          name: r.name.trim(),
          asset_group: r.asset_group || undefined,
          brand_model: r.brand_model.trim() || undefined,
          serial_number: r.serial_number.trim() || undefined,
          purchase_date: r.purchase_date || new Date().toISOString().split("T")[0],
          acquisition_cost: Number(r.acquisition_cost) || 0,
          salvage_value: Number(r.salvage_value) || 0,
          useful_life_months:
            Number(r.useful_life_months) > 0 ? Number(r.useful_life_months) : undefined,
          location: r.location.trim() || "Dapur Produksi",
          pic_name: r.pic_name.trim() || "-",
          vendor_name: r.vendor_name.trim() || "-",
          warranty_months: Math.max(0, Number(r.warranty_months) || 0),
          condition: r.condition || "Baik",
          status: r.status || "Aktif",
          notes: r.notes.trim() || undefined,
        }))
      ),
    onSuccess: (res) => {
      toast.success(res.message || `${res.added} aset berhasil ditambahkan.`);
      if (res.errors && res.errors.length > 0) {
        toast.warning(`Catatan: ${res.errors.slice(0, 3).join("; ")}`);
      }
      setIsBulkFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menyimpan aset masal.");
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: (file: File) => importAssetsCsv(file),
    onSuccess: (res) => {
      toast.success(res.message || `${res.added} aset berhasil diimpor dari CSV.`);
      if (res.errors && res.errors.length > 0) {
        toast.warning(`Catatan: ${res.errors.slice(0, 3).join("; ")}`);
      }
      setIsCsvImportOpen(false);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mengimpor file CSV aset.");
    },
  });

  // Analisa Ulang Modal
  const [isReanalyzeOpen, setIsReanalyzeOpen] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");
  const [lifeInput, setLifeInput] = useState("");
  const [lastReanalyzeResult, setLastReanalyzeResult] = useState<AssetReanalyzeResult | null>(null);

  // Add Manual Asset Modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState("Mesin & Peralatan Dapur");
  const [newCost, setNewCost] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newLocation, setNewLocation] = useState("Dapur Produksi");
  const [newVendor, setNewVendor] = useState("");
  const [newWarranty, setNewWarranty] = useState("12");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets", search, statusFilter, capFilter, groupFilter],
    queryFn: () =>
      getAssets({
        search: search || undefined,
        status: statusFilter,
        capitalization_status: capFilter,
        asset_group: groupFilter,
      }),
  });

  const assets = useMemo(() => data?.items || [], [data]);
  const summary = data?.summary;
  const activeThreshold = data?.config?.asset_capitalization_threshold ?? 500000;
  const activeDefaultLife = data?.config?.asset_default_useful_life_months ?? 48;

  const syncMutation = useMutation({
    mutationFn: () => syncExistingAssets(),
    onSuccess: (res) => {
      toast.success(res.message);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal sinkronisasi data Asset.");
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: () =>
      reanalyzeAssets({
        asset_capitalization_threshold: thresholdInput ? Number(thresholdInput) : undefined,
        asset_default_useful_life_months: lifeInput ? Number(lifeInput) : undefined,
      }),
    onSuccess: (res) => {
      setLastReanalyzeResult(res);
      toast.success(res.message);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menganalisa ulang aset.");
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createAsset({
        name: newName.trim(),
        asset_group: newGroup,
        acquisition_cost: Number(newCost || 0),
        purchase_date: newDate,
        location: newLocation.trim() || "Dapur Produksi",
        vendor_name: newVendor.trim() || "-",
        warranty_months: Number(newWarranty || 0),
      }),
    onSuccess: () => {
      toast.success("Aset inventaris berhasil ditambahkan.");
      setIsAddOpen(false);
      setNewName("");
      setNewCost("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounting-report"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal menambah aset.");
    },
  });

  const openReanalyzeDialog = () => {
    setThresholdInput(String(activeThreshold));
    setLifeInput(String(activeDefaultLife));
    setLastReanalyzeResult(null);
    setIsReanalyzeOpen(true);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === assets.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(assets.map((a) => a.id));
    }
  };

  const assetColumns = useMemo<ColumnDef<DataGridFeatures, FixedAsset>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selectedIds.length > 0 && selectedIds.length === assets.length}
              onChange={toggleSelectAll}
              aria-label="Pilih semua aset"
              className="w-4 h-4 rounded"
            />
          </div>
        ),
        cell: ({ row }) => {
          const ast = row.original;
          return (
            <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selectedIds.includes(ast.id)}
                onChange={() => toggleSelect(ast.id)}
                aria-label={`Pilih ${ast.asset_code}`}
                className="w-4 h-4 rounded"
              />
            </div>
          );
        },
        size: 42,
        enableSorting: false,
      },
      {
        accessorKey: "name",
        id: "name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Kode & Nama Aset" column={column} />
        ),
        cell: ({ row }) => {
          const ast = row.original;
          return (
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {ast.asset_code}
                </span>
                {ast.capitalization_status === "expensed_low_value" ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-600"
                  >
                    Nilai Rendah
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-blue-200 bg-blue-50 text-blue-700"
                  >
                    Aset Tetap
                  </Badge>
                )}
              </div>
              <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {ast.name}
              </p>
              <p className="text-[11px] text-slate-500">
                {ast.asset_group} • Beli {formatDateId(ast.purchase_date)}
              </p>
            </div>
          );
        },
        size: 240,
      },
      {
        accessorKey: "location",
        id: "location",
        header: ({ column }) => (
          <DataGridColumnHeader title="Lokasi & Status" column={column} />
        ),
        cell: ({ row }) => {
          const ast = row.original;
          return (
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">{ast.location}</p>
              <Badge
                variant="outline"
                className={`mt-1 text-[10px] ${
                  ast.status === "Aktif"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : ast.status === "Dalam Perbaikan"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                {ast.status} • {ast.condition}
              </Badge>
            </div>
          );
        },
        size: 170,
      },
      {
        accessorKey: "warranty_status",
        id: "warranty_status",
        header: () => <span>Garansi &amp; Servis</span>,
        cell: ({ row }) => {
          const ast = row.original;
          return (
            <div>
              <p className="text-slate-800 dark:text-slate-200 font-medium">
                {ast.warranty_status}
              </p>
              <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                <Wrench className="w-3 h-3" />
                {ast.maintenance_count} servis
              </p>
            </div>
          );
        },
        size: 145,
      },
      {
        accessorKey: "acquisition_cost",
        id: "acquisition_cost",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Perolehan"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {formatRupiah(row.original.acquisition_cost || 0)}
          </div>
        ),
        size: 125,
      },
      {
        accessorKey: "accumulated_depreciation",
        id: "accumulated_depreciation",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Akum. Susut"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-amber-800 dark:text-amber-400 whitespace-nowrap">
            {formatRupiah(row.original.accumulated_depreciation || 0)}
          </div>
        ),
        size: 125,
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
          <div className="text-right tabular-nums font-bold text-emerald-800 dark:text-emerald-400 whitespace-nowrap">
            {formatRupiah(row.original.net_book_value || 0)}
          </div>
        ),
        size: 125,
      },
      {
        id: "actions",
        header: () => <div className="text-right w-full">Aksi</div>,
        cell: ({ row }) => {
          const ast = row.original;
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPrintAssets([ast])}
                className="h-8 px-2 text-xs gap-1"
                title="Cetak Label QR"
              >
                <QrCode className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        },
        size: 70,
      },
    ],
    [assets, selectedIds]
  );

  const handleOpenBatchPrint = () => {
    const targets =
      selectedIds.length > 0
        ? assets.filter((a) => selectedIds.includes(a.id))
        : assets;
    setPrintAssets(targets);
  };

  const totalAcq = summary?.total_acquisition_cost ?? 0;
  const totalDepr = summary?.total_accumulated_depreciation ?? 0;
  const totalNbv = summary?.total_net_book_value ?? 0;

  return (
    <div className="space-y-3 pb-6">
      {/* 1. Editorial Header Strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
            Buku Inventaris &amp; Penyusutan Aset
          </h2>
          <p className="text-xs text-[var(--ledger-muted)] tabular-nums">
            {summary?.active_assets ?? assets.length} unit aktif •{" "}
            {summary?.capitalized_count ?? 0} dikapitalisasi •{" "}
            {summary?.low_value_count ?? 0} nilai rendah
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-center">
          {/* Dropdown: Alat & Analisa (Khusus Owner) */}
          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-xs font-semibold gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
                >
                  <Calculator className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Alat &amp; Audit</span>
                  <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 rounded-xl p-1.5 shadow-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <DropdownMenuLabel className="text-[11px] font-semibold text-[var(--ledger-muted)] px-2 py-1">
                  Audit &amp; Sinkronisasi
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={openReanalyzeDialog}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <Calculator className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <div className="font-medium">Analisa Ulang Aset</div>
                    <div className="text-[10px] text-[var(--ledger-muted)]">
                      Evaluasi threshold &amp; umur manfaat
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={syncMutation.isPending}
                  onClick={() => syncMutation.mutate()}
                  className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-indigo-500 ${
                      syncMutation.isPending ? "animate-spin" : ""
                    }`}
                  />
                  <div>
                    <div className="font-medium">
                      {syncMutation.isPending ? "Sinkronisasi..." : "Sinkron Data Asset"}
                    </div>
                    <div className="text-[10px] text-[var(--ledger-muted)]">
                      Tarik belanja kategori Asset ke inventaris
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Cetak Label QR */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenBatchPrint}
            disabled={assets.length === 0}
            className="h-8 rounded-lg text-xs font-semibold gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Cetak Label QR {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}</span>
          </Button>

          {/* Dropdown: Import / Masal */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-xs font-semibold gap-1.5 border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
              >
                <Table2 className="w-3.5 h-3.5 text-[var(--ledger-muted)]" />
                <span>Import / Masal</span>
                <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52 rounded-xl p-1.5 shadow-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)]"
            >
              <DropdownMenuLabel className="text-[11px] font-semibold text-[var(--ledger-muted)] px-2 py-1">
                Pilihan Input Massal
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setIsBulkFormOpen(true)}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <Table2 className="w-3.5 h-3.5 text-blue-500" />
                <div>
                  <div className="font-medium">Tambah Masal</div>
                  <div className="text-[10px] text-[var(--ledger-muted)]">
                    Spreadsheet input multi-aset
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsCsvImportOpen(true)}
                className="text-xs gap-2 py-2 cursor-pointer rounded-lg"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                <div>
                  <div className="font-medium">Import CSV</div>
                  <div className="text-[10px] text-[var(--ledger-muted)]">Upload template file CSV</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tambah Aset (Primary) */}
          <Button
            type="button"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="h-8 rounded-lg text-xs font-semibold gap-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 ledger-press"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Aset</span>
          </Button>
        </div>
      </div>

      {/* 2. Unified Asymmetric Metric Strip (Zero Nested Cards) */}
      <LedgerMetricStrip
        isLoading={isLoading && !summary}
        primary={{
          label: "Nilai Buku Bersih (NBV)",
          value: formatRupiah(totalNbv),
          valueClassName: "text-[var(--signal-cleared)]",
          subtext: `${summary?.warranty_expiring_count ?? 0} garansi segera habis • ${summary?.upcoming_service_count ?? 0} jadwal servis`,
          segments:
            totalAcq > 0
              ? [
                  {
                    key: "nbv",
                    label: "Nilai Buku",
                    value: Math.max(0, totalNbv),
                    displayValue: formatRupiah(totalNbv),
                    colorClass: "bg-emerald-600 dark:bg-emerald-400",
                  },
                  {
                    key: "depr",
                    label: "Akum. Susut",
                    value: Math.max(0, totalDepr),
                    displayValue: formatRupiah(totalDepr),
                    colorClass: "bg-amber-500 dark:bg-amber-400",
                  },
                ]
              : undefined,
        }}
        supporting={[
          {
            key: "units",
            label: "Total Unit Inventaris",
            value: `${summary?.active_assets ?? 0} Unit`,
            subtext: `${summary?.capitalized_count ?? 0} dikapitalisasi • ${summary?.low_value_count ?? 0} beban`,
          },
          {
            key: "acq",
            label: "Harga Perolehan (1-2100)",
            value: formatRupiah(totalAcq),
            subtext: "Aset tetap aktif di Neraca",
          },
          {
            key: "depr",
            label: "Akum. Penyusutan (1-2190)",
            value: formatRupiah(totalDepr),
            valueClassName: "text-[var(--signal-dp)]",
            subtext: `Susut bln ini: ${formatRupiah(summary?.monthly_depreciation_total ?? 0)}`,
          },
        ]}
      />

      {/* 3. Unified Ledger Filter & DataTable Surface */}
      <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
        <div className="p-3 sm:px-3.5 sm:py-2.5 border-b border-[color:var(--ledger-hairline)] flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5">
          <div className="relative flex-1 max-w-md min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode aset, nama, seri, vendor, lokasi..."
              className="pl-8 h-9 text-xs rounded-lg bg-[var(--ledger-surface)] border-[color:var(--ledger-hairline)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={capFilter}
              onChange={(e) => setCapFilter(e.target.value)}
              aria-label="Filter tipe kapitalisasi aset"
              className="h-9 px-2.5 text-xs rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] font-medium text-[var(--ledger-ink)]"
            >
              <option value="all">Semua Kapitalisasi</option>
              <option value="capitalized">Dikapitalisasi (Disusutkan)</option>
              <option value="expensed_low_value">Nilai Rendah (Langsung Beban)</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter status inventaris aset"
              className="h-9 px-2.5 text-xs rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] font-medium text-[var(--ledger-ink)]"
            >
              <option value="all">Semua Status</option>
              <option value="Aktif">Aktif</option>
              <option value="Dalam Perbaikan">Dalam Perbaikan</option>
              <option value="Disimpan">Disimpan</option>
              <option value="Dihapuskan">Dihapuskan</option>
              <option value="Dijual">Dijual</option>
            </select>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              aria-label="Filter kelompok inventaris aset"
              className="h-9 px-2.5 text-xs rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] font-medium text-[var(--ledger-ink)]"
            >
              <option value="all">Semua Kelompok</option>
              <option value="Mesin & Peralatan Dapur">Mesin &amp; Peralatan Dapur</option>
              <option value="Pendingin & Showcase">Pendingin &amp; Showcase</option>
              <option value="Elektronik & POS">Elektronik &amp; POS</option>
              <option value="Furnitur & Rak">Furnitur &amp; Rak</option>
              <option value="Kendaraan Operasional">Kendaraan Operasional</option>
              <option value="Perlengkapan Kecil">Perlengkapan Kecil</option>
            </select>
          </div>
        </div>

        {/* Content States: Loading / Error / Empty / Table */}
        {isLoading ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-[var(--ledger-muted)]">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span>Memuat inventaris aset...</span>
          </div>
        ) : isError ? (
          <LedgerStateBlock
            variant="error"
            title="Gagal memuat data inventaris"
            description="Periksa koneksi jaringan lalu coba muat ulang inventaris aset."
            actions={
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Coba Lagi
              </Button>
            }
          />
        ) : assets.length === 0 ? (
          <LedgerStateBlock
            variant="empty"
            icon={<Boxes className="w-7 h-7" />}
            title="Belum ada data aset di inventaris"
            description="Catat pengeluaran berkategori Asset atau klik Sinkron Data Asset untuk memigrasi transaksi lama."
          />
        ) : (
          <DataTable
            columns={assetColumns}
            data={assets}
            getRowId={(row) => String(row.id)}
            defaultPageSize={10}
            onRowClick={(ast) => setDetailAssetId(ast.id)}
            containerClassName="border-0 rounded-none shadow-none"
            footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
            tableWrapperClassName="hidden md:block"
          >
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-[color:var(--ledger-hairline)]">
              {assets.map((ast) => (
                <div
                  key={ast.id}
                  onClick={() => setDetailAssetId(ast.id)}
                  className="p-3.5 space-y-2 ledger-hover-recessed transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">{ast.asset_code}</span>
                      <p className="text-sm font-bold text-[var(--ledger-ink)] truncate">{ast.name}</p>
                      <p className="text-[11px] text-[var(--ledger-muted)]">{ast.location} • {ast.status}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrintAssets([ast]);
                      }}
                      className="h-9 px-2.5 shrink-0"
                    >
                      <QrCode className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1 tabular-nums">
                    <span className="text-[var(--ledger-muted)]">Perolehan: <strong className="text-[var(--ledger-ink)]">{formatRupiah(ast.acquisition_cost || 0)}</strong></span>
                    <span className="text-[var(--signal-cleared)] font-bold">NBV: {formatRupiah(ast.net_book_value || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </DataTable>
        )}
      </div>

      {/* Modal Analisa Ulang Aset */}
      <Dialog open={isReanalyzeOpen} onOpenChange={setIsReanalyzeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-600" />
              Analisa Ulang Aset Tetap
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ubah batas minimal harga kapitalisasi aset lalu evaluasi ulang seluruh data inventaris (kecuali aset yang dikunci manual).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Minimal Harga Kapitalisasi (Rp)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Masa Manfaat Default (Bulan)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={lifeInput}
                  onChange={(e) => setLifeInput(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {lastReanalyzeResult && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1">
                <p className="font-bold">{lastReanalyzeResult.message}</p>
                <p className="text-[11px]">
                  Total Aset Tetap Neraca (1-2100):{" "}
                  <strong>{formatRupiah(lastReanalyzeResult.capitalized_total_before)}</strong> &rarr;{" "}
                  <strong>{formatRupiah(lastReanalyzeResult.capitalized_total_after)}</strong>
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsReanalyzeOpen(false)}>
              Tutup
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={reanalyzeMutation.isPending}
              onClick={() => reanalyzeMutation.mutate()}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reanalyzeMutation.isPending ? "animate-spin" : ""}`} />
              {reanalyzeMutation.isPending ? "Menganalisa..." : "Simpan & Analisa Ulang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Tambah Aset Manual */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Tambah Aset Inventaris</DialogTitle>
            <DialogDescription className="text-xs">
              Daftarkan aset fisik yang sudah dimiliki sebelumnya ke buku inventaris &amp; label QR.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Nama Aset *</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="mis: Oven Deck 2 Loyang" required className="h-9 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Kelompok</label>
                <select value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className="w-full h-9 px-2 text-xs rounded-md border border-input bg-white">
                  <option value="Mesin & Peralatan Dapur">Mesin & Peralatan Dapur</option>
                  <option value="Pendingin & Showcase">Pendingin & Showcase</option>
                  <option value="Elektronik & POS">Elektronik & POS</option>
                  <option value="Furnitur & Rak">Furnitur & Rak</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tanggal Perolehan</label>
                <DatePicker value={newDate} onChange={(d) => setNewDate(toIsoDate(d))} className="w-full h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Harga Perolehan (Rp) *</label>
                <Input type="number" min={0} value={newCost} onChange={(e) => setNewCost(e.target.value)} required className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Garansi (Bulan)</label>
                <Input type="number" min={0} value={newWarranty} onChange={(e) => setNewWarranty(e.target.value)} className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Lokasi</label>
                <Input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} className="h-9 text-xs" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Vendor / Toko</label>
                <Input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>Batal</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {createMutation.isPending ? "Menyimpan..." : "Simpan Aset"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modals Detail & Cetak QR */}
      <AssetDetailModal
        assetId={detailAssetId}
        isOpen={detailAssetId !== null}
        onClose={() => setDetailAssetId(null)}
        onOpenPrintLabel={(list) => setPrintAssets(list)}
        canManageAccounting={isOwner}
      />

      <AssetLabelPrintModal
        isOpen={printAssets !== null}
        onClose={() => setPrintAssets(null)}
        assets={printAssets || []}
      />

      <BulkRowImportDialog<BulkAssetRow>
        isOpen={isBulkFormOpen}
        onClose={() => setIsBulkFormOpen(false)}
        title="Tambah Aset Inventaris Masal (Form Tabel)"
        description="Input banyak aset sekaligus atau tempel (paste) langsung dari Excel/Google Sheets. Kapitalisasi dan penyusutan SAK EMKM otomatis dihitung sesuai threshold aktif."
        columns={assetBulkColumns}
        createEmptyRow={createEmptyAssetRow}
        requiredKey="name"
        showUpdateExistingToggle={false}
        isSubmitting={bulkFormMutation.isPending}
        submitLabel="Simpan Semua Aset"
        onSubmit={async (rows) => {
          await bulkFormMutation.mutateAsync(rows);
        }}
      />

      <CsvTemplateImportDialog
        isOpen={isCsvImportOpen}
        onClose={() => setIsCsvImportOpen(false)}
        title="Import Aset Inventaris via Template CSV"
        description="Unduh template CSV resmi agar struktur kolom sesuai, isi data aset (separator koma atau titik koma didukung), lalu unggah kembali."
        templateColumns={[
          "Nama Aset",
          "Kelompok Aset",
          "Merk / Model",
          "Nomor Seri",
          "Tanggal Perolehan",
          "Harga Perolehan",
          "Nilai Residu",
          "Masa Manfaat (Bulan)",
          "Lokasi",
          "PIC",
          "Vendor / Toko",
          "Garansi (Bulan)",
          "Kondisi",
          "Status",
          "Catatan",
        ]}
        showUpdateExistingToggle={false}
        isImporting={csvImportMutation.isPending}
        onDownloadTemplate={downloadAssetCsvTemplate}
        onImportCsv={async (file) => {
          await csvImportMutation.mutateAsync(file);
        }}
      />
    </div>
  );
};
