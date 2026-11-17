"""
app/api/bank_transfers.py — REST API for Transfer Antar Rekening (Setor Tunai & Pencairan Platform)
"""
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_admin_role, require_roles
from app.models.bank_account import BankAccount
from app.models.bank_transfer import BankTransfer

router = APIRouter(
    prefix="/bank-transfers",
    tags=["bank-transfers"],
    dependencies=[Depends(require_roles("admin", "admin_input"))],
)


class BankTransferCreate(BaseModel):
    transfer_date: date
    from_account_id: int
    to_account_id: int
    amount: float = Field(..., gt=0)
    admin_fee: float = Field(0.0, ge=0)
    transfer_type: str = Field("antar_rekening", pattern="^(setor_tunai|pencairan_platform|antar_rekening)$")
    reference_no: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = None


def _serialize_transfer(t: BankTransfer) -> dict:
    return {
        "id": t.id,
        "transfer_date": t.transfer_date.isoformat() if t.transfer_date else None,
        "from_account_id": t.from_account_id,
        "from_account_name": t.from_account.name if t.from_account else None,
        "to_account_id": t.to_account_id,
        "to_account_name": t.to_account.name if t.to_account else None,
        "amount": float(t.amount or 0.0),
        "admin_fee": float(t.admin_fee or 0.0),
        "transfer_type": t.transfer_type,
        "reference_no": t.reference_no or "",
        "notes": t.notes or "",
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.get("")
async def api_list_bank_transfers(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    account_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if start_date:
        conditions.append(BankTransfer.transfer_date >= start_date)
    if end_date:
        conditions.append(BankTransfer.transfer_date <= end_date)
    if account_id is not None:
        conditions.append(
            or_(
                BankTransfer.from_account_id == account_id,
                BankTransfer.to_account_id == account_id,
            )
        )
    where_clause = and_(*conditions) if conditions else True
    res = await db.execute(
        select(BankTransfer)
        .where(where_clause)
        .order_by(BankTransfer.transfer_date.desc(), BankTransfer.id.desc())
        .limit(200)
    )
    rows = res.scalars().all()
    return {"ok": True, "transfers": [_serialize_transfer(t) for t in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def api_create_bank_transfer(
    payload: BankTransferCreate,
    db: AsyncSession = Depends(get_db),
):
    if payload.from_account_id == payload.to_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rekening asal dan rekening tujuan tidak boleh sama.",
        )

    src = await db.get(BankAccount, payload.from_account_id)
    dst = await db.get(BankAccount, payload.to_account_id)
    if not src or not dst:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekening asal atau tujuan tidak ditemukan.",
        )

    tr = BankTransfer(
        transfer_date=payload.transfer_date,
        from_account_id=payload.from_account_id,
        to_account_id=payload.to_account_id,
        amount=float(payload.amount),
        admin_fee=float(payload.admin_fee or 0.0),
        transfer_type=payload.transfer_type,
        reference_no=(payload.reference_no or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(tr)
    await db.commit()
    await db.refresh(tr)
    return {"ok": True, "transfer": _serialize_transfer(tr)}


@router.delete("/{transfer_id}", dependencies=[Depends(require_admin_role)])
async def api_delete_bank_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
):
    tr = await db.get(BankTransfer, transfer_id)
    if not tr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data transfer tidak ditemukan.")
    await db.delete(tr)
    await db.commit()
    return {"ok": True}
