"""
app/services/ai_chat_tools.py — Deterministic Read-Only Financial Tools untuk AI Chat

Seluruh pengambilan angka keuangan dilakukan lewat service layer yang sudah tervalidasi
di codebase agar bebas halusinasi dan tetap mematuhi Observation Contract di AGENTS.md.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.accounting_service import get_accounting_report
from app.services.asset_service import list_assets
from app.services.bank_account_service import list_bank_accounts
from app.services.budget_service import get_effective_budget
from app.services.cashflow_service import get_daily_cashflow
from app.services.expense_service import (
    get_all_expenses_paginated,
    get_item_price_history,
    get_monthly_leaderboards,
    get_monthly_report,
    get_price_inflation_summary,
    get_reimbursement_summary,
    get_unpaid_summary,
)
from app.services.menu_product_service import (
    build_master_price_history_map,
    load_all_menus_graph,
    resolve_all_menu_financials,
    serialize_menu_product,
)
from app.services.purchase_request_service import (
    get_purchase_request_stats,
    get_purchase_requests,
)
from app.services.supplier_service import get_suppliers
from app.utils.formatters import fmt_rupiah

MONTH_NAMES_ID = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

AI_CHAT_TOOL_LABELS: dict[str, str] = {
    "get_monthly_expense_summary": "Ringkasan pengeluaran & kategori bulanan",
    "search_expenses": "Pencarian detail transaksi pengeluaran",
    "get_cashflow_and_bank_balances": "Arus kas & saldo rekening bank/kas",
    "get_profit_loss_report": "Laporan laba rugi & analisis rasio akuntansi",
    "get_budget_status": "Status serapan anggaran bulanan",
    "get_unpaid_and_reimbursements": "Tagihan belum lunas/DP & talangan karyawan",
    "get_price_trends_and_suppliers": "Tren harga bahan & data supplier",
    "get_menu_hpp_summary": "HPP, margin & food cost menu produk",
    "get_assets_and_purchase_requests": "Inventaris aset tetap & pengajuan belanja",
}

AI_CHAT_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_monthly_expense_summary",
            "description": (
                "Ambil ringkasan total pengeluaran bulanan, perbandingan dengan bulan sebelumnya (MoM), "
                "rincian per kategori, per metode pembayaran, total ongkir & kurir, tukar cash, "
                "serta top barang dan top supplier."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Tahun 4 digit, misal 2026. Kosongkan untuk tahun berjalan."},
                    "month": {"type": "integer", "description": "Bulan 1-12. Kosongkan untuk bulan berjalan."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_expenses",
            "description": (
                "Cari daftar transaksi pengeluaran spesifik dengan filter tanggal, bulan/tahun, kategori, "
                "supplier, kata kunci barang/catatan, status bayar (Lunas/Belum Lunas/DP), atau jenis khusus "
                "(tukar_cash, ongkir, talangan, unpaid, all)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Tanggal mulai format YYYY-MM-DD."},
                    "end_date": {"type": "string", "description": "Tanggal akhir format YYYY-MM-DD."},
                    "year": {"type": "integer", "description": "Filter tahun jika tanpa start_date/end_date."},
                    "month": {"type": "integer", "description": "Filter bulan 1-12 jika tanpa start_date/end_date."},
                    "category": {"type": "string", "description": "Nama kategori persis (misal: Bahan Kue, Ongkir, Gaji)."},
                    "supplier": {"type": "string", "description": "Nama toko atau supplier."},
                    "keyword": {"type": "string", "description": "Kata kunci nama barang, no invoice, atau catatan."},
                    "status": {"type": "string", "description": "Filter status pembayaran: Lunas, Belum Lunas, atau DP."},
                    "special_type": {
                        "type": "string",
                        "description": "Filter khusus: tukar_cash, ongkir, talangan, unpaid, atau all.",
                    },
                    "limit": {"type": "integer", "description": "Jumlah maksimum baris (1-50, default 20)."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_cashflow_and_bank_balances",
            "description": (
                "Ambil data arus kas harian (kas masuk, kas keluar, arus kas bersih, saldo awal/akhir) "
                "dan saldo estimasi terkini seluruh rekening bank, e-wallet, maupun kas tunai."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Tahun 4 digit jika memilih periode bulanan."},
                    "month": {"type": "integer", "description": "Bulan 1-12 jika memilih periode bulanan."},
                    "start_date": {"type": "string", "description": "Tanggal mulai periode format YYYY-MM-DD."},
                    "end_date": {"type": "string", "description": "Tanggal akhir periode format YYYY-MM-DD."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_profit_loss_report",
            "description": (
                "Ambil laporan Laba Rugi (omzet/pendapatan bersih, rincian per channel penjualan, HPP, "
                "OPEX, laba kotor, laba bersih, penyusutan aset) serta evaluasi kesehatan rasio keuangan."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Tahun 4 digit. Kosongkan untuk tahun berjalan."},
                    "month": {"type": "integer", "description": "Bulan 1-12. Kosongkan untuk bulan berjalan."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_budget_status",
            "description": (
                "Ambil status serapan anggaran bulanan (total budget vs realisasi belanja, sisa budget, "
                "persentase terpakai, serta kategori yang mendekati atau melebihi batas anggaran)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Tahun 4 digit. Kosongkan untuk tahun berjalan."},
                    "month": {"type": "integer", "description": "Bulan 1-12. Kosongkan untuk bulan berjalan."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_unpaid_and_reimbursements",
            "description": (
                "Ambil ringkasan dan daftar tagihan belum lunas/tempo/DP per supplier beserta status jatuh tempo, "
                "serta daftar talangan/reimbursement karyawan yang belum diganti."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Opsional filter tahun. Kosongkan untuk cek semua tunggakan aktif."},
                    "month": {"type": "integer", "description": "Opsional filter bulan 1-12. Kosongkan untuk cek semua."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_price_trends_and_suppliers",
            "description": (
                "Cek inflasi/kenaikan harga bahan dibanding bulan sebelumnya, riwayat harga bahan tertentu "
                "beserta perbandingan harga termurah antar supplier, dan ringkasan top supplier."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "Nama bahan/barang untuk cek riwayat harga detail."},
                    "year": {"type": "integer", "description": "Tahun 4 digit untuk analisis tren bulanan."},
                    "month": {"type": "integer", "description": "Bulan 1-12 untuk analisis tren bulanan."},
                    "supplier_search": {"type": "string", "description": "Filter pencarian nama supplier."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_menu_hpp_summary",
            "description": (
                "Ambil data HPP (Harga Pokok Penjualan), harga jual, gross margin, persentase food cost, "
                "dan deteksi kenaikan harga bahan pada menu produk Historycake."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "Kata kunci nama menu, kategori, atau SKU."},
                    "sort_by": {
                        "type": "string",
                        "enum": ["lowest_margin", "highest_hpp", "name"],
                        "description": "Urutan hasil: lowest_margin (default), highest_hpp, atau name.",
                    },
                    "limit": {"type": "integer", "description": "Jumlah maksimum menu (1-50, default 20)."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_assets_and_purchase_requests",
            "description": (
                "Ambil ringkasan inventaris aset tetap (nilai perolehan, nilai buku bersih, penyusutan bulanan, "
                "garansi/servis) serta status pengajuan belanja (Purchase Request) staf dan purchasing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_search": {"type": "string", "description": "Kata kunci pencarian aset tetap."},
                    "request_status": {
                        "type": "string",
                        "description": "Filter status request belanja: DRAFT, PENDING, APPROVED, ORDERED, RECEIVED, FULFILLED, REJECTED.",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
]


def _resolve_year_month(year: Any, month: Any) -> tuple[int, int] | tuple[None, None]:
    today = date.today()
    y = today.year if year is None else year
    m = today.month if month is None else month
    try:
        y_int = int(y)
        m_int = int(m)
    except (TypeError, ValueError):
        return None, None
    if not (2000 <= y_int <= 2100) or not (1 <= m_int <= 12):
        return None, None
    return y_int, m_int


def _parse_iso_date(val: Any) -> date | None:
    if not val:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    try:
        return date.fromisoformat(str(val).strip()[:10])
    except ValueError:
        return None


def _clamp_limit(limit: Any, default: int = 20, max_limit: int = 50) -> int:
    if limit is None:
        return default
    try:
        val = int(limit)
    except (TypeError, ValueError):
        return default
    return max(1, min(max_limit, val))


def _period_label(year: int, month: int) -> str:
    return f"{MONTH_NAMES_ID[month - 1]} {year}"


def _make_observation(
    *,
    tool: str,
    status: str,
    period: str,
    summary: str,
    data: Any,
) -> dict[str, Any]:
    return {
        "status": status,
        "tool": tool,
        "label": AI_CHAT_TOOL_LABELS.get(tool, tool),
        "period": period,
        "summary": summary,
        "data": data,
    }


async def _tool_get_monthly_expense_summary(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    y, m = _resolve_year_month(args.get("year"), args.get("month"))
    if y is None or m is None:
        return _make_observation(
            tool="get_monthly_expense_summary",
            status="error",
            period="-",
            summary="Parameter tahun atau bulan tidak valid.",
            data={"error": "Bulan harus antara 1-12 dan tahun antara 2000-2100."},
        )

    report = await get_monthly_report(db, y, m)
    prev_y, prev_m = (y - 1, 12) if m == 1 else (y, m - 1)
    prev_report = await get_monthly_report(db, prev_y, prev_m)
    leaderboards = await get_monthly_leaderboards(db, y, m)

    total_lunas = float(report.get("total_lunas", 0.0))
    list_hutang = report.get("list_hutang", [])
    total_hutang = sum(float(h.get("nominal", 0.0)) for h in list_hutang)
    total_pengeluaran = total_lunas + total_hutang

    prev_lunas = float(prev_report.get("total_lunas", 0.0))
    prev_hutang = sum(float(h.get("nominal", 0.0)) for h in prev_report.get("list_hutang", []))
    prev_total = prev_lunas + prev_hutang
    mom_diff = total_pengeluaran - prev_total
    mom_pct = round((mom_diff / prev_total) * 100.0, 1) if prev_total > 0 else None

    period = _period_label(y, m)
    tx_count = int(report.get("expense_count", 0))
    summary = (
        f"Total pengeluaran {period}: {fmt_rupiah(total_pengeluaran)} "
        f"({tx_count} transaksi; lunas {fmt_rupiah(total_lunas)}, belum lunas {fmt_rupiah(total_hutang)})."
    )

    return _make_observation(
        tool="get_monthly_expense_summary",
        status="success",
        period=period,
        summary=summary,
        data={
            "year": y,
            "month": m,
            "period": period,
            "expense_count": tx_count,
            "total_pengeluaran": round(total_pengeluaran, 2),
            "total_lunas": round(total_lunas, 2),
            "total_hutang": round(total_hutang, 2),
            "unpaid_count": len(list_hutang),
            "prev_period": _period_label(prev_y, prev_m),
            "prev_total_pengeluaran": round(prev_total, 2),
            "mom_diff": round(mom_diff, 2),
            "mom_pct": mom_pct,
            "total_ongkir": round(float(report.get("total_ongkir", 0.0)), 2),
            "ongkir_count": int(report.get("ongkir_count", 0)),
            "ongkir_by_courier": (report.get("ongkir_by_courier") or [])[:10],
            "total_tukar_cash": round(float(report.get("total_tukar_cash", 0.0)), 2),
            "tukar_cash_count": int(report.get("tukar_cash_count", 0)),
            "reimburse_pending_count": int(report.get("reimburse_pending_count", 0)),
            "reimburse_pending_total": round(float(report.get("reimburse_pending_total", 0.0)), 2),
            "per_kategori": report.get("per_kategori", {}),
            "per_metode_bayar": report.get("per_metode_bayar", {}),
            "top_expensive_items": (leaderboards.get("top_expensive_items") or [])[:8],
            "top_frequent_items": (leaderboards.get("top_frequent_items") or [])[:8],
            "top_suppliers": (leaderboards.get("top_suppliers") or [])[:8],
            "summary_metrics": leaderboards.get("summary_metrics", {}),
        },
    )


async def _tool_search_expenses(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    start_raw = args.get("start_date")
    end_raw = args.get("end_date")
    start_d = _parse_iso_date(start_raw)
    end_d = _parse_iso_date(end_raw)

    if start_raw and start_d is None:
        return _make_observation(
            tool="search_expenses",
            status="error",
            period="-",
            summary="Format start_date tidak valid.",
            data={"error": "Gunakan format YYYY-MM-DD untuk start_date."},
        )
    if end_raw and end_d is None:
        return _make_observation(
            tool="search_expenses",
            status="error",
            period="-",
            summary="Format end_date tidak valid.",
            data={"error": "Gunakan format YYYY-MM-DD untuk end_date."},
        )

    year_val = args.get("year")
    month_val = args.get("month")
    y_filter: int | None = None
    m_filter: int | None = None
    if not start_d and not end_d and (year_val is not None or month_val is not None):
        y_filter, m_filter = _resolve_year_month(year_val, month_val)
        if y_filter is None or m_filter is None:
            return _make_observation(
                tool="search_expenses",
                status="error",
                period="-",
                summary="Filter bulan/tahun tidak valid.",
                data={"error": "Bulan harus 1-12 dan tahun 2000-2100."},
            )

    limit = _clamp_limit(args.get("limit"), default=20, max_limit=50)
    category = str(args["category"]).strip() if args.get("category") else None
    supplier_arg = str(args["supplier"]).strip() if args.get("supplier") else None
    keyword = str(args["keyword"]).strip() if args.get("keyword") else None
    status_arg = str(args["status"]).strip() if args.get("status") else None
    special_type = str(args["special_type"]).strip() if args.get("special_type") else None

    # Gunakan ilike search saat hanya supplier yang diisi agar nama parsial tetap cocok
    search_term = keyword
    exact_supplier = supplier_arg
    if supplier_arg and not keyword:
        search_term = supplier_arg
        exact_supplier = None

    include_ongkir = bool(
        (category and category.lower() == "ongkir")
        or (special_type and special_type.lower() in ("ongkir", "all", "all_cash_delivery"))
        or (keyword and "ongkir" in keyword.lower())
    )

    rows, total_matched = await get_all_expenses_paginated(
        db,
        page=1,
        per_page=limit,
        category=category,
        month=m_filter,
        year=y_filter,
        search=search_term,
        status=status_arg,
        supplier=exact_supplier,
        special_type=special_type,
        include_ongkir=include_ongkir,
        start_date=start_d,
        end_date=end_d,
    )

    items = [
        {
            "id": e.id,
            "tanggal": e.expense_date.isoformat() if e.expense_date else None,
            "barang": e.item_name,
            "qty": float(e.qty or 1),
            "satuan": e.unit or "Pcs",
            "harga_satuan": float(e.unit_price or 0),
            "total_harga": float(e.total_price or 0),
            "kategori": e.category or "-",
            "supplier": e.supplier or "-",
            "metode_bayar": e.pay_method or "-",
            "status_pembayaran": e.pay_status or "-",
            "jatuh_tempo": e.due_date or "-",
            "is_reimbursement": bool(e.is_reimbursement),
            "reimbursed": e.reimbursed_at is not None,
            "no_invoice": e.invoice_number or "-",
            "keterangan": e.notes or "-",
        }
        for e in rows
    ]

    if start_d or end_d:
        period = f"{start_d.isoformat() if start_d else '...'} s.d. {end_d.isoformat() if end_d else '...'}"
    elif y_filter and m_filter:
        period = _period_label(y_filter, m_filter)
    else:
        period = "Semua periode"

    total_nominal_shown = sum(it["total_harga"] for it in items)
    summary = (
        f"Ditemukan {total_matched} transaksi (ditampilkan {len(items)} baris, "
        f"total tampilan {fmt_rupiah(total_nominal_shown)})."
    )
    return _make_observation(
        tool="search_expenses",
        status="success",
        period=period,
        summary=summary,
        data={
            "total_matched": int(total_matched),
            "returned_count": len(items),
            "shown_total_amount": round(total_nominal_shown, 2),
            "items": items,
        },
    )


async def _tool_get_cashflow_and_bank_balances(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    start_raw = args.get("start_date")
    end_raw = args.get("end_date")
    start_d = _parse_iso_date(start_raw)
    end_d = _parse_iso_date(end_raw)

    if start_raw and start_d is None:
        return _make_observation(
            tool="get_cashflow_and_bank_balances",
            status="error",
            period="-",
            summary="Format start_date tidak valid.",
            data={"error": "Gunakan format YYYY-MM-DD untuk start_date."},
        )
    if end_raw and end_d is None:
        return _make_observation(
            tool="get_cashflow_and_bank_balances",
            status="error",
            period="-",
            summary="Format end_date tidak valid.",
            data={"error": "Gunakan format YYYY-MM-DD untuk end_date."},
        )

    y: int | None = None
    m: int | None = None
    if not start_d and not end_d:
        y, m = _resolve_year_month(args.get("year"), args.get("month"))
        if y is None or m is None:
            return _make_observation(
                tool="get_cashflow_and_bank_balances",
                status="error",
                period="-",
                summary="Parameter tahun atau bulan tidak valid.",
                data={"error": "Bulan harus 1-12 dan tahun 2000-2100."},
            )

    cashflow = await get_daily_cashflow(
        db,
        year=y,
        month=m,
        start_date=start_d,
        end_date=end_d,
    )
    accounts = await list_bank_accounts(db, active_only=True)

    total_estimated_balance = round(
        sum(float(a.get("estimated_balance", 0.0)) for a in accounts),
        2,
    )
    accounts_compact = [
        {
            "id": a["id"],
            "name": a["name"],
            "bank_name": a["bank_name"],
            "account_type": a["account_type"],
            "account_code": a["account_code"],
            "opening_balance": round(float(a.get("opening_balance", 0.0)), 2),
            "total_incoming": round(float(a.get("total_incoming", 0.0)), 2),
            "total_expenses": round(float(a.get("total_expenses", 0.0)), 2),
            "transfers_in": round(float(a.get("transfers_in", 0.0)), 2),
            "transfers_out": round(float(a.get("transfers_out", 0.0)), 2),
            "estimated_balance": round(float(a.get("estimated_balance", 0.0)), 2),
        }
        for a in accounts
    ]

    daily_rows = cashflow.get("daily_rows") or []
    period = cashflow.get("periode") or "-"
    summary = (
        f"Arus kas {period}: masuk {fmt_rupiah(cashflow.get('total_cash_in', 0))}, "
        f"keluar {fmt_rupiah(cashflow.get('total_cash_out', 0))}, "
        f"saldo akhir periode {fmt_rupiah(cashflow.get('saldo_akhir', 0))}; "
        f"total saldo {len(accounts_compact)} rekening aktif {fmt_rupiah(total_estimated_balance)}."
    )

    return _make_observation(
        tool="get_cashflow_and_bank_balances",
        status="success",
        period=period,
        summary=summary,
        data={
            "periode": period,
            "start_date": cashflow.get("start_date"),
            "end_date": cashflow.get("end_date"),
            "saldo_awal": cashflow.get("saldo_awal", 0.0),
            "total_cash_in": cashflow.get("total_cash_in", 0.0),
            "total_cash_out": cashflow.get("total_cash_out", 0.0),
            "net_cash_flow": cashflow.get("net_cash_flow", 0.0),
            "saldo_akhir": cashflow.get("saldo_akhir", 0.0),
            "total_tx_in": cashflow.get("total_tx_in", 0),
            "total_tx_out": cashflow.get("total_tx_out", 0),
            "total_bank_balances": total_estimated_balance,
            "bank_accounts": accounts_compact,
            "daily_rows": daily_rows[-31:],
        },
    )


async def _tool_get_profit_loss_report(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    y, m = _resolve_year_month(args.get("year"), args.get("month"))
    if y is None or m is None:
        return _make_observation(
            tool="get_profit_loss_report",
            status="error",
            period="-",
            summary="Parameter tahun atau bulan tidak valid.",
            data={"error": "Bulan harus 1-12 dan tahun 2000-2100."},
        )

    rep = await get_accounting_report(db, year=y, month=m)
    lr = rep.get("laba_rugi", {})
    analisis = rep.get("analisis", {})
    period = f"{rep.get('month_name', MONTH_NAMES_ID[m - 1])} {y}"

    summary = (
        f"Laba Rugi {period}: pendapatan bersih {fmt_rupiah(lr.get('revenue_net', 0))}, "
        f"total beban {fmt_rupiah(lr.get('total_beban', 0))}, "
        f"laba bersih {fmt_rupiah(lr.get('net_profit', 0))}."
    )

    return _make_observation(
        tool="get_profit_loss_report",
        status="success",
        period=period,
        summary=summary,
        data={
            "period": period,
            "laba_rugi": {
                "paid_tx_count": lr.get("paid_tx_count", 0),
                "revenue_gross": lr.get("revenue_gross", 0.0),
                "revenue_discount": lr.get("revenue_discount", 0.0),
                "revenue_platform_fee": lr.get("revenue_platform_fee", 0.0),
                "revenue_net": lr.get("revenue_net", 0.0),
                "prev_revenue_net": lr.get("prev_revenue_net", 0.0),
                "mom_revenue_change_pct": lr.get("mom_revenue_change_pct", 0.0),
                "subtotal_hpp": lr.get("subtotal_hpp", 0.0),
                "subtotal_opex": lr.get("subtotal_opex", 0.0),
                "total_beban": lr.get("total_beban", 0.0),
                "gross_profit": lr.get("gross_profit", 0.0),
                "net_profit": lr.get("net_profit", 0.0),
                "prev_net_profit": lr.get("prev_net_profit", 0.0),
                "depreciation_expense": lr.get("depreciation_expense", 0.0),
                "low_value_asset_expense": lr.get("low_value_asset_expense", 0.0),
                "disposal_gain_loss": lr.get("disposal_gain_loss", 0.0),
                "revenue_by_channel": lr.get("revenue_by_channel", []),
                "hpp_items": [
                    {"category": i["category"], "total": i["total"], "mom_change_pct": i["mom_change_pct"]}
                    for i in (lr.get("hpp_items") or []) if float(i.get("total", 0)) > 0
                ],
                "opex_items": [
                    {"category": i["category"], "total": i["total"], "mom_change_pct": i["mom_change_pct"]}
                    for i in (lr.get("opex_items") or []) if float(i.get("total", 0)) > 0
                ],
            },
            "cost_structure": analisis.get("cost_structure", {}),
            "health_evaluation": analisis.get("health_evaluation", []),
            "top_variances_mom": {
                "top_increases": ((analisis.get("top_variances_mom") or {}).get("top_increases") or [])[:5],
                "top_savings": ((analisis.get("top_variances_mom") or {}).get("top_savings") or [])[:5],
            },
        },
    )


async def _tool_get_budget_status(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    y, m = _resolve_year_month(args.get("year"), args.get("month"))
    if y is None or m is None:
        return _make_observation(
            tool="get_budget_status",
            status="error",
            period="-",
            summary="Parameter tahun atau bulan tidak valid.",
            data={"error": "Bulan harus 1-12 dan tahun 2000-2100."},
        )

    eff = await get_effective_budget(db, y, m)
    report = await get_monthly_report(db, y, m)

    total_budget = float(eff.get("total_budget", 0.0))
    total_lunas = float(report.get("total_lunas", 0.0))
    total_hutang = sum(float(h.get("nominal", 0.0)) for h in report.get("list_hutang", []))
    total_spent = total_lunas + total_hutang
    remaining = total_budget - total_spent if total_budget > 0 else None
    used_pct = round((total_spent / total_budget) * 100.0, 1) if total_budget > 0 else None

    per_kategori = report.get("per_kategori", {})
    cat_amounts = eff.get("category_amounts", {})
    all_cats = sorted(set(per_kategori.keys()) | set(cat_amounts.keys()))

    category_breakdown = []
    overbudget_categories = []
    for cat in all_cats:
        spent = round(float(per_kategori.get(cat, 0.0)), 2)
        limit_amt = round(float(cat_amounts.get(cat, 0.0)), 2)
        cat_pct = round((spent / limit_amt) * 100.0, 1) if limit_amt > 0 else None
        is_over = bool(limit_amt > 0 and spent > limit_amt)
        entry = {
            "category": cat,
            "budget": limit_amt,
            "spent": spent,
            "remaining": round(limit_amt - spent, 2) if limit_amt > 0 else None,
            "used_pct": cat_pct,
            "is_overbudget": is_over,
        }
        category_breakdown.append(entry)
        if is_over:
            overbudget_categories.append(entry)

    category_breakdown.sort(key=lambda x: x["spent"], reverse=True)
    period = _period_label(y, m)
    if total_budget > 0:
        summary = (
            f"Budget {period}: terpakai {fmt_rupiah(total_spent)} dari {fmt_rupiah(total_budget)} "
            f"({used_pct}%), {len(overbudget_categories)} kategori overbudget."
        )
    else:
        summary = f"Budget {period} belum disetel; realisasi belanja saat ini {fmt_rupiah(total_spent)}."

    return _make_observation(
        tool="get_budget_status",
        status="success" if total_budget > 0 else "warning",
        period=period,
        summary=summary,
        data={
            "year": y,
            "month": m,
            "period": period,
            "is_custom_monthly_budget": bool(eff.get("is_custom")),
            "total_budget": round(total_budget, 2),
            "total_spent": round(total_spent, 2),
            "remaining_budget": round(remaining, 2) if remaining is not None else None,
            "used_pct": used_pct,
            "overbudget_categories": overbudget_categories,
            "categories": category_breakdown,
        },
    )


async def _tool_get_unpaid_and_reimbursements(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    y_arg = args.get("year")
    m_arg = args.get("month")
    y_filter: int | None = None
    m_filter: int | None = None
    if y_arg is not None or m_arg is not None:
        y_filter, m_filter = _resolve_year_month(y_arg, m_arg)
        if y_filter is None or m_filter is None:
            return _make_observation(
                tool="get_unpaid_and_reimbursements",
                status="error",
                period="-",
                summary="Parameter tahun atau bulan tidak valid.",
                data={"error": "Bulan harus 1-12 dan tahun 2000-2100."},
            )

    unpaid = await get_unpaid_summary(db, month=m_filter, year=y_filter)
    reimb = await get_reimbursement_summary(db, month=m_filter, year=y_filter, include_ongkir=True)

    unpaid_rows, _ = await get_all_expenses_paginated(
        db,
        page=1,
        per_page=15,
        month=m_filter,
        year=y_filter,
        special_type="unpaid",
        sort_by="due_date",
        include_ongkir=True,
    )
    reimb_rows, _ = await get_all_expenses_paginated(
        db,
        page=1,
        per_page=15,
        month=m_filter,
        year=y_filter,
        is_reimbursement=True,
        reimbursed_status="pending",
        include_ongkir=True,
    )

    period = _period_label(y_filter, m_filter) if (y_filter and m_filter) else "Semua tunggakan aktif"
    unpaid_total = float(unpaid.get("total_unpaid_nominal", 0.0))
    pending_reimb_total = float(reimb.get("pending_total", 0.0))

    summary = (
        f"Tagihan belum lunas/DP: {unpaid.get('total_unpaid_count', 0)} transaksi "
        f"({fmt_rupiah(unpaid_total)}, lewat tempo {unpaid.get('overdue_count', 0)}); "
        f"talangan belum diganti: {reimb.get('pending_count', 0)} item ({fmt_rupiah(pending_reimb_total)})."
    )

    return _make_observation(
        tool="get_unpaid_and_reimbursements",
        status="success",
        period=period,
        summary=summary,
        data={
            "unpaid": {
                "total_count": unpaid.get("total_unpaid_count", 0),
                "total_remaining_nominal": round(unpaid_total, 2),
                "dp_count": unpaid.get("dp_count", 0),
                "dp_paid_nominal": unpaid.get("dp_paid_nominal", 0.0),
                "dp_remaining_nominal": unpaid.get("dp_remaining_nominal", 0.0),
                "overdue_count": unpaid.get("overdue_count", 0),
                "overdue_nominal": unpaid.get("overdue_nominal", 0.0),
                "due_today_count": unpaid.get("due_today_count", 0),
                "due_soon_count": unpaid.get("due_soon_count", 0),
                "nearest_due": unpaid.get("nearest_due"),
                "by_supplier": (unpaid.get("by_supplier") or [])[:15],
                "items": [
                    {
                        "id": e.id,
                        "tanggal": e.expense_date.isoformat() if e.expense_date else None,
                        "barang": e.item_name,
                        "supplier": e.supplier or "-",
                        "total_harga": float(e.total_price or 0),
                        "paid_amount": float(getattr(e, "paid_amount", 0) or 0),
                        "status_pembayaran": e.pay_status,
                        "jatuh_tempo": e.due_date or "-",
                    }
                    for e in unpaid_rows
                ],
            },
            "reimbursements": {
                "pending_count": reimb.get("pending_count", 0),
                "pending_total": round(pending_reimb_total, 2),
                "reimbursed_count": reimb.get("reimbursed_count", 0),
                "reimbursed_total": round(float(reimb.get("reimbursed_total", 0.0)), 2),
                "by_user": reimb.get("by_user", []),
                "pending_items": [
                    {
                        "id": e.id,
                        "tanggal": e.expense_date.isoformat() if e.expense_date else None,
                        "barang": e.item_name,
                        "total_harga": float(e.total_price or 0),
                        "supplier": e.supplier or "-",
                        "kategori": e.category or "-",
                    }
                    for e in reimb_rows
                ],
            },
        },
    )


async def _tool_get_price_trends_and_suppliers(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    y, m = _resolve_year_month(args.get("year"), args.get("month"))
    if y is None or m is None:
        return _make_observation(
            tool="get_price_trends_and_suppliers",
            status="error",
            period="-",
            summary="Parameter tahun atau bulan tidak valid.",
            data={"error": "Bulan harus 1-12 dan tahun 2000-2100."},
        )

    prev_y, prev_m = (y - 1, 12) if m == 1 else (y, m - 1)
    inflation = await get_price_inflation_summary(db, y, m, prev_y, prev_m)
    leaderboards = await get_monthly_leaderboards(db, y, m)

    keyword = str(args["keyword"]).strip() if args.get("keyword") else None
    item_history = await get_item_price_history(db, item_name=keyword) if keyword else None

    supplier_search = str(args["supplier_search"]).strip() if args.get("supplier_search") else None
    suppliers_list, suppliers_total, suppliers_summary = await get_suppliers(
        db, search=supplier_search, limit=15
    )
    suppliers_compact = [
        {
            "id": s["id"],
            "name": s["name"],
            "supplier_type": s.get("supplier_type", "toko"),
            "total_spent": s.get("total_spent", 0.0),
            "transaction_count": s.get("transaction_count", 0),
            "unpaid_bills_total": s.get("unpaid_bills_total", 0.0),
            "last_expense_date": s.get("last_expense_date"),
        }
        for s in suppliers_list
    ]

    period = _period_label(y, m)
    inflated_cnt = inflation.get("items_inflated_count", 0)
    spikes = leaderboards.get("top_price_spikes") or []
    summary = (
        f"Tren harga {period}: {inflated_cnt} item naik harga dibanding bulan lalu "
        f"({len(spikes)} lonjakan harga utama), total {suppliers_total} supplier tercatat."
    )
    if item_history and item_history.get("tx_count", 0) > 0:
        summary += (
            f" Riwayat '{item_history.get('item_name')}': terbaru {fmt_rupiah(item_history.get('latest_price', 0))}, "
            f"termurah di {item_history.get('cheapest_supplier', '-')}."
        )

    return _make_observation(
        tool="get_price_trends_and_suppliers",
        status="success",
        period=period,
        summary=summary,
        data={
            "period": period,
            "inflation_summary": inflation,
            "top_price_spikes": spikes,
            "item_price_history": item_history,
            "suppliers_summary": suppliers_summary,
            "suppliers": suppliers_compact,
        },
    )


async def _tool_get_menu_hpp_summary(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    keyword = str(args.get("keyword") or "").strip().lower()
    sort_by = str(args.get("sort_by") or "lowest_margin").strip().lower()
    limit = _clamp_limit(args.get("limit"), default=20, max_limit=50)

    menus_by_id = await load_all_menus_graph(db)
    price_history_map = await build_master_price_history_map(db)
    price_map = {mid: float(info["latest_price"]) for mid, info in price_history_map.items()}
    resolved_map = resolve_all_menu_financials(menus_by_id, price_history_map)

    serialized = [
        serialize_menu_product(
            menu,
            price_map,
            anonymize=False,
            price_history_map=price_history_map,
            financials=resolved_map[menu.id],
        )
        for menu in menus_by_id.values()
        if getattr(menu, "is_active", True)
    ]

    if keyword:
        serialized = [
            m
            for m in serialized
            if keyword in (m.get("name") or "").lower()
            or keyword in (m.get("category") or "").lower()
            or keyword in (m.get("product_group") or "").lower()
            or keyword in (m.get("sku") or "").lower()
        ]

    if sort_by == "highest_hpp":
        serialized.sort(key=lambda m: float(m.get("effective_hpp") or 0), reverse=True)
    elif sort_by == "name":
        serialized.sort(key=lambda m: (m.get("name") or "").lower())
    else:
        # Menu dengan margin terendah dulu (prioritaskan menu yang punya harga jual > 0)
        serialized.sort(
            key=lambda m: (
                0 if float(m.get("selling_price") or 0) > 0 else 1,
                float(m.get("margin_pct") or 0),
            )
        )

    total_matched = len(serialized)
    drift_menus = [m for m in serialized if m.get("has_price_drift")]
    top_menus = [
        {
            "id": m["id"],
            "name": m["name"],
            "category": m.get("category") or "-",
            "item_type": m.get("item_type", "finished"),
            "is_sellable": bool(m.get("is_sellable", True)),
            "selling_price": round(float(m.get("selling_price") or 0), 2),
            "effective_hpp": round(float(m.get("effective_hpp") or 0), 2),
            "gross_margin": round(float(m.get("gross_margin") or 0), 2),
            "margin_pct": round(float(m.get("margin_pct") or 0), 1),
            "food_cost_pct": round(float(m.get("food_cost_pct") or 0), 1),
            "food_cost_status": m.get("food_cost_status"),
            "has_price_drift": bool(m.get("has_price_drift")),
            "max_ingredient_increase_pct": float(m.get("max_ingredient_increase_pct") or 0),
            "top_ingredients": sorted(
                [
                    {
                        "name": ing.get("ingredient_name") or "-",
                        "qty": ing.get("qty"),
                        "unit": ing.get("unit"),
                        "cost": round(float(ing.get("line_cost") or 0), 2),
                    }
                    for ing in (m.get("ingredients") or [])
                ],
                key=lambda x: x["cost"],
                reverse=True,
            )[:5],
        }
        for m in serialized[:limit]
    ]

    summary = (
        f"Ditemukan {total_matched} menu aktif ({len(drift_menus)} menu terdampak kenaikan harga bahan)."
    )
    return _make_observation(
        tool="get_menu_hpp_summary",
        status="success",
        period="Data resep & harga bahan terkini",
        summary=summary,
        data={
            "total_matched": total_matched,
            "returned_count": len(top_menus),
            "price_drift_menu_count": len(drift_menus),
            "menus": top_menus,
        },
    )


async def _tool_get_assets_and_purchase_requests(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    asset_search = str(args["asset_search"]).strip() if args.get("asset_search") else None
    req_status = str(args["request_status"]).strip().upper() if args.get("request_status") else None

    assets_res = await list_assets(db, search=asset_search)
    req_stats = await get_purchase_request_stats(db)
    requests, req_total = await get_purchase_requests(db, status=req_status, limit=20)

    compact_assets = [
        {
            "asset_code": a.get("asset_code"),
            "name": a.get("name"),
            "asset_group": a.get("asset_group"),
            "status": a.get("status"),
            "location": a.get("location"),
            "purchase_date": a.get("purchase_date"),
            "acquisition_cost": a.get("acquisition_cost", 0.0),
            "net_book_value": a.get("net_book_value", 0.0),
            "monthly_depreciation": a.get("monthly_depreciation", 0.0),
            "warranty_status": a.get("warranty_status"),
        }
        for a in (assets_res.get("items") or [])[:20]
    ]

    compact_requests = [
        {
            "id": r.id,
            "request_number": r.request_number,
            "title": r.title,
            "request_date": r.request_date.isoformat() if r.request_date else None,
            "requester_name": r.requester_name,
            "urgency": r.urgency,
            "status": r.status,
            "items": [
                {
                    "item_name": it.item_name,
                    "qty": float(it.qty or 0),
                    "unit": it.unit or "Pcs",
                    "estimated_price": float(it.estimated_price or 0) if it.estimated_price is not None else None,
                    "order_status": it.order_status,
                    "receiving_status": it.receiving_status,
                }
                for it in (r.items or [])[:8]
            ],
        }
        for r in requests
    ]

    asset_summary = assets_res.get("summary", {})
    summary = (
        f"Aset tetap: {asset_summary.get('total_assets', 0)} aset "
        f"(nilai buku bersih {fmt_rupiah(asset_summary.get('total_net_book_value', 0))}); "
        f"Request belanja: {req_stats.get('pending', 0)} menunggu approval, "
        f"{req_stats.get('approved', 0)} siap dipesan, {req_stats.get('ordered', 0)} sedang dipesan."
    )

    return _make_observation(
        tool="get_assets_and_purchase_requests",
        status="success",
        period="Posisi terkini",
        summary=summary,
        data={
            "assets_summary": asset_summary,
            "assets": compact_assets,
            "purchase_request_stats": req_stats,
            "purchase_requests_total_matched": req_total,
            "purchase_requests": compact_requests,
        },
    )


_TOOL_HANDLERS = {
    "get_monthly_expense_summary": _tool_get_monthly_expense_summary,
    "search_expenses": _tool_search_expenses,
    "get_cashflow_and_bank_balances": _tool_get_cashflow_and_bank_balances,
    "get_profit_loss_report": _tool_get_profit_loss_report,
    "get_budget_status": _tool_get_budget_status,
    "get_unpaid_and_reimbursements": _tool_get_unpaid_and_reimbursements,
    "get_price_trends_and_suppliers": _tool_get_price_trends_and_suppliers,
    "get_menu_hpp_summary": _tool_get_menu_hpp_summary,
    "get_assets_and_purchase_requests": _tool_get_assets_and_purchase_requests,
}


async def execute_ai_chat_tool(
    db: AsyncSession,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Eksekusi satu read-only tool keuangan dengan Observation Contract deterministik."""
    handler = _TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return _make_observation(
            tool=tool_name,
            status="error",
            period="-",
            summary=f"Tool '{tool_name}' tidak terdaftar.",
            data={"error": f"Tool tidak dikenal: {tool_name}"},
        )

    safe_args = arguments if isinstance(arguments, dict) else {}
    try:
        return await handler(db, safe_args)
    except Exception as exc:
        return _make_observation(
            tool=tool_name,
            status="error",
            period="-",
            summary=f"Gagal mengeksekusi tool {tool_name}: {type(exc).__name__}",
            data={"error": str(exc)},
        )


async def build_fallback_snapshot(db: AsyncSession) -> dict[str, Any]:
    """Snapshot ringkas bulan berjalan saat model upstream tidak mendukung native tool calling."""
    today = date.today()
    args = {"year": today.year, "month": today.month}
    monthly = await _tool_get_monthly_expense_summary(db, args)
    cashflow = await _tool_get_cashflow_and_bank_balances(db, args)
    budget = await _tool_get_budget_status(db, args)
    unpaid = await _tool_get_unpaid_and_reimbursements(db, {})
    return {
        "snapshot_period": _period_label(today.year, today.month),
        "monthly_expense_summary": monthly.get("data"),
        "cashflow_and_bank_balances": cashflow.get("data"),
        "budget_status": budget.get("data"),
        "unpaid_and_reimbursements": unpaid.get("data"),
    }
