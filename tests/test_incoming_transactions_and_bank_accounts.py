"""
tests/test_incoming_transactions_and_bank_accounts.py
Test parser POS multi-item & Void, Rekening Setup CRUD, auto-mapping, dan API Transaksi Masuk.
"""
from pathlib import Path
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.sales_import_service import parse_pos_csv


SAMPLE_POS_CSV = """Daftar Transaksi_History Cake
Periode,2026-11-16 00:00:00 - 2026-11-16 23:59:59
Lokasi,Semua Lokasi

Nama Lokasi,No Receipt,No Penjualan,Tanggal Penjualan,Waktu Penjualan,Nama Pelanggan,Nomor Telepon Pelanggan,Jumlah Pelanggan,Tipe Order,Kategori Produk,Grup Produk,Nama Produk,SKU Produk,Qty produk,Pengubah,Kuantitas Tercancel,Alasan pembatalan,Dibatalkan Oleh,Harga,Harga Tambahan,Penjualan Kotor,Total Diskon,Diskon Penjualan,Diskon Produk,Tambahan Biaya,Penjualan Bersih,Service Charge,Pajak Service Charge,Pajak Produk,Total Pajak,Nama Pajak,Biaya Tambahan,Pembulatan,Metode Pengiriman,Biaya Pengiriman,Total,Total Pembatalan,Nama Promo,Poin yang Ditukarkan,Skema Hadiah,Subsidi Promo,Biaya Pembayaran,Bersih Diterima,Jenis Pembayaran,Catatan Pembayaran,Catatan Penyesuaian,Nama Perangkat,Durasi Persiapan,Durasi Penyajian,Nama Kasir,Nama Pelayan,Status,Tanggal Void,Waktu Void,Void Oleh,Catatan Void
History Cake,RkiNqGO,PMQpcR9,16/11/2026,11:12:33 WIB,,,0,Take Away,Cake Ready,Nov26,Kue Ulang Tahun Bouquet Flower Sweet Pea Petal,HC\\BFC\\NOV26\\RV,1,,0,-,-,150000,0,150000,0,0,0,0,175000,0,0,0,0,-,0,0,-,"",175000,"",-,-,-,0,0,175000,QRIS,-,-,23073RPBFG,-,-,Bila,,Dibayar,-,-,,
,,,,,,,,Take Away,Dessert Box Mini,,Dessert Box Mini - Classic Tiramisu,HC\\DBM\\CST,1,,0,-,-,25000,0,25000,0,0,0,0,,,,0,,-,,,,,,,,,,,,,,,-,,-,-,,,,,,,
History Cake,RFxN7V5,F-3429057006,16/11/2026,11:24:55 WIB,vivie,,0,GoFood Integrasi,Cake Ready,,Kue Bogel Gold Mini,HC\\BC\\BC,1,,0,-,-,70000,0,70000,18480,18480,0,0,106720,0,0,0,0,-,0,0,-,"",106720,"",Promo-GoFood,0,-,0,49300,57420,GoFood Integrasi,-,-,,-,-,,,Dibayar,-,-,,
,,,,,,,,GoFood Integrasi,Minuman,,Coffee Story Cheese,HC\\MN\\CSC,1,,0,-,-,40000,0,40000,10560,10560,0,0,,,,0,,-,,,,,,,,,,,,,,,-,,-,-,,,,,,,
,,,,,,,,GoFood Integrasi,Minuman,,Matcha Cheese,HC\\MN\\DDMC,1,,0,-,-,35000,0,35000,9240,9240,0,0,,,,0,,-,,,,,,,,,,,,,,,-,,-,-,,,,,,,
History Cake,RAGKaYr,F-3429207063,16/11/2026,13:15:02 WIB,debi,,0,GoFood Integrasi,Cake Ready,Nov26,Kue Ulang Tahun Bouquet,HC\\BFC\\NOV26\\TC,1,1x Lilin Panjang,0,-,-,225000,6000,231000,54670,54670,0,0,176330,0,0,0,0,-,0,0,-,"","",176330,Promo-GoFood,0,-,0,78540,97790,GoFood Integrasi,-,-,,-,-,,,Void,16/11/2026,14:10:20 WIB,,
TOTAL,,,,,,,0,,,,,,,,0,,,,,481000,92950,92950,0,0,281720,0,0,0,0,,0,0,,0,281720,176330,,,,0,49300,232420,,,,,,,,,,,,,
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


def test_parse_pos_csv_multi_item_and_void():
    parsed = parse_pos_csv(SAMPLE_POS_CSV)
    assert len(parsed.transactions) == 3
    assert parsed.paid_count == 2
    assert parsed.void_count == 1
    assert parsed.total_items == 6

    tx1 = parsed.transactions[0]
    assert tx1["receipt_no"] == "RkiNqGO"
    assert len(tx1["items"]) == 2
    assert tx1["gross_sales"] == 175000.0
    assert tx1["net_received"] == 175000.0
    assert tx1["status"] == "paid"

    tx2 = parsed.transactions[1]
    assert tx2["receipt_no"] == "RFxN7V5"
    assert len(tx2["items"]) == 3
    assert tx2["gross_sales"] == 145000.0
    assert tx2["discount_amount"] == 38280.0
    assert tx2["net_sales"] == 106720.0
    assert tx2["platform_fee"] == 49300.0
    assert tx2["net_received"] == 57420.0

    tx3 = parsed.transactions[2]
    assert tx3["receipt_no"] == "RAGKaYr"
    assert tx3["status"] == "void"
    assert tx3["net_received"] == 0.0
    assert tx3["cancellation_total"] == 176330.0


def test_parse_real_attached_pos_csv_if_present():
    real_path = Path("/Users/taufik/Downloads/POS Transaction History Cake.csv")
    if not real_path.exists():
        pytest.skip("Sample CSV not present on disk")
    parsed = parse_pos_csv(real_path.read_bytes())
    assert parsed.paid_count > 0
    assert parsed.void_count == 2
    paid_net_received = sum(t["net_received"] for t in parsed.transactions if t["status"] == "paid")
    assert paid_net_received == 6882295.0


@pytest.mark.asyncio
async def test_bank_account_and_incoming_tx_flow(client: AsyncSession, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Buat Rekening Setup (BCA untuk QRIS & Transfer, GoBiz untuk GoFood Integrasi)
    res_bca = await client.post(
        "/api/v1/bank-accounts",
        json={
            "name": "BCA Operasional",
            "bank_name": "BCA",
            "account_number": "1234567890",
            "account_holder": "History Cake",
            "account_type": "bank",
            "opening_balance": 1000000,
            "channel_mappings": ["QRIS", "Transfer"],
            "is_default": True,
        },
    )
    assert res_bca.status_code == 201
    bca_id = res_bca.json()["account"]["id"]

    res_gobiz = await client.post(
        "/api/v1/bank-accounts",
        json={
            "name": "GoBiz Wallet",
            "bank_name": "GoPay / GoBiz",
            "account_type": "aggregator",
            "opening_balance": 0,
            "channel_mappings": ["GoFood Integrasi"],
        },
    )
    assert res_gobiz.status_code == 201
    gobiz_id = res_gobiz.json()["account"]["id"]

    # 2. Preview import CSV POS
    res_prev = await client.post(
        "/api/v1/incoming-transactions/import/preview",
        files={"file": ("pos.csv", SAMPLE_POS_CSV, "text/csv")},
        data={"source_type": "auto"},
    )
    assert res_prev.status_code == 200
    prev = res_prev.json()["preview"]
    assert prev["new_paid_count"] == 2
    assert prev["new_void_count"] == 1
    assert prev["duplicate_count"] == 0
    assert prev["total_net_received"] == 175000.0 + 57420.0

    # 3. Commit import CSV POS
    res_commit = await client.post(
        "/api/v1/incoming-transactions/import/commit",
        files={"file": ("pos.csv", SAMPLE_POS_CSV, "text/csv")},
        data={"source_type": "auto", "skip_duplicates": "true", "include_void": "true"},
    )
    assert res_commit.status_code == 200
    assert res_commit.json()["result"]["inserted_paid"] == 2
    assert res_commit.json()["result"]["inserted_void"] == 1

    # 4. Commit ulang file yang sama -> harus skip semua sebagai duplikat
    res_dup = await client.post(
        "/api/v1/incoming-transactions/import/commit",
        files={"file": ("pos.csv", SAMPLE_POS_CSV, "text/csv")},
        data={"source_type": "auto", "skip_duplicates": "true"},
    )
    assert res_dup.status_code == 200
    assert res_dup.json()["result"]["inserted_paid"] == 0
    assert res_dup.json()["result"]["duplicate_count"] == 3

    # 5. List transaksi masuk + cek auto-mapping rekening
    res_list = await client.get("/api/v1/incoming-transactions")
    assert res_list.status_code == 200
    body = res_list.json()
    assert body["summary"]["paid_count"] == 2
    assert body["summary"]["void_count"] == 1
    assert body["summary"]["net_received"] == 232420.0

    tx_by_receipt = {t["receipt_no"]: t for t in body["transactions"]}
    assert tx_by_receipt["RkiNqGO"]["bank_account_id"] == bca_id
    assert tx_by_receipt["RFxN7V5"]["bank_account_id"] == gobiz_id

    # 6. Cek saldo estimasi di Rekening Setup
    res_accs = await client.get("/api/v1/bank-accounts")
    assert res_accs.status_code == 200
    accs = {a["id"]: a for a in res_accs.json()["accounts"]}
    assert accs[bca_id]["total_incoming"] == 175000.0
    assert accs[bca_id]["estimated_balance"] == 1175000.0
    assert accs[gobiz_id]["total_incoming"] == 57420.0

    # 7. Cek integrasi ke Laporan Akuntansi (Laba Rugi, Neraca Rekening, Arus Kas)
    res_acc_rep = await client.get("/api/v1/reports/accounting?month=11&year=2026")
    assert res_acc_rep.status_code == 200
    rep = res_acc_rep.json()
    assert rep["laba_rugi"]["revenue_net"] == 232420.0
    assert rep["laba_rugi"]["paid_tx_count"] == 2
    assert rep["arus_kas"]["total_kas_masuk"] == 232420.0
    pos_by_id = {p["id"]: p for p in rep["neraca"]["rekening_positions"]}
    assert pos_by_id[bca_id]["account_code"] == "1-1120"
    assert pos_by_id[bca_id]["incoming_month"] == 175000.0
    assert pos_by_id[bca_id]["estimated_balance"] == 1175000.0
    assert pos_by_id[gobiz_id]["account_code"] == "1-1130"
    assert pos_by_id[gobiz_id]["incoming_month"] == 57420.0
