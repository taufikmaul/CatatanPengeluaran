import axios from "axios";
import {
  Expense,
  ExpenseFormData,
  ExpenseLog,
  ExpenseAuditResponse,
  Supplier,
  SupplierDetail,
  SupplierListResponse,
  SupplierTopItem,
  SupplierPriciestItem,
  SupplierDuplicateGroup,
  SupplierFormData,
  MasterDataOption,
  BackgroundJob,
  MasterItemMergeRequest,
  MasterItemMergeResponse,
  MasterItemAuditResponse,
  ReimbursementSummaryResponse,
} from "@/types";

export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Request interceptor to attach SSO token if available
api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("hcteams_token") ||
    localStorage.getItem("dashboard_session_token");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to catch 401 unauthorized
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Dispatch custom event for auth modal or redirect
      window.dispatchEvent(new CustomEvent("catpen:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export async function scanExpenseOcr(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/expenses/ocr", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function createExpenseBatch(items: ExpenseFormData[]) {
  const res = await api.post("/expenses/batch", { items });
  return res.data;
}

export async function getAiAnalysis(month?: number, year?: number, forceRefresh = false) {
  const params = new URLSearchParams();
  if (month) params.append("month", String(month));
  if (year) params.append("year", String(year));
  if (forceRefresh) params.append("force_refresh", "true");
  const res = await api.get(`/reports/ai-analysis?${params.toString()}`);
  return res.data;
}

export async function getExpenseUsers() {
  const res = await api.get("/expenses/users/list");
  return res.data;
}

export async function getMonthlyBudget(year?: number, month?: number) {
  const params = new URLSearchParams();
  if (year) params.append("year", String(year));
  if (month) params.append("month", String(month));
  const res = await api.get(`/budgets?${params.toString()}`);
  return res.data;
}

export async function saveMonthlyBudget(payload: {
  year: number;
  month: number;
  total_budget: number;
  category_percentages: Record<string, number>;
}) {
  const res = await api.post("/budgets", payload);
  return res.data;
}

export async function copyMonthlyBudget(
  targetYear: number,
  targetMonth: number,
  sourceYear?: number,
  sourceMonth?: number
) {
  const res = await api.post("/budgets/copy", {
    target_year: targetYear,
    target_month: targetMonth,
    source_year: sourceYear,
    source_month: sourceMonth,
  });
  return res.data;
}

export async function getExpenseLogs(expenseId: number): Promise<ExpenseLog[]> {
  const res = await api.get(`/expenses/${expenseId}/logs`);
  return res.data;
}

export async function getRecentExpenseLogs(limit: number = 50): Promise<ExpenseLog[]> {
  const res = await api.get(`/expenses/logs/recent?limit=${limit}`);
  return res.data;
}

export async function exportExpenseLogsCsv(action?: string, search?: string): Promise<void> {
  const params = new URLSearchParams();
  if (action && action !== "ALL") params.append("action", action);
  if (search?.trim()) params.append("search", search.trim());
  params.append("limit", "2000");

  const res = await api.get(`/expenses/logs/export?${params.toString()}`, {
    responseType: "blob",
  });

  const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  link.setAttribute("download", `log_aktivitas_belanja_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  link.parentNode?.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export async function restoreDeletedExpense(logId: number): Promise<Expense> {
  const res = await api.post(`/expenses/logs/${logId}/restore`);
  return res.data;
}

export async function getExpenseAuditDuplicates(params?: {
  min_similarity?: number;
  month?: number;
  year?: number;
  category?: string;
  limit?: number;
}): Promise<ExpenseAuditResponse> {
  const query = new URLSearchParams();
  if (params?.min_similarity !== undefined) {
    query.set("min_similarity", params.min_similarity.toString());
  }
  if (params?.month !== undefined) {
    query.set("month", params.month.toString());
  }
  if (params?.year !== undefined) {
    query.set("year", params.year.toString());
  }
  if (params?.category) {
    query.set("category", params.category);
  }
  if (params?.limit !== undefined) {
    query.set("limit", params.limit.toString());
  }
  const queryStr = query.toString() ? `?${query.toString()}` : "";
  const res = await api.get(`/expenses/audit-duplicates${queryStr}`);
  return res.data;
}

// ──────────────────────────────────────────────
// Master Supplier / Toko API
// ──────────────────────────────────────────────

export async function getSuppliers(params?: {
  search?: string;
  is_active?: boolean;
  has_unpaid?: boolean;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: string;
}): Promise<SupplierListResponse> {
  const query = new URLSearchParams();
  if (params?.search?.trim()) query.set("search", params.search.trim());
  if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
  if (params?.has_unpaid !== undefined) query.set("has_unpaid", String(params.has_unpaid));
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.sort_by) query.set("sort_by", params.sort_by);
  if (params?.sort_order) query.set("sort_order", params.sort_order);

  const queryStr = query.toString() ? `?${query.toString()}` : "";
  const res = await api.get(`/suppliers${queryStr}`);
  return res.data;
}

export async function getSupplierById(id: number): Promise<SupplierDetail> {
  const res = await api.get(`/suppliers/${id}`);
  return res.data;
}

export async function createSupplier(payload: SupplierFormData): Promise<Supplier> {
  const res = await api.post("/suppliers", payload);
  return res.data;
}

export async function updateSupplier(id: number, payload: Partial<SupplierFormData>): Promise<Supplier> {
  const res = await api.put(`/suppliers/${id}`, payload);
  return res.data;
}

export async function deleteSupplier(id: number): Promise<{ ok: boolean; message: string }> {
  const res = await api.delete(`/suppliers/${id}`);
  return res.data;
}

export async function getSupplierExpenses(
  id: number,
  params?: {
    start_date?: string;
    end_date?: string;
    category?: string;
    pay_status?: string;
    page?: number;
    limit?: number;
  }
): Promise<{
  ok: boolean;
  data: Expense[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}> {
  const query = new URLSearchParams();
  if (params?.start_date) query.set("start_date", params.start_date);
  if (params?.end_date) query.set("end_date", params.end_date);
  if (params?.category) query.set("category", params.category);
  if (params?.pay_status) query.set("pay_status", params.pay_status);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));

  const queryStr = query.toString() ? `?${query.toString()}` : "";
  const res = await api.get(`/suppliers/${id}/expenses${queryStr}`);
  return res.data;
}

export async function updateSupplierExpensePayStatus(
  supplierId: number,
  expenseId: number,
  payStatus: string = "Lunas"
): Promise<Expense> {
  const res = await api.patch(`/suppliers/${supplierId}/expenses/${expenseId}/pay-status`, {
    pay_status: payStatus,
  });
  return res.data;
}

export async function getSupplierTopItems(id: number, limit: number = 10): Promise<SupplierTopItem[]> {
  const res = await api.get(`/suppliers/${id}/top-items?limit=${limit}`);
  return res.data;
}

export async function getSupplierPriciestItems(id: number, limit: number = 10): Promise<SupplierPriciestItem[]> {
  const res = await api.get(`/suppliers/${id}/priciest-items?limit=${limit}`);
  return res.data;
}

export async function createSupplierExpense(id: number, payload: ExpenseFormData): Promise<Expense> {
  const res = await api.post(`/suppliers/${id}/expenses`, payload);
  return res.data;
}

export async function deleteSupplierExpense(
  supplierId: number,
  expenseId: number
): Promise<{ ok: boolean; message: string }> {
  const res = await api.delete(`/suppliers/${supplierId}/expenses/${expenseId}`);
  return res.data;
}

export async function syncSupplierExpenses(): Promise<{
  synced_count: number;
  created_suppliers: number;
  message: string;
}> {
  const res = await api.post("/suppliers/sync-existing");
  return res.data;
}

export async function getSupplierAuditDuplicates(threshold: number = 0.75): Promise<SupplierDuplicateGroup[]> {
  const res = await api.get(`/suppliers/audit-duplicates?threshold=${threshold}`);
  return res.data;
}

export async function mergeSuppliers(
  targetSupplierId: number,
  sourceSupplierIds: number[]
): Promise<{
  success: boolean;
  target_supplier_id: number;
  target_supplier_name: string;
  merged_supplier_count: number;
  expenses_transferred: number;
}> {
  const res = await api.post("/suppliers/merge", {
    target_supplier_id: targetSupplierId,
    source_supplier_ids: sourceSupplierIds,
  });
  return res.data;
}

// ──────────────────────────────────────────────
// Master Data API (Metode Bayar, Kategori, Satuan)
// ──────────────────────────────────────────────

export async function getMasterData(type?: string): Promise<MasterDataOption[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  const res = await api.get(`/config/master-data${query}`);
  return res.data.items || [];
}

export async function createMasterData(payload: {
  type: string;
  name: string;
  description?: string;
  sort_order?: number;
  is_default?: boolean;
}): Promise<{ ok: boolean; item: MasterDataOption; message?: string }> {
  const res = await api.post("/config/master-data", payload);
  return res.data;
}

export async function updateMasterData(
  id: number,
  payload: {
    name?: string;
    description?: string;
    sort_order?: number;
    is_active?: boolean;
    is_default?: boolean;
  }
): Promise<{ ok: boolean; item: MasterDataOption; message?: string }> {
  const res = await api.put(`/config/master-data/${id}`, payload);
  return res.data;
}

export async function deleteMasterData(
  id: number,
  force: boolean = false
): Promise<{ ok: boolean; message: string }> {
  const query = force ? "?force=true" : "";
  const res = await api.delete(`/config/master-data/${id}${query}`);
  return res.data;
}

export async function resetMasterDataDefaults(
  type?: string
): Promise<{ ok: boolean; message: string; restored_count?: number }> {
  const res = await api.post("/config/master-data/reset-defaults", { type });
  return res.data;
}

// ──────────────────────────────────────────────
// Background Queue & Actions API
// ──────────────────────────────────────────────

export async function getBackgroundJobs(params?: {
  limit?: number;
  status?: string;
  job_type?: string;
}): Promise<BackgroundJob[]> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.status) query.set("status", params.status);
  if (params?.job_type) query.set("job_type", params.job_type);

  const queryStr = query.toString() ? `?${query.toString()}` : "";
  const res = await api.get(`/jobs${queryStr}`);
  return res.data;
}

export async function getBackgroundJob(jobId: string): Promise<BackgroundJob> {
  const res = await api.get(`/jobs/${jobId}`);
  return res.data;
}

export async function cancelBackgroundJob(jobId: string): Promise<{ ok: boolean; message: string }> {
  const res = await api.post(`/jobs/${jobId}/cancel`);
  return res.data;
}

export async function getMasterItemAuditDuplicates(params?: {
  min_score?: number;
  limit?: number;
  supplier?: string;
  supplier_id?: number;
  strict_supplier?: boolean;
}): Promise<MasterItemAuditResponse> {
  const query = new URLSearchParams();
  if (params?.min_score !== undefined) query.set("min_score", String(params.min_score));
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.supplier) query.set("supplier", params.supplier);
  if (params?.supplier_id !== undefined) query.set("supplier_id", String(params.supplier_id));
  if (params?.strict_supplier !== undefined) query.set("strict_supplier", String(params.strict_supplier));
  const qStr = query.toString() ? `?${query.toString()}` : "";
  const res = await api.get(`/master-items/audit-duplicates${qStr}`);
  return res.data;
}

export async function mergeMasterItems(payload: MasterItemMergeRequest): Promise<MasterItemMergeResponse> {
  const res = await api.post("/master-items/merge", payload);
  return res.data;
}

export async function enqueueMasterItemAudit(params?: {
  min_score?: number;
  limit?: number;
  supplier?: string;
  supplier_id?: number;
  strict_supplier?: boolean;
}): Promise<BackgroundJob> {
  const res = await api.post("/jobs/audit/master-items", {
    min_score: params?.min_score ?? 0.7,
    limit: params?.limit ?? 150,
    supplier: params?.supplier,
    supplier_id: params?.supplier_id,
    strict_supplier: params?.strict_supplier ?? false,
  });
  return res.data;
}

export async function enqueueSupplierAudit(threshold: number = 0.75): Promise<BackgroundJob> {
  const res = await api.post("/jobs/audit/suppliers", { threshold });
  return res.data;
}

export async function enqueueExpenseAudit(params?: {
  min_similarity?: number;
  month?: number;
  year?: number;
  category?: string;
  limit?: number;
}): Promise<BackgroundJob> {
  const res = await api.post("/jobs/audit/expenses", {
    min_similarity: params?.min_similarity ?? 0.9,
    month: params?.month,
    year: params?.year,
    category: params?.category,
    limit: params?.limit ?? 150,
  });
  return res.data;
}

export async function enqueueMergeMasterItems(payload: MasterItemMergeRequest): Promise<BackgroundJob> {
  const res = await api.post("/jobs/merge/master-items", payload);
  return res.data;
}

export async function enqueueMergeSuppliers(
  targetId: number,
  sourceIds: number[]
): Promise<BackgroundJob> {
  const res = await api.post("/jobs/merge/suppliers", {
    target_id: targetId,
    source_ids: sourceIds,
  });
  return res.data;
}

export async function enqueueBatchMergeMasterItems(
  merges: Array<{
    target_item_id: number;
    source_item_ids: number[];
    custom_name?: string | null;
    custom_category?: string | null;
    custom_supplier?: string | null;
    merge_aliases?: boolean;
    update_expenses?: boolean;
  }>
): Promise<BackgroundJob> {
  const res = await api.post("/jobs/merge/batch-master-items", { merges });
  return res.data;
}

export async function getReimbursementSummary(params?: {
  month?: number | null;
  year?: number | null;
  userId?: number | null;
}): Promise<ReimbursementSummaryResponse> {
  const q = new URLSearchParams();
  if (params?.month) q.append("month", String(params.month));
  if (params?.year) q.append("year", String(params.year));
  if (params?.userId) q.append("user_id", String(params.userId));
  const res = await api.get(`/expenses/reimbursements/summary?${q.toString()}`);
  return res.data;
}

export async function settleReimbursements(payload: {
  expense_ids: number[];
  action: "mark_reimbursed" | "unmark";
}): Promise<{ ok: boolean; action: string; updated_count: number; updated_ids: number[] }> {
  const res = await api.post("/expenses/reimbursements/settle", payload);
  return res.data;
}




