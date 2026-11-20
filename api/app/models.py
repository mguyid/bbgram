from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

WEI = Numeric(78, 0)


def utcnow() -> datetime:
    return datetime.now(UTC)


def ts(**kw: Any) -> Any:
    return mapped_column(DateTime(timezone=True), **kw)


def created() -> Any:
    return mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


def user_fk(**kw: Any) -> Any:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), **kw)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    photo_url: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(String(16))
    referral_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    referred_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    x_bio_marked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    x_bio_marked_at: Mapped[datetime | None] = ts()
    x_bio_revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = created()


class Referral(Base):
    __tablename__ = "referrals"
    id: Mapped[int] = mapped_column(primary_key=True)
    referrer_id: Mapped[int] = user_fk(nullable=False, index=True)
    referred_id: Mapped[int] = user_fk(nullable=False, unique=True)
    # pending | credited | rejected | clawed_back
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    credited_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created()


class PointEvent(Base):
    __tablename__ = "point_events"
    __table_args__ = (UniqueConstraint("user_id", "type", "ref_id", name="uq_point_events_user_type_ref"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    ref_id: Mapped[str | None] = mapped_column(String(128))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class Spin(Base):
    __tablename__ = "spins"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, index=True)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    reminded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class UserDevice(Base):
    __tablename__ = "user_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "ip", "device_hash", "user_agent", name="uq_user_devices_combo"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, index=True)
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    device_hash: Mapped[str] = mapped_column(String(128), nullable=False, default="", index=True)
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    platform: Mapped[str | None] = mapped_column(String(32))
    timezone: Mapped[str | None] = mapped_column(String(64))
    language: Mapped[str | None] = mapped_column(String(16))
    requests: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    first_seen_at: Mapped[datetime] = created()
    last_seen_at: Mapped[datetime] = created()


class ScreenView(Base):
    __tablename__ = "screen_views"
    __table_args__ = (UniqueConstraint("user_id", "screen", name="uq_screen_views_user_screen"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False)
    screen: Mapped[str] = mapped_column(String(32), nullable=False)
    views: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_seen_at: Mapped[datetime] = created()


class RiskScore(Base):
    __tablename__ = "risk_scores"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reasons: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    computed_at: Mapped[datetime] = created()


class Ban(Base):
    __tablename__ = "bans"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created()
    lifted_at: Mapped[datetime | None] = ts()


class XAccount(Base):
    __tablename__ = "x_accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, unique=True)
    x_user_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    connected_at: Mapped[datetime] = created()


class XPost(Base):
    __tablename__ = "x_posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = created()
    revoked_at: Mapped[datetime | None] = ts()


class Wallet(Base):
    __tablename__ = "wallets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = user_fk(nullable=False, unique=True)
    address: Mapped[str] = mapped_column(String(42), nullable=False, unique=True)
    linked_at: Mapped[datetime] = created()


class Snapshot(Base):
    __tablename__ = "snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created()


class SnapshotBalance(Base):
    __tablename__ = "snapshot_balances"
    __table_args__ = (UniqueConstraint("snapshot_id", "user_id", name="uq_snapshot_balances_user"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = user_fk(nullable=False)
    wallet_address: Mapped[str | None] = mapped_column(String(42))
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    exclusion_reason: Mapped[str | None] = mapped_column(String(32))


class Airdrop(Base):
    __tablename__ = "airdrops"
    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    merkle_root: Mapped[str] = mapped_column(String(66), nullable=False)
    total_amount_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    recipients: Mapped[int] = mapped_column(Integer, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = created()


class AirdropProof(Base):
    __tablename__ = "airdrop_proofs"
    __table_args__ = (UniqueConstraint("airdrop_id", "wallet_address", name="uq_airdrop_proofs_wallet"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    airdrop_id: Mapped[int] = mapped_column(
        ForeignKey("airdrops.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = user_fk(nullable=False, index=True)
    wallet_address: Mapped[str] = mapped_column(String(42), nullable=False)
    amount_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    proof: Mapped[list[str]] = mapped_column(JSONB, nullable=False)


class PresaleAllocation(Base):
    """One row per paying wallet, frozen when the admin closes the presale (the presale snapshot).
    `credited_tx` is set once the team has sent the tokens after launch."""
    __tablename__ = "presale_allocations"
    wallet_address: Mapped[str] = mapped_column(String(42), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    contributed_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    counted_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    tokens_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    credited_tx: Mapped[str | None] = mapped_column(String(66))
    credited_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created()


class PresaleContribution(Base):
    """A USDT transfer into the presale wallet (indexed from chain; `total_wei` is unused and kept 0)."""
    __tablename__ = "presale_contributions"
    __table_args__ = (UniqueConstraint("tx_hash", "log_index", name="uq_presale_contributions_log"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wallet_address: Mapped[str] = mapped_column(String(42), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    amount_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    total_wei: Mapped[Decimal] = mapped_column(WEI, nullable=False)
    tx_hash: Mapped[str] = mapped_column(String(66), nullable=False)
    log_index: Mapped[int] = mapped_column(Integer, nullable=False)
    block_number: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = created()


class Config(Base):
    __tablename__ = "config"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)


class RuntimeSetting(Base):
    """Runtime settings managed in admin (interfaces.md 2a). Secret values are Fernet-encrypted."""
    __tablename__ = "runtime_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = created()


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    admin_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target: Mapped[str | None] = mapped_column(String(128))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )
