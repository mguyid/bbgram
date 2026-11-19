"""admin 2FA is optional and set up from the dashboard

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-19 20:00:00
"""
import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("admins", "totp_secret", existing_type=sa.String(length=64), nullable=True)
    # Secrets from the old CLI were never confirmed by the admin; start everyone with 2FA off.
    op.execute("UPDATE admins SET totp_secret = NULL")


def downgrade() -> None:
    op.execute("DELETE FROM admins WHERE totp_secret IS NULL")
    op.alter_column("admins", "totp_secret", existing_type=sa.String(length=64), nullable=False)
