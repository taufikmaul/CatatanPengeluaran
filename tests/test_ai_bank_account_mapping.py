"""
tests/test_ai_bank_account_mapping.py
Pengujian fitur pemetaan rekening tujuan transaksi masuk berbasis AI (preview, fallback, apply, RBAC).
"""
from datetime import date
import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction
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


async def _seed_accounts_and_transactions(db: AsyncSession):
    acc_cash = BankAccount(
        name="Kas Kasir",
        bank_name="Tunai",
        account_type="cash",
        is_active=True,
        sort_order=1,
    )
    acc_bca = BankAccount(
        name="BCA Operasional",
        bank_name="BCA",
        account_type="bank",
        is_default=True,
        is_active=True,
        sort_order=2,
    )
    acc_shopee = BankAccount(
        name="ShopeeFood Saldo",
        bank_name="Shopee",
        account_type="aggregator",
        is_active=True,
        sort_order=3,
    )
    acc_grab = BankAccount(
        name="GrabMerchant Wallet",
        bank_name="Grab",
        account_type="aggregator",
        is_active=True,
        sort_order=4,
    )
    db.add_all([acc_cash, acc_bca, acc_shopee, acc_grab])
    await db.flush()

    txs = [
        IncomingTransaction(
            source_type="pos",
            receipt_no="R-QRIS-1",
            transaction_date=date(2026, 11, 15),
            order_type="Take Away",
            payment_method="QRIS",
            bank_account_id=None,
            gross_sales=38000,
            discount_amount=3800,
            net_sales=34200,
            net_received=34200,
            status="paid",
        ),
        IncomingTransaction(
            source_type="pos",
            receipt_no="R-QRIS-2",
            transaction_date=date(2026, 11, 15),
            order_type="Take Away",
            payment_method="QRIS",
            bank_account_id=None,
            gross_sales=110000,
            net_sales=110000,
            net_received=110000,
            status="paid",
        ),
        IncomingTransaction(
            source_type="pos",
            receipt_no="R-CASH-1",
            transaction_date=date(2026, 11, 15),
            order_type="Take Away",
            payment_method="Cash",
            bank_account_id=None,
            gross_sales=150000,
            net_sales=150000,
            net_received=150000,
            status="paid",
        ),
        IncomingTransaction(
            source_type="pos",
            receipt_no="R-SPF-1",
            transaction_date=date(2026, 11, 15),
            order_type="ShopeeFood",
            payment_method="ShopeeFood",
            bank_account_id=None,
            gross_sales=145000,
            net_sales=145000,
            net_received=145000,
            status="paid",
        ),
        IncomingTransaction(
            source_type="pos",
            receipt_no="R-GRAB-1",
            transaction_date=date(2026, 11, 15),
            order_type="GrabFood Integrasi",
            payment_method="GrabFood Integrasi",
            bank_account_id=None,
            gross_sales=186000,
            platform_fee=109554,
            net_sales=186000,
            net_received=76446,
            status="paid",
        ),
    ]
    db.add_all(txs)
    await db.commit()
    return {
        "cash": acc_cash,
        "bca": acc_bca,
        "shopee": acc_shopee,
        "grab": acc_grab,
    }


@pytest.mark.asyncio
async def test_ai_preview_with_llm_and_apply_flow(client: AsyncClient, db: AsyncSession, admin_cookies):
    accs = await _seed_accounts_and_transactions(db)
    client.cookies.update(admin_cookies)

    # Cek unmapped_count pada endpoint list transaksi masuk
    list_res = await client.get("/api/v1/incoming-transactions")
    assert list_res.status_code == 200
    assert list_res.json()["summary"]["unmapped_count"] == 5

    # Mock respons AI
    mock_llm_map = {
        "Take Away||QRIS": {
            "bank_account_id": accs["bca"].id,
            "confidence": "high",
            "reason": "Pembayaran QRIS Take Away masuk ke BCA Operasional.",
        },
        "Take Away||Cash": {
            "bank_account_id": accs["cash"].id,
            "confidence": "high",
            "reason": "Pembayaran Cash masuk ke Kas Kasir.",
        },
        "ShopeeFood||ShopeeFood": {
            "bank_account_id": accs["shopee"].id,
            "confidence": "high",
            "reason": "Order ShopeeFood masuk ke ShopeeFood Saldo.",
        },
        "GrabFood Integrasi||GrabFood Integrasi": {
            "bank_account_id": accs["grab"].id,
            "confidence": "high",
            "reason": "Order GrabFood Integrasi masuk ke GrabMerchant Wallet.",
        },
    }

    with patch(
        "app.services.incoming_account_ai_service._call_llm_for_account_mapping",
        new=AsyncMock(return_value=(mock_llm_map, "test-model", None)),
    ):
        prev_res = await client.post(
            "/api/v1/incoming-transactions/ai-map-accounts/preview",
            json={"scope": "unmapped"},
        )

    assert prev_res.status_code == 200
    body = prev_res.json()
    assert body["ok"] is True
    assert body["engine"] == "ai"
    assert body["model"] == "test-model"
    assert body["total_groups"] == 4
    assert body["total_transactions"] == 5
    assert body["suggested_groups"] == 4

    by_key = {s["group_key"]: s for s in body["suggestions"]}
    assert by_key["Take Away||QRIS"]["suggested_bank_account_id"] == accs["bca"].id
    assert by_key["Take Away||QRIS"]["tx_count"] == 2
    assert by_key["Take Away||Cash"]["suggested_bank_account_id"] == accs["cash"].id
    assert by_key["ShopeeFood||ShopeeFood"]["suggested_bank_account_id"] == accs["shopee"].id
    assert by_key["GrabFood Integrasi||GrabFood Integrasi"]["suggested_bank_account_id"] == accs["grab"].id

    # Terapkan pemetaan + simpan aturan channel_mappings
    apply_res = await client.post(
        "/api/v1/incoming-transactions/ai-map-accounts/apply",
        json={
            "scope": "unmapped",
            "save_channel_mappings": True,
            "mappings": [
                {
                    "order_type": s["order_type"],
                    "payment_method": s["payment_method"],
                    "bank_account_id": s["suggested_bank_account_id"],
                }
                for s in body["suggestions"]
            ],
        },
    )
    assert apply_res.status_code == 200
    apply_body = apply_res.json()
    assert apply_body["updated_transactions"] == 5
    assert apply_body["applied_groups"] == 4
    assert apply_body["updated_accounts"] == 4

    # Pastikan unmapped_count sekarang 0
    list_after = await client.get("/api/v1/incoming-transactions")
    assert list_after.status_code == 200
    assert list_after.json()["summary"]["unmapped_count"] == 0

    # Pastikan "Take Away" tidak disimpan ke channel_mappings karena terpecah antara Cash dan QRIS
    await db.refresh(accs["cash"])
    await db.refresh(accs["bca"])
    cash_channels = json.loads(accs["cash"].channel_mappings or "[]")
    bca_channels = json.loads(accs["bca"].channel_mappings or "[]")
    assert "Cash" in cash_channels
    assert "Take Away" not in cash_channels
    assert "QRIS" in bca_channels
    assert "Take Away" not in bca_channels


@pytest.mark.asyncio
async def test_ai_preview_rules_fallback_matches_correctly(client: AsyncClient, db: AsyncSession, admin_cookies):
    accs = await _seed_accounts_and_transactions(db)
    client.cookies.update(admin_cookies)

    with patch(
        "app.services.incoming_account_ai_service._call_llm_for_account_mapping",
        new=AsyncMock(return_value=(None, None, "Layanan AI tidak terjangkau")),
    ):
        prev_res = await client.post(
            "/api/v1/incoming-transactions/ai-map-accounts/preview",
            json={"scope": "unmapped"},
        )

    assert prev_res.status_code == 200
    body = prev_res.json()
    assert body["engine"] == "rules_fallback"
    assert body["fallback_reason"] == "Layanan AI tidak terjangkau"

    by_key = {s["group_key"]: s for s in body["suggestions"]}
    assert by_key["Take Away||Cash"]["suggested_bank_account_id"] == accs["cash"].id
    assert by_key["Take Away||QRIS"]["suggested_bank_account_id"] == accs["bca"].id
    assert by_key["ShopeeFood||ShopeeFood"]["suggested_bank_account_id"] == accs["shopee"].id
    assert by_key["GrabFood Integrasi||GrabFood Integrasi"]["suggested_bank_account_id"] == accs["grab"].id


@pytest.mark.asyncio
async def test_apply_rbac_and_validation(client: AsyncClient, db: AsyncSession, admin_input_cookies):
    accs = await _seed_accounts_and_transactions(db)
    client.cookies.update(admin_input_cookies)

    # admin_input tidak boleh mengubah channel_mappings rekening
    forbid_res = await client.post(
        "/api/v1/incoming-transactions/ai-map-accounts/apply",
        json={
            "scope": "unmapped",
            "save_channel_mappings": True,
            "mappings": [
                {
                    "order_type": "Take Away",
                    "payment_method": "Cash",
                    "bank_account_id": accs["cash"].id,
                }
            ],
        },
    )
    assert forbid_res.status_code == 403

    # admin_input boleh menerapkan mapping transaksi jika save_channel_mappings=False
    ok_res = await client.post(
        "/api/v1/incoming-transactions/ai-map-accounts/apply",
        json={
            "scope": "unmapped",
            "save_channel_mappings": False,
            "mappings": [
                {
                    "order_type": "Take Away",
                    "payment_method": "Cash",
                    "bank_account_id": accs["cash"].id,
                }
            ],
        },
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["updated_transactions"] == 1

    # Rekening tidak valid ditolak 400
    bad_res = await client.post(
        "/api/v1/incoming-transactions/ai-map-accounts/apply",
        json={
            "scope": "unmapped",
            "save_channel_mappings": False,
            "mappings": [
                {
                    "order_type": "Take Away",
                    "payment_method": "QRIS",
                    "bank_account_id": 999999,
                }
            ],
        },
    )
    assert bad_res.status_code == 400
