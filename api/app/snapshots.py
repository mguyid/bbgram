"""Snapshot -> preview -> airdrop build."""

from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config_store import get_config
from app.merkle import build_tree
from app.models import Airdrop, AirdropProof, Referral, RiskScore, Snapshot, SnapshotBalance, User, Wallet
from app.points import add_points, balances_subquery

WEI_PER_TOKEN = 10**18


def to_wei(tokens: Decimal) -> int:
    return int(Decimal(tokens) * WEI_PER_TOKEN)


def wei_to_str(wei: int) -> str:
    whole, frac = divmod(int(wei), WEI_PER_TOKEN)
    frac_s = f"{frac:018d}".rstrip("0")
    return f"{whole}.{frac_s}" if frac_s else str(whole)


async def create_snapshot(session: AsyncSession, admin_id: int | None) -> Snapshot:
    cfg = await get_config(session)
    if not cfg["activity_paused"]:
        raise HTTPException(409, "Pause activity before taking a snapshot.")
    threshold = int(cfg["risk_threshold"])
    risk = dict((await session.execute(select(RiskScore.user_id, RiskScore.score))).all())
    users = (await session.execute(select(User))).scalars().all()
    wallets = dict((await session.execute(select(Wallet.user_id, Wallet.address))).all())

    def sybil_reason(u: User) -> str | None:
        if u.banned:
            return "banned"
        if risk.get(u.id, 0) >= threshold:
            return "risk"
        return None

    sybils = {u.id for u in users if sybil_reason(u)}

    # Claw back referral points the referrer earned from excluded (banned / high-risk) users.
    if sybils:
        refs = (await session.execute(
            select(Referral).where(Referral.status == "credited", Referral.referred_id.in_(sybils))
        )).scalars().all()
        for ref in refs:
            await add_points(session, ref.referrer_id, "clawback", -ref.points, f"clawback:{ref.id}",
                             note=f"referral from excluded user {ref.referred_id}")
            ref.status = "clawed_back"
        await session.flush()

    b = balances_subquery()
    balances = dict((await session.execute(select(b.c.user_id, b.c.points))).all())
    snap = Snapshot(created_by=admin_id)
    session.add(snap)
    await session.flush()
    for u in users:
        points = int(balances.get(u.id, 0))
        if points <= 0:
            continue
        reason = sybil_reason(u) or (None if wallets.get(u.id) else "no_wallet")
        session.add(SnapshotBalance(
            snapshot_id=snap.id, user_id=u.id, wallet_address=wallets.get(u.id), points=points,
            risk_score=risk.get(u.id, 0), excluded=reason is not None, exclusion_reason=reason,
        ))
    await session.commit()
    return snap


@dataclass
class Allocation:
    user_id: int
    wallet_address: str
    points: int
    amount_wei: int


async def compute_allocations(
    session: AsyncSession,
    snapshot_id: int,
    pool_tokens: Decimal,
    min_points: int | None,
    per_user_cap_tokens: Decimal | None,
) -> list[Allocation]:
    """Each eligible user gets pool * points / total_points, optionally capped (no redistribution)."""
    if pool_tokens <= 0:
        raise HTTPException(400, "Pool size must be greater than zero.")
    rows = (await session.execute(
        select(SnapshotBalance).where(
            SnapshotBalance.snapshot_id == snapshot_id,
            SnapshotBalance.excluded.is_(False),
            SnapshotBalance.wallet_address.is_not(None),
            SnapshotBalance.points >= max(min_points or 1, 1),
        ).order_by(SnapshotBalance.user_id)
    )).scalars().all()
    total = sum(r.points for r in rows)
    pool_wei = to_wei(pool_tokens)
    cap_wei = to_wei(per_user_cap_tokens) if per_user_cap_tokens else None
    out = []
    for r in rows:
        amount = pool_wei * r.points // total
        if cap_wei is not None:
            amount = min(amount, cap_wei)
        out.append(Allocation(r.user_id, r.wallet_address, r.points, amount))
    return out


async def build_airdrop(
    session: AsyncSession,
    snapshot_id: int,
    pool_tokens: Decimal,
    min_points: int | None,
    per_user_cap_tokens: Decimal | None,
) -> Airdrop:
    allocations = [a for a in await compute_allocations(
        session, snapshot_id, pool_tokens, min_points, per_user_cap_tokens) if a.amount_wei > 0]
    if not allocations:
        raise HTTPException(400, "No eligible recipients for this airdrop.")
    tree = build_tree([(a.wallet_address, a.amount_wei) for a in allocations])
    drop = Airdrop(
        snapshot_id=snapshot_id,
        merkle_root=tree.root,
        total_amount_wei=sum(a.amount_wei for a in allocations),
        recipients=len(allocations),
        params={"pool_tokens": str(pool_tokens), "min_points": min_points,
                "per_user_cap_tokens": str(per_user_cap_tokens) if per_user_cap_tokens else None},
    )
    session.add(drop)
    await session.flush()
    for a in allocations:
        session.add(AirdropProof(
            airdrop_id=drop.id, user_id=a.user_id, wallet_address=a.wallet_address,
            amount_wei=a.amount_wei, proof=tree.proof(a.wallet_address, a.amount_wei),
        ))
    await session.commit()
    return drop
