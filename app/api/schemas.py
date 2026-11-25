"""
app/api/schemas.py — Pydantic Schemas for CatatanPengeluaran REST API
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from pydantic import BaseModel, Field, ConfigDict


class ExpensePaymentCreate(BaseModel):
    amount: float | None = Field(None, gt=0)
    dp_percent: float | None = Field(None, gt=0, le=100)
    payment_type: str | None = None  # "dp", "installment", "settlement", "reimbursement"
    payment_date: date = Field(default_factory=date.today)
    pay_method: str = "Transfer"
    bank_account_id: int | None = None
    reference_no: str | None = None
    notes: str = "-"
    due_date: str | None = None
    settle_full: bool = False


class ExpensePaymentResponse(BaseModel):
    id: int
    expense_id: int
    payment_type: str
    amount: float
    dp_percent: float | None = None
    payment_date: str
    pay_method: str
    bank_account_id: int | None = None
    bank_account_name: str | None = None
    reference_no: str | None = None
    notes: str = "-"
    actor: str = "system"
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ExpenseBase(BaseModel):
    expense_date: date = Field(default_factory=date.today)
    supplier: str = "-"
    item_name: str
    qty: float = 1.0
    unit: str = "Pcs"
    category: str = "Operasional"
    unit_price: float = 0.0
    shipping_fee: float = 0.0
    tax: float = 0.0
    other_fee: float = 0.0
    discount: float = 0.0
    total_price: float = 0.0
    pay_method: str = "Tunai"
    pay_status: str = "Lunas"
    due_date: str = "-"
    paid_amount: float = 0.0
    dp_type: str | None = None
    dp_percent: float | None = None
    dp_payment_date: date | None = None
    dp_reference_no: str | None = None
    notes: str = "-"
    is_reimbursement: bool = False
    invoice_number: str = "-"
    invoice_group_id: str | None = None
    msg_link: str = "Web Dashboard"
    user_id: int | None = None
    master_item_id: int | None = None
    supplier_id: int | None = None
    bank_account_id: int | None = None
    # Opsional: integrasi otomatis ke Inventaris Aset & Maintenance
    asset_id: int | None = None
    maintenance_type: str | None = None
    next_service_date: date | None = None
    warranty_months: int | None = None
    useful_life_months: int | None = None
    asset_location: str | None = None


class ExpenseCreate(ExpenseBase):
    pass


class ExpenseBatchCreate(BaseModel):
    items: list[ExpenseCreate]


class ExpenseUpdate(BaseModel):
    expense_date: date | None = None
    supplier: str | None = None
    item_name: str | None = None
    qty: float | None = None
    unit: str | None = None
    category: str | None = None
    unit_price: float | None = None
    shipping_fee: float | None = None
    tax: float | None = None
    other_fee: float | None = None
    discount: float | None = None
    total_price: float | None = None
    pay_method: str | None = None
    pay_status: str | None = None
    due_date: str | None = None
    paid_amount: float | None = None
    dp_type: str | None = None
    dp_percent: float | None = None
    notes: str | None = None
    is_reimbursement: bool | None = None
    invoice_number: str | None = None
    invoice_group_id: str | None = None
    reimbursed_at: datetime | None = None
    msg_link: str | None = None
    user_id: int | None = None
    master_item_id: int | None = None
    supplier_id: int | None = None
    bank_account_id: int | None = None
    # Opsional: integrasi otomatis ke Inventaris Aset & Maintenance
    asset_id: int | None = None
    maintenance_type: str | None = None
    next_service_date: date | None = None
    warranty_months: int | None = None
    useful_life_months: int | None = None
    asset_location: str | None = None


class ExpenseResponse(BaseModel):
    id: int
    created_at: datetime | None = None
    expense_date: str
    supplier: str
    item_name: str
    qty: float
    unit: str = "Pcs"
    category: str
    unit_price: float
    shipping_fee: float = 0.0
    tax: float = 0.0
    other_fee: float = 0.0
    discount: float = 0.0
    total_price: float
    pay_method: str
    pay_status: str
    due_date: str
    paid_amount: float = 0.0
    remaining_amount: float = 0.0
    dp_type: str | None = None
    dp_percent: float | None = None
    payment_progress_pct: float = 0.0
    payments_count: int = 0
    payments: list[ExpensePaymentResponse] = []
    notes: str
    msg_link: str
    is_reimbursement: bool = False
    invoice_number: str = "-"
    invoice_group_id: str | None = None
    reimbursed_at: datetime | None = None
    user_id: int | None = None
    user_name: str | None = None
    master_item_id: int | None = None
    supplier_id: int | None = None
    bank_account_id: int | None = None
    reconciled_at: datetime | None = None
    reconciled_ref: str | None = None
    sheets_synced: bool

    model_config = ConfigDict(from_attributes=True)


class ExpenseDuplicatePair(BaseModel):
    expense_a: ExpenseResponse
    expense_b: ExpenseResponse
    similarity_score: float
    similarity_pct: int
    expense_date: str
    total_price: float
    reason: str
    suggested_keep_id: int
    suggested_delete_id: int


class ExpenseAuditResponse(BaseModel):
    ok: bool = True
    total_duplicates: int
    total_potential_waste: float
    pairs: list[ExpenseDuplicatePair]


class ExpenseUserResponse(BaseModel):
    id: int
    name: str
    telegram_id: int | None = None
    is_auth: bool = False


class ExpenseListResponse(BaseModel):
    ok: bool = True
    data: list[ExpenseResponse]
    total: int
    page: int
    per_page: int
    total_pages: int


class ExpenseInvoiceGroupResponse(BaseModel):
    group_key: str
    invoice_number: str = "-"
    invoice_group_id: str | None = None
    is_grouped: bool = False
    expense_date: str
    supplier: str = "-"
    supplier_id: int | None = None
    user_id: int | None = None
    user_name: str | None = None
    msg_link: str = "Web Dashboard"
    pay_method: str = "Tunai"
    items_count: int
    matched_items_count: int
    matched_item_ids: list[int] = []
    categories: list[str] = []
    primary_category: str = "Operasional"
    subtotal_items: float = 0.0
    shipping_fee: float = 0.0
    tax: float = 0.0
    other_fee: float = 0.0
    discount: float = 0.0
    total_amount: float = 0.0
    paid_amount: float = 0.0
    remaining_amount: float = 0.0
    payment_progress_pct: float = 0.0
    pay_status: str = "Lunas"
    is_paid: bool = True
    is_dp: bool = False
    is_mixed_pay_status: bool = False
    due_date: str = "-"
    is_reimbursement: bool = False
    reimbursed_status: str = "none"  # "none" | "pending" | "partial" | "reimbursed"
    reimbursed_count: int = 0
    reimbursement_pending_count: int = 0
    reimbursement_pending_total: float = 0.0
    reimbursed_at: datetime | None = None
    items: list[ExpenseResponse] = []


class ExpenseInvoiceListResponse(BaseModel):
    ok: bool = True
    data: list[ExpenseInvoiceGroupResponse]
    total: int
    total_items: int = 0
    page: int
    per_page: int
    total_pages: int


class ReimbursementUserSummary(BaseModel):
    user_id: int | None = None
    user_name: str
    telegram_id: int | None = None
    pending_count: int = 0
    pending_total: float = 0.0
    reimbursed_count: int = 0
    reimbursed_total: float = 0.0
    total_count: int = 0
    total_nominal: float = 0.0
    belanja_pending_count: int = 0
    belanja_pending_total: float = 0.0
    ongkir_pending_count: int = 0
    ongkir_pending_total: float = 0.0
    belanja_reimbursed_count: int = 0
    belanja_reimbursed_total: float = 0.0
    ongkir_reimbursed_count: int = 0
    ongkir_reimbursed_total: float = 0.0
    belanja_total_count: int = 0
    belanja_total_nominal: float = 0.0
    ongkir_total_count: int = 0
    ongkir_total_nominal: float = 0.0


class ReimbursementSummaryResponse(BaseModel):
    ok: bool = True
    pending_count: int = 0
    pending_total: float = 0.0
    reimbursed_count: int = 0
    reimbursed_total: float = 0.0
    total_count: int = 0
    total_nominal: float = 0.0
    belanja_pending_count: int = 0
    belanja_pending_total: float = 0.0
    ongkir_pending_count: int = 0
    ongkir_pending_total: float = 0.0
    belanja_reimbursed_count: int = 0
    belanja_reimbursed_total: float = 0.0
    ongkir_reimbursed_count: int = 0
    ongkir_reimbursed_total: float = 0.0
    belanja_total_count: int = 0
    belanja_total_nominal: float = 0.0
    ongkir_total_count: int = 0
    ongkir_total_nominal: float = 0.0
    by_user: list[ReimbursementUserSummary] = []


class ReimbursementSettleRequest(BaseModel):
    expense_ids: list[int]
    action: str = "mark_reimbursed"  # "mark_reimbursed" | "unmark"
    bank_account_id: int | None = None


class UnpaidNearestDue(BaseModel):
    expense_id: int
    item_name: str
    supplier: str
    due_date: str
    parsed_due_date: str | None = None
    total_price: float
    paid_amount: float = 0.0
    remaining_amount: float = 0.0
    pay_status: str = "Belum Lunas"
    days_left: int | None = None
    is_overdue: bool = False
    is_today: bool = False
    urgency: str = "upcoming"


class UnpaidSupplierSummary(BaseModel):
    supplier_id: int | None = None
    supplier_name: str
    unpaid_count: int = 0
    unpaid_total: float = 0.0
    dp_count: int = 0
    dp_paid_total: float = 0.0
    paid_count: int = 0
    paid_total: float = 0.0
    total_count: int = 0
    total_nominal: float = 0.0
    nearest_due_date: str | None = None
    nearest_days_left: int | None = None
    has_overdue: bool = False


class UnpaidSummaryResponse(BaseModel):
    ok: bool = True
    total_unpaid_count: int = 0
    total_unpaid_nominal: float = 0.0
    unpaid_count: int = 0
    unpaid_total: float = 0.0
    dp_count: int = 0
    dp_paid_nominal: float = 0.0
    dp_remaining_nominal: float = 0.0
    total_invoice_nominal: float = 0.0
    paid_count: int = 0
    paid_total: float = 0.0
    total_count: int = 0
    overdue_count: int = 0
    overdue_nominal: float = 0.0
    overdue_total: float = 0.0
    due_today_count: int = 0
    due_today_nominal: float = 0.0
    due_soon_count: int = 0
    due_soon_nominal: float = 0.0
    no_due_date_count: int = 0
    nearest_due: UnpaidNearestDue | None = None
    by_supplier: list[UnpaidSupplierSummary] = []


class UnpaidSettleRequest(BaseModel):
    expense_ids: list[int]
    action: str = "mark_paid"  # "mark_paid" | "mark_unpaid"
    bank_account_id: int | None = None
    pay_method: str | None = None
    payment_date: date | None = None
    reference_no: str | None = None
    notes: str | None = None


class UnpaidInvoicePaymentRequest(BaseModel):
    expense_ids: list[int]
    amount: float | None = Field(None, gt=0)
    dp_percent: float | None = Field(None, gt=0, le=100)
    payment_type: str | None = None
    payment_date: date = Field(default_factory=date.today)
    pay_method: str = "Transfer"
    bank_account_id: int | None = None
    reference_no: str | None = None
    notes: str = "-"
    due_date: str | None = None
    settle_full: bool = False


class ExpenseLogResponse(BaseModel):
    id: int
    expense_id: int | None = None
    action: str
    actor: str
    details: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonthlyReportResponse(BaseModel):
    ok: bool = True
    month: int
    month_end: int | None = None
    year: int
    month_name: str
    total_lunas: float
    total_pengeluaran: float
    total_tukar_cash: float = 0.0
    tukar_cash_count: int = 0
    total_ongkir: float = 0.0
    ongkir_count: int = 0
    ongkir_reimburse_count: int = 0
    ongkir_reimburse_total: float = 0.0
    total_belanja_riil: float = 0.0
    expense_count: int
    prev_month_name: str | None = None
    prev_total_lunas: float = 0.0
    prev_total_pengeluaran: float = 0.0
    mom_lunas_change_pct: float | None = None
    mom_total_change_pct: float | None = None
    monthly_budget_limit: float = 0.0
    budget_used_pct: float | None = None
    category_budgets: dict[str, float] = {}
    category_budget_percentages: dict[str, float] = {}
    is_custom_budget: bool = False
    per_kategori: dict[str, float]
    per_metode_bayar: dict[str, float] = {}
    per_account_group: dict[str, float] = {}
    prev_per_account_group: dict[str, float] = {}
    mom_account_group_change_pct: dict[str, float | None] = {}
    accounting_inflation: dict[str, Any] = {}
    accounting_breakdown: list[dict[str, Any]] = []
    list_hutang: list[dict[str, Any]]
    daily_chart: list[dict[str, Any]]
    valid_categories: list[str]
    valid_units: list[str] = []
    reimburse_pending_count: int = 0
    reimburse_pending_total: float = 0.0
    top_frequent_items: list[dict[str, Any]] = []
    top_expensive_items: list[dict[str, Any]] = []
    top_unit_price_items: list[dict[str, Any]] = []
    top_price_spikes: list[dict[str, Any]] = []
    top_suppliers: list[dict[str, Any]] = []
    summary_metrics: dict[str, Any] = {}


class AiAnalysisResponse(BaseModel):
    ok: bool = True
    month: int
    year: int
    month_name: str
    health_status: str  # "SEHAT" | "PERLU_PERHATIAN" | "KRITIS"
    health_score: int  # 1 - 100
    summary: str
    key_insights: list[str] = []
    budget_analysis: str = ""
    price_alerts: list[str] = []
    actionable_recommendations: list[str] = []
    markdown_report: str = ""
    analyzed_at: str
    cached: bool = False


class AccountLineItem(BaseModel):
    account_code: str
    account_name: str
    category: str
    account_group: str
    report_type: str
    total: float
    prev_total: float = 0.0
    diff_nominal: float = 0.0
    mom_change_pct: float | None = None
    percentage_of_group: float = 0.0
    percentage_of_total_expense: float = 0.0
    percentage_of_revenue: float | None = None
    transaction_count: int = 0
    description: str = ""


class LabaRugiReport(BaseModel):
    paid_tx_count: int = 0
    revenue_gross: float = 0.0
    revenue_discount: float = 0.0
    revenue_platform_fee: float = 0.0
    revenue_net: float = 0.0
    prev_revenue_net: float = 0.0
    mom_revenue_change_pct: float | None = None
    gross_profit: float = 0.0
    gross_margin_pct: float | None = None
    net_profit: float = 0.0
    net_margin_pct: float | None = None
    prev_net_profit: float = 0.0
    disposal_gain_loss: float = 0.0
    depreciation_expense: float = 0.0
    low_value_asset_expense: float = 0.0
    revenue_by_channel: list[dict[str, Any]] = []
    hpp_items: list[AccountLineItem]
    subtotal_hpp: float
    prev_subtotal_hpp: float
    mom_hpp_change_pct: float | None = None
    opex_items: list[AccountLineItem]
    subtotal_opex: float
    prev_subtotal_opex: float
    mom_opex_change_pct: float | None = None
    total_beban: float
    prev_total_beban: float
    mom_beban_change_pct: float | None = None


class NeracaItem(BaseModel):
    account_code: str
    account_name: str
    group: str
    nominal: float
    description: str = ""


class RekeningPositionItem(BaseModel):
    id: int
    account_code: str
    name: str
    bank_name: str
    account_type: str
    opening_balance: float = 0.0
    incoming_month: float = 0.0
    outgoing_month: float = 0.0
    net_month_flow: float = 0.0
    estimated_balance: float = 0.0


class NeracaReport(BaseModel):
    aset_lancar: list[NeracaItem]
    subtotal_aset_lancar: float
    rekening_positions: list[RekeningPositionItem] = []
    total_rekening_balance: float = 0.0
    aset_tetap: list[NeracaItem]
    aset_tetap_summary: dict[str, Any] = {}
    subtotal_aset_tetap: float
    total_aset: float
    kewajiban_lancar: list[NeracaItem]
    subtotal_kewajiban: float
    detail_hutang: list[dict[str, Any]] = []
    ekuitas: list[NeracaItem] = []
    subtotal_ekuitas: float = 0.0


class ArusKasItem(BaseModel):
    activity: str
    account_name: str
    nominal: float
    percentage: float = 0.0


class ArusKasReport(BaseModel):
    total_kas_masuk: float = 0.0
    net_cash_flow: float = 0.0
    aktivitas_operasi: list[ArusKasItem]
    subtotal_operasi: float
    aktivitas_investasi: list[ArusKasItem]
    subtotal_investasi: float
    aktivitas_kliring: list[ArusKasItem]
    subtotal_kliring: float
    total_kas_keluar_riil: float
    metode_bayar_distribution: list[dict[str, Any]] = []


class AccountingAnalysis(BaseModel):
    cost_structure: dict[str, Any]
    top_variances_mom: dict[str, Any]
    health_evaluation: list[dict[str, Any]]
    hpp_variance: dict[str, Any] = {}


class AccountingReportResponse(BaseModel):
    ok: bool = True
    month: int
    month_end: int | None = None
    year: int
    month_name: str
    prev_month_name: str
    laba_rugi: LabaRugiReport
    neraca: NeracaReport
    arus_kas: ArusKasReport
    analisis: AccountingAnalysis
    all_accounts: list[AccountLineItem]


class DailyCashflowRow(BaseModel):
    date: str
    cash_in: float
    cash_out: float
    net_flow: float
    saldo: float
    cash_in_count: int = 0
    cash_out_count: int = 0


class DailyCashflowResponse(BaseModel):
    ok: bool = True
    periode: str
    start_date: str
    end_date: str
    month: int | None = None
    year: int | None = None
    bank_account_id: int | None = None
    account_name: str
    saldo_awal: float
    total_cash_in: float
    total_cash_out: float
    net_cash_flow: float
    saldo_akhir: float
    total_tx_in: int
    total_tx_out: int
    days_count: int
    bank_accounts: list[dict[str, Any]] = []
    daily_rows: list[DailyCashflowRow]


class MasterItemCreate(BaseModel):
    item_name: str
    category: str = "Bahan Kue"
    default_supplier: str = "-"
    aliases: str = ""
    satuan_beli: str = "Pcs"
    tipe_satuan: str = "keduanya"
    isi_paket: str = ""
    satuan_ecer: str = "Pcs"
    satuan_resep: str | None = None
    konversi_resep: float | None = Field(None, gt=0)


class MasterItemUpdate(BaseModel):
    item_name: str | None = None
    category: str | None = None
    default_supplier: str | None = None
    aliases: str | None = None
    satuan_beli: str | None = None
    tipe_satuan: str | None = None
    isi_paket: str | None = None
    satuan_ecer: str | None = None
    satuan_resep: str | None = None
    konversi_resep: float | None = Field(None, gt=0)


class MasterItemBulkRequest(BaseModel):
    raw_text: str = ""
    default_category: str = "Bahan Kue"
    items: list[MasterItemCreate] | None = None
    update_existing: bool = True


class MasterItemResponse(BaseModel):
    id: int
    item_name: str
    category: str
    default_supplier: str
    aliases: str
    satuan_beli: str = "Pcs"
    tipe_satuan: str = "keduanya"
    isi_paket: str = ""
    satuan_ecer: str = "Pcs"
    satuan_resep: str | None = None
    konversi_resep: float | None = None
    recipe_unit_price: float | None = None
    last_unit_price: float = 0.0
    last_supplier: str = "-"
    tx_count: int = 0
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class MasterItemDuplicatePair(BaseModel):
    item_a: MasterItemResponse
    item_b: MasterItemResponse
    similarity_score: float
    match_type: str  # "substring", "prefix_suffix", "fuzzy", "alias"
    reason: str
    suggested_primary_id: int
    both_in_supplier: bool = False


class MasterItemAuditResponse(BaseModel):
    ok: bool
    total_duplicates: int
    pairs: list[MasterItemDuplicatePair]


class MasterItemMergeRequest(BaseModel):
    target_item_id: int
    source_item_ids: list[int]
    custom_name: str | None = None
    custom_category: str | None = None
    custom_supplier: str | None = None
    custom_satuan_beli: str | None = None
    custom_tipe_satuan: str | None = None
    custom_isi_paket: str | None = None
    custom_satuan_ecer: str | None = None
    merge_aliases: bool = True
    update_expenses: bool = True


class MasterItemMergeResponse(BaseModel):
    ok: bool
    message: str
    target_item: MasterItemResponse
    merged_sources: list[str]
    expenses_reassigned_count: int
    aliases_added: list[str]


class AuthPermissions(BaseModel):
    can_edit: bool = True
    can_delete: bool = False
    can_view_charts: bool = False
    can_manage_config: bool = False
    can_manage_requests: bool = True
    can_approve_requests: bool = False
    can_order_purchasing: bool = False
    can_receive_warehouse: bool = False
    can_settle_talangan: bool = False
    can_access_warehouse: bool = False


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: str | None = None
    role: str | None = None
    permissions: AuthPermissions | None = None


class PinVerifyRequest(BaseModel):
    pin: str


class AdminInputLoginRequest(BaseModel):
    password: str


class RoleLoginRequest(BaseModel):
    role: str
    password: str


class SystemConfigUpdate(BaseModel):
    telegram_token: str | None = None
    dashboard_pin_chat_id: str | None = None
    dashboard_pin_thread_id: int | None = None
    allowed_thread_id: int | None = None
    allowed_thread_ids: str | None = None
    tukar_cash_thread_ids: str | None = None
    ongkir_thread_ids: str | None = None
    report_chat_id: str | None = None
    report_thread_id: int | None = None
    sumopod_api_key: str | None = None
    sumopod_model: str | None = None
    sumopod_url: str | None = None
    ai_analysis_api_key: str | None = None
    ai_analysis_url: str | None = None
    ai_analysis_model: str | None = None
    ai_chat_default_provider: str | None = None
    ai_chat_default_model: str | None = None
    ai_chat_openrouter_models: str | None = None
    ai_chat_classai_models: str | None = None
    ai_chat_sumopod_models: str | None = None
    spreadsheet_id: str | None = None
    bot_password: str | None = None
    admin_input_password: str | None = None
    purchasing_password: str | None = None
    warehouse_password: str | None = None
    staff_password: str | None = None
    request_belanja_chat_id: str | None = None
    request_belanja_thread_id: int | None = None
    webhook_url: str | None = None
    monthly_budget_limit: int | None = None
    category_budgets: dict[str, float] | None = None
    asset_capitalization_threshold: int | None = None
    asset_default_useful_life_months: int | None = None


class MonthlyBudgetUpsert(BaseModel):
    year: int
    month: int
    total_budget: float = 0.0
    category_percentages: dict[str, float] = {}


class MonthlyBudgetCopyRequest(BaseModel):
    target_year: int
    target_month: int
    source_year: int | None = None
    source_month: int | None = None
    use_previous_cash_balance: bool = False


class MonthlyBudgetDetailResponse(BaseModel):
    ok: bool = True
    year: int
    month: int
    total_budget: float = 0.0
    category_percentages: dict[str, float] = {}
    category_amounts: dict[str, float] = {}
    is_custom: bool = False
    valid_categories: list[str]
    valid_units: list[str] = []
    previous_month_ending_balance: float | None = 0.0
    previous_month_year: int | None = None
    previous_month: int | None = None
    message: str | None = None


# ──────────────────────────────────────────────
# Master Data Options Schemas (Metode Bayar, Kategori, Satuan)
# ──────────────────────────────────────────────

class MasterDataOptionCreate(BaseModel):
    type: str  # "kategori" | "metode_bayar" | "satuan" | "kategori_menu"
    name: str
    description: str = ""
    sort_order: int | None = None
    is_default: bool = False
    account_code: str | None = None
    account_name: str | None = None
    account_group: str | None = None
    report_type: str | None = None


class MasterDataOptionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_default: bool | None = None
    account_code: str | None = None
    account_name: str | None = None
    account_group: str | None = None
    report_type: str | None = None


class MasterDataOptionResponse(BaseModel):
    id: int
    type: str
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True
    is_default: bool = False
    usage_count: int = 0
    account_code: str | None = None
    account_name: str | None = None
    account_group: str | None = None
    report_type: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ──────────────────────────────────────────────
# Master Supplier / Toko Schemas
# ──────────────────────────────────────────────

class SupplierBase(BaseModel):
    name: str
    phone: str = ""
    address: str = ""
    aliases: str = ""
    notes: str = ""
    supplier_type: str = "toko"
    courier_category: str | None = None
    is_subscribed: bool = False
    is_active: bool = True


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    address: str | None = None
    aliases: str | None = None
    notes: str | None = None
    supplier_type: str | None = None
    courier_category: str | None = None
    is_subscribed: bool | None = None
    is_active: bool | None = None


class SupplierResponse(SupplierBase):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    total_spent: float = 0.0
    transaction_count: int = 0
    unpaid_bills_count: int = 0
    unpaid_bills_total: float = 0.0
    last_expense_date: str | None = None

    model_config = ConfigDict(from_attributes=True)


class SupplierUnpaidBillItem(BaseModel):
    id: int
    expense_date: str
    item_name: str
    total_price: float
    paid_amount: float = 0.0
    remaining_amount: float = 0.0
    due_date: str = "-"
    invoice_number: str = "-"
    notes: str = "-"
    category: str = "Operasional"
    pay_method: str = "Tunai"
    pay_status: str = "Belum Lunas"


class SupplierDetailResponse(SupplierResponse):
    avg_per_transaction: float = 0.0
    first_expense_date: str | None = None
    unpaid_bills: list[SupplierUnpaidBillItem] = []


class SupplierListSummary(BaseModel):
    total_suppliers: int = 0
    total_spent: float = 0.0
    total_unpaid_amount: float = 0.0
    unpaid_suppliers_count: int = 0


class SupplierListResponse(BaseModel):
    items: list[SupplierResponse]
    total: int
    page: int
    limit: int
    summary: SupplierListSummary | None = None


class SupplierTopItem(BaseModel):
    item_name: str
    master_item_id: int | None = None
    category: str = "Lainnya"
    purchase_count: int
    total_qty: float
    unit: str = "Pcs"
    total_spent: float


class SupplierPriciestItem(BaseModel):
    item_name: str
    master_item_id: int | None = None
    category: str = "Lainnya"
    max_unit_price: float
    unit: str = "Pcs"
    last_purchase_date: str | None = None


class SupplierDuplicateItem(BaseModel):
    id: int
    name: str
    phone: str = ""
    address: str = ""
    transaction_count: int = 0
    total_spent: float = 0.0
    similarity: float = 0.0
    reason: str


class SupplierDuplicateGroup(BaseModel):
    suggested_primary_id: int
    primary: dict
    duplicates: list[SupplierDuplicateItem]


class SupplierMergeRequest(BaseModel):
    target_supplier_id: int
    source_supplier_ids: list[int]


class SupplierBulkCreateRequest(BaseModel):
    items: list[SupplierCreate]
    update_existing: bool = True


# ──────────────────────────────────────────────
# Purchase Request Schemas (Multi-Item & 3 Roles)
# ──────────────────────────────────────────────

class PurchaseRequestItemBase(BaseModel):
    item_name: str
    qty: float = 1.0
    unit: str = "Pcs"
    category: str | None = "Bahan Kue"
    notes: str = "-"
    estimated_price: float | None = None
    supplier_id: int | None = None
    supplier_name: str = "-"


class PurchaseRequestItemCreate(PurchaseRequestItemBase):
    pass


class PurchaseRequestItemResponse(PurchaseRequestItemBase):
    id: int
    request_id: int
    master_item_id: int | None = None
    order_status: str = "PENDING"
    ordered_at: datetime | None = None
    qty_received: float | None = None
    receiving_status: str = "PENDING"
    expired_date: str | None = None
    received_by: str | None = None
    received_at: datetime | None = None
    receiving_notes: str | None = None
    expense_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class PurchaseRequestBase(BaseModel):
    title: str = "Request Belanja"
    item_name: str | None = None
    qty: float | None = 1.0
    unit: str | None = "Pcs"
    category: str | None = None
    estimated_price: float | None = None
    urgency: str = "NORMAL"
    notes: str = "-"
    requester_name: str = "-"
    request_date: str | None = None


class PurchaseRequestCreate(PurchaseRequestBase):
    user_id: int | None = None
    status: str = "PENDING"
    items: list[PurchaseRequestItemCreate] = []


class PurchaseRequestUpdate(BaseModel):
    title: str | None = None
    item_name: str | None = None
    qty: float | None = None
    unit: str | None = None
    category: str | None = None
    estimated_price: float | None = None
    urgency: str | None = None
    notes: str | None = None
    requester_name: str | None = None
    request_date: str | None = None
    status: str | None = None
    items: list[PurchaseRequestItemCreate] | None = None


class PurchaseRequestRejectInput(BaseModel):
    reason: str = "Ditolak oleh admin"


class PurchasingAssignSupplierInput(BaseModel):
    supplier_id: int | None = None
    supplier_name: str | None = None
    estimated_price: float | None = None


class PurchasingSupplierOption(BaseModel):
    id: int
    name: str
    phone: str = ""
    address: str = ""
    has_item: bool = False
    is_default_supplier: bool = False
    tx_count: int = 0
    last_unit_price: float | None = None
    last_date: str | None = None


class PurchasingSupplierOptionsResponse(BaseModel):
    item_id: int
    item_name: str
    matching_suppliers: list[PurchasingSupplierOption] = []
    other_suppliers: list[PurchasingSupplierOption] = []


class PurchasingItemUpdateInput(BaseModel):
    item_name: str | None = None
    qty: float | None = Field(None, gt=0)
    unit: str | None = None
    category: str | None = None
    estimated_price: float | None = Field(None, ge=0)
    notes: str | None = None


class PurchasingItemCreateInput(BaseModel):
    request_id: int | None = None
    item_name: str
    qty: float = Field(1, gt=0)
    unit: str = "Pcs"
    category: str | None = "Bahan Kue"
    supplier_id: int | None = None
    supplier_name: str | None = None
    estimated_price: float | None = Field(None, ge=0)
    notes: str = ""


class PurchasingItemCancelInput(BaseModel):
    reason: str = "Barang tidak tersedia di supplier"


class PurchasingMarkOrderedInput(BaseModel):
    item_ids: list[int]


class PurchasingWhatsAppTemplateInput(BaseModel):
    supplier_name: str
    item_ids: list[int]
    custom_notes: str = ""


class WarehouseReceiveItemInput(BaseModel):
    qty_received: float
    expired_date: str | None = None
    received_by: str = "Gudang"
    receiving_notes: str = "-"


class PurchaseRequestResponse(PurchaseRequestBase):
    id: int
    request_number: str = ""
    status: str
    user_id: int | None = None
    reviewed_by_id: int | None = None
    reviewer_name: str | None = None
    reviewed_at: datetime | None = None
    reject_reason: str | None = None
    expense_id: int | None = None
    fulfilled_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[PurchaseRequestItemResponse] = []

    model_config = ConfigDict(from_attributes=True)


class PurchaseRequestStatsResponse(BaseModel):
    total: int = 0
    draft: int = 0
    pending: int = 0
    approved: int = 0
    ordered: int = 0
    received: int = 0
    fulfilled: int = 0
    rejected: int = 0
    urgent_pending: int = 0


class PurchaseRequestListResponse(BaseModel):
    items: list[PurchaseRequestResponse]
    total: int
    stats: PurchaseRequestStatsResponse | None = None


class SsoExchangeRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=4096)


# ──────────────────────────────────────────────
# Fixed Assets & Maintenance Schemas (SAK EMKM)
# ──────────────────────────────────────────────

class FixedAssetCreate(BaseModel):
    name: str
    asset_group: str = "Mesin & Peralatan Dapur"
    brand_model: str = ""
    serial_number: str = ""
    vendor_name: str = "-"
    supplier_id: int | None = None
    expense_id: int | None = None
    location: str = "Dapur Produksi"
    pic_name: str = "-"
    condition: str = "Baik"
    status: str = "Aktif"
    purchase_date: date = Field(default_factory=date.today)
    warranty_months: int = 0
    warranty_expiry_date: date | None = None
    warranty_notes: str = ""
    acquisition_cost: float = Field(..., ge=0)
    salvage_value: float = Field(0.0, ge=0)
    useful_life_months: int | None = None
    depreciation_method: str | None = None
    capitalization_status: str | None = None
    is_capitalization_overridden: bool = False
    depreciation_start_date: date | None = None
    notes: str = ""


class FixedAssetUpdate(BaseModel):
    name: str | None = None
    asset_group: str | None = None
    brand_model: str | None = None
    serial_number: str | None = None
    vendor_name: str | None = None
    location: str | None = None
    pic_name: str | None = None
    condition: str | None = None
    status: str | None = None
    warranty_months: int | None = None
    warranty_expiry_date: date | None = None
    warranty_notes: str | None = None
    acquisition_cost: float | None = Field(None, ge=0)
    salvage_value: float | None = Field(None, ge=0)
    useful_life_months: int | None = Field(None, ge=0)
    depreciation_method: str | None = None
    capitalization_status: str | None = None
    is_capitalization_overridden: bool | None = None
    notes: str | None = None


class FixedAssetDisposeRequest(BaseModel):
    disposed_at: date = Field(default_factory=date.today)
    disposal_type: str = "rusak"  # "rusak" | "hilang" | "dijual"
    disposal_proceeds: float = Field(0.0, ge=0)
    disposal_notes: str = ""


class AssetMaintenanceCreate(BaseModel):
    maintenance_date: date = Field(default_factory=date.today)
    maintenance_type: str = "Perbaikan"
    vendor_name: str = "-"
    cost: float = Field(0.0, ge=0)
    description: str = "-"
    next_service_date: date | None = None
    service_warranty_until: date | None = None
    performed_by: str = "-"
    create_expense: bool = False
    pay_method: str = "Tunai"


class AssetReanalyzeRequest(BaseModel):
    asset_capitalization_threshold: int | None = Field(None, ge=0)
    asset_default_useful_life_months: int | None = Field(None, ge=1)


class FixedAssetBulkCreateRequest(BaseModel):
    items: list[FixedAssetCreate]


# ── Laporan Umum (General Reports) Schemas ───────────────────────────────────


class GeneralReportPeriod(BaseModel):
    start_date: date
    end_date: date
    label: str


class MaterialItemRow(BaseModel):
    item_name: str
    category: str
    supplier: str | None = None
    total_qty: float
    unit: str
    tx_count: int
    total_bruto: float
    total_spend: float
    wap: float
    prev_wap: float | None = None
    recipe_unit: str | None = None
    recipe_unit_cost: float | None = None
    price_drift_pct: float | None = None
    is_drifting: bool = False


class MaterialSupplierRow(BaseModel):
    supplier: str
    total_spend: float
    tx_count: int
    share_pct: float


class MaterialsReportResponse(BaseModel):
    period: GeneralReportPeriod
    total_bruto: float
    total_spend: float
    material_to_sales_pct: float | None = None
    unique_suppliers: int
    drifting_items: int
    discrepancy_count: int
    items: list[MaterialItemRow]
    supplier_breakdown: list[MaterialSupplierRow]


class ShippingCourierRow(BaseModel):
    courier: str
    courier_category: str | None = None
    is_subscribed: bool = False
    trip_count: int
    total_cost: float
    avg_cost_per_trip: float
    talangan_cost: float
    kas_cost: float
    share_pct: float


class ShippingReportResponse(BaseModel):
    period: GeneralReportPeriod
    total_shipping_cost: float
    ongkir_mandiri_total: float
    ongkir_trip_count: int
    avg_cost_per_trip: float
    freight_in_total: float
    freight_in_count: int
    talangan_total: float
    talangan_pending_total: float
    kas_toko_total: float
    shipping_to_sales_pct: float | None = None
    freight_in_to_material_pct: float | None = None
    mom_change_pct: float | None = None
    couriers: list[ShippingCourierRow]


class SalesChannelRow(BaseModel):
    channel: str
    order_count: int
    gross_sales: float
    discount_amount: float
    net_sales: float
    net_received: float
    platform_fee: float
    aov: float
    discount_rate: float | None = None
    platform_fee_rate: float | None = None
    void_count: int = 0
    void_nominal: float = 0.0
    void_rate_pct: float | None = None


class DailySalesRow(BaseModel):
    date: date
    gross_sales: float
    net_sales: float
    net_received: float
    order_count: int


class SalesReportResponse(BaseModel):
    period: GeneralReportPeriod
    total_orders: int
    total_gross_sales: float
    total_discount_amount: float
    total_net_sales: float
    total_platform_fee: float
    total_net_received: float
    total_aov: float
    daily_avg_net_sales: float
    void_count: int
    void_nominal: float
    void_rate_pct: float | None = None
    mom_growth_pct: float | None = None
    channels: list[SalesChannelRow]
    daily: list[DailySalesRow]


class MenuChannelMarginRow(BaseModel):
    key: str
    name: str
    net_profit: float
    net_margin_pct: float | None = None


class MenuEngineeringRow(BaseModel):
    menu_id: int
    menu_name: str
    category: str
    selling_price: float
    core_unit_hpp: float
    recipe_hpp: float
    effective_hpp: float
    food_cost_pct: float | None = None
    pure_food_cost_pct: float | None = None
    packaging_cost_pct: float | None = None
    gross_margin_pct: float | None = None
    contribution_margin: float
    qty_sold: int
    gross_revenue: float
    theoretical_hpp: float
    classification: str  # Star | Plowhorse | Puzzle | Dog
    has_price_drift: bool = False
    channel_margins: list[MenuChannelMarginRow] = []


class HppReportResponse(BaseModel):
    period: GeneralReportPeriod
    hpp_basis_note: str
    theoretical_hpp_total: float
    actual_purchase_hpp: float
    hpp_variance_amount: float
    theoretical_food_cost_pct: float | None = None
    actual_purchase_ratio_pct: float | None = None
    popularity_threshold: float
    cm_threshold: float
    unmatched_items: list[str]
    menus: list[MenuEngineeringRow]






