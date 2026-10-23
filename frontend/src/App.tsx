import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, createExpenseBatch, getExpenseUsers } from "@/lib/api";
import { Expense, MonthlyReport, SystemConfig, ExpenseFormData, ExpenseUser, SuggestionsResponse } from "@/types";
import { StatCards } from "@/components/dashboard/StatCards";
import { AiAnalysisCard } from "@/components/dashboard/AiAnalysisCard";
import { CategoryDonutChart } from "@/components/dashboard/CategoryDonutChart";
import { PaymentMethodChart } from "@/components/dashboard/PaymentMethodChart";
import { UnpaidOrdersCard } from "@/components/dashboard/UnpaidOrdersCard";
import { DailyTrendChart } from "@/components/dashboard/DailyTrendChart";
import { LeaderboardCards } from "@/components/dashboard/LeaderboardCards";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { ExpenseTable } from "@/components/dashboard/ExpenseTable";
import { ExpenseDetailModal } from "@/components/dashboard/ExpenseDetailModal";
import { PriceHistoryModal } from "@/components/dashboard/PriceHistoryModal";
import { ExpenseFormDrawer } from "@/components/forms/ExpenseFormDrawer";
import { CsvImportModal } from "@/components/import/CsvImportModal";
import { ConfigTab } from "@/components/config/ConfigTab";
import { MasterItemsTab } from "@/components/master/MasterItemsTab";
import { LoginModal } from "@/components/auth/LoginModal";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard-01/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard-01/dashboard-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import confetti from "canvas-confetti";
import { formatRupiah } from "@/lib/formatters";
import { Plus } from "lucide-react";

export function App() {
  const queryClient = useQueryClient();

  // Active Tab: "overview" | "master" | "config"
  const [activeTab, setActiveTab] = useState<"overview" | "master" | "config">("overview");

  // Filter states
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [isReimbursement, setIsReimbursement] = useState<boolean | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [page, setPage] = useState<number>(1);

  // Modal & Drawer states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  const [repeatingExpense, setRepeatingExpense] = useState<Expense | null>(null);
  const [inspectedItemName, setInspectedItemName] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  // Theme state with localStorage persistence
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved) return saved === "dark";
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });

  const handleToggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      }
      return next;
    });
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

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

  // Perizinan & Peran Pengguna (Admin Input vs Owner/Admin Utama)
  const userRole = authData?.role || (authData?.authenticated ? "admin" : null);
  const canDelete = authData?.permissions?.can_delete ?? (userRole === "admin");
  const canViewCharts = authData?.permissions?.can_view_charts ?? (userRole === "admin");
  const canManageConfig = authData?.permissions?.can_manage_config ?? (userRole === "admin");

  // Jika admin_input mencoba membuka tab konfigurasi sistem, kembalikan ke overview
  useEffect(() => {
    if (userRole === "admin_input" && activeTab === "config") {
      setActiveTab("overview");
    }
  }, [userRole, activeTab]);

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
    queryKey: ["expenses", page, month, year, category, search, status, isReimbursement, selectedUserId],
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
      if (isReimbursement !== null) params.append("is_reimbursement", String(isReimbursement));
      if (selectedUserId !== null) params.append("user_id", String(selectedUserId));

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
    enabled: !!authData?.authenticated,
  });

  // 3b. Expense Users Query
  const { data: usersData = [] } = useQuery<ExpenseUser[]>({
    queryKey: ["expense-users"],
    queryFn: async () => getExpenseUsers(),
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

  // 5. Autocomplete Suggestions (Master Items + Historical Items & Suppliers)
  const { data: suggestionsData } = useQuery<SuggestionsResponse>({
    queryKey: ["suggestions"],
    queryFn: async () => {
      const res = await api.get("/master-items/suggestions");
      return res.data;
    },
    enabled: !!authData?.authenticated,
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
          ? "Data pengeluaran berhasil diperbarui"
          : "Catatan pengeluaran berhasil ditambahkan"
      );
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan pengeluaran");
    },
  });

  // Mutasi: Batch Create Expenses (dari Scan Nota OCR)
  const batchSaveMutation = useMutation({
    mutationFn: async (items: ExpenseFormData[]) => {
      return await createExpenseBatch(items);
    },
    onSuccess: (saved) => {
      toast.success(`${saved.length} catatan pengeluaran berhasil disimpan`);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal menyimpan pengeluaran batch");
    },
  });

  // Mutasi: Toggle Pay Status (Optimistic Update)
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
        toast.success(`Transaksi #${updated.id} ditandai Lunas`);
        confetti({
          particleCount: 30,
          spread: 45,
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
      if (!canDelete) {
        throw new Error("Admin Input tidak memiliki izin menghapus transaksi. Hubungi Owner.");
      }
      return (await api.delete(`/expenses/${id}`)).data;
    },
    onSuccess: () => {
      toast.success("Pengeluaran berhasil dihapus");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || err.message || "Gagal menghapus pengeluaran");
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
      toast.success("Anda telah keluar akun");
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
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {/* Toast provider */}
        <Toaster position="top-right" richColors />

        {/* Dashboard Sidebar */}
        <DashboardSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenImport={() => setIsImportOpen(true)}
          userRole={userRole}
          canManageConfig={canManageConfig}
          monthlyBudgetLimit={reportData?.monthly_budget_limit}
          budgetUsedPct={reportData?.budget_used_pct}
          totalPengeluaran={reportData?.total_pengeluaran}
          expenseCount={reportData?.expense_count}
          unpaidCount={reportData?.list_hutang?.length}
          username={authData?.username}
          onLogout={handleLogout}
          isDarkMode={isDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
        />

        {/* Main Inset Area */}
        <SidebarInset className="flex flex-1 flex-col min-w-0 overflow-x-hidden bg-slate-50/60 dark:bg-slate-950">
          {/* Dashboard Header */}
          <DashboardHeader
            activeTab={activeTab}
            month={month}
            year={year}
            onMonthChange={(m) => {
              setMonth(m);
              setPage(1);
            }}
            onYearChange={(y) => {
              setYear(y);
              setPage(1);
            }}
            onOpenAddExpense={() => {
              setEditingExpense(null);
              setRepeatingExpense(null);
              setIsFormOpen(true);
            }}
            userRole={userRole}
            unpaidCount={reportData?.list_hutang?.length || 0}
            unpaidTotal={totalUnpaidNominal}
            reimburseCount={reportData?.reimburse_pending_count || 0}
            onFilterUnpaid={() => {
              setActiveTab("overview");
              setStatus("Belum Lunas");
              setPage(1);
            }}
            onFilterReimburse={() => {
              setActiveTab("overview");
              setIsReimbursement(true);
              setPage(1);
            }}
            isDarkMode={isDarkMode}
            onToggleDarkMode={handleToggleDarkMode}
            onLogout={handleLogout}
          />

          {/* Main Content Area */}
          <main className="w-full max-w-[1920px] mx-auto px-4 md:px-8 py-6 space-y-6">
            {activeTab === "overview" && (
              <>
                {/* Tampilan Header & Statistik Sesuai Role Pengguna */}
                {canViewCharts ? (
                  <>
                    {/* Stat Cards Lengkap untuk Owner */}
                    <StatCards
                      totalLunas={reportData?.total_lunas || 0}
                      totalPengeluaran={reportData?.total_pengeluaran || 0}
                      expenseCount={reportData?.expense_count || 0}
                      unpaidCount={reportData?.list_hutang?.length || 0}
                      unpaidTotal={totalUnpaidNominal}
                      categoryCount={Object.keys(reportData?.per_kategori || {}).length}
                      monthName={reportData?.month_name || "Bulan Ini"}
                      year={year}
                      prevMonthName={reportData?.prev_month_name}
                      prevTotalLunas={reportData?.prev_total_lunas}
                      prevTotalPengeluaran={reportData?.prev_total_pengeluaran}
                      momLunasChangePct={reportData?.mom_lunas_change_pct}
                      momTotalChangePct={reportData?.mom_total_change_pct}
                      monthlyBudgetLimit={reportData?.monthly_budget_limit}
                      budgetUsedPct={reportData?.budget_used_pct}
                      categoryBudgets={reportData?.category_budgets}
                      perKategori={reportData?.per_kategori}
                      reimbursePendingCount={reportData?.reimburse_pending_count || 0}
                      reimbursePendingTotal={reportData?.reimburse_pending_total || 0}
                      onFilterUnpaid={() => setStatus("Belum Lunas")}
                      onFilterReimburse={() => {
                        setIsReimbursement(true);
                        setPage(1);
                      }}
                      onOpenBudgetSettings={() => setActiveTab("config")}
                    />

                    {/* AI Financial Analysis & Strategic Advisor Card */}
                    <AiAnalysisCard
                      month={month}
                      year={year}
                      monthName={reportData?.month_name || "Bulan Ini"}
                    />

                    {/* Charts & Analytics Row 1: Category & Payment Methods */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      <div className="lg:col-span-6">
                        <CategoryDonutChart
                          categoryData={reportData?.per_kategori || {}}
                          totalAmount={reportData?.total_lunas || 0}
                        />
                      </div>
                      <div className="lg:col-span-6">
                        <PaymentMethodChart
                          paymentData={reportData?.per_metode_bayar || {}}
                          totalAmount={reportData?.total_pengeluaran || 0}
                        />
                      </div>
                    </div>

                    {/* Charts & Analytics Row 2: Daily Trend & Unpaid Orders */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      <div className="lg:col-span-7">
                        <DailyTrendChart data={reportData?.daily_chart || []} />
                      </div>
                      <div className="lg:col-span-5">
                        <UnpaidOrdersCard
                          unpaidList={reportData?.list_hutang || []}
                          onMarkPaid={(id) => toggleStatusMutation.mutate({ id, newStatus: "Lunas" })}
                          onViewAll={() => setStatus("Belum Lunas")}
                        />
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
                  </>
                ) : (
                  /* Tampilan Ringkas & Cepat Khusus Admin Input */
                  <div className="space-y-4">
                    {/* Banner Status Admin Input */}
                    <div className="bg-amber-500/10 border border-amber-200/90 dark:border-amber-800/80 rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
                      <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xl shrink-0">
                          ✍️
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm md:text-base font-bold text-slate-900 dark:text-slate-100">
                              Workspace Admin Input Historycake
                            </h2>
                            <Badge variant="outline" className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                              Input & Koreksi
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                            Pencatatan pengeluaran harian dan koreksi transaksi operasional.
                          </p>
                        </div>
                      </div>
                      <Button
                        onClick={() => {
                          setEditingExpense(null);
                          setRepeatingExpense(null);
                          setIsFormOpen(true);
                        }}
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs gap-1.5 text-xs font-semibold h-10 px-4 shrink-0 w-full md:w-auto"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Catat Pengeluaran Baru</span>
                      </Button>
                    </div>

                    {/* Ringkasan Angka Utama */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Total Transaksi ({reportData?.month_name || "Bulan Ini"})
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                          {reportData?.expense_count || 0}
                          <span className="text-xs font-normal text-slate-400 ml-1.5">transaksi</span>
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Pengeluaran Tercatat</div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                          {formatRupiah(reportData?.total_pengeluaran || 0)}
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Tagihan Belum Lunas</div>
                        <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 tabular-nums">
                          {reportData?.list_hutang?.length || 0}
                          <span className="text-xs font-normal text-slate-400 ml-1.5">
                            ({formatRupiah(totalUnpaidNominal)})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Filter Bar */}
                <FilterBar
                  month={month}
                  year={year}
                  selectedCategory={category}
                  search={search}
                  status={status}
                  isReimbursement={isReimbursement}
                  users={usersData}
                  selectedUserId={selectedUserId}
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
                  onReimbursementChange={(val) => {
                    setIsReimbursement(val);
                    setPage(1);
                  }}
                  onUserChange={(uid) => {
                    setSelectedUserId(uid);
                    setPage(1);
                  }}
                  onReset={() => {
                    setCategory("");
                    setSearch("");
                    setStatus("");
                    setIsReimbursement(null);
                    setSelectedUserId(null);
                    setPage(1);
                  }}
                  onOpenAddExpense={() => {
                    setEditingExpense(null);
                    setRepeatingExpense(null);
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
                    setRepeatingExpense(null);
                    setEditingExpense(item);
                    setIsFormOpen(true);
                  }}
                  onRepeatExpense={(item) => {
                    setEditingExpense(null);
                    setRepeatingExpense(item);
                    setIsFormOpen(true);
                  }}
                  onInspectItemPrice={(name) => setInspectedItemName(name)}
                  onDeleteExpense={(id) => deleteMutation.mutate(id)}
                  onViewExpense={(item) => setViewingExpense(item)}
                  canDelete={canDelete}
                />
              </>
            )}

            {activeTab === "master" && (
              <MasterItemsTab
                categories={categories}
                onInspectItemPrice={(name) => setInspectedItemName(name)}
              />
            )}

            {activeTab === "config" && canManageConfig && (
              <ConfigTab
                config={configData || null}
                onRefreshConfig={() => {
                  refetchConfig();
                  refetchReport();
                }}
              />
            )}
          </main>
        </SidebarInset>

        {/* Expense Form Drawer / Modal */}
        <ExpenseFormDrawer
          isOpen={isFormOpen}
          onClose={() => {
            setIsFormOpen(false);
            setRepeatingExpense(null);
          }}
          onSubmit={handleFormSubmit}
          onBatchSubmit={(items) => batchSaveMutation.mutate(items)}
          categories={categories}
          initialData={editingExpense}
          repeatData={repeatingExpense}
          isSubmitting={saveMutation.isPending || batchSaveMutation.isPending}
          itemSuggestions={suggestionsData?.items || []}
          supplierSuggestions={suggestionsData?.suppliers || []}
        />

        {/* Expense Detail Modal with Telegram Cross-Check */}
        <ExpenseDetailModal
          isOpen={!!viewingExpense}
          onClose={() => setViewingExpense(null)}
          expense={viewingExpense}
          onEditExpense={(expense) => {
            setViewingExpense(null);
            setRepeatingExpense(null);
            setEditingExpense(expense);
            setIsFormOpen(true);
          }}
          onInspectItemPrice={(name) => {
            setViewingExpense(null);
            setInspectedItemName(name);
          }}
        />

        {/* Price History & Supplier Comparison Modal */}
        <PriceHistoryModal
          itemName={inspectedItemName}
          onClose={() => setInspectedItemName(null)}
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
    </SidebarProvider>
  );
}

export default App;
