"""
tests/test_csv_import.py — Test suite komprehensif untuk modul parsing & import CSV
Menguji sanitasi Rupiah, parsing tanggal, audit matematika, deteksi header,
validasi baris, dan endpoint upload dashboard.
"""
from __future__ import annotations

import io
from datetime import date
from decimal import Decimal
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.connection import get_db
from app.main import app
from app.models.expense import Expense
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.csv_import_service import (
    parse_rupiah,
    parse_date_id,
    detect_header,
    audit_calculation,
    validate_expense_dict,
    parse_csv_file,
    map_row_to_expense,
)
from app.services.expense_service import bulk_check_duplicates, batch_insert_expenses, make_duplicate_key


# ──────────────────────────────────────────────
# Unit Tests: Parser & Sanitasi
# ──────────────────────────────────────────────

class TestParseRupiah:
    def test_parses_indonesian_rupiah_format(self):
        assert parse_rupiah("Rp 15.000,00") == Decimal("15000.00")
        assert parse_rupiah("rp 250.000") == Decimal("250000.00")
        assert parse_rupiah("Rp. 1.500.000") == Decimal("1500000.00")
        assert parse_rupiah("IDR 50.000") == Decimal("50000.00")

    def test_parses_us_and_plain_formats(self):
        assert parse_rupiah("15000") == Decimal("15000.00")
        assert parse_rupiah("15,000.50") == Decimal("15000.50")
        assert parse_rupiah("1,500,000") == Decimal("1500000.00")
        assert parse_rupiah(35000) == Decimal("35000.00")
        assert parse_rupiah(12.5) == Decimal("12.50")

    def test_handles_empty_and_zero(self):
        assert parse_rupiah("") == Decimal("0.00")
        assert parse_rupiah("0") == Decimal("0.00")
        assert parse_rupiah("-") == Decimal("0.00")
        assert parse_rupiah(None) == Decimal("0.00")


class TestParseDateId:
    def test_parses_various_valid_formats(self):
        expected = date(2026, 10, 21)
        assert parse_date_id("2026-10-21") == expected
        assert parse_date_id("2026/10/21") == expected
        assert parse_date_id("21/10/2026") == expected
        assert parse_date_id("21-10-2026") == expected

    def test_parses_datetime_and_timestamps(self):
        assert parse_date_id("2026-10-21 14:35:00") == date(2026, 10, 21)
        assert parse_date_id("2026-10-21T08:00:00Z") == date(2026, 10, 21)
        assert parse_date_id(date(2026, 10, 21)) == date(2026, 10, 21)

    def test_handles_invalid_and_empty(self):
        assert parse_date_id("invalid-date") is None
        assert parse_date_id("") is None
        assert parse_date_id("-") is None
        assert parse_date_id(None) is None


class TestDetectHeader:
    def test_detects_indonesian_and_standard_headers(self):
        header1 = ["Tanggal", "Barang", "Kategori", "Total"]
        header2 = ["Timestamp", "Tgl Nota", "Toko / Supplier", "Nama Barang", "Total Harga"]
        assert detect_header(header1) is True
        assert detect_header(header2) is True

    def test_rejects_actual_data_rows(self):
        data_row = ["2026-10-21", "Toko Sumber", "Tepung Terigu", "50000"]
        assert detect_header(data_row) is False


class TestAuditCalculation:
    def test_calculates_total_when_missing(self):
        item = {
            "qty": Decimal("2"),
            "unit_price": Decimal("15000"),
            "tax": Decimal("0"),
            "discount": Decimal("0"),
            "total_price": Decimal("0"),
        }
        fixed = audit_calculation(item)
        assert fixed["total_price"] == Decimal("30000.00")

    def test_corrects_mismatched_total(self):
        item = {
            "qty": Decimal("3"),
            "unit_price": Decimal("10000"),
            "tax": Decimal("1000"),
            "discount": Decimal("2000"),
            "total_price": Decimal("50000"),  # salah, seharusnya (3*10000)+1000-2000 = 29000
        }
        fixed = audit_calculation(item)
        assert fixed["total_price"] == Decimal("29000.00")

    def test_calculates_unit_price_when_missing(self):
        item = {
            "qty": Decimal("2"),
            "unit_price": Decimal("0"),
            "tax": Decimal("0"),
            "discount": Decimal("0"),
            "total_price": Decimal("50000"),
        }
        fixed = audit_calculation(item)
        assert fixed["unit_price"] == Decimal("25000.00")


class TestValidateExpenseDict:
    def test_validates_clean_item(self):
        item = {
            "expense_date": date(2026, 10, 21),
            "item_name": "Tepung Terigu",
            "category": "Bahan Kue",
            "total_price": Decimal("30000.00"),
        }
        errs = validate_expense_dict(item, ["Bahan Kue", "Kemasan"])
        assert len(errs) == 0
        assert item["category"] == "Bahan Kue"

    def test_catches_missing_date_and_name(self):
        item = {
            "expense_date": None,
            "item_name": "",
            "category": "Bahan Kue",
            "total_price": Decimal("30000.00"),
        }
        errs = validate_expense_dict(item, ["Bahan Kue"])
        assert any("Tanggal" in e for e in errs)
        assert any("Nama barang" in e for e in errs)

    def test_fallbacks_unknown_category_safely(self):
        item = {
            "expense_date": date(2026, 10, 21),
            "item_name": "Plastik",
            "category": "Kategori Aneh",
            "total_price": Decimal("10000.00"),
        }
        errs = validate_expense_dict(item, ["Bahan Kue", "Kemasan"])
        assert len(errs) == 0
        assert item["category"] == "Operasional"


class TestParseCsvFile:
    def test_parses_gas_15_columns_export(self):
        csv_text = (
            "Timestamp,Tanggal Nota,Toko,Barang,Qty,Kategori,Harga Satuan,Tax,Diskon,Total,Metode,Status,Tempo,Notes,Link\n"
            "2026-10-01 10:00:00,2026-10-01,Toko Roti,Terigu Cakra,2,Bahan Kue,260000,0,0,520000,Tunai,Lunas,-,Adonan,Private\n"
            "2026-10-02 11:00:00,2026-10-02,Toko Plastik,Dus 20x20,100,Kemasan,3500,0,0,350000,Transfer,Lunas,-,Box,Private\n"
        )
        res = parse_csv_file(csv_text.encode("utf-8"), ["Bahan Kue", "Kemasan"])
        assert res.total_rows == 2
        assert len(res.valid_rows) == 2
        assert len(res.skipped_rows) == 0
        assert res.valid_rows[0]["item_name"] == "Terigu Cakra"
        assert res.valid_rows[0]["total_price"] == Decimal("520000.00")
        assert res.valid_rows[1]["category"] == "Kemasan"

    def test_parses_semicolon_delimited_csv(self):
        csv_text = (
            "Tanggal;Barang;Kategori;Harga Satuan;Qty;Total\n"
            "05/10/2026;Keju Cheddar;Bahan Kue;Rp 25.000;2;Rp 50.000\n"
        )
        res = parse_csv_file(csv_text.encode("utf-8"), ["Bahan Kue"])
        assert len(res.valid_rows) == 1
        assert res.valid_rows[0]["expense_date"] == date(2026, 10, 5)
        assert res.valid_rows[0]["total_price"] == Decimal("50000.00")

    def test_handles_empty_csv(self):
        res = parse_csv_file(b"", ["Bahan Kue"])
        assert res.total_rows == 0
        assert len(res.valid_rows) == 0


# ──────────────────────────────────────────────
# Integration Tests: Duplicate Check & Batch Insert
# ──────────────────────────────────────────────

class TestDuplicateAndBatchInsert:
    async def test_bulk_duplicate_detection_and_batch_insert(self, db: AsyncSession):
        item1 = {
            "expense_date": date(2026, 10, 10),
            "supplier": "Toko Berkah",
            "item_name": "Margarin Palmia",
            "qty": Decimal("5"),
            "category": "Bahan Kue",
            "unit_price": Decimal("10000.00"),
            "tax": Decimal("0"),
            "discount": Decimal("0"),
            "total_price": Decimal("50000.00"),
            "pay_method": "Tunai",
            "pay_status": "Lunas",
            "due_date": "-",
            "notes": "-",
            "msg_link": "Import CSV",
        }

        # 1. Insert item1
        await batch_insert_expenses(db, [item1], sheets_synced=True)
        await db.flush()

        # Verifikasi item masuk dan sheets_synced=True
        res = await db.execute(select(Expense).where(Expense.item_name == "Margarin Palmia"))
        inserted = res.scalar_one()
        assert inserted.sheets_synced is True

        # 2. Cek duplikasi dengan bulk_check_duplicates
        dup_keys = await bulk_check_duplicates(db, [item1])
        key = make_duplicate_key(item1["expense_date"], item1["supplier"], item1["item_name"], item1["total_price"])
        assert key in dup_keys

        # 3. Item baru tidak boleh terdeteksi duplikat
        item2 = dict(item1)
        item2["item_name"] = "Margarin Blueband Berbeda"
        key2 = make_duplicate_key(item2["expense_date"], item2["supplier"], item2["item_name"], item2["total_price"])
        assert key2 not in dup_keys


# ──────────────────────────────────────────────
# Integration Tests: Endpoints Dashboard Import
# ──────────────────────────────────────────────

@pytest.fixture
async def client(db: AsyncSession):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


class TestDashboardImportEndpoints:
    async def test_import_page_unauthenticated_redirects(self, client):
        res = await client.get("/dashboard/import", follow_redirects=False)
        assert res.status_code == 303
        assert res.headers["location"] == "/dashboard/login"

    async def test_import_page_authenticated_renders(self, client):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        res = await client.get("/dashboard/import")
        assert res.status_code == 200
        assert "Upload File CSV Pengeluaran" in res.text
        assert "Download Template CSV" in res.text

    async def test_download_template_csv(self, client):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        res = await client.get("/dashboard/import/template")
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/csv")
        assert "Timestamp,Tanggal Nota,Toko / Supplier" in res.text

    async def test_post_import_csv_success(self, client, db):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())

        csv_content = (
            "Tanggal Nota,Barang,Toko / Supplier,Qty,Kategori,Harga Satuan,Total Harga\n"
            "2026-10-15,Selai Nanas 1kg,Toko Roti Makmur,2,Bahan Kue,35000,70000\n"
            "2026-10-16,Dus Mini,Plastik Jaya,50,Kemasan,2000,100000\n"
        ).encode("utf-8")

        files = {"file": ("data_test.csv", csv_content, "text/csv")}
        headers = {"accept": "application/json"}
        res = await client.post("/dashboard/import", files=files, headers=headers)

        assert res.status_code == 201
        data = res.json()
        assert data["ok"] is True
        assert data["result"]["inserted_count"] == 2
        assert data["result"]["duplicate_count"] == 0

        # Verifikasi data tersimpan di DB
        db_res = await db.execute(select(Expense).where(Expense.item_name == "Selai Nanas 1kg"))
        saved = db_res.scalar_one_or_none()
        assert saved is not None
        assert saved.sheets_synced is True

    async def test_post_import_csv_skips_duplicates(self, client, db):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())

        csv_content = (
            "Tanggal Nota,Barang,Toko / Supplier,Qty,Kategori,Harga Satuan,Total Harga\n"
            "2026-10-15,Coklat Batang Colatta,Toko Roti Makmur,1,Bahan Kue,45000,45000\n"
        ).encode("utf-8")

        files1 = {"file": ("data_batch1.csv", csv_content, "text/csv")}
        res1 = await client.post("/dashboard/import", files=files1, headers={"accept": "application/json"})
        assert res1.json()["result"]["inserted_count"] == 1

        # Upload file yang sama lagi dengan skip_duplicates=True
        files2 = {"file": ("data_batch2.csv", csv_content, "text/csv")}
        data2 = {"skip_duplicates": "true"}
        res2 = await client.post("/dashboard/import", files=files2, data=data2, headers={"accept": "application/json"})

        assert res2.status_code == 201
        res_data2 = res2.json()["result"]
        assert res_data2["inserted_count"] == 0
        assert res_data2["duplicate_count"] == 1

    async def test_post_import_rejects_non_csv(self, client):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token())
        files = {"file": ("image.png", b"fake-png-bytes", "image/png")}
        res = await client.post("/dashboard/import", files=files, headers={"accept": "application/json"})
        assert res.status_code == 400
        assert "Format file tidak valid" in res.json()["error"]
