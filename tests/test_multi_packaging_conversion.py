"""
tests/test_multi_packaging_conversion.py — Pengujian multi-varian kemasan,
konversi otomatis ecer & satuan resep, harga dasar dari unit_price,
deteksi DRAFT_WARNING + konfirmasi Web, serta OCR Web & HPP.
"""
import io
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.menu_product import MenuProduct, MenuIngredient
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.expense_service import save_expenses
from app.services.menu_product_service import (
    build_master_price_history_map,
    load_all_menus_graph,
    resolve_all_menu_financials,
)


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
    token = create_session_token(role="admin")
    return {SESSION_COOKIE_NAME: token}


@pytest.mark.asyncio
async def test_simple_box_to_kg_to_gram_and_unit_price_math(client, auth_cookies):
    """
    1 Box = 24 Kg = 24.000 Gram.
    Beli 2 Box @ Rp 240.000 + ongkir Rp 20.000 -> total_price Rp 500.000.
    base_unit_price HARUS dihitung dari unit_price (240.000 / 24.000 = Rp 10/Gram),
    bukan dari total_price.
    """
    client.cookies.update(auth_cookies)

    res_mi = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Mentega Putih Baker",
            "category": "Bahan Kue",
            "satuan_beli": "Box",
            "satuan_ecer": "Kg",
            "satuan_resep": "Gram",
            "konversi_resep": 24000,
            "packagings": [
                {
                    "label": "Box 24 Kg",
                    "purchase_unit": "Box",
                    "retail_qty": 24,
                    "retail_unit": "Kg",
                    "base_qty": 24000,
                    "base_unit": "Gram",
                    "keywords": "24kg, box",
                    "is_default": True,
                    "is_active": True,
                }
            ],
        },
    )
    assert res_mi.status_code == 201, res_mi.text
    mi = res_mi.json()
    assert len(mi["packagings"]) == 1
    pkg_id = mi["packagings"][0]["id"]

    res_exp = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-11-26",
            "supplier": "Toko Bahan",
            "item_name": "Mentega Putih Baker",
            "master_item_id": mi["id"],
            "packaging_id": pkg_id,
            "qty": 2,
            "unit": "Box",
            "category": "Bahan Kue",
            "unit_price": 240000,
            "shipping_fee": 20000,
            "total_price": 500000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
        },
    )
    assert res_exp.status_code == 201, res_exp.text
    exp = res_exp.json()
    assert exp["review_status"] == "CONFIRMED"
    assert exp["retail_qty"] == 48.0
    assert exp["retail_unit"] == "Kg"
    assert exp["base_qty"] == 48000.0
    assert exp["base_unit"] == "Gram"
    assert exp["base_unit_price"] == 10.0


@pytest.mark.asyncio
async def test_single_pcs_900ml_auto_conversion(db: AsyncSession):
    """Contoh 2 user: Susu 1 Pcs isi 900ml -> otomatis terkonversi ke 900 ml."""
    saved = await save_expenses(
        db,
        [
            {
                "tanggal": "2026-11-26",
                "barang": "Susu Segar 900ml",
                "qty": 3,
                "satuan": "Pcs",
                "harga_satuan": 22500,
                "total_harga": 67500,
                "toko_supplier": "Supermarket",
                "kategori": "Bahan Kue",
            }
        ],
    )
    assert len(saved) == 1
    exp = saved[0]
    assert float(exp.base_qty) == 2700.0
    assert exp.base_unit == "ml"
    assert float(exp.base_unit_price) == 25.0


@pytest.mark.asyncio
async def test_carnation_multi_packaging_variants_draft_warning_confirm_and_hpp(
    client, db: AsyncSession, auth_cookies
):
    """
    Kasus utama Carnation dengan 4 varian di 1 MasterItem:
    - Karton Pouch (8x2kg) -> 16000 Gram
    - Pouch 2kg -> 2000 Gram
    - Karton Kaleng (24x480g) -> 11520 Gram
    - Kaleng 480g -> 480 Gram
    """
    client.cookies.update(auth_cookies)

    res_mi = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Susu Carnation",
            "category": "Bahan Kue",
            "aliases": "carnation",
            "satuan_beli": "Dus",
            "satuan_ecer": "Kaleng",
            "satuan_resep": "Gram",
            "konversi_resep": 16000,
            "packagings": [
                {
                    "label": "Karton Pouch (8x2kg)",
                    "purchase_unit": "Dus",
                    "retail_qty": 8,
                    "retail_unit": "Pouch",
                    "base_qty": 16000,
                    "base_unit": "Gram",
                    "keywords": "pouch, 2kg, 8x2kg",
                    "is_default": True,
                    "is_active": True,
                },
                {
                    "label": "Pouch 2kg",
                    "purchase_unit": "Pouch",
                    "retail_qty": 1,
                    "retail_unit": "Pouch",
                    "base_qty": 2000,
                    "base_unit": "Gram",
                    "keywords": "pouch, 2kg, 2000g",
                    "is_default": False,
                    "is_active": True,
                },
                {
                    "label": "Karton Kaleng (24x480g)",
                    "purchase_unit": "Dus",
                    "retail_qty": 24,
                    "retail_unit": "Kaleng",
                    "base_qty": 11520,
                    "base_unit": "Gram",
                    "keywords": "kaleng, klg, 480g, 24x480g",
                    "is_default": False,
                    "is_active": True,
                },
                {
                    "label": "Kaleng 480g",
                    "purchase_unit": "Kaleng",
                    "retail_qty": 1,
                    "retail_unit": "Kaleng",
                    "base_qty": 480,
                    "base_unit": "Gram",
                    "keywords": "kaleng, klg, 480g",
                    "is_default": False,
                    "is_active": True,
                },
            ],
        },
    )
    assert res_mi.status_code == 201, res_mi.text
    mi = res_mi.json()
    pkgs = {p["label"]: p for p in mi["packagings"]}

    # Buat MenuProduct untuk uji HPP
    menu = MenuProduct(
        name="Kue Sus Carnation",
        anonymous_name="MENU-901",
        category="Pastry",
        unit="Porsi",
        hpp_mode="recipe",
        selling_price=50000,
    )
    db.add(menu)
    await db.flush()
    db.add(
        MenuIngredient(
            menu_id=menu.id,
            master_item_id=mi["id"],
            ingredient_name="Susu Carnation",
            qty=100,
            unit="Gram",
            yield_factor=16000,
        )
    )
    await db.flush()

    # 1. Struk jelas: Karton Pouch 8x2kg = Rp 480.000 (Rp 30/Gram) -> CONFIRMED
    saved_1 = await save_expenses(
        db,
        [
            {
                "tanggal": "2026-11-20",
                "barang": "Carnation pouch 2kg",
                "qty": 1,
                "satuan": "Karton",
                "harga_satuan": 480000,
                "total_harga": 480000,
                "toko_supplier": "Grosir Kue",
            }
        ],
    )
    assert saved_1[0].review_status == "CONFIRMED"
    assert saved_1[0].packaging_id == pkgs["Karton Pouch (8x2kg)"]["id"]
    assert float(saved_1[0].retail_qty) == 8.0
    assert saved_1[0].retail_unit == "Pouch"
    assert float(saved_1[0].base_qty) == 16000.0
    assert float(saved_1[0].base_unit_price) == 30.0

    # 2. Struk tulis Pcs tapi jelas "KLG 480G" -> otomatis Kaleng 480g, CONFIRMED
    saved_2 = await save_expenses(
        db,
        [
            {
                "tanggal": "2026-11-22",
                "barang": "CARNATION KLG 480G",
                "qty": 5,
                "satuan": "Pcs",
                "harga_satuan": 16800,
                "total_harga": 84000,
                "toko_supplier": "Minimarket",
            }
        ],
    )
    assert saved_2[0].review_status == "CONFIRMED"
    assert saved_2[0].unit == "Kaleng"
    assert saved_2[0].packaging_id == pkgs["Kaleng 480g"]["id"]
    assert float(saved_2[0].base_qty) == 2400.0
    assert float(saved_2[0].base_unit_price) == 35.0

    # HPP harus memakai harga per gram terbaru (Rp 35/Gram * 100g = Rp 3.500),
    # bukan keliru jadi (100 / 16000) * 16800 = Rp 105!
    menus_graph = await load_all_menus_graph(db)
    price_map_1 = await build_master_price_history_map(db)
    fin_before_draft = resolve_all_menu_financials(menus_graph, price_map_1)
    assert fin_before_draft[menu.id]["core_unit_hpp"] == 3500.0

    # 3. Struk ambigu: "Carnation 1 Karton" tanpa info Pouch atau Kaleng -> DRAFT_WARNING
    saved_3 = await save_expenses(
        db,
        [
            {
                "tanggal": "2026-11-25",
                "barang": "Carnation",
                "qty": 1,
                "satuan": "Karton",
                "harga_satuan": 345600,
                "total_harga": 345600,
                "toko_supplier": "Grosir Kue",
            }
        ],
    )
    draft_exp = saved_3[0]
    assert draft_exp.review_status == "DRAFT_WARNING"
    assert draft_exp.review_warning is not None
    await db.commit()

    # Cek draft warning tidak mencemari HPP maupun price history sebelum dikonfirmasi
    price_map = await build_master_price_history_map(db)
    assert price_map[mi["id"]]["latest_price"] == round(35.0 * 16000, 2)

    cnt_res = await client.get("/api/v1/expenses/draft-warnings/count")
    assert cnt_res.status_code == 200
    assert cnt_res.json()["count"] == 1

    list_draft = await client.get("/api/v1/expenses?review_status=DRAFT_WARNING")
    assert list_draft.status_code == 200
    assert len(list_draft.json()["data"]) == 1
    assert list_draft.json()["data"][0]["id"] == draft_exp.id

    # 4. Konfirmasi via endpoint Web ke Karton Kaleng (24x480g) -> CONFIRMED
    # 345.600 / 11.520 Gram = Rp 30/Gram
    confirm_res = await client.post(
        f"/api/v1/expenses/{draft_exp.id}/confirm-unit",
        json={
            "master_item_id": mi["id"],
            "packaging_id": pkgs["Karton Kaleng (24x480g)"]["id"],
            "qty": 1,
            "unit": "Dus",
            "unit_price": 345600,
        },
    )
    assert confirm_res.status_code == 200, confirm_res.text
    confirmed = confirm_res.json()
    assert confirmed["review_status"] == "CONFIRMED"
    assert confirmed["review_warning"] is None
    assert confirmed["retail_qty"] == 24.0
    assert confirmed["retail_unit"] == "Kaleng"
    assert confirmed["base_qty"] == 11520.0
    assert confirmed["base_unit_price"] == 30.0

    # Sekarang count draft kembali 0 dan HPP update ke Rp 30/Gram * 100g = Rp 3.000
    cnt_after = await client.get("/api/v1/expenses/draft-warnings/count")
    assert cnt_after.json()["count"] == 0

    menus_graph_after = await load_all_menus_graph(db)
    price_map_after = await build_master_price_history_map(db)
    fin_after = resolve_all_menu_financials(menus_graph_after, price_map_after)
    assert fin_after[menu.id]["core_unit_hpp"] == 3000.0

    # 5. Anomali harga: Beli Karton Kaleng tapi harganya Rp 18.000 (seperti harga ecer 1 kaleng) -> DRAFT_WARNING
    saved_anomaly = await save_expenses(
        db,
        [
            {
                "tanggal": "2026-11-26",
                "barang": "Carnation 24x480g",
                "qty": 1,
                "satuan": "Karton",
                "harga_satuan": 18000,
                "total_harga": 18000,
                "toko_supplier": "Grosir Kue",
            }
        ],
    )
    assert saved_anomaly[0].review_status == "DRAFT_WARNING"
    assert "menyimpang" in (saved_anomaly[0].review_warning or "").lower()


@pytest.mark.asyncio
async def test_web_scan_ocr_endpoint_returns_packaging_and_warning(client, auth_cookies):
    """Endpoint Web POST /api/v1/expenses/ocr memetakan packaging & menandai warning jika ambigu."""
    client.cookies.update(auth_cookies)

    await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Carnation",
            "category": "Bahan Kue",
            "satuan_beli": "Dus",
            "satuan_ecer": "Kaleng",
            "satuan_resep": "Gram",
            "konversi_resep": 16000,
            "packagings": [
                {
                    "label": "Karton Pouch (8x2kg)",
                    "purchase_unit": "Dus",
                    "retail_qty": 8,
                    "retail_unit": "Pouch",
                    "base_qty": 16000,
                    "base_unit": "Gram",
                    "keywords": "pouch, 2kg",
                    "is_default": True,
                    "is_active": True,
                },
                {
                    "label": "Karton Kaleng (24x480g)",
                    "purchase_unit": "Dus",
                    "retail_qty": 24,
                    "retail_unit": "Kaleng",
                    "base_qty": 11520,
                    "base_unit": "Gram",
                    "keywords": "kaleng, 480g",
                    "is_default": False,
                    "is_active": True,
                },
            ],
        },
    )

    mock_ai_response = {
        "items": [
            {
                "tanggal": "2026-11-26",
                "barang": "Carnation",
                "qty": 1,
                "satuan": "Karton",
                "kategori": "Bahan Kue",
                "harga_satuan": 350000,
                "total_harga": 350000,
                "toko_supplier": "Toko Bahan",
            },
            {
                "tanggal": "2026-11-26",
                "barang": "Carnation pouch 2kg",
                "qty": 1,
                "satuan": "Dus",
                "kategori": "Bahan Kue",
                "harga_satuan": 480000,
                "total_harga": 480000,
                "toko_supplier": "Toko Bahan",
            },
        ]
    }

    with patch("app.api.expenses.call_ai_image", new=AsyncMock(return_value=mock_ai_response)):
        res = await client.post(
            "/api/v1/expenses/ocr",
            files={"file": ("struk.png", io.BytesIO(b"\x89PNG\r\n\x1a\nfake"), "image/png")},
        )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["warning_count"] == 1
    assert len(body["items"]) == 2
    assert body["items"][0]["review_status"] == "DRAFT_WARNING"
    assert body["items"][0]["review_warning"]
    assert body["items"][1]["review_status"] == "CONFIRMED"
    assert body["items"][1]["retail_qty"] == 8.0
    assert body["items"][1]["base_qty"] == 16000.0


def test_telegram_specific_transaction_links():
    """Link Telegram harus mengarah ke transaksi spesifik (?expense_id=... / ?confirm_unit=...)."""
    from types import SimpleNamespace
    from app.utils.formatters import build_expense_action_keyboard, build_transaction_dashboard_url

    url_single = build_transaction_dashboard_url("https://keuangan.example.com/app", "42")
    assert url_single == "https://keuangan.example.com/app/transactions?expense_id=42"

    url_multi_draft = build_transaction_dashboard_url(
        "https://keuangan.example.com/app/", "42,43", review_draft=True
    )
    assert url_multi_draft == (
        "https://keuangan.example.com/app/transactions?expense_id=42&ids=42,43&confirm_unit=42"
    )

    kb_confirmed = build_expense_action_keyboard(
        ids_str="42",
        is_paid=True,
        is_reimb=False,
        dashboard_url="https://keuangan.example.com/app",
        expenses=[SimpleNamespace(id=42, review_status="CONFIRMED", category="Bahan Kue", item_name="Gula")],
    )
    url_buttons = [btn for row in kb_confirmed["inline_keyboard"] for btn in row if "url" in btn]
    assert len(url_buttons) == 1
    assert url_buttons[0]["text"] == "🌐 Lihat Dashboard"
    assert url_buttons[0]["url"] == "https://keuangan.example.com/app/transactions?expense_id=42"

    kb_draft = build_expense_action_keyboard(
        ids_str="42,43",
        is_paid=True,
        is_reimb=False,
        dashboard_url="https://keuangan.example.com/app",
        expenses=[
            SimpleNamespace(id=42, review_status="CONFIRMED", category="Bahan Kue", item_name="Gula"),
            SimpleNamespace(id=43, review_status="DRAFT_WARNING", category="Bahan Kue", item_name="Carnation"),
        ],
    )
    draft_buttons = [btn for row in kb_draft["inline_keyboard"] for btn in row if "url" in btn]
    assert len(draft_buttons) == 1
    assert draft_buttons[0]["text"] == "⚠️ Konfirmasi Kemasan (Web)"
    assert draft_buttons[0]["url"] == (
        "https://keuangan.example.com/app/transactions?expense_id=43&confirm_unit=43"
    )
