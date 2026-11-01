"""
app/services/accounting_service.py — Layanan Laporan & Analisis Akuntansi Standar (SAK EMKM)
Menyajikan laporan Laba Rugi, Posisi Keuangan (Neraca), Arus Kas, dan Analisis Rasio Finansial.
"""
from datetime import datetime, date
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.models.expense import Expense
from app.models.master_data import MasterDataOption
from app.services.expense_service import get_monthly_report
from app.services.master_data_service import get_category_accounting_map, get_master_options

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
    cur_month_name = MONTH_NAMES[cur_month - 1]

    # Hitung periode bulan lalu
    if cur_month == 1:
        prev_month, prev_year = 12, cur_year - 1
    else:
        prev_month, prev_year = cur_month - 1, cur_year
    prev_month_name = MONTH_NAMES[prev_month - 1]

    # Ambil laporan belanja bulan ini dan bulan lalu
    cur_report = await get_monthly_report(db, cur_year, cur_month)
    prev_report = await get_monthly_report(db, prev_year, prev_month)

    # Ambil master options dan COA
    kategori_options = await get_master_options(db, opt_type="kategori", active_only=True)
    metode_bayar_options = await get_master_options(db, opt_type="metode_bayar", active_only=True)
    coa_map = await get_category_accounting_map(db)

    # Hitung jumlah transaksi per kategori pada periode ini
    start_date = date(cur_year, cur_month, 1)
    end_date = date(cur_year + 1, 1, 1) if cur_month == 12 else date(cur_year, cur_month + 1, 1)
    
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

    # Urutkan berdasarkan account_code
    all_account_lines.sort(key=lambda x: (x["account_code"], x["category"]))

    # ─────────────────────────────────────────────────────────────
    # 1. LAPORAN LABA RUGI (INCOME STATEMENT - BEBAN USAHA)
    # ─────────────────────────────────────────────────────────────
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

    # Tambahkan proporsi persentase ke masing-masing item Laba Rugi
    for item in hpp_items:
        item["percentage_of_group"] = round((item["total"] / subtotal_hpp) * 100.0, 1) if subtotal_hpp > 0 else 0.0
        item["percentage_of_total_expense"] = round((item["total"] / total_beban) * 100.0, 1) if total_beban > 0 else 0.0

    for item in opex_items:
        item["percentage_of_group"] = round((item["total"] / subtotal_opex) * 100.0, 1) if subtotal_opex > 0 else 0.0
        item["percentage_of_total_expense"] = round((item["total"] / total_beban) * 100.0, 1) if total_beban > 0 else 0.0

    laba_rugi = {
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

    # Aset Tetap (Peralatan & Mesin)
    asset_line = next((item for item in all_account_lines if item["category"] == "Asset"), None)
    subtotal_aset_tetap = float(asset_line["total"]) if asset_line else 0.0
    aset_tetap = [
        {
            "account_code": "1-2100",
            "account_name": "Aset Tetap - Peralatan & Mesin",
            "group": "ASET_TETAP",
            "nominal": subtotal_aset_tetap,
            "description": "Belanja modal peralatan, showcase, oven, mixer",
        }
    ]

    total_aset = subtotal_aset_lancar + subtotal_aset_tetap

    # Kewajiban Lancar (Hutang Belanja Belum Lunas)
    list_hutang = cur_report.get("list_hutang", [])
    subtotal_kewajiban = sum(float(item.get("nominal", 0)) for item in list_hutang)
    kewajiban_lancar = [
        {
            "account_code": "2-1110",
            "account_name": "Hutang Usaha / Belanja Tempo",
            "group": "KEWAJIBAN",
            "nominal": subtotal_kewajiban,
            "description": f"{len(list_hutang)} transaksi belanja belum lunas / tempo ke supplier",
        }
    ]

    neraca = {
        "aset_lancar": aset_lancar,
        "subtotal_aset_lancar": subtotal_aset_lancar,
        "aset_tetap": aset_tetap,
        "subtotal_aset_tetap": subtotal_aset_tetap,
        "total_aset": total_aset,
        "kewajiban_lancar": kewajiban_lancar,
        "subtotal_kewajiban": subtotal_kewajiban,
        "detail_hutang": list_hutang,
    }

    # ─────────────────────────────────────────────────────────────
    # 3. LAPORAN ARUS KAS (CASH FLOW STATEMENT)
    # ─────────────────────────────────────────────────────────────
    # Arus Kas Operasi: Pengeluaran lunas untuk HPP dan OPEX
    arus_operasi = [
        {
            "activity": "Pengeluaran Kas untuk Pembelian Bahan Baku & HPP",
            "account_name": "Harga Pokok Penjualan",
            "nominal": subtotal_hpp,
            "percentage": round((subtotal_hpp / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        },
        {
            "activity": "Pengeluaran Kas untuk Operasional, Gaji, Sewa, & Utilitas",
            "account_name": "Beban Operasional (OPEX)",
            "nominal": subtotal_opex,
            "percentage": round((subtotal_opex / total_beban) * 100.0, 1) if total_beban > 0 else 0.0,
        },
    ]
    subtotal_arus_operasi = subtotal_hpp + subtotal_opex

    # Arus Kas Investasi: Pembelian Aset Tetap
    arus_investasi = [
        {
            "activity": "Pengeluaran Kas untuk Pembelian Aset Tetap & Peralatan",
            "account_name": "Belanja Modal (Capex)",
            "nominal": subtotal_aset_tetap,
            "percentage": 100.0 if subtotal_aset_tetap > 0 else 0.0,
        }
    ]
    subtotal_arus_investasi = subtotal_aset_tetap

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
        "year": cur_year,
        "month_name": cur_month_name,
        "prev_month_name": prev_month_name,
        "laba_rugi": laba_rugi,
        "neraca": neraca,
        "arus_kas": arus_kas,
        "analisis": analisis,
        "all_accounts": all_account_lines,
    }
