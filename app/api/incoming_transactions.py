"""
app/api/incoming_transactions.py — REST API for Daftar Transaksi Masuk & Import Laporan POS/Platform
"""
from datetime import date
from typing import Any, Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_auth, require_admin_role
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.models.bank_account import BankAccount
from app.services.bank_account_service import build_channel_account_map, resolve_bank_account_for_tx
from app.services.sales_import_service import parse_sales_csv

router = APIRouter(
    prefix="/incoming-transactions",
    tags=["incoming-transactions"],
    dependencies=[Depends(require_auth)],
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
    gross_sales: float = Field(..., ge=0)
    discount_amount: float = Field(0.0, ge=0)
    platform_fee: float = Field(0.0, ge=0)
    notes: Optional[str] = None


class ReassignBankAccountPayload(BaseModel):
    bank_account_id: Optional[int] = None


@router.get("")
async def api_list_incoming_transactions(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    order_type: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    bank_account_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
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

    where_clause = and_(*conditions) if conditions else True

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
    paid_cond = and_(where_clause, IncomingTransaction.status == "paid") if conditions else (IncomingTransaction.status == "paid")
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

    void_cond = and_(where_clause, IncomingTransaction.status != "paid") if conditions else (IncomingTransaction.status != "paid")
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


@router.post("", status_code=status.HTTP_201_CREATED)
async def api_create_incoming_transaction(
    payload: ManualIncomingTxCreate,
    db: AsyncSession = Depends(get_db),
):
    net_sales = max(0.0, payload.gross_sales - payload.discount_amount)
    net_received = max(0.0, net_sales - payload.platform_fee)

    bank_account_id = payload.bank_account_id
    if bank_account_id is None:
        channel_map, default_acc = await build_channel_account_map(db)
        bank_account_id, _ = resolve_bank_account_for_tx(
            payload.payment_method, payload.order_type, channel_map, default_acc
        )

    tx = IncomingTransaction(
        source_type="manual",
        receipt_no=(payload.receipt_no or "").strip() or None,
        order_no=(payload.order_no or "").strip() or None,
        transaction_date=payload.transaction_date,
        transaction_time=(payload.transaction_time or "").strip() or None,
        order_type=payload.order_type.strip(),
        payment_method=payload.payment_method.strip(),
        bank_account_id=bank_account_id,
        customer_name=(payload.customer_name or "").strip() or None,
        gross_sales=payload.gross_sales,
        discount_amount=payload.discount_amount,
        net_sales=net_sales,
        platform_fee=payload.platform_fee,
        net_received=net_received,
        status="paid",
        notes=(payload.notes or "").strip() or None,
    )
    db.add(tx)
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


@router.post("/import/preview")
async def api_preview_sales_import(
    file: UploadFile = File(...),
    source_type: str = Form("auto"),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format file tidak valid. Harap unggah file .csv",
        )
    content = await file.read()
    try:
        parsed = parse_sales_csv(content, source_type=source_type)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    receipt_nos = [t["receipt_no"] for t in parsed.transactions if t.get("receipt_no")]
    existing_receipts = await _find_existing_receipts(db, parsed.source_type, receipt_nos)
    channel_map, default_acc = await build_channel_account_map(db)

    new_paid = []
    new_void = []
    duplicates = []

    channel_breakdown: dict[str, dict[str, Any]] = {}

    for tx in parsed.transactions:
        rno = tx.get("receipt_no")
        if rno and rno in existing_receipts:
            duplicates.append(tx)
            continue

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
                "receipt_no": tx["receipt_no"],
                "order_no": tx["order_no"],
                "transaction_date": tx["transaction_date"].isoformat(),
                "transaction_time": tx["transaction_time"],
                "order_type": tx["order_type"],
                "payment_method": tx["payment_method"],
                "bank_account_name": tx.get("bank_account_name"),
                "gross_sales": tx["gross_sales"],
                "discount_amount": tx["discount_amount"],
                "platform_fee": tx["platform_fee"],
                "net_received": tx["net_received"],
                "status": tx["status"],
                "item_count": len(tx.get("items", [])),
            }
        )

    return {
        "ok": True,
        "preview": {
            "source_type": parsed.source_type,
            "total_transactions": len(parsed.transactions),
            "new_paid_count": len(new_paid),
            "new_void_count": len(new_void),
            "duplicate_count": len(duplicates),
            "skipped_count": len(parsed.skipped_rows),
            "total_items": parsed.total_items,
            "total_gross_sales": sum(t["gross_sales"] for t in new_paid),
            "total_discount": sum(t["discount_amount"] for t in new_paid),
            "total_platform_fee": sum(t["platform_fee"] for t in new_paid),
            "total_net_received": sum(t["net_received"] for t in new_paid),
            "total_void_amount": sum(t["cancellation_total"] for t in new_void),
            "channel_breakdown": channel_breakdown,
            "sample_rows": preview_rows,
        },
    }


@router.post("/import/commit")
async def api_commit_sales_import(
    file: UploadFile = File(...),
    source_type: str = Form("auto"),
    skip_duplicates: bool = Form(True),
    include_void: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format file tidak valid. Harap unggah file .csv",
        )
    content = await file.read()
    try:
        parsed = parse_sales_csv(content, source_type=source_type)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    receipt_nos = [t["receipt_no"] for t in parsed.transactions if t.get("receipt_no")]
    existing_receipts = (
        await _find_existing_receipts(db, parsed.source_type, receipt_nos)
        if skip_duplicates
        else set()
    )
    channel_map, default_acc = await build_channel_account_map(db)

    inserted_paid = 0
    inserted_void = 0
    duplicate_count = 0

    for tx_data in parsed.transactions:
        rno = tx_data.get("receipt_no")
        if skip_duplicates and rno and rno in existing_receipts:
            duplicate_count += 1
            continue
        if not include_void and tx_data["status"] != "paid":
            continue

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

    return {
        "ok": True,
        "result": {
            "inserted_paid": inserted_paid,
            "inserted_void": inserted_void,
            "duplicate_count": duplicate_count,
            "skipped_count": len(parsed.skipped_rows),
        },
    }
