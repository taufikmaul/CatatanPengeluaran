"""
app/services/cashflow_service.py — Layanan Rekapitulasi Arus Kas Harian (Daily Cashflow)
Menyajikan rekapitulasi arus kas harian: Kas Masuk (Cash In), Kas Keluar (Cash Out), Arus Bersih (Net), dan Saldo Berjalan (Running Balance).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, exists

from app.models.expense import Expense
from app.models.expense_payment import ExpensePayment
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction
from app.models.bank_transfer import BankTransfer
from app.services.bank_account_service import _parse_mappings, normalize_channel_key

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


async def get_daily_cashflow(
    db: AsyncSession,
    year: int | None = None,
    month: int | None = None,
    month_end: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    bank_account_id: int | None = None,
) -> dict[str, Any]:
    """
    Menghitung rekapitulasi arus kas harian:
    - Saldo Awal (sebelum rentang tanggal)
    - Kas Masuk (Cash In) harian dari transaksi penjualan lunas (+ transfer masuk jika rekening spesifik)
    - Kas Keluar (Cash Out) harian dari pembayaran belanja lunas & DP (+ transfer keluar jika rekening spesifik)
    - Arus Kas Bersih (Net Cash Flow) harian
    - Saldo Berjalan Kumulatif (Running Balance)
    """
    # 1. Resolusi Rentang Tanggal
    if start_date and end_date:
        period_start = start_date
        period_end = end_date
        month_val = None
        year_val = None
        periode_str = f"{period_start.strftime('%d/%m/%Y')} s/d {period_end.strftime('%d/%m/%Y')}"
    elif year and month:
        m_end = month_end or month
        period_start = date(year, month, 1)
        next_m = date(year + 1, 1, 1) if m_end == 12 else date(year, m_end + 1, 1)
        period_end = next_m - timedelta(days=1)
        month_val = month
        year_val = year
        periode_str = (
            f"{MONTH_NAMES[month - 1]} - {MONTH_NAMES[m_end - 1]} {year}"
            if m_end != month
            else f"{MONTH_NAMES[month - 1]} {year}"
        )
    else:
        now = datetime.now()
        month_val = now.month
        year_val = now.year
        period_start = date(year_val, month_val, 1)
        next_m = date(year_val + 1, 1, 1) if month_val == 12 else date(year_val, month_val + 1, 1)
        period_end = next_m - timedelta(days=1)
        periode_str = f"{MONTH_NAMES[month_val - 1]} {year_val}"

    cutoff_end_date = period_end + timedelta(days=1)

    # 2. Master Rekening & Pemetaan Channel/Metode Bayar
    bank_accs_res = await db.execute(
        select(BankAccount)
        .where(BankAccount.is_active == True)  # noqa: E712
        .order_by(BankAccount.sort_order.asc(), BankAccount.id.asc())
    )
    bank_accounts = bank_accs_res.scalars().all()
    target_account = (
        next((a for a in bank_accounts if a.id == bank_account_id), None)
        if bank_account_id
        else None
    )
    account_name = target_account.name if target_account else "Semua Rekening & Kas"

    method_to_acc_id: dict[str, int] = {}
    norm_method_to_acc_id: dict[str, int] = {}
    default_acc_id: int | None = None
    for acc in bank_accounts:
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

    has_payment_subq = exists(
        select(ExpensePayment.id).where(ExpensePayment.expense_id == Expense.id)
    )

    # 3. Hitung Saldo Awal (Opening Balance sebelum s_date)
    prior_cash_in = 0.0
    prior_cash_out = 0.0

    if target_account:
        base_balance = float(target_account.opening_balance or 0.0)

        # Uang masuk lunas sebelum period_start untuk rekening ini
        inc_prior_res = await db.execute(
            select(func.coalesce(func.sum(IncomingTransaction.net_received), 0.0)).where(
                and_(
                    IncomingTransaction.transaction_date < period_start,
                    IncomingTransaction.status == "paid",
                    IncomingTransaction.bank_account_id == target_account.id,
                )
            )
        )
        prior_cash_in += float(inc_prior_res.scalar() or 0.0)

        # Uang masuk lunas sebelum period_start tanpa bank_account_id -> fallback channel_mappings (termasuk Cake Flow)
        inc_prior_unassigned = await db.execute(
            select(
                IncomingTransaction.payment_method,
                IncomingTransaction.order_type,
                func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
            )
            .where(
                and_(
                    IncomingTransaction.transaction_date < period_start,
                    IncomingTransaction.status == "paid",
                    IncomingTransaction.bank_account_id.is_(None),
                )
            )
            .group_by(IncomingTransaction.payment_method, IncomingTransaction.order_type)
        )
        for pm_name, ot_name, amt in inc_prior_unassigned.fetchall():
            if match_account_by_method(pm_name, ot_name) == target_account.id:
                prior_cash_in += float(amt or 0.0)

        # Transfer antar rekening masuk ke rekening ini sebelum period_start
        tr_in_prior_res = await db.execute(
            select(func.coalesce(func.sum(BankTransfer.amount), 0.0)).where(
                and_(
                    BankTransfer.transfer_date < period_start,
                    BankTransfer.to_account_id == target_account.id,
                )
            )
        )
        prior_cash_in += float(tr_in_prior_res.scalar() or 0.0)

        # Transfer antar rekening keluar dari rekening ini sebelum period_start (nominal + fee)
        tr_out_prior_res = await db.execute(
            select(func.coalesce(func.sum(BankTransfer.amount + BankTransfer.admin_fee), 0.0)).where(
                and_(
                    BankTransfer.transfer_date < period_start,
                    BankTransfer.from_account_id == target_account.id,
                )
            )
        )
        prior_cash_out += float(tr_out_prior_res.scalar() or 0.0)

        # Pengeluaran bertahap sebelum period_start
        effective_ep_acc = func.coalesce(ExpensePayment.bank_account_id, Expense.bank_account_id)
        ep_prior_assigned = await db.execute(
            select(func.coalesce(func.sum(ExpensePayment.amount), 0.0))
            .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
            .where(
                and_(
                    ExpensePayment.payment_date < period_start,
                    effective_ep_acc == target_account.id,
                )
            )
        )
        prior_cash_out += float(ep_prior_assigned.scalar() or 0.0)

        # Pengeluaran bertahap sebelum period_start tanpa bank_account_id -> fallback channel_mappings
        ep_prior_unassigned = await db.execute(
            select(
                func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
                func.coalesce(func.sum(ExpensePayment.amount), 0.0),
            )
            .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
            .where(
                and_(
                    ExpensePayment.payment_date < period_start,
                    effective_ep_acc.is_(None),
                )
            )
            .group_by(func.coalesce(ExpensePayment.pay_method, Expense.pay_method))
        )
        for m_name, amt in ep_prior_unassigned.fetchall():
            if match_account_by_method(m_name) == target_account.id:
                prior_cash_out += float(amt or 0.0)

        # Pengeluaran langsung lunas sebelum period_start dengan bank_account_id eksplisit
        exp_prior_assigned = await db.execute(
            select(func.coalesce(func.sum(Expense.total_price), 0.0)).where(
                and_(
                    Expense.expense_date < period_start,
                    Expense.pay_status == "Lunas",
                    Expense.bank_account_id == target_account.id,
                    ~has_payment_subq,
                    ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
                )
            )
        )
        prior_cash_out += float(exp_prior_assigned.scalar() or 0.0)

        # Pengeluaran langsung lunas sebelum period_start tanpa bank_account_id -> fallback channel_mappings
        exp_prior_unassigned = await db.execute(
            select(Expense.pay_method, func.coalesce(func.sum(Expense.total_price), 0.0)).where(
                and_(
                    Expense.expense_date < period_start,
                    Expense.pay_status == "Lunas",
                    Expense.bank_account_id.is_(None),
                    ~has_payment_subq,
                    ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
                )
            )
            .group_by(Expense.pay_method)
        )
        for m_name, amt in exp_prior_unassigned.fetchall():
            if match_account_by_method(m_name) == target_account.id:
                prior_cash_out += float(amt or 0.0)

    else:
        # Semua rekening aktif
        base_balance = sum(float(a.opening_balance or 0.0) for a in bank_accounts)

        # Seluruh uang masuk lunas sebelum period_start
        inc_prior_all = await db.execute(
            select(func.coalesce(func.sum(IncomingTransaction.net_received), 0.0)).where(
                and_(
                    IncomingTransaction.transaction_date < period_start,
                    IncomingTransaction.status == "paid",
                )
            )
        )
        prior_cash_in += float(inc_prior_all.scalar() or 0.0)

        # Seluruh pembayaran belanja bertahap sebelum period_start
        ep_prior_all = await db.execute(
            select(func.coalesce(func.sum(ExpensePayment.amount), 0.0)).where(
                ExpensePayment.payment_date < period_start
            )
        )
        prior_cash_out += float(ep_prior_all.scalar() or 0.0)

        # Seluruh pengeluaran langsung lunas sebelum period_start (tanpa termin)
        exp_prior_all = await db.execute(
            select(func.coalesce(func.sum(Expense.total_price), 0.0)).where(
                and_(
                    Expense.expense_date < period_start,
                    Expense.pay_status == "Lunas",
                    ~has_payment_subq,
                    ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
                )
            )
        )
        prior_cash_out += float(exp_prior_all.scalar() or 0.0)

        # Biaya admin transfer antar rekening sebelum period_start
        tr_fee_prior = await db.execute(
            select(func.coalesce(func.sum(BankTransfer.admin_fee), 0.0)).where(
                BankTransfer.transfer_date < period_start
            )
        )
        prior_cash_out += float(tr_fee_prior.scalar() or 0.0)

    saldo_awal = round(base_balance + prior_cash_in - prior_cash_out, 2)

    # 4. Ambil Data Transaksi Harian pada Rentang [period_start, period_end]
    daily_inc_map: dict[date, dict[str, Any]] = {}
    daily_out_map: dict[date, dict[str, Any]] = {}

    def _normalize_date(d: Any) -> date | None:
        if d is None:
            return None
        if isinstance(d, datetime):
            return d.date()
        if isinstance(d, date):
            return d
        if isinstance(d, str):
            try:
                return date.fromisoformat(d.split("T")[0].split(" ")[0])
            except Exception:
                return None
        return None

    def _add_inc(raw_date: Any, amount: float, count: int = 1):
        tx_date = _normalize_date(raw_date)
        if not tx_date:
            return
        if tx_date not in daily_inc_map:
            daily_inc_map[tx_date] = {"amount": 0.0, "count": 0}
        daily_inc_map[tx_date]["amount"] += amount
        daily_inc_map[tx_date]["count"] += count

    def _add_out(raw_date: Any, amount: float, count: int = 1):
        tx_date = _normalize_date(raw_date)
        if not tx_date:
            return
        if tx_date not in daily_out_map:
            daily_out_map[tx_date] = {"amount": 0.0, "count": 0}
        daily_out_map[tx_date]["amount"] += amount
        daily_out_map[tx_date]["count"] += count

    # A. Kas Masuk (IncomingTransaction)
    if target_account:
        inc_rows_res = await db.execute(
            select(
                IncomingTransaction.transaction_date,
                IncomingTransaction.net_received,
                IncomingTransaction.bank_account_id,
                IncomingTransaction.payment_method,
                IncomingTransaction.order_type,
            ).where(
                and_(
                    IncomingTransaction.transaction_date >= period_start,
                    IncomingTransaction.transaction_date <= period_end,
                    IncomingTransaction.status == "paid",
                )
            )
        )
        for row_date, row_amt, row_acc_id, row_pm, row_ot in inc_rows_res.fetchall():
            acc_id = row_acc_id if row_acc_id is not None else match_account_by_method(row_pm, row_ot)
            if acc_id == target_account.id and row_date:
                _add_inc(row_date, float(row_amt or 0.0), 1)
    else:
        inc_query = (
            select(
                IncomingTransaction.transaction_date,
                func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
                func.count(IncomingTransaction.id),
            )
            .where(
                and_(
                    IncomingTransaction.transaction_date >= period_start,
                    IncomingTransaction.transaction_date <= period_end,
                    IncomingTransaction.status == "paid",
                )
            )
            .group_by(IncomingTransaction.transaction_date)
        )
        inc_res = await db.execute(inc_query)
        for row_date, row_amt, row_cnt in inc_res.fetchall():
            if row_date:
                _add_inc(row_date, float(row_amt or 0.0), int(row_cnt or 0))

    # B. Transfer Masuk / Keluar (BankTransfer)
    if target_account:
        # Transfer Masuk ke target_account
        tr_in_res = await db.execute(
            select(
                BankTransfer.transfer_date,
                func.coalesce(func.sum(BankTransfer.amount), 0.0),
                func.count(BankTransfer.id),
            )
            .where(
                and_(
                    BankTransfer.transfer_date >= period_start,
                    BankTransfer.transfer_date <= period_end,
                    BankTransfer.to_account_id == target_account.id,
                )
            )
            .group_by(BankTransfer.transfer_date)
        )
        for t_date, t_amt, t_cnt in tr_in_res.fetchall():
            if t_date:
                _add_inc(t_date, float(t_amt or 0.0), int(t_cnt or 0))

        # Transfer Keluar dari target_account (nominal + admin_fee)
        tr_out_res = await db.execute(
            select(
                BankTransfer.transfer_date,
                func.coalesce(func.sum(BankTransfer.amount + BankTransfer.admin_fee), 0.0),
                func.count(BankTransfer.id),
            )
            .where(
                and_(
                    BankTransfer.transfer_date >= period_start,
                    BankTransfer.transfer_date <= period_end,
                    BankTransfer.from_account_id == target_account.id,
                )
            )
            .group_by(BankTransfer.transfer_date)
        )
        for t_date, t_amt, t_cnt in tr_out_res.fetchall():
            if t_date:
                _add_out(t_date, float(t_amt or 0.0), int(t_cnt or 0))
    else:
        # Semua rekening: Biaya admin transfer antar rekening
        tr_fee_res = await db.execute(
            select(
                BankTransfer.transfer_date,
                func.coalesce(func.sum(BankTransfer.admin_fee), 0.0),
                func.count(BankTransfer.id),
            )
            .where(
                and_(
                    BankTransfer.transfer_date >= period_start,
                    BankTransfer.transfer_date <= period_end,
                    BankTransfer.admin_fee > 0,
                )
            )
            .group_by(BankTransfer.transfer_date)
        )
        for t_date, t_amt, t_cnt in tr_fee_res.fetchall():
            if t_date and float(t_amt or 0.0) > 0:
                _add_out(t_date, float(t_amt or 0.0), int(t_cnt or 0))

    # C. Pembayaran Belanja Bertahap (ExpensePayment)
    if target_account:
        effective_ep_acc = func.coalesce(ExpensePayment.bank_account_id, Expense.bank_account_id)
        ep_rows_res = await db.execute(
            select(
                ExpensePayment.payment_date,
                ExpensePayment.amount,
                effective_ep_acc,
                func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
            )
            .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
            .where(
                and_(
                    ExpensePayment.payment_date >= period_start,
                    ExpensePayment.payment_date <= period_end,
                )
            )
        )
        for p_date, p_amt, p_acc_id, p_method in ep_rows_res.fetchall():
            acc_id = p_acc_id if p_acc_id is not None else match_account_by_method(p_method)
            if acc_id == target_account.id and p_date:
                _add_out(p_date, float(p_amt or 0.0), 1)
    else:
        ep_group_res = await db.execute(
            select(
                ExpensePayment.payment_date,
                func.coalesce(func.sum(ExpensePayment.amount), 0.0),
                func.count(ExpensePayment.id),
            )
            .where(
                and_(
                    ExpensePayment.payment_date >= period_start,
                    ExpensePayment.payment_date <= period_end,
                )
            )
            .group_by(ExpensePayment.payment_date)
        )
        for p_date, p_amt, p_cnt in ep_group_res.fetchall():
            if p_date:
                _add_out(p_date, float(p_amt or 0.0), int(p_cnt or 0))

    # D. Pengeluaran Langsung Lunas (Expense)
    if target_account:
        exp_rows_res = await db.execute(
            select(
                Expense.expense_date,
                Expense.total_price,
                Expense.bank_account_id,
                Expense.pay_method,
            ).where(
                and_(
                    Expense.expense_date >= period_start,
                    Expense.expense_date <= period_end,
                    Expense.pay_status == "Lunas",
                    ~has_payment_subq,
                    ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
                )
            )
        )
        for exp_date_val, exp_amt, exp_acc_id, exp_method in exp_rows_res.fetchall():
            acc_id = exp_acc_id if exp_acc_id is not None else match_account_by_method(exp_method)
            if acc_id == target_account.id and exp_date_val:
                _add_out(exp_date_val, float(exp_amt or 0.0), 1)
    else:
        exp_group_res = await db.execute(
            select(
                Expense.expense_date,
                func.coalesce(func.sum(Expense.total_price), 0.0),
                func.count(Expense.id),
            ).where(
                and_(
                    Expense.expense_date >= period_start,
                    Expense.expense_date <= period_end,
                    Expense.pay_status == "Lunas",
                    ~has_payment_subq,
                    ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
                )
            )
            .group_by(Expense.expense_date)
        )
        for exp_date_val, exp_amt, exp_cnt in exp_group_res.fetchall():
            if exp_date_val:
                _add_out(exp_date_val, float(exp_amt or 0.0), int(exp_cnt or 0))

    # 5. Susun Rekapitulasi Baris Harian & Hitung Running Balance
    daily_rows: list[dict[str, Any]] = []
    current_saldo = saldo_awal
    total_cash_in = 0.0
    total_cash_out = 0.0
    total_tx_in = 0
    total_tx_out = 0

    curr_cursor = period_start
    while curr_cursor <= period_end:
        inc_data = daily_inc_map.get(curr_cursor, {"amount": 0.0, "count": 0})
        out_data = daily_out_map.get(curr_cursor, {"amount": 0.0, "count": 0})

        c_in = round(float(inc_data["amount"]), 2)
        c_out = round(float(out_data["amount"]), 2)
        net_d = round(c_in - c_out, 2)
        current_saldo = round(current_saldo + net_d, 2)

        daily_rows.append({
            "date": curr_cursor.isoformat(),
            "cash_in": c_in,
            "cash_out": c_out,
            "net_flow": net_d,
            "saldo": current_saldo,
            "cash_in_count": int(inc_data["count"]),
            "cash_out_count": int(out_data["count"]),
        })

        total_cash_in += c_in
        total_cash_out += c_out
        total_tx_in += int(inc_data["count"])
        total_tx_out += int(out_data["count"])

        curr_cursor += timedelta(days=1)

    bank_accounts_summary = [
        {
            "id": a.id,
            "name": a.name,
            "bank_name": a.bank_name,
            "account_number": a.account_number or "",
            "account_type": a.account_type,
            "account_code": a.account_code or "",
            "opening_balance": float(a.opening_balance or 0.0),
        }
        for a in bank_accounts
    ]

    return {
        "ok": True,
        "periode": periode_str,
        "start_date": period_start.isoformat(),
        "end_date": period_end.isoformat(),
        "month": month_val,
        "year": year_val,
        "bank_account_id": bank_account_id,
        "account_name": account_name,
        "saldo_awal": round(saldo_awal, 2),
        "total_cash_in": round(total_cash_in, 2),
        "total_cash_out": round(total_cash_out, 2),
        "net_cash_flow": round(total_cash_in - total_cash_out, 2),
        "saldo_akhir": round(current_saldo, 2),
        "total_tx_in": total_tx_in,
        "total_tx_out": total_tx_out,
        "days_count": len(daily_rows),
        "bank_accounts": bank_accounts_summary,
        "daily_rows": daily_rows,
    }


def export_cashflow_to_csv(cashflow_data: dict[str, Any]) -> str:
    """
    Format hasil arus kas harian ke format CSV ber-BOM UTF-8 dengan kolom:
    Tanggal, Kas Masuk (Cash In), Kas Keluar (Cash Out), Arus Kas Bersih (Net), Saldo (Balance), Jml Tx Masuk, Jml Tx Keluar
    """
    headers = [
        "Tanggal",
        "Kas Masuk (Cash In)",
        "Kas Keluar (Cash Out)",
        "Arus Kas Bersih (Net)",
        "Saldo (Balance)",
        "Jml Tx Masuk",
        "Jml Tx Keluar",
    ]

    data_rows: list[list[Any]] = []
    for r in cashflow_data.get("daily_rows", []):
        data_rows.append([
            r["date"],
            f"{r['cash_in']:.2f}",
            f"{r['cash_out']:.2f}",
            f"{r['net_flow']:.2f}",
            f"{r['saldo']:.2f}",
            r["cash_in_count"],
            r["cash_out_count"],
        ])

    # Baris ringkasan total di akhir
    data_rows.append([
        "TOTAL / SALDO AKHIR",
        f"{cashflow_data.get('total_cash_in', 0.0):.2f}",
        f"{cashflow_data.get('total_cash_out', 0.0):.2f}",
        f"{cashflow_data.get('net_cash_flow', 0.0):.2f}",
        f"{cashflow_data.get('saldo_akhir', 0.0):.2f}",
        cashflow_data.get("total_tx_in", 0),
        cashflow_data.get("total_tx_out", 0),
    ])

    meta_headers = [
        ["LAPORAN ARUS KAS HARIAN (DAILY CASHFLOW) - HISTORYCAKE"],
        [f"Periode: {cashflow_data.get('periode', '-')}"],
        [f"Rekening: {cashflow_data.get('account_name', 'Semua Rekening & Kas')}"],
        [f"Saldo Awal: {cashflow_data.get('saldo_awal', 0.0):.2f}"],
        [f"Total Kas Masuk: {cashflow_data.get('total_cash_in', 0.0):.2f}"],
        [f"Total Kas Keluar: {cashflow_data.get('total_cash_out', 0.0):.2f}"],
        [f"Arus Kas Bersih: {cashflow_data.get('net_cash_flow', 0.0):.2f}"],
        [f"Saldo Akhir: {cashflow_data.get('saldo_akhir', 0.0):.2f}"],
        [f"Dicetak pada: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"],
        [],  # blank line
    ]

    # Gabungkan metadata dan tabel
    import io
    import csv

    buf = io.StringIO()
    writer = csv.writer(buf)
    for meta in meta_headers:
        writer.writerow(meta)
    writer.writerow(headers)
    for row in data_rows:
        writer.writerow(row)

    return "\ufeff" + buf.getvalue()
