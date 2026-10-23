"""add master items

Revision ID: a1b2c3d4e5f6
Revises: d45b0a79e123
Create Date: 2026-10-23 06:42:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'd45b0a79e123'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'master_items',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('item_name', sa.String(length=255), nullable=False),
        sa.Column('category', sa.String(length=100), nullable=False),
        sa.Column('default_supplier', sa.String(length=255), nullable=True),
        sa.Column('aliases', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('master_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_master_items_item_name'), ['item_name'], unique=True)
        batch_op.create_index(batch_op.f('ix_master_items_category'), ['category'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('master_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_master_items_category'))
        batch_op.drop_index(batch_op.f('ix_master_items_item_name'))

    op.drop_table('master_items')
