import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  createExpenseBatch,
  exchangeSsoToken,
  getBankAccounts,
  getDraftWarningCount,
  getExpenseUsers,
  getGroupedExpenses,
  getPurchaseRequestStats,
  settleUnpaidExpenses,
} from "@/lib/api";
import {
  Expense,
  ExpenseInvoiceGroup,
  ExpenseInvoiceListResponse,
  MonthlyReport,
  SystemConfig,
  ExpenseFormData,
  ExpenseUser,
  SuggestionsResponse,
} from "@/types";
import { ExpenseViewMode } from "@/components/common/InvoiceGroupShared";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { getEffectiveSearchQuery } from "@/lib/searchHighlight";

// Lazy-loaded dashboard sections, tabs & heavy modals untuk optimasi chunk size & fast initial paint
const StatCards = React.lazy(() => import("@/components/dashboard/StatCards").then(m => ({ default: m.StatCards })));
const AiAnalysisCard = React.lazy(() => import("@/components/dashboard/AiAnalysisCard").then(m => ({ default: m.AiAnalysisCard })));
const CategoryDonutChart = React.lazy(() => import("@/components/dashboard/CategoryDonutChart").then(m => ({ default: m.CategoryDonutChart })));
const PaymentMethodChart = React.lazy(() => import("@/components/dashboard/PaymentMethodChart").then(m => ({ default: m.PaymentMethodChart })));
const UnpaidOrdersCard = React.lazy(() => import("@/components/dashboard/UnpaidOrdersCard").then(m => ({ default: m.UnpaidOrdersCard })));
const DailyTrendChart = React.lazy(() => import("@/components/dashboard/DailyTrendChart").then(m => ({ default: m.DailyTrendChart })));
const LeaderboardCards = React.lazy(() => import("@/components/dashboard/LeaderboardCards").then(m => ({ default: m.LeaderboardCards })));
const FilterBar = React.lazy(() => import("@/components/dashboard/FilterBar").then(m => ({ default: m.FilterBar })));
const ExpenseTable = React.lazy(() => import("@/components/dashboard/ExpenseTable").then(m => ({ default: m.ExpenseTable })));
const OwnerMobileView = React.lazy(() => import("@/components/dashboard/OwnerMobileView").then(m => ({ default: m.OwnerMobileView })));
const ExpenseDetailModal = React.lazy(() => import("@/components/dashboard/ExpenseDetailModal").then(m => ({ default: m.ExpenseDetailModal })));
const ConfirmPackagingModal = React.lazy(() => import("@/components/dashboard/ConfirmPackagingModal").then(m => ({ default: m.ConfirmPackagingModal })));
const PriceHistoryModal = React.lazy(() => import("@/components/dashboard/PriceHistoryModal").then(m => ({ default: m.PriceHistoryModal })));
const BudgetSetupDialog = React.lazy(() => import("@/components/dashboard/BudgetSetupDialog").then(m => ({ default: m.BudgetSetupDialog })));
const ExpenseActivityLogModal = React.lazy(() => import("@/components/dashboard/ExpenseActivityLogModal").then(m => ({ default: m.ExpenseActivityLogModal })));
const AuditDuplicatesModal = React.lazy(() => import("@/components/dashboard/AuditDuplicatesModal").then(m => ({ default: m.AuditDuplicatesModal })));
const DataHygieneModal = React.lazy(() => import("@/components/dashboard/DataHygieneModal").then(m => ({ default: m.DataHygieneModal })));
const ExpenseFormDrawer = React.lazy(() => import("@/components/forms/ExpenseFormDrawer").then(m => ({ default: m.ExpenseFormDrawer })));
const DpPaymentModal = React.lazy(() => import("@/components/unpaid/DpPaymentModal").then(m => ({ default: m.DpPaymentModal })));
const LoginModal = React.lazy(() => import("@/components/auth/LoginModal").then(m => ({ default: m.LoginModal })));
const ConfigTab = React.lazy(() => import("@/components/config/ConfigTab").then(m => ({ default: m.ConfigTab })));
const IncomingTransactionsTab = React.lazy(() => import("@/components/incoming/IncomingTransactionsTab").then(m => ({ default: m.IncomingTransactionsTab })));
const MasterItemsTab = React.lazy(() => import("@/components/master/MasterItemsTab").then(m => ({ default: m.MasterItemsTab })));
const MenuProductsTab = React.lazy(() => import("@/components/menu/MenuProductsTab").then(m => ({ default: m.MenuProductsTab })));
const SharedMenuReadOnlyPage = React.lazy(() => import("@/components/menu/SharedMenuReadOnlyPage").then(m => ({ default: m.SharedMenuReadOnlyPage })));
const AccountingTab = React.lazy(() => import("@/components/accounting/AccountingTab").then(m => ({ default: m.AccountingTab })));
const GeneralReportsTab = React.lazy(() => import("@/components/reports/GeneralReportsTab").then(m => ({ default: m.GeneralReportsTab })));
const TukarCashOngkirTab = React.lazy(() => import("@/components/cash-delivery/TukarCashOngkirTab").then(m => ({ default: m.TukarCashOngkirTab })));
const TalanganTab = React.lazy(() => import("@/components/talangan/TalanganTab").then(m => ({ default: m.TalanganTab })));
const UnpaidTab = React.lazy(() => import("@/components/unpaid/UnpaidTab").then(m => ({ default: m.UnpaidTab })));
const SuppliersTab = React.lazy(() => import("@/components/supplier/SuppliersTab").then(m => ({ default: m.SuppliersTab })));
const SupplierDetailPage = React.lazy(() => import("@/components/supplier/SupplierDetailPage").then(m => ({ default: m.SupplierDetailPage })));
const AssetsTab = React.lazy(() => import("@/components/assets/AssetsTab").then(m => ({ default: m.AssetsTab })));
const AssetPublicLabelPage = React.lazy(() => import("@/components/assets/AssetPublicLabelPage").then(m => ({ default: m.AssetPublicLabelPage })));
const StaffRequestsPage = React.lazy(() => import("@/components/requests/StaffRequestsPage").then(m => ({ default: m.StaffRequestsPage })));
const ApprovalBelanjaPage = React.lazy(() => import("@/components/requests/ApprovalBelanjaPage").then(m => ({ default: m.ApprovalBelanjaPage })));
const PurchasingOrdersPage = React.lazy(() => import("@/components/requests/PurchasingOrdersPage").then(m => ({ default: m.PurchasingOrdersPage })));
const WarehouseReceivingPage = React.lazy(() => import("@/components/requests/WarehouseReceivingPage").then(m => ({ default: m.WarehouseReceivingPage })));
const CsvImportModal = React.lazy(() => import("@/components/import/CsvImportModal").then(m => ({ default: m.CsvImportModal })));
const CashflowHubView = React.lazy(() => import("@/components/dashboard/CashflowHubView").then(m => ({ default: m.CashflowHubView })));
const UnifiedProcurementHub = React.lazy(() => import("@/components/requests/UnifiedProcurementHub").then(m => ({ default: m.UnifiedProcurementHub })));
const CatalogHubView = React.lazy(() => import("@/components/master/CatalogHubView").then(m => ({ default: m.CatalogHubView })));
const GovernanceHubView = React.lazy(() => import("@/components/accounting/GovernanceHubView").then(m => ({ default: m.GovernanceHubView })));
const AiChatFullPage = React.lazy(() => import("@/components/ai-chat/AiChatFullPage").then(m => ({ default: m.AiChatFullPage })));
const AiChatWidget = React.lazy(() => import("@/components/ai-chat/AiChatWidget").then(m => ({ default: m.AiChatWidget })));

function TabLoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[350px] p-8 space-y-3">
      <Spinner className="w-7 h-7 text-primary" />
      <span className="text-xs text-muted-foreground animate-pulse font-medium">Memuat modul...</span>
    </div>
  );
}
import { useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard-01/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard-01/dashboard-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { isPaidStatus, isDpStatus, getTempoQuickDate } from "@/lib/paymentStatus";
import { Plus } from "lucide-react";

// Ambil dan hapus SSO token dari URL segera sebelum render agar tidak bertahan di history
let initialPendingSsoToken: string | null = null;
try {
  const isSharedRoute = window.location.pathname.includes("/shared/");
  const initParams = new URLSearchParams(window.location.search);
  const initUrlToken = isSharedRoute ? null : initParams.get("token");
  if (initUrlToken) {
    initialPendingSsoToken = initUrlToken;
    initParams.delete("token");
    const initNewQuery = initParams.toString() ? `?${initParams.toString()}` : "";
    window.history.replaceState({}, "", `${window.location.pathname}${initNewQuery}`);
  }
} catch {
  // Abaikan saat SSR atau testing environment
}

function AssetQrRouteView({ qrToken }: { qrToken: string }) {
  const navigate = useNavigate();
  const { data: authData } = useQuery<{ authenticated: boolean }>({
    queryKey: ["auth-status"],
    queryFn: async () => {
      const res = await api.get("/auth/status");
      return res.data;
    },
    retry: false,
  });

  return (
    <React.Suspense fallback={<TabLoadingFallback />}>
      <Toaster position="top-right" richColors closeButton />
      <AssetPublicLabelPage
        qrToken={qrToken}
        isAuthenticated={Boolean(authData?.authenticated)}
        onBackToDashboard={authData?.authenticated ? () => navigate("/inventaris") : undefined}
      />
    </React.Suspense>
  );
}

export function App() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/shared/menus") {
    const params = new URLSearchParams(location.search);
    const shareToken = params.get("share") || params.get("token") || "";
    return (
      <React.Suspense fallback={<TabLoadingFallback />}>
        <Toaster position="top-right" richColors closeButton />
        <SharedMenuReadOnlyPage token={shareToken} />
      </React.Suspense>
    );
  }
  const assetLabelMatch = pathname.match(/^\/inventaris\/label\/([^/]+)$/);
  if (assetLabelMatch) {
    return <AssetQrRouteView qrToken={decodeURIComponent(assetLabelMatch[1])} />;
  }
  return <MainDashboardApp />;
}

function MainDashboardApp() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Parse path to activeTab & selectedSupplierId
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const supplierMatch = pathname.match(/^\/suppliers\/(\d+)$/);
  const selectedSupplierId = supplierMatch ? parseInt(supplierMatch[1], 10) : null;

  let activeTab: "overview" | "transactions" | "incoming" | "accounting" | "laporan-umum" | "master" | "menus" | "suppliers" | "supplier-detail" | "inventaris" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "requests" | "approval" | "purchasing" | "gudang" | "config" | "ai-chat" = "overview";
  if (selectedSupplierId) {
    activeTab = "supplier-detail";
  } else if (pathname === "/suppliers") {
    activeTab = "suppliers";
  } else if (pathname === "/inventaris" || pathname === "/assets") {
    activeTab = "inventaris";
  } else if (pathname === "/menus" || pathname === "/menu" || pathname === "/produk") {
    activeTab = "menus";
  } else if (pathname === "/accounting" || pathname === "/akuntansi" || pathname === "/laporan-akuntansi") {
    activeTab = "accounting";
  } else if (pathname === "/laporan-umum") {
    activeTab = "laporan-umum";
  } else if (pathname === "/incoming" || pathname === "/transaksi-masuk") {
    activeTab = "incoming";
  } else if (pathname === "/master") {
    activeTab = "master";
  } else if (pathname === "/transactions" || pathname === "/transaksi") {
    activeTab = "transactions";
  } else if (pathname === "/requests" || pathname === "/request" || pathname === "/request-belanja") {
    activeTab = "requests";
  } else if (pathname === "/approval" || pathname === "/approval-belanja") {
    activeTab = "approval";
  } else if (pathname === "/purchasing") {
    activeTab = "purchasing";
  } else if (pathname === "/gudang" || pathname === "/warehouse") {
    activeTab = "gudang";
  } else if (pathname === "/tukar-cash-ongkir") {
    activeTab = "tukar-cash-ongkir";
  } else if (pathname === "/talangan" || pathname === "/reimburse") {
    activeTab = "talangan";
  } else if (pathname === "/unpaid" || pathname === "/belum-lunas" || pathname === "/hutang") {
    activeTab = "unpaid";
  } else if (pathname === "/config") {
    activeTab = "config";
  } else if (pathname === "/ai-chat") {
    activeTab = "ai-chat";
  } else {
    activeTab = "overview";
  }

  const handleTabChange = (tab: "overview" | "transactions" | "incoming" | "accounting" | "laporan-umum" | "master" | "menus" | "suppliers" | "inventaris" | "tukar-cash-ongkir" | "talangan" | "unpaid" | "requests" | "approval" | "purchasing" | "gudang" | "config" | "ai-chat") => {
    if (tab === "overview") {
      navigate("/");
    } else {
      navigate("/" + tab);
    }
  };

  const isCashflowActive = [
    "overview",
    "transactions",
    "incoming",
    "unpaid",
    "talangan",
    "tukar-cash-ongkir",
  ].includes(activeTab);

  const isProcurementActive = [
    "requests",
    "approval",
    "purchasing",
    "gudang",
  ].includes(activeTab);

  const isCatalogActive = [
    "master",
    "menus",
    "suppliers",
    "supplier-detail",
    "inventaris",
  ].includes(activeTab);

  const isGovernanceActive = [
    "accounting",
    "laporan-umum",
    "config",
  ].includes(activeTab);

  const cashflowSubTab: "transactions" | "unpaid" | "talangan" | "cash-delivery" | "incoming" =
    activeTab === "unpaid"
      ? "unpaid"
      : activeTab === "talangan"
      ? "talangan"
      : activeTab === "tukar-cash-ongkir"
      ? "cash-delivery"
      : activeTab === "incoming"
      ? "incoming"
      : "transactions";

  const [cashDeliverySubtype, setCashDeliverySubtype] = useState<"all" | "tukar_cash" | "ongkir">("all");

  // Filter states
  const now = new Date();
  const [monthStart, setMonthStart] = useState<number>(now.getMonth() + 1);
  const [monthEnd, setMonthEnd] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());

  // Backwards-compatible alias for single-month usage
  const month = monthStart;
  const setMonth = (m: number, mEnd?: number) => {
    setMonthStart(m);
    setMonthEnd(mEnd || m);
  };

  // Formatted ISO date range for the active header period
  const filterStartDate = useMemo(() => {
    return `${year}-${String(monthStart).padStart(2, "0")}-01`;
  }, [year, monthStart]);

  const filterEndDate = useMemo(() => {
    const lastDay = new Date(year, monthEnd, 0).getDate();
    return `${year}-${String(monthEnd).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }, [year, monthEnd]);

  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("");
  const [isReimbursement, setIsReimbursement] = useState<boolean | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<"" | "DRAFT_WARNING">("");
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(25);
  const [txViewMode, setTxViewMode] = useState<ExpenseViewMode>("grouped");

  const handleTxViewModeChange = (next: ExpenseViewMode) => {
    setTxViewMode(next);
    setPage(1);
  };

  // Modal & Drawer states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [confirmingPackagingExpense, setConfirmingPackagingExpense] = useState<Expense | null>(null);
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
  const [paymentModalExpense, setPaymentModalExpense] = useState<Expense | null>(null);
  const [paymentModalInvoiceGroup, setPaymentModalInvoiceGroup] = useState<ExpenseInvoiceGroup | null>(null);
  const [paymentModalMode, setPaymentModalMode] = useState<"full" | "percent" | "amount">("full");
  const [activeAiChatSessionId, setActiveAiChatSessionId] = useState<number | null>(null);

  const handleOpenPaymentModal = (expense: Expense, mode: "full" | "percent" | "amount" = "full") => {
    setPaymentModalInvoiceGroup(null);
    setPaymentModalExpense(expense);
    setPaymentModalMode(mode);
  };

  const handleOpenInvoicePaymentModal = (
    group: ExpenseInvoiceGroup,
    mode: "full" | "percent" | "amount" = "full"
  ) => {
    setPaymentModalExpense(null);
    setPaymentModalInvoiceGroup(group);
    setPaymentModalMode(mode);
  };

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

  // Tukar SSO token dari HCTeams Hub menjadi cookie sesi HttpOnly
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token") || initialPendingSsoToken;
    if (params.get("token")) {
      params.delete("token");
      const newQuery = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState({}, "", `${window.location.pathname}${newQuery}`);
    }
    initialPendingSsoToken = null;

    if (tokenFromUrl) {
      exchangeSsoToken(tokenFromUrl)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["auth-status"] });
        })
        .catch(() => {
          setIsLoginOpen(true);
        });
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
        setIsLoginOpen(true);
      }
    }
  }, [authData]);

  // Perizinan & Peran Pengguna (Owner, Purchasing, Gudang, Staf Dapur, Admin Input)
  const userRole = authData?.role || "staff";
  const isOwner = userRole === "admin";
  const isStaff = userRole === "staff";
  const isWarehouse = userRole === "warehouse";
  const isPurchasing = userRole === "purchasing";
  const isAdminInput = userRole === "admin_input";

  const canDelete = authData?.permissions?.can_delete ?? isOwner;
  const canViewCharts = authData?.permissions?.can_view_charts ?? isOwner;
  const canManageConfig = authData?.permissions?.can_manage_config ?? isOwner;
  const canSettleTalangan = (authData?.permissions?.can_settle_talangan ?? isOwner) && !isAdminInput;
  const canViewFinancialData = isOwner || isAdminInput || isPurchasing;

  // Proteksi navigasi & pembatasan menu sesuai role -> arahkan ke halaman khusus tiap user
  useEffect(() => {
    if (!authData?.authenticated) return;

    if (isStaff && activeTab !== "requests") {
      navigate("/requests");
    } else if (isWarehouse && activeTab !== "gudang" && activeTab !== "master" && activeTab !== "inventaris") {
      navigate("/gudang");
    } else if (
      isPurchasing &&
      activeTab !== "purchasing" &&
      activeTab !== "requests" &&
      activeTab !== "transactions" &&
      activeTab !== "suppliers" &&
      activeTab !== "supplier-detail" &&
      activeTab !== "master" &&
      activeTab !== "menus"
    ) {
      navigate("/purchasing");
    } else if (
      isAdminInput &&
      (activeTab === "config" ||
        activeTab === "accounting" ||
        activeTab === "laporan-umum" ||
        activeTab === "approval" ||
        activeTab === "purchasing" ||
        activeTab === "gudang" ||
        activeTab === "suppliers" ||
        activeTab === "supplier-detail" ||
        activeTab === "master" ||
        activeTab === "unpaid" ||
        activeTab === "ai-chat")
    ) {
      navigate("/");
    }
  }, [authData?.authenticated, userRole, activeTab, isStaff, isWarehouse, isPurchasing, isAdminInput, navigate]);

  // Deep-link spesifik transaksi dari Telegram (?expense_id=... atau ?confirm_unit=...)
  useEffect(() => {
    if (!authData?.authenticated || !canViewFinancialData) return;
    const params = new URLSearchParams(location.search);
    const confirmParam = params.get("confirm_unit");
    const expenseParam = params.get("expense_id");
    const rawTargetId = confirmParam || expenseParam;
    if (!rawTargetId) return;
    const targetId = Number(rawTargetId);
    if (!Number.isInteger(targetId) || targetId <= 0) return;

    let cancelled = false;
    api
      .get<Expense>(`/expenses/${targetId}`)
      .then((res) => {
        if (cancelled || !res.data) return;
        const exp = res.data;
        if (exp.expense_date && /^\d{4}-\d{2}-\d{2}/.test(exp.expense_date)) {
          const [yStr, mStr] = exp.expense_date.split("-");
          const yNum = Number(yStr);
          const mNum = Number(mStr);
          if (yNum > 2000 && mNum >= 1 && mNum <= 12) {
            setYear(yNum);
            setMonthStart(mNum);
            setMonthEnd(mNum);
          }
        }
        setHighlightedExpenseId(exp.id);
        if (confirmParam || exp.review_status === "DRAFT_WARNING") {
          setConfirmingPackagingExpense(exp);
        } else {
          setViewingExpense(exp);
        }
      })
      .catch(() => {
        toast.error(`Transaksi #${targetId} tidak ditemukan atau sudah dihapus.`);
      })
      .finally(() => {
        if (cancelled) return;
        const cleanParams = new URLSearchParams(location.search);
        cleanParams.delete("expense_id");
        cleanParams.delete("confirm_unit");
        cleanParams.delete("ids");
        const q = cleanParams.toString();
        navigate(`${location.pathname}${q ? `?${q}` : ""}`, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [authData?.authenticated, canViewFinancialData, location.search, location.pathname, navigate]);

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
    queryKey: ["report", monthStart, monthEnd, year],
    queryFn: async () => {
      const res = await api.get(`/reports/monthly?month=${monthStart}&month_end=${monthEnd}&year=${year}`);
      return res.data;
    },
    enabled: !!authData?.authenticated && canViewFinancialData,
  });

  // 2b. Purchase Request Stats for Sidebar Badges
  const { data: requestStatsData } = useQuery({
    queryKey: ["purchase-request-stats"],
    queryFn: getPurchaseRequestStats,
    enabled: !!authData?.authenticated,
    staleTime: 30_000,
  });

  const { data: draftWarningCountData } = useQuery({
    queryKey: ["draft-warning-count"],
    queryFn: getDraftWarningCount,
    enabled: !!authData?.authenticated && canViewFinancialData,
    staleTime: 30_000,
  });
  const draftWarningCount = draftWarningCountData?.count || 0;

  const effectiveSearch = useMemo(() => getEffectiveSearchQuery(search), [search]);

  // 3. Expenses List Query (Per Item Mode)
  const {
    data: expensesData,
    isLoading: isFlatExpensesLoading,
    refetch: refetchFlatExpenses,
  } = useQuery({
    queryKey: ["expenses", page, perPage, monthStart, monthEnd, year, category, effectiveSearch, status, payMethod, isReimbursement, selectedUserId, reviewStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        month: String(monthStart),
        year: String(year),
      });
      if (monthEnd && monthEnd !== monthStart) {
        params.append("month_end", String(monthEnd));
      }
      if (category) params.append("category", category);
      if (effectiveSearch) params.append("search", effectiveSearch);
      if (status) params.append("status", status);
      if (payMethod) params.append("pay_method", payMethod);
      if (isReimbursement !== null) params.append("is_reimbursement", String(isReimbursement));
      if (selectedUserId !== null) params.append("user_id", String(selectedUserId));
      if (reviewStatusFilter) params.append("review_status", reviewStatusFilter);

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
    enabled: !!authData?.authenticated && canViewFinancialData && txViewMode === "items",
  });

  // 3a. Grouped Invoice List Query (Default Mode)
  const {
    data: groupedExpensesData,
    isLoading: isGroupedExpensesLoading,
    refetch: refetchGroupedExpenses,
  } = useQuery<ExpenseInvoiceListResponse>({
    queryKey: ["expenses-grouped", page, perPage, monthStart, monthEnd, year, category, effectiveSearch, status, payMethod, isReimbursement, selectedUserId, reviewStatusFilter],
    queryFn: () =>
      getGroupedExpenses({
        page,
        per_page: perPage,
        month: monthStart,
        month_end: monthEnd && monthEnd !== monthStart ? monthEnd : null,
        year,
        category: category || undefined,
        search: effectiveSearch || undefined,
        status: status || undefined,
        pay_method: payMethod || undefined,
        is_reimbursement: isReimbursement,
        user_id: selectedUserId,
        review_status: reviewStatusFilter || undefined,
      }),
    enabled: !!authData?.authenticated && canViewFinancialData && txViewMode === "grouped",
  });

  const isExpensesLoading = txViewMode === "grouped" ? isGroupedExpensesLoading : isFlatExpensesLoading;
  const activeTotalCount = txViewMode === "grouped" ? (groupedExpensesData?.total || 0) : (expensesData?.total || 0);
  const activeTotalPages = txViewMode === "grouped" ? (groupedExpensesData?.total_pages || 1) : (expensesData?.total_pages || 1);
  const activeTotalItemsCount = txViewMode === "grouped" ? (groupedExpensesData?.total_items || 0) : (expensesData?.total || 0);

  const refetchExpenses = () => {
    refetchFlatExpenses();
    refetchGroupedExpenses();
  };

  const { data: bankAccountsData = [] } = useQuery({
    queryKey: ["bank-accounts", "active"],
    queryFn: () => getBankAccounts(true),
    enabled: !!authData?.authenticated && canViewFinancialData,
  });

  // 3b. Expense Users Query
  const { data: usersData = [] } = useQuery<ExpenseUser[]>({
    queryKey: ["expense-users"],
    queryFn: async () => getExpenseUsers(),
    enabled: !!authData?.authenticated && canViewFinancialData,
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
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
      queryClient.invalidateQueries({ queryKey: ["price-history"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-top-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
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
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
      queryClient.invalidateQueries({ queryKey: ["price-history"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-top-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
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
        import("canvas-confetti")
          .then(({ default: confetti }) =>
            confetti({
              particleCount: 30,
              spread: 45,
              origin: { y: 0.8 },
              colors: ["#10b981", "#3b82f6", "#f59e0b"],
            })
          )
          .catch(() => {});
      } else {
        toast.info(`Transaksi #${updated.id} diubah ke Belum Lunas`);
      }
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["price-history"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
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

  // Mutasi: Toggle Pay Status untuk 1 Grup Invoice
  const toggleInvoiceStatusMutation = useMutation({
    mutationFn: async ({
      expenseIds,
      action,
    }: {
      expenseIds: number[];
      action: "mark_paid" | "mark_unpaid";
    }) => {
      return await settleUnpaidExpenses({ expense_ids: expenseIds, action });
    },
    onSuccess: (data) => {
      if (data.action === "mark_paid") {
        toast.success(`Invoice ditandai Lunas (${data.updated_count} item)`);
      } else {
        toast.info(`Status Lunas invoice dibatalkan (${data.updated_count} item)`);
      }
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal mengubah status pembayaran invoice");
    },
  });

  const handleToggleInvoiceStatus = (group: ExpenseInvoiceGroup) => {
    if (group.is_paid) {
      toggleInvoiceStatusMutation.mutate({
        expenseIds: group.items.map((it) => it.id),
        action: "mark_unpaid",
      });
    } else {
      const unpaidIds = group.items
        .filter((it) => !isPaidStatus(it.pay_status))
        .map((it) => it.id);
      if (unpaidIds.length > 0) {
        toggleInvoiceStatusMutation.mutate({
          expenseIds: unpaidIds,
          action: "mark_paid",
        });
      }
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["master-items"] });
      queryClient.invalidateQueries({ queryKey: ["price-history"] });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-top-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-priciest-items"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
      queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || err.message || "Gagal menghapus pengeluaran");
    },
  });

  const handleToggleStatus = (item: Expense) => {
    if (isDpStatus(item.pay_status)) {
      handleOpenPaymentModal(item, "full");
      return;
    }
    const isLunas = isPaidStatus(item.pay_status);
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

  const categories = (masterCategoriesData && masterCategoriesData.length > 0)
    ? masterCategoriesData
    : (reportData?.valid_categories && reportData.valid_categories.length > 0)
    ? reportData.valid_categories
    : [
        "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor",
        "Kemasan", "Operasional", "Topper & Mainan", "Renovasi",
        "Asset", "Iuran", "Tukar Cash", "Ongkir",
        "Gaji", "Sewa", "Marketing", "Software", "Maintenance"
      ];

  const totalUnpaidNominal =
    reportData?.list_hutang?.reduce((sum, item) => sum + item.nominal, 0) || 0;

  const categoryCoaMap = useMemo(() => {
    const map: Record<string, { code: string; name: string; group: string }> = {};
    reportData?.accounting_breakdown?.forEach((item) => {
      map[item.category] = {
        code: item.account_code,
        name: item.account_name,
        group: item.account_group,
      };
    });
    return map;
  }, [reportData]);

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
          onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
          userRole={userRole}
          canManageConfig={canManageConfig}
          monthlyBudgetLimit={reportData?.monthly_budget_limit}
          budgetUsedPct={reportData?.budget_used_pct}
          totalPengeluaran={reportData?.total_pengeluaran}
          expenseCount={reportData?.expense_count}
          unpaidCount={reportData?.list_hutang?.length}
          reimbursePendingCount={reportData?.reimburse_pending_count || 0}
          pendingApprovalCount={requestStatsData?.pending || 0}
          purchasingReadyCount={requestStatsData?.approved || 0}
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
            month={monthStart}
            monthEnd={monthEnd}
            year={year}
            onMonthChange={(m, mEnd) => {
              setMonthStart(m);
              setMonthEnd(mEnd || m);
              setPage(1);
            }}
            onPeriodChange={(s, e, y) => {
              setMonthStart(s);
              setMonthEnd(e);
              setYear(y);
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
          <main className="w-full min-w-0 max-w-[1920px] mx-auto px-3 sm:px-5 md:px-6 py-3.5 space-y-3.5">
            {/* Hub 1: Kas & Pengeluaran */}
            {isCashflowActive && (
              <React.Suspense fallback={<TabLoadingFallback />}>
                <CashflowHubView
                  activeSubTab={cashflowSubTab}
                  onSubTabChange={(sub) => {
                    if (sub === "transactions") navigate("/transactions");
                    else if (sub === "unpaid") navigate("/unpaid");
                    else if (sub === "talangan") navigate("/talangan");
                    else if (sub === "cash-delivery") navigate("/tukar-cash-ongkir");
                    else if (sub === "incoming") navigate("/incoming");
                  }}
                  onOpenAddExpense={() => {
                    setEditingExpense(null);
                    setRepeatingExpense(null);
                    setIsFormOpen(true);
                  }}
                  unpaidCount={reportData?.list_hutang?.length || 0}
                  unpaidTotal={totalUnpaidNominal}
                  reimburseCount={reportData?.reimburse_pending_count || 0}
                  reimburseTotal={reportData?.reimburse_pending_total || 0}
                  totalPengeluaran={reportData?.total_pengeluaran || 0}
                  userRole={userRole}
                  currentMonth={monthStart}
                  currentMonthEnd={monthEnd}
                  currentYear={year}
                >
                  {activeTab === "overview" && (
              <>
                {/* Tampilan Header & Statistik Sesuai Role Pengguna */}
                {canViewCharts ? (
                  isMobile ? (
                    /* 1. Tampilan Khusus Mobile Owner (Simple, Ergonomis & Cepat) */
                    <div>
                      <React.Suspense fallback={<TabLoadingFallback />}>
                        <OwnerMobileView
                        activeTab="overview"
                        onNavigateTab={(t) => handleTabChange(t)}
                        reportData={reportData}
                        expenses={expensesData?.data || []}
                        invoiceGroups={groupedExpensesData?.data || []}
                        viewMode={txViewMode}
                        onViewModeChange={handleTxViewModeChange}
                        totalItemsCount={activeTotalItemsCount}
                        isExpensesLoading={isExpensesLoading}
                        page={page}
                        totalPages={activeTotalPages}
                        totalCount={activeTotalCount}
                        onPageChange={setPage}
                        onToggleStatus={handleToggleStatus}
                        onToggleInvoiceStatus={handleToggleInvoiceStatus}
                        onOpenPaymentModal={handleOpenPaymentModal}
                        onOpenInvoicePaymentModal={handleOpenInvoicePaymentModal}
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
                        onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                        onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                      />
                      </React.Suspense>
                    </div>
                  ) : (
                    /* 2. Tampilan Desktop (md: ke atas) Tetap Lengkap & Kaya Data */
                    <React.Suspense fallback={<TabLoadingFallback />}>
                    <div className="space-y-3.5">
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
                        perAccountGroup={reportData?.per_account_group}
                        prevPerAccountGroup={reportData?.prev_per_account_group}
                        momAccountGroupChangePct={reportData?.mom_account_group_change_pct}
                        accountingInflation={reportData?.accounting_inflation}
                        accountingBreakdown={reportData?.accounting_breakdown}
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
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                        <div className="lg:col-span-6">
                          <CategoryDonutChart
                            categoryData={reportData?.per_kategori || {}}
                            totalAmount={reportData?.total_lunas || 0}
                            perAccountGroup={reportData?.per_account_group}
                            accountingBreakdown={reportData?.accounting_breakdown}
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
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
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
                    </div>
                    </React.Suspense>
                  )
                ) : (
                  /* Tampilan Ringkas & Cepat Khusus Admin Input */
                  <div className="space-y-4">
                    {/* Action Toolbar Admin Input */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-semibold px-2.5 py-1 rounded-lg text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 shadow-xs">
                          ✍️ Workspace Admin Input
                        </Badge>
                      </div>
                      <Button
                        onClick={() => {
                          setEditingExpense(null);
                          setRepeatingExpense(null);
                          setIsFormOpen(true);
                        }}
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs gap-1.5 text-xs font-semibold h-8 px-3 shrink-0 self-start sm:self-center"
                      >
                        <Plus className="w-3.5 h-3.5" />
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

                    {/* Admin Input Filter Bar & Expense Table */}
                    <React.Suspense fallback={<TabLoadingFallback />}>
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
                      categoryCoaMap={categoryCoaMap}
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
                      onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                    />

                    {/* Admin Input Expense Table */}
                    {(draftWarningCount > 0 || reviewStatusFilter === "DRAFT_WARNING") && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/40 px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs">
                        <span className="text-amber-900 dark:text-amber-200 font-medium">
                          {draftWarningCount > 0
                            ? `${draftWarningCount} transaksi AI/struk berstatus Draft menunggu konfirmasi varian kemasan.`
                            : "Menampilkan filter Draft Konfirmasi Kemasan."}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setReviewStatusFilter((prev) =>
                              prev === "DRAFT_WARNING" ? "" : "DRAFT_WARNING"
                            );
                            setPage(1);
                          }}
                          className="px-2.5 py-1 rounded-md border border-amber-400 bg-white dark:bg-amber-900/50 text-amber-950 dark:text-amber-100 font-semibold hover:bg-amber-100 transition-colors"
                        >
                          {reviewStatusFilter === "DRAFT_WARNING"
                            ? "Tampilkan Semua Transaksi"
                            : `Filter ${draftWarningCount} Draft`}
                        </button>
                      </div>
                    )}
                    <ExpenseTable
                      expenses={expensesData?.data || []}
                      invoiceGroups={groupedExpensesData?.data || []}
                      viewMode={txViewMode}
                      onViewModeChange={handleTxViewModeChange}
                      totalItemsCount={activeTotalItemsCount}
                      isLoading={isExpensesLoading}
                      page={page}
                      pageSize={perPage}
                      totalPages={activeTotalPages}
                      totalCount={activeTotalCount}
                      searchQuery={search}
                      onPageChange={setPage}
                      onPageSizeChange={(size) => {
                        setPerPage(size);
                        setPage(1);
                      }}
                      onToggleStatus={handleToggleStatus}
                      onToggleInvoiceStatus={handleToggleInvoiceStatus}
                      onOpenPaymentModal={handleOpenPaymentModal}
                      onOpenInvoicePaymentModal={handleOpenInvoicePaymentModal}
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
                      onConfirmPackaging={(item) => setConfirmingPackagingExpense(item)}
                      canDelete={canDelete}
                      categoryCoaMap={categoryCoaMap}
                      highlightedExpenseId={highlightedExpenseId}
                    />
                    </React.Suspense>
                  </div>
                )}
              </>
            )}

            {activeTab === "incoming" && (
              <React.Suspense fallback={<TabLoadingFallback />}>
                <IncomingTransactionsTab
                  isAdmin={isOwner}
                  headerStartDate={filterStartDate}
                  headerEndDate={filterEndDate}
                  headerMonthStart={monthStart}
                  headerMonthEnd={monthEnd}
                  headerYear={year}
                />
              </React.Suspense>
            )}

            {activeTab === "transactions" && (
              <>
                {canViewCharts ? (
                  isMobile ? (
                    /* 1. Tampilan Khusus Mobile Owner untuk Halaman Transaksi */
                    <div>
                      <React.Suspense fallback={<TabLoadingFallback />}>
                      <OwnerMobileView
                        activeTab="transactions"
                        onNavigateTab={(t) => handleTabChange(t)}
                        reportData={reportData}
                        expenses={expensesData?.data || []}
                        invoiceGroups={groupedExpensesData?.data || []}
                        viewMode={txViewMode}
                        onViewModeChange={handleTxViewModeChange}
                        totalItemsCount={activeTotalItemsCount}
                        isExpensesLoading={isExpensesLoading}
                        page={page}
                        totalPages={activeTotalPages}
                        totalCount={activeTotalCount}
                        onPageChange={setPage}
                        onToggleStatus={handleToggleStatus}
                        onToggleInvoiceStatus={handleToggleInvoiceStatus}
                        onOpenPaymentModal={handleOpenPaymentModal}
                        onOpenInvoicePaymentModal={handleOpenInvoicePaymentModal}
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
                        onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                        onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                      />
                      </React.Suspense>
                    </div>
                  ) : (
                    /* 2. Tampilan Desktop Halaman Daftar Transaksi */
                    <React.Suspense fallback={<TabLoadingFallback />}>
                    <div className="space-y-3.5">
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
                        categoryCoaMap={categoryCoaMap}
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
                        onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                      />

                      {/* Desktop Expense Data Table */}
                      {(draftWarningCount > 0 || reviewStatusFilter === "DRAFT_WARNING") && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/40 px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs">
                          <span className="text-amber-900 dark:text-amber-200 font-medium">
                            {draftWarningCount > 0
                              ? `${draftWarningCount} transaksi AI/struk berstatus Draft menunggu konfirmasi varian kemasan.`
                              : "Menampilkan filter Draft Konfirmasi Kemasan."}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setReviewStatusFilter((prev) =>
                                prev === "DRAFT_WARNING" ? "" : "DRAFT_WARNING"
                              );
                              setPage(1);
                            }}
                            className="px-2.5 py-1 rounded-md border border-amber-400 bg-white dark:bg-amber-900/50 text-amber-950 dark:text-amber-100 font-semibold hover:bg-amber-100 transition-colors"
                          >
                            {reviewStatusFilter === "DRAFT_WARNING"
                              ? "Tampilkan Semua Transaksi"
                              : `Filter ${draftWarningCount} Draft`}
                          </button>
                        </div>
                      )}
                      <ExpenseTable
                        expenses={expensesData?.data || []}
                        invoiceGroups={groupedExpensesData?.data || []}
                        viewMode={txViewMode}
                        onViewModeChange={handleTxViewModeChange}
                        totalItemsCount={activeTotalItemsCount}
                        isLoading={isExpensesLoading}
                        page={page}
                        pageSize={perPage}
                        totalPages={activeTotalPages}
                        totalCount={activeTotalCount}
                        searchQuery={search}
                        onPageChange={setPage}
                        onPageSizeChange={(size) => {
                          setPerPage(size);
                          setPage(1);
                        }}
                        onToggleStatus={handleToggleStatus}
                        onToggleInvoiceStatus={handleToggleInvoiceStatus}
                        onOpenPaymentModal={handleOpenPaymentModal}
                        onOpenInvoicePaymentModal={handleOpenInvoicePaymentModal}
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
                        onConfirmPackaging={(item) => setConfirmingPackagingExpense(item)}
                        canDelete={canDelete}
                        highlightedExpenseId={highlightedExpenseId}
                      />
                    </div>
                    </React.Suspense>
                  )
                ) : (
                  /* Admin Input View pada Halaman Transaksi */
                  <div className="space-y-3">
                    {/* Editorial Admin Input Header */}
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-bold tracking-tight text-[var(--ledger-ink)]">
                            Daftar Transaksi Operasional
                          </h2>
                          <Badge variant="outline" className="text-[10px] font-semibold text-amber-800 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
                            Input &amp; Koreksi
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--ledger-muted)]">
                          Pencatatan pengeluaran harian dan koreksi transaksi operasional.
                        </p>
                      </div>
                      <Button
                        onClick={() => {
                          setEditingExpense(null);
                          setRepeatingExpense(null);
                          setIsFormOpen(true);
                        }}
                        size="sm"
                        className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 rounded-lg gap-1.5 text-xs font-semibold h-9 px-3.5 shrink-0 w-full sm:w-auto ledger-press"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Catat Pengeluaran Baru</span>
                      </Button>
                    </div>

                    {/* Unified Hairline Summary Strip */}
                    <div className="rounded-xl border border-[color:var(--ledger-hairline)] bg-[var(--ledger-surface)] overflow-hidden grid grid-cols-3 divide-x divide-[color:var(--ledger-hairline)]">
                      <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="text-[10px] sm:text-xs font-semibold text-[var(--ledger-muted)] truncate">
                          Total Transaksi
                        </div>
                        <div className="text-sm sm:text-xl font-bold text-[var(--ledger-ink)] mt-0.5 tabular-nums">
                          {reportData?.expense_count || 0}
                          <span className="hidden sm:inline text-xs font-normal text-[var(--ledger-muted)] ml-1.5">item</span>
                        </div>
                      </div>
                      <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="text-[10px] sm:text-xs font-semibold text-[var(--ledger-muted)] truncate">Total Belanja</div>
                        <div className="text-xs sm:text-xl font-bold text-[var(--ledger-ink)] mt-0.5 tabular-nums truncate">
                          {formatRupiah(reportData?.total_pengeluaran || 0)}
                        </div>
                      </div>
                      <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="text-[10px] sm:text-xs font-semibold text-[var(--ledger-muted)] truncate">Belum Lunas</div>
                        <div className="text-xs sm:text-xl font-bold text-[var(--signal-unpaid)] mt-0.5 tabular-nums truncate">
                          {reportData?.list_hutang?.length || 0}
                          <span className="hidden sm:inline text-xs font-normal text-[var(--ledger-muted)] ml-1.5">
                            ({formatRupiah(totalUnpaidNominal)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Admin Input Filter Bar & Expense Table */}
                    <React.Suspense fallback={<TabLoadingFallback />}>
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
                      categoryCoaMap={categoryCoaMap}
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
                      onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                    />

                    {/* Admin Input Expense Table */}
                    {(draftWarningCount > 0 || reviewStatusFilter === "DRAFT_WARNING") && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/40 px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs">
                        <span className="text-amber-900 dark:text-amber-200 font-medium">
                          {draftWarningCount > 0
                            ? `${draftWarningCount} transaksi AI/struk berstatus Draft menunggu konfirmasi varian kemasan.`
                            : "Menampilkan filter Draft Konfirmasi Kemasan."}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setReviewStatusFilter((prev) =>
                              prev === "DRAFT_WARNING" ? "" : "DRAFT_WARNING"
                            );
                            setPage(1);
                          }}
                          className="px-2.5 py-1 rounded-md border border-amber-400 bg-white dark:bg-amber-900/50 text-amber-950 dark:text-amber-100 font-semibold hover:bg-amber-100 transition-colors"
                        >
                          {reviewStatusFilter === "DRAFT_WARNING"
                            ? "Tampilkan Semua Transaksi"
                            : `Filter ${draftWarningCount} Draft`}
                        </button>
                      </div>
                    )}
                    <ExpenseTable
                      expenses={expensesData?.data || []}
                      invoiceGroups={groupedExpensesData?.data || []}
                      viewMode={txViewMode}
                      onViewModeChange={handleTxViewModeChange}
                      totalItemsCount={activeTotalItemsCount}
                      isLoading={isExpensesLoading}
                      page={page}
                      pageSize={perPage}
                      totalPages={activeTotalPages}
                      totalCount={activeTotalCount}
                      searchQuery={search}
                      onPageChange={setPage}
                      onPageSizeChange={(size) => {
                        setPerPage(size);
                        setPage(1);
                      }}
                      onToggleStatus={handleToggleStatus}
                      onToggleInvoiceStatus={handleToggleInvoiceStatus}
                      onOpenPaymentModal={handleOpenPaymentModal}
                      onOpenInvoicePaymentModal={handleOpenInvoicePaymentModal}
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
                      onConfirmPackaging={(item) => setConfirmingPackagingExpense(item)}
                      canDelete={canDelete}
                      categoryCoaMap={categoryCoaMap}
                      highlightedExpenseId={highlightedExpenseId}
                    />
                    </React.Suspense>
                  </div>
                )}
              </>
            )}

                  {activeTab === "tukar-cash-ongkir" && (
                    <TukarCashOngkirTab
                      currentMonth={monthStart}
                      currentMonthEnd={monthEnd}
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
                      currentMonth={monthStart}
                      currentMonthEnd={monthEnd}
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
                      canSettle={canSettleTalangan}
                      userRole={userRole}
                    />
                  )}

                  {activeTab === "unpaid" && (
                    <UnpaidTab
                      currentMonth={monthStart}
                      currentMonthEnd={monthEnd}
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
                        const in7Days = getTempoQuickDate(7);
                        setRepeatingExpense({
                          id: 0,
                          created_at: new Date().toISOString(),
                          expense_date: new Date().toISOString().split("T")[0],
                          category: category || categories[0] || "Bahan Kue",
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
                      onAddNewDp={() => {
                        setEditingExpense(null);
                        const in14Days = getTempoQuickDate(14);
                        setRepeatingExpense({
                          id: 0,
                          created_at: new Date().toISOString(),
                          expense_date: new Date().toISOString().split("T")[0],
                          category: category || categories[0] || "Bahan Kue",
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
                          pay_method: "Transfer",
                          pay_status: "DP / Sebagian",
                          due_date: in14Days,
                          paid_amount: 0,
                          dp_type: "percent",
                          dp_percent: 50,
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
                </CashflowHubView>
              </React.Suspense>
            )}

            {/* Hub 2: Alur Pengadaan */}
            {isProcurementActive && (
              <React.Suspense fallback={<TabLoadingFallback />}>
                <UnifiedProcurementHub
                  activeStage={activeTab as any}
                  onStageChange={(stage) => navigate("/" + stage)}
                  pendingApprovalCount={requestStatsData?.pending || 0}
                  purchasingReadyCount={requestStatsData?.approved || 0}
                  userRole={userRole}
                >
                  {activeTab === "requests" && (
                    <StaffRequestsPage
                      categories={categories}
                      itemSuggestions={suggestionsData?.items || []}
                      currentUser={authData?.user || authData?.username || ""}
                    />
                  )}

                  {activeTab === "approval" && isOwner && (
                    <ApprovalBelanjaPage
                      categories={categories}
                      itemSuggestions={suggestionsData?.items || []}
                      currentUser={authData?.user || authData?.username || ""}
                    />
                  )}

                  {activeTab === "purchasing" && (isOwner || isPurchasing) && (
                    <PurchasingOrdersPage
                      categories={categories}
                      itemSuggestions={suggestionsData?.items || []}
                    />
                  )}

                  {activeTab === "gudang" && (isOwner || isWarehouse) && (
                    <WarehouseReceivingPage
                      currentUser={authData?.user || authData?.username || ""}
                    />
                  )}
                </UnifiedProcurementHub>
              </React.Suspense>
            )}

            {/* Hub 3: Katalog & Margin */}
            {isCatalogActive && (
              <React.Suspense fallback={<TabLoadingFallback />}>
                <CatalogHubView
                  activeSubTab={activeTab as any}
                  onSubTabChange={(sub) => navigate("/" + sub)}
                  userRole={userRole}
                >
                  {activeTab === "master" && (
                    <MasterItemsTab
                      categories={categories}
                      units={activeUnits}
                      onInspectItemPrice={handleInspectItemPrice}
                      canEdit={isOwner || isPurchasing}
                      canDelete={isOwner}
                    />
                  )}

                  {activeTab === "menus" && (
                    <MenuProductsTab
                      isAdmin={isOwner}
                      units={activeUnits}
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

                  {activeTab === "inventaris" && (
                    <AssetsTab isOwner={isOwner} />
                  )}
                </CatalogHubView>
              </React.Suspense>
            )}

            {/* Hub 4: Laporan & Kontrol */}
            {isGovernanceActive && (
              <React.Suspense fallback={<TabLoadingFallback />}>
                <GovernanceHubView
                  activeSubTab={
                    activeTab === "config"
                      ? "config"
                      : activeTab === "laporan-umum"
                      ? "laporan-umum"
                      : "accounting"
                  }
                  onSubTabChange={(sub) => navigate("/" + sub)}
                  onOpenDataHygiene={() => setIsDataHygieneModalOpen(true)}
                  onOpenAuditDuplicates={() => setIsAuditModalOpen(true)}
                  onOpenImport={() => setIsImportOpen(true)}
                  canManageConfig={canManageConfig}
                  userRole={userRole}
                >
                  {activeTab === "accounting" && (
                    <AccountingTab
                      currentMonth={monthStart}
                      currentMonthEnd={monthEnd}
                      currentYear={year}
                      onMonthChange={(m) => {
                        setMonthStart(m);
                        setMonthEnd(m);
                      }}
                      onYearChange={setYear}
                      onViewExpense={(item) => setViewingExpense(item)}
                    />
                  )}

                  {activeTab === "laporan-umum" && (
                    <GeneralReportsTab
                      currentMonth={monthStart}
                      currentMonthEnd={monthEnd}
                      currentYear={year}
                      onMonthChange={(m) => {
                        setMonthStart(m);
                        setMonthEnd(m);
                      }}
                      onYearChange={setYear}
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
                </GovernanceHubView>
              </React.Suspense>
            )}

            {/* Hub 5: Asisten AI Keuangan (Khusus Owner) */}
            {activeTab === "ai-chat" && isOwner && authData?.authenticated && (
              <React.Suspense fallback={<TabLoadingFallback />}>
                <AiChatFullPage
                  sessionId={activeAiChatSessionId}
                  onSessionChange={setActiveAiChatSessionId}
                  onNavigateConfig={() => navigate("/config")}
                />
              </React.Suspense>
            )}
          </main>
        </SidebarInset>

        {/* Floating AI Chat Popup (blocks-so/ai-05, Khusus Owner, tersembunyi di /ai-chat) */}
        {isOwner && authData?.authenticated && (
          <React.Suspense fallback={null}>
            <AiChatWidget
              sessionId={activeAiChatSessionId}
              onSessionChange={setActiveAiChatSessionId}
              onExpandFull={() => navigate("/ai-chat")}
              onNavigateConfig={() => navigate("/config")}
              hidden={activeTab === "ai-chat"}
            />
          </React.Suspense>
        )}

        {/* Monthly Budget Setup Modal (Persentase per Kategori & Preview Rupiah) */}
        {isBudgetDialogOpen && (
          <React.Suspense fallback={null}>
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
          </React.Suspense>
        )}

        {/* Expense Form Drawer / Modal */}
        {isFormOpen && (
          <React.Suspense fallback={null}>
            <ExpenseFormDrawer
              isOpen={isFormOpen}
              onClose={() => {
                setIsFormOpen(false);
                setRepeatingExpense(null);
              }}
              onSubmit={handleFormSubmit}
              onBatchSubmit={(items) => batchSaveMutation.mutate(items)}
              categories={categories}
              defaultCategory={category || undefined}
              paymentMethods={activePayMethods}
              units={activeUnits}
              initialData={editingExpense}
              repeatData={repeatingExpense}
              isSubmitting={saveMutation.isPending || batchSaveMutation.isPending}
              itemSuggestions={suggestionsData?.items || []}
              supplierSuggestions={suggestionsData?.suppliers || []}
            />
          </React.Suspense>
        )}

        {/* Confirm Packaging Modal (Draft Warning) */}
        {!!confirmingPackagingExpense && (
          <React.Suspense fallback={null}>
            <ConfirmPackagingModal
              isOpen={!!confirmingPackagingExpense}
              onClose={() => setConfirmingPackagingExpense(null)}
              expense={confirmingPackagingExpense}
              itemSuggestions={suggestionsData?.items || []}
              units={activeUnits}
              onConfirmed={() => {
                queryClient.invalidateQueries({ queryKey: ["expenses"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
                queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
                queryClient.invalidateQueries({ queryKey: ["master-items"] });
                queryClient.invalidateQueries({ queryKey: ["suggestions"] });
                queryClient.invalidateQueries({ queryKey: ["menus"] });
                queryClient.invalidateQueries({ queryKey: ["report"] });
              }}
            />
          </React.Suspense>
        )}

        {/* Expense Detail Modal with Telegram Cross-Check */}
        {!!viewingExpense && (
          <React.Suspense fallback={null}>
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
              onOpenPaymentModal={handleOpenPaymentModal}
            />
          </React.Suspense>
        )}

        {/* DP & Pelunasan Payment Modal */}
        {(paymentModalExpense || paymentModalInvoiceGroup) && (
          <React.Suspense fallback={null}>
            <DpPaymentModal
              isOpen={Boolean(paymentModalExpense || paymentModalInvoiceGroup)}
              onClose={() => {
                setPaymentModalExpense(null);
                setPaymentModalInvoiceGroup(null);
              }}
              expense={paymentModalExpense}
              invoiceGroup={paymentModalInvoiceGroup}
              bankAccounts={bankAccountsData}
              initialMode={paymentModalMode}
              onPaymentUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-talangan-grouped"] });
                queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
                queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
                queryClient.invalidateQueries({ queryKey: ["report"] });
                queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
                queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
              }}
              onInvoiceUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["draft-warning-count"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-grouped"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-unpaid"] });
                queryClient.invalidateQueries({ queryKey: ["expenses-unpaid-grouped"] });
                queryClient.invalidateQueries({ queryKey: ["unpaid-summary"] });
                queryClient.invalidateQueries({ queryKey: ["report"] });
                queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
              }}
            />
          </React.Suspense>
        )}

        {/* Price History & Supplier Comparison Modal */}
        {!!(inspectedItemName || inspectedItemId) && (
          <React.Suspense fallback={null}>
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
          </React.Suspense>
        )}

        {/* CSV Import Modal */}
        {isImportOpen && (
          <React.Suspense fallback={null}>
            <CsvImportModal
              isOpen={isImportOpen}
              onClose={() => setIsImportOpen(false)}
              onImportSuccess={() => {
                refetchExpenses();
                refetchReport();
                queryClient.invalidateQueries({ queryKey: ["master-items"] });
                queryClient.invalidateQueries({ queryKey: ["suggestions"] });
                queryClient.invalidateQueries({ queryKey: ["price-history"] });
                queryClient.invalidateQueries({ queryKey: ["menus"] });
                queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
              }}
            />
          </React.Suspense>
        )}

        {/* Expense Activity Log Modal (Log Aksi Perubahan Belanja) */}
        {isActivityLogOpen && (
          <React.Suspense fallback={null}>
            <ExpenseActivityLogModal
              isOpen={isActivityLogOpen}
              onClose={() => setIsActivityLogOpen(false)}
              onSelectExpense={(id) => {
                setIsActivityLogOpen(false);
              }}
              onExpenseRestored={() => {
                refetchExpenses();
                refetchReport();
                queryClient.invalidateQueries({ queryKey: ["master-items"] });
                queryClient.invalidateQueries({ queryKey: ["suggestions"] });
                queryClient.invalidateQueries({ queryKey: ["price-history"] });
                queryClient.invalidateQueries({ queryKey: ["menus"] });
                queryClient.invalidateQueries({ queryKey: ["menus-all-for-recipe"] });
              }}
            />
          </React.Suspense>
        )}

        {/* Data Hygiene & Normalizer Modal */}
        {isDataHygieneModalOpen && (
          <React.Suspense fallback={null}>
            <DataHygieneModal
              isOpen={isDataHygieneModalOpen}
              onClose={() => setIsDataHygieneModalOpen(false)}
              canClean={canDelete}
            />
          </React.Suspense>
        )}

        {/* Audit Duplikat Modal (Nama Mirip >=90% + Tanggal Sama + Nominal Sama) */}
        {isAuditModalOpen && (
          <React.Suspense fallback={null}>
            <AuditDuplicatesModal
              isOpen={isAuditModalOpen}
              onClose={() => setIsAuditModalOpen(false)}
              currentMonth={month}
              currentYear={year}
              onDeleteExpense={(id) => deleteMutation.mutate(id)}
              canDelete={canDelete}
            />
          </React.Suspense>
        )}

        {/* Telegram PIN Login Modal */}
        {isLoginOpen && (
          <React.Suspense fallback={null}>
            <LoginModal
              isOpen={isLoginOpen}
              onSuccess={() => {
                setIsLoginOpen(false);
                refetchAuth();
                refetchReport();
                refetchExpenses();
              }}
            />
          </React.Suspense>
        )}
      </div>
    </SidebarProvider>
  );
}

export default App;
