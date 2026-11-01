"""widen_isi_paket_to_text

Revision ID: 9c0d1e2f3a4b
Revises: 8b9c0d1e2f3a
Create Date: 2026-11-01 09:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c0d1e2f3a4b'
down_revision: Union[str, None] = '8b9c0d1e2f3a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('master_items', schema=None) as batch_op:
        batch_op.alter_column(
            'isi_paket',
            existing_type=sa.String(length=255),
            type_=sa.Text(),
            nullable=True,
            existing_server_default=sa.text("''"),
        )


def downgrade() -> None:
    with op.batch_alter_table('master_items', schema=None) as batch_op:
        batch_op.alter_column(
            'isi_paket',
            existing_type=sa.Text(),
            type_=sa.String(length=255),
            nullable=True,
            existing_server_default=sa.text("''"),
        )
