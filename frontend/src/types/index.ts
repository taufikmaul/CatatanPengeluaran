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
  list_hutang: UnpaidExpenseItem[];
  daily_chart: Array<{
    date: string;
    total: number;
    count: number;
  }>;
  valid_categories: string[];
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
}

export interface MasterItemAuditResponse {
  ok: boolean;
  total_duplicates: number;
  pairs: DuplicatePair[];
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

export interface AuthPermissions {
  can_edit: boolean;
  can_delete: boolean;
  can_view_charts: boolean;
  can_manage_config: boolean;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user?: string | null;
  role?: "admin" | "admin_input" | null;
  permissions?: AuthPermissions | null;
}

export interface SuggestionsResponse {
  ok: boolean;
  items: ItemSuggestion[];
  suppliers: string[];
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

