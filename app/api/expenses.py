"""
app/api/expenses.py — REST API for Expenses Management
"""
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.models.expense import Expense
from app.api.deps import require_auth
from app.api.schemas import (
    ExpenseCreate,
    ExpenseUpdate,
    ExpenseResponse,
    ExpenseListResponse,
)
from app.services.expense_service import (
    get_all_expenses_paginated,
    get_expense_by_id,
    update_expense,
    delete_expense,
)

router = APIRouter(prefix="/expenses", tags=["expenses"], dependencies=[Depends(require_auth)])


def _to_response_dict(e: Expense) -> dict:
    return {
        "id": e.id,
        "created_at": e.created_at,
        "expense_date": str(e.expense_date),
        "supplier": e.supplier or "-",
        "item_name": e.item_name or "-",
        "qty": float(e.qty or 1),
        "category": e.category or "Operasional",
        "unit_price": float(e.unit_price or 0),
        "tax": float(e.tax or 0),
        "discount": float(e.discount or 0),
        "total_price": float(e.total_price or 0),
        "pay_method": e.pay_method or "Tunai",
        "pay_status": e.pay_status or "Lunas",
        "due_date": e.due_date or "-",
        "notes": e.notes or "-",
        "msg_link": e.msg_link or "Web Dashboard",
        "sheets_synced": bool(e.sheets_synced),
    }


@router.get("", response_model=ExpenseListResponse)
async def list_expenses(
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    category: str | None = Query(None),
    month: int | None = Query(None),
    year: int | None = Query(None),
    search: str | None = Query(None),
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    expenses, total = await get_all_expenses_paginated(
        db,
        page=page,
        per_page=per_page,
        category=category,
        month=month,
        year=year,
        search=search,
        status=status,
    )
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1

    return ExpenseListResponse(
        ok=True,
        data=[ExpenseResponse(**_to_response_dict(e)) for e in expenses],
        total=total,
        page=page,
        per_page=per_page,
        total_pages=total_pages,
    )


@router.post("", response_model=ExpenseResponse, status_code=status.HTTP_201_CREATED)
async def create_expense(
    payload: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
):
    qty = Decimal(str(payload.qty or 1))
    unit_price = Decimal(str(payload.unit_price or 0))
    tax = Decimal(str(payload.tax or 0))
    discount = Decimal(str(payload.discount or 0))

    # Jika total_price tidak diset manual, hitung otomatis
    if payload.total_price > 0:
        total_price = Decimal(str(payload.total_price))
    else:
        total_price = (qty * unit_price) + tax - discount

    expense = Expense(
        expense_date=payload.expense_date,
        supplier=payload.supplier or "-",
        item_name=payload.item_name,
        qty=qty,
        category=payload.category or "Operasional",
        unit_price=unit_price,
        tax=tax,
        discount=discount,
        total_price=total_price,
        pay_method=payload.pay_method or "Tunai",
        pay_status=payload.pay_status or "Lunas",
        due_date=payload.due_date or "-",
        notes=payload.notes or "-",
        msg_link="Web Dashboard",
        sheets_synced=False,
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)

    return ExpenseResponse(**_to_response_dict(expense))


@router.get("/{expense_id}", response_model=ExpenseResponse)
async def get_expense(
    expense_id: int,
    db: AsyncSession = Depends(get_db),
):
    expense = await get_expense_by_id(db, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")
    return ExpenseResponse(**_to_response_dict(expense))


@router.put("/{expense_id}", response_model=ExpenseResponse)
async def update_expense_endpoint(
    expense_id: int,
    payload: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        expense = await get_expense_by_id(db, expense_id)
        if not expense:
            raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")
        return ExpenseResponse(**_to_response_dict(expense))

    expense = await update_expense(db, expense_id, updates)
    if not expense:
        raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")

    await db.commit()
    await db.refresh(expense)
    return ExpenseResponse(**_to_response_dict(expense))


@router.delete("/{expense_id}")
async def delete_expense_endpoint(
    expense_id: int,
    db: AsyncSession = Depends(get_db),
):
    deleted = await delete_expense(db, expense_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")
    await db.commit()
    return {"ok": True, "message": "Pengeluaran berhasil dihapus"}
