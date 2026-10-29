"""
tests/test_multi_topic_and_transfer.py — Unit test untuk multi-topic Telegram, auto-detect bukti transfer bank & ongkir
"""
import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from app.config import Settings
from app.services.ai_service import _execute_fetch
from app.services.expense_service import get_monthly_report
from app.models.expense import Expense


def test_settings_multi_thread_ids_parsing():
    s = Settings(
        telegram_token="token",
        database_url="sqlite+aiosqlite:///:memory:",
        sumopod_api_key="key",
        allowed_thread_id=7,
        allowed_thread_ids="8, 9, 10",
        tukar_cash_thread_ids="12",
        ongkir_thread_ids="15",
    )
    allowed = s.get_allowed_thread_ids()
    assert 7 in allowed
    assert 8 in allowed
    assert 9 in allowed
    assert 10 in allowed
    assert 12 in allowed
    assert 15 in allowed

    assert s.is_thread_allowed(7) is True
    assert s.is_thread_allowed(12) is True
    assert s.is_thread_allowed(15) is True
    assert s.is_thread_allowed(999) is False
    assert s.is_thread_allowed(None) is True  # pesan direct/main chat

    assert s.get_thread_topic_type(12) == "tukar_cash"
    assert s.get_thread_topic_type(15) == "ongkir"
    assert s.get_thread_topic_type(7) is None


@pytest.mark.asyncio
async def test_auto_detect_bank_transfer_to_tukar_cash():
    # Simulasi AI mengembalikan bukti transfer m-BCA
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "Transfer m-BCA",
                            "qty": 1,
                            "satuan": "Pcs",
                            "harga_satuan": 100000,
                            "total_harga": 100000,
                            "toko_supplier": "BCA Mobile",
                            "metode_bayar": "Transfer",
                            "status_pembayaran": "Lunas",
                            "keterangan": "Tarik tunai Budi"
                        }
                    ]
                }"""
            }
        }]
    }

    mock_res = MagicMock()
    mock_res.json.return_value = raw_llm_response

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_res
        res = await _execute_fetch([{"role": "user", "content": "screenshot transfer bca"}])

        item = res["items"][0]
        assert item["kategori"] == "Tukar Cash"
        assert item["satuan"] == "Trans"
        assert item["total_harga"] == 100000
        assert item["metode_bayar"] == "Tunai"
        assert item["status_pembayaran"] == "Lunas"
        assert item["toko_supplier"] == "-"
        assert "BCA Mobile" in item["keterangan"] or "Transfer" in item["keterangan"]


@pytest.mark.asyncio
async def test_auto_detect_gosend_ongkir_with_reimbursement():
    # Simulasi AI membaca bukti GoSend bayar pakai GoPay
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "GoSend Instant - Cake Ibu Maya",
                            "qty": 1,
                            "satuan": "Pcs",
                            "harga_satuan": 28000,
                            "total_harga": 28000,
                            "toko_supplier": "GoSend",
                            "metode_bayar": "GoPay",
                            "status_pembayaran": "Lunas",
                            "keterangan": "ditalangi e-wallet kasir"
                        }
                    ]
                }"""
            }
        }]
    }

    mock_res = MagicMock()
    mock_res.json.return_value = raw_llm_response

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_res
        res = await _execute_fetch([{"role": "user", "content": "screenshot gosend"}])

        item = res["items"][0]
        assert item["kategori"] == "Ongkir"
        assert "Ongkir" in item["barang"]
        assert item["satuan"] == "Trip"
        assert item["is_reimbursement"] is True
        assert "ditalangi e-wallet" in item["keterangan"]


@pytest.mark.asyncio
async def test_monthly_report_separates_tukar_cash(db):
    # Buat 1 belanja normal dan 1 transaksi tukar cash
    e1 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="Toko Wahab",
        item_name="Tepung Terigu",
        qty=Decimal("10"),
        unit="Kg",
        category="Bahan Kue",
        unit_price=Decimal("12000"),
        total_price=Decimal("120000"),
        pay_status="Lunas",
    )
    e2 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="BCA",
        item_name="Tukar Cash - Budi",
        qty=Decimal("1"),
        unit="Trans",
        category="Tukar Cash",
        unit_price=Decimal("100000"),
        total_price=Decimal("100000"),
        pay_status="Lunas",
    )
    db.add_all([e1, e2])
    await db.flush()

    report = await get_monthly_report(db, 2026, 10)
    # total_lunas dan total_belanja_riil toko mengecualikan tukar cash (murni belanja 120.000)
    assert report["total_lunas"] == 120000
    assert report["total_tukar_cash"] == 100000
    assert report["tukar_cash_count"] == 1
    assert report["total_belanja_riil"] == 120000


@pytest.mark.asyncio
async def test_special_type_filters_tukar_cash_and_ongkir(db):
    from app.services.expense_service import get_all_expenses_paginated

    e1 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="-",
        item_name="Tukar Cash Karyawan",
        qty=Decimal("1"),
        unit="Trans",
        category="Tukar Cash",
        unit_price=Decimal("50000"),
        total_price=Decimal("50000"),
        pay_method="Tunai",
        pay_status="Lunas",
    )
    e2 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="GoSend Car",
        item_name="Ongkir GoSend Instant - Bu Rita",
        qty=Decimal("1"),
        unit="Trip",
        category="Ongkir",
        unit_price=Decimal("25000"),
        total_price=Decimal("25000"),
        pay_method="Gopay - Kasir",
        pay_status="Lunas",
        is_reimbursement=True,
    )
    e3 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="Toko Titan",
        item_name="Butter Anchor",
        qty=Decimal("2"),
        unit="Kg",
        category="Bahan Kue",
        unit_price=Decimal("150000"),
        total_price=Decimal("300000"),
        pay_method="Tunai",
        pay_status="Lunas",
    )
    db.add_all([e1, e2, e3])
    await db.flush()

    # 1. Default view (special_type=None): WAJIB EXCLUDE Ongkir dan Tukar Cash!
    items, total = await get_all_expenses_paginated(db, special_type=None, month=10, year=2026)
    assert total == 1
    assert items[0].item_name == "Butter Anchor"

    # 2. Filter tukar cash
    items, total = await get_all_expenses_paginated(db, special_type="tukar_cash", month=10, year=2026)
    assert total >= 1
    assert all("tukar cash" in i.category.lower() or "tukar cash" in i.item_name.lower() for i in items)

    # 3. Filter ongkir
    items, total = await get_all_expenses_paginated(db, special_type="ongkir", month=10, year=2026)
    assert total >= 1
    assert any("ongkir" in i.item_name.lower() or "gosend" in i.supplier.lower() for i in items)

    # 4. Filter combined cash_or_delivery
    items, total = await get_all_expenses_paginated(db, special_type="cash_or_delivery", month=10, year=2026)
    assert total >= 2


@pytest.mark.asyncio
async def test_master_item_excludes_ongkir_and_tukar_cash(db):
    from app.services.master_item_service import (
        match_and_normalize_extracted_items,
        import_master_items_from_history,
        list_master_items,
    )

    items = [
        {"barang": "ongkir delivery cake", "kategori": "Ongkir", "toko_supplier": "GoSend Car"},
        {"barang": "Tukar Cash - Budi", "kategori": "Tukar Cash", "toko_supplier": "-"},
    ]
    # Pastikan tidak dicocokkan ke MasterItem
    res = await match_and_normalize_extracted_items(db, items)
    assert res[0].get("master_item_id") is None
    assert res[1].get("master_item_id") is None

    # Pastikan import dari history juga mengabaikan Ongkir & Tukar Cash
    import_res = await import_master_items_from_history(db)
    master_list = await list_master_items(db)
    master_names = [m.item_name.lower() for m in master_list]
    assert not any("ongkir" in name for name in master_names)
    assert not any("tukar cash" in name for name in master_names)


@pytest.mark.asyncio
async def test_hermes_guidance_on_empty_ongkir_and_tukar_cash(db):
    from app.agent.hermes import HermesAgent
    from app.bot import telegram_client as tg

    agent = HermesAgent(db=db, chat_id=123, user_id=456, thread_id=7)

    with patch.object(tg, "send_message", new_callable=AsyncMock) as mock_send:
        # 1. /ongkir tanpa parameter
        await agent.process(text="/ongkir")
        mock_send.assert_called_once()
        sent_text = mock_send.call_args[0][1]
        assert "FORMAT LAPORAN ONGKIR" in sent_text
        assert "GoSend Car" in sent_text

    with patch.object(tg, "send_message", new_callable=AsyncMock) as mock_send:
        # 2. /tukercash tanpa parameter
        await agent.process(text="/tukercash")
        mock_send.assert_called_once()
        sent_text = mock_send.call_args[0][1]
        assert "FORMAT LAPORAN TUKAR CASH" in sent_text
        assert "Transfer BCA" in sent_text


@pytest.mark.asyncio
async def test_multi_item_in_single_chat_ongkir_and_tukar_cash():
    # 1. Multi item Ongkir dalam 1 chat
    raw_ongkir = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {"barang": "GoSend Car", "total_harga": 25000, "toko_supplier": "GoSend Car", "metode_bayar": "Gopay - Kasir", "keterangan": "Bolu Bu Maya"},
                        {"barang": "GrabExpress", "total_harga": 15000, "toko_supplier": "GrabExpress", "metode_bayar": "Tunai", "keterangan": "Roti Pak Doni"}
                    ]
                }"""
            }
        }]
    }
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = raw_ongkir
        mock_post.return_value = mock_resp

        messages = [{"role": "user", "content": "/ongkir 1. GoSend 25rb 2. Grab 15rb"}]
        res = await _execute_fetch(messages)
        items = res["items"]
        assert len(items) == 2
        assert items[0]["kategori"] == "Ongkir"
        assert items[0]["toko_supplier"] == "GoSend Car"
        assert items[0]["total_harga"] == 25000
        assert items[1]["kategori"] == "Ongkir"
        assert items[1]["toko_supplier"] == "GrabExpress"
        assert items[1]["total_harga"] == 15000

    # 2. Multi item Tukar Cash dalam 1 chat
    raw_tukar = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {"barang": "Tukar Cash - Budi", "total_harga": 100000, "toko_supplier": "BCA", "metode_bayar": "Transfer", "keterangan": "Tarik tunai kasir"},
                        {"barang": "Tukar Cash - Siti", "total_harga": 50000, "toko_supplier": "Mandiri", "metode_bayar": "Transfer", "keterangan": "Tarik tunai kasir"}
                    ]
                }"""
            }
        }]
    }
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = raw_tukar
        mock_post.return_value = mock_resp

        messages = [{"role": "user", "content": "/tukercash 1. Budi 100rb 2. Siti 50rb"}]
        res = await _execute_fetch(messages)
        items = res["items"]
        assert len(items) == 2
        assert items[0]["kategori"] == "Tukar Cash"
        assert items[0]["metode_bayar"] == "Tunai"
        assert items[0]["toko_supplier"] == "-"
        assert "BCA" in items[0]["keterangan"]

        assert items[1]["kategori"] == "Tukar Cash"
        assert items[1]["metode_bayar"] == "Tunai"
        assert items[1]["toko_supplier"] == "-"
        assert "Mandiri" in items[1]["keterangan"]


@pytest.mark.asyncio
async def test_ongkir_and_tukar_cash_save_success_keyboard_actions(db):
    from app.agent.hermes import HermesAgent
    from app.services.expense_service import save_expenses
    from app.bot import telegram_client as tg

    sent_messages = []
    edited_messages = []

    async def fake_send_message(chat_id, text, thread_id=None, reply_markup=None):
        sent_messages.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return {"result": {"message_id": 999}}

    async def fake_edit_message(chat_id, message_id, text, reply_markup=None):
        edited_messages.append({"chat_id": chat_id, "message_id": message_id, "text": text, "reply_markup": reply_markup})
        return {"ok": True}

    with patch.object(tg, "send_message", side_effect=fake_send_message), \
         patch.object(tg, "edit_message", side_effect=fake_edit_message):

        agent = HermesAgent(db, 1, 12345, 15)

        # 1. Test Ongkir save success
        ongkir_items = [{
            "barang": "Ongkir GoSend Cake Bu Maya",
            "kategori": "Ongkir",
            "qty": 1,
            "satuan": "Trip",
            "harga_satuan": 30000,
            "total_harga": 30000,
        }]
        saved_ongkir = await save_expenses(db, ongkir_items, user_id=1)
        await agent._send_save_success(msg_id=101, items=ongkir_items, saved_expenses=saved_ongkir)

        assert len(edited_messages) == 1
        kb_ongkir = edited_messages[-1]["reply_markup"]
        all_buttons = [btn["text"] for row in kb_ongkir["inline_keyboard"] for btn in row]
        assert "🗑️ Batal Simpan" in all_buttons
        assert "⏳ Set Belum Lunas" not in all_buttons
        assert "✅ Tandai Lunas" not in all_buttons
        assert "💼 Tandai Reimburse" not in all_buttons
        assert "💼 Reimburse: YA (Ubah)" not in all_buttons
        assert "🌐 Lihat Dashboard" not in all_buttons

        # 2. Test Tukar Cash save success
        tukar_items = [{
            "barang": "Tukar Cash - Karyawan",
            "kategori": "Tukar Cash",
            "qty": 1,
            "satuan": "Trans",
            "harga_satuan": 100000,
            "total_harga": 100000,
        }]
        saved_tukar = await save_expenses(db, tukar_items, user_id=1)
        await agent._send_save_success(msg_id=102, items=tukar_items, saved_expenses=saved_tukar)

        assert len(edited_messages) == 2
        kb_tukar = edited_messages[-1]["reply_markup"]
        all_buttons_tukar = [btn["text"] for row in kb_tukar["inline_keyboard"] for btn in row]
        assert "🗑️ Batal Simpan" in all_buttons_tukar
        assert "⏳ Set Belum Lunas" not in all_buttons_tukar
        assert "✅ Tandai Lunas" not in all_buttons_tukar
        assert "💼 Tandai Reimburse" not in all_buttons_tukar
        assert "💼 Reimburse: YA (Ubah)" not in all_buttons_tukar
        assert "🌐 Lihat Dashboard" not in all_buttons_tukar


@pytest.mark.asyncio
async def test_undo_save_ongkir_removes_dashboard_button(db):
    from app.services.expense_service import save_expenses, get_expense_by_id
    from app.bot.callbacks import handle_callback_query
    from app.bot import telegram_client as tg

    edited_messages = []

    async def fake_edit_message(chat_id, message_id, text, reply_markup=None):
        edited_messages.append({"chat_id": chat_id, "message_id": message_id, "text": text, "reply_markup": reply_markup})
        return {"ok": True}

    with patch.object(tg, "edit_message", side_effect=fake_edit_message), \
         patch.object(tg, "answer_callback_query", return_value=None):

        ongkir_items = [{
            "barang": "Ongkir Lalamove",
            "kategori": "Ongkir",
            "qty": 1,
            "satuan": "Trip",
            "harga_satuan": 45000,
            "total_harga": 45000,
        }]
        saved = await save_expenses(db, ongkir_items, user_id=1)
        exp_id = saved[0].id

        cb_undo = {
            "id": "cb-undo-ongkir",
            "from": {"id": 111},
            "message": {"message_id": 201, "chat": {"id": 12345}},
            "data": f"undo_save:{exp_id}",
        }
        await handle_callback_query(cb_undo, db)

        assert await get_expense_by_id(db, exp_id) is None
        assert len(edited_messages) == 1
        markup = edited_messages[-1]["reply_markup"]
        # Empty inline keyboard to remove buttons, NO "Lihat Dashboard"
        assert markup == {"inline_keyboard": []}




