export interface ExpensePayment {
  id: number;
  expense_id: number;
  payment_type: "dp" | "installment" | "settlement" | "reimbursement" | string;
  amount: number;
  dp_percent?: number | null;
  payment_date: string;
  pay_method: string;
  bank_account_id?: number | null;
  bank_account_name?: string | null;
  reference_no?: string | null;
  notes: string;
  actor: string;
  created_at?: string;
}

export interface ExpensePaymentPayload {
  amount?: number | null;
  dp_percent?: number | null;
  payment_type?: "dp" | "installment" | "settlement" | "reimbursement" | string | null;
  payment_date?: string;
  pay_method?: string;
  bank_account_id?: number | null;
  reference_no?: string | null;
  notes?: string;
  due_date?: string | null;
  settle_full?: boolean;
}

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
  paid_amount?: number;
  remaining_amount?: number;
  dp_type?: "percent" | "amount" | string | null;
  dp_percent?: number | null;
  payment_progress_pct?: number;
  payments_count?: number;
  payments?: ExpensePayment[];
  notes: string;
  msg_link: string;
  is_reimbursement?: boolean;
  invoice_number?: string;
  reimbursed_at?: string | null;
  user_id?: number | null;
  user_name?: string | null;
  master_item_id?: number | null;
  bank_account_id?: number | null;
  reconciled_at?: string | null;
  reconciled_ref?: string | null;
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
  paid_amount?: number;
  remaining_amount?: number;
  pay_status?: string;
  due_date: string;
  parsed_due_date: string | null;
  days_left: number | null;
  is_overdue?: boolean;
  is_today?: boolean;
  urgency: "overdue" | "today" | "soon" | "upcoming" | "none" | "unknown" | string;
}

export interface UnpaidSupplierSummary {
  supplier_id: number | null;
  supplier_name: string;
  unpaid_count: number;
  unpaid_total: number;
  dp_count?: number;
  dp_paid_total?: number;
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
  total_unpaid_count?: number;
  total_unpaid_nominal?: number;
  unpaid_count: number;
  unpaid_total: number;
  dp_count?: number;
  dp_paid_nominal?: number;
  dp_remaining_nominal?: number;
  total_invoice_nominal?: number;
  paid_count: number;
  paid_total: number;
  total_count: number;
  total_nominal?: number;
  overdue_count: number;
  overdue_nominal?: number;
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
  total_invoice?: number;
  paid_amount?: number;
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
  percentage_of_revenue?: number | null;
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
  paid_tx_count?: number;
  revenue_gross?: number;
  revenue_discount?: number;
  revenue_platform_fee?: number;
  revenue_net?: number;
  prev_revenue_net?: number;
  mom_revenue_change_pct?: number | null;
  gross_profit?: number;
  gross_margin_pct?: number | null;
  net_profit?: number;
  net_margin_pct?: number | null;
  prev_net_profit?: number;
  disposal_gain_loss?: number;
  depreciation_expense?: number;
  low_value_asset_expense?: number;
  revenue_by_channel?: Array<{
    channel: string;
    tx_count: number;
    gross_sales: number;
    platform_fee: number;
    net_received: number;
    percentage: number;
  }>;
}

export interface NeracaItemData {
  account_code: string;
  account_name: string;
  group: string;
  nominal: number;
  description: string;
}

export interface RekeningPositionData {
  id: number;
  account_code: string;
  name: string;
  bank_name: string;
  account_type: string;
  opening_balance: number;
  incoming_month: number;
  outgoing_month: number;
  net_month_flow: number;
  estimated_balance: number;
}

export interface NeracaReportData {
  aset_lancar: NeracaItemData[];
  subtotal_aset_lancar: number;
  rekening_positions?: RekeningPositionData[];
  total_rekening_balance?: number;
  aset_tetap: NeracaItemData[];
  aset_tetap_summary?: {
    gross_cost: number;
    accumulated_depreciation: number;
    net_book_value: number;
    monthly_depreciation: number;
    active_capitalized_count: number;
    low_value_count: number;
    disposal_gain_loss_month: number;
  };
  subtotal_aset_tetap: number;
  total_aset: number;
  kewajiban_lancar: NeracaItemData[];
  subtotal_kewajiban: number;
  detail_hutang: UnpaidExpenseItem[];
  ekuitas?: NeracaItemData[];
  subtotal_ekuitas?: number;
}

export interface ArusKasItemData {
  activity: string;
  account_name: string;
  nominal: number;
  percentage: number;
}

export interface ArusKasReportData {
  total_kas_masuk?: number;
  net_cash_flow?: number;
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

export interface HppVarianceMenuItem {
  product_name: string;
  qty_sold: number;
  unit_hpp: number;
  total_theoretical_hpp: number;
  net_sales: number;
}

export interface HppVarianceData {
  theoretical_hpp: number;
  actual_hpp: number;
  variance_nominal: number;
  variance_pct: number | null;
  matched_menu_count: number;
  unmatched_item_count: number;
  matched_qty_total: number;
  top_menu_costs: HppVarianceMenuItem[];
  status: "aligned" | "surplus_purchase" | "stock_drawdown" | "no_sales_match" | "no_menu_data" | string;
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
    has_revenue?: boolean;
    hpp_to_revenue_pct?: number | null;
    opex_to_revenue_pct?: number | null;
    bahan_to_revenue_pct?: number | null;
    kemasan_to_revenue_pct?: number | null;
    gaji_to_revenue_pct?: number | null;
    sewa_to_revenue_pct?: number | null;
    marketing_to_revenue_pct?: number | null;
    maintenance_to_revenue_pct?: number | null;
    software_to_revenue_pct?: number | null;
    utilitas_to_revenue_pct?: number | null;
    gross_margin_pct?: number | null;
    net_margin_pct?: number | null;
  };
  top_variances_mom: {
    top_increases: AccountLineItem[];
    top_savings: AccountLineItem[];
  };
  health_evaluation: HealthEvaluationItem[];
  hpp_variance?: HppVarianceData;
}

export interface AccountingReportData {
  ok: boolean;
  month: number;
  month_end?: number;
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
  month_end?: number;
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
  ongkir_by_courier?: Array<{
    courier_name: string;
    supplier_id?: number | null;
    trip_count: number;
    total_amount: number;
    avg_per_trip: number;
    is_subscribed?: boolean;
  }>;
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
  supplier?: string;
  aliases: string;
  satuan_beli?: string;
  tipe_satuan?: "paket" | "ecer" | "keduanya";
  isi_paket?: string;
  satuan_ecer?: string;
  satuan_resep?: string | null;
  konversi_resep?: number | null;
  recipe_unit_price?: number | null;
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
  satuan_resep?: string | null;
  konversi_resep?: number | null;
  recipe_unit_price?: number | null;
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
  type: "kategori" | "metode_bayar" | "satuan" | "kategori_menu";
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
  telegram_token_configured?: boolean;
  dashboard_pin_chat_id?: string;
  dashboard_pin_thread_id?: number | null;
  allowed_thread_id: number;
  allowed_thread_ids?: string;
  tukar_cash_thread_ids?: string;
  ongkir_thread_ids?: string;
  report_chat_id: string;
  report_thread_id: number;
  bot_password_configured?: boolean;
  admin_input_password_configured?: boolean;
  purchasing_password_configured?: boolean;
  warehouse_password_configured?: boolean;
  staff_password_configured?: boolean;
  request_belanja_chat_id?: string;
  request_belanja_thread_id?: number | null;
  webhook_url?: string;
  ai_provider: string;
  ai_url: string;
  ai_model: string;
  sumopod_api_key_configured?: boolean;
  ai_key_masked: string;
  ai_analysis_key_masked?: string;
  ai_analysis_api_key_configured?: boolean;
  ai_analysis_url?: string;
  ai_analysis_model?: string;
  ai_chat_default_provider?: string;
  ai_chat_default_model?: string;
  ai_chat_openrouter_models?: string;
  ai_chat_sumopod_models?: string;
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
  asset_capitalization_threshold?: number;
  asset_default_useful_life_months?: number;
}

export interface MonthlyBudgetDetailResponse {
  ok: boolean;
  year: number;
  month: number;
  total_budget: number;
  category_percentages: Record<string, number>;
  category_amounts: Record<string, number>;
  is_custom: boolean;
  valid_categories: string[];
  valid_units?: string[];
  previous_month_ending_balance?: number;
  previous_month_year?: number;
  previous_month?: number;
  message?: string;
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
  paid_amount?: number;
  dp_type?: "percent" | "amount" | string | null;
  dp_percent?: number | null;
  dp_payment_date?: string;
  dp_reference_no?: string;
  notes: string;
  is_reimbursement?: boolean;
  invoice_number?: string;
  msg_link?: string;
  user_id?: number | null;
  master_item_id?: number | null;
  supplier_id?: number | null;
  bank_account_id?: number | null;
  asset_id?: number | null;
  maintenance_type?: string;
  next_service_date?: string;
  warranty_months?: number;
  useful_life_months?: number;
  asset_location?: string;
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
  supplier_type?: "toko" | "kurir" | string;
  courier_category?: string | null;
  is_subscribed?: boolean;
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
  paid_amount?: number;
  remaining_amount?: number;
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
  supplier_type?: "toko" | "kurir" | string;
  courier_category?: string | null;
  is_subscribed?: boolean;
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
  status: "DRAFT" | "PENDING" | "APPROVED" | "PARTIAL_ORDERED" | "ORDERED" | "RECEIVED" | "REJECTED" | "FULFILLED" | "CANCELLED";
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
  status?: "DRAFT" | "PENDING";
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

export interface PurchasingSupplierOption {
  id: number;
  name: string;
  phone: string;
  address: string;
  has_item: boolean;
  is_default_supplier: boolean;
  tx_count: number;
  last_unit_price?: number | null;
  last_date?: string | null;
}

export interface PurchasingSupplierOptionsResponse {
  item_id: number;
  item_name: string;
  matching_suppliers: PurchasingSupplierOption[];
  other_suppliers: PurchasingSupplierOption[];
}

export interface PurchasingItemUpdateInput {
  item_name?: string;
  qty?: number;
  unit?: string;
  category?: string;
  estimated_price?: number;
  notes?: string;
}

export interface PurchasingItemCreateInput {
  request_id?: number | null;
  item_name: string;
  qty: number;
  unit: string;
  category?: string;
  supplier_id?: number | null;
  supplier_name?: string;
  estimated_price?: number;
  notes?: string;
}

export interface WarehouseReceiveItemInput {
  qty_received: number;
  expired_date?: string;
  received_by?: string;
  receiving_notes?: string;
}

export interface PurchaseRequestStats {
  total: number;
  draft: number;
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

export type BankAccountType = "bank" | "cash" | "ewallet" | "aggregator";

export interface BankAccount {
  id: number;
  name: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  account_type: BankAccountType;
  account_code: string;
  opening_balance: number;
  total_incoming: number;
  total_expenses?: number;
  transfers_in?: number;
  transfers_out?: number;
  estimated_balance: number;
  tx_count: number;
  channel_mappings: string[];
  notes: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface IncomingTransactionItem {
  id: number;
  category?: string | null;
  product_group?: string | null;
  product_name: string;
  sku?: string | null;
  qty: number;
  modifier?: string | null;
  unit_price: number;
  extra_price: number;
  gross_amount: number;
  discount_amount: number;
}

export interface IncomingTransaction {
  id: number;
  source_type: string;
  receipt_no?: string | null;
  order_no?: string | null;
  transaction_date: string;
  transaction_time?: string | null;
  location_name?: string | null;
  order_type: string;
  payment_method: string;
  bank_account_id?: number | null;
  bank_account_name?: string | null;
  customer_name?: string | null;
  cashier_name?: string | null;
  gross_sales: number;
  discount_amount: number;
  net_sales: number;
  platform_fee: number;
  net_received: number;
  cancellation_total: number;
  promo_name?: string | null;
  status: "paid" | "void" | "cancelled";
  void_at?: string | null;
  notes?: string | null;
  reconciled_at?: string | null;
  reconciled_ref?: string | null;
  items: IncomingTransactionItem[];
}

export interface ManualIncomingTxFormData {
  transaction_date: string;
  transaction_time?: string;
  receipt_no?: string;
  order_no?: string;
  order_type: string;
  payment_method: string;
  bank_account_id?: number | null;
  customer_name?: string;
  cashier_name?: string;
  gross_sales: number;
  discount_amount: number;
  platform_fee: number;
  status: "paid" | "void";
  notes?: string;
}

export interface BulkIncomingTxRow {
  transaction_date: string;
  transaction_time: string;
  receipt_no: string;
  order_no: string;
  order_type: string;
  payment_method: string;
  bank_account_name: string;
  customer_name: string;
  cashier_name?: string;
  gross_sales: number;
  discount_amount: number;
  platform_fee: number;
  status: "paid" | "void";
  notes: string;
}

export interface BankTransfer {
  id: number;
  transfer_date: string;
  from_account_id: number;
  from_account_name?: string | null;
  to_account_id: number;
  to_account_name?: string | null;
  amount: number;
  admin_fee: number;
  transfer_type: "setor_tunai" | "pencairan_platform" | "antar_rekening";
  reference_no?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface IncomingAnalyticsProductRow {
  product_name: string;
  category: string;
  total_qty: number;
  net_sales: number;
  avg_price?: number;
  order_lines: number;
  qty_share_pct?: number;
  revenue_share_pct?: number;
  order_types?: string[];
}

export interface IncomingAnalyticsRadarPoint {
  label: string;
  product_name: string;
  category: string;
  total_qty: number;
  net_sales: number;
  qty_score: number;
  revenue_score: number;
}

export interface IncomingAnalyticsChannelRow {
  channel: string;
  is_cakeflow: boolean;
  tx_count: number;
  total_qty: number;
  gross_sales: number;
  net_sales: number;
  platform_fee: number;
  net_received: number;
  revenue_share_pct: number;
}

export interface IncomingAnalytics {
  top_products: IncomingAnalyticsProductRow[];
  top_products_by_qty: IncomingAnalyticsProductRow[];
  top_products_by_revenue: IncomingAnalyticsProductRow[];
  radar_by_qty: IncomingAnalyticsRadarPoint[];
  radar_by_revenue: IncomingAnalyticsRadarPoint[];
  by_channel: IncomingAnalyticsChannelRow[];
  categories: Array<{
    category: string;
    total_qty: number;
    net_sales: number;
  }>;
  peak_hours: Array<{
    hour: number;
    label: string;
    offline_count: number;
    online_count: number;
    cakeflow_count?: number;
    total_count: number;
    net_received: number;
  }>;
  void_by_channel: Array<{
    channel: string;
    count: number;
    amount: number;
  }>;
  available_order_types: string[];
  summary: {
    total_paid_tx: number;
    total_qty: number;
    total_net_sales: number;
    total_net_received: number;
    unique_products: number;
    cakeflow_tx_count: number;
    cakeflow_qty: number;
    cakeflow_net_sales: number;
    cakeflow_net_received: number;
    unscheduled_time_count: number;
  };
}

export interface ReconciliationPreview {
  mode: "mutasi_bank" | "settlement_platform";
  total_rows: number;
  matched_incoming: Array<{
    row_no: number;
    reconciled_ref: string;
    bank_date?: string;
    bank_desc?: string;
    tx_id: number;
    receipt_no?: string | null;
    order_no?: string | null;
    transaction_date: string;
    order_type: string;
    old_platform_fee: number;
    new_platform_fee: number;
    old_net_received: number;
    new_net_received: number;
    diff_net: number;
    bank_account_id?: number | null;
  }>;
  matched_expenses: Array<{
    row_no: number;
    reconciled_ref: string;
    bank_date: string;
    bank_desc: string;
    expense_id: number;
    expense_date: string;
    supplier: string;
    item_name: string;
    total_price: number;
    pay_method: string;
    bank_account_id?: number | null;
  }>;
  unmatched_rows: Array<{
    row_no: number;
    date?: string | null;
    description: string;
    direction: string;
    amount: number;
  }>;
}

export interface IncomingTransactionsSummary {
  paid_count: number;
  gross_sales: number;
  discount_amount: number;
  net_sales: number;
  platform_fee: number;
  net_received: number;
  void_count: number;
  cancellation_total: number;
  unmapped_count?: number;
}

export type AiAccountMappingScope = "unmapped" | "all";
export type AiAccountMappingConfidence = "high" | "medium" | "low";

export interface AiBankAccountMappingSuggestion {
  group_key: string;
  order_type: string;
  payment_method: string;
  tx_count: number;
  unmapped_count: number;
  total_net_received: number;
  current_account_names: string[];
  suggested_bank_account_id: number | null;
  suggested_bank_account_name: string | null;
  confidence: AiAccountMappingConfidence;
  reason: string;
}

export interface AiBankAccountMappingPreview {
  ok: boolean;
  engine: "ai" | "rules_fallback";
  model: string | null;
  fallback_reason: string | null;
  scope: AiAccountMappingScope;
  has_active_accounts: boolean;
  total_groups: number;
  total_transactions: number;
  suggested_groups: number;
  suggestions: AiBankAccountMappingSuggestion[];
}

export interface AiBankAccountMappingApplyResult {
  ok: boolean;
  updated_transactions: number;
  applied_groups: number;
  updated_accounts: number;
  saved_mappings: Array<{
    bank_account_id: number;
    bank_account_name: string;
    added_channels: string[];
  }>;
  message: string;
}

export type IncomingDuplicateReasonCode =
  | "same_receipt_no"
  | "same_order_no"
  | "exact_timestamp_amount"
  | "cross_source_match"
  | "same_day_fingerprint";

export type IncomingDuplicateSeverity = "high" | "medium";

export interface IncomingDuplicateTxSummary {
  id: number;
  source_type: string;
  receipt_no?: string | null;
  order_no?: string | null;
  transaction_date?: string | null;
  transaction_time?: string | null;
  order_type: string;
  payment_method: string;
  bank_account_id?: number | null;
  bank_account_name?: string | null;
  customer_name?: string | null;
  cashier_name?: string | null;
  gross_sales: number;
  discount_amount: number;
  platform_fee: number;
  net_received: number;
  status: string;
  item_count: number;
  reconciled_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface IncomingDuplicateGroup {
  group_id: string;
  reason_code: IncomingDuplicateReasonCode;
  severity: IncomingDuplicateSeverity;
  reason: string;
  tx_count: number;
  duplicate_count: number;
  suggested_keep_id: number;
  suggested_delete_ids: number[];
  potential_overstated_gross: number;
  potential_overstated_net_received: number;
  transactions: IncomingDuplicateTxSummary[];
}

export interface IncomingDuplicatesAuditResult {
  ok: boolean;
  scanned_transactions: number;
  duplicate_group_count: number;
  duplicate_tx_count: number;
  high_confidence_groups: number;
  medium_confidence_groups: number;
  potential_overstated_gross: number;
  potential_overstated_net_received: number;
  groups: IncomingDuplicateGroup[];
}

export interface DeleteIncomingDuplicatesResult {
  ok: boolean;
  deleted_count: number;
  deleted_ids: number[];
  skipped_reconciled_ids: number[];
  not_found_ids: number[];
  message: string;
}

export interface SalesAuditFinding {
  level: "error" | "warning" | "info";
  category: "missing_field" | "financial_anomaly" | "date_anomaly" | "account_mapping" | "duplicate";
  message: string;
  receipt_no?: string | null;
  tx_index?: number | null;
  field?: string | null;
  raw_value?: string | null;
}

export interface SalesImportAuditSummary {
  total_findings: number;
  error_count: number;
  warning_count: number;
  info_count: number;
  has_blocking_errors: boolean;
  findings: SalesAuditFinding[];
}

export interface SalesImportRowOverride {
  receipt_no?: string;
  transaction_date?: string;
  order_type?: string;
  payment_method?: string;
  bank_account_id?: number | null;
  bank_account_name?: string | null;
  gross_sales?: number;
  discount_amount?: number;
  platform_fee?: number;
  status?: string;
  notes?: string;
  exclude?: boolean;
}

export interface SalesImportEditableRow {
  tx_index: number;
  receipt_no?: string | null;
  order_no?: string | null;
  transaction_date: string;
  transaction_time?: string | null;
  order_type: string;
  payment_method: string;
  bank_account_id?: number | null;
  bank_account_name?: string | null;
  raw_bank_account_name?: string | null;
  gross_sales: number;
  discount_amount: number;
  platform_fee: number;
  net_received: number;
  status: string;
  notes?: string | null;
  item_count: number;
  is_edited: boolean;
  is_excluded: boolean;
}

export interface SalesImportPreview {
  source_type: string;
  total_transactions: number;
  new_paid_count: number;
  new_void_count: number;
  duplicate_count: number;
  skipped_count: number;
  edited_count?: number;
  excluded_count?: number;
  total_items: number;
  total_gross_sales: number;
  total_discount: number;
  total_platform_fee: number;
  total_net_received: number;
  total_void_amount: number;
  channel_breakdown: Record<
    string,
    { count: number; net_received: number; platform_fee: number }
  >;
  sample_rows: Array<{
    tx_index?: number;
    receipt_no?: string | null;
    order_no?: string | null;
    transaction_date: string;
    transaction_time?: string | null;
    order_type: string;
    payment_method: string;
    bank_account_id?: number | null;
    bank_account_name?: string | null;
    gross_sales: number;
    discount_amount: number;
    platform_fee: number;
    net_received: number;
    status: string;
    item_count: number;
    is_edited?: boolean;
  }>;
  editable_rows?: Record<string, SalesImportEditableRow>;
  available_accounts?: Array<{
    id: number;
    name: string;
    bank_name: string;
    account_type: string;
  }>;
  audit?: SalesImportAuditSummary;
}

export type MenuItemType = "finished" | "prepared" | "bundle";
export type IngredientCostGroup = "ingredient" | "packaging";

export interface SubMenuBreakdownItem {
  id?: number;
  ingredient_name: string;
  master_item_id?: number | null;
  sub_menu_id?: number | null;
  sub_menu_name?: string | null;
  sub_menu_item_type?: MenuItemType | null;
  cost_group: IngredientCostGroup;
  qty: number;
  unit: string;
  yield_factor: number;
  waste_pct?: number;
  line_cost: number;
  price_drift_alert?: boolean;
  price_change_pct?: number | null;
  drift_source?: string | null;
  sub_menu_breakdown?: SubMenuBreakdownItem[];
}

export interface MenuIngredient {
  id?: number;
  menu_id?: number;
  master_item_id?: number | null;
  master_item_name?: string | null;
  sub_menu_id?: number | null;
  sub_menu_name?: string | null;
  sub_menu_anonymous_name?: string | null;
  sub_menu_item_type?: MenuItemType | null;
  sub_menu_yield_unit?: string | null;
  sub_menu_core_unit_hpp?: number | null;
  sub_menu_effective_hpp?: number | null;
  cost_group: IngredientCostGroup;
  include_sub_packaging?: boolean;
  waste_pct?: number;
  sub_menu_breakdown?: SubMenuBreakdownItem[];
  drift_source?: string | null;
  ingredient_name: string;
  qty: number;
  unit: string;
  unit_cost_override?: number | null;
  master_latest_price?: number;
  master_prev_price?: number | null;
  price_change_pct?: number | null;
  price_drift_alert?: boolean;
  effective_unit_cost?: number;
  yield_factor: number;
  line_cost?: number;
  notes?: string | null;
}

export interface MenuIngredientInput {
  master_item_id?: number | null;
  sub_menu_id?: number | null;
  cost_group?: IngredientCostGroup;
  include_sub_packaging?: boolean | null;
  waste_pct?: number;
  ingredient_name?: string;
  qty: number;
  unit: string;
  unit_cost_override?: number | null;
  yield_factor: number;
  notes?: string | null;
}

export type MenuHppMode = "auto" | "manual" | "recipe";
export type BatchCostCategory = "labor" | "operational";

export interface MenuBatchCostItem {
  category: BatchCostCategory;
  name: string;
  amount: number;
  unit_amount?: number;
}

export interface MenuBatchCostItemInput {
  category: BatchCostCategory;
  name?: string;
  amount: number;
}

export type FoodCostStatus =
  | "no_price"
  | "no_hpp"
  | "ideal"
  | "moderate"
  | "high"
  | "not_sellable";

export interface MenuProduct {
  id: number;
  name: string;
  display_name: string;
  anonymous_name: string;
  sku?: string | null;
  category: string;
  product_group?: string | null;
  unit: string;
  item_type: MenuItemType;
  is_sellable: boolean;
  batch_yield_qty: number;
  batch_yield_unit: string;
  waste_loss_pct: number;
  net_yield_qty: number;
  labor_cost: number;
  unit_labor_cost?: number;
  unit_other_fee?: number;
  batch_cost_items?: MenuBatchCostItem[];
  target_food_cost_pct?: number | null;
  shelf_life_days?: number | null;
  storage_method?: string | null;
  notes?: string | null;
  is_active: boolean;
  is_anonymized: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  ingredients: MenuIngredient[];
  ingredient_count: number;
  ingredient_only_count?: number;
  packaging_count?: number;
  raw_batch_ingredients?: number;
  raw_batch_total?: number;
  subtotal_ingredients?: number;
  subtotal_packaging?: number;
  core_unit_hpp?: number;
  other_fee: number;
  other_fee_description?: string | null;
  recipe_hpp: number;
  hpp_manual: number;
  hpp_mode: MenuHppMode;
  active_hpp_source: "manual" | "recipe";
  effective_hpp: number;
  selling_price: number;
  gross_margin: number;
  food_cost_pct: number;
  pure_food_cost_pct?: number;
  packaging_cost_pct?: number;
  margin_pct: number;
  food_cost_status: FoodCostStatus;
  has_price_drift?: boolean;
  price_drift_count?: number;
  max_ingredient_increase_pct?: number;
  used_in_count?: number;
}

export interface MenuProductPayload {
  name: string;
  anonymous_name?: string | null;
  sku?: string | null;
  category: string;
  product_group?: string | null;
  unit: string;
  item_type?: MenuItemType;
  is_sellable?: boolean;
  batch_yield_qty?: number;
  batch_yield_unit?: string | null;
  waste_loss_pct?: number;
  labor_cost?: number;
  target_food_cost_pct?: number | null;
  shelf_life_days?: number | null;
  storage_method?: string | null;
  selling_price: number;
  hpp_manual: number;
  hpp_mode: MenuHppMode;
  other_fee?: number;
  other_fee_description?: string | null;
  batch_cost_items?: MenuBatchCostItemInput[];
  notes?: string | null;
  is_active: boolean;
  ingredients?: MenuIngredientInput[];
}

export interface MenuSummary {
  total_menus: number;
  active_menus: number;
  with_hpp_count: number;
  missing_hpp_count: number;
  recipe_based_count: number;
  price_drift_menus_count?: number;
  avg_food_cost_pct: number;
  avg_margin_pct: number;
  ideal_count: number;
  moderate_count: number;
  high_count: number;
  finished_count?: number;
  prepared_count?: number;
  bundle_count?: number;
  sellable_count?: number;
  used_prepared_count?: number;
}

export interface MenuListResponse {
  ok: boolean;
  items: MenuProduct[];
  summary: MenuSummary;
  categories: string[];
  anonymized: boolean;
  anonymize_locked?: boolean;
  read_only?: boolean;
  expires_at?: number;
}

export interface MenuUsageItem {
  menu_id: number;
  name: string;
  anonymous_name: string;
  item_type: MenuItemType;
  category: string;
  qty: number;
  unit: string;
  cost_group: IngredientCostGroup;
  include_sub_packaging: boolean;
  line_cost: number;
  parent_effective_hpp: number;
  cost_share_pct: number;
}

export interface PricingChannelConfig {
  key: string;
  name: string;
  commission_pct: number;
  fixed_fee: number;
  extra_packaging: number;
}

export interface PriceAdjustmentInput {
  master_item_id: number;
  mode: "pct" | "new_price";
  value: number;
}

export interface PriceSimulationAffectedItem {
  menu_id: number;
  name: string;
  anonymous_name: string;
  item_type: MenuItemType;
  is_sellable: boolean;
  category: string;
  unit: string;
  selling_price: number;
  old_hpp: number;
  new_hpp: number;
  delta_hpp: number;
  delta_hpp_pct: number | null;
  old_margin: number;
  new_margin: number;
  delta_margin: number;
  old_food_cost_pct: number;
  new_food_cost_pct: number;
  old_status: FoodCostStatus;
  new_status: FoodCostStatus;
  suggested_selling_price: number | null;
}

export interface PriceSimulationResponse {
  ok: boolean;
  adjustments: Array<{
    master_item_id: number;
    master_item_name: string;
    mode: "pct" | "new_price";
    value: number;
    base_price: number;
    simulated_price: number;
    delta_pct: number | null;
  }>;
  affected_items: PriceSimulationAffectedItem[];
  summary: {
    total_affected: number;
    affected_prepared_count: number;
    affected_menu_count: number;
    newly_high_fc_count: number;
  };
}

// ──────────────────────────────────────────────
// Inventaris Aset Tetap & Maintenance (SAK EMKM)
// ──────────────────────────────────────────────

export interface AssetMaintenance {
  id: number;
  asset_id: number;
  expense_id?: number | null;
  maintenance_date: string;
  maintenance_type: string;
  vendor_name: string;
  cost?: number;
  description: string;
  next_service_date?: string | null;
  service_warranty_until?: string | null;
  performed_by: string;
  created_at?: string | null;
}

export interface AssetDepreciationScheduleRow {
  period: number;
  year: number;
  month: number;
  period_label: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  net_book_value: number;
}

export interface AssetLogEntry {
  id: number;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  created_at?: string | null;
}

export interface FixedAsset {
  id: number;
  asset_code: string;
  qr_token: string;
  name: string;
  asset_group: string;
  brand_model: string;
  serial_number: string;
  qty_in_lot: number;
  vendor_name: string;
  location: string;
  pic_name: string;
  condition: string;
  status: string;
  purchase_date: string;
  warranty_months: number;
  warranty_expiry_date?: string | null;
  warranty_status: string;
  days_to_warranty_end?: number | null;
  warranty_notes: string;
  notes: string;
  maintenance_count: number;
  last_maintenance_date?: string | null;
  next_service_date?: string | null;
  maintenances: AssetMaintenance[];
  is_public_view?: boolean;
  // Financial fields (only when authenticated)
  expense_id?: number | null;
  unit_index?: number;
  supplier_id?: number | null;
  acquisition_cost?: number;
  salvage_value?: number;
  useful_life_months?: number;
  depreciation_method?: string;
  capitalization_status?: "capitalized" | "expensed_low_value" | string;
  is_capitalization_overridden?: boolean;
  depreciation_start_date?: string;
  monthly_depreciation?: number;
  depreciation_in_period?: number;
  accumulated_depreciation?: number;
  net_book_value?: number;
  remaining_months?: number;
  total_maintenance_cost?: number;
  total_cost_of_ownership?: number;
  disposed_at?: string | null;
  disposal_type?: string | null;
  disposal_proceeds?: number | null;
  disposal_notes?: string | null;
  depreciation_schedule?: AssetDepreciationScheduleRow[];
  logs?: AssetLogEntry[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AssetListSummary {
  total_assets: number;
  active_assets: number;
  capitalized_count: number;
  low_value_count: number;
  total_acquisition_cost: number;
  total_accumulated_depreciation: number;
  total_net_book_value: number;
  monthly_depreciation_total: number;
  warranty_expiring_count: number;
  upcoming_service_count: number;
}

export interface AssetListResponse {
  ok: boolean;
  items: FixedAsset[];
  total: number;
  config: {
    asset_capitalization_threshold: number;
    asset_default_useful_life_months: number;
  };
  summary: AssetListSummary;
}

export interface AssetReanalyzeResult {
  ok: boolean;
  threshold: number;
  default_useful_life_months: number;
  total_assets_checked: number;
  promoted_to_capitalized: number;
  moved_to_low_value: number;
  unchanged: number;
  overridden_skipped: number;
  disposed_skipped: number;
  capitalized_total_before: number;
  capitalized_total_after: number;
  balance_sheet_delta: number;
  message: string;
}

export interface DailyCashflowRow {
  date: string;
  cash_in: number;
  cash_out: number;
  net_flow: number;
  saldo: number;
  cash_in_count: number;
  cash_out_count: number;
}

export interface DailyCashflowResponse {
  ok: boolean;
  periode: string;
  start_date: string;
  end_date: string;
  month?: number;
  year?: number;
  bank_account_id?: number;
  account_name: string;
  saldo_awal: number;
  total_cash_in: number;
  total_cash_out: number;
  net_cash_flow: number;
  saldo_akhir: number;
  total_tx_in: number;
  total_tx_out: number;
  days_count: number;
  bank_accounts: {
    id: number;
    name: string;
    bank_name: string;
    account_number: string;
    account_type: string;
    account_code: string;
    opening_balance: number;
  }[];
  daily_rows: DailyCashflowRow[];
}

export type AiChatProviderId = "openrouter" | "sumopod";

export interface AiChatProviderOption {
  id: AiChatProviderId;
  label: string;
  configured: boolean;
  url: string;
  default_model: string;
  models: string[];
}

export interface AiChatModelCatalog {
  ok: boolean;
  default_provider: AiChatProviderId;
  configured_default_provider: AiChatProviderId;
  default_model: string;
  providers: AiChatProviderOption[];
}

export interface AiChatToolTrace {
  tool: string;
  label: string;
  period: string;
  status: string;
  summary: string;
  arguments?: Record<string, unknown>;
}

export interface AiChatMessage {
  id: number | string;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  provider?: string | null;
  model_used?: string | null;
  tool_calls?: AiChatToolTrace[];
  created_at?: string | null;
}

export interface AiChatSessionSummary {
  id: number;
  title: string;
  provider: AiChatProviderId | string;
  model_id: string;
  message_count: number;
  last_message_preview?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AiChatSessionDetail {
  id: number;
  title: string;
  provider: AiChatProviderId | string;
  model_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  messages: AiChatMessage[];
}





