"""
app/services/incoming_duplicate_audit_service.py - Analisa & Pembersihan Duplikat Transaksi Masuk.

Mendeteksi transaksi masuk (IncomingTransaction) yang tercatat ganda berdasarkan:
1. Nomor struk (receipt_no) identik lintas sumber atau variasi spasi/huruf.
2. Nomor order (order_no) identik.
3. Tanggal, waktu (<= 60 detik), tipe order, metode pembayaran, dan nominal identik.
4. Sidik jari harian (tanggal + tipe order + metode bayar + nominal identik) dengan sinyal kuat
   seperti pelanggan sama, rincian produk identik, atau beda sumber (mis. manual vs POS).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
import re
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.incoming_transaction import IncomingTransaction


def _norm_token(value: str | None) -> str:
    clean = (value or "").strip().lower()
    if clean in ("", "-", "n/a", "none", "null"):
        return ""
    return re.sub(r"\s+", "", clean)


def _norm_label(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _parse_time_seconds(time_str: str | None) -> int | None:
    if not time_str:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", str(time_str))
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2))
    ss = int(m.group(3) or 0)
    if not (0 <= hh <= 23 and 0 <= mm <= 59 and 0 <= ss <= 59):
        return None
    return hh * 3600 + mm * 60 + ss


def _amounts_match(a: IncomingTransaction, b: IncomingTransaction, tol: float = 1.0) -> bool:
    gross_diff = abs(float(a.gross_sales or 0.0) - float(b.gross_sales or 0.0))
    net_diff = abs(float(a.net_received or 0.0) - float(b.net_received or 0.0))
    return gross_diff <= tol and net_diff <= tol


def _items_fingerprint(tx: IncomingTransaction) -> tuple[tuple[str, float], ...]:
    if not tx.items:
        return ()
    entries = [
        (_norm_label(it.product_name), round(float(it.qty or 0.0), 2))
        for it in tx.items
        if (it.product_name or "").strip()
    ]
    return tuple(sorted(entries))


def _keep_score(tx: IncomingTransaction) -> tuple[int, int, int, int, int, int]:
    """
    Skor prioritas transaksi yang sebaiknya dipertahankan.
    Semakin tinggi semakin diprioritaskan untuk disimpan.
    """
    is_reconciled = 1 if tx.reconciled_at is not None else 0
    item_count = len(tx.items or [])
    has_bank = 1 if tx.bank_account_id is not None else 0
    is_pos = 1 if (tx.source_type or "").lower() == "pos" else 0
    completeness = (
        (1 if _norm_token(tx.receipt_no) else 0)
        + (1 if _norm_token(tx.order_no) else 0)
        + (1 if _norm_label(tx.customer_name) else 0)
        + (1 if (tx.transaction_time or "").strip() else 0)
    )
    # Tie-breaker: pertahankan ID lebih kecil (data yang masuk lebih dulu)
    return (is_reconciled, item_count, has_bank, is_pos, completeness, -int(tx.id))


def _serialize_dup_tx(tx: IncomingTransaction) -> dict[str, Any]:
    return {
        "id": tx.id,
        "source_type": tx.source_type,
        "receipt_no": tx.receipt_no,
        "order_no": tx.order_no,
        "transaction_date": tx.transaction_date.isoformat() if tx.transaction_date else None,
        "transaction_time": tx.transaction_time,
        "order_type": tx.order_type,
        "payment_method": tx.payment_method,
        "bank_account_id": tx.bank_account_id,
        "bank_account_name": tx.bank_account.name if tx.bank_account else None,
        "customer_name": tx.customer_name,
        "cashier_name": tx.cashier_name,
        "gross_sales": float(tx.gross_sales or 0.0),
        "discount_amount": float(tx.discount_amount or 0.0),
        "platform_fee": float(tx.platform_fee or 0.0),
        "net_received": float(tx.net_received or 0.0),
        "status": tx.status,
        "item_count": len(tx.items or []),
        "reconciled_at": tx.reconciled_at.isoformat() if tx.reconciled_at else None,
        "notes": tx.notes,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
    }


_REASON_PRIORITY: dict[str, int] = {
    "same_receipt_no": 5,
    "same_order_no": 4,
    "exact_timestamp_amount": 3,
    "cross_source_match": 2,
    "same_day_fingerprint": 1,
}


class _UnionFind:
    def __init__(self, ids: list[int]) -> None:
        self.parent = {i: i for i in ids}

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if ra < rb:
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


async def audit_duplicate_incoming_transactions(
    db: AsyncSession,
    where_clause: Any = True,
    include_medium: bool = True,
) -> dict[str, Any]:
    """
    Pindai transaksi masuk sesuai filter untuk mendeteksi grup duplikat.
    Mengelompokkan transaksi yang saling terkait ke dalam satu grup deterministik
    dengan rekomendasi baris yang dipertahankan dan baris duplikat yang dapat dihapus.
    """
    stmt = (
        select(IncomingTransaction)
        .where(where_clause)
        .order_by(
            IncomingTransaction.transaction_date.desc(),
            IncomingTransaction.transaction_time.desc(),
            IncomingTransaction.id.asc(),
        )
    )
    rows = list((await db.execute(stmt)).scalars().all())
    scanned_count = len(rows)

    if scanned_count < 2:
        return {
            "scanned_transactions": scanned_count,
            "duplicate_group_count": 0,
            "duplicate_tx_count": 0,
            "high_confidence_groups": 0,
            "medium_confidence_groups": 0,
            "potential_overstated_gross": 0.0,
            "potential_overstated_net_received": 0.0,
            "groups": [],
        }

    tx_by_id = {tx.id: tx for tx in rows}
    uf = _UnionFind(list(tx_by_id.keys()))
    pair_reasons: dict[tuple[int, int], tuple[str, str, str]] = {}

    def record_match(id_a: int, id_b: int, reason_code: str, severity: str, reason_text: str) -> None:
        pair_key = (min(id_a, id_b), max(id_a, id_b))
        existing = pair_reasons.get(pair_key)
        if existing is None or _REASON_PRIORITY[reason_code] > _REASON_PRIORITY[existing[0]]:
            pair_reasons[pair_key] = (reason_code, severity, reason_text)
        uf.union(id_a, id_b)

    # 1. Duplikat nomor struk (receipt_no)
    by_receipt: dict[str, list[IncomingTransaction]] = defaultdict(list)
    for tx in rows:
        rk = _norm_token(tx.receipt_no)
        if rk:
            by_receipt[rk].append(tx)

    for rk, group in by_receipt.items():
        if len(group) < 2:
            continue
        base = group[0]
        label = (base.receipt_no or rk).strip()
        sources = sorted({(t.source_type or "pos") for t in group})
        reason_txt = (
            f"No. Struk '{label}' tercatat {len(group)} kali"
            + (f" (sumber: {', '.join(sources)})." if sources else ".")
        )
        for other in group[1:]:
            record_match(base.id, other.id, "same_receipt_no", "high", reason_txt)

    # 2. Duplikat nomor order (order_no)
    by_order: dict[str, list[IncomingTransaction]] = defaultdict(list)
    for tx in rows:
        ok = _norm_token(tx.order_no)
        if ok:
            by_order[ok].append(tx)

    for ok, group in by_order.items():
        if len(group) < 2:
            continue
        base = group[0]
        label = (base.order_no or ok).strip()
        reason_txt = f"No. Order '{label}' muncul pada {len(group)} transaksi berbeda."
        for other in group[1:]:
            record_match(base.id, other.id, "same_order_no", "high", reason_txt)

    # 3 & 4. Bucket berdasarkan tanggal + tipe order + metode bayar + nominal dibulatkan
    by_day_bucket: dict[tuple[date, str, str, int, int], list[IncomingTransaction]] = defaultdict(list)
    for tx in rows:
        if not tx.transaction_date:
            continue
        bkey = (
            tx.transaction_date,
            _norm_label(tx.order_type),
            _norm_label(tx.payment_method),
            round(float(tx.gross_sales or 0.0)),
            round(float(tx.net_received or 0.0)),
        )
        by_day_bucket[bkey].append(tx)

    for _, bucket in by_day_bucket.items():
        if len(bucket) < 2:
            continue
        n = len(bucket)
        for i in range(n):
            a = bucket[i]
            ra = _norm_token(a.receipt_no)
            oa = _norm_token(a.order_no)
            ta = _parse_time_seconds(a.transaction_time)
            ca = _norm_label(a.customer_name)
            fa = _items_fingerprint(a)

            for j in range(i + 1, n):
                b = bucket[j]
                if not _amounts_match(a, b):
                    continue
                rb = _norm_token(b.receipt_no)
                ob = _norm_token(b.order_no)
                tb = _parse_time_seconds(b.transaction_time)
                cb = _norm_label(b.customer_name)
                fb = _items_fingerprint(b)

                # Anti false-positive: dua struk POS dengan nomor struk & order ID berbeda
                # serta jam terpaut > 2 menit adalah order berbeda dengan harga sama
                both_distinct_ids = bool(ra and rb and ra != rb) and bool(oa and ob and oa != ob)
                time_diff = abs(ta - tb) if (ta is not None and tb is not None) else None

                # Tier 3: Tanggal + Jam (selisih <= 60 detik) + Tipe Order + Metode Bayar + Nominal sama
                if time_diff is not None and time_diff <= 60 and not both_distinct_ids:
                    record_match(
                        a.id,
                        b.id,
                        "exact_timestamp_amount",
                        "high",
                        (
                            f"Tanggal ({a.transaction_date.isoformat()}), jam ({a.transaction_time or '-'}), "
                            f"tipe order ({a.order_type}), metode bayar ({a.payment_method}), dan nominal identik."
                        ),
                    )
                    continue

                if not include_medium:
                    continue

                if both_distinct_ids and (time_diff is None or time_diff > 120):
                    continue

                # Tier 4a: Beda sumber (misal manual vs POS) pada hari, channel, dan nominal yang sama
                if (a.source_type or "").lower() != (b.source_type or "").lower():
                    record_match(
                        a.id,
                        b.id,
                        "cross_source_match",
                        "medium",
                        (
                            f"Tanggal, tipe order ({a.order_type}), metode bayar ({a.payment_method}), dan nominal sama "
                            f"lintas sumber ({a.source_type} vs {b.source_type})."
                        ),
                    )
                    continue

                # Tier 4b: Sinyal tambahan (pelanggan sama, item identik, atau keduanya tanpa nomor struk & jam)
                same_customer = bool(ca and cb and ca == cb)
                same_items = bool(fa and fb and fa == fb) and (time_diff is None or time_diff <= 300)
                both_unnumbered = (not ra and not rb) and (ta is None or tb is None)

                if same_customer or same_items or both_unnumbered:
                    signals: list[str] = []
                    if same_customer:
                        signals.append(f"pelanggan '{a.customer_name}'")
                    if same_items:
                        signals.append("rincian produk identik")
                    if both_unnumbered:
                        signals.append("keduanya tanpa nomor struk")
                    record_match(
                        a.id,
                        b.id,
                        "same_day_fingerprint",
                        "medium",
                        (
                            f"Transaksi pada {a.transaction_date.isoformat()} dengan tipe order, metode bayar, dan nominal sama "
                            f"({', '.join(signals)})."
                        ),
                    )

    # Kumpulkan komponen terhubung dari pasangan yang cocok
    components: dict[int, set[int]] = defaultdict(set)
    for (id_a, id_b) in pair_reasons.keys():
        root = uf.find(id_a)
        components[root].add(id_a)
        components[root].add(id_b)

    groups_out: list[dict[str, Any]] = []
    high_groups = 0
    medium_groups = 0
    total_dup_txs = 0
    total_overstated_gross = 0.0
    total_overstated_net = 0.0

    for comp_ids in components.values():
        if len(comp_ids) < 2:
            continue
        sorted_ids = sorted(comp_ids)
        comp_txs = [tx_by_id[tid] for tid in sorted_ids]

        # Ambil alasan dengan prioritas tertinggi dalam komponen ini
        best_reason_code = "same_day_fingerprint"
        best_severity = "medium"
        best_reason_text = "Terdeteksi potensi transaksi duplikat."
        for (pa, pb), (rcode, sev, rtxt) in pair_reasons.items():
            if pa in comp_ids and pb in comp_ids:
                if _REASON_PRIORITY[rcode] > _REASON_PRIORITY[best_reason_code] or (
                    _REASON_PRIORITY[rcode] == _REASON_PRIORITY[best_reason_code] and sev == "high"
                ):
                    best_reason_code = rcode
                    best_severity = sev
                    best_reason_text = rtxt

        if best_severity == "medium" and not include_medium:
            continue

        # Pilih 1 transaksi terbaik untuk dipertahankan, sisanya rekomendasi hapus
        keep_tx = max(comp_txs, key=_keep_score)
        delete_txs = [t for t in comp_txs if t.id != keep_tx.id]

        overstated_gross = sum(float(t.gross_sales or 0.0) for t in delete_txs if t.status == "paid")
        overstated_net = sum(float(t.net_received or 0.0) for t in delete_txs if t.status == "paid")

        if best_severity == "high":
            high_groups += 1
        else:
            medium_groups += 1
        total_dup_txs += len(delete_txs)
        total_overstated_gross += overstated_gross
        total_overstated_net += overstated_net

        # Urutkan tampilan transaksi: yang dipertahankan paling atas, lalu urut ID
        ordered_txs = [keep_tx] + sorted(delete_txs, key=lambda x: x.id)

        groups_out.append(
            {
                "group_id": "dup-" + "-".join(str(i) for i in sorted_ids),
                "reason_code": best_reason_code,
                "severity": best_severity,
                "reason": best_reason_text,
                "tx_count": len(comp_txs),
                "duplicate_count": len(delete_txs),
                "suggested_keep_id": keep_tx.id,
                "suggested_delete_ids": [t.id for t in delete_txs],
                "potential_overstated_gross": round(overstated_gross, 2),
                "potential_overstated_net_received": round(overstated_net, 2),
                "transactions": [_serialize_dup_tx(t) for t in ordered_txs],
            }
        )

    # Urutkan grup: high severity dulu, lalu dampak omset terbesar
    groups_out.sort(
        key=lambda g: (
            0 if g["severity"] == "high" else 1,
            -g["potential_overstated_net_received"],
            -g["tx_count"],
        )
    )

    return {
        "scanned_transactions": scanned_count,
        "duplicate_group_count": len(groups_out),
        "duplicate_tx_count": total_dup_txs,
        "high_confidence_groups": high_groups,
        "medium_confidence_groups": medium_groups,
        "potential_overstated_gross": round(total_overstated_gross, 2),
        "potential_overstated_net_received": round(total_overstated_net, 2),
        "groups": groups_out,
    }


async def delete_duplicate_incoming_transactions(
    db: AsyncSession,
    transaction_ids: list[int],
    allow_reconciled: bool = False,
) -> dict[str, Any]:
    """
    Hapus daftar transaksi masuk duplikat secara aman dan atomik.
    Secara default melindungi transaksi yang sudah berstatus rekonsiliasi kecuali allow_reconciled=True.
    """
    unique_ids = sorted({int(i) for i in transaction_ids if int(i) > 0})
    if not unique_ids:
        return {
            "deleted_count": 0,
            "deleted_ids": [],
            "skipped_reconciled_ids": [],
            "not_found_ids": [],
        }

    res = await db.execute(
        select(IncomingTransaction).where(IncomingTransaction.id.in_(unique_ids))
    )
    found = {tx.id: tx for tx in res.scalars().all()}

    not_found_ids = [i for i in unique_ids if i not in found]
    skipped_reconciled_ids: list[int] = []
    deleted_ids: list[int] = []

    for tid in unique_ids:
        tx = found.get(tid)
        if not tx:
            continue
        if tx.reconciled_at is not None and not allow_reconciled:
            skipped_reconciled_ids.append(tid)
            continue
        await db.delete(tx)
        deleted_ids.append(tid)

    await db.commit()
    return {
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "skipped_reconciled_ids": skipped_reconciled_ids,
        "not_found_ids": not_found_ids,
    }
