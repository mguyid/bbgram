from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PointEvent, User


async def add_points(
    session: AsyncSession,
    user_id: int,
    type_: str,
    amount: int,
    ref_id: str | None = None,
    note: str | None = None,
) -> bool:
    """Append a ledger event. Returns False if (user, type, ref_id) was already recorded."""
    stmt = (
        insert(PointEvent)
        .values(user_id=user_id, type=type_, amount=amount, ref_id=ref_id, note=note,
                created_at=datetime.now(UTC))
        .on_conflict_do_nothing(constraint="uq_point_events_user_type_ref")
        .returning(PointEvent.id)
    )
    return (await session.execute(stmt)).scalar_one_or_none() is not None


async def balance_of(session: AsyncSession, user_id: int) -> int:
    q = select(func.coalesce(func.sum(PointEvent.amount), 0)).where(PointEvent.user_id == user_id)
    return int((await session.execute(q)).scalar_one())


def day_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def week_start(now: datetime | None = None) -> datetime:
    d = day_start(now)
    return d - timedelta(days=d.weekday())


async def delta_since(session: AsyncSession, user_id: int, since: datetime) -> int:
    q = select(func.coalesce(func.sum(PointEvent.amount), 0)).where(
        PointEvent.user_id == user_id, PointEvent.created_at >= since
    )
    return int((await session.execute(q)).scalar_one())


def balances_subquery(since: datetime | None = None):
    """Per-user point totals (all users with at least one event)."""
    q = select(PointEvent.user_id.label("user_id"), func.sum(PointEvent.amount).label("points"))
    if since is not None:
        q = q.where(PointEvent.created_at >= since)
    return q.group_by(PointEvent.user_id).subquery()


async def rank_of(session: AsyncSession, user_id: int, since: datetime | None = None) -> tuple[int, int]:
    """Return (rank, points) among non-banned users. Rank = 1 + users with strictly more points."""
    b = balances_subquery(since)
    mine = int(
        (await session.execute(select(func.coalesce(func.sum(b.c.points), 0)).where(b.c.user_id == user_id)))
        .scalar_one()
    )
    higher = (
        await session.execute(
            select(func.count())
            .select_from(b)
            .join(User, User.id == b.c.user_id)
            .where(User.banned.is_(False), b.c.points > mine)
        )
    ).scalar_one()
    return int(higher) + 1, mine
