"""
app/api/reconciliation.py — REST API for Rekonsiliasi Settlement Platform & Mutasi Bank (Masuk + Pengeluaran)
"""
from typing import Any, Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.api.deps import require_auth
from app.services.reconciliation_service import preview_reconciliation, apply_reconciliation

router = APIRouter(
    prefix="/reconciliation",
    tags=["reconciliation"],
    dependencies=[Depends(require_auth)],
)


class ApplyReconciliationPayload(BaseModel):
    incoming_matches: list[dict[str, Any]] = []
    expense_matches: list[dict[str, Any]] = []


@router.post("/preview")
async def api_preview_reconciliation(
    file: UploadFile = File(...),
    mode: str = Form("mutasi_bank"),
    bank_account_id: Optional[int] = Form(None),
    date_tolerance_days: int = Form(2),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Harap unggah file .csv mutasi bank atau laporan settlement platform.",
        )
    if mode not in ("mutasi_bank", "settlement_platform"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mode rekonsiliasi harus 'mutasi_bank' atau 'settlement_platform'.",
        )
    content = await file.read()
    try:
        result = await preview_reconciliation(
            db,
            content,
            mode=mode,
            bank_account_id=bank_account_id,
            date_tolerance_days=date_tolerance_days,
        )
        return {"ok": True, "preview": result}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/apply")
async def api_apply_reconciliation(
    payload: ApplyReconciliationPayload,
    db: AsyncSession = Depends(get_db),
):
    res = await apply_reconciliation(
        db,
        incoming_matches=payload.incoming_matches,
        expense_matches=payload.expense_matches,
    )
    return {"ok": True, "result": res}
