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


@pytest.mark.asyncio
async def test_multi_item_request_purchasing_and_warehouse_flow(db):
    # 1. Staf Dapur membuat request multi-item
    multi_items = [
        {"item_name": "Tepung Cakra", "qty": 5, "unit": "Sak", "notes": "Untuk roti"},
        {"item_name": "Ragi Instant", "qty": 2, "unit": "Box", "notes": "Habis"},
        {"item_name": "Mentega Anchor", "qty": 10, "unit": "Pcs", "notes": "Urgent"},
    ]
    req = await purchase_request_service.create_purchase_request(
        db,
        title="Kebutuhan Mingguan Dapur",
        urgency="URGENT",
        requester_name="Karyawan Dapur",
        items=multi_items,
    )
    assert req.id is not None
    assert len(req.items) == 3
    assert req.request_number.startswith("REQ-")

    # 2. Admin menyetujui request
    approved = await purchase_request_service.approve_purchase_request(db, req.id, reviewer_name="Owner")
    assert approved.status == "APPROVED"

    # 3. Purchasing mapping supplier
    item1 = req.items[0]
    item2 = req.items[1]
    item3 = req.items[2]

    await purchase_request_service.update_item_supplier(
        db, item1.id, supplier_name="Toko Makmur", estimated_price=120000
    )
    await purchase_request_service.update_item_supplier(
        db, item2.id, supplier_name="Toko Makmur", estimated_price=35000
    )
    await purchase_request_service.update_item_supplier(
        db, item3.id, supplier_name="CV Sumber Pangan", estimated_price=45000
    )

    # 4. Purchasing cek pengelompokan per supplier
    grouped = await purchase_request_service.get_purchasing_grouped_orders(db)
    sup_names = [g["supplier_name"] for g in grouped]
    assert "Toko Makmur" in sup_names
    assert "CV Sumber Pangan" in sup_names

    # 5. Purchasing generate format WA Toko Makmur
    wa_text = purchase_request_service.generate_whatsapp_order_text(
        supplier_name="Toko Makmur",
        items=[item1, item2],
        custom_notes="Kirim sebelum jam 13.00",
    )
    assert "Toko Makmur" in wa_text
    assert "Tepung Cakra" in wa_text
    assert "5 Sak" in wa_text
    assert "Kirim sebelum jam 13.00" in wa_text

    # 6. Purchasing menandai sudah dipesan (ORDERED)
    ordered_items = await purchase_request_service.mark_items_as_ordered(
        db, [item1.id, item2.id, item3.id]
    )
    assert len(ordered_items) == 3
    assert all(it.order_status == "ORDERED" for it in ordered_items)

    # 7. Gudang memeriksa barang datang:
    # Item 1: Datang 5 Sak (SESUAI) + Exp date
    received1 = await purchase_request_service.receive_warehouse_item(
        db,
        item_id=item1.id,
        qty_received=5,
        expired_date=date(2027, 5, 20),
        received_by="Budi Gudang",
        receiving_notes="Kondisi karung utuh dan bersih",
    )
    assert received1.receiving_status == "SESUAI"
    assert received1.expired_date == date(2027, 5, 20)

    # Item 2: Datang 1 Box (KURANG, harusnya 2)
    received2 = await purchase_request_service.receive_warehouse_item(
        db,
        item_id=item2.id,
        qty_received=1,
        expired_date=date(2026, 12, 10),
        received_by="Budi Gudang",
        receiving_notes="Supplier kehabisan 1 box, akan disusulkan",
    )
    assert received2.receiving_status == "KURANG"

    # Item 3: Datang 11 Pcs (LEBIH, pesan 10 dapat bonus 1)
    received3 = await purchase_request_service.receive_warehouse_item(
        db,
        item_id=item3.id,
        qty_received=11,
        expired_date=date(2026, 8, 15),
        received_by="Budi Gudang",
        receiving_notes="Dapat bonus 1 pcs dari promo toko",
    )
    assert received3.receiving_status == "LEBIH"

    # Seluruh item sudah diperiksa gudang -> Header status = RECEIVED
    updated_req = await purchase_request_service.get_purchase_request_by_id(db, req.id)
    assert updated_req.status == "RECEIVED"


