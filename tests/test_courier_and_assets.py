"""
tests/test_courier_and_assets.py — Pengujian komprehensif Master Kurir Ongkir, Migrasi,
Inventaris Aset Tetap (SAK EMKM), Analisa Ulang Threshold, Label QR & Maintenance.
"""
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.expense import Expense
from app.models.fixed_asset import AssetMaintenance, FixedAsset
from app.models.supplier import Supplier
from app.services.accounting_service import get_accounting_report
from app.services.asset_service import (
    calculate_asset_depreciation,
    reanalyze_assets_by_threshold,
    sync_existing_asset_expenses,
)
from app.services.expense_service import get_monthly_report, save_expenses
from app.services.supplier_service import migrate_legacy_ongkir_expenses


@pytest.mark.asyncio
async def test_migrate_legacy_ongkir_and_courier_suppliers(db, client, auth_cookies):
    # 1. Buat data historis campuran: Operasional (Ongkir), Operasional (bukan Ongkir), dan kurir langganan
    exp_ongkir_gosend = Expense(
        expense_date=date(2026, 11, 5),
        supplier="GoSend Car",
        item_name="Ongkir",
        qty=Decimal("1"),
        unit="Trip",
        category="Operasional",
        unit_price=Decimal("35000"),
        total_price=Decimal("35000"),
        pay_method="Tunai",
        pay_status="Lunas",
    )
    exp_ongkir_custom = Expense(
        expense_date=date(2026, 11, 6),
        supplier="Pak Budi Kurir",
        item_name="Ongkir Kue Pengantin",
        qty=Decimal("1"),
        unit="Trip",
        category="Operasional",
        unit_price=Decimal("75000"),
        total_price=Decimal("75000"),
        pay_method="Transfer",
        pay_status="Lunas",
    )
    exp_regular_ops = Expense(
        expense_date=date(2026, 11, 6),
        supplier="Agen Gas LPG",
        item_name="Gas LPG 12kg",
        qty=Decimal("1"),
        unit="Pcs",
        category="Operasional",
        unit_price=Decimal("215000"),
        total_price=Decimal("215000"),
        pay_method="Tunai",
        pay_status="Lunas",
    )
    db.add_all([exp_ongkir_gosend, exp_ongkir_custom, exp_regular_ops])
    await db.flush()

    # Dry run tidak mengubah DB
    dry_res = await migrate_legacy_ongkir_expenses(db, dry_run=True)
    assert dry_res["migrated_count"] == 2
    await db.refresh(exp_ongkir_gosend)
    assert exp_ongkir_gosend.category == "Operasional"

    # Eksekusi migrasi penuh
    mig_res = await migrate_legacy_ongkir_expenses(db, actor="test", dry_run=False)
    assert mig_res["ok"] is True
    assert mig_res["migrated_count"] == 2
    assert mig_res["reclassified_from_operasional"] == 2

    await db.refresh(exp_ongkir_gosend)
    await db.refresh(exp_ongkir_custom)
    await db.refresh(exp_regular_ops)

    assert exp_ongkir_gosend.category == "Ongkir"
    assert exp_ongkir_gosend.supplier == "GoSend"
    assert exp_ongkir_gosend.supplier_id is not None

    assert exp_ongkir_custom.category == "Ongkir"
    assert exp_ongkir_custom.supplier == "Pak Budi Kurir"
    assert exp_ongkir_custom.supplier_id is not None

    # Pengeluaran Operasional reguler tetap Operasional
    assert exp_regular_ops.category == "Operasional"

    # Cek API GET /api/v1/suppliers?supplier_type=kurir
    client.cookies.update(auth_cookies)
    res = await client.get("/api/v1/suppliers?supplier_type=kurir&limit=50")
    assert res.status_code == 200
    names = {it["name"] for it in res.json()["items"]}
    assert {"GoSend", "GoCar", "Lalamove", "GrabExpress", "Shopee Express", "Maxim", "JNE", "Pak Budi Kurir"} <= names

    # Cek save_expenses kategori Ongkir langsung menautkan supplier_type='kurir'
    saved = await save_expenses(
        db,
        items=[{
            "tanggal": "2026-11-10",
            "barang": "Ongkir Kirim Hampers",
            "qty": 1,
            "satuan": "Trip",
            "kategori": "Ongkir",
            "harga_satuan": 45000,
            "total_harga": 45000,
            "toko_supplier": "Shopee Express",
            "metode_bayar": "Transfer",
        }],
    )
    assert len(saved) == 1
    assert saved[0].category == "Ongkir"
    assert saved[0].supplier == "Shopee Express"
    assert saved[0].supplier_id is not None
    sup_row = await db.get(Supplier, saved[0].supplier_id)
    assert sup_row is not None and sup_row.supplier_type == "kurir"

    # Cek ongkir_by_courier di laporan bulanan
    rep = await get_monthly_report(db, 2026, 11)
    assert rep["ongkir_count"] == 3
    courier_names = {c["courier_name"] for c in rep["ongkir_by_courier"]}
    assert {"GoSend", "Pak Budi Kurir", "Shopee Express"} <= courier_names


@pytest.mark.asyncio
async def test_asset_auto_sync_reanalyze_qr_and_accounting(db, client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Input pengeluaran Asset bernilai besar (qty=2 unit @ 2.400.000 = 4.800.000) -> auto-split 2 unit capitalized
    res_big = await client.post("/api/v1/expenses", json={
        "expense_date": "2026-10-01",
        "supplier": "Guataka Mesin",
        "item_name": "Showcase Chiller Cake",
        "qty": 2,
        "unit": "Pcs",
        "category": "Asset",
        "unit_price": 2400000,
        "total_price": 4800000,
        "pay_method": "Transfer",
        "pay_status": "Lunas",
        "warranty_months": 12,
        "useful_life_months": 24,
        "asset_location": "Area Display Toko",
    })
    assert res_big.status_code == 201, res_big.text
    big_exp_id = res_big.json()["id"]

    # 2. Input pengeluaran Asset bernilai kecil (Rp 300.000 < default 500.000) -> expensed_low_value
    res_small = await client.post("/api/v1/expenses", json={
        "expense_date": "2026-10-05",
        "supplier": "Toko Loyang Jaya",
        "item_name": "Loyang Kotak Set",
        "qty": 1,
        "unit": "Pack",
        "category": "Asset",
        "unit_price": 300000,
        "total_price": 300000,
        "pay_method": "Tunai",
        "pay_status": "Lunas",
    })
    assert res_small.status_code == 201, res_small.text

    assets_res = await client.get("/api/v1/assets")
    assert assets_res.status_code == 200
    assets_data = assets_res.json()
    assert assets_data["summary"]["total_assets"] == 3
    assert assets_data["summary"]["capitalized_count"] == 2
    assert assets_data["summary"]["low_value_count"] == 1

    chiller_assets = [a for a in assets_data["items"] if a["expense_id"] == big_exp_id]
    assert len(chiller_assets) == 2
    first_chiller = chiller_assets[0]
    assert first_chiller["asset_code"].startswith("AST-2026-")
    assert first_chiller["acquisition_cost"] == 2400000.0
    assert first_chiller["monthly_depreciation"] == 100000.0  # 2.400.000 / 24 bln

    # 3. Verifikasi Laporan Akuntansi SAK EMKM (Oktober & November 2026)
    rep_oct = await get_accounting_report(db, 2026, 10)
    # Di Oktober: 2 chiller x 100.000 = 200.000 beban penyusutan, 300.000 beban peralatan nilai rendah
    assert rep_oct["laba_rugi"]["depreciation_expense"] == 200000.0
    assert rep_oct["laba_rugi"]["low_value_asset_expense"] == 300000.0
    assert rep_oct["neraca"]["aset_tetap_summary"]["gross_cost"] == 4800000.0
    assert rep_oct["neraca"]["aset_tetap_summary"]["accumulated_depreciation"] == 200000.0
    assert rep_oct["neraca"]["aset_tetap_summary"]["net_book_value"] == 4600000.0
    # Arus kas investasi hanya belanja capex dikapitalisasi bulan Oct (5.100.000 - 300.000 = 4.800.000)
    assert rep_oct["arus_kas"]["subtotal_investasi"] == 4800000.0

    # Di November (bulan ke-2): akumulasi jadi 400.000, nilai buku 4.400.000, low-value Oct tidak masuk beban Nov
    rep_nov = await get_accounting_report(db, 2026, 11)
    assert rep_nov["laba_rugi"]["depreciation_expense"] == 200000.0
    assert rep_nov["laba_rugi"]["low_value_asset_expense"] == 0.0
    assert rep_nov["neraca"]["aset_tetap_summary"]["accumulated_depreciation"] == 400000.0
    assert rep_nov["neraca"]["aset_tetap_summary"]["net_book_value"] == 4400000.0

    # 4. Uji Maintenance tertaut ke aset (via Expense Maintenance + langsung via /assets/{id}/maintenances)
    maint_exp = await client.post("/api/v1/expenses", json={
        "expense_date": "2026-11-12",
        "supplier": "Teknisi Pendingin Jaya",
        "item_name": "Cuci & Isi Freon Showcase",
        "qty": 1,
        "unit": "Pcs",
        "category": "Maintenance",
        "unit_price": 250000,
        "total_price": 250000,
        "pay_method": "Tunai",
        "pay_status": "Lunas",
        "asset_id": first_chiller["id"],
        "next_service_date": "2027-02-12",
    })
    assert maint_exp.status_code == 201, maint_exp.text

    detail_res = await client.get(f"/api/v1/assets/{first_chiller['id']}")
    assert detail_res.status_code == 200
    assert detail_res.json()["asset"]["maintenance_count"] == 1
    assert detail_res.json()["asset"]["total_maintenance_cost"] == 250000.0
    assert detail_res.json()["asset"]["total_cost_of_ownership"] == 2650000.0

    # 5. Uji keamanan QR Label Publik (tanpa cookie admin tidak boleh membocorkan data finansial)
    qr_token = first_chiller["qr_token"]
    client.cookies.clear()
    pub_res = await client.get(f"/api/v1/assets/label/{qr_token}")
    assert pub_res.status_code == 200
    pub_asset = pub_res.json()["asset"]
    assert pub_asset["is_public_view"] is True
    assert pub_asset["asset_code"] == first_chiller["asset_code"]
    assert "acquisition_cost" not in pub_asset
    assert "net_book_value" not in pub_asset
    assert pub_asset["maintenance_count"] == 1
    assert "cost" not in pub_asset["maintenances"][0]

    # Dengan cookie admin, data finansial lengkap tampil
    client.cookies.update(auth_cookies)
    adm_qr_res = await client.get(f"/api/v1/assets/label/{qr_token}")
    assert adm_qr_res.status_code == 200
    assert adm_qr_res.json()["asset"]["is_public_view"] is False
    assert adm_qr_res.json()["asset"]["acquisition_cost"] == 2400000.0

    # 6. Uji Override + Tombol Analisa Ulang Aset (Reanalyze)
    second_chiller = chiller_assets[1]
    await client.put(f"/api/v1/assets/{second_chiller['id']}", json={
        "is_capitalization_overridden": True,
    })

    # Naikkan minimal harga aset ke Rp 3.000.000 -> first_chiller turun ke low-value, second_chiller tetap karena di-override
    reanalyze_up = await client.post("/api/v1/assets/reanalyze", json={
        "asset_capitalization_threshold": 3000000,
    })
    assert reanalyze_up.status_code == 200
    rup = reanalyze_up.json()
    assert rup["moved_to_low_value"] == 1
    assert rup["overridden_skipped"] == 1
    assert rup["capitalized_total_after"] == 2400000.0

    # Kembalikan minimal ke Rp 500.000 -> first_chiller kembali ke capitalized
    reanalyze_down = await client.post("/api/v1/assets/reanalyze", json={
        "asset_capitalization_threshold": 500000,
    })
    assert reanalyze_down.status_code == 200
    assert reanalyze_down.json()["promoted_to_capitalized"] == 1

    # 7. Uji Disposal (Penjualan/Penghapusan Aset)
    disp_res = await client.post(f"/api/v1/assets/{first_chiller['id']}/dispose", json={
        "disposed_at": "2026-11-20",
        "disposal_type": "dijual",
        "disposal_proceeds": 2500000,
        "disposal_notes": "Upgrade unit lebih besar",
    })
    assert disp_res.status_code == 200
    assert disp_res.json()["asset"]["status"] == "Dijual"

    # Pada bulan pelepasan (Nov), aset yg dijual tidak lagi masuk aset aktif Neraca (hanya second_chiller yang tersisa)
    rep_nov_after_dispose = await get_accounting_report(db, 2026, 11)
    assert rep_nov_after_dispose["neraca"]["aset_tetap_summary"]["gross_cost"] == 2400000.0
    # Gain/loss: proceeds 2.500.000 - book_val_at_disposal (2.400.000 - 100.000 susut Oct) = +200.000
    assert rep_nov_after_dispose["laba_rugi"]["disposal_gain_loss"] == 200000.0


@pytest.mark.asyncio
async def test_sync_existing_asset_expenses_backfill(db):
    raw_asset = Expense(
        expense_date=date(2026, 9, 15),
        supplier="Toko Oven",
        item_name="Oven Convection",
        qty=Decimal("1"),
        unit="Pcs",
        category="Asset",
        unit_price=Decimal("3600000"),
        total_price=Decimal("3600000"),
        pay_method="Transfer",
        pay_status="Lunas",
        notes="[Penempatan: Dapur Produksi] | [Kondisi: Baru (Garansi Resmi 1 Thn)]",
    )
    db.add(raw_asset)
    await db.flush()

    res = await sync_existing_asset_expenses(db)
    assert res["synced_expenses"] == 1
    assert res["created_assets"] == 1

    ast = (await db.execute(select(FixedAsset).where(FixedAsset.expense_id == raw_asset.id))).scalar_one()
    assert ast.location == "Dapur Produksi"
    assert ast.warranty_months == 12
    assert ast.capitalization_status == "capitalized"

    dep = calculate_asset_depreciation(ast, 2026, 10)
    assert dep["accumulated_depreciation"] > 0
