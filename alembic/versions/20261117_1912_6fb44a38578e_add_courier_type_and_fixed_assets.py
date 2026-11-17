"""add_courier_type_and_fixed_assets

Revision ID: 6fb44a38578e
Revises: bb8929669940
Create Date: 2026-11-17 19:12:46.915777

"""
from datetime import date, datetime
from decimal import Decimal
import json
import re
import secrets
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6fb44a38578e'
down_revision: Union[str, None] = 'bb8929669940'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_COURIERS = [
    ("GoSend", "Instan", "GoSend Car, GoSend Bike, Gojek, Go-Send", False),
    ("GoCar", "Instan", "Gocar, Go-Car", False),
    ("Lalamove", "Instan", "Lalamove Mobil, Lalamove Motor", False),
    ("GrabExpress", "Instan", "Grab Express, GrabExpress Instant, GrabExpress SameDay, GrabCar, GrabBike, Grab", False),
    ("Shopee Express", "Ekspedisi", "SPX, SPX Express, Shopee Express Instant", False),
    ("Maxim", "Instan", "Maxim Car, Maxim Bike, Maxim Delivery", False),
    ("JNE", "Ekspedisi", "JNE Reg, JNE YES, JNE Express", False),
    ("J&T Express", "Ekspedisi", "J&T, JNT, J&T Cargo", False),
    ("SiCepat", "Ekspedisi", "SiCepat Express, SiCepat Halu", False),
    ("Anteraja", "Ekspedisi", "Anter Aja", False),
    ("Kurir Lainnya", "Lainnya", "Ongkir Umum", False),
]

COURIER_KEYWORDS = (
    "gosend", "go-send", "gocar", "go-car", "gojek",
    "lalamove", "grab", "grabexpress", "shopee express", "spx",
    "maxim", "jne", "j&t", "jnt", "sicepat", "anteraja",
    "paxel", "ninja", "lion parcel", "pos indonesia", "kurir",
)


def _add_months(d: date, months: int) -> date:
    if months <= 0:
        return d
    total_m = (d.year * 12 + (d.month - 1)) + months
    ny = total_m // 12
    nm = (total_m % 12) + 1
    # clamp day to valid month length
    import calendar
    max_day = calendar.monthrange(ny, nm)[1]
    return date(ny, nm, min(d.day, max_day))


def _coerce_date(val) -> date:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        try:
            return date.fromisoformat(val[:10])
        except ValueError:
            pass
    return date.today()


def upgrade() -> None:
    # ### Schema changes ###
    op.create_table(
        'fixed_assets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('asset_code', sa.String(length=50), nullable=False),
        sa.Column('qr_token', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('asset_group', sa.String(length=100), server_default=sa.text("'Mesin & Peralatan Dapur'"), nullable=False),
        sa.Column('brand_model', sa.String(length=255), server_default=sa.text("''"), nullable=True),
        sa.Column('serial_number', sa.String(length=120), server_default=sa.text("''"), nullable=True),
        sa.Column('expense_id', sa.Integer(), nullable=True),
        sa.Column('unit_index', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('qty_in_lot', sa.Numeric(precision=10, scale=2), server_default=sa.text('1'), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=True),
        sa.Column('vendor_name', sa.String(length=255), server_default=sa.text("'-'"), nullable=False),
        sa.Column('location', sa.String(length=120), server_default=sa.text("'Dapur Produksi'"), nullable=False),
        sa.Column('pic_name', sa.String(length=120), server_default=sa.text("'-'"), nullable=False),
        sa.Column('condition', sa.String(length=50), server_default=sa.text("'Baik'"), nullable=False),
        sa.Column('status', sa.String(length=50), server_default=sa.text("'Aktif'"), nullable=False),
        sa.Column('purchase_date', sa.Date(), nullable=False),
        sa.Column('warranty_months', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('warranty_expiry_date', sa.Date(), nullable=True),
        sa.Column('warranty_notes', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('acquisition_cost', sa.Numeric(precision=15, scale=2), server_default=sa.text('0'), nullable=False),
        sa.Column('salvage_value', sa.Numeric(precision=15, scale=2), server_default=sa.text('0'), nullable=False),
        sa.Column('useful_life_months', sa.Integer(), server_default=sa.text('48'), nullable=False),
        sa.Column('depreciation_method', sa.String(length=30), server_default=sa.text("'straight_line'"), nullable=False),
        sa.Column('capitalization_status', sa.String(length=30), server_default=sa.text("'capitalized'"), nullable=False),
        sa.Column('is_capitalization_overridden', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('depreciation_start_date', sa.Date(), nullable=False),
        sa.Column('disposed_at', sa.Date(), nullable=True),
        sa.Column('disposal_type', sa.String(length=30), nullable=True),
        sa.Column('disposal_proceeds', sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column('disposal_notes', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['supplier_id'], ['suppliers.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('fixed_assets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_fixed_assets_asset_code'), ['asset_code'], unique=True)
        batch_op.create_index(batch_op.f('ix_fixed_assets_capitalization_status'), ['capitalization_status'], unique=False)
        batch_op.create_index(batch_op.f('ix_fixed_assets_expense_id'), ['expense_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_fixed_assets_name'), ['name'], unique=False)
        batch_op.create_index(batch_op.f('ix_fixed_assets_purchase_date'), ['purchase_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_fixed_assets_qr_token'), ['qr_token'], unique=True)
        batch_op.create_index(batch_op.f('ix_fixed_assets_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_fixed_assets_supplier_id'), ['supplier_id'], unique=False)

    op.create_table(
        'asset_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('actor', sa.String(length=100), server_default=sa.text("'system'"), nullable=False),
        sa.Column('details', sa.Text(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['fixed_assets.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('asset_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_asset_logs_action'), ['action'], unique=False)
        batch_op.create_index(batch_op.f('ix_asset_logs_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_asset_logs_created_at'), ['created_at'], unique=False)

    op.create_table(
        'asset_maintenances',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('expense_id', sa.Integer(), nullable=True),
        sa.Column('maintenance_date', sa.Date(), nullable=False),
        sa.Column('maintenance_type', sa.String(length=50), server_default=sa.text("'Perbaikan'"), nullable=False),
        sa.Column('vendor_name', sa.String(length=255), server_default=sa.text("'-'"), nullable=False),
        sa.Column('cost', sa.Numeric(precision=15, scale=2), server_default=sa.text('0'), nullable=False),
        sa.Column('description', sa.Text(), server_default=sa.text("'-'"), nullable=False),
        sa.Column('next_service_date', sa.Date(), nullable=True),
        sa.Column('service_warranty_until', sa.Date(), nullable=True),
        sa.Column('performed_by', sa.String(length=120), server_default=sa.text("'-'"), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['fixed_assets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('asset_maintenances', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_asset_maintenances_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_asset_maintenances_expense_id'), ['expense_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_asset_maintenances_maintenance_date'), ['maintenance_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_asset_maintenances_next_service_date'), ['next_service_date'], unique=False)

    with op.batch_alter_table('suppliers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('supplier_type', sa.String(length=30), server_default=sa.text("'toko'"), nullable=False))
        batch_op.add_column(sa.Column('courier_category', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('is_subscribed', sa.Boolean(), server_default=sa.text('false'), nullable=False))
        batch_op.create_index(batch_op.f('ix_suppliers_is_subscribed'), ['is_subscribed'], unique=False)
        batch_op.create_index(batch_op.f('ix_suppliers_supplier_type'), ['supplier_type'], unique=False)

    # ### Data Migrations (idempotent) ###
    conn = op.get_bind()
    now = datetime.utcnow()

    # 1. Seed default settings for Asset Capitalization Threshold & Useful Life
    for k, v in (
        ("asset_capitalization_threshold", "500000"),
        ("asset_default_useful_life_months", "48"),
    ):
        exists = conn.execute(
            sa.text("SELECT key FROM system_settings WHERE key = :k"),
            {"k": k},
        ).fetchone()
        if not exists:
            conn.execute(
                sa.text(
                    "INSERT INTO system_settings (key, value, created_at, updated_at) "
                    "VALUES (:k, :v, :c, :u)"
                ),
                {"k": k, "v": v, "c": now, "u": now},
            )

    # 2. Seed default Couriers in suppliers table (supplier_type = 'kurir')
    courier_map: dict[str, tuple[int, str]] = {}
    existing_sups = conn.execute(
        sa.text("SELECT id, name, aliases, supplier_type FROM suppliers")
    ).fetchall()
    existing_by_lower = {str(r[1]).strip().lower(): r for r in existing_sups}

    for cname, ccat, caliases, csub in DEFAULT_COURIERS:
        key = cname.lower()
        row = existing_by_lower.get(key)
        if row:
            sup_id = row[0]
            merged_aliases = row[2] or caliases
            conn.execute(
                sa.text(
                    "UPDATE suppliers SET supplier_type = 'kurir', courier_category = :ccat, "
                    "aliases = :aliases, updated_at = :u WHERE id = :id"
                ),
                {"ccat": ccat, "aliases": merged_aliases, "u": now, "id": sup_id},
            )
            courier_map[key] = (sup_id, row[1])
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO suppliers (name, phone, address, aliases, notes, supplier_type, "
                    "courier_category, is_subscribed, is_active, created_at, updated_at) "
                    "VALUES (:name, '', '', :aliases, '', 'kurir', :ccat, :csub, true, :c, :u)"
                ),
                {
                    "name": cname,
                    "aliases": caliases,
                    "ccat": ccat,
                    "csub": bool(csub),
                    "c": now,
                    "u": now,
                },
            )
            inserted = conn.execute(
                sa.text("SELECT id, name FROM suppliers WHERE LOWER(name) = :n"),
                {"n": key},
            ).fetchone()
            if inserted:
                courier_map[key] = (inserted[0], inserted[1])

    # Build alias lookup for couriers
    alias_lookup: dict[str, tuple[int, str]] = dict(courier_map)
    for cname, _, caliases, _ in DEFAULT_COURIERS:
        if cname.lower() in courier_map:
            target = courier_map[cname.lower()]
            for al in caliases.split(","):
                al_clean = al.strip().lower()
                if al_clean and al_clean not in alias_lookup:
                    alias_lookup[al_clean] = target

    # 3. Migrate legacy Operasional / non-Ongkir ongkir expenses -> category='Ongkir' & link courier supplier
    exp_rows = conn.execute(
        sa.text("SELECT id, category, item_name, supplier, supplier_id FROM expenses")
    ).fetchall()
    for eid, ecat, eitem, esup, esup_id in exp_rows:
        cat_l = (ecat or "").strip().lower()
        if cat_l == "tukar cash":
            continue
        item_l = (eitem or "").strip().lower()
        sup_raw = (esup or "").strip()
        sup_l = sup_raw.lower()

        is_legacy_ongkir = (
            cat_l == "ongkir"
            or (cat_l == "operasional" and ("ongkir" in item_l or "ongkos kirim" in item_l))
            or ("ongkir" in item_l and cat_l in ("operasional", "", "lainnya"))
            or any(kw in sup_l for kw in COURIER_KEYWORDS)
        )
        if not is_legacy_ongkir:
            continue

        # Resolve courier supplier
        resolved_id = None
        resolved_name = sup_raw or "Kurir Lainnya"
        if sup_l in alias_lookup:
            resolved_id, resolved_name = alias_lookup[sup_l]
        else:
            for al_key, target in alias_lookup.items():
                if al_key and len(al_key) >= 3 and al_key in sup_l:
                    resolved_id, resolved_name = target
                    break

        if not resolved_id and sup_raw and sup_raw not in ("-", "None", "null"):
            # Custom / subscribed courier name (e.g. "Pak Budi Kurir")
            existing_custom = conn.execute(
                sa.text("SELECT id, name FROM suppliers WHERE LOWER(name) = :n"),
                {"n": sup_l},
            ).fetchone()
            if existing_custom:
                resolved_id, resolved_name = existing_custom[0], existing_custom[1]
                conn.execute(
                    sa.text(
                        "UPDATE suppliers SET supplier_type = 'kurir', "
                        "courier_category = COALESCE(courier_category, 'Langganan'), "
                        "is_subscribed = true, updated_at = :u WHERE id = :id"
                    ),
                    {"u": now, "id": resolved_id},
                )
            else:
                conn.execute(
                    sa.text(
                        "INSERT INTO suppliers (name, phone, address, aliases, notes, supplier_type, "
                        "courier_category, is_subscribed, is_active, created_at, updated_at) "
                        "VALUES (:name, '', '', '', 'Migrasi otomatis kurir ongkir', 'kurir', 'Langganan', true, true, :c, :u)"
                    ),
                    {"name": sup_raw, "c": now, "u": now},
                )
                created = conn.execute(
                    sa.text("SELECT id, name FROM suppliers WHERE LOWER(name) = :n"),
                    {"n": sup_l},
                ).fetchone()
                if created:
                    resolved_id, resolved_name = created[0], created[1]
            if resolved_id:
                alias_lookup[sup_l] = (resolved_id, resolved_name)
        elif not resolved_id:
            fallback = courier_map.get("kurir lainnya")
            if fallback:
                resolved_id, resolved_name = fallback

        new_sup_name = resolved_name if resolved_id else (sup_raw or "-")
        conn.execute(
            sa.text(
                "UPDATE expenses SET category = 'Ongkir', supplier_id = :sid, "
                "supplier = :sname, sheets_synced = false WHERE id = :eid"
            ),
            {"sid": resolved_id, "sname": new_sup_name, "eid": eid},
        )

    # 4. Backfill existing Asset expenses into fixed_assets
    threshold_row = conn.execute(
        sa.text("SELECT value FROM system_settings WHERE key = 'asset_capitalization_threshold'")
    ).fetchone()
    threshold_val = Decimal(str(threshold_row[0])) if threshold_row and str(threshold_row[0]).isdigit() else Decimal("500000")

    asset_expenses = conn.execute(
        sa.text(
            "SELECT id, expense_date, supplier, supplier_id, item_name, qty, total_price, notes "
            "FROM expenses WHERE LOWER(category) = 'asset' ORDER BY expense_date ASC, id ASC"
        )
    ).fetchall()

    seq_by_year: dict[int, int] = {}
    for eid, edate_raw, esup, esup_id, ename, eqty, etotal, enotes in asset_expenses:
        p_date = _coerce_date(edate_raw)
        yr = p_date.year
        qty_dec = Decimal(str(eqty or 1))
        if qty_dec <= 0:
            qty_dec = Decimal("1")
        total_dec = Decimal(str(etotal or 0))
        notes_str = str(enotes or "")

        # Parse metadata tags if present
        loc_match = re.search(r"\[Penempatan:\s*([^\]]+)\]", notes_str, re.IGNORECASE)
        location = loc_match.group(1).strip() if loc_match else "Dapur Produksi"
        cond_match = re.search(r"\[Kondisi:\s*([^\]]+)\]", notes_str, re.IGNORECASE)
        cond_raw = cond_match.group(1).strip() if cond_match else ""
        warranty_months = 0
        if "1 thn" in cond_raw.lower() or "1 tahun" in cond_raw.lower() or "12 bulan" in cond_raw.lower():
            warranty_months = 12
        elif "2 thn" in cond_raw.lower() or "2 tahun" in cond_raw.lower():
            warranty_months = 24
        elif "6 bulan" in cond_raw.lower() or "6 bln" in cond_raw.lower():
            warranty_months = 6
        warranty_expiry = _add_months(p_date, warranty_months) if warranty_months > 0 else None

        name_l = (ename or "").lower()
        if any(k in name_l for k in ("showcase", "chiller", "freezer", "kulkas", "ac ")):
            asset_group, life_months = "Pendingin & Showcase", 60
        elif any(k in name_l for k in ("tablet", "kasir", "printer", "laptop", "komputer", "cctv", "light box", "neon box")):
            asset_group, life_months = "Elektronik & POS", 48
        elif any(k in name_l for k in ("rak ", "lemari", "kursi", "etalase", "meja")):
            asset_group, life_months = "Furnitur & Rak", 60
        else:
            asset_group, life_months = "Mesin & Peralatan Dapur", 48

        qty_int = int(qty_dec)
        is_whole_qty = qty_dec == Decimal(qty_int) and qty_int > 1
        unit_cost_est = (total_dec / qty_dec).quantize(Decimal("0.01")) if qty_dec > 0 else total_dec
        should_split = is_whole_qty and qty_int <= 20 and unit_cost_est >= threshold_val

        units_count = qty_int if should_split else 1
        for u_idx in range(1, units_count + 1):
            if should_split:
                if u_idx < units_count:
                    unit_cost = unit_cost_est
                else:
                    unit_cost = total_dec - (unit_cost_est * (units_count - 1))
                unit_lot_qty = Decimal("1")
                unit_name = f"{ename} (#{u_idx})"
            else:
                unit_cost = total_dec
                unit_lot_qty = qty_dec
                unit_name = ename

            is_cap = unit_cost >= threshold_val
            cap_status = "capitalized" if is_cap else "expensed_low_value"
            dep_method = "straight_line" if is_cap else "immediate_expense"
            dep_life = life_months if is_cap else 0

            seq_by_year[yr] = seq_by_year.get(yr, 0) + 1
            asset_code = f"AST-{yr}-{seq_by_year[yr]:04d}"
            qr_token = secrets.token_urlsafe(12)

            conn.execute(
                sa.text(
                    "INSERT INTO fixed_assets ("
                    "asset_code, qr_token, name, asset_group, brand_model, serial_number, "
                    "expense_id, unit_index, qty_in_lot, supplier_id, vendor_name, "
                    "location, pic_name, condition, status, purchase_date, warranty_months, "
                    "warranty_expiry_date, warranty_notes, acquisition_cost, salvage_value, "
                    "useful_life_months, depreciation_method, capitalization_status, "
                    "is_capitalization_overridden, depreciation_start_date, notes, created_at, updated_at"
                    ") VALUES ("
                    ":asset_code, :qr_token, :name, :asset_group, '', '', "
                    ":expense_id, :unit_index, :qty_in_lot, :supplier_id, :vendor_name, "
                    ":location, '-', 'Baik', 'Aktif', :purchase_date, :warranty_months, "
                    ":warranty_expiry_date, :warranty_notes, :acquisition_cost, 0, "
                    ":useful_life_months, :depreciation_method, :capitalization_status, "
                    "false, :depreciation_start_date, :notes, :created_at, :updated_at"
                    ")"
                ),
                {
                    "asset_code": asset_code,
                    "qr_token": qr_token,
                    "name": unit_name,
                    "asset_group": asset_group,
                    "expense_id": eid,
                    "unit_index": u_idx,
                    "qty_in_lot": unit_lot_qty,
                    "supplier_id": esup_id,
                    "vendor_name": esup or "-",
                    "location": location,
                    "purchase_date": p_date,
                    "warranty_months": warranty_months,
                    "warranty_expiry_date": warranty_expiry,
                    "warranty_notes": cond_raw,
                    "acquisition_cost": unit_cost,
                    "useful_life_months": dep_life,
                    "depreciation_method": dep_method,
                    "capitalization_status": cap_status,
                    "depreciation_start_date": p_date,
                    "notes": notes_str if notes_str != "-" else "",
                    "created_at": now,
                    "updated_at": now,
                },
            )


def downgrade() -> None:
    with op.batch_alter_table('suppliers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_suppliers_supplier_type'))
        batch_op.drop_index(batch_op.f('ix_suppliers_is_subscribed'))
        batch_op.drop_column('is_subscribed')
        batch_op.drop_column('courier_category')
        batch_op.drop_column('supplier_type')

    with op.batch_alter_table('asset_maintenances', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_asset_maintenances_next_service_date'))
        batch_op.drop_index(batch_op.f('ix_asset_maintenances_maintenance_date'))
        batch_op.drop_index(batch_op.f('ix_asset_maintenances_expense_id'))
        batch_op.drop_index(batch_op.f('ix_asset_maintenances_asset_id'))

    op.drop_table('asset_maintenances')
    with op.batch_alter_table('asset_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_asset_logs_created_at'))
        batch_op.drop_index(batch_op.f('ix_asset_logs_asset_id'))
        batch_op.drop_index(batch_op.f('ix_asset_logs_action'))

    op.drop_table('asset_logs')
    with op.batch_alter_table('fixed_assets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_fixed_assets_supplier_id'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_status'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_qr_token'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_purchase_date'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_name'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_expense_id'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_capitalization_status'))
        batch_op.drop_index(batch_op.f('ix_fixed_assets_asset_code'))

    op.drop_table('fixed_assets')
