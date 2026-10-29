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


@pytest.mark.asyncio
async def test_merge_when_target_takes_source_name_does_not_violate_unique_constraint(db):
    """
    Skenario bug yang dilaporkan pengguna:
    Target (id A) diberi custom_name yang sama persis dengan nama salah satu source (id B).
    Tanpa penanganan urutan flush, Postgres melempar UniqueViolationError pada ix_master_items_item_name.
    """
    target = await create_master_item(
        db,
        item_name="Alat Makan Sendok Garpu Wooden Sendok Teh / Garpu Panjang",
        category="Operasional",
    )
    source = await create_master_item(
        db,
        item_name="Alat Makan Sendok Garpu Wooden Sendok Teh",
        category="Operasional",
    )
    await db.commit()

    # Merge dengan custom_name = source.item_name
    res = await merge_master_items(
        db,
        target_item_id=target.id,
        source_item_ids=[source.id],
        custom_name="Alat Makan Sendok Garpu Wooden Sendok Teh",
        merge_aliases=True,
        update_expenses=True,
    )
    await db.commit()

    assert res["ok"] is True
    assert res["target_item"]["item_name"] == "Alat Makan Sendok Garpu Wooden Sendok Teh"
    # Pastikan source terhapus
    deleted = await db.scalar(select(MasterItem).where(MasterItem.id == source.id))
    assert deleted is None


@pytest.mark.asyncio
async def test_audit_duplicate_master_items_by_supplier(db, client, auth_cookies):
    """
    Uji audit duplikat item yang difilter khusus untuk supplier tertentu.
    Hanya pasangan duplikat dari supplier tersebut yang ditampilkan.
    """
    from app.models.supplier import Supplier

    # Buat 2 supplier
    supp1 = Supplier(name="Toko Roti Makmur", aliases="Roti Makmur, RM")
    supp2 = Supplier(name="Toko Bangunan Sejahtera", aliases="Sejahtera Bangunan")
    db.add_all([supp1, supp2])
    await db.flush()

    # Item untuk supplier 1 (duplikat tepung)
    item1a = await create_master_item(
        db,
        item_name="Tepung Terigu Segitiga Biru 1kg",
        category="Bahan Kue",
        default_supplier="Toko Roti Makmur",
    )
    item1b = await create_master_item(
        db,
        item_name="Segitiga Biru 1 Kg Tepung",
        category="Bahan Kue",
        default_supplier="Toko Roti Makmur",
    )

    # Item untuk supplier 2 (duplikat semen)
    item2a = await create_master_item(
        db,
        item_name="Semen Tiga Roda 50kg",
        category="Renovasi",
        default_supplier="Toko Bangunan Sejahtera",
    )
    item2b = await create_master_item(
        db,
        item_name="Semen Tiga Roda 50 Kg Sak",
        category="Renovasi",
        default_supplier="Toko Bangunan Sejahtera",
    )
    await db.commit()

    # 1. Audit supplier 1 saja
    res1 = await audit_duplicate_master_items(db, supplier_id=supp1.id, strict_supplier=True)
    assert res1["ok"] is True
    assert res1["total_duplicates"] == 1
    pair = res1["pairs"][0]
    pair_names = {pair["item_a"]["item_name"], pair["item_b"]["item_name"]}
    assert "Tepung Terigu Segitiga Biru 1kg" in pair_names
    assert "Segitiga Biru 1 Kg Tepung" in pair_names
    assert pair["both_in_supplier"] is True

    # 2. Audit via REST API dengan query parameter supplier
    api_res = await client.get(
        "/api/v1/master-items/audit-duplicates?supplier=Toko%20Roti%20Makmur&strict_supplier=true",
        cookies=auth_cookies,
    )
    assert api_res.status_code == 200
    data = api_res.json()
    assert data["ok"] is True
    assert data["total_duplicates"] == 1
    assert data["pairs"][0]["both_in_supplier"] is True


@pytest.mark.asyncio
async def test_audit_duplicate_master_items_supplier_with_expenses(db):
    """
    Uji audit duplikat item toko ketika salah satu item baru dicatat di transaksi Expense
    dan belum sempat didaftarkan manual di tabel master_items.
    Sistem harus otomatis mendeteksi dan mengikutsertakannya dalam audit toko.
    """
    from app.models.supplier import Supplier

    supp = Supplier(name="Toko Bahan Kue Ceria")
    db.add(supp)
    await db.flush()

    # 1 master item terdaftar
    master1 = await create_master_item(
        db,
        item_name="Mentega Blueband Serbaguna 200g",
        category="Bahan Kue",
        default_supplier="Toko Bahan Kue Ceria",
    )

    # 1 transaksi belanja dengan nama mirip tapi belum ada di master_item
    exp = Expense(
        expense_date=date(2026, 3, 1),
        supplier="Toko Bahan Kue Ceria",
        supplier_id=supp.id,
        item_name="Blueband Serbaguna 200 g Mentega",
        qty=5,
        unit="Pcs",
        unit_price=12000,
        total_price=60000,
        category="Bahan Kue",
        pay_method="Tunai",
        pay_status="Lunas",
    )
    db.add(exp)
    await db.commit()

    # Audit untuk toko Ceria
    audit_res = await audit_duplicate_master_items(db, supplier_id=supp.id, strict_supplier=True)
    assert audit_res["ok"] is True
    assert audit_res["total_duplicates"] >= 1

    pair = audit_res["pairs"][0]
    names = {pair["item_a"]["item_name"], pair["item_b"]["item_name"]}
    assert "Mentega Blueband Serbaguna 200g" in names
    assert "Blueband Serbaguna 200 g Mentega" in names


@pytest.mark.asyncio
async def test_audit_duplicate_master_items_with_min_score_90(db, client, auth_cookies):
    """
    Uji audit duplikat katalog item baku dengan tingkat kemiripan min_score=0.90 (90%).
    - Item dengan kemiripan sangat tinggi (>= 90%) tetap terdeteksi.
    - Item dengan kemiripan sedang (~75%) terdeteksi di min_score=0.70 tetapi tersaring keluar di min_score=0.90.
    """
    client.cookies.update(auth_cookies)

    # Pasangan 1: Sangat mirip (kemiripan substring tinggi, >= 90%)
    item1 = await create_master_item(
        db,
        item_name="Minyak Goreng Bimoli 2 Liter",
        category="Bahan Baku",
        default_supplier="Toko Sembako",
    )
    item2 = await create_master_item(
        db,
        item_name="Minyak Goreng Bimoli 2 Liter Refill",
        category="Bahan Baku",
        default_supplier="Toko Sembako",
    )

    # Pasangan 2: Kemiripan sedang (~75-77%)
    item3 = await create_master_item(
        db,
        item_name="Gula Pasir Gulaku Kuning",
        category="Bahan Baku",
        default_supplier="Toko Sembako",
    )
    item4 = await create_master_item(
        db,
        item_name="Gula Pasir Gulaku Hijau",
        category="Bahan Baku",
        default_supplier="Toko Sembako",
    )
    await db.commit()

    # 1. Audit via Service dengan min_score=0.70 -> Keduanya harus terdeteksi
    res_70 = await audit_duplicate_master_items(db, min_score=0.70)
    assert res_70["ok"] is True
    pair_ids_70 = [{p["item_a"]["id"], p["item_b"]["id"]} for p in res_70["pairs"]]
    assert {item1.id, item2.id} in pair_ids_70
    assert {item3.id, item4.id} in pair_ids_70

    # 2. Audit via Service dengan min_score=0.90 -> Pasangan 1 (>=90%) lolos, Pasangan 2 (<90%) terfilter
    res_90 = await audit_duplicate_master_items(db, min_score=0.90)
    assert res_90["ok"] is True
    pair_ids_90 = [{p["item_a"]["id"], p["item_b"]["id"]} for p in res_90["pairs"]]
    assert {item1.id, item2.id} in pair_ids_90
    assert {item3.id, item4.id} not in pair_ids_90

    # 3. Audit via REST API endpoint dengan query parameter ?min_score=0.90
    api_resp = await client.get("/api/v1/master-items/audit-duplicates?min_score=0.90")
    assert api_resp.status_code == 200
    api_data = api_resp.json()
    assert api_data["ok"] is True
    api_pair_ids = [{p["item_a"]["id"], p["item_b"]["id"]} for p in api_data["pairs"]]
    assert {item1.id, item2.id} in api_pair_ids
    assert {item3.id, item4.id} not in api_pair_ids


