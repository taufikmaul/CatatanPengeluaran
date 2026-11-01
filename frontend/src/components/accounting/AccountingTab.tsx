import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAccountingReport, api } from "@/lib/api";
import { AccountingReportData, AccountLineItem, Expense } from "@/types";
import { formatRupiah, formatDateId, getCategoryColor } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  onMonthChange,
  onYearChange,
  onViewExpense,
}) => {
  // Sub-tabs dalam halaman akuntansi
  const [activeSubTab, setActiveSubTab] = useState<
    "laba_rugi" | "neraca" | "arus_kas" | "analisis" | "buku_besar"
  >("laba_rugi");

  // State untuk Buku Besar (Drill-Down Akun)
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState<string>("5-1100");
  const [ledgerSearch, setLedgerSearch] = useState<string>("");

  // Query Data Akuntansi
  const {
    data: accountingData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<AccountingReportData>({
    queryKey: ["accounting-report", currentMonth, currentYear],
    queryFn: () => getAccountingReport(currentMonth, currentYear),
    staleTime: 60 * 1000,
  });

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

  const filteredLedgerExpenses = useMemo(() => {
    if (!ledgerExpensesData?.data) return [];
    if (!ledgerSearch.trim()) return ledgerExpensesData.data;
    const q = ledgerSearch.toLowerCase();
    return ledgerExpensesData.data.filter(
      (e) =>
        e.item_name?.toLowerCase().includes(q) ||
        e.supplier?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q)
    );
  }, [ledgerExpensesData, ledgerSearch]);

  // Export Rekap Akuntansi ke CSV
  const handleExportCsv = () => {
    if (!accountingData) return;
    const lines = [
      `LAPORAN AKUNTANSI KEUANGAN (SAK EMKM) - HISTORYCAKE`,
      `Periode: ${accountingData.month_name} ${accountingData.year}`,
      `Dicetak pada: ${new Date().toLocaleString("id-ID")}`,
      "",
      `1. LAPORAN LABA RUGI (BEBAN POKOK & OPERASIONAL)`,
      `Kode Akun,Nama Akun,Kategori,Nominal Bulan Ini,Nominal Bulan Lalu,Selisih MoM,% Grup,% Beban Usaha`,
    ];

    // HPP
    lines.push(`-- HARGA POKOK PENJUALAN (HPP) --,,,,,,,`);
    accountingData.laba_rugi.hpp_items.forEach((item) => {
      lines.push(
        `"${item.account_code}","${item.account_name}","${item.category}",${item.total},${item.prev_total},${item.diff_nominal},${item.percentage_of_group}%,${item.percentage_of_total_expense}%`
      );
    });
    lines.push(
      `"SUBTOTAL HPP","","Harga Pokok Penjualan",${accountingData.laba_rugi.subtotal_hpp},${accountingData.laba_rugi.prev_subtotal_hpp},${accountingData.laba_rugi.subtotal_hpp - accountingData.laba_rugi.prev_subtotal_hpp},100%,${accountingData.analisis.cost_structure.hpp_ratio}%`
    );

    // OPEX
    lines.push(``);
    lines.push(`-- BEBAN OPERASIONAL & UMUM (OPEX) --,,,,,,,`);
    accountingData.laba_rugi.opex_items.forEach((item) => {
      lines.push(
        `"${item.account_code}","${item.account_name}","${item.category}",${item.total},${item.prev_total},${item.diff_nominal},${item.percentage_of_group}%,${item.percentage_of_total_expense}%`
      );
    });
    lines.push(
      `"SUBTOTAL OPEX","","Beban Operasional",${accountingData.laba_rugi.subtotal_opex},${accountingData.laba_rugi.prev_subtotal_opex},${accountingData.laba_rugi.subtotal_opex - accountingData.laba_rugi.prev_subtotal_opex},100%,${accountingData.analisis.cost_structure.opex_ratio}%`
    );

    // Total Beban
    lines.push(``);
    lines.push(
      `"TOTAL BEBAN USAHA (LABA RUGI)","","",${accountingData.laba_rugi.total_beban},${accountingData.laba_rugi.prev_total_beban},${accountingData.laba_rugi.total_beban - accountingData.laba_rugi.prev_total_beban},-,100%`
    );

    // Neraca
    lines.push(``);
    lines.push(`2. LAPORAN POSISI KEUANGAN (NERACA BELANJA & ASET)`);
    lines.push(`Kode Akun,Nama Akun,Kelompok,Nominal,Keterangan`);
    accountingData.neraca.aset_lancar.forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Aset Lancar",${item.nominal},"${item.description}"`);
    });
    accountingData.neraca.aset_tetap.forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Aset Tetap",${item.nominal},"${item.description}"`);
    });
    accountingData.neraca.kewajiban_lancar.forEach((item) => {
      lines.push(`"${item.account_code}","${item.account_name}","Kewajiban / Hutang",${item.nominal},"${item.description}"`);
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

  return (
    <div className="space-y-6 pb-12 print:p-0">
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER & CONTROLS
      ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100">
                Laporan & Analisis Akuntansi
              </h1>
              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800 font-medium">
                SAK EMKM
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Klasifikasi Chart of Accounts (COA): Laba Rugi, Posisi Keuangan, Arus Kas, dan Analisis Rasio Biaya
            </p>
          </div>
        </div>

        {/* Filter Bulan/Tahun & Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
            <select
              value={currentMonth}
              onChange={(e) => onMonthChange(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-hidden py-1 px-1 cursor-pointer"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={idx} value={idx + 1} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {name}
                </option>
              ))}
            </select>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <select
              value={currentYear}
              onChange={(e) => onYearChange(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-hidden py-1 px-1 cursor-pointer"
            >
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {y}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 gap-1.5 text-xs text-slate-600 dark:text-slate-300"
            title="Refresh Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!accountingData}
            className="h-8 gap-1.5 text-xs text-slate-600 dark:text-slate-300"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="h-8 gap-1.5 text-xs text-slate-600 dark:text-slate-300"
            title="Cetak Laporan"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cetak</span>
          </Button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          LOADING & ERROR STATES
      ───────────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      )}

      {isError && (
        <Card className="border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20">
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <h3 className="font-semibold text-rose-800 dark:text-rose-200 text-sm">
              Gagal Memuat Laporan Akuntansi
            </h3>
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 max-w-md mx-auto">
              {(error as Error)?.message || "Terjadi kesalahan saat memproses data buku besar."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-3.5 text-xs border-rose-300 text-rose-700 hover:bg-rose-100"
            >
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      )}

      {accountingData && (
        <>
          {/* ─────────────────────────────────────────────────────────────
              2. TOP KPI CARDS (FINANCIAL SUMMARY)
          ───────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* 1. Total Beban Usaha (Laba Rugi) */}
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Total Beban Usaha</span>
                  <Badge variant="outline" className="text-[10px] font-mono py-0 bg-slate-50 dark:bg-slate-800">
                    Laba Rugi
                  </Badge>
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 mt-1.5 tabular-nums">
                  {formatRupiah(accountingData.laba_rugi.total_beban)}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                  {accountingData.laba_rugi.mom_beban_change_pct !== null && accountingData.laba_rugi.mom_beban_change_pct !== undefined ? (
                    <span
                      className={`inline-flex items-center font-medium ${
                        accountingData.laba_rugi.mom_beban_change_pct > 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
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
                    <span className="text-slate-400">Periode awal</span>
                  )}
                  <span className="text-slate-400">vs {accountingData.prev_month_name}</span>
                </div>
              </CardContent>
            </Card>

            {/* 2. Harga Pokok Penjualan (HPP) */}
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="text-amber-700 dark:text-amber-400 font-medium">Beban Pokok (HPP)</span>
                  <Badge variant="outline" className="text-[10px] font-mono py-0 bg-amber-50 text-amber-700 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800">
                    Akun 5-XXXX
                  </Badge>
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 mt-1.5 tabular-nums">
                  {formatRupiah(accountingData.laba_rugi.subtotal_hpp)}
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                  <span>Porsi: <strong>{accountingData.analisis.cost_structure.hpp_ratio}%</strong></span>
                  {accountingData.laba_rugi.mom_hpp_change_pct !== null && (
                    <span className={accountingData.laba_rugi.mom_hpp_change_pct > 0 ? "text-amber-600" : "text-emerald-600"}>
                      {accountingData.laba_rugi.mom_hpp_change_pct > 0 ? `+` : ``}
                      {accountingData.laba_rugi.mom_hpp_change_pct}%
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 3. Beban Operasional (OPEX) */}
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="text-blue-700 dark:text-blue-400 font-medium">Operasional (OPEX)</span>
                  <Badge variant="outline" className="text-[10px] font-mono py-0 bg-blue-50 text-blue-700 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800">
                    Akun 6-XXXX
                  </Badge>
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 mt-1.5 tabular-nums">
                  {formatRupiah(accountingData.laba_rugi.subtotal_opex)}
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                  <span>Porsi: <strong>{accountingData.analisis.cost_structure.opex_ratio}%</strong></span>
                  {accountingData.laba_rugi.mom_opex_change_pct !== null && (
                    <span className={accountingData.laba_rugi.mom_opex_change_pct > 0 ? "text-rose-600" : "text-emerald-600"}>
                      {accountingData.laba_rugi.mom_opex_change_pct > 0 ? `+` : ``}
                      {accountingData.laba_rugi.mom_opex_change_pct}%
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 4. Belanja Modal / Aset Tetap */}
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="text-purple-700 dark:text-purple-400 font-medium">Aset Tetap (Capex)</span>
                  <Badge variant="outline" className="text-[10px] font-mono py-0 bg-purple-50 text-purple-700 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800">
                    Neraca 1-2100
                  </Badge>
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 mt-1.5 tabular-nums">
                  {formatRupiah(accountingData.neraca.subtotal_aset_tetap)}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Peralatan, showcase, mesin tahan lama
                </div>
              </CardContent>
            </Card>

            {/* 5. Hutang Belanja (Kewajiban) */}
            <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="text-rose-700 dark:text-rose-400 font-medium">Hutang Belanja</span>
                  <Badge variant="outline" className="text-[10px] font-mono py-0 bg-rose-50 text-rose-700 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800">
                    Kewajiban 2-1110
                  </Badge>
                </div>
                <div className="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 mt-1.5 tabular-nums">
                  {formatRupiah(accountingData.neraca.subtotal_kewajiban)}
                </div>
                <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>{accountingData.neraca.detail_hutang.length} nota tempo</span>
                  {accountingData.neraca.subtotal_kewajiban > 0 ? (
                    <span className="text-rose-600 font-medium">Belum Lunas</span>
                  ) : (
                    <span className="text-emerald-600 font-medium">Nihil (Lunas)</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ─────────────────────────────────────────────────────────────
              3. SUB-TAB BAR NAVIGATION
          ───────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 overflow-x-auto pb-0 text-sm print:hidden">
            <button
              onClick={() => setActiveSubTab("laba_rugi")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeSubTab === "laba_rugi"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>1. Laporan Laba Rugi</span>
            </button>

            <button
              onClick={() => setActiveSubTab("neraca")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeSubTab === "neraca"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>2. Posisi Keuangan (Neraca)</span>
            </button>

            <button
              onClick={() => setActiveSubTab("arus_kas")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeSubTab === "arus_kas"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>3. Laporan Arus Kas</span>
            </button>

            <button
              onClick={() => setActiveSubTab("analisis")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeSubTab === "analisis"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <PieChart className="w-4 h-4" />
              <span>4. Analisis & Rasio Finansial</span>
            </button>

            <button
              onClick={() => setActiveSubTab("buku_besar")}
              className={`flex items-center gap-2 px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeSubTab === "buku_besar"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Receipt className="w-4 h-4" />
              <span>5. Buku Besar & Rincian Akun</span>
            </button>
          </div>

          {/* ─────────────────────────────────────────────────────────────
              TAB 1: LAPORAN LABA RUGI (INCOME STATEMENT)
          ───────────────────────────────────────────────────────────── */}
          {activeSubTab === "laba_rugi" && (
            <div className="space-y-6">
              {/* Visual Proportion Bar HPP vs OPEX */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Struktur Beban Usaha Laba Rugi
                  </span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                      HPP ({accountingData.analisis.cost_structure.hpp_ratio}%)
                    </span>
                    <span className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                      OPEX ({accountingData.analisis.cost_structure.opex_ratio}%)
                    </span>
                  </div>
                </div>
                <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    className="bg-amber-500 h-full transition-all duration-500"
                    style={{ width: `${accountingData.analisis.cost_structure.hpp_ratio}%` }}
                    title={`HPP: ${formatRupiah(accountingData.laba_rugi.subtotal_hpp)}`}
                  />
                  <div
                    className="bg-blue-500 h-full transition-all duration-500"
                    style={{ width: `${accountingData.analisis.cost_structure.opex_ratio}%` }}
                    title={`OPEX: ${formatRupiah(accountingData.laba_rugi.subtotal_opex)}`}
                  />
                </div>
              </div>

              {/* 1. SECTION HPP (Akun Kepala 5) */}
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                <div className="bg-amber-50/70 dark:bg-amber-950/30 px-5 py-3.5 border-b border-amber-200/70 dark:border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded">
                      AKUN 5-XXXX
                    </span>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      Harga Pokok Penjualan (HPP / Beban Pokok)
                    </h3>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 dark:text-slate-400 mr-2">Subtotal HPP:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 text-sm tabular-nums">
                      {formatRupiah(accountingData.laba_rugi.subtotal_hpp)}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-800/40">
                        <th className="py-2.5 px-4 font-semibold w-24">Kode Akun</th>
                        <th className="py-2.5 px-4 font-semibold">Nama Akun Akuntansi</th>
                        <th className="py-2.5 px-4 font-semibold">Kategori Belanja</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Bulan Ini</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Bulan Lalu</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Perubahan MoM</th>
                        <th className="py-2.5 px-4 font-semibold text-right">% HPP</th>
                        <th className="py-2.5 px-4 font-semibold text-center w-20">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {accountingData.laba_rugi.hpp_items.map((row) => {
                        const color = getCategoryColor(row.category);
                        return (
                          <tr
                            key={row.account_code}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-3 px-4 font-mono font-medium text-slate-600 dark:text-slate-300">
                              {row.account_code}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                                {row.account_name}
                              </span>
                              <span className="text-[11px] text-slate-400 block truncate max-w-xs">
                                {row.description}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${color.bg} ${color.border}`}>
                                {row.category}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                              {formatRupiah(row.total)}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-500 tabular-nums">
                              {formatRupiah(row.prev_total)}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums">
                              {row.mom_change_pct !== null && row.mom_change_pct !== undefined ? (
                                <span
                                  className={`font-semibold ${
                                    row.mom_change_pct > 0
                                      ? "text-rose-600 dark:text-rose-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                  }`}
                                >
                                  {row.mom_change_pct > 0 ? `+` : ``}
                                  {row.mom_change_pct}%
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums">
                              <span className="font-semibold text-amber-700 dark:text-amber-400">
                                {row.percentage_of_group}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedLedgerAccount(row.account_code);
                                  setActiveSubTab("buku_besar");
                                }}
                                className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                                title="Lihat Rincian Buku Besar"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50/50 dark:bg-amber-950/20 font-bold border-t border-amber-200 dark:border-amber-900 text-slate-900 dark:text-slate-100">
                        <td colSpan={3} className="py-3 px-4">
                          Subtotal Harga Pokok Penjualan (HPP)
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-amber-800 dark:text-amber-300">
                          {formatRupiah(accountingData.laba_rugi.subtotal_hpp)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          {formatRupiah(accountingData.laba_rugi.prev_subtotal_hpp)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {accountingData.laba_rugi.mom_hpp_change_pct !== null && (
                            <span className={accountingData.laba_rugi.mom_hpp_change_pct > 0 ? "text-rose-600" : "text-emerald-600"}>
                              {accountingData.laba_rugi.mom_hpp_change_pct > 0 ? `+` : ``}
                              {accountingData.laba_rugi.mom_hpp_change_pct}%
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">100.0%</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>

              {/* 2. SECTION OPEX (Akun Kepala 6) */}
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                <div className="bg-blue-50/70 dark:bg-blue-950/30 px-5 py-3.5 border-b border-blue-200/70 dark:border-blue-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-800 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded">
                      AKUN 6-XXXX
                    </span>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      Beban Operasional & Umum (OPEX)
                    </h3>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 dark:text-slate-400 mr-2">Subtotal OPEX:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 text-sm tabular-nums">
                      {formatRupiah(accountingData.laba_rugi.subtotal_opex)}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-800/40">
                        <th className="py-2.5 px-4 font-semibold w-24">Kode Akun</th>
                        <th className="py-2.5 px-4 font-semibold">Nama Akun Akuntansi</th>
                        <th className="py-2.5 px-4 font-semibold">Kategori Belanja</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Bulan Ini</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Bulan Lalu</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Perubahan MoM</th>
                        <th className="py-2.5 px-4 font-semibold text-right">% OPEX</th>
                        <th className="py-2.5 px-4 font-semibold text-center w-20">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {accountingData.laba_rugi.opex_items.map((row) => {
                        const color = getCategoryColor(row.category);
                        return (
                          <tr
                            key={row.account_code}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-3 px-4 font-mono font-medium text-slate-600 dark:text-slate-300">
                              {row.account_code}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                                {row.account_name}
                              </span>
                              <span className="text-[11px] text-slate-400 block truncate max-w-xs">
                                {row.description}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${color.bg} ${color.border}`}>
                                {row.category}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                              {formatRupiah(row.total)}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-500 tabular-nums">
                              {formatRupiah(row.prev_total)}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums">
                              {row.mom_change_pct !== null && row.mom_change_pct !== undefined ? (
                                <span
                                  className={`font-semibold ${
                                    row.mom_change_pct > 0
                                      ? "text-rose-600 dark:text-rose-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                  }`}
                                >
                                  {row.mom_change_pct > 0 ? `+` : ``}
                                  {row.mom_change_pct}%
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums">
                              <span className="font-semibold text-blue-700 dark:text-blue-400">
                                {row.percentage_of_group}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedLedgerAccount(row.account_code);
                                  setActiveSubTab("buku_besar");
                                }}
                                className="h-7 w-7 p-0 text-slate-500 hover:text-blue-600"
                                title="Lihat Rincian Buku Besar"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-blue-50/50 dark:bg-blue-950/20 font-bold border-t border-blue-200 dark:border-blue-900 text-slate-900 dark:text-slate-100">
                        <td colSpan={3} className="py-3 px-4">
                          Subtotal Beban Operasional & Umum (OPEX)
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-blue-800 dark:text-blue-300">
                          {formatRupiah(accountingData.laba_rugi.subtotal_opex)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-600 dark:text-slate-400">
                          {formatRupiah(accountingData.laba_rugi.prev_subtotal_opex)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {accountingData.laba_rugi.mom_opex_change_pct !== null && (
                            <span className={accountingData.laba_rugi.mom_opex_change_pct > 0 ? "text-rose-600" : "text-emerald-600"}>
                              {accountingData.laba_rugi.mom_opex_change_pct > 0 ? `+` : ``}
                              {accountingData.laba_rugi.mom_opex_change_pct}%
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">100.0%</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>

              {/* 3. GRAND TOTAL BEBAN USAHA */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl p-5 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-slate-300 font-semibold">
                      Total Beban Usaha Toko (Laba Rugi)
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-white/10 text-white border-white/20">
                      HPP + OPEX
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Seluruh biaya operasional dan pokok bahan yang dibebankan pada periode {accountingData.month_name} {accountingData.year}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl md:text-3xl font-extrabold tabular-nums tracking-tight">
                    {formatRupiah(accountingData.laba_rugi.total_beban)}
                  </div>
                  <div className="text-xs text-slate-300 mt-1">
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

          {/* ─────────────────────────────────────────────────────────────
              TAB 2: LAPORAN POSISI KEUANGAN / NERACA
          ───────────────────────────────────────────────────────────── */}
          {activeSubTab === "neraca" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* SISI KIRI: ASET (AKTIVA) */}
                <div className="space-y-6">
                  {/* Aset Lancar */}
                  <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-emerald-600" />
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          Aset Lancar (Kas & Bank Belanja)
                        </h3>
                      </div>
                      <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatRupiah(accountingData.neraca.subtotal_aset_lancar)}
                      </span>
                    </div>

                    <div className="p-4 space-y-3">
                      {accountingData.neraca.aset_lancar.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-600 dark:text-slate-300">{item.account_code}</span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{item.account_name}</span>
                            </div>
                            <span className="text-[11px] text-slate-400 mt-0.5 block">{item.description}</span>
                          </div>
                          <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm">
                            {formatRupiah(item.nominal)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Aset Tetap */}
                  <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building className="w-4 h-4 text-purple-600" />
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          Aset Tetap (Peralatan & Mesin)
                        </h3>
                      </div>
                      <span className="font-mono text-xs font-semibold text-purple-700 dark:text-purple-400 tabular-nums">
                        {formatRupiah(accountingData.neraca.subtotal_aset_tetap)}
                      </span>
                    </div>

                    <div className="p-4">
                      {accountingData.neraca.aset_tetap.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-600 dark:text-slate-300">{item.account_code}</span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{item.account_name}</span>
                            </div>
                            <span className="text-[11px] text-slate-400 mt-0.5 block">{item.description}</span>
                          </div>
                          <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-sm">
                            {formatRupiah(item.nominal)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* SISI KANAN: KEWAJIBAN (PASSIVA) */}
                <div className="space-y-6">
                  <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                    <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-600" />
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          Kewajiban Lancar (Hutang Belanja & Tempo)
                        </h3>
                      </div>
                      <span className="font-mono text-xs font-semibold text-rose-700 dark:text-rose-400 tabular-nums">
                        {formatRupiah(accountingData.neraca.subtotal_kewajiban)}
                      </span>
                    </div>

                    <div className="p-4 space-y-3">
                      {accountingData.neraca.kewajiban_lancar.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-rose-800 dark:text-rose-300">{item.account_code}</span>
                              <span className="font-semibold text-rose-900 dark:text-rose-100">{item.account_name}</span>
                            </div>
                            <span className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 block">{item.description}</span>
                          </div>
                          <span className="font-bold text-rose-700 dark:text-rose-300 tabular-nums text-sm">
                            {formatRupiah(item.nominal)}
                          </span>
                        </div>
                      ))}

                      {/* Detail Faktur / Tagihan Belum Lunas */}
                      {accountingData.neraca.detail_hutang.length > 0 ? (
                        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                          <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                            Daftar Faktur / Nota Tempo Belum Lunas:
                          </h4>
                          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                            {accountingData.neraca.detail_hutang.map((h, i) => (
                              <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-slate-50 dark:bg-slate-800/40">
                                <div>
                                  <span className="font-medium text-slate-800 dark:text-slate-200">{h.barang}</span>
                                  <span className="text-[10px] text-slate-400 block">
                                    Toko: {h.supplier || "-"} • Jatuh Tempo: {h.tempo || "-"}
                                  </span>
                                </div>
                                <span className="font-semibold text-rose-600 tabular-nums">
                                  {formatRupiah(h.nominal)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 text-center text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg">
                          <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-500" />
                          Tidak ada hutang belanja atau tempo yang tertunggak pada bulan ini.
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              TAB 3: LAPORAN ARUS KAS (CASH FLOW STATEMENT)
          ───────────────────────────────────────────────────────────── */}
          {activeSubTab === "arus_kas" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Aktivitas Operasi */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                      Aktivitas Operasi
                    </span>
                    <span className="text-[11px] text-slate-400">Pembayaran HPP, bahan baku & OPEX toko</span>
                  </div>
                  <CardContent className="p-4 space-y-3">
                    {accountingData.arus_kas.aktivitas_operasi.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-600 dark:text-slate-300 max-w-[65%]">{item.activity}</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          ({formatRupiah(item.nominal)})
                        </span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center font-bold text-xs">
                      <span>Kas Keluar Operasi:</span>
                      <span className="text-rose-600 tabular-nums">
                        ({formatRupiah(accountingData.arus_kas.subtotal_operasi)})
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* 2. Aktivitas Investasi */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                      Aktivitas Investasi
                    </span>
                    <span className="text-[11px] text-slate-400">Pembelian aset tetap, mesin & peralatan</span>
                  </div>
                  <CardContent className="p-4 space-y-3">
                    {accountingData.arus_kas.aktivitas_investasi.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-600 dark:text-slate-300 max-w-[65%]">{item.activity}</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          ({formatRupiah(item.nominal)})
                        </span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center font-bold text-xs">
                      <span>Kas Keluar Investasi:</span>
                      <span className="text-rose-600 tabular-nums">
                        ({formatRupiah(accountingData.arus_kas.subtotal_investasi)})
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* 3. Aktivitas Kliring / Transfer */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                      Aktivitas Kliring
                    </span>
                    <span className="text-[11px] text-slate-400">Tukar cash kasir / transfer kliring</span>
                  </div>
                  <CardContent className="p-4 space-y-3">
                    {accountingData.arus_kas.aktivitas_kliring.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-600 dark:text-slate-300 max-w-[65%]">{item.activity}</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          ({formatRupiah(item.nominal)})
                        </span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center font-bold text-xs">
                      <span>Kas Kliring:</span>
                      <span className="text-slate-700 dark:text-slate-300 tabular-nums">
                        ({formatRupiah(accountingData.arus_kas.subtotal_kliring)})
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Total Arus Kas Riil & Distribusi Pembayaran */}
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      Total Pengeluaran Kas Riil (Net Cash Outflow)
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Total dana kas & bank yang keluar dari kasir pada periode {accountingData.month_name} {accountingData.year}
                    </p>
                  </div>
                  <div className="text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
                    {formatRupiah(accountingData.arus_kas.total_kas_keluar_riil)}
                  </div>
                </div>

                {/* Metode Pembayaran Distribution */}
                <div className="mt-4">
                  <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
                    Distribusi Realisasi Berdasarkan Metode Pembayaran:
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {accountingData.arus_kas.metode_bayar_distribution.map((m, idx) => (
                      <div key={idx} className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                        <span className="text-slate-500 font-medium block">{m.metode}</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 block mt-1 tabular-nums">
                          {formatRupiah(m.nominal)}
                        </span>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                          <div className="bg-blue-600 h-full rounded-full" style={{ width: `${m.percentage}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1 block text-right">{m.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              TAB 4: ANALISIS & RASIO FINANSIAL (HEALTH & RATIOS)
          ───────────────────────────────────────────────────────────── */}
          {activeSubTab === "analisis" && (
            <div className="space-y-6">
              {/* Evaluasi Kesehatan Finansial (4 Cards) */}
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  Evaluasi Kesehatan Beban & Rasio Operasional (Target vs Realisasi)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {accountingData.analisis.health_evaluation.map((evalItem) => {
                    const statusColor =
                      evalItem.status === "healthy"
                        ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200"
                        : evalItem.status === "warning"
                        ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200"
                        : evalItem.status === "danger"
                        ? "border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-200"
                        : "border-slate-200 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300";

                    const badgeColor =
                      evalItem.status === "healthy"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60"
                        : evalItem.status === "warning"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/60"
                        : evalItem.status === "danger"
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/60"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800";

                    return (
                      <Card key={evalItem.key} className={`border ${statusColor} shadow-xs`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold leading-tight">{evalItem.title}</span>
                            <Badge className={`text-[10px] uppercase font-bold ${badgeColor} border-0`}>
                              {evalItem.status}
                            </Badge>
                          </div>
                          <div className="text-xl font-black mt-2 tabular-nums">
                            {evalItem.value}
                          </div>
                          <div className="text-[11px] opacity-75 mt-0.5">
                            Target Ideal: <strong>{evalItem.ideal_range}</strong>
                          </div>
                          <p className="text-xs mt-2.5 leading-relaxed border-t border-black/5 dark:border-white/5 pt-2">
                            {evalItem.note}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* Struktur Biaya Operasional (Cost Breakdown) */}
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm mb-1">
                  Struktur Biaya Komprehensif (% terhadap Total Beban Usaha)
                </h4>
                <p className="text-xs text-slate-500 mb-4">
                  Proporsi alokasi setiap komponen biaya utama terhadap total belanja operasional
                </p>

                <div className="space-y-3.5">
                  {[
                    { label: "Bahan Baku (Bahan Kue & Minuman)", pct: accountingData.analisis.cost_structure.bahan_ratio, color: "bg-amber-500" },
                    { label: "Gaji & Upah Karyawan (SDM)", pct: accountingData.analisis.cost_structure.gaji_ratio, color: "bg-rose-500" },
                    { label: "Sewa Tempat & Bangunan", pct: accountingData.analisis.cost_structure.sewa_ratio, color: "bg-purple-500" },
                    { label: "Utilitas Toko (Listrik, Gas, Air)", pct: accountingData.analisis.cost_structure.utilitas_ratio, color: "bg-emerald-500" },
                    { label: "Pemasaran & Promosi (Marketing)", pct: accountingData.analisis.cost_structure.marketing_ratio, color: "bg-pink-500" },
                    { label: "Pemeliharaan & Servis (Maintenance)", pct: accountingData.analisis.cost_structure.maintenance_ratio, color: "bg-orange-500" },
                    { label: "Software & POS Cloud", pct: accountingData.analisis.cost_structure.software_ratio, color: "bg-cyan-500" },
                  ].map((cost, idx) => (
                    <div key={idx}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{cost.label}</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">{cost.pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div className={`${cost.color} h-full rounded-full transition-all duration-500`} style={{ width: `${cost.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Analisis Variansi MoM (Lonjakan vs Efisiensi) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Kenaikan Biaya Terbesar */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-rose-50/50 dark:bg-rose-950/20 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-rose-600" />
                    <h4 className="font-bold text-xs text-rose-900 dark:text-rose-200 uppercase tracking-wider">
                      Akun dengan Lonjakan Biaya Terbesar (MoM)
                    </h4>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {accountingData.analisis.top_variances_mom.top_increases.length > 0 ? (
                      accountingData.analisis.top_variances_mom.top_increases.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-2 rounded bg-slate-50 dark:bg-slate-800/40">
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100">{item.account_name}</span>
                            <span className="text-[10px] text-slate-400 block">{item.account_code} • {item.category}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-rose-600 block tabular-nums">
                              +{formatRupiah(item.diff_nominal)}
                            </span>
                            <span className="text-[10px] text-rose-500 font-semibold">
                              {item.mom_change_pct ? `+${item.mom_change_pct}%` : "Baru"}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-4">Tidak ada lonjakan biaya signifikan.</p>
                    )}
                  </div>
                </Card>

                {/* Penghematan Biaya Terbesar */}
                <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-emerald-600" />
                    <h4 className="font-bold text-xs text-emerald-900 dark:text-emerald-200 uppercase tracking-wider">
                      Akun dengan Efisiensi / Penurunan Terbesar (MoM)
                    </h4>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {accountingData.analisis.top_variances_mom.top_savings.length > 0 ? (
                      accountingData.analisis.top_variances_mom.top_savings.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-2 rounded bg-slate-50 dark:bg-slate-800/40">
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100">{item.account_name}</span>
                            <span className="text-[10px] text-slate-400 block">{item.account_code} • {item.category}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-emerald-600 block tabular-nums">
                              {formatRupiah(item.diff_nominal)}
                            </span>
                            <span className="text-[10px] text-emerald-500 font-semibold">
                              {item.mom_change_pct}%
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-4">Belum ada penghematan yang tercatat.</p>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              TAB 5: BUKU BESAR & RINCIAN AKUN (GENERAL LEDGER DRILL-DOWN)
          ───────────────────────────────────────────────────────────── */}
          {activeSubTab === "buku_besar" && (
            <div className="space-y-6">
              <Card className="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      Buku Besar Akun (General Ledger Drill-Down)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Pilih akun akuntansi untuk memeriksa seluruh rincian transaksi belanja riil yang membentuk saldo akun tersebut.
                    </p>
                  </div>

                  {/* Account Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Pilih Akun:</span>
                    <select
                      value={selectedLedgerAccount}
                      onChange={(e) => setSelectedLedgerAccount(e.target.value)}
                      className="text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg py-1.5 px-3 focus:outline-hidden cursor-pointer"
                    >
                      {accountingData.all_accounts.map((acc) => (
                        <option key={acc.account_code} value={acc.account_code}>
                          {acc.account_code} - {acc.account_name} ({formatRupiah(acc.total)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Account Detail Summary Header */}
                {selectedAccountInfo && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 px-2 py-0.5 rounded">
                          {selectedAccountInfo.account_code}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {selectedAccountInfo.account_name}
                        </h4>
                        <Badge variant="outline" className="text-[10px]">
                          {selectedAccountInfo.account_group}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Kategori Terhubung: <strong>{selectedAccountInfo.category}</strong> • {selectedAccountInfo.description}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Total Saldo Periode:</span>
                      <span className="text-xl font-black text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatRupiah(selectedAccountInfo.total)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Search in Ledger */}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Cari transaksi, supplier, catatan..."
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                      className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:border-blue-500"
                    />
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    Menampilkan <strong>{filteredLedgerExpenses.length}</strong> transaksi
                  </span>
                </div>

                {/* Ledger Transactions Table */}
                <div className="mt-3 overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2.5 px-3 font-semibold w-24">Tanggal</th>
                        <th className="py-2.5 px-3 font-semibold">Nama Item / Transaksi</th>
                        <th className="py-2.5 px-3 font-semibold">Toko / Supplier</th>
                        <th className="py-2.5 px-3 font-semibold text-center w-20">Qty</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Harga Satuan</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Total Nominal</th>
                        <th className="py-2.5 px-3 font-semibold">Metode</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {isLoadingLedger ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400">
                            Memuat transaksi buku besar...
                          </td>
                        </tr>
                      ) : filteredLedgerExpenses.length > 0 ? (
                        filteredLedgerExpenses.map((exp) => (
                          <tr
                            key={exp.id}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-mono">
                              {exp.expense_date}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                                {exp.item_name}
                              </span>
                              {exp.notes && exp.notes !== "-" && (
                                <span className="text-[10px] text-slate-400 block truncate max-w-xs">
                                  {exp.notes}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                              {exp.supplier || "-"}
                            </td>
                            <td className="py-2.5 px-3 text-center tabular-nums">
                              {exp.qty} {exp.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400">
                              {formatRupiah(Number(exp.unit_price || 0))}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                              {formatRupiah(Number(exp.total_price || 0))}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                              {exp.pay_method || "Tunai"}
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge
                                variant="outline"
                                className={`text-[10px] py-0 ${
                                  exp.pay_status === "Lunas"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                {exp.pay_status || "Lunas"}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                            Tidak ada transaksi untuk akun ini pada periode {accountingData.month_name} {accountingData.year}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
};
