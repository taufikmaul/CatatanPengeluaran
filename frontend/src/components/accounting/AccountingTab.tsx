import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAccountingReport, getDailyCashflow, exportDailyCashflowCsv, api } from "@/lib/api";
import { AccountingReportData, AccountLineItem, Expense, DailyCashflowResponse } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/common/DataTable";
import { SearchMinCharHint } from "@/components/common/HighlightText";
import { getEffectiveSearchQuery } from "@/lib/searchHighlight";
import {
  LedgerStateBlock,
  LedgerStatusTabs,
} from "@/components/common/LedgerPrimitives";
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { ColumnDef } from "@tanstack/react-table";
import {
  Scale,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  Layers,
  Receipt,
  Download,
  Printer,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Search,
  PieChart,
  BarChart3,
  Calendar,
  Wallet,
  Building,
  Wrench,
  Laptop,
  Megaphone,
  Users,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Info,
} from "lucide-react";

interface AccountingTabProps {
  currentMonth: number;
  currentYear: number;
  currentMonthEnd?: number;
  onMonthChange: (m: number) => void;
  onYearChange: (y: number) => void;
  onViewExpense?: (expense: Expense) => void;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export const AccountingTab: React.FC<AccountingTabProps> = ({
  currentMonth,
  currentYear,
  currentMonthEnd,
  onMonthChange,
  onYearChange,
  onViewExpense,
}) => {
  const effectiveMonthEnd = currentMonthEnd || currentMonth;
  const periodLabel = currentMonthEnd && currentMonthEnd !== currentMonth
    ? `${MONTH_NAMES[currentMonth - 1]} - ${MONTH_NAMES[currentMonthEnd - 1]} ${currentYear}`
    : `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

  // Sub-tabs dalam halaman akuntansi
  const [activeSubTab, setActiveSubTab] = useState<
    "laba_rugi" | "neraca" | "arus_kas" | "analisis" | "buku_besar"
  >("laba_rugi");

  // State untuk Buku Besar (Drill-Down Akun)
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState<string>("5-1100");
  const [ledgerSearch, setLedgerSearch] = useState<string>("");

  // State & Query untuk Arus Kas Harian (Daily Cashflow)
  const [selectedCashflowAccount, setSelectedCashflowAccount] = useState<number | null>(null);
  const [isExportingCashflow, setIsExportingCashflow] = useState(false);

  // Query Data Akuntansi
  const {
    data: accountingData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<AccountingReportData>({
    queryKey: ["accounting-report", currentMonth, currentYear, currentMonthEnd],
    queryFn: () => getAccountingReport(currentMonth, currentYear, currentMonthEnd),
    staleTime: 60 * 1000,
  });

  // Query Data Arus Kas Harian (Daily Cashflow)
  const {
    data: dailyCashflowData,
    isLoading: isLoadingCashflow,
    isError: isErrorCashflow,
    refetch: refetchCashflow,
  } = useQuery<DailyCashflowResponse>({
    queryKey: ["daily-cashflow", currentYear, currentMonth, currentMonthEnd, selectedCashflowAccount],
    queryFn: () =>
      getDailyCashflow({
        month: currentMonth,
        year: currentYear,
        monthEnd: currentMonthEnd,
        bankAccountId: selectedCashflowAccount || undefined,
      }),
    enabled: activeSubTab === "arus_kas",
    staleTime: 60 * 1000,
  });

  const handleExportCashflowCsv = async () => {
    setIsExportingCashflow(true);
    try {
      await exportDailyCashflowCsv({
        month: currentMonth,
        year: currentYear,
        monthEnd: currentMonthEnd,
        bankAccountId: selectedCashflowAccount || undefined,
      });
    } catch (err) {
      console.error("Gagal export cashflow:", err);
    } finally {
      setIsExportingCashflow(false);
    }
  };

  // Query Transaksi Buku Besar untuk akun terpilih
  const selectedAccountInfo = useMemo(() => {
    if (!accountingData?.all_accounts) return null;
    return accountingData.all_accounts.find(
      (a) => a.account_code === selectedLedgerAccount || a.category === selectedLedgerAccount
    );
  }, [accountingData, selectedLedgerAccount]);

  const ledgerCategory = selectedAccountInfo?.category || "Bahan Kue";

  const { data: ledgerExpensesData, isLoading: isLoadingLedger } = useQuery<{
    data: Expense[];
    total: number;
  }>({
    queryKey: ["ledger-expenses", ledgerCategory, currentMonth, currentYear],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("category", ledgerCategory);
      params.append("month", String(currentMonth));
      params.append("year", String(currentYear));
      params.append("per_page", "100");
      params.append("include_ongkir", "true");
      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
    enabled: activeSubTab === "buku_besar" && Boolean(ledgerCategory),
    staleTime: 60 * 1000,
  });

  const effectiveLedgerSearch = useMemo(
    () => getEffectiveSearchQuery(ledgerSearch),
    [ledgerSearch]
  );

  const filteredLedgerExpenses = useMemo(() => {
    if (!ledgerExpensesData?.data) return [];
    if (!effectiveLedgerSearch) return ledgerExpensesData.data;
    const q = effectiveLedgerSearch.toLowerCase();
    return ledgerExpensesData.data.filter(
      (e) =>
        e.item_name?.toLowerCase().includes(q) ||
        e.supplier?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q)
    );
  }, [ledgerExpensesData, effectiveLedgerSearch]);

  // Export Rekap Akuntansi ke CSV
  const handleExportCsv = () => {
    if (!accountingData) return;
    const lr = accountingData.laba_rugi;
    const cs = accountingData.analisis.cost_structure;
    const lines = [
      `LAPORAN AKUNTANSI KEUANGAN (SAK EMKM) - HISTORYCAKE`,
      `Periode: ${accountingData.month_name} ${accountingData.year}`,
      `Dicetak pada: ${new Date().toLocaleString("id-ID")}`,
      "",
      `0. RINGKASAN PENDAPATAN & PROFITABILITAS`,
      `"Penjualan Kotor (Gross Sales)",${lr.revenue_gross || 0}`,
      `"Diskon & Komisi Platform",-${(lr.revenue_discount || 0) + (lr.revenue_platform_fee || 0)}`,
      `"Pendapatan Bersih (Net Revenue)",${lr.revenue_net || 0}`,
      `"Laba Kotor (Gross Profit)",${lr.gross_profit || 0},"${lr.gross_margin_pct != null ? lr.gross_margin_pct + "%" : "-"}"`,
      `"Laba / Rugi Bersih (Net Profit)",${lr.net_profit || 0},"${lr.net_margin_pct != null ? lr.net_margin_pct + "%" : "-"}"`,
      "",
      `1. LAPORAN LABA RUGI (BEBAN POKOK & OPERASIONAL)`,
      `Kode Akun,Nama Akun,Kategori,Nominal Bulan Ini,Nominal Bulan Lalu,Selisih MoM,% Grup,% Beban Usaha,% Omset Bersih`,
    ];

    // HPP
    lines.push(`-- HARGA POKOK PENJUALAN (HPP) --,,,,,,,,`);
    lr.hpp_items.forEach((item) => {
      const revPct = item.percentage_of_revenue != null ? `${item.percentage_of_revenue}%` : "-";
      lines.push(
        `"${item.account_code}","${item.account_name}","${item.category}",${item.total},${item.prev_total},${item.diff_nominal},${item.percentage_of_group}%,${item.percentage_of_total_expense}%,${revPct}`
      );
    });
    lines.push(
      `"SUBTOTAL HPP","","Harga Pokok Penjualan",${lr.subtotal_hpp},${lr.prev_subtotal_hpp},${lr.subtotal_hpp - lr.prev_subtotal_hpp},100%,${cs.hpp_ratio}%,${cs.hpp_to_revenue_pct != null ? cs.hpp_to_revenue_pct + "%" : "-"}`
    );

    // OPEX
    lines.push(``);
    lines.push(`-- BEBAN OPERASIONAL & UMUM (OPEX) --,,,,,,,,`);
    lr.opex_items.forEach((item) => {
      const revPct = item.percentage_of_revenue != null ? `${item.percentage_of_revenue}%` : "-";
      lines.push(
        `"${item.account_code}","${item.account_name}","${item.category}",${item.total},${item.prev_total},${item.diff_nominal},${item.percentage_of_group}%,${item.percentage_of_total_expense}%,${revPct}`
      );
    });
    lines.push(
      `"SUBTOTAL OPEX","","Beban Operasional",${lr.subtotal_opex},${lr.prev_subtotal_opex},${lr.subtotal_opex - lr.prev_subtotal_opex},100%,${cs.opex_ratio}%,${cs.opex_to_revenue_pct != null ? cs.opex_to_revenue_pct + "%" : "-"}`
    );

    // Total Beban
    lines.push(``);
    lines.push(
      `"TOTAL BEBAN USAHA (LABA RUGI)","","",${lr.total_beban},${lr.prev_total_beban},${lr.total_beban - lr.prev_total_beban},-,100%,-`
    );

    // Neraca
    lines.push(``);
    lines.push(`2. LAPORAN POSISI KEUANGAN (NERACA STANDAR SAK EMKM)`);
    lines.push(`Kode Akun,Nama Akun,Kelompok,Nominal,Keterangan`);
    accountingData.neraca.aset_lancar.forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Aset Lancar",${item.nominal},"${item.description}"`);
    });
    accountingData.neraca.aset_tetap.forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Aset Tetap",${item.nominal},"${item.description}"`);
    });
    lines.push(`"TOTAL ASET","Total Aktiva (Aset Lancar + Aset Tetap)","Total Aset",${accountingData.neraca.total_aset},""`);
    accountingData.neraca.kewajiban_lancar.forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Kewajiban Lancar",${item.nominal},"${item.description}"`);
    });
    (accountingData.neraca.ekuitas || []).forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Ekuitas",${item.nominal},"${item.description}"`);
    });

    const csvContent = "data:text/csv;charset=utf-8," + lines.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `laporan_akuntansi_${accountingData.year}_${accountingData.month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  const buildLabaRugiColumns = (
    pctTitle: string,
    pctColorClass: string
  ): ColumnDef<DataGridFeatures, AccountLineItem>[] => [
    {
      accessorKey: "account_code",
      id: "account_code",
      header: ({ column }) => <DataGridColumnHeader title="Kode Akun" column={column} />,
      cell: ({ row }) => (
        <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
          {row.original.account_code}
        </span>
      ),
      size: 95,
    },
    {
      accessorKey: "account_name",
      id: "account_name",
      header: ({ column }) => (
        <DataGridColumnHeader title="Nama Akun Akuntansi" column={column} />
      ),
      cell: ({ row }) => (
        <div>
          <span className="font-semibold text-slate-900 dark:text-slate-100 block">
            {row.original.account_name}
          </span>
          <span className="text-[11px] text-slate-400 block truncate max-w-xs">
            {row.original.description}
          </span>
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: "category",
      id: "category",
      header: ({ column }) => (
        <DataGridColumnHeader title="Kategori Belanja" column={column} />
      ),
      cell: ({ row }) => {
        const color = getCategoryColor(row.original.category);
        return (
          <span
            className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${color.bg} ${color.border}`}
          >
            {row.original.category}
          </span>
        );
      },
      size: 145,
    },
    {
      accessorKey: "total",
      id: "total",
      header: ({ column }) => (
        <DataGridColumnHeader
          title="Bulan Ini"
          column={column}
          className="justify-end text-right"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
          {formatRupiah(row.original.total)}
        </div>
      ),
      size: 125,
    },
    {
      accessorKey: "prev_total",
      id: "prev_total",
      header: ({ column }) => (
        <DataGridColumnHeader
          title="Bulan Lalu"
          column={column}
          className="justify-end text-right"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right text-slate-500 tabular-nums whitespace-nowrap">
          {formatRupiah(row.original.prev_total)}
        </div>
      ),
      size: 120,
    },
    {
      accessorKey: "mom_change_pct",
      id: "mom_change_pct",
      header: ({ column }) => (
        <DataGridColumnHeader
          title="Perubahan MoM"
          column={column}
          className="justify-end text-right"
        />
      ),
      cell: ({ row }) => {
        const pct = row.original.mom_change_pct;
        return (
          <div className="text-right tabular-nums whitespace-nowrap">
            {pct !== null && pct !== undefined ? (
              <span
                className={`font-semibold ${
                  pct > 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {pct > 0 ? `+` : ``}
                {pct}%
              </span>
            ) : (
              <span className="text-slate-400">-</span>
            )}
          </div>
        );
      },
      size: 120,
    },
    {
      accessorKey: "percentage_of_group",
      id: "percentage_of_group",
      header: ({ column }) => (
        <DataGridColumnHeader
          title={pctTitle}
          column={column}
          className="justify-end text-right"
        />
      ),
      cell: ({ row }) => (
        <div className="text-right tabular-nums whitespace-nowrap">
          <span className={`font-semibold ${pctColorClass}`}>
            {row.original.percentage_of_group}%
          </span>
        </div>
      ),
      size: 90,
    },
    {
      accessorKey: "percentage_of_revenue",
      id: "percentage_of_revenue",
      header: ({ column }) => (
        <DataGridColumnHeader
          title="% Omset"
          column={column}
          className="justify-end text-right"
        />
      ),
      cell: ({ row }) => {
        const revPct = row.original.percentage_of_revenue;
        return (
          <div className="text-right tabular-nums whitespace-nowrap">
            {revPct !== null && revPct !== undefined ? (
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {revPct}%
              </span>
            ) : (
              <span className="text-slate-400">-</span>
            )}
          </div>
        );
      },
      size: 90,
    },
    {
      id: "actions",
      header: () => <div className="text-center w-full">Aksi</div>,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedLedgerAccount(row.original.account_code);
              setActiveSubTab("buku_besar");
            }}
            className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
            title="Lihat Rincian Buku Besar"
          >
            <Eye className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
      size: 70,
    },
  ];

  const hppColumns = useMemo(
    () => buildLabaRugiColumns("% HPP", "text-amber-700 dark:text-amber-400"),
    []
  );

  const opexColumns = useMemo(
    () => buildLabaRugiColumns("% OPEX", "text-blue-700 dark:text-blue-400"),
    []
  );

  type RekeningPosRow = NonNullable<
    NonNullable<AccountingReportData["neraca"]>["rekening_positions"]
  >[number];
  const rekeningColumns = useMemo<ColumnDef<DataGridFeatures, RekeningPosRow>[]>(
    () => [
      {
        accessorKey: "account_code",
        id: "account_code",
        header: ({ column }) => <DataGridColumnHeader title="Kode COA" column={column} />,
        cell: ({ row }) => (
          <span className="font-mono text-slate-600 dark:text-slate-300">
            {row.original.account_code}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: "name",
        id: "name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Rekening / Akun Kas" column={column} />
        ),
        cell: ({ row }) => (
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {row.original.name}
            </span>
            <span className="text-[11px] text-slate-400 ml-1.5">
              ({row.original.bank_name})
            </span>
          </div>
        ),
        size: 220,
      },
      {
        accessorKey: "opening_balance",
        id: "opening_balance",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Saldo Awal"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-slate-600 whitespace-nowrap">
            {formatRupiah(row.original.opening_balance)}
          </div>
        ),
        size: 125,
      },
      {
        accessorKey: "incoming_month",
        id: "incoming_month",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Masuk (Bulan Ini)"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-emerald-700 font-medium whitespace-nowrap">
            +{formatRupiah(row.original.incoming_month)}
          </div>
        ),
        size: 135,
      },
      {
        accessorKey: "outgoing_month",
        id: "outgoing_month",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Keluar (Bulan Ini)"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-rose-600 font-medium whitespace-nowrap">
            -{formatRupiah(row.original.outgoing_month)}
          </div>
        ),
        size: 135,
      },
      {
        accessorKey: "estimated_balance",
        id: "estimated_balance",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Estimasi Saldo"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {formatRupiah(row.original.estimated_balance)}
          </div>
        ),
        size: 135,
      },
    ],
    []
  );

  type DailyCashflowRow = DailyCashflowResponse["daily_rows"][number];
  const dailyCashflowColumns = useMemo<ColumnDef<DataGridFeatures, DailyCashflowRow>[]>(
    () => [
      {
        accessorKey: "date",
        id: "date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => (
          <span className="font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {formatDateId(row.original.date)}
          </span>
        ),
        size: 135,
      },
      {
        accessorKey: "cash_in",
        id: "cash_in",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Kas Masuk (Cash In)"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums whitespace-nowrap">
            {row.original.cash_in > 0 ? (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                +{formatRupiah(row.original.cash_in)}
              </span>
            ) : (
              <span className="text-slate-400">-</span>
            )}
          </div>
        ),
        size: 145,
      },
      {
        accessorKey: "cash_out",
        id: "cash_out",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Kas Keluar (Cash Out)"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums whitespace-nowrap">
            {row.original.cash_out > 0 ? (
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                -{formatRupiah(row.original.cash_out)}
              </span>
            ) : (
              <span className="text-slate-400">-</span>
            )}
          </div>
        ),
        size: 145,
      },
      {
        accessorKey: "net_flow",
        id: "net_flow",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Arus Bersih (Net)"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => {
          const nf = row.original.net_flow;
          return (
            <div className="text-right tabular-nums whitespace-nowrap">
              {nf !== 0 ? (
                <span
                  className={`font-semibold ${
                    nf > 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {nf > 0 ? "+" : ""}
                  {formatRupiah(nf)}
                </span>
              ) : (
                <span className="text-slate-400">-</span>
              )}
            </div>
          );
        },
        size: 140,
      },
      {
        accessorKey: "saldo",
        id: "saldo",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Saldo Berjalan"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {formatRupiah(row.original.saldo)}
          </div>
        ),
        size: 140,
      },
      {
        id: "tx_count",
        header: () => <div className="text-center w-full">Transaksi</div>,
        cell: ({ row }) => {
          const r = row.original;
          const hasActivity = r.cash_in > 0 || r.cash_out > 0;
          return (
            <div className="text-center">
              {hasActivity ? (
                <div className="inline-flex items-center gap-1">
                  {r.cash_in_count > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                      title={`${r.cash_in_count} transaksi uang masuk`}
                    >
                      +{r.cash_in_count}
                    </Badge>
                  )}
                  {r.cash_out_count > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800"
                      title={`${r.cash_out_count} transaksi kas keluar`}
                    >
                      -{r.cash_out_count}
                    </Badge>
                  )}
                </div>
              ) : (
                <span className="text-slate-300 dark:text-slate-600 text-[11px]">-</span>
              )}
            </div>
          );
        },
        size: 105,
      },
    ],
    []
  );

  const ledgerColumns = useMemo<ColumnDef<DataGridFeatures, Expense>[]>(
    () => [
      {
        accessorKey: "expense_date",
        id: "expense_date",
        header: ({ column }) => <DataGridColumnHeader title="Tanggal" column={column} />,
        cell: ({ row }) => (
          <span className="text-slate-600 dark:text-slate-300 font-mono whitespace-nowrap">
            {row.original.expense_date}
          </span>
        ),
        size: 105,
      },
      {
        accessorKey: "item_name",
        id: "item_name",
        header: ({ column }) => (
          <DataGridColumnHeader title="Nama Item / Transaksi" column={column} />
        ),
        cell: ({ row }) => {
          const exp = row.original;
          return (
            <div>
              <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                {exp.item_name}
              </span>
              {exp.notes && exp.notes !== "-" && (
                <span className="text-[10px] text-slate-400 block truncate max-w-xs">
                  {exp.notes}
                </span>
              )}
            </div>
          );
        },
        size: 220,
      },
      {
        accessorKey: "supplier",
        id: "supplier",
        header: ({ column }) => (
          <DataGridColumnHeader title="Toko / Supplier" column={column} />
        ),
        cell: ({ row }) => (
          <span className="text-slate-600 dark:text-slate-300">
            {row.original.supplier || "-"}
          </span>
        ),
        size: 145,
      },
      {
        accessorKey: "qty",
        id: "qty",
        header: () => <div className="text-center w-full">Qty</div>,
        cell: ({ row }) => (
          <div className="text-center tabular-nums whitespace-nowrap">
            {row.original.qty} {row.original.unit}
          </div>
        ),
        size: 85,
      },
      {
        accessorKey: "unit_price",
        id: "unit_price",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Harga Satuan"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {formatRupiah(Number(row.original.unit_price || 0))}
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: "total_price",
        id: "total_price",
        header: ({ column }) => (
          <DataGridColumnHeader
            title="Total Nominal"
            column={column}
            className="justify-end text-right"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
            {formatRupiah(Number(row.original.total_price || 0))}
          </div>
        ),
        size: 125,
      },
      {
        accessorKey: "pay_method",
        id: "pay_method",
        header: () => <span>Metode</span>,
        cell: ({ row }) => (
          <span className="text-slate-600 dark:text-slate-300">
            {row.original.pay_method || "Tunai"}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: "pay_status",
        id: "pay_status",
        header: () => <span>Status</span>,
        cell: ({ row }) => {
          const st = row.original.pay_status || "Lunas";
          return (
            <Badge
              variant="outline"
              className={`text-[10px] py-0 ${
                st === "Lunas"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-rose-50 text-rose-700 border-rose-200"
              }`}
            >
              {st}
            </Badge>
          );
        },
        size: 95,
      },
    ],
    []
  );

  return (
    <div className="space-y-3.5 pb-6 print:p-0">
      {/* 1. Editorial Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5 print:hidden">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
              Laporan &amp; Analisis Akuntansi
            </h2>
            <Badge
              variant="outline"
              className="text-[10px] font-semibold px-2 py-0.5 rounded-md border-blue-200 bg-blue-50/60 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300"
            >
              SAK EMKM
            </Badge>
          </div>
          <p className="text-xs text-[var(--ledger-muted)]">
            Periode {periodLabel} • Laba Rugi, Neraca, Arus Kas &amp; Buku Besar
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)] rounded-lg"
            title="Refresh Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </Button>

          {activeSubTab === "arus_kas" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCashflowCsv}
              disabled={isExportingCashflow || !dailyCashflowData}
              className="h-8 gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)] rounded-lg"
              title="Export Arus Kas Harian ke CSV (Cash In, Cash Out, Saldo)"
            >
              <Download className={`w-3.5 h-3.5 ${isExportingCashflow ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Export Cashflow CSV</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={!accountingData}
              className="h-8 gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)] rounded-lg"
              title="Export CSV Akuntansi (SAK EMKM)"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="h-8 gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--ledger-ink)] rounded-lg"
            title="Cetak Laporan"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cetak</span>
          </Button>
        </div>
      </div>

      {/* Print Document Title Header */}
      <div className="hidden print:block pb-4 mb-2 border-b">
        <h1 className="text-xl font-bold text-slate-900">
          Laporan &amp; Analisis Akuntansi (SAK EMKM)
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Periode: {periodLabel}
        </p>
      </div>

      {/* LOADING & ERROR STATES */}
      {isLoading && (
        <div className="space-y-3.5">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)]">
          <LedgerStateBlock
            variant="error"
            title="Gagal Memuat Laporan Akuntansi"
            description={(error as Error)?.message || "Terjadi kesalahan saat memproses data buku besar."}
            actions={
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Coba Lagi
              </Button>
            }
          />
        </div>
      )}

      {accountingData && (
        <>
          {/* 2. Unified 5-Column Financial KPI Hairline Strip (Zero Nested Cards) */}
          <section
            aria-label="Ringkasan utama laporan akuntansi"
            className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 lg:divide-x divide-[color:var(--ledger-hairline)]"
          >
            {/* 1. Total Beban Usaha */}
            <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1.5 min-w-0">
              <div className="flex items-center justify-between gap-1.5 text-xs text-[var(--ledger-muted)] font-semibold">
                <span className="truncate">Total Beban Usaha</span>
                <span className="text-[10px] font-mono-ledger px-1.5 py-0.5 rounded bg-[var(--ledger-recessed)] text-[var(--ledger-ink)] shrink-0 whitespace-nowrap">
                  Laba Rugi
                </span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(accountingData.laba_rugi.total_beban)}
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                {accountingData.laba_rugi.mom_beban_change_pct !== null &&
                accountingData.laba_rugi.mom_beban_change_pct !== undefined ? (
                  <span
                    className={`inline-flex items-center font-semibold tabular-nums shrink-0 ${
                      accountingData.laba_rugi.mom_beban_change_pct > 0
                        ? "text-[var(--signal-unpaid)]"
                        : "text-[var(--signal-cleared)]"
                    }`}
                  >
                    {accountingData.laba_rugi.mom_beban_change_pct > 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                    )}
                    {accountingData.laba_rugi.mom_beban_change_pct > 0 ? `+` : ``}
                    {accountingData.laba_rugi.mom_beban_change_pct}% MoM
                  </span>
                ) : (
                  <span className="text-[var(--ledger-muted)]">Periode awal</span>
                )}
                <span className="text-[var(--ledger-muted)] truncate">
                  vs {accountingData.prev_month_name}
                </span>
              </div>
            </div>

            {/* 2. Harga Pokok Penjualan (HPP) */}
            <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1.5 min-w-0">
              <div className="flex items-center justify-between gap-1.5 text-xs font-semibold">
                <span className="text-[var(--signal-dp)] truncate">Beban Pokok (HPP)</span>
                <span className="text-[10px] font-mono-ledger px-1.5 py-0.5 rounded bg-[var(--signal-dp-soft)] text-[var(--signal-dp)] shrink-0 whitespace-nowrap">
                  5-XXXX
                </span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(accountingData.laba_rugi.subtotal_hpp)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--ledger-muted)] tabular-nums">
                <span>
                  Porsi: <strong className="text-[var(--ledger-ink)]">{accountingData.analisis.cost_structure.hpp_ratio}%</strong>
                </span>
                {accountingData.laba_rugi.mom_hpp_change_pct !== null && (
                  <span
                    className={
                      accountingData.laba_rugi.mom_hpp_change_pct > 0
                        ? "text-[var(--signal-dp)] font-semibold"
                        : "text-[var(--signal-cleared)] font-semibold"
                    }
                  >
                    {accountingData.laba_rugi.mom_hpp_change_pct > 0 ? `+` : ``}
                    {accountingData.laba_rugi.mom_hpp_change_pct}%
                  </span>
                )}
              </div>
            </div>

            {/* 3. Beban Operasional (OPEX) */}
            <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1.5 min-w-0">
              <div className="flex items-center justify-between gap-1.5 text-xs font-semibold">
                <span className="text-blue-700 dark:text-blue-400 truncate">Operasional (OPEX)</span>
                <span className="text-[10px] font-mono-ledger px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 shrink-0 whitespace-nowrap">
                  6-XXXX
                </span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(accountingData.laba_rugi.subtotal_opex)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--ledger-muted)] tabular-nums">
                <span>
                  Porsi: <strong className="text-[var(--ledger-ink)]">{accountingData.analisis.cost_structure.opex_ratio}%</strong>
                </span>
                {accountingData.laba_rugi.mom_opex_change_pct !== null && (
                  <span
                    className={
                      accountingData.laba_rugi.mom_opex_change_pct > 0
                        ? "text-[var(--signal-unpaid)] font-semibold"
                        : "text-[var(--signal-cleared)] font-semibold"
                    }
                  >
                    {accountingData.laba_rugi.mom_opex_change_pct > 0 ? `+` : ``}
                    {accountingData.laba_rugi.mom_opex_change_pct}%
                  </span>
                )}
              </div>
            </div>

            {/* 4. Belanja Modal / Aset Tetap */}
            <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1.5 min-w-0">
              <div className="flex items-center justify-between gap-1.5 text-xs font-semibold">
                <span className="text-[var(--signal-talangan)] truncate">Aset Tetap (Capex)</span>
                <span className="text-[10px] font-mono-ledger px-1.5 py-0.5 rounded bg-[var(--signal-talangan-soft)] text-[var(--signal-talangan)] shrink-0 whitespace-nowrap">
                  1-2100
                </span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(accountingData.neraca.subtotal_aset_tetap)}
              </div>
              <div className="text-[11px] text-[var(--ledger-muted)] truncate">
                Peralatan, showcase, mesin tahan lama
              </div>
            </div>

            {/* 5. Hutang Belanja (Kewajiban) */}
            <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col justify-between gap-1.5 min-w-0">
              <div className="flex items-center justify-between gap-1.5 text-xs font-semibold">
                <span className="text-[var(--signal-unpaid)] truncate">Hutang Belanja</span>
                <span className="text-[10px] font-mono-ledger px-1.5 py-0.5 rounded bg-[var(--signal-unpaid-soft)] text-[var(--signal-unpaid)] shrink-0 whitespace-nowrap">
                  2-1110
                </span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-[var(--ledger-ink)] tabular-nums">
                {formatRupiah(accountingData.neraca.subtotal_kewajiban)}
              </div>
              <div className="text-[11px] text-[var(--ledger-muted)] flex items-center justify-between tabular-nums">
                <span>{accountingData.neraca.detail_hutang.length} nota tempo</span>
                {accountingData.neraca.subtotal_kewajiban > 0 ? (
                  <span className="text-[var(--signal-unpaid)] font-semibold">Belum Lunas</span>
                ) : (
                  <span className="text-[var(--signal-cleared)] font-semibold">Nihil (Lunas)</span>
                )}
              </div>
            </div>
          </section>

          {/* 3. Editorial Sub-Tab Bar Navigation */}
          <div className="print:hidden">
            <LedgerStatusTabs
              tabs={[
                { value: "laba_rugi", label: "1. Laporan Laba Rugi" },
                { value: "neraca", label: "2. Posisi Keuangan (Neraca)" },
                { value: "arus_kas", label: "3. Laporan Arus Kas" },
                { value: "analisis", label: "4. Analisis & Rasio Finansial" },
                { value: "buku_besar", label: "5. Buku Besar & Rincian Akun" },
              ]}
              value={activeSubTab}
              onChange={(next) => setActiveSubTab(next)}
              layoutId="accounting-subtab-underline"
              ariaLabel="Sub-laporan akuntansi SAK EMKM"
            />
          </div>

          {/* TAB 1: LAPORAN LABA RUGI (INCOME STATEMENT) */}
          {activeSubTab === "laba_rugi" && (
            <div className="space-y-3">
              {/* 0. SECTION PENDAPATAN & LABA BERSIH (Zero Nested Cards) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="ledger-recessed-subtle px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-ledger text-[11px] font-bold text-[var(--signal-cleared)] bg-[var(--signal-cleared-soft)] px-2 py-0.5 rounded">
                      AKUN 4-1100
                    </span>
                    <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                      Pendapatan Usaha &amp; Ringkasan Laba / Rugi
                    </h3>
                  </div>
                  <div className="text-xs text-[var(--ledger-muted)] tabular-nums">
                    {accountingData.laba_rugi.paid_tx_count || 0} transaksi masuk dibayar
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 lg:divide-x divide-[color:var(--ledger-hairline)]">
                  <div className="px-3.5 py-2.5 sm:px-4 sm:py-3">
                    <div className="text-[11px] font-semibold text-[var(--ledger-muted)]">Penjualan Kotor</div>
                    <div className="text-sm sm:text-base font-bold text-[var(--ledger-ink)] tabular-nums mt-0.5">
                      {formatRupiah(accountingData.laba_rugi.revenue_gross || 0)}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5 sm:px-4 sm:py-3">
                    <div className="text-[11px] font-semibold text-[var(--ledger-muted)]">Diskon &amp; Fee Platform</div>
                    <div className="text-sm sm:text-base font-bold text-[var(--signal-unpaid)] tabular-nums mt-0.5">
                      -{formatRupiah((accountingData.laba_rugi.revenue_discount || 0) + (accountingData.laba_rugi.revenue_platform_fee || 0))}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 signal-surface-cleared">
                    <div className="text-[11px] font-semibold text-[var(--signal-cleared)]">Pendapatan Bersih</div>
                    <div className="text-sm sm:text-base font-bold text-[var(--signal-cleared)] tabular-nums mt-0.5">
                      {formatRupiah(accountingData.laba_rugi.revenue_net || 0)}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5 sm:px-4 sm:py-3">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--ledger-muted)]">
                      <span>Laba Kotor (Net - HPP)</span>
                      {accountingData.laba_rugi.gross_margin_pct != null && (
                        <span className="font-mono-ledger text-[var(--ledger-ink)]">
                          {accountingData.laba_rugi.gross_margin_pct}%
                        </span>
                      )}
                    </div>
                    <div className="text-sm sm:text-base font-bold text-[var(--ledger-ink)] tabular-nums mt-0.5">
                      {formatRupiah(accountingData.laba_rugi.gross_profit || 0)}
                    </div>
                  </div>
                  <div
                    className={`col-span-2 lg:col-span-1 px-3.5 py-2.5 sm:px-4 sm:py-3 ${
                      (accountingData.laba_rugi.net_profit || 0) >= 0
                        ? "signal-surface-cleared"
                        : "signal-surface-unpaid"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--ledger-muted)]">
                      <span>Laba / Rugi Bersih</span>
                      {accountingData.laba_rugi.net_margin_pct != null && (
                        <span className="font-mono-ledger text-[var(--ledger-ink)]">
                          {accountingData.laba_rugi.net_margin_pct}%
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-sm sm:text-base font-bold tabular-nums mt-0.5 ${
                        (accountingData.laba_rugi.net_profit || 0) >= 0
                          ? "text-[var(--signal-cleared)]"
                          : "text-[var(--signal-unpaid)]"
                      }`}
                    >
                      {formatRupiah(accountingData.laba_rugi.net_profit || 0)}
                    </div>
                  </div>
                </div>

                {accountingData.laba_rugi.revenue_by_channel &&
                  accountingData.laba_rugi.revenue_by_channel.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-[color:var(--ledger-hairline)] flex flex-wrap gap-2">
                      {accountingData.laba_rugi.revenue_by_channel.map((ch) => (
                        <div
                          key={ch.channel}
                          className="text-xs px-2.5 py-1 rounded-md bg-[var(--ledger-recessed)] text-[var(--ledger-ink)] tabular-nums"
                        >
                          <span className="font-medium">{ch.channel}</span>{" "}
                          <span className="text-[var(--ledger-muted)]">
                            ({ch.tx_count} tx • {ch.percentage}%)
                          </span>
                          :{" "}
                          <span className="font-semibold text-[var(--signal-cleared)]">
                            {formatRupiah(ch.net_received)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {/* Visual Proportion Bar HPP vs OPEX */}
              <div className="bg-[var(--ledger-surface)] border border-[color:var(--ledger-hairline)] rounded-xl px-4 py-3">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-bold text-[var(--ledger-ink)]">
                    Struktur Beban Usaha Laba Rugi
                  </span>
                  <div className="flex items-center gap-4 text-xs tabular-nums">
                    <span className="flex items-center gap-1.5 text-[var(--signal-dp)] font-semibold">
                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                      HPP ({accountingData.analisis.cost_structure.hpp_ratio}%)
                    </span>
                    <span className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 inline-block" />
                      OPEX ({accountingData.analisis.cost_structure.opex_ratio}%)
                    </span>
                  </div>
                </div>
                <div className="w-full h-2 bg-[var(--ledger-recessed)] rounded-full overflow-hidden flex">
                  <div
                    className="bg-amber-500 h-full transition-all duration-500"
                    style={{ width: `${accountingData.analisis.cost_structure.hpp_ratio}%` }}
                    title={`HPP: ${formatRupiah(accountingData.laba_rugi.subtotal_hpp)}`}
                  />
                  <div
                    className="bg-blue-600 dark:bg-blue-400 h-full transition-all duration-500"
                    style={{ width: `${accountingData.analisis.cost_structure.opex_ratio}%` }}
                    title={`OPEX: ${formatRupiah(accountingData.laba_rugi.subtotal_opex)}`}
                  />
                </div>
              </div>

              {/* 1. SECTION HPP (Akun Kepala 5) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="ledger-recessed-subtle px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-ledger text-[11px] font-bold text-[var(--signal-dp)] bg-[var(--signal-dp-soft)] px-2 py-0.5 rounded">
                      AKUN 5-XXXX
                    </span>
                    <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                      Harga Pokok Penjualan (HPP / Beban Pokok)
                    </h3>
                  </div>
                  <div className="text-right tabular-nums">
                    <span className="text-xs text-[var(--ledger-muted)] mr-2">Subtotal HPP:</span>
                    <span className="font-bold text-[var(--ledger-ink)] text-sm">
                      {formatRupiah(accountingData.laba_rugi.subtotal_hpp)}
                    </span>
                  </div>
                </div>

                <DataTable
                  columns={hppColumns}
                  data={accountingData.laba_rugi.hpp_items}
                  getRowId={(r) => r.account_code}
                  defaultPageSize={10}
                  tableLayout={{ columnsResizable: false, width: "auto" }}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
                >
                  <div className="ledger-recessed-band border-t border-[color:var(--ledger-hairline)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[var(--ledger-ink)]">
                    <span>Subtotal Harga Pokok Penjualan (HPP)</span>
                    <div className="flex items-center gap-4 tabular-nums">
                      <span className="text-[var(--signal-dp)]">
                        {formatRupiah(accountingData.laba_rugi.subtotal_hpp)}
                      </span>
                      <span className="text-[var(--ledger-muted)] font-medium">
                        Lalu: {formatRupiah(accountingData.laba_rugi.prev_subtotal_hpp)}
                      </span>
                      {accountingData.laba_rugi.mom_hpp_change_pct !== null && (
                        <span
                          className={
                            accountingData.laba_rugi.mom_hpp_change_pct > 0
                              ? "text-[var(--signal-unpaid)]"
                              : "text-[var(--signal-cleared)]"
                          }
                        >
                          {accountingData.laba_rugi.mom_hpp_change_pct > 0 ? `+` : ``}
                          {accountingData.laba_rugi.mom_hpp_change_pct}%
                        </span>
                      )}
                    </div>
                  </div>
                </DataTable>
              </div>

              {/* 2. SECTION OPEX (Akun Kepala 6) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="ledger-recessed-subtle px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-ledger text-[11px] font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/50 dark:text-blue-300 px-2 py-0.5 rounded">
                      AKUN 6-XXXX
                    </span>
                    <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                      Beban Operasional &amp; Umum (OPEX)
                    </h3>
                  </div>
                  <div className="text-right tabular-nums">
                    <span className="text-xs text-[var(--ledger-muted)] mr-2">Subtotal OPEX:</span>
                    <span className="font-bold text-[var(--ledger-ink)] text-sm">
                      {formatRupiah(accountingData.laba_rugi.subtotal_opex)}
                    </span>
                  </div>
                </div>

                <DataTable
                  columns={opexColumns}
                  data={accountingData.laba_rugi.opex_items}
                  getRowId={(r) => r.account_code}
                  defaultPageSize={10}
                  tableLayout={{ columnsResizable: false, width: "auto" }}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
                >
                  <div className="ledger-recessed-band border-t border-[color:var(--ledger-hairline)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[var(--ledger-ink)]">
                    <span>Subtotal Beban Operasional &amp; Umum (OPEX)</span>
                    <div className="flex items-center gap-4 tabular-nums">
                      <span className="text-blue-700 dark:text-blue-400">
                        {formatRupiah(accountingData.laba_rugi.subtotal_opex)}
                      </span>
                      <span className="text-[var(--ledger-muted)] font-medium">
                        Lalu: {formatRupiah(accountingData.laba_rugi.prev_subtotal_opex)}
                      </span>
                      {accountingData.laba_rugi.mom_opex_change_pct !== null && (
                        <span
                          className={
                            accountingData.laba_rugi.mom_opex_change_pct > 0
                              ? "text-[var(--signal-unpaid)]"
                              : "text-[var(--signal-cleared)]"
                          }
                        >
                          {accountingData.laba_rugi.mom_opex_change_pct > 0 ? `+` : ``}
                          {accountingData.laba_rugi.mom_opex_change_pct}%
                        </span>
                      )}
                    </div>
                  </div>
                </DataTable>
              </div>

              {/* 3. GRAND TOTAL BEBAN USAHA */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-slate-900 dark:bg-slate-950 text-white px-4 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-slate-300 font-semibold">
                      Total Beban Usaha Toko (Laba Rugi)
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-white/10 text-white border-white/20">
                      HPP + OPEX
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Seluruh biaya operasional dan pokok bahan pada periode {accountingData.month_name} {accountingData.year}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xl md:text-2xl font-extrabold tabular-nums tracking-tight">
                    {formatRupiah(accountingData.laba_rugi.total_beban)}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5 tabular-nums">
                    Bulan lalu: {formatRupiah(accountingData.laba_rugi.prev_total_beban)}{" "}
                    {accountingData.laba_rugi.mom_beban_change_pct !== null && (
                      <span className={accountingData.laba_rugi.mom_beban_change_pct > 0 ? "text-rose-300 font-semibold" : "text-emerald-300 font-semibold"}>
                        ({accountingData.laba_rugi.mom_beban_change_pct > 0 ? "+" : ""}
                        {accountingData.laba_rugi.mom_beban_change_pct}% MoM)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LAPORAN POSISI KEUANGAN / NERACA */}
          {activeSubTab === "neraca" && (
            <div className="space-y-3">
              {/* Posisi Kas & Bank per Rekening Setup (Terhubung ke COA 1-11xx) */}
              {accountingData.neraca.rekening_positions && accountingData.neraca.rekening_positions.length > 0 && (
                <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                        Posisi Kas &amp; Bank per Rekening Setup (Akun 1-11xx)
                      </h3>
                    </div>
                    <span className="font-mono-ledger text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                      Total Estimasi: {formatRupiah(accountingData.neraca.total_rekening_balance || 0)}
                    </span>
                  </div>
                  <DataTable
                    columns={rekeningColumns}
                    data={accountingData.neraca.rekening_positions}
                    getRowId={(r) => String(r.id)}
                    defaultPageSize={10}
                    tableLayout={{ columnsResizable: false, width: "auto" }}
                    containerClassName="border-0 rounded-none shadow-none"
                    footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* SISI KIRI: ASET (AKTIVA) */}
                <div className="space-y-3">
                  {/* Aset Lancar */}
                  <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-[var(--signal-cleared)]" />
                        <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                          Aset Lancar (Posisi Kas &amp; Bank)
                        </h3>
                      </div>
                      <span className="font-mono-ledger text-xs font-semibold text-[var(--signal-cleared)] tabular-nums">
                        {formatRupiah(accountingData.neraca.subtotal_aset_lancar)}
                      </span>
                    </div>

                    <div className="divide-y divide-[color:var(--ledger-hairline)]">
                      {accountingData.neraca.aset_lancar.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between px-4 py-2.5 ledger-hover-recessed text-xs transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono-ledger font-bold text-[var(--ledger-muted)]">{item.account_code}</span>
                              <span className="font-semibold text-[var(--ledger-ink)]">{item.account_name}</span>
                            </div>
                            <span className="text-[11px] text-[var(--ledger-muted)] mt-0.5 block">{item.description}</span>
                          </div>
                          <span className="font-bold text-[var(--ledger-ink)] tabular-nums text-sm">
                            {formatRupiah(item.nominal)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Aset Tetap */}
                  <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building className="w-4 h-4 text-[var(--signal-talangan)]" />
                        <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                          Aset Tetap (Peralatan &amp; Mesin)
                        </h3>
                      </div>
                      <span className="font-mono-ledger text-xs font-semibold text-[var(--signal-talangan)] tabular-nums">
                        {formatRupiah(accountingData.neraca.subtotal_aset_tetap)}
                      </span>
                    </div>

                    <div className="divide-y divide-[color:var(--ledger-hairline)]">
                      {accountingData.neraca.aset_tetap.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between px-4 py-2.5 ledger-hover-recessed text-xs transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono-ledger font-bold text-[var(--ledger-muted)]">{item.account_code}</span>
                              <span className="font-semibold text-[var(--ledger-ink)]">{item.account_name}</span>
                            </div>
                            <span className="text-[11px] text-[var(--ledger-muted)] mt-0.5 block">{item.description}</span>
                          </div>
                          <span className={`font-bold tabular-nums text-sm ${item.nominal < 0 ? "text-[var(--signal-dp)]" : "text-[var(--ledger-ink)]"}`}>
                            {item.nominal < 0 ? `(${formatRupiah(Math.abs(item.nominal))})` : formatRupiah(item.nominal)}
                          </span>
                        </div>
                      ))}
                      {accountingData.neraca.aset_tetap_summary && (
                        <div className="flex items-center justify-between px-4 py-2.5 ledger-recessed-band text-xs font-bold text-[var(--ledger-ink)]">
                          <span>Nilai Buku Bersih Aset Tetap</span>
                          <span className="tabular-nums text-[var(--signal-talangan)]">
                            {formatRupiah(accountingData.neraca.aset_tetap_summary.net_book_value)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Total Aset (Aktiva) */}
                  <div className="px-4 py-3 rounded-xl bg-slate-900 dark:bg-slate-950 border border-[color:var(--ledger-hairline)] text-white flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                        Total Aset (Aktiva)
                      </span>
                      <span className="text-[11px] text-slate-300">
                        Aset Lancar (Kas &amp; Bank) + Nilai Buku Aset Tetap
                      </span>
                    </div>
                    <span className="text-lg font-extrabold tabular-nums">
                      {formatRupiah(accountingData.neraca.total_aset)}
                    </span>
                  </div>
                </div>

                {/* SISI KANAN: KEWAJIBAN (PASSIVA) */}
                <div className="space-y-3">
                  <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-[var(--signal-unpaid)]" />
                        <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                          Kewajiban Lancar (Hutang Belanja &amp; Tempo)
                        </h3>
                      </div>
                      <span className="font-mono-ledger text-xs font-semibold text-[var(--signal-unpaid)] tabular-nums">
                        {formatRupiah(accountingData.neraca.subtotal_kewajiban)}
                      </span>
                    </div>

                    <div className="divide-y divide-[color:var(--ledger-hairline)]">
                      {accountingData.neraca.kewajiban_lancar.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between px-4 py-2.5 signal-surface-unpaid-subtle text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono-ledger font-bold text-[var(--signal-unpaid)]">{item.account_code}</span>
                              <span className="font-semibold text-[var(--ledger-ink)]">{item.account_name}</span>
                            </div>
                            <span className="text-[11px] text-[var(--ledger-muted)] mt-0.5 block">{item.description}</span>
                          </div>
                          <span className="font-bold text-[var(--signal-unpaid)] tabular-nums text-sm">
                            {formatRupiah(item.nominal)}
                          </span>
                        </div>
                      ))}

                      {/* Detail Faktur / Tagihan Belum Lunas */}
                      {accountingData.neraca.detail_hutang.length > 0 ? (
                        <div>
                          <div className="px-4 py-2 ledger-recessed-subtle text-[11px] font-bold text-[var(--ledger-muted)]">
                            Daftar Faktur / Nota Tempo Belum Lunas ({accountingData.neraca.detail_hutang.length})
                          </div>
                          <div className="divide-y divide-[color:var(--ledger-hairline)] max-h-60 overflow-y-auto">
                            {accountingData.neraca.detail_hutang.map((h, i) => (
                              <div key={i} className="flex items-center justify-between text-xs px-4 py-2 ledger-hover-recessed">
                                <div>
                                  <span className="font-medium text-[var(--ledger-ink)]">{h.barang}</span>
                                  <span className="text-[10px] text-[var(--ledger-muted)] block">
                                    Toko: {h.supplier || "-"} • Jatuh Tempo: {h.tempo || "-"}
                                  </span>
                                </div>
                                <span className="font-semibold text-[var(--signal-unpaid)] tabular-nums">
                                  {formatRupiah(h.nominal)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 py-4 text-center text-xs text-[var(--signal-cleared)] font-medium">
                          <CheckCircle2 className="w-5 h-5 mx-auto mb-1" />
                          Tidak ada hutang belanja atau tempo yang tertunggak pada bulan ini.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ekuitas (Modal & Laba Berjalan) */}
                  {accountingData.neraca.ekuitas && accountingData.neraca.ekuitas.length > 0 && (
                    <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Scale className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                            Ekuitas (Modal &amp; Laba Berjalan)
                          </h3>
                        </div>
                        <span className="font-mono-ledger text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                          {formatRupiah(accountingData.neraca.subtotal_ekuitas || 0)}
                        </span>
                      </div>
                      <div className="divide-y divide-[color:var(--ledger-hairline)]">
                        {accountingData.neraca.ekuitas.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between px-4 py-2.5 ledger-hover-recessed text-xs transition-colors"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono-ledger font-bold text-blue-700 dark:text-blue-400">
                                  {item.account_code}
                                </span>
                                <span className="font-semibold text-[var(--ledger-ink)]">
                                  {item.account_name}
                                </span>
                              </div>
                              <span className="text-[11px] text-[var(--ledger-muted)] mt-0.5 block">
                                {item.description}
                              </span>
                            </div>
                            <span
                              className={`font-bold tabular-nums text-sm ${
                                item.nominal >= 0 ? "text-blue-700 dark:text-blue-400" : "text-[var(--signal-unpaid)]"
                              }`}
                            >
                              {formatRupiah(item.nominal)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Total Kewajiban + Ekuitas (Passiva) */}
                  <div className="px-4 py-3 rounded-xl bg-slate-900 dark:bg-slate-950 border border-[color:var(--ledger-hairline)] text-white flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                        Total Kewajiban &amp; Ekuitas (Passiva)
                      </span>
                      <span className="text-[11px] text-slate-300">
                        Kewajiban Lancar + Modal Awal + Laba Ditahan + Laba Berjalan
                      </span>
                    </div>
                    <span className="text-lg font-extrabold tabular-nums">
                      {formatRupiah(
                        (accountingData.neraca.subtotal_kewajiban || 0) +
                          (accountingData.neraca.subtotal_ekuitas || 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LAPORAN ARUS KAS (CASH FLOW STATEMENT) */}
          {activeSubTab === "arus_kas" && (
            <div className="space-y-3">
              {/* Ringkasan Arus Kas Masuk vs Keluar (Single Hairline Strip) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
                <div className="px-4 py-3 signal-surface-cleared">
                  <div className="text-xs font-semibold text-[var(--signal-cleared)]">Total Kas Masuk (Penjualan Bersih)</div>
                  <div className="text-lg font-bold text-[var(--signal-cleared)] tabular-nums mt-0.5">
                    +{formatRupiah(accountingData.arus_kas.total_kas_masuk || 0)}
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">Total Kas Keluar Riil</div>
                  <div className="text-lg font-bold text-[var(--signal-unpaid)] tabular-nums mt-0.5">
                    -{formatRupiah(accountingData.arus_kas.total_kas_keluar_riil)}
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs font-semibold text-[var(--ledger-muted)]">Arus Kas Bersih (Net Cash Flow)</div>
                  <div
                    className={`text-lg font-bold tabular-nums mt-0.5 ${
                      (accountingData.arus_kas.net_cash_flow || 0) >= 0
                        ? "text-[var(--signal-cleared)]"
                        : "text-[var(--signal-unpaid)]"
                    }`}
                  >
                    {formatRupiah(accountingData.arus_kas.net_cash_flow || 0)}
                  </div>
                </div>
              </div>

              {/* 3 Aktivitas Arus Kas (Unified 3-Column Hairline Panel) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[color:var(--ledger-hairline)]">
                {/* 1. Aktivitas Operasi */}
                <div className="flex flex-col justify-between">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle">
                    <span className="text-xs font-bold text-[var(--ledger-ink)] block">
                      Aktivitas Operasi
                    </span>
                    <span className="text-[11px] text-[var(--ledger-muted)]">Pembayaran HPP, bahan baku &amp; OPEX toko</span>
                  </div>
                  <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      {accountingData.arus_kas.aktivitas_operasi.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--ledger-muted)] max-w-[65%]">{item.activity}</span>
                          <span className="font-bold text-[var(--ledger-ink)] tabular-nums">
                            ({formatRupiah(item.nominal)})
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-[color:var(--ledger-hairline)] flex justify-between items-center font-bold text-xs">
                      <span className="text-[var(--ledger-ink)]">Kas Keluar Operasi:</span>
                      <span className="text-[var(--signal-unpaid)] tabular-nums">
                        ({formatRupiah(accountingData.arus_kas.subtotal_operasi)})
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Aktivitas Investasi */}
                <div className="flex flex-col justify-between">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle">
                    <span className="text-xs font-bold text-[var(--ledger-ink)] block">
                      Aktivitas Investasi
                    </span>
                    <span className="text-[11px] text-[var(--ledger-muted)]">Pembelian aset tetap, mesin &amp; peralatan</span>
                  </div>
                  <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      {accountingData.arus_kas.aktivitas_investasi.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--ledger-muted)] max-w-[65%]">{item.activity}</span>
                          <span className="font-bold text-[var(--ledger-ink)] tabular-nums">
                            ({formatRupiah(item.nominal)})
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-[color:var(--ledger-hairline)] flex justify-between items-center font-bold text-xs">
                      <span className="text-[var(--ledger-ink)]">Kas Keluar Investasi:</span>
                      <span className="text-[var(--signal-unpaid)] tabular-nums">
                        ({formatRupiah(accountingData.arus_kas.subtotal_investasi)})
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Aktivitas Kliring / Transfer */}
                <div className="flex flex-col justify-between">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle">
                    <span className="text-xs font-bold text-[var(--ledger-ink)] block">
                      Aktivitas Kliring
                    </span>
                    <span className="text-[11px] text-[var(--ledger-muted)]">Tukar cash kasir / transfer kliring</span>
                  </div>
                  <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      {accountingData.arus_kas.aktivitas_kliring.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="text-[var(--ledger-muted)] max-w-[65%]">{item.activity}</span>
                          <span className="font-bold text-[var(--ledger-ink)] tabular-nums">
                            ({formatRupiah(item.nominal)})
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-[color:var(--ledger-hairline)] flex justify-between items-center font-bold text-xs">
                      <span className="text-[var(--ledger-ink)]">Kas Kliring:</span>
                      <span className="text-[var(--ledger-ink)] tabular-nums">
                        ({formatRupiah(accountingData.arus_kas.subtotal_kliring)})
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Total Arus Kas Riil & Distribusi Pembayaran (Zero Nested Cards) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)] flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-[var(--ledger-ink)] text-sm">
                      Total Pengeluaran Kas Riil (Net Cash Outflow)
                    </h4>
                    <p className="text-xs text-[var(--ledger-muted)] mt-0.5">
                      Distribusi realisasi kas keluar berdasarkan metode pembayaran periode {accountingData.month_name} {accountingData.year}
                    </p>
                  </div>
                  <div className="text-xl font-extrabold text-[var(--signal-unpaid)] tabular-nums">
                    {formatRupiah(accountingData.arus_kas.total_kas_keluar_riil)}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-[color:var(--ledger-hairline)]">
                  {accountingData.arus_kas.metode_bayar_distribution.map((m, idx) => (
                    <div key={idx} className="px-3.5 py-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between text-[var(--ledger-muted)] font-medium">
                        <span className="truncate">{m.metode}</span>
                        <span className="text-[10px] font-mono-ledger tabular-nums">{m.percentage}%</span>
                      </div>
                      <span className="text-sm font-bold text-[var(--ledger-ink)] block tabular-nums truncate">
                        {formatRupiah(m.nominal)}
                      </span>
                      <div className="w-full bg-[var(--ledger-recessed)] h-1 rounded-full overflow-hidden">
                        <div className="bg-blue-600 dark:bg-blue-400 h-full rounded-full" style={{ width: `${m.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rekapitulasi & Tabel Arus Kas Harian (Daily Cashflow) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                  <div>
                    <h4 className="font-bold text-[var(--ledger-ink)] text-sm">
                      Buku Kas &amp; Arus Kas Harian (Daily Cashflow)
                    </h4>
                    <p className="text-xs text-[var(--ledger-muted)] mt-0.5">
                      Rincian mutasi cash in, cash out, dan saldo berjalan per hari periode {accountingData.month_name} {accountingData.year}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <label htmlFor="cashflow-acc-select" className="text-xs text-[var(--ledger-muted)] font-medium">Rekening:</label>
                      <select
                        id="cashflow-acc-select"
                        value={selectedCashflowAccount ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedCashflowAccount(val ? Number(val) : null);
                        }}
                        className="h-8 px-2.5 rounded-lg border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-xs text-[var(--ledger-ink)]"
                      >
                        <option value="">Semua Rekening &amp; Kas</option>
                        {dailyCashflowData?.bank_accounts?.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.bank_name})
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportCashflowCsv}
                      disabled={isExportingCashflow || isLoadingCashflow || !dailyCashflowData}
                      className="h-8 gap-1.5 text-xs border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] text-[var(--signal-cleared)] rounded-lg font-semibold"
                      title="Unduh file CSV Arus Kas Harian"
                    >
                      <Download className={`w-3.5 h-3.5 ${isExportingCashflow ? "animate-spin" : ""}`} />
                      <span>Export CSV Cashflow</span>
                    </Button>
                  </div>
                </div>

                {dailyCashflowData && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-[color:var(--ledger-hairline)] divide-x divide-y sm:divide-y-0 divide-[color:var(--ledger-hairline)] text-xs">
                    <div className="px-3.5 py-2.5">
                      <span className="text-[11px] text-[var(--ledger-muted)] block">Saldo Awal</span>
                      <span className="font-bold text-[var(--ledger-ink)] text-sm tabular-nums">
                        {formatRupiah(dailyCashflowData.saldo_awal)}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5">
                      <span className="text-[11px] text-[var(--signal-cleared)] block">Total Cash In</span>
                      <span className="font-bold text-[var(--signal-cleared)] text-sm tabular-nums">
                        +{formatRupiah(dailyCashflowData.total_cash_in)}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5">
                      <span className="text-[11px] text-[var(--signal-unpaid)] block">Total Cash Out</span>
                      <span className="font-bold text-[var(--signal-unpaid)] text-sm tabular-nums">
                        -{formatRupiah(dailyCashflowData.total_cash_out)}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5">
                      <span className="text-[11px] text-[var(--ledger-muted)] block">Arus Bersih (Net)</span>
                      <span className={`font-bold text-sm tabular-nums ${
                        dailyCashflowData.net_cash_flow >= 0 ? "text-[var(--signal-cleared)]" : "text-[var(--signal-unpaid)]"
                      }`}>
                        {dailyCashflowData.net_cash_flow >= 0 ? "+" : ""}
                        {formatRupiah(dailyCashflowData.net_cash_flow)}
                      </span>
                    </div>
                    <div className="col-span-2 sm:col-span-1 px-3.5 py-2.5 ledger-recessed-band">
                      <span className="text-[11px] text-[var(--ledger-ink)] font-semibold block">Saldo Akhir</span>
                      <span className="font-black text-[var(--ledger-ink)] text-sm tabular-nums">
                        {formatRupiah(dailyCashflowData.saldo_akhir)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  {isLoadingCashflow ? (
                    <div className="p-6 space-y-2">
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                    </div>
                  ) : isErrorCashflow ? (
                    <LedgerStateBlock
                      variant="error"
                      title="Gagal memuat data arus kas harian"
                      description="Periksa koneksi jaringan lalu coba muat ulang."
                      actions={
                        <Button variant="outline" size="sm" onClick={() => refetchCashflow()}>
                          Coba Lagi
                        </Button>
                      }
                    />
                  ) : dailyCashflowData?.daily_rows?.length ? (
                    <DataTable
                      columns={dailyCashflowColumns}
                      data={dailyCashflowData.daily_rows}
                      getRowId={(r) => r.date}
                      defaultPageSize={10}
                      tableLayout={{ columnsResizable: false, width: "auto" }}
                      containerClassName="border-0 rounded-none shadow-none"
                      footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
                    >
                      <div className="border-t border-[color:var(--ledger-hairline)] ledger-recessed-band px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-[var(--ledger-ink)]">
                        <span>TOTAL &amp; SALDO AKHIR</span>
                        <div className="flex flex-wrap items-center gap-4 tabular-nums">
                          <span className="text-[var(--signal-cleared)]">
                            Masuk: +{formatRupiah(dailyCashflowData.total_cash_in)}
                          </span>
                          <span className="text-[var(--signal-unpaid)]">
                            Keluar: -{formatRupiah(dailyCashflowData.total_cash_out)}
                          </span>
                          <span
                            className={
                              dailyCashflowData.net_cash_flow >= 0
                                ? "text-[var(--signal-cleared)]"
                                : "text-[var(--signal-unpaid)]"
                            }
                          >
                            Net: {dailyCashflowData.net_cash_flow >= 0 ? "+" : ""}
                            {formatRupiah(dailyCashflowData.net_cash_flow)}
                          </span>
                          <span className="text-[var(--ledger-ink)] text-sm">
                            Saldo: {formatRupiah(dailyCashflowData.saldo_akhir)}
                          </span>
                          <span className="text-[11px] font-medium text-[var(--ledger-muted)]">
                            ({dailyCashflowData.total_tx_in + dailyCashflowData.total_tx_out} tx)
                          </span>
                        </div>
                      </div>
                    </DataTable>
                  ) : (
                    <LedgerStateBlock
                      variant="empty"
                      icon={<FileSpreadsheet className="w-7 h-7" />}
                      title="Tidak ada data arus kas untuk periode ini"
                      description="Transaksi masuk maupun keluar pada periode terpilih akan ditampilkan di sini."
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ANALISIS & RASIO FINANSIAL (HEALTH & RATIOS) */}
          {activeSubTab === "analisis" && (
            <div className="space-y-3">
              {/* Evaluasi Kesehatan Finansial (Unified 4-Column Hairline Strip) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-bold text-[var(--ledger-ink)]">
                    Evaluasi Kesehatan Beban &amp; Rasio Operasional (Target vs Realisasi)
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-[color:var(--ledger-hairline)]">
                  {accountingData.analisis.health_evaluation.map((evalItem) => {
                    const accentSurface =
                      evalItem.status === "healthy"
                        ? "signal-surface-cleared"
                        : evalItem.status === "warning"
                        ? "signal-surface-dp"
                        : evalItem.status === "danger"
                        ? "signal-surface-unpaid"
                        : "";

                    const badgeColor =
                      evalItem.status === "healthy"
                        ? "bg-[var(--signal-cleared-soft)] text-[var(--signal-cleared)]"
                        : evalItem.status === "warning"
                        ? "bg-[var(--signal-dp-soft)] text-[var(--signal-dp)]"
                        : evalItem.status === "danger"
                        ? "bg-[var(--signal-unpaid-soft)] text-[var(--signal-unpaid)]"
                        : "bg-[var(--ledger-recessed)] text-[var(--ledger-muted)]";

                    return (
                      <div key={evalItem.key} className={`p-3.5 flex flex-col justify-between gap-2 ${accentSurface}`}>
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold leading-tight text-[var(--ledger-ink)]">{evalItem.title}</span>
                            <Badge className={`text-[10px] uppercase font-bold ${badgeColor} border-0 shrink-0`}>
                              {evalItem.status}
                            </Badge>
                          </div>
                          <div className="text-xl font-black text-[var(--ledger-ink)] tabular-nums">
                            {evalItem.value}
                          </div>
                          <div className="text-[11px] text-[var(--ledger-muted)]">
                            Target Ideal: <strong className="text-[var(--ledger-ink)]">{evalItem.ideal_range}</strong>
                          </div>
                        </div>
                        <p className="text-xs leading-relaxed text-[var(--ledger-muted)] border-t border-[color:var(--ledger-hairline)] pt-2">
                          {evalItem.note}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Analisis Variansi HPP Teoritis (Resep) vs HPP Aktual (Belanja) */}
              {accountingData.analisis.hpp_variance && (
                <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-[var(--ledger-ink)] text-sm">
                        Variansi HPP Teoritis (Resep Menu) vs HPP Aktual (Belanja Bahan &amp; Kemasan)
                      </h4>
                      <p className="text-xs text-[var(--ledger-muted)] mt-0.5">
                        Membandingkan biaya resep dari kuantitas produk terjual terhadap realisasi belanja bahan baku pada periode ini
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold shrink-0 ${
                        accountingData.analisis.hpp_variance.status === "aligned"
                          ? "bg-[var(--signal-cleared-soft)] text-[var(--signal-cleared)] border-emerald-300 dark:border-emerald-800"
                          : accountingData.analisis.hpp_variance.status === "surplus_purchase"
                          ? "bg-[var(--signal-dp-soft)] text-[var(--signal-dp)] border-amber-300 dark:border-amber-800"
                          : "bg-[var(--ledger-recessed)] text-[var(--ledger-muted)] border-[color:var(--ledger-hairline)]"
                      }`}
                    >
                      {accountingData.analisis.hpp_variance.matched_menu_count} menu cocok ({accountingData.analisis.hpp_variance.matched_qty_total} unit terjual)
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[color:var(--ledger-hairline)]">
                    <div className="px-4 py-3">
                      <span className="text-[11px] font-semibold text-[var(--ledger-muted)] block">HPP Teoritis (Standar Resep)</span>
                      <span className="text-base font-bold text-[var(--ledger-ink)] tabular-nums mt-0.5 block">
                        {formatRupiah(accountingData.analisis.hpp_variance.theoretical_hpp)}
                      </span>
                    </div>
                    <div className="px-4 py-3">
                      <span className="text-[11px] font-semibold text-[var(--ledger-muted)] block">HPP Aktual (Belanja Periode Ini)</span>
                      <span className="text-base font-bold text-[var(--ledger-ink)] tabular-nums mt-0.5 block">
                        {formatRupiah(accountingData.analisis.hpp_variance.actual_hpp)}
                      </span>
                    </div>
                    <div className="px-4 py-3">
                      <span className="text-[11px] font-semibold text-[var(--ledger-muted)] block">Selisih (Aktual - Teoritis)</span>
                      <span
                        className={`text-base font-bold tabular-nums mt-0.5 block ${
                          accountingData.analisis.hpp_variance.variance_nominal > 0
                            ? "text-[var(--signal-dp)]"
                            : "text-[var(--signal-cleared)]"
                        }`}
                      >
                        {accountingData.analisis.hpp_variance.variance_nominal > 0 ? "+" : ""}
                        {formatRupiah(accountingData.analisis.hpp_variance.variance_nominal)}
                        {accountingData.analisis.hpp_variance.variance_pct != null && (
                          <span className="text-xs font-semibold ml-1.5">
                            ({accountingData.analisis.hpp_variance.variance_pct > 0 ? "+" : ""}
                            {accountingData.analisis.hpp_variance.variance_pct}%)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-[var(--ledger-muted)] border-t border-[color:var(--ledger-hairline)] ledger-recessed-subtle px-4 py-2.5">
                    {accountingData.analisis.hpp_variance.note}
                  </p>
                </div>
              )}

              {/* Struktur Biaya Operasional (Cost Breakdown) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle">
                  <h4 className="font-bold text-[var(--ledger-ink)] text-sm">
                    Struktur Biaya Komprehensif (% terhadap Omset Bersih &amp; Total Beban Usaha)
                  </h4>
                  <p className="text-xs text-[var(--ledger-muted)] mt-0.5">
                    Proporsi setiap komponen biaya terhadap pendapatan bersih (omset) dan terhadap total belanja operasional
                  </p>
                </div>

                <div className="p-4 space-y-3">
                  {[
                    {
                      label: "Bahan Baku (Bahan Kue & Minuman)",
                      pct: accountingData.analisis.cost_structure.bahan_ratio,
                      revPct: accountingData.analisis.cost_structure.bahan_to_revenue_pct,
                      color: "bg-amber-500",
                    },
                    {
                      label: "Gaji & Upah Karyawan (SDM)",
                      pct: accountingData.analisis.cost_structure.gaji_ratio,
                      revPct: accountingData.analisis.cost_structure.gaji_to_revenue_pct,
                      color: "bg-rose-500",
                    },
                    {
                      label: "Sewa Tempat & Bangunan",
                      pct: accountingData.analisis.cost_structure.sewa_ratio,
                      revPct: accountingData.analisis.cost_structure.sewa_to_revenue_pct,
                      color: "bg-purple-500",
                    },
                    {
                      label: "Utilitas Toko (Listrik, Gas, Air)",
                      pct: accountingData.analisis.cost_structure.utilitas_ratio,
                      revPct: accountingData.analisis.cost_structure.utilitas_to_revenue_pct,
                      color: "bg-emerald-500",
                    },
                    {
                      label: "Pemasaran & Promosi (Marketing)",
                      pct: accountingData.analisis.cost_structure.marketing_ratio,
                      revPct: accountingData.analisis.cost_structure.marketing_to_revenue_pct,
                      color: "bg-pink-500",
                    },
                    {
                      label: "Pemeliharaan & Servis (Maintenance)",
                      pct: accountingData.analisis.cost_structure.maintenance_ratio,
                      revPct: accountingData.analisis.cost_structure.maintenance_to_revenue_pct,
                      color: "bg-orange-500",
                    },
                    {
                      label: "Software & POS Cloud",
                      pct: accountingData.analisis.cost_structure.software_ratio,
                      revPct: accountingData.analisis.cost_structure.software_to_revenue_pct,
                      color: "bg-cyan-500",
                    },
                  ].map((cost, idx) => (
                    <div key={idx}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-[var(--ledger-ink)]">{cost.label}</span>
                        <div className="flex items-center gap-3 tabular-nums">
                          {cost.revPct != null && (
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              {cost.revPct}% omset
                            </span>
                          )}
                          <span className="font-bold text-[var(--ledger-ink)]">
                            {cost.pct}% beban
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-[var(--ledger-recessed)] h-1.5 rounded-full overflow-hidden">
                        <div className={`${cost.color} h-full rounded-full transition-all duration-500`} style={{ width: `${Math.min(100, cost.pct)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Analisis Variansi MoM (Lonjakan vs Efisiensi) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Kenaikan Biaya Terbesar */}
                <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] signal-surface-unpaid-subtle flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[var(--signal-unpaid)]" />
                    <h4 className="font-bold text-xs text-[var(--signal-unpaid)] uppercase tracking-wider">
                      Akun dengan Lonjakan Biaya Terbesar (MoM)
                    </h4>
                  </div>
                  <div className="divide-y divide-[color:var(--ledger-hairline)]">
                    {accountingData.analisis.top_variances_mom.top_increases.length > 0 ? (
                      accountingData.analisis.top_variances_mom.top_increases.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs px-4 py-2.5 ledger-hover-recessed">
                          <div>
                            <span className="font-bold text-[var(--ledger-ink)]">{item.account_name}</span>
                            <span className="text-[10px] text-[var(--ledger-muted)] block">{item.account_code} • {item.category}</span>
                          </div>
                          <div className="text-right tabular-nums">
                            <span className="font-bold text-[var(--signal-unpaid)] block">
                              +{formatRupiah(item.diff_nominal)}
                            </span>
                            <span className="text-[10px] text-[var(--signal-unpaid)] font-semibold">
                              {item.mom_change_pct ? `+${item.mom_change_pct}%` : "Baru"}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-[var(--ledger-muted)] text-center py-6">Tidak ada lonjakan biaya signifikan.</p>
                    )}
                  </div>
                </div>

                {/* Penghematan Biaya Terbesar */}
                <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] signal-surface-cleared flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-[var(--signal-cleared)]" />
                    <h4 className="font-bold text-xs text-[var(--signal-cleared)] uppercase tracking-wider">
                      Akun dengan Efisiensi / Penurunan Terbesar (MoM)
                    </h4>
                  </div>
                  <div className="divide-y divide-[color:var(--ledger-hairline)]">
                    {accountingData.analisis.top_variances_mom.top_savings.length > 0 ? (
                      accountingData.analisis.top_variances_mom.top_savings.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs px-4 py-2.5 ledger-hover-recessed">
                          <div>
                            <span className="font-bold text-[var(--ledger-ink)]">{item.account_name}</span>
                            <span className="text-[10px] text-[var(--ledger-muted)] block">{item.account_code} • {item.category}</span>
                          </div>
                          <div className="text-right tabular-nums">
                            <span className="font-bold text-[var(--signal-cleared)] block">
                              {formatRupiah(item.diff_nominal)}
                            </span>
                            <span className="text-[10px] text-[var(--signal-cleared)] font-semibold">
                              {item.mom_change_pct}%
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-[var(--ledger-muted)] text-center py-6">Belum ada penghematan yang tercatat.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BUKU BESAR & RINCIAN AKUN (GENERAL LEDGER DRILL-DOWN) */}
          {activeSubTab === "buku_besar" && (
            <div className="space-y-3">
              {/* Ringkasan Akun Kas (1-11xx) & Pendapatan (4-xxxx) */}
              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle">
                  <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                    Ringkasan Akun Kas/Bank (1-11xx) &amp; Pendapatan (4-xxxx)
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-[color:var(--ledger-hairline)] text-xs">
                  <div className="px-4 py-3 signal-surface-cleared">
                    <span className="font-mono-ledger font-bold text-[var(--signal-cleared)]">4-1100</span>
                    <div className="font-semibold text-[var(--ledger-ink)] mt-0.5">
                      Pendapatan Penjualan Kotor
                    </div>
                    <div className="text-base font-bold text-[var(--signal-cleared)] tabular-nums mt-1">
                      {formatRupiah(accountingData.laba_rugi.revenue_gross || 0)}
                    </div>
                  </div>
                  <div className="px-4 py-3 signal-surface-unpaid-subtle">
                    <span className="font-mono-ledger font-bold text-[var(--signal-unpaid)]">4-1200</span>
                    <div className="font-semibold text-[var(--ledger-ink)] mt-0.5">
                      Diskon &amp; Komisi Platform
                    </div>
                    <div className="text-base font-bold text-[var(--signal-unpaid)] tabular-nums mt-1">
                      -{formatRupiah((accountingData.laba_rugi.revenue_discount || 0) + (accountingData.laba_rugi.revenue_platform_fee || 0))}
                    </div>
                  </div>
                  {(accountingData.neraca.rekening_positions || []).slice(0, 2).map((rek) => (
                    <div
                      key={rek.id}
                      className="px-4 py-3"
                    >
                      <span className="font-mono-ledger font-bold text-blue-700 dark:text-blue-400">{rek.account_code}</span>
                      <div className="font-semibold text-[var(--ledger-ink)] mt-0.5 truncate">
                        {rek.name}
                      </div>
                      <div className="text-base font-bold text-[var(--ledger-ink)] tabular-nums mt-1">
                        {formatRupiah(rek.estimated_balance)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden">
                <div className="p-3.5 sm:px-4 sm:py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[color:var(--ledger-hairline)]">
                  <div>
                    <h3 className="font-bold text-[var(--ledger-ink)] text-sm">
                      Buku Besar Akun (General Ledger Drill-Down)
                    </h3>
                    <p className="text-xs text-[var(--ledger-muted)] mt-0.5">
                      Pilih akun akuntansi untuk memeriksa seluruh rincian transaksi belanja riil yang membentuk saldo akun tersebut.
                    </p>
                  </div>

                  {/* Account Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--ledger-muted)] shrink-0">Pilih Akun:</span>
                    <select
                      value={selectedLedgerAccount}
                      onChange={(e) => setSelectedLedgerAccount(e.target.value)}
                      aria-label="Pilih akun buku besar"
                      className="h-9 text-xs font-semibold bg-[var(--ledger-surface)] text-[var(--ledger-ink)] border border-[color:var(--ledger-hairline)] rounded-lg px-3 focus:outline-hidden cursor-pointer max-w-full"
                    >
                      {accountingData.all_accounts.map((acc) => (
                        <option key={acc.account_code} value={acc.account_code}>
                          {acc.account_code} - {acc.account_name} ({formatRupiah(acc.total)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Account Detail Summary Band */}
                {selectedAccountInfo && (
                  <div className="px-4 py-3 border-b border-[color:var(--ledger-hairline)] ledger-recessed-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono-ledger text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 px-2 py-0.5 rounded">
                          {selectedAccountInfo.account_code}
                        </span>
                        <h4 className="text-sm font-bold text-[var(--ledger-ink)]">
                          {selectedAccountInfo.account_name}
                        </h4>
                        <Badge variant="outline" className="text-[10px]">
                          {selectedAccountInfo.account_group}
                        </Badge>
                      </div>
                      <p className="text-xs text-[var(--ledger-muted)] mt-1">
                        Kategori Terhubung: <strong className="text-[var(--ledger-ink)]">{selectedAccountInfo.category}</strong> • {selectedAccountInfo.description}
                      </p>
                    </div>

                    <div className="sm:text-right">
                      <span className="text-xs text-[var(--ledger-muted)] block">Total Saldo Periode</span>
                      <span className="text-xl font-black text-[var(--ledger-ink)] tabular-nums">
                        {formatRupiah(selectedAccountInfo.total)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Search in Ledger */}
                <div className="px-4 py-2.5 border-b border-[color:var(--ledger-hairline)] flex items-center justify-between gap-3">
                  <div className="flex-1 max-w-sm">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ledger-muted)]" />
                      <input
                        type="text"
                        placeholder="Cari transaksi, supplier, catatan..."
                        value={ledgerSearch}
                        onChange={(e) => setLedgerSearch(e.target.value)}
                        className="w-full h-9 text-xs pl-8 pr-3 rounded-lg bg-[var(--ledger-surface)] text-[var(--ledger-ink)] border border-[color:var(--ledger-hairline)] focus:outline-hidden focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <SearchMinCharHint query={ledgerSearch} />
                  </div>
                  <span className="text-xs text-[var(--ledger-muted)] tabular-nums">
                    Menampilkan <strong className="text-[var(--ledger-ink)]">{filteredLedgerExpenses.length}</strong> transaksi
                  </span>
                </div>

                {/* Ledger Transactions Table */}
                <DataTable
                  columns={ledgerColumns}
                  data={filteredLedgerExpenses}
                  getRowId={(exp) => String(exp.id)}
                  isLoading={isLoadingLedger}
                  defaultPageSize={10}
                  searchQuery={ledgerSearch}
                  tableLayout={{ columnsResizable: false, width: "auto" }}
                  containerClassName="border-0 rounded-none shadow-none"
                  footerClassName="border-t border-[color:var(--ledger-hairline)] px-3.5 py-2 ledger-recessed-subtle"
                  emptyState={
                    <LedgerStateBlock
                      variant="empty"
                      icon={<Receipt className="w-7 h-7" />}
                      title="Tidak ada transaksi untuk akun ini"
                      description={`Belum ada transaksi pada periode ${accountingData.month_name} ${accountingData.year} untuk akun terpilih.`}
                    />
                  }
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
