import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, settleReimbursements, getReimbursementSummary } from "@/lib/api";
import { Expense, ExpenseUser, ReimbursementSummaryResponse, ReimbursementUserSummary } from "@/types";
import { formatRupiah, formatDateId } from "@/lib/formatters";
import { parseTelegramLink } from "@/lib/telegram";
import { TelegramIcon } from "@/components/ui/TelegramIcon";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  HandCoins,
  CheckCircle2,
  Clock,
  Search,
  RotateCcw,
  Plus,
  Trash2,
  Edit2,
  Eye,
  ExternalLink,
  Users,
  ChevronDown,
  ChevronUp,
  Calendar,
  AlertCircle,
  FileCheck2,
  Filter,
  CheckCheck,
  Undo2,
  Receipt,
  Wallet,
} from "lucide-react";

interface TalanganTabProps {
  currentMonth: number;
  currentYear: number;
  users?: ExpenseUser[];
  onEditExpense: (expense: Expense) => void;
  onViewExpense?: (expense: Expense) => void;
  onDeleteExpense: (id: number) => void;
  onAddNewTalangan?: () => void;
  canDelete?: boolean;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export const TalanganTab: React.FC<TalanganTabProps> = ({
  currentMonth,
  currentYear,
  users = [],
  onEditExpense,
  onViewExpense,
  onDeleteExpense,
  onAddNewTalangan,
  canDelete = false,
}) => {
  const queryClient = useQueryClient();

  // Filter states
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "reimbursed">("pending");
  const [isAllPeriods, setIsAllPeriods] = useState<boolean>(true); // Default true agar owner bisa langsung lihat seluruh talangan tertunda
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const perPage = 25;

  // Selection states for batch action
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isUsersExpanded, setIsUsersExpanded] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 1. Fetch Ringkasan Talangan (Summary KPI + User breakdown)
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
  } = useQuery<ReimbursementSummaryResponse>({
    queryKey: [
      "talangan-summary",
      isAllPeriods ? null : selectedMonth,
      isAllPeriods ? null : selectedYear,
      selectedUserId,
    ],
    queryFn: () =>
      getReimbursementSummary({
        month: isAllPeriods ? null : selectedMonth,
        year: isAllPeriods ? null : selectedYear,
        userId: selectedUserId,
      }),
  });

  // 2. Fetch Data Talangan Terpaginasi
  const {
    data: expensesData,
    isLoading: isExpensesLoading,
    refetch: refetchExpenses,
  } = useQuery({
    queryKey: [
      "expenses-talangan",
      page,
      perPage,
      isAllPeriods ? null : selectedMonth,
      isAllPeriods ? null : selectedYear,
      statusFilter,
      selectedUserId,
      search,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        is_reimbursement: "true",
        special_type: "talangan",
      });

      if (!isAllPeriods) {
        params.append("month", String(selectedMonth));
        params.append("year", String(selectedYear));
      }

      if (statusFilter === "pending") {
        params.append("reimbursed_status", "pending");
      } else if (statusFilter === "reimbursed") {
        params.append("reimbursed_status", "reimbursed");
      }

      if (selectedUserId !== null) {
        params.append("user_id", String(selectedUserId));
      }

      if (search.trim()) {
        params.append("search", search.trim());
      }

      const res = await api.get(`/expenses?${params.toString()}`);
      return res.data;
    },
  });

  const expenses: Expense[] = expensesData?.data || [];
  const totalItems: number = expensesData?.total || 0;
  const totalPages: number = expensesData?.total_pages || 1;

  // 3. Settle Mutation (Mark / Unmark Reimbursed)
  const settleMutation = useMutation({
    mutationFn: settleReimbursements,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses-talangan"] });
      queryClient.invalidateQueries({ queryKey: ["talangan-summary"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["auth-status"] });

      if (data.action === "mark_reimbursed") {
        toast.success(`Berhasil menandai ${data.updated_count} talangan telah diganti!`);
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
        });
      } else {
        toast.info(`Status penggantian ${data.updated_count} talangan dibatalkan.`);
      }
      setSelectedIds([]);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Gagal memproses status talangan.");
    },
  });

  // Handle single item settlement toggle
  const handleToggleReimbursed = (expense: Expense) => {
    const isCurrentlyReimbursed = !!expense.reimbursed_at;
    const action = isCurrentlyReimbursed ? "unmark" : "mark_reimbursed";
    settleMutation.mutate({
      expense_ids: [expense.id],
      action,
    });
  };

  // Handle settle all for a specific user
  const handleSettleUserPending = (userGroup: ReimbursementUserSummary) => {
    if (userGroup.pending_count === 0) return;
    const confirmMsg = `Ganti semua ${userGroup.pending_count} talangan milik ${userGroup.user_name} senilai ${formatRupiah(userGroup.pending_total)}?`;
    if (!window.confirm(confirmMsg)) return;

    // Ambil semua expense pending milik user ini dari query expenses atau fetch
    api
      .get(`/expenses?is_reimbursement=true&reimbursed_status=pending&special_type=talangan&user_id=${userGroup.user_id ?? ""}&per_page=100`)
      .then((res) => {
        const ids = (res.data?.data || []).map((e: Expense) => e.id);
        if (ids.length === 0) {
          toast.error("Tidak ada item talangan pending yang dapat diproses.");
          return;
        }
        settleMutation.mutate({
          expense_ids: ids,
          action: "mark_reimbursed",
        });
      })
      .catch(() => {
        toast.error("Gagal mengambil data talangan user.");
      });
  };

  // Handle batch selection
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(expenses.map((e) => e.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchSettle = (action: "mark_reimbursed" | "unmark") => {
    if (selectedIds.length === 0) return;
    settleMutation.mutate({
      expense_ids: selectedIds,
      action,
    });
  };

  // Total nominal selected
  const selectedNominal = useMemo(() => {
    return expenses
      .filter((e) => selectedIds.includes(e.id))
      .reduce((sum, e) => sum + (e.total_price || 0), 0);
  }, [expenses, selectedIds]);

  // Handle delete confirmation
  const handleDelete = (id: number) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus catatan talangan ini?")) {
      setDeletingId(id);
      onDeleteExpense(id);
      setTimeout(() => setDeletingId(null), 1000);
    }
  };

  const getInitials = (name: string) => {
    return (name || "HC")
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
            <HandCoins className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Daftar Talangan (Reimbursement)
              </h2>
              {summaryData && summaryData.pending_count > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                >
                  {summaryData.pending_count} Belum Diganti
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Kelola pengeluaran yang ditalangi karyawan / tim, verifikasi nota, dan konfirmasi penggantian dana kas toko.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onAddNewTalangan && (
            <Button
              onClick={onAddNewTalangan}
              className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold h-10 px-4 gap-2 shadow-xs shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Catat Talangan Baru</span>
            </Button>
          )}
        </div>
      </div>

      {/* 2. KPI Cards: Ringkasan Status Talangan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Belum Diganti (Pending) */}
        <Card
          onClick={() => {
            setStatusFilter("pending");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusFilter === "pending"
              ? "ring-2 ring-amber-500 border-amber-300 bg-amber-50/40 dark:bg-amber-950/20"
              : "hover:border-amber-300 dark:hover:border-amber-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Belum Diganti (Pending)
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                  {formatRupiah(summaryData?.pending_total || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.pending_count || 0}
                </span>{" "}
                nota perlu diganti
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Sudah Diganti (Selesai) */}
        <Card
          onClick={() => {
            setStatusFilter("reimbursed");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusFilter === "reimbursed"
              ? "ring-2 ring-emerald-500 border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20"
              : "hover:border-emerald-300 dark:hover:border-emerald-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Sudah Diganti (Lunas)
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatRupiah(summaryData?.reimbursed_total || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.reimbursed_count || 0}
                </span>{" "}
                nota telah diselesaikan
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Total Keseluruhan */}
        <Card
          onClick={() => {
            setStatusFilter("all");
            setPage(1);
          }}
          className={`cursor-pointer transition-all border rounded-2xl shadow-xs ${
            statusFilter === "all"
              ? "ring-2 ring-purple-500 border-purple-300 bg-purple-50/40 dark:bg-purple-950/20"
              : "hover:border-purple-300 dark:hover:border-purple-800 bg-white dark:bg-slate-900"
          }`}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Total Seluruh Talangan
              </span>
              <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-28 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(summaryData?.total_nominal || 0)}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {summaryData?.total_count || 0}
                </span>{" "}
                total nota tercatat
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Karyawan Terlibat */}
        <Card className="border rounded-2xl shadow-xs bg-white dark:bg-slate-900">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Karyawan Menalangi
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              {isSummaryLoading ? (
                <Skeleton className="h-7 w-16 rounded-lg" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {summaryData?.by_user?.length || 0} Orang
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {summaryData?.by_user?.filter((u) => u.pending_count > 0).length || 0}
                </span>{" "}
                orang menunggu ganti
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Rekap Saldo Talangan per Karyawan */}
      {summaryData && summaryData.by_user && summaryData.by_user.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                Rekap Saldo Talangan per Karyawan
              </h3>
              <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-200">
                {summaryData.by_user.length} Anggota
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsUsersExpanded((prev) => !prev)}
              className="h-8 text-xs text-slate-500 hover:text-slate-800 gap-1 px-2"
            >
              <span>{isUsersExpanded ? "Tutup Rekap" : "Buka Rekap"}</span>
              {isUsersExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {isUsersExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
              {summaryData.by_user.map((userGroup) => {
                const isSelected = selectedUserId === userGroup.user_id;
                const hasPending = userGroup.pending_count > 0;

                return (
                  <div
                    key={userGroup.user_id ?? "unknown"}
                    className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                      isSelected
                        ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/30 ring-1 ring-purple-400"
                        : "border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white text-xs font-bold text-purple-700">
                          <AvatarFallback>{getInitials(userGroup.user_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {userGroup.user_name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {userGroup.telegram_id ? `@ID: ${userGroup.telegram_id}` : "Input Web / Kasir"}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUserId(isSelected ? null : userGroup.user_id);
                          setPage(1);
                        }}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                          isSelected
                            ? "bg-purple-600 text-white border-purple-600"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                        }`}
                        title="Filter data khusus karyawan ini"
                      >
                        {isSelected ? "Filter Aktif" : "Filter"}
                      </button>
                    </div>

                    <div className="bg-white dark:bg-slate-950/50 border border-slate-200/60 dark:border-slate-800/80 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 text-[11px]">Belum Diganti:</span>
                        <span
                          className={`font-bold tabular-nums ${
                            hasPending ? "text-amber-600 dark:text-amber-400" : "text-slate-400"
                          }`}
                        >
                          {formatRupiah(userGroup.pending_total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Jumlah Nota:</span>
                        <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                          {userGroup.pending_count} pending / {userGroup.total_count} total
                        </span>
                      </div>
                    </div>

                    {hasPending && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSettleUserPending(userGroup)}
                        disabled={settleMutation.isPending}
                        className="w-full h-8 text-[11px] font-semibold rounded-lg border-amber-300 text-amber-800 bg-amber-50/60 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40 gap-1.5"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-amber-600" />
                        <span>Ganti Semua ({formatRupiah(userGroup.pending_total)})</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. Filter & Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-3">
        {/* Row 1: Status Tabs & Periode */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tab Pills */}
          <div className="flex items-center gap-1.5 bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("pending");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === "pending"
                  ? "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Belum Diganti</span>
              {summaryData && summaryData.pending_count > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold">
                  {summaryData.pending_count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusFilter("reimbursed");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === "reimbursed"
                  ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Sudah Diganti</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === "all"
                  ? "bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <span>Semua</span>
            </button>
          </div>

          {/* Periode Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isAllPeriods ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setIsAllPeriods((prev) => !prev);
                setPage(1);
              }}
              className="h-9 rounded-xl text-xs font-medium px-3 gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{isAllPeriods ? "Semua Waktu (Aktif)" : "Bulan Tertentu"}</span>
            </Button>

            {!isAllPeriods && (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-9 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden"
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-9 px-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden"
                >
                  {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Search, User Selector & Reset */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
          <div className="relative w-full sm:flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nama barang, toko, catatan, no nota..."
              className="h-9.5 pl-9 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Filter Karyawan */}
            <select
              value={selectedUserId !== null ? String(selectedUserId) : ""}
              onChange={(e) => {
                setSelectedUserId(e.target.value ? Number(e.target.value) : null);
                setPage(1);
              }}
              className="h-9.5 px-3 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium focus:outline-hidden w-full sm:w-44"
            >
              <option value="">Semua Karyawan</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter("pending");
                setIsAllPeriods(true);
                setSelectedUserId(null);
                setSearch("");
                setPage(1);
                setSelectedIds([]);
              }}
              title="Reset Filter"
              className="h-9.5 px-3 rounded-xl text-xs text-slate-600 hover:text-slate-900 border-slate-200 shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 5. Batch Action Toolbar (muncul jika ada item yang dicentang) */}
      {selectedIds.length > 0 && (
        <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 text-xs text-purple-900 dark:text-purple-200">
            <span className="font-bold bg-purple-200 dark:bg-purple-900/60 px-2 py-0.5 rounded-md tabular-nums">
              {selectedIds.length}
            </span>
            <span>item talangan dipilih</span>
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              ({formatRupiah(selectedNominal)})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleBatchSettle("mark_reimbursed")}
              disabled={settleMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold h-8.5 px-3.5 gap-1.5 shadow-xs"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Tandai Sudah Diganti</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBatchSettle("unmark")}
              disabled={settleMutation.isPending}
              className="rounded-xl text-xs font-semibold h-8.5 px-3.5 gap-1.5 text-slate-700 dark:text-slate-300"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Batal Ganti</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
              className="h-8.5 text-xs text-slate-500 hover:text-slate-800 px-2.5"
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {/* 6. Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 font-semibold select-none">
                <th className="py-3 px-3.5 w-10 text-center">
                  <Checkbox
                    checked={
                      expenses.length > 0 && selectedIds.length === expenses.length
                        ? true
                        : selectedIds.length > 0
                        ? "indeterminate"
                        : false
                    }
                    onCheckedChange={handleSelectAll}
                    aria-label="Pilih semua di halaman ini"
                  />
                </th>
                <th className="py-3 px-3 min-w-[100px]">Tanggal</th>
                <th className="py-3 px-3 min-w-[140px]">Karyawan</th>
                <th className="py-3 px-3 min-w-[200px]">Barang / Keperluan</th>
                <th className="py-3 px-3 min-w-[130px]">Toko / Supplier</th>
                <th className="py-3 px-3 min-w-[110px] text-right">Nominal</th>
                <th className="py-3 px-3 min-w-[140px]">Status Ganti</th>
                <th className="py-3 px-3 min-w-[130px]">Ket / Nota</th>
                <th className="py-3 px-3 w-28 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isExpensesLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-3 px-3.5 text-center">
                      <Skeleton className="h-4 w-4 rounded-sm mx-auto" />
                    </td>
                    <td className="py-3 px-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-3 px-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="py-3 px-3"><Skeleton className="h-4 w-36" /></td>
                    <td className="py-3 px-3"><Skeleton className="h-4 w-20" /></td>
                    <td className="py-3 px-3 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    <td className="py-3 px-3"><Skeleton className="h-5 w-24 rounded-full" /></td>
                    <td className="py-3 px-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="py-3 px-3 text-center"><Skeleton className="h-7 w-16 mx-auto rounded-lg" /></td>
                  </tr>
                ))
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-2.5 max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 flex items-center justify-center">
                        <FileCheck2 className="w-6 h-6" />
                      </div>
                      <div className="font-bold text-sm text-slate-800 dark:text-slate-200">
                        Tidak Ada Data Talangan
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                        {statusFilter === "pending"
                          ? "Hebat! Semua talangan karyawan pada filter ini sudah diganti lunas."
                          : "Belum ada catatan pengeluaran talangan yang sesuai dengan filter yang Anda pilih."}
                      </p>
                      {onAddNewTalangan && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onAddNewTalangan}
                          className="mt-2 text-xs rounded-xl h-8.5 gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Input Talangan Baru</span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                expenses.map((e) => {
                  const isChecked = selectedIds.includes(e.id);
                  const isReimbursed = !!e.reimbursed_at;
                  const tgLink = parseTelegramLink(e.msg_link);

                  return (
                    <tr
                      key={e.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        isChecked ? "bg-purple-50/40 dark:bg-purple-950/20" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3.5 text-center">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => handleToggleSelect(e.id)}
                          aria-label={`Pilih talangan #${e.id}`}
                        />
                      </td>

                      {/* Tanggal */}
                      <td className="py-3 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        <span className="font-medium">{formatDateId(e.expense_date)}</span>
                        <div className="text-[10px] text-slate-400">ID #{e.id}</div>
                      </td>

                      {/* Karyawan / Pemegang Talangan */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 text-[10px] font-bold">
                            <AvatarFallback>{getInitials(e.user_name || "HC")}</AvatarFallback>
                          </Avatar>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[110px]">
                            {e.user_name || "Web / Kasir"}
                          </span>
                        </div>
                      </td>

                      {/* Barang & Kategori */}
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight">
                          {e.item_name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {e.category && (
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1.5 py-0 font-medium text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                            >
                              {e.category}
                            </Badge>
                          )}
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {e.qty} {e.unit || "Pcs"}
                          </span>
                        </div>
                      </td>

                      {/* Toko / Supplier */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                        <span className="truncate block max-w-[120px]">{e.supplier || "-"}</span>
                      </td>

                      {/* Total Nominal */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatRupiah(e.total_price)}
                        </div>
                        <div className="text-[10px] text-slate-400">{e.pay_method || "Tunai"}</div>
                      </td>

                      {/* Status Penggantian */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {isReimbursed ? (
                          <div className="space-y-0.5">
                            <Badge
                              variant="outline"
                              className="text-[10px] font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Sudah Diganti</span>
                            </Badge>
                            {e.reimbursed_at && (
                              <div className="text-[10px] text-slate-400 tabular-nums">
                                {formatDateId(e.reimbursed_at)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Badge
                              variant="outline"
                              className="text-[10px] font-semibold text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 gap-1"
                            >
                              <Clock className="w-3 h-3" />
                              <span>Belum Diganti</span>
                            </Badge>
                            <button
                              type="button"
                              onClick={() => handleToggleReimbursed(e)}
                              disabled={settleMutation.isPending}
                              className="text-[10px] font-semibold text-purple-700 hover:text-purple-800 dark:text-purple-300 underline block"
                            >
                              Tandai Diganti
                            </button>
                          </div>
                        )}
                      </td>

                      {/* No Nota & Keterangan */}
                      <td className="py-3 px-3 text-slate-500 dark:text-slate-400">
                        {e.invoice_number && e.invoice_number !== "-" && (
                          <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                            #{e.invoice_number}
                          </div>
                        )}
                        <span className="truncate block max-w-[120px] text-[11px]">
                          {e.notes && e.notes !== "-" ? e.notes : "-"}
                        </span>
                        {tgLink?.isUrl && tgLink.url && (
                          <a
                            href={tgLink.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline mt-0.5"
                          >
                            <TelegramIcon className="w-3 h-3 text-[#229ED9]" />
                            <span>Telegram</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </td>

                      {/* Aksi */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {onViewExpense && (
                            <button
                              type="button"
                              onClick={() => onViewExpense(e)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
                              title="Lihat Detail Nota"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onEditExpense(e)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors"
                            title="Edit Data"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDelete(e.id)}
                              disabled={deletingId === e.id}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3.5 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>
              Menampilkan {expenses.length} dari {totalItems} talangan (Halaman {page} dari {totalPages})
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 px-2.5 text-xs rounded-lg"
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-8 px-2.5 text-xs rounded-lg"
              >
                Selanjutnya
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
