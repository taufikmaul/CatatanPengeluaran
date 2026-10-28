"""add_master_data_options

Revision ID: 4534c2b89e65
Revises: c6d7e8f90123
Create Date: 2026-10-28 06:22:47.313900

"""
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4534c2b89e65'
down_revision: Union[str, None] = 'c6d7e8f90123'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Buat tabel master_data_options
    op.create_table('master_data_options',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('type', sa.String(length=50), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('type', 'name', name='uq_master_data_type_name')
    )
    with op.batch_alter_table('master_data_options', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_master_data_options_type'), ['type'], unique=False)
        batch_op.create_index('ix_master_data_type_active', ['type', 'is_active', 'sort_order'], unique=False)

    # 2. Seed data default
    conn = op.get_bind()
    now_dt = datetime.utcnow()
    master_table = sa.table(
        'master_data_options',
        sa.column('type', sa.String),
        sa.column('name', sa.String),
        sa.column('description', sa.String),
        sa.column('sort_order', sa.Integer),
        sa.column('is_active', sa.Boolean),
        sa.column('is_default', sa.Boolean),
        sa.column('created_at', sa.DateTime),
        sa.column('updated_at', sa.DateTime),
    )

    defaults = [
        # Kategori
        ("kategori", "Bahan Kue", "Bahan baku pembuatan kue & roti", 1, True, False),
        ("kategori", "Bahan Minuman", "Bahan baku minuman, sirup, teh, kopi", 2, True, False),
        ("kategori", "Kebersihan", "Sabun, plastik sampah, pembersih lantai, spon", 3, True, False),
        ("kategori", "Kantor", "ATK, kertas nota, pulpen, lakban", 4, True, False),
        ("kategori", "Kemasan", "Box kue, standing pouch, kantong plastik, pita", 5, True, False),
        ("kategori", "Operasional", "Gas LPG, listrik, galon air, es batu, transportasi", 6, True, False),
        ("kategori", "Topper & Mainan", "Lilin ultah, topper cake, hiasan kue", 7, True, False),
        ("kategori", "Renovasi", "Perbaikan toko, cat, peralatan tukang", 8, True, False),
        ("kategori", "Asset", "Peralatan tahan lama, mixer, loyang, showcase", 9, True, False),
        ("kategori", "Iuran", "Iuran sampah, keamanan, lingkungan", 10, True, False),
        ("kategori", "Tukar Cash", "Tarik tunai kasir / titip transfer kas", 11, True, False),

        # Metode Bayar
        ("metode_bayar", "Tunai", "Uang tunai kasir toko", 1, True, True),
        ("metode_bayar", "Transfer", "Transfer bank (BCA, Mandiri, BRI, dll)", 2, True, False),
        ("metode_bayar", "QRIS", "Pembayaran barcode QRIS", 3, True, False),
        ("metode_bayar", "Debit", "Kartu debit EDC", 4, True, False),
        ("metode_bayar", "Kredit", "Kartu kredit EDC / tempo bank", 5, True, False),

        # Satuan
        ("satuan", "Pcs", "Pieces / satuan bijian umum", 1, True, True),
        ("satuan", "Box", "Kotak / kardus kecil", 2, True, False),
        ("satuan", "Pouch", "Kemasan kantong / pouch berdiri", 3, True, False),
        ("satuan", "Kg", "Kilogram (berat)", 4, True, False),
        ("satuan", "Dus", "Karton besar / dus luar", 5, True, False),
        ("satuan", "Kaleng", "Kemasan kaleng can / tin", 6, True, False),
        ("satuan", "Pack", "Paket isi beberapa kemasan", 7, True, False),
        ("satuan", "Sak", "Karung besar / sak (terigu, gula)", 8, True, False),
        ("satuan", "Bal", "Bal besar (kemasan plastik/kertas)", 9, True, False),
        ("satuan", "Botol", "Kemasan botol cairan / perisa", 10, True, False),
        ("satuan", "Tray", "Rak telur / kemasan nampan", 11, True, False),
        ("satuan", "Liter", "Liter (satuan volume)", 12, True, False),
        ("satuan", "Gram", "Gram (satuan berat kecil)", 13, True, False),
        ("satuan", "Roll", "Gulungan (plastik roll, pita)", 14, True, False),
        ("satuan", "Lembar", "Lembaran kertas / stiker", 15, True, False),
        ("satuan", "Meter", "Satuan panjang", 16, True, False),
    ]

    records = [
        {
            "type": d[0],
            "name": d[1],
            "description": d[2],
            "sort_order": d[3],
            "is_active": d[4],
            "is_default": d[5],
            "created_at": now_dt,
            "updated_at": now_dt,
        }
        for d in defaults
    ]
    op.bulk_insert(master_table, records)


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('master_data_options', schema=None) as batch_op:
        batch_op.drop_index('ix_master_data_type_active')
        batch_op.drop_index(batch_op.f('ix_master_data_options_type'))

    op.drop_table('master_data_options')
    # ### end Alembic commands ###
