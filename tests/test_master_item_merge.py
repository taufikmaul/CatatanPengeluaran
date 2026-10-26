"""
tests/test_master_item_merge.py — Test audit double item master dan merge ke 1 item.
Skenario: ketika scan AI menghasilkan nama berbeda awal/akhir (mis. kabel NYM 2x1.5 vs kabel NYM 2x1.5 / kabel tembaga).
"""
from datetime import date
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.models.master_item import MasterItem
from app.models.expense import Expense
from app.services.master_item_service import (
    create_master_item,
    audit_duplicate_master_items,
    merge_master_items,
    find_best_master_match,
    list_master_items,
)
from app.services.expense_service import save_expenses


@pytest.fixture
async def client(db):
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
async def test_audit_detects_ai_scan_duplicate_suffixes(db):
    """
    Uji deteksi duplikat untuk nama dengan tambahan deskripsi di akhir/awal.
    Item 1: 'Kabel listrik NYM Dynamic 2 x 1.5'
    Item 2: 'Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga'
    Item 3: 'Kabel listrik NYM Dynamic 3 x 1.5' (dimensi beda 2 vs 3, TIDAK boleh dianggap duplikat)
    """
    item1 = await create_master_item(
        db,
        item_name="Kabel listrik NYM Dynamic 2 x 1.5",
        category="Operasional",
        default_supplier="Istana Sinar",
        satuan_beli="Pcs",
    )
    item2 = await create_master_item(
        db,
        item_name="Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga",
        category="Renovasi",
        default_supplier="Istana Sinar",
        satuan_beli="Pcs",
    )
    item3 = await create_master_item(
        db,
        item_name="Kabel listrik NYM Dynamic 3 x 1.5",
        category="Operasional",
        default_supplier="Istana Sinar",
        satuan_beli="Pcs",
    )
    await db.commit()

    # Jalankan audit
    audit_res = await audit_duplicate_master_items(db, min_score=0.70)
    assert audit_res["ok"] is True
    assert audit_res["total_duplicates"] >= 1

    pairs = audit_res["pairs"]
    matched_pair = None
    for p in pairs:
        ids = {p["item_a"]["id"], p["item_b"]["id"]}
        if ids == {item1.id, item2.id}:
            matched_pair = p
        # Pastikan item 3 (3 x 1.5) tidak dipasangkan dengan item 1 (2 x 1.5)
        assert ids != {item1.id, item3.id}, "Item beda dimensi 2 vs 3 tidak boleh dideteksi sebagai duplikat"

    assert matched_pair is not None, "Harus menemukan pasangan duplikat Item 1 dan Item 2"
    assert matched_pair["match_type"] in ("substring", "prefix_suffix")
    assert matched_pair["similarity_score"] >= 0.85


@pytest.mark.asyncio
async def test_merge_master_items_reassigns_expenses_and_adds_alias(db):
    """
    Uji operasi merge:
    - Transaksi dari item duplikat dialihkan ke item target
    - Nama asli dicatat di notes
    - Nama item sumber otomatis masuk ke aliases target
    - Item sumber dihapus
    """
    target = await create_master_item(
        db,
        item_name="Kabel listrik NYM Dynamic 2 x 1.5",
        category="Operasional",
        default_supplier="Istana Sinar",
        satuan_beli="Pcs",
    )
    source = await create_master_item(
        db,
        item_name="Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga",
        category="Renovasi",
        default_supplier="Istana Sinar",
        satuan_beli="Pcs",
    )
    await db.commit()

    # Buat transaksi yang mengarah ke source
    exp1 = Expense(
        expense_date=date(2026, 10, 24),
        item_name="Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga",
        category="Renovasi",
        supplier="Istana Sinar",
        unit_price=7220,
        qty=2,
        total_price=14440,
        master_item_id=source.id,
        notes="Pembelian proyek renovasi",
    )
    db.add(exp1)
    await db.commit()

    # Eksekusi merge
    merge_res = await merge_master_items(
        db,
        target_item_id=target.id,
        source_item_ids=[source.id],
        merge_aliases=True,
        update_expenses=True,
    )
    await db.commit()

    assert merge_res["ok"] is True
    assert merge_res["expenses_reassigned_count"] == 1
    assert "Kabel tembaga" in merge_res["target_item"]["aliases"]

    # Verifikasi source sudah terhapus
    source_check = await db.scalar(select(MasterItem).where(MasterItem.id == source.id))
    assert source_check is None

    # Verifikasi expense ter-update
    await db.refresh(exp1)
    assert exp1.master_item_id == target.id
    assert exp1.item_name == "Kabel listrik NYM Dynamic 2 x 1.5"
    assert exp1.category == "Operasional"
    assert "Struk: Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga" in exp1.notes

    # Verifikasi pencocokan AI scan masa depan:
    # Jika ada struk dengan nama lama, harus langsung cocok ke target!
    all_masters = await list_master_items(db)
    matched = find_best_master_match("Kabel listrik NYM Dynamic 2 x 1.5 / Kabel tembaga", all_masters)
    assert matched is not None
    assert matched.id == target.id


@pytest.mark.asyncio
async def test_api_audit_and_merge_endpoints(client, auth_cookies, db):
    """Uji REST API GET /audit-duplicates dan POST /merge."""
    client.cookies.update(auth_cookies)

    m1 = await create_master_item(
        db,
        item_name="Susu UHT Ultra Milk 1 Liter",
        category="Bahan Kue",
        default_supplier="Toko Bahan",
    )
    m2 = await create_master_item(
        db,
        item_name="Susu UHT Ultra Milk 1 Liter Full Cream",
        category="Bahan Kue",
        default_supplier="Toko Bahan",
    )
    await db.commit()

    # 1. Panggil audit endpoint
    audit_resp = await client.get("/api/v1/master-items/audit-duplicates")
    assert audit_resp.status_code == 200
    data = audit_resp.json()
    assert data["ok"] is True
    assert len(data["pairs"]) >= 1

    # 2. Panggil merge endpoint
    merge_payload = {
        "target_item_id": m1.id,
        "source_item_ids": [m2.id],
        "merge_aliases": True,
        "update_expenses": True,
    }
    merge_resp = await client.post("/api/v1/master-items/merge", json=merge_payload)
    assert merge_resp.status_code == 200
    merge_data = merge_resp.json()
    assert merge_data["ok"] is True
    assert merge_data["target_item"]["id"] == m1.id
    assert "Full Cream" in merge_data["target_item"]["aliases"]
