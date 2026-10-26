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
        assert item["metode_bayar"] == "Transfer"
        assert item["status_pembayaran"] == "Lunas"


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
        res = await _execute_fetch([{"role": "user", "content": "screenshot gosend"}])

        item = res["items"][0]
        assert item["kategori"] == "Operasional"
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
    assert report["total_lunas"] == 220000
    assert report["total_tukar_cash"] == 100000
    assert report["tukar_cash_count"] == 1
    assert report["total_belanja_riil"] == 120000


@pytest.mark.asyncio
async def test_special_type_filters_tukar_cash_and_ongkir(db):
    from app.services.expense_service import get_all_expenses_paginated

    e1 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="BCA",
        item_name="Tukar Cash Karyawan",
        qty=Decimal("1"),
        unit="Trans",
        category="Tukar Cash",
        unit_price=Decimal("50000"),
        total_price=Decimal("50000"),
        pay_status="Lunas",
    )
    e2 = Expense(
        expense_date=date(2026, 10, 26),
        supplier="GoSend",
        item_name="Ongkir GoSend Instant - Bu Rita",
        qty=Decimal("1"),
        unit="Trip",
        category="Operasional",
        unit_price=Decimal("25000"),
        total_price=Decimal("25000"),
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
        pay_status="Lunas",
    )
    db.add_all([e1, e2, e3])
    await db.flush()

    # Filter tukar cash
    items, total = await get_all_expenses_paginated(db, special_type="tukar_cash", month=10, year=2026)
    assert total >= 1
    assert all("tukar cash" in i.category.lower() or "tukar cash" in i.item_name.lower() for i in items)

    # Filter ongkir
    items, total = await get_all_expenses_paginated(db, special_type="ongkir", month=10, year=2026)
    assert total >= 1
    assert any("ongkir" in i.item_name.lower() or i.supplier.lower() == "gosend" for i in items)

    # Filter combined cash_or_delivery
    items, total = await get_all_expenses_paginated(db, special_type="cash_or_delivery", month=10, year=2026)
    assert total >= 2

