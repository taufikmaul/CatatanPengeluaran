"""
app/api/incoming_transactions.py — REST API for Daftar Transaksi Masuk & Import Laporan POS/Platform
"""
from datetime import date, timedelta
import json
from typing import Any, Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select, func, and_, or_, exists
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_admin_role, require_roles, validate_upload_file
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.models.bank_account import BankAccount
from app.services.bank_account_service import (
    build_channel_account_map,
    resolve_bank_account_for_tx,
    is_cakeflow_order_type,
)
from app.services.sales_import_service import (
    parse_sales_csv,
    audit_sales_transactions,
    apply_sales_import_overrides,
)
from app.utils.csv_helpers import (
    build_csv_template,
    col_lookup,
    get_cell,
    parse_csv_table,
    parse_date_cell,
    parse_number_cell,
)

router = APIRouter(
    prefix="/incoming-transactions",
    tags=["incoming-transactions"],
    dependencies=[Depends(require_roles("admin", "admin_input"))],
)


def _serialize_tx(tx: IncomingTransaction) -> dict[str, Any]:
    return {
        "id": tx.id,
        "source_type": tx.source_type,
        "receipt_no": tx.receipt_no,
        "order_no": tx.order_no,
        "transaction_date": tx.transaction_date.isoformat() if tx.transaction_date else None,
        "transaction_time": tx.transaction_time,
        "location_name": tx.location_name,
        "order_type": tx.order_type,
        "payment_method": tx.payment_method,
        "bank_account_id": tx.bank_account_id,
        "bank_account_name": tx.bank_account.name if tx.bank_account else None,
        "customer_name": tx.customer_name,
        "cashier_name": tx.cashier_name,
        "gross_sales": float(tx.gross_sales or 0.0),
        "discount_amount": float(tx.discount_amount or 0.0),
        "net_sales": float(tx.net_sales or 0.0),
        "platform_fee": float(tx.platform_fee or 0.0),
        "net_received": float(tx.net_received or 0.0),
        "cancellation_total": float(tx.cancellation_total or 0.0),
        "promo_name": tx.promo_name,
        "status": tx.status,
        "void_at": tx.void_at,
        "notes": tx.notes,
        "reconciled_at": tx.reconciled_at.isoformat() if tx.reconciled_at else None,
        "reconciled_ref": tx.reconciled_ref,
        "items": [
            {
                "id": it.id,
                "category": it.category,
                "product_group": it.product_group,
                "product_name": it.product_name,
                "sku": it.sku,
                "qty": float(it.qty or 0.0),
                "modifier": it.modifier,
                "unit_price": float(it.unit_price or 0.0),
                "extra_price": float(it.extra_price or 0.0),
                "gross_amount": float(it.gross_amount or 0.0),
                "discount_amount": float(it.discount_amount or 0.0),
            }
            for it in (tx.items or [])
        ],
    }


class ManualIncomingTxCreate(BaseModel):
    transaction_date: date
    transaction_time: Optional[str] = None
    order_type: str = Field(..., min_length=1, max_length=60)
    payment_method: str = Field(..., min_length=1, max_length=60)
    bank_account_id: Optional[int] = None
    receipt_no: Optional[str] = Field(None, max_length=80)
    order_no: Optional[str] = Field(None, max_length=120)
    customer_name: Optional[str] = Field(None, max_length=120)
    cashier_name: Optional[str] = Field(None, max_length=80)
    gross_sales: float = Field(..., ge=0)
    discount_amount: float = Field(0.0, ge=0)
    platform_fee: float = Field(0.0, ge=0)
    status: Optional[str] = Field("paid", max_length=20)
    notes: Optional[str] = None


class ManualIncomingTxUpdate(BaseModel):
    transaction_date: Optional[date] = None
    transaction_time: Optional[str] = None
    order_type: Optional[str] = Field(None, min_length=1, max_length=60)
    payment_method: Optional[str] = Field(None, min_length=1, max_length=60)
    bank_account_id: Optional[int] = None
    receipt_no: Optional[str] = Field(None, max_length=80)
    order_no: Optional[str] = Field(None, max_length=120)
    customer_name: Optional[str] = Field(None, max_length=120)
    cashier_name: Optional[str] = Field(None, max_length=80)
    gross_sales: Optional[float] = Field(None, ge=0)
    discount_amount: Optional[float] = Field(None, ge=0)
    platform_fee: Optional[float] = Field(None, ge=0)
    status: Optional[str] = Field(None, max_length=20)
    notes: Optional[str] = None


class IncomingTxBulkItem(BaseModel):
    transaction_date: date
    transaction_time: Optional[str] = None
    receipt_no: Optional[str] = None
    order_no: Optional[str] = None
    order_type: str = "Take Away"
    payment_method: str = "Tunai"
    bank_account_id: Optional[int] = None
    bank_account_name: Optional[str] = None
    customer_name: Optional[str] = None
    cashier_name: Optional[str] = None
    gross_sales: float = Field(0.0, ge=0)
    discount_amount: float = Field(0.0, ge=0)
    platform_fee: float = Field(0.0, ge=0)
    status: str = "paid"
    notes: Optional[str] = None


class IncomingTxBulkRequest(BaseModel):
    items: list[IncomingTxBulkItem]
    update_existing: bool = True


class ReassignBankAccountPayload(BaseModel):
    bank_account_id: Optional[int] = None


def _build_incoming_tx_filter(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    order_type: Optional[str] = None,
    payment_method: Optional[str] = None,
    status_filter: Optional[str] = None,
    bank_account_id: Optional[int] = None,
    search: Optional[str] = None,
    month: Optional[int] = None,
    month_end: Optional[int] = None,
    year: Optional[int] = None,
):
    conditions = []
    if not start_date and not end_date and month and year:
        m_end = month_end or month
        start_date = date(year, month, 1)
        end_date = (date(year + 1, 1, 1) if m_end == 12 else date(year, m_end + 1, 1)) - timedelta(days=1)

    if start_date:
        conditions.append(IncomingTransaction.transaction_date >= start_date)
    if end_date:
        conditions.append(IncomingTransaction.transaction_date <= end_date)
    if order_type and order_type != "all":
        conditions.append(IncomingTransaction.order_type == order_type)
    if payment_method and payment_method != "all":
        conditions.append(IncomingTransaction.payment_method == payment_method)
    if status_filter and status_filter != "all":
        conditions.append(IncomingTransaction.status == status_filter)
    if bank_account_id is not None:
        if bank_account_id == 0:
            conditions.append(IncomingTransaction.bank_account_id.is_(None))
        else:
            conditions.append(IncomingTransaction.bank_account_id == bank_account_id)
    if search and search.strip():
        q = f"%{search.strip()}%"
        conditions.append(
            or_(
                IncomingTransaction.receipt_no.ilike(q),
                IncomingTransaction.order_no.ilike(q),
                IncomingTransaction.customer_name.ilike(q),
                IncomingTransaction.promo_name.ilike(q),
            )
        )
    return and_(*conditions) if conditions else True


@router.get("")
async def api_list_incoming_transactions(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    month_end: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    order_type: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    bank_account_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    where_clause = _build_incoming_tx_filter(
        start_date=start_date,
        end_date=end_date,
        order_type=order_type,
        payment_method=payment_method,
        status_filter=status_filter,
        bank_account_id=bank_account_id,
        search=search,
        month=month,
        month_end=month_end,
        year=year,
    )

    # Paginated rows
    stmt = (
        select(IncomingTransaction)
        .where(where_clause)
        .order_by(IncomingTransaction.transaction_date.desc(), IncomingTransaction.transaction_time.desc(), IncomingTransaction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    res = await db.execute(stmt)
    rows = res.scalars().all()

    total_count_res = await db.execute(select(func.count(IncomingTransaction.id)).where(where_clause))
    total_count = int(total_count_res.scalar() or 0)

    # Summary aggregation (paid vs void)
    paid_cond = and_(where_clause, IncomingTransaction.status == "paid")
    paid_agg_res = await db.execute(
        select(
            func.count(IncomingTransaction.id),
            func.coalesce(func.sum(IncomingTransaction.gross_sales), 0.0),
            func.coalesce(func.sum(IncomingTransaction.discount_amount), 0.0),
            func.coalesce(func.sum(IncomingTransaction.net_sales), 0.0),
            func.coalesce(func.sum(IncomingTransaction.platform_fee), 0.0),
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        ).where(paid_cond)
    )
    p_row = paid_agg_res.fetchone()

    void_cond = and_(where_clause, IncomingTransaction.status != "paid")
    void_agg_res = await db.execute(
        select(
            func.count(IncomingTransaction.id),
            func.coalesce(func.sum(IncomingTransaction.cancellation_total), 0.0),
        ).where(void_cond)
    )
    v_row = void_agg_res.fetchone()

    # Distinct order_types & payment_methods for filter dropdowns
    ot_res = await db.execute(select(IncomingTransaction.order_type).distinct().order_by(IncomingTransaction.order_type))
    pm_res = await db.execute(select(IncomingTransaction.payment_method).distinct().order_by(IncomingTransaction.payment_method))

    return {
        "ok": True,
        "transactions": [_serialize_tx(tx) for tx in rows],
        "total_count": total_count,
        "summary": {
            "paid_count": int(p_row[0] or 0) if p_row else 0,
            "gross_sales": float(p_row[1] or 0.0) if p_row else 0.0,
            "discount_amount": float(p_row[2] or 0.0) if p_row else 0.0,
            "net_sales": float(p_row[3] or 0.0) if p_row else 0.0,
            "platform_fee": float(p_row[4] or 0.0) if p_row else 0.0,
            "net_received": float(p_row[5] or 0.0) if p_row else 0.0,
            "void_count": int(v_row[0] or 0) if v_row else 0,
            "cancellation_total": float(v_row[1] or 0.0) if v_row else 0.0,
        },
        "facets": {
            "order_types": [r[0] for r in ot_res.fetchall() if r[0]],
            "payment_methods": [r[0] for r in pm_res.fetchall() if r[0]],
        },
    }


def _fallback_product_from_tx(order_type: str | None, notes: str | None) -> tuple[str, str]:
    """
    Turunkan nama menu & kategori fallback bagi transaksi lunas tanpa rincian IncomingTransactionItem
    (mis. order Cake Flow lama, input manual, atau import template CSV 1-baris).
    """
    ot = (order_type or "").strip() or "Lainnya"
    is_cf = is_cakeflow_order_type(ot)
    category = "Cakeflow" if is_cf else ot

    raw_note = (notes or "").strip()
    if raw_note:
        first_line = next((ln.strip() for ln in raw_note.splitlines() if ln.strip()), "")
        if first_line and first_line not in ("-", "—"):
            return first_line[:120], category

    if is_cf:
        return f"{ot} (Order Custom)", category
    return f"{ot} (Tanpa Rincian Item)", category


def _short_radar_label(name: str, max_len: int = 22) -> str:
    clean = (name or "").strip()
    if len(clean) <= max_len:
        return clean
    return clean[: max_len - 1].rstrip() + "…"


@router.get("/analytics")
async def api_incoming_analytics(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    month_end: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    order_type: Optional[str] = Query(None),
    top_limit: int = Query(15, ge=5, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Radar Menu Terlaris (Top Qty & Top Omset), Kontribusi Channel (termasuk Cake Flow), & Jam Sibuk:
    - top_products / top_products_by_qty: produk terlaris berdasarkan qty
    - top_products_by_revenue: produk terlaris berdasarkan omset net
    - radar_by_qty & radar_by_revenue: dataset radar chart (skor 0-100 Qty vs Omset)
    - by_channel: kontribusi per tipe order (Take Away, Cakeflow, GoFood, GrabFood, ShopeeFood, dll.)
    - categories: ringkasan per kategori produk (termasuk transaksi tanpa item seperti Cake Flow)
    - peak_hours: distribusi transaksi per jam (offline vs online delivery vs cakeflow)
    - void_by_channel: ringkasan transaksi void
    - summary: ringkasan KPI termasuk kontribusi khusus Cake Flow
    """
    if not start_date and not end_date and month and year:
        m_end = month_end or month
        start_date = date(year, month, 1)
        end_date = (date(year + 1, 1, 1) if m_end == 12 else date(year, m_end + 1, 1)) - timedelta(days=1)

    base_paid_conds = [IncomingTransaction.status == "paid"]
    if start_date:
        base_paid_conds.append(IncomingTransaction.transaction_date >= start_date)
    if end_date:
        base_paid_conds.append(IncomingTransaction.transaction_date <= end_date)
    base_paid_where = and_(*base_paid_conds)

    # Distinct order_types pada periode aktif (sebelum filter order_type) untuk opsi filter UI
    ot_avail_res = await db.execute(
        select(IncomingTransaction.order_type)
        .where(base_paid_where)
        .distinct()
        .order_by(IncomingTransaction.order_type.asc())
    )
    available_order_types = [r[0] for r in ot_avail_res.fetchall() if r[0]]

    tx_conds = list(base_paid_conds)
    if order_type and order_type != "all":
        tx_conds.append(IncomingTransaction.order_type == order_type)
    paid_where = and_(*tx_conds)

    # 1. Agregasi Produk & Kategori dari IncomingTransactionItem (POS multi-item & Cake Flow ber-item)
    product_map: dict[str, dict[str, Any]] = {}
    category_map: dict[str, dict[str, Any]] = {}
    channel_qty_map: dict[str, float] = {}

    item_res = await db.execute(
        select(
            IncomingTransactionItem.product_name,
            IncomingTransactionItem.category,
            IncomingTransactionItem.qty,
            IncomingTransactionItem.gross_amount,
            IncomingTransactionItem.discount_amount,
            IncomingTransaction.order_type,
        )
        .join(IncomingTransaction, IncomingTransactionItem.transaction_id == IncomingTransaction.id)
        .where(paid_where)
    )
    for p_name, p_cat, qty_val, gross_val, disc_val, o_type in item_res.fetchall():
        clean_name = (p_name or "").strip()
        if not clean_name:
            continue
        qty_f = float(qty_val or 0.0)
        net_f = max(0.0, float(gross_val or 0.0) - float(disc_val or 0.0))
        ot_label = (o_type or "").strip() or "Lainnya"
        cat_label = (p_cat or "").strip() or ("Cakeflow" if is_cakeflow_order_type(ot_label) else "Lainnya")

        key = clean_name.lower()
        if key not in product_map:
            product_map[key] = {
                "product_name": clean_name,
                "category": cat_label,
                "total_qty": 0.0,
                "net_sales": 0.0,
                "order_lines": 0,
                "order_types": set(),
            }
        elif product_map[key]["category"] == "Lainnya" and cat_label != "Lainnya":
            product_map[key]["category"] = cat_label

        product_map[key]["total_qty"] += qty_f
        product_map[key]["net_sales"] += net_f
        product_map[key]["order_lines"] += 1
        product_map[key]["order_types"].add(ot_label)

        if cat_label not in category_map:
            category_map[cat_label] = {"category": cat_label, "total_qty": 0.0, "net_sales": 0.0}
        category_map[cat_label]["total_qty"] += qty_f
        category_map[cat_label]["net_sales"] += net_f

        channel_qty_map[ot_label] = channel_qty_map.get(ot_label, 0.0) + qty_f

    # 1b. Fallback transaksi lunas TANPA rincian item (mis. Cake Flow historis / input manual / template CSV)
    has_item_subq = exists(
        select(IncomingTransactionItem.id).where(IncomingTransactionItem.transaction_id == IncomingTransaction.id)
    )
    itemless_res = await db.execute(
        select(
            IncomingTransaction.order_type,
            IncomingTransaction.notes,
            IncomingTransaction.gross_sales,
            IncomingTransaction.discount_amount,
            IncomingTransaction.net_sales,
            IncomingTransaction.net_received,
        ).where(and_(paid_where, ~has_item_subq))
    )
    for o_type, notes_val, gross_val, disc_val, net_s_val, net_rec_val in itemless_res.fetchall():
        ot_label = (o_type or "").strip() or "Lainnya"
        prod_name, cat_label = _fallback_product_from_tx(ot_label, notes_val)
        eff_net = float(net_s_val or 0.0)
        if eff_net <= 0:
            eff_net = float(net_rec_val or 0.0)
        if eff_net <= 0:
            eff_net = max(0.0, float(gross_val or 0.0) - float(disc_val or 0.0))
        qty_f = 1.0

        key = prod_name.lower()
        if key not in product_map:
            product_map[key] = {
                "product_name": prod_name,
                "category": cat_label,
                "total_qty": 0.0,
                "net_sales": 0.0,
                "order_lines": 0,
                "order_types": set(),
            }
        product_map[key]["total_qty"] += qty_f
        product_map[key]["net_sales"] += eff_net
        product_map[key]["order_lines"] += 1
        product_map[key]["order_types"].add(ot_label)

        if cat_label not in category_map:
            category_map[cat_label] = {"category": cat_label, "total_qty": 0.0, "net_sales": 0.0}
        category_map[cat_label]["total_qty"] += qty_f
        category_map[cat_label]["net_sales"] += eff_net

        channel_qty_map[ot_label] = channel_qty_map.get(ot_label, 0.0) + qty_f

    total_product_qty = sum(p["total_qty"] for p in product_map.values())
    total_product_net_sales = sum(p["net_sales"] for p in product_map.values())

    def _serialize_product_row(p: dict[str, Any]) -> dict[str, Any]:
        qty = float(p["total_qty"])
        rev = float(p["net_sales"])
        return {
            "product_name": p["product_name"],
            "category": p["category"],
            "total_qty": round(qty, 2),
            "net_sales": round(rev, 2),
            "avg_price": round(rev / qty, 2) if qty > 0 else 0.0,
            "order_lines": int(p["order_lines"]),
            "qty_share_pct": round((qty / total_product_qty) * 100.0, 1) if total_product_qty > 0 else 0.0,
            "revenue_share_pct": round((rev / total_product_net_sales) * 100.0, 1) if total_product_net_sales > 0 else 0.0,
            "order_types": sorted(p["order_types"]),
        }

    all_products_qty = sorted(
        product_map.values(),
        key=lambda x: (-x["total_qty"], -x["net_sales"], x["product_name"].lower()),
    )
    all_products_rev = sorted(
        product_map.values(),
        key=lambda x: (-x["net_sales"], -x["total_qty"], x["product_name"].lower()),
    )

    top_products_by_qty = [_serialize_product_row(p) for p in all_products_qty[:top_limit]]
    top_products_by_revenue = [_serialize_product_row(p) for p in all_products_rev[:top_limit]]
    # Backwards-compatible alias
    top_products = top_products_by_qty

    def _build_radar_dataset(rows: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
        sliced = rows[:limit]
        if not sliced:
            return []
        max_q = max((r["total_qty"] for r in sliced), default=1.0) or 1.0
        max_r = max((r["net_sales"] for r in sliced), default=1.0) or 1.0
        return [
            {
                "label": _short_radar_label(r["product_name"]),
                "product_name": r["product_name"],
                "category": r["category"],
                "total_qty": r["total_qty"],
                "net_sales": r["net_sales"],
                "qty_score": round((r["total_qty"] / max_q) * 100.0, 1),
                "revenue_score": round((r["net_sales"] / max_r) * 100.0, 1),
            }
            for r in sliced
        ]

    radar_by_qty = _build_radar_dataset(top_products_by_qty, limit=8)
    radar_by_revenue = _build_radar_dataset(top_products_by_revenue, limit=8)

    # 2. Category Breakdown
    categories = sorted(
        [
            {
                "category": c["category"],
                "total_qty": round(float(c["total_qty"]), 2),
                "net_sales": round(float(c["net_sales"]), 2),
            }
            for c in category_map.values()
        ],
        key=lambda x: (-x["net_sales"], -x["total_qty"]),
    )

    # 3. Channel Breakdown (termasuk Cake Flow) & Peak Hours
    tx_rows_res = await db.execute(
        select(
            IncomingTransaction.transaction_time,
            IncomingTransaction.order_type,
            IncomingTransaction.gross_sales,
            IncomingTransaction.net_sales,
            IncomingTransaction.platform_fee,
            IncomingTransaction.net_received,
        ).where(paid_where)
    )
    hour_buckets: dict[int, dict[str, Any]] = {}
    channel_agg: dict[str, dict[str, Any]] = {}
    total_paid_tx = 0
    total_net_sales_tx = 0.0
    total_net_received_tx = 0.0
    cakeflow_tx_count = 0
    cakeflow_net_sales = 0.0
    cakeflow_net_received = 0.0
    cakeflow_qty = 0.0
    unscheduled_time_count = 0

    for t_time, o_type, gross_v, net_s_v, fee_v, net_rec_v in tx_rows_res.fetchall():
        ot_label = (o_type or "").strip() or "Lainnya"
        is_cf = is_cakeflow_order_type(ot_label)
        g_f = float(gross_v or 0.0)
        ns_f = float(net_s_v or 0.0)
        fee_f = float(fee_v or 0.0)
        nr_f = float(net_rec_v or 0.0)

        total_paid_tx += 1
        total_net_sales_tx += ns_f
        total_net_received_tx += nr_f

        if is_cf:
            cakeflow_tx_count += 1
            cakeflow_net_sales += ns_f
            cakeflow_net_received += nr_f

        if ot_label not in channel_agg:
            channel_agg[ot_label] = {
                "channel": ot_label,
                "is_cakeflow": is_cf,
                "tx_count": 0,
                "total_qty": 0.0,
                "gross_sales": 0.0,
                "net_sales": 0.0,
                "platform_fee": 0.0,
                "net_received": 0.0,
            }
        channel_agg[ot_label]["tx_count"] += 1
        channel_agg[ot_label]["gross_sales"] += g_f
        channel_agg[ot_label]["net_sales"] += ns_f
        channel_agg[ot_label]["platform_fee"] += fee_f
        channel_agg[ot_label]["net_received"] += nr_f

        hour = None
        if t_time and ":" in t_time:
            try:
                hour = int(t_time.split(":")[0].strip())
            except ValueError:
                hour = None
        if hour is None or not (0 <= hour <= 23):
            unscheduled_time_count += 1
            continue
        if hour not in hour_buckets:
            hour_buckets[hour] = {
                "hour": hour,
                "label": f"{hour:02d}:00",
                "offline_count": 0,
                "online_count": 0,
                "cakeflow_count": 0,
                "total_count": 0,
                "net_received": 0.0,
            }
        ot_lower = ot_label.lower()
        is_online = any(k in ot_lower for k in ("gofood", "grabfood", "shopeefood", "marketplace"))
        if is_cf:
            hour_buckets[hour]["cakeflow_count"] += 1
        elif is_online:
            hour_buckets[hour]["online_count"] += 1
        else:
            hour_buckets[hour]["offline_count"] += 1
        hour_buckets[hour]["total_count"] += 1
        hour_buckets[hour]["net_received"] += nr_f

    for ot_label, ch_data in channel_agg.items():
        ch_qty = float(channel_qty_map.get(ot_label, 0.0))
        ch_data["total_qty"] = round(ch_qty, 2)
        ch_data["gross_sales"] = round(ch_data["gross_sales"], 2)
        ch_data["net_sales"] = round(ch_data["net_sales"], 2)
        ch_data["platform_fee"] = round(ch_data["platform_fee"], 2)
        ch_data["net_received"] = round(ch_data["net_received"], 2)
        ch_data["revenue_share_pct"] = (
            round((ch_data["net_received"] / total_net_received_tx) * 100.0, 1)
            if total_net_received_tx > 0
            else 0.0
        )
        if ch_data["is_cakeflow"]:
            cakeflow_qty += ch_qty

    by_channel = sorted(
        channel_agg.values(),
        key=lambda x: (-x["net_received"], -x["tx_count"], x["channel"].lower()),
    )

    peak_hours = [hour_buckets[h] for h in sorted(hour_buckets.keys())]

    # 4. Void Summary
    void_conds = [IncomingTransaction.status != "paid"]
    if start_date:
        void_conds.append(IncomingTransaction.transaction_date >= start_date)
    if end_date:
        void_conds.append(IncomingTransaction.transaction_date <= end_date)
    if order_type and order_type != "all":
        void_conds.append(IncomingTransaction.order_type == order_type)
    void_res = await db.execute(
        select(
            IncomingTransaction.order_type,
            func.count(IncomingTransaction.id),
            func.coalesce(func.sum(IncomingTransaction.cancellation_total), 0.0),
        )
        .where(and_(*void_conds))
        .group_by(IncomingTransaction.order_type)
    )
    void_by_channel = [
        {"channel": r[0] or "Lainnya", "count": int(r[1] or 0), "amount": float(r[2] or 0.0)}
        for r in void_res.fetchall()
    ]

    return {
        "ok": True,
        "analytics": {
            "top_products": top_products,
            "top_products_by_qty": top_products_by_qty,
            "top_products_by_revenue": top_products_by_revenue,
            "radar_by_qty": radar_by_qty,
            "radar_by_revenue": radar_by_revenue,
            "by_channel": by_channel,
            "categories": categories,
            "peak_hours": peak_hours,
            "void_by_channel": void_by_channel,
            "available_order_types": available_order_types,
            "summary": {
                "total_paid_tx": total_paid_tx,
                "total_qty": round(total_product_qty, 2),
                "total_net_sales": round(total_net_sales_tx, 2),
                "total_net_received": round(total_net_received_tx, 2),
                "unique_products": len(product_map),
                "cakeflow_tx_count": cakeflow_tx_count,
                "cakeflow_qty": round(cakeflow_qty, 2),
                "cakeflow_net_sales": round(cakeflow_net_sales, 2),
                "cakeflow_net_received": round(cakeflow_net_received, 2),
                "unscheduled_time_count": unscheduled_time_count,
            },
        },
    }


@router.get("/template-csv")
async def api_download_incoming_csv_template():
    """Unduh template CSV siap isi untuk import Transaksi Masuk."""
    headers = [
        "No Receipt",
        "No Order",
        "Tanggal",
        "Jam",
        "Tipe Order",
        "Metode Bayar",
        "Rekening Tujuan",
        "Nama Pelanggan",
        "Nama Kasir",
        "Penjualan Kotor",
        "Diskon",
        "Fee Platform",
        "Status",
        "Catatan",
    ]
    sample_rows = [
        [
            "POS-001",
            "ORD-001",
            date.today().isoformat(),
            "10:15",
            "Take Away",
            "QRIS",
            "BCA Operasional",
            "Budi Santoso",
            "Kasir 1",
            150000,
            0,
            0,
            "paid",
            "Pembelian offline di kasir",
        ],
        [
            "GF-002",
            "F-3429057006",
            date.today().isoformat(),
            "12:30",
            "GoFood Integrasi",
            "GoFood Integrasi",
            "GoBiz",
            "Siti Rahma",
            "-",
            120000,
            15000,
            21000,
            "paid",
            "Order via GoFood",
        ],
    ]
    csv_text = build_csv_template(headers, sample_rows)
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="Transaction Import.csv"'},
    )


@router.get("/export")
async def api_export_incoming_transactions_csv(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    month_end: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    order_type: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    bank_account_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Export daftar transaksi masuk sesuai filter aktif ke CSV."""
    where_clause = _build_incoming_tx_filter(
        start_date=start_date,
        end_date=end_date,
        order_type=order_type,
        payment_method=payment_method,
        status_filter=status_filter,
        bank_account_id=bank_account_id,
        search=search,
        month=month,
        month_end=month_end,
        year=year,
    )
    stmt = (
        select(IncomingTransaction)
        .where(where_clause)
        .order_by(
            IncomingTransaction.transaction_date.desc(),
            IncomingTransaction.transaction_time.desc(),
            IncomingTransaction.id.desc(),
        )
    )
    res = await db.execute(stmt)
    rows = res.scalars().all()

    headers = [
        "ID",
        "No Receipt",
        "No Order",
        "Tanggal",
        "Jam",
        "Tipe Order",
        "Metode Bayar",
        "Rekening Tujuan",
        "Nama Pelanggan",
        "Nama Kasir",
        "Penjualan Kotor",
        "Diskon",
        "Penjualan Bersih",
        "Fee Platform",
        "Bersih Diterima",
        "Nilai Batal",
        "Status",
        "Catatan",
        "Rekonsiliasi",
    ]
    data_rows = []
    for tx in rows:
        data_rows.append(
            [
                tx.id,
                tx.receipt_no or "",
                tx.order_no or "",
                tx.transaction_date.isoformat() if tx.transaction_date else "",
                tx.transaction_time or "",
                tx.order_type or "",
                tx.payment_method or "",
                tx.bank_account.name if tx.bank_account else "",
                tx.customer_name or "",
                tx.cashier_name or "",
                float(tx.gross_sales or 0.0),
                float(tx.discount_amount or 0.0),
                float(tx.net_sales or 0.0),
                float(tx.platform_fee or 0.0),
                float(tx.net_received or 0.0),
                float(tx.cancellation_total or 0.0),
                tx.status or "paid",
                tx.notes or "",
                "Ya" if tx.reconciled_at else "Tidak",
            ]
        )

    csv_text = build_csv_template(headers, data_rows)
    filename = f"transaksi_masuk_{date.today().isoformat()}.csv"
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
async def api_bulk_incoming_transactions(
    payload: IncomingTxBulkRequest,
    db: AsyncSession = Depends(get_db),
):
    """Tambah atau perbarui banyak transaksi masuk sekaligus via form masal."""
    if not payload.items:
        raise HTTPException(status_code=400, detail="Daftar transaksi tidak boleh kosong.")

    # Bank account lookup cache
    acc_res = await db.execute(select(BankAccount))
    all_accounts = acc_res.scalars().all()
    acc_by_name = {a.name.strip().lower(): a.id for a in all_accounts}
    acc_by_id = {a.id: a.id for a in all_accounts}
    channel_map, default_acc = await build_channel_account_map(db)

    # Existing transactions lookup
    receipt_nos = [it.receipt_no.strip() for it in payload.items if it.receipt_no and it.receipt_no.strip()]
    existing_by_receipt: dict[str, IncomingTransaction] = {}
    if receipt_nos:
        res = await db.execute(
            select(IncomingTransaction).where(
                IncomingTransaction.receipt_no.in_(receipt_nos)
            )
        )
        for tx in res.scalars().all():
            if tx.receipt_no:
                existing_by_receipt[tx.receipt_no.strip()] = tx

    added = 0
    updated = 0
    skipped = 0

    for it in payload.items:
        rno = (it.receipt_no or "").strip() or None
        ono = (it.order_no or "").strip() or None

        # Resolve bank account
        acc_id = None
        if it.bank_account_id and it.bank_account_id in acc_by_id:
            acc_id = it.bank_account_id
        elif it.bank_account_name and it.bank_account_name.strip().lower() in acc_by_name:
            acc_id = acc_by_name[it.bank_account_name.strip().lower()]
        else:
            acc_id, _ = resolve_bank_account_for_tx(
                it.payment_method, it.order_type, channel_map, default_acc
            )

        is_paid = (it.status or "paid").lower() in ("paid", "dibayar", "sukses")
        gross = max(0.0, float(it.gross_sales or 0.0))
        disc = max(0.0, float(it.discount_amount or 0.0))
        fee = max(0.0, float(it.platform_fee or 0.0))
        net_s = max(0.0, gross - disc) if is_paid else 0.0
        net_r = max(0.0, net_s - fee) if is_paid else 0.0
        canc_tot = max(0.0, gross - disc) if not is_paid else 0.0
        st = "paid" if is_paid else "void"

        existing = existing_by_receipt.get(rno) if rno else None
        if existing:
            if not payload.update_existing:
                skipped += 1
                continue
            existing.transaction_date = it.transaction_date
            if it.transaction_time:
                existing.transaction_time = it.transaction_time.strip()
            if ono:
                existing.order_no = ono
            existing.order_type = it.order_type.strip()
            existing.payment_method = it.payment_method.strip()
            existing.bank_account_id = acc_id
            if it.customer_name:
                existing.customer_name = it.customer_name.strip()
            if it.cashier_name:
                existing.cashier_name = it.cashier_name.strip()
            existing.gross_sales = gross
            existing.discount_amount = disc
            existing.net_sales = net_s
            existing.platform_fee = fee
            existing.net_received = net_r
            existing.cancellation_total = canc_tot
            existing.status = st
            if it.notes:
                existing.notes = it.notes.strip()
            updated += 1
        else:
            new_tx = IncomingTransaction(
                source_type="manual",
                receipt_no=rno,
                order_no=ono,
                transaction_date=it.transaction_date,
                transaction_time=(it.transaction_time or "").strip() or None,
                order_type=it.order_type.strip(),
                payment_method=it.payment_method.strip(),
                bank_account_id=acc_id,
                customer_name=(it.customer_name or "").strip() or None,
                cashier_name=(it.cashier_name or "").strip() or None,
                gross_sales=gross,
                discount_amount=disc,
                net_sales=net_s,
                platform_fee=fee,
                net_received=net_r,
                cancellation_total=canc_tot,
                status=st,
                notes=(it.notes or "").strip() or None,
            )
            db.add(new_tx)
            if rno:
                existing_by_receipt[rno] = new_tx
            added += 1

    await db.commit()
    return {
        "ok": True,
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "message": f"Berhasil memproses transaksi masuk: {added} ditambahkan, {updated} diperbarui, {skipped} dilewati.",
    }


@router.post("/import-csv", dependencies=[Depends(require_roles("admin", "admin_input"))])
async def api_import_incoming_csv(
    file: UploadFile = File(...),
    update_existing: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    """Import banyak transaksi masuk dari file CSV (format Transaction Import.csv maupun POS per-item)."""
    content = await file.read()
    validate_upload_file(content, file.filename, allowed_extensions=(".csv",))

    parsed_txs = None
    try:
        parsed_res = parse_sales_csv(content)
        if parsed_res and parsed_res.transactions:
            parsed_txs = parsed_res.transactions
    except Exception:
        parsed_txs = None

    if parsed_txs is not None:
        acc_res = await db.execute(select(BankAccount))
        all_accounts = acc_res.scalars().all()
        acc_by_name = {a.name.strip().lower(): a.id for a in all_accounts}
        channel_map, default_acc = await build_channel_account_map(db)

        csv_receipt_nos = [t["receipt_no"] for t in parsed_txs if t.get("receipt_no")]
        existing_by_receipt: dict[str, IncomingTransaction] = {}
        if csv_receipt_nos:
            res = await db.execute(
                select(IncomingTransaction).where(
                    IncomingTransaction.receipt_no.in_(csv_receipt_nos)
                )
            )
            for tx in res.scalars().all():
                if tx.receipt_no:
                    existing_by_receipt[tx.receipt_no.strip()] = tx

        added = 0
        updated = 0
        skipped = 0

        for tx_data in parsed_txs:
            rno = tx_data.get("receipt_no")
            ono = tx_data.get("order_no")
            tx_date = tx_data["transaction_date"]
            if not tx_date:
                skipped += 1
                continue

            order_type = tx_data["order_type"] or "Take Away"
            pay_method = tx_data["payment_method"] or "Tunai"

            target_acc_raw = (tx_data.get("bank_account_name") or "").strip().lower()
            if target_acc_raw and target_acc_raw in acc_by_name:
                acc_id = acc_by_name[target_acc_raw]
            else:
                acc_id, _ = resolve_bank_account_for_tx(pay_method, order_type, channel_map, default_acc)

            existing = existing_by_receipt.get(rno) if rno else None
            if existing:
                if not update_existing:
                    skipped += 1
                    continue
                existing.transaction_date = tx_date
                if tx_data.get("transaction_time"):
                    existing.transaction_time = tx_data["transaction_time"]
                if ono:
                    existing.order_no = ono
                existing.order_type = order_type
                existing.payment_method = pay_method
                existing.bank_account_id = acc_id
                if tx_data.get("customer_name"):
                    existing.customer_name = tx_data["customer_name"]
                if tx_data.get("cashier_name"):
                    existing.cashier_name = tx_data["cashier_name"]
                existing.gross_sales = tx_data["gross_sales"]
                existing.discount_amount = tx_data["discount_amount"]
                existing.net_sales = tx_data["net_sales"]
                existing.platform_fee = tx_data["platform_fee"]
                existing.net_received = tx_data["net_received"]
                existing.cancellation_total = tx_data["cancellation_total"]
                existing.status = tx_data["status"]
                if tx_data.get("notes"):
                    existing.notes = tx_data["notes"]
                updated += 1
            else:
                new_tx = IncomingTransaction(
                    source_type=tx_data.get("source_type", "pos"),
                    receipt_no=rno,
                    order_no=ono,
                    transaction_date=tx_date,
                    transaction_time=tx_data.get("transaction_time"),
                    location_name=tx_data.get("location_name"),
                    order_type=order_type,
                    payment_method=pay_method,
                    bank_account_id=acc_id,
                    customer_name=tx_data.get("customer_name"),
                    cashier_name=tx_data.get("cashier_name"),
                    gross_sales=tx_data["gross_sales"],
                    discount_amount=tx_data["discount_amount"],
                    net_sales=tx_data["net_sales"],
                    platform_fee=tx_data["platform_fee"],
                    net_received=tx_data["net_received"],
                    cancellation_total=tx_data["cancellation_total"],
                    promo_name=tx_data.get("promo_name"),
                    status=tx_data["status"],
                    void_at=tx_data.get("void_at"),
                    notes=tx_data.get("notes"),
                    items=[
                        IncomingTransactionItem(
                            category=it["category"],
                            product_group=it["product_group"],
                            product_name=it["product_name"],
                            sku=it["sku"],
                            qty=it["qty"],
                            modifier=it["modifier"],
                            unit_price=it["unit_price"],
                            extra_price=it["extra_price"],
                            gross_amount=it["gross_amount"],
                            discount_amount=it["discount_amount"],
                        )
                        for it in tx_data.get("items", [])
                    ],
                )
                db.add(new_tx)
                if rno:
                    existing_by_receipt[rno] = new_tx
                added += 1

        await db.commit()
        audit_res = audit_sales_transactions(
            parsed_txs,
            existing_receipts=set(existing_by_receipt.keys()),
            registered_bank_accounts=set(acc_by_name.keys()),
            skipped_rows=parsed_res.skipped_rows if parsed_res else None,
        )
        return {
            "ok": True,
            "added": added,
            "updated": updated,
            "skipped": skipped,
            "audit": audit_res,
            "message": f"Import CSV transaksi selesai: {added} ditambahkan, {updated} diperbarui, {skipped} dilewati."
            + (f" ({audit_res['warning_count']} catatan audit)" if audit_res["warning_count"] > 0 else ""),
        }

    first_row, data_rows = parse_csv_table(content)

    idx_rno = col_lookup(first_row, "receipt_no", "no receipt", "no struk", "receipt", "struk")
    idx_ono = col_lookup(first_row, "order_no", "no order", "no penjualan", "order id")
    idx_date = col_lookup(first_row, "transaction_date", "tanggal", "tanggal transaksi", "tanggal penjualan", "date")
    idx_time = col_lookup(first_row, "transaction_time", "waktu", "jam", "waktu penjualan", "time")
    idx_type = col_lookup(first_row, "order_type", "tipe order", "channel", "saluran")
    idx_pay = col_lookup(first_row, "payment_method", "metode bayar", "metode pembayaran", "jenis pembayaran", "payment")
    idx_acc = col_lookup(first_row, "bank_account", "rekening", "rekening tujuan", "nama rekening", "bank")
    idx_cust = col_lookup(first_row, "customer_name", "nama pelanggan", "pelanggan", "customer")
    idx_cashier = col_lookup(first_row, "cashier_name", "nama kasir", "kasir", "cashier")
    idx_gross = col_lookup(first_row, "gross_sales", "penjualan kotor", "total kotor", "gross", "harga")
    idx_disc = col_lookup(first_row, "discount_amount", "diskon", "total diskon", "discount")
    idx_fee = col_lookup(first_row, "platform_fee", "fee platform", "biaya platform", "biaya pembayaran", "platform fee", "komisi")
    idx_status = col_lookup(first_row, "status", "status transaksi")
    idx_notes = col_lookup(first_row, "notes", "catatan", "keterangan")

    if idx_date is None:
        raise HTTPException(status_code=400, detail="Kolom tanggal transaksi ('Tanggal' atau 'transaction_date') wajib ada pada file CSV.")

    # Cache accounts
    acc_res = await db.execute(select(BankAccount))
    all_accounts = acc_res.scalars().all()
    acc_by_name = {a.name.strip().lower(): a.id for a in all_accounts}
    channel_map, default_acc = await build_channel_account_map(db)

    # Existing transactions lookup
    csv_receipt_nos = [
        get_cell(r, idx_rno).strip() for r in data_rows if idx_rno is not None and get_cell(r, idx_rno).strip()
    ]
    existing_by_receipt: dict[str, IncomingTransaction] = {}
    if csv_receipt_nos:
        res = await db.execute(
            select(IncomingTransaction).where(
                IncomingTransaction.receipt_no.in_(csv_receipt_nos)
            )
        )
        for tx in res.scalars().all():
            if tx.receipt_no:
                existing_by_receipt[tx.receipt_no.strip()] = tx

    added = 0
    updated = 0
    skipped = 0

    for r in data_rows:
        tx_date = parse_date_cell(get_cell(r, idx_date))
        if not tx_date:
            skipped += 1
            continue

        rno = get_cell(r, idx_rno).strip() or None
        ono = get_cell(r, idx_ono).strip() or None
        order_type = get_cell(r, idx_type).strip() or "Take Away"
        pay_method = get_cell(r, idx_pay).strip() or "Tunai"

        acc_name_raw = get_cell(r, idx_acc).strip().lower()
        if acc_name_raw and acc_name_raw in acc_by_name:
            acc_id = acc_by_name[acc_name_raw]
        else:
            acc_id, _ = resolve_bank_account_for_tx(pay_method, order_type, channel_map, default_acc)

        raw_status = get_cell(r, idx_status).lower()
        is_paid = raw_status not in ("void", "batal", "cancelled", "cancel")
        st = "paid" if is_paid else "void"

        gross = max(0.0, parse_number_cell(get_cell(r, idx_gross)))
        disc = max(0.0, parse_number_cell(get_cell(r, idx_disc)))
        fee = max(0.0, parse_number_cell(get_cell(r, idx_fee)))
        net_s = max(0.0, gross - disc) if is_paid else 0.0
        net_r = max(0.0, net_s - fee) if is_paid else 0.0
        canc_tot = max(0.0, gross - disc) if not is_paid else 0.0

        existing = existing_by_receipt.get(rno) if rno else None
        if existing:
            if not update_existing:
                skipped += 1
                continue
            existing.transaction_date = tx_date
            time_str = get_cell(r, idx_time).strip()
            if time_str:
                existing.transaction_time = time_str
            if ono:
                existing.order_no = ono
            existing.order_type = order_type
            existing.payment_method = pay_method
            existing.bank_account_id = acc_id
            cust = get_cell(r, idx_cust).strip()
            if cust:
                existing.customer_name = cust
            cashier = get_cell(r, idx_cashier).strip()
            if cashier:
                existing.cashier_name = cashier
            existing.gross_sales = gross
            existing.discount_amount = disc
            existing.net_sales = net_s
            existing.platform_fee = fee
            existing.net_received = net_r
            existing.cancellation_total = canc_tot
            existing.status = st
            notes = get_cell(r, idx_notes).strip()
            if notes:
                existing.notes = notes
            updated += 1
        else:
            new_tx = IncomingTransaction(
                source_type="pos",
                receipt_no=rno,
                order_no=ono,
                transaction_date=tx_date,
                transaction_time=get_cell(r, idx_time).strip() or None,
                order_type=order_type,
                payment_method=pay_method,
                bank_account_id=acc_id,
                customer_name=get_cell(r, idx_cust).strip() or None,
                cashier_name=get_cell(r, idx_cashier).strip() or None,
                gross_sales=gross,
                discount_amount=disc,
                net_sales=net_s,
                platform_fee=fee,
                net_received=net_r,
                cancellation_total=canc_tot,
                status=st,
                notes=get_cell(r, idx_notes).strip() or None,
            )
            db.add(new_tx)
            if rno:
                existing_by_receipt[rno] = new_tx
            added += 1

    await db.commit()
    return {
        "ok": True,
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "message": f"Import CSV transaksi selesai: {added} ditambahkan, {updated} diperbarui, {skipped} dilewati.",
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def api_create_incoming_transaction(
    payload: ManualIncomingTxCreate,
    db: AsyncSession = Depends(get_db),
):
    is_paid = (payload.status or "paid").lower() in ("paid", "dibayar", "sukses")
    net_sales = max(0.0, payload.gross_sales - payload.discount_amount) if is_paid else 0.0
    net_received = max(0.0, net_sales - payload.platform_fee) if is_paid else 0.0
    cancellation_total = max(0.0, payload.gross_sales - payload.discount_amount) if not is_paid else 0.0

    bank_account_id = payload.bank_account_id
    if bank_account_id is None:
        channel_map, default_acc = await build_channel_account_map(db)
        bank_account_id, _ = resolve_bank_account_for_tx(
            payload.payment_method, payload.order_type, channel_map, default_acc
        )

    r_no = (payload.receipt_no or "").strip() or None
    if r_no:
        existing = await db.execute(
            select(IncomingTransaction).where(
                IncomingTransaction.source_type == "manual",
                IncomingTransaction.receipt_no == r_no,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No Receipt '{r_no}' sudah terdaftar.",
            )

    tx = IncomingTransaction(
        source_type="manual",
        receipt_no=r_no,
        order_no=(payload.order_no or "").strip() or None,
        transaction_date=payload.transaction_date,
        transaction_time=(payload.transaction_time or "").strip() or None,
        order_type=payload.order_type.strip(),
        payment_method=payload.payment_method.strip(),
        bank_account_id=bank_account_id,
        customer_name=(payload.customer_name or "").strip() or None,
        cashier_name=(payload.cashier_name or "").strip() or None,
        gross_sales=payload.gross_sales,
        discount_amount=payload.discount_amount,
        net_sales=net_sales,
        platform_fee=payload.platform_fee,
        net_received=net_received,
        cancellation_total=cancellation_total,
        status="paid" if is_paid else "void",
        notes=(payload.notes or "").strip() or None,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)
    return {"ok": True, "transaction": _serialize_tx(tx)}


@router.put("/{tx_id}")
async def api_update_incoming_transaction(
    tx_id: int,
    payload: ManualIncomingTxUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update field transaksi masuk satuan."""
    tx = await db.get(IncomingTransaction, tx_id)
    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaksi tidak ditemukan.")

    if payload.receipt_no is not None:
        rno_clean = payload.receipt_no.strip() or None
        if rno_clean and rno_clean != tx.receipt_no:
            existing = await db.execute(
                select(IncomingTransaction).where(
                    IncomingTransaction.source_type == tx.source_type,
                    IncomingTransaction.receipt_no == rno_clean,
                    IncomingTransaction.id != tx.id,
                )
            )
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"No Receipt '{rno_clean}' sudah digunakan pada transaksi lain.",
                )
        tx.receipt_no = rno_clean

    if payload.transaction_date is not None:
        tx.transaction_date = payload.transaction_date
    if payload.transaction_time is not None:
        tx.transaction_time = payload.transaction_time.strip() or None
    if payload.order_type is not None:
        tx.order_type = payload.order_type.strip()
    if payload.payment_method is not None:
        tx.payment_method = payload.payment_method.strip()
    if payload.bank_account_id is not None:
        if payload.bank_account_id == 0:
            tx.bank_account_id = None
        else:
            acc = await db.get(BankAccount, payload.bank_account_id)
            if not acc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rekening tidak ditemukan.")
            tx.bank_account_id = payload.bank_account_id
    if payload.order_no is not None:
        tx.order_no = payload.order_no.strip() or None
    if payload.customer_name is not None:
        tx.customer_name = payload.customer_name.strip() or None
    if payload.cashier_name is not None:
        tx.cashier_name = payload.cashier_name.strip() or None
    if payload.gross_sales is not None:
        tx.gross_sales = payload.gross_sales
    if payload.discount_amount is not None:
        tx.discount_amount = payload.discount_amount
    if payload.platform_fee is not None:
        tx.platform_fee = payload.platform_fee
    if payload.status is not None:
        tx.status = payload.status.strip().lower()
    if payload.notes is not None:
        tx.notes = payload.notes.strip() or None

    is_paid = tx.status in ("paid", "dibayar", "sukses")
    tx.net_sales = max(0.0, tx.gross_sales - tx.discount_amount) if is_paid else 0.0
    tx.net_received = max(0.0, tx.net_sales - tx.platform_fee) if is_paid else 0.0
    tx.cancellation_total = max(0.0, tx.gross_sales - tx.discount_amount) if not is_paid else 0.0

    await db.commit()
    await db.refresh(tx)
    return {"ok": True, "transaction": _serialize_tx(tx)}


@router.patch("/{tx_id}/bank-account")
async def api_reassign_bank_account(
    tx_id: int,
    payload: ReassignBankAccountPayload,
    db: AsyncSession = Depends(get_db),
):
    tx = await db.get(IncomingTransaction, tx_id)
    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaksi tidak ditemukan.")
    if payload.bank_account_id is not None:
        acc = await db.get(BankAccount, payload.bank_account_id)
        if not acc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rekening tidak ditemukan.")
    tx.bank_account_id = payload.bank_account_id
    await db.commit()
    await db.refresh(tx)
    return {"ok": True, "transaction": _serialize_tx(tx)}


@router.delete("/{tx_id}", dependencies=[Depends(require_admin_role)])
async def api_delete_incoming_transaction(
    tx_id: int,
    db: AsyncSession = Depends(get_db),
):
    tx = await db.get(IncomingTransaction, tx_id)
    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaksi tidak ditemukan.")
    await db.delete(tx)
    await db.commit()
    return {"ok": True}


async def _find_existing_receipts(
    db: AsyncSession,
    source_type: str,
    receipt_nos: list[str],
) -> set[str]:
    if not receipt_nos:
        return set()
    res = await db.execute(
        select(IncomingTransaction.receipt_no).where(
            IncomingTransaction.source_type == source_type,
            IncomingTransaction.receipt_no.in_(receipt_nos),
        )
    )
    return {r[0] for r in res.fetchall() if r[0]}


class SalesImportRowOverride(BaseModel):
    receipt_no: Optional[str] = Field(None, max_length=80)
    transaction_date: Optional[str] = None
    order_type: Optional[str] = Field(None, max_length=60)
    payment_method: Optional[str] = Field(None, max_length=60)
    bank_account_id: Optional[int] = None
    bank_account_name: Optional[str] = Field(None, max_length=120)
    gross_sales: Optional[float] = Field(None, ge=0)
    discount_amount: Optional[float] = Field(None, ge=0)
    platform_fee: Optional[float] = Field(None, ge=0)
    status: Optional[str] = Field(None, max_length=20)
    notes: Optional[str] = None
    exclude: bool = False


def _parse_overrides_json(overrides_json: Optional[str]) -> dict[int, dict[str, Any]]:
    if not overrides_json or not overrides_json.strip():
        return {}
    try:
        raw = json.loads(overrides_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format overrides_json tidak valid.",
        )
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="overrides_json harus berupa objek JSON dengan kunci indeks baris.",
        )
    validated: dict[int, dict[str, Any]] = {}
    for k, v in raw.items():
        try:
            idx = int(k)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Indeks baris override tidak valid: {k}",
            )
        if not isinstance(v, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Data override untuk baris #{idx} harus berupa objek.",
            )
        try:
            model = SalesImportRowOverride(**v)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Validasi override baris #{idx} gagal: {exc.errors()[0].get('msg', 'data tidak valid')}",
            )
        validated[idx] = model.model_dump(exclude_unset=True)
    return validated


def _serialize_editable_import_row(tx: dict[str, Any]) -> dict[str, Any]:
    tx_date = tx.get("transaction_date")
    return {
        "tx_index": tx.get("tx_index"),
        "receipt_no": tx.get("receipt_no"),
        "order_no": tx.get("order_no"),
        "transaction_date": tx_date.isoformat() if isinstance(tx_date, date) else (str(tx_date) if tx_date else ""),
        "transaction_time": tx.get("transaction_time"),
        "order_type": tx.get("order_type") or "",
        "payment_method": tx.get("payment_method") or "",
        "bank_account_id": tx.get("bank_account_id"),
        "bank_account_name": tx.get("bank_account_name"),
        "raw_bank_account_name": tx.get("raw_bank_account_name"),
        "gross_sales": float(tx.get("gross_sales") or 0.0),
        "discount_amount": float(tx.get("discount_amount") or 0.0),
        "platform_fee": float(tx.get("platform_fee") or 0.0),
        "net_received": float(tx.get("net_received") or 0.0),
        "status": tx.get("status") or "paid",
        "notes": tx.get("notes") or "",
        "item_count": len(tx.get("items", [])),
        "is_edited": bool(tx.get("_edited")),
        "is_excluded": bool(tx.get("_excluded")),
    }


@router.post("/import/preview")
async def api_preview_sales_import(
    file: UploadFile = File(...),
    source_type: str = Form("auto"),
    overrides_json: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    validate_upload_file(content, file.filename, allowed_extensions=(".csv",))
    overrides = _parse_overrides_json(overrides_json)
    try:
        parsed = parse_sales_csv(content, source_type=source_type)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    acc_res = await db.execute(select(BankAccount).order_by(BankAccount.sort_order.asc(), BankAccount.id.asc()))
    all_accounts = acc_res.scalars().all()
    acc_by_id = {a.id: a for a in all_accounts}
    acc_by_name = {a.name.strip().lower(): a for a in all_accounts}
    channel_map, default_acc = await build_channel_account_map(db)

    apply_sales_import_overrides(
        parsed.transactions,
        overrides=overrides,
        acc_by_id=acc_by_id,
        acc_by_name=acc_by_name,
    )

    active_txs = [t for t in parsed.transactions if not t.get("_excluded")]
    receipt_nos = [t["receipt_no"] for t in active_txs if t.get("receipt_no")]
    existing_receipts = await _find_existing_receipts(db, parsed.source_type, receipt_nos)

    new_paid = []
    new_void = []
    duplicates = []

    channel_breakdown: dict[str, dict[str, Any]] = {}

    for tx in active_txs:
        rno = tx.get("receipt_no")
        if rno and rno in existing_receipts:
            duplicates.append(tx)
            continue

        if not tx.get("_bank_overridden"):
            target_acc_raw = (tx.get("bank_account_name") or "").strip().lower()
            if target_acc_raw and target_acc_raw in acc_by_name:
                matched_acc = acc_by_name[target_acc_raw]
                acc_id = matched_acc.id
                acc_name = matched_acc.name
            else:
                acc_id, acc_name = resolve_bank_account_for_tx(
                    tx["payment_method"], tx["order_type"], channel_map, default_acc
                )
            tx["bank_account_id"] = acc_id
            tx["bank_account_name"] = acc_name

        if tx["status"] == "paid":
            new_paid.append(tx)
            ch = tx["order_type"]
            if ch not in channel_breakdown:
                channel_breakdown[ch] = {"count": 0, "net_received": 0.0, "platform_fee": 0.0}
            channel_breakdown[ch]["count"] += 1
            channel_breakdown[ch]["net_received"] += tx["net_received"]
            channel_breakdown[ch]["platform_fee"] += tx["platform_fee"]
        else:
            new_void.append(tx)

    preview_rows = []
    for tx in (new_paid + new_void)[:15]:
        preview_rows.append(
            {
                "tx_index": tx["tx_index"],
                "receipt_no": tx["receipt_no"],
                "order_no": tx["order_no"],
                "transaction_date": tx["transaction_date"].isoformat(),
                "transaction_time": tx["transaction_time"],
                "order_type": tx["order_type"],
                "payment_method": tx["payment_method"],
                "bank_account_id": tx.get("bank_account_id"),
                "bank_account_name": tx.get("bank_account_name"),
                "gross_sales": tx["gross_sales"],
                "discount_amount": tx["discount_amount"],
                "platform_fee": tx["platform_fee"],
                "net_received": tx["net_received"],
                "status": tx["status"],
                "item_count": len(tx.get("items", [])),
                "is_edited": bool(tx.get("_edited")),
            }
        )

    audit_res = audit_sales_transactions(
        parsed.transactions,
        existing_receipts=existing_receipts,
        registered_bank_accounts=set(acc_by_name.keys()),
        skipped_rows=parsed.skipped_rows,
    )

    # Kumpulkan baris yang memiliki temuan audit, sedang di-sample, atau pernah diedit agar user bisa edit/reset
    relevant_indices: set[int] = set()
    for f in audit_res["findings"]:
        if f.get("tx_index") is not None:
            relevant_indices.add(int(f["tx_index"]))
    for r in preview_rows:
        if r.get("tx_index") is not None:
            relevant_indices.add(int(r["tx_index"]))
    for idx_key in overrides.keys():
        relevant_indices.add(int(idx_key))

    editable_rows = {
        str(tx["tx_index"]): _serialize_editable_import_row(tx)
        for tx in parsed.transactions
        if tx["tx_index"] in relevant_indices
    }

    available_accounts = [
        {
            "id": a.id,
            "name": a.name,
            "bank_name": a.bank_name,
            "account_type": a.account_type,
        }
        for a in all_accounts
        if a.is_active
    ]

    edited_count = sum(1 for t in parsed.transactions if t.get("_edited") and not t.get("_excluded"))
    excluded_count = sum(1 for t in parsed.transactions if t.get("_excluded"))

    return {
        "ok": True,
        "preview": {
            "source_type": parsed.source_type,
            "total_transactions": len(active_txs),
            "new_paid_count": len(new_paid),
            "new_void_count": len(new_void),
            "duplicate_count": len(duplicates),
            "skipped_count": len(parsed.skipped_rows),
            "edited_count": edited_count,
            "excluded_count": excluded_count,
            "total_items": sum(len(t.get("items", [])) for t in active_txs),
            "total_gross_sales": sum(t["gross_sales"] for t in new_paid),
            "total_discount": sum(t["discount_amount"] for t in new_paid),
            "total_platform_fee": sum(t["platform_fee"] for t in new_paid),
            "total_net_received": sum(t["net_received"] for t in new_paid),
            "total_void_amount": sum(t["cancellation_total"] for t in new_void),
            "channel_breakdown": channel_breakdown,
            "sample_rows": preview_rows,
            "editable_rows": editable_rows,
            "available_accounts": available_accounts,
            "audit": audit_res,
        },
    }


@router.post("/import/commit")
async def api_commit_sales_import(
    file: UploadFile = File(...),
    source_type: str = Form("auto"),
    skip_duplicates: bool = Form(True),
    include_void: bool = Form(True),
    overrides_json: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    validate_upload_file(content, file.filename, allowed_extensions=(".csv",))
    overrides = _parse_overrides_json(overrides_json)
    try:
        parsed = parse_sales_csv(content, source_type=source_type)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    acc_res = await db.execute(select(BankAccount))
    all_accounts = acc_res.scalars().all()
    acc_by_id = {a.id: a for a in all_accounts}
    acc_by_name_obj = {a.name.strip().lower(): a for a in all_accounts}
    acc_by_name = {a.name.strip().lower(): a.id for a in all_accounts}
    channel_map, default_acc = await build_channel_account_map(db)

    apply_sales_import_overrides(
        parsed.transactions,
        overrides=overrides,
        acc_by_id=acc_by_id,
        acc_by_name=acc_by_name_obj,
    )

    active_txs = [t for t in parsed.transactions if not t.get("_excluded")]
    receipt_nos = [t["receipt_no"] for t in active_txs if t.get("receipt_no")]
    existing_receipts = (
        await _find_existing_receipts(db, parsed.source_type, receipt_nos)
        if skip_duplicates
        else set()
    )

    pre_audit = audit_sales_transactions(
        parsed.transactions,
        existing_receipts=existing_receipts,
        registered_bank_accounts=set(acc_by_name.keys()),
        skipped_rows=parsed.skipped_rows,
    )
    if pre_audit["has_blocking_errors"]:
        first_err = next((f["message"] for f in pre_audit["findings"] if f["level"] == "error"), "Terdapat error kritis.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Import dibatalkan karena masih ada error kritis: {first_err}",
        )

    inserted_paid = 0
    inserted_void = 0
    duplicate_count = 0
    excluded_count = len(parsed.transactions) - len(active_txs)

    for tx_data in active_txs:
        rno = tx_data.get("receipt_no")
        if skip_duplicates and rno and rno in existing_receipts:
            duplicate_count += 1
            continue
        if not include_void and tx_data["status"] != "paid":
            continue

        if tx_data.get("_bank_overridden"):
            acc_id = tx_data.get("bank_account_id")
        else:
            target_acc_raw = (tx_data.get("bank_account_name") or "").strip().lower()
            if target_acc_raw and target_acc_raw in acc_by_name:
                acc_id = acc_by_name[target_acc_raw]
            else:
                acc_id, _ = resolve_bank_account_for_tx(
                    tx_data["payment_method"], tx_data["order_type"], channel_map, default_acc
                )

        tx_model = IncomingTransaction(
            source_type=tx_data["source_type"],
            receipt_no=tx_data["receipt_no"],
            order_no=tx_data["order_no"],
            transaction_date=tx_data["transaction_date"],
            transaction_time=tx_data["transaction_time"],
            location_name=tx_data["location_name"],
            order_type=tx_data["order_type"],
            payment_method=tx_data["payment_method"],
            bank_account_id=acc_id,
            customer_name=tx_data["customer_name"],
            cashier_name=tx_data["cashier_name"],
            gross_sales=tx_data["gross_sales"],
            discount_amount=tx_data["discount_amount"],
            net_sales=tx_data["net_sales"],
            platform_fee=tx_data["platform_fee"],
            net_received=tx_data["net_received"],
            cancellation_total=tx_data["cancellation_total"],
            promo_name=tx_data["promo_name"],
            status=tx_data["status"],
            void_at=tx_data["void_at"],
            notes=tx_data["notes"],
            items=[
                IncomingTransactionItem(
                    category=it["category"],
                    product_group=it["product_group"],
                    product_name=it["product_name"],
                    sku=it["sku"],
                    qty=it["qty"],
                    modifier=it["modifier"],
                    unit_price=it["unit_price"],
                    extra_price=it["extra_price"],
                    gross_amount=it["gross_amount"],
                    discount_amount=it["discount_amount"],
                )
                for it in tx_data.get("items", [])
            ],
        )
        db.add(tx_model)
        if rno:
            existing_receipts.add(rno)
        if tx_data["status"] == "paid":
            inserted_paid += 1
        else:
            inserted_void += 1

    await db.commit()

    audit_res = audit_sales_transactions(
        parsed.transactions,
        existing_receipts=existing_receipts,
        registered_bank_accounts=set(acc_by_name.keys()),
        skipped_rows=parsed.skipped_rows,
    )

    return {
        "ok": True,
        "result": {
            "inserted_paid": inserted_paid,
            "inserted_void": inserted_void,
            "duplicate_count": duplicate_count,
            "skipped_count": len(parsed.skipped_rows),
            "excluded_count": excluded_count,
            "audit_summary": {
                "total_findings": audit_res["total_findings"],
                "warning_count": audit_res["warning_count"],
                "error_count": audit_res["error_count"],
                "info_count": audit_res["info_count"],
            },
        },
    }
