"""
app/api/expenses.py — REST API for Expenses Management
"""
from datetime import date
from decimal import Decimal
import base64
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.models.expense import Expense
from app.api.deps import require_auth, require_admin_role, get_current_role
from app.api.schemas import (
    ExpenseCreate,
    ExpenseBatchCreate,
    ExpenseUpdate,
    ExpenseResponse,
    ExpenseListResponse,
    ExpenseUserResponse,
    ExpenseLogResponse,
)
from app.services.expense_service import (
    get_all_expenses_paginated,
    get_expense_by_id,
    get_all_expense_users,
    get_item_price_history,
    update_expense,
    delete_expense,
    batch_insert_expenses,
    record_expense_log,
    get_expense_logs,
    get_recent_expense_logs,
)
from app.services.ai_service import call_ai_image

router = APIRouter(prefix="/expenses", tags=["expenses"], dependencies=[Depends(require_auth)])


def _to_response_dict(e: Expense) -> dict:
    user_name = None
    if getattr(e, "user", None) and e.user and e.user.name:
        user_name = e.user.name
    elif getattr(e, "user_id", None):
        user_name = f"User #{e.user_id}"

    return {
        "id": e.id,
        "created_at": e.created_at,
        "expense_date": str(e.expense_date),
        "supplier": e.supplier or "-",
        "item_name": e.item_name or "-",
        "qty": float(e.qty or 1),
        "unit": getattr(e, "unit", "Pcs") or "Pcs",
        "category": e.category or "Operasional",
        "unit_price": float(e.unit_price or 0),
        "shipping_fee": float(e.shipping_fee or 0),
        "tax": float(e.tax or 0),
        "other_fee": float(e.other_fee or 0),
        "discount": float(e.discount or 0),
        "total_price": float(e.total_price or 0),
        "pay_method": e.pay_method or "Tunai",
        "pay_status": e.pay_status or "Lunas",
        "due_date": e.due_date or "-",
        "notes": e.notes or "-",
        "msg_link": e.msg_link or "Web Dashboard",
        "is_reimbursement": bool(e.is_reimbursement),
        "invoice_number": e.invoice_number or "-",
        "reimbursed_at": e.reimbursed_at,
        "user_id": e.user_id,
        "user_name": user_name,
        "master_item_id": getattr(e, "master_item_id", None),
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
    is_reimbursement: bool | None = Query(None),
    user_id: int | None = Query(None),
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
        is_reimbursement=is_reimbursement,
        user_id=user_id,
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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    from app.services.master_item_service import match_and_normalize_extracted_items

    normalized_list = await match_and_normalize_extracted_items(
        db,
        [
            {
                "item_name": payload.item_name,
                "category": payload.category or "Operasional",
                "supplier": payload.supplier or "-",
                "notes": payload.notes or "-",
                "unit": payload.unit or "Pcs",
                "master_item_id": payload.master_item_id,
            }
        ],
    )
    norm = normalized_list[0]

    qty = Decimal(str(payload.qty or 1))
    unit_price = Decimal(str(payload.unit_price or 0))
    shipping_fee = Decimal(str(payload.shipping_fee or 0))
    tax = Decimal(str(payload.tax or 0))
    other_fee = Decimal(str(payload.other_fee or 0))
    discount = Decimal(str(payload.discount or 0))

    # Jika total_price tidak diset manual, hitung otomatis
    if payload.total_price > 0:
        total_price = Decimal(str(payload.total_price))
    else:
        total_price = (qty * unit_price) + shipping_fee + tax + other_fee - discount

    # Cegah pengeluaran 0 atau minus
    if total_price <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nominal pengeluaran tidak boleh Rp 0 atau minus.",
        )

    expense = Expense(
        expense_date=payload.expense_date,
        supplier=norm["supplier"] or "-",
        item_name=norm["item_name"],
        qty=qty if qty > 0 else Decimal("1"),
        unit=norm.get("unit") or payload.unit or "Pcs",
        category=norm["category"] or "Operasional",
        unit_price=unit_price,
        shipping_fee=shipping_fee,
        tax=tax,
        other_fee=other_fee,
        discount=discount,
        total_price=total_price,
        pay_method=payload.pay_method or "Tunai",
        pay_status=payload.pay_status or "Lunas",
        due_date=payload.due_date or "-",
        notes=norm["notes"] or "-",
        is_reimbursement=payload.is_reimbursement,
        invoice_number=payload.invoice_number or "-",
        msg_link=payload.msg_link or "Web Dashboard",
        user_id=payload.user_id,
        master_item_id=norm.get("master_item_id") or payload.master_item_id,
        sheets_synced=False,
    )
    db.add(expense)
    await db.flush()

    actor = f"dashboard:{get_current_role(request)}"
    await record_expense_log(
        db,
        expense_id=expense.id,
        action="CREATE",
        actor=actor,
        details={
            "item_name": expense.item_name,
            "total_price": float(expense.total_price),
            "supplier": expense.supplier,
            "expense_date": str(expense.expense_date),
            "category": expense.category,
            "pay_status": expense.pay_status,
        },
    )

    await db.commit()
    await db.refresh(expense)
    if expense.user_id:
        try:
            await db.refresh(expense, ["user"])
        except Exception:
            pass

    return ExpenseResponse(**_to_response_dict(expense))


@router.post("/batch", response_model=list[ExpenseResponse], status_code=status.HTTP_201_CREATED)
async def create_expense_batch(
    payload: ExpenseBatchCreate | list[ExpenseCreate],
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Simpan sekumpulan pengeluaran sekaligus (misal hasil scan OCR nota multi-item)."""
    items_in = payload.items if isinstance(payload, ExpenseBatchCreate) else payload
    if not items_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Daftar pengeluaran kosong.",
        )

    dict_items = []
    for it in items_in:
        qty = Decimal(str(it.qty or 1))
        unit_price = Decimal(str(it.unit_price or 0))
        shipping_fee = Decimal(str(it.shipping_fee or 0))
        tax = Decimal(str(it.tax or 0))
        other_fee = Decimal(str(it.other_fee or 0))
        discount = Decimal(str(it.discount or 0))
        if it.total_price > 0:
            total_price = Decimal(str(it.total_price))
        else:
            total_price = (qty * unit_price) + shipping_fee + tax + other_fee - discount

        # Saring item yang bernilai <= 0
        if total_price <= 0:
            continue

        dict_items.append({
            "expense_date": it.expense_date,
            "supplier": it.supplier or "-",
            "item_name": it.item_name,
            "qty": qty if qty > 0 else Decimal("1"),
            "unit": it.unit or "Pcs",
            "category": it.category or "Operasional",
            "unit_price": unit_price,
            "shipping_fee": shipping_fee,
            "tax": tax,
            "other_fee": other_fee,
            "discount": discount,
            "total_price": total_price,
            "pay_method": it.pay_method or "Tunai",
            "pay_status": it.pay_status or "Lunas",
            "due_date": it.due_date or "-",
            "notes": it.notes or "-",
            "is_reimbursement": it.is_reimbursement,
            "invoice_number": it.invoice_number or "-",
            "msg_link": it.msg_link or "Web Dashboard",
            "user_id": it.user_id,
            "master_item_id": it.master_item_id,
        })

    if not dict_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Semua item bernilai Rp 0 atau minus, tidak ada pengeluaran valid.",
        )

    actor = f"dashboard:{get_current_role(request)}"
    saved = await batch_insert_expenses(
        db,
        dict_items,
        sheets_synced=False,
        actor=actor,
    )
    await db.commit()
    for e in saved:
        await db.refresh(e)
        if e.user_id:
            try:
                await db.refresh(e, ["user"])
            except Exception:
                pass

    return [ExpenseResponse(**_to_response_dict(e)) for e in saved]


@router.post("/ocr")
async def scan_expense_ocr(
    file: UploadFile = File(...),
):
    """Pindai gambar nota/struk/invoice dengan Vision AI untuk auto-fill form pengeluaran."""
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File nota kosong atau tidak dapat dibaca.",
        )

    b64_img = base64.b64encode(content).decode("utf-8")
    extracted = await call_ai_image(
        b64_img,
        caption="Ekstrak data struk/nota/invoice belanja toko kue Historycake secara teliti",
    )

    if extracted.get("error") or not extracted.get("items"):
        return {
            "ok": False,
            "message": extracted.get("message") or "Gagal membaca struk/nota. Pastikan foto jelas dan pencahayaan cukup.",
            "items": [],
        }

    return {
        "ok": True,
        "items": extracted.get("items", []),
    }


@router.get("/users/list", response_model=list[ExpenseUserResponse])
async def list_expense_users(
    db: AsyncSession = Depends(get_db),
):
    """Ambil daftar user terdaftar untuk pilihan filter atau penginput nota."""
    users = await get_all_expense_users(db)
    return [
        ExpenseUserResponse(
            id=u.id,
            name=u.name or f"User #{u.telegram_id}",
            telegram_id=u.telegram_id,
            is_auth=bool(u.is_auth),
        )
        for u in users
    ]


@router.get("/price-history")
async def get_expense_price_history(
    item_name: str | None = Query(None),
    item_id: int | None = Query(None),
    master_item_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Ambil riwayat harga satuan & perbandingan harga antar toko untuk suatu barang."""
    target_id = item_id or master_item_id
    if not target_id and not (item_name and item_name.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Harus menyertakan item_name atau item_id/master_item_id.",
        )
    data = await get_item_price_history(db, item_name=item_name or "", master_item_id=target_id)
    return {
        "ok": True,
        **data,
    }


@router.get("/logs/recent", response_model=list[ExpenseLogResponse])
async def list_recent_expense_logs(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Ambil daftar log aktivitas perubahan belanja terkini secara global."""
    logs = await get_recent_expense_logs(db, limit=limit)
    return [ExpenseLogResponse.model_validate(log) for log in logs]


@router.get("/{expense_id}/logs", response_model=list[ExpenseLogResponse])
async def list_expense_logs(
    expense_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Ambil riwayat log aksi / perubahan khusus untuk satu transaksi belanja."""
    logs = await get_expense_logs(db, expense_id=expense_id)
    return [ExpenseLogResponse.model_validate(log) for log in logs]


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
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        expense = await get_expense_by_id(db, expense_id)
        if not expense:
            raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")
        return ExpenseResponse(**_to_response_dict(expense))

    if "total_price" in updates and updates["total_price"] is not None:
        if float(updates["total_price"]) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nominal total pengeluaran tidak boleh Rp 0 atau minus.",
            )

    actor = f"dashboard:{get_current_role(request)}"
    expense = await update_expense(db, expense_id, updates, actor=actor)
    if not expense:
        raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")

    await db.commit()
    await db.refresh(expense)
    if expense.user_id:
        try:
            await db.refresh(expense, ["user"])
        except Exception:
            pass
    return ExpenseResponse(**_to_response_dict(expense))


@router.delete("/{expense_id}", dependencies=[Depends(require_admin_role)])
async def delete_expense_endpoint(
    expense_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    actor = f"dashboard:{get_current_role(request)}"
    deleted = await delete_expense(db, expense_id, actor=actor)
    if not deleted:
        raise HTTPException(status_code=404, detail="Data pengeluaran tidak ditemukan")
    await db.commit()
    return {"ok": True, "message": "Pengeluaran berhasil dihapus"}
