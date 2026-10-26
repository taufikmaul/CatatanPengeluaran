"""
tests/test_cod_flow.py — Unit test untuk alur pembayaran COD (Skenario 1)
"""
import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from app.agent.hermes import HermesAgent
from app.models.expense import Expense
from app.models.user import User
from app.services.ai_service import _execute_fetch


@pytest.mark.asyncio
async def test_cod_normalization_sets_belum_lunas_and_notes():
    # Simulasi raw response dari LLM yang mengekstrak COD tetapi default ke Lunas
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "Box Jendela Mika",
                            "qty": 1,
                            "satuan": "Pcs",
                            "harga_satuan": 152455,
                            "total_harga": 152455,
                            "toko_supplier": "Boxlab_Bdg",
                            "metode_bayar": "COD (Bayar di Tempat)",
                            "status_pembayaran": "Lunas",
                            "keterangan": "-"
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
        res = await _execute_fetch([{"role": "user", "content": "test COD"}])

        assert "items" in res
        item = res["items"][0]
        assert item["metode_bayar"] == "COD"
        assert item["status_pembayaran"] == "Belum Lunas"
        assert item["keterangan"] == "COD - Bayar di Kasir"


@pytest.mark.asyncio
async def test_cod_normalization_preserves_lunas_when_explicitly_paid():
    raw_llm_response = {
        "choices": [{
            "message": {
                "content": """{
                    "items": [
                        {
                            "barang": "Box Jendela Mika",
                            "qty": 1,
                            "satuan": "Pcs",
                            "harga_satuan": 152455,
                            "total_harga": 152455,
                            "toko_supplier": "Boxlab_Bdg",
                            "metode_bayar": "COD",
                            "status_pembayaran": "Lunas",
                            "keterangan": "Sudah dibayar kasir tunai"
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
        res = await _execute_fetch([{"role": "user", "content": "test COD lunas"}])

        item = res["items"][0]
        assert item["metode_bayar"] == "COD"
        assert item["status_pembayaran"] == "Lunas"
        assert "Sudah dibayar kasir" in item["keterangan"]


@pytest.mark.asyncio
async def test_send_save_success_cod_label_and_mark_paid_button(db):
    user = User(telegram_id=88888, name="Staff Kasir", is_auth=True)
    db.add(user)
    await db.flush()

    exp = Expense(
        expense_date=date(2026, 10, 26),
        supplier="Boxlab_Bdg",
        item_name="Box Jendela Mika",
        qty=Decimal("1"),
        unit="Pcs",
        category="Kemasan",
        unit_price=Decimal("152455"),
        total_price=Decimal("152455"),
        pay_method="COD",
        pay_status="Belum Lunas",
        notes="COD - Bayar di Kasir",
        user_id=user.id,
    )
    db.add(exp)
    await db.flush()

    agent = HermesAgent(db, user_id=user.id, chat_id=12345, thread_id=None)

    items = [{
        "barang": "Box Jendela Mika",
        "qty": 1,
        "satuan": "Pcs",
        "harga_satuan": 152455,
        "total_harga": 152455,
        "toko_supplier": "Boxlab_Bdg",
        "metode_bayar": "COD",
        "status_pembayaran": "Belum Lunas",
    }]

    with patch("app.bot.telegram_client.send_message", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = {"ok": True, "result": {"message_id": 999}}
        await agent._send_save_success(
            msg_id=None,
            items=items,
            saved_expenses=[exp],
        )

        assert mock_send.call_count == 1
        args, kwargs = mock_send.call_args
        sent_text = args[1]
        keyboard = args[3] if len(args) > 3 else kwargs.get("reply_markup")

        # Cek status bayar memuat keterangan COD kasir
        assert "Belum Lunas (COD - Bayar di Kasir)" in sent_text

        # Cek tombol aksi memuat "✅ Tandai Lunas"
        flattened_buttons = [btn["text"] for row in keyboard["inline_keyboard"] for btn in row]
        assert "✅ Tandai Lunas" in flattened_buttons
