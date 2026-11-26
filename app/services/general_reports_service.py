"""
app/services/general_reports_service.py — Layanan Laporan Umum (Operasional & Manajerial)
Menyediakan laporan di luar SAK EMKM:
1. Laporan Bahan Baku, Kemasan & Pergerakan Harga (Materials)
2. Laporan Ongkir & Logistik Kurir (Shipping)
3. Laporan Omset & Performa Channel Penjualan (Sales)
4. Laporan HPP Pembelian vs Teoritis & Menu Engineering (HPP)
"""
from __future__ import annotations

import csv
import io
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import Expense
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.models.master_item import MasterItem
from app.models.purchase_request import PurchaseRequestItem
from app.models.supplier import Supplier
from app.services.accounting_service import _classify_expense_group
from app.services.master_data_service import get_category_accounting_map
from app.services.menu_product_service import (
    DEFAULT_PRICING_CHANNELS,
    PRICE_DRIFT_THRESHOLD_PCT,
    build_master_price_history_map,
    load_all_menus_graph,
    resolve_all_menu_financials,
)

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

_COURIER_SUPPLIER_KEYWORDS = (
    "gosend", "gocar", "grabexpress", "lalamove", "maxim",
    "shopee express", "spx", "jne", "j&t", "sicepat", "anteraja",
)

_VOID_STATUSES = ("void", "cancelled")


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def safe_pct(numerator: float, denominator: float, decimals: int = 1) -> float | None:
    """Hitung persentase dengan aman; kembalikan None jika denominator <= 0."""
    if not denominator or denominator <= 0:
        return None
    return round((numerator / denominator) * 100.0, decimals)


def calc_pct_change(current: float, previous: float) -> float | None:
    """Hitung persentase perubahan vs periode sebelumnya; kembalikan None jika previous <= 0."""
    if not previous or previous <= 0:
        return None
    return round(((current - previous) / previous) * 100.0, 1)


async def resolve_period(
    year: int | None = None,
    month: int | None = None,
    month_end: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> tuple[date, date, str]:
    """
    Resolusi rentang tanggal dari parameter query.
    Prioritas: start_date/end_date > year+month > bulan berjalan.
    Mengembalikan (start_date, end_date, label).
    """
    today = date.today()

    if start_date and end_date:
        if start_date > end_date:
            start_date, end_date = end_date, start_date
        label = f"{start_date.isoformat()} s/d {end_date.isoformat()}"
        return start_date, end_date, label

    resolved_year = max(2000, min(2100, year or today.year))
    resolved_month = max(1, min(12, month or today.month))
    resolved_month_end = (
        max(resolved_month, min(12, month_end)) if month_end is not None else resolved_month
    )

    start = date(resolved_year, resolved_month, 1)
    last_day = monthrange(resolved_year, resolved_month_end)[1]
    end = date(resolved_year, resolved_month_end, last_day)

    if resolved_month == resolved_month_end:
        label = f"{MONTH_NAMES[resolved_month - 1]} {resolved_year}"
    else:
        label = f"{MONTH_NAMES[resolved_month - 1]}–{MONTH_NAMES[resolved_month_end - 1]} {resolved_year}"

    return start, end, label


def get_previous_period(start_date: date, end_date: date) -> tuple[date, date]:
    """
    Hitung periode pembanding tepat sebelum rentang berjalan:
    - Jika rentang adalah bulan kalender penuh (tgl 1 s/d akhir bulan), geser mundur sejumlah bulan tersebut.
    - Selain itu geser mundur sejumlah durasi hari yang sama.
    """
    is_full_calendar_span = (
        start_date.day == 1
        and end_date.day == monthrange(end_date.year, end_date.month)[1]
    )
    if is_full_calendar_span:
        months_span = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month) + 1
        prev_end = start_date - timedelta(days=1)
        prev_start_year = start_date.year
        prev_start_month = start_date.month - months_span
        while prev_start_month <= 0:
            prev_start_month += 12
            prev_start_year -= 1
        prev_start = date(prev_start_year, prev_start_month, 1)
        return prev_start, prev_end

    duration_days = (end_date - start_date).days
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=duration_days)
    return prev_start, prev_end


def _is_ongkir_expense(
    category: str | None,
    item_name: str | None,
    supplier: str | None,
) -> bool:
    """Deteksi apakah baris expense merupakan transaksi ongkir / kurir mandiri."""
    kat_l = (category or "").strip().lower()
    item_l = (item_name or "").lower()
    sup_l = (supplier or "").lower()
    return (
        kat_l == "ongkir"
        or item_l.startswith("ongkir")
        or "ongkir" in item_l
        or any(k in sup_l for k in _COURIER_SUPPLIER_KEYWORDS)
    )


def _is_material_expense(
    category: str | None,
    item_name: str | None,
    supplier: str | None,
    coa_map: dict[str, dict[str, str | None]],
) -> bool:
    """
    Re-use klasifikasi COA dari accounting_service:
    Termasuk HPP dan bukan ongkir kurir mandiri.
    """
    if _is_ongkir_expense(category, item_name, supplier):
        return False
    return _classify_expense_group(category, item_name, supplier, coa_map) == "HPP"


def _csv_response_text(headers: list[str], rows: list[list[Any]]) -> str:
    """Format header dan baris data menjadi string CSV UTF-8 dengan BOM untuk Excel."""
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


async def _fetch_period_net_sales(
    db: AsyncSession,
    start_date: date,
    end_date: date,
) -> float:
    """Ambil total net_sales transaksi aktif (non-void/non-cancelled) pada periode."""
    stmt = select(func.coalesce(func.sum(IncomingTransaction.net_sales), 0.0)).where(
        and_(
            IncomingTransaction.transaction_date >= start_date,
            IncomingTransaction.transaction_date <= end_date,
            func.lower(IncomingTransaction.status).notin_(_VOID_STATUSES),
        )
    )
    return float((await db.execute(stmt)).scalar() or 0.0)


# ─────────────────────────────────────────────────────────────────────────────
# Report A: Materials (Laporan Bahan Baku, Kemasan & Pergerakan Harga)
# ─────────────────────────────────────────────────────────────────────────────

async def get_materials_report(
    db: AsyncSession,
    year: int | None = None,
    month: int | None = None,
    month_end: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """
    Laporan bahan baku, kemasan, dan pergerakan harga (berbasis pembelian):
    - Total belanja bruto (qty * unit_price) & netto/landed cost (total_price)
    - Weighted Average Price (WAP) per item + konversi ke satuan resep jika tersedia
    - Deteksi kenaikan harga >= PRICE_DRIFT_THRESHOLD_PCT (5%) dibanding periode sebelumnya
    - Breakdown per supplier & jumlah selisih penerimaan gudang (KURANG/LEBIH/RUSAK)
    """
    s_date, e_date, label = await resolve_period(year, month, month_end, start_date, end_date)
    prev_start, prev_end = get_previous_period(s_date, e_date)
    coa_map = await get_category_accounting_map(db)

    stmt_cur = select(
        Expense.master_item_id,
        Expense.item_name,
        Expense.category,
        Expense.supplier,
        Expense.qty,
        Expense.unit,
        Expense.unit_price,
        Expense.total_price,
        Expense.base_qty,
        Expense.base_unit,
        Expense.review_status,
    ).where(
        and_(
            Expense.expense_date >= s_date,
            Expense.expense_date <= e_date,
        )
    )
    cur_rows = (await db.execute(stmt_cur)).fetchall()

    item_agg: dict[str, dict[str, Any]] = {}
    supplier_agg: dict[str, dict[str, Any]] = {}
    unique_suppliers: set[str] = set()
    total_bruto = 0.0

    for master_item_id, item_name, category, supplier, qty, unit, unit_price, total_price, base_qty, base_unit, review_status in cur_rows:
        if (review_status or "CONFIRMED") == "DRAFT_WARNING":
            continue
        if not _is_material_expense(category, item_name, supplier, coa_map):
            continue

        key = f"mid:{master_item_id}" if master_item_id else f"name:{(item_name or '').strip().lower()}"
        qty_f = float(qty or 0.0)
        unit_price_f = float(unit_price or 0.0)
        total_f = float(total_price or 0.0)
        bruto_f = (qty_f * unit_price_f) if (qty_f > 0 and unit_price_f > 0) else total_f
        sup_name = (supplier or "-").strip()

        total_bruto += bruto_f

        if key not in item_agg:
            item_agg[key] = {
                "master_item_id": master_item_id,
                "item_name": item_name or "-",
                "category": category or "Bahan Kue",
                "supplier": sup_name,
                "total_qty": 0.0,
                "total_base_qty": 0.0,
                "base_unit": base_unit,
                "total_spend": 0.0,
                "total_bruto": 0.0,
                "tx_count": 0,
                "unit": unit or "Pcs",
            }

        item_agg[key]["total_qty"] += qty_f
        if base_qty is not None and float(base_qty) > 0:
            item_agg[key]["total_base_qty"] += float(base_qty)
            if not item_agg[key]["base_unit"] and base_unit:
                item_agg[key]["base_unit"] = base_unit
        item_agg[key]["total_spend"] += total_f
        item_agg[key]["total_bruto"] += bruto_f
        item_agg[key]["tx_count"] += 1

        if sup_name and sup_name != "-":
            unique_suppliers.add(sup_name)
            if sup_name not in supplier_agg:
                supplier_agg[sup_name] = {"supplier": sup_name, "total_spend": 0.0, "tx_count": 0}
            supplier_agg[sup_name]["total_spend"] += total_f
            supplier_agg[sup_name]["tx_count"] += 1

    # Lookup MasterItem untuk satuan beli & konversi satuan resep
    master_ids = [v["master_item_id"] for v in item_agg.values() if v["master_item_id"]]
    master_map: dict[int, MasterItem] = {}
    if master_ids:
        mi_res = await db.execute(select(MasterItem).where(MasterItem.id.in_(master_ids)))
        for mi in mi_res.scalars().all():
            master_map[mi.id] = mi

    # Periode sebelumnya untuk perbandingan WAP (Price Drift)
    prev_rows = (
        await db.execute(
            select(
                Expense.master_item_id,
                Expense.item_name,
                Expense.category,
                Expense.supplier,
                Expense.qty,
                Expense.total_price,
                Expense.review_status,
            ).where(
                and_(
                    Expense.expense_date >= prev_start,
                    Expense.expense_date <= prev_end,
                )
            )
        )
    ).fetchall()

    prev_agg: dict[str, dict[str, float]] = {}
    for master_item_id, item_name, category, supplier, qty, total_price, review_status in prev_rows:
        if (review_status or "CONFIRMED") == "DRAFT_WARNING":
            continue
        if not _is_material_expense(category, item_name, supplier, coa_map):
            continue
        pk = f"mid:{master_item_id}" if master_item_id else f"name:{(item_name or '').strip().lower()}"
        if pk not in prev_agg:
            prev_agg[pk] = {"total_qty": 0.0, "total_spend": 0.0}
        prev_agg[pk]["total_qty"] += float(qty or 0.0)
        prev_agg[pk]["total_spend"] += float(total_price or 0.0)

    # Discrepancy count dari PurchaseRequestItem pada periode
    dt_start = datetime.combine(s_date, time.min)
    dt_end = datetime.combine(e_date, time.max)
    disc_count = int(
        (
            await db.execute(
                select(func.count(PurchaseRequestItem.id)).where(
                    and_(
                        PurchaseRequestItem.receiving_status.in_(["KURANG", "LEBIH", "RUSAK"]),
                        func.coalesce(PurchaseRequestItem.received_at, PurchaseRequestItem.created_at) >= dt_start,
                        func.coalesce(PurchaseRequestItem.received_at, PurchaseRequestItem.created_at) <= dt_end,
                    )
                )
            )
        ).scalar()
        or 0
    )

    items_out: list[dict[str, Any]] = []
    drifting_count = 0

    for key, agg in item_agg.items():
        total_qty = agg["total_qty"]
        total_spend = agg["total_spend"]
        wap = (total_spend / total_qty) if total_qty > 0 else 0.0

        mid = agg["master_item_id"]
        mi = master_map.get(mid) if mid else None
        unit = (mi.satuan_beli if mi and mi.satuan_beli else agg["unit"]) or "Pcs"

        recipe_unit = agg["base_unit"] or (mi.satuan_resep if mi and mi.satuan_resep else None)
        recipe_unit_cost: float | None = None
        if agg["total_base_qty"] > 0 and agg["total_bruto"] > 0:
            recipe_unit_cost = round(agg["total_bruto"] / agg["total_base_qty"], 2)
        elif mi and mi.konversi_resep and mi.konversi_resep > 0 and wap > 0:
            recipe_unit_cost = round(wap / float(mi.konversi_resep), 2)

        prev_wap: float | None = None
        drift_pct: float | None = None
        is_drifting = False
        if key in prev_agg and prev_agg[key]["total_qty"] > 0:
            p_wap = prev_agg[key]["total_spend"] / prev_agg[key]["total_qty"]
            if p_wap > 0:
                prev_wap = round(p_wap, 2)
                drift_pct = calc_pct_change(wap, p_wap)
                is_drifting = drift_pct is not None and drift_pct >= PRICE_DRIFT_THRESHOLD_PCT

        if is_drifting:
            drifting_count += 1

        items_out.append({
            "item_name": agg["item_name"],
            "category": agg["category"],
            "supplier": agg["supplier"] if agg["supplier"] != "-" else None,
            "total_qty": round(total_qty, 3),
            "unit": unit,
            "tx_count": agg["tx_count"],
            "total_bruto": round(agg["total_bruto"], 2),
            "total_spend": round(total_spend, 2),
            "wap": round(wap, 2),
            "prev_wap": prev_wap,
            "recipe_unit": recipe_unit,
            "recipe_unit_cost": recipe_unit_cost,
            "price_drift_pct": drift_pct,
            "is_drifting": is_drifting,
        })

    items_out.sort(key=lambda x: x["total_spend"], reverse=True)
    total_spend = round(sum(x["total_spend"] for x in items_out), 2)
    net_sales = await _fetch_period_net_sales(db, s_date, e_date)

    supplier_breakdown = [
        {
            "supplier": s["supplier"],
            "total_spend": round(s["total_spend"], 2),
            "tx_count": s["tx_count"],
            "share_pct": safe_pct(s["total_spend"], total_spend) or 0.0,
        }
        for s in sorted(supplier_agg.values(), key=lambda x: -x["total_spend"])
    ]

    return {
        "period": {"start_date": s_date, "end_date": e_date, "label": label},
        "total_bruto": round(total_bruto, 2),
        "total_spend": total_spend,
        "material_to_sales_pct": safe_pct(total_spend, net_sales),
        "unique_suppliers": len(unique_suppliers),
        "drifting_items": drifting_count,
        "discrepancy_count": disc_count,
        "items": items_out,
        "supplier_breakdown": supplier_breakdown,
    }


def export_materials_csv(report: dict[str, Any]) -> str:
    headers = [
        "Nama Item", "Kategori", "Supplier Utama", "Qty Beli", "Satuan Beli",
        "Jml Transaksi", "Belanja Bruto", "Belanja Netto", "WAP (Harga Rata-rata)",
        "WAP Periode Lalu", "Drift Harga (%)", "Status Drift", "Satuan Resep", "Harga/Satuan Resep",
    ]
    rows = [
        [
            it["item_name"],
            it["category"],
            it["supplier"] or "-",
            it["total_qty"],
            it["unit"],
            it["tx_count"],
            it["total_bruto"],
            it["total_spend"],
            it["wap"],
            it["prev_wap"] if it["prev_wap"] is not None else "",
            it["price_drift_pct"] if it["price_drift_pct"] is not None else "",
            "NAIK >=5%" if it["is_drifting"] else "Normal",
            it["recipe_unit"] or "-",
            it["recipe_unit_cost"] if it["recipe_unit_cost"] is not None else "",
        ]
        for it in report.get("items", [])
    ]
    return _csv_response_text(headers, rows)


# ─────────────────────────────────────────────────────────────────────────────
# Report B: Shipping (Laporan Ongkir & Logistik Kurir)
# ─────────────────────────────────────────────────────────────────────────────

async def get_shipping_report(
    db: AsyncSession,
    year: int | None = None,
    month: int | None = None,
    month_end: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """
    Laporan ongkir yang memisahkan:
    - Ongkir Kurir Mandiri (transaksi expense kategori Ongkir / kurir)
    - Freight-In / Ongkir Pembelian (kolom shipping_fee pada transaksi non-ongkir)
    - Breakdown kurir (Supplier.is_subscribed, courier_category), kas toko vs talangan
    """
    s_date, e_date, label = await resolve_period(year, month, month_end, start_date, end_date)
    prev_start, prev_end = get_previous_period(s_date, e_date)
    coa_map = await get_category_accounting_map(db)

    stmt = select(
        Expense.supplier_id,
        Expense.supplier,
        Expense.item_name,
        Expense.category,
        Expense.total_price,
        Expense.shipping_fee,
        Expense.is_reimbursement,
        Expense.reimbursed_at,
    ).where(
        and_(
            Expense.expense_date >= s_date,
            Expense.expense_date <= e_date,
        )
    )
    rows = (await db.execute(stmt)).fetchall()

    # Load metadata Supplier untuk informasi langganan & kategori kurir
    sup_res = await db.execute(select(Supplier))
    sup_by_id: dict[int, Supplier] = {}
    sup_by_name: dict[str, Supplier] = {}
    for sup in sup_res.scalars().all():
        sup_by_id[sup.id] = sup
        sup_by_name[sup.name.strip().lower()] = sup

    ongkir_total = 0.0
    ongkir_trip_count = 0
    freight_in_total = 0.0
    freight_in_count = 0
    talangan_total = 0.0
    talangan_pending_total = 0.0
    kas_toko_total = 0.0
    material_spend_total = 0.0

    courier_agg: dict[str, dict[str, Any]] = {}

    for sup_id, supplier, item_name, category, total_price, shipping_fee, is_reimb, reimb_at in rows:
        tp = float(total_price or 0.0)
        sf = float(shipping_fee or 0.0)
        sup_name = (supplier or "-").strip()

        if _is_ongkir_expense(category, item_name, supplier):
            ongkir_total += tp
            ongkir_trip_count += 1

            if is_reimb:
                talangan_total += tp
                if reimb_at is None:
                    talangan_pending_total += tp
            else:
                kas_toko_total += tp

            sup_obj = sup_by_id.get(sup_id) if sup_id else sup_by_name.get(sup_name.lower())
            courier_label = sup_obj.name if sup_obj else (sup_name if sup_name != "-" else "Kurir Umum")

            if courier_label not in courier_agg:
                courier_agg[courier_label] = {
                    "courier": courier_label,
                    "courier_category": sup_obj.courier_category if sup_obj else None,
                    "is_subscribed": bool(sup_obj.is_subscribed) if sup_obj else False,
                    "trip_count": 0,
                    "total_cost": 0.0,
                    "talangan_cost": 0.0,
                    "kas_cost": 0.0,
                }
            c = courier_agg[courier_label]
            c["trip_count"] += 1
            c["total_cost"] += tp
            if is_reimb:
                c["talangan_cost"] += tp
            else:
                c["kas_cost"] += tp
        else:
            if sf > 0:
                freight_in_total += sf
                freight_in_count += 1
            if _is_material_expense(category, item_name, supplier, coa_map):
                material_spend_total += tp

    # Periode lalu untuk delta total ongkir
    prev_rows = (
        await db.execute(
            select(
                Expense.supplier,
                Expense.item_name,
                Expense.category,
                Expense.total_price,
                Expense.shipping_fee,
            ).where(
                and_(
                    Expense.expense_date >= prev_start,
                    Expense.expense_date <= prev_end,
                )
            )
        )
    ).fetchall()
    prev_total_shipping = 0.0
    for supplier, item_name, category, total_price, shipping_fee in prev_rows:
        if _is_ongkir_expense(category, item_name, supplier):
            prev_total_shipping += float(total_price or 0.0)
        elif float(shipping_fee or 0.0) > 0:
            prev_total_shipping += float(shipping_fee or 0.0)

    total_shipping_cost = round(ongkir_total + freight_in_total, 2)
    net_sales = await _fetch_period_net_sales(db, s_date, e_date)

    couriers_out = [
        {
            "courier": c["courier"],
            "courier_category": c["courier_category"],
            "is_subscribed": c["is_subscribed"],
            "trip_count": c["trip_count"],
            "total_cost": round(c["total_cost"], 2),
            "avg_cost_per_trip": round(c["total_cost"] / c["trip_count"], 2) if c["trip_count"] > 0 else 0.0,
            "talangan_cost": round(c["talangan_cost"], 2),
            "kas_cost": round(c["kas_cost"], 2),
            "share_pct": safe_pct(c["total_cost"], ongkir_total) or 0.0,
        }
        for c in sorted(courier_agg.values(), key=lambda x: -x["total_cost"])
    ]

    return {
        "period": {"start_date": s_date, "end_date": e_date, "label": label},
        "total_shipping_cost": total_shipping_cost,
        "ongkir_mandiri_total": round(ongkir_total, 2),
        "ongkir_trip_count": ongkir_trip_count,
        "avg_cost_per_trip": round(ongkir_total / ongkir_trip_count, 2) if ongkir_trip_count > 0 else 0.0,
        "freight_in_total": round(freight_in_total, 2),
        "freight_in_count": freight_in_count,
        "talangan_total": round(talangan_total, 2),
        "talangan_pending_total": round(talangan_pending_total, 2),
        "kas_toko_total": round(kas_toko_total, 2),
        "shipping_to_sales_pct": safe_pct(total_shipping_cost, net_sales),
        "freight_in_to_material_pct": safe_pct(freight_in_total, material_spend_total),
        "mom_change_pct": calc_pct_change(total_shipping_cost, prev_total_shipping),
        "couriers": couriers_out,
    }


def export_shipping_csv(report: dict[str, Any]) -> str:
    headers = [
        "Kurir / Ekspedisi", "Kategori Kurir", "Status Langganan",
        "Jumlah Trip", "Total Biaya Ongkir", "Rata-rata / Trip",
        "Kas Toko", "Talangan", "Porsi (%)",
    ]
    rows = [
        [
            c["courier"],
            c["courier_category"] or "-",
            "Langganan" if c["is_subscribed"] else "Reguler",
            c["trip_count"],
            c["total_cost"],
            c["avg_cost_per_trip"],
            c["kas_cost"],
            c["talangan_cost"],
            c["share_pct"],
        ]
        for c in report.get("couriers", [])
    ]
    return _csv_response_text(headers, rows)


# ─────────────────────────────────────────────────────────────────────────────
# Report C: Sales (Laporan Omset & Performa Channel Penjualan)
# ─────────────────────────────────────────────────────────────────────────────

async def get_sales_report(
    db: AsyncSession,
    year: int | None = None,
    month: int | None = None,
    month_end: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """
    Laporan penjualan 3-lapis (gross_sales, net_sales, net_received) per channel:
    - AOV, Discount Rate, Effective Platform Fee Rate
    - Void / Cancellation Count & Nominal + Rate
    - Rata-rata harian, tren harian, pertumbuhan vs periode pembanding
    """
    s_date, e_date, label = await resolve_period(year, month, month_end, start_date, end_date)
    prev_start, prev_end = get_previous_period(s_date, e_date)

    stmt_active = select(
        IncomingTransaction.order_type,
        IncomingTransaction.source_type,
        IncomingTransaction.transaction_date,
        IncomingTransaction.gross_sales,
        IncomingTransaction.discount_amount,
        IncomingTransaction.net_sales,
        IncomingTransaction.net_received,
        IncomingTransaction.platform_fee,
    ).where(
        and_(
            IncomingTransaction.transaction_date >= s_date,
            IncomingTransaction.transaction_date <= e_date,
            func.lower(IncomingTransaction.status).notin_(_VOID_STATUSES),
        )
    )
    active_rows = (await db.execute(stmt_active)).fetchall()

    stmt_void = select(
        IncomingTransaction.order_type,
        IncomingTransaction.source_type,
        IncomingTransaction.gross_sales,
        IncomingTransaction.cancellation_total,
    ).where(
        and_(
            IncomingTransaction.transaction_date >= s_date,
            IncomingTransaction.transaction_date <= e_date,
            func.lower(IncomingTransaction.status).in_(_VOID_STATUSES),
        )
    )
    void_rows = (await db.execute(stmt_void)).fetchall()

    channel_agg: dict[str, dict[str, Any]] = {}
    daily_agg: dict[date, dict[str, Any]] = {}

    for order_type, source_type, tx_date, gross, discount, net, net_recv, pf in active_rows:
        channel = (order_type or source_type or "Lainnya").strip()
        if channel not in channel_agg:
            channel_agg[channel] = {
                "channel": channel,
                "order_count": 0,
                "gross_sales": 0.0,
                "discount_amount": 0.0,
                "net_sales": 0.0,
                "net_received": 0.0,
                "platform_fee": 0.0,
                "void_count": 0,
                "void_nominal": 0.0,
            }
        c = channel_agg[channel]
        g_f = float(gross or 0.0)
        d_f = float(discount or 0.0)
        n_f = float(net or 0.0)
        nr_f = float(net_recv or 0.0)
        pf_f = float(pf or 0.0)

        c["order_count"] += 1
        c["gross_sales"] += g_f
        c["discount_amount"] += d_f
        c["net_sales"] += n_f
        c["net_received"] += nr_f
        c["platform_fee"] += pf_f

        if tx_date not in daily_agg:
            daily_agg[tx_date] = {
                "date": tx_date,
                "gross_sales": 0.0,
                "net_sales": 0.0,
                "net_received": 0.0,
                "order_count": 0,
            }
        daily_agg[tx_date]["gross_sales"] += g_f
        daily_agg[tx_date]["net_sales"] += n_f
        daily_agg[tx_date]["net_received"] += nr_f
        daily_agg[tx_date]["order_count"] += 1

    void_count = 0
    void_nominal = 0.0
    for order_type, source_type, gross, canc_total in void_rows:
        channel = (order_type or source_type or "Lainnya").strip()
        v_nom = float(canc_total or 0.0) if float(canc_total or 0.0) > 0 else float(gross or 0.0)
        void_count += 1
        void_nominal += v_nom
        if channel not in channel_agg:
            channel_agg[channel] = {
                "channel": channel,
                "order_count": 0,
                "gross_sales": 0.0,
                "discount_amount": 0.0,
                "net_sales": 0.0,
                "net_received": 0.0,
                "platform_fee": 0.0,
                "void_count": 0,
                "void_nominal": 0.0,
            }
        channel_agg[channel]["void_count"] += 1
        channel_agg[channel]["void_nominal"] += v_nom

    channels_out: list[dict[str, Any]] = []
    for c in channel_agg.values():
        g = c["gross_sales"]
        n = c["net_sales"]
        cnt = c["order_count"]
        pf = c["platform_fee"]
        disc = c["discount_amount"]
        vc = c["void_count"]
        vn = c["void_nominal"]
        channels_out.append({
            "channel": c["channel"],
            "order_count": cnt,
            "gross_sales": round(g, 2),
            "discount_amount": round(disc, 2),
            "net_sales": round(n, 2),
            "net_received": round(c["net_received"], 2),
            "platform_fee": round(pf, 2),
            "aov": round(n / cnt, 2) if cnt > 0 else 0.0,
            "discount_rate": safe_pct(disc, g),
            "platform_fee_rate": safe_pct(pf, g),
            "void_count": vc,
            "void_nominal": round(vn, 2),
            "void_rate_pct": safe_pct(vc, cnt + vc),
        })
    channels_out.sort(key=lambda x: x["net_sales"], reverse=True)

    total_gross = round(sum(c["gross_sales"] for c in channels_out), 2)
    total_discount = round(sum(c["discount_amount"] for c in channels_out), 2)
    total_net = round(sum(c["net_sales"] for c in channels_out), 2)
    total_net_recv = round(sum(c["net_received"] for c in channels_out), 2)
    total_platform_fee = round(sum(c["platform_fee"] for c in channels_out), 2)
    total_orders = sum(c["order_count"] for c in channels_out)
    total_aov = round(total_net / total_orders, 2) if total_orders > 0 else 0.0

    period_days = max(1, (e_date - s_date).days + 1)
    daily_avg_net_sales = round(total_net / period_days, 2)

    daily_out = [
        {
            "date": d,
            "gross_sales": round(v["gross_sales"], 2),
            "net_sales": round(v["net_sales"], 2),
            "net_received": round(v["net_received"], 2),
            "order_count": v["order_count"],
        }
        for d, v in sorted(daily_agg.items())
    ]

    prev_net = await _fetch_period_net_sales(db, prev_start, prev_end)
    mom_growth_pct = calc_pct_change(total_net, prev_net)

    return {
        "period": {"start_date": s_date, "end_date": e_date, "label": label},
        "total_orders": total_orders,
        "total_gross_sales": total_gross,
        "total_discount_amount": total_discount,
        "total_net_sales": total_net,
        "total_platform_fee": total_platform_fee,
        "total_net_received": total_net_recv,
        "total_aov": total_aov,
        "daily_avg_net_sales": daily_avg_net_sales,
        "void_count": void_count,
        "void_nominal": round(void_nominal, 2),
        "void_rate_pct": safe_pct(void_count, total_orders + void_count),
        "mom_growth_pct": mom_growth_pct,
        "channels": channels_out,
        "daily": daily_out,
    }


def export_sales_csv(report: dict[str, Any]) -> str:
    headers = [
        "Channel", "Jml Order Sukses", "Gross Sales", "Diskon", "Net Sales",
        "Platform Fee", "Net Diterima", "AOV", "Discount Rate (%)",
        "Platform Fee Rate (%)", "Jml Void", "Nominal Void", "Void Rate (%)",
    ]
    rows = [
        [
            c["channel"],
            c["order_count"],
            c["gross_sales"],
            c["discount_amount"],
            c["net_sales"],
            c["platform_fee"],
            c["net_received"],
            c["aov"],
            c["discount_rate"] if c["discount_rate"] is not None else "",
            c["platform_fee_rate"] if c["platform_fee_rate"] is not None else "",
            c["void_count"],
            c["void_nominal"],
            c["void_rate_pct"] if c["void_rate_pct"] is not None else "",
        ]
        for c in report.get("channels", [])
    ]
    return _csv_response_text(headers, rows)


# ─────────────────────────────────────────────────────────────────────────────
# Report D: HPP & Menu Engineering (Kasavana-Smith Matrix + Simulasi Channel)
# ─────────────────────────────────────────────────────────────────────────────

def _compute_channel_margins(selling_price: float, effective_hpp: float) -> list[dict[str, Any]]:
    """Simulasi net profit & margin per channel delivery dari DEFAULT_PRICING_CHANNELS."""
    out: list[dict[str, Any]] = []
    for ch in DEFAULT_PRICING_CHANNELS:
        comm_pct = float(ch.get("commission_pct", 0.0) or 0.0)
        fixed_fee = float(ch.get("fixed_fee", 0.0) or 0.0)
        extra_pkg = float(ch.get("extra_packaging", 0.0) or 0.0)
        net_payout = selling_price * (1.0 - comm_pct / 100.0) - fixed_fee
        net_profit = net_payout - effective_hpp - extra_pkg
        out.append({
            "key": ch["key"],
            "name": ch["name"],
            "net_profit": round(net_profit, 2),
            "net_margin_pct": safe_pct(net_profit, selling_price),
        })
    return out


async def get_hpp_report(
    db: AsyncSession,
    year: int | None = None,
    month: int | None = None,
    month_end: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """
    Laporan HPP & Menu Engineering:
    - Memakai HPP efektif, core_unit_hpp, recipe_hpp, food_cost_pct dari menu_product_service
    - Membandingkan HPP Teoritis penjualan (qty_sold * effective_hpp) vs HPP Pembelian (belanja bahan)
    - Mengklasifikasikan menu jual ke Matriks Kasavana-Smith: Star, Plowhorse, Puzzle, Dog
    - Melaporkan daftar produk POS yang belum terpetakan ke MenuProduct (unmatched_items)
    """
    s_date, e_date, label = await resolve_period(year, month, month_end, start_date, end_date)
    coa_map = await get_category_accounting_map(db)

    menus_by_id = await load_all_menus_graph(db)
    price_history_map = await build_master_price_history_map(db)
    financials = resolve_all_menu_financials(menus_by_id, price_history_map)

    sellable_menus = {
        mid: menu
        for mid, menu in menus_by_id.items()
        if bool(getattr(menu, "is_active", True)) and bool(getattr(menu, "is_sellable", True))
    }

    name_to_mid: dict[str, int] = {
        menu.name.strip().lower(): mid
        for mid, menu in sellable_menus.items()
    }

    # Query item terjual dari transaksi aktif pada periode
    stmt_sold = (
        select(
            IncomingTransactionItem.product_name,
            func.sum(IncomingTransactionItem.qty).label("qty_sold"),
            func.sum(IncomingTransactionItem.gross_amount - IncomingTransactionItem.discount_amount).label("net_revenue"),
            func.sum(IncomingTransactionItem.gross_amount).label("gross_revenue"),
        )
        .join(
            IncomingTransaction,
            IncomingTransactionItem.transaction_id == IncomingTransaction.id,
        )
        .where(
            and_(
                IncomingTransaction.transaction_date >= s_date,
                IncomingTransaction.transaction_date <= e_date,
                func.lower(IncomingTransaction.status).notin_(_VOID_STATUSES),
            )
        )
        .group_by(IncomingTransactionItem.product_name)
    )
    sold_rows = (await db.execute(stmt_sold)).fetchall()

    sales_by_name: dict[str, dict[str, Any]] = {}
    for pname, qty_sold, net_rev, gross_rev in sold_rows:
        norm = (pname or "").strip().lower()
        if not norm:
            continue
        sales_by_name[norm] = {
            "product_name": pname,
            "qty_sold": float(qty_sold or 0.0),
            "net_revenue": float(net_rev or 0.0),
            "gross_revenue": float(gross_rev or 0.0),
        }

    unmatched_items: list[str] = []
    total_matched_qty = 0.0
    for name_l, sdata in sales_by_name.items():
        if name_l not in name_to_mid:
            unmatched_items.append(sdata["product_name"])
        else:
            total_matched_qty += sdata["qty_sold"]

    sellable_count = len(sellable_menus)
    popularity_threshold = (
        (total_matched_qty / sellable_count) * 0.7 if sellable_count > 0 else 0.0
    )

    total_cm_weight = 0.0
    total_cm_num = 0.0
    prepared_menus: list[tuple[int, dict[str, Any], dict[str, Any]]] = []

    for mid, menu in sellable_menus.items():
        fin = financials.get(mid, {})
        effective_hpp = float(fin.get("effective_hpp", 0.0) or 0.0)
        selling_price = float(
            fin.get("selling_price", 0.0) or getattr(menu, "selling_price", 0.0) or 0.0
        )
        cm = selling_price - effective_hpp
        name_l = menu.name.strip().lower()
        sdata = sales_by_name.get(name_l, {"qty_sold": 0.0, "gross_revenue": 0.0, "net_revenue": 0.0})

        prepared_menus.append((mid, fin, {**sdata, "cm": cm, "menu": menu}))
        total_cm_weight += sdata["qty_sold"]
        total_cm_num += cm * sdata["qty_sold"]

    # Jika belum ada penjualan di periode ini, pakai rata-rata sederhana CM menu aktif
    if total_cm_weight > 0:
        cm_threshold = total_cm_num / total_cm_weight
    elif prepared_menus:
        cm_threshold = sum(m["cm"] for _, _, m in prepared_menus) / len(prepared_menus)
    else:
        cm_threshold = 0.0

    menu_rows: list[dict[str, Any]] = []
    theoretical_hpp_total = 0.0
    matched_revenue_total = 0.0

    for mid, fin, mdata in prepared_menus:
        menu = mdata["menu"]
        effective_hpp = float(fin.get("effective_hpp", 0.0) or 0.0)
        core_unit_hpp = float(fin.get("core_unit_hpp", 0.0) or 0.0)
        recipe_hpp = float(fin.get("recipe_hpp", 0.0) or 0.0)
        selling_price = float(
            fin.get("selling_price", 0.0) or getattr(menu, "selling_price", 0.0) or 0.0
        )
        cm = mdata["cm"]
        qty_sold = mdata["qty_sold"]
        gross_revenue = mdata["gross_revenue"]

        is_popular = qty_sold >= popularity_threshold if total_matched_qty > 0 else False
        is_profitable = cm >= cm_threshold

        if is_popular and is_profitable:
            classification = "Star"
        elif not is_popular and is_profitable:
            classification = "Puzzle"
        elif is_popular and not is_profitable:
            classification = "Plowhorse"
        else:
            classification = "Dog"

        theoretical_hpp_total += effective_hpp * qty_sold
        matched_revenue_total += gross_revenue

        menu_rows.append({
            "menu_id": mid,
            "menu_name": menu.name,
            "category": menu.category,
            "selling_price": round(selling_price, 2),
            "core_unit_hpp": round(core_unit_hpp, 2),
            "recipe_hpp": round(recipe_hpp, 2),
            "effective_hpp": round(effective_hpp, 2),
            "food_cost_pct": fin.get("food_cost_pct"),
            "pure_food_cost_pct": fin.get("pure_food_cost_pct"),
            "packaging_cost_pct": fin.get("packaging_cost_pct"),
            "gross_margin_pct": fin.get("margin_pct"),
            "contribution_margin": round(cm, 2),
            "qty_sold": int(round(qty_sold)),
            "gross_revenue": round(gross_revenue, 2),
            "theoretical_hpp": round(effective_hpp * qty_sold, 2),
            "classification": classification,
            "has_price_drift": bool(fin.get("has_price_drift", False)),
            "channel_margins": _compute_channel_margins(selling_price, effective_hpp),
        })

    menu_rows.sort(key=lambda x: (x["qty_sold"], x["contribution_margin"]), reverse=True)

    # Actual Purchase HPP ("HPP Pembelian") berbasis belanja bahan periode berjalan
    hpp_rows = (
        await db.execute(
            select(
                Expense.category,
                Expense.item_name,
                Expense.supplier,
                Expense.total_price,
            ).where(
                and_(
                    Expense.expense_date >= s_date,
                    Expense.expense_date <= e_date,
                )
            )
        )
    ).fetchall()

    actual_purchase_hpp = sum(
        float(tp or 0.0)
        for cat, iname, sup, tp in hpp_rows
        if _is_material_expense(cat, iname, sup, coa_map)
    )

    net_sales = await _fetch_period_net_sales(db, s_date, e_date)
    theoretical_hpp_rounded = round(theoretical_hpp_total, 2)
    actual_purchase_rounded = round(actual_purchase_hpp, 2)

    return {
        "period": {"start_date": s_date, "end_date": e_date, "label": label},
        "hpp_basis_note": "HPP Pembelian dihitung dari belanja bahan periode berjalan (non-opname).",
        "theoretical_hpp_total": theoretical_hpp_rounded,
        "actual_purchase_hpp": actual_purchase_rounded,
        "hpp_variance_amount": round(actual_purchase_rounded - theoretical_hpp_rounded, 2),
        "theoretical_food_cost_pct": safe_pct(theoretical_hpp_rounded, net_sales),
        "actual_purchase_ratio_pct": safe_pct(actual_purchase_rounded, net_sales),
        "popularity_threshold": round(popularity_threshold, 1),
        "cm_threshold": round(cm_threshold, 2),
        "unmatched_items": sorted(set(unmatched_items)),
        "menus": menu_rows,
    }


def export_hpp_csv(report: dict[str, Any]) -> str:
    headers = [
        "Nama Menu", "Kategori", "Harga Jual", "Core HPP", "Recipe HPP",
        "HPP Efektif", "Food Cost (%)", "Gross Margin (%)", "Contribution Margin",
        "Qty Terjual", "Revenue", "HPP Teoritis", "Klasifikasi Menu Engineering",
    ]
    rows = [
        [
            m["menu_name"],
            m["category"],
            m["selling_price"],
            m["core_unit_hpp"],
            m["recipe_hpp"],
            m["effective_hpp"],
            m["food_cost_pct"] if m["food_cost_pct"] is not None else "",
            m["gross_margin_pct"] if m["gross_margin_pct"] is not None else "",
            m["contribution_margin"],
            m["qty_sold"],
            m["gross_revenue"],
            m["theoretical_hpp"],
            m["classification"],
        ]
        for m in report.get("menus", [])
    ]
    return _csv_response_text(headers, rows)
