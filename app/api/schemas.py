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
    category: str = "Operasional"
    unit_price: float = 0.0
    tax: float = 0.0
    discount: float = 0.0
    total_price: float = 0.0
    pay_method: str = "Tunai"
    pay_status: str = "Lunas"
    due_date: str = "-"
    notes: str = "-"
    is_reimbursement: bool = False
    invoice_number: str = "-"


class ExpenseCreate(ExpenseBase):
    pass


class ExpenseUpdate(BaseModel):
    expense_date: date | None = None
    supplier: str | None = None
    item_name: str | None = None
    qty: float | None = None
    category: str | None = None
    unit_price: float | None = None
    tax: float | None = None
    discount: float | None = None
    total_price: float | None = None
    pay_method: str | None = None
    pay_status: str | None = None
    due_date: str | None = None
    notes: str | None = None
    is_reimbursement: bool | None = None
    invoice_number: str | None = None


class ExpenseResponse(BaseModel):
    id: int
    created_at: datetime | None = None
    expense_date: str
    supplier: str
    item_name: str
    qty: float
    category: str
    unit_price: float
    tax: float
    discount: float
    total_price: float
    pay_method: str
    pay_status: str
    due_date: str
    notes: str
    msg_link: str
    is_reimbursement: bool = False
    invoice_number: str = "-"
    sheets_synced: bool

    class Config:
        from_attributes = True


class ExpenseListResponse(BaseModel):
    ok: bool = True
    data: list[ExpenseResponse]
    total: int
    page: int
    per_page: int
    total_pages: int


class MonthlyReportResponse(BaseModel):
    ok: bool = True
    month: int
    year: int
    month_name: str
    total_lunas: float
    total_pengeluaran: float
    expense_count: int
    prev_month_name: str | None = None
    prev_total_lunas: float = 0.0
    prev_total_pengeluaran: float = 0.0
    mom_lunas_change_pct: float | None = None
    mom_total_change_pct: float | None = None
    monthly_budget_limit: float = 0.0
    budget_used_pct: float | None = None
    category_budgets: dict[str, float] = {}
    per_kategori: dict[str, float]
    per_metode_bayar: dict[str, float] = {}
    list_hutang: list[dict[str, Any]]
    daily_chart: list[dict[str, Any]]
    valid_categories: list[str]
    top_frequent_items: list[dict[str, Any]] = []
    top_expensive_items: list[dict[str, Any]] = []
    top_unit_price_items: list[dict[str, Any]] = []
    top_price_spikes: list[dict[str, Any]] = []
    top_suppliers: list[dict[str, Any]] = []
    summary_metrics: dict[str, Any] = {}


class MasterItemCreate(BaseModel):
    item_name: str
    category: str = "Bahan Kue"
    default_supplier: str = "-"
    aliases: str = ""


class MasterItemUpdate(BaseModel):
    item_name: str | None = None
    category: str | None = None
    default_supplier: str | None = None
    aliases: str | None = None


class MasterItemBulkRequest(BaseModel):
    raw_text: str
    default_category: str = "Bahan Kue"


class MasterItemResponse(BaseModel):
    id: int
    item_name: str
    category: str
    default_supplier: str
    aliases: str
    last_unit_price: float = 0.0
    last_supplier: str = "-"
    tx_count: int = 0
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: str | None = None


class PinVerifyRequest(BaseModel):
    pin: str


class SystemConfigUpdate(BaseModel):
    telegram_token: str | None = None
    dashboard_pin_chat_id: str | None = None
    dashboard_pin_thread_id: int | None = None
    allowed_thread_id: int | None = None
    report_chat_id: str | None = None
    report_thread_id: int | None = None
    sumopod_api_key: str | None = None
    sumopod_model: str | None = None
    sumopod_url: str | None = None
    spreadsheet_id: str | None = None
    bot_password: str | None = None
    webhook_url: str | None = None
    monthly_budget_limit: int | None = None
    category_budgets: dict[str, float] | None = None

