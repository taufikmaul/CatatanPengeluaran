"""
app/api/schemas.py — Pydantic Schemas for CatatanPengeluaran REST API
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from pydantic import BaseModel, Field


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
    notes: str = "-"
    is_reimbursement: bool = False
    invoice_number: str = "-"
    msg_link: str = "Web Dashboard"
    user_id: int | None = None
    master_item_id: int | None = None
    supplier_id: int | None = None


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
    notes: str | None = None
    is_reimbursement: bool | None = None
    invoice_number: str | None = None
    reimbursed_at: datetime | None = None
    msg_link: str | None = None
    user_id: int | None = None
    master_item_id: int | None = None
    supplier_id: int | None = None


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
    notes: str
    msg_link: str
    is_reimbursement: bool = False
    invoice_number: str = "-"
    reimbursed_at: datetime | None = None
    user_id: int | None = None
    user_name: str | None = None
    master_item_id: int | None = None
    supplier_id: int | None = None
    sheets_synced: bool

    class Config:
        from_attributes = True


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


class ReimbursementSummaryResponse(BaseModel):
    ok: bool = True
    pending_count: int = 0
    pending_total: float = 0.0
    reimbursed_count: int = 0
    reimbursed_total: float = 0.0
    total_count: int = 0
    total_nominal: float = 0.0
    by_user: list[ReimbursementUserSummary] = []


class ReimbursementSettleRequest(BaseModel):
    expense_ids: list[int]
    action: str = "mark_reimbursed"  # "mark_reimbursed" | "unmark"


class UnpaidNearestDue(BaseModel):
    expense_id: int
    item_name: str
    supplier: str
    due_date: str
    total_price: float
    days_left: int | None = None
    is_overdue: bool = False
    is_today: bool = False


class UnpaidSupplierSummary(BaseModel):
    supplier_id: int | None = None
    supplier_name: str
    unpaid_count: int = 0
    unpaid_total: float = 0.0
    nearest_due_date: str | None = None
    nearest_days_left: int | None = None


class UnpaidSummaryResponse(BaseModel):
    ok: bool = True
    total_unpaid_count: int = 0
    total_unpaid_nominal: float = 0.0
    overdue_count: int = 0
    overdue_nominal: float = 0.0
    due_today_count: int = 0
    due_today_nominal: float = 0.0
    due_soon_count: int = 0
    due_soon_nominal: float = 0.0
    nearest_due: UnpaidNearestDue | None = None
    by_supplier: list[UnpaidSupplierSummary] = []


class UnpaidSettleRequest(BaseModel):
    expense_ids: list[int]
    action: str = "mark_paid"  # "mark_paid" | "mark_unpaid"


class ExpenseLogResponse(BaseModel):
    id: int
    expense_id: int | None = None
    action: str
    actor: str
    details: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class MonthlyReportResponse(BaseModel):
    ok: bool = True
    month: int
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


class MasterItemCreate(BaseModel):
    item_name: str
    category: str = "Bahan Kue"
    default_supplier: str = "-"
    aliases: str = ""
    satuan_beli: str = "Pcs"
    tipe_satuan: str = "keduanya"
    isi_paket: str = ""
    satuan_ecer: str = "Pcs"


class MasterItemUpdate(BaseModel):
    item_name: str | None = None
    category: str | None = None
    default_supplier: str | None = None
    aliases: str | None = None
    satuan_beli: str | None = None
    tipe_satuan: str | None = None
    isi_paket: str | None = None
    satuan_ecer: str | None = None


class MasterItemBulkRequest(BaseModel):
    raw_text: str
    default_category: str = "Bahan Kue"


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
    last_unit_price: float = 0.0
    last_supplier: str = "-"
    tx_count: int = 0
    created_at: datetime | None = None

    class Config:
        from_attributes = True


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


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: str | None = None
    role: str | None = None
    permissions: AuthPermissions | None = None


class PinVerifyRequest(BaseModel):
    pin: str


class AdminInputLoginRequest(BaseModel):
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
    spreadsheet_id: str | None = None
    bot_password: str | None = None
    admin_input_password: str | None = None
    webhook_url: str | None = None
    monthly_budget_limit: int | None = None
    category_budgets: dict[str, float] | None = None


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
    message: str | None = None


# ──────────────────────────────────────────────
# Master Data Options Schemas (Metode Bayar, Kategori, Satuan)
# ──────────────────────────────────────────────

class MasterDataOptionCreate(BaseModel):
    type: str  # "kategori" | "metode_bayar" | "satuan"
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
    is_active: bool = True


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    address: str | None = None
    aliases: str | None = None
    notes: str | None = None
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

    class Config:
        from_attributes = True


class SupplierUnpaidBillItem(BaseModel):
    id: int
    expense_date: str
    item_name: str
    total_price: float
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



