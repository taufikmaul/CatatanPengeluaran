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
