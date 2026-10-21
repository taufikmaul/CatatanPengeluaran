"""Test untuk app/agent/tools.py — audit & insight (tanpa memanggil AI)."""

from datetime import date
from decimal import Decimal

import pytest

from app.agent import tools
from app.models.expense import Expense


async def _add_expense(db, **overrides) -> Expense:
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


class TestAuditCategories:
    async def test_reports_invalid_categories(self, db):
        await _add_expense(db, category="Bahan Kue")       # valid
        await _add_expense(db, category="Makan Siang")     # invalid
        await _add_expense(db, category=None)              # kosong

        result = await tools.tool_audit_categories(db)

        assert result["invalid_count"] == 2
        categories = [i["kategori"] for i in result["invalid_items"]]
        assert "Makan Siang" in categories
        assert "Kosong" in categories

    async def test_clean_database_reports_zero(self, db):
        await _add_expense(db, category="Kemasan")
        result = await tools.tool_audit_categories(db)
        assert result["invalid_count"] == 0
        assert result["invalid_items"] == []


class TestAuditCalculations:
    async def test_fixes_wrong_total(self, db):
        expense = await _add_expense(
            db, qty=Decimal("2"), unit_price=Decimal("15000"),
            tax=Decimal("0"), discount=Decimal("0"),
            total_price=Decimal("99000"),
        )

        result = await tools.tool_audit_calculations(db)
        await db.flush()
        await db.refresh(expense)

        assert result["fixed_count"] == 1
        assert expense.total_price == Decimal("30000")
        assert result["fixed_items"][0]["id"] == expense.id

    async def test_accounts_for_tax_and_discount(self, db):
        expense = await _add_expense(
            db, qty=Decimal("3"), unit_price=Decimal("10000"),
            tax=Decimal("2000"), discount=Decimal("1000"),
            total_price=Decimal("0"),
        )
        # (3 * 10000) + 2000 - 1000 = 31000
        await tools.tool_audit_calculations(db)
        await db.flush()
        await db.refresh(expense)
        assert expense.total_price == Decimal("31000")

    async def test_leaves_correct_rows_untouched(self, db):
        expense = await _add_expense(db, total_price=Decimal("30000"))
        result = await tools.tool_audit_calculations(db)
        assert result["fixed_count"] == 0
        assert expense.total_price == Decimal("30000")

    async def test_tolerance_under_one_rupiah(self, db):
        # Selisih < 1 rupiah dianggap pembulatan, bukan error.
        await _add_expense(db, total_price=Decimal("30000.50"))
        result = await tools.tool_audit_calculations(db)
        assert result["fixed_count"] == 0


class TestPriceInsight:
    async def test_reports_price_increase(self, db):
        await _add_expense(
            db, item_name="Tepung", expense_date=date(2026, 10, 1),
            unit_price=Decimal("10000"),
        )
        insight = await tools.tool_get_price_insight(db, "Tepung", 12000.0)

        assert insight is not None
        assert "naik" in insight
        assert "Rp 2.000" in insight

    async def test_reports_price_decrease(self, db):
        await _add_expense(
            db, item_name="Gula", expense_date=date(2026, 10, 1),
            unit_price=Decimal("20000"),
        )
        insight = await tools.tool_get_price_insight(db, "Gula", 15000.0)

        assert insight is not None
        assert "turun" in insight

    async def test_ignores_insignificant_change(self, db):
        await _add_expense(db, item_name="Gula", unit_price=Decimal("10000"))
        # 1% < ambang 2%
        assert await tools.tool_get_price_insight(db, "Gula", 10100.0) is None

    async def test_returns_none_without_history(self, db):
        assert await tools.tool_get_price_insight(db, "Tidak Ada", 1000.0) is None

    async def test_returns_none_for_zero_price(self, db):
        await _add_expense(db, item_name="Gula", unit_price=Decimal("0"))
        assert await tools.tool_get_price_insight(db, "Gula", 5000.0) is None


class TestExtractTools:
    async def test_extract_text_uses_ai_then_audits(self, db, monkeypatch):
        async def fake_call_ai_text(text):
            return {"items": [{"barang": "Gula", "qty": 2, "harga_satuan": 5000,
                               "total_harga": 0}]}

        monkeypatch.setattr("app.services.ai_service.call_ai_text", fake_call_ai_text)

        result = await tools.tool_extract_text("beli gula 2kg")
        assert result["items"][0]["total_harga"] == 10000

    async def test_extract_image_propagates_ai_error(self, db, monkeypatch):
        async def fake_call_ai_image(base64_image, caption=""):
            return {"error": True, "message": "gagal"}

        monkeypatch.setattr("app.services.ai_service.call_ai_image", fake_call_ai_image)

        result = await tools.tool_extract_image("base64", "caption")
        assert result["error"] is True
