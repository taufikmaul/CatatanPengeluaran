"""add_categories_gaji_sewa_marketing_software_maintenance

Revision ID: aeb38b3c5393
Revises: b64d003fc767
Create Date: 2026-11-01 12:22:02.692957

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'aeb38b3c5393'
down_revision: Union[str, None] = 'b64d003fc767'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NEW_CATEGORIES = [
    {
        "name": "Gaji",
        "description": "Gaji karyawan, upah lembur, tunjangan, dan honorarium",
        "sort_order": 13,
        "account_code": "6-1600",
        "account_name": "Beban Gaji & Upah Karyawan",
        "account_group": "OPEX",
        "report_type": "LABA_RUGI",
    },
    {
        "name": "Sewa",
        "description": "Sewa tempat usaha, toko, ruko, atau sewa peralatan",
        "sort_order": 14,
        "account_code": "6-1700",
        "account_name": "Beban Sewa Tempat & Gedung",
        "account_group": "OPEX",
        "report_type": "LABA_RUGI",
    },
    {
        "name": "Marketing",
        "description": "Iklan, endorse, promosi medsos, brosur & sponsorship",
        "sort_order": 15,
        "account_code": "6-1800",
        "account_name": "Beban Pemasaran & Promosi",
        "account_group": "OPEX",
        "report_type": "LABA_RUGI",
    },
    {
        "name": "Software",
        "description": "Langganan aplikasi POS, software kasir, domain/hosting, cloud",
        "sort_order": 16,
        "account_code": "6-1900",
        "account_name": "Beban Software & Layanan Cloud",
        "account_group": "OPEX",
        "report_type": "LABA_RUGI",
    },
    {
        "name": "Maintenance",
        "description": "Servis mesin, perawatan AC & showcase, pemeliharaan peralatan",
        "sort_order": 17,
        "account_code": "6-2000",
        "account_name": "Beban Pemeliharaan & Servis Peralatan",
        "account_group": "OPEX",
        "report_type": "LABA_RUGI",
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    now_dt = datetime.utcnow()

    for item in NEW_CATEGORIES:
        check_sql = sa.text(
            "SELECT id FROM master_data_options WHERE type = 'kategori' AND LOWER(name) = LOWER(:name)"
        )
        existing = conn.execute(check_sql, {"name": item["name"]}).fetchone()

        if existing:
            update_sql = sa.text(
                "UPDATE master_data_options SET "
                "  description = :description, "
                "  sort_order = :sort_order, "
                "  account_code = :account_code, "
                "  account_name = :account_name, "
                "  account_group = :account_group, "
                "  report_type = :report_type, "
                "  is_active = :is_active, "
                "  updated_at = :updated_at "
                "WHERE type = 'kategori' AND LOWER(name) = LOWER(:name)"
            )
            conn.execute(
                update_sql,
                {
                    "name": item["name"],
                    "description": item["description"],
                    "sort_order": item["sort_order"],
                    "account_code": item["account_code"],
                    "account_name": item["account_name"],
                    "account_group": item["account_group"],
                    "report_type": item["report_type"],
                    "is_active": True,
                    "updated_at": now_dt,
                },
            )
        else:
            insert_sql = sa.text(
                "INSERT INTO master_data_options ("
                "  type, name, description, sort_order, is_active, is_default, "
                "  account_code, account_name, account_group, report_type, created_at, updated_at"
                ") VALUES ("
                "  'kategori', :name, :description, :sort_order, :is_active, :is_default, "
                "  :account_code, :account_name, :account_group, :report_type, :created_at, :updated_at"
                ")"
            )
            conn.execute(
                insert_sql,
                {
                    "name": item["name"],
                    "description": item["description"],
                    "sort_order": item["sort_order"],
                    "is_active": True,
                    "is_default": False,
                    "account_code": item["account_code"],
                    "account_name": item["account_name"],
                    "account_group": item["account_group"],
                    "report_type": item["report_type"],
                    "created_at": now_dt,
                    "updated_at": now_dt,
                },
            )


def downgrade() -> None:
    conn = op.get_bind()
    for item in NEW_CATEGORIES:
        delete_sql = sa.text(
            "DELETE FROM master_data_options WHERE type = 'kategori' AND LOWER(name) = LOWER(:name)"
        )
        conn.execute(delete_sql, {"name": item["name"]})
