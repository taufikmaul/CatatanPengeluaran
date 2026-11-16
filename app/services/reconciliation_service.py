"""
app/services/reconciliation_service.py — Mesin Rekonsiliasi Settlement Platform & Mutasi Bank (Masuk + Pengeluaran)
"""
import csv
import io
from datetime import datetime, date, timedelta
from typing import Any
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.incoming_transaction import IncomingTransaction
from app.models.expense import Expense
from app.services.sales_import_service import (
    _decode_csv_bytes,
    _detect_delimiter,
    _parse_number,
    _parse_date_id,
)


def _find_header_and_rows(content: bytes) -> tuple[list[str], list[list[str]]]:
    text = _decode_csv_bytes(content)
    lines = text.splitlines()
    delim = _detect_delimiter(lines)
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))

    header_idx = 0
    for idx, r in enumerate(rows[:25]):
        non_empty = [c.strip().lower() for c in r if c and c.strip()]
        if len(non_empty) >= 3 and any(
            k in h
            for h in non_empty
            for k in ("tanggal", "date", "nominal", "jumlah", "kredit", "debit", "order", "payout", "net")
        ):
            header_idx = idx
            break

    if header_idx >= len(rows):
        return [], []
    headers = [h.strip() for h in rows[header_idx]]
    return headers, rows[header_idx + 1 :]


def _col_lookup(headers: list[str], *candidates: str) -> int | None:
    lower_headers = [h.lower() for h in headers]
    for cand in candidates:
        c = cand.lower()
        for idx, h in enumerate(lower_headers):
            if c == h or c in h:
                return idx
    return None


def parse_bank_statement_csv(content: bytes) -> list[dict[str, Any]]:
    """
    Parse CSV mutasi bank (BCA / Mandiri / BRI / generic) menjadi daftar baris:
    {row_no, date, description, direction ('CR'|'DB'), amount, reference}
    """
    headers, data_rows = _find_header_and_rows(content)
    if not headers:
        raise ValueError("Header CSV mutasi bank tidak terbaca.")

    idx_date = _col_lookup(headers, "tanggal", "date", "tgl")
    idx_desc = _col_lookup(headers, "keterangan", "deskripsi", "description", "uraian", "berita")
    idx_credit = _col_lookup(headers, "kredit", "credit", "masuk", "cr")
    idx_debit = _col_lookup(headers, "debit", "debet", "keluar", "db")
    idx_amount = _col_lookup(headers, "nominal", "jumlah", "amount", "mutasi")
    idx_type = _col_lookup(headers, "tipe", "type", "dk", "d/k", "db/cr")
    idx_ref = _col_lookup(headers, "referensi", "ref", "no ref", "reference")

    if idx_date is None:
        raise ValueError("Kolom 'Tanggal' tidak ditemukan pada CSV mutasi bank.")

    parsed: list[dict[str, Any]] = []
    for i, r in enumerate(data_rows, start=2):
        if not any(c.strip() for c in r):
            continue
        tx_date = _parse_date_id(r[idx_date] if idx_date < len(r) else "")
        if not tx_date:
            continue

        desc = r[idx_desc].strip() if idx_desc is not None and idx_desc < len(r) else ""
        ref = r[idx_ref].strip() if idx_ref is not None and idx_ref < len(r) else ""

        credit_val = _parse_number(r[idx_credit]) if idx_credit is not None and idx_credit < len(r) else 0.0
        debit_val = _parse_number(r[idx_debit]) if idx_debit is not None and idx_debit < len(r) else 0.0

        direction = ""
        amount = 0.0
        if credit_val > 0 and debit_val == 0:
            direction = "CR"
            amount = credit_val
        elif debit_val > 0 and credit_val == 0:
            direction = "DB"
            amount = debit_val
        elif idx_amount is not None and idx_amount < len(r):
            raw_amt = _parse_number(r[idx_amount])
            raw_type = (r[idx_type].strip().upper() if idx_type is not None and idx_type < len(r) else "")
            if raw_amt < 0 or "DB" in raw_type or "DEBIT" in raw_type or "KELUAR" in raw_type or raw_type == "D":
                direction = "DB"
                amount = abs(raw_amt)
            else:
                direction = "CR"
                amount = abs(raw_amt)

        if amount <= 0:
            continue

        parsed.append({
            "row_no": i,
            "date": tx_date.isoformat(),
            "date_obj": tx_date,
            "description": desc,
            "direction": direction,
            "amount": amount,
            "reference": ref or f"BANK-{tx_date.isoformat()}-{i}",
        })

    return parsed


def parse_settlement_csv(content: bytes) -> list[dict[str, Any]]:
    """
    Parse CSV settlement platform (GoFood/GrabFood/ShopeeFood):
    {row_no, order_no, date, gross, fee, net_payout, description}
    """
    headers, data_rows = _find_header_and_rows(content)
    if not headers:
        raise ValueError("Header CSV settlement platform tidak terbaca.")

    idx_order = _col_lookup(headers, "order id", "no pesanan", "id pesanan", "no penjualan", "order_no", "order")
    idx_date = _col_lookup(headers, "tanggal", "date", "waktu")
    idx_gross = _col_lookup(headers, "gross", "penjualan kotor", "total", "subtotal")
    idx_fee = _col_lookup(headers, "fee", "komisi", "biaya", "potongan", "commission")
    idx_net = _col_lookup(headers, "net", "bersih", "payout", "settlement", "cair", "diterima")

    if idx_order is None and idx_net is None:
        raise ValueError("Kolom 'Order ID' atau 'Net/Payout' tidak ditemukan pada CSV settlement.")

    parsed: list[dict[str, Any]] = []
    for i, r in enumerate(data_rows, start=2):
        if not any(c.strip() for c in r):
            continue
        order_no = r[idx_order].strip() if idx_order is not None and idx_order < len(r) else ""
        tx_date = _parse_date_id(r[idx_date] if idx_date is not None and idx_date < len(r) else "")
        gross = _parse_number(r[idx_gross]) if idx_gross is not None and idx_gross < len(r) else 0.0
        fee = abs(_parse_number(r[idx_fee])) if idx_fee is not None and idx_fee < len(r) else 0.0
        net = _parse_number(r[idx_net]) if idx_net is not None and idx_net < len(r) else max(0.0, gross - fee)

        if net <= 0 and gross <= 0:
            continue

        parsed.append({
            "row_no": i,
            "order_no": order_no,
            "date": tx_date.isoformat() if tx_date else None,
            "date_obj": tx_date,
            "gross": gross,
            "fee": fee,
            "net_payout": net,
            "reference": order_no or f"SETTLE-{i}",
        })

    return parsed


async def preview_reconciliation(
    db: AsyncSession,
    content: bytes,
    mode: str,
    bank_account_id: int | None = None,
    date_tolerance_days: int = 2,
) -> dict[str, Any]:
    if mode == "settlement_platform":
        rows = parse_settlement_csv(content)
        order_nos = [r["order_no"] for r in rows if r.get("order_no")]
        tx_res = await db.execute(
            select(IncomingTransaction).where(
                IncomingTransaction.status == "paid",
                IncomingTransaction.reconciled_at.is_(None),
            )
        )
        all_tx = tx_res.scalars().all()
        by_order = {(t.order_no or "").strip().lower(): t for t in all_tx if t.order_no}

        matched_incoming = []
        unmatched = []
        used_tx_ids: set[int] = set()

        for r in rows:
            key = (r.get("order_no") or "").strip().lower()
            matched_tx = by_order.get(key) if key else None
            if not matched_tx and r.get("date_obj"):
                # Fallback match by date + gross/net
                for t in all_tx:
                    if t.id in used_tx_ids:
                        continue
                    if abs((t.transaction_date - r["date_obj"]).days) <= date_tolerance_days and (
                        abs(float(t.gross_sales) - r["gross"]) < 1.0
                        or abs(float(t.net_received) - r["net_payout"]) < 1.0
                    ):
                        matched_tx = t
                        break

            if matched_tx and matched_tx.id not in used_tx_ids:
                used_tx_ids.add(matched_tx.id)
                matched_incoming.append({
                    "row_no": r["row_no"],
                    "reconciled_ref": r["reference"],
                    "order_no": matched_tx.order_no or r["order_no"],
                    "receipt_no": matched_tx.receipt_no,
                    "tx_id": matched_tx.id,
                    "transaction_date": matched_tx.transaction_date.isoformat(),
                    "order_type": matched_tx.order_type,
                    "old_platform_fee": float(matched_tx.platform_fee or 0.0),
                    "new_platform_fee": r["fee"],
                    "old_net_received": float(matched_tx.net_received or 0.0),
                    "new_net_received": r["net_payout"],
                    "diff_net": r["net_payout"] - float(matched_tx.net_received or 0.0),
                    "bank_account_id": bank_account_id or matched_tx.bank_account_id,
                })
            else:
                unmatched.append({
                    "row_no": r["row_no"],
                    "date": r["date"],
                    "description": f"Order {r['order_no']} (Net {r['net_payout']})",
                    "direction": "CR",
                    "amount": r["net_payout"],
                })

        return {
            "mode": mode,
            "total_rows": len(rows),
            "matched_incoming": matched_incoming,
            "matched_expenses": [],
            "unmatched_rows": unmatched,
        }

    # Mode: mutasi_bank (match IncomingTransaction for CR, Expense for DB)
    rows = parse_bank_statement_csv(content)
    if not rows:
        return {
            "mode": mode,
            "total_rows": 0,
            "matched_incoming": [],
            "matched_expenses": [],
            "unmatched_rows": [],
        }

    min_d = min(r["date_obj"] for r in rows) - timedelta(days=date_tolerance_days)
    max_d = max(r["date_obj"] for r in rows) + timedelta(days=date_tolerance_days)

    tx_res = await db.execute(
        select(IncomingTransaction).where(
            and_(
                IncomingTransaction.transaction_date >= min_d,
                IncomingTransaction.transaction_date <= max_d,
                IncomingTransaction.status == "paid",
                IncomingTransaction.reconciled_at.is_(None),
            )
        )
    )
    candidate_tx = tx_res.scalars().all()

    exp_res = await db.execute(
        select(Expense).where(
            and_(
                Expense.expense_date >= min_d,
                Expense.expense_date <= max_d,
                Expense.pay_status == "Lunas",
                Expense.reconciled_at.is_(None),
            )
        )
    )
    candidate_exp = exp_res.scalars().all()

    matched_incoming = []
    matched_expenses = []
    unmatched = []
    used_tx: set[int] = set()
    used_exp: set[int] = set()

    for r in rows:
        r_date = r["date_obj"]
        amt = r["amount"]
        if r["direction"] == "CR":
            found = None
            for t in candidate_tx:
                if t.id in used_tx:
                    continue
                if abs((t.transaction_date - r_date).days) <= date_tolerance_days and abs(float(t.net_received) - amt) < 1.0:
                    found = t
                    break
            if found:
                used_tx.add(found.id)
                matched_incoming.append({
                    "row_no": r["row_no"],
                    "reconciled_ref": r["reference"],
                    "bank_date": r["date"],
                    "bank_desc": r["description"],
                    "tx_id": found.id,
                    "receipt_no": found.receipt_no,
                    "order_no": found.order_no,
                    "transaction_date": found.transaction_date.isoformat(),
                    "order_type": found.order_type,
                    "old_platform_fee": float(found.platform_fee or 0.0),
                    "new_platform_fee": float(found.platform_fee or 0.0),
                    "old_net_received": float(found.net_received or 0.0),
                    "new_net_received": amt,
                    "diff_net": 0.0,
                    "bank_account_id": bank_account_id or found.bank_account_id,
                })
            else:
                unmatched.append({
                    "row_no": r["row_no"],
                    "date": r["date"],
                    "description": r["description"],
                    "direction": "CR",
                    "amount": amt,
                })
        else:
            found_exp = None
            for e in candidate_exp:
                if e.id in used_exp:
                    continue
                if abs((e.expense_date - r_date).days) <= date_tolerance_days and abs(float(e.total_price) - amt) < 1.0:
                    found_exp = e
                    break
            if found_exp:
                used_exp.add(found_exp.id)
                matched_expenses.append({
                    "row_no": r["row_no"],
                    "reconciled_ref": r["reference"],
                    "bank_date": r["date"],
                    "bank_desc": r["description"],
                    "expense_id": found_exp.id,
                    "expense_date": found_exp.expense_date.isoformat(),
                    "supplier": found_exp.supplier,
                    "item_name": found_exp.item_name,
                    "total_price": float(found_exp.total_price),
                    "pay_method": found_exp.pay_method,
                    "bank_account_id": bank_account_id or found_exp.bank_account_id,
                })
            else:
                unmatched.append({
                    "row_no": r["row_no"],
                    "date": r["date"],
                    "description": r["description"],
                    "direction": "DB",
                    "amount": amt,
                })

    return {
        "mode": mode,
        "total_rows": len(rows),
        "matched_incoming": matched_incoming,
        "matched_expenses": matched_expenses,
        "unmatched_rows": unmatched,
    }


async def apply_reconciliation(
    db: AsyncSession,
    incoming_matches: list[dict[str, Any]],
    expense_matches: list[dict[str, Any]],
) -> dict[str, int]:
    now = datetime.utcnow()
    inc_count = 0
    exp_count = 0

    for m in incoming_matches:
        tx = await db.get(IncomingTransaction, m["tx_id"])
        if not tx:
            continue
        tx.reconciled_at = now
        tx.reconciled_ref = m.get("reconciled_ref")
        if m.get("new_platform_fee") is not None:
            tx.platform_fee = float(m["new_platform_fee"])
        if m.get("new_net_received") is not None:
            tx.net_received = float(m["new_net_received"])
        if m.get("bank_account_id") is not None:
            tx.bank_account_id = int(m["bank_account_id"])
        inc_count += 1

    for m in expense_matches:
        exp = await db.get(Expense, m["expense_id"])
        if not exp:
            continue
        exp.reconciled_at = now
        exp.reconciled_ref = m.get("reconciled_ref")
        if m.get("bank_account_id") is not None:
            exp.bank_account_id = int(m["bank_account_id"])
        exp_count += 1

    await db.commit()
    return {"reconciled_incoming": inc_count, "reconciled_expenses": exp_count}
