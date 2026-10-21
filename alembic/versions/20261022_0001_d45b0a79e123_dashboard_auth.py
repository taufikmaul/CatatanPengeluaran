"""dashboard auth

Revision ID: d45b0a79e123
Revises: fc3dd6cf7407
Create Date: 2026-10-22 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd45b0a79e123'
down_revision: Union[str, None] = 'fc3dd6cf7407'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dashboard_pins',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pin_hash', sa.String(length=64), nullable=False),
        sa.Column('salt', sa.String(length=32), nullable=False),
        sa.Column('ip_address', sa.String(length=64), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('max_attempts', sa.Integer(), nullable=False),
        sa.Column('is_used', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('dashboard_pins', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_dashboard_pins_ip_address'), ['ip_address'], unique=False)
        batch_op.create_index(batch_op.f('ix_dashboard_pins_expires_at'), ['expires_at'], unique=False)

    op.create_table(
        'dashboard_access_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('ip_address', sa.String(length=64), nullable=False),
        sa.Column('action', sa.String(length=32), nullable=False),
        sa.Column('details', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('dashboard_access_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_dashboard_access_logs_ip_address'), ['ip_address'], unique=False)
        batch_op.create_index(batch_op.f('ix_dashboard_access_logs_action'), ['action'], unique=False)
        batch_op.create_index(batch_op.f('ix_dashboard_access_logs_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('dashboard_access_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_dashboard_access_logs_created_at'))
        batch_op.drop_index(batch_op.f('ix_dashboard_access_logs_action'))
        batch_op.drop_index(batch_op.f('ix_dashboard_access_logs_ip_address'))

    op.drop_table('dashboard_access_logs')

    with op.batch_alter_table('dashboard_pins', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_dashboard_pins_expires_at'))
        batch_op.drop_index(batch_op.f('ix_dashboard_pins_ip_address'))

    op.drop_table('dashboard_pins')
