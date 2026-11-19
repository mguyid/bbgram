"""Domain logic shared by the mini app API, admin API and worker."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import runtime
from app.config_store import get_config
from app.models import Referral, Spin, User, Wallet, XAccount
from app.points import add_points, balance_of, day_start, delta_since, rank_of
from app.redis_client import redis
from app.security import TelegramUser

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


async def referral_link(code: str) -> str:
    return f"https://t.me/{(await runtime.get()).telegram_bot_username}?startapp={code}"


async def ensure_can_earn(session: AsyncSession, user: User) -> dict[str, Any]:
    """Raise 403 for banned users and 423 while activity is paused. Returns config."""
    if user.banned:
        raise HTTPException(403, "Your account is restricted.")
    cfg = await get_config(session)
    if cfg["activity_paused"]:
        raise HTTPException(423, "Activity is paused right now. Points are being tallied.")
    return cfg


async def _new_code(session: AsyncSession) -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        if not (await session.execute(select(User.id).where(User.referral_code == code))).first():
            return code


async def apply_referral(session: AsyncSession, user: User, code: str | None) -> bool:
    """Attach a referrer by code. Rejects self-referral, circular chains and users already referred."""
    if not code or user.referred_by_id is not None:
        return False
    referrer = (await session.execute(select(User).where(User.referral_code == code))).scalar_one_or_none()
    if referrer is None or referrer.id == user.id:
        return False
    # Walk up the referrer's chain: if `user` appears, linking would create a cycle (A->B->A).
    seen = {referrer.id}
    cursor = referrer.referred_by_id
    while cursor is not None:
        if cursor == user.id or cursor in seen:
            return False
        seen.add(cursor)
        cursor = (await session.execute(select(User.referred_by_id).where(User.id == cursor))).scalar()
    user.referred_by_id = referrer.id
    session.add(Referral(referrer_id=referrer.id, referred_id=user.id, status="pending"))
    return True


async def register_or_update(
    session: AsyncSession, tg: TelegramUser, start_param: str | None, language: str | None
) -> User:
    user = (await session.execute(select(User).where(User.telegram_id == tg.id))).scalar_one_or_none()
    if user is None:
        user = User(
            telegram_id=tg.id,
            username=tg.username,
            first_name=tg.first_name,
            photo_url=tg.photo_url,
            language=language or tg.language_code,
            referral_code=await _new_code(session),
        )
        session.add(user)
        await session.flush()
        cfg = await get_config(session)
        if not cfg["activity_paused"]:
            await add_points(session, user.id, "register", cfg["register_points"], "register")
        await apply_referral(session, user, start_param or tg.start_param)
    else:
        user.username = tg.username
        user.first_name = tg.first_name
        user.photo_url = tg.photo_url
        if language or tg.language_code:
            user.language = language or tg.language_code
    await session.flush()
    return user


async def referral_eligible(session: AsyncSession, referred: User, cfg: dict[str, Any]) -> bool:
    if not referred.username or not referred.photo_url:
        return False
    max_id = int(cfg["max_telegram_id"])
    return not (max_id and referred.telegram_id > max_id)


async def credit_referral(session: AsyncSession, referred: User, cfg: dict[str, Any]) -> None:
    """Called after the referred user's first spin."""
    ref = (
        await session.execute(
            select(Referral).where(Referral.referred_id == referred.id, Referral.status == "pending")
        )
    ).scalar_one_or_none()
    if ref is None:
        return
    referrer = await session.get(User, ref.referrer_id)
    if referrer is None or referrer.banned or not await referral_eligible(session, referred, cfg):
        ref.status = "rejected"
        return
    points = int(cfg["referral_points"])
    await add_points(session, referrer.id, "referral", points, f"referral:{referred.id}")
    ref.status = "credited"
    ref.points = points
    ref.credited_at = datetime.now(UTC)


async def last_spin(session: AsyncSession, user_id: int) -> Spin | None:
    q = select(Spin).where(Spin.user_id == user_id).order_by(Spin.created_at.desc()).limit(1)
    return (await session.execute(q)).scalar_one_or_none()


def next_refill(spin: Spin | None, cfg: dict[str, Any]) -> datetime | None:
    if spin is None:
        return None
    return spin.created_at + timedelta(hours=int(cfg["spin_interval_hours"]))


async def do_spin(session: AsyncSession, user: User) -> dict[str, Any]:
    cfg = await ensure_can_earn(session, user)
    lock_key = f"lock:spin:{user.id}"
    if not await redis.set(lock_key, "1", nx=True, ex=15):
        raise HTTPException(409, "Spin already in progress.")
    try:
        prev = await last_spin(session, user.id)
        refill = next_refill(prev, cfg)
        now = datetime.now(UTC)
        if refill and refill > now:
            raise HTTPException(409, "Your spin is not ready yet.")
        points = int(cfg["points_per_spin"])
        spin = Spin(user_id=user.id, points=points, created_at=now)
        session.add(spin)
        await session.flush()
        await add_points(session, user.id, "spin", points, f"spin:{spin.id}")
        if prev is None:
            await credit_referral(session, user, cfg)
        await session.commit()
    finally:
        await redis.delete(lock_key)
    return {
        "points": points,
        "balance": await balance_of(session, user.id),
        "next_refill_at": now + timedelta(hours=int(cfg["spin_interval_hours"])),
    }


async def build_me(session: AsyncSession, user: User) -> dict[str, Any]:
    cfg = await get_config(session)
    wallet = (await session.execute(select(Wallet.address).where(Wallet.user_id == user.id))).scalar()
    x_username = (
        await session.execute(select(XAccount.username).where(XAccount.user_id == user.id))
    ).scalar()
    rank, balance = await rank_of(session, user.id)
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "username": user.username,
        "first_name": user.first_name,
        "photo_url": user.photo_url,
        "referral_code": user.referral_code,
        "referral_link": await referral_link(user.referral_code),
        "balance": balance,
        "today_delta": await delta_since(session, user.id, day_start()),
        "rank": rank,
        "wallet_address": wallet,
        "x_username": x_username,
        "reminders_enabled": user.reminders_enabled,
        "banned": user.banned,
        "activity_paused": bool(cfg["activity_paused"]),
    }

