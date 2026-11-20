"""Background jobs run by the worker (also callable from tests)."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import chain, runtime, telegram
from app.config_store import get_config
from app.models import PresaleContribution, Spin, User, Wallet, XPost
from app.points import add_points
from app.redis_client import redis
from app.settings import settings

log = logging.getLogger(__name__)
INDEXER_KEY = "presale:last_block"


async def send_spin_reminders(session: AsyncSession) -> int:
    """Message users whose spin has refilled since their last spin (once per spin)."""
    cfg = await get_config(session)
    if cfg["activity_paused"]:
        return 0
    cutoff = datetime.now(UTC) - timedelta(hours=int(cfg["spin_interval_hours"]))
    latest = select(Spin.user_id, func.max(Spin.id).label("spin_id")).group_by(Spin.user_id).subquery()
    rows = (await session.execute(
        select(Spin, User).join(latest, latest.c.spin_id == Spin.id).join(User, User.id == Spin.user_id)
        .where(Spin.reminded.is_(False), Spin.created_at <= cutoff, User.reminders_enabled.is_(True),
               User.banned.is_(False))
        .limit(500)
    )).all()
    sent = 0
    for spin, user in rows:
        spin.reminded = True  # mark first so a failed send is not retried forever
        await session.commit()
        if await telegram.send_message(user.telegram_id, "Your spin is ready.", button_text="Spin now",
                                       web_app_url=settings.MINIAPP_URL):
            sent += 1
    return sent


async def accrue_x_daily(session: AsyncSession, now: datetime | None = None) -> int:
    """Award daily points once per UTC day per active X post and per marked bio. Idempotent."""
    cfg = await get_config(session)
    if cfg["activity_paused"]:
        return 0
    day = (now or datetime.now(UTC)).date().isoformat()
    awarded = 0
    posts = (await session.execute(
        select(XPost.id, XPost.user_id).join(User, User.id == XPost.user_id)
        .where(XPost.status == "active", User.banned.is_(False))
    )).all()
    for post_id, user_id in posts:
        awarded += await add_points(session, user_id, "x_post_daily", int(cfg["x_post_daily_points"]),
                                    f"x_post_daily:{post_id}:{day}")
    bios = (await session.execute(
        select(User.id).where(User.x_bio_marked.is_(True), User.banned.is_(False))
    )).scalars().all()
    for user_id in bios:
        awarded += await add_points(session, user_id, "x_bio_daily", int(cfg["x_bio_daily_points"]),
                                    f"x_bio_daily:{day}")
    await session.commit()
    return awarded


async def index_presale(session: AsyncSession) -> int:
    """Index USDT transfers into the presale wallet from presale_start_block; idempotent by (tx_hash, log_index).
    Stops once the presale is closed, so allocations and the contribution list stay in step."""
    rt = await runtime.get()
    if not (rt.rpc_url and rt.presale_wallet and rt.usdt):
        return 0
    if (await get_config(session))["presale_closed_at"]:
        return 0
    last = await redis.get(INDEXER_KEY)
    from_block = int(last) + 1 if last else rt.start_block_int
    logs, scanned_to = await chain.fetch_presale_transfers(rt, from_block)
    wallets = dict((await session.execute(select(func.lower(Wallet.address), Wallet.user_id))).all())
    for lg in logs:
        await session.execute(insert(PresaleContribution).values(
            wallet_address=lg["buyer"], user_id=wallets.get(lg["buyer"].lower()), amount_wei=lg["amount"],
            total_wei=0, tx_hash=lg["tx_hash"], log_index=lg["log_index"],
            block_number=lg["block_number"], created_at=datetime.now(UTC),
        ).on_conflict_do_nothing(constraint="uq_presale_contributions_log"))
    await session.commit()
    await redis.set(INDEXER_KEY, scanned_to)
    return len(logs)
