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
    assert data["user"] in ("Admin", "Owner / Super Admin")


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


@pytest.mark.asyncio
async def test_api_expenses_msg_link_create_and_update(client, auth_cookies):
    """Test pembuatan dan update msg_link untuk cross check Telegram."""
    client.cookies.update(auth_cookies)

    # 1. Buat transaksi dengan link Telegram
    tg_url = "https://t.me/c/2481928371/7/9981"
    payload = {
        "expense_date": "2026-10-23",
        "supplier": "TBK Megah",
        "item_name": "Coklat Bubuk Tulip 1kg",
        "qty": 2,
        "category": "Bahan Baku",
        "unit_price": 60000,
        "total_price": 120000,
        "msg_link": tg_url,
    }
    res = await client.post("/api/v1/expenses", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["msg_link"] == tg_url
    expense_id = data["id"]

    # 2. Update msg_link
    updated_url = "https://t.me/c/2481928371/7/9982"
    update_res = await client.put(
        f"/api/v1/expenses/{expense_id}",
        json={"msg_link": updated_url},
    )
    assert update_res.status_code == 200
    assert update_res.json()["msg_link"] == updated_url


def test_build_msg_link_variations():
    """Test build_msg_link dengan berbagai tipe chat Telegram."""
    from app.bot.telegram_client import build_msg_link

    # Supergroup dengan thread topic
    link = build_msg_link(-1002481928371, "supergroup", 7, 501)
    assert link == "https://t.me/c/2481928371/7/501"

    # Supergroup tanpa thread
    link_no_thread = build_msg_link(-1002481928371, "supergroup", None, 502)
    assert link_no_thread == "https://t.me/c/2481928371/502"

    # Group dengan username publik
    link_username = build_msg_link(-1002481928371, "supergroup", 7, 503, chat_username="historycake_ops")
    assert link_username == "https://t.me/historycake_ops/7/503"

    # Private chat
    link_private = build_msg_link(12345678, "private", None, 504)
    assert link_private == "tg://user?id=12345678"


@pytest.mark.asyncio
async def test_api_expenses_shipping_and_other_fee(client, auth_cookies):
    """Test penambahan kolom ongkir (shipping_fee) dan biaya lainnya (other_fee)."""
    client.cookies.update(auth_cookies)

    # 1. Buat transaksi dengan ongkir dan biaya lainnya, auto-calculate total_price
    # (qty: 2 * 45000) + shipping: 15000 + tax: 0 + other_fee: 2500 - discount: 5000 = 102500
    payload = {
        "expense_date": "2026-10-23",
        "supplier": "Shopee TBK Baking",
        "item_name": "Keju Cheddar Prochiz 2kg",
        "qty": 2,
        "category": "Bahan Baku",
        "unit_price": 45000,
        "shipping_fee": 15000,
        "tax": 0,
        "other_fee": 2500,
        "discount": 5000,
        "total_price": 0,  # otomatis dihitung
    }
    res = await client.post("/api/v1/expenses", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["shipping_fee"] == 15000
    assert data["other_fee"] == 2500
    assert data["discount"] == 5000
    assert data["total_price"] == 102500
    expense_id = data["id"]

    # 2. Update shipping_fee dan other_fee
    update_res = await client.put(
        f"/api/v1/expenses/{expense_id}",
        json={"shipping_fee": 20000, "other_fee": 3000, "total_price": 108000},
    )
    assert update_res.status_code == 200
    updated_data = update_res.json()
    assert updated_data["shipping_fee"] == 20000
    assert updated_data["other_fee"] == 3000
    assert updated_data["total_price"] == 108000


@pytest.mark.asyncio
async def test_api_expenses_rejects_zero_or_negative_expense(client, auth_cookies):
    """Test penolakan pengeluaran dengan nominal 0 atau minus."""
    client.cookies.update(auth_cookies)

    # 1. Total 0 ditolak
    payload_zero = {
        "item_name": "Bonus Gratis",
        "qty": 1,
        "unit_price": 0,
        "total_price": 0,
    }
    res_zero = await client.post("/api/v1/expenses", json=payload_zero)
    assert res_zero.status_code == 400
    assert "tidak boleh" in res_zero.json()["detail"].lower()

    # 2. Total negatif ditolak
    payload_neg = {
        "item_name": "Diskon Salah",
        "qty": 1,
        "unit_price": 10000,
        "discount": 15000,
        "total_price": 0,  # rumus menghasilkan -5000
    }
    res_neg = await client.post("/api/v1/expenses", json=payload_neg)
    assert res_neg.status_code == 400


@pytest.mark.asyncio
async def test_api_expense_activity_logs(client, auth_cookies):
    """Test pencatatan dan query log aksi pengeluaran (CREATE, UPDATE, DELETE)."""
    client.cookies.update(auth_cookies)

    # 1. CREATE
    payload = {
        "expense_date": "2026-10-26",
        "supplier": "Toko Loyang Jaya",
        "item_name": "Loyang Brownies 20x10",
        "qty": 5,
        "unit_price": 25000,
        "total_price": 125000,
    }
    create_res = await client.post("/api/v1/expenses", json=payload)
    assert create_res.status_code == 201
    expense_id = create_res.json()["id"]

    # 2. Query log untuk expense ini (harus ada log CREATE)
    logs_res = await client.get(f"/api/v1/expenses/{expense_id}/logs")
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert len(logs) == 1
    assert logs[0]["action"] == "CREATE"
    assert "dashboard" in logs[0]["actor"]

    # 3. UPDATE
    update_res = await client.put(
        f"/api/v1/expenses/{expense_id}",
        json={"pay_status": "Belum Lunas", "notes": "Hutang tempo 14 hari"},
    )
    assert update_res.status_code == 200

    # Query log lagi (harus ada log STATUS_CHANGE / UPDATE)
    logs_after_update = (await client.get(f"/api/v1/expenses/{expense_id}/logs")).json()
    assert len(logs_after_update) == 2
    assert logs_after_update[0]["action"] in ("UPDATE", "STATUS_CHANGE")
    assert "pay_status" in logs_after_update[0]["details"]

    # 4. Global recent logs endpoint
    recent_res = await client.get("/api/v1/expenses/logs/recent?limit=20")
    assert recent_res.status_code == 200
    recent_logs = recent_res.json()
    assert any(l["expense_id"] == expense_id for l in recent_logs)

    # 5. DELETE
    del_res = await client.delete(f"/api/v1/expenses/{expense_id}")
    assert del_res.status_code == 200

    # Verifikasi log DELETE tercatat
    logs_after_delete = (await client.get(f"/api/v1/expenses/{expense_id}/logs")).json()
    assert len(logs_after_delete) == 3
    assert logs_after_delete[0]["action"] == "DELETE"


@pytest.mark.asyncio
async def test_api_expense_logs_export_csv(client, auth_cookies):
    """Test ekspor log aktivitas belanja ke CSV."""
    client.cookies.update(auth_cookies)

    # 1. Buat transaksi untuk menghasilkan log
    payload = {
        "expense_date": "2026-10-26",
        "supplier": "Toko Plastik Makmur",
        "item_name": "Plastik Mika 100pcs",
        "qty": 2,
        "unit_price": 30000,
        "total_price": 60000,
    }
    create_res = await client.post("/api/v1/expenses", json=payload)
    assert create_res.status_code == 201

    # 2. Panggil endpoint ekspor
    res = await client.get("/api/v1/expenses/logs/export")
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attachment; filename=" in res.headers["content-disposition"]
    csv_text = res.text
    assert "ID Log" in csv_text
    assert "Plastik Mika" in csv_text or "CREATE" in csv_text


@pytest.mark.asyncio
async def test_api_restore_deleted_expense(client, auth_cookies):
    """Test fitur undo delete / restore data belanja dari log DELETE."""
    client.cookies.update(auth_cookies)

    # 1. Buat belanja
    payload = {
        "expense_date": "2026-10-26",
        "supplier": "CV Aneka Bahan",
        "item_name": "Mentega Anchor 5kg",
        "qty": 1,
        "unit_price": 350000,
        "total_price": 350000,
        "notes": "Pesanan kue ulang tahun",
    }
    create_res = await client.post("/api/v1/expenses", json=payload)
    assert create_res.status_code == 201
    expense_id = create_res.json()["id"]

    # 2. Hapus belanja
    del_res = await client.delete(f"/api/v1/expenses/{expense_id}")
    assert del_res.status_code == 200

    # 3. Cari ID log DELETE
    logs_res = await client.get(f"/api/v1/expenses/{expense_id}/logs")
    logs = logs_res.json()
    delete_log = next(l for l in logs if l["action"] == "DELETE")
    delete_log_id = delete_log["id"]

    # 4. Panggil endpoint restore
    restore_res = await client.post(f"/api/v1/expenses/logs/{delete_log_id}/restore")
    assert restore_res.status_code == 200
    restored_data = restore_res.json()
    assert restored_data["item_name"] == "Mentega Anchor 5kg"
    assert restored_data["total_price"] == 350000
    assert restored_data["notes"] == "Pesanan kue ulang tahun"

    # 5. Cek apakah ada log RESTORE yang tercatat
    new_expense_id = restored_data["id"]
    new_logs_res = await client.get(f"/api/v1/expenses/{new_expense_id}/logs")
    new_logs = new_logs_res.json()
    assert any(l["action"] == "RESTORE" for l in new_logs)


@pytest.mark.asyncio
async def test_telegram_duplicate_interactive_callbacks(db):
    """Test callback interactive duplicate Telegram (force_save_duplicate & cancel_duplicate)."""
    from app.bot.callbacks import handle_callback_query
    from app.agent.memory import get_user_context, update_user_context
    from app.utils.auth import get_or_create_user
    from app.services.expense_service import get_all_expenses_paginated

    user = await get_or_create_user(db, 888999)

    # 1. Simpan pending duplicate ke context
    pending_items = [
        {
            "barang": "Keju Edam Holland",
            "toko_supplier": "TBK Sumber Berkah",
            "qty": 2,
            "satuan": "Kg",
            "harga_satuan": 175000,
            "total_harga": 350000,
            "kategori": "Bahan Baku",
            "tanggal": "2026-10-26",
        }
    ]
    await update_user_context(db, user.id, {
        "pending_duplicate": {
            "items": pending_items,
            "msg_link": "https://t.me/c/123/456",
        }
    })
    await db.commit()

    # 2. User klik "Tetap Simpan" (force_save_duplicate)
    cb_force = {
        "id": "cb_test_force",
        "from": {"id": 888999, "first_name": "Chef"},
        "message": {"chat": {"id": 12345}, "message_id": 999, "message_thread_id": 7},
        "data": "force_save_duplicate",
    }
    await handle_callback_query(cb_force, db)
    await db.commit()

    # Context pending_duplicate harus sudah bersih
    ctx = await get_user_context(db, user.id)
    assert ctx.get("pending_duplicate") is None

    # Expense harus tersimpan di DB
    expenses, count = await get_all_expenses_paginated(db, search="Keju Edam Holland")
    assert count >= 1
    assert expenses[0].total_price == 350000

    # 3. Test cancel_duplicate
    await update_user_context(db, user.id, {
        "pending_duplicate": {
            "items": pending_items,
            "msg_link": "https://t.me/c/123/456",
        }
    })
    await db.commit()

    cb_cancel = {
        "id": "cb_test_cancel",
        "from": {"id": 888999, "first_name": "Chef"},
        "message": {"chat": {"id": 12345}, "message_id": 999, "message_thread_id": 7},
        "data": "cancel_duplicate",
    }
    await handle_callback_query(cb_cancel, db)
    await db.commit()

    ctx_after_cancel = await get_user_context(db, user.id)
    assert ctx_after_cancel.get("pending_duplicate") is None


@pytest.mark.asyncio
async def test_high_value_audit_alert_triggering(db, monkeypatch):
    """Test notifikasi alert audit untuk pengeluaran >= threshold (Rp 500.000)."""
    from app.services.expense_service import save_expenses, update_expense, delete_expense

    sent_alerts = []

    async def mock_send_message(chat_id, text, thread_id=None, **kwargs):
        sent_alerts.append({"chat_id": chat_id, "text": text, "thread_id": thread_id})
        return {"ok": True}

    monkeypatch.setattr("app.bot.telegram_client.send_message", mock_send_message)
    monkeypatch.setattr("app.config.settings.report_chat_id", "-1002481928371")
    monkeypatch.setattr("app.config.settings.report_thread_id", 7)
    monkeypatch.setattr("app.config.settings.high_value_alert_threshold", 500000.0)

    # 1. Simpan item dengan nominal Rp 1.500.000
    items = [{
        "barang": "Oven Deck Gas RFL-12",
        "toko_supplier": "PT Fomac Machinery",
        "qty": 1,
        "satuan": "Unit",
        "harga_satuan": 1500000,
        "total_harga": 1500000,
        "kategori": "Asset",
        "tanggal": "2026-10-26",
    }]
    saved = await save_expenses(db, items, actor="dashboard:admin")
    await db.commit()
    exp_id = saved[0].id

    # 2. Update harga ke Rp 1.600.000 -> Harus memicu alert
    sent_alerts.clear()
    await update_expense(
        db,
        exp_id,
        {"unit_price": 1600000, "total_price": 1600000},
        actor="dashboard:admin",
    )
    await db.commit()

    assert len(sent_alerts) == 1
    assert "AUDIT ALERT" in sent_alerts[0]["text"]
    assert "Oven Deck Gas" in sent_alerts[0]["text"]
    assert "1.600.000" in sent_alerts[0]["text"]

    # 3. Hapus item bernilai Rp 1.600.000 -> Harus memicu alert
    sent_alerts.clear()
    await delete_expense(db, exp_id, actor="dashboard:admin")
    await db.commit()

    assert len(sent_alerts) == 1
    assert "PENGELUARAN DIHAPUS" in sent_alerts[0]["text"]
    assert "Oven Deck Gas" in sent_alerts[0]["text"]




