"""simulated presale contributions

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-21 12:00:00
"""
import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "presale_simulated",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("wallet_address", sa.String(length=42), nullable=False),
        sa.Column("amount_wei", sa.Numeric(78, 0), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_presale_simulated_created_at", "presale_simulated", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_presale_simulated_created_at", table_name="presale_simulated")
    op.drop_table("presale_simulated")
