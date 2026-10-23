"""
tests/test_api_v1.py — Test REST API v1 Endpoints
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database.connection import get_db
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
def auth_cookies():
    token = create_session_token()
    return {SESSION_COOKIE_NAME: token}


@pytest.mark.asyncio
async def test_api_auth_status_unauthenticated(client):
    res = await client.get("/api/v1/auth/status")
    assert res.status_code == 200
    data = res.json()
    assert data["authenticated"] is False


@pytest.mark.asyncio
async def test_api_auth_status_authenticated(client, auth_cookies):
    client.cookies.update(auth_cookies)
    res = await client.get("/api/v1/auth/status")
    assert res.status_code == 200
    data = res.json()
    assert data["authenticated"] is True
    assert data["user"] == "Admin"


@pytest.mark.asyncio
async def test_api_expenses_requires_auth(client):
    res = await client.get("/api/v1/expenses")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_api_expenses_crud(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Create expense
    payload = {
        "expense_date": "2026-10-22",
        "supplier": "Toko Bahan Kue Sejahtera",
        "item_name": "Butter Anchor 1kg",
        "qty": 5,
        "category": "Bahan Baku",
        "unit_price": 145000,
        "tax": 0,
        "discount": 0,
        "total_price": 725000,
        "pay_method": "Transfer",
        "pay_status": "Lunas",
        "notes": "Persediaan weekend",
        "is_reimbursement": True,
        "invoice_number": "INV-2026-089",
    }
    create_res = await client.post("/api/v1/expenses", json=payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    assert created_data["item_name"] == "Butter Anchor 1kg"
    assert created_data["is_reimbursement"] is True
    assert created_data["invoice_number"] == "INV-2026-089"
    expense_id = created_data["id"]

    # 2. Get list (including filter by is_reimbursement)
    list_res = await client.get("/api/v1/expenses?is_reimbursement=true")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["ok"] is True
    assert any(e["id"] == expense_id for e in list_data["data"])

    # 3. Update expense (e.g. toggle status & toggle reimbursement)
    update_res = await client.put(
        f"/api/v1/expenses/{expense_id}",
        json={"pay_status": "Belum Lunas", "is_reimbursement": False, "invoice_number": "INV-EDITED"},
    )
    assert update_res.status_code == 200
    assert update_res.json()["pay_status"] == "Belum Lunas"
    assert update_res.json()["is_reimbursement"] is False
    assert update_res.json()["invoice_number"] == "INV-EDITED"

    # 4. Monthly report check
    report_res = await client.get("/api/v1/reports/monthly?month=10&year=2026")
    assert report_res.status_code == 200
    report_data = report_res.json()
    assert report_data["ok"] is True
    assert "daily_chart" in report_data
    assert "top_frequent_items" in report_data
    assert "top_expensive_items" in report_data
    assert "top_price_spikes" in report_data
    assert "top_suppliers" in report_data
    assert "summary_metrics" in report_data
    assert len(report_data["top_frequent_items"]) >= 1
    assert report_data["top_frequent_items"][0]["item_name"] == "Butter Anchor 1kg"

    # 4b. Dedicated leaderboard endpoint check
    lb_res = await client.get("/api/v1/reports/leaderboard?month=10&year=2026")
    assert lb_res.status_code == 200
    lb_data = lb_res.json()
    assert lb_data["ok"] is True
    assert "top_frequent_items" in lb_data
    assert "top_expensive_items" in lb_data

    # 5. Delete expense
    del_res = await client.delete(f"/api/v1/expenses/{expense_id}")
    assert del_res.status_code == 200
    assert del_res.json()["ok"] is True


@pytest.mark.asyncio
async def test_react_app_route(client):
    res = await client.get("/app")
    assert res.status_code == 200
    assert "Catatan Pengeluaran" in res.text


@pytest.mark.asyncio
async def test_api_config_endpoints(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Get config
    get_res = await client.get("/api/v1/config")
    assert get_res.status_code == 200
    cfg = get_res.json()
    assert cfg["ok"] is True
    assert "telegram_token_masked" in cfg

    # 2. Update config
    payload = {
        "sumopod_model": "seed-2-0-mini",
        "spreadsheet_id": "test_sheet_12345",
        "dashboard_pin_chat_id": "999888777",
    }
    put_res = await client.put("/api/v1/config", json=payload)
    assert put_res.status_code == 200
    assert put_res.json()["ok"] is True

    # 3. Verify get config reflects update
    get_res2 = await client.get("/api/v1/config")
    assert get_res2.json()["spreadsheet_id"] == "test_sheet_12345"
    assert get_res2.json()["dashboard_pin_chat_id"] == "999888777"


@pytest.mark.asyncio
async def test_master_items_and_auto_matching(client, auth_cookies, db):
    client.cookies.update(auth_cookies)

    # 1. Bulk import master items
    bulk_payload = {
        "raw_text": (
            "Tepung Terigu Cakra | Bahan Kue | cakra kembar, terigu cakra\n"
            "Box Kue 20x20 | Kemasan | dus kue 20x20, kotak 20x20"
        ),
        "default_category": "Bahan Kue",
    }
    bulk_res = await client.post("/api/v1/master-items/bulk", json=bulk_payload)
    assert bulk_res.status_code == 200
    assert bulk_res.json()["added"] == 2

    # 2. Create expense with variant name ("Terigu Cakra Kembar 1kg")
    exp_payload = {
        "expense_date": "2026-10-23",
        "supplier": "Toko Berkah",
        "item_name": "Terigu Cakra Kembar 1kg",
        "qty": 2,
        "category": "Operasional",
        "unit_price": 14000,
        "total_price": 28000,
        "pay_method": "Tunai",
        "pay_status": "Lunas",
        "notes": "-",
    }
    create_res = await client.post("/api/v1/expenses", json=exp_payload)
    assert create_res.status_code == 201
    created = create_res.json()

    # Harus otomatis disamakan ke nama baku & nama asli dicatat di notes
    assert created["item_name"] == "Tepung Terigu Cakra"
    assert created["category"] == "Bahan Kue"
    assert "Struk: Terigu Cakra Kembar 1kg" in created["notes"]

    # 3. Cek endpoint suggestions
    sug_res = await client.get("/api/v1/master-items/suggestions")
    assert sug_res.status_code == 200
    sug_data = sug_res.json()
    assert sug_data["ok"] is True
    cakra_sug = next(i for i in sug_data["items"] if i["item_name"] == "Tepung Terigu Cakra")
    assert cakra_sug["is_master"] is True
    assert cakra_sug["last_unit_price"] == 14000.0


@pytest.mark.asyncio
async def test_telegram_quick_action_callbacks(db, monkeypatch):
    from app.bot.callbacks import handle_callback_query
    from app.services.expense_service import save_expenses, get_expense_by_id
    from app.bot import telegram_client as tg

    edited_messages = []

    async def fake_answer_cb(cb_id):
        return None

    async def fake_edit_msg(chat_id, msg_id, text, reply_markup=None, parse_mode="Markdown"):
        edited_messages.append({"text": text, "reply_markup": reply_markup})

    monkeypatch.setattr(tg, "answer_callback_query", fake_answer_cb)
    monkeypatch.setattr(tg, "edit_message", fake_edit_msg)

    saved = await save_expenses(
        db,
        [{"tanggal": "2026-10-23", "barang": "Gula Pasir", "qty": 1, "harga_satuan": 17500, "total_harga": 17500}],
    )
    await db.commit()
    exp_id = saved[0].id

    # 1. Klik Set Belum Lunas
    cb_unpaid = {
        "id": "cb-unpaid",
        "from": {"id": 111},
        "message": {"message_id": 50, "chat": {"id": 999}},
        "data": f"unpaid_save:{exp_id}",
    }
    await handle_callback_query(cb_unpaid, db)
    exp = await get_expense_by_id(db, exp_id)
    assert exp.pay_status == "Belum Lunas"
    assert "Gula Pasir" in edited_messages[-1]["text"]
    assert "Belum Lunas" in edited_messages[-1]["text"]
    assert "Rp 17.500" in edited_messages[-1]["text"]

    # 2. Klik Tandai Lunas
    cb_paid = {
        "id": "cb-paid",
        "from": {"id": 111},
        "message": {"message_id": 50, "chat": {"id": 999}},
        "data": f"mark_paid:{exp_id}",
    }
    await handle_callback_query(cb_paid, db)
    exp = await get_expense_by_id(db, exp_id)
    assert exp.pay_status == "Lunas"
    assert "Gula Pasir" in edited_messages[-1]["text"]
    assert "Lunas" in edited_messages[-1]["text"]

    # 3. Klik Toggle Reimbursement (dari False -> True)
    cb_reimb = {
        "id": "cb-reimb",
        "from": {"id": 111},
        "message": {"message_id": 50, "chat": {"id": 999}},
        "data": f"toggle_reimb:{exp_id}",
    }
    await handle_callback_query(cb_reimb, db)
    exp = await get_expense_by_id(db, exp_id)
    assert exp.is_reimbursement is True
    assert "Gula Pasir" in edited_messages[-1]["text"]
    assert "REIMBURSEMENT" in edited_messages[-1]["text"]

    # 3b. Klik Toggle Reimbursement lagi (dari True -> False)
    await handle_callback_query(cb_reimb, db)
    exp = await get_expense_by_id(db, exp_id)
    assert exp.is_reimbursement is False
    assert "Gula Pasir" in edited_messages[-1]["text"]

    # 4. Klik Batal Simpan (Undo) - item names MUST be preserved in text for searchability
    cb_undo = {
        "id": "cb-undo",
        "from": {"id": 111},
        "message": {"message_id": 50, "chat": {"id": 999}},
        "data": f"undo_save:{exp_id}",
    }
    await handle_callback_query(cb_undo, db)
    assert await get_expense_by_id(db, exp_id) is None
    assert "Gula Pasir" in edited_messages[-1]["text"]
    assert "Dibatalkan" in edited_messages[-1]["text"]


@pytest.mark.asyncio
async def test_api_expenses_ocr(client, auth_cookies, monkeypatch):
    client.cookies.update(auth_cookies)

    async def fake_call_ai_image(base64_img, caption=""):
        return {
            "items": [
                {
                    "tanggal": "2026-10-23",
                    "barang": "Keju Cheddar Kraft 2kg",
                    "qty": 3,
                    "kategori": "Bahan Kue",
                    "harga_satuan": 125000,
                    "tax": 5000,
                    "diskon": 10000,
                    "total_harga": 370000,
                    "toko_supplier": "TBK Makmur",
                    "metode_bayar": "Transfer",
                    "status_pembayaran": "Lunas",
                    "no_invoice": "INV-OCR-001",
                    "is_reimbursement": True,
                    "keterangan": "Struk kasir #12",
                }
            ]
        }

    import app.api.expenses as api_exp
    monkeypatch.setattr(api_exp, "call_ai_image", fake_call_ai_image)

    fake_file = ("nota.jpg", b"fake_jpeg_image_content", "image/jpeg")
    res = await client.post("/api/v1/expenses/ocr", files={"file": fake_file})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert len(data["items"]) == 1
    assert data["items"][0]["barang"] == "Keju Cheddar Kraft 2kg"
    assert data["items"][0]["no_invoice"] == "INV-OCR-001"
    assert data["items"][0]["is_reimbursement"] is True


@pytest.mark.asyncio
async def test_import_from_history_and_price_history(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # Buat 2 transaksi dengan harga berbeda di 2 toko
    await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-01",
            "supplier": "Toko Murah",
            "item_name": "Cokelat Blok Diamond",
            "qty": 2,
            "category": "Bahan Kue",
            "unit_price": 52000,
            "total_price": 104000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
        },
    )
    await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-15",
            "supplier": "Toko Mahal",
            "item_name": "Cokelat Blok Diamond",
            "qty": 1,
            "category": "Bahan Kue",
            "unit_price": 58000,
            "total_price": 58000,
            "pay_method": "Tunai",
            "pay_status": "Lunas",
        },
    )

    # 1. Uji tarik otomatis ke Master Item dari histori transaksi
    seed_res = await client.post("/api/v1/master-items/import-from-history")
    assert seed_res.status_code == 200
    assert seed_res.json()["added"] >= 1

    # 2. Uji endpoint riwayat harga & perbandingan toko
    ph_res = await client.get("/api/v1/expenses/price-history?item_name=Cokelat%20Blok%20Diamond")
    assert ph_res.status_code == 200
    ph = ph_res.json()
    assert ph["ok"] is True
    assert ph["tx_count"] == 2
    assert ph["min_price"] == 52000.0
    assert ph["max_price"] == 58000.0
    assert ph["cheapest_supplier"] == "Toko Murah"
    assert len(ph["suppliers_comparison"]) == 2
    assert ph["suppliers_comparison"][0]["supplier"] == "Toko Murah"


@pytest.mark.asyncio
async def test_hermes_hutang_and_trend_handlers(db, monkeypatch):
    from app.agent.hermes import HermesAgent
    from app.services.expense_service import save_expenses
    from app.bot import telegram_client as tg

    sent_messages = []

    async def fake_send_msg(chat_id, text, thread_id=None, reply_markup=None, parse_mode="Markdown"):
        sent_messages.append({"text": text, "reply_markup": reply_markup})
        return {"ok": True, "result": {"message_id": 77}}

    monkeypatch.setattr(tg, "send_message", fake_send_msg)

    await save_expenses(
        db,
        [
            {
                "tanggal": "2026-10-23",
                "barang": "Keju Cheddar",
                "qty": 1,
                "harga_satuan": 95000,
                "total_harga": 95000,
                "status_pembayaran": "Belum Lunas",
                "jatuh_tempo": "2026-10-23",
            }
        ],
    )
    await db.commit()

    agent = HermesAgent(db, user_id=1, chat_id=888, thread_id=None)

    # 1. Uji /hutang
    await agent.process(text="/hutang")
    assert any("DAFTAR TAGIHAN BELUM LUNAS" in m["text"] for m in sent_messages)
    assert any("Keju Cheddar" in m["text"] for m in sent_messages)

    # 2. Uji pertanyaan tren (QUERY_TREND)
    sent_messages.clear()
    await agent.process(text="pengeluaran bulan ini naik atau turun dibanding bulan lalu?")
    assert any("TREN PENGELUARAN" in m["text"] for m in sent_messages)
