"""add satuan to master_items and expenses

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-10-23 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a1b2c3d4'
down_revision: Union[str, None] = 'd4e5f6a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('master_items', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('satuan_beli', sa.String(50), nullable=False, server_default=sa.text("'Pcs'"))
        )
        batch_op.add_column(
            sa.Column('tipe_satuan', sa.String(20), nullable=False, server_default=sa.text("'keduanya'"))
        )
        batch_op.add_column(
            sa.Column('isi_paket', sa.String(255), nullable=True, server_default=sa.text("''"))
        )
        batch_op.add_column(
            sa.Column('satuan_ecer', sa.String(50), nullable=True, server_default=sa.text("'Pcs'"))
        )

    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('unit', sa.String(50), nullable=False, server_default=sa.text("'Pcs'"))
        )


def downgrade() -> None:
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.drop_column('unit')

    with op.batch_alter_table('master_items', schema=None) as batch_op:
        batch_op.drop_column('satuan_ecer')
        batch_op.drop_column('isi_paket')
        batch_op.drop_column('tipe_satuan')
        batch_op.drop_column('satuan_beli')
