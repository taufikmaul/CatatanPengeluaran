"""
app/api/bank_accounts.py — REST API for Rekening Setup (Bank Accounts & Cash/Wallets)
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_admin_role, require_roles
from app.services.bank_account_service import (
    list_bank_accounts,
    create_bank_account,
    update_bank_account,
    delete_bank_account,
    serialize_bank_account,
)

router = APIRouter(prefix="/bank-accounts", tags=["bank-accounts"])


class BankAccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    bank_name: str = Field(..., min_length=1, max_length=100)
    account_number: Optional[str] = Field(None, max_length=60)
    account_holder: Optional[str] = Field(None, max_length=100)
    account_type: str = Field("bank", pattern="^(bank|cash|ewallet|aggregator)$")
    account_code: Optional[str] = Field(None, max_length=20)
    opening_balance: float = 0.0
    channel_mappings: list[str] = Field(default_factory=list)
    notes: Optional[str] = None
    is_default: bool = False
    is_active: bool = True
    sort_order: int = 0


class BankAccountUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    bank_name: Optional[str] = Field(None, min_length=1, max_length=100)
    account_number: Optional[str] = Field(None, max_length=60)
    account_holder: Optional[str] = Field(None, max_length=100)
    account_type: Optional[str] = Field(None, pattern="^(bank|cash|ewallet|aggregator)$")
    account_code: Optional[str] = Field(None, max_length=20)
    opening_balance: Optional[float] = None
    channel_mappings: Optional[list[str]] = None
    notes: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


@router.get("", dependencies=[Depends(require_roles("admin", "admin_input", "purchasing"))])
async def api_list_bank_accounts(
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    accounts = await list_bank_accounts(db, active_only=active_only)
    return {"ok": True, "accounts": accounts}


@router.post("", dependencies=[Depends(require_admin_role)], status_code=status.HTTP_201_CREATED)
async def api_create_bank_account(
    payload: BankAccountCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        acc = await create_bank_account(db, payload.model_dump())
        await db.commit()
        await db.refresh(acc)
        return {"ok": True, "account": serialize_bank_account(acc)}
    except Exception as e:
        await db.rollback()
        if "UNIQUE" in str(e).upper() or "duplicate" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Rekening dengan nama '{payload.name}' sudah terdaftar.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put("/{account_id}", dependencies=[Depends(require_admin_role)])
async def api_update_bank_account(
    account_id: int,
    payload: BankAccountUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        acc = await update_bank_account(db, account_id, payload.model_dump(exclude_unset=True))
        if not acc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rekening tidak ditemukan.")
        await db.commit()
        await db.refresh(acc)
        return {"ok": True, "account": serialize_bank_account(acc)}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        if "UNIQUE" in str(e).upper() or "duplicate" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Nama rekening sudah digunakan.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/{account_id}", dependencies=[Depends(require_admin_role)])
async def api_delete_bank_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    deleted = await delete_bank_account(db, account_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rekening tidak ditemukan.")
    await db.commit()
    return {"ok": True}
