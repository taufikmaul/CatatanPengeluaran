"""add_suppliers_table

Revision ID: c6d7e8f90123
Revises: b5ef18b37034
Create Date: 2026-10-28 05:37:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c6d7e8f90123'
down_revision: Union[str, None] = 'b5ef18b37034'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Buat tabel suppliers
    op.create_table(
        'suppliers',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('phone', sa.String(length=50), nullable=True, server_default=sa.text("''")),
        sa.Column('address', sa.Text(), nullable=True, server_default=sa.text("''")),
        sa.Column('aliases', sa.Text(), nullable=True, server_default=sa.text("''")),
        sa.Column('notes', sa.Text(), nullable=True, server_default=sa.text("''")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_suppliers_name'), 'suppliers', ['name'], unique=True)
    op.create_index(op.f('ix_suppliers_is_active'), 'suppliers', ['is_active'], unique=False)

    # 2. Tambah kolom supplier_id ke tabel expenses
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.add_column(sa.Column('supplier_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_expenses_supplier_id'), ['supplier_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_expenses_supplier_id_suppliers', 'suppliers', ['supplier_id'], ['id'], ondelete='SET NULL'
        )

    # 3. Backfill data: buat record supplier dari data belanja yang sudah ada
    conn = op.get_bind()
    # Ambil distinct supplier valid dari expenses
    res = conn.execute(sa.text("""
        SELECT DISTINCT trim(supplier) as raw_supplier
        FROM expenses
        WHERE supplier IS NOT NULL
          AND trim(supplier) NOT IN ('', '-', 'None')
    """)).fetchall()

    seen_lower = set()
    for row in res:
        name = (row[0] or "").strip()
        if not name or name.lower() in seen_lower:
            continue
        seen_lower.add(name.lower())
        conn.execute(
            sa.text("INSERT INTO suppliers (name, phone, address, aliases, notes, is_active) VALUES (:name, '', '', '', '', true)"),
            {"name": name}
        )

    # Hubungkan supplier_id di expenses
    conn.execute(sa.text("""
        UPDATE expenses
        SET supplier_id = (
            SELECT suppliers.id
            FROM suppliers
            WHERE lower(trim(expenses.supplier)) = lower(suppliers.name)
            LIMIT 1
        )
        WHERE supplier IS NOT NULL
          AND trim(supplier) NOT IN ('', '-', 'None')
          AND supplier_id IS NULL
    """))


def downgrade() -> None:
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.drop_constraint('fk_expenses_supplier_id_suppliers', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_expenses_supplier_id'))
        batch_op.drop_column('supplier_id')

    op.drop_index(op.f('ix_suppliers_is_active'), table_name='suppliers')
    op.drop_index(op.f('ix_suppliers_name'), table_name='suppliers')
    op.drop_table('suppliers')
