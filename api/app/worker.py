"""Background worker: python -m app.worker"""

import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app import jobs
from app.db import SessionLocal
from app.risk import compute_risk_scores

log = logging.getLogger("worker")


def with_session(fn):
    async def run():
        try:
            async with SessionLocal() as session:
                result = await fn(session)
            log.info("%s -> %s", fn.__name__, result)
        except Exception:
            log.exception("Job %s failed", fn.__name__)

    run.__name__ = fn.__name__
    return run


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    scheduler = AsyncIOScheduler(timezone="UTC")
    opts = {"max_instances": 1, "coalesce": True}
    scheduler.add_job(with_session(jobs.send_spin_reminders), "interval", seconds=60, **opts)
    scheduler.add_job(with_session(jobs.accrue_x_daily), "cron", minute=5, **opts)
    scheduler.add_job(with_session(compute_risk_scores), "cron", hour=3, minute=0, **opts)
    scheduler.add_job(with_session(jobs.index_presale), "interval", seconds=30, **opts)
    scheduler.start()
    await with_session(jobs.accrue_x_daily)()
    log.info("Worker started")
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
