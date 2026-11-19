import re
import secrets
from datetime import UTC, datetime
from typing import Literal

from eth_utils import is_address, to_checksum_address
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import chain, runtime, telegram
from app.config_store import get_config
from app.db import get_session
from app.deps import current_user, ip_rate_limit, record_device
from app.models import (
    Airdrop,
    AirdropProof,
    PointEvent,
    PresaleContribution,
    PresaleWhitelist,
    Referral,
    ScreenView,
    Snapshot,
    User,
    Wallet,
    XAccount,
    XPost,
)
from app.points import add_points, balances_subquery, rank_of, week_start
from app.redis_client import redis
from app.security import USER_TOKEN_TTL, InitDataError, make_token, validate_init_data
from app.services import (
    build_me,
    do_spin,
    ensure_can_earn,
    last_spin,
    next_refill,
    referral_link,
    register_or_update,
)
from app.settings import settings

router = APIRouter(prefix="/api")

HANDOFF_TTL = 600
NONCE_TTL = 600
X_STATUS_RE = re.compile(
    r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{1,25})(?:[/?#].*)?$"
)


# ---------- auth ----------

class TelegramAuthIn(BaseModel):
    init_data: str
    start_param: str | None = None
    timezone: str | None = None
    language: str | None = None
    platform: str | None = None


@router.post("/auth/telegram", dependencies=[Depends(ip_rate_limit("auth_telegram", 30))])
async def auth_telegram(body: TelegramAuthIn, request: Request, session: AsyncSession = Depends(get_session)):
    try:
        tg = validate_init_data(body.init_data, (await runtime.get()).telegram_bot_token)
    except InitDataError as e:
        raise HTTPException(401, "Could not verify your Telegram session. Reopen the app.") from e
    user = await register_or_update(session, tg, body.start_param, body.language)
    await record_device(session, user.id, request, body.platform, body.timezone, body.language)
    await session.commit()
    return {"token": make_token(user.id, "user", USER_TOKEN_TTL), "user": await build_me(session, user)}


class HandoffIn(BaseModel):
    handoff_token: str


@router.post("/auth/handoff", dependencies=[Depends(ip_rate_limit("auth_handoff", 30))])
async def auth_handoff(body: HandoffIn, request: Request, session: AsyncSession = Depends(get_session)):
    user_id = await redis.getdel(f"handoff:{body.handoff_token}")
    user = await session.get(User, int(user_id)) if user_id else None
    if not user:
        raise HTTPException(401, "This link has expired. Request a new one in the app.")
    await record_device(session, user.id, request)
    await session.commit()
    return {"token": make_token(user.id, "user", USER_TOKEN_TTL), "user": await build_me(session, user)}


# ---------- me / settings / events ----------

@router.get("/me")
async def me(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await build_me(session, user)


class SettingsIn(BaseModel):
    reminders_enabled: bool


@router.patch("/settings")
async def update_settings(body: SettingsIn, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session)):
    user.reminders_enabled = body.reminders_enabled
    await session.commit()
    return await build_me(session, user)


class EventIn(BaseModel):
    screen: str


@router.post("/events")
async def screen_event(body: EventIn, user: User = Depends(current_user),
                       session: AsyncSession = Depends(get_session)):
    now = datetime.now(UTC)
    stmt = insert(ScreenView).values(user_id=user.id, screen=body.screen[:32], last_seen_at=now)
    await session.execute(stmt.on_conflict_do_update(
        constraint="uq_screen_views_user_screen",
        set_={"views": ScreenView.views + 1, "last_seen_at": now},
    ))
    await session.commit()
    return {"ok": True}


# ---------- spin ----------

@router.get("/spin")
async def spin_state(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    cfg = await get_config(session)
    refill = next_refill(await last_spin(session, user.id), cfg)
    ready = refill is None or refill <= datetime.now(UTC)
    return {
        "ready": ready,
        "next_refill_at": None if ready else refill,
        "points_per_spin": cfg["points_per_spin"],
        "interval_seconds": int(cfg["spin_interval_hours"]) * 3600,
    }


@router.post("/spin")
async def spin(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await do_spin(session, user)


# ---------- tasks ----------

async def _has_event(session: AsyncSession, user_id: int, type_: str) -> bool:
    q = select(PointEvent.id).where(PointEvent.user_id == user_id, PointEvent.type == type_).limit(1)
    return (await session.execute(q)).first() is not None


@router.get("/tasks")
async def tasks(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    cfg = await get_config(session)
    refill = next_refill(await last_spin(session, user.id), cfg)
    spin_ready = refill is None or refill <= datetime.now(UTC)
    has_post = (await session.execute(
        select(XPost.id).where(XPost.user_id == user.id, XPost.status == "active").limit(1)
    )).first() is not None
    x_connected = (await session.execute(select(XAccount.id).where(XAccount.user_id == user.id))).first()
    wallet = (await session.execute(select(Wallet.id).where(Wallet.user_id == user.id))).first()

    def st(done: bool) -> str:
        return "done" if done else "todo"

    channel = str(cfg["telegram_channel"] or "").lstrip("@")
    channel_url = f"https://t.me/{channel}" if channel else None

    return {"tasks": [
        {"key": "spin", "title": "Spin the wheel", "section": "daily",
         "reward": cfg["points_per_spin"], "state": st(not spin_ready)},
        {"key": "x_post", "title": "Post about Baby Grand on X", "section": "daily",
         "reward": cfg["x_post_daily_points"], "state": st(has_post)},
        {"key": "x_bio", "title": "Add Baby Grand to your X bio", "section": "daily",
         "reward": cfg["x_bio_daily_points"], "state": st(user.x_bio_marked)},
        {"key": "x_connect", "title": "Connect your X account", "section": "one_time",
         "reward": cfg["x_connect_points"], "state": st(x_connected is not None)},
        {"key": "wallet", "title": "Link your wallet", "section": "one_time",
         "reward": 0, "state": st(wallet is not None)},
        {"key": "join_channel", "title": "Join the Telegram channel", "section": "one_time",
         "reward": cfg["join_channel_points"], "state": st(await _has_event(session, user.id, "join_channel")),
         "url": channel_url},
    ]}


@router.post("/tasks/join_channel")
async def join_channel(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    cfg = await ensure_can_earn(session, user)
    if await _has_event(session, user.id, "join_channel"):
        return {"state": "done"}
    channel = cfg["telegram_channel"]
    if not channel:
        raise HTTPException(400, "The channel is not set up yet.")
    if not await telegram.is_channel_member(channel, user.telegram_id):
        return {"state": "todo"}
    await add_points(session, user.id, "join_channel", int(cfg["join_channel_points"]), "join_channel")
    await session.commit()
    return {"state": "done"}


# ---------- referrals ----------

@router.get("/referrals")
async def referrals(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    cfg = await get_config(session)
    rows = (await session.execute(
        select(Referral, User).join(User, User.id == Referral.referred_id)
        .where(Referral.referrer_id == user.id).order_by(Referral.created_at.desc())
    )).all()
    items = []
    earned = pending = 0
    for ref, friend in rows:
        credited = ref.status == "credited"
        earned += ref.points if credited else 0
        pending += 1 if ref.status == "pending" else 0
        items.append({
            "name": friend.username or friend.first_name or "Friend",
            "photo_url": friend.photo_url,
            "joined_at": ref.created_at,
            "points_earned": ref.points if credited else 0,
            "status": "credited" if credited else "pending",
        })
    return {
        "code": user.referral_code,
        "link": await referral_link(user.referral_code),
        "points_per_friend": cfg["referral_points"],
        "stats": {"friends": len(rows), "points_earned": earned, "pending": pending},
        "items": items,
    }


# ---------- leaderboard ----------

@router.get("/leaderboard")
async def leaderboard(period: Literal["all", "week"] = "all", user: User = Depends(current_user),
                      session: AsyncSession = Depends(get_session)):
    since = week_start() if period == "week" else None
    b = balances_subquery(since)
    rows = (await session.execute(
        select(User, b.c.points).join(b, b.c.user_id == User.id)
        .where(User.banned.is_(False), b.c.points > 0)
        .order_by(b.c.points.desc(), User.id).limit(100)
    )).all()
    items = [
        {"rank": i + 1, "name": u.username or u.first_name or "Player", "photo_url": u.photo_url,
         "points": int(p)}
        for i, (u, p) in enumerate(rows)
    ]
    rank, points = await rank_of(session, user.id, since)
    return {"items": items, "me": {"rank": rank, "points": points}}


# ---------- X ----------

def _post_out(p: XPost) -> dict:
    return {"id": p.id, "url": p.url, "status": p.status, "created_at": p.created_at}


@router.get("/x")
async def x_state(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    acct = (await session.execute(select(XAccount).where(XAccount.user_id == user.id))).scalar_one_or_none()
    posts = (await session.execute(
        select(XPost).where(XPost.user_id == user.id).order_by(XPost.created_at.desc())
    )).scalars().all()
    return {
        "connected": acct is not None,
        "username": acct.username if acct else None,
        "posts": [_post_out(p) for p in posts],
        "bio_marked": user.x_bio_marked,
    }


class XPostIn(BaseModel):
    url: str


@router.post("/x/post")
async def x_post(body: XPostIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    cfg = await ensure_can_earn(session, user)
    m = X_STATUS_RE.match(body.url.strip())
    if not m:
        raise HTTPException(400, "Paste a link to your post on x.com.")
    handle, status_id = m.group(1), m.group(2)
    lock_key = f"lock:x_post:{user.id}"
    if not await redis.set(lock_key, "1", nx=True, ex=15):
        raise HTTPException(409, "Already submitting. Try again in a moment.")
    try:
        existing = (await session.execute(
            select(XPost).where(XPost.status_id == status_id)
        )).scalar_one_or_none()
        if existing:
            if existing.user_id != user.id:
                raise HTTPException(409, "This post was already submitted.")
            return _post_out(existing)
        post = XPost(user_id=user.id, url=f"https://x.com/{handle}/status/{status_id}", status_id=status_id,
                     status="active")
        session.add(post)
        await session.flush()
        await add_points(session, user.id, "x_post", int(cfg["x_post_points"]), f"x_post:{status_id}")
        await session.commit()
        return _post_out(post)
    finally:
        await redis.delete(lock_key)


class XBioIn(BaseModel):
    marked: bool = True


@router.post("/x/bio")
async def x_bio(body: XBioIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    await ensure_can_earn(session, user)
    if user.x_bio_revoked:
        raise HTTPException(403, "Bio points were revoked for this account.")
    if body.marked and not user.x_bio_marked:
        user.x_bio_marked = True
        user.x_bio_marked_at = datetime.now(UTC)
    elif not body.marked:
        user.x_bio_marked = False
    await session.commit()
    return {"bio_marked": user.x_bio_marked}


# ---------- wallet ----------

@router.get("/wallet/nonce")
async def wallet_nonce(user: User = Depends(current_user)):
    nonce = secrets.token_hex(8)
    await redis.set(f"wallet_nonce:{user.id}", nonce, ex=NONCE_TTL)
    return {"nonce": nonce, "message": chain.wallet_message(user.telegram_id, nonce)}


class WalletLinkIn(BaseModel):
    address: str
    signature: str
    nonce: str


@router.post("/wallet/link")
async def wallet_link(body: WalletLinkIn, user: User = Depends(current_user),
                      session: AsyncSession = Depends(get_session)):
    if not is_address(body.address):
        raise HTTPException(400, "That is not a valid wallet address.")
    stored = await redis.get(f"wallet_nonce:{user.id}")
    if not stored or stored != body.nonce:
        raise HTTPException(400, "This signing request expired. Try again.")
    message = chain.wallet_message(user.telegram_id, body.nonce)
    try:
        signer = chain.recover_personal_sign(message, body.signature)
    except Exception as e:  # noqa: BLE001 - malformed signature
        raise HTTPException(400, "Signature could not be verified. Try again.") from e
    address = to_checksum_address(body.address)
    if signer != address:
        raise HTTPException(400, "Signature does not match this wallet.")
    await redis.delete(f"wallet_nonce:{user.id}")

    other = (await session.execute(
        select(Wallet).where(func.lower(Wallet.address) == address.lower())
    )).scalar_one_or_none()
    if other and other.user_id != user.id:
        raise HTTPException(409, "This wallet is linked to another account.")
    mine = (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalar_one_or_none()
    if mine:
        if mine.address != address:
            if (await session.execute(select(Snapshot.id).limit(1))).first():
                raise HTTPException(409, "Wallet changes are closed after the snapshot.")
            mine.address = address
            mine.linked_at = datetime.now(UTC)
    else:
        session.add(Wallet(user_id=user.id, address=address))
    await session.commit()
    return {"address": address}


@router.post("/handoff")
async def create_handoff(user: User = Depends(current_user)):
    return {"url": await _handoff_url(user)}


async def _handoff_url(user: User) -> str:
    token = secrets.token_urlsafe(24)
    await redis.set(f"handoff:{token}", str(user.id), ex=HANDOFF_TTL)
    return f"{settings.MINIAPP_URL.rstrip('/')}/?handoff={token}"


@router.post("/handoff/send")
async def send_handoff(user: User = Depends(current_user)):
    url = await _handoff_url(user)
    await telegram.send_message(user.telegram_id, "Open Baby Grand in your browser. This link works once "
                                "and expires in 10 minutes.", button_text="Open in browser", url=url)
    return {"ok": True}


# ---------- presale ----------

async def _user_wallet(session: AsyncSession, user_id: int) -> str | None:
    return (await session.execute(select(Wallet.address).where(Wallet.user_id == user_id))).scalar()


async def _is_whitelisted(session: AsyncSession, wallet: str | None) -> bool:
    if not wallet:
        return False
    q = select(PresaleWhitelist.wallet_address).where(
        func.lower(PresaleWhitelist.wallet_address) == wallet.lower()
    )
    return (await session.execute(q)).first() is not None


def _iso(ts: int) -> str | None:
    return datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z") if ts else None


@router.get("/presale")
async def presale(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    rt = await runtime.get()
    wallet = await _user_wallet(session, user.id)
    out = {
        "status": "upcoming", "start_at": None, "end_at": None, "raised_wei": "0", "hard_cap_wei": "0",
        "tokens_per_usdt_wei": "0", "min_wei": "0", "max_wei": "0", "chain_id": rt.chain_id_int,
        "presale_address": rt.presale_address or None, "usdt_address": rt.usdt_address or None,
        "whitelisted": await _is_whitelisted(session, wallet), "contributed_wei": "0", "purchased_wei": "0",
        "vested_wei": "0", "claimed_wei": "0", "claimable_wei": "0", "unlock_bps": 0, "vesting_seconds": 0,
        "claim_start": None,
    }
    s = await chain.read_presale(rt, wallet)
    if s is None:
        if wallet:  # fall back to indexed contributions
            total = (await session.execute(
                select(func.coalesce(func.sum(PresaleContribution.amount_wei), 0))
                .where(func.lower(PresaleContribution.wallet_address) == wallet.lower())
            )).scalar_one()
            out["contributed_wei"] = str(int(total))
        return out
    now = int(datetime.now(UTC).timestamp())
    if s["claimEnabled"]:
        status = "claimable"
    elif not s["startTime"] or now < s["startTime"]:
        status = "upcoming"
    elif now >= s["endTime"] or (s["hardCapWei"] and s["totalRaised"] >= s["hardCapWei"]):
        status = "ended"
    elif s["paused"]:
        status = "paused"
    else:
        status = "live"
    out.update({
        "status": status, "start_at": _iso(s["startTime"]), "end_at": _iso(s["endTime"]),
        "raised_wei": str(s["totalRaised"]), "hard_cap_wei": str(s["hardCapWei"]),
        "tokens_per_usdt_wei": str(s["tokensPerUsdt"]), "min_wei": str(s["minWei"]), "max_wei": str(s["maxWei"]),
        "unlock_bps": int(s["unlockBps"]), "vesting_seconds": int(s["vestingDuration"]),
        "claim_start": _iso(s["claimStart"]),
    })
    for field in ("contributed", "purchased", "vested", "claimed", "claimable"):
        out[f"{field}_wei"] = str(s.get(field, 0))
    return out


@router.get("/presale/signature")
async def presale_signature(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    wallet = await _user_wallet(session, user.id)
    if not await _is_whitelisted(session, wallet):
        raise HTTPException(403, "Your linked wallet is not on the whitelist.")
    rt = await runtime.get()
    if not rt.presale_address:
        raise HTTPException(409, "The presale is not open yet.")
    key = await runtime.signer_key()
    s = await chain.read_presale(rt, None)
    max_allocation = int(s["maxWei"]) if s else 2500 * 10**18
    return {
        "wallet": wallet,
        "max_allocation_wei": str(max_allocation),
        "signature": chain.sign_whitelist(rt.chain_id_int, rt.presale_address, key, wallet, max_allocation),
    }


# ---------- airdrop ----------

async def active_airdrop(session: AsyncSession, onchain: dict | None) -> Airdrop | None:
    """The built airdrop whose merkle_root equals the on-chain merkleRoot() of the airdrop contract."""
    if not onchain:
        return None
    return (await session.execute(
        select(Airdrop).where(func.lower(Airdrop.merkle_root) == onchain["merkle_root"].lower())
        .order_by(Airdrop.id.desc()).limit(1)
    )).scalar_one_or_none()


@router.get("/airdrop")
async def airdrop(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    rt = await runtime.get()
    wallet = await _user_wallet(session, user.id)
    onchain = await chain.read_airdrop(rt, wallet)
    out = {"available": False, "airdrop_address": rt.airdrop_address or None, "amount_wei": "0", "proof": [],
           "claimed": bool(onchain and onchain["claimed"]),
           "deadline": _iso(onchain["deadline"]) if onchain else None}
    drop = await active_airdrop(session, onchain)
    proof = None
    if drop is not None:
        proof = (await session.execute(
            select(AirdropProof).where(AirdropProof.airdrop_id == drop.id, AirdropProof.user_id == user.id)
        )).scalar_one_or_none()
    if proof is not None:  # wallets cannot change after a snapshot, so proof wallet == linked wallet
        out.update({"available": True, "amount_wei": str(int(proof.amount_wei)), "proof": proof.proof})
    return out
