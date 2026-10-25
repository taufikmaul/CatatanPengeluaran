"""
app/services/ai_analysis_service.py - AI Financial Analysis Service
Menghasilkan analisis keuangan cerdas, deteksi lonjakan harga, evaluasi anggaran,
dan rekomendasi efisiensi operasional untuk Historycake.
"""
import json
import logging
import re
import time
from datetime import datetime
from typing import Any
import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.expense_service import (
    get_monthly_report,
    get_monthly_chart_data,
    get_monthly_leaderboards,
)
from app.utils.formatters import fmt_rupiah

logger = logging.getLogger(__name__)

# Cache in-memory: {(year, month): (timestamp, result_dict)}
_CACHE_TTL_SECONDS = 3600  # 1 jam
_analysis_cache: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}

MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


def clear_analysis_cache(year: int | None = None, month: int | None = None) -> None:
    """Kosongkan cache analisis (semua atau per bulan)."""
    global _analysis_cache
    if year and month:
        _analysis_cache.pop((year, month), None)
    else:
        _analysis_cache.clear()


async def generate_ai_analysis(
    db: AsyncSession,
    year: int,
    month: int,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """
    Generate analisis keuangan berbasis AI untuk bulan dan tahun yang dipilih.
    Menggunakan caching in-memory kecuali force_refresh=True.
    """
    cache_key = (year, month)
    now_ts = time.time()

    if not force_refresh and cache_key in _analysis_cache:
        cached_time, cached_data = _analysis_cache[cache_key]
        if now_ts - cached_time < _CACHE_TTL_SECONDS:
            result = dict(cached_data)
            result["cached"] = True
            return result

    # 1. Kumpulkan data finansial aktual dari database
    financial_data = await _aggregate_financial_data(db, year, month)

    # 2. Panggil AI untuk mendapatkan analisis mendalam
    analysis_result = await _call_ai_engine(financial_data)

    analysis_result["month"] = month
    analysis_result["year"] = year
    analysis_result["month_name"] = MONTH_NAMES[month - 1]
    analysis_result["analyzed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    analysis_result["cached"] = False

    # Simpan ke cache
    _analysis_cache[cache_key] = (now_ts, analysis_result)
    return analysis_result


async def _aggregate_financial_data(
    db: AsyncSession, year: int, month: int
) -> dict[str, Any]:
    """Kompilasi ringkasan data finansial bulan berjalan dan komparasi bulan lalu."""
    report = await get_monthly_report(db, year, month)
    leaderboards = await get_monthly_leaderboards(db, year, month)

    # Hitung bulan lalu
    if month == 1:
        prev_m, prev_y = 12, year - 1
    else:
        prev_m, prev_y = month - 1, year
    prev_report = await get_monthly_report(db, prev_y, prev_m)

    total_lunas = float(report.get("total_lunas", 0.0))
    list_hutang = report.get("list_hutang", [])
    total_hutang = sum(float(item.get("nominal", 0)) for item in list_hutang)
    total_pengeluaran = total_lunas + total_hutang

    prev_lunas = float(prev_report.get("total_lunas", 0.0))
    prev_hutang = sum(float(item.get("nominal", 0)) for item in prev_report.get("list_hutang", []))
    prev_total = prev_lunas + prev_hutang

    mom_diff = total_pengeluaran - prev_total
    mom_pct = round((mom_diff / prev_total) * 100.0, 1) if prev_total > 0 else 0.0

    # Anggaran
    from app.services.budget_service import get_effective_budget
    eff_budget = await get_effective_budget(db, year, month)
    cat_budgets = eff_budget.get("category_amounts", {})
    budget_limit = float(eff_budget.get("total_budget", 0))
    budget_used_pct = round((total_pengeluaran / budget_limit) * 100.0, 1) if budget_limit > 0 else None

    # Overbudget kategori
    per_kategori = report.get("per_kategori", {})
    overbudget_categories = []
    for cat, spent in per_kategori.items():
        limit = cat_budgets.get(cat, 0.0)
        if limit > 0 and spent > limit:
            overbudget_categories.append({
                "category": cat,
                "spent": spent,
                "budget": limit,
                "over_nominal": spent - limit,
                "over_pct": round(((spent - limit) / limit) * 100.0, 1),
            })

    return {
        "month": month,
        "year": year,
        "month_name": MONTH_NAMES[month - 1],
        "total_lunas": total_lunas,
        "total_hutang": total_hutang,
        "total_pengeluaran": total_pengeluaran,
        "expense_count": report.get("expense_count", 0),
        "prev_month_name": MONTH_NAMES[prev_m - 1],
        "prev_total_pengeluaran": prev_total,
        "mom_diff": mom_diff,
        "mom_pct": mom_pct,
        "budget_limit": budget_limit,
        "budget_used_pct": budget_used_pct,
        "per_kategori": per_kategori,
        "overbudget_categories": overbudget_categories,
        "unpaid_count": len(list_hutang),
        "unpaid_samples": [
            {
                "barang": h.get("barang"),
                "nominal": h.get("nominal"),
                "tempo": h.get("jatuh_tempo", "-"),
            }
            for h in list_hutang[:5]
        ],
        "reimburse_pending_count": int(report.get("reimburse_pending_count", 0)),
        "reimburse_pending_total": float(report.get("reimburse_pending_total", 0.0)),
        "top_expensive_items": leaderboards.get("top_expensive_items", [])[:5],
        "top_frequent_items": leaderboards.get("top_frequent_items", [])[:5],
        "top_price_spikes": leaderboards.get("top_price_spikes", [])[:5],
        "top_suppliers": leaderboards.get("top_suppliers", [])[:5],
    }


async def _call_ai_engine(data: dict[str, Any]) -> dict[str, Any]:
    """Mengirim prompt ke AI endpoint dan memproses respons."""
    api_key = settings.ai_analysis_api_key or settings.sumopod_api_key
    url = settings.ai_analysis_url or settings.sumopod_url
    model = settings.ai_analysis_model or settings.sumopod_model

    prompt = _build_prompt(data)

    messages = [
        {
            "role": "system",
            "content": (
                "Anda adalah Chief Financial Officer (CFO) dan konsultan bisnis F&B senior untuk toko kue Historycake. "
                "Tugas Anda adalah mengevaluasi data pengeluaran aktual secara tajam, realistis, dan memberikan rekomendasi praktis. "
                "Gunakan Bahasa Indonesia yang profesional, ringkas, dan jelas. Hindari bahasa berlebihan atau kata klise. "
                "Jangan gunakan karakter em dash. Format jawaban wajib berupa JSON murni."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            if response.status_code != 200:
                logger.error(f"AI API error status {response.status_code}: {response.text}")
                return _build_fallback_analysis(data)

            res_json = response.json()
            raw_content = res_json["choices"][0]["message"]["content"]
            parsed = _extract_json_from_response(raw_content)
            if parsed:
                return _normalize_analysis_dict(parsed, data)

    except Exception as e:
        logger.warning(f"Gagal memanggil AI Engine ({e}), menggunakan analisis aturan bawaan.")

    return _build_fallback_analysis(data)


def _build_prompt(data: dict[str, Any]) -> str:
    """Susun prompt analisis keuangan dengan konteks angka toko kue."""
    cat_summary = "\n".join(
        f"- {k}: {fmt_rupiah(v)}" for k, v in data["per_kategori"].items()
    ) or "- Belum ada data kategori"

    expensive_summary = "\n".join(
        f"- {item.get('item_name')} ({item.get('category')}): total {fmt_rupiah(item.get('total_spent', 0))} ({item.get('percentage', 0)}%)"
        for item in data["top_expensive_items"]
    ) or "- Belum ada data"

    spike_summary = "\n".join(
        f"- {s.get('item_name')}: {fmt_rupiah(s.get('previous_price', 0))} -> {fmt_rupiah(s.get('current_price', 0))} (+{s.get('percent_change', 0)}%) di {s.get('supplier', '-')}"
        for s in data["top_price_spikes"]
    ) or "- Tidak ada lonjakan harga signifikan tercatat"

    overbudget_summary = "\n".join(
        f"- {o['category']}: Aktual {fmt_rupiah(o['spent'])} vs Budget {fmt_rupiah(o['budget'])} (+{o['over_pct']}%)"
        for o in data["overbudget_categories"]
    ) or "- Semua kategori dalam batas anggaran"

    budget_info = (
        f"Limit Anggaran Bulanan: {fmt_rupiah(data['budget_limit'])}, Terpakai: {data['budget_used_pct']}%"
        if data["budget_limit"] > 0
        else "Limit Anggaran Bulanan belum disetel."
    )

    return f"""Berikut adalah data real pengeluaran toko kue Historycake periode {data['month_name']} {data['year']}:

1. RINGKASAN TOTAL:
- Total Pengeluaran: {fmt_rupiah(data['total_pengeluaran'])} ({data['expense_count']} transaksi)
- Lunas: {fmt_rupiah(data['total_lunas'])}
- Belum Lunas / Tempo: {fmt_rupiah(data['total_hutang'])} ({data['unpaid_count']} tagihan)
- Komparasi MoM ({data['prev_month_name']}): Perubahan {data['mom_pct']}% ({fmt_rupiah(data['mom_diff'])})
- Status Anggaran: {budget_info}
- Reimbursement / Talangan Karyawan Tertunda: {data['reimburse_pending_count']} item ({fmt_rupiah(data['reimburse_pending_total'])})

2. PENGELUARAN PER KATEGORI:
{cat_summary}

3. KATEGORI OVERBUDGET:
{overbudget_summary}

4. 5 BARANG DENGAN BIAYA TERBESAR BULAN INI:
{expensive_summary}

5. LONJAKAN HARGA BAHAN TERDETEKSI:
{spike_summary}

TUGAS ANDA:
Analisis kondisi keuangan ini dan berikan output dalam format JSON valid dengan struktur persis berikut:
{{
  "health_status": "SEHAT" | "PERLU_PERHATIAN" | "KRITIS",
  "health_score": <skor integer 1 sampai 100>,
  "summary": "<Paragraf ringkasan eksekutif 3-4 kalimat tentang kondisi pengeluaran bulan ini>",
  "key_insights": [
    "<Poin observasi penting 1>",
    "<Poin observasi penting 2>",
    "<Poin observasi penting 3>"
  ],
  "budget_analysis": "<Ulasan mendalam terkait serapan anggaran, kategori boros, dan arus kas>",
  "price_alerts": [
    "<Peringatan lonjakan harga atau bahan yang perlu dievaluasi vendornya>"
  ],
  "actionable_recommendations": [
    "<Saran tindakan konkret 1 (misal negosiasi vendor, batching belanja)>",
    "<Saran tindakan konkret 2>",
    "<Saran tindakan konkret 3>"
  ],
  "markdown_report": "<Laporan lengkap berformat Markdown rapi dengan judul sub-bagian yang terstruktur>"
}}

ATURAN WAJIB:
- Jangan gunakan karakter em dash. Gunakan koma, titik dua, atau tanda kurung.
- Berikan penilaian realistis berdasarkan angka di atas.
- Keluarkan HANYA JSON VALID tanpa pembungkus teks tambahan."""


def _extract_json_from_response(raw: str) -> dict[str, Any] | None:
    """Ekstrak objek JSON dari respons string model."""
    try:
        # Coba parsing langsung
        return json.loads(raw.strip())
    except Exception:
        pass

    # Coba ekstrak dari code block ```json ... ```
    match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            pass

    # Regex fallback pencarian kurung kurawal terluar
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass

    return None


def _normalize_analysis_dict(parsed: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    """Pastikan tipe data dan format respons AI konsisten."""
    health_status = str(parsed.get("health_status", "PERLU_PERHATIAN")).upper()
    if health_status not in ("SEHAT", "PERLU_PERHATIAN", "KRITIS"):
        health_status = "PERLU_PERHATIAN"

    health_score = parsed.get("health_score", 75)
    try:
        health_score = int(health_score)
        health_score = max(1, min(100, health_score))
    except Exception:
        health_score = 75

    summary = str(parsed.get("summary", "")).strip() or "Pengeluaran operasional toko kue bulan ini terpantau aktif."
    key_insights = parsed.get("key_insights") or []
    if isinstance(key_insights, str):
        key_insights = [key_insights]

    budget_analysis = str(parsed.get("budget_analysis", "")).strip()
    price_alerts = parsed.get("price_alerts") or []
    if isinstance(price_alerts, str):
        price_alerts = [price_alerts]

    actionable_recommendations = parsed.get("actionable_recommendations") or []
    if isinstance(actionable_recommendations, str):
        actionable_recommendations = [actionable_recommendations]

    markdown_report = str(parsed.get("markdown_report", "")).strip()
    if not markdown_report:
        markdown_report = _compose_markdown(summary, key_insights, budget_analysis, price_alerts, actionable_recommendations)

    return {
        "ok": True,
        "health_status": health_status,
        "health_score": health_score,
        "summary": summary,
        "key_insights": [str(x) for x in key_insights],
        "budget_analysis": budget_analysis,
        "price_alerts": [str(x) for x in price_alerts],
        "actionable_recommendations": [str(x) for x in actionable_recommendations],
        "markdown_report": markdown_report,
    }


def _build_fallback_analysis(data: dict[str, Any]) -> dict[str, Any]:
    """Analisis cadangan otomatis saat koneksi AI tidak tersedia."""
    total = data["total_pengeluaran"]
    mom_pct = data["mom_pct"]
    unpaid = data["total_hutang"]
    overbudget = data["overbudget_categories"]

    score = 80
    reasons = []

    if mom_pct > 20:
        score -= 15
        reasons.append(f"Pengeluaran naik signifikan +{mom_pct}% dibanding bulan lalu.")
    elif mom_pct < -5:
        score += 5

    if overbudget:
        score -= min(25, len(overbudget) * 10)
        reasons.append(f"Terdapat {len(overbudget)} kategori yang melebihi pagu anggaran.")

    if unpaid > 0 and total > 0 and (unpaid / total) > 0.25:
        score -= 15
        reasons.append(f"Porsi hutang tempo cukup tinggi ({fmt_rupiah(unpaid)}).")

    score = max(20, min(95, score))

    if score >= 75:
        status = "SEHAT"
    elif score >= 50:
        status = "PERLU_PERHATIAN"
    else:
        status = "KRITIS"

    summary = (
        f"Total pengeluaran tercatat {fmt_rupiah(total)} pada {data['month_name']} {data['year']}. "
        f"Tren bulanan tercatat {('naik +' + str(mom_pct) + '%') if mom_pct >= 0 else ('turun ' + str(mom_pct) + '%')} "
        f"dibandingkan {data['prev_month_name']}. Arus kas dan alokasi bahan baku perlu dipantau secara berkala."
    )

    insights = [
        f"Kategori Bahan Baku dan Kemasan memegang porsi terbesar dalam operasional toko.",
        f"Terdapat {data['unpaid_count']} tagihan tempo senilai {fmt_rupiah(unpaid)} yang perlu diperhatikan tanggal jatuh temponya.",
    ]
    if reasons:
        insights.extend(reasons)

    price_alerts = []
    for sp in data["top_price_spikes"]:
        price_alerts.append(
            f"Lonjakan harga {sp.get('item_name')}: {fmt_rupiah(sp.get('previous_price', 0))} ke {fmt_rupiah(sp.get('current_price', 0))} (+{sp.get('percent_change', 0)}%) di {sp.get('supplier', '-')}"
        )
    if not price_alerts:
        price_alerts.append("Fluktuasi harga satuan bahan terpantau relatif stabil dalam batas wajar.")

    recommendations = [
        "Lakukan konsolidasi pembelian bahan utama dengan supplier untuk mendapatkan diskon kuantitas.",
        "Prioritaskan pelunasan tagihan tempo yang mendekati batas jatuh tempo.",
        "Pantau pemakaian bahan kemasan agar tidak terjadi penumpukan stok berlebih.",
    ]

    budget_text = (
        f"Penggunaan anggaran bulan ini mencapai {data['budget_used_pct'] or 0}% dari batas yang ditetapkan."
        if data["budget_limit"] > 0
        else "Batas anggaran bulanan belum disetel secara spesifik."
    )

    markdown = _compose_markdown(summary, insights, budget_text, price_alerts, recommendations)

    return {
        "ok": True,
        "health_status": status,
        "health_score": score,
        "summary": summary,
        "key_insights": insights,
        "budget_analysis": budget_text,
        "price_alerts": price_alerts,
        "actionable_recommendations": recommendations,
        "markdown_report": markdown,
    }


def _compose_markdown(
    summary: str,
    insights: list[str],
    budget: str,
    alerts: list[str],
    recommendations: list[str],
) -> str:
    """Susun teks markdown komprehensif tanpa em dash."""
    md = f"### Ringkasan Eksekutif\n\n{summary}\n\n"
    if insights:
        md += "### Poin Utama Observasi\n\n"
        for i in insights:
            md += f"- {i}\n"
        md += "\n"
    if budget:
        md += f"### Analisis Anggaran & Arus Kas\n\n{budget}\n\n"
    if alerts:
        md += "### Peringatan & Dinamika Harga\n\n"
        for a in alerts:
            md += f"- {a}\n"
        md += "\n"
    if recommendations:
        md += "### Rekomendasi Langkah Penghematan\n\n"
        for idx, r in enumerate(recommendations, 1):
            md += f"{idx}. {r}\n"
    return md
