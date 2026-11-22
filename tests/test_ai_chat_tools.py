"""
tests/test_ai_chat_tools.py — Unit test untuk 9 read-only financial tools AI Chat.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.models.bank_account import BankAccount
from app.models.budget import MonthlyBudget
from app.models.expense import Expense
from app.models.fixed_asset import FixedAsset
from app.models.incoming_transaction import IncomingTransaction
from app.models.menu_product import MenuProduct
from app.models.purchase_request import PurchaseRequest, PurchaseRequestItem
from app.models.supplier import Supplier
from app.models.user import User
from app.services.ai_chat_tools import (
    AI_CHAT_TOOL_SCHEMAS,
    build_fallback_snapshot,
    execute_ai_chat_tool,
)


async def _seed_financial_data(db):
    user = User(telegram_id=991100, name="Rina Kasir", is_auth=True)
    db.add(user)
    await db.flush()

    sup = Supplier(name="Toko Bahan Jaya", supplier_type="toko", is_active=True)
    db.add(sup)
    await db.flush()

    bank = BankAccount(
        name="BCA Operasional",
        bank_name="BCA",
        account_number="1234567890",
        account_type="bank",
        opening_balance=Decimal("1000000.00"),
        is_active=True,
    )
    db.add(bank)
    await db.flush()

    # Pengeluaran bulan 2026-10 dan 2026-11
    exp_prev = Expense(
        user_id=user.id,
        supplier_id=sup.id,
        expense_date=date(2026, 10, 15),
        item_name="Mentega Anchor 2kg",
        qty=Decimal("2"),
        unit="Pcs",
        unit_price=Decimal("200000"),
        total_price=Decimal("400000"),
        category="Bahan Kue",
        supplier="Toko Bahan Jaya",
        pay_method="Transfer",
        pay_status="Lunas",
        bank_account_id=bank.id,
        is_reimbursement=False,
    )
    exp_cur_paid = Expense(
        user_id=user.id,
        supplier_id=sup.id,
        expense_date=date(2026, 11, 10),
        item_name="Mentega Anchor 2kg",
        qty=Decimal("2"),
        unit="Pcs",
        unit_price=Decimal("250000"),
        total_price=Decimal("500000"),
        category="Bahan Kue",
        supplier="Toko Bahan Jaya",
        pay_method="Transfer",
        pay_status="Lunas",
        bank_account_id=bank.id,
        is_reimbursement=False,
    )
    exp_unpaid_reimb = Expense(
        user_id=user.id,
        supplier_id=sup.id,
        expense_date=date(2026, 11, 12),
        item_name="Kotak Kue Premium",
        qty=Decimal("10"),
        unit="Pack",
        unit_price=Decimal("30000"),
        total_price=Decimal("300000"),
        category="Kemasan",
        supplier="Toko Bahan Jaya",
        pay_method="Tunai",
        pay_status="Belum Lunas",
        due_date="2026-11-30",
        is_reimbursement=True,
    )
    db.add_all([exp_prev, exp_cur_paid, exp_unpaid_reimb])

    inc = IncomingTransaction(
        source_type="pos",
        receipt_no="INV-202611-001",
        transaction_date=date(2026, 11, 10),
        order_type="Walk-in",
        payment_method="Transfer",
        bank_account_id=bank.id,
        gross_sales=2500000.0,
        discount_amount=0.0,
        net_sales=2500000.0,
        platform_fee=0.0,
        net_received=2500000.0,
        status="paid",
    )
    db.add(inc)

    budget = MonthlyBudget(
        year=2026,
        month=11,
        total_budget=Decimal("2000000"),
        category_percentages_json='{"Bahan Kue": 20, "Kemasan": 30}',
        category_amounts_json='{"Bahan Kue": 400000, "Kemasan": 600000}',
    )
    db.add(budget)

    menu = MenuProduct(
        name="Chiffon Pandan",
        anonymous_name="MENU-001",
        category="Cake",
        unit="Porsi",
        selling_price=120000.0,
        hpp_manual=45000.0,
        hpp_mode="manual",
        is_active=True,
        is_sellable=True,
    )
    db.add(menu)

    asset = FixedAsset(
        asset_code="AST-2026-001",
        qr_token="qr-test-oven-001",
        name="Oven Deck 2 Tray",
        asset_group="Mesin & Peralatan Dapur",
        vendor_name="Mesin Bakery Pro",
        purchase_date=date(2026, 10, 1),
        acquisition_cost=Decimal("8000000"),
        salvage_value=Decimal("0"),
        useful_life_months=48,
        depreciation_method="straight_line",
        capitalization_status="capitalized",
        depreciation_start_date=date(2026, 10, 1),
    )
    db.add(asset)

    pr = PurchaseRequest(
        request_number="PR-202611-01",
        title="Restok Tepung & Mentega",
        request_date=date(2026, 11, 15),
        user_id=user.id,
        requester_name="Rina Kasir",
        urgency="URGENT",
        status="PENDING",
    )
    pr.items.append(
        PurchaseRequestItem(
            item_name="Tepung Terigu Cakra",
            qty=Decimal("5"),
            unit="Sak",
            estimated_price=Decimal("260000"),
            order_status="PENDING",
        )
    )
    db.add(pr)
    await db.flush()


@pytest.mark.anyio
async def test_all_9_read_only_tools_and_observation_contract(db):
    await _seed_financial_data(db)

    assert len(AI_CHAT_TOOL_SCHEMAS) == 9

    # 1. Monthly expense summary
    obs_monthly = await execute_ai_chat_tool(
        db, "get_monthly_expense_summary", {"year": 2026, "month": 11}
    )
    assert obs_monthly["status"] == "success"
    assert obs_monthly["tool"] == "get_monthly_expense_summary"
    assert obs_monthly["data"]["total_lunas"] == 500000.0
    assert obs_monthly["data"]["total_hutang"] == 300000.0
    assert obs_monthly["data"]["total_pengeluaran"] == 800000.0
    assert obs_monthly["data"]["prev_total_pengeluaran"] == 400000.0
    assert obs_monthly["data"]["mom_pct"] == 100.0

    # 2. Search expenses
    obs_search = await execute_ai_chat_tool(
        db, "search_expenses", {"year": 2026, "month": 11, "keyword": "Mentega"}
    )
    assert obs_search["status"] == "success"
    assert obs_search["data"]["total_matched"] == 1
    assert obs_search["data"]["items"][0]["barang"] == "Mentega Anchor 2kg"

    # 3. Cashflow and bank balances
    obs_cf = await execute_ai_chat_tool(
        db, "get_cashflow_and_bank_balances", {"year": 2026, "month": 11}
    )
    assert obs_cf["status"] == "success"
    assert obs_cf["data"]["total_cash_in"] == 2500000.0
    assert obs_cf["data"]["total_cash_out"] == 500000.0
    assert len(obs_cf["data"]["bank_accounts"]) == 1
    assert obs_cf["data"]["bank_accounts"][0]["name"] == "BCA Operasional"

    # 4. Profit & loss report
    obs_pl = await execute_ai_chat_tool(
        db, "get_profit_loss_report", {"year": 2026, "month": 11}
    )
    assert obs_pl["status"] == "success"
    assert obs_pl["data"]["laba_rugi"]["revenue_net"] == 2500000.0

    # 5. Budget status (Bahan Kue spent 500k vs budget 400k -> overbudget)
    obs_budget = await execute_ai_chat_tool(
        db, "get_budget_status", {"year": 2026, "month": 11}
    )
    assert obs_budget["status"] == "success"
    assert obs_budget["data"]["total_budget"] == 2000000.0
    over_cats = [c["category"] for c in obs_budget["data"]["overbudget_categories"]]
    assert "Bahan Kue" in over_cats

    # 6. Unpaid & reimbursements
    obs_unpaid = await execute_ai_chat_tool(db, "get_unpaid_and_reimbursements", {})
    assert obs_unpaid["status"] == "success"
    assert obs_unpaid["data"]["unpaid"]["total_count"] == 1
    assert obs_unpaid["data"]["unpaid"]["total_remaining_nominal"] == 300000.0
    assert obs_unpaid["data"]["reimbursements"]["pending_count"] == 1
    assert obs_unpaid["data"]["reimbursements"]["pending_total"] == 300000.0

    # 7. Price trends & suppliers
    obs_price = await execute_ai_chat_tool(
        db,
        "get_price_trends_and_suppliers",
        {"year": 2026, "month": 11, "keyword": "Mentega"},
    )
    assert obs_price["status"] == "success"
    assert obs_price["data"]["inflation_summary"]["items_inflated_count"] == 1
    assert obs_price["data"]["item_price_history"]["latest_price"] == 250000.0
    assert obs_price["data"]["suppliers_summary"]["total_suppliers"] == 1

    # 8. Menu HPP summary
    obs_menu = await execute_ai_chat_tool(
        db, "get_menu_hpp_summary", {"keyword": "Chiffon"}
    )
    assert obs_menu["status"] == "success"
    assert obs_menu["data"]["total_matched"] == 1
    assert obs_menu["data"]["menus"][0]["effective_hpp"] == 45000.0
    assert obs_menu["data"]["menus"][0]["selling_price"] == 120000.0

    # 9. Assets & purchase requests
    obs_assets = await execute_ai_chat_tool(
        db, "get_assets_and_purchase_requests", {"request_status": "PENDING"}
    )
    assert obs_assets["status"] == "success"
    assert obs_assets["data"]["assets_summary"]["total_assets"] == 1
    assert obs_assets["data"]["purchase_request_stats"]["pending"] == 1
    assert len(obs_assets["data"]["purchase_requests"]) == 1

    # Snapshot helper
    snap = await build_fallback_snapshot(db)
    assert "monthly_expense_summary" in snap
    assert "unpaid_and_reimbursements" in snap


@pytest.mark.anyio
async def test_tool_validation_and_unknown_tool_errors(db):
    bad_tool = await execute_ai_chat_tool(db, "delete_database_drop_all", {})
    assert bad_tool["status"] == "error"

    bad_month = await execute_ai_chat_tool(
        db, "get_monthly_expense_summary", {"year": 2026, "month": 15}
    )
    assert bad_month["status"] == "error"

    bad_date = await execute_ai_chat_tool(
        db, "search_expenses", {"start_date": "not-a-date"}
    )
    assert bad_date["status"] == "error"
