import time
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Admin, User, UserDevice
from app.redis_client import redis
from app.security import read_token

USER_LIMIT_PER_MIN = 60


async def rate_limit(key: str, limit: int) -> None:
    """Fixed one-minute window counter in Redis; 429 once `limit` is exceeded."""
    window = int(time.time() // 60)
    rkey = f"rl:{key}:{window}"
    count = await redis.incr(rkey)
    if count == 1:
        await redis.expire(rkey, 60)
    if count > limit:
        raise HTTPException(429, "Too many requests. Try again in a minute.")


def ip_rate_limit(name: str, limit: int):
    async def dep(request: Request) -> None:
        await rate_limit(f"{name}:{request.client.host if request.client else ''}", limit)

    return dep


def bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Not signed in")
    return authorization[7:].strip()


async def record_device(
    session: AsyncSession,
    user_id: int,
    request: Request,
    platform: str | None = None,
    timezone: str | None = None,
    language: str | None = None,
) -> None:
    """Upsert request metadata (IP, user agent, device hash, ...) for anti-Sybil scoring."""
    now = datetime.now(UTC)
    values = {
        "user_id": user_id,
        "ip": (request.client.host if request.client else "")[:64],
        "device_hash": (request.headers.get("x-device-hash") or "")[:128],
        "user_agent": (request.headers.get("user-agent") or "")[:512],
        "platform": platform,
        "timezone": timezone,
        "language": language,
        "first_seen_at": now,
        "last_seen_at": now,
    }
    stmt = insert(UserDevice).values(**values)
    update = {"last_seen_at": now, "requests": UserDevice.requests + 1}
    for col in ("platform", "timezone", "language"):
        if values[col]:
            update[col] = values[col]
    await session.execute(stmt.on_conflict_do_update(constraint="uq_user_devices_combo", set_=update))


async def current_user(
    request: Request,
    authorization: str | None = Header(None),
    session: AsyncSession = Depends(get_session),
) -> User:
    user_id = read_token(bearer(authorization), "user")
    user = await session.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(401, "Session expired. Reopen the app.")
    await rate_limit(f"user:{user.id}", USER_LIMIT_PER_MIN)
    await record_device(session, user.id, request)
    await session.commit()
    return user


async def current_admin(
    authorization: str | None = Header(None),
    session: AsyncSession = Depends(get_session),
) -> Admin:
    admin_id = read_token(bearer(authorization), "admin")
    admin = await session.get(Admin, admin_id) if admin_id else None
    if not admin:
        raise HTTPException(401, "Not signed in")
    return admin


async def writer_admin(admin: Admin = Depends(current_admin)) -> Admin:
    if admin.role not in ("owner", "admin"):
        raise HTTPException(403, "Your role is read-only")
    return admin


async def owner_admin(admin: Admin = Depends(current_admin)) -> Admin:
    if admin.role != "owner":
        raise HTTPException(403, "Only the owner can do this")
    return admin
