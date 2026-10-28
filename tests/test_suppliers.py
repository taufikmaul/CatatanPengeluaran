"""
tests/test_suppliers.py — Pengujian komprehensif untuk fitur Master Supplier / Toko
Menguji:
1. CRUD Master Supplier
2. Role & Hak Akses (Admin/Karyawan vs Owner)
3. Auto-creation supplier saat pencatatan belanja
4. Sinkronisasi data belanja lama ke master supplier
5. Audit supplier ganda & penggabungan (merge)
6. Statistik belanja: Top item & Item termahal
"""
from datetime import date
from decimal import Decimal
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.database.connection import get_db
from app.models.supplier import Supplier
from app.models.expense import Expense
from app.models.master_item import MasterItem
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.supplier_service import (
    create_supplier,
    get_supplier_by_id,
    update_supplier,
    delete_supplier,
    audit_duplicate_suppliers,
    merge_suppliers,
    sync_existing_expenses,
    get_supplier_top_items,
    get_supplier_priciest_items,
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
def owner_cookies():
    token = create_session_token(role="admin")
    return {SESSION_COOKIE_NAME: token}


@pytest.fixture
def admin_input_cookies():
    token = create_session_token(role="admin_input")
    return {SESSION_COOKIE_NAME: token}


@pytest.mark.asyncio
async def test_supplier_crud(db):
    """Uji operasi CRUD dasar pada master supplier."""
    supp = await create_supplier(
        db,
        name="TBK Sukses Makmur",
        phone="08123456789",
        address="Jl. Merdeka No. 10",
        aliases="tbk sukses, sukses makmur",
        notes="Supplier bahan kue langganan",
    )
    assert supp.id is not None
    assert supp.name == "TBK Sukses Makmur"

    detail = await get_supplier_by_id(db, supp.id)
    assert detail is not None
    assert detail["name"] == "TBK Sukses Makmur"
    assert detail["transaction_count"] == 0
    assert detail["total_spent"] == 0.0

    # Update
    updated = await update_supplier(
        db,
        supplier_id=supp.id,
        phone="0899999999",
        address="Jl. Baru No. 20",
    )
    assert updated.phone == "0899999999"
    assert updated.address == "Jl. Baru No. 20"

    # Delete
    await delete_supplier(db, supp.id, actor="owner")
    deleted_check = await get_supplier_by_id(db, supp.id)
    assert deleted_check is None


@pytest.mark.asyncio
async def test_supplier_duplicate_name_rejected(db):
    """Nama supplier tidak boleh duplikat (case-insensitive)."""
    await create_supplier(db, name="Toko Sumber Rejeki")

    with pytest.raises(Exception) as exc:
        await create_supplier(db, name="toko sumber rejeki")
    assert "sudah ada" in str(exc.value)


@pytest.mark.asyncio
async def test_role_permissions(client, owner_cookies, admin_input_cookies, db):
    """
    Scope role:
    - Admin (admin_input) BISA list, create, update, detail, dan tambah expense ke supplier.
    - Admin (admin_input) TIDAK BISA delete supplier (403), merge (403), atau delete expense (403).
    - Owner (admin) BISA melakukan semuanya.
    """
    # 1. Admin_input membuat supplier -> HARUS BERHASIL (201)
    res = await client.post(
        "/api/v1/suppliers",
        json={"name": "Toko Bahan Roti Indah", "phone": "081111"},
        cookies=admin_input_cookies,
    )
    assert res.status_code == 201
    supp_id = res.json()["id"]

    # 2. Admin_input update supplier -> HARUS BERHASIL (200)
    res_up = await client.put(
        f"/api/v1/suppliers/{supp_id}",
        json={"notes": "Diperbarui admin input"},
        cookies=admin_input_cookies,
    )
    assert res_up.status_code == 200

    # 3. Admin_input tambah expense di toko -> HARUS BERHASIL (201)
    res_exp = await client.post(
        f"/api/v1/suppliers/{supp_id}/expenses",
        json={
            "expense_date": "2026-10-28",
            "item_name": "Tepung Segitiga 1kg",
            "qty": 5,
            "unit": "Kg",
            "unit_price": 12000,
            "total_price": 60000,
            "category": "Bahan Baku",
        },
        cookies=admin_input_cookies,
    )
    assert res_exp.status_code == 201
    expense_id = res_exp.json()["id"]

    # 4. Admin_input mencoba DELETE expense -> DITOLAK 403 (Owner only)
    res_del_exp_forbidden = await client.delete(
        f"/api/v1/suppliers/{supp_id}/expenses/{expense_id}",
        cookies=admin_input_cookies,
    )
    assert res_del_exp_forbidden.status_code == 403

    # 5. Admin_input mencoba MERGE suppliers -> DITOLAK 403 (Owner only)
    res_merge_forbidden = await client.post(
        "/api/v1/suppliers/merge",
        json={"target_supplier_id": supp_id, "source_supplier_ids": [999]},
        cookies=admin_input_cookies,
    )
    assert res_merge_forbidden.status_code == 403

    # 6. Admin_input mencoba DELETE supplier -> DITOLAK 403 (Owner only)
    res_del_supp_forbidden = await client.delete(
        f"/api/v1/suppliers/{supp_id}",
        cookies=admin_input_cookies,
    )
    assert res_del_supp_forbidden.status_code == 403

    # 7. Owner menghapus expense -> HARUS BERHASIL (200)
    res_del_exp_ok = await client.delete(
        f"/api/v1/suppliers/{supp_id}/expenses/{expense_id}",
        cookies=owner_cookies,
    )
    assert res_del_exp_ok.status_code == 200

    # 8. Owner menghapus supplier -> HARUS BERHASIL (200)
    res_del_supp_ok = await client.delete(
        f"/api/v1/suppliers/{supp_id}",
        cookies=owner_cookies,
    )
    assert res_del_supp_ok.status_code == 200


@pytest.mark.asyncio
async def test_auto_creation_on_expense(db):
    """
    Ketika belanja dicatat dengan nama supplier baru (belum ada di master),
    supplier dibuat otomatis dan dihubungkan ke expense.supplier_id.
    """
    expenses = await save_expenses(
        db,
        items=[
            {
                "expense_date": "2026-10-28",
                "supplier": "Toko Plastik Makmur Sejati",
                "item_name": "Mika Kue 10x10",
                "qty": 10,
                "unit": "Pack",
                "unit_price": 15000,
                "total_price": 150000,
                "category": "Kemasan",
            }
        ],
        actor="test_bot",
    )
    assert len(expenses) == 1
    exp = expenses[0]
    assert exp.supplier_id is not None

    supp = await db.get(Supplier, exp.supplier_id)
    assert supp is not None
    assert supp.name == "Toko Plastik Makmur Sejati"


@pytest.mark.asyncio
async def test_sync_existing_expenses(db):
    """
    Uji sinkronisasi expense lama yang supplier_id-nya masih NULL.
    """
    # Buat master supplier yang sudah ada
    supp_prima = await create_supplier(db, name="TBK Prima Rasa")

    # Buat expense mentah tanpa supplier_id
    raw_exp1 = Expense(
        expense_date=date(2026, 10, 20),
        supplier="TBK Prima Rasa",
        supplier_id=None,
        item_name="Butter Wysman",
        qty=Decimal("2"),
        unit="Kaleng",
        unit_price=Decimal("150000"),
        total_price=Decimal("300000"),
        category="Bahan Kue",
    )
    raw_exp2 = Expense(
        expense_date=date(2026, 10, 21),
        supplier="Toko Mitra Abadi",  # Belum ada di master
        supplier_id=None,
        item_name="Kotak Kardus",
        qty=Decimal("50"),
        unit="Pcs",
        unit_price=Decimal("3000"),
        total_price=Decimal("150000"),
        category="Kemasan",
    )
    db.add_all([raw_exp1, raw_exp2])
    await db.flush()

    sync_res = await sync_existing_expenses(db)
    assert sync_res["synced_count"] >= 2

    await db.refresh(raw_exp1)
    await db.refresh(raw_exp2)
    assert raw_exp1.supplier_id == supp_prima.id
    assert raw_exp2.supplier_id is not None

    new_supp = await db.get(Supplier, raw_exp2.supplier_id)
    assert new_supp.name == "Toko Mitra Abadi"


@pytest.mark.asyncio
async def test_audit_duplicates_and_merge(db):
    """
    Uji audit supplier mirip (misal 'TBK Berkah Jaya' vs 'Berkah Jaya')
    dan penggabungan data (merge) oleh Owner.
    """
    s1 = await create_supplier(db, name="TBK Berkah Jaya")
    s2 = await create_supplier(db, name="Berkah Jaya")

    # Catat belanja pada s2
    e1 = Expense(
        expense_date=date(2026, 10, 25),
        supplier="Berkah Jaya",
        supplier_id=s2.id,
        item_name="Coklat Colatta 1kg",
        qty=Decimal("3"),
        unit="Kg",
        unit_price=Decimal("50000"),
        total_price=Decimal("150000"),
    )
    db.add(e1)
    await db.flush()

    # Jalankan audit duplikat
    clusters = await audit_duplicate_suppliers(db, threshold=0.7)
    assert len(clusters) > 0
    # Verifikasi cluster mendeteksi s1 dan s2
    found_pair = False
    for c in clusters:
        ids_in_cluster = [c["primary"]["id"]] + [d["id"] for d in c["duplicates"]]
        if s1.id in ids_in_cluster and s2.id in ids_in_cluster:
            found_pair = True
            break
    assert found_pair is True

    # Owner menggabungkan s2 ke s1
    merge_res = await merge_suppliers(db, target_id=s1.id, source_ids=[s2.id], actor="owner")
    assert merge_res["success"] is True
    assert merge_res["expenses_transferred"] == 1

    # Cek bahwa s2 sudah terhapus
    s2_check = await db.get(Supplier, s2.id)
    assert s2_check is None

    # Cek bahwa expense e1 sekarang terhubung ke s1
    await db.refresh(e1)
    assert e1.supplier_id == s1.id
    assert e1.supplier == s1.name

    # Cek alias s1 memuat nama s2
    await db.refresh(s1)
    assert "Berkah Jaya" in s1.aliases


@pytest.mark.asyncio
async def test_top_items_and_priciest_items(db):
    """
    Uji agregasi:
    - Top items (paling sering dibeli, grouped by master_item_id)
    - Priciest items (harga satuan tertinggi)
    """
    supp = await create_supplier(db, name="TBK Aneka Bahan")

    m_tepung = MasterItem(item_name="Tepung Cakra Kembar 1kg", category="Bahan Kue", satuan_beli="Kg")
    m_butter = MasterItem(item_name="Butter Anchor 2kg", category="Bahan Kue", satuan_beli="Tin")
    db.add_all([m_tepung, m_butter])
    await db.flush()

    # Belanja Tepung 3x (total 3x transaksi)
    e1 = Expense(
        expense_date=date(2026, 10, 1),
        supplier_id=supp.id,
        supplier=supp.name,
        master_item_id=m_tepung.id,
        item_name="Tepung Cakra",
        qty=Decimal("10"),
        unit="Kg",
        unit_price=Decimal("14000"),
        total_price=Decimal("140000"),
        category="Bahan Kue",
    )
    e2 = Expense(
        expense_date=date(2026, 10, 5),
        supplier_id=supp.id,
        supplier=supp.name,
        master_item_id=m_tepung.id,
        item_name="Tepung Cakra Kembar",
        qty=Decimal("10"),
        unit="Kg",
        unit_price=Decimal("15000"),  # Harga satuan tertinggi untuk tepung
        total_price=Decimal("150000"),
        category="Bahan Kue",
    )
    e3 = Expense(
        expense_date=date(2026, 10, 10),
        supplier_id=supp.id,
        supplier=supp.name,
        master_item_id=m_tepung.id,
        item_name="Tepung Cakra 1kg",
        qty=Decimal("5"),
        unit="Kg",
        unit_price=Decimal("14500"),
        total_price=Decimal("72500"),
        category="Bahan Kue",
    )

    # Belanja Butter 1x (harga satuan sangat mahal 350.000)
    e4 = Expense(
        expense_date=date(2026, 10, 8),
        supplier_id=supp.id,
        supplier=supp.name,
        master_item_id=m_butter.id,
        item_name="Butter Anchor 2kg",
        qty=Decimal("1"),
        unit="Tin",
        unit_price=Decimal("350000"),
        total_price=Decimal("350000"),
        category="Bahan Kue",
    )

    db.add_all([e1, e2, e3, e4])
    await db.flush()

    # 1. Test Top Items: Tepung harus rank #1 karena frekuensi = 3
    top_items = await get_supplier_top_items(db, supplier_id=supp.id)
    assert len(top_items) >= 2
    assert top_items[0]["master_item_id"] == m_tepung.id
    assert top_items[0]["purchase_count"] == 3
    assert top_items[0]["total_qty"] == 25.0

    # 2. Test Priciest Items: Butter harus rank #1 karena unit_price = 350.000
    priciest = await get_supplier_priciest_items(db, supplier_id=supp.id)
    assert len(priciest) >= 2
    assert priciest[0]["master_item_id"] == m_butter.id
    assert priciest[0]["max_unit_price"] == 350000.0

    # Rank #2 adalah Tepung dengan unit_price tertinggi = 15.000
    assert priciest[1]["master_item_id"] == m_tepung.id
    assert priciest[1]["max_unit_price"] == 15000.0


@pytest.mark.asyncio
async def test_supplier_unpaid_bills_and_statistics(client, owner_cookies, db):
    """
    Uji statistik tagihan supplier:
    1. Belanja dengan pay_status='Belum Lunas' meningkatkan unpaid_bills_count dan unpaid_bills_total.
    2. get_supplier_by_id mengembalikan daftar unpaid_bills lengkap.
    3. List suppliers endpoint mengembalikan data tagihan dan summary agregat.
    4. Pembayaran / update pay_status ke 'Lunas' mengurangi tagihan.
    """
    supp = await create_supplier(db, name="TBK Tagihan Test")

    # Buat 2 expense: 1 Lunas (50.000), 1 Belum Lunas (200.000)
    e1 = Expense(
        expense_date=date(2026, 10, 1),
        supplier_id=supp.id,
        supplier=supp.name,
        item_name="Tepung Terigu",
        qty=Decimal("5"),
        unit="Kg",
        unit_price=Decimal("10000"),
        total_price=Decimal("50000"),
        pay_status="Lunas",
    )
    e2 = Expense(
        expense_date=date(2026, 10, 2),
        supplier_id=supp.id,
        supplier=supp.name,
        item_name="Keju Cheddar 2kg",
        qty=Decimal("1"),
        unit="Block",
        unit_price=Decimal("200000"),
        total_price=Decimal("200000"),
        pay_status="Belum Lunas",
        due_date="2026-10-15",
        invoice_number="INV-999",
    )
    db.add_all([e1, e2])
    await db.flush()

    # 1. Cek detail supplier
    detail = await get_supplier_by_id(db, supp.id)
    assert detail["transaction_count"] == 2
    assert detail["total_spent"] == 250000.0
    assert detail["unpaid_bills_count"] == 1
    assert detail["unpaid_bills_total"] == 200000.0
    assert len(detail["unpaid_bills"]) == 1
    assert detail["unpaid_bills"][0]["item_name"] == "Keju Cheddar 2kg"
    assert detail["unpaid_bills"][0]["invoice_number"] == "INV-999"

    # 2. Cek API list suppliers
    res = await client.get("/api/v1/suppliers", cookies=owner_cookies)
    assert res.status_code == 200
    json_data = res.json()
    assert "summary" in json_data
    assert json_data["summary"]["total_unpaid_amount"] >= 200000.0
    assert json_data["summary"]["unpaid_suppliers_count"] >= 1

    # 3. Tandai Lunas via endpoint PATCH
    pay_res = await client.patch(
        f"/api/v1/suppliers/{supp.id}/expenses/{e2.id}/pay-status",
        json={"pay_status": "Lunas"},
        cookies=owner_cookies,
    )
    assert pay_res.status_code == 200
    assert pay_res.json()["pay_status"] == "Lunas"

    # 4. Verifikasi setelah lunas, tagihan menjadi 0
    updated_detail = await get_supplier_by_id(db, supp.id)
    assert updated_detail["unpaid_bills_count"] == 0
    assert updated_detail["unpaid_bills_total"] == 0.0
    assert len(updated_detail["unpaid_bills"]) == 0

