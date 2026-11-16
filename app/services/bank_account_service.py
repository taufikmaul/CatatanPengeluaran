"""
app/services/bank_account_service.py — Layanan CRUD & Mapping Rekening Penerimaan
"""
import json
from typing import Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction


def _parse_mappings(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x).strip() for x in parsed if str(x).strip()]
    except Exception:
        pass
    return [x.strip() for x in raw.split(",") if x.strip()]


def serialize_bank_account(
    acc: BankAccount,
    total_incoming: float = 0.0,
    tx_count: int = 0,
) -> dict[str, Any]:
    return {
        "id": acc.id,
        "name": acc.name,
        "bank_name": acc.bank_name,
        "account_number": acc.account_number or "",
        "account_holder": acc.account_holder or "",
        "account_type": acc.account_type,
        "opening_balance": float(acc.opening_balance or 0.0),
        "total_incoming": float(total_incoming),
        "estimated_balance": float(acc.opening_balance or 0.0) + float(total_incoming),
        "tx_count": int(tx_count),
        "channel_mappings": _parse_mappings(acc.channel_mappings),
        "notes": acc.notes or "",
        "is_default": bool(acc.is_default),
        "is_active": bool(acc.is_active),
        "sort_order": int(acc.sort_order or 0),
        "created_at": acc.created_at.isoformat() if acc.created_at else None,
        "updated_at": acc.updated_at.isoformat() if acc.updated_at else None,
    }


async def list_bank_accounts(
    db: AsyncSession,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    stmt = select(BankAccount).order_by(BankAccount.sort_order.asc(), BankAccount.id.asc())
    if active_only:
        stmt = stmt.where(BankAccount.is_active == True)  # noqa: E712
    res = await db.execute(stmt)
    accounts = res.scalars().all()

    agg_stmt = (
        select(
            IncomingTransaction.bank_account_id,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
            func.count(IncomingTransaction.id),
        )
        .where(
            IncomingTransaction.bank_account_id.is_not(None),
            IncomingTransaction.status == "paid",
        )
        .group_by(IncomingTransaction.bank_account_id)
    )
    agg_res = await db.execute(agg_stmt)
    agg_map = {
        row[0]: (float(row[1] or 0.0), int(row[2] or 0))
        for row in agg_res.fetchall()
    }

    return [
        serialize_bank_account(
            acc,
            total_incoming=agg_map.get(acc.id, (0.0, 0))[0],
            tx_count=agg_map.get(acc.id, (0.0, 0))[1],
        )
        for acc in accounts
    ]


async def create_bank_account(db: AsyncSession, data: dict[str, Any]) -> BankAccount:
    if data.get("is_default"):
        existing = await db.execute(select(BankAccount).where(BankAccount.is_default == True))  # noqa: E712
        for acc in existing.scalars().all():
            acc.is_default = False

    mappings = data.get("channel_mappings") or []
    acc = BankAccount(
        name=data["name"].strip(),
        bank_name=data["bank_name"].strip(),
        account_number=(data.get("account_number") or "").strip() or None,
        account_holder=(data.get("account_holder") or "").strip() or None,
        account_type=(data.get("account_type") or "bank").strip(),
        opening_balance=float(data.get("opening_balance") or 0.0),
        channel_mappings=json.dumps([str(m).strip() for m in mappings if str(m).strip()]),
        notes=(data.get("notes") or "").strip() or None,
        is_default=bool(data.get("is_default", False)),
        is_active=bool(data.get("is_active", True)),
        sort_order=int(data.get("sort_order") or 0),
    )
    db.add(acc)
    await db.flush()
    return acc


async def update_bank_account(
    db: AsyncSession,
    account_id: int,
    data: dict[str, Any],
) -> BankAccount | None:
    acc = await db.get(BankAccount, account_id)
    if not acc:
        return None

    if data.get("is_default"):
        existing = await db.execute(
            select(BankAccount).where(BankAccount.is_default == True, BankAccount.id != account_id)  # noqa: E712
        )
        for other in existing.scalars().all():
            other.is_default = False

    for field in ("name", "bank_name", "account_number", "account_holder", "account_type", "notes"):
        if field in data and data[field] is not None:
            val = str(data[field]).strip()
            setattr(acc, field, val if val or field in ("name", "bank_name", "account_type") else None)

    if "opening_balance" in data and data["opening_balance"] is not None:
        acc.opening_balance = float(data["opening_balance"])
    if "channel_mappings" in data and data["channel_mappings"] is not None:
        acc.channel_mappings = json.dumps(
            [str(m).strip() for m in data["channel_mappings"] if str(m).strip()]
        )
    if "is_default" in data and data["is_default"] is not None:
        acc.is_default = bool(data["is_default"])
    if "is_active" in data and data["is_active"] is not None:
        acc.is_active = bool(data["is_active"])
    if "sort_order" in data and data["sort_order"] is not None:
        acc.sort_order = int(data["sort_order"])

    await db.flush()
    return acc


async def delete_bank_account(db: AsyncSession, account_id: int) -> bool:
    acc = await db.get(BankAccount, account_id)
    if not acc:
        return False
    await db.delete(acc)
    await db.flush()
    return True


async def build_channel_account_map(db: AsyncSession) -> tuple[dict[str, tuple[int, str]], tuple[int, str] | None]:
    """
    Bangun peta channel/metode bayar (lowercase) -> (bank_account_id, bank_account_name)
    beserta rekening default jika tidak ada mapping spesifik.
    """
    res = await db.execute(
        select(BankAccount)
        .where(BankAccount.is_active == True)  # noqa: E712
        .order_by(BankAccount.sort_order.asc(), BankAccount.id.asc())
    )
    accounts = res.scalars().all()
    channel_map: dict[str, tuple[int, str]] = {}
    default_acc: tuple[int, str] | None = None

    for acc in accounts:
        if acc.is_default and default_acc is None:
            default_acc = (acc.id, acc.name)
        for ch in _parse_mappings(acc.channel_mappings):
            key = ch.strip().lower()
            if key and key not in channel_map:
                channel_map[key] = (acc.id, acc.name)

    return channel_map, default_acc


def resolve_bank_account_for_tx(
    payment_method: str,
    order_type: str,
    channel_map: dict[str, tuple[int, str]],
    default_acc: tuple[int, str] | None,
) -> tuple[int | None, str | None]:
    pm_key = (payment_method or "").strip().lower()
    ot_key = (order_type or "").strip().lower()

    if pm_key and pm_key in channel_map:
        return channel_map[pm_key]
    if ot_key and ot_key in channel_map:
        return channel_map[ot_key]
    if default_acc:
        return default_acc
    return None, None
