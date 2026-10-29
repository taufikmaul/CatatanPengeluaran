"""add_accounting_codes_to_master_data

Revision ID: 8b9c0d1e2f3a
Revises: 7a8b9c0d1e2f
Create Date: 2026-10-29 17:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b9c0d1e2f3a'
down_revision: Union[str, None] = '7a8b9c0d1e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ACCOUNTING_MAPPINGS = [
    # Kategori
    ("kategori", "Bahan Kue", "5-1100", "Beban Pokok Bahan Baku Kue", "HPP", "LABA_RUGI"),
    ("kategori", "Bahan Minuman", "5-1200", "Beban Pokok Bahan Minuman", "HPP", "LABA_RUGI"),
    ("kategori", "Kemasan", "5-1300", "Beban Bahan Pembantu & Kemasan", "HPP", "LABA_RUGI"),
    ("kategori", "Topper & Mainan", "5-1400", "Beban Aksesoris & Ornamen Produk", "HPP", "LABA_RUGI"),
    ("kategori", "Ongkir", "5-1500", "Beban Angkut Penjualan (Delivery)", "HPP", "LABA_RUGI"),
    ("kategori", "Operasional", "6-1100", "Beban Utilitas & Operasional Toko", "OPEX", "LABA_RUGI"),
    ("kategori", "Kebersihan", "6-1200", "Beban Perlengkapan & Sanitasi", "OPEX", "LABA_RUGI"),
    ("kategori", "Kantor", "6-1300", "Beban Administrasi & ATK", "OPEX", "LABA_RUGI"),
    ("kategori", "Renovasi", "6-1400", "Beban Pemeliharaan & Perbaikan", "OPEX", "LABA_RUGI"),
    ("kategori", "Iuran", "6-1500", "Beban Retribusi & Lingkungan", "OPEX", "LABA_RUGI"),
    ("kategori", "Asset", "1-2100", "Aset Tetap - Peralatan & Mesin", "ASSET", "NERACA"),
    ("kategori", "Tukar Cash", "1-1199", "Kas Kliring / Penukaran Tunai", "CASH_TRANSFER", "ARUS_KAS"),

    # Metode Bayar
    ("metode_bayar", "Tunai", "1-1110", "Kas Tunai Kasir", "KAS", "NERACA"),
    ("metode_bayar", "Transfer", "1-1120", "Bank Operasional", "BANK", "NERACA"),
    ("metode_bayar", "QRIS", "1-1121", "QRIS Settlement", "BANK", "NERACA"),
    ("metode_bayar", "Debit", "1-1122", "EDC Debit", "BANK", "NERACA"),
    ("metode_bayar", "Kredit", "2-1110", "Kartu Kredit / Tempo", "HUTANG", "NERACA"),
    ("metode_bayar", "COD", "1-1110", "Kas Tunai Kasir (COD)", "KAS", "NERACA"),
]


def upgrade() -> None:
    with op.batch_alter_table('master_data_options', schema=None) as batch_op:
        batch_op.add_column(sa.Column('account_code', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('account_name', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('account_group', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('report_type', sa.String(length=50), nullable=True))

    # Seed data akuntansi ke baris yang sudah ada
    conn = op.get_bind()
    for opt_type, name, code, acc_name, group, rep_type in ACCOUNTING_MAPPINGS:
        conn.execute(
            sa.text(
                "UPDATE master_data_options "
                "SET account_code = :code, account_name = :acc_name, "
                "    account_group = :group, report_type = :rep_type "
                "WHERE type = :opt_type AND name = :name"
            ),
            {
                "code": code,
                "acc_name": acc_name,
                "group": group,
                "rep_type": rep_type,
                "opt_type": opt_type,
                "name": name,
            }
        )


def downgrade() -> None:
    with op.batch_alter_table('master_data_options', schema=None) as batch_op:
        batch_op.drop_column('report_type')
        batch_op.drop_column('account_group')
        batch_op.drop_column('account_name')
        batch_op.drop_column('account_code')
