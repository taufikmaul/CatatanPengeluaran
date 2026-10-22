import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Expense, MonthlyReport, SystemConfig, ExpenseFormData } from "@/types";
import { StatCards } from "@/components/dashboard/StatCards";
import { CategoryDonutChart } from "@/components/dashboard/CategoryDonutChart";
import { DailyTrendChart } from "@/components/dashboard/DailyTrendChart";
import { LeaderboardCards } from "@/components/dashboard/LeaderboardCards";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { ExpenseTable } from "@/components/dashboard/ExpenseTable";
import { ExpenseFormDrawer } from "@/components/forms/ExpenseFormDrawer";
import { CsvImportModal } from "@/components/import/CsvImportModal";
import { ConfigTab } from "@/components/config/ConfigTab";
import { LoginModal } from "@/components/auth/LoginModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import confetti from "canvas-confetti";
import {
  BarChart3,
  Upload,
  Settings,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";

export function App() {
  const queryClient = useQueryClient();

  // Active Tab: "overview" | "import" | "config"
  const [activeTab, setActiveTab] = useState<"overview" | "import" | "config">("overview");

  // Filter states
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  // Modal & Drawer states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  // 1. Auth Status Query
  const { data: authData, refetch: refetchAuth } = useQuery({
    queryKey: ["auth-status"],
    queryFn: async () => {
      const res = await api.get("/auth/status");
      return res.data;
    },
    retry: false,
  });

  useEffect(() => {
    if (authData && !authData.authenticated) {
      setIsLoginOpen(true);
    }
  }, [authData]);

  // Listen for 401 unauthorized event
  useEffect(() => {
    const handleUnauthorized = () => {
      setIsLoginOpen(true);
    };
    window.addEventListener("catpen:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("catpen:unauthorized", handleUnauthorized);
  }, []);

  // 2. Monthly Analytics Report Query
  const { data: reportData, refetch: refetchReport } = useQuery<MonthlyReport>({
    queryKey: ["report", month, year],
    queryFn: async () => {
      const res = await api.get(`/reports/monthly?month=${month}&year=${year}`);
      return res.data;
    },
    enabled: !!authData?.authenticated,
  });

  // 3. Expenses List Query
  const {
    data: expensesData,
    isLoading: isExpensesLoading,
    refetch: refetchExpenses,
  } = useQuery({
    queryKey: ["expenses", page, month, year, category, search, status],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: "30",
        month: String(month),
        year: String(year),
      });
      if (category) params.append("category", category);
      if (search) params.append("search", search);
      if (status) params.append("status", status);

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
    enabled: !!authData?.authenticated,
  });

  // 4. System Config Query
  const { data: configData, refetch: refetchConfig } = useQuery<SystemConfig>({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await api.get("/config");
      return res.data;
    },
    enabled: activeTab === "config" && !!authData?.authenticated,
  });

  // Mutasi: Create / Update Expense
  const saveMutation = useMutation({
    mutationFn: async ({
      data,
      id,
    }: {
      data: ExpenseFormData;
      id?: number;
    }) => {
      if (id) {
        return (await api.put(`/expenses/${id}`, data)).data;
      } else {
        return (await api.post("/expenses", data)).data;
      }
    },
    onSuccess: (saved, variables) => {
      toast.success(
        variables.id
          ? "Data pengeluaran berhasil diperbarui!"
          : "Catatan pengeluaran berhasil ditambahkan!"
      );
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan pengeluaran");
    },
  });

  // Mutasi: Toggle Pay Status (Optimistic Update for zero perceived lag!)
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: number; newStatus: string }) => {
      return (await api.put(`/expenses/${id}`, { pay_status: newStatus })).data;
    },
    onMutate: async ({ id, newStatus }) => {
      await queryClient.cancelQueries({ queryKey: ["expenses"] });
      const previousExpenses = queryClient.getQueryData(["expenses", page, month, year, category, search, status]);

      queryClient.setQueryData(
        ["expenses", page, month, year, category, search, status],
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((item: Expense) =>
              item.id === id ? { ...item, pay_status: newStatus } : item
            ),
          };
        }
      );

      return { previousExpenses };
    },
    onSuccess: (updated) => {
      const isLunas = updated.pay_status === "Lunas";
      if (isLunas) {
        toast.success(`Transaksi #${updated.id} ditandai Lunas! 🎉`);
        // Subtle confetti celebrate!
        confetti({
          particleCount: 40,
          spread: 50,
          origin: { y: 0.8 },
          colors: ["#10b981", "#3b82f6", "#f59e0b"],
        });
      } else {
        toast.info(`Transaksi #${updated.id} diubah ke Belum Lunas`);
      }
      queryClient.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (_err, _vars, context) => {
      if (context?.previousExpenses) {
        queryClient.setQueryData(
          ["expenses", page, month, year, category, search, status],
          context.previousExpenses
        );
      }
      toast.error("Gagal mengubah status pembayaran");
    },
  });

  // Mutasi: Delete Expense
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return (await api.delete(`/expenses/${id}`)).data;
    },
    onSuccess: () => {
      toast.success("Pengeluaran berhasil dihapus");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menghapus pengeluaran");
    },
  });

  const handleToggleStatus = (item: Expense) => {
    const isLunas = (item.pay_status || "").toLowerCase().includes("lunas");
    const newStatus = isLunas ? "Belum Lunas" : "Lunas";
    toggleStatusMutation.mutate({ id: item.id, newStatus });
  };

  const handleFormSubmit = (data: ExpenseFormData, expenseId?: number) => {
    saveMutation.mutate({ data, id: expenseId });
  };

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
      toast.success("Anda telah berhasil keluar");
      refetchAuth();
      setIsLoginOpen(true);
    } catch {
      window.location.reload();
    }
  };

  const categories = reportData?.valid_categories || [
    "Bahan Baku",
    "Bahan Tambahan",
    "Kemasan",
    "Operasional",
    "Peralatan",
    "Gaji / SDM",
    "Lainnya",
  ];

  const totalUnpaidNominal =
    reportData?.list_hutang?.reduce((sum, item) => sum + item.nominal, 0) || 0;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* Toast provider */}
      <Toaster position="top-right" richColors />

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 md:px-8 py-3.5 transition-all">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <span className="text-2xl md:text-3xl filter drop-shadow-sm select-none">🎂</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base md:text-lg text-slate-900 leading-tight">
                  Catatan Pengeluaran
                </h1>
                <Badge variant="outline" className="hidden sm:inline-flex text-[10px] font-semibold text-rose-600 border-rose-200 bg-rose-50/50">
                  Historycake
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                FastAPI • PostgreSQL • React + shadcn
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl text-xs font-semibold">
            <button
              onClick={() => setActiveTab("overview")}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === "overview"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className="px-3 py-1.5 rounded-xl text-slate-600 hover:text-slate-900 transition-all flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Import</span> CSV
            </button>
            <button
              onClick={() => setActiveTab("config")}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === "config"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Sistem</span>
            </button>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setEditingExpense(null);
                setIsFormOpen(true);
              }}
              size="sm"
              className="hidden md:inline-flex bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs gap-1.5 text-xs font-semibold h-9"
            >
              <Plus className="w-3.5 h-3.5" />
              Catat Baru
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-9 px-2.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {activeTab === "overview" && (
          <>
            {/* Stat Cards */}
            <StatCards
              totalLunas={reportData?.total_lunas || 0}
              totalPengeluaran={reportData?.total_pengeluaran || 0}
              expenseCount={reportData?.expense_count || 0}
              unpaidCount={reportData?.list_hutang?.length || 0}
              unpaidTotal={totalUnpaidNominal}
              categoryCount={Object.keys(reportData?.per_kategori || {}).length}
              monthName={reportData?.month_name || "Bulan Ini"}
              year={year}
              onFilterUnpaid={() => setStatus("Belum Lunas")}
            />

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5">
                <CategoryDonutChart
                  categoryData={reportData?.per_kategori || {}}
                  totalAmount={reportData?.total_lunas || 0}
                />
              </div>
              <div className="lg:col-span-7">
                <DailyTrendChart data={reportData?.daily_chart || []} />
              </div>
            </div>

            {/* Leaderboard & Top Stats Section */}
            <LeaderboardCards
              topFrequentItems={reportData?.top_frequent_items || []}
              topExpensiveItems={reportData?.top_expensive_items || []}
              topUnitPriceItems={reportData?.top_unit_price_items || []}
              topPriceSpikes={reportData?.top_price_spikes || []}
              topSuppliers={reportData?.top_suppliers || []}
              summaryMetrics={reportData?.summary_metrics}
              monthName={reportData?.month_name || "Bulan Ini"}
              year={year}
            />

            {/* Filter Bar */}
            <FilterBar
              month={month}
              year={year}
              selectedCategory={category}
              search={search}
              status={status}
              categories={categories}
              onMonthChange={(m) => {
                setMonth(m);
                setPage(1);
              }}
              onYearChange={(y) => {
                setYear(y);
                setPage(1);
              }}
              onCategoryChange={(c) => {
                setCategory(c);
                setPage(1);
              }}
              onSearchChange={(s) => {
                setSearch(s);
                setPage(1);
              }}
              onStatusChange={(st) => {
                setStatus(st);
                setPage(1);
              }}
              onReset={() => {
                setCategory("");
                setSearch("");
                setStatus("");
                setPage(1);
              }}
              onOpenAddExpense={() => {
                setEditingExpense(null);
                setIsFormOpen(true);
              }}
            />

            {/* Expense Data Table */}
            <ExpenseTable
              expenses={expensesData?.data || []}
              isLoading={isExpensesLoading}
              page={page}
              totalPages={expensesData?.total_pages || 1}
              totalCount={expensesData?.total || 0}
              onPageChange={setPage}
              onToggleStatus={handleToggleStatus}
              onEditExpense={(item) => {
                setEditingExpense(item);
                setIsFormOpen(true);
              }}
              onDeleteExpense={(id) => deleteMutation.mutate(id)}
            />
          </>
        )}

        {activeTab === "config" && (
          <ConfigTab
            config={configData || null}
            onRefreshConfig={() => refetchConfig()}
          />
        )}
      </main>

      {/* Expense Form Drawer / Modal */}
      <ExpenseFormDrawer
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        categories={categories}
        initialData={editingExpense}
        isSubmitting={saveMutation.isPending}
      />

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportSuccess={() => {
          refetchExpenses();
          refetchReport();
        }}
      />

      {/* Telegram PIN Login Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        onSuccess={() => {
          setIsLoginOpen(false);
          refetchAuth();
          refetchReport();
          refetchExpenses();
        }}
      />
    </div>
  );
}
export default App;
