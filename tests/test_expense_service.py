"""Test untuk app/services/expense_service.py (memakai SQLite in-memory)."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.expense import Expense
from app.services.expense_service import (
    check_duplicate,
    get_all_expenses_paginated,
    get_monthly_report,
    get_unsynced_to_sheets,
    mark_synced_to_sheets,
    save_expenses,
    search_last_price,
)


async def _add_expense(db, **overrides) -> Expense:
    """Helper: simpan satu expense dengan default yang wajar."""
    defaults = {
        "expense_date": date(2026, 10, 21),
        "supplier": "Toko A",
        "item_name": "Tepung Terigu",
        "qty": Decimal("2"),
        "category": "Bahan Kue",
        "unit_price": Decimal("15000"),
        "tax": Decimal("0"),
        "discount": Decimal("0"),
        "total_price": Decimal("30000"),
        "pay_method": "Tunai",
        "pay_status": "Lunas",
        "due_date": "-",
        "notes": "-",
        "msg_link": "Private Chat",
    }
    defaults.update(overrides)
    expense = Expense(**defaults)
    db.add(expense)
    await db.flush()
    return expense


class TestSaveExpenses:
    async def test_persists_items(self, db, sample_items):
        saved = await save_expenses(db, sample_items, "link", user_id=None)
        assert len(saved) == 1

        result = await db.execute(select(Expense))
        row = result.scalar_one()
        assert row.item_name == "Tepung Terigu"
        assert row.supplier == "Toko Sumber Rejeki"
        assert row.category == "Bahan Kue"
        assert row.qty == Decimal("2")
        assert row.unit_price == Decimal("15000")
        assert row.total_price == Decimal("30000")
        assert row.pay_status == "Lunas"
        assert row.sheets_synced is False

    async def test_multiple_items(self, db, sample_items):
        items = sample_items + [{**sample_items[0], "barang": "Gula Pasir"}]
        saved = await save_expenses(db, items)
        assert len(saved) == 2

    async def test_invalid_date_falls_back_to_today(self, db, sample_items):
        items = [{**sample_items[0], "tanggal": "bukan-tanggal"}]
        saved = await save_expenses(db, items)
        assert saved[0].expense_date == date.today()

    async def test_missing_fields_use_defaults(self, db):
        saved = await save_expenses(db, [{"barang": "Tanpa Detail"}])
        expense = saved[0]
        assert expense.item_name == "Tanpa Detail"
        assert expense.supplier == "-"
        assert expense.qty == Decimal("1")
        assert expense.category == "Operasional"

    async def test_stores_msg_link_and_user_id(self, db, sample_items):
        saved = await save_expenses(db, sample_items, "https://t.me/c/1/2/3", 42)
        assert saved[0].msg_link == "https://t.me/c/1/2/3"
        assert saved[0].user_id == 42


class TestCheckDuplicate:
    async def test_detects_same_supplier_total_and_date(self, db, sample_items):
        await save_expenses(db, sample_items)
        assert await check_duplicate(db, sample_items) is True

    async def test_ignores_different_date(self, db, sample_items):
        await save_expenses(db, sample_items)
        changed = [{**sample_items[0], "tanggal": "2026-10-20"}]
        assert await check_duplicate(db, changed) is False

    async def test_ignores_different_supplier(self, db, sample_items):
        await save_expenses(db, sample_items)
        changed = [{**sample_items[0], "toko_supplier": "Toko Lain"}]
        assert await check_duplicate(db, changed) is False

    async def test_ignores_zero_total(self, db):
        items = [
            {
                "tanggal": "2026-10-21",
                "toko_supplier": "Toko A",
                "total_harga": 0,
            }
        ]
        assert await check_duplicate(db, items) is False

    async def test_empty_database_has_no_duplicate(self, db, sample_items):
        assert await check_duplicate(db, sample_items) is False


class TestGetMonthlyReport:
    async def test_aggregates_lunas_per_category(self, db):
        await _add_expense(db, total_price=Decimal("30000"), category="Bahan Kue")
        await _add_expense(db, total_price=Decimal("20000"), category="Bahan Kue")
        await _add_expense(db, total_price=Decimal("50000"), category="Kemasan")

        report = await get_monthly_report(db, 2026, 10)

        assert report["total_lunas"] == 100000
        assert report["per_kategori"] == {"Bahan Kue": 50000, "Kemasan": 50000}
        assert report["expense_count"] == 3
        assert report["month"] == 10
        assert report["year"] == 2026

    async def test_lists_unpaid_expenses(self, db):
        await _add_expense(
            db,
            item_name="Kotak Kue",
            total_price=Decimal("75000"),
            pay_status="Belum Lunas",
            due_date="2026-10-30",
        )
        report = await get_monthly_report(db, 2026, 10)

        assert report["total_lunas"] == 0
        assert len(report["list_hutang"]) == 1
        assert report["list_hutang"][0]["nominal"] == 75000
        assert report["list_hutang"][0]["tempo"] == "2026-10-30"

    @pytest.mark.parametrize("status", ["Hutang", "Tempo", "Belum Dibayar"])
    async def test_recognizes_various_unpaid_statuses(self, db, status):
        await _add_expense(db, pay_status=status, total_price=Decimal("1000"))
        report = await get_monthly_report(db, 2026, 10)
        assert len(report["list_hutang"]) == 1

    async def test_excludes_other_months(self, db):
        await _add_expense(db, expense_date=date(2026, 9, 30))
        await _add_expense(db, expense_date=date(2026, 11, 1))
        report = await get_monthly_report(db, 2026, 10)
        assert report["expense_count"] == 0

    async def test_december_boundary(self, db):
        await _add_expense(db, expense_date=date(2026, 12, 31))
        report = await get_monthly_report(db, 2026, 12)
        assert report["expense_count"] == 1

    async def test_empty_month_returns_zeroes(self, db):
        report = await get_monthly_report(db, 2020, 1)
        assert report["total_lunas"] == 0
        assert report["per_kategori"] == {}
        assert report["list_hutang"] == []
        assert report["expense_count"] == 0


class TestSearchLastPrice:
    async def test_finds_latest_matching_item(self, db):
        await _add_expense(
            db, item_name="Tepung Terigu", expense_date=date(2026, 10, 1),
            unit_price=Decimal("14000"),
        )
        latest = await _add_expense(
            db, item_name="Tepung Terigu Cakra", expense_date=date(2026, 10, 20),
            unit_price=Decimal("16000"),
        )

        found = await search_last_price(db, "tepung")
        assert found is not None
        assert found.id == latest.id
        assert found.unit_price == Decimal("16000")

    async def test_partial_case_insensitive_match(self, db):
        await _add_expense(db, item_name="Gula Pasir")
        assert await search_last_price(db, "GULA") is not None

    async def test_returns_none_when_not_found(self, db):
        assert await search_last_price(db, "tidak ada") is None


class TestPagination:
    async def test_paginates_results(self, db):
        for i in range(45):
            await _add_expense(db, item_name=f"Item {i}")

        page1, total = await get_all_expenses_paginated(db, page=1, per_page=30)
        page2, _ = await get_all_expenses_paginated(db, page=2, per_page=30)

        assert total == 45
        assert len(page1) == 30
        assert len(page2) == 15

    async def test_filters_by_category(self, db):
        await _add_expense(db, category="Kemasan")
        await _add_expense(db, category="Operasional")

        rows, total = await get_all_expenses_paginated(db, category="Kemasan")
        assert total == 1
        assert rows[0].category == "Kemasan"

    async def test_filters_by_month_and_year(self, db):
        await _add_expense(db, expense_date=date(2026, 10, 5))
        await _add_expense(db, expense_date=date(2026, 9, 5))

        rows, total = await get_all_expenses_paginated(db, month=10, year=2026)
        assert total == 1
        assert rows[0].expense_date.month == 10


class TestSheetsSyncFlags:
    async def test_returns_only_unsynced(self, db):
        unsynced = await _add_expense(db, item_name="Belum")
        synced = await _add_expense(db, item_name="Sudah")
        synced.sheets_synced = True
        await db.flush()

        rows = await get_unsynced_to_sheets(db)
        assert [r.id for r in rows] == [unsynced.id]

    async def test_marks_rows_as_synced(self, db):
        expense = await _add_expense(db)
        await mark_synced_to_sheets(db, [expense.id])
        await db.flush()
        await db.refresh(expense)

        assert expense.sheets_synced is True
        assert await get_unsynced_to_sheets(db) == []
