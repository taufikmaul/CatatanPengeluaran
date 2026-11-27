"""
tests/test_price_history_latest_price.py
Regression tests untuk bug sinkronisasi Riwayat Harga & latest price Master Item
ketika transaksi diedit, diubah tanggal/nama itemnya, atau dihapus.
"""
from datetime import date
import pytest

from app.services.expense_service import search_last_price
from app.services.master_item_service import (
    create_master_item,
    merge_master_items,
    audit_duplicate_master_items,
)
from app.services.menu_product_service import build_master_price_history_map


@pytest.mark.asyncio
async def test_edit_and_delete_expense_updates_price_history_and_master_latest_price(
    client, auth_cookies, db
):
    client.cookies.update(auth_cookies)

    # 1. Buat Master Item
    m_res = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Tepung Cakra Kembar",
            "category": "Bahan Kue",
            "default_supplier": "Toko Default",
            "satuan_beli": "Kg",
            "satuan_resep": "Gram",
            "konversi_resep": 1000,
        },
    )
    assert m_res.status_code == 201
    master_id = m_res.json()["id"]

    # 2. Tambah 2 transaksi: lama (Rp 12.000) dan baru (Rp 15.000)
    tx_old_res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-01",
            "supplier": "Toko Lama",
            "item_name": "Tepung Cakra Kembar",
            "qty": 2,
            "unit": "Kg",
            "category": "Bahan Kue",
            "unit_price": 12000,
            "total_price": 24000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
            "master_item_id": master_id,
        },
    )
    assert tx_old_res.status_code == 201
    tx_old_id = tx_old_res.json()["id"]

    tx_new_res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-15",
            "supplier": "Toko Baru",
            "item_name": "Tepung Cakra Kembar",
            "qty": 2,
            "unit": "Kg",
            "category": "Bahan Kue",
            "unit_price": 15000,
            "total_price": 30000,
            "pay_method": "Tunai",
            "pay_status": "Lunas",
            "master_item_id": master_id,
        },
    )
    assert tx_new_res.status_code == 201
    tx_new_id = tx_new_res.json()["id"]

    # Verifikasi awal: latest price = 15.000
    ph0 = (await client.get(f"/api/v1/expenses/price-history?item_id={master_id}")).json()
    assert ph0["tx_count"] == 2
    assert ph0["latest_price"] == 15000.0
    assert [h["id"] for h in ph0["history"]] == [tx_new_id, tx_old_id]

    mi0 = next(
        i for i in (await client.get("/api/v1/master-items")).json()["data"] if i["id"] == master_id
    )
    assert mi0["last_unit_price"] == 15000.0
    assert mi0["recipe_unit_price"] == 15.0
    assert mi0["last_supplier"] == "Toko Baru"
    assert mi0["tx_count"] == 2

    # 3. Edit harga transaksi terbaru (Rp 15.000 -> Rp 13.500)
    upd1 = await client.put(
        f"/api/v1/expenses/{tx_new_id}",
        json={"unit_price": 13500, "total_price": 27000},
    )
    assert upd1.status_code == 200

    ph1 = (await client.get(f"/api/v1/expenses/price-history?item_id={master_id}")).json()
    assert ph1["latest_price"] == 13500.0
    assert ph1["history"][0]["unit_price"] == 13500.0

    mi1 = next(
        i for i in (await client.get("/api/v1/master-items")).json()["data"] if i["id"] == master_id
    )
    assert mi1["last_unit_price"] == 13500.0
    assert mi1["recipe_unit_price"] == 13.5

    # Verifikasi juga menu price history map ikut sinkron
    menu_hist = await build_master_price_history_map(db)
    assert menu_hist[master_id]["latest_price"] == 13500.0
    assert menu_hist[master_id]["prev_price"] == 12000.0

    # 4. Edit hanya total_price (qty=2 -> total 28.000 harus update unit_price menjadi 14.000)
    upd2 = await client.put(
        f"/api/v1/expenses/{tx_new_id}",
        json={"total_price": 28000},
    )
    assert upd2.status_code == 200
    assert upd2.json()["unit_price"] == 14000.0

    ph2 = (await client.get(f"/api/v1/expenses/price-history?item_id={master_id}")).json()
    assert ph2["latest_price"] == 14000.0

    # 5. Ubah tanggal transaksi lama (Rp 12.000) menjadi lebih baru (2026-10-25) ->
    # latest price HARUS Rp 12.000 (bukan MAX Rp 14.000!)
    upd3 = await client.put(
        f"/api/v1/expenses/{tx_old_id}",
        json={"expense_date": "2026-10-25"},
    )
    assert upd3.status_code == 200

    ph3 = (await client.get(f"/api/v1/expenses/price-history?item_id={master_id}")).json()
    assert ph3["latest_price"] == 12000.0
    assert [h["id"] for h in ph3["history"]] == [tx_old_id, tx_new_id]

    mi3 = next(
        i for i in (await client.get("/api/v1/master-items")).json()["data"] if i["id"] == master_id
    )
    assert mi3["last_unit_price"] == 12000.0
    assert mi3["last_supplier"] == "Toko Lama"

    # 6. Hapus transaksi paling baru (tx_old_id, tanggal 2026-10-25) ->
    # hilang dari Riwayat Harga dan harga item mundur ke transaksi terbaru sebelumnya (Rp 14.000)
    del1 = await client.delete(f"/api/v1/expenses/{tx_old_id}")
    assert del1.status_code == 200

    ph4 = (await client.get(f"/api/v1/expenses/price-history?item_id={master_id}")).json()
    assert ph4["tx_count"] == 1
    assert ph4["latest_price"] == 14000.0
    assert [h["id"] for h in ph4["history"]] == [tx_new_id]

    mi4 = next(
        i for i in (await client.get("/api/v1/master-items")).json()["data"] if i["id"] == master_id
    )
    assert mi4["last_unit_price"] == 14000.0
    assert mi4["last_supplier"] == "Toko Baru"
    assert mi4["tx_count"] == 1

    sug4 = next(
        i
        for i in (await client.get("/api/v1/master-items/suggestions")).json()["items"]
        if i.get("id") == master_id
    )
    assert sug4["last_unit_price"] == 14000.0
    assert sug4["tx_count"] == 1


@pytest.mark.asyncio
async def test_delete_all_transactions_does_not_leak_other_master_items(
    client, auth_cookies
):
    """
    Saat semua transaksi MasterItem 'Gula' dihapus, Riwayat Harga 'Gula'
    harus kosong (tx_count=0, latest_price=0) dan TIDAK menarik transaksi 'Gula Halus'.
    """
    client.cookies.update(auth_cookies)

    m_gula = (
        await client.post(
            "/api/v1/master-items",
            json={"item_name": "Gula", "category": "Bahan Kue", "satuan_beli": "Kg"},
        )
    ).json()
    m_gula_halus = (
        await client.post(
            "/api/v1/master-items",
            json={"item_name": "Gula Halus", "category": "Bahan Kue", "satuan_beli": "Kg"},
        )
    ).json()

    tx_gula = (
        await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": "2026-10-10",
                "supplier": "Toko A",
                "item_name": "Gula",
                "qty": 1,
                "unit": "Kg",
                "category": "Bahan Kue",
                "unit_price": 17000,
                "total_price": 17000,
                "master_item_id": m_gula["id"],
            },
        )
    ).json()

    tx_halus = (
        await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": "2026-10-12",
                "supplier": "Toko B",
                "item_name": "Gula Halus",
                "qty": 1,
                "unit": "Kg",
                "category": "Bahan Kue",
                "unit_price": 23000,
                "total_price": 23000,
                "master_item_id": m_gula_halus["id"],
            },
        )
    ).json()

    # Hapus transaksi satu-satunya milik 'Gula'
    del_res = await client.delete(f"/api/v1/expenses/{tx_gula['id']}")
    assert del_res.status_code == 200

    ph_gula = (
        await client.get(
            f"/api/v1/expenses/price-history?item_id={m_gula['id']}&item_name=Gula"
        )
    ).json()
    assert ph_gula["tx_count"] == 0
    assert ph_gula["latest_price"] == 0.0
    assert ph_gula["history"] == []

    # MasterItem 'Gula' harus kembali ke harga 0 & 0 transaksi
    items = (await client.get("/api/v1/master-items")).json()["data"]
    gula_row = next(i for i in items if i["id"] == m_gula["id"])
    halus_row = next(i for i in items if i["id"] == m_gula_halus["id"])
    assert gula_row["tx_count"] == 0
    assert gula_row["last_unit_price"] == 0.0
    assert halus_row["tx_count"] == 1
    assert halus_row["last_unit_price"] == 23000.0

    # Uji edit item_name transaksi dari 'Gula Halus' ke 'Gula' (bahkan jika payload masih mengirim master_item_id lama)
    edit_res = await client.put(
        f"/api/v1/expenses/{tx_halus['id']}",
        json={
            "item_name": "Gula",
            "master_item_id": m_gula_halus["id"],
            "unit_price": 18500,
            "total_price": 18500,
        },
    )
    assert edit_res.status_code == 200
    assert edit_res.json()["master_item_id"] == m_gula["id"]

    ph_gula_after = (
        await client.get(f"/api/v1/expenses/price-history?item_id={m_gula['id']}")
    ).json()
    assert ph_gula_after["tx_count"] == 1
    assert ph_gula_after["latest_price"] == 18500.0

    ph_halus_after = (
        await client.get(f"/api/v1/expenses/price-history?item_id={m_gula_halus['id']}")
    ).json()
    assert ph_halus_after["tx_count"] == 0
    assert ph_halus_after["latest_price"] == 0.0


@pytest.mark.asyncio
async def test_audit_merge_and_search_last_price_use_latest_not_max(
    client, auth_cookies, db
):
    client.cookies.update(auth_cookies)

    m1 = await create_master_item(db, item_name="Butter Anchor 2kg", category="Bahan Kue")
    m2 = await create_master_item(db, item_name="Butter Anchor 2 kg", category="Bahan Kue")
    await db.commit()

    # Transaksi lebih lama tetapi harga LEBIH MAHAL (Rp 320.000)
    r1 = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-09-01",
            "supplier": "Toko Mahal",
            "item_name": "Butter Anchor 2kg",
            "qty": 1,
            "unit": "Pcs",
            "category": "Bahan Kue",
            "unit_price": 320000,
            "total_price": 320000,
            "master_item_id": m1.id,
        },
    )
    assert r1.status_code == 201

    # Transaksi lebih baru tetapi harga LEBIH MURAH (Rp 295.000)
    r2 = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-20",
            "supplier": "Toko Baru",
            "item_name": "Butter Anchor 2 kg",
            "qty": 1,
            "unit": "Pcs",
            "category": "Bahan Kue",
            "unit_price": 295000,
            "total_price": 295000,
            "master_item_id": m2.id,
        },
    )
    assert r2.status_code == 201

    # Audit duplikat harus memakai latest price per item (bukan max)
    audit = await audit_duplicate_master_items(db, min_score=0.70)
    pair = next(
        p
        for p in audit["pairs"]
        if {p["item_a"]["id"], p["item_b"]["id"]} == {m1.id, m2.id}
    )
    stats_by_id = {
        pair["item_a"]["id"]: pair["item_a"],
        pair["item_b"]["id"]: pair["item_b"],
    }
    assert stats_by_id[m1.id]["last_unit_price"] == 320000.0
    assert stats_by_id[m2.id]["last_unit_price"] == 295000.0

    # Merge m2 -> m1: latest price hasil merge harus Rp 295.000 (transaksi tgl 2026-10-20), bukan MAX Rp 320.000
    merged = await merge_master_items(db, target_item_id=m1.id, source_item_ids=[m2.id])
    await db.commit()
    assert merged["target_item"]["last_unit_price"] == 295000.0
    assert merged["target_item"]["last_supplier"] == "Toko Baru"
    assert merged["target_item"]["tx_count"] == 2

    # Tambah transaksi backdated (ID lebih besar, tetapi tanggal lebih lama 2026-08-01)
    r3 = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-08-01",
            "supplier": "Toko Backdate",
            "item_name": "Butter Anchor 2kg",
            "qty": 1,
            "unit": "Pcs",
            "category": "Bahan Kue",
            "unit_price": 350000,
            "total_price": 350000,
            "master_item_id": m1.id,
        },
    )
    assert r3.status_code == 201

    # search_last_price harus mengembalikan transaksi tanggal terbaru (2026-10-20, Rp 295.000), bukan ID terbesar
    latest_exp = await search_last_price(db, "Butter Anchor")
    assert latest_exp is not None
    assert latest_exp.expense_date == date(2026, 10, 20)
    assert float(latest_exp.unit_price) == 295000.0


@pytest.mark.asyncio
async def test_price_history_normalizes_to_master_recipe_unit_across_packagings(
    client, auth_cookies, db
):
    """
    Grafik inflasi & perbandingan harga antar toko harus menormalisasi harga ke satuan resep/terkecil
    ketika satu item dibeli dengan kemasan berbeda (mis. Dus 16kg vs Pouch 2kg) atau transaksi lama
    dibuat sebelum satuan resep dikonfigurasi.
    """
    client.cookies.update(auth_cookies)

    # 1. Buat transaksi lama SEBELUM MasterItem memiliki satuan_resep/packaging
    tx_legacy_res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-09-11",
            "supplier": "Alat Kopi Bandung",
            "item_name": "Susu Carnation Test",
            "qty": 2,
            "unit": "Dus",
            "category": "Bahan Kue",
            "unit_price": 436000,
            "total_price": 872000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
        },
    )
    assert tx_legacy_res.status_code == 201
    tx_legacy = tx_legacy_res.json()
    assert tx_legacy["base_unit_price"] is None

    # 2. Daftarkan MasterItem dengan satuan_resep='Gram' dan 2 varian kemasan (Dus 16000g & Pouch 2000g)
    m_res = await client.post(
        "/api/v1/master-items",
        json={
            "item_name": "Susu Carnation Test",
            "category": "Bahan Kue",
            "satuan_beli": "Dus",
            "satuan_ecer": "Pouch",
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
                    "keywords": "dus, karton",
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
                    "keywords": "pouch, 2kg",
                    "is_default": False,
                    "is_active": True,
                },
            ],
        },
    )
    assert m_res.status_code == 201, m_res.text
    mi = m_res.json()
    pkgs = {p["purchase_unit"]: p for p in mi["packagings"]}

    # 3. Beli eceran 24 Pouch @ Rp 61.000 (= Rp 30.5 / Gram) di Ny. Liem
    tx_pouch_res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-10-08",
            "supplier": "Ny. Liem",
            "item_name": "Susu Carnation Test",
            "master_item_id": mi["id"],
            "packaging_id": pkgs["Pouch"]["id"],
            "qty": 24,
            "unit": "Pouch",
            "category": "Bahan Kue",
            "unit_price": 61000,
            "total_price": 1464000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
        },
    )
    assert tx_pouch_res.status_code == 201
    assert tx_pouch_res.json()["base_unit_price"] == 30.5

    # 4. Beli 2 Dus @ Rp 488.000 (= Rp 30.5 / Gram) di Ny. Liem
    tx_dus_res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-11-02",
            "supplier": "Ny. Liem",
            "item_name": "Susu Carnation Test",
            "master_item_id": mi["id"],
            "packaging_id": pkgs["Dus"]["id"],
            "qty": 2,
            "unit": "Dus",
            "category": "Bahan Kue",
            "unit_price": 488000,
            "total_price": 976000,
            "pay_method": "Transfer",
            "pay_status": "Lunas",
        },
    )
    assert tx_dus_res.status_code == 201
    assert tx_dus_res.json()["base_unit_price"] == 30.5

    # 5. Cek price-history: semua transaksi termasuk transaksi legacy harus ternormalisasi ke Gram
    ph = (await client.get(f"/api/v1/expenses/price-history?item_id={mi['id']}")).json()
    assert ph["ok"] is True
    assert ph["base_unit"] == "Gram"
    assert ph["has_recipe_unit"] is True
    assert ph["tx_count"] == 3

    # Field satuan beli lama tetap terjaga untuk kompatibilitas API
    assert ph["latest_price"] == 488000.0
    assert ph["min_price"] == 61000.0

    # Field satuan terkecil / resep: Alat Kopi Bandung (436.000 / 16.000 = 27.25/Gram) paling murah!
    assert ph["base_min_price"] == 27.25
    assert ph["base_max_price"] == 30.5
    assert ph["base_latest_price"] == 30.5
    assert ph["base_cheapest_supplier"] == "Alat Kopi Bandung"
    assert ph["suppliers_comparison"][0]["supplier"] == "Alat Kopi Bandung"
    assert ph["suppliers_comparison"][0]["base_min_price"] == 27.25
    assert ph["suppliers_comparison"][1]["supplier"] == "Ny. Liem"
    assert ph["suppliers_comparison"][1]["base_min_price"] == 30.5

    by_id = {h["id"]: h for h in ph["history"]}
    assert by_id[tx_legacy["id"]]["base_unit"] == "Gram"
    assert by_id[tx_legacy["id"]]["base_unit_price"] == 27.25
    assert by_id[tx_pouch_res.json()["id"]]["base_unit_price"] == 30.5
    assert by_id[tx_dus_res.json()["id"]]["base_unit_price"] == 30.5


@pytest.mark.asyncio
async def test_price_history_unconfigured_container_unit_has_no_forced_base_unit(
    client, auth_cookies
):
    """Item tanpa satuan resep dan memakai unit kemasan tak terukur tidak memaksa base_unit."""
    client.cookies.update(auth_cookies)
    res = await client.post(
        "/api/v1/expenses",
        json={
            "expense_date": "2026-11-10",
            "supplier": "Toko Kemasan",
            "item_name": "Kardus Polos Custom",
            "qty": 5,
            "unit": "Bal",
            "category": "Kemasan",
            "unit_price": 75000,
            "total_price": 375000,
        },
    )
    assert res.status_code == 201
    ph = (await client.get("/api/v1/expenses/price-history?item_name=Kardus%20Polos%20Custom")).json()
    assert ph["base_unit"] is None
    assert ph["has_recipe_unit"] is False
    assert ph["base_latest_price"] is None
    assert ph["latest_price"] == 75000.0
