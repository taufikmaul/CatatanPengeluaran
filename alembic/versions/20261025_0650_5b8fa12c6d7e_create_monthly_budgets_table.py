"""create_monthly_budgets_table

Revision ID: 5b8fa12c6d7e
Revises: 4a7ef03b4226
Create Date: 2026-10-25 06:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b8fa12c6d7e'
down_revision: Union[str, None] = '4a7ef03b4226'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'monthly_budgets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('total_budget', sa.Numeric(precision=15, scale=2), server_default=sa.text('0'), nullable=False),
        sa.Column('category_percentages_json', sa.Text(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('category_amounts_json', sa.Text(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('year', 'month', name='uq_monthly_budgets_year_month'),
    )
    with op.batch_alter_table('monthly_budgets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_monthly_budgets_year'), ['year'], unique=False)
        batch_op.create_index(batch_op.f('ix_monthly_budgets_month'), ['month'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('monthly_budgets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_monthly_budgets_month'))
        batch_op.drop_index(batch_op.f('ix_monthly_budgets_year'))
    op.drop_table('monthly_budgets')
