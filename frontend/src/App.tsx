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
import { BudgetSetupDialog } from "@/components/dashboard/BudgetSetupDialog";
import { ExpenseActivityLogModal } from "@/components/dashboard/ExpenseActivityLogModal";
import { AuditDuplicatesModal } from "@/components/dashboard/AuditDuplicatesModal";
import { DataHygieneModal } from "@/components/dashboard/DataHygieneModal";
import { ExpenseFormDrawer } from "@/components/forms/ExpenseFormDrawer";
import { CsvImportModal } from "@/components/import/CsvImportModal";
import { ConfigTab } from "@/components/config/ConfigTab";
import { MasterItemsTab } from "@/components/master/MasterItemsTab";
import { TukarCashOngkirTab } from "@/components/cash-delivery/TukarCashOngkirTab";
import { TalanganTab } from "@/components/talangan/TalanganTab";
import { UnpaidTab } from "@/components/unpaid/UnpaidTab";
import { SuppliersTab } from "@/components/supplier/SuppliersTab";
import { SupplierDetailPage } from "@/components/supplier/SupplierDetailPage";
import { LoginModal } from "@/components/auth/LoginModal";
import { useLocation, useNavigate } from "react-router-dom";
import { OwnerMobileView } from "@/components/dashboard/OwnerMobileView";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard-01/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard-01/dashboard-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import confetti from "canvas-confetti";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { Plus, ReceiptText, ArrowRight } from "lucide-react";

// Tangani SSO token dari URL (dikirim oleh HCTeams Hub) secara langsung sebelum render
try {
  const initParams = new URLSearchParams(window.location.search);
  const initUrlToken = initParams.get("token");
  if (initUrlToken) {
    localStorage.setItem("hcteams_token", initUrlToken);
    localStorage.setItem("dashboard_session_token", initUrlToken);
    initParams.delete("token");
    const initNewQuery = initParams.toString() ? `?${initParams.toString()}` : "";
    window.history.replaceState({}, "", `${window.location.pathname}${initNewQuery}`);
  }
} catch {
  // Abaikan saat SSR atau testing environment
}

export function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  // Parse path to activeTab & selectedSupplierId
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const supplierMatch = pathname.match(/^\/suppliers\/(\d+)$/);
  const selectedSupplierId = supplierMatch ? parseInt(supplierMatch[1], 10) : null;

  let activeTab: "overview" | "transactions" | "master" | "suppliers" | "supplier-detail" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "config" = "overview";
  if (selectedSupplierId) {
    activeTab = "supplier-detail";
  } else if (pathname === "/suppliers") {
    activeTab = "suppliers";
  } else if (pathname === "/master") {
    activeTab = "master";
  } else if (pathname === "/transactions" || pathname === "/transaksi") {
    activeTab = "transactions";
  } else if (pathname === "/tukar-cash-ongkir") {
    activeTab = "tukar-cash-ongkir";
  } else if (pathname === "/talangan" || pathname === "/reimburse") {
    activeTab = "talangan";
  } else if (pathname === "/unpaid" || pathname === "/belum-lunas" || pathname === "/hutang") {
    activeTab = "unpaid";
  } else if (pathname === "/config") {
    activeTab = "config";
  } else {
    activeTab = "overview";
  }

  const handleTabChange = (tab: "overview" | "transactions" | "master" | "suppliers" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "config") => {
    if (tab === "overview") {
      navigate("/");
    } else {
      navigate("/" + tab);
    }
  };

  const [cashDeliverySubtype, setCashDeliverySubtype] = useState<"all" | "tukar_cash" | "ongkir">("all");

  // Filter states
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("");
  const [isReimbursement, setIsReimbursement] = useState<boolean | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [page, setPage] = useState<number>(1);

  // Modal & Drawer states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  const [repeatingExpense, setRepeatingExpense] = useState<Expense | null>(null);
  const [inspectedItemName, setInspectedItemName] = useState<string | null>(null);
  const [inspectedItemId, setInspectedItemId] = useState<number | null>(null);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState<number | null>(null);

  // Bersihkan highlight ID secara otomatis setelah beberapa detik
  useEffect(() => {
    if (highlightedExpenseId) {
      const timer = setTimeout(() => {
        setHighlightedExpenseId(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [highlightedExpenseId]);

  const handleInspectItemPrice = (name: string, id?: number | null) => {
    setInspectedItemName(name);
    setInspectedItemId(id || null);
  };
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isBudgetDialogOpen, setIsBudgetDialogOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isDataHygieneModalOpen, setIsDataHygieneModalOpen] = useState(false);

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

  // Tangani SSO token dari URL (dikirim oleh HCTeams Hub)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("hcteams_token", urlToken);
      localStorage.setItem("dashboard_session_token", urlToken);
      params.delete("token");
      const newQuery = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState({}, "", `${window.location.pathname}${newQuery}`);
      queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    }
  }, [queryClient]);

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
    if (authData) {
      if (authData.authenticated) {
        setIsLoginOpen(false);
      } else {
        localStorage.removeItem("hcteams_token");
        localStorage.removeItem("dashboard_session_token");
        setIsLoginOpen(true);
      }
    }
  }, [authData]);

  // Perizinan & Peran Pengguna (Admin Input vs Owner/Admin Utama)
  // Default adalah Owner (admin) kecuali jika akun secara spesifik memiliki role 'admin_input'
  const isExplicitAdminInput = authData?.role === "admin_input";
  const userRole = isExplicitAdminInput ? "admin_input" : (authData?.role || "admin");
  const canDelete = authData?.permissions?.can_delete ?? (!isExplicitAdminInput);
  const canViewCharts = authData?.permissions?.can_view_charts ?? (!isExplicitAdminInput);
  const canManageConfig = authData?.permissions?.can_manage_config ?? (!isExplicitAdminInput);

  // Jika admin_input mencoba membuka tab konfigurasi sistem, kembalikan ke overview
  useEffect(() => {
    if (userRole === "admin_input" && activeTab === "config") {
      navigate("/");
    }
  }, [userRole, activeTab, navigate]);

  // Listen for 401 unauthorized event
  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem("hcteams_token");
      localStorage.removeItem("dashboard_session_token");
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
    queryKey: ["expenses", page, month, year, category, search, status, payMethod, isReimbursement, selectedUserId],
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
      if (payMethod) params.append("pay_method", payMethod);
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
    enabled: !!authData?.authenticated && canManageConfig,
    staleTime: 5 * 60 * 1000,
  });

  // 4b. Master Data Units Query (tersedia untuk semua role terautentikasi)
  const { data: masterUnitsData } = useQuery<string[]>({
    queryKey: ["master-units"],
    queryFn: async () => {
      const res = await api.get("/config/master-data?type=satuan&active_only=true");
      return (res.data?.items || []).map((it: any) => it.name);
    },
    enabled: !!authData?.authenticated,
    staleTime: 5 * 60 * 1000,
  });

  const activeUnits = (masterUnitsData && masterUnitsData.length > 0)
    ? masterUnitsData
    : (reportData?.valid_units && reportData.valid_units.length > 0)
    ? reportData.valid_units
    : (configData?.units && configData.units.length > 0)
    ? configData.units
    : [
        "Pcs", "Box", "Bungkus", "Pack", "Pouch", "Kg", "Gram", "Dus",
        "Kaleng", "Sak", "Bal", "Botol", "Tray", "Liter", "Roll", "Lembar",
        "Meter", "Ikat", "Butir", "Trans", "Trip"
      ];

  // 4c. Master Data Payment Methods Query (tersedia untuk semua role terautentikasi)
  const { data: masterPayMethodsData } = useQuery<string[]>({
    queryKey: ["master-pay-methods"],
    queryFn: async () => {
      const res = await api.get("/config/master-data?type=metode_bayar&active_only=true");
      return (res.data?.items || []).map((it: any) => it.name);
    },
    enabled: !!authData?.authenticated,
    staleTime: 5 * 60 * 1000,
  });

  const activePayMethods = (masterPayMethodsData && masterPayMethodsData.length > 0)
    ? masterPayMethodsData
    : (configData?.payment_methods && configData.payment_methods.length > 0)
    ? configData.payment_methods
    : ["Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"];

  // 4d. Master Data Categories Query (tersedia untuk semua role terautentikasi)
  const { data: masterCategoriesData } = useQuery<string[]>({
    queryKey: ["master-categories"],
    queryFn: async () => {
      const res = await api.get("/config/master-data?type=kategori&active_only=true");
      return (res.data?.items || []).map((it: any) => it.name);
    },
    enabled: !!authData?.authenticated,
    staleTime: 5 * 60 * 1000,
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
    localStorage.removeItem("hcteams_token");
    localStorage.removeItem("dashboard_session_token");
    try {
      await api.post("/auth/logout");
      toast.success("Anda telah keluar akun");
      refetchAuth();
      setIsLoginOpen(true);
    } catch {
      window.location.reload();
    }
  };

  const categories = (masterCategoriesData && masterCategoriesData.length > 0)
    ? masterCategoriesData
    : (reportData?.valid_categories && reportData.valid_categories.length > 0)
    ? reportData.valid_categories
    : [
        "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor",
        "Kemasan", "Operasional", "Topper & Mainan", "Renovasi",
        "Asset", "Iuran", "Tukar Cash", "Ongkir"
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
          onTabChange={handleTabChange}
          onOpenImport={() => setIsImportOpen(true)}
          onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
          userRole={userRole}
          canManageConfig={canManageConfig}
          monthlyBudgetLimit={reportData?.monthly_budget_limit}
          budgetUsedPct={reportData?.budget_used_pct}
          totalPengeluaran={reportData?.total_pengeluaran}
          expenseCount={reportData?.expense_count}
          unpaidCount={reportData?.list_hutang?.length}
          reimbursePendingCount={reportData?.reimburse_pending_count || 0}
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
              navigate("/unpaid");
            }}
            onFilterReimburse={() => {
              navigate("/talangan");
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
                    {/* 1. Tampilan Khusus Mobile Owner (Simple, Ergonomis & Cepat) */}
                    <div className="block md:hidden">
                      <OwnerMobileView
                        activeTab="overview"
                        onNavigateTab={(t) => handleTabChange(t)}
                        reportData={reportData}
                        expenses={expensesData?.data || []}
                        isExpensesLoading={isExpensesLoading}
                        page={page}
                        totalPages={expensesData?.total_pages || 1}
                        totalCount={expensesData?.total || 0}
                        onPageChange={setPage}
                        onToggleStatus={handleToggleStatus}
                        onMarkPaidById={(id) => toggleStatusMutation.mutate({ id, newStatus: "Lunas" })}
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
                        onInspectItemPrice={handleInspectItemPrice}
                        onDeleteExpense={(id) => deleteMutation.mutate(id)}
                        onViewExpense={(item) => setViewingExpense(item)}
                        canDelete={canDelete}
                        month={month}
                        year={year}
                        category={category}
                        search={search}
                        status={status}
                        payMethod={payMethod}
                        payMethods={activePayMethods}
                        isReimbursement={isReimbursement}
                        users={usersData}
                        selectedUserId={selectedUserId}
                        categories={categories}
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
                        onPayMethodChange={(pm) => {
                          setPayMethod(pm);
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
                        onResetFilters={() => {
                          setCategory("");
                          setSearch("");
                          setStatus("");
                          setPayMethod("");
                          setIsReimbursement(null);
                          setSelectedUserId(null);
                          setPage(1);
                        }}
                        onOpenAddExpense={() => {
                          setEditingExpense(null);
                          setRepeatingExpense(null);
                          setIsFormOpen(true);
                        }}
                        onOpenBudgetSettings={() => setIsBudgetDialogOpen(true)}
                        onOpenTukarCashOngkir={(subType) => {
                          setCashDeliverySubtype(subType || "all");
                          navigate("/tukar-cash-ongkir");
                        }}
                      />
                    </div>

                    {/* 2. Tampilan Desktop (md: ke atas) Tetap Lengkap & Kaya Data */}
                    <div className="hidden md:block space-y-6">
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
                        categoryBudgetPercentages={reportData?.category_budget_percentages}
                        isCustomBudget={reportData?.is_custom_budget}
                        perKategori={reportData?.per_kategori}
                        reimbursePendingCount={reportData?.reimburse_pending_count || 0}
                        reimbursePendingTotal={reportData?.reimburse_pending_total || 0}
                        totalTukarCash={reportData?.total_tukar_cash || 0}
                        tukarCashCount={reportData?.tukar_cash_count || 0}
                        totalOngkir={reportData?.total_ongkir || 0}
                        ongkirCount={reportData?.ongkir_count || 0}
                        ongkirReimburseCount={reportData?.ongkir_reimburse_count || 0}
                        ongkirReimburseTotal={reportData?.ongkir_reimburse_total || 0}
                        onFilterUnpaid={() => {
                          navigate("/unpaid");
                        }}
                        onFilterReimburse={() => {
                          navigate("/talangan");
                        }}
                        onOpenBudgetSettings={() => setIsBudgetDialogOpen(true)}
                        onOpenTukarCashOngkir={(subType) => {
                          setCashDeliverySubtype(subType || "all");
                          navigate("/tukar-cash-ongkir");
                        }}
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
                            onViewAll={() => {
                              navigate("/unpaid");
                            }}
                          />
                        </div>
                      </div>

                      {/* Banner Akses Halaman Baru Daftar Transaksi & Peringkat Belanja */}
                      <div className="bg-gradient-to-r from-blue-50/80 via-white to-slate-50 dark:from-slate-900/90 dark:via-slate-900/60 dark:to-slate-900 border border-blue-200/80 dark:border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
                        <div className="flex items-center gap-3.5">
                          <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <ReceiptText className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              Daftar Transaksi & Peringkat Belanja
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              Lihat rincian transaksi belanja, filter pengeluaran, serta peringkat item sering dibeli dan lonjakan harga.
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => navigate("/transactions")}
                          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold h-10 px-5 gap-2 shrink-0 shadow-xs"
                        >
                          <span>Buka Halaman Transaksi</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
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
                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs">
                        <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                          Total Transaksi
                        </div>
                        <div className="text-sm sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                          {reportData?.expense_count || 0}
                          <span className="hidden sm:inline text-xs font-normal text-slate-500 ml-1.5">item</span>
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs">
                        <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Total Belanja</div>
                        <div className="text-xs sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums truncate">
                          {formatRupiah(reportData?.total_pengeluaran || 0)}
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs">
                        <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Belum Lunas</div>
                        <div className="text-xs sm:text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 tabular-nums truncate">
                          {reportData?.list_hutang?.length || 0}
                          <span className="hidden sm:inline text-xs font-normal text-slate-500 ml-1.5">
                            ({formatRupiah(totalUnpaidNominal)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Admin Input Filter Bar */}
                    <FilterBar
                      month={month}
                      year={year}
                      selectedCategory={category}
                      search={search}
                      status={status}
                      payMethod={payMethod}
                      payMethods={activePayMethods}
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
                      onPayMethodChange={(pm) => {
                        setPayMethod(pm);
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
                        setPayMethod("");
                        setIsReimbursement(null);
                        setSelectedUserId(null);
                        setPage(1);
                      }}
                      onOpenAddExpense={() => {
                        setEditingExpense(null);
                        setRepeatingExpense(null);
                        setIsFormOpen(true);
                      }}
                      onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                    />

                    {/* Admin Input Expense Table */}
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
                      onInspectItemPrice={handleInspectItemPrice}
                      onDeleteExpense={(id) => deleteMutation.mutate(id)}
                      onViewExpense={(item) => setViewingExpense(item)}
                      onOpenActivityLog={() => setIsActivityLogOpen(true)}
                      onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                      onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                      canDelete={canDelete}
                      highlightedExpenseId={highlightedExpenseId}
                    />
                  </div>
                )}
              </>
            )}

            {activeTab === "transactions" && (
              <>
                {canViewCharts ? (
                  <>
                    {/* 1. Tampilan Khusus Mobile Owner untuk Halaman Transaksi */}
                    <div className="block md:hidden">
                      <OwnerMobileView
                        activeTab="transactions"
                        onNavigateTab={(t) => handleTabChange(t)}
                        reportData={reportData}
                        expenses={expensesData?.data || []}
                        isExpensesLoading={isExpensesLoading}
                        page={page}
                        totalPages={expensesData?.total_pages || 1}
                        totalCount={expensesData?.total || 0}
                        onPageChange={setPage}
                        onToggleStatus={handleToggleStatus}
                        onMarkPaidById={(id) => toggleStatusMutation.mutate({ id, newStatus: "Lunas" })}
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
                        onInspectItemPrice={handleInspectItemPrice}
                        onDeleteExpense={(id) => deleteMutation.mutate(id)}
                        onViewExpense={(item) => setViewingExpense(item)}
                        canDelete={canDelete}
                        highlightedExpenseId={highlightedExpenseId}
                        month={month}
                        year={year}
                        category={category}
                        search={search}
                        status={status}
                        payMethod={payMethod}
                        payMethods={activePayMethods}
                        isReimbursement={isReimbursement}
                        users={usersData}
                        selectedUserId={selectedUserId}
                        categories={categories}
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
                        onPayMethodChange={(pm) => {
                          setPayMethod(pm);
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
                        onResetFilters={() => {
                          setCategory("");
                          setSearch("");
                          setStatus("");
                          setPayMethod("");
                          setIsReimbursement(null);
                          setSelectedUserId(null);
                          setPage(1);
                        }}
                        onOpenAddExpense={() => {
                          setEditingExpense(null);
                          setRepeatingExpense(null);
                          setIsFormOpen(true);
                        }}
                        onOpenBudgetSettings={() => setIsBudgetDialogOpen(true)}
                        onOpenTukarCashOngkir={(subType) => {
                          setCashDeliverySubtype(subType || "all");
                          navigate("/tukar-cash-ongkir");
                        }}
                      />
                    </div>

                    {/* 2. Tampilan Desktop Halaman Daftar Transaksi */}
                    <div className="hidden md:block space-y-6">
                      {/* Header Halaman Transaksi */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
                        <div className="flex items-center gap-3.5">
                          <div className="w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <ReceiptText className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                                Daftar Transaksi & Peringkat Belanja
                              </h2>
                              <Badge variant="outline" className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40">
                                {expensesData?.total || 0} Total Transaksi
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              Rincian nota transaksi operasional periode {reportData?.month_name || "Bulan Ini"} {year} dan analitika leaderboard belanja
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => {
                            setEditingExpense(null);
                            setRepeatingExpense(null);
                            setIsFormOpen(true);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs gap-1.5 text-xs font-semibold h-10 px-4 shrink-0"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Catat Pengeluaran Baru</span>
                        </Button>
                      </div>

                      {/* Leaderboard & Top Stats Section (Top Sering Dibeli, Top Item Termahal, Top Naik Drastis, Top Toko & Mitra, Rata-rata / Hari, Rata-rata / Transaksi, Ragam Item Unik, Transaksi Terbesar) */}
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

                      {/* Desktop Filter Bar */}
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
                        onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                      />

                      {/* Desktop Expense Data Table */}
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
                        onInspectItemPrice={handleInspectItemPrice}
                        onDeleteExpense={(id) => deleteMutation.mutate(id)}
                        onViewExpense={(item) => setViewingExpense(item)}
                        onOpenActivityLog={() => setIsActivityLogOpen(true)}
                        onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                        canDelete={canDelete}
                        highlightedExpenseId={highlightedExpenseId}
                      />
                    </div>
                  </>
                ) : (
                  /* Admin Input View pada Halaman Transaksi */
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
                              Daftar Transaksi (Admin Input)
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
                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs">
                        <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                          Total Transaksi
                        </div>
                        <div className="text-sm sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                          {reportData?.expense_count || 0}
                          <span className="hidden sm:inline text-xs font-normal text-slate-500 ml-1.5">item</span>
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs">
                        <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Total Belanja</div>
                        <div className="text-xs sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums truncate">
                          {formatRupiah(reportData?.total_pengeluaran || 0)}
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs">
                        <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Belum Lunas</div>
                        <div className="text-xs sm:text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 tabular-nums truncate">
                          {reportData?.list_hutang?.length || 0}
                          <span className="hidden sm:inline text-xs font-normal text-slate-500 ml-1.5">
                            ({formatRupiah(totalUnpaidNominal)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Admin Input Filter Bar */}
                    <FilterBar
                      month={month}
                      year={year}
                      selectedCategory={category}
                      search={search}
                      status={status}
                      payMethod={payMethod}
                      payMethods={activePayMethods}
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
                      onPayMethodChange={(pm) => {
                        setPayMethod(pm);
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
                        setPayMethod("");
                        setIsReimbursement(null);
                        setSelectedUserId(null);
                        setPage(1);
                      }}
                      onOpenAddExpense={() => {
                        setEditingExpense(null);
                        setRepeatingExpense(null);
                        setIsFormOpen(true);
                      }}
                      onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                    />

                    {/* Admin Input Expense Table */}
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
                      onInspectItemPrice={handleInspectItemPrice}
                      onDeleteExpense={(id) => deleteMutation.mutate(id)}
                      onViewExpense={(item) => setViewingExpense(item)}
                      onOpenActivityLog={() => setIsActivityLogOpen(true)}
                      onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                      onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                      canDelete={canDelete}
                      highlightedExpenseId={highlightedExpenseId}
                    />
                  </div>
                )}
              </>
            )}

            {activeTab === "master" && (
              <MasterItemsTab
                categories={categories}
                units={activeUnits}
                onInspectItemPrice={handleInspectItemPrice}
              />
            )}

            {activeTab === "suppliers" && (
              <SuppliersTab
                onSelectSupplier={(id) => navigate(`/suppliers/${id}`)}
                canDelete={canDelete}
              />
            )}

            {activeTab === "supplier-detail" && selectedSupplierId && (
              <SupplierDetailPage
                supplierId={selectedSupplierId}
                onBack={() => navigate("/suppliers")}
                canDelete={canDelete}
                categories={categories}
                paymentMethods={configData?.payment_methods}
                units={activeUnits}
              />
            )}

            {activeTab === "tukar-cash-ongkir" && (
              <TukarCashOngkirTab
                currentMonth={month}
                currentYear={year}
                reportData={reportData}
                initialType={cashDeliverySubtype}
                onEditExpense={(item) => {
                  setRepeatingExpense(null);
                  setEditingExpense(item);
                  setIsFormOpen(true);
                }}
                onViewExpense={(item) => setViewingExpense(item)}
                onToggleStatus={handleToggleStatus}
                onDeleteExpense={(id) => deleteMutation.mutate(id)}
                onAddNewExpense={(type) => {
                  setEditingExpense(null);
                  setRepeatingExpense({
                    id: 0,
                    created_at: new Date().toISOString(),
                    expense_date: new Date().toISOString().split("T")[0],
                    category: type === "tukar_cash" ? "Tukar Cash" : "Ongkir",
                    item_name: type === "tukar_cash" ? "Tukar Cash - " : "ongkir delivery cake",
                    supplier: "-",
                    qty: 1,
                    unit: type === "tukar_cash" ? "Trans" : "Trip",
                    unit_price: 0,
                    shipping_fee: 0,
                    tax: 0,
                    other_fee: 0,
                    discount: 0,
                    total_price: 0,
                    pay_method: type === "tukar_cash" ? "Tunai" : "Gopay - Kasir",
                    pay_status: "Lunas",
                    due_date: "-",
                    notes: "-",
                    msg_link: "Web Dashboard",
                    is_reimbursement: false,
                    invoice_number: "-",
                  } as Expense);
                  setIsFormOpen(true);
                }}
                canDelete={canDelete}
              />
            )}

            {activeTab === "talangan" && (
              <TalanganTab
                currentMonth={month}
                currentYear={year}
                users={usersData}
                onEditExpense={(item) => {
                  setRepeatingExpense(null);
                  setEditingExpense(item);
                  setIsFormOpen(true);
                }}
                onViewExpense={(item) => setViewingExpense(item)}
                onDeleteExpense={(id) => deleteMutation.mutate(id)}
                onAddNewTalangan={() => {
                  setEditingExpense(null);
                  setRepeatingExpense({
                    id: 0,
                    created_at: new Date().toISOString(),
                    expense_date: new Date().toISOString().split("T")[0],
                    category: "Operasional",
                    item_name: "",
                    supplier: "-",
                    qty: 1,
                    unit: "Pcs",
                    unit_price: 0,
                    shipping_fee: 0,
                    tax: 0,
                    other_fee: 0,
                    discount: 0,
                    total_price: 0,
                    pay_method: "Tunai",
                    pay_status: "Lunas",
                    due_date: "-",
                    notes: "Ditalangi karyawan",
                    msg_link: "Web Dashboard",
                    is_reimbursement: true,
                    invoice_number: "-",
                  } as Expense);
                  setIsFormOpen(true);
                }}
                canDelete={canDelete}
              />
            )}

            {activeTab === "unpaid" && (
              <UnpaidTab
                currentMonth={month}
                currentYear={year}
                onEditExpense={(item) => {
                  setRepeatingExpense(null);
                  setEditingExpense(item);
                  setIsFormOpen(true);
                }}
                onViewExpense={(item) => setViewingExpense(item)}
                onDeleteExpense={(id) => deleteMutation.mutate(id)}
                onAddNewUnpaid={() => {
                  setEditingExpense(null);
                  const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
                  setRepeatingExpense({
                    id: 0,
                    created_at: new Date().toISOString(),
                    expense_date: new Date().toISOString().split("T")[0],
                    category: "Bahan Baku",
                    item_name: "",
                    supplier: "",
                    qty: 1,
                    unit: "Pcs",
                    unit_price: 0,
                    shipping_fee: 0,
                    tax: 0,
                    other_fee: 0,
                    discount: 0,
                    total_price: 0,
                    pay_method: "Tempo / Tagihan",
                    pay_status: "Belum Lunas",
                    due_date: in7Days,
                    notes: "-",
                    msg_link: "Web Dashboard",
                    is_reimbursement: false,
                    invoice_number: "-",
                  } as Expense);
                  setIsFormOpen(true);
                }}
                canDelete={canDelete}
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

        {/* Monthly Budget Setup Modal (Persentase per Kategori & Preview Rupiah) */}
        <BudgetSetupDialog
          isOpen={isBudgetDialogOpen}
          onClose={() => setIsBudgetDialogOpen(false)}
          initialYear={year}
          initialMonth={month}
          onBudgetUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ["monthly-report"] });
            queryClient.invalidateQueries({ queryKey: ["system-config"] });
          }}
          currentSpending={reportData?.per_kategori || {}}
        />

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
          paymentMethods={activePayMethods}
          units={activeUnits}
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
          onInspectItemPrice={(name, id) => {
            setViewingExpense(null);
            handleInspectItemPrice(name, id);
          }}
        />

        {/* Price History & Supplier Comparison Modal */}
        <PriceHistoryModal
          itemName={inspectedItemName}
          itemId={inspectedItemId}
          onClose={() => {
            setInspectedItemName(null);
            setInspectedItemId(null);
          }}
          onNavigateToExpense={(record) => {
            // 1. Tutup modal riwayat harga & modal detail jika sedang terbuka
            setInspectedItemName(null);
            setInspectedItemId(null);
            setViewingExpense(null);

            // 2. Sesuaikan filter bulan & tahun sesuai tanggal transaksi riwayat terpilih
            if (record.expense_date) {
              const parts = record.expense_date.split("-");
              if (parts.length >= 2) {
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!isNaN(y) && !isNaN(m)) {
                  setYear(y);
                  setMonth(m);
                }
              }
            }

            // 3. Reset filter yang berpotensi menyembunyikan transaksi
            setCategory("");
            setStatus("");
            setIsReimbursement(null);
            setSelectedUserId(null);

            // 4. Set kata kunci pencarian agar langsung menyaring ke barang tersebut
            setSearch(record.item_name);
            setPage(1);

            // 5. Tandai ID transaksi untuk highlight di tabel / list
            setHighlightedExpenseId(record.id);

            // 6. Alihkan navigasi ke Daftar Transaksi
            navigate("/transactions");

            toast.info(`Membuka transaksi: ${record.item_name}`, {
              description: `Menampilkan data tanggal ${formatDateId(record.expense_date)} pada Daftar Transaksi.`,
              duration: 3500,
            });
          }}
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

        {/* Expense Activity Log Modal (Log Aksi Perubahan Belanja) */}
        <ExpenseActivityLogModal
          isOpen={isActivityLogOpen}
          onClose={() => setIsActivityLogOpen(false)}
          onSelectExpense={(id) => {
            setIsActivityLogOpen(false);
          }}
          onExpenseRestored={() => {
            refetchExpenses();
            refetchReport();
          }}
        />

        {/* Data Hygiene & Normalizer Modal */}
        <DataHygieneModal
          isOpen={isDataHygieneModalOpen}
          onClose={() => setIsDataHygieneModalOpen(false)}
          canClean={canDelete}
        />

        {/* Audit Duplikat Modal (Nama Mirip >=90% + Tanggal Sama + Nominal Sama) */}
        <AuditDuplicatesModal
          isOpen={isAuditModalOpen}
          onClose={() => setIsAuditModalOpen(false)}
          currentMonth={month}
          currentYear={year}
          onDeleteExpense={(id) => deleteMutation.mutate(id)}
          canDelete={canDelete}
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
