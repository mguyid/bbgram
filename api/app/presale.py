"""Presale without a contract (interfaces.md section 1 and 2, Presale).

Buyers send USDT from their linked wallet straight to the presale wallet. The worker indexes those
transfers into `presale_contributions`. Terms live in config (`presale_*`). Closing the presale freezes
one `presale_allocations` row per paying wallet; after launch the team sends the tokens and marks
each row credited with the transaction hash.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config_store import get_config, set_config
from app.models import PresaleAllocation, PresaleContribution, User, Wallet
from app.runtime import Runtime

WEI = 10**18


@dataclass(frozen=True)
class Terms:
    tokens_per_usdt_wei: int
    hard_cap_wei: int
    min_wei: int
    max_wei: int
    start: datetime | None
    end: datetime | None
    paused: bool
    closed_at: datetime | None


def parse_price(value: str) -> int:
    """Tokens per 1 USDT as a decimal string -> token wei per whole USDT. Raises ValueError."""
    try:
        d = Decimal(value)
    except InvalidOperation as e:
        raise ValueError("presale_tokens_per_usdt must be a number, e.g. 100") from e
    if not d.is_finite() or d <= 0:
        raise ValueError("presale_tokens_per_usdt must be greater than 0")
    return int(d * WEI)


def parse_time(value: str) -> datetime:
    """ISO-8601 -> aware UTC datetime. Raises ValueError."""
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(f"{value!r} is not an ISO-8601 date and time") from e
    return (t if t.tzinfo else t.replace(tzinfo=UTC)).astimezone(UTC)


def iso(t: datetime | None) -> str | None:
    return t.astimezone(UTC).isoformat().replace("+00:00", "Z") if t else None


def terms_from(cfg: dict[str, Any]) -> Terms:
    def t(key: str) -> datetime | None:
        try:
            return parse_time(cfg[key]) if cfg[key] else None
        except ValueError:
            return None

    try:
        price = parse_price(cfg["presale_tokens_per_usdt"]) if cfg["presale_tokens_per_usdt"] else 0
    except ValueError:
        price = 0
    return Terms(
        tokens_per_usdt_wei=price,
        hard_cap_wei=int(cfg["presale_hard_cap_usdt"]) * WEI,
        min_wei=int(cfg["presale_min_usdt"]) * WEI,
        max_wei=int(cfg["presale_max_usdt"]) * WEI,
        start=t("presale_start_at"),
        end=t("presale_end_at"),
        paused=bool(cfg["presale_paused"]),
        closed_at=t("presale_closed_at"),
    )


async def get_terms(session: AsyncSession) -> Terms:
    return terms_from(await get_config(session))


def validate_update(current: dict[str, Any], values: dict[str, Any]) -> None:
    """Checks a config write touching presale keys. Raises ValueError (400) or PermissionError (409)."""
    keys = {k for k in values if k.startswith("presale_")}
    if not keys:
        return
    if "presale_closed_at" in keys:
        raise ValueError("presale_closed_at is set by closing the presale.")
    if current["presale_closed_at"]:
        raise PermissionError("The presale is closed. Reopen it to change its terms.")
    merged = {**current, **values}
    if merged["presale_tokens_per_usdt"]:
        parse_price(merged["presale_tokens_per_usdt"])
    start = parse_time(merged["presale_start_at"]) if merged["presale_start_at"] else None
    end = parse_time(merged["presale_end_at"]) if merged["presale_end_at"] else None
    if start and end and end <= start:
        raise ValueError("The presale must end after it starts.")
    if int(merged["presale_min_usdt"]) > int(merged["presale_max_usdt"]):
        raise ValueError("The minimum per wallet cannot be above the maximum.")


def allocation(contributed_wei: int, t: Terms) -> tuple[int, int]:
    """(counted USDT wei, token wei) for a wallet's total contribution."""
    counted = min(contributed_wei, t.max_wei) if t.max_wei else contributed_wei
    return counted, counted * t.tokens_per_usdt_wei // WEI


def configured(rt: Runtime, t: Terms) -> bool:
    return bool(rt.presale_wallet and t.tokens_per_usdt_wei and t.start and t.end)


def status(rt: Runtime, t: Terms, raised_wei: int, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    if t.closed_at:
        return "closed"
    if t.paused:
        return "paused"
    if not configured(rt, t) or now < t.start:  # type: ignore[operator]
        return "upcoming"
    if now >= t.end or (t.hard_cap_wei and raised_wei >= t.hard_cap_wei):  # type: ignore[operator]
        return "ended"
    return "live"


async def raised(session: AsyncSession) -> int:
    return int((await session.execute(
        select(func.coalesce(func.sum(PresaleContribution.amount_wei), 0)))).scalar_one())


async def contributed(session: AsyncSession, wallet: str) -> int:
    return int((await session.execute(
        select(func.coalesce(func.sum(PresaleContribution.amount_wei), 0))
        .where(func.lower(PresaleContribution.wallet_address) == wallet.lower())
    )).scalar_one())


async def live_rows(session: AsyncSession, t: Terms) -> list[dict[str, Any]]:
    """Allocation preview from indexed transfers: one row per paying wallet, largest first."""
    sums = (await session.execute(
        select(func.lower(PresaleContribution.wallet_address), func.min(PresaleContribution.wallet_address),
               func.sum(PresaleContribution.amount_wei))
        .group_by(func.lower(PresaleContribution.wallet_address))
    )).all()
    users = {addr: (uid, name) for addr, uid, name in (await session.execute(
        select(func.lower(Wallet.address), Wallet.user_id, User.username).join(User, User.id == Wallet.user_id)
    )).all()}
    rows = []
    for lower, wallet, total in sums:
        counted, tokens = allocation(int(total), t)
        uid, name = users.get(lower, (None, None))
        rows.append({"wallet_address": wallet, "user_id": uid, "username": name, "contributed_wei": int(total),
                     "counted_wei": counted, "tokens_wei": tokens, "credited_tx": None})
    rows.sort(key=lambda r: (-r["contributed_wei"], r["wallet_address"].lower()))
    return rows


async def frozen_rows(session: AsyncSession) -> list[dict[str, Any]]:
    result = (await session.execute(
        select(PresaleAllocation, User.username).outerjoin(User, User.id == PresaleAllocation.user_id)
        .order_by(PresaleAllocation.contributed_wei.desc(), PresaleAllocation.wallet_address)
    )).all()
    return [{"wallet_address": a.wallet_address, "user_id": a.user_id, "username": name,
             "contributed_wei": int(a.contributed_wei), "counted_wei": int(a.counted_wei),
             "tokens_wei": int(a.tokens_wei), "credited_tx": a.credited_tx} for a, name in result]


async def allocations(session: AsyncSession) -> dict[str, Any]:
    t = await get_terms(session)
    rows = await frozen_rows(session) if t.closed_at else await live_rows(session, t)
    return {
        "closed": bool(t.closed_at), "closed_at": iso(t.closed_at),
        "total_usdt_wei": str(sum(r["counted_wei"] for r in rows)),
        "total_tokens_wei": str(sum(r["tokens_wei"] for r in rows)),
        "items": [{**r, "contributed_wei": str(r["contributed_wei"]), "counted_wei": str(r["counted_wei"]),
                   "tokens_wei": str(r["tokens_wei"])} for r in rows],
    }


async def close(session: AsyncSession) -> None:
    """The presale snapshot: freeze one allocation per paying wallet and mark the presale closed.
    Raises PermissionError (409) if already closed, ValueError (400) if the price is not set."""
    t = await get_terms(session)
    if t.closed_at:
        raise PermissionError("The presale is already closed.")
    if not t.tokens_per_usdt_wei:
        raise ValueError("Set the presale price before closing.")
    now = datetime.now(UTC)
    for r in await live_rows(session, t):
        session.add(PresaleAllocation(
            wallet_address=r["wallet_address"], user_id=r["user_id"], contributed_wei=r["contributed_wei"],
            counted_wei=r["counted_wei"], tokens_wei=r["tokens_wei"], created_at=now,
        ))
    await set_config(session, "presale_closed_at", iso(now))


async def reopen(session: AsyncSession) -> None:
    """Undo close. Raises PermissionError (409) once any allocation was credited."""
    credited = (await session.execute(
        select(func.count()).select_from(PresaleAllocation).where(PresaleAllocation.credited_tx.is_not(None))
    )).scalar_one()
    if credited:
        raise PermissionError("Tokens were already sent to some buyers; the presale cannot be reopened.")
    await session.execute(delete(PresaleAllocation))
    await set_config(session, "presale_closed_at", "")


async def mark_credited(session: AsyncSession, tx_hash: str, wallets: list[str]) -> int:
    lowered = {w.lower() for w in wallets}
    rows = (await session.execute(
        select(PresaleAllocation).where(func.lower(PresaleAllocation.wallet_address).in_(lowered),
                                        PresaleAllocation.credited_tx.is_(None))
    )).scalars().all()
    now = datetime.now(UTC)
    for a in rows:
        a.credited_tx, a.credited_at = tx_hash, now
    return len(rows)


async def credited_count(session: AsyncSession) -> int:
    return int((await session.execute(
        select(func.count()).select_from(PresaleAllocation).where(PresaleAllocation.credited_tx.is_not(None))
    )).scalar_one())
