"""
tests/test_general_reports_service.py — Unit & API integration tests untuk modul Laporan Umum (MVP)
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import pytest

from app.models.expense import Expense
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.models.master_item import MasterItem
from app.models.menu_product import MenuIngredient, MenuProduct
from app.models.purchase_request import PurchaseRequest, PurchaseRequestItem
from app.models.supplier import Supplier
from app.services.general_reports_service import (
    calc_pct_change,
    export_hpp_csv,
    export_materials_csv,
    export_sales_csv,
    export_shipping_csv,
    get_hpp_report,
    get_materials_report,
    get_previous_period,
    get_sales_report,
    get_shipping_report,
    resolve_period,
    safe_pct,
)


def test_safe_pct_and_calc_pct_change():
    assert safe_pct(25.0, 100.0) == 25.0
    assert safe_pct(1.0, 3.0, decimals=2) == 33.33
    assert safe_pct(10.0, 0.0) is None
    assert safe_pct(10.0, -5.0) is None

    assert calc_pct_change(120.0, 100.0) == 20.0
    assert calc_pct_change(80.0, 100.0) == -20.0
    assert calc_pct_change(50.0, 0.0) is None


@pytest.mark.anyio
async def test_resolve_period_and_previous_period():
    s, e, label = await resolve_period(year=2026, month=11)
    assert s == date(2026, 11, 1)
    assert e == date(2026, 11, 30)
    assert label == "November 2026"
    ps, pe = get_previous_period(s, e)
    assert ps == date(2026, 10, 1)
    assert pe == date(2026, 10, 31)

    # Multi-bulan & Januari wrap
    s_jan, e_jan, _ = await resolve_period(year=2026, month=1)
    ps_jan, pe_jan = get_previous_period(s_jan, e_jan)
    assert ps_jan == date(2025, 12, 1)
    assert pe_jan == date(2025, 12, 31)

    # Rentang custom terbalik otomatis ditukar
    sc, ec, lbl_c = await resolve_period(
        start_date=date(2026, 11, 15),
        end_date=date(2026, 11, 5),
    )
    assert sc == date(2026, 11, 5)
    assert ec == date(2026, 11, 15)
    assert "2026-11-05" in lbl_c


@pytest.mark.anyio
async def test_materials_report_wap_conversion_drift_and_discrepancy(db):
    mi = MasterItem(
        item_name="Tepung Terigu",
        category="Bahan Kue",
        satuan_beli="Kg",
        satuan_resep="Gram",
        konversi_resep=1000.0,
    )
    db.add(mi)
    await db.flush()

    # Periode lalu (Oktober 2026): 10 Kg @ 10.000 = 100.000 -> WAP 10.000
    db.add(
        Expense(
            expense_date=date(2026, 10, 15),
            supplier="Toko Bahan Jaya",
            item_name="Tepung Terigu",
            qty=Decimal("10"),
            unit="Kg",
            category="Bahan Kue",
            unit_price=Decimal("10000"),
            total_price=Decimal("100000"),
            master_item_id=mi.id,
        )
    )
    # Periode berjalan (November 2026): 10 Kg @ 12.000 = 120.000 -> WAP 12.000 (+20% drift!)
    db.add(
        Expense(
            expense_date=date(2026, 11, 10),
            supplier="Toko Bahan Jaya",
            item_name="Tepung Terigu",
            qty=Decimal("10"),
            unit="Kg",
            category="Bahan Kue",
            unit_price=Decimal("12000"),
            total_price=Decimal("120000"),
            master_item_id=mi.id,
        )
    )
    # Ongkir & OPEX harus ter-filter keluar dari bahan
    db.add(
        Expense(
            expense_date=date(2026, 11, 11),
            supplier="GoSend",
            item_name="Ongkir Kirim Bahan",
            qty=Decimal("1"),
            unit="Trip",
            category="Ongkir",
            unit_price=Decimal("25000"),
            total_price=Decimal("25000"),
        )
    )
    db.add(
        Expense(
            expense_date=date(2026, 11, 12),
            supplier="PLN",
            item_name="Token Listrik",
            qty=Decimal("1"),
            unit="Pcs",
            category="Listrik & Air",
            unit_price=Decimal("200000"),
            total_price=Decimal("200000"),
        )
    )

    # Discrepancy penerimaan gudang
    pr = PurchaseRequest(request_number="PR-001", request_date=date(2026, 11, 8), title="Restock")
    db.add(pr)
    await db.flush()
    db.add(
        PurchaseRequestItem(
            request_id=pr.id,
            item_name="Tepung Terigu",
            master_item_id=mi.id,
            qty=Decimal("10"),
            qty_received=Decimal("8"),
            receiving_status="KURANG",
            received_at=datetime(2026, 11, 9, 14, 0, 0),
        )
    )
    await db.flush()

    res = await get_materials_report(db, year=2026, month=11)
    assert res["total_spend"] == 120000.0
    assert res["unique_suppliers"] == 1
    assert res["drifting_items"] == 1
    assert res["discrepancy_count"] == 1
    assert len(res["items"]) == 1

    item = res["items"][0]
    assert item["wap"] == 12000.0
    assert item["prev_wap"] == 10000.0
    assert item["price_drift_pct"] == 20.0
    assert item["is_drifting"] is True
    assert item["recipe_unit"] == "Gram"
    assert item["recipe_unit_cost"] == 12.0  # 12.000 / 1000

    csv_text = export_materials_csv(res)
    assert "Tepung Terigu" in csv_text
    assert "NAIK >=5%" in csv_text


@pytest.mark.anyio
async def test_shipping_report_no_double_counting(db):
    sup_kurir = Supplier(
        name="Lalamove",
        supplier_type="kurir",
        courier_category="Instan",
        is_subscribed=True,
    )
    db.add(sup_kurir)
    await db.flush()

    # Ongkir mandiri (talangan belum diganti)
    db.add(
        Expense(
            expense_date=date(2026, 11, 5),
            supplier="Lalamove",
            supplier_id=sup_kurir.id,
            item_name="Ongkir Kue Ulang Tahun",
            qty=Decimal("1"),
            category="Ongkir",
            total_price=Decimal("35000"),
            is_reimbursement=True,
            reimbursed_at=None,
        )
    )
    # Ongkir mandiri (kas toko)
    db.add(
        Expense(
            expense_date=date(2026, 11, 6),
            supplier="GoSend",
            item_name="Ongkir Customer",
            qty=Decimal("1"),
            category="Ongkir",
            total_price=Decimal("20000"),
            is_reimbursement=False,
        )
    )
    # Pembelian bahan dengan freight-in (shipping_fee) -> tidak boleh terhitung sebagai ongkir mandiri
    db.add(
        Expense(
            expense_date=date(2026, 11, 7),
            supplier="Toko Kemasan",
            item_name="Dus Kue",
            qty=Decimal("100"),
            category="Kemasan",
            unit_price=Decimal("2000"),
            shipping_fee=Decimal("15000"),
            total_price=Decimal("215000"),
        )
    )
    await db.flush()

    res = await get_shipping_report(db, year=2026, month=11)
    assert res["ongkir_mandiri_total"] == 55000.0
    assert res["ongkir_trip_count"] == 2
    assert res["freight_in_total"] == 15000.0
    assert res["freight_in_count"] == 1
    assert res["total_shipping_cost"] == 70000.0
    assert res["talangan_total"] == 35000.0
    assert res["talangan_pending_total"] == 35000.0
    assert res["kas_toko_total"] == 20000.0

    lala = next(c for c in res["couriers"] if c["courier"] == "Lalamove")
    assert lala["is_subscribed"] is True
    assert lala["trip_count"] == 1

    assert "Lalamove" in export_shipping_csv(res)


@pytest.mark.anyio
async def test_sales_report_three_layers_and_void(db):
    # Periode lalu
    db.add(
        IncomingTransaction(
            source_type="pos",
            receipt_no="POS-OCT-1",
            transaction_date=date(2026, 10, 20),
            order_type="Dine-in",
            payment_method="QRIS",
            gross_sales=100000.0,
            discount_amount=0.0,
            net_sales=100000.0,
            platform_fee=0.0,
            net_received=100000.0,
            status="paid",
        )
    )
    # Periode berjalan (paid)
    db.add(
        IncomingTransaction(
            source_type="pos",
            receipt_no="POS-NOV-1",
            transaction_date=date(2026, 11, 10),
            order_type="GoFood",
            payment_method="GoPay",
            gross_sales=150000.0,
            discount_amount=10000.0,
            net_sales=140000.0,
            platform_fee=28000.0,
            net_received=112000.0,
            status="paid",
        )
    )
    # Void transaction memakai cancellation_total
    db.add(
        IncomingTransaction(
            source_type="pos",
            receipt_no="POS-NOV-2",
            transaction_date=date(2026, 11, 11),
            order_type="GoFood",
            payment_method="GoPay",
            gross_sales=0.0,
            net_sales=0.0,
            net_received=0.0,
            cancellation_total=50000.0,
            status="void",
        )
    )
    await db.flush()

    res = await get_sales_report(db, year=2026, month=11)
    assert res["total_orders"] == 1
    assert res["total_gross_sales"] == 150000.0
    assert res["total_net_sales"] == 140000.0
    assert res["total_net_received"] == 112000.0
    assert res["void_count"] == 1
    assert res["void_nominal"] == 50000.0
    assert res["void_rate_pct"] == 50.0
    assert res["mom_growth_pct"] == 40.0

    assert "GoFood" in export_sales_csv(res)


@pytest.mark.anyio
async def test_hpp_report_menu_engineering_and_unmatched(db):
    m1 = MenuProduct(
        name="Chiffon Pandan",
        anonymous_name="Menu A",
        category="Cake",
        item_type="finished",
        is_sellable=True,
        selling_price=50000.0,
        hpp_manual=15000.0,
        hpp_mode="manual",
    )
    m2 = MenuProduct(
        name="Brownies Mini",
        anonymous_name="Menu B",
        category="Cake",
        item_type="finished",
        is_sellable=True,
        selling_price=20000.0,
        hpp_manual=12000.0,
        hpp_mode="manual",
    )
    # Sub-resep non-sellable tidak boleh masuk Menu Engineering
    m_sub = MenuProduct(
        name="Buttercream Base",
        anonymous_name="Sub 1",
        category="Base",
        item_type="prepared",
        is_sellable=False,
        selling_price=0.0,
        hpp_manual=5000.0,
        hpp_mode="manual",
    )
    db.add_all([m1, m2, m_sub])
    await db.flush()

    tx = IncomingTransaction(
        source_type="pos",
        receipt_no="POS-HPP-1",
        transaction_date=date(2026, 11, 14),
        order_type="Dine-in",
        payment_method="Tunai",
        gross_sales=520000.0,
        net_sales=520000.0,
        net_received=520000.0,
        status="paid",
    )
    db.add(tx)
    await db.flush()

    db.add_all([
        IncomingTransactionItem(
            transaction_id=tx.id,
            product_name="Chiffon Pandan",
            qty=10.0,
            unit_price=50000.0,
            gross_amount=500000.0,
        ),
        IncomingTransactionItem(
            transaction_id=tx.id,
            product_name="Produk Baru Belum Mapping",
            qty=1.0,
            unit_price=20000.0,
            gross_amount=20000.0,
        ),
    ])
    db.add(
        Expense(
            expense_date=date(2026, 11, 14),
            supplier="Toko Bahan",
            item_name="Telur & Tepung",
            qty=Decimal("5"),
            category="Bahan Kue",
            total_price=Decimal("200000"),
        )
    )
    await db.flush()

    res = await get_hpp_report(db, year=2026, month=11)
    assert res["theoretical_hpp_total"] == 150000.0  # 10 * 15000
    assert res["actual_purchase_hpp"] == 200000.0
    assert res["unmatched_items"] == ["Produk Baru Belum Mapping"]
    menu_names = [m["menu_name"] for m in res["menus"]]
    assert "Chiffon Pandan" in menu_names
    assert "Buttercream Base" not in menu_names
    chiffon = next(m for m in res["menus"] if m["menu_name"] == "Chiffon Pandan")
    assert chiffon["classification"] == "Star"

    assert "Chiffon Pandan" in export_hpp_csv(res)


@pytest.mark.anyio
async def test_general_reports_api_endpoints_smoke(client, auth_cookies):
    client.cookies.update(auth_cookies)
    for path in (
        "/api/v1/reports/general/materials?year=2026&month=11",
        "/api/v1/reports/general/shipping?year=2026&month=11",
        "/api/v1/reports/general/sales?year=2026&month=11",
        "/api/v1/reports/general/hpp?year=2026&month=11",
    ):
        resp = await client.get(path)
        assert resp.status_code == 200, f"Gagal pada {path}: {resp.text}"
        body = resp.json()
        assert body["period"]["label"] == "November 2026"

    for export_path in (
        "/api/v1/reports/general/materials/export?year=2026&month=11",
        "/api/v1/reports/general/shipping/export?year=2026&month=11",
        "/api/v1/reports/general/sales/export?year=2026&month=11",
        "/api/v1/reports/general/hpp/export?year=2026&month=11",
    ):
        resp = await client.get(export_path)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
