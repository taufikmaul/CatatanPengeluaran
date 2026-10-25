"""create_expense_logs_table

Revision ID: b5ef18b37034
Revises: 5b8fa12c6d7e
Create Date: 2026-10-26 06:24:56.222567

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5ef18b37034'
down_revision: Union[str, None] = '5b8fa12c6d7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'expense_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('expense_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('actor', sa.String(length=100), server_default=sa.text("'system'"), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('expense_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_expense_logs_action'), ['action'], unique=False)
        batch_op.create_index(batch_op.f('ix_expense_logs_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_expense_logs_expense_id'), ['expense_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('expense_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_expense_logs_expense_id'))
        batch_op.drop_index(batch_op.f('ix_expense_logs_created_at'))
        batch_op.drop_index(batch_op.f('ix_expense_logs_action'))
    op.drop_table('expense_logs')
