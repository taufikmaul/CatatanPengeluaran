"""
app/services/incoming_account_ai_service.py - Layanan Pemetaan Rekening Tujuan Transaksi Masuk berbasis AI.

Menganalisis kombinasi (order_type, payment_method) pada transaksi masuk terhadap daftar rekening aktif
dan preseden historis di database, lalu menghasilkan rekomendasi rekening tujuan yang tervalidasi.
"""
from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from typing import Any, Literal

import httpx
from sqlalchemy import and_, case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.bank_account import BankAccount
from app.models.incoming_transaction import IncomingTransaction
from app.services.bank_account_service import (
    _parse_mappings,
    normalize_channel_key,
)

logger = logging.getLogger(__name__)

MappingScope = Literal["unmapped", "all"]

_PLATFORM_KEYWORDS: dict[str, tuple[str, ...]] = {
    "gofood": ("gofood", "gobiz", "gopay", "gojek"),
    "grabfood": ("grabfood", "grab", "grabmerchant", "ovo"),
    "shopeefood": ("shopeefood", "shopee", "shopeepay", "spay"),
    "cash": ("cash", "tunai", "kas", "kasir", "laci", "petty"),
    "qris": ("qris", "qr"),
    "transfer": ("transfer", "trf", "tf", "va", "virtualaccount"),
    "edc": ("edc", "debit", "kredit", "kartu", "card"),
    "cakeflow": ("cakeflow",),
}

_BANK_BRANDS: tuple[str, ...] = (
    "bca",
    "mandiri",
    "bri",
    "bni",
    "bsi",
    "permata",
    "cimb",
    "danamon",
    "seabank",
    "jago",
    "gopay",
    "ovo",
    "dana",
    "shopeepay",
    "linkaja",
)


def make_group_key(order_type: str, payment_method: str) -> str:
    return f"{(order_type or '').strip()}||{(payment_method or '').strip()}"


def _clean_text(text: str | None) -> str:
    if not text:
        return ""
    cleaned = str(text).replace("\u2014", " - ").replace("\u2013", " - ").strip()
    return re.sub(r"\s+", " ", cleaned)


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    text = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()
    obj_match = re.search(r"\{[\s\S]*\}", text)
    candidate = obj_match.group(0) if obj_match else text
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def _account_searchable_text(acc: BankAccount) -> str:
    parts = [
        acc.name or "",
        acc.bank_name or "",
        acc.account_type or "",
        acc.notes or "",
        " ".join(_parse_mappings(acc.channel_mappings)),
    ]
    return " ".join(parts).lower()


def _heuristic_suggest_for_group(
    order_type: str,
    payment_method: str,
    accounts: list[BankAccount],
    historical_counts: dict[tuple[str, str], dict[int, int]],
) -> tuple[int | None, str, str]:
    """
    Rekomendasi deterministik sebagai fallback saat AI tidak tersedia atau gagal.
    Mengembalikan (bank_account_id | None, confidence, reason).
    """
    if not accounts:
        return None, "low", "Belum ada rekening aktif yang terdaftar."

    acc_by_id = {a.id: a for a in accounts}
    pm_raw = (payment_method or "").strip()
    ot_raw = (order_type or "").strip()
    pm_lower = pm_raw.lower()
    ot_lower = ot_raw.lower()
    pm_norm = normalize_channel_key(pm_raw)
    ot_norm = normalize_channel_key(ot_raw)

    # 1. Cocok langsung dengan channel_mappings yang dikonfigurasi pada rekening
    for acc in accounts:
        mappings = _parse_mappings(acc.channel_mappings)
        for m in mappings:
            m_lower = m.strip().lower()
            m_norm = normalize_channel_key(m)
            if not m_lower:
                continue
            if pm_lower == m_lower or (pm_norm and pm_norm == m_norm):
                return (
                    acc.id,
                    "high",
                    f"Metode pembayaran '{pm_raw}' cocok langsung dengan mapping channel rekening {acc.name}.",
                )
            if ot_lower == m_lower or (ot_norm and ot_norm == m_norm):
                return (
                    acc.id,
                    "high",
                    f"Tipe order '{ot_raw}' cocok langsung dengan mapping channel rekening {acc.name}.",
                )

    # 2. Substring match pada channel_mappings
    for acc in accounts:
        mappings = _parse_mappings(acc.channel_mappings)
        for m in mappings:
            m_norm = normalize_channel_key(m)
            if not m_norm or len(m_norm) < 3:
                continue
            if pm_norm and (m_norm in pm_norm or pm_norm in m_norm):
                return (
                    acc.id,
                    "high",
                    f"Metode pembayaran '{pm_raw}' sesuai dengan mapping '{m}' pada rekening {acc.name}.",
                )
            if ot_norm and (m_norm in ot_norm or ot_norm in m_norm):
                return (
                    acc.id,
                    "medium",
                    f"Tipe order '{ot_raw}' sesuai dengan mapping '{m}' pada rekening {acc.name}.",
                )

    # 3. Preseden historis dari transaksi yang sudah pernah dipetakan sebelumnya
    hist_key = (ot_lower, pm_lower)
    hist_map = historical_counts.get(hist_key, {})
    valid_hist = {aid: cnt for aid, cnt in hist_map.items() if aid in acc_by_id and cnt > 0}
    if valid_hist:
        total_hist = sum(valid_hist.values())
        best_id, best_cnt = max(valid_hist.items(), key=lambda x: x[1])
        ratio = best_cnt / total_hist if total_hist > 0 else 0.0
        if ratio >= 0.7:
            best_acc = acc_by_id[best_id]
            conf = "high" if best_cnt >= 3 and ratio >= 0.85 else "medium"
            return (
                best_id,
                conf,
                f"Mengikuti pola historis ({best_cnt} dari {total_hist} transaksi serupa masuk ke {best_acc.name}).",
            )

    # 4. Pencocokan semantik berdasarkan metode bayar, tipe order, nama bank, dan tipe akun
    combined_norm = f"{pm_norm} {ot_norm}"
    combined_lower = f"{pm_lower} {ot_lower}"

    # 4a. Cash / Tunai -> rekening bertipe cash
    if any(k in pm_lower for k in ("cash", "tunai")):
        cash_accounts = [a for a in accounts if a.account_type == "cash"]
        if not cash_accounts:
            cash_accounts = [
                a for a in accounts if any(k in _account_searchable_text(a) for k in _PLATFORM_KEYWORDS["cash"])
            ]
        if cash_accounts:
            target = cash_accounts[0]
            return (
                target.id,
                "high" if target.account_type == "cash" else "medium",
                f"Metode bayar '{pm_raw}' mengarah ke akun kas tunai {target.name}.",
            )

    # 4b. Platform aggregator (GoFood, GrabFood, ShopeeFood)
    for platform_key in ("gofood", "grabfood", "shopeefood"):
        kws = _PLATFORM_KEYWORDS[platform_key]
        if any(k in combined_norm for k in kws):
            scored: list[tuple[int, BankAccount]] = []
            for acc in accounts:
                search_txt = normalize_channel_key(_account_searchable_text(acc))
                score = 0
                if any(k in search_txt for k in kws):
                    score += 4
                if acc.account_type == "aggregator":
                    score += 1
                if score >= 4:
                    scored.append((score, acc))
            if scored:
                scored.sort(key=lambda x: (-x[0], x[1].sort_order, x[1].id))
                best = scored[0][1]
                return (
                    best.id,
                    "high",
                    f"Channel '{ot_raw}' / '{pm_raw}' cocok dengan rekening aggregator {best.name}.",
                )

    # 4c. Nama bank / e-wallet spesifik di metode bayar (BCA, Mandiri, BRI, BNI, OVO, GoPay, DANA, dll.)
    for brand in _BANK_BRANDS:
        if brand in pm_norm or brand in ot_norm:
            for acc in accounts:
                search_norm = normalize_channel_key(_account_searchable_text(acc))
                if brand in search_norm:
                    return (
                        acc.id,
                        "high",
                        f"Pembayaran '{pm_raw}' cocok langsung dengan rekening {acc.name} ({acc.bank_name}).",
                    )

    # 4d. QRIS -> cari akun yang menyebut QRIS atau rekening bank default/pertama
    if "qris" in pm_lower or "qris" in ot_lower:
        for acc in accounts:
            if "qris" in _account_searchable_text(acc):
                return (
                    acc.id,
                    "high",
                    f"Metode pembayaran QRIS cocok dengan rekening {acc.name}.",
                )
        default_bank = next((a for a in accounts if a.is_default and a.account_type == "bank"), None)
        first_bank = default_bank or next((a for a in accounts if a.account_type == "bank"), None)
        if first_bank:
            return (
                first_bank.id,
                "medium",
                f"Pembayaran QRIS diarahkan ke rekening bank utama {first_bank.name}. Mohon verifikasi sebelum diterapkan.",
            )

    # 4e. Transfer / EDC / Debit / Kredit -> rekening bank
    if any(k in combined_lower for k in ("transfer", "edc", "debit", "kredit", "va", "bank")):
        default_bank = next((a for a in accounts if a.is_default and a.account_type == "bank"), None)
        first_bank = default_bank or next((a for a in accounts if a.account_type == "bank"), None)
        if first_bank:
            return (
                first_bank.id,
                "medium",
                f"Pembayaran non-tunai '{pm_raw}' diarahkan ke rekening bank {first_bank.name}.",
            )

    # 5. Rekening default sebagai fallback rendah
    default_acc = next((a for a in accounts if a.is_default), None)
    if default_acc:
        return (
            default_acc.id,
            "low",
            f"Tidak ditemukan kecocokan spesifik untuk '{ot_raw} / {pm_raw}', diarahkan ke rekening default {default_acc.name}.",
        )

    return (
        None,
        "low",
        f"Belum ditemukan rekening yang cocok untuk '{ot_raw} / {pm_raw}'. Pilih rekening secara manual.",
    )


async def _call_llm_for_account_mapping(
    accounts: list[BankAccount],
    groups: list[dict[str, Any]],
    historical_counts: dict[tuple[str, str], dict[int, int]],
) -> tuple[dict[str, dict[str, Any]] | None, str | None, str | None]:
    """
    Panggil LLM untuk memetakan setiap kombinasi (order_type, payment_method) ke bank_account_id.
    Mengembalikan (parsed_map_by_group_key | None, model_used | None, error_reason | None).
    """
    api_key = (settings.ai_analysis_api_key or settings.sumopod_api_key or "").strip()
    url = (settings.ai_analysis_url if settings.ai_analysis_api_key else settings.sumopod_url).strip()
    model = (settings.ai_analysis_model if settings.ai_analysis_api_key else settings.sumopod_model).strip()

    if not api_key or not url or not model:
        return None, None, "Kunci API AI belum dikonfigurasi, menggunakan aturan pencocokan otomatis."

    acc_by_id = {a.id: a for a in accounts}
    accounts_payload = [
        {
            "id": a.id,
            "name": a.name,
            "bank_name": a.bank_name,
            "account_type": a.account_type,
            "channel_mappings": _parse_mappings(a.channel_mappings),
            "notes": (a.notes or "")[:160],
            "is_default": bool(a.is_default),
        }
        for a in accounts
    ]

    groups_payload = []
    for g in groups:
        hist_raw = historical_counts.get((g["order_type"].lower(), g["payment_method"].lower()), {})
        hist_summary = [
            {
                "bank_account_id": aid,
                "bank_account_name": acc_by_id[aid].name,
                "count": cnt,
            }
            for aid, cnt in sorted(hist_raw.items(), key=lambda x: -x[1])
            if aid in acc_by_id
        ][:3]
        groups_payload.append(
            {
                "group_key": g["group_key"],
                "order_type": g["order_type"],
                "payment_method": g["payment_method"],
                "tx_count": g["tx_count"],
                "unmapped_count": g["unmapped_count"],
                "historical_precedents": hist_summary,
            }
        )

    system_prompt = (
        "Anda adalah asisten akuntansi dan rekonsiliasi POS untuk toko kue Historycake. "
        "Tugas Anda adalah memetakan setiap kombinasi (order_type, payment_method) transaksi penjualan masuk "
        "ke rekening tujuan (bank_account_id) yang paling tepat dari daftar rekening aktif yang diberikan.\n\n"
        "Aturan Wajib:\n"
        "1. HANYA gunakan bank_account_id yang ada persis pada daftar 'accounts', atau null jika benar-benar tidak ada rekening yang cocok.\n"
        "2. Dilarang mengarang ID atau nama rekening di luar daftar.\n"
        "3. Pertimbangkan KEDUA kolom 'order_type' dan 'payment_method' secara bersamaan. Contoh:\n"
        "   - Take Away + Cash/Tunai -> akun kas tunai (account_type='cash').\n"
        "   - Take Away + QRIS / Transfer / EDC -> akun bank atau QRIS yang sesuai.\n"
        "   - ShopeeFood / GoFood / GrabFood -> akun aggregator/dompet platform terkait (misal ShopeeFood/ShopeePay, GoBiz/GoPay, GrabMerchant/OVO) jika tersedia, atau rekening bank settlement jika tidak ada akun aggregator.\n"
        "   - Cakeflow / Custom Order -> sesuaikan dengan metode pembayaran (misal Transfer BCA -> BCA, QRIS -> rekening QRIS/Bank, Tunai -> Kas).\n"
        "4. Hormati 'channel_mappings' pada akun dan 'historical_precedents' bila konsisten.\n"
        "5. Nilai 'confidence' wajib salah satu dari: 'high', 'medium', 'low'.\n"
        "6. Tulis 'reason' singkat (maks 1 kalimat Bahasa Indonesia jelas, tanpa karakter em dash).\n"
        "7. Kembalikan HANYA JSON murni valid dengan format:\n"
        '{"mappings":[{"group_key":"...","bank_account_id":1,"confidence":"high","reason":"..."}]}'
    )

    user_prompt = json.dumps(
        {
            "accounts": accounts_payload,
            "groups": groups_payload,
        },
        ensure_ascii=False,
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            res = await client.post(url, json=payload, headers=headers)
            if res.status_code != 200:
                logger.warning("AI account mapping API status %s: %s", res.status_code, res.text[:300])
                return None, model, f"Layanan AI mengembalikan status {res.status_code}, menggunakan pencocokan aturan lokal."
            data = res.json()
            raw_content = data["choices"][0]["message"]["content"]
            parsed = _extract_json_object(raw_content)
            if not parsed or not isinstance(parsed.get("mappings"), list):
                return None, model, "Format respons AI tidak valid, menggunakan pencocokan aturan lokal."

            result_map: dict[str, dict[str, Any]] = {}
            for item in parsed["mappings"]:
                if not isinstance(item, dict):
                    continue
                gkey = str(item.get("group_key") or "").strip()
                if not gkey:
                    continue
                raw_id = item.get("bank_account_id")
                validated_id: int | None = None
                if raw_id is not None and str(raw_id).strip() != "":
                    try:
                        cand_id = int(raw_id)
                        if cand_id in acc_by_id:
                            validated_id = cand_id
                    except (TypeError, ValueError):
                        validated_id = None

                conf = str(item.get("confidence") or "medium").strip().lower()
                if conf not in ("high", "medium", "low"):
                    conf = "medium"
                reason = _clean_text(item.get("reason")) or "Rekomendasi AI berdasarkan tipe order dan metode pembayaran."
                result_map[gkey] = {
                    "bank_account_id": validated_id,
                    "confidence": conf,
                    "reason": reason[:220],
                }
            return result_map, model, None
    except Exception as exc:
        logger.warning("AI account mapping fallback triggered: %s", exc)
        return None, model, "Koneksi ke layanan AI tidak tersedia, menggunakan pencocokan aturan lokal."


async def preview_ai_account_mappings(
    db: AsyncSession,
    where_clause: Any,
    scope: MappingScope = "unmapped",
) -> dict[str, Any]:
    """
    Kumpulkan kombinasi unik (order_type, payment_method) pada transaksi masuk yang cocok dengan filter,
    lalu hasilkan rekomendasi rekening tujuan menggunakan AI (dengan fallback heuristik yang aman).
    """
    acc_res = await db.execute(
        select(BankAccount)
        .where(BankAccount.is_active == True)  # noqa: E712
        .order_by(BankAccount.sort_order.asc(), BankAccount.id.asc())
    )
    accounts = list(acc_res.scalars().all())
    acc_by_id = {a.id: a for a in accounts}

    target_where = (
        and_(where_clause, IncomingTransaction.bank_account_id.is_(None))
        if scope == "unmapped"
        else where_clause
    )

    group_stmt = (
        select(
            IncomingTransaction.order_type,
            IncomingTransaction.payment_method,
            func.count(IncomingTransaction.id).label("tx_count"),
            func.coalesce(
                func.sum(case((IncomingTransaction.bank_account_id.is_(None), 1), else_=0)),
                0,
            ).label("unmapped_count"),
            func.coalesce(
                func.sum(
                    case(
                        (IncomingTransaction.status == "paid", IncomingTransaction.net_received),
                        else_=0.0,
                    )
                ),
                0.0,
            ).label("total_net_received"),
        )
        .where(target_where)
        .group_by(IncomingTransaction.order_type, IncomingTransaction.payment_method)
        .order_by(func.count(IncomingTransaction.id).desc(), IncomingTransaction.order_type.asc())
    )
    group_rows = (await db.execute(group_stmt)).fetchall()

    if not group_rows:
        return {
            "engine": "rules_fallback",
            "model": None,
            "fallback_reason": None,
            "scope": scope,
            "has_active_accounts": len(accounts) > 0,
            "total_groups": 0,
            "total_transactions": 0,
            "suggested_groups": 0,
            "suggestions": [],
        }

    # Cek rekening yang saat ini terpasang pada tiap grup (bermanfaat saat scope='all')
    current_acc_map: dict[tuple[str, str], set[str]] = defaultdict(set)
    if scope == "all":
        cur_stmt = (
            select(
                IncomingTransaction.order_type,
                IncomingTransaction.payment_method,
                IncomingTransaction.bank_account_id,
            )
            .where(and_(target_where, IncomingTransaction.bank_account_id.is_not(None)))
            .distinct()
        )
        for ot_v, pm_v, aid in (await db.execute(cur_stmt)).fetchall():
            if aid in acc_by_id:
                current_acc_map[(ot_v or "", pm_v or "")].add(acc_by_id[aid].name)

    # Preseden historis dari seluruh transaksi yang sudah dipetakan di DB
    hist_stmt = (
        select(
            func.lower(IncomingTransaction.order_type),
            func.lower(IncomingTransaction.payment_method),
            IncomingTransaction.bank_account_id,
            func.count(IncomingTransaction.id),
        )
        .where(IncomingTransaction.bank_account_id.is_not(None))
        .group_by(
            func.lower(IncomingTransaction.order_type),
            func.lower(IncomingTransaction.payment_method),
            IncomingTransaction.bank_account_id,
        )
    )
    historical_counts: dict[tuple[str, str], dict[int, int]] = defaultdict(dict)
    for ot_l, pm_l, aid, cnt in (await db.execute(hist_stmt)).fetchall():
        if aid is not None:
            historical_counts[((ot_l or "").strip(), (pm_l or "").strip())][int(aid)] = int(cnt or 0)

    groups_meta: list[dict[str, Any]] = []
    for ot_v, pm_v, tx_cnt, unmapped_cnt, total_net in group_rows:
        ot_clean = (ot_v or "").strip()
        pm_clean = (pm_v or "").strip()
        groups_meta.append(
            {
                "group_key": make_group_key(ot_clean, pm_clean),
                "order_type": ot_clean,
                "payment_method": pm_clean,
                "tx_count": int(tx_cnt or 0),
                "unmapped_count": int(unmapped_cnt or 0),
                "total_net_received": round(float(total_net or 0.0), 2),
                "current_account_names": sorted(current_acc_map.get((ot_v or "", pm_v or ""), set())),
            }
        )

    if not accounts:
        return {
            "engine": "rules_fallback",
            "model": None,
            "fallback_reason": "Belum ada rekening aktif. Tambahkan rekening di menu Pengaturan Rekening terlebih dahulu.",
            "scope": scope,
            "has_active_accounts": False,
            "total_groups": len(groups_meta),
            "total_transactions": sum(g["tx_count"] for g in groups_meta),
            "suggested_groups": 0,
            "suggestions": [
                {
                    **g,
                    "suggested_bank_account_id": None,
                    "suggested_bank_account_name": None,
                    "confidence": "low",
                    "reason": "Belum ada rekening aktif yang tersedia untuk dipetakan.",
                }
                for g in groups_meta
            ],
        }

    llm_map, model_used, fallback_reason = await _call_llm_for_account_mapping(
        accounts=accounts,
        groups=groups_meta,
        historical_counts=historical_counts,
    )
    engine = "ai" if llm_map is not None else "rules_fallback"

    suggestions: list[dict[str, Any]] = []
    suggested_groups = 0
    for g in groups_meta:
        gkey = g["group_key"]
        if llm_map is not None and gkey in llm_map:
            entry = llm_map[gkey]
            acc_id = entry["bank_account_id"]
            confidence = entry["confidence"]
            reason = entry["reason"]
        else:
            acc_id, confidence, reason = _heuristic_suggest_for_group(
                g["order_type"],
                g["payment_method"],
                accounts,
                historical_counts,
            )

        acc_name = acc_by_id[acc_id].name if acc_id is not None and acc_id in acc_by_id else None
        if acc_id is not None:
            suggested_groups += 1

        suggestions.append(
            {
                **g,
                "suggested_bank_account_id": acc_id,
                "suggested_bank_account_name": acc_name,
                "confidence": confidence,
                "reason": reason,
            }
        )

    return {
        "engine": engine,
        "model": model_used if engine == "ai" else None,
        "fallback_reason": fallback_reason,
        "scope": scope,
        "has_active_accounts": True,
        "total_groups": len(suggestions),
        "total_transactions": sum(g["tx_count"] for g in suggestions),
        "suggested_groups": suggested_groups,
        "suggestions": suggestions,
    }


async def apply_ai_account_mappings(
    db: AsyncSession,
    where_clause: Any,
    scope: MappingScope,
    mappings: list[dict[str, Any]],
    save_channel_mappings: bool = False,
) -> dict[str, Any]:
    """
    Terapkan pemetaan (order_type, payment_method) -> bank_account_id ke transaksi masuk yang cocok.
    Jika save_channel_mappings=True, simpan kunci metode bayar yang tidak ambigu ke BankAccount.channel_mappings.
    """
    if not mappings:
        return {
            "updated_transactions": 0,
            "applied_groups": 0,
            "updated_accounts": 0,
            "saved_mappings": [],
        }

    # Validasi seluruh bank_account_id terlebih dahulu
    requested_acc_ids = {int(m["bank_account_id"]) for m in mappings if m.get("bank_account_id") is not None}
    acc_res = await db.execute(select(BankAccount).where(BankAccount.id.in_(requested_acc_ids)))
    found_accounts = {a.id: a for a in acc_res.scalars().all()}
    missing_ids = sorted(requested_acc_ids - set(found_accounts.keys()))
    if missing_ids:
        raise ValueError(f"Rekening tujuan tidak ditemukan (ID: {', '.join(map(str, missing_ids))}).")

    base_where = (
        and_(where_clause, IncomingTransaction.bank_account_id.is_(None))
        if scope == "unmapped"
        else where_clause
    )

    updated_transactions = 0
    applied_groups = 0

    for item in mappings:
        ot = (item.get("order_type") or "").strip()
        pm = (item.get("payment_method") or "").strip()
        acc_id = int(item["bank_account_id"])
        stmt = (
            update(IncomingTransaction)
            .where(
                and_(
                    base_where,
                    IncomingTransaction.order_type == ot,
                    IncomingTransaction.payment_method == pm,
                )
            )
            .values(bank_account_id=acc_id)
        )
        res = await db.execute(stmt)
        rowcount = int(res.rowcount or 0)
        updated_transactions += rowcount
        if rowcount > 0:
            applied_groups += 1

    updated_accounts = 0
    saved_mappings: list[dict[str, Any]] = []

    if save_channel_mappings:
        # Hanya simpan payment_method yang memetakan secara unik ke 1 rekening (hindari konflik antar tipe order)
        pm_targets: dict[str, set[int]] = defaultdict(set)
        pm_original_label: dict[str, str] = {}
        ot_targets: dict[str, set[int]] = defaultdict(set)
        ot_original_label: dict[str, str] = {}

        for item in mappings:
            pm = (item.get("payment_method") or "").strip()
            ot = (item.get("order_type") or "").strip()
            acc_id = int(item["bank_account_id"])
            if pm:
                pm_key = pm.lower()
                pm_targets[pm_key].add(acc_id)
                pm_original_label.setdefault(pm_key, pm)
            if ot:
                ot_key = ot.lower()
                ot_targets[ot_key].add(acc_id)
                ot_original_label.setdefault(ot_key, ot)

        additions_by_acc: dict[int, list[str]] = defaultdict(list)
        for pm_key, target_ids in pm_targets.items():
            if len(target_ids) == 1:
                aid = next(iter(target_ids))
                additions_by_acc[aid].append(pm_original_label[pm_key])

        # Untuk tipe order platform spesifik (GoFood/GrabFood/ShopeeFood/Cakeflow) yang unik ke 1 rekening
        platform_markers = ("gofood", "grabfood", "shopeefood", "cakeflow")
        for ot_key, target_ids in ot_targets.items():
            ot_norm = normalize_channel_key(ot_key)
            if len(target_ids) == 1 and any(marker in ot_norm for marker in platform_markers):
                aid = next(iter(target_ids))
                additions_by_acc[aid].append(ot_original_label[ot_key])

        for aid, new_labels in additions_by_acc.items():
            acc = found_accounts.get(aid)
            if not acc:
                continue
            existing = _parse_mappings(acc.channel_mappings)
            existing_lower = {e.strip().lower() for e in existing}
            added_for_acc: list[str] = []
            for label in new_labels:
                if label.strip().lower() not in existing_lower:
                    existing.append(label.strip())
                    existing_lower.add(label.strip().lower())
                    added_for_acc.append(label.strip())
            if added_for_acc:
                acc.channel_mappings = json.dumps(existing)
                updated_accounts += 1
                saved_mappings.append(
                    {
                        "bank_account_id": acc.id,
                        "bank_account_name": acc.name,
                        "added_channels": added_for_acc,
                    }
                )

    await db.commit()
    return {
        "updated_transactions": updated_transactions,
        "applied_groups": applied_groups,
        "updated_accounts": updated_accounts,
        "saved_mappings": saved_mappings,
    }
