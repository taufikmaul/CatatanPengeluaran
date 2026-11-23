"""
tests/test_accounting_report.py — Tests untuk endpoint & layanan laporan akuntansi
"""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.connection import get_db
from app.services.accounting_service import get_accounting_report


@pytest.fixture
async def client(db):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_accounting_service_direct(db):
    """Pastikan service get_accounting_report mengembalikan struktur lengkap."""
    data = await get_accounting_report(db, 2026, 10)
    assert data["ok"] is True
    assert data["month"] == 10
    assert data["year"] == 2026
    assert data["month_name"] == "Oktober"

    # Laba Rugi
    assert "laba_rugi" in data
    assert "hpp_items" in data["laba_rugi"]
    assert "opex_items" in data["laba_rugi"]
    assert "total_beban" in data["laba_rugi"]

    # Neraca
    assert "neraca" in data
    assert "aset_lancar" in data["neraca"]
    assert "aset_tetap" in data["neraca"]
    assert "kewajiban_lancar" in data["neraca"]

    # Arus Kas
    assert "arus_kas" in data
    assert "aktivitas_operasi" in data["arus_kas"]
    assert "aktivitas_investasi" in data["arus_kas"]
    assert "aktivitas_kliring" in data["arus_kas"]

    # Analisis
    assert "analisis" in data
    assert "cost_structure" in data["analisis"]
    assert "top_variances_mom" in data["analisis"]
    assert "health_evaluation" in data["analisis"]


@pytest.mark.anyio
async def test_accounting_endpoint(client, auth_cookies):
    """Pastikan GET /api/v1/reports/accounting berfungsi dengan otentikasi."""
    client.cookies.update(auth_cookies)
    res = await client.get("/api/v1/reports/accounting?month=10&year=2026")
    assert res.status_code == 200
    json_data = res.json()
    assert json_data["ok"] is True
    assert json_data["month"] == 10
    assert json_data["year"] == 2026
    assert len(json_data["laba_rugi"]["hpp_items"]) > 0
    assert len(json_data["laba_rugi"]["opex_items"]) > 0


@pytest.mark.anyio
async def test_accounting_multi_month_range(client, auth_cookies, db):
    """Pastikan multi-month range bekerja di accounting dan monthly report."""
    data = await get_accounting_report(db, 2026, 1, month_end=6)
    assert data["ok"] is True
    assert data["month"] == 1
    assert data["month_end"] == 6
    assert "Januari - Juni" in data["month_name"]

    client.cookies.update(auth_cookies)
    res = await client.get("/api/v1/reports/accounting?month=1&month_end=6&year=2026")
    assert res.status_code == 200
    json_data = res.json()
    assert json_data["ok"] is True
    assert json_data["month"] == 1
    assert json_data["month_end"] == 6
    assert "Januari - Juni" in json_data["month_name"]

    # Test monthly report endpoint with month_end
    res_monthly = await client.get("/api/v1/reports/monthly?month=1&month_end=7&year=2026")
    assert res_monthly.status_code == 200
    monthly_data = res_monthly.json()
    assert monthly_data["month"] == 1
    assert monthly_data["month_end"] == 7
    assert "Januari - Juli" in monthly_data["month_name"]


@pytest.mark.anyio
async def test_accounting_strategic_integrity_accrual_cutoff_ratios_and_hpp_variance(db):
    """
    Uji integritas menyeluruh Step 1 - Step 4:
    1. Pengakuan akrual penuh belanja tempo/DP di Laba Rugi vs pemisahan kas keluar riil di Arus Kas.
    2. Neraca point-in-time (< end_date) untuk Aset Lancar, Hutang Usaha, Hutang Talangan, dan Laba Ditahan (3-2000).
    3. Rasio strategis F&B terhadap Net Revenue (menghindari false warning HPP saat OPEX efisien).
    4. Analisis variansi HPP Teoritis (Resep MenuProduct) vs HPP Aktual (Belanja Bahan).
    """
    from datetime import date
    from decimal import Decimal
    from app.models.bank_account import BankAccount
    from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
    from app.models.expense import Expense
    from app.models.expense_payment import ExpensePayment
    from app.models.menu_product import MenuProduct

    # 1. Buat Rekening Bank Operasional dengan Saldo Awal Rp 10.000.000
    bank = BankAccount(
        name="BCA Utama",
        bank_name="BCA",
        account_type="bank",
        account_code="1-1120",
        opening_balance=Decimal("10000000"),
        channel_mappings='["Transfer", "Cash", "Tunai"]',
        is_default=True,
        is_active=True,
    )
    db.add(bank)
    await db.flush()

    # 2. Data Bulan September 2026 (Periode Sebelumnya -> menjadi Laba Ditahan di Oktober):
    # Omset September = Rp 5.000.000, Belanja Bahan Lunas = Rp 2.000.000 -> Laba Ditahan = Rp 3.000.000
    tx_sep = IncomingTransaction(
        transaction_date=date(2026, 9, 15),
        receipt_no="SEP-001",
        order_type="Take Away",
        payment_method="Transfer",
        bank_account_id=bank.id,
        gross_sales=5000000.0,
        discount_amount=0.0,
        net_sales=5000000.0,
        platform_fee=0.0,
        net_received=5000000.0,
        status="paid",
    )
    exp_sep = Expense(
        expense_date=date(2026, 9, 10),
        supplier="Supplier Terigu",
        item_name="Terigu Protein Tinggi",
        qty=Decimal("10"),
        unit="Sak",
        category="Bahan Kue",
        unit_price=Decimal("200000"),
        total_price=Decimal("2000000"),
        pay_method="Transfer",
        pay_status="Lunas",
        bank_account_id=bank.id,
    )
    db.add_all([tx_sep, exp_sep])
    await db.flush()

    # 3. Data Bulan Oktober 2026 (Periode Laporan):
    # - MenuProduct "Bolu Gulung Premium" dengan HPP manual Rp 40.000, Harga Jual Rp 100.000
    menu = MenuProduct(
        name="Bolu Gulung Premium",
        anonymous_name="MENU-001",
        category="Cake Ready",
        unit="Box",
        selling_price=100000.0,
        hpp_manual=40000.0,
        hpp_mode="manual",
        is_sellable=True,
    )
    db.add(menu)
    await db.flush()

    # - Penjualan Oktober: 100 Box Bolu Gulung Premium @ Rp 100.000 = Rp 10.000.000
    #   (Theoretical HPP = 100 x Rp 40.000 = Rp 4.000.000)
    tx_oct = IncomingTransaction(
        transaction_date=date(2026, 10, 12),
        receipt_no="OCT-001",
        order_type="Take Away",
        payment_method="Transfer",
        bank_account_id=bank.id,
        gross_sales=10000000.0,
        discount_amount=0.0,
        net_sales=10000000.0,
        platform_fee=0.0,
        net_received=10000000.0,
        status="paid",
    )
    db.add(tx_oct)
    await db.flush()
    db.add(
        IncomingTransactionItem(
            transaction_id=tx_oct.id,
            product_name="Bolu Gulung Premium",
            category="Cake Ready",
            qty=100.0,
            unit_price=100000.0,
            gross_amount=10000000.0,
            discount_amount=0.0,
        )
    )

    # - Belanja Bahan Kue Lunas Oktober: Rp 3.000.000
    exp_oct_lunas = Expense(
        expense_date=date(2026, 10, 5),
        supplier="Toko Bahan",
        item_name="Mentega & Telur",
        qty=Decimal("1"),
        unit="Paket",
        category="Bahan Kue",
        unit_price=Decimal("3000000"),
        total_price=Decimal("3000000"),
        pay_method="Transfer",
        pay_status="Lunas",
        bank_account_id=bank.id,
    )
    # - Belanja Kemasan Tempo (Belum Lunas) Oktober: Rp 1.000.000 (Harus masuk HPP Laba Rugi, tapi TIDAK masuk Kas Keluar)
    exp_oct_tempo = Expense(
        expense_date=date(2026, 10, 18),
        supplier="Pabrik Box",
        item_name="Box Bolu Gulung",
        qty=Decimal("1000"),
        unit="Pcs",
        category="Kemasan",
        unit_price=Decimal("1000"),
        total_price=Decimal("1000000"),
        pay_method="Transfer",
        pay_status="Belum Lunas",
        due_date="2026-11-18",
    )
    # - Belanja OPEX Operasional Talangan Belum Diganti Oktober: Rp 500.000 (Masuk OPEX & Hutang Talangan, TIDAK memotong Kas)
    exp_oct_talangan = Expense(
        expense_date=date(2026, 10, 20),
        supplier="PLN",
        item_name="Token Listrik Dapur",
        qty=Decimal("1"),
        unit="Pcs",
        category="Operasional",
        unit_price=Decimal("500000"),
        total_price=Decimal("500000"),
        pay_method="Transfer",
        pay_status="Lunas",
        is_reimbursement=True,
        reimbursed_at=None,
    )
    db.add_all([exp_oct_lunas, exp_oct_tempo, exp_oct_talangan])
    await db.flush()

    # 4. Data Bulan November 2026 (Setelah end_date Oktober -> TIDAK boleh bocor ke Neraca Oktober):
    tx_nov = IncomingTransaction(
        transaction_date=date(2026, 11, 5),
        receipt_no="NOV-001",
        order_type="Take Away",
        payment_method="Transfer",
        bank_account_id=bank.id,
        gross_sales=8000000.0,
        discount_amount=0.0,
        net_sales=8000000.0,
        platform_fee=0.0,
        net_received=8000000.0,
        status="paid",
    )
    db.add(tx_nov)
    await db.commit()

    # Ambil laporan akuntansi Oktober 2026
    rep = await get_accounting_report(db, 2026, 10)

    # A. Verifikasi Laba Rugi Akrual
    lr = rep["laba_rugi"]
    assert lr["revenue_net"] == 10000000.0
    # HPP = 3.000.000 (lunas) + 1.000.000 (tempo belum lunas) = 4.000.000
    assert lr["subtotal_hpp"] == 4000000.0
    # OPEX = 500.000 (talangan)
    assert lr["subtotal_opex"] == 500000.0
    assert lr["total_beban"] == 4500000.0
    assert lr["gross_profit"] == 6000000.0
    assert lr["gross_margin_pct"] == 60.0
    assert lr["net_profit"] == 5500000.0
    assert lr["net_margin_pct"] == 55.0

    # B. Verifikasi Arus Kas Riil
    ak = rep["arus_kas"]
    # Kas keluar riil Oktober HANYA Rp 3.000.000 (belanja bahan lunas). Kemasan tempo 1jt & talangan 500rb belum keluar kas!
    assert ak["subtotal_operasi"] == 3000000.0
    assert ak["total_kas_keluar_riil"] == 3000000.0
    assert ak["net_cash_flow"] == 7000000.0

    # C. Verifikasi Neraca Point-in-Time (< 2026-11-01) & Keseimbangan Aset = Kewajiban + Ekuitas
    ner = rep["neraca"]
    # Saldo Kas/Bank per 31 Okt = 10jt (awal) + 5jt (in Sep) - 2jt (out Sep) + 10jt (in Okt) - 3jt (out Okt) = 20.000.000
    # (Transaksi Nov 8jt tidak ikut masuk)
    assert ner["subtotal_aset_lancar"] == 20000000.0
    assert ner["total_aset"] == 20000000.0
    # Kewajiban = 1.000.000 (hutang usaha) + 500.000 (hutang talangan) = 1.500.000
    assert ner["subtotal_kewajiban"] == 1500000.0
    # Ekuitas = 10.000.000 (Modal Awal) + 3.000.000 (Laba Ditahan Sep) + 5.500.000 (Laba Bersih Okt) = 18.500.000
    assert ner["subtotal_ekuitas"] == 18500000.0
    # Persamaan Dasar Akuntansi: Aset (20.000.000) == Kewajiban (1.500.000) + Ekuitas (18.500.000)
    assert ner["total_aset"] == ner["subtotal_kewajiban"] + ner["subtotal_ekuitas"]

    # D. Verifikasi Rasio Strategis terhadap Omset (bukan terhadap Total Beban)
    cs = rep["analisis"]["cost_structure"]
    # HPP terhadap beban = 4jt / 4.5jt = 88.9% (kalau pakai rumus lama ini memicu false warning!)
    assert cs["hpp_ratio"] == 88.9
    # HPP terhadap omset = 4jt / 10jt = 40.0% (sehat!)
    assert cs["hpp_to_revenue_pct"] == 40.0
    hpp_eval = next(e for e in rep["analisis"]["health_evaluation"] if e["key"] == "hpp_ratio")
    assert hpp_eval["status"] == "healthy"
    assert hpp_eval["value"] == "40.0%"

    # E. Verifikasi Variansi HPP Teoritis vs Aktual
    hv = rep["analisis"]["hpp_variance"]
    assert hv["theoretical_hpp"] == 4000000.0
    assert hv["actual_hpp"] == 4000000.0
    assert hv["variance_nominal"] == 0.0
    assert hv["variance_pct"] == 0.0
    assert hv["matched_menu_count"] == 1
    assert hv["status"] == "aligned"


