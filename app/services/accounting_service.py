"""
app/services/accounting_service.py — Layanan Laporan & Analisis Akuntansi Standar (SAK EMKM)
Menyajikan laporan Laba Rugi, Posisi Keuangan (Neraca), Arus Kas, dan Analisis Rasio Finansial.
"""
from datetime import datetime, date
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, exists

from app.models.expense import Expense
from app.models.expense_payment import ExpensePayment
from app.models.master_data import MasterDataOption
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction
from app.models.bank_transfer import BankTransfer
from app.models.fixed_asset import FixedAsset
from app.services.expense_service import get_monthly_report
from app.services.master_data_service import get_category_accounting_map, get_master_options
from app.services.bank_account_service import DEFAULT_COA_BY_TYPE, _parse_mappings
from app.services.asset_service import calculate_asset_depreciation

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


def _calc_mom_pct(current: float, previous: float) -> float | None:
    """Hitung persentase kenaikan/penurunan Month-over-Month."""
    if previous <= 0:
        return None
    return round(((current - previous) / previous) * 100.0, 1)


async def get_accounting_report(
    db: AsyncSession,
    year: int,
    month: int,
    month_end: int | None = None,
) -> dict[str, Any]:
    """
    Kompilasi laporan dan analisis akuntansi lengkap standar SAK EMKM:
    1. Laporan Laba Rugi (Beban Pokok Penjualan HPP & Beban Operasional OPEX)
    2. Laporan Posisi Keuangan / Neraca (Aset Lancar Kas/Bank, Aset Tetap, dan Kewajiban Hutang Belanja)
    3. Laporan Arus Kas (Aktivitas Operasi, Investasi Aset, dan Kliring Kas)
    4. Analisis Rasio Finansial, Struktur Biaya, dan Evaluasi Kesehatan Bisnis
    5. Rekap Bagan Akun (Chart of Accounts)
    """
    cur_year = year
    cur_month = month
    cur_month_end = month_end or month
    cur_month_name = (
        f"{MONTH_NAMES[cur_month - 1]} - {MONTH_NAMES[cur_month_end - 1]}"
        if cur_month_end != cur_month
        else MONTH_NAMES[cur_month - 1]
    )

    # Hitung periode pembanding
    if cur_month_end == cur_month:
        if cur_month == 1:
            prev_month, prev_year = 12, cur_year - 1
        else:
            prev_month, prev_year = cur_month - 1, cur_year
        prev_report = await get_monthly_report(db, prev_year, prev_month)
        prev_month_name = MONTH_NAMES[prev_month - 1]
    else:
        prev_year = cur_year - 1
        prev_month = cur_month
        prev_report = await get_monthly_report(db, prev_year, cur_month, month_end=cur_month_end)
        prev_month_name = f"{MONTH_NAMES[cur_month - 1][:3]}-{MONTH_NAMES[cur_month_end - 1][:3]} {prev_year}"

    # Ambil laporan belanja periode ini
    cur_report = await get_monthly_report(db, cur_year, cur_month, month_end=cur_month_end)

    # Ambil master options dan COA
    kategori_options = await get_master_options(db, opt_type="kategori", active_only=True)
    metode_bayar_options = await get_master_options(db, opt_type="metode_bayar", active_only=True)
    coa_map = await get_category_accounting_map(db)

    # Hitung jumlah transaksi per kategori pada periode ini
    start_date = date(cur_year, cur_month, 1)
    end_date = date(cur_year + 1, 1, 1) if cur_month_end == 12 else date(cur_year, cur_month_end + 1, 1)
    
    tx_count_res = await db.execute(
        select(func.lower(Expense.category), func.count(Expense.id))
        .where(and_(Expense.expense_date >= start_date, Expense.expense_date < end_date))
        .group_by(func.lower(Expense.category))
    )
    tx_counts: dict[str, int] = {
        row[0]: int(row[1]) for row in tx_count_res.fetchall() if row[0]
    }

    # Ambil data pengeluaran aktual
    cur_per_kat = cur_report.get("per_kategori", {})
    prev_per_kat = prev_report.get("per_kategori", {})
    cur_ongkir = float(cur_report.get("total_ongkir", 0.0))
    prev_ongkir = float(prev_report.get("total_ongkir", 0.0))
    cur_tukar_cash = float(cur_report.get("total_tukar_cash", 0.0))
    prev_tukar_cash = float(prev_report.get("total_tukar_cash", 0.0))
    cur_metode = cur_report.get("per_metode_bayar", {})

    # Susun semua akun kategori
    all_account_lines: list[dict[str, Any]] = []

    for opt in kategori_options:
        cat_name = opt["name"]
        cat_lower = cat_name.lower()
        code = opt.get("account_code") or "-"
        acc_name = opt.get("account_name") or cat_name
        group = opt.get("account_group") or "OPEX"
        rep_type = opt.get("report_type") or "LABA_RUGI"

        if cat_name == "Ongkir":
            val_cur = cur_ongkir
            val_prev = prev_ongkir
            count = int(cur_report.get("ongkir_count", 0))
        elif cat_name == "Tukar Cash":
            val_cur = cur_tukar_cash
            val_prev = prev_tukar_cash
            count = int(cur_report.get("tukar_cash_count", 0))
        else:
            val_cur = float(cur_per_kat.get(cat_name, 0.0))
            val_prev = float(prev_per_kat.get(cat_name, 0.0))
            count = tx_counts.get(cat_lower, 0)

        diff_nom = val_cur - val_prev
        mom_pct = _calc_mom_pct(val_cur, val_prev)

        all_account_lines.append({
            "account_code": code,
            "account_name": acc_name,
            "category": cat_name,
            "account_group": group,
            "report_type": rep_type,
            "total": val_cur,
            "prev_total": val_prev,
            "diff_nominal": diff_nom,
            "mom_change_pct": mom_pct,
            "transaction_count": count,
            "description": opt.get("description", ""),
        })

    # Tangani kategori belanja aktual yang belum terdaftar di opsi master kategori
    seen_cats = {opt["name"].strip().lower() for opt in kategori_options}
    for cat_name, val_cur in cur_per_kat.items():
        if cat_name.strip().lower() not in seen_cats:
            coa = coa_map.get(cat_name, {})
            code = coa.get("account_code") or "6-9900"
            acc_name = coa.get("account_name") or f"Beban Lainnya ({cat_name})"
            group = coa.get("account_group") or ("HPP" if any(k in cat_name.lower() for k in ("bahan", "kemasan", "baku")) else "OPEX")
            rep_type = coa.get("report_type") or "LABA_RUGI"
            val_prev = float(prev_per_kat.get(cat_name, 0.0))
            all_account_lines.append({
                "account_code": code,
                "account_name": acc_name,
                "category": cat_name,
                "account_group": group,
                "report_type": rep_type,
                "total": float(val_cur),
                "prev_total": val_prev,
                "diff_nominal": float(val_cur) - val_prev,
                "mom_change_pct": _calc_mom_pct(float(val_cur), val_prev),
                "transaction_count": tx_counts.get(cat_name.lower(), 0),
                "description": f"Kategori pengeluaran {cat_name}",
            })

    # Urutkan berdasarkan account_code
    all_account_lines.sort(key=lambda x: (x["account_code"], x["category"]))

    # ─────────────────────────────────────────────────────────────
    # INVENTARIS ASET TETAP & PENYUSUTAN SAK EMKM
    # ─────────────────────────────────────────────────────────────
    fixed_assets_res = await db.execute(select(FixedAsset).order_by(FixedAsset.id.asc()))
    all_fixed_assets = list(fixed_assets_res.scalars().all())

    cur_dep_expense = 0.0
    prev_dep_expense = 0.0
    cur_low_value_expense = 0.0
    prev_low_value_expense = 0.0
    cur_gross_fixed_asset = 0.0
    cur_accum_dep = 0.0
    cur_disposal_gain_loss = 0.0
    prev_disposal_gain_loss = 0.0
    active_capitalized_count = 0
    low_value_asset_count = 0
    linked_asset_expense_ids: set[int] = set()

    for ast in all_fixed_assets:
        if ast.expense_id:
            linked_asset_expense_ids.add(ast.expense_id)
        cur_calc = calculate_asset_depreciation(ast, cur_year, cur_month)
        prev_calc = calculate_asset_depreciation(ast, prev_year, prev_month)

        cur_dep_expense += cur_calc["depreciation_in_period"]
        prev_dep_expense += prev_calc["depreciation_in_period"]
        cur_low_value_expense += cur_calc["immediate_expense_in_period"]
        prev_low_value_expense += prev_calc["immediate_expense_in_period"]
        cur_gross_fixed_asset += cur_calc["gross_balance_sheet_cost"]
        cur_accum_dep += cur_calc["accumulated_depreciation"]
        cur_disposal_gain_loss += cur_calc["disposal_gain_loss_in_period"]
        prev_disposal_gain_loss += prev_calc["disposal_gain_loss_in_period"]

        if cur_calc["is_owned_in_period"] and not cur_calc["is_disposed_as_of"]:
            if ast.capitalization_status == "capitalized":
                active_capitalized_count += 1
            else:
                low_value_asset_count += 1

    cur_dep_expense = round(cur_dep_expense, 2)
    prev_dep_expense = round(prev_dep_expense, 2)
    cur_low_value_expense = round(cur_low_value_expense, 2)
    prev_low_value_expense = round(prev_low_value_expense, 2)
    cur_gross_fixed_asset = round(cur_gross_fixed_asset, 2)
    cur_accum_dep = round(cur_accum_dep, 2)

    if cur_dep_expense > 0 or prev_dep_expense > 0:
        all_account_lines.append({
            "account_code": "6-2100",
            "account_name": "Beban Penyusutan Aset Tetap",
            "category": "Penyusutan Aset",
            "account_group": "OPEX",
            "report_type": "LABA_RUGI",
            "total": cur_dep_expense,
            "prev_total": prev_dep_expense,
            "diff_nominal": round(cur_dep_expense - prev_dep_expense, 2),
            "mom_change_pct": _calc_mom_pct(cur_dep_expense, prev_dep_expense),
            "transaction_count": active_capitalized_count,
            "description": "Beban penyusutan garis lurus aset tetap bulan berjalan (non-kas, SAK EMKM)",
        })

    if cur_low_value_expense > 0 or prev_low_value_expense > 0:
        all_account_lines.append({
            "account_code": "6-2200",
            "account_name": "Beban Peralatan Nilai Rendah",
            "category": "Peralatan Kecil",
            "account_group": "OPEX",
            "report_type": "LABA_RUGI",
            "total": cur_low_value_expense,
            "prev_total": prev_low_value_expense,
            "diff_nominal": round(cur_low_value_expense - prev_low_value_expense, 2),
            "mom_change_pct": _calc_mom_pct(cur_low_value_expense, prev_low_value_expense),
            "transaction_count": low_value_asset_count,
            "description": "Pembelian alat di bawah batas minimal kapitalisasi yang langsung dibebankan",
        })

    all_account_lines.sort(key=lambda x: (x["account_code"], x["category"]))

    # ─────────────────────────────────────────────────────────────
    # 1. LAPORAN LABA RUGI (PENDAPATAN USAHA & BEBAN USAHA)
    # ─────────────────────────────────────────────────────────────
    prev_start_date = date(prev_year, prev_month, 1)
    prev_end_date = start_date

    rev_cur_res = await db.execute(
        select(
            func.count(IncomingTransaction.id),
            func.coalesce(func.sum(IncomingTransaction.gross_sales), 0.0),
            func.coalesce(func.sum(IncomingTransaction.discount_amount), 0.0),
            func.coalesce(func.sum(IncomingTransaction.platform_fee), 0.0),
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        ).where(
            and_(
                IncomingTransaction.transaction_date >= start_date,
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
            )
        )
    )
    rev_cur_row = rev_cur_res.fetchone()
    paid_tx_count = int(rev_cur_row[0] or 0) if rev_cur_row else 0
    revenue_gross = float(rev_cur_row[1] or 0.0) if rev_cur_row else 0.0
    revenue_discount = float(rev_cur_row[2] or 0.0) if rev_cur_row else 0.0
    revenue_platform_fee = float(rev_cur_row[3] or 0.0) if rev_cur_row else 0.0
    revenue_net = float(rev_cur_row[4] or 0.0) if rev_cur_row else 0.0

    rev_prev_res = await db.execute(
        select(func.coalesce(func.sum(IncomingTransaction.net_received), 0.0)).where(
            and_(
                IncomingTransaction.transaction_date >= prev_start_date,
                IncomingTransaction.transaction_date < prev_end_date,
                IncomingTransaction.status == "paid",
            )
        )
    )
    prev_revenue_net = float(rev_prev_res.scalar() or 0.0)
    mom_revenue_pct = _calc_mom_pct(revenue_net, prev_revenue_net)

    rev_channel_res = await db.execute(
        select(
            IncomingTransaction.order_type,
            func.count(IncomingTransaction.id),
            func.coalesce(func.sum(IncomingTransaction.gross_sales), 0.0),
            func.coalesce(func.sum(IncomingTransaction.platform_fee), 0.0),
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        )
        .where(
            and_(
                IncomingTransaction.transaction_date >= start_date,
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
            )
        )
        .group_by(IncomingTransaction.order_type)
        .order_by(func.sum(IncomingTransaction.net_received).desc())
    )
    revenue_by_channel = [
        {
            "channel": r[0] or "Lainnya",
            "tx_count": int(r[1] or 0),
            "gross_sales": float(r[2] or 0.0),
            "platform_fee": float(r[3] or 0.0),
            "net_received": float(r[4] or 0.0),
            "percentage": round((float(r[4] or 0.0) / revenue_net) * 100.0, 1) if revenue_net > 0 else 0.0,
        }
        for r in rev_channel_res.fetchall()
    ]

    hpp_items: list[dict[str, Any]] = [
        item for item in all_account_lines
        if item["account_group"] == "HPP" or item["category"] == "Ongkir"
    ]
    subtotal_hpp = sum(item["total"] for item in hpp_items)
    prev_subtotal_hpp = sum(item["prev_total"] for item in hpp_items)
    mom_hpp_pct = _calc_mom_pct(subtotal_hpp, prev_subtotal_hpp)

    opex_items: list[dict[str, Any]] = [
        item for item in all_account_lines
        if item["account_group"] == "OPEX"
    ]
    subtotal_opex = sum(item["total"] for item in opex_items)
    prev_subtotal_opex = sum(item["prev_total"] for item in opex_items)
    mom_opex_pct = _calc_mom_pct(subtotal_opex, prev_subtotal_opex)

    total_beban = subtotal_hpp + subtotal_opex
    prev_total_beban = prev_subtotal_hpp + prev_subtotal_opex
    mom_beban_pct = _calc_mom_pct(total_beban, prev_total_beban)

    gross_profit = revenue_net - subtotal_hpp
    net_profit = revenue_net - total_beban + round(cur_disposal_gain_loss, 2)
    prev_net_profit = prev_revenue_net - prev_total_beban + round(prev_disposal_gain_loss, 2)

    # Tambahkan proporsi persentase ke masing-masing item Laba Rugi
    for item in hpp_items:
        item["percentage_of_group"] = round((item["total"] / subtotal_hpp) * 100.0, 1) if subtotal_hpp > 0 else 0.0
        item["percentage_of_total_expense"] = round((item["total"] / total_beban) * 100.0, 1) if total_beban > 0 else 0.0

    for item in opex_items:
        item["percentage_of_group"] = round((item["total"] / subtotal_opex) * 100.0, 1) if subtotal_opex > 0 else 0.0
        item["percentage_of_total_expense"] = round((item["total"] / total_beban) * 100.0, 1) if total_beban > 0 else 0.0

    laba_rugi = {
        "paid_tx_count": paid_tx_count,
        "revenue_gross": revenue_gross,
        "revenue_discount": revenue_discount,
        "revenue_platform_fee": revenue_platform_fee,
        "revenue_net": revenue_net,
        "prev_revenue_net": prev_revenue_net,
        "mom_revenue_change_pct": mom_revenue_pct,
        "gross_profit": gross_profit,
        "net_profit": net_profit,
        "prev_net_profit": prev_net_profit,
        "disposal_gain_loss": round(cur_disposal_gain_loss, 2),
        "depreciation_expense": cur_dep_expense,
        "low_value_asset_expense": cur_low_value_expense,
        "revenue_by_channel": revenue_by_channel,
        "hpp_items": hpp_items,
        "subtotal_hpp": subtotal_hpp,
        "prev_subtotal_hpp": prev_subtotal_hpp,
        "mom_hpp_change_pct": mom_hpp_pct,
        "opex_items": opex_items,
        "subtotal_opex": subtotal_opex,
        "prev_subtotal_opex": prev_subtotal_opex,
        "mom_opex_change_pct": mom_opex_pct,
        "total_beban": total_beban,
        "prev_total_beban": prev_total_beban,
        "mom_beban_change_pct": mom_beban_pct,
    }

    # ─────────────────────────────────────────────────────────────
    # 2. LAPORAN POSISI KEUANGAN / NERACA (BELANJA & ASET)
    # ─────────────────────────────────────────────────────────────
    # Aset Lancar: Kas & Bank yang dikeluarkan untuk transaksi lunas
    cash_method_map: dict[str, dict[str, str]] = {
        "tunai": {"code": "1-1110", "name": "Kas Tunai Kasir"},
        "cod": {"code": "1-1110", "name": "Kas Tunai Kasir (COD)"},
        "transfer": {"code": "1-1120", "name": "Bank Operasional"},
        "qris": {"code": "1-1121", "name": "QRIS Settlement"},
        "debit": {"code": "1-1122", "name": "EDC Debit"},
    }

    aset_lancar: list[dict[str, Any]] = []
    total_kas_lancar = 0.0

    for m_name, m_total in cur_metode.items():
        m_lower = m_name.lower()
        mapping = None
        for k, v in cash_method_map.items():
            if k in m_lower:
                mapping = v
                break
        if not mapping:
            mapping = {"code": "1-1120", "name": f"Bank Operasional ({m_name})"}

        aset_lancar.append({
            "account_code": mapping["code"],
            "account_name": mapping["name"],
            "group": "ASET_LANCAR",
            "nominal": float(m_total),
            "description": f"Realisasi pengeluaran kas melalui metode {m_name}",
        })
        total_kas_lancar += float(m_total)

    # Tambahkan Kas Kliring (Tukar Cash)
    if cur_tukar_cash > 0:
        aset_lancar.append({
            "account_code": "1-1199",
            "account_name": "Kas Kliring / Penukaran Tunai",
            "group": "ASET_LANCAR",
            "nominal": cur_tukar_cash,
            "description": "Titip tarik tunai kasir (netral, saldo kliring)",
        })

    subtotal_aset_lancar = sum(i["nominal"] for i in aset_lancar)

    # Aset Tetap (Peralatan & Mesin - Nilai Perolehan & Akumulasi Penyusutan SAK EMKM)
    asset_line = next((item for item in all_account_lines if item["category"] == "Asset"), None)
    asset_month_total = float(asset_line["total"]) if asset_line else 0.0

    # Fallback hanya untuk transaksi Asset lama/langsung yang belum masuk ke fixed_assets
    unlinked_asset_res = await db.execute(
        select(Expense.id, Expense.total_price).where(
            and_(
                func.lower(Expense.category) == "asset",
                Expense.expense_date < end_date,
            )
        )
    )
    unlinked_asset_total = sum(
        float(r[1] or 0.0)
        for r in unlinked_asset_res.fetchall()
        if r[0] not in linked_asset_expense_ids
    )

    gross_aset_tetap = round(cur_gross_fixed_asset + unlinked_asset_total, 2)
    net_aset_tetap = round(max(0.0, gross_aset_tetap - cur_accum_dep), 2)
    subtotal_aset_tetap = net_aset_tetap

    aset_tetap = [
        {
            "account_code": "1-2100",
            "account_name": "Aset Tetap - Peralatan & Mesin (Harga Perolehan)",
            "group": "ASET_TETAP",
            "nominal": gross_aset_tetap,
            "description": f"{active_capitalized_count} unit aset tetap dikapitalisasi s/d {cur_month_name} {cur_year} (pembelian bulan ini: Rp {asset_month_total:,.0f})",
        },
        {
            "account_code": "1-2190",
            "account_name": "Akumulasi Penyusutan Aset Tetap",
            "group": "ASET_TETAP",
            "nominal": -cur_accum_dep,
            "description": f"Akumulasi penyusutan garis lurus s/d {cur_month_name} {cur_year} (beban bulan ini: Rp {cur_dep_expense:,.0f})",
        },
    ]
    aset_tetap_summary = {
        "gross_cost": gross_aset_tetap,
        "accumulated_depreciation": cur_accum_dep,
        "net_book_value": net_aset_tetap,
        "monthly_depreciation": cur_dep_expense,
        "active_capitalized_count": active_capitalized_count,
        "low_value_count": low_value_asset_count,
        "disposal_gain_loss_month": round(cur_disposal_gain_loss, 2),
    }

    total_aset = subtotal_aset_lancar + subtotal_aset_tetap

    # Kewajiban Lancar (Hutang Belanja Tempo + Hutang Talangan/Reimbursement)
    list_hutang = cur_report.get("list_hutang", [])
    subtotal_hutang_usaha = sum(float(item.get("nominal", 0)) for item in list_hutang)

    reimb_res = await db.execute(
        select(
            func.count(Expense.id),
            func.coalesce(func.sum(Expense.total_price), 0.0),
        ).where(
            and_(
                Expense.is_reimbursement == True,  # noqa: E712
                Expense.reimbursed_at.is_(None),
            )
        )
    )
    reimb_row = reimb_res.fetchone()
    reimb_count = int(reimb_row[0] or 0) if reimb_row else 0
    subtotal_hutang_talangan = float(reimb_row[1] or 0.0) if reimb_row else 0.0

    subtotal_kewajiban = subtotal_hutang_usaha + subtotal_hutang_talangan
    kewajiban_lancar = [
        {
            "account_code": "2-1110",
            "account_name": "Hutang Usaha / Belanja Tempo",
            "group": "KEWAJIBAN",
            "nominal": subtotal_hutang_usaha,
            "description": f"{len(list_hutang)} transaksi belanja belum lunas / tempo ke supplier",
        },
        {
            "account_code": "2-1120",
            "account_name": "Hutang Talangan / Reimbursement",
            "group": "KEWAJIBAN",
            "nominal": subtotal_hutang_talangan,
            "description": f"{reimb_count} transaksi talangan staf/owner yang belum diganti",
        },
    ]

    # Posisi Kas & Bank per Rekening Setup (Terhubung ke COA 1-11xx)
    bank_accs_res = await db.execute(
        select(BankAccount)
        .where(BankAccount.is_active == True)  # noqa: E712
        .order_by(BankAccount.sort_order.asc(), BankAccount.id.asc())
    )
    bank_accounts = bank_accs_res.scalars().all()

    inc_month_res = await db.execute(
        select(
            IncomingTransaction.bank_account_id,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        )
        .where(
            and_(
                IncomingTransaction.transaction_date >= start_date,
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
                IncomingTransaction.bank_account_id.is_not(None),
            )
        )
        .group_by(IncomingTransaction.bank_account_id)
    )
    inc_month_map = {int(r[0]): float(r[1] or 0.0) for r in inc_month_res.fetchall()}

    inc_all_res = await db.execute(
        select(
            IncomingTransaction.bank_account_id,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        )
        .where(
            and_(
                IncomingTransaction.status == "paid",
                IncomingTransaction.bank_account_id.is_not(None),
            )
        )
        .group_by(IncomingTransaction.bank_account_id)
    )
    inc_all_map = {int(r[0]): float(r[1] or 0.0) for r in inc_all_res.fetchall()}

    # Cocokkan pengeluaran (cur_metode) ke rekening berdasarkan channel_mappings
    method_to_acc_id: dict[str, int] = {}
    default_acc_id: int | None = None
    for acc in bank_accounts:
        if acc.is_default and default_acc_id is None:
            default_acc_id = acc.id
        for m in _parse_mappings(acc.channel_mappings):
            key = m.strip().lower()
            if key and key not in method_to_acc_id:
                method_to_acc_id[key] = acc.id

    def match_account_by_method(method_name: str | None) -> int | None:
        m_key = (method_name or "").strip().lower()
        if not m_key:
            return default_acc_id
        matched = method_to_acc_id.get(m_key)
        if matched is None:
            for k, aid in method_to_acc_id.items():
                if k in m_key or m_key in k:
                    matched = aid
                    break
        return matched if matched is not None else default_acc_id

    has_payment_subq = exists(
        select(ExpensePayment.id).where(ExpensePayment.expense_id == Expense.id)
    )

    # Pengeluaran bulan ini yang sudah memilih bank_account_id langsung (tanpa ExpensePayment)
    exp_direct_res = await db.execute(
        select(
            Expense.bank_account_id,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            and_(
                Expense.expense_date >= start_date,
                Expense.expense_date < end_date,
                Expense.pay_status == "Lunas",
                Expense.bank_account_id.is_not(None),
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
        .group_by(Expense.bank_account_id)
    )
    out_month_map: dict[int, float] = {int(r[0]): float(r[1] or 0.0) for r in exp_direct_res.fetchall()}

    # Pembayaran DP/termin/pelunasan/talangan bulan ini per rekening (coalesce payment & parent expense)
    effective_ep_month_id = func.coalesce(ExpensePayment.bank_account_id, Expense.bank_account_id)
    ep_month_res = await db.execute(
        select(
            effective_ep_month_id,
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(
            and_(
                ExpensePayment.payment_date >= start_date,
                ExpensePayment.payment_date < end_date,
                effective_ep_month_id.is_not(None),
            )
        )
        .group_by(effective_ep_month_id)
    )
    for aid, amt in ep_month_res.fetchall():
        out_month_map[int(aid)] = out_month_map.get(int(aid), 0.0) + float(amt or 0.0)

    # Pembayaran DP/termin/pelunasan bulan ini tanpa bank_account_id -> fallback channel_mappings
    ep_month_unassigned_res = await db.execute(
        select(
            func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(
            and_(
                ExpensePayment.payment_date >= start_date,
                ExpensePayment.payment_date < end_date,
                effective_ep_month_id.is_(None),
            )
        )
        .group_by(func.coalesce(ExpensePayment.pay_method, Expense.pay_method))
    )
    for m_name, amt in ep_month_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            out_month_map[matched_id] = out_month_map.get(matched_id, 0.0) + float(amt or 0.0)

    # Pengeluaran langsung bulan ini yang belum punya bank_account_id -> fallback mapping pay_method
    exp_unassigned_res = await db.execute(
        select(
            Expense.pay_method,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            and_(
                Expense.expense_date >= start_date,
                Expense.expense_date < end_date,
                Expense.pay_status == "Lunas",
                Expense.bank_account_id.is_(None),
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
        .group_by(Expense.pay_method)
    )
    for m_name, m_total in exp_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            out_month_map[matched_id] = out_month_map.get(matched_id, 0.0) + float(m_total or 0.0)

    # Transfer antar rekening (all-time & bulan ini)
    tr_in_all_res = await db.execute(
        select(BankTransfer.to_account_id, func.coalesce(func.sum(BankTransfer.amount), 0.0))
        .group_by(BankTransfer.to_account_id)
    )
    tr_in_all = {int(r[0]): float(r[1] or 0.0) for r in tr_in_all_res.fetchall()}

    tr_out_all_res = await db.execute(
        select(BankTransfer.from_account_id, func.coalesce(func.sum(BankTransfer.amount + BankTransfer.admin_fee), 0.0))
        .group_by(BankTransfer.from_account_id)
    )
    tr_out_all = {int(r[0]): float(r[1] or 0.0) for r in tr_out_all_res.fetchall()}

    # Pengeluaran lunas kumulatif per rekening (all-time) agar konsisten dengan Rekening Setup
    exp_all_res = await db.execute(
        select(
            Expense.bank_account_id,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            and_(
                Expense.bank_account_id.is_not(None),
                Expense.pay_status == "Lunas",
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
        .group_by(Expense.bank_account_id)
    )
    exp_all_map = {int(r[0]): float(r[1] or 0.0) for r in exp_all_res.fetchall()}

    # Pengeluaran langsung all-time tanpa bank_account_id -> fallback channel_mappings
    exp_all_unassigned_res = await db.execute(
        select(
            Expense.pay_method,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            and_(
                Expense.bank_account_id.is_(None),
                Expense.pay_status == "Lunas",
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
        .group_by(Expense.pay_method)
    )
    for m_name, amt in exp_all_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            exp_all_map[matched_id] = exp_all_map.get(matched_id, 0.0) + float(amt or 0.0)

    # Pembayaran bertahap all-time (coalesce payment & parent expense)
    effective_ep_all_id = func.coalesce(ExpensePayment.bank_account_id, Expense.bank_account_id)
    ep_all_res = await db.execute(
        select(
            effective_ep_all_id,
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(effective_ep_all_id.is_not(None))
        .group_by(effective_ep_all_id)
    )
    for aid, amt in ep_all_res.fetchall():
        exp_all_map[int(aid)] = exp_all_map.get(int(aid), 0.0) + float(amt or 0.0)

    # Pembayaran bertahap all-time tanpa bank_account_id -> fallback channel_mappings
    ep_all_unassigned_res = await db.execute(
        select(
            func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(effective_ep_all_id.is_(None))
        .group_by(func.coalesce(ExpensePayment.pay_method, Expense.pay_method))
    )
    for m_name, amt in ep_all_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            exp_all_map[matched_id] = exp_all_map.get(matched_id, 0.0) + float(amt or 0.0)

    rekening_positions: list[dict[str, Any]] = []
    for acc in bank_accounts:
        in_m = inc_month_map.get(acc.id, 0.0)
        out_m = out_month_map.get(acc.id, 0.0)
        in_all = inc_all_map.get(acc.id, 0.0)
        exp_all = exp_all_map.get(acc.id, 0.0)
        t_in = tr_in_all.get(acc.id, 0.0)
        t_out = tr_out_all.get(acc.id, 0.0)
        coa_code = acc.account_code or DEFAULT_COA_BY_TYPE.get(acc.account_type, "1-1120")
        rekening_positions.append({
            "id": acc.id,
            "account_code": coa_code,
            "name": acc.name,
            "bank_name": acc.bank_name,
            "account_type": acc.account_type,
            "opening_balance": float(acc.opening_balance or 0.0),
            "incoming_month": in_m,
            "outgoing_month": out_m,
            "net_month_flow": in_m - out_m,
            "estimated_balance": float(acc.opening_balance or 0.0) + in_all + t_in - t_out - exp_all,
        })

    # Ekuitas (Modal Awal Rekening + Laba/Rugi Bersih Berjalan)
    modal_awal_rekening = sum(float(acc.opening_balance or 0.0) for acc in bank_accounts)
    ekuitas = [
        {
            "account_code": "3-1100",
            "account_name": "Modal Awal & Saldo Awal Rekening",
            "group": "EKUITAS",
            "nominal": modal_awal_rekening,
            "description": f"Akumulasi saldo awal dari {len(bank_accounts)} rekening aktif",
        },
        {
            "account_code": "3-2100",
            "account_name": f"Laba / Rugi Bersih ({cur_month_name} {cur_year})",
            "group": "EKUITAS",
            "nominal": net_profit,
            "description": "Pendapatan bersih dikurangi total beban usaha (HPP + OPEX)",
        },
    ]
    subtotal_ekuitas = modal_awal_rekening + net_profit

    neraca = {
        "aset_lancar": aset_lancar,
        "subtotal_aset_lancar": subtotal_aset_lancar,
        "rekening_positions": rekening_positions,
        "total_rekening_balance": sum(r["estimated_balance"] for r in rekening_positions),
        "aset_tetap": aset_tetap,
        "aset_tetap_summary": aset_tetap_summary,
        "subtotal_aset_tetap": subtotal_aset_tetap,
        "total_aset": total_aset,
        "kewajiban_lancar": kewajiban_lancar,
        "subtotal_kewajiban": subtotal_kewajiban,
        "detail_hutang": list_hutang,
        "ekuitas": ekuitas,
        "subtotal_ekuitas": subtotal_ekuitas,
    }

    # ─────────────────────────────────────────────────────────────
    # 3. LAPORAN ARUS KAS (CASH FLOW STATEMENT)
    # ─────────────────────────────────────────────────────────────
    # Arus Kas Operasi: Pengeluaran kas untuk HPP dan OPEX (tidak termasuk beban penyusutan non-kas 6-2100)
    cash_opex = round(max(0.0, subtotal_opex - cur_dep_expense), 2)
    cash_total_beban = subtotal_hpp + cash_opex
    arus_operasi = [
        {
            "activity": "Pengeluaran Kas untuk Pembelian Bahan Baku & HPP",
            "account_name": "Harga Pokok Penjualan",
            "nominal": subtotal_hpp,
            "percentage": round((subtotal_hpp / cash_total_beban) * 100.0, 1) if cash_total_beban > 0 else 0.0,
        },
        {
            "activity": "Pengeluaran Kas untuk Operasional, Gaji, Sewa, & Utilitas",
            "account_name": "Beban Operasional (OPEX Kas)",
            "nominal": cash_opex,
            "percentage": round((cash_opex / cash_total_beban) * 100.0, 1) if cash_total_beban > 0 else 0.0,
        },
    ]
    subtotal_arus_operasi = subtotal_hpp + cash_opex

    # Arus Kas Investasi: Pembelian Aset Tetap dikapitalisasi bulan berjalan (hindari double count aset nilai rendah yang sudah masuk OPEX 6-2200)
    capex_cash_month = round(max(0.0, asset_month_total - cur_low_value_expense), 2)
    arus_investasi = [
        {
            "activity": "Pengeluaran Kas untuk Pembelian Aset Tetap & Peralatan (Capex Bulan Ini)",
            "account_name": "Belanja Modal (Capex)",
            "nominal": capex_cash_month,
            "percentage": 100.0 if capex_cash_month > 0 else 0.0,
        }
    ]
    subtotal_arus_investasi = capex_cash_month

    # Arus Kas Kliring / Transfer
    arus_kliring = [
        {
            "activity": "Penukaran Kas / Kliring Titip Tarik Tunai Kasir",
            "account_name": "Kas Kliring (Tukar Cash)",
            "nominal": cur_tukar_cash,
            "percentage": 100.0 if cur_tukar_cash > 0 else 0.0,
        }
    ]
    subtotal_arus_kliring = cur_tukar_cash

    total_kas_keluar_riil = subtotal_arus_operasi + subtotal_arus_investasi + subtotal_arus_kliring

    # Distribusi Metode Pembayaran
    metode_distribution = []
    for m_name, m_nom in cur_metode.items():
        pct = round((float(m_nom) / total_kas_keluar_riil) * 100.0, 1) if total_kas_keluar_riil > 0 else 0.0
        metode_distribution.append({
            "metode": m_name,
            "nominal": float(m_nom),
            "percentage": pct,
        })
    metode_distribution.sort(key=lambda x: -x["nominal"])

    arus_kas = {
        "total_kas_masuk": revenue_net,
        "net_cash_flow": revenue_net - total_kas_keluar_riil,
        "aktivitas_operasi": arus_operasi,
        "subtotal_operasi": subtotal_arus_operasi,
        "aktivitas_investasi": arus_investasi,
        "subtotal_investasi": subtotal_arus_investasi,
        "aktivitas_kliring": arus_kliring,
        "subtotal_kliring": subtotal_arus_kliring,
        "total_kas_keluar_riil": total_kas_keluar_riil,
        "metode_bayar_distribution": metode_distribution,
    }

    # ─────────────────────────────────────────────────────────────
    # 4. ANALISIS AKUNTANSI & RASIO FINANSIAL (ANALYTICS & HEALTH)
    # ─────────────────────────────────────────────────────────────
    # Helper ambil nominal kategori tertentu
    def _get_cat_nominal(name: str) -> float:
        line = next((i for i in all_account_lines if i["category"].lower() == name.lower()), None)
        return float(line["total"]) if line else 0.0

    gaji_total = _get_cat_nominal("Gaji")
    sewa_total = _get_cat_nominal("Sewa")
    marketing_total = _get_cat_nominal("Marketing")
    software_total = _get_cat_nominal("Software")
    maintenance_total = _get_cat_nominal("Maintenance")
    utilitas_total = _get_cat_nominal("Operasional")
    bahan_total = _get_cat_nominal("Bahan Kue") + _get_cat_nominal("Bahan Minuman")

    cost_structure = {
        "hpp_ratio": round((subtotal_hpp / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "opex_ratio": round((subtotal_opex / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "bahan_ratio": round((bahan_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "gaji_ratio": round((gaji_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "sewa_ratio": round((sewa_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "marketing_ratio": round((marketing_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "maintenance_ratio": round((maintenance_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "software_ratio": round((software_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "utilitas_ratio": round((utilitas_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
    }

    # Analisis variansi akun (kenaikan terbesar & penghematan)
    variances = [item for item in all_account_lines if item["total"] > 0 or item["prev_total"] > 0]
    top_increases = sorted(
        [v for v in variances if v["diff_nominal"] > 0],
        key=lambda x: -x["diff_nominal"]
    )[:5]
    top_savings = sorted(
        [v for v in variances if v["diff_nominal"] < 0],
        key=lambda x: x["diff_nominal"]
    )[:5]

    top_variances_mom = {
        "top_increases": top_increases,
        "top_savings": top_savings,
    }

    # Evaluasi Kesehatan Finansial
    health_evaluation: list[dict[str, Any]] = []

    # 1. Evaluasi Rasio HPP
    hpp_ratio = cost_structure["hpp_ratio"]
    if hpp_ratio == 0:
        h_status = "neutral"
        h_note = "Belum ada transaksi beban HPP tercatat pada bulan ini."
    elif 40.0 <= hpp_ratio <= 55.0:
        h_status = "healthy"
        h_note = f"Rasio HPP ({hpp_ratio}%) berada pada rentang ideal toko kue & bakery (40% - 55%)."
    elif hpp_ratio < 40.0:
        h_status = "healthy"
        h_note = f"Rasio HPP ({hpp_ratio}%) sangat efisien (di bawah 40% dari total beban usaha)."
    else:
        h_status = "warning"
        h_note = f"Rasio HPP ({hpp_ratio}%) di atas 55%. Pertimbangkan review harga bahan baku atau negosiasi supplier."

    health_evaluation.append({
        "key": "hpp_ratio",
        "title": "Rasio Harga Pokok Penjualan (HPP)",
        "value": f"{hpp_ratio}%",
        "ideal_range": "40% - 55%",
        "status": h_status,
        "note": h_note,
    })

    # 2. Evaluasi Rasio Gaji Karyawan
    gaji_ratio = cost_structure["gaji_ratio"]
    if gaji_ratio == 0:
        g_status = "neutral"
        g_note = "Belum ada transaksi payroll / gaji karyawan yang diinput bulan ini."
    elif 15.0 <= gaji_ratio <= 28.0:
        g_status = "healthy"
        g_note = f"Rasio gaji ({gaji_ratio}%) berada dalam porsi wajar usaha F&B/ritel (15% - 28%)."
    elif gaji_ratio < 15.0:
        g_status = "healthy"
        g_note = f"Porsi beban gaji ({gaji_ratio}%) sangat terjaga."
    else:
        g_status = "warning"
        g_note = f"Porsi beban gaji ({gaji_ratio}%) melampaui 28% total beban. Perhatikan jam lembur & produktivitas tim."

    health_evaluation.append({
        "key": "gaji_ratio",
        "title": "Rasio Beban Gaji & Upah (SDM)",
        "value": f"{gaji_ratio}%",
        "ideal_range": "15% - 28%",
        "status": g_status,
        "note": g_note,
    })

    # 3. Evaluasi Rasio Sewa Tempat
    sewa_ratio = cost_structure["sewa_ratio"]
    if sewa_ratio == 0:
        s_status = "neutral"
        s_note = "Tidak ada beban sewa dibayarkan pada bulan ini (mungkin pembayaran tahunan/semesteran)."
    elif sewa_ratio <= 12.0:
        s_status = "healthy"
        s_note = f"Porsi beban sewa ({sewa_ratio}%) aman dan proporsional (di bawah 12%)."
    else:
        s_status = "warning"
        s_note = f"Beban sewa ({sewa_ratio}%) memakan porsi signifikan dari operasional bulanan."

    health_evaluation.append({
        "key": "sewa_ratio",
        "title": "Rasio Beban Sewa Tempat",
        "value": f"{sewa_ratio}%",
        "ideal_range": "5% - 12%",
        "status": s_status,
        "note": s_note,
    })

    # 4. Evaluasi Hutang Belanja (Accounts Payable)
    debt_ratio = round((subtotal_kewajiban / total_beban) * 100.0, 1) if total_beban > 0 else 0.0
    if subtotal_kewajiban == 0:
        d_status = "healthy"
        d_note = "Luar biasa! Tidak ada hutang belanja atau tagihan tempo tertunggak saat ini."
    elif debt_ratio <= 20.0:
        d_status = "healthy"
        d_note = f"Kewajiban hutang ({debt_ratio}% dari beban) dalam batas aman likuiditas kas toko."
    else:
        d_status = "danger"
        d_note = f"Terdapat {len(list_hutang)} tagihan belum lunas dengan nominal total Rp {subtotal_kewajiban:,.0f} ({debt_ratio}% dari beban). Prioritaskan pelunasan."

    health_evaluation.append({
        "key": "unpaid_debt",
        "title": "Kewajiban Hutang Belanja (Tempo)",
        "value": f"Rp {subtotal_kewajiban:,.0f}",
        "ideal_range": "< 20% beban",
        "status": d_status,
        "note": d_note,
    })

    analisis = {
        "cost_structure": cost_structure,
        "top_variances_mom": top_variances_mom,
        "health_evaluation": health_evaluation,
    }

    return {
        "ok": True,
        "month": cur_month,
        "month_end": cur_month_end,
        "year": cur_year,
        "month_name": cur_month_name,
        "prev_month_name": prev_month_name,
        "laba_rugi": laba_rugi,
        "neraca": neraca,
        "arus_kas": arus_kas,
        "analisis": analisis,
        "all_accounts": all_account_lines,
    }
