"""runtime settings table; airdrops lose contract_address

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-19 18:00:00
"""
import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "runtime_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.drop_column("airdrops", "contract_address")


def downgrade() -> None:
    op.add_column("airdrops", sa.Column("contract_address", sa.String(length=42), nullable=True))
    op.drop_table("runtime_settings")
