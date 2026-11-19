from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Config

DEFAULTS: dict[str, Any] = {
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


async def get_config(session: AsyncSession) -> dict[str, Any]:
    rows = (await session.execute(select(Config))).scalars().all()
    cfg = dict(DEFAULTS)
    cfg.update({r.key: r.value for r in rows if r.key in DEFAULTS})
    return cfg


def validate_value(key: str, value: Any) -> Any:
    """Return value coerced to the type of the default, or raise ValueError."""
    if key not in DEFAULTS:
        raise ValueError(f"Unknown config key: {key}")
    default = DEFAULTS[key]
    if isinstance(default, bool):
        if not isinstance(value, bool):
            raise ValueError(f"{key} must be true or false")
        return value
    if isinstance(default, int):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"{key} must be a non-negative integer")
        return value
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string")
    return value


async def set_config(session: AsyncSession, key: str, value: Any) -> None:
    stmt = insert(Config).values(key=key, value=value)
    await session.execute(stmt.on_conflict_do_update(index_elements=[Config.key], set_={"value": value}))
