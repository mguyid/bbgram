"""Anti-Sybil: nightly risk scoring and cluster detection (plan 3.11, layer 2)."""

from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config_store import get_config
from app.models import RiskScore, User

# Signal weights. Score is the capped sum of triggered signals.
W_SHARED_DEVICE = 40
W_SHARED_IP = 20
W_SHARED_IP_SINGLE = 10
W_CHILDREN_SHARED = 30
W_TIMING = 20
W_ONLY_SPIN = 15
W_REFERRAL_BURST = 30
W_NEW_TELEGRAM_ID = 20

CHILDREN_SHARED_MIN = 3
TIMING_WINDOW_SECONDS = 5
TIMING_MIN_MATCHES = 3
ONLY_SPIN_MIN_SPINS = 3

SQL_SHARED_DEVICE = """
SELECT d.user_id, COUNT(DISTINCT o.user_id) FROM user_devices d
JOIN user_devices o ON o.device_hash = d.device_hash AND o.user_id <> d.user_id
WHERE d.device_hash <> '' GROUP BY d.user_id
"""
SQL_SHARED_IP = """
SELECT d.user_id, COUNT(DISTINCT o.user_id) FROM user_devices d
JOIN user_devices o ON o.ip = d.ip AND o.user_id <> d.user_id
WHERE d.ip <> '' GROUP BY d.user_id
"""
SQL_CHILDREN_SHARED = """
SELECT r1.referrer_id, COUNT(DISTINCT r1.referred_id) FROM referrals r1
JOIN referrals r2 ON r2.referrer_id = r1.referrer_id AND r2.referred_id <> r1.referred_id
JOIN user_devices d1 ON d1.user_id = r1.referred_id
JOIN user_devices d2 ON d2.user_id = r2.referred_id
WHERE (d1.ip = d2.ip AND d1.ip <> '') OR (d1.device_hash = d2.device_hash AND d1.device_hash <> '')
GROUP BY r1.referrer_id
"""
SQL_TIMING = """
SELECT user_id, COUNT(*) FROM (
  SELECT s1.user_id, s2.user_id AS other FROM spins s1
  JOIN spins s2 ON s2.user_id <> s1.user_id
   AND s2.created_at BETWEEN s1.created_at - make_interval(secs => :w) AND s1.created_at + make_interval(secs => :w)
  WHERE s1.created_at > now() - interval '7 days'
  GROUP BY s1.user_id, s2.user_id HAVING COUNT(DISTINCT s1.id) >= :m
) t GROUP BY user_id
"""
SQL_ONLY_SPIN = """
SELECT s.user_id FROM spins s GROUP BY s.user_id
HAVING COUNT(*) >= :n AND NOT EXISTS (
  SELECT 1 FROM screen_views v WHERE v.user_id = s.user_id AND v.screen NOT IN ('home', 'spin'))
"""
SQL_REFERRAL_BURST = """
SELECT referrer_id, MAX(cnt) FROM (
  SELECT r1.referrer_id, r1.id, COUNT(r2.id) AS cnt FROM referrals r1
  JOIN referrals r2 ON r2.referrer_id = r1.referrer_id
   AND r2.created_at >= r1.created_at AND r2.created_at < r1.created_at + make_interval(mins => :mins)
  GROUP BY r1.referrer_id, r1.id
) t GROUP BY referrer_id HAVING MAX(cnt) > :n
"""


async def _pairs(session: AsyncSession, sql: str, **params) -> dict[int, int]:
    return {int(a): int(b) for a, b in (await session.execute(text(sql), params)).all()}


async def compute_risk_scores(session: AsyncSession) -> int:
    cfg = await get_config(session)
    reasons: dict[int, list[tuple[int, str]]] = defaultdict(list)

    for uid, n in (await _pairs(session, SQL_SHARED_DEVICE)).items():
        reasons[uid].append((W_SHARED_DEVICE, f"Device shared with {n} other account(s)"))
    for uid, n in (await _pairs(session, SQL_SHARED_IP)).items():
        w = W_SHARED_IP if n >= 2 else W_SHARED_IP_SINGLE
        reasons[uid].append((w, f"IP shared with {n} other account(s)"))
    for uid, n in (await _pairs(session, SQL_CHILDREN_SHARED)).items():
        if n >= CHILDREN_SHARED_MIN:
            reasons[uid].append((W_CHILDREN_SHARED, f"{n} referred accounts share a device or IP"))
    for uid, n in (await _pairs(session, SQL_TIMING, w=TIMING_WINDOW_SECONDS, m=TIMING_MIN_MATCHES)).items():
        reasons[uid].append((W_TIMING, f"Spins in lockstep with {n} other account(s)"))
    only_spin = (await session.execute(text(SQL_ONLY_SPIN), {"n": ONLY_SPIN_MIN_SPINS})).scalars().all()
    for uid in only_spin:
        reasons[int(uid)].append((W_ONLY_SPIN, "Only spins, never opens other screens"))
    burst = await _pairs(session, SQL_REFERRAL_BURST, mins=int(cfg["referral_burst_minutes"]),
                         n=int(cfg["referral_burst_n"]))
    for uid, n in burst.items():
        reasons[uid].append((W_REFERRAL_BURST,
                             f"{n} referrals within {cfg['referral_burst_minutes']} minutes"))
    max_id = int(cfg["max_telegram_id"])
    if max_id:
        new_ids = (await session.execute(select(User.id).where(User.telegram_id > max_id))).scalars().all()
        for uid in new_ids:
            reasons[uid].append((W_NEW_TELEGRAM_ID, "New Telegram account (id above threshold)"))

    now = datetime.now(UTC)
    user_ids = (await session.execute(select(User.id))).scalars().all()
    rows = []
    for uid in user_ids:
        items = reasons.get(uid, [])
        rows.append({"user_id": uid, "score": min(100, sum(w for w, _ in items)),
                     "reasons": [r for _, r in items], "computed_at": now})
    for i in range(0, len(rows), 1000):
        stmt = insert(RiskScore).values(rows[i:i + 1000])
        await session.execute(stmt.on_conflict_do_update(
            index_elements=[RiskScore.user_id],
            set_={"score": stmt.excluded.score, "reasons": stmt.excluded.reasons,
                  "computed_at": stmt.excluded.computed_at},
        ))
    await session.commit()
    return len(rows)


async def find_clusters(session: AsyncSession, limit: int = 100) -> list[dict]:
    """Groups of accounts sharing an IP, a device hash or a referrer (2+ accounts)."""
    items = []
    for kind, col in (("ip", "ip"), ("device", "device_hash")):
        rows = (await session.execute(text(f"""
            SELECT {col}, array_agg(DISTINCT user_id ORDER BY user_id) FROM user_devices
            WHERE {col} <> '' GROUP BY {col} HAVING COUNT(DISTINCT user_id) > 1
            ORDER BY COUNT(DISTINCT user_id) DESC LIMIT :limit
        """), {"limit": limit})).all()
        items += [{"kind": kind, "key": key, "user_ids": list(ids), "count": len(ids)} for key, ids in rows]
    rows = (await session.execute(text("""
        SELECT referrer_id, array_agg(referred_id ORDER BY referred_id) FROM referrals
        GROUP BY referrer_id HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT :limit
    """), {"limit": limit})).all()
    items += [{"kind": "referrer", "key": str(key), "user_ids": list(ids), "count": len(ids)} for key, ids in rows]
    items.sort(key=lambda c: c["count"], reverse=True)
    return items
