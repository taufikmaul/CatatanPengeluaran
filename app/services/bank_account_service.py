"""
app/services/bank_account_service.py — Layanan CRUD & Mapping Rekening Penerimaan
"""
import json
import re
from typing import Any
from sqlalchemy import select, func, exists, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction
from app.models.bank_transfer import BankTransfer
from app.models.expense import Expense
from app.models.expense_payment import ExpensePayment


def normalize_channel_key(value: str | None) -> str:
    """Normalisasi nama channel/tipe order agar 'Cake Flow', 'Cakeflow', 'cake_flow' cocok konsisten."""
    return re.sub(r"[\s_\-]+", "", (value or "").strip().lower())


def is_cakeflow_order_type(order_type: str | None) -> bool:
    """Deteksi apakah tipe order merupakan pesanan Cake Flow / Cakeflow."""
    return "cakeflow" in normalize_channel_key(order_type)


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


DEFAULT_COA_BY_TYPE: dict[str, str] = {
    "cash": "1-1110",
    "bank": "1-1120",
    "ewallet": "1-1121",
    "aggregator": "1-1130",
}


def serialize_bank_account(
    acc: BankAccount,
    total_incoming: float = 0.0,
    tx_count: int = 0,
    total_expenses: float = 0.0,
    transfers_in: float = 0.0,
    transfers_out: float = 0.0,
) -> dict[str, Any]:
    opening = float(acc.opening_balance or 0.0)
    estimated = opening + float(total_incoming) + float(transfers_in) - float(transfers_out) - float(total_expenses)
    return {
        "id": acc.id,
        "name": acc.name,
        "bank_name": acc.bank_name,
        "account_number": acc.account_number or "",
        "account_holder": acc.account_holder or "",
        "account_type": acc.account_type,
        "account_code": acc.account_code or DEFAULT_COA_BY_TYPE.get(acc.account_type, "1-1120"),
        "opening_balance": opening,
        "total_incoming": float(total_incoming),
        "total_expenses": float(total_expenses),
        "transfers_in": float(transfers_in),
        "transfers_out": float(transfers_out),
        "estimated_balance": estimated,
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
    agg_map: dict[int, tuple[float, int]] = {
        row[0]: (float(row[1] or 0.0), int(row[2] or 0))
        for row in agg_res.fetchall()
    }

    # Bangun pemetaan pay_method / order_type -> bank_account_id dari channel_mappings rekening aktif
    method_to_acc_id: dict[str, int] = {}
    norm_method_to_acc_id: dict[str, int] = {}
    default_acc_id: int | None = None
    for acc in accounts:
        if acc.is_default and default_acc_id is None:
            default_acc_id = acc.id
        for m in _parse_mappings(acc.channel_mappings):
            key = m.strip().lower()
            norm_key = normalize_channel_key(m)
            if key and key not in method_to_acc_id:
                method_to_acc_id[key] = acc.id
            if norm_key and norm_key not in norm_method_to_acc_id:
                norm_method_to_acc_id[norm_key] = acc.id

    def match_account_by_method(method_name: str | None, fallback_order_type: str | None = None) -> int | None:
        for candidate in (method_name, fallback_order_type):
            m_key = (candidate or "").strip().lower()
            if not m_key:
                continue
            matched = method_to_acc_id.get(m_key)
            if matched is not None:
                return matched
            norm_cand = normalize_channel_key(candidate)
            if norm_cand and norm_cand in norm_method_to_acc_id:
                return norm_method_to_acc_id[norm_cand]
            for k, aid in method_to_acc_id.items():
                if k in m_key or m_key in k:
                    return aid
            for nk, aid in norm_method_to_acc_id.items():
                if nk and norm_cand and (nk in norm_cand or norm_cand in nk):
                    return aid
        return default_acc_id

    # Transaksi masuk lunas tanpa bank_account_id -> fallback channel_mappings (termasuk Cake Flow)
    inc_unassigned_res = await db.execute(
        select(
            IncomingTransaction.payment_method,
            IncomingTransaction.order_type,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
            func.count(IncomingTransaction.id),
        )
        .where(
            IncomingTransaction.bank_account_id.is_(None),
            IncomingTransaction.status == "paid",
        )
        .group_by(IncomingTransaction.payment_method, IncomingTransaction.order_type)
    )
    for pm_name, ot_name, amt, cnt in inc_unassigned_res.fetchall():
        matched_id = match_account_by_method(pm_name, ot_name)
        if matched_id is not None:
            prev_amt, prev_cnt = agg_map.get(matched_id, (0.0, 0))
            agg_map[matched_id] = (prev_amt + float(amt or 0.0), prev_cnt + int(cnt or 0))

    has_payment_subq = exists(
        select(ExpensePayment.id).where(ExpensePayment.expense_id == Expense.id)
    )
    # 1. Pengeluaran langsung (tanpa payment terpisah) yang sudah memiliki bank_account_id
    # Catatan: Talangan belum diganti (~and_(is_reimbursement, reimbursed_at IS NULL)) belum memotong kas perusahaan
    exp_res = await db.execute(
        select(
            Expense.bank_account_id,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            Expense.bank_account_id.is_not(None),
            Expense.pay_status == "Lunas",
            ~has_payment_subq,
            ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
        )
        .group_by(Expense.bank_account_id)
    )
    exp_map = {int(r[0]): float(r[1] or 0.0) for r in exp_res.fetchall()}

    # 1b. Pengeluaran langsung lunas tanpa bank_account_id -> fallback channel_mappings
    exp_unassigned_res = await db.execute(
        select(
            Expense.pay_method,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            Expense.bank_account_id.is_(None),
            Expense.pay_status == "Lunas",
            ~has_payment_subq,
            ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
        )
        .group_by(Expense.pay_method)
    )
    for m_name, amt in exp_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            exp_map[matched_id] = exp_map.get(matched_id, 0.0) + float(amt or 0.0)

    # 2. Pembayaran bertahap (DP, COD settlement, Talangan, Termin) yang sudah terhubung ke rekening
    effective_ep_bank_id = func.coalesce(ExpensePayment.bank_account_id, Expense.bank_account_id)
    ep_res = await db.execute(
        select(
            effective_ep_bank_id,
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(effective_ep_bank_id.is_not(None))
        .group_by(effective_ep_bank_id)
    )
    for aid, amt in ep_res.fetchall():
        exp_map[int(aid)] = exp_map.get(int(aid), 0.0) + float(amt or 0.0)

    # 2b. Pembayaran bertahap tanpa bank_account_id -> fallback channel_mappings
    ep_unassigned_res = await db.execute(
        select(
            func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(effective_ep_bank_id.is_(None))
        .group_by(func.coalesce(ExpensePayment.pay_method, Expense.pay_method))
    )
    for m_name, amt in ep_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            exp_map[matched_id] = exp_map.get(matched_id, 0.0) + float(amt or 0.0)

    tr_in_res = await db.execute(
        select(
            BankTransfer.to_account_id,
            func.coalesce(func.sum(BankTransfer.amount), 0.0),
        ).group_by(BankTransfer.to_account_id)
    )
    tr_in_map = {int(r[0]): float(r[1] or 0.0) for r in tr_in_res.fetchall()}

    tr_out_res = await db.execute(
        select(
            BankTransfer.from_account_id,
            func.coalesce(func.sum(BankTransfer.amount + BankTransfer.admin_fee), 0.0),
        ).group_by(BankTransfer.from_account_id)
    )
    tr_out_map = {int(r[0]): float(r[1] or 0.0) for r in tr_out_res.fetchall()}

    return [
        serialize_bank_account(
            acc,
            total_incoming=agg_map.get(acc.id, (0.0, 0))[0],
            tx_count=agg_map.get(acc.id, (0.0, 0))[1],
            total_expenses=exp_map.get(acc.id, 0.0),
            transfers_in=tr_in_map.get(acc.id, 0.0),
            transfers_out=tr_out_map.get(acc.id, 0.0),
        )
        for acc in accounts
    ]


async def create_bank_account(db: AsyncSession, data: dict[str, Any]) -> BankAccount:
    if data.get("is_default"):
        existing = await db.execute(select(BankAccount).where(BankAccount.is_default == True))  # noqa: E712
        for acc in existing.scalars().all():
            acc.is_default = False

    mappings = data.get("channel_mappings") or []
    acc_type = (data.get("account_type") or "bank").strip()
    acc_code = (data.get("account_code") or "").strip() or DEFAULT_COA_BY_TYPE.get(acc_type, "1-1120")
    acc = BankAccount(
        name=data["name"].strip(),
        bank_name=data["bank_name"].strip(),
        account_number=(data.get("account_number") or "").strip() or None,
        account_holder=(data.get("account_holder") or "").strip() or None,
        account_type=acc_type,
        account_code=acc_code,
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

    for field in ("name", "bank_name", "account_number", "account_holder", "account_type", "account_code", "notes"):
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

    # Normalisasi spasi/underscore/hyphen agar "Cake Flow" cocok dengan "Cakeflow"
    norm_map = {normalize_channel_key(k): v for k, v in channel_map.items() if normalize_channel_key(k)}
    for candidate in (pm_key, ot_key):
        norm_cand = normalize_channel_key(candidate)
        if not norm_cand:
            continue
        if norm_cand in norm_map:
            return norm_map[norm_cand]
        for nk, val in norm_map.items():
            if nk in norm_cand or norm_cand in nk:
                return val

    if default_acc:
        return default_acc
    return None, None
