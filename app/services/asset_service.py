"""
app/services/asset_service.py — Layanan Inventaris Aset Tetap, Penyusutan SAK EMKM, Label QR & Maintenance
"""
from __future__ import annotations

import calendar
import json
import re
import secrets
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, inspect as sa_inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.expense import Expense
from app.models.fixed_asset import AssetLog, AssetMaintenance, FixedAsset


ASSET_GROUP_DEFAULT_LIFE: dict[str, int] = {
    "Mesin & Peralatan Dapur": 48,
    "Pendingin & Showcase": 60,
    "Elektronik & POS": 48,
    "Furnitur & Rak": 60,
    "Kendaraan Operasional": 96,
    "Perlengkapan Kecil": 24,
    "Lainnya": 48,
}


def _add_months(d: date, months: int) -> date:
    if months <= 0:
        return d
    total_m = (d.year * 12 + (d.month - 1)) + months
    ny = total_m // 12
    nm = (total_m % 12) + 1
    max_day = calendar.monthrange(ny, nm)[1]
    return date(ny, nm, min(d.day, max_day))


def _infer_asset_group(name: str, default_life: int = 48) -> tuple[str, int]:
    name_l = (name or "").lower()
    if any(k in name_l for k in ("showcase", "chiller", "freezer", "kulkas", "ac ", "pendingin")):
        return "Pendingin & Showcase", 60
    if any(k in name_l for k in ("tablet", "kasir", "printer", "laptop", "komputer", "cctv", "light box", "neon box")):
        return "Elektronik & POS", 48
    if any(k in name_l for k in ("motor", "mobil", "kendaraan", "pickup")):
        return "Kendaraan Operasional", 96
    if any(k in name_l for k in ("rak ", "lemari", "kursi", "etalase", "meja")):
        return "Furnitur & Rak", 60
    return "Mesin & Peralatan Dapur", default_life


def _extract_asset_metadata_from_notes(notes: str, purchase_date: date) -> dict[str, Any]:
    notes_str = str(notes or "")
    loc_match = re.search(r"\[Penempatan:\s*([^\]]+)\]", notes_str, re.IGNORECASE)
    location = loc_match.group(1).strip() if loc_match else "Dapur Produksi"

    cond_match = re.search(r"\[Kondisi:\s*([^\]]+)\]", notes_str, re.IGNORECASE)
    cond_raw = cond_match.group(1).strip() if cond_match else ""
    cond_l = cond_raw.lower()

    warranty_months = 0
    if "2 thn" in cond_l or "2 tahun" in cond_l or "24 bulan" in cond_l:
        warranty_months = 24
    elif "1 thn" in cond_l or "1 tahun" in cond_l or "12 bulan" in cond_l:
        warranty_months = 12
    elif "6 bulan" in cond_l or "6 bln" in cond_l:
        warranty_months = 6
    elif "3 bulan" in cond_l or "3 bln" in cond_l:
        warranty_months = 3

    sn_match = re.search(r"(?:SN|Serial(?:\s*No)?)[:\s-]*([A-Za-z0-9-]+)", notes_str, re.IGNORECASE)
    serial_number = sn_match.group(1).strip() if sn_match else ""

    warranty_expiry = _add_months(purchase_date, warranty_months) if warranty_months > 0 else None
    return {
        "location": location,
        "warranty_months": warranty_months,
        "warranty_expiry_date": warranty_expiry,
        "warranty_notes": cond_raw,
        "serial_number": serial_number,
    }


async def _generate_next_asset_code(db: AsyncSession, year: int) -> str:
    prefix = f"AST-{year}-"
    res = await db.execute(
        select(FixedAsset.asset_code).where(FixedAsset.asset_code.like(f"{prefix}%"))
    )
    max_seq = 0
    for (code,) in res.fetchall():
        tail = str(code)[len(prefix):]
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    return f"{prefix}{max_seq + 1:04d}"


async def _generate_unique_qr_token(db: AsyncSession) -> str:
    for _ in range(10):
        tok = secrets.token_urlsafe(12)
        exists = (
            await db.execute(select(FixedAsset.id).where(FixedAsset.qr_token == tok))
        ).scalar_one_or_none()
        if not exists:
            return tok
    return secrets.token_hex(16)


async def record_asset_log(
    db: AsyncSession,
    action: str,
    asset_id: int | None = None,
    actor: str = "system",
    details: dict | str | None = None,
) -> AssetLog:
    details_str = (
        json.dumps(details, default=str, ensure_ascii=False)
        if isinstance(details, dict)
        else (details or "{}")
    )
    entry = AssetLog(
        asset_id=asset_id,
        action=action.upper(),
        actor=actor,
        details=details_str,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(entry)
    return entry


def calculate_asset_depreciation(
    asset: FixedAsset,
    as_of_year: int,
    as_of_month: int,
) -> dict[str, Any]:
    """
    Kalkulasi penyusutan garis lurus (Straight-Line) SAK EMKM untuk 1 aset pada akhir periode (as_of_year, as_of_month).
    """
    acq = float(asset.acquisition_cost or 0)
    salvage = min(acq, max(0.0, float(asset.salvage_value or 0)))
    life = int(asset.useful_life_months or 0)
    p_date = asset.purchase_date
    start_date = asset.depreciation_start_date or p_date

    report_ym = as_of_year * 12 + as_of_month
    purchase_ym = p_date.year * 12 + p_date.month
    start_ym = start_date.year * 12 + start_date.month

    if report_ym < purchase_ym:
        return {
            "is_owned_in_period": False,
            "is_disposed_as_of": False,
            "monthly_depreciation": 0.0,
            "depreciation_in_period": 0.0,
            "immediate_expense_in_period": 0.0,
            "accumulated_depreciation": 0.0,
            "gross_balance_sheet_cost": 0.0,
            "net_book_value": 0.0,
            "remaining_months": life,
            "disposal_gain_loss_in_period": 0.0,
        }

    disposed_ym = (
        (asset.disposed_at.year * 12 + asset.disposed_at.month)
        if asset.disposed_at
        else None
    )
    is_disposed_as_of = bool(disposed_ym is not None and report_ym >= disposed_ym)
    disposed_in_period = bool(disposed_ym is not None and report_ym == disposed_ym)

    # Kasus 1: Aset nilai rendah di bawah batas kapitalisasi -> langsung dibebankan saat pembelian
    if (
        asset.capitalization_status == "expensed_low_value"
        or asset.depreciation_method == "immediate_expense"
    ):
        imm_exp = acq if report_ym == purchase_ym else 0.0
        return {
            "is_owned_in_period": True,
            "is_disposed_as_of": is_disposed_as_of,
            "monthly_depreciation": 0.0,
            "depreciation_in_period": 0.0,
            "immediate_expense_in_period": round(imm_exp, 2),
            "accumulated_depreciation": 0.0,
            "gross_balance_sheet_cost": 0.0,
            "net_book_value": 0.0,
            "remaining_months": 0,
            "disposal_gain_loss_in_period": (
                round(float(asset.disposal_proceeds or 0), 2) if disposed_in_period else 0.0
            ),
        }

    # Kasus 2: Aset tetap tidak disusutkan (non_depreciable)
    if asset.depreciation_method == "non_depreciable" or life <= 0:
        gross_bs = 0.0 if is_disposed_as_of else round(acq, 2)
        gain_loss = (
            round(float(asset.disposal_proceeds or 0) - acq, 2)
            if disposed_in_period
            else 0.0
        )
        return {
            "is_owned_in_period": True,
            "is_disposed_as_of": is_disposed_as_of,
            "monthly_depreciation": 0.0,
            "depreciation_in_period": 0.0,
            "immediate_expense_in_period": 0.0,
            "accumulated_depreciation": 0.0,
            "gross_balance_sheet_cost": gross_bs,
            "net_book_value": gross_bs,
            "remaining_months": 0,
            "disposal_gain_loss_in_period": gain_loss,
        }

    # Kasus 3: Aset tetap dikapitalisasi dengan metode Garis Lurus (Straight-Line)
    depreciable_base = max(0.0, acq - salvage)
    monthly_rate = depreciable_base / life if life > 0 else 0.0
    end_life_ym = start_ym + life - 1

    # Akumulasi penyusutan hingga titik efektif (berhenti 1 bulan sebelum bulan pelepasan)
    effective_end_ym = report_ym
    if disposed_ym is not None:
        effective_end_ym = min(report_ym, disposed_ym - 1)

    if effective_end_ym < start_ym:
        months_elapsed = 0
    else:
        months_elapsed = min(life, effective_end_ym - start_ym + 1)

    if months_elapsed >= life:
        accumulated = round(depreciable_base, 2)
    else:
        accumulated = round(monthly_rate * months_elapsed, 2)

    # Beban penyusutan pada bulan (as_of_year, as_of_month)
    dep_in_period = 0.0
    if not is_disposed_as_of and start_ym <= report_ym <= end_life_ym:
        if report_ym == end_life_ym:
            dep_in_period = round(depreciable_base - round(monthly_rate * (life - 1), 2), 2)
        else:
            dep_in_period = round(monthly_rate, 2)

    disposal_gain_loss = 0.0
    if disposed_in_period:
        book_at_disposal = round(max(0.0, acq - accumulated), 2)
        proceeds = float(asset.disposal_proceeds or 0)
        disposal_gain_loss = round(proceeds - book_at_disposal, 2)

    gross_bs = 0.0 if is_disposed_as_of else round(acq, 2)
    acc_bs = 0.0 if is_disposed_as_of else accumulated
    nbv = round(max(0.0, gross_bs - acc_bs), 2)
    remaining_months = max(0, life - months_elapsed) if not is_disposed_as_of else 0

    return {
        "is_owned_in_period": True,
        "is_disposed_as_of": is_disposed_as_of,
        "monthly_depreciation": round(monthly_rate, 2),
        "depreciation_in_period": dep_in_period,
        "immediate_expense_in_period": 0.0,
        "accumulated_depreciation": acc_bs,
        "gross_balance_sheet_cost": gross_bs,
        "net_book_value": nbv,
        "remaining_months": remaining_months,
        "disposal_gain_loss_in_period": disposal_gain_loss,
    }


def build_depreciation_schedule(
    asset: FixedAsset,
    max_months: int = 120,
) -> list[dict[str, Any]]:
    """Susun tabel jadwal penyusutan bulanan aset."""
    if (
        asset.capitalization_status != "capitalized"
        or asset.depreciation_method != "straight_line"
        or (asset.useful_life_months or 0) <= 0
    ):
        return []

    start = asset.depreciation_start_date or asset.purchase_date
    total_periods = min(int(asset.useful_life_months), max_months)
    schedule: list[dict[str, Any]] = []
    for i in range(total_periods):
        d = _add_months(start, i)
        if asset.disposed_at and (d.year * 12 + d.month) >= (asset.disposed_at.year * 12 + asset.disposed_at.month):
            break
        calc = calculate_asset_depreciation(asset, d.year, d.month)
        schedule.append({
            "period": i + 1,
            "year": d.year,
            "month": d.month,
            "period_label": f"{d.year}-{d.month:02d}",
            "depreciation_amount": calc["depreciation_in_period"],
            "accumulated_depreciation": calc["accumulated_depreciation"],
            "net_book_value": calc["net_book_value"],
        })
    return schedule


def _get_threshold_and_life() -> tuple[Decimal, int]:
    threshold = Decimal(str(getattr(settings, "asset_capitalization_threshold", 500000) or 500000))
    life = int(getattr(settings, "asset_default_useful_life_months", 48) or 48)
    if life <= 0:
        life = 48
    return threshold, life


async def sync_expense_to_fixed_assets(
    db: AsyncSession,
    expense: Expense,
    actor: str = "system",
    warranty_months: int | None = None,
    useful_life_months: int | None = None,
    location: str | None = None,
) -> list[FixedAsset]:
    """
    Sinkronkan record Expense kategori 'Asset' ke tabel fixed_assets.
    Jika Expense bukan lagi 'Asset', lepas atau hapus aset yang belum memiliki histori maintenance.
    """
    cat_lower = (expense.category or "").strip().lower()
    existing_res = await db.execute(
        select(FixedAsset)
        .options(selectinload(FixedAsset.maintenances))
        .where(FixedAsset.expense_id == expense.id)
        .order_by(FixedAsset.unit_index.asc(), FixedAsset.id.asc())
    )
    existing_assets = list(existing_res.scalars().all())

    if cat_lower != "asset":
        for ast in existing_assets:
            if ast.maintenances:
                ast.expense_id = None
                await record_asset_log(
                    db,
                    action="UNLINK_EXPENSE",
                    asset_id=ast.id,
                    actor=actor,
                    details={"reason": f"Kategori transaksi #{expense.id} diubah menjadi {expense.category}"},
                )
            else:
                await record_asset_log(
                    db,
                    action="DELETE_BY_CATEGORY_CHANGE",
                    asset_id=None,
                    actor=actor,
                    details={"asset_code": ast.asset_code, "expense_id": expense.id},
                )
                await db.delete(ast)
        await db.flush()
        return []

    threshold, default_life = _get_threshold_and_life()
    p_date = expense.expense_date or date.today()
    total_dec = Decimal(str(expense.total_price or 0))
    qty_dec = Decimal(str(expense.qty or 1))
    if qty_dec <= 0:
        qty_dec = Decimal("1")

    meta = _extract_asset_metadata_from_notes(expense.notes, p_date)
    resolved_loc = (location or meta["location"] or "Dapur Produksi").strip()
    resolved_warranty_m = warranty_months if warranty_months is not None else meta["warranty_months"]
    resolved_warranty_exp = _add_months(p_date, resolved_warranty_m) if resolved_warranty_m > 0 else meta["warranty_expiry_date"]
    inferred_group, inferred_life = _infer_asset_group(expense.item_name, default_life=default_life)
    resolved_life = useful_life_months if (useful_life_months is not None and useful_life_months > 0) else inferred_life

    if existing_assets:
        count = len(existing_assets)
        unit_cost_est = (total_dec / Decimal(count)).quantize(Decimal("0.01"))
        for idx, ast in enumerate(existing_assets):
            new_cost = unit_cost_est if idx < count - 1 else (total_dec - unit_cost_est * (count - 1))
            ast.acquisition_cost = new_cost
            ast.purchase_date = p_date
            ast.depreciation_start_date = p_date
            ast.supplier_id = expense.supplier_id
            ast.vendor_name = expense.supplier or "-"
            if count == 1:
                ast.name = expense.item_name
                ast.qty_in_lot = qty_dec
            else:
                ast.name = f"{expense.item_name} (#{idx + 1})"
            if not ast.is_capitalization_overridden:
                is_cap = new_cost >= threshold
                ast.capitalization_status = "capitalized" if is_cap else "expensed_low_value"
                ast.depreciation_method = "straight_line" if is_cap else "immediate_expense"
                if ast.useful_life_months <= 0:
                    ast.useful_life_months = resolved_life
            ast.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.flush()
        return existing_assets

    # Buat aset baru
    qty_int = int(qty_dec)
    is_whole_qty = qty_dec == Decimal(qty_int) and qty_int > 1
    unit_cost_est = (total_dec / qty_dec).quantize(Decimal("0.01")) if qty_dec > 0 else total_dec
    should_split = is_whole_qty and qty_int <= 20 and unit_cost_est >= threshold

    units_count = qty_int if should_split else 1
    created_assets: list[FixedAsset] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for u_idx in range(1, units_count + 1):
        if should_split:
            unit_cost = unit_cost_est if u_idx < units_count else (total_dec - unit_cost_est * (units_count - 1))
            unit_lot_qty = Decimal("1")
            unit_name = f"{expense.item_name} (#{u_idx})"
        else:
            unit_cost = total_dec
            unit_lot_qty = qty_dec
            unit_name = expense.item_name

        is_cap = unit_cost >= threshold
        cap_status = "capitalized" if is_cap else "expensed_low_value"
        dep_method = "straight_line" if is_cap else "immediate_expense"
        dep_life = resolved_life

        asset_code = await _generate_next_asset_code(db, p_date.year)
        qr_token = await _generate_unique_qr_token(db)

        ast = FixedAsset(
            asset_code=asset_code,
            qr_token=qr_token,
            name=unit_name,
            asset_group=inferred_group,
            brand_model="",
            serial_number=meta["serial_number"],
            expense_id=expense.id,
            unit_index=u_idx,
            qty_in_lot=unit_lot_qty,
            supplier_id=expense.supplier_id,
            vendor_name=expense.supplier or "-",
            location=resolved_loc,
            pic_name="-",
            condition="Baik",
            status="Aktif",
            purchase_date=p_date,
            warranty_months=resolved_warranty_m,
            warranty_expiry_date=resolved_warranty_exp,
            warranty_notes=meta["warranty_notes"],
            acquisition_cost=unit_cost,
            salvage_value=Decimal("0"),
            useful_life_months=dep_life,
            depreciation_method=dep_method,
            capitalization_status=cap_status,
            is_capitalization_overridden=False,
            depreciation_start_date=p_date,
            notes="" if (expense.notes or "-") == "-" else str(expense.notes),
            created_at=now,
            updated_at=now,
        )
        db.add(ast)
        await db.flush()
        await record_asset_log(
            db,
            action="CREATE",
            asset_id=ast.id,
            actor=actor,
            details={
                "asset_code": ast.asset_code,
                "expense_id": expense.id,
                "acquisition_cost": float(unit_cost),
                "capitalization_status": cap_status,
            },
        )
        created_assets.append(ast)

    await db.flush()
    return created_assets


async def remove_assets_for_deleted_expense(
    db: AsyncSession,
    expense_id: int,
    actor: str = "system",
) -> None:
    """Bersihkan atau lepas tautan aset ketika Expense sumbernya dihapus."""
    res = await db.execute(
        select(FixedAsset)
        .options(selectinload(FixedAsset.maintenances))
        .where(FixedAsset.expense_id == expense_id)
    )
    assets = list(res.scalars().all())
    for ast in assets:
        if ast.maintenances:
            ast.expense_id = None
            await record_asset_log(
                db,
                action="UNLINK_DELETED_EXPENSE",
                asset_id=ast.id,
                actor=actor,
                details={"deleted_expense_id": expense_id},
            )
        else:
            await record_asset_log(
                db,
                action="DELETE_BY_EXPENSE",
                asset_id=None,
                actor=actor,
                details={"asset_code": ast.asset_code, "deleted_expense_id": expense_id},
            )
            await db.delete(ast)
    await db.flush()


async def sync_existing_asset_expenses(
    db: AsyncSession,
    actor: str = "system",
) -> dict[str, Any]:
    """Backfill transaksi kategori 'Asset' yang belum masuk ke inventaris fixed_assets."""
    existing_exp_ids_res = await db.execute(
        select(FixedAsset.expense_id).where(FixedAsset.expense_id.is_not(None))
    )
    existing_exp_ids = {row[0] for row in existing_exp_ids_res.fetchall()}

    stmt = (
        select(Expense)
        .where(func.lower(Expense.category) == "asset")
        .order_by(Expense.expense_date.asc(), Expense.id.asc())
    )
    asset_expenses = list((await db.execute(stmt)).scalars().all())

    synced_expenses = 0
    created_assets = 0
    for exp in asset_expenses:
        if exp.id in existing_exp_ids:
            continue
        created = await sync_expense_to_fixed_assets(db, exp, actor=actor)
        if created:
            synced_expenses += 1
            created_assets += len(created)

    return {
        "ok": True,
        "synced_expenses": synced_expenses,
        "created_assets": created_assets,
        "message": f"Berhasil menyinkronkan {synced_expenses} transaksi Asset menjadi {created_assets} unit inventaris.",
    }


async def reanalyze_assets_by_threshold(
    db: AsyncSession,
    new_threshold: int | None = None,
    new_default_life_months: int | None = None,
    actor: str = "admin",
) -> dict[str, Any]:
    """
    Analisa ulang seluruh inventaris aset terhadap batas minimal harga kapitalisasi.
    Bila new_threshold / new_default_life_months dikirim, simpan ke system_settings sekaligus.
    """
    if new_threshold is not None or new_default_life_months is not None:
        from app.services.system_setting_service import apply_settings_to_runtime, save_bulk_system_settings
        updates: dict[str, Any] = {}
        if new_threshold is not None:
            if new_threshold < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Batas minimal harga aset tidak boleh negatif.",
                )
            updates["asset_capitalization_threshold"] = str(int(new_threshold))
        if new_default_life_months is not None:
            if new_default_life_months <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Masa manfaat default aset harus lebih dari 0 bulan.",
                )
            updates["asset_default_useful_life_months"] = str(int(new_default_life_months))
        await save_bulk_system_settings(db, updates)
        apply_settings_to_runtime(updates)

    threshold, default_life = _get_threshold_and_life()

    res = await db.execute(select(FixedAsset).order_by(FixedAsset.id.asc()))
    all_assets = list(res.scalars().all())

    promoted = 0
    demoted = 0
    unchanged = 0
    overridden_skipped = 0
    disposed_skipped = 0
    capitalized_total_before = 0.0
    capitalized_total_after = 0.0

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for ast in all_assets:
        acq = Decimal(str(ast.acquisition_cost or 0))
        if ast.capitalization_status == "capitalized" and ast.status not in ("Dihapuskan", "Dijual"):
            capitalized_total_before += float(acq)

        if ast.status in ("Dihapuskan", "Dijual") or ast.disposed_at is not None:
            disposed_skipped += 1
            continue

        if ast.is_capitalization_overridden:
            overridden_skipped += 1
            if ast.capitalization_status == "capitalized":
                capitalized_total_after += float(acq)
            continue

        should_capitalize = acq >= threshold
        new_cap_status = "capitalized" if should_capitalize else "expensed_low_value"
        _, inferred_life = _infer_asset_group(ast.name, default_life=default_life)
        target_life = (
            ast.useful_life_months
            if (ast.useful_life_months and ast.useful_life_months > 0)
            else inferred_life
        )

        if ast.capitalization_status != new_cap_status:
            old_status = ast.capitalization_status
            ast.capitalization_status = new_cap_status
            ast.depreciation_method = "straight_line" if should_capitalize else "immediate_expense"
            if should_capitalize and (not ast.useful_life_months or ast.useful_life_months <= 0):
                ast.useful_life_months = target_life
            ast.updated_at = now

            if should_capitalize:
                promoted += 1
            else:
                demoted += 1

            await record_asset_log(
                db,
                action="REANALYZE",
                asset_id=ast.id,
                actor=actor,
                details={
                    "threshold": float(threshold),
                    "acquisition_cost": float(acq),
                    "old_capitalization_status": old_status,
                    "new_capitalization_status": new_cap_status,
                },
            )
        else:
            unchanged += 1

        if ast.capitalization_status == "capitalized":
            capitalized_total_after += float(acq)

    await db.flush()

    return {
        "ok": True,
        "threshold": float(threshold),
        "default_useful_life_months": default_life,
        "total_assets_checked": len(all_assets),
        "promoted_to_capitalized": promoted,
        "moved_to_low_value": demoted,
        "unchanged": unchanged,
        "overridden_skipped": overridden_skipped,
        "disposed_skipped": disposed_skipped,
        "capitalized_total_before": round(capitalized_total_before, 2),
        "capitalized_total_after": round(capitalized_total_after, 2),
        "balance_sheet_delta": round(capitalized_total_after - capitalized_total_before, 2),
        "message": (
            f"Analisa ulang selesai (batas Rp {int(threshold):,}): "
            f"{promoted} aset dikapitalisasi, {demoted} aset masuk kategori nilai rendah, "
            f"{unchanged} tidak berubah."
        ),
    }


def serialize_asset(
    asset: FixedAsset,
    include_financial: bool = True,
    as_of_year: int | None = None,
    as_of_month: int | None = None,
) -> dict[str, Any]:
    today = date.today()
    y = as_of_year or today.year
    m = as_of_month or today.month
    dep = calculate_asset_depreciation(asset, y, m)

    state = sa_inspect(asset)
    if "maintenances" in state.unloaded:
        maintenances = []
    else:
        maintenances = list(getattr(asset, "maintenances", None) or [])
    total_maintenance_cost = sum(float(mt.cost or 0) for mt in maintenances)
    last_maintenance = maintenances[0] if maintenances else None

    upcoming_dates = [
        mt.next_service_date for mt in maintenances
        if mt.next_service_date is not None and mt.next_service_date >= today
    ]
    next_service = min(upcoming_dates) if upcoming_dates else (
        last_maintenance.next_service_date if last_maintenance else None
    )

    warranty_status = "Tanpa Garansi"
    days_to_warranty_end: int | None = None
    if asset.warranty_expiry_date:
        days_to_warranty_end = (asset.warranty_expiry_date - today).days
        if days_to_warranty_end < 0:
            warranty_status = "Garansi Habis"
        elif days_to_warranty_end <= 30:
            warranty_status = "Segera Habis"
        else:
            warranty_status = "Aktif"

    maint_serialized = []
    for mt in maintenances:
        item = {
            "id": mt.id,
            "asset_id": mt.asset_id,
            "expense_id": mt.expense_id if include_financial else None,
            "maintenance_date": mt.maintenance_date.isoformat(),
            "maintenance_type": mt.maintenance_type,
            "vendor_name": mt.vendor_name,
            "description": mt.description,
            "next_service_date": mt.next_service_date.isoformat() if mt.next_service_date else None,
            "service_warranty_until": mt.service_warranty_until.isoformat() if mt.service_warranty_until else None,
            "performed_by": mt.performed_by,
            "created_at": mt.created_at.isoformat() if mt.created_at else None,
        }
        if include_financial:
            item["cost"] = float(mt.cost or 0)
        maint_serialized.append(item)

    payload: dict[str, Any] = {
        "id": asset.id,
        "asset_code": asset.asset_code,
        "qr_token": asset.qr_token,
        "name": asset.name,
        "asset_group": asset.asset_group,
        "brand_model": asset.brand_model or "",
        "serial_number": asset.serial_number or "",
        "qty_in_lot": float(asset.qty_in_lot or 1),
        "vendor_name": asset.vendor_name or "-",
        "location": asset.location or "Dapur Produksi",
        "pic_name": asset.pic_name or "-",
        "condition": asset.condition or "Baik",
        "status": asset.status or "Aktif",
        "purchase_date": asset.purchase_date.isoformat(),
        "warranty_months": int(asset.warranty_months or 0),
        "warranty_expiry_date": asset.warranty_expiry_date.isoformat() if asset.warranty_expiry_date else None,
        "warranty_status": warranty_status,
        "days_to_warranty_end": days_to_warranty_end,
        "warranty_notes": asset.warranty_notes or "",
        "notes": asset.notes or "",
        "maintenance_count": len(maintenances),
        "last_maintenance_date": last_maintenance.maintenance_date.isoformat() if last_maintenance else None,
        "next_service_date": next_service.isoformat() if next_service else None,
        "maintenances": maint_serialized,
        "is_public_view": not include_financial,
    }

    if include_financial:
        acq = float(asset.acquisition_cost or 0)
        payload.update({
            "expense_id": asset.expense_id,
            "unit_index": int(asset.unit_index or 1),
            "supplier_id": asset.supplier_id,
            "acquisition_cost": acq,
            "salvage_value": float(asset.salvage_value or 0),
            "useful_life_months": int(asset.useful_life_months or 0),
            "depreciation_method": asset.depreciation_method,
            "capitalization_status": asset.capitalization_status,
            "is_capitalization_overridden": bool(asset.is_capitalization_overridden),
            "depreciation_start_date": asset.depreciation_start_date.isoformat(),
            "monthly_depreciation": dep["monthly_depreciation"],
            "depreciation_in_period": dep["depreciation_in_period"],
            "accumulated_depreciation": dep["accumulated_depreciation"],
            "net_book_value": dep["net_book_value"],
            "remaining_months": dep["remaining_months"],
            "total_maintenance_cost": round(total_maintenance_cost, 2),
            "total_cost_of_ownership": round(acq + total_maintenance_cost, 2),
            "disposed_at": asset.disposed_at.isoformat() if asset.disposed_at else None,
            "disposal_type": asset.disposal_type,
            "disposal_proceeds": float(asset.disposal_proceeds) if asset.disposal_proceeds is not None else None,
            "disposal_notes": asset.disposal_notes,
            "created_at": asset.created_at.isoformat() if asset.created_at else None,
            "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
        })

    return payload


async def list_assets(
    db: AsyncSession,
    search: str | None = None,
    status_filter: str | None = None,
    capitalization_status: str | None = None,
    asset_group: str | None = None,
    location: str | None = None,
    as_of_year: int | None = None,
    as_of_month: int | None = None,
) -> dict[str, Any]:
    stmt = (
        select(FixedAsset)
        .options(selectinload(FixedAsset.maintenances))
        .order_by(FixedAsset.purchase_date.desc(), FixedAsset.id.desc())
    )
    filters = []
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(FixedAsset.asset_code).like(term),
                func.lower(FixedAsset.name).like(term),
                func.lower(FixedAsset.brand_model).like(term),
                func.lower(FixedAsset.serial_number).like(term),
                func.lower(FixedAsset.vendor_name).like(term),
                func.lower(FixedAsset.location).like(term),
            )
        )
    if status_filter and status_filter != "all":
        filters.append(FixedAsset.status == status_filter)
    if capitalization_status and capitalization_status != "all":
        filters.append(FixedAsset.capitalization_status == capitalization_status)
    if asset_group and asset_group != "all":
        filters.append(FixedAsset.asset_group == asset_group)
    if location and location != "all":
        filters.append(FixedAsset.location == location)

    if filters:
        stmt = stmt.where(and_(*filters))

    assets = list((await db.execute(stmt)).scalars().all())
    today = date.today()
    y = as_of_year or today.year
    m = as_of_month or today.month

    items = [serialize_asset(a, include_financial=True, as_of_year=y, as_of_month=m) for a in assets]

    # Ringkasan seluruh inventaris
    all_assets_res = await db.execute(select(FixedAsset).options(selectinload(FixedAsset.maintenances)))
    all_assets = list(all_assets_res.scalars().all())

    total_acquisition = 0.0
    total_accumulated_dep = 0.0
    total_net_book_value = 0.0
    total_monthly_dep = 0.0
    low_value_count = 0
    capitalized_count = 0
    warranty_expiring_count = 0
    upcoming_service_count = 0
    active_count = 0

    for a in all_assets:
        dep = calculate_asset_depreciation(a, y, m)
        if a.status not in ("Dihapuskan", "Dijual"):
            active_count += 1
        if a.capitalization_status == "capitalized":
            capitalized_count += 1
            total_acquisition += dep["gross_balance_sheet_cost"]
            total_accumulated_dep += dep["accumulated_depreciation"]
            total_net_book_value += dep["net_book_value"]
            total_monthly_dep += dep["depreciation_in_period"]
        else:
            low_value_count += 1

        if a.warranty_expiry_date:
            d_left = (a.warranty_expiry_date - today).days
            if 0 <= d_left <= 30:
                warranty_expiring_count += 1

        if any(
            mt.next_service_date is not None and 0 <= (mt.next_service_date - today).days <= 14
            for mt in (a.maintenances or [])
        ):
            upcoming_service_count += 1

    threshold, default_life = _get_threshold_and_life()
    return {
        "ok": True,
        "items": items,
        "total": len(items),
        "config": {
            "asset_capitalization_threshold": int(threshold),
            "asset_default_useful_life_months": default_life,
        },
        "summary": {
            "total_assets": len(all_assets),
            "active_assets": active_count,
            "capitalized_count": capitalized_count,
            "low_value_count": low_value_count,
            "total_acquisition_cost": round(total_acquisition, 2),
            "total_accumulated_depreciation": round(total_accumulated_dep, 2),
            "total_net_book_value": round(total_net_book_value, 2),
            "monthly_depreciation_total": round(total_monthly_dep, 2),
            "warranty_expiring_count": warranty_expiring_count,
            "upcoming_service_count": upcoming_service_count,
        },
    }


async def get_asset_detail(
    db: AsyncSession,
    asset_id: int | None = None,
    qr_token: str | None = None,
    include_financial: bool = True,
) -> dict[str, Any]:
    stmt = select(FixedAsset).options(selectinload(FixedAsset.maintenances))
    if asset_id is not None:
        stmt = stmt.where(FixedAsset.id == asset_id)
    elif qr_token:
        stmt = stmt.where(FixedAsset.qr_token == qr_token)
    else:
        raise HTTPException(status_code=400, detail="Parameter aset tidak valid.")

    asset = (await db.execute(stmt)).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Data aset tidak ditemukan.")

    data = serialize_asset(asset, include_financial=include_financial)
    if include_financial:
        data["depreciation_schedule"] = build_depreciation_schedule(asset)
        logs_res = await db.execute(
            select(AssetLog)
            .where(AssetLog.asset_id == asset.id)
            .order_by(AssetLog.created_at.desc(), AssetLog.id.desc())
            .limit(30)
        )
        data["logs"] = [
            {
                "id": l.id,
                "action": l.action,
                "actor": l.actor,
                "details": json.loads(l.details) if l.details else {},
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in logs_res.scalars().all()
        ]
    return data


async def create_manual_asset(
    db: AsyncSession,
    payload: dict[str, Any],
    actor: str = "admin",
) -> FixedAsset:
    threshold, default_life = _get_threshold_and_life()
    p_date = payload.get("purchase_date") or date.today()
    acq_cost = Decimal(str(payload.get("acquisition_cost") or 0))
    if acq_cost < 0:
        raise HTTPException(status_code=400, detail="Nilai perolehan aset tidak boleh negatif.")

    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nama aset wajib diisi.")

    asset_group = payload.get("asset_group") or _infer_asset_group(name, default_life)[0]
    warranty_months = int(payload.get("warranty_months") or 0)
    warranty_exp = payload.get("warranty_expiry_date") or (
        _add_months(p_date, warranty_months) if warranty_months > 0 else None
    )

    cap_override = payload.get("capitalization_status")
    is_overridden = bool(payload.get("is_capitalization_overridden", False))
    if cap_override in ("capitalized", "expensed_low_value"):
        cap_status = cap_override
        is_overridden = True
    else:
        cap_status = "capitalized" if acq_cost >= threshold else "expensed_low_value"

    dep_method = payload.get("depreciation_method") or (
        "straight_line" if cap_status == "capitalized" else "immediate_expense"
    )
    life_months = int(payload.get("useful_life_months") or (
        ASSET_GROUP_DEFAULT_LIFE.get(asset_group, default_life) if cap_status == "capitalized" else 0
    ))

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    ast = FixedAsset(
        asset_code=await _generate_next_asset_code(db, p_date.year),
        qr_token=await _generate_unique_qr_token(db),
        name=name,
        asset_group=asset_group,
        brand_model=str(payload.get("brand_model") or "").strip(),
        serial_number=str(payload.get("serial_number") or "").strip(),
        expense_id=payload.get("expense_id"),
        supplier_id=payload.get("supplier_id"),
        vendor_name=str(payload.get("vendor_name") or "-").strip() or "-",
        location=str(payload.get("location") or "Dapur Produksi").strip() or "Dapur Produksi",
        pic_name=str(payload.get("pic_name") or "-").strip() or "-",
        condition=str(payload.get("condition") or "Baik").strip() or "Baik",
        status=str(payload.get("status") or "Aktif").strip() or "Aktif",
        purchase_date=p_date,
        warranty_months=warranty_months,
        warranty_expiry_date=warranty_exp,
        warranty_notes=str(payload.get("warranty_notes") or "").strip(),
        acquisition_cost=acq_cost,
        salvage_value=Decimal(str(payload.get("salvage_value") or 0)),
        useful_life_months=life_months if cap_status == "capitalized" else 0,
        depreciation_method=dep_method,
        capitalization_status=cap_status,
        is_capitalization_overridden=is_overridden,
        depreciation_start_date=payload.get("depreciation_start_date") or p_date,
        notes=str(payload.get("notes") or "").strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(ast)
    await db.flush()
    await record_asset_log(
        db,
        action="CREATE_MANUAL",
        asset_id=ast.id,
        actor=actor,
        details={"asset_code": ast.asset_code, "acquisition_cost": float(acq_cost)},
    )
    await db.flush()
    return ast


async def update_asset(
    db: AsyncSession,
    asset_id: int,
    updates: dict[str, Any],
    actor: str = "admin",
) -> FixedAsset:
    ast = (
        await db.execute(
            select(FixedAsset)
            .options(selectinload(FixedAsset.maintenances))
            .where(FixedAsset.id == asset_id)
        )
    ).scalar_one_or_none()
    if not ast:
        raise HTTPException(status_code=404, detail="Data aset tidak ditemukan.")

    changes: dict[str, Any] = {}
    for field, val in updates.items():
        if val is None or not hasattr(ast, field):
            continue
        old_val = getattr(ast, field)
        if field in ("acquisition_cost", "salvage_value"):
            val = Decimal(str(val))
        if str(old_val) != str(val):
            changes[field] = {
                "old": float(old_val) if isinstance(old_val, Decimal) else str(old_val),
                "new": float(val) if isinstance(val, Decimal) else str(val),
            }
        setattr(ast, field, val)

    # Sinkronkan warranty_expiry_date otomatis jika warranty_months diubah tanpa explicit warranty_expiry_date
    if "warranty_months" in updates and "warranty_expiry_date" not in updates:
        wm = int(ast.warranty_months or 0)
        ast.warranty_expiry_date = _add_months(ast.purchase_date, wm) if wm > 0 else None

    if "capitalization_status" in updates:
        if ast.capitalization_status == "expensed_low_value":
            ast.depreciation_method = "immediate_expense"
        elif ast.capitalization_status == "capitalized":
            ast.depreciation_method = updates.get("depreciation_method") or "straight_line"
            if (ast.useful_life_months or 0) <= 0:
                _, default_life = _get_threshold_and_life()
                ast.useful_life_months = ASSET_GROUP_DEFAULT_LIFE.get(ast.asset_group, default_life)

    ast.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if changes:
        await record_asset_log(
            db,
            action="UPDATE",
            asset_id=ast.id,
            actor=actor,
            details={"changes": changes},
        )
    await db.flush()
    return ast


async def dispose_asset(
    db: AsyncSession,
    asset_id: int,
    disposed_at: date,
    disposal_type: str,
    disposal_proceeds: Decimal | float = 0,
    disposal_notes: str = "",
    actor: str = "admin",
) -> FixedAsset:
    ast = (
        await db.execute(
            select(FixedAsset)
            .options(selectinload(FixedAsset.maintenances))
            .where(FixedAsset.id == asset_id)
        )
    ).scalar_one_or_none()
    if not ast:
        raise HTTPException(status_code=404, detail="Data aset tidak ditemukan.")

    ast.disposed_at = disposed_at
    ast.disposal_type = disposal_type
    ast.disposal_proceeds = Decimal(str(disposal_proceeds or 0))
    ast.disposal_notes = disposal_notes.strip()
    ast.status = "Dijual" if disposal_type.lower() == "dijual" else "Dihapuskan"
    if disposal_type.lower() in ("rusak", "hilang"):
        ast.condition = "Rusak"
    ast.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    dep = calculate_asset_depreciation(ast, disposed_at.year, disposed_at.month)
    await record_asset_log(
        db,
        action="DISPOSE",
        asset_id=ast.id,
        actor=actor,
        details={
            "disposed_at": disposed_at.isoformat(),
            "disposal_type": disposal_type,
            "disposal_proceeds": float(ast.disposal_proceeds),
            "disposal_gain_loss": dep["disposal_gain_loss_in_period"],
        },
    )
    await db.flush()
    return ast


async def add_asset_maintenance(
    db: AsyncSession,
    asset_id: int,
    maintenance_date: date,
    maintenance_type: str = "Perbaikan",
    vendor_name: str = "-",
    cost: Decimal | float = 0,
    description: str = "-",
    next_service_date: date | None = None,
    service_warranty_until: date | None = None,
    performed_by: str = "-",
    expense_id: int | None = None,
    create_expense: bool = False,
    pay_method: str = "Tunai",
    actor: str = "admin",
) -> AssetMaintenance:
    ast = await db.get(FixedAsset, asset_id)
    if not ast:
        raise HTTPException(status_code=404, detail="Data aset tidak ditemukan.")

    cost_dec = Decimal(str(cost or 0))
    linked_expense_id = expense_id

    if create_expense and linked_expense_id is None and cost_dec > 0:
        from app.services.expense_service import save_expenses
        saved_exps = await save_expenses(
            db,
            items=[{
                "tanggal": maintenance_date.isoformat(),
                "barang": f"Servis {ast.name} ({ast.asset_code})",
                "qty": 1,
                "satuan": "Pcs",
                "kategori": "Maintenance",
                "harga_satuan": float(cost_dec),
                "total_harga": float(cost_dec),
                "toko_supplier": vendor_name or "-",
                "metode_bayar": pay_method or "Tunai",
                "status_pembayaran": "Lunas",
                "keterangan": f"[{ast.asset_code}] {description}",
            }],
            msg_link="Inventaris Aset",
            actor=actor,
        )
        if saved_exps:
            linked_expense_id = saved_exps[0].id

    mt = AssetMaintenance(
        asset_id=ast.id,
        expense_id=linked_expense_id,
        maintenance_date=maintenance_date,
        maintenance_type=maintenance_type or "Perbaikan",
        vendor_name=(vendor_name or "-").strip() or "-",
        cost=cost_dec,
        description=(description or "-").strip() or "-",
        next_service_date=next_service_date,
        service_warranty_until=service_warranty_until,
        performed_by=(performed_by or "-").strip() or "-",
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(mt)
    await db.flush()

    await record_asset_log(
        db,
        action="MAINTENANCE",
        asset_id=ast.id,
        actor=actor,
        details={
            "maintenance_id": mt.id,
            "maintenance_type": mt.maintenance_type,
            "cost": float(cost_dec),
            "expense_id": linked_expense_id,
        },
    )
    await db.flush()
    return mt


async def bulk_create_assets(
    db: AsyncSession,
    items: list[dict[str, Any]],
    actor: str = "admin",
) -> dict[str, Any]:
    """Tambah beberapa unit aset inventaris sekaligus dari form masal."""
    created: list[dict[str, Any]] = []
    skipped = 0
    errors: list[str] = []

    for idx, item in enumerate(items, start=1):
        name = str(item.get("name") or "").strip()
        if not name:
            skipped += 1
            continue
        try:
            ast = await create_manual_asset(db, item, actor=actor)
            created.append(serialize_asset(ast, include_financial=True))
        except HTTPException as exc:
            skipped += 1
            errors.append(f"Baris {idx} ({name}): {exc.detail}")

    return {
        "ok": True,
        "added": len(created),
        "skipped": skipped,
        "errors": errors[:10],
        "items": created,
        "message": f"Berhasil menambahkan {len(created)} aset ke inventaris" + (f" ({skipped} dilewati)." if skipped else "."),
    }


def generate_asset_csv_template() -> str:
    """Bangun template CSV siap isi untuk import Inventaris Aset Tetap."""
    from app.utils.csv_helpers import build_csv_template

    return build_csv_template([
        "Nama Aset",
        "Kelompok Aset",
        "Merk / Model",
        "Nomor Seri",
        "Tanggal Perolehan",
        "Harga Perolehan",
        "Nilai Residu",
        "Masa Manfaat (Bulan)",
        "Lokasi",
        "PIC",
        "Vendor / Toko",
        "Garansi (Bulan)",
        "Kondisi",
        "Status",
        "Catatan",
    ])


async def import_assets_from_csv(
    db: AsyncSession,
    content: bytes,
    actor: str = "admin",
) -> dict[str, Any]:
    """Import banyak aset inventaris dari file CSV."""
    from app.utils.csv_helpers import (
        col_lookup,
        find_header_row,
        get_cell,
        parse_csv_table,
        parse_date_cell,
        parse_number_cell,
    )

    first_row, rest_rows = parse_csv_table(content)
    all_rows = [first_row, *rest_rows]
    hdr_idx, headers = find_header_row(all_rows, ("nama aset", "asset_name", "nama barang", "name"))

    idx_name = col_lookup(headers, "nama aset", "asset_name", "nama barang", "name", "nama")
    idx_group = col_lookup(headers, "kelompok aset", "kelompok", "asset_group", "group")
    idx_brand = col_lookup(headers, "merk / model", "merk", "brand", "model", "brand_model")
    idx_sn = col_lookup(headers, "nomor seri", "no seri", "serial_number", "sn", "serial")
    idx_date = col_lookup(headers, "tanggal perolehan", "tgl perolehan", "tanggal beli", "purchase_date", "tanggal")
    idx_cost = col_lookup(headers, "harga perolehan", "nilai perolehan", "acquisition_cost", "harga", "nominal")
    idx_salvage = col_lookup(headers, "nilai residu", "salvage_value", "residu")
    idx_life = col_lookup(headers, "masa manfaat", "useful_life_months", "umur ekonomis", "manfaat")
    idx_loc = col_lookup(headers, "lokasi", "location", "penempatan")
    idx_pic = col_lookup(headers, "pic", "penanggung jawab", "pic_name")
    idx_vendor = col_lookup(headers, "vendor / toko", "vendor", "toko", "supplier", "vendor_name")
    idx_warranty = col_lookup(headers, "garansi (bulan)", "garansi", "warranty_months")
    idx_cond = col_lookup(headers, "kondisi", "condition")
    idx_status = col_lookup(headers, "status")
    idx_notes = col_lookup(headers, "catatan", "notes", "keterangan")

    if idx_name is None:
        raise ValueError("Kolom 'Nama Aset' tidak ditemukan di file CSV.")

    items_payload: list[dict[str, Any]] = []
    for row in all_rows[hdr_idx + 1:]:
        if not any(c.strip() for c in row):
            continue
        name = get_cell(row, idx_name)
        if not name or name.upper() == "TOTAL":
            continue

        p_date = parse_date_cell(get_cell(row, idx_date), default=date.today()) or date.today()
        acq_cost = max(0.0, parse_number_cell(get_cell(row, idx_cost), default=0.0))
        salvage = max(0.0, parse_number_cell(get_cell(row, idx_salvage), default=0.0))
        life_raw = int(parse_number_cell(get_cell(row, idx_life), default=0.0))
        warranty_m = max(0, int(parse_number_cell(get_cell(row, idx_warranty), default=0.0)))

        items_payload.append({
            "name": name,
            "asset_group": get_cell(row, idx_group) or None,
            "brand_model": get_cell(row, idx_brand),
            "serial_number": get_cell(row, idx_sn),
            "purchase_date": p_date,
            "acquisition_cost": acq_cost,
            "salvage_value": salvage,
            "useful_life_months": life_raw if life_raw > 0 else None,
            "location": get_cell(row, idx_loc) or "Dapur Produksi",
            "pic_name": get_cell(row, idx_pic) or "-",
            "vendor_name": get_cell(row, idx_vendor) or "-",
            "warranty_months": warranty_m,
            "condition": get_cell(row, idx_cond) or "Baik",
            "status": get_cell(row, idx_status) or "Aktif",
            "notes": get_cell(row, idx_notes),
        })

    if not items_payload:
        raise ValueError("Tidak ada baris aset valid di dalam file CSV.")

    return await bulk_create_assets(db, items_payload, actor=actor)
