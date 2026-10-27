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
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: string;
}): Promise<SupplierListResponse> {
  const query = new URLSearchParams();
  if (params?.search?.trim()) query.set("search", params.search.trim());
  if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
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
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));

  const queryStr = query.toString() ? `?${query.toString()}` : "";
  const res = await api.get(`/suppliers/${id}/expenses${queryStr}`);
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


