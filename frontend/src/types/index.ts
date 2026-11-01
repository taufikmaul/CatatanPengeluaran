export interface Expense {
  id: number;
  created_at?: string;
  expense_date: string;
  supplier: string;
  item_name: string;
  qty: number;
  unit?: string;
  category: string;
  unit_price: number;
  shipping_fee?: number;
  tax: number;
  other_fee?: number;
  discount: number;
  total_price: number;
  pay_method: string;
  pay_status: string;
  due_date: string;
  notes: string;
  msg_link: string;
  is_reimbursement?: boolean;
  invoice_number?: string;
  reimbursed_at?: string | null;
  user_id?: number | null;
  user_name?: string | null;
  master_item_id?: number | null;
  supplier_id?: number | null;
  sheets_synced: boolean;
}

export interface ExpenseUser {
  id: number;
  name: string;
  telegram_id?: number | null;
  is_auth?: boolean;
}

export interface ExpenseLog {
  id: number;
  expense_id: number | null;
  action: string;
  actor: string;
  details: string | null;
  created_at: string;
}

export interface ExpenseListResponse {
  ok: boolean;
  data: Expense[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface ReimbursementUserSummary {
  user_id: number | null;
  user_name: string;
  telegram_id?: number | null;
  pending_count: number;
  pending_total: number;
  reimbursed_count: number;
  reimbursed_total: number;
  total_count: number;
  total_nominal: number;
}

export interface ReimbursementSummaryResponse {
  ok: boolean;
  pending_count: number;
  pending_total: number;
  reimbursed_count: number;
  reimbursed_total: number;
  total_count: number;
  total_nominal: number;
  by_user: ReimbursementUserSummary[];
}

export interface UnpaidNearestDue {
  expense_id: number;
  item_name: string;
  supplier: string;
  total_price: number;
  due_date: string;
  parsed_due_date: string;
  days_left: number;
  urgency: "overdue" | "today" | "soon" | "upcoming" | "unknown" | string;
}

export interface UnpaidSupplierSummary {
  supplier_id: number | null;
  supplier_name: string;
  unpaid_count: number;
  unpaid_total: number;
  paid_count: number;
  paid_total: number;
  total_count: number;
  total_nominal: number;
  nearest_due_date: string | null;
  nearest_days_left: number | null;
  has_overdue: boolean;
}

export interface UnpaidSummaryResponse {
  ok: boolean;
  unpaid_count: number;
  unpaid_total: number;
  paid_count: number;
  paid_total: number;
  total_count: number;
  total_nominal: number;
  overdue_count: number;
  overdue_total: number;
  due_soon_count: number;
  due_today_count: number;
  no_due_date_count: number;
  nearest_due: UnpaidNearestDue | null;
  by_supplier: UnpaidSupplierSummary[];
}

export interface TopFrequentItem {
  item_name: string;
  category: string;
  count: number;
  total_qty: number;
  total_spent: number;
  avg_unit_price: number;
}

export interface TopExpensiveItem {
  item_name: string;
  category: string;
  total_spent: number;
  count: number;
  total_qty: number;
  max_unit_price: number;
  percentage: number;
}

export interface TopUnitPriceItem {
  item_name: string;
  category: string;
  supplier: string;
  unit_price: number;
  last_date: string;
}

export interface TopPriceSpikeItem {
  item_name: string;
  category: string;
  supplier: string;
  previous_price: number;
  current_price: number;
  diff_price: number;
  percent_change: number;
  previous_date: string;
  latest_date: string;
}

export interface TopSupplierItem {
  supplier: string;
  count: number;
  total_spent: number;
  percentage: number;
}

export interface SummaryMetrics {
  daily_average: number;
  average_per_transaction: number;
  max_single_transaction?: {
    item_name: string;
    supplier: string;
    amount: number;
    date: string;
    category: string;
  } | null;
  unique_items_count: number;
  unique_suppliers_count: number;
  active_days_count: number;
}

export interface UnpaidExpenseItem {
  id?: number;
  barang: string;
  supplier?: string;
  nominal: number;
  tempo: string;
  tanggal?: string;
  kategori?: string;
  status?: string;
}

export interface AccountingBreakdownItem {
  account_code: string;
  account_name: string;
  account_group: "HPP" | "OPEX" | "ASSET" | "CASH_TRANSFER" | string;
  report_type: "LABA_RUGI" | "NERACA" | "ARUS_KAS" | string;
  category: string;
  total: number;
  percentage: number;
  prev_total?: number;
  mom_change_pct?: number | null;
}

export interface AccountLineItem {
  account_code: string;
  account_name: string;
  category: string;
  account_group: string;
  report_type: string;
  total: number;
  prev_total: number;
  diff_nominal: number;
  mom_change_pct: number | null;
  percentage_of_group: number;
  percentage_of_total_expense: number;
  transaction_count: number;
  description?: string;
}

export interface LabaRugiReportData {
  hpp_items: AccountLineItem[];
  subtotal_hpp: number;
  prev_subtotal_hpp: number;
  mom_hpp_change_pct: number | null;
  opex_items: AccountLineItem[];
  subtotal_opex: number;
  prev_subtotal_opex: number;
  mom_opex_change_pct: number | null;
  total_beban: number;
  prev_total_beban: number;
  mom_beban_change_pct: number | null;
}

export interface NeracaItemData {
  account_code: string;
  account_name: string;
  group: string;
  nominal: number;
  description: string;
}

export interface NeracaReportData {
  aset_lancar: NeracaItemData[];
  subtotal_aset_lancar: number;
  aset_tetap: NeracaItemData[];
  subtotal_aset_tetap: number;
  total_aset: number;
  kewajiban_lancar: NeracaItemData[];
  subtotal_kewajiban: number;
  detail_hutang: UnpaidExpenseItem[];
}

export interface ArusKasItemData {
  activity: string;
  account_name: string;
  nominal: number;
  percentage: number;
}

export interface ArusKasReportData {
  aktivitas_operasi: ArusKasItemData[];
  subtotal_operasi: number;
  aktivitas_investasi: ArusKasItemData[];
  subtotal_investasi: number;
  aktivitas_kliring: ArusKasItemData[];
  subtotal_kliring: number;
  total_kas_keluar_riil: number;
  metode_bayar_distribution: Array<{
    metode: string;
    nominal: number;
    percentage: number;
  }>;
}

export interface HealthEvaluationItem {
  key: string;
  title: string;
  value: string;
  ideal_range: string;
  status: "healthy" | "warning" | "danger" | "neutral";
  note: string;
}

export interface AccountingAnalysisData {
  cost_structure: {
    hpp_ratio: number;
    opex_ratio: number;
    bahan_ratio: number;
    gaji_ratio: number;
    sewa_ratio: number;
    marketing_ratio: number;
    maintenance_ratio: number;
    software_ratio: number;
    utilitas_ratio: number;
  };
  top_variances_mom: {
    top_increases: AccountLineItem[];
    top_savings: AccountLineItem[];
  };
  health_evaluation: HealthEvaluationItem[];
}

export interface AccountingReportData {
  ok: boolean;
  month: number;
  year: number;
  month_name: string;
  prev_month_name: string;
  laba_rugi: LabaRugiReportData;
  neraca: NeracaReportData;
  arus_kas: ArusKasReportData;
  analisis: AccountingAnalysisData;
  all_accounts: AccountLineItem[];
}

export interface AccountingInflation {
  laba_rugi_inflation_pct?: number | null;
  hpp_inflation_pct?: number | null;
  opex_inflation_pct?: number | null;
  asset_change_pct?: number | null;
  prev_laba_rugi_total?: number;
  prev_hpp_total?: number;
  prev_opex_total?: number;
  prev_asset_total?: number;
  price_inflation_pct?: number | null;
  items_compared_count?: number;
  items_inflated_count?: number;
  items_deflated_count?: number;
  items_stable_count?: number;
  top_inflated_items?: Array<{
    item_name: string;
    category: string;
    unit: string;
    previous_price: number;
    current_price: number;
    diff_price: number;
    percent_change: number;
  }>;
}

export interface MonthlyReport {
  ok: boolean;
  month: number;
  year: number;
  month_name: string;
  total_lunas: number;
  total_pengeluaran: number;
  total_tukar_cash?: number;
  tukar_cash_count?: number;
  total_ongkir?: number;
  ongkir_count?: number;
  ongkir_reimburse_count?: number;
  ongkir_reimburse_total?: number;
  total_belanja_riil?: number;
  expense_count: number;
  prev_month_name?: string | null;
  prev_total_lunas?: number;
  prev_total_pengeluaran?: number;
  mom_lunas_change_pct?: number | null;
  mom_total_change_pct?: number | null;
  monthly_budget_limit?: number;
  budget_used_pct?: number | null;
  category_budgets?: Record<string, number>;
  category_budget_percentages?: Record<string, number>;
  is_custom_budget?: boolean;
  per_kategori: Record<string, number>;
  per_metode_bayar?: Record<string, number>;
  per_account_group?: Record<string, number>;
  prev_per_account_group?: Record<string, number>;
  mom_account_group_change_pct?: Record<string, number | null>;
  accounting_inflation?: AccountingInflation;
  accounting_breakdown?: AccountingBreakdownItem[];
  list_hutang: UnpaidExpenseItem[];
  daily_chart: Array<{
    date: string;
    total: number;
    count: number;
  }>;
  valid_categories: string[];
  valid_units?: string[];
  reimburse_pending_count?: number;
  reimburse_pending_total?: number;
  top_frequent_items?: TopFrequentItem[];
  top_expensive_items?: TopExpensiveItem[];
  top_unit_price_items?: TopUnitPriceItem[];
  top_price_spikes?: TopPriceSpikeItem[];
  top_suppliers?: TopSupplierItem[];
  summary_metrics?: SummaryMetrics;
}

export interface MasterItem {
  id: number;
  item_name: string;
  category: string;
  default_supplier: string;
  aliases: string;
  satuan_beli?: string;
  tipe_satuan?: "paket" | "ecer" | "keduanya";
  isi_paket?: string;
  satuan_ecer?: string;
  last_unit_price: number;
  last_supplier: string;
  tx_count: number;
  created_at?: string;
}

export interface DuplicatePair {
  item_a: MasterItem;
  item_b: MasterItem;
  similarity_score: number;
  match_type: "substring" | "prefix_suffix" | "fuzzy" | "alias";
  reason: string;
  suggested_primary_id: number;
  both_in_supplier?: boolean;
}

export interface MasterItemAuditResponse {
  ok: boolean;
  total_duplicates: number;
  pairs: DuplicatePair[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobType =
  | "audit_master_items"
  | "audit_suppliers"
  | "audit_expenses"
  | "merge_master_items"
  | "merge_suppliers"
  | "batch_merge_items";

export interface BackgroundJob {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  progress: number;
  progress_message: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  payload: Record<string, any>;
  result?: any;
  error?: string | null;
  actor: string;
}

export interface MasterItemMergeRequest {
  target_item_id: number;
  source_item_ids: number[];
  custom_name?: string | null;
  custom_category?: string | null;
  custom_supplier?: string | null;
  custom_satuan_beli?: string | null;
  custom_tipe_satuan?: string | null;
  custom_isi_paket?: string | null;
  custom_satuan_ecer?: string | null;
  merge_aliases?: boolean;
  update_expenses?: boolean;
}

export interface MasterItemMergeResponse {
  ok: boolean;
  message: string;
  target_item: MasterItem;
  merged_sources: string[];
  expenses_reassigned_count: number;
  aliases_added: string[];
}

export interface ItemSuggestion {
  id?: number | null;
  item_name: string;
  category: string;
  aliases?: string;
  satuan_beli?: string;
  tipe_satuan?: "paket" | "ecer" | "keduanya";
  isi_paket?: string;
  satuan_ecer?: string;
  last_unit_price: number;
  last_supplier: string;
  last_date?: string | null;
  tx_count: number;
  is_master: boolean;
}

export type UserRole = "admin" | "admin_input" | "purchasing" | "warehouse" | "staff";

export interface AuthPermissions {
  can_edit: boolean;
  can_delete: boolean;
  can_view_charts: boolean;
  can_manage_config: boolean;
  can_manage_requests?: boolean;
  can_approve_requests?: boolean;
  can_order_purchasing?: boolean;
  can_receive_warehouse?: boolean;
  can_settle_talangan?: boolean;
  can_access_warehouse?: boolean;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: string | null;
  role?: UserRole | null;
  permissions?: AuthPermissions | null;
}

export interface SuggestionsResponse {
  ok: boolean;
  items: ItemSuggestion[];
  suppliers: string[];
}

export interface MasterDataOption {
  id: number;
  type: "kategori" | "metode_bayar" | "satuan";
  name: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
  account_code?: string | null;
  account_name?: string | null;
  account_group?: string | null;
  report_type?: string | null;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface SystemConfig {
  ok: boolean;
  total_expenses: number;
  unsynced_count: number;
  telegram_token_masked: string;
  telegram_token?: string;
  dashboard_pin_chat_id?: string;
  dashboard_pin_thread_id?: number | null;
  allowed_thread_id: number;
  allowed_thread_ids?: string;
  tukar_cash_thread_ids?: string;
  ongkir_thread_ids?: string;
  report_chat_id: string;
  report_thread_id: number;
  bot_password?: string;
  admin_input_password?: string;
  purchasing_password?: string;
  warehouse_password?: string;
  staff_password?: string;
  request_belanja_chat_id?: string;
  request_belanja_thread_id?: number | null;
  webhook_url?: string;
  ai_provider: string;
  ai_url: string;
  ai_model: string;
  sumopod_api_key?: string;
  ai_key_masked: string;
  system_prompt: string;
  spreadsheet_id: string;
  sheets_creds_path: string;
  sheets_creds_exists: boolean;
  service_account_email?: string | null;
  valid_categories: string[];
  valid_units?: string[];
  payment_methods?: string[];
  units?: string[];
  master_data?: Record<string, MasterDataOption[]>;
  monthly_budget_limit?: number;
  category_budgets?: Record<string, number>;
}

export interface SupplierPriceComparison {
  supplier: string;
  min_price: number;
  max_price: number;
  latest_price: number;
  last_date: string;
  tx_count: number;
}

export interface ItemPriceHistoryResponse {
  ok: boolean;
  item_name: string;
  master_item_id?: number | null;
  tx_count: number;
  min_price: number;
  max_price: number;
  avg_price: number;
  latest_price: number;
  cheapest_supplier: string;
  suppliers_comparison: SupplierPriceComparison[];
  history: Array<{
    id: number;
    expense_date: string;
    supplier: string;
    item_name: string;
    qty: number;
    unit?: string;
    unit_price: number;
    total_price: number;
    category: string;
    notes: string;
    master_item_id?: number | null;
  }>;
}

export interface ExpenseFormData {
  expense_date: string;
  supplier: string;
  item_name: string;
  qty: number;
  unit?: string;
  category: string;
  unit_price: number;
  shipping_fee?: number;
  tax: number;
  other_fee?: number;
  discount: number;
  total_price: number;
  pay_method: string;
  pay_status: string;
  due_date: string;
  notes: string;
  is_reimbursement?: boolean;
  invoice_number?: string;
  msg_link?: string;
  user_id?: number | null;
  master_item_id?: number | null;
  supplier_id?: number | null;
}

export interface OcrExtractedItem {
  barang?: string;
  qty?: number;
  satuan?: string;
  unit?: string;
  harga_satuan?: number;
  ongkir?: number;
  shipping_fee?: number;
  tax?: number;
  biaya_lainnya?: number;
  other_fee?: number;
  diskon?: number;
  total_harga?: number;
  kategori?: string;
  toko_supplier?: string;
  tanggal?: string;
  metode_bayar?: string;
  status_pembayaran?: string;
  no_invoice?: string;
  is_reimbursement?: boolean;
  keterangan?: string;
}

export interface OcrScanResponse {
  ok: boolean;
  message?: string;
  items?: OcrExtractedItem[];
}

export interface AiAnalysisData {
  ok: boolean;
  month: number;
  year: number;
  month_name: string;
  health_status: "SEHAT" | "PERLU_PERHATIAN" | "KRITIS";
  health_score: number;
  summary: string;
  key_insights: string[];
  budget_analysis: string;
  price_alerts: string[];
  actionable_recommendations: string[];
  markdown_report: string;
  analyzed_at: string;
  cached: boolean;
}

export interface MonthlyBudgetDetail {
  ok: boolean;
  year: number;
  month: number;
  total_budget: number;
  category_percentages: Record<string, number>;
  category_amounts: Record<string, number>;
  is_custom: boolean;
  valid_categories: string[];
  valid_units?: string[];
  message?: string;
}

export interface MonthlyBudgetUpsertPayload {
  year: number;
  month: number;
  total_budget: number;
  category_percentages: Record<string, number>;
}

export interface ExpenseDuplicatePair {
  expense_a: Expense;
  expense_b: Expense;
  similarity_score: number;
  similarity_pct: number;
  expense_date: string;
  total_price: number;
  reason: string;
  suggested_keep_id: number;
  suggested_delete_id: number;
}

export interface ExpenseAuditResponse {
  ok: boolean;
  total_duplicates: number;
  total_potential_waste: number;
  pairs: ExpenseDuplicatePair[];
}

export interface DataHygieneStats {
  total_expenses: number;
  unlinked_master_item_count: number;
  unlinked_supplier_count: number;
  unnormalized_units_count: number;
  unnormalized_pay_methods_count: number;
  unnormalized_categories_count: number;
  hygiene_score: number;
  is_clean: boolean;
}

export interface BulkCleanResponse {
  ok: boolean;
  message: string;
  items_matched: number;
  suppliers_synced: number;
  units_normalized: number;
  pay_methods_normalized: number;
  categories_normalized: number;
  total_changes: number;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  address: string;
  aliases: string;
  notes: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  total_spent: number;
  transaction_count: number;
  unpaid_bills_count: number;
  unpaid_bills_total: number;
  last_expense_date: string | null;
}

export interface SupplierUnpaidBillItem {
  id: number;
  expense_date: string;
  item_name: string;
  total_price: number;
  due_date: string;
  invoice_number: string;
  notes: string;
  category: string;
  pay_method: string;
  pay_status: string;
}

export interface SupplierDetail extends Supplier {
  avg_per_transaction: number;
  first_expense_date: string | null;
  unpaid_bills: SupplierUnpaidBillItem[];
}

export interface SupplierListSummary {
  total_suppliers: number;
  total_spent: number;
  total_unpaid_amount: number;
  unpaid_suppliers_count: number;
}

export interface SupplierListResponse {
  items: Supplier[];
  total: number;
  page: number;
  limit: number;
  summary?: SupplierListSummary;
}

export interface SupplierTopItem {
  item_name: string;
  master_item_id: number | null;
  category: string;
  purchase_count: number;
  total_qty: number;
  unit: string;
  total_spent: number;
}

export interface SupplierPriciestItem {
  item_name: string;
  master_item_id: number | null;
  category: string;
  max_unit_price: number;
  unit: string;
  last_purchase_date: string | null;
}

export interface SupplierDuplicateItem {
  id: number;
  name: string;
  phone: string;
  address: string;
  transaction_count: number;
  total_spent: number;
  similarity: number;
  reason: string;
}

export interface SupplierDuplicateGroup {
  suggested_primary_id: number;
  primary: {
    id: number;
    name: string;
    phone: string;
    address: string;
    transaction_count: number;
    total_spent: number;
  };
  duplicates: SupplierDuplicateItem[];
}

export interface SupplierFormData {
  name: string;
  phone?: string;
  address?: string;
  aliases?: string;
  notes?: string;
  is_active?: boolean;
}

export interface PurchaseRequestItem {
  id: number;
  request_id: number;
  item_name: string;
  master_item_id?: number | null;
  qty: number;
  unit: string;
  category?: string | null;
  notes?: string;
  estimated_price?: number | null;
  supplier_id?: number | null;
  supplier_name?: string;
  order_status: "PENDING" | "ORDERED" | "CANCELLED";
  ordered_at?: string | null;
  qty_received?: number | null;
  receiving_status: "PENDING" | "SESUAI" | "KURANG" | "LEBIH" | "RUSAK";
  expired_date?: string | null;
  received_by?: string | null;
  received_at?: string | null;
  receiving_notes?: string | null;
  expense_id?: number | null;
}

export interface PurchaseRequest {
  id: number;
  request_number: string;
  title: string;
  request_date: string;
  user_id?: number | null;
  requester_name: string;
  item_name?: string | null;
  qty?: number | null;
  unit?: string | null;
  category?: string | null;
  estimated_price?: number | null;
  urgency: "NORMAL" | "URGENT";
  notes: string;
  status: "PENDING" | "APPROVED" | "PARTIAL_ORDERED" | "ORDERED" | "RECEIVED" | "REJECTED" | "FULFILLED" | "CANCELLED";
  reviewed_by_id?: number | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  reject_reason?: string | null;
  expense_id?: number | null;
  fulfilled_at?: string | null;
  created_at?: string;
  updated_at?: string;
  items: PurchaseRequestItem[];
}

export interface PurchaseRequestItemFormData {
  id?: number;
  item_name: string;
  qty: number;
  unit: string;
  category?: string;
  estimated_price?: number;
  supplier_name?: string;
  notes?: string;
}

export interface PurchaseRequestFormData {
  title?: string;
  item_name?: string;
  qty?: number;
  unit?: string;
  category?: string;
  estimated_price?: number;
  urgency: "NORMAL" | "URGENT";
  notes?: string;
  requester_name?: string;
  request_date?: string;
  items?: PurchaseRequestItemFormData[];
}

export interface PurchasingSupplierGroup {
  supplier_name: string;
  supplier_id?: number | null;
  supplier_phone?: string;
  supplier_address?: string;
  total_items: number;
  items: PurchaseRequestItem[];
}

export interface WarehouseReceiveItemInput {
  qty_received: number;
  expired_date?: string;
  received_by?: string;
  receiving_notes?: string;
}

export interface PurchaseRequestStats {
  total: number;
  pending: number;
  approved: number;
  ordered: number;
  received: number;
  fulfilled: number;
  rejected: number;
  urgent_pending: number;
}

export interface PurchaseRequestListResponse {
  items: PurchaseRequest[];
  total: number;
  stats?: PurchaseRequestStats;
}




