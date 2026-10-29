"""
tests/test_audit_duplicates.py — Uji fitur audit duplikat data pengeluaran
Klasifikasi: Nama mirip >= 90% + Tanggal sama + Nominal sama
"""
import pytest
from datetime import date
from decimal import Decimal
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
from app.models.expense import Expense
from app.models.user import User
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.expense_service import (
    calculate_name_similarity,
    audit_duplicate_expenses,
    save_expenses,
    find_duplicate_expenses,
)


@pytest.fixture
async def client(db: AsyncSession):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def auth_cookies():
    token = create_session_token()
    return {SESSION_COOKIE_NAME: token}


class TestNameSimilarity:
    def test_identical_names(self):
        assert calculate_name_similarity("Tepung Terigu Segitiga", "Tepung Terigu Segitiga") == 1.0

    def test_case_and_whitespace_insensitivity(self):
        assert calculate_name_similarity("  tepung terigu segitiga  ", "TEPUNG   TERIGU SEGITIGA") == 1.0

    def test_minor_abbreviation_and_unit_variations(self):
        # 1L vs 1 Liter
        sim = calculate_name_similarity("Susu UHT Diamond 1L", "Susu UHT Diamond 1 Liter")
        assert sim >= 0.90

        # 165g vs 165gr
        sim2 = calculate_name_similarity("Keju Kraft Cheddar 165g", "Keju Kraft Cheddar 165gr")
        assert sim2 >= 0.90

        # Plastik Roll 15x30 vs Plastik Roll 15x30.
        sim3 = calculate_name_similarity("Plastik Roll 15x30", "Plastik Roll 15x30.")
        assert sim3 >= 0.95

    def test_word_reordering(self):
        # Kata tertukar urutan tetap terdeteksi mirip tinggi
        sim = calculate_name_similarity("Tepung Segitiga Biru 1kg", "Segitiga Biru Tepung 1kg")
        assert sim == 1.0

    def test_different_items_have_low_similarity(self):
        assert calculate_name_similarity("Tepung Terigu Segitiga", "Gula Pasir Gulaku") < 0.40
        assert calculate_name_similarity("Minyak Goreng Sunco 2L", "Minyak Goreng Bimoli 2L") < 0.90


class TestAuditDuplicateExpensesService:
    async def test_detects_90_percent_name_similarity_same_date_same_nominal(self, db):
        # Data 1: Minyak Goreng Sunco 2L
        exp1 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Sembako",
            item_name="Minyak Goreng Sunco 2L",
            qty=Decimal("1"),
            unit="Pcs",
            category="Bahan Baku",
            unit_price=Decimal("38000"),
            total_price=Decimal("38000"),
            pay_method="Tunai",
            pay_status="Lunas",
            sheets_synced=True,
        )
        # Data 2: Minyak Goreng Sunco 2 Liter (sama tanggal 2026-10-25, sama nominal 38.000, nama mirip > 90%)
        exp2 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Sembako",
            item_name="Minyak Goreng Sunco 2 Liter",
            qty=Decimal("1"),
            unit="Pcs",
            category="Bahan Baku",
            unit_price=Decimal("38000"),
            total_price=Decimal("38000"),
            pay_method="Tunai",
            pay_status="Lunas",
            sheets_synced=False,
        )
        db.add_all([exp1, exp2])
        await db.commit()

        result = await audit_duplicate_expenses(db, min_similarity=0.90)
        assert result["ok"] is True
        assert result["total_duplicates"] == 1
        assert result["total_potential_waste"] == 38000.0

        pair = result["pairs"][0]
        assert pair["expense_date"] == "2026-10-25"
        assert pair["total_price"] == 38000.0
        assert pair["similarity_pct"] >= 90
        # exp1 sudah sheets_synced, exp2 belum -> keep exp1, delete exp2
        assert pair["suggested_keep_id"] == exp1.id
        assert pair["suggested_delete_id"] == exp2.id

    async def test_ignores_different_dates(self, db):
        # Nama sama, nominal sama, tapi tanggal berbeda -> bukan duplikat
        exp1 = Expense(
            expense_date=date(2026, 10, 20),
            supplier="Toko Bahan",
            item_name="Keju Cheddar 2kg",
            total_price=Decimal("150000"),
            sheets_synced=True,
        )
        exp2 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Bahan",
            item_name="Keju Cheddar 2kg",
            total_price=Decimal("150000"),
            sheets_synced=True,
        )
        db.add_all([exp1, exp2])
        await db.commit()

        result = await audit_duplicate_expenses(db, min_similarity=0.90)
        assert result["total_duplicates"] == 0
        assert len(result["pairs"]) == 0

    async def test_ignores_different_nominals(self, db):
        # Tanggal sama, nama sama, tapi nominal berbeda -> bukan duplikat
        exp1 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Bahan",
            item_name="Susu UHT Full Cream",
            total_price=Decimal("20000"),
            sheets_synced=True,
        )
        exp2 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Bahan",
            item_name="Susu UHT Full Cream",
            total_price=Decimal("40000"),
            sheets_synced=True,
        )
        db.add_all([exp1, exp2])
        await db.commit()

        result = await audit_duplicate_expenses(db, min_similarity=0.90)
        assert result["total_duplicates"] == 0

    async def test_ignores_different_items_same_day_and_nominal(self, db):
        # Tanggal sama, nominal sama, tapi barang berbeda (kemiripan < 90%)
        exp1 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Serba Ada",
            item_name="Tepung Maizena",
            total_price=Decimal("15000"),
            sheets_synced=True,
        )
        exp2 = Expense(
            expense_date=date(2026, 10, 25),
            supplier="Toko Serba Ada",
            item_name="Baking Powder",
            total_price=Decimal("15000"),
            sheets_synced=True,
        )
        db.add_all([exp1, exp2])
        await db.commit()

        result = await audit_duplicate_expenses(db, min_similarity=0.90)
        assert result["total_duplicates"] == 0

    async def test_filters_by_month_and_year(self, db):
        # Duplikat di Oktober 2026
        exp1 = Expense(
            expense_date=date(2026, 10, 10),
            item_name="Coklat Bubuk Tulungagung 500g",
            total_price=Decimal("45000"),
            sheets_synced=True,
        )
        exp2 = Expense(
            expense_date=date(2026, 10, 10),
            item_name="Coklat Bubuk Tulungagung 500gr",
            total_price=Decimal("45000"),
            sheets_synced=False,
        )
        # Duplikat di September 2026
        exp3 = Expense(
            expense_date=date(2026, 9, 15),
            item_name="Ragi Saf Instant 500g",
            total_price=Decimal("60000"),
            sheets_synced=True,
        )
        exp4 = Expense(
            expense_date=date(2026, 9, 15),
            item_name="Ragi Saf Instant 500gr",
            total_price=Decimal("60000"),
            sheets_synced=False,
        )
        db.add_all([exp1, exp2, exp3, exp4])
        await db.commit()

        # Audit khusus bulan 10
        oct_result = await audit_duplicate_expenses(db, min_similarity=0.90, month=10, year=2026)
        assert oct_result["total_duplicates"] == 1
        assert oct_result["pairs"][0]["expense_a"]["item_name"] == "Coklat Bubuk Tulungagung 500g"

        # Audit khusus bulan 9
        sep_result = await audit_duplicate_expenses(db, min_similarity=0.90, month=9, year=2026)
        assert sep_result["total_duplicates"] == 1
        assert sep_result["pairs"][0]["expense_a"]["item_name"] == "Ragi Saf Instant 500g"


class TestAuditDuplicatesApi:
    async def test_api_audit_duplicates_requires_auth(self, client):
        resp = await client.get("/api/v1/expenses/audit-duplicates")
        assert resp.status_code == 401

    async def test_api_audit_duplicates_success(self, client, auth_cookies, db):
        # Buat user dan session
        user = User(name="Owner Test", telegram_id=999888, is_auth=True)
        db.add(user)
        await db.commit()
        await db.refresh(user)

        # Buat data duplikat
        exp1 = Expense(
            expense_date=date(2026, 10, 26),
            supplier="Toko Loyang Jaya",
            item_name="Loyang Brownies 20x10",
            total_price=Decimal("25000"),
            sheets_synced=True,
        )
        exp2 = Expense(
            expense_date=date(2026, 10, 26),
            supplier="Toko Loyang Jaya",
            item_name="Loyang Brownies 20x10cm",
            total_price=Decimal("25000"),
            sheets_synced=False,
        )
        db.add_all([exp1, exp2])
        await db.commit()

        resp = await client.get(
            "/api/v1/expenses/audit-duplicates?min_similarity=0.90",
            cookies=auth_cookies,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["total_duplicates"] >= 1
        assert data["total_potential_waste"] >= 25000.0
        assert len(data["pairs"]) >= 1

        pair = data["pairs"][0]
        assert pair["expense_date"] == "2026-10-26"
        assert pair["total_price"] == 25000.0
        assert pair["similarity_pct"] >= 90
        assert "Tanggal sama" in pair["reason"]


class TestCheckInvoiceDuplicate:
    async def test_detects_existing_invoice(self, client, auth_cookies, db):
        from app.services.expense_service import check_invoice_duplicate

        exp = Expense(
            expense_date=date(2026, 10, 28),
            supplier="Toko Kemasan Makmur",
            item_name="Box Kue 20x20",
            total_price=Decimal("125000"),
            invoice_number="INV/2026/X/998",
        )
        db.add(exp)
        await db.commit()
        await db.refresh(exp)

        # 1. Service direct check
        check = await check_invoice_duplicate(db, "inv/2026/x/998")
        assert check["is_duplicate"] is True
        assert check["existing_expense"]["id"] == exp.id
        assert "sudah tercatat" in check["message"]

        # Check with exclude self ID
        check_self = await check_invoice_duplicate(db, "inv/2026/x/998", exclude_expense_id=exp.id)
        assert check_self["is_duplicate"] is False

        # Check with different invoice
        check_none = await check_invoice_duplicate(db, "INV-BARU-001")
        assert check_none["is_duplicate"] is False

        # 2. API Endpoint check
        resp = await client.get(
            "/api/v1/expenses/check-invoice?invoice_number=INV%2F2026%2FX%2F998",
            cookies=auth_cookies,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_duplicate"] is True
        assert data["existing_expense"]["item_name"] == "Box Kue 20x20"

