"""
tests/test_reconciliation_transfers_analytics.py
Test:
1. Rekonsiliasi Settlement Platform & Mutasi Bank (Masuk + Pengeluaran)
2. Transfer Antar Rekening (Setor Tunai & Pencairan Platform)
3. Radar Menu Terlaris & Jam Sibuk Toko (/incoming-transactions/analytics)
4. Pencatatan Rekening Sumber di Form Pengeluaran & Petty Cash (bank_account_id on Expense)
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME


SAMPLE_POS_CSV = """Daftar Transaksi_History Cake
Periode,2026-11-16 00:00:00 - 2026-11-16 23:59:59

Nama Lokasi,No Receipt,No Penjualan,Tanggal Penjualan,Waktu Penjualan,Nama Pelanggan,Nomor Telepon Pelanggan,Jumlah Pelanggan,Tipe Order,Kategori Produk,Grup Produk,Nama Produk,SKU Produk,Qty produk,Pengubah,Kuantitas Tercancel,Alasan pembatalan,Dibatalkan Oleh,Harga,Harga Tambahan,Penjualan Kotor,Total Diskon,Diskon Penjualan,Diskon Produk,Tambahan Biaya,Penjualan Bersih,Service Charge,Pajak Service Charge,Pajak Produk,Total Pajak,Nama Pajak,Biaya Tambahan,Pembulatan,Metode Pengiriman,Biaya Pengiriman,Total,Total Pembatalan,Nama Promo,Poin yang Ditukarkan,Skema Hadiah,Subsidi Promo,Biaya Pembayaran,Bersih Diterima,Jenis Pembayaran,Catatan Pembayaran,Catatan Penyesuaian,Nama Perangkat,Durasi Persiapan,Durasi Penyajian,Nama Kasir,Nama Pelayan,Status,Tanggal Void,Waktu Void,Void Oleh,Catatan Void
History Cake,R4gL8DI,P5EcHtp,16/11/2026,10:48:44 WIB,,,0,ShopeeFood,Cake Ready,Nov26,Kue Ulang Tahun Lunch Box,HC\\LBC\\NOV26\\VC,1,,0,-,-,145000,9000,154000,0,0,0,0,154000,0,0,0,0,-,0,0,-,"",154000,"",-,-,-,0,0,154000,ShopeeFood,-,-,23073RPBFG,-,-,Bila,,Dibayar,-,-,,
History Cake,RL6SJPe,PWNesKy,16/11/2026,11:13:40 WIB,,,0,Take Away,Cake Ready,,Kue Ulang Tahun Bogel Gold Mini,HC\\BC\\BC,2,,0,-,-,45000,0,90000,0,0,0,0,90000,0,0,0,0,-,0,0,-,"",90000,"",-,-,-,0,0,90000,Cash,-,-,23073RPBFG,-,-,Bila,,Dibayar,-,-,,
""".encode("utf-8")

SAMPLE_SETTLEMENT_CSV = """Order ID,Tanggal,Gross,Fee,Net Payout
P5EcHtp,16/11/2026,154000,30800,123200
""".encode("utf-8")

SAMPLE_BANK_MUTASI_CSV = """Tanggal,Keterangan,Debit,Kredit,Referensi
16/11/2026,TRSF TOKO BAHAN KUE,50000,0,MUT-DB-001
17/11/2026,SETOR TUNAI KASIR,0,90000,MUT-CR-001
""".encode("utf-8")


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


@pytest.mark.asyncio
async def test_transfers_petty_cash_analytics_and_reconciliation(client: AsyncSession, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Setup 3 Rekening: Kas Tunai, BCA, ShopeeFood Wallet
    r_cash = await client.post("/api/v1/bank-accounts", json={
        "name": "Kas Tunai Toko",
        "bank_name": "Cash",
        "account_type": "cash",
        "account_code": "1-1110",
        "opening_balance": 200000,
        "channel_mappings": ["Cash", "Tunai"],
    })
    assert r_cash.status_code == 201
    cash_id = r_cash.json()["account"]["id"]

    r_bca = await client.post("/api/v1/bank-accounts", json={
        "name": "BCA Operasional",
        "bank_name": "BCA",
        "account_type": "bank",
        "account_code": "1-1120",
        "opening_balance": 1000000,
        "channel_mappings": ["Transfer", "QRIS"],
    })
    assert r_bca.status_code == 201
    bca_id = r_bca.json()["account"]["id"]

    r_shopee = await client.post("/api/v1/bank-accounts", json={
        "name": "ShopeeFood Wallet",
        "bank_name": "Shopee",
        "account_type": "aggregator",
        "account_code": "1-1130",
        "opening_balance": 0,
        "channel_mappings": ["ShopeeFood"],
    })
    assert r_shopee.status_code == 201
    shopee_id = r_shopee.json()["account"]["id"]

    # 2. Import POS CSV (1 ShopeeFood 154.000, 1 Cash 90.000)
    r_imp = await client.post(
        "/api/v1/incoming-transactions/import/commit",
        files={"file": ("pos.csv", SAMPLE_POS_CSV, "text/csv")},
        data={"source_type": "auto"},
    )
    assert r_imp.status_code == 200
    assert r_imp.json()["result"]["inserted_paid"] == 2

    # 3. Catat Pengeluaran Petty Cash dari Kas Tunai Toko (50.000)
    r_exp = await client.post("/api/v1/expenses", json={
        "expense_date": "2026-11-16",
        "supplier": "Toko Bahan Kue",
        "item_name": "Lilin Angka",
        "qty": 1,
        "unit": "Pcs",
        "category": "Operasional",
        "unit_price": 50000,
        "total_price": 50000,
        "pay_method": "Tunai",
        "pay_status": "Lunas",
        "bank_account_id": cash_id,
    })
    assert r_exp.status_code == 201
    assert r_exp.json()["bank_account_id"] == cash_id

    # 4. Transfer Antar Rekening: Setor Tunai 100.000 dari Kas Tunai -> BCA
    r_tr = await client.post("/api/v1/bank-transfers", json={
        "transfer_date": "2026-11-16",
        "from_account_id": cash_id,
        "to_account_id": bca_id,
        "amount": 100000,
        "admin_fee": 0,
        "transfer_type": "setor_tunai",
        "notes": "Setor kasir sore",
    })
    assert r_tr.status_code == 201

    # Cek saldo setelah transaksi masuk + petty cash + setor tunai:
    # Kas Tunai = 200.000 (awal) + 90.000 (POS Cash) - 50.000 (Petty Cash) - 100.000 (Setor) = 140.000
    # BCA = 1.000.000 (awal) + 100.000 (Setor) = 1.100.000
    r_accs = await client.get("/api/v1/bank-accounts")
    accs = {a["id"]: a for a in r_accs.json()["accounts"]}
    assert accs[cash_id]["estimated_balance"] == 140000.0
    assert accs[bca_id]["estimated_balance"] == 1100000.0

    # 5. Radar Menu Terlaris & Jam Sibuk
    r_ana = await client.get("/api/v1/incoming-transactions/analytics")
    assert r_ana.status_code == 200
    ana = r_ana.json()["analytics"]
    assert len(ana["top_products"]) == 2
    assert ana["top_products"][0]["product_name"] == "Kue Ulang Tahun Bogel Gold Mini"
    assert ana["top_products"][0]["total_qty"] == 2.0
    assert len(ana["peak_hours"]) == 2  # Jam 10:00 & 11:00

    # 6. Rekonsiliasi Settlement ShopeeFood (update fee dari 0 -> 30.800, net -> 123.200)
    r_prev_set = await client.post(
        "/api/v1/reconciliation/preview",
        files={"file": ("shopee_settle.csv", SAMPLE_SETTLEMENT_CSV, "text/csv")},
        data={"mode": "settlement_platform", "bank_account_id": str(shopee_id)},
    )
    assert r_prev_set.status_code == 200
    prev_set = r_prev_set.json()["preview"]
    assert len(prev_set["matched_incoming"]) == 1
    assert prev_set["matched_incoming"][0]["new_platform_fee"] == 30800.0
    assert prev_set["matched_incoming"][0]["new_net_received"] == 123200.0

    r_apply_set = await client.post("/api/v1/reconciliation/apply", json={
        "incoming_matches": prev_set["matched_incoming"],
        "expense_matches": [],
    })
    assert r_apply_set.status_code == 200
    assert r_apply_set.json()["result"]["reconciled_incoming"] == 1

    # 7. Rekonsiliasi Mutasi Bank (cocokkan Debit 50.000 -> Expense, Kredit 90.000 -> POS Cash)
    r_prev_bank = await client.post(
        "/api/v1/reconciliation/preview",
        files={"file": ("mutasi.csv", SAMPLE_BANK_MUTASI_CSV, "text/csv")},
        data={"mode": "mutasi_bank", "bank_account_id": str(bca_id)},
    )
    assert r_prev_bank.status_code == 200
    prev_bank = r_prev_bank.json()["preview"]
    assert len(prev_bank["matched_expenses"]) == 1
    assert len(prev_bank["matched_incoming"]) == 1

    r_apply_bank = await client.post("/api/v1/reconciliation/apply", json={
        "incoming_matches": prev_bank["matched_incoming"],
        "expense_matches": prev_bank["matched_expenses"],
    })
    assert r_apply_bank.status_code == 200
    assert r_apply_bank.json()["result"]["reconciled_expenses"] == 1
    assert r_apply_bank.json()["result"]["reconciled_incoming"] == 1


SAMPLE_CAKEFLOW_CSV = """Order ID,Tanggal Input,Tanggal Target,Customer/Penerima,Admin,Produk,Total Belanja,Metode DP,Metode Pelunasan,Status
CF-2026-001,2026-11-18 14:25:00,2026-11-18,Ibu Ratna,Admin CF,Custom Wedding Cake 3 Tier,1800000,Transfer,Transfer,Paid
CF-2026-002,2026-11-18 15:10:00,2026-11-18,Pak Dimas,Admin CF,2x Bento Cake Custom Tema Bola,320000,Transfer,Transfer,Paid
""".encode("utf-8")


@pytest.mark.asyncio
async def test_radar_menu_top_qty_vs_omset_and_cakeflow_in_stats_and_accounting(
    client: AsyncSession, auth_cookies, db: AsyncSession
):
    from datetime import date as dt_date
    from app.models.incoming_transaction import IncomingTransaction

    client.cookies.update(auth_cookies)

    # 1. Setup Rekening BCA dengan mapping "Cakeflow" (tanpa spasi) untuk uji normalisasi "Cake Flow"
    r_bca = await client.post("/api/v1/bank-accounts", json={
        "name": "BCA Operasional",
        "bank_name": "BCA",
        "account_type": "bank",
        "account_code": "1-1120",
        "opening_balance": 500000,
        "channel_mappings": ["Cakeflow", "Transfer", "Cash"],
        "is_default": True,
    })
    assert r_bca.status_code == 201
    bca_id = r_bca.json()["account"]["id"]

    # 2. Import POS CSV (item murah qty tinggi vs item sedang)
    r_pos = await client.post(
        "/api/v1/incoming-transactions/import/commit",
        files={"file": ("pos.csv", SAMPLE_POS_CSV, "text/csv")},
        data={"source_type": "auto"},
    )
    assert r_pos.status_code == 200

    # 3. Import Cake Flow CSV (2 transaksi: Wedding Cake 1.8jt qty 1, Bento Cake 320rb qty 2)
    r_cf = await client.post(
        "/api/v1/incoming-transactions/import/commit",
        files={"file": ("cakeflow.csv", SAMPLE_CAKEFLOW_CSV, "text/csv")},
        data={"source_type": "cakeflow"},
    )
    assert r_cf.status_code == 200
    assert r_cf.json()["result"]["inserted_paid"] == 2

    # 4. Tambahkan 1 transaksi historis Cake Flow (pakai spasi "Cake Flow", tanpa item & tanpa bank_account_id)
    legacy_cf_tx = IncomingTransaction(
        source_type="manual",
        receipt_no="CF-LEGACY-001",
        order_no="CF-LEGACY-001",
        transaction_date=dt_date(2026, 11, 18),
        transaction_time="16:00:00",
        order_type="Cake Flow",
        payment_method="Cake Flow",
        bank_account_id=None,
        gross_sales=750000.0,
        discount_amount=0.0,
        net_sales=750000.0,
        platform_fee=0.0,
        net_received=750000.0,
        status="paid",
        notes="Custom Cake Karakter Unicorn 22cm",
    )
    db.add(legacy_cf_tx)
    await db.commit()

    # 5. Verifikasi Radar Menu Analytics (Top Qty vs Top Omset + Cake Flow)
    r_ana = await client.get("/api/v1/incoming-transactions/analytics?month=11&year=2026")
    assert r_ana.status_code == 200
    ana = r_ana.json()["analytics"]

    # Top Omset #1 HARUS Custom Wedding Cake 3 Tier (Rp 1.800.000, qty 1)
    assert ana["top_products_by_revenue"][0]["product_name"] == "Custom Wedding Cake 3 Tier"
    assert ana["top_products_by_revenue"][0]["net_sales"] == 1800000.0
    # Legacy itemless Cake Flow order juga masuk di Top Omset #2 (Rp 750.000)
    assert ana["top_products_by_revenue"][1]["product_name"] == "Custom Cake Karakter Unicorn 22cm"
    assert ana["top_products_by_revenue"][1]["net_sales"] == 750000.0

    # Top Qty #1 adalah item qty 2 (Bento Cake Custom Tema Bola Rp 320rb mengungguli Bogel Gold Mini Rp 90rb)
    assert ana["top_products_by_qty"][0]["product_name"] == "Bento Cake Custom Tema Bola"
    assert ana["top_products_by_qty"][0]["total_qty"] == 2.0

    # Radar dataset terisi untuk kedua mode (Qty & Revenue)
    assert len(ana["radar_by_qty"]) >= 4
    assert len(ana["radar_by_revenue"]) >= 4
    assert ana["radar_by_revenue"][0]["revenue_score"] == 100.0

    # Summary Cake Flow mencakup 3 transaksi (2 CSV + 1 legacy) = 1.800.000 + 320.000 + 750.000 = 2.870.000
    assert ana["summary"]["cakeflow_tx_count"] == 3
    assert ana["summary"]["cakeflow_net_received"] == 2870000.0
    assert ana["summary"]["cakeflow_qty"] == 4.0  # 1 + 2 + 1

    # Peak hours mencatat cakeflow_count di jam 14, 15, 16
    cf_hours = [h for h in ana["peak_hours"] if h["cakeflow_count"] > 0]
    assert len(cf_hours) == 3

    # Filter order_type spesifik ke Cakeflow
    r_ana_cf = await client.get("/api/v1/incoming-transactions/analytics?month=11&year=2026&order_type=Cakeflow")
    assert r_ana_cf.status_code == 200
    assert r_ana_cf.json()["analytics"]["summary"]["total_paid_tx"] == 2

    # 6. Verifikasi Akuntansi (Laba Rugi & Posisi Kas Bank) mencakup semua transaksi Cake Flow termasuk yang bank_account_id=None
    # Total semua transaksi masuk Nov 2026 = 154.000 + 90.000 + 1.800.000 + 320.000 + 750.000 = 3.114.000
    r_acc = await client.get("/api/v1/reports/accounting?month=11&year=2026")
    assert r_acc.status_code == 200
    acc_data = r_acc.json()
    assert acc_data["laba_rugi"]["revenue_net"] == 3114000.0
    channels_in_acc = {c["channel"]: c["net_received"] for c in acc_data["laba_rugi"]["revenue_by_channel"]}
    assert channels_in_acc["Cakeflow"] == 2120000.0
    assert channels_in_acc["Cake Flow"] == 750000.0

    # Posisi Kas & Bank BCA juga mencakup transaksi Cake Flow legacy (bank_account_id=None -> fallback mapping "Cakeflow")
    pos_bca = next(p for p in acc_data["neraca"]["rekening_positions"] if p["id"] == bca_id)
    assert pos_bca["incoming_month"] == 3114000.0
    assert pos_bca["estimated_balance"] == 500000.0 + 3114000.0
    assert acc_data["arus_kas"]["total_kas_masuk"] == 3114000.0

    # 7. Verifikasi Daily Cashflow (All & per rekening BCA) mencakup semua transaksi Cake Flow
    r_cf_daily = await client.get(f"/api/v1/reports/cashflow?month=11&year=2026&bank_account_id={bca_id}")
    assert r_cf_daily.status_code == 200
    cf_daily = r_cf_daily.json()
    assert cf_daily["total_cash_in"] == 3114000.0
    assert cf_daily["saldo_akhir"] == 3614000.0


@pytest.mark.asyncio
async def test_radar_menu_labels_unique_for_shared_long_prefixes(client: AsyncClient, db: AsyncSession, auth_cookies):
    client.cookies.update(auth_cookies)
    """
    Regresi: Menu dengan awalan panjang yang identik (mis. 'Kue Ulang Tahun Bogel ...' &
    'Kue Ulang Tahun Bouquet ...') sebelumnya menghasilkan label radar duplikat setelah
    pemotongan 22 karakter, menyebabkan Recharts PolarAngleAxis menghitung koordinat NaN
    dan merender poligon radar kosong.
    """
    from datetime import date
    from app.api.incoming_transactions import _build_unique_radar_labels
    from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem

    sample_names = [
        "💛Kue Ulang Tahun Mini 10cm",
        "💛Kue Ulang Tahun Bogel 14cm",
        "Kue Ulang Tahun Bogel 14cm Coklat",
        "Kue Ulang Tahun Bogel 16cm Vanilla",
        "Kue Ulang Tahun Bouquet Mini Pink",
        "Kue Ulang Tahun Bouquet Medium Blue",
        "Dubai Chewy Cookie",
        "Fee Custom",
    ]
    labels = _build_unique_radar_labels(sample_names, max_len=24)
    assert len(labels) == len(sample_names)
    assert len({lbl.lower() for lbl in labels}) == len(sample_names)
    assert all(len(lbl) <= 24 for lbl in labels)
    # Pastikan pembeda ukuran/varian tetap muncul pada label yang bertabrakan
    assert "14cm" in labels[2]
    assert "16cm" in labels[3]
    assert "Mini" in labels[4]
    assert "Medium" in labels[5]

    tx = IncomingTransaction(
        transaction_date=date(2026, 10, 15),
        transaction_time="11:00",
        receipt_no="POS-RADAR-DUP-01",
        order_type="Take Away",
        payment_method="Cash",
        gross_sales=1200000.0,
        discount_amount=0.0,
        net_sales=1200000.0,
        platform_fee=0.0,
        net_received=1200000.0,
        status="paid",
    )
    db.add(tx)
    await db.flush()

    for idx, pname in enumerate(sample_names):
        db.add(
            IncomingTransactionItem(
                transaction_id=tx.id,
                product_name=pname,
                category="Cake",
                qty=float(10 - idx),
                unit_price=50000.0 + idx * 15000.0,
                gross_amount=(10 - idx) * (50000.0 + idx * 15000.0),
                discount_amount=0.0,
            )
        )
    await db.commit()

    res = await client.get("/api/v1/incoming-transactions/analytics?month=10&year=2026")
    assert res.status_code == 200
    ana = res.json()["analytics"]

    for key in ("radar_by_qty", "radar_by_revenue"):
        pts = ana[key]
        assert len(pts) == 8
        lbls = [p["label"] for p in pts]
        assert len({l.lower() for l in lbls}) == 8
        assert all(0.0 <= p["qty_score"] <= 100.0 for p in pts)
        assert all(0.0 <= p["revenue_score"] <= 100.0 for p in pts)
        assert max(p["qty_score"] for p in pts) == 100.0
        assert max(p["revenue_score"] for p in pts) == 100.0


@pytest.mark.asyncio
async def test_reconciliation_matches_expense_payments_and_daily_batch_payouts(
    client: AsyncClient, db: AsyncSession, auth_cookies
):
    """
    Uji Step 6:
    - Mutasi DB pada CSV rekening koran dapat mencocokkan pembayaran DP/cicilan di ExpensePayment.
    - Mutasi CR dapat mencocokkan pencairan gabungan harian (batch settlement) per order_type / payment_method.
    """
    from datetime import date
    from decimal import Decimal
    from app.models.incoming_transaction import IncomingTransaction
    from app.models.expense import Expense
    from app.models.expense_payment import ExpensePayment

    client.cookies.update(auth_cookies)

    # 1. Buat 2 transaksi masuk QRIS di tanggal yang sama (120.000 + 80.000 = 200.000 batch payout)
    tx1 = IncomingTransaction(
        transaction_date=date(2026, 11, 20),
        receipt_no="QR-001",
        order_type="Take Away",
        payment_method="QRIS",
        gross_sales=120000.0,
        discount_amount=0.0,
        net_sales=120000.0,
        platform_fee=0.0,
        net_received=120000.0,
        status="paid",
    )
    tx2 = IncomingTransaction(
        transaction_date=date(2026, 11, 20),
        receipt_no="QR-002",
        order_type="Take Away",
        payment_method="QRIS",
        gross_sales=80000.0,
        discount_amount=0.0,
        net_sales=80000.0,
        platform_fee=0.0,
        net_received=80000.0,
        status="paid",
    )
    # 2. Buat 1 invoice belanja DP / Sebagian (Total 1.000.000, DP 400.000 di ExpensePayment)
    exp_dp = Expense(
        expense_date=date(2026, 11, 19),
        supplier="Vendor Box",
        item_name="Box Tart Custom",
        qty=Decimal("100"),
        unit="Pcs",
        category="Kemasan",
        unit_price=Decimal("10000"),
        total_price=Decimal("1000000"),
        pay_method="Transfer",
        pay_status="DP / Sebagian",
        paid_amount=Decimal("400000"),
    )
    db.add_all([tx1, tx2, exp_dp])
    await db.flush()

    ep = ExpensePayment(
        expense_id=exp_dp.id,
        payment_type="dp",
        amount=Decimal("400000"),
        payment_date=date(2026, 11, 20),
        pay_method="Transfer",
        notes="DP 40%",
    )
    db.add(ep)
    await db.commit()

    bank_csv = """Tanggal,Keterangan,Debit,Kredit,Referensi
20/11/2026,TRSF DP VENDOR BOX,400000,0,REF-DP-400
21/11/2026,SETTLEMENT QRIS GABUNGAN,0,200000,REF-QRIS-BATCH
""".encode("utf-8")

    r_prev = await client.post(
        "/api/v1/reconciliation/preview",
        files={"file": ("mutasi_batch.csv", bank_csv, "text/csv")},
        data={"mode": "mutasi_bank"},
    )
    assert r_prev.status_code == 200
    preview = r_prev.json()["preview"]
    assert len(preview["unmatched_rows"]) == 0
    assert len(preview["matched_expenses"]) == 1
    assert preview["matched_expenses"][0]["expense_id"] == exp_dp.id
    assert preview["matched_expenses"][0]["expense_payment_id"] == ep.id
    assert preview["matched_expenses"][0]["total_price"] == 400000.0

    assert len(preview["matched_incoming"]) == 2
    matched_tx_ids = {m["tx_id"] for m in preview["matched_incoming"]}
    assert matched_tx_ids == {tx1.id, tx2.id}

    r_apply = await client.post(
        "/api/v1/reconciliation/apply",
        json={
            "incoming_matches": preview["matched_incoming"],
            "expense_matches": preview["matched_expenses"],
        },
    )
    assert r_apply.status_code == 200
    assert r_apply.json()["result"]["reconciled_incoming"] == 2
    assert r_apply.json()["result"]["reconciled_expenses"] == 1

