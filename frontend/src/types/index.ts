export interface Expense {
  id: number;
  created_at?: string;
  expense_date: string;
  supplier: string;
  item_name: string;
  qty: number;
  category: string;
  unit_price: number;
  tax: number;
  discount: number;
  total_price: number;
  pay_method: string;
  pay_status: string;
  due_date: string;
  notes: string;
  msg_link: string;
  sheets_synced: boolean;
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
  expense_count: number;
  per_kategori: Record<string, number>;
  per_metode_bayar?: Record<string, number>;
  list_hutang: UnpaidExpenseItem[];
  daily_chart: Array<{
    date: string;
    total: number;
    count: number;
  }>;
  valid_categories: string[];
  top_frequent_items?: TopFrequentItem[];
  top_expensive_items?: TopExpensiveItem[];
  top_unit_price_items?: TopUnitPriceItem[];
  top_price_spikes?: TopPriceSpikeItem[];
  top_suppliers?: TopSupplierItem[];
  summary_metrics?: SummaryMetrics;
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
  report_chat_id: string;
  report_thread_id: number;
  bot_password?: string;
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
}

export interface ExpenseFormData {
  expense_date: string;
  supplier: string;
  item_name: string;
  qty: number;
  category: string;
  unit_price: number;
  tax: number;
  discount: number;
  total_price: number;
  pay_method: string;
  pay_status: string;
  due_date: string;
  notes: string;
}
