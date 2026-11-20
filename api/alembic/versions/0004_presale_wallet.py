"""presale without a contract: drop the whitelist, add frozen allocations

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-20 12:00:00
"""
import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

WEI = sa.Numeric(78, 0)


def upgrade() -> None:
    op.drop_table("presale_whitelist")
    op.create_table(
        "presale_allocations",
        sa.Column("wallet_address", sa.String(length=42), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("contributed_wei", WEI, nullable=False),
        sa.Column("counted_wei", WEI, nullable=False),
        sa.Column("tokens_wei", WEI, nullable=False),
        sa.Column("credited_tx", sa.String(length=66)),
        sa.Column("credited_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Old rows came from the presale contract's Contributed events, which no longer exist.
    op.execute("DELETE FROM presale_contributions")
    op.execute("DELETE FROM runtime_settings WHERE key IN ('presale_address', 'signer_key')")


def downgrade() -> None:
    op.drop_table("presale_allocations")
    op.create_table(
        "presale_whitelist",
        sa.Column("wallet_address", sa.String(length=42), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("added_by", sa.Integer(), sa.ForeignKey("admins.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
