"""
tests/test_cashflow_export.py — Tests untuk Layanan & Endpoint Export Arus Kas Harian (Daily Cashflow)
"""
from datetime import date, datetime
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction
from app.models.expense import Expense
from app.models.expense_payment import ExpensePayment
from app.models.bank_transfer import BankTransfer
from app.services.cashflow_service import get_daily_cashflow, export_cashflow_to_csv


@pytest.fixture
async def client(db: AsyncSession):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_cashflow_service_empty(db: AsyncSession):
    """Pastikan rekapitulasi pada database kosong mengembalikan saldo 0 dan daftar tanggal lengkap."""
    data = await get_daily_cashflow(db, year=2026, month=11)
    assert data["ok"] is True
    assert data["month"] == 11
    assert data["year"] == 2026
    assert data["saldo_awal"] == 0.0
    assert data["total_cash_in"] == 0.0
    assert data["total_cash_out"] == 0.0
    assert data["saldo_akhir"] == 0.0
    assert data["days_count"] == 30  # November = 30 hari
    assert len(data["daily_rows"]) == 30

    first_day = data["daily_rows"][0]
    assert first_day["date"] == "2026-11-01"
    assert first_day["cash_in"] == 0.0
    assert first_day["cash_out"] == 0.0
    assert first_day["saldo"] == 0.0


@pytest.mark.anyio
async def test_cashflow_service_with_transactions(db: AsyncSession):
    """Uji perhitungan saldo awal, cash in harian, cash out harian, dan running balance."""
    # 1. Tambah rekening bank
    acc = BankAccount(
        name="BCA Utama",
        bank_name="BCA",
        account_number="1234567890",
        account_type="bank",
        opening_balance=5000000.0,
        is_default=True,
        is_active=True,
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)

    # 2. Transaksi SEBELUM periode (Oktober 2026) -> harus mempengaruhi Saldo Awal November
    # Transaksi masuk sebelum periode (+1.000.000)
    tx_prior = IncomingTransaction(
        transaction_date=date(2026, 10, 25),
        transaction_time="14:00",
        order_type="dine_in",
        payment_method="BCA Transfer",
        gross_sales=1000000.0,
        net_received=1000000.0,
        status="paid",
        bank_account_id=acc.id,
    )
    # Pengeluaran lunas sebelum periode (-500.000)
    exp_prior = Expense(
        item_name="Beli Mentega Oktober",
        category="Bahan Kue",
        total_price=500000.0,
        expense_date=date(2026, 10, 28),
        pay_method="BCA Transfer",
        pay_status="Lunas",
        bank_account_id=acc.id,
    )
    db.add_all([tx_prior, exp_prior])
    await db.commit()

    # Saldo awal per 1 November seharusnya:
    # 5.000.000 (opening) + 1.000.000 (in) - 500.000 (out) = 5.500.000

    # 3. Transaksi PADA periode (November 2026)
    # 2 Nov: Cash In 1.500.000
    tx_nov2 = IncomingTransaction(
        transaction_date=date(2026, 11, 2),
        transaction_time="10:00",
        order_type="dine_in",
        payment_method="BCA Transfer",
        gross_sales=1500000.0,
        net_received=1500000.0,
        status="paid",
        bank_account_id=acc.id,
    )
    # 2 Nov: Cash Out 300.000 (pengeluaran langsung)
    exp_nov2 = Expense(
        item_name="Bahan Tepung",
        category="Bahan Kue",
        total_price=300000.0,
        expense_date=date(2026, 11, 2),
        pay_method="BCA Transfer",
        pay_status="Lunas",
        bank_account_id=acc.id,
    )
    # 5 Nov: Cash Out 700.000 (via ExpensePayment termin/DP)
    exp_tempo = Expense(
        item_name="Oven Gas",
        category="Peralatan",
        total_price=2000000.0,
        expense_date=date(2026, 11, 1),
        pay_method="Transfer",
        pay_status="Sebagian",
        bank_account_id=acc.id,
    )
    db.add_all([tx_nov2, exp_nov2, exp_tempo])
    await db.commit()
    await db.refresh(exp_tempo)

    payment_nov5 = ExpensePayment(
        expense_id=exp_tempo.id,
        amount=700000.0,
        payment_date=date(2026, 11, 5),
        pay_method="BCA Transfer",
        bank_account_id=acc.id,
    )
    db.add(payment_nov5)
    await db.commit()

    # 4. Jalankan layanan get_daily_cashflow
    cashflow = await get_daily_cashflow(db, year=2026, month=11)

    assert cashflow["saldo_awal"] == 5500000.0
    assert cashflow["total_cash_in"] == 1500000.0
    assert cashflow["total_cash_out"] == 1000000.0  # 300.000 + 700.000
    assert cashflow["net_cash_flow"] == 500000.0
    assert cashflow["saldo_akhir"] == 6000000.0  # 5.500.000 + 500.000

    # Cek baris per tanggal
    day1 = next(r for r in cashflow["daily_rows"] if r["date"] == "2026-11-01")
    assert day1["cash_in"] == 0.0
    assert day1["cash_out"] == 0.0
    assert day1["saldo"] == 5500000.0

    day2 = next(r for r in cashflow["daily_rows"] if r["date"] == "2026-11-02")
    assert day2["cash_in"] == 1500000.0
    assert day2["cash_out"] == 300000.0
    assert day2["net_flow"] == 1200000.0
    assert day2["saldo"] == 6700000.0  # 5.500.000 + 1.200.000

    day5 = next(r for r in cashflow["daily_rows"] if r["date"] == "2026-11-05")
    assert day5["cash_in"] == 0.0
    assert day5["cash_out"] == 700000.0
    assert day5["net_flow"] == -700000.0
    assert day5["saldo"] == 6000000.0  # 6.700.000 - 700.000


@pytest.mark.anyio
async def test_cashflow_csv_export_format(db: AsyncSession):
    """Pastikan string CSV memuat header metadata dan kolom-kolom yang diminta."""
    data = await get_daily_cashflow(db, year=2026, month=11)
    csv_str = export_cashflow_to_csv(data)

    assert csv_str.startswith("\ufeff")  # BOM UTF-8 untuk Excel
    assert "LAPORAN ARUS KAS HARIAN (DAILY CASHFLOW) - HISTORYCAKE" in csv_str
    assert "Periode: November 2026" in csv_str
    assert "Tanggal,Kas Masuk (Cash In),Kas Keluar (Cash Out),Arus Kas Bersih (Net),Saldo (Balance),Jml Tx Masuk,Jml Tx Keluar" in csv_str
    assert "TOTAL / SALDO AKHIR" in csv_str
    assert "2026-11-01,0.00,0.00,0.00,0.00,0,0" in csv_str


@pytest.mark.anyio
async def test_cashflow_api_endpoints(client: AsyncClient, auth_cookies: dict[str, str], db: AsyncSession):
    """Pastikan endpoint REST API GET /cashflow dan GET /cashflow/export merespons dengan benar."""
    client.cookies.update(auth_cookies)

    # 1. Test GET /api/v1/reports/cashflow (JSON)
    res_json = await client.get("/api/v1/reports/cashflow?month=11&year=2026")
    assert res_json.status_code == 200
    body = res_json.json()
    assert body["ok"] is True
    assert body["month"] == 11
    assert body["year"] == 2026
    assert "daily_rows" in body
    assert len(body["daily_rows"]) == 30

    # 2. Test GET /api/v1/reports/cashflow/export (CSV file download)
    res_csv = await client.get("/api/v1/reports/cashflow/export?month=11&year=2026")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    assert 'attachment; filename="cashflow_harian_2026_11.csv"' in res_csv.headers["content-disposition"]
    assert b"Kas Masuk (Cash In),Kas Keluar (Cash Out)" in res_csv.content
