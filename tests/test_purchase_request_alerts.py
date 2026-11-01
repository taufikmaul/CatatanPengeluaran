"""
tests/test_purchase_request_alerts.py — Unit test untuk notifikasi Telegram Request Belanja & Konfigurasi Role
"""
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch
import pytest
from httpx import AsyncClient, ASGITransport

from app.config import settings
from app.main import app
from app.models.purchase_request import PurchaseRequest, PurchaseRequestItem
from app.services import purchase_request_alert_service as alert_svc
from app.services.purchase_request_service import (
    create_purchase_request,
    mark_items_as_ordered,
    receive_warehouse_item,
)


@pytest.mark.asyncio
async def test_get_target_chat_and_thread():
    with patch.object(settings, "request_belanja_chat_id", "-100999888"), \
         patch.object(settings, "request_belanja_thread_id", 88):
        chat_id, thread_id = alert_svc.get_target_chat_and_thread()
        assert chat_id == -100999888
        assert thread_id == 88

    # Fallback ke report chat & thread jika request belanja kosong
    with patch.object(settings, "request_belanja_chat_id", None), \
         patch.object(settings, "request_belanja_thread_id", None), \
         patch.object(settings, "report_chat_id", "-100123456"), \
         patch.object(settings, "report_thread_id", 7):
        chat_id, thread_id = alert_svc.get_target_chat_and_thread()
        assert chat_id == -100123456
        assert thread_id == 7


@pytest.mark.asyncio
async def test_notify_new_purchase_request():
    mock_send = AsyncMock(return_value={"ok": True})
    with patch("app.bot.telegram_client.send_message", mock_send), \
         patch.object(settings, "request_belanja_chat_id", "-100123456"), \
         patch.object(settings, "request_belanja_thread_id", 42):

        req = PurchaseRequest(
            id=10,
            request_number="REQ-20261101-010",
            title="Belanja Bahan Cake",
            requester_name="Budi",
            urgency="URGENT",
            notes="Untuk pesanan wedding cake",
            request_date=date(2026, 11, 1),
            items=[
                PurchaseRequestItem(
                    id=1,
                    item_name="Tepung Terigu",
                    qty=Decimal("5"),
                    unit="Sak",
                    estimated_price=Decimal("150000"),
                    supplier_name="Toko Bahan",
                )
            ],
        )

        await alert_svc.notify_new_purchase_request(req)

        assert mock_send.called
        kwargs = mock_send.call_args.kwargs
        assert kwargs["chat_id"] == -100123456
        assert kwargs["thread_id"] == 42
        text = kwargs["text"]
        assert "REQUEST BELANJA BARU" in text
        assert "REQ-20261101-010" in text
        assert "Budi" in text
        assert "URGENT" in text
        assert "Tepung Terigu" in text
        assert "750.000" in text  # 5 * 150.000


@pytest.mark.asyncio
async def test_notify_purchasing_ordered():
    mock_send = AsyncMock(return_value={"ok": True})
    with patch("app.bot.telegram_client.send_message", mock_send), \
         patch.object(settings, "request_belanja_chat_id", "-100123456"), \
         patch.object(settings, "request_belanja_thread_id", 42):

        item = PurchaseRequestItem(
            id=5,
            request_id=10,
            item_name="Mentega Wijsman",
            qty=Decimal("2"),
            unit="Kaleng",
            supplier_name="CV Sumber Pangan",
        )

        await alert_svc.notify_purchasing_ordered([item], supplier_name="CV Sumber Pangan", actor="Dewi Purchasing")

        assert mock_send.called
        kwargs = mock_send.call_args.kwargs
        text = kwargs["text"]
        assert "PESANAN BELANJA TELAH DIBELI / DIORDER" in text
        assert "Dewi Purchasing" in text
        assert "CV Sumber Pangan" in text
        assert "Mentega Wijsman" in text


@pytest.mark.asyncio
async def test_notify_warehouse_received():
    mock_send = AsyncMock(return_value={"ok": True})
    with patch("app.bot.telegram_client.send_message", mock_send), \
         patch.object(settings, "request_belanja_chat_id", "-100123456"), \
         patch.object(settings, "request_belanja_thread_id", 42):

        item = PurchaseRequestItem(
            id=5,
            request_id=10,
            item_name="Mentega Wijsman",
            qty=Decimal("2"),
            qty_received=Decimal("2"),
            unit="Kaleng",
            receiving_status="SESUAI",
            expired_date=date(2027, 5, 20),
            receiving_notes="Kaleng mulus dan segel utuh",
            supplier_name="CV Sumber Pangan",
        )

        await alert_svc.notify_warehouse_received(item, actor="Agus Gudang")

        assert mock_send.called
        kwargs = mock_send.call_args.kwargs
        text = kwargs["text"]
        assert "BARANG DITERIMA DI GUDANG" in text
        assert "Agus Gudang" in text
        assert "Mentega Wijsman" in text
        assert "SESUAI" in text
        assert "20/05/2027" in text
        assert "Kaleng mulus dan segel utuh" in text


@pytest.mark.asyncio
async def test_alert_failure_does_not_raise():
    # Menguji jika Telegram melempar exception, service tidak crash
    mock_send = AsyncMock(side_effect=Exception("Telegram connection timed out"))
    with patch("app.bot.telegram_client.send_message", mock_send), \
         patch.object(settings, "request_belanja_chat_id", "-100123456"):

        req = PurchaseRequest(
            id=1,
            request_number="REQ-1",
            title="Test",
            requester_name="Staff",
            items=[],
        )
        # Should catch and not raise
        await alert_svc.notify_new_purchase_request(req)


@pytest.mark.asyncio
async def test_purchase_request_service_integration_triggers_alerts(db):
    mock_new_req = AsyncMock()
    mock_ordered = AsyncMock()
    mock_received = AsyncMock()

    with patch("app.services.purchase_request_alert_service.notify_new_purchase_request", mock_new_req), \
         patch("app.services.purchase_request_alert_service.notify_purchasing_ordered", mock_ordered), \
         patch("app.services.purchase_request_alert_service.notify_warehouse_received", mock_received):

        # 1. Staf create request
        req = await create_purchase_request(
            db=db,
            title="Test Belanja Alert",
            requester_name="Staf Dapur",
            items=[{"item_name": "Gula Pasir", "qty": 10, "unit": "Kg", "estimated_price": 17000}],
        )
        assert mock_new_req.called

        # 2. Purchasing mark as ordered
        item_id = req.items[0].id
        await mark_items_as_ordered(db, [item_id], actor="Purchasing")
        assert mock_ordered.called

        # 3. Warehouse receive item
        await receive_warehouse_item(
            db,
            item_id=item_id,
            qty_received=10,
            expired_date=date(2027, 1, 1),
            received_by="Gudang",
            receiving_notes="Kondisi bagus",
        )
        assert mock_received.called


@pytest.mark.asyncio
async def test_system_config_role_passwords_and_telegram_topic(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # Test update system config through API
    update_data = {
        "purchasing_password": "new_purchasing_pw",
        "warehouse_password": "new_warehouse_pw",
        "staff_password": "new_staff_pw",
        "request_belanja_thread_id": 99,
        "request_belanja_chat_id": "-100888777",
    }
    res = await client.put("/api/v1/config", json=update_data)
    assert res.status_code == 200
    data = res.json()
    assert data.get("ok") is True

    # Verify settings updated in runtime
    assert settings.purchasing_password == "new_purchasing_pw"
    assert settings.warehouse_password == "new_warehouse_pw"
    assert settings.staff_password == "new_staff_pw"
    assert settings.request_belanja_thread_id == 99
    assert settings.request_belanja_chat_id == "-100888777"

    # Verify get system config
    get_res = await client.get("/api/v1/config")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["purchasing_password"] == "new_purchasing_pw"
    assert get_data["warehouse_password"] == "new_warehouse_pw"
    assert get_data["staff_password"] == "new_staff_pw"
    assert get_data["request_belanja_thread_id"] == 99
    assert get_data["request_belanja_chat_id"] == "-100888777"
