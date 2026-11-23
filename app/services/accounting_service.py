"""
app/services/accounting_service.py — Layanan Laporan & Analisis Akuntansi Standar (SAK EMKM)
Menyajikan laporan Laba Rugi, Posisi Keuangan (Neraca), Arus Kas, dan Analisis Rasio Finansial.
"""
from datetime import datetime, date
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, exists

from app.models.expense import Expense
from app.models.expense_payment import ExpensePayment
from app.models.master_data import MasterDataOption
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction, IncomingTransactionItem
from app.models.bank_transfer import BankTransfer
from app.models.fixed_asset import FixedAsset
from app.services.expense_service import (
    get_monthly_report,
    get_expense_payment_breakdown,
    is_unpaid_or_dp_status,
)
from app.services.master_data_service import get_category_accounting_map, get_master_options
from app.services.bank_account_service import DEFAULT_COA_BY_TYPE, _parse_mappings, normalize_channel_key
from app.services.asset_service import calculate_asset_depreciation
from app.services.menu_product_service import (
    load_all_menus_graph,
    build_master_price_history_map,
    resolve_all_menu_financials,
)

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]

COA_CASH_NAMES: dict[str, str] = {
    "1-1110": "Kas Tunai Kasir",
    "1-1120": "Bank Operasional",
    "1-1121": "E-Wallet & QRIS Settlement",
    "1-1122": "EDC Debit",
    "1-1130": "Saldo Aggregator Platform",
}


def _calc_mom_pct(current: float, previous: float) -> float | None:
    """Hitung persentase kenaikan/penurunan Month-over-Month."""
    if previous <= 0:
        return None
    return round(((current - previous) / previous) * 100.0, 1)


def _classify_expense_group(
    category: str | None,
    item_name: str | None,
    supplier: str | None,
    coa_map: dict[str, dict[str, str | None]],
) -> str:
    """Klasifikasikan transaksi pengeluaran ke HPP, OPEX, ASSET, atau CASH_TRANSFER."""
    kat = (category or "").strip()
    kat_l = kat.lower()
    item_l = (item_name or "").lower()
    sup_l = (supplier or "").lower()

    if kat_l == "tukar cash" or "tukar cash" in item_l or "tarik tunai" in item_l:
        return "CASH_TRANSFER"
    if (
        kat_l == "ongkir"
        or item_l.startswith("ongkir")
        or "ongkir" in item_l
        or any(
            k in sup_l
            for k in (
                "gosend", "gocar", "grabexpress", "lalamove", "maxim",
                "shopee express", "spx", "jne", "j&t", "sicepat", "anteraja",
            )
        )
    ):
        return "HPP"
    if kat_l == "asset":
        return "ASSET"

    coa = coa_map.get(kat, {})
    grp = coa.get("account_group")
    if grp in ("HPP", "OPEX", "ASSET", "CASH_TRANSFER"):
        return str(grp)
    if any(k in kat_l for k in ("bahan", "kemasan", "baku", "topper")):
        return "HPP"
    return "OPEX"


async def _compute_retained_earnings_before(
    db: AsyncSession,
    start_date: date,
    all_fixed_assets: list[FixedAsset],
    coa_map: dict[str, dict[str, str | None]],
) -> float:
    """
    Hitung Laba Ditahan (Retained Earnings) kumulatif untuk seluruh periode sebelum start_date:
    Pendapatan Bersih (< start_date) - Beban Akrual HPP & OPEX (< start_date)
    - Akumulasi Penyusutan & Low-Value Asset (< start_date) - Biaya Admin Transfer (< start_date)
    + Laba/Rugi Pelepasan Aset (< start_date).
    """
    rev_prior_res = await db.execute(
        select(func.coalesce(func.sum(IncomingTransaction.net_received), 0.0)).where(
            and_(
                IncomingTransaction.transaction_date < start_date,
                IncomingTransaction.status == "paid",
            )
        )
    )
    prior_revenue = float(rev_prior_res.scalar() or 0.0)

    exp_prior_res = await db.execute(
        select(
            Expense.category,
            Expense.item_name,
            Expense.supplier,
            Expense.total_price,
            Expense.shipping_fee,
        ).where(Expense.expense_date < start_date)
    )
    prior_expense_total = 0.0
    for cat, item_name, sup, tot_price, ship_fee in exp_prior_res.fetchall():
        grp = _classify_expense_group(cat, item_name, sup, coa_map)
        if grp in ("HPP", "OPEX"):
            prior_expense_total += float(tot_price or 0.0)
        elif grp != "CASH_TRANSFER" and float(ship_fee or 0.0) > 0:
            prior_expense_total += float(ship_fee or 0.0)

    # Hitung bulan sebelum start_date untuk akumulasi penyusutan aset tetap
    if start_date.month == 1:
        prior_y, prior_m = start_date.year - 1, 12
    else:
        prior_y, prior_m = start_date.year, start_date.month - 1
    prior_ym = prior_y * 12 + prior_m

    prior_asset_expense = 0.0
    for ast in all_fixed_assets:
        p_date = ast.purchase_date
        if not p_date or p_date >= start_date:
            continue
        if (
            ast.capitalization_status == "expensed_low_value"
            or ast.depreciation_method == "immediate_expense"
        ):
            prior_asset_expense += float(ast.acquisition_cost or 0.0)
        else:
            calc_prior = calculate_asset_depreciation(ast, prior_y, prior_m)
            # Jika aset sudah dilepas sebelum start_date, hitung gain/loss pelepasan & akumulasi penyusutannya
            if ast.disposed_at and (ast.disposed_at.year * 12 + ast.disposed_at.month) <= prior_ym:
                disp_calc = calculate_asset_depreciation(
                    ast, ast.disposed_at.year, ast.disposed_at.month
                )
                # Total beban bersih atas aset yang dilepas = harga perolehan - hasil penjualan
                prior_asset_expense += float(ast.acquisition_cost or 0.0) - float(
                    ast.disposal_proceeds or 0.0
                )
            else:
                prior_asset_expense += float(calc_prior["accumulated_depreciation"] or 0.0)

    tr_fee_prior_res = await db.execute(
        select(func.coalesce(func.sum(BankTransfer.admin_fee), 0.0)).where(
            BankTransfer.transfer_date < start_date
        )
    )
    prior_transfer_fee = float(tr_fee_prior_res.scalar() or 0.0)

    return round(prior_revenue - prior_expense_total - prior_asset_expense - prior_transfer_fee, 2)


async def _compute_theoretical_vs_actual_hpp(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    actual_hpp: float,
) -> dict[str, Any]:
    """
    Hitung HPP Teoritis dari kuantitas produk terjual (IncomingTransactionItem pada transaksi 'paid')
    dikalikan dengan effective_hpp resep/produk dari MenuProduct, lalu bandingkan dengan actual_hpp.
    """
    menus_by_id = await load_all_menus_graph(db)
    if not menus_by_id:
        return {
            "theoretical_hpp": 0.0,
            "actual_hpp": round(actual_hpp, 2),
            "variance_nominal": round(actual_hpp, 2),
            "variance_pct": None,
            "matched_menu_count": 0,
            "unmatched_item_count": 0,
            "matched_qty_total": 0.0,
            "top_menu_costs": [],
            "status": "no_menu_data",
            "note": "Belum ada data resep/HPP menu di katalog produk untuk menghitung HPP teoritis.",
        }

    price_history_map = await build_master_price_history_map(db)
    financials_by_id = resolve_all_menu_financials(menus_by_id, price_history_map)

    menu_hpp_by_name: dict[str, tuple[str, float]] = {}
    for mid, menu in menus_by_id.items():
        fin = financials_by_id.get(mid, {})
        eff_hpp = float(fin.get("effective_hpp") or 0.0)
        clean_name = (menu.name or "").strip().lower()
        if clean_name:
            menu_hpp_by_name[clean_name] = (menu.name, eff_hpp)
        anon_name = (getattr(menu, "anonymous_name", None) or "").strip().lower()
        if anon_name and anon_name not in menu_hpp_by_name:
            menu_hpp_by_name[anon_name] = (menu.name, eff_hpp)

    sold_items_res = await db.execute(
        select(
            IncomingTransactionItem.product_name,
            func.coalesce(func.sum(IncomingTransactionItem.qty), 0.0),
            func.coalesce(
                func.sum(
                    IncomingTransactionItem.gross_amount - IncomingTransactionItem.discount_amount
                ),
                0.0,
            ),
        )
        .join(
            IncomingTransaction,
            IncomingTransactionItem.transaction_id == IncomingTransaction.id,
        )
        .where(
            and_(
                IncomingTransaction.transaction_date >= start_date,
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
            )
        )
        .group_by(IncomingTransactionItem.product_name)
    )

    theoretical_hpp = 0.0
    matched_menus: set[str] = set()
    unmatched_items: set[str] = set()
    matched_qty_total = 0.0
    menu_cost_rows: list[dict[str, Any]] = []

    for prod_name, total_qty, net_sales_val in sold_items_res.fetchall():
        raw_name = (prod_name or "").strip()
        if not raw_name:
            continue
        qty_f = float(total_qty or 0.0)
        if qty_f <= 0:
            continue
        key = raw_name.lower()
        matched_entry = menu_hpp_by_name.get(key)

        if matched_entry is not None:
            canon_name, unit_hpp = matched_entry
            line_theo_hpp = round(qty_f * unit_hpp, 2)
            theoretical_hpp += line_theo_hpp
            matched_menus.add(key)
            matched_qty_total += qty_f
            menu_cost_rows.append({
                "product_name": canon_name,
                "qty_sold": round(qty_f, 2),
                "unit_hpp": round(unit_hpp, 2),
                "total_theoretical_hpp": line_theo_hpp,
                "net_sales": round(float(net_sales_val or 0.0), 2),
            })
        else:
            unmatched_items.add(key)

    theoretical_hpp = round(theoretical_hpp, 2)
    actual_hpp_rounded = round(actual_hpp, 2)
    variance_nominal = round(actual_hpp_rounded - theoretical_hpp, 2)
    variance_pct = (
        round((variance_nominal / theoretical_hpp) * 100.0, 1)
        if theoretical_hpp > 0
        else None
    )

    menu_cost_rows.sort(key=lambda x: -x["total_theoretical_hpp"])

    if theoretical_hpp == 0:
        v_status = "no_sales_match"
        v_note = (
            "Belum ada item penjualan yang terhubung ke resep HPP menu pada periode ini."
            if not unmatched_items
            else f"Terdapat {len(unmatched_items)} produk terjual yang belum dipetakan ke database resep menu."
        )
    elif abs(variance_pct or 0.0) <= 10.0:
        v_status = "aligned"
        v_note = (
            f"Belanja bahan aktual selaras dengan HPP teoritis resep (selisih {variance_pct:+}%)."
        )
    elif variance_nominal > 0:
        v_status = "surplus_purchase"
        v_note = (
            f"Belanja HPP aktual lebih tinggi Rp {variance_nominal:,.0f} (+{variance_pct}%) dibanding HPP teoritis penjualan. "
            "Mengindikasikan penambahan stok bahan di gudang (restock) atau potensi susut/waste produksi."
        )
    else:
        v_status = "stock_drawdown"
        v_note = (
            f"Belanja HPP aktual lebih rendah Rp {abs(variance_nominal):,.0f} ({variance_pct}%) dibanding HPP teoritis penjualan. "
            "Produksi bulan ini sebagian menggunakan sisa stok bahan baku dari periode sebelumnya."
        )

    return {
        "theoretical_hpp": theoretical_hpp,
        "actual_hpp": actual_hpp_rounded,
        "variance_nominal": variance_nominal,
        "variance_pct": variance_pct,
        "matched_menu_count": len(matched_menus),
        "unmatched_item_count": len(unmatched_items),
        "matched_qty_total": round(matched_qty_total, 2),
        "top_menu_costs": menu_cost_rows[:10],
        "status": v_status,
        "note": v_note,
    }


async def get_accounting_report(
    db: AsyncSession,
    year: int,
    month: int,
    month_end: int | None = None,
) -> dict[str, Any]:
    """
    Kompilasi laporan dan analisis akuntansi lengkap standar SAK EMKM:
    1. Laporan Laba Rugi (Akrual: Pendapatan Usaha, HPP & Beban Operasional OPEX)
    2. Laporan Posisi Keuangan / Neraca Point-in-Time (Aset Lancar Saldo Kas/Bank s/d akhir periode, Aset Tetap, Kewajiban, & Ekuitas dengan Laba Ditahan)
    3. Laporan Arus Kas Riil (Aktivitas Operasi, Investasi Capex, dan Kliring Kas berdasarkan aliran kas aktual)
    4. Analisis Rasio Finansial Strategis (terhadap Net Revenue & Total Beban), Variansi HPP Teoritis vs Aktual, dan Evaluasi Kesehatan Bisnis
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

    # Ambil laporan belanja periode ini (akrual penuh per_kategori)
    cur_report = await get_monthly_report(db, cur_year, cur_month, month_end=cur_month_end)

    # Ambil master options dan COA
    kategori_options = await get_master_options(db, opt_type="kategori", active_only=True)
    coa_map = await get_category_accounting_map(db)

    # Rentang tanggal periode laporan [start_date, end_date)
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

    # Ambil data pengeluaran akrual periode ini
    cur_per_kat = cur_report.get("per_kategori", {})
    prev_per_kat = prev_report.get("per_kategori", {})
    cur_ongkir = float(cur_report.get("total_ongkir", 0.0))
    prev_ongkir = float(prev_report.get("total_ongkir", 0.0))
    cur_tukar_cash = float(cur_report.get("total_tukar_cash", 0.0))
    prev_tukar_cash = float(prev_report.get("total_tukar_cash", 0.0))

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
            group = coa.get("account_group") or (
                "HPP" if any(k in cat_name.lower() for k in ("bahan", "kemasan", "baku")) else "OPEX"
            )
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

        # Untuk rentang multi-bulan, jumlahkan beban penyusutan & low value di setiap bulan dalam rentang
        for m_cursor in range(cur_month, cur_month_end + 1):
            m_calc = calculate_asset_depreciation(ast, cur_year, m_cursor)
            cur_dep_expense += m_calc["depreciation_in_period"]
            cur_low_value_expense += m_calc["immediate_expense_in_period"]
            cur_disposal_gain_loss += m_calc["disposal_gain_loss_in_period"]

        prev_m_end = cur_month_end if cur_month_end != cur_month else prev_month
        for pm_cursor in range(prev_month, prev_m_end + 1):
            pm_calc = calculate_asset_depreciation(ast, prev_year, pm_cursor)
            prev_dep_expense += pm_calc["depreciation_in_period"]
            prev_low_value_expense += pm_calc["immediate_expense_in_period"]
            prev_disposal_gain_loss += pm_calc["disposal_gain_loss_in_period"]

        # Posisi Neraca Aset Tetap adalah point-in-time pada akhir periode (cur_year, cur_month_end)
        end_calc = calculate_asset_depreciation(ast, cur_year, cur_month_end)
        cur_gross_fixed_asset += end_calc["gross_balance_sheet_cost"]
        cur_accum_dep += end_calc["accumulated_depreciation"]

        if end_calc["is_owned_in_period"] and not end_calc["is_disposed_as_of"]:
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

    # Biaya admin transfer antar rekening pada periode berjalan & periode pembanding
    prev_start_date = date(prev_year, prev_month, 1)
    prev_end_date = (
        start_date
        if cur_month_end == cur_month
        else (date(prev_year + 1, 1, 1) if cur_month_end == 12 else date(prev_year, cur_month_end + 1, 1))
    )

    tr_fee_cur_res = await db.execute(
        select(
            func.count(BankTransfer.id),
            func.coalesce(func.sum(BankTransfer.admin_fee), 0.0),
        ).where(
            and_(
                BankTransfer.transfer_date >= start_date,
                BankTransfer.transfer_date < end_date,
                BankTransfer.admin_fee > 0,
            )
        )
    )
    tr_fee_cur_row = tr_fee_cur_res.fetchone()
    cur_transfer_fee_count = int(tr_fee_cur_row[0] or 0) if tr_fee_cur_row else 0
    cur_transfer_fee = round(float(tr_fee_cur_row[1] or 0.0), 2) if tr_fee_cur_row else 0.0

    tr_fee_prev_res = await db.execute(
        select(func.coalesce(func.sum(BankTransfer.admin_fee), 0.0)).where(
            and_(
                BankTransfer.transfer_date >= prev_start_date,
                BankTransfer.transfer_date < prev_end_date,
                BankTransfer.admin_fee > 0,
            )
        )
    )
    prev_transfer_fee = round(float(tr_fee_prev_res.scalar() or 0.0), 2)

    if cur_transfer_fee > 0 or prev_transfer_fee > 0:
        all_account_lines.append({
            "account_code": "6-2300",
            "account_name": "Beban Administrasi Bank & Transfer",
            "category": "Biaya Admin Bank",
            "account_group": "OPEX",
            "report_type": "LABA_RUGI",
            "total": cur_transfer_fee,
            "prev_total": prev_transfer_fee,
            "diff_nominal": round(cur_transfer_fee - prev_transfer_fee, 2),
            "mom_change_pct": _calc_mom_pct(cur_transfer_fee, prev_transfer_fee),
            "transaction_count": cur_transfer_fee_count,
            "description": "Biaya admin mutasi/transfer antar rekening bank",
        })

    all_account_lines.sort(key=lambda x: (x["account_code"], x["category"]))

    # ─────────────────────────────────────────────────────────────
    # 1. LAPORAN LABA RUGI (PENDAPATAN USAHA & BEBAN USAHA)
    # ─────────────────────────────────────────────────────────────
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
    subtotal_hpp = round(sum(item["total"] for item in hpp_items), 2)
    prev_subtotal_hpp = round(sum(item["prev_total"] for item in hpp_items), 2)
    mom_hpp_pct = _calc_mom_pct(subtotal_hpp, prev_subtotal_hpp)

    opex_items: list[dict[str, Any]] = [
        item for item in all_account_lines
        if item["account_group"] == "OPEX"
    ]
    subtotal_opex = round(sum(item["total"] for item in opex_items), 2)
    prev_subtotal_opex = round(sum(item["prev_total"] for item in opex_items), 2)
    mom_opex_pct = _calc_mom_pct(subtotal_opex, prev_subtotal_opex)

    total_beban = round(subtotal_hpp + subtotal_opex, 2)
    prev_total_beban = round(prev_subtotal_hpp + prev_subtotal_opex, 2)
    mom_beban_pct = _calc_mom_pct(total_beban, prev_total_beban)

    gross_profit = round(revenue_net - subtotal_hpp, 2)
    net_profit = round(revenue_net - total_beban + round(cur_disposal_gain_loss, 2), 2)
    prev_net_profit = round(prev_revenue_net - prev_total_beban + round(prev_disposal_gain_loss, 2), 2)

    gross_margin_pct = round((gross_profit / revenue_net) * 100.0, 1) if revenue_net > 0 else None
    net_margin_pct = round((net_profit / revenue_net) * 100.0, 1) if revenue_net > 0 else None

    # Tambahkan proporsi persentase ke masing-masing item Laba Rugi (terhadap grup, total beban, dan net revenue)
    for item in hpp_items:
        item["percentage_of_group"] = round((item["total"] / subtotal_hpp) * 100.0, 1) if subtotal_hpp > 0 else 0.0
        item["percentage_of_total_expense"] = round((item["total"] / total_beban) * 100.0, 1) if total_beban > 0 else 0.0
        item["percentage_of_revenue"] = round((item["total"] / revenue_net) * 100.0, 1) if revenue_net > 0 else None

    for item in opex_items:
        item["percentage_of_group"] = round((item["total"] / subtotal_opex) * 100.0, 1) if subtotal_opex > 0 else 0.0
        item["percentage_of_total_expense"] = round((item["total"] / total_beban) * 100.0, 1) if total_beban > 0 else 0.0
        item["percentage_of_revenue"] = round((item["total"] / revenue_net) * 100.0, 1) if revenue_net > 0 else None

    laba_rugi = {
        "paid_tx_count": paid_tx_count,
        "revenue_gross": revenue_gross,
        "revenue_discount": revenue_discount,
        "revenue_platform_fee": revenue_platform_fee,
        "revenue_net": revenue_net,
        "prev_revenue_net": prev_revenue_net,
        "mom_revenue_change_pct": mom_revenue_pct,
        "gross_profit": gross_profit,
        "gross_margin_pct": gross_margin_pct,
        "net_profit": net_profit,
        "net_margin_pct": net_margin_pct,
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
    # 2. LAPORAN POSISI KEUANGAN / NERACA POINT-IN-TIME (< end_date)
    # ─────────────────────────────────────────────────────────────
    bank_accs_res = await db.execute(
        select(BankAccount)
        .where(BankAccount.is_active == True)  # noqa: E712
        .order_by(BankAccount.sort_order.asc(), BankAccount.id.asc())
    )
    bank_accounts = list(bank_accs_res.scalars().all())

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

    # A. Uang masuk lunas bulan ini & kumulatif s/d akhir periode (< end_date)
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

    inc_cutoff_res = await db.execute(
        select(
            IncomingTransaction.bank_account_id,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        )
        .where(
            and_(
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
                IncomingTransaction.bank_account_id.is_not(None),
            )
        )
        .group_by(IncomingTransaction.bank_account_id)
    )
    inc_cutoff_map = {int(r[0]): float(r[1] or 0.0) for r in inc_cutoff_res.fetchall()}

    inc_month_unassigned_res = await db.execute(
        select(
            IncomingTransaction.payment_method,
            IncomingTransaction.order_type,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        )
        .where(
            and_(
                IncomingTransaction.transaction_date >= start_date,
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
                IncomingTransaction.bank_account_id.is_(None),
            )
        )
        .group_by(IncomingTransaction.payment_method, IncomingTransaction.order_type)
    )
    for pm_name, ot_name, amt in inc_month_unassigned_res.fetchall():
        matched_id = match_account_by_method(pm_name, ot_name)
        if matched_id is not None:
            inc_month_map[matched_id] = inc_month_map.get(matched_id, 0.0) + float(amt or 0.0)

    inc_cutoff_unassigned_res = await db.execute(
        select(
            IncomingTransaction.payment_method,
            IncomingTransaction.order_type,
            func.coalesce(func.sum(IncomingTransaction.net_received), 0.0),
        )
        .where(
            and_(
                IncomingTransaction.transaction_date < end_date,
                IncomingTransaction.status == "paid",
                IncomingTransaction.bank_account_id.is_(None),
            )
        )
        .group_by(IncomingTransaction.payment_method, IncomingTransaction.order_type)
    )
    for pm_name, ot_name, amt in inc_cutoff_unassigned_res.fetchall():
        matched_id = match_account_by_method(pm_name, ot_name)
        if matched_id is not None:
            inc_cutoff_map[matched_id] = inc_cutoff_map.get(matched_id, 0.0) + float(amt or 0.0)

    has_payment_subq = exists(
        select(ExpensePayment.id).where(ExpensePayment.expense_id == Expense.id)
    )

    # B. Pengeluaran kas keluar bulan ini per rekening
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

    # C. Transfer antar rekening kumulatif s/d akhir periode (< end_date)
    tr_in_cutoff_res = await db.execute(
        select(BankTransfer.to_account_id, func.coalesce(func.sum(BankTransfer.amount), 0.0))
        .where(BankTransfer.transfer_date < end_date)
        .group_by(BankTransfer.to_account_id)
    )
    tr_in_cutoff = {int(r[0]): float(r[1] or 0.0) for r in tr_in_cutoff_res.fetchall()}

    tr_out_cutoff_res = await db.execute(
        select(BankTransfer.from_account_id, func.coalesce(func.sum(BankTransfer.amount + BankTransfer.admin_fee), 0.0))
        .where(BankTransfer.transfer_date < end_date)
        .group_by(BankTransfer.from_account_id)
    )
    tr_out_cutoff = {int(r[0]): float(r[1] or 0.0) for r in tr_out_cutoff_res.fetchall()}

    # D. Pengeluaran kas keluar kumulatif per rekening s/d akhir periode (< end_date)
    exp_cutoff_res = await db.execute(
        select(
            Expense.bank_account_id,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            and_(
                Expense.expense_date < end_date,
                Expense.bank_account_id.is_not(None),
                Expense.pay_status == "Lunas",
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
        .group_by(Expense.bank_account_id)
    )
    exp_cutoff_map = {int(r[0]): float(r[1] or 0.0) for r in exp_cutoff_res.fetchall()}

    exp_cutoff_unassigned_res = await db.execute(
        select(
            Expense.pay_method,
            func.coalesce(func.sum(Expense.total_price), 0.0),
        )
        .where(
            and_(
                Expense.expense_date < end_date,
                Expense.bank_account_id.is_(None),
                Expense.pay_status == "Lunas",
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
        .group_by(Expense.pay_method)
    )
    for m_name, amt in exp_cutoff_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            exp_cutoff_map[matched_id] = exp_cutoff_map.get(matched_id, 0.0) + float(amt or 0.0)

    effective_ep_cutoff_id = func.coalesce(ExpensePayment.bank_account_id, Expense.bank_account_id)
    ep_cutoff_res = await db.execute(
        select(
            effective_ep_cutoff_id,
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(
            and_(
                ExpensePayment.payment_date < end_date,
                effective_ep_cutoff_id.is_not(None),
            )
        )
        .group_by(effective_ep_cutoff_id)
    )
    for aid, amt in ep_cutoff_res.fetchall():
        exp_cutoff_map[int(aid)] = exp_cutoff_map.get(int(aid), 0.0) + float(amt or 0.0)

    ep_cutoff_unassigned_res = await db.execute(
        select(
            func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(
            and_(
                ExpensePayment.payment_date < end_date,
                effective_ep_cutoff_id.is_(None),
            )
        )
        .group_by(func.coalesce(ExpensePayment.pay_method, Expense.pay_method))
    )
    for m_name, amt in ep_cutoff_unassigned_res.fetchall():
        matched_id = match_account_by_method(m_name)
        if matched_id is not None:
            exp_cutoff_map[matched_id] = exp_cutoff_map.get(matched_id, 0.0) + float(amt or 0.0)

    rekening_positions: list[dict[str, Any]] = []
    coa_balance_buckets: dict[str, dict[str, Any]] = {}

    for acc in bank_accounts:
        in_m = round(inc_month_map.get(acc.id, 0.0), 2)
        out_m = round(out_month_map.get(acc.id, 0.0), 2)
        in_cut = inc_cutoff_map.get(acc.id, 0.0)
        exp_cut = exp_cutoff_map.get(acc.id, 0.0)
        t_in = tr_in_cutoff.get(acc.id, 0.0)
        t_out = tr_out_cutoff.get(acc.id, 0.0)
        est_bal = round(float(acc.opening_balance or 0.0) + in_cut + t_in - t_out - exp_cut, 2)
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
            "net_month_flow": round(in_m - out_m, 2),
            "estimated_balance": est_bal,
        })

        if coa_code not in coa_balance_buckets:
            coa_balance_buckets[coa_code] = {
                "account_code": coa_code,
                "account_name": COA_CASH_NAMES.get(coa_code, f"Kas & Bank ({acc.name})"),
                "nominal": 0.0,
                "acc_names": [],
            }
        coa_balance_buckets[coa_code]["nominal"] = round(
            coa_balance_buckets[coa_code]["nominal"] + est_bal, 2
        )
        coa_balance_buckets[coa_code]["acc_names"].append(acc.name)

    aset_lancar: list[dict[str, Any]] = []
    if coa_balance_buckets:
        for code in sorted(coa_balance_buckets.keys()):
            b = coa_balance_buckets[code]
            names_str = ", ".join(b["acc_names"])
            aset_lancar.append({
                "account_code": code,
                "account_name": b["account_name"],
                "group": "ASET_LANCAR",
                "nominal": b["nominal"],
                "description": f"Saldo posisi kas/bank s/d akhir {cur_month_name} {cur_year} ({names_str})",
            })
    else:
        # Fallback apabila belum ada BankAccount yang disetup: hitung posisi kas kumulatif keseluruhan s/d < end_date
        total_inc_cut = sum(inc_cutoff_map.values())
        if total_inc_cut == 0:
            raw_inc_cut = await db.execute(
                select(func.coalesce(func.sum(IncomingTransaction.net_received), 0.0)).where(
                    and_(
                        IncomingTransaction.transaction_date < end_date,
                        IncomingTransaction.status == "paid",
                    )
                )
            )
            total_inc_cut = float(raw_inc_cut.scalar() or 0.0)

        raw_exp_cut = await db.execute(
            select(func.coalesce(func.sum(Expense.total_price), 0.0)).where(
                and_(
                    Expense.expense_date < end_date,
                    Expense.pay_status == "Lunas",
                    ~has_payment_subq,
                    ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
                )
            )
        )
        raw_ep_cut = await db.execute(
            select(func.coalesce(func.sum(ExpensePayment.amount), 0.0)).where(
                ExpensePayment.payment_date < end_date
            )
        )
        raw_fee_cut = await db.execute(
            select(func.coalesce(func.sum(BankTransfer.admin_fee), 0.0)).where(
                BankTransfer.transfer_date < end_date
            )
        )
        total_out_cut = (
            float(raw_exp_cut.scalar() or 0.0)
            + float(raw_ep_cut.scalar() or 0.0)
            + float(raw_fee_cut.scalar() or 0.0)
        )
        fallback_cash_bal = round(total_inc_cut - total_out_cut, 2)
        aset_lancar.append({
            "account_code": "1-1110",
            "account_name": "Kas & Bank Operasional (Kumulatif)",
            "group": "ASET_LANCAR",
            "nominal": fallback_cash_bal,
            "description": f"Estimasi posisi kas/bank bersih s/d akhir {cur_month_name} {cur_year}",
        })

    subtotal_aset_lancar = round(sum(i["nominal"] for i in aset_lancar), 2)

    # Aset Tetap (Peralatan & Mesin - Nilai Perolehan & Akumulasi Penyusutan SAK EMKM per < end_date)
    asset_line = next((item for item in all_account_lines if item["category"] == "Asset"), None)
    asset_month_total = float(asset_line["total"]) if asset_line else 0.0

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

    total_aset = round(subtotal_aset_lancar + subtotal_aset_tetap, 2)

    # Kewajiban Lancar Point-in-Time (< end_date):
    # 1. Hutang Usaha (2-1110): Seluruh belanja s/d < end_date yang masih memiliki sisa hutang per < end_date
    ep_paid_before_end_res = await db.execute(
        select(
            ExpensePayment.expense_id,
            func.coalesce(func.sum(ExpensePayment.amount), 0.0),
        )
        .where(
            and_(
                ExpensePayment.payment_date < end_date,
                ExpensePayment.payment_type != "reimbursement",
            )
        )
        .group_by(ExpensePayment.expense_id)
    )
    ep_paid_before_end_map: dict[int, float] = {
        int(r[0]): float(r[1] or 0.0) for r in ep_paid_before_end_res.fetchall() if r[0] is not None
    }

    all_ep_exists_res = await db.execute(
        select(ExpensePayment.expense_id)
        .where(ExpensePayment.payment_type != "reimbursement")
        .distinct()
    )
    expenses_with_payments_set = {
        int(r[0]) for r in all_ep_exists_res.fetchall() if r[0] is not None
    }

    cand_unpaid_res = await db.execute(
        select(Expense)
        .where(Expense.expense_date < end_date)
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
    )
    list_hutang_cutoff: list[dict[str, Any]] = []
    for e in cand_unpaid_res.scalars().all():
        grp = _classify_expense_group(e.category, e.item_name, e.supplier, coa_map)
        if grp == "CASH_TRANSFER":
            continue
        total_val = max(0.0, float(e.total_price or 0.0))
        if total_val <= 0:
            continue

        if e.id in expenses_with_payments_set:
            paid_as_of = min(total_val, max(0.0, ep_paid_before_end_map.get(e.id, 0.0)))
            rem_as_of = round(max(0.0, total_val - paid_as_of), 2)
            if rem_as_of > 0:
                list_hutang_cutoff.append({
                    "id": e.id,
                    "barang": e.item_name,
                    "supplier": e.supplier or "-",
                    "nominal": rem_as_of,
                    "total_invoice": total_val,
                    "paid_amount": round(paid_as_of, 2),
                    "tempo": e.due_date or "-",
                    "tanggal": str(e.expense_date),
                    "kategori": e.category or "Lainnya",
                    "status": "DP / Sebagian" if paid_as_of > 0 else "Belum Lunas",
                })
        elif is_unpaid_or_dp_status(e.pay_status):
            tot_v, paid_v, rem_v, _ = get_expense_payment_breakdown(e)
            if rem_v > 0:
                list_hutang_cutoff.append({
                    "id": e.id,
                    "barang": e.item_name,
                    "supplier": e.supplier or "-",
                    "nominal": round(rem_v, 2),
                    "total_invoice": round(tot_v, 2),
                    "paid_amount": round(paid_v, 2),
                    "tempo": e.due_date or "-",
                    "tanggal": str(e.expense_date),
                    "kategori": e.category or "Lainnya",
                    "status": e.pay_status or "Belum Lunas",
                })

    subtotal_hutang_usaha = round(sum(float(item.get("nominal", 0.0)) for item in list_hutang_cutoff), 2)

    # 2. Hutang Talangan / Reimbursement (2-1120) per < end_date:
    # Transaksi talangan dengan expense_date < end_date yang belum diganti atau baru diganti pada/setelah end_date
    end_datetime = datetime.combine(end_date, datetime.min.time())
    reimb_res = await db.execute(
        select(
            func.count(Expense.id),
            func.coalesce(func.sum(Expense.total_price), 0.0),
        ).where(
            and_(
                Expense.expense_date < end_date,
                Expense.is_reimbursement == True,  # noqa: E712
                or_(
                    Expense.reimbursed_at.is_(None),
                    Expense.reimbursed_at >= end_datetime,
                ),
            )
        )
    )
    reimb_row = reimb_res.fetchone()
    reimb_count = int(reimb_row[0] or 0) if reimb_row else 0
    subtotal_hutang_talangan = round(float(reimb_row[1] or 0.0), 2) if reimb_row else 0.0

    subtotal_kewajiban = round(subtotal_hutang_usaha + subtotal_hutang_talangan, 2)
    kewajiban_lancar = [
        {
            "account_code": "2-1110",
            "account_name": "Hutang Usaha / Belanja Tempo",
            "group": "KEWAJIBAN",
            "nominal": subtotal_hutang_usaha,
            "description": f"{len(list_hutang_cutoff)} transaksi belanja belum lunas / tempo ke supplier s/d {cur_month_name} {cur_year}",
        },
        {
            "account_code": "2-1120",
            "account_name": "Hutang Talangan / Reimbursement",
            "group": "KEWAJIBAN",
            "nominal": subtotal_hutang_talangan,
            "description": f"{reimb_count} transaksi talangan staf/owner yang belum diganti s/d {cur_month_name} {cur_year}",
        },
    ]

    # Ekuitas (Modal Awal Rekening + Laba Ditahan Periode Sebelumnya + Laba/Rugi Bersih Berjalan)
    modal_awal_rekening = round(sum(float(acc.opening_balance or 0.0) for acc in bank_accounts), 2)
    retained_earnings_prior = await _compute_retained_earnings_before(
        db, start_date, all_fixed_assets, coa_map
    )

    ekuitas = [
        {
            "account_code": "3-1100",
            "account_name": "Modal Awal & Saldo Awal Rekening",
            "group": "EKUITAS",
            "nominal": modal_awal_rekening,
            "description": f"Akumulasi saldo awal dari {len(bank_accounts)} rekening aktif",
        },
        {
            "account_code": "3-2000",
            "account_name": f"Laba Ditahan (Retained Earnings s/d sebelum {cur_month_name} {cur_year})",
            "group": "EKUITAS",
            "nominal": retained_earnings_prior,
            "description": "Akumulasi laba/rugi bersih historis sebelum periode laporan berjalan",
        },
        {
            "account_code": "3-2100",
            "account_name": f"Laba / Rugi Bersih ({cur_month_name} {cur_year})",
            "group": "EKUITAS",
            "nominal": net_profit,
            "description": "Pendapatan bersih dikurangi total beban usaha (HPP + OPEX) periode berjalan",
        },
    ]
    subtotal_ekuitas = round(modal_awal_rekening + retained_earnings_prior + net_profit, 2)

    neraca = {
        "aset_lancar": aset_lancar,
        "subtotal_aset_lancar": subtotal_aset_lancar,
        "rekening_positions": rekening_positions,
        "total_rekening_balance": round(sum(r["estimated_balance"] for r in rekening_positions), 2),
        "aset_tetap": aset_tetap,
        "aset_tetap_summary": aset_tetap_summary,
        "subtotal_aset_tetap": subtotal_aset_tetap,
        "total_aset": total_aset,
        "kewajiban_lancar": kewajiban_lancar,
        "subtotal_kewajiban": subtotal_kewajiban,
        "detail_hutang": list_hutang_cutoff,
        "ekuitas": ekuitas,
        "subtotal_ekuitas": subtotal_ekuitas,
    }

    # ─────────────────────────────────────────────────────────────
    # 3. LAPORAN ARUS KAS RIIL (ACTUAL CASH FLOW STATEMENT)
    # ─────────────────────────────────────────────────────────────
    # Hitung pengeluaran kas riil pada periode [start_date, end_date) berdasarkan klasifikasi HPP, OPEX, ASSET, dan Kliring:
    # 1. Pengeluaran langsung Lunas (tanpa record ExpensePayment dan bukan talangan yang belum diganti)
    direct_cash_exp_res = await db.execute(
        select(
            Expense.category,
            Expense.item_name,
            Expense.supplier,
            Expense.pay_method,
            Expense.total_price,
            Expense.shipping_fee,
            Expense.id,
        ).where(
            and_(
                Expense.expense_date >= start_date,
                Expense.expense_date < end_date,
                Expense.pay_status == "Lunas",
                ~has_payment_subq,
                ~and_(Expense.is_reimbursement == True, Expense.reimbursed_at.is_(None)),  # noqa: E712
            )
        )
    )

    low_value_exp_ids = {
        ast.expense_id
        for ast in all_fixed_assets
        if ast.expense_id is not None
        and (
            ast.capitalization_status == "expensed_low_value"
            or ast.depreciation_method == "immediate_expense"
        )
    }

    cash_out_hpp = 0.0
    cash_out_opex = 0.0
    cash_out_capex = 0.0
    cash_out_kliring = 0.0
    cash_metode_map: dict[str, float] = {}

    def _add_cash_out(grp: str, exp_id: int | None, amount: float, method_name: str | None) -> None:
        nonlocal cash_out_hpp, cash_out_opex, cash_out_capex, cash_out_kliring
        if amount <= 0:
            return
        m_clean = (method_name or "Tunai").strip() or "Tunai"
        cash_metode_map[m_clean] = cash_metode_map.get(m_clean, 0.0) + amount

        if grp == "CASH_TRANSFER":
            cash_out_kliring += amount
        elif grp == "HPP":
            cash_out_hpp += amount
        elif grp == "ASSET":
            if exp_id is not None and exp_id in low_value_exp_ids:
                cash_out_opex += amount
            else:
                cash_out_capex += amount
        else:
            cash_out_opex += amount

    for cat, item_name, sup, pay_m, tot_price, ship_fee, exp_id in direct_cash_exp_res.fetchall():
        grp = _classify_expense_group(cat, item_name, sup, coa_map)
        amt = float(tot_price or 0.0)
        ship = float(ship_fee or 0.0)
        if grp not in ("HPP", "CASH_TRANSFER") and ship > 0 and amt >= ship:
            _add_cash_out("HPP", exp_id, ship, pay_m)
            _add_cash_out(grp, exp_id, amt - ship, pay_m)
        else:
            _add_cash_out(grp, exp_id, amt, pay_m)

    # 2. Pembayaran DP, termin, pelunasan tempo, COD, dan penggantian talangan pada periode [start_date, end_date)
    ep_cash_res = await db.execute(
        select(
            ExpensePayment.amount,
            func.coalesce(ExpensePayment.pay_method, Expense.pay_method),
            Expense.category,
            Expense.item_name,
            Expense.supplier,
            Expense.id,
        )
        .join(Expense, ExpensePayment.expense_id == Expense.id, isouter=True)
        .where(
            and_(
                ExpensePayment.payment_date >= start_date,
                ExpensePayment.payment_date < end_date,
            )
        )
    )
    for ep_amt, ep_method, cat, item_name, sup, exp_id in ep_cash_res.fetchall():
        grp = _classify_expense_group(cat, item_name, sup, coa_map)
        _add_cash_out(grp, exp_id, float(ep_amt or 0.0), ep_method)

    # 3. Biaya admin transfer antar rekening pada periode berjalan
    if cur_transfer_fee > 0:
        _add_cash_out("OPEX", None, cur_transfer_fee, "Transfer")

    cash_out_hpp = round(cash_out_hpp, 2)
    cash_out_opex = round(cash_out_opex, 2)
    cash_out_capex = round(cash_out_capex, 2)
    cash_out_kliring = round(cash_out_kliring, 2)

    cash_total_operasi = round(cash_out_hpp + cash_out_opex, 2)
    arus_operasi = [
        {
            "activity": "Pengeluaran Kas untuk Pembelian Bahan Baku & HPP",
            "account_name": "Harga Pokok Penjualan (Kas)",
            "nominal": cash_out_hpp,
            "percentage": round((cash_out_hpp / cash_total_operasi) * 100.0, 1) if cash_total_operasi > 0 else 0.0,
        },
        {
            "activity": "Pengeluaran Kas untuk Operasional, Gaji, Sewa, & Utilitas",
            "account_name": "Beban Operasional (OPEX Kas)",
            "nominal": cash_out_opex,
            "percentage": round((cash_out_opex / cash_total_operasi) * 100.0, 1) if cash_total_operasi > 0 else 0.0,
        },
    ]
    subtotal_arus_operasi = cash_total_operasi

    arus_investasi = [
        {
            "activity": "Pengeluaran Kas untuk Pembelian Aset Tetap & Peralatan (Capex Bulan Ini)",
            "account_name": "Belanja Modal (Capex)",
            "nominal": cash_out_capex,
            "percentage": 100.0 if cash_out_capex > 0 else 0.0,
        }
    ]
    subtotal_arus_investasi = cash_out_capex

    arus_kliring = [
        {
            "activity": "Penukaran Kas / Kliring Titip Tarik Tunai Kasir",
            "account_name": "Kas Kliring (Tukar Cash)",
            "nominal": cash_out_kliring,
            "percentage": 100.0 if cash_out_kliring > 0 else 0.0,
        }
    ]
    subtotal_arus_kliring = cash_out_kliring

    total_kas_keluar_riil = round(
        subtotal_arus_operasi + subtotal_arus_investasi + subtotal_arus_kliring, 2
    )

    metode_distribution = []
    for m_name, m_nom in cash_metode_map.items():
        pct = round((float(m_nom) / total_kas_keluar_riil) * 100.0, 1) if total_kas_keluar_riil > 0 else 0.0
        metode_distribution.append({
            "metode": m_name,
            "nominal": round(float(m_nom), 2),
            "percentage": pct,
        })
    metode_distribution.sort(key=lambda x: -x["nominal"])

    arus_kas = {
        "total_kas_masuk": revenue_net,
        "net_cash_flow": round(revenue_net - total_kas_keluar_riil, 2),
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
    kemasan_total = _get_cat_nominal("Kemasan")

    has_revenue = revenue_net > 0

    cost_structure = {
        # Proporsi terhadap Total Beban Usaha (100% Beban)
        "hpp_ratio": round((subtotal_hpp / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "opex_ratio": round((subtotal_opex / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "bahan_ratio": round((bahan_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "gaji_ratio": round((gaji_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "sewa_ratio": round((sewa_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "marketing_ratio": round((marketing_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "maintenance_ratio": round((maintenance_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "software_ratio": round((software_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        "utilitas_ratio": round((utilitas_total / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        # Rasio Strategis F&B terhadap Pendapatan Bersih (Net Revenue)
        "has_revenue": has_revenue,
        "hpp_to_revenue_pct": round((subtotal_hpp / revenue_net) * 100.0, 1) if has_revenue else None,
        "opex_to_revenue_pct": round((subtotal_opex / revenue_net) * 100.0, 1) if has_revenue else None,
        "bahan_to_revenue_pct": round((bahan_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "kemasan_to_revenue_pct": round((kemasan_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "gaji_to_revenue_pct": round((gaji_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "sewa_to_revenue_pct": round((sewa_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "marketing_to_revenue_pct": round((marketing_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "maintenance_to_revenue_pct": round((maintenance_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "software_to_revenue_pct": round((software_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "utilitas_to_revenue_pct": round((utilitas_total / revenue_net) * 100.0, 1) if has_revenue else None,
        "gross_margin_pct": gross_margin_pct,
        "net_margin_pct": net_margin_pct,
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

    # Evaluasi Kesehatan Finansial (menggunakan % terhadap Pendapatan Bersih bila tersedia, fallback ke % Beban)
    health_evaluation: list[dict[str, Any]] = []
    basis_label = "pendapatan bersih" if has_revenue else "total beban usaha"

    # 1. Evaluasi Rasio HPP (Food & Packaging Cost)
    eval_hpp_pct = (
        cost_structure["hpp_to_revenue_pct"]
        if has_revenue and cost_structure["hpp_to_revenue_pct"] is not None
        else cost_structure["hpp_ratio"]
    )
    if subtotal_hpp == 0:
        h_status = "neutral"
        h_note = "Belum ada transaksi beban HPP tercatat pada periode ini."
    elif 30.0 <= eval_hpp_pct <= 55.0:
        h_status = "healthy"
        h_note = f"Rasio HPP ({eval_hpp_pct}% dari {basis_label}) berada pada rentang ideal toko kue & bakery (30% - 55%)."
    elif eval_hpp_pct < 30.0:
        h_status = "healthy"
        h_note = f"Rasio HPP ({eval_hpp_pct}% dari {basis_label}) sangat efisien (di bawah 30%)."
    else:
        h_status = "warning"
        h_note = f"Rasio HPP ({eval_hpp_pct}% dari {basis_label}) melampaui 55%. Pertimbangkan review harga jual, takaran resep, atau negosiasi supplier."

    health_evaluation.append({
        "key": "hpp_ratio",
        "title": "Rasio Harga Pokok Penjualan (HPP)",
        "value": f"{eval_hpp_pct}%",
        "ideal_range": "30% - 55% omset" if has_revenue else "40% - 55% beban",
        "status": h_status,
        "note": h_note,
    })

    # 2. Evaluasi Rasio Gaji Karyawan (Labor Cost Ratio)
    eval_gaji_pct = (
        cost_structure["gaji_to_revenue_pct"]
        if has_revenue and cost_structure["gaji_to_revenue_pct"] is not None
        else cost_structure["gaji_ratio"]
    )
    if gaji_total == 0:
        g_status = "neutral"
        g_note = "Belum ada transaksi payroll / gaji karyawan yang diinput pada periode ini."
    elif 15.0 <= eval_gaji_pct <= 28.0:
        g_status = "healthy"
        g_note = f"Rasio gaji ({eval_gaji_pct}% dari {basis_label}) berada dalam porsi wajar usaha F&B/bakery (15% - 28%)."
    elif eval_gaji_pct < 15.0:
        g_status = "healthy"
        g_note = f"Porsi beban gaji ({eval_gaji_pct}% dari {basis_label}) sangat efisien dan terjaga."
    else:
        g_status = "warning"
        g_note = f"Porsi beban gaji ({eval_gaji_pct}% dari {basis_label}) melampaui 28%. Perhatikan jadwal shift, jam lembur, dan produktivitas tim."

    health_evaluation.append({
        "key": "gaji_ratio",
        "title": "Rasio Beban Gaji & Upah (SDM)",
        "value": f"{eval_gaji_pct}%",
        "ideal_range": "15% - 28% omset" if has_revenue else "15% - 28% beban",
        "status": g_status,
        "note": g_note,
    })

    # 3. Evaluasi Rasio Sewa Tempat (Occupancy Cost Ratio)
    eval_sewa_pct = (
        cost_structure["sewa_to_revenue_pct"]
        if has_revenue and cost_structure["sewa_to_revenue_pct"] is not None
        else cost_structure["sewa_ratio"]
    )
    if sewa_total == 0:
        s_status = "neutral"
        s_note = "Tidak ada beban sewa dibayarkan pada periode ini (mungkin pembayaran tahunan/semesteran)."
    elif eval_sewa_pct <= 12.0:
        s_status = "healthy"
        s_note = f"Porsi beban sewa ({eval_sewa_pct}% dari {basis_label}) aman dan proporsional (di bawah 12%)."
    else:
        s_status = "warning"
        s_note = f"Beban sewa ({eval_sewa_pct}% dari {basis_label}) memakan porsi signifikan dari operasional bulanan."

    health_evaluation.append({
        "key": "sewa_ratio",
        "title": "Rasio Beban Sewa Tempat",
        "value": f"{eval_sewa_pct}%",
        "ideal_range": "5% - 12% omset" if has_revenue else "5% - 12% beban",
        "status": s_status,
        "note": s_note,
    })

    # 4. Evaluasi Kewajiban Hutang Belanja & Talangan terhadap Likuiditas / Beban
    debt_denominator = revenue_net if has_revenue else total_beban
    debt_ratio = round((subtotal_kewajiban / debt_denominator) * 100.0, 1) if debt_denominator > 0 else 0.0
    if subtotal_kewajiban == 0:
        d_status = "healthy"
        d_note = "Tidak ada hutang belanja tempo atau talangan tertunggak pada akhir periode ini."
    elif debt_ratio <= 20.0:
        d_status = "healthy"
        d_note = f"Total kewajiban lancar ({debt_ratio}% dari {basis_label}) dalam batas aman likuiditas kas toko."
    else:
        d_status = "danger"
        d_note = (
            f"Terdapat kewajiban belum lunas sebesar Rp {subtotal_kewajiban:,.0f} "
            f"({debt_ratio}% dari {basis_label}). Prioritaskan pelunasan sesuai jadwal jatuh tempo."
        )

    health_evaluation.append({
        "key": "unpaid_debt",
        "title": "Kewajiban Lancar (Tempo & Talangan)",
        "value": f"Rp {subtotal_kewajiban:,.0f}",
        "ideal_range": "< 20% omset" if has_revenue else "< 20% beban",
        "status": d_status,
        "note": d_note,
    })

    # 5. Analisis Variansi HPP Teoritis (Resep Menu) vs HPP Aktual (Belanja)
    hpp_variance = await _compute_theoretical_vs_actual_hpp(
        db, start_date, end_date, subtotal_hpp
    )

    analisis = {
        "cost_structure": cost_structure,
        "top_variances_mom": top_variances_mom,
        "health_evaluation": health_evaluation,
        "hpp_variance": hpp_variance,
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
