"""
tests/test_incoming_duplicates_audit.py
Pengujian analisa & penghapusan duplikat transaksi masuk (/api/v1/incoming-transactions/audit-duplicates).
"""
from datetime import date, datetime

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME


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
def admin_cookies():
    return {SESSION_COOKIE_NAME: create_session_token(role="admin")}


@pytest.fixture
def admin_input_cookies():
    return {SESSION_COOKIE_NAME: create_session_token(role="admin_input")}


@pytest.mark.asyncio
async def test_audit_detects_real_duplicates_and_avoids_false_positives(
    client: AsyncClient, db: AsyncSession, admin_cookies
):
    client.cookies.update(admin_cookies)

    # 1. Duplikat No. Struk lintas sumber (pos ber-item vs manual)
    tx_pos_keep = IncomingTransaction(
        source_type="pos",
        receipt_no="R-DUP-001",
        order_no="ORD-001",
        transaction_date=date(2026, 11, 15),
        transaction_time="17:00:10",
        order_type="ShopeeFood",
        payment_method="ShopeeFood",
        gross_sales=230000,
        net_sales=230000,
        net_received=230000,
        status="paid",
        items=[
            IncomingTransactionItem(
                product_name="Kue Tart Coklat",
                qty=1,
                unit_price=230000,
                gross_amount=230000,
            )
        ],
    )
    tx_manual_dup = IncomingTransaction(
        source_type="manual",
        receipt_no=" r-dup-001 ",
        order_no=None,
        transaction_date=date(2026, 11, 15),
        transaction_time="17:00:10",
        order_type="ShopeeFood",
        payment_method="ShopeeFood",
        gross_sales=230000,
        net_sales=230000,
        net_received=230000,
        status="paid",
    )

    # 2. Duplikat No. Order dengan nomor struk berbeda
    tx_ord_a = IncomingTransaction(
        source_type="pos",
        receipt_no="R-ORD-A",
        order_no="GF-998877",
        transaction_date=date(2026, 11, 15),
        transaction_time="16:40:39",
        order_type="GrabFood Integrasi",
        payment_method="GrabFood Integrasi",
        gross_sales=186000,
        platform_fee=109554,
        net_sales=186000,
        net_received=76446,
        status="paid",
        reconciled_at=datetime(2026, 11, 16, 10, 0, 0),
    )
    tx_ord_b = IncomingTransaction(
        source_type="pos",
        receipt_no="R-ORD-B",
        order_no="GF-998877",
        transaction_date=date(2026, 11, 15),
        transaction_time="16:40:39",
        order_type="GrabFood Integrasi",
        payment_method="GrabFood Integrasi",
        gross_sales=186000,
        platform_fee=109554,
        net_sales=186000,
        net_received=76446,
        status="paid",
    )

    # 3. Duplikat medium lintas sumber tanpa struk/order ID
    tx_cross_pos = IncomingTransaction(
        source_type="pos",
        receipt_no=None,
        order_no=None,
        transaction_date=date(2026, 11, 15),
        transaction_time="12:10:00",
        order_type="Take Away",
        payment_method="Cash",
        gross_sales=150000,
        net_sales=150000,
        net_received=150000,
        status="paid",
    )
    tx_cross_manual = IncomingTransaction(
        source_type="manual",
        receipt_no=None,
        order_no=None,
        transaction_date=date(2026, 11, 15),
        transaction_time=None,
        order_type="Take Away",
        payment_method="Cash",
        gross_sales=150000,
        net_sales=150000,
        net_received=150000,
        status="paid",
    )

    # 4. BUKAN DUPLIKAT: dua order ShopeeFood Rp 145.000 dengan struk, order ID, dan jam berbeda
    tx_legit_1 = IncomingTransaction(
        source_type="pos",
        receipt_no="RmViAh0",
        order_no="PVrhwRE",
        transaction_date=date(2026, 11, 15),
        transaction_time="17:24:54",
        order_type="ShopeeFood",
        payment_method="ShopeeFood",
        gross_sales=145000,
        net_sales=145000,
        net_received=145000,
        status="paid",
    )
    tx_legit_2 = IncomingTransaction(
        source_type="pos",
        receipt_no="Rcv1fP7",
        order_no="P2Pa0xd",
        transaction_date=date(2026, 11, 15),
        transaction_time="17:00:34",
        order_type="ShopeeFood",
        payment_method="ShopeeFood",
        gross_sales=145000,
        net_sales=145000,
        net_received=145000,
        status="paid",
    )

    db.add_all(
        [
            tx_pos_keep,
            tx_manual_dup,
            tx_ord_a,
            tx_ord_b,
            tx_cross_pos,
            tx_cross_manual,
            tx_legit_1,
            tx_legit_2,
        ]
    )
    await db.commit()

    # Scan dengan include_medium=True
    res = await client.get(
        "/api/v1/incoming-transactions/audit-duplicates",
        params={"include_medium": "true"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["scanned_transactions"] == 8
    assert body["duplicate_group_count"] == 3
    assert body["high_confidence_groups"] == 2
    assert body["medium_confidence_groups"] == 1
    assert body["duplicate_tx_count"] == 3

    # Pastikan dua order ShopeeFood yang sah TIDAK masuk grup duplikat
    flagged_ids = {
        t["id"]
        for g in body["groups"]
        for t in g["transactions"]
    }
    assert tx_legit_1.id not in flagged_ids
    assert tx_legit_2.id not in flagged_ids

    by_reason = {g["reason_code"]: g for g in body["groups"]}
    assert by_reason["same_receipt_no"]["suggested_keep_id"] == tx_pos_keep.id
    assert by_reason["same_receipt_no"]["suggested_delete_ids"] == [tx_manual_dup.id]
    # Untuk grup yang salah satunya sudah rekonsiliasi, wajib sarankan simpan yang terekonsiliasi
    assert by_reason["same_order_no"]["suggested_keep_id"] == tx_ord_a.id
    assert by_reason["same_order_no"]["suggested_delete_ids"] == [tx_ord_b.id]

    # Scan dengan include_medium=False hanya mengembalikan 2 grup high severity
    res_high = await client.get(
        "/api/v1/incoming-transactions/audit-duplicates",
        params={"include_medium": "false"},
    )
    assert res_high.status_code == 200
    assert res_high.json()["duplicate_group_count"] == 2


@pytest.mark.asyncio
async def test_delete_duplicates_rbac_and_reconciled_protection(
    client: AsyncClient, db: AsyncSession, admin_cookies, admin_input_cookies
):
    tx_reconciled = IncomingTransaction(
        source_type="pos",
        receipt_no="R-REC-1",
        transaction_date=date(2026, 11, 15),
        order_type="Take Away",
        payment_method="QRIS",
        gross_sales=50000,
        net_sales=50000,
        net_received=50000,
        status="paid",
        reconciled_at=datetime(2026, 11, 16, 9, 0, 0),
    )
    tx_dup = IncomingTransaction(
        source_type="manual",
        receipt_no="R-REC-1",
        transaction_date=date(2026, 11, 15),
        order_type="Take Away",
        payment_method="QRIS",
        gross_sales=50000,
        net_sales=50000,
        net_received=50000,
        status="paid",
    )
    db.add_all([tx_reconciled, tx_dup])
    await db.commit()

    # admin_input boleh scan, tapi tidak boleh hapus
    client.cookies.clear()
    client.cookies.update(admin_input_cookies)
    scan_res = await client.get("/api/v1/incoming-transactions/audit-duplicates")
    assert scan_res.status_code == 200
    assert scan_res.json()["duplicate_group_count"] == 1

    forbid_res = await client.post(
        "/api/v1/incoming-transactions/audit-duplicates/delete",
        json={"transaction_ids": [tx_dup.id]},
    )
    assert forbid_res.status_code == 403

    # admin menghapus keduanya, tapi tx_reconciled dilindungi secara default
    client.cookies.clear()
    client.cookies.update(admin_cookies)
    del_res = await client.post(
        "/api/v1/incoming-transactions/audit-duplicates/delete",
        json={"transaction_ids": [tx_reconciled.id, tx_dup.id], "allow_reconciled": False},
    )
    assert del_res.status_code == 200
    del_body = del_res.json()
    assert del_body["deleted_count"] == 1
    assert del_body["deleted_ids"] == [tx_dup.id]
    assert del_body["skipped_reconciled_ids"] == [tx_reconciled.id]

    # Scan ulang sekarang bersih
    scan_after = await client.get("/api/v1/incoming-transactions/audit-duplicates")
    assert scan_after.status_code == 200
    assert scan_after.json()["duplicate_group_count"] == 0
