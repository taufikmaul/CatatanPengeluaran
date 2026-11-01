"""
tests/test_purchase_requests.py — Unit test untuk modul Request Belanja (Sprint 1)
"""
import pytest
from datetime import date
from decimal import Decimal
from app.models.purchase_request import PurchaseRequest
from app.models.expense import Expense
from app.models.user import User
from app.services import purchase_request_service
from app.agent.hermes import _parse_purchase_request_text


def test_parse_purchase_request_text():
    # 1. Simple format
    r1 = _parse_purchase_request_text("Tepung Cakra 5 sak urgent buat orderan bolu")
    assert r1["item_name"] == "Tepung Cakra"
    assert r1["qty"] == 5.0
    assert r1["unit"] == "Sak"
    assert r1["urgency"] == "URGENT"
    assert "bolu" in r1["notes"]

    # 2. Bracket notes
    r2 = _parse_purchase_request_text("/request Keju Kraft 3 box [beli di Toko Makmur]")
    assert r2["item_name"] == "Keju Kraft"
    assert r2["qty"] == 3.0
    assert r2["unit"] == "Box"
    assert r2["urgency"] == "NORMAL"
    assert r2["notes"] == "beli di Toko Makmur"

    # 3. Start qty format
    r3 = _parse_purchase_request_text("10 kg Telur Ayam segera")
    assert r3["item_name"] == "Telur Ayam"
    assert r3["qty"] == 10.0
    assert r3["unit"] == "Kg"
    assert r3["urgency"] == "URGENT"


@pytest.mark.asyncio
async def test_purchase_request_crud_and_approval(db):
    # 1. Create request
    user = User(telegram_id=999888, name="Siti Dapur", is_auth=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    req = await purchase_request_service.create_purchase_request(
        db,
        item_name="Mentega Wisman",
        qty=2,
        unit="Kaleng",
        urgency="URGENT",
        notes="Untuk pesanan premium",
        user_id=user.id,
        requester_name="Siti Dapur",
    )
    assert req.id is not None
    assert req.status == "PENDING"
    assert req.urgency == "URGENT"
    assert req.requester_name == "Siti Dapur"

    # 2. Get list & stats
    items, total = await purchase_request_service.get_purchase_requests(db)
    assert total >= 1
    assert any(i.id == req.id for i in items)

    stats = await purchase_request_service.get_purchase_request_stats(db)
    assert stats["pending"] >= 1
    assert stats["urgent_pending"] >= 1

    # 3. Approve request
    admin = User(telegram_id=111222, name="Owner Toko", is_auth=True)
    db.add(admin)
    await db.commit()
    await db.refresh(admin)

    approved = await purchase_request_service.approve_purchase_request(
        db, req.id, reviewer_id=admin.id, reviewer_name="Owner Toko"
    )
    assert approved.status == "APPROVED"
    assert approved.reviewer_name == "Owner Toko"
    assert approved.reviewed_at is not None

    # 4. Auto-match and fulfill when expense is saved
    expense = Expense(
        expense_date=date.today(),
        item_name="Mentega Wisman",
        qty=Decimal("2"),
        unit="Kaleng",
        unit_price=Decimal("250000"),
        total_price=Decimal("500000"),
        pay_status="Lunas",
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)

    matched = await purchase_request_service.auto_match_and_fulfill(db, expense)
    assert len(matched) == 1
    assert matched[0].id == req.id
    assert matched[0].status == "FULFILLED"
    assert matched[0].expense_id == expense.id


@pytest.mark.asyncio
async def test_purchase_request_rejection(db):
    req = await purchase_request_service.create_purchase_request(
        db,
        item_name="Alat Pemotong Tidak Penting",
        qty=1,
        unit="Pcs",
        urgency="NORMAL",
    )
    assert req.status == "PENDING"

    rejected = await purchase_request_service.reject_purchase_request(
        db, req.id, reviewer_name="Admin", reason="Stok masih ada di gudang"
    )
    assert rejected.status == "REJECTED"
    assert rejected.reject_reason == "Stok masih ada di gudang"


@pytest.mark.asyncio
async def test_purchase_request_api_endpoints(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Create via API
    payload = {
        "item_name": "Coklat Bubuk Tulip",
        "qty": 3,
        "unit": "Kg",
        "urgency": "URGENT",
        "notes": "Untuk stok brownies",
        "requester_name": "Koki 1",
    }
    create_res = await client.post("/api/v1/requests", json=payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    assert created_data["item_name"] == "Coklat Bubuk Tulip"
    assert created_data["status"] == "PENDING"
    req_id = created_data["id"]

    # 2. List & Stats
    list_res = await client.get("/api/v1/requests")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total"] >= 1
    assert any(it["id"] == req_id for it in list_data["items"])

    stats_res = await client.get("/api/v1/requests/stats")
    assert stats_res.status_code == 200
    assert stats_res.json()["total"] >= 1

    # 3. Approve via API
    app_res = await client.post(f"/api/v1/requests/{req_id}/approve")
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "APPROVED"

    # 4. Fulfill via API
    ful_res = await client.post(f"/api/v1/requests/{req_id}/fulfill")
    assert ful_res.status_code == 200
    assert ful_res.json()["status"] == "FULFILLED"

