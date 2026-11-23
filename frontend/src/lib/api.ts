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
  UnpaidSummaryResponse,
  DailyCashflowResponse,
  SalesImportAuditSummary,
  MonthlyBudgetDetailResponse,
} from "@/types";

export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Request interceptor to attach CSRF token for mutating requests (cookie-based auth)
api.interceptors.request.use((config) => {
  const method = (config.method || "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = getCookieValue("catpen_csrf");
    if (csrfToken && config.headers) {
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});

export async function exchangeSsoToken(token: string) {
  const res = await api.post("/auth/sso-exchange", { token });
  return res.data;
}

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

export async function getAccountingReport(month?: number, year?: number, monthEnd?: number) {
  const params = new URLSearchParams();
  if (month) params.append("month", String(month));
  if (monthEnd) params.append("month_end", String(monthEnd));
  if (year) params.append("year", String(year));
  const res = await api.get(`/reports/accounting?${params.toString()}`);
  return res.data;
}

export async function getExpenseUsers() {
  const res = await api.get("/expenses/users/list");
  return res.data;
}

export async function getMonthlyBudget(
  year?: number,
  month?: number
): Promise<MonthlyBudgetDetailResponse> {
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
}): Promise<MonthlyBudgetDetailResponse> {
  const res = await api.post("/budgets", payload);
  return res.data;
}

export async function copyMonthlyBudget(
  targetYear: number,
  targetMonth: number,
  sourceYear?: number,
  sourceMonth?: number,
  usePreviousCashBalance: boolean = false
): Promise<MonthlyBudgetDetailResponse> {
  const res = await api.post("/budgets/copy", {
    target_year: targetYear,
    target_month: targetMonth,
    source_year: sourceYear,
    source_month: sourceMonth,
    use_previous_cash_balance: usePreviousCashBalance,
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
  supplier_type?: "toko" | "kurir" | string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: string;
}): Promise<SupplierListResponse> {
  const query = new URLSearchParams();
  if (params?.search?.trim()) query.set("search", params.search.trim());
  if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
  if (params?.has_unpaid !== undefined) query.set("has_unpaid", String(params.has_unpaid));
  if (params?.supplier_type && params.supplier_type !== "all") query.set("supplier_type", params.supplier_type);
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
  account_code?: string | null;
  account_name?: string | null;
  account_group?: string | null;
  report_type?: string | null;
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
    account_code?: string | null;
    account_name?: string | null;
    account_group?: string | null;
    report_type?: string | null;
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
  includeOngkir?: boolean;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<ReimbursementSummaryResponse> {
  const q = new URLSearchParams();
  if (params?.month) q.append("month", String(params.month));
  if (params?.year) q.append("year", String(params.year));
  if (params?.startDate) q.append("start_date", params.startDate);
  if (params?.endDate) q.append("end_date", params.endDate);
  if (params?.userId) q.append("user_id", String(params.userId));
  if (params?.includeOngkir) q.append("include_ongkir", "true");
  const res = await api.get(`/expenses/reimbursements/summary?${q.toString()}`);
  return res.data;
}

export async function settleReimbursements(payload: {
  expense_ids: number[];
  action: "mark_reimbursed" | "unmark";
  bank_account_id?: number | null;
}): Promise<{ ok: boolean; action: string; updated_count: number; updated_ids: number[] }> {
  const res = await api.post("/expenses/reimbursements/settle", payload);
  return res.data;
}

export async function getUnpaidSummary(params?: {
  month?: number | null;
  year?: number | null;
  supplierId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<UnpaidSummaryResponse> {
  const q = new URLSearchParams();
  if (params?.month) q.append("month", String(params.month));
  if (params?.year) q.append("year", String(params.year));
  if (params?.supplierId) q.append("supplier_id", String(params.supplierId));
  if (params?.startDate) q.append("start_date", params.startDate);
  if (params?.endDate) q.append("end_date", params.endDate);
  const res = await api.get(`/expenses/unpaid/summary?${q.toString()}`);
  return res.data;
}

export async function settleUnpaidExpenses(payload: {
  expense_ids: number[];
  action?: "mark_paid" | "mark_unpaid";
  bank_account_id?: number | null;
  pay_method?: string | null;
  payment_date?: string | null;
  reference_no?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; action: string; updated_count: number; updated_ids: number[] }> {
  const res = await api.post("/expenses/unpaid/settle", payload);
  return res.data;
}

export async function getExpensePayments(
  expenseId: number
): Promise<import("@/types").ExpensePayment[]> {
  const res = await api.get(`/expenses/${expenseId}/payments`);
  return res.data;
}

export async function recordExpensePayment(
  expenseId: number,
  payload: import("@/types").ExpensePaymentPayload
): Promise<Expense> {
  const res = await api.post(`/expenses/${expenseId}/payments`, payload);
  return res.data;
}

export async function deleteExpensePayment(
  expenseId: number,
  paymentId: number
): Promise<Expense> {
  const res = await api.delete(`/expenses/${expenseId}/payments/${paymentId}`);
  return res.data;
}

export async function getDataHygieneStats(): Promise<import("@/types").DataHygieneStats> {
  const res = await api.get("/expenses/data-hygiene");
  return res.data;
}

export async function runBulkDataClean(): Promise<import("@/types").BulkCleanResponse> {
  const res = await api.post("/expenses/bulk-clean");
  return res.data;
}

export async function checkInvoiceDuplicate(
  invoiceNumber: string,
  excludeId?: number
): Promise<{
  is_duplicate: boolean;
  invoice_number: string;
  existing_expense: {
    id: number;
    item_name: string;
    supplier: string;
    expense_date: string;
    total_price: number;
  } | null;
  message: string | null;
}> {
  if (!invoiceNumber || invoiceNumber.trim() === "-" || !invoiceNumber.trim()) {
    return { is_duplicate: false, invoice_number: "", existing_expense: null, message: null };
  }
  const q = new URLSearchParams({ invoice_number: invoiceNumber.trim() });
  if (excludeId) q.append("exclude_id", String(excludeId));
  const res = await api.get(`/expenses/check-invoice?${q.toString()}`);
  return res.data;
}

// ──────────────────────────────────────────────
// Purchase Requests (Request Belanja) API
// ──────────────────────────────────────────────

export async function getPurchaseRequests(params?: {
  status?: string;
  urgency?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<import("@/types").PurchaseRequestListResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== "ALL") query.append("status", params.status);
  if (params?.urgency && params.urgency !== "ALL") query.append("urgency", params.urgency);
  if (params?.search) query.append("search", params.search);
  if (params?.page) query.append("page", String(params.page));
  if (params?.limit) query.append("limit", String(params.limit));

  const res = await api.get(`/requests?${query.toString()}`);
  return res.data;
}

export async function getPurchaseRequestStats(): Promise<import("@/types").PurchaseRequestStats> {
  const res = await api.get("/requests/stats");
  return res.data;
}

export async function createPurchaseRequest(
  data: import("@/types").PurchaseRequestFormData
): Promise<import("@/types").PurchaseRequest> {
  const res = await api.post("/requests", data);
  return res.data;
}

export async function updatePurchaseRequest(
  id: number,
  data: Partial<import("@/types").PurchaseRequestFormData>
): Promise<import("@/types").PurchaseRequest> {
  const res = await api.patch(`/requests/${id}`, data);
  return res.data;
}

export async function submitPurchaseRequest(
  id: number
): Promise<import("@/types").PurchaseRequest> {
  const res = await api.post(`/requests/${id}/submit`);
  return res.data;
}

export async function approvePurchaseRequest(
  id: number
): Promise<import("@/types").PurchaseRequest> {
  const res = await api.post(`/requests/${id}/approve`);
  return res.data;
}

export async function rejectPurchaseRequest(
  id: number,
  reason: string = "Ditolak oleh admin"
): Promise<import("@/types").PurchaseRequest> {
  const res = await api.post(`/requests/${id}/reject`, { reason });
  return res.data;
}

export async function fulfillPurchaseRequest(
  id: number,
  expenseId?: number
): Promise<import("@/types").PurchaseRequest> {
  const query = expenseId ? `?expense_id=${expenseId}` : "";
  const res = await api.post(`/requests/${id}/fulfill${query}`);
  return res.data;
}

export async function deletePurchaseRequest(id: number): Promise<void> {
  await api.delete(`/requests/${id}`);
}

export async function getPurchasingOrders(): Promise<import("@/types").PurchasingSupplierGroup[]> {
  const res = await api.get("/requests/purchasing/orders");
  return res.data;
}

export async function getPurchasingSupplierOptions(
  itemId: number
): Promise<import("@/types").PurchasingSupplierOptionsResponse> {
  const res = await api.get(`/requests/purchasing/items/${itemId}/supplier-options`);
  return res.data;
}

export async function assignPurchasingSupplier(
  itemId: number,
  data: { supplier_id?: number | null; supplier_name?: string; estimated_price?: number }
): Promise<import("@/types").PurchaseRequestItem> {
  const res = await api.post(`/requests/purchasing/items/${itemId}/assign-supplier`, data);
  return res.data;
}

export async function addPurchasingItem(
  data: import("@/types").PurchasingItemCreateInput
): Promise<import("@/types").PurchaseRequestItem> {
  const res = await api.post("/requests/purchasing/items", data);
  return res.data;
}

export async function updatePurchasingItem(
  itemId: number,
  data: import("@/types").PurchasingItemUpdateInput
): Promise<import("@/types").PurchaseRequestItem> {
  const res = await api.patch(`/requests/purchasing/items/${itemId}`, data);
  return res.data;
}

export async function cancelPurchasingItem(
  itemId: number,
  reason: string
): Promise<import("@/types").PurchaseRequestItem> {
  const res = await api.post(`/requests/purchasing/items/${itemId}/cancel`, { reason });
  return res.data;
}

export async function generatePurchasingWhatsApp(data: {
  supplier_name: string;
  item_ids: number[];
  custom_notes?: string;
}): Promise<{ ok: boolean; text: string }> {
  const res = await api.post("/requests/purchasing/generate-whatsapp", data);
  return res.data;
}

export async function markPurchasingOrdered(
  itemIds: number[]
): Promise<{ ok: boolean; updated_count: number }> {
  const res = await api.post("/requests/purchasing/mark-ordered", { item_ids: itemIds });
  return res.data;
}

export async function getWarehouseIncoming(search?: string): Promise<import("@/types").PurchaseRequestItem[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await api.get(`/requests/warehouse/incoming${q}`);
  return res.data;
}

export async function receiveWarehouseItem(
  itemId: number,
  data: import("@/types").WarehouseReceiveItemInput
): Promise<import("@/types").PurchaseRequestItem> {
  const res = await api.post(`/requests/warehouse/items/${itemId}/receive`, data);
  return res.data;
}

// ── Rekening Setup (Bank Accounts) ────────────────────────────────────────────
export async function getBankAccounts(
  activeOnly = false
): Promise<import("@/types").BankAccount[]> {
  const res = await api.get(`/bank-accounts?active_only=${activeOnly}`);
  return res.data.accounts;
}

export async function createBankAccount(
  data: Partial<import("@/types").BankAccount>
): Promise<import("@/types").BankAccount> {
  const res = await api.post("/bank-accounts", data);
  return res.data.account;
}

export async function updateBankAccount(
  id: number,
  data: Partial<import("@/types").BankAccount>
): Promise<import("@/types").BankAccount> {
  const res = await api.put(`/bank-accounts/${id}`, data);
  return res.data.account;
}

export async function deleteBankAccount(id: number): Promise<void> {
  await api.delete(`/bank-accounts/${id}`);
}

// ── Daftar Transaksi Masuk ────────────────────────────────────────────────────
export async function getIncomingTransactions(params: {
  start_date?: string;
  end_date?: string;
  order_type?: string;
  payment_method?: string;
  status?: string;
  bank_account_id?: number;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  transactions: import("@/types").IncomingTransaction[];
  total_count: number;
  summary: import("@/types").IncomingTransactionsSummary;
  facets: { order_types: string[]; payment_methods: string[] };
}> {
  const res = await api.get("/incoming-transactions", { params });
  return res.data;
}

export async function createManualIncomingTransaction(
  data: import("@/types").ManualIncomingTxFormData
): Promise<import("@/types").IncomingTransaction> {
  const res = await api.post("/incoming-transactions", data);
  return res.data.transaction;
}

export async function updateIncomingTransaction(
  txId: number,
  data: Partial<import("@/types").ManualIncomingTxFormData>
): Promise<import("@/types").IncomingTransaction> {
  const res = await api.put(`/incoming-transactions/${txId}`, data);
  return res.data.transaction;
}

export async function reassignIncomingTxBankAccount(
  txId: number,
  bankAccountId: number | null
): Promise<import("@/types").IncomingTransaction> {
  const res = await api.patch(`/incoming-transactions/${txId}/bank-account`, {
    bank_account_id: bankAccountId,
  });
  return res.data.transaction;
}

export async function previewAiIncomingBankMapping(params: {
  start_date?: string;
  end_date?: string;
  order_type?: string;
  payment_method?: string;
  status?: string;
  search?: string;
  scope?: import("@/types").AiAccountMappingScope;
}): Promise<import("@/types").AiBankAccountMappingPreview> {
  const res = await api.post("/incoming-transactions/ai-map-accounts/preview", params);
  return res.data;
}

export async function applyAiIncomingBankMapping(params: {
  start_date?: string;
  end_date?: string;
  order_type?: string;
  payment_method?: string;
  status?: string;
  search?: string;
  scope: import("@/types").AiAccountMappingScope;
  mappings: Array<{
    order_type: string;
    payment_method: string;
    bank_account_id: number;
  }>;
  save_channel_mappings?: boolean;
}): Promise<import("@/types").AiBankAccountMappingApplyResult> {
  const res = await api.post("/incoming-transactions/ai-map-accounts/apply", params);
  return res.data;
}

export async function auditIncomingDuplicateTransactions(params?: {
  start_date?: string;
  end_date?: string;
  order_type?: string;
  payment_method?: string;
  status?: string;
  search?: string;
  include_medium?: boolean;
}): Promise<import("@/types").IncomingDuplicatesAuditResult> {
  const res = await api.get("/incoming-transactions/audit-duplicates", { params });
  return res.data;
}

export async function deleteIncomingDuplicateTransactions(params: {
  transaction_ids: number[];
  allow_reconciled?: boolean;
}): Promise<import("@/types").DeleteIncomingDuplicatesResult> {
  const res = await api.post("/incoming-transactions/audit-duplicates/delete", params);
  return res.data;
}

export async function deleteIncomingTransaction(txId: number): Promise<void> {
  await api.delete(`/incoming-transactions/${txId}`);
}

export async function previewSalesImport(
  file: File,
  sourceType = "auto",
  overrides?: Record<string, import("@/types").SalesImportRowOverride>
): Promise<import("@/types").SalesImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source_type", sourceType);
  if (overrides && Object.keys(overrides).length > 0) {
    formData.append("overrides_json", JSON.stringify(overrides));
  }
  const res = await api.post("/incoming-transactions/import/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.preview;
}

export async function commitSalesImport(
  file: File,
  sourceType = "auto",
  skipDuplicates = true,
  includeVoid = true,
  overrides?: Record<string, import("@/types").SalesImportRowOverride>
): Promise<{
  inserted_paid: number;
  inserted_void: number;
  duplicate_count: number;
  skipped_count: number;
  excluded_count?: number;
}> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source_type", sourceType);
  formData.append("skip_duplicates", String(skipDuplicates));
  formData.append("include_void", String(includeVoid));
  if (overrides && Object.keys(overrides).length > 0) {
    formData.append("overrides_json", JSON.stringify(overrides));
  }
  const res = await api.post("/incoming-transactions/import/commit", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.result;
}

export async function getIncomingAnalytics(params?: {
  start_date?: string;
  end_date?: string;
  order_type?: string;
  top_limit?: number;
}): Promise<import("@/types").IncomingAnalytics> {
  const res = await api.get("/incoming-transactions/analytics", { params });
  return res.data.analytics;
}

// ── Transfer Antar Rekening ───────────────────────────────────────────────────
export async function getBankTransfers(params?: {
  start_date?: string;
  end_date?: string;
  account_id?: number;
}): Promise<import("@/types").BankTransfer[]> {
  const res = await api.get("/bank-transfers", { params });
  return res.data.transfers;
}

export async function createBankTransfer(data: {
  transfer_date: string;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  admin_fee?: number;
  transfer_type: "setor_tunai" | "pencairan_platform" | "antar_rekening";
  reference_no?: string;
  notes?: string;
}): Promise<import("@/types").BankTransfer> {
  const res = await api.post("/bank-transfers", data);
  return res.data.transfer;
}

export async function deleteBankTransfer(id: number): Promise<void> {
  await api.delete(`/bank-transfers/${id}`);
}

// ── Rekonsiliasi Settlement & Mutasi Bank ─────────────────────────────────────
export async function previewReconciliation(
  file: File,
  mode: "mutasi_bank" | "settlement_platform",
  bankAccountId?: number | null
): Promise<import("@/types").ReconciliationPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", mode);
  if (bankAccountId) formData.append("bank_account_id", String(bankAccountId));
  const res = await api.post("/reconciliation/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.preview;
}

export async function applyReconciliation(payload: {
  incoming_matches: any[];
  expense_matches: any[];
}): Promise<{ reconciled_incoming: number; reconciled_expenses: number }> {
  const res = await api.post("/reconciliation/apply", payload);
  return res.data.result;
}

// ── Database Menu / Produk & HPP / Food Cost ──────────────────────────────────
export async function getMenus(params?: {
  search?: string;
  category?: string;
  hpp_status?: string;
  item_type?: string;
  sellable_only?: boolean;
  active_only?: boolean;
  anonymize?: boolean;
}): Promise<import("@/types").MenuListResponse> {
  const res = await api.get("/menus", { params });
  return res.data;
}

export async function getMenuDetail(
  menuId: number,
  anonymize = false
): Promise<import("@/types").MenuProduct> {
  const res = await api.get(`/menus/${menuId}`, { params: { anonymize } });
  return res.data.item;
}

export async function createMenu(
  payload: import("@/types").MenuProductPayload
): Promise<import("@/types").MenuProduct> {
  const res = await api.post("/menus", payload);
  return res.data.item;
}

export async function updateMenu(
  menuId: number,
  payload: Partial<import("@/types").MenuProductPayload>
): Promise<import("@/types").MenuProduct> {
  const res = await api.put(`/menus/${menuId}`, payload);
  return res.data.item;
}

export async function deleteMenu(menuId: number): Promise<void> {
  await api.delete(`/menus/${menuId}`);
}

export async function getMenuUsages(
  menuId: number,
  anonymize = false
): Promise<{
  ok: boolean;
  menu_id: number;
  count: number;
  usages: import("@/types").MenuUsageItem[];
}> {
  const res = await api.get(`/menus/${menuId}/usages`, { params: { anonymize } });
  return res.data;
}

export async function cloneMenu(
  menuId: number,
  payload: {
    new_name: string;
    scale_factor?: number;
    scale_packaging?: boolean;
    item_type?: import("@/types").MenuItemType;
  }
): Promise<import("@/types").MenuProduct> {
  const res = await api.post(`/menus/${menuId}/clone`, payload);
  return res.data.item;
}

export async function simulateMenuPriceImpact(
  adjustments: import("@/types").PriceAdjustmentInput[]
): Promise<import("@/types").PriceSimulationResponse> {
  const res = await api.post("/menus/simulate-price-impact", { adjustments });
  return res.data;
}

export async function getMenuPricingChannels(): Promise<{
  ok: boolean;
  channels: import("@/types").PricingChannelConfig[];
}> {
  const res = await api.get("/menus/pricing-channels");
  return res.data;
}

export async function updateMenuPricingChannels(
  channels: import("@/types").PricingChannelConfig[]
): Promise<{
  ok: boolean;
  channels: import("@/types").PricingChannelConfig[];
}> {
  const res = await api.put("/menus/pricing-channels", { channels });
  return res.data;
}

export async function importMenusFromPos(): Promise<{
  ok: boolean;
  added: number;
  skipped: number;
  total_pos_products: number;
}> {
  const res = await api.post("/menus/import-from-pos");
  return res.data;
}

export async function importMenusCsv(
  file: File,
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("update_existing", String(updateExisting));
  const res = await api.post("/menus/import-csv", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function anonymizeAllMenus(
  prefix = "MENU",
  preserveCustom = false
): Promise<{ ok: boolean; updated_count: number }> {
  const res = await api.post("/menus/anonymize-all", {
    prefix,
    preserve_custom: preserveCustom,
  });
  return res.data;
}

export async function downloadMenusCsv(params?: {
  search?: string;
  category?: string;
  hpp_status?: string;
  item_type?: string;
  sellable_only?: boolean;
  active_only?: boolean;
  anonymize?: boolean;
}): Promise<void> {
  const res = await api.get("/menus/export", {
    params,
    responseType: "blob",
  });
  const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = params?.anonymize ? "database_menu_hpp_anonim.csv" : "database_menu_hpp.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadMenusTemplateCsv(): Promise<void> {
  const res = await api.get("/menus/template-csv", { responseType: "blob" });
  const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "template_import_menu_hpp.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function getMenusJsonPayload(params?: {
  search?: string;
  category?: string;
  hpp_status?: string;
  item_type?: string;
  sellable_only?: boolean;
  active_only?: boolean;
  anonymize?: boolean;
}): Promise<any> {
  const res = await api.get("/menus/export-json", {
    params: { ...params, download: false },
  });
  return res.data;
}

export async function downloadMenusJson(params?: {
  search?: string;
  category?: string;
  hpp_status?: string;
  item_type?: string;
  sellable_only?: boolean;
  active_only?: boolean;
  anonymize?: boolean;
}): Promise<void> {
  const res = await api.get("/menus/export-json", {
    params: { ...params, download: true },
    responseType: "blob",
  });
  const blob = new Blob([res.data], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = params?.anonymize ? "database_menu_hpp_anonim.json" : "database_menu_hpp.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function bulkUpdateMenus(
  updates: Array<{
    id: number;
    selling_price?: number;
    hpp_manual?: number;
    hpp_mode?: import("@/types").MenuHppMode;
    is_active?: boolean;
  }>
): Promise<{ ok: boolean; updated_count: number }> {
  const res = await api.patch("/menus/bulk-update", { updates });
  return res.data;
}

export async function getMenuConversionHint(params: {
  masterItemId?: number | null;
  subMenuId?: number | null;
  recipeUnit: string;
}): Promise<{ yield_factor: number; reason: string }> {
  const res = await api.get("/menus/conversion-hint", {
    params: {
      master_item_id: params.masterItemId ?? undefined,
      sub_menu_id: params.subMenuId ?? undefined,
      recipe_unit: params.recipeUnit,
    },
  });
  return res.data;
}

export async function setMenuAnonymizeLock(
  locked: boolean
): Promise<{ ok: boolean; anonymize_locked: boolean }> {
  const res = await api.post("/menus/anonymize-lock", { locked });
  return res.data;
}

export async function createMenuShareToken(
  expireHours = 24
): Promise<{ ok: boolean; token: string; expire_hours: number; share_path: string; api_path: string }> {
  const res = await api.post("/menus/share-token", { expire_hours: expireHours });
  return res.data;
}

export async function getSharedAnonymousMenus(
  token: string,
  params?: { search?: string; category?: string; hpp_status?: string; item_type?: string }
): Promise<import("@/types").MenuListResponse> {
  const res = await api.get(`/menus/shared/${encodeURIComponent(token)}`, { params });
  return res.data;
}

// ──────────────────────────────────────────────
// Migrasi Ongkir & Inventaris Aset Tetap (SAK EMKM)
// ──────────────────────────────────────────────

export async function migrateLegacyOngkir(dryRun = false): Promise<{
  ok: boolean;
  dry_run: boolean;
  migrated_count: number;
  reclassified_from_operasional: number;
  created_couriers: number;
  message: string;
}> {
  const res = await api.post(`/suppliers/migrate-ongkir?dry_run=${dryRun}`);
  return res.data;
}

export async function getAssets(params?: {
  search?: string;
  status?: string;
  capitalization_status?: string;
  asset_group?: string;
  location?: string;
  as_of_year?: number;
  as_of_month?: number;
}): Promise<import("@/types").AssetListResponse> {
  const res = await api.get("/assets", { params });
  return res.data;
}

export async function getAssetDetail(
  assetId: number
): Promise<{ ok: boolean; asset: import("@/types").FixedAsset }> {
  const res = await api.get(`/assets/${assetId}`);
  return res.data;
}

export async function getAssetByQrToken(
  qrToken: string
): Promise<{ ok: boolean; asset: import("@/types").FixedAsset }> {
  const res = await api.get(`/assets/label/${encodeURIComponent(qrToken)}`);
  return res.data;
}

export async function createAsset(
  payload: Partial<import("@/types").FixedAsset>
): Promise<{ ok: boolean; asset: import("@/types").FixedAsset }> {
  const res = await api.post("/assets", payload);
  return res.data;
}

export async function updateAsset(
  assetId: number,
  payload: Partial<import("@/types").FixedAsset>
): Promise<{ ok: boolean; asset: import("@/types").FixedAsset }> {
  const res = await api.put(`/assets/${assetId}`, payload);
  return res.data;
}

export async function disposeAsset(
  assetId: number,
  payload: {
    disposed_at: string;
    disposal_type: string;
    disposal_proceeds?: number;
    disposal_notes?: string;
  }
): Promise<{ ok: boolean; asset: import("@/types").FixedAsset }> {
  const res = await api.post(`/assets/${assetId}/dispose`, payload);
  return res.data;
}

export async function addAssetMaintenance(
  assetId: number,
  payload: {
    maintenance_date: string;
    maintenance_type: string;
    vendor_name?: string;
    cost?: number;
    description: string;
    next_service_date?: string | null;
    service_warranty_until?: string | null;
    performed_by?: string;
    create_expense?: boolean;
    pay_method?: string;
  }
): Promise<{ ok: boolean; maintenance_id: number; asset: import("@/types").FixedAsset }> {
  const res = await api.post(`/assets/${assetId}/maintenances`, payload);
  return res.data;
}

export async function syncExistingAssets(): Promise<{
  ok: boolean;
  synced_expenses: number;
  created_assets: number;
  message: string;
}> {
  const res = await api.post("/assets/sync-existing");
  return res.data;
}

export async function reanalyzeAssets(payload?: {
  asset_capitalization_threshold?: number;
  asset_default_useful_life_months?: number;
}): Promise<import("@/types").AssetReanalyzeResult> {
  const res = await api.post("/assets/reanalyze", payload || {});
  return res.data;
}

// ──────────────────────────────────────────────
// Bulk Form & Import CSV Template (Asset, Supplier, Item, Menu)
// ──────────────────────────────────────────────

async function triggerCsvDownload(endpoint: string, filename: string): Promise<void> {
  const res = await api.get(endpoint, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadAssetCsvTemplate(): Promise<void> {
  return triggerCsvDownload("/assets/template-csv", "template_import_aset.csv");
}

export async function bulkCreateAssets(
  items: Array<Partial<import("@/types").FixedAsset>>
): Promise<{ ok: boolean; added: number; skipped: number; errors?: string[]; message: string }> {
  const res = await api.post("/assets/bulk", { items });
  return res.data;
}

export async function importAssetsCsv(
  file: File
): Promise<{ ok: boolean; added: number; skipped: number; errors?: string[]; message: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/assets/import-csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function downloadSupplierCsvTemplate(): Promise<void> {
  return triggerCsvDownload("/suppliers/template-csv", "template_import_supplier.csv");
}

export async function bulkCreateSuppliers(
  items: SupplierFormData[],
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; message: string }> {
  const res = await api.post("/suppliers/bulk", { items, update_existing: updateExisting });
  return res.data;
}

export async function importSuppliersCsv(
  file: File,
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; message: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("update_existing", String(updateExisting));
  const res = await api.post("/suppliers/import-csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function downloadMasterItemCsvTemplate(): Promise<void> {
  return triggerCsvDownload("/master-items/template-csv", "template_import_master_item.csv");
}

export async function bulkCreateMasterItemsStructured(
  items: Array<{
    item_name: string;
    category: string;
    default_supplier?: string;
    aliases?: string;
    satuan_beli?: string;
    tipe_satuan?: string;
    isi_paket?: string;
    satuan_ecer?: string;
    satuan_resep?: string | null;
    konversi_resep?: number | null;
  }>,
  defaultCategory = "Bahan Kue",
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; message?: string }> {
  const res = await api.post("/master-items/bulk", {
    items,
    default_category: defaultCategory,
    update_existing: updateExisting,
  });
  return res.data;
}

export async function autoFillMasterRecipeUnits(): Promise<{
  ok: boolean;
  updated: number;
  skipped: number;
  total: number;
  message: string;
}> {
  const res = await api.post("/master-items/auto-fill-recipe-units");
  return res.data;
}

export async function importMasterItemsCsv(
  file: File,
  defaultCategory = "Bahan Kue",
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; message: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("default_category", defaultCategory);
  form.append("update_existing", String(updateExisting));
  const res = await api.post("/master-items/import-csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function bulkCreateMenus(
  items: import("@/types").MenuProductPayload[],
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; message: string }> {
  const res = await api.post("/menus/bulk", { items, update_existing: updateExisting });
  return res.data;
}

export async function downloadIncomingTxTemplateCsv(): Promise<void> {
  return triggerCsvDownload(
    "/incoming-transactions/template-csv",
    "Transaction Import.csv"
  );
}

export async function exportIncomingTransactionsCsv(params?: {
  start_date?: string;
  end_date?: string;
  order_type?: string;
  payment_method?: string;
  status?: string;
  bank_account_id?: number;
  search?: string;
}): Promise<void> {
  const searchParams = new URLSearchParams();
  if (params?.start_date) searchParams.set("start_date", params.start_date);
  if (params?.end_date) searchParams.set("end_date", params.end_date);
  if (params?.order_type && params.order_type !== "all") searchParams.set("order_type", params.order_type);
  if (params?.payment_method && params.payment_method !== "all") searchParams.set("payment_method", params.payment_method);
  if (params?.status && params.status !== "all") searchParams.set("status", params.status);
  if (params?.bank_account_id !== undefined && params.bank_account_id !== null) {
    searchParams.set("bank_account_id", String(params.bank_account_id));
  }
  if (params?.search) searchParams.set("search", params.search);

  const qs = searchParams.toString();
  const endpoint = qs ? `/incoming-transactions/export?${qs}` : "/incoming-transactions/export";
  const today = new Date().toISOString().split("T")[0];
  return triggerCsvDownload(endpoint, `transaksi_masuk_${today}.csv`);
}

export async function bulkCreateIncomingTransactions(
  items: import("@/types").BulkIncomingTxRow[],
  updateExisting = true
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; message: string }> {
  const res = await api.post("/incoming-transactions/bulk", {
    items,
    update_existing: updateExisting,
  });
  return res.data;
}

export async function importIncomingTransactionsCsv(
  file: File,
  updateExisting = true
): Promise<{
  ok: boolean;
  added: number;
  updated: number;
  skipped: number;
  message: string;
  audit?: SalesImportAuditSummary;
}> {
  const form = new FormData();
  form.append("file", file);
  form.append("update_existing", String(updateExisting));
  const res = await api.post("/incoming-transactions/import-csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function getDailyCashflow(params?: {
  month?: number;
  monthEnd?: number;
  year?: number;
  startDate?: string;
  endDate?: string;
  bankAccountId?: number;
}): Promise<DailyCashflowResponse> {
  const q = new URLSearchParams();
  if (params?.month) q.append("month", String(params.month));
  if (params?.monthEnd) q.append("month_end", String(params.monthEnd));
  if (params?.year) q.append("year", String(params.year));
  if (params?.startDate) q.append("start_date", params.startDate);
  if (params?.endDate) q.append("end_date", params.endDate);
  if (params?.bankAccountId) q.append("bank_account_id", String(params.bankAccountId));
  const res = await api.get(`/reports/cashflow?${q.toString()}`);
  return res.data;
}

export async function exportDailyCashflowCsv(params?: {
  month?: number;
  monthEnd?: number;
  year?: number;
  startDate?: string;
  endDate?: string;
  bankAccountId?: number;
}): Promise<void> {
  const q = new URLSearchParams();
  if (params?.month) q.append("month", String(params.month));
  if (params?.monthEnd) q.append("month_end", String(params.monthEnd));
  if (params?.year) q.append("year", String(params.year));
  if (params?.startDate) q.append("start_date", params.startDate);
  if (params?.endDate) q.append("end_date", params.endDate);
  if (params?.bankAccountId) q.append("bank_account_id", String(params.bankAccountId));
  const endpoint = `/reports/cashflow/export?${q.toString()}`;
  const filename = params?.month && params?.year
    ? `cashflow_harian_${params.year}_${String(params.month).padStart(2, "0")}.csv`
    : `cashflow_harian_${new Date().toISOString().slice(0, 10)}.csv`;
  return triggerCsvDownload(endpoint, filename);
}









