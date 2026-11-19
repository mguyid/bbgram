"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-19 12:12:35.165362
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# Config defaults (interfaces.md section 3), frozen here so the migration never changes.
CONFIG_DEFAULTS = {
    "activity_paused": False,
    "points_per_spin": 200,
    "spin_interval_hours": 3,
    "referral_points": 250,
    "register_points": 100,
    "x_connect_points": 500,
    "x_post_points": 100,
    "x_post_daily_points": 50,
    "x_bio_daily_points": 50,
    "join_channel_points": 250,
    "telegram_channel": "",
    "max_telegram_id": 0,
    "risk_threshold": 70,
    "referral_burst_n": 10,
    "referral_burst_minutes": 60,
}

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('admins',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('totp_secret', sa.String(length=64), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('config',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('telegram_id', sa.BigInteger(), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=True),
    sa.Column('first_name', sa.String(length=128), nullable=True),
    sa.Column('photo_url', sa.Text(), nullable=True),
    sa.Column('language', sa.String(length=16), nullable=True),
    sa.Column('referral_code', sa.String(length=16), nullable=False),
    sa.Column('referred_by_id', sa.Integer(), nullable=True),
    sa.Column('reminders_enabled', sa.Boolean(), nullable=False),
    sa.Column('banned', sa.Boolean(), nullable=False),
    sa.Column('x_bio_marked', sa.Boolean(), nullable=False),
    sa.Column('x_bio_marked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('x_bio_revoked', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['referred_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('referral_code'),
    sa.UniqueConstraint('telegram_id')
    )
    op.create_table('admin_audit_log',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('admin_id', sa.Integer(), nullable=True),
    sa.Column('admin_email', sa.String(length=255), nullable=False),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('target', sa.String(length=128), nullable=True),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['admin_id'], ['admins.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_audit_log_created_at'), 'admin_audit_log', ['created_at'], unique=False)
    op.create_table('bans',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('admin_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('lifted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['admin_id'], ['admins.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bans_user_id'), 'bans', ['user_id'], unique=False)
    op.create_table('point_events',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=32), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('ref_id', sa.String(length=128), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'type', 'ref_id', name='uq_point_events_user_type_ref')
    )
    op.create_index(op.f('ix_point_events_created_at'), 'point_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_point_events_user_id'), 'point_events', ['user_id'], unique=False)
    op.create_table('presale_contributions',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('wallet_address', sa.String(length=42), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('amount_wei', sa.Numeric(precision=78, scale=0), nullable=False),
    sa.Column('total_wei', sa.Numeric(precision=78, scale=0), nullable=False),
    sa.Column('tx_hash', sa.String(length=66), nullable=False),
    sa.Column('log_index', sa.Integer(), nullable=False),
    sa.Column('block_number', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tx_hash', 'log_index', name='uq_presale_contributions_log')
    )
    op.create_index(op.f('ix_presale_contributions_wallet_address'), 'presale_contributions', ['wallet_address'], unique=False)
    op.create_table('presale_whitelist',
    sa.Column('wallet_address', sa.String(length=42), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('added_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['added_by'], ['admins.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('wallet_address')
    )
    op.create_table('referrals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('referrer_id', sa.Integer(), nullable=False),
    sa.Column('referred_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('points', sa.Integer(), nullable=False),
    sa.Column('credited_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['referred_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['referrer_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('referred_id')
    )
    op.create_index(op.f('ix_referrals_referrer_id'), 'referrals', ['referrer_id'], unique=False)
    op.create_table('risk_scores',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('score', sa.Integer(), nullable=False),
    sa.Column('reasons', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('screen_views',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('screen', sa.String(length=32), nullable=False),
    sa.Column('views', sa.Integer(), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'screen', name='uq_screen_views_user_screen')
    )
    op.create_table('snapshots',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['admins.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('spins',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('points', sa.Integer(), nullable=False),
    sa.Column('reminded', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_spins_created_at'), 'spins', ['created_at'], unique=False)
    op.create_index(op.f('ix_spins_user_id'), 'spins', ['user_id'], unique=False)
    op.create_table('user_devices',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('device_hash', sa.String(length=128), nullable=False),
    sa.Column('user_agent', sa.Text(), nullable=False),
    sa.Column('platform', sa.String(length=32), nullable=True),
    sa.Column('timezone', sa.String(length=64), nullable=True),
    sa.Column('language', sa.String(length=16), nullable=True),
    sa.Column('requests', sa.Integer(), nullable=False),
    sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'ip', 'device_hash', 'user_agent', name='uq_user_devices_combo')
    )
    op.create_index(op.f('ix_user_devices_device_hash'), 'user_devices', ['device_hash'], unique=False)
    op.create_index(op.f('ix_user_devices_ip'), 'user_devices', ['ip'], unique=False)
    op.create_index(op.f('ix_user_devices_user_id'), 'user_devices', ['user_id'], unique=False)
    op.create_table('wallets',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('address', sa.String(length=42), nullable=False),
    sa.Column('linked_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('address'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('x_accounts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('x_user_id', sa.String(length=32), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=False),
    sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id'),
    sa.UniqueConstraint('x_user_id')
    )
    op.create_table('x_posts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('url', sa.Text(), nullable=False),
    sa.Column('status_id', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('status_id')
    )
    op.create_index(op.f('ix_x_posts_user_id'), 'x_posts', ['user_id'], unique=False)
    op.create_table('airdrops',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('snapshot_id', sa.Integer(), nullable=False),
    sa.Column('merkle_root', sa.String(length=66), nullable=False),
    sa.Column('total_amount_wei', sa.Numeric(precision=78, scale=0), nullable=False),
    sa.Column('recipients', sa.Integer(), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('contract_address', sa.String(length=42), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['snapshot_id'], ['snapshots.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('snapshot_balances',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('snapshot_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('wallet_address', sa.String(length=42), nullable=True),
    sa.Column('points', sa.Integer(), nullable=False),
    sa.Column('risk_score', sa.Integer(), nullable=False),
    sa.Column('excluded', sa.Boolean(), nullable=False),
    sa.Column('exclusion_reason', sa.String(length=32), nullable=True),
    sa.ForeignKeyConstraint(['snapshot_id'], ['snapshots.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('snapshot_id', 'user_id', name='uq_snapshot_balances_user')
    )
    op.create_index(op.f('ix_snapshot_balances_snapshot_id'), 'snapshot_balances', ['snapshot_id'], unique=False)
    op.create_table('airdrop_proofs',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('airdrop_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('wallet_address', sa.String(length=42), nullable=False),
    sa.Column('amount_wei', sa.Numeric(precision=78, scale=0), nullable=False),
    sa.Column('proof', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.ForeignKeyConstraint(['airdrop_id'], ['airdrops.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('airdrop_id', 'wallet_address', name='uq_airdrop_proofs_wallet')
    )
    op.create_index(op.f('ix_airdrop_proofs_airdrop_id'), 'airdrop_proofs', ['airdrop_id'], unique=False)
    op.create_index(op.f('ix_airdrop_proofs_user_id'), 'airdrop_proofs', ['user_id'], unique=False)

    config = sa.table("config", sa.column("key", sa.String), sa.column("value", postgresql.JSONB))
    op.bulk_insert(config, [{"key": k, "value": v} for k, v in CONFIG_DEFAULTS.items()])


def downgrade() -> None:
    op.drop_index(op.f('ix_airdrop_proofs_user_id'), table_name='airdrop_proofs')
    op.drop_index(op.f('ix_airdrop_proofs_airdrop_id'), table_name='airdrop_proofs')
    op.drop_table('airdrop_proofs')
    op.drop_index(op.f('ix_snapshot_balances_snapshot_id'), table_name='snapshot_balances')
    op.drop_table('snapshot_balances')
    op.drop_table('airdrops')
    op.drop_index(op.f('ix_x_posts_user_id'), table_name='x_posts')
    op.drop_table('x_posts')
    op.drop_table('x_accounts')
    op.drop_table('wallets')
    op.drop_index(op.f('ix_user_devices_user_id'), table_name='user_devices')
    op.drop_index(op.f('ix_user_devices_ip'), table_name='user_devices')
    op.drop_index(op.f('ix_user_devices_device_hash'), table_name='user_devices')
    op.drop_table('user_devices')
    op.drop_index(op.f('ix_spins_user_id'), table_name='spins')
    op.drop_index(op.f('ix_spins_created_at'), table_name='spins')
    op.drop_table('spins')
    op.drop_table('snapshots')
    op.drop_table('screen_views')
    op.drop_table('risk_scores')
    op.drop_index(op.f('ix_referrals_referrer_id'), table_name='referrals')
    op.drop_table('referrals')
    op.drop_table('presale_whitelist')
    op.drop_index(op.f('ix_presale_contributions_wallet_address'), table_name='presale_contributions')
    op.drop_table('presale_contributions')
    op.drop_index(op.f('ix_point_events_user_id'), table_name='point_events')
    op.drop_index(op.f('ix_point_events_created_at'), table_name='point_events')
    op.drop_table('point_events')
    op.drop_index(op.f('ix_bans_user_id'), table_name='bans')
    op.drop_table('bans')
    op.drop_index(op.f('ix_admin_audit_log_created_at'), table_name='admin_audit_log')
    op.drop_table('admin_audit_log')
    op.drop_table('users')
    op.drop_table('config')
    op.drop_table('admins')
