"""
tests/test_telegram_client.py — Unit test untuk telegram client & fallback entity parser
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.bot import telegram_client as tg


@pytest.mark.asyncio
async def test_send_message_normal_success():
    mock_res = MagicMock()
    mock_res.json.return_value = {"ok": True, "result": {"message_id": 101}}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_res
        res = await tg.send_message(12345, "Hello World")
        assert res["ok"] is True
        assert res["result"]["message_id"] == 101
        assert mock_post.call_count == 1
        payload = mock_post.call_args[1]["json"]
        assert payload["parse_mode"] == "Markdown"


@pytest.mark.asyncio
async def test_send_message_markdown_entity_error_fallback():
    # Simulasi pertama gagal karena parse entities, panggilan kedua tanpa parse_mode sukses
    error_res = MagicMock()
    error_res.json.return_value = {
        "ok": False,
        "error_code": 400,
        "description": "Bad Request: can't parse entities: Can't find end of the entity starting with character '_'",
    }
    success_res = MagicMock()
    success_res.json.return_value = {"ok": True, "result": {"message_id": 102}}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = [error_res, success_res]
        res = await tg.send_message(12345, "Toko_Bdg error _test")
        assert res["ok"] is True
        assert res["result"]["message_id"] == 102
        assert mock_post.call_count == 2
        # Cek bahwa call kedua tidak menyertakan parse_mode
        second_payload = mock_post.call_args_list[1][1]["json"]
        assert "parse_mode" not in second_payload


@pytest.mark.asyncio
async def test_edit_message_markdown_entity_error_fallback():
    error_res = MagicMock()
    error_res.json.return_value = {
        "ok": False,
        "error_code": 400,
        "description": "Bad Request: can't parse entities",
    }
    success_res = MagicMock()
    success_res.json.return_value = {"ok": True, "result": {"message_id": 202}}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = [error_res, success_res]
        res = await tg.edit_message(12345, 202, "Toko_Bdg error _test")
        assert res["ok"] is True
        assert res["result"]["message_id"] == 202
        assert mock_post.call_count == 2
        second_payload = mock_post.call_args_list[1][1]["json"]
        assert "parse_mode" not in second_payload


@pytest.mark.asyncio
async def test_edit_message_not_modified_no_fallback():
    not_modified_res = MagicMock()
    not_modified_res.json.return_value = {
        "ok": False,
        "error_code": 400,
        "description": "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = not_modified_res
        res = await tg.edit_message(12345, 202, "Same text")
        assert res["ok"] is False
        assert mock_post.call_count == 1


@pytest.mark.asyncio
async def test_hermes_send_duplicate_warning_escapes_underscores(db):
    from datetime import date
    from decimal import Decimal
    from app.agent.hermes import HermesAgent
    from app.models.expense import Expense
    from app.models.user import User

    user = User(telegram_id=99999, name="User_Tester", is_auth=True)
    db.add(user)
    await db.flush()

    exp = Expense(
        expense_date=date(2026, 10, 25),
        supplier="Boxlab_Bdg",
        item_name="Box_Jendela_Mika",
        qty=Decimal("1"),
        unit="Pcs",
        category="Kemasan",
        unit_price=Decimal("152455"),
        total_price=Decimal("152455"),
        user_id=user.id,
    )
    db.add(exp)
    await db.flush()

    agent = HermesAgent(db, user_id=user.id, chat_id=12345, thread_id=None)

    items = [{
        "barang": "Box_Jendela_Mika",
        "qty": 1,
        "satuan": "Pcs",
        "harga_satuan": 152455,
        "total_harga": 152455,
        "toko_supplier": "Boxlab_Bdg",
    }]
    matches = [{
        "new_item": items[0],
        "existing_expense": exp,
    }]

    with patch("app.bot.telegram_client.edit_message", new_callable=AsyncMock) as mock_edit:
        await agent._send_duplicate_warning(
            msg_id=123,
            items=items,
            msg_link="Private Chat",
            duplicate_matches=matches,
        )

        assert mock_edit.call_count == 1
        args, kwargs = mock_edit.call_args
        sent_text = args[2]
        # Pastikan underscore dalam nama toko dan barang diescape
        assert "Boxlab\\_Bdg" in sent_text
        assert "Box\\_Jendela\\_Mika" in sent_text
        assert "User\\_Tester" in sent_text
        # Cek footer tidak memiliki nested ** di dalam _..._
        assert "**Tetap Simpan**" not in sent_text
        assert "*Tetap Simpan*" in sent_text

