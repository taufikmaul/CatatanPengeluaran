"""add reimbursement and invoice to expenses

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-10-23 09:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a1'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('is_reimbursement', sa.Boolean(), server_default=sa.text('false'), nullable=False)
        )
        batch_op.add_column(
            sa.Column('invoice_number', sa.String(length=100), server_default='-', nullable=True)
        )
        batch_op.create_index(
            batch_op.f('ix_expenses_is_reimbursement'), ['is_reimbursement'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('expenses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_expenses_is_reimbursement'))
        batch_op.drop_column('invoice_number')
        batch_op.drop_column('is_reimbursement')
