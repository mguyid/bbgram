import secrets
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

from eth_utils import is_address, to_checksum_address
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import backup, chain, jobs, runtime, telegram
from app.config_store import get_config, set_config, validate_value
from app.db import get_session
from app.deps import current_admin, ip_rate_limit, owner_admin, writer_admin
from app.models import (
    Admin,
    AdminAuditLog,
    Airdrop,
    AirdropProof,
    Ban,
    PointEvent,
    PresaleContribution,
    PresaleWhitelist,
    Referral,
    RiskScore,
    Snapshot,
    SnapshotBalance,
    User,
    UserDevice,
    Wallet,
    XAccount,
    XPost,
)
from app.points import add_points, balances_subquery, day_start
from app.redis_client import redis
from app.risk import find_clusters
from app.security import (
    ADMIN_TOKEN_TTL,
    hash_password,
    make_token,
    new_totp_secret,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.settings import settings
from app.snapshots import build_airdrop, compute_allocations, create_snapshot, wei_to_str

router = APIRouter(prefix="/admin-api")


def admin_out(a: Admin) -> dict:
    return {"id": a.id, "email": a.email, "role": a.role}


async def audit(session: AsyncSession, admin: Admin, action: str, target: Any = None,
                details: dict | None = None) -> None:
    session.add(AdminAuditLog(admin_id=admin.id, admin_email=admin.email, action=action,
                              target=None if target is None else str(target), details=details or {}))


def page_args(page: int, page_size: int) -> tuple[int, int]:
    page_size = max(1, min(page_size, 200))
    return (max(page, 1) - 1) * page_size, page_size


# ---------- auth ----------

class LoginIn(BaseModel):
    email: str
    password: str
    totp: str


@router.post("/auth/login", dependencies=[Depends(ip_rate_limit("admin_login", 10))])
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)):
    admin = (await session.execute(
        select(Admin).where(func.lower(Admin.email) == body.email.strip().lower())
    )).scalar_one_or_none()
    if not admin or not verify_password(admin.password_hash, body.password) or not verify_totp(
        admin.totp_secret, body.totp
    ):
        raise HTTPException(401, "Wrong email, password or code.")
    return {"token": make_token(admin.id, "admin", ADMIN_TOKEN_TTL), "admin": admin_out(admin)}


@router.get("/me")
async def me(admin: Admin = Depends(current_admin)):
    return admin_out(admin)


# ---------- stats ----------

@router.get("/stats")
async def stats(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    cfg = await get_config(session)

    async def scalar(q):
        return (await session.execute(q)).scalar_one()

    return {
        "users": await scalar(select(func.count(User.id))),
        "users_today": await scalar(select(func.count(User.id)).where(User.created_at >= day_start())),
        "points_total": int(await scalar(select(func.coalesce(func.sum(PointEvent.amount), 0)))),
        "wallets_linked": await scalar(select(func.count(Wallet.id))),
        "activity_paused": bool(cfg["activity_paused"]),
        "presale": {
            "raised_wei": str(int(await scalar(
                select(func.coalesce(func.sum(PresaleContribution.amount_wei), 0))))),
            "contributors": await scalar(
                select(func.count(func.distinct(func.lower(PresaleContribution.wallet_address))))),
        },
    }


# ---------- users ----------

@router.get("/users")
async def list_users(
    q: str = "", min_risk: int | None = None, banned: bool | None = None,
    page: int = 1, page_size: int = 50,
    admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session),
):
    b = balances_subquery()
    stmt = (
        select(User, func.coalesce(b.c.points, 0), func.coalesce(RiskScore.score, 0), Wallet.address,
               XAccount.username)
        .outerjoin(b, b.c.user_id == User.id)
        .outerjoin(RiskScore, RiskScore.user_id == User.id)
        .outerjoin(Wallet, Wallet.user_id == User.id)
        .outerjoin(XAccount, XAccount.user_id == User.id)
    )
    if q:
        conds = [User.username.ilike(f"%{q}%"), Wallet.address.ilike(f"%{q}%"), XAccount.username.ilike(f"%{q}%")]
        if q.isdigit():
            conds += [User.telegram_id == int(q), User.id == int(q)]
        stmt = stmt.where(or_(*conds))
    if min_risk is not None:
        stmt = stmt.where(func.coalesce(RiskScore.score, 0) >= min_risk)
    if banned is not None:
        stmt = stmt.where(User.banned.is_(banned))
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    offset, limit = page_args(page, page_size)
    rows = (await session.execute(stmt.order_by(User.id.desc()).offset(offset).limit(limit))).all()
    return {"items": [
        {"id": u.id, "telegram_id": u.telegram_id, "username": u.username, "balance": int(bal),
         "risk_score": int(risk), "wallet_address": wallet, "x_username": xu, "banned": u.banned,
         "created_at": u.created_at}
        for u, bal, risk, wallet, xu in rows
    ], "total": total}


async def get_user_or_404(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    return user


@router.get("/users/{user_id}")
async def get_user(user_id: int, admin: Admin = Depends(current_admin),
                   session: AsyncSession = Depends(get_session)):
    u = await get_user_or_404(session, user_id)
    bal = (await session.execute(
        select(func.coalesce(func.sum(PointEvent.amount), 0)).where(PointEvent.user_id == u.id))).scalar_one()
    risk = await session.get(RiskScore, u.id)
    wallet = (await session.execute(select(Wallet.address).where(Wallet.user_id == u.id))).scalar()
    xu = (await session.execute(select(XAccount.username).where(XAccount.user_id == u.id))).scalar()
    events = (await session.execute(
        select(PointEvent).where(PointEvent.user_id == u.id).order_by(PointEvent.id.desc()).limit(500)
    )).scalars().all()
    devices = (await session.execute(
        select(UserDevice).where(UserDevice.user_id == u.id).order_by(UserDevice.last_seen_at.desc())
    )).scalars().all()
    refs = (await session.execute(
        select(Referral, User).join(User, User.id == Referral.referred_id).where(Referral.referrer_id == u.id)
        .order_by(Referral.id.desc())
    )).all()
    referrer = await session.get(User, u.referred_by_id) if u.referred_by_id else None
    return {
        "id": u.id, "telegram_id": u.telegram_id, "username": u.username, "first_name": u.first_name,
        "photo_url": u.photo_url, "balance": int(bal), "risk_score": risk.score if risk else 0,
        "wallet_address": wallet, "x_username": xu, "banned": u.banned, "created_at": u.created_at,
        "referral_code": u.referral_code, "reminders_enabled": u.reminders_enabled,
        "x_bio_marked": u.x_bio_marked,
        "point_events": [
            {"id": e.id, "type": e.type, "amount": e.amount, "ref_id": e.ref_id, "note": e.note,
             "created_at": e.created_at} for e in events
        ],
        "risk_reasons": risk.reasons if risk else [],
        "devices": [
            {"ip": d.ip, "device_hash": d.device_hash, "user_agent": d.user_agent, "platform": d.platform,
             "timezone": d.timezone, "language": d.language, "requests": d.requests,
             "first_seen_at": d.first_seen_at, "last_seen_at": d.last_seen_at} for d in devices
        ],
        "referrals": [
            {"user_id": ru.id, "username": ru.username, "status": r.status, "points": r.points,
             "created_at": r.created_at} for r, ru in refs
        ],
        "referrer": {"id": referrer.id, "username": referrer.username} if referrer else None,
    }


class AdjustIn(BaseModel):
    amount: int
    reason: str


@router.post("/users/{user_id}/adjust")
async def adjust(user_id: int, body: AdjustIn, admin: Admin = Depends(writer_admin),
                 session: AsyncSession = Depends(get_session)):
    u = await get_user_or_404(session, user_id)
    if body.amount == 0:
        raise HTTPException(400, "Amount must not be zero.")
    await add_points(session, u.id, "admin_adjust", body.amount, f"adjust:{datetime.now(UTC).isoformat()}",
                     note=body.reason)
    await audit(session, admin, "user.adjust", u.id, {"amount": body.amount, "reason": body.reason})
    await session.commit()
    return {"ok": True}


class BanIn(BaseModel):
    reason: str = ""


async def ban_user(session: AsyncSession, admin: Admin, user: User, reason: str) -> None:
    if user.banned:
        return
    user.banned = True
    session.add(Ban(user_id=user.id, reason=reason, admin_id=admin.id))
    await audit(session, admin, "user.ban", user.id, {"reason": reason})


@router.post("/users/{user_id}/ban")
async def ban(user_id: int, body: BanIn, admin: Admin = Depends(writer_admin),
              session: AsyncSession = Depends(get_session)):
    u = await get_user_or_404(session, user_id)
    await ban_user(session, admin, u, body.reason)
    await session.commit()
    return {"ok": True}


@router.post("/users/{user_id}/unban")
async def unban(user_id: int, admin: Admin = Depends(writer_admin), session: AsyncSession = Depends(get_session)):
    u = await get_user_or_404(session, user_id)
    if u.banned:
        u.banned = False
        bans = (await session.execute(
            select(Ban).where(Ban.user_id == u.id, Ban.lifted_at.is_(None)))).scalars().all()
        for b in bans:
            b.lifted_at = datetime.now(UTC)
        await audit(session, admin, "user.unban", u.id)
        await session.commit()
    return {"ok": True}


# ---------- clusters ----------

@router.get("/clusters")
async def clusters(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    return {"items": await find_clusters(session)}


class ClusterBanIn(BaseModel):
    user_ids: list[int]
    reason: str = ""


@router.post("/clusters/ban")
async def cluster_ban(body: ClusterBanIn, admin: Admin = Depends(writer_admin),
                      session: AsyncSession = Depends(get_session)):
    users = (await session.execute(select(User).where(User.id.in_(body.user_ids)))).scalars().all()
    for u in users:
        await ban_user(session, admin, u, body.reason)
    await session.commit()
    return {"ok": True, "banned": len(users)}


# ---------- config / activity ----------

@router.get("/config")
async def read_config(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    return await get_config(session)


@router.put("/config")
async def write_config(body: dict[str, Any] = Body(...), admin: Admin = Depends(writer_admin),
                       session: AsyncSession = Depends(get_session)):
    current = await get_config(session)
    try:
        values = {k: validate_value(k, v) for k, v in body.items()}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    for k, v in values.items():
        if current[k] != v:
            await set_config(session, k, v)
            await audit(session, admin, "config.update", k, {"old": current[k], "new": v})
    await session.commit()
    return await get_config(session)


async def set_paused(session: AsyncSession, admin: Admin, paused: bool) -> dict:
    await set_config(session, "activity_paused", paused)
    await audit(session, admin, "activity.pause" if paused else "activity.resume")
    await session.commit()
    return {"activity_paused": paused}


@router.post("/pause")
async def pause(admin: Admin = Depends(writer_admin), session: AsyncSession = Depends(get_session)):
    return await set_paused(session, admin, True)


@router.post("/resume")
async def resume(admin: Admin = Depends(writer_admin), session: AsyncSession = Depends(get_session)):
    return await set_paused(session, admin, False)


# ---------- X review ----------

@router.get("/x/posts")
async def x_posts(status: Literal["active", "revoked"] | None = None, admin: Admin = Depends(current_admin),
                  session: AsyncSession = Depends(get_session)):
    stmt = (select(XPost, User, XAccount.username).join(User, User.id == XPost.user_id)
            .outerjoin(XAccount, XAccount.user_id == XPost.user_id).order_by(XPost.id.desc()))
    if status:
        stmt = stmt.where(XPost.status == status)
    rows = (await session.execute(stmt)).all()
    return {"items": [
        {"id": p.id, "user_id": u.id, "username": u.username, "x_username": xu, "url": p.url,
         "status": p.status, "created_at": p.created_at, "revoked_at": p.revoked_at} for p, u, xu in rows
    ]}


@router.post("/x/posts/{post_id}/revoke")
async def revoke_post(post_id: int, admin: Admin = Depends(writer_admin),
                      session: AsyncSession = Depends(get_session)):
    post = await session.get(XPost, post_id)
    if not post:
        raise HTTPException(404, "Post not found.")
    if post.status != "revoked":
        post.status = "revoked"
        post.revoked_at = datetime.now(UTC)
        await audit(session, admin, "x.post.revoke", post.id, {"user_id": post.user_id, "url": post.url})
        await session.commit()
    return {"ok": True}


@router.get("/x/bios")
async def x_bios(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(User, XAccount.username).outerjoin(XAccount, XAccount.user_id == User.id)
        .where(User.x_bio_marked.is_(True)).order_by(User.x_bio_marked_at.desc())
    )).all()
    return {"items": [
        {"user_id": u.id, "username": u.username, "x_username": xu, "marked_at": u.x_bio_marked_at}
        for u, xu in rows
    ]}


@router.post("/x/bios/{user_id}/revoke")
async def revoke_bio(user_id: int, admin: Admin = Depends(writer_admin),
                     session: AsyncSession = Depends(get_session)):
    u = await get_user_or_404(session, user_id)
    u.x_bio_marked = False
    u.x_bio_revoked = True
    await audit(session, admin, "x.bio.revoke", u.id)
    await session.commit()
    return {"ok": True}


# ---------- snapshots / airdrops ----------

async def snapshot_out(session: AsyncSession, snap: Snapshot) -> dict:
    rows = (await session.execute(
        select(SnapshotBalance, User.username).join(User, User.id == SnapshotBalance.user_id)
        .where(SnapshotBalance.snapshot_id == snap.id).order_by(SnapshotBalance.points.desc())
    )).all()
    return {
        "id": snap.id,
        "created_at": snap.created_at,
        "total_points": sum(b.points for b, _ in rows if not b.excluded),
        "items": [
            {"user_id": b.user_id, "username": name, "wallet_address": b.wallet_address, "points": b.points,
             "risk_score": b.risk_score, "excluded": b.excluded, "exclusion_reason": b.exclusion_reason}
            for b, name in rows
        ],
    }


async def get_snapshot_or_404(session: AsyncSession, snapshot_id: int) -> Snapshot:
    snap = await session.get(Snapshot, snapshot_id)
    if not snap:
        raise HTTPException(404, "Snapshot not found.")
    return snap


@router.post("/snapshots")
async def new_snapshot(admin: Admin = Depends(writer_admin), session: AsyncSession = Depends(get_session)):
    snap = await create_snapshot(session, admin.id)
    await audit(session, admin, "snapshot.create", snap.id)
    await session.commit()
    return await snapshot_out(session, snap)


@router.get("/snapshots")
async def list_snapshots(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Snapshot, func.count(SnapshotBalance.id),
               func.coalesce(func.sum(SnapshotBalance.points).filter(SnapshotBalance.excluded.is_(False)), 0),
               func.count(SnapshotBalance.id).filter(SnapshotBalance.excluded.is_(True)))
        .outerjoin(SnapshotBalance, SnapshotBalance.snapshot_id == Snapshot.id)
        .group_by(Snapshot.id).order_by(Snapshot.id.desc())
    )).all()
    return {"items": [
        {"id": s.id, "created_at": s.created_at, "users": n, "total_points": int(pts), "excluded": int(exc)}
        for s, n, pts, exc in rows
    ]}


@router.get("/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: int, admin: Admin = Depends(current_admin),
                       session: AsyncSession = Depends(get_session)):
    return await snapshot_out(session, await get_snapshot_or_404(session, snapshot_id))


class ExclusionIn(BaseModel):
    user_id: int
    excluded: bool


@router.post("/snapshots/{snapshot_id}/exclusions")
async def set_exclusion(snapshot_id: int, body: ExclusionIn, admin: Admin = Depends(writer_admin),
                        session: AsyncSession = Depends(get_session)):
    snap = await get_snapshot_or_404(session, snapshot_id)
    row = (await session.execute(select(SnapshotBalance).where(
        SnapshotBalance.snapshot_id == snap.id, SnapshotBalance.user_id == body.user_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "User is not in this snapshot.")
    if body.excluded:
        row.excluded, row.exclusion_reason = True, "manual"
    else:
        if not row.wallet_address:
            raise HTTPException(400, "This user has no linked wallet.")
        row.excluded, row.exclusion_reason = False, None
    await audit(session, admin, "snapshot.exclude" if body.excluded else "snapshot.restore",
                snap.id, {"user_id": body.user_id})
    await session.commit()
    return await snapshot_out(session, snap)


class PoolIn(BaseModel):
    pool_tokens: Decimal
    min_points: int | None = None
    per_user_cap_tokens: Decimal | None = None


@router.post("/snapshots/{snapshot_id}/preview")
async def preview(snapshot_id: int, body: PoolIn, admin: Admin = Depends(current_admin),
                  session: AsyncSession = Depends(get_session)):
    snap = await get_snapshot_or_404(session, snapshot_id)
    allocs = await compute_allocations(session, snap.id, body.pool_tokens, body.min_points,
                                       body.per_user_cap_tokens)
    return {
        "total_points": sum(a.points for a in allocs),
        "recipients": sum(1 for a in allocs if a.amount_wei > 0),
        "total_tokens": wei_to_str(sum(a.amount_wei for a in allocs)),
        "items": [{"user_id": a.user_id, "wallet_address": a.wallet_address, "points": a.points,
                   "amount": wei_to_str(a.amount_wei)} for a in allocs],
    }


@router.post("/snapshots/{snapshot_id}/airdrop")
async def make_airdrop(snapshot_id: int, body: PoolIn, admin: Admin = Depends(writer_admin),
                       session: AsyncSession = Depends(get_session)):
    snap = await get_snapshot_or_404(session, snapshot_id)
    drop = await build_airdrop(session, snap.id, body.pool_tokens, body.min_points, body.per_user_cap_tokens)
    await audit(session, admin, "airdrop.build", drop.id, {"snapshot_id": snap.id, **drop.params,
                                                          "merkle_root": drop.merkle_root})
    await session.commit()
    return {"airdrop_id": drop.id, "merkle_root": drop.merkle_root,
            "total_amount_wei": str(int(drop.total_amount_wei)), "recipients": drop.recipients}


@router.get("/airdrops")
async def list_airdrops(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    onchain = await chain.read_airdrop(await runtime.get())
    root = onchain["merkle_root"].lower() if onchain else None
    rows = (await session.execute(select(Airdrop).order_by(Airdrop.id.desc()))).scalars().all()
    return {"items": [
        {"id": d.id, "snapshot_id": d.snapshot_id, "merkle_root": d.merkle_root,
         "total_amount_wei": str(int(d.total_amount_wei)), "recipients": d.recipients, "params": d.params,
         "created_at": d.created_at, "active": d.merkle_root.lower() == root}
        for d in rows
    ]}


@router.get("/airdrops/{airdrop_id}/proofs")
async def airdrop_proofs(airdrop_id: int, admin: Admin = Depends(current_admin),
                         session: AsyncSession = Depends(get_session)):
    drop = await session.get(Airdrop, airdrop_id)
    if not drop:
        raise HTTPException(404, "Airdrop not found.")
    rows = (await session.execute(
        select(AirdropProof).where(AirdropProof.airdrop_id == drop.id).order_by(AirdropProof.id)
    )).scalars().all()
    return {"merkle_root": drop.merkle_root, "items": [
        {"wallet_address": p.wallet_address, "amount_wei": str(int(p.amount_wei)), "proof": p.proof}
        for p in rows
    ]}


# ---------- presale ----------

@router.get("/presale/whitelist")
async def whitelist(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(PresaleWhitelist, User.username).outerjoin(User, User.id == PresaleWhitelist.user_id)
        .order_by(PresaleWhitelist.created_at.desc())
    )).all()
    return {"items": [
        {"wallet_address": w.wallet_address, "user_id": w.user_id, "username": name, "created_at": w.created_at}
        for w, name in rows
    ]}


class WhitelistIn(BaseModel):
    wallet_address: str
    user_id: int | None = None


@router.post("/presale/whitelist")
async def add_whitelist(body: WhitelistIn, admin: Admin = Depends(writer_admin),
                        session: AsyncSession = Depends(get_session)):
    if not is_address(body.wallet_address):
        raise HTTPException(400, "Invalid wallet address.")
    address = to_checksum_address(body.wallet_address)
    user_id = body.user_id or (await session.execute(
        select(Wallet.user_id).where(func.lower(Wallet.address) == address.lower()))).scalar()
    if await session.get(PresaleWhitelist, address):
        raise HTTPException(409, "This wallet is already whitelisted.")
    session.add(PresaleWhitelist(wallet_address=address, user_id=user_id, added_by=admin.id))
    await audit(session, admin, "presale.whitelist.add", address, {"user_id": user_id})
    await session.commit()
    return {"wallet_address": address, "user_id": user_id}


@router.delete("/presale/whitelist/{wallet_address}")
async def remove_whitelist(wallet_address: str, admin: Admin = Depends(writer_admin),
                           session: AsyncSession = Depends(get_session)):
    result = await session.execute(delete(PresaleWhitelist).where(
        func.lower(PresaleWhitelist.wallet_address) == wallet_address.lower()))
    if not result.rowcount:
        raise HTTPException(404, "Wallet is not whitelisted.")
    await audit(session, admin, "presale.whitelist.remove", wallet_address)
    await session.commit()
    return {"ok": True}


@router.get("/presale/contributions")
async def contributions(admin: Admin = Depends(current_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(PresaleContribution).order_by(PresaleContribution.block_number.desc(),
                                             PresaleContribution.log_index.desc())
    )).scalars().all()
    return {"raised_wei": str(sum(int(c.amount_wei) for c in rows)), "items": [
        {"wallet_address": c.wallet_address, "user_id": c.user_id, "amount_wei": str(int(c.amount_wei)),
         "tx_hash": c.tx_hash, "block_number": c.block_number, "created_at": c.created_at} for c in rows
    ]}


# ---------- runtime settings (interfaces.md 2a) ----------

ADDRESS_SETTINGS = ("token_address", "presale_address", "airdrop_address")
INT_SETTINGS = ("chain_id", "presale_start_block")
EDITABLE_SETTINGS = ("telegram_bot_token", "x_client_id", "x_client_secret", "rpc_url",
                     *ADDRESS_SETTINGS, *INT_SETTINGS)


@router.get("/settings")
async def read_settings(admin: Admin = Depends(current_admin)):
    rt = await runtime.get()
    return {
        "telegram_bot_token_set": bool(rt.telegram_bot_token),
        "telegram_bot_username": rt.telegram_bot_username,
        "telegram_webhook_ok": rt.telegram_webhook_ok == "true",
        "x_client_id": rt.x_client_id,
        "x_client_secret_set": bool(rt.x_client_secret),
        "x_redirect_uri": runtime.x_redirect_uri(),
        "chain_id": rt.chain_id_int,
        "rpc_url": rt.rpc_url,
        "usdt_address": rt.usdt_address,
        "token_address": rt.token_address,
        "presale_address": rt.presale_address,
        "presale_start_block": rt.start_block_int if rt.presale_start_block else None,
        "airdrop_address": rt.airdrop_address,
        "signer_address": runtime.signer_address(await runtime.signer_key()),
    }


def _clean_setting(key: str, value: Any) -> str:
    if key not in EDITABLE_SETTINGS:
        raise HTTPException(400, f"Unknown setting: {key}")
    if value is None or value == "":
        return ""
    if key in INT_SETTINGS:
        if isinstance(value, bool) or not str(value).isdigit():
            raise HTTPException(400, f"{key} must be a non-negative integer")
        return str(int(value))
    if not isinstance(value, str):
        raise HTTPException(400, f"{key} must be a string")
    value = value.strip()
    if key in ADDRESS_SETTINGS:
        if not is_address(value):
            raise HTTPException(400, f"{key} is not a valid address")
        return to_checksum_address(value)
    return value


@router.put("/settings")
async def write_settings(body: dict[str, Any] = Body(...), admin: Admin = Depends(owner_admin),
                         session: AsyncSession = Depends(get_session)):
    rt = await runtime.get()
    values = {k: _clean_setting(k, v) for k, v in body.items()}

    if "telegram_bot_token" in values:
        token = values["telegram_bot_token"]
        values.update({"telegram_bot_username": "", "telegram_webhook_ok": ""})
        if token:
            me = await telegram.call("getMe", {}, token=token)
            if not me:
                raise HTTPException(400, "Telegram rejected this bot token.")
            secret = rt.telegram_webhook_secret or secrets.token_urlsafe(32)
            ok = await telegram.call("setWebhook", {
                "url": settings.API_PUBLIC_URL.rstrip("/") + "/bot/webhook", "secret_token": secret,
            }, token=token)
            values.update({"telegram_bot_username": me.get("username", ""), "telegram_webhook_secret": secret,
                           "telegram_webhook_ok": "true" if ok else ""})

    if "presale_address" in values:
        if values["presale_address"]:
            try:
                usdt, block = await chain.read_presale_setup(values.get("rpc_url", rt.rpc_url),
                                                             values["presale_address"])
            except Exception as e:  # noqa: BLE001 - bad RPC URL, wrong address, network error
                raise HTTPException(400, "Could not read the presale contract. Check the RPC URL and address.") from e
            values["usdt_address"] = usdt
            if not values.get("presale_start_block", rt.presale_start_block):
                values["presale_start_block"] = str(block)
        else:
            values["usdt_address"] = ""
    if "presale_address" in values or "presale_start_block" in values:
        await redis.delete(jobs.INDEXER_KEY)  # re-index from the (new) start block

    await runtime.save(session, values)
    await audit(session, admin, "settings.update", None,
                {k: "<secret>" if k in runtime.SECRET_KEYS else v for k, v in values.items()})
    await session.commit()
    runtime.invalidate()
    return await read_settings(admin)


@router.post("/settings/rotate-signer")
async def rotate_signer(admin: Admin = Depends(owner_admin), session: AsyncSession = Depends(get_session)):
    address = await runtime.rotate_signer()
    await audit(session, admin, "settings.rotate_signer", address)
    await session.commit()
    return {"signer_address": address}


class ContractLogIn(BaseModel):
    contract: Literal["token", "presale", "airdrop", "usdt"]
    method: str = Field(max_length=64)
    args: list[Any] = []
    tx_hash: str = Field(max_length=128)


@router.post("/contracts/log")
async def contract_log(body: ContractLogIn, admin: Admin = Depends(writer_admin),
                       session: AsyncSession = Depends(get_session)):
    await audit(session, admin, "contract.call", body.tx_hash,
                {"contract": body.contract, "method": body.method, "args": body.args})
    await session.commit()
    return {"ok": True}


# ---------- admins ----------

@router.get("/admins")
async def list_admins(admin: Admin = Depends(owner_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Admin).order_by(Admin.id))).scalars().all()
    return {"items": [{**admin_out(a), "created_at": a.created_at} for a in rows]}


class AdminIn(BaseModel):
    email: str
    password: str
    role: Literal["owner", "admin", "viewer"]


async def create_admin(session: AsyncSession, email: str, password: str, role: str) -> tuple[Admin, str]:
    email = email.strip().lower()
    if (await session.execute(select(Admin).where(func.lower(Admin.email) == email))).first():
        raise HTTPException(409, "An admin with this email already exists.")
    if len(password) < 10:
        raise HTTPException(400, "Password must be at least 10 characters.")
    secret = new_totp_secret()
    a = Admin(email=email, password_hash=hash_password(password), totp_secret=secret, role=role)
    session.add(a)
    await session.flush()
    return a, totp_uri(secret, email)


@router.post("/admins")
async def add_admin(body: AdminIn, admin: Admin = Depends(owner_admin),
                    session: AsyncSession = Depends(get_session)):
    new, uri = await create_admin(session, body.email, body.password, body.role)
    await audit(session, admin, "admin.create", new.id, {"email": new.email, "role": new.role})
    await session.commit()
    return {"admin": admin_out(new), "totp_uri": uri}


@router.delete("/admins/{admin_id}")
async def remove_admin(admin_id: int, admin: Admin = Depends(owner_admin),
                       session: AsyncSession = Depends(get_session)):
    if admin_id == admin.id:
        raise HTTPException(400, "You cannot remove yourself.")
    target = await session.get(Admin, admin_id)
    if not target:
        raise HTTPException(404, "Admin not found.")
    await audit(session, admin, "admin.delete", target.id, {"email": target.email})
    await session.delete(target)
    await session.commit()
    return {"ok": True}


@router.get("/audit-log")
async def audit_log(page: int = Query(1), page_size: int = Query(50), admin: Admin = Depends(current_admin),
                    session: AsyncSession = Depends(get_session)):
    offset, limit = page_args(page, page_size)
    total = (await session.execute(select(func.count(AdminAuditLog.id)))).scalar_one()
    rows = (await session.execute(
        select(AdminAuditLog).order_by(AdminAuditLog.id.desc()).offset(offset).limit(limit)
    )).scalars().all()
    return {"items": [
        {"id": r.id, "admin_id": r.admin_id, "admin_email": r.admin_email, "action": r.action,
         "target": r.target, "details": r.details, "created_at": r.created_at} for r in rows
    ], "total": total, "page": max(page, 1), "page_size": limit}


# ---------- backup ----------

MAX_BACKUP_BYTES = 2 * 1024**3


@router.get("/backup/export")
async def backup_export(admin: Admin = Depends(owner_admin), session: AsyncSession = Depends(get_session)):
    now = datetime.now(UTC)
    name = backup.backup_filename(now)
    await audit(session, admin, "backup.export", name)
    await session.commit()
    return StreamingResponse(backup.export_stream(now), media_type="application/gzip",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/backup/import")
async def backup_import(file: UploadFile = File(...), confirm: str = Form(""), admin: Admin = Depends(owner_admin),
                        session: AsyncSession = Depends(get_session)):
    if confirm != "RESTORE":
        raise HTTPException(400, 'Type RESTORE to confirm.')
    if file.size is not None and file.size > MAX_BACKUP_BYTES:
        raise HTTPException(413, "Backup file is larger than 2 GB.")
    email = admin.email
    await session.rollback()  # release this request's locks before TRUNCATE
    try:
        header, counts = await backup.restore(file.file)  # Starlette spools uploads to a temp file
    except backup.RestoreError as e:
        raise HTTPException(400, str(e)) from e
    runtime.invalidate()
    await redis.delete(jobs.INDEXER_KEY)  # re-scan presale logs from the restored start block
    restored = (await session.execute(select(Admin).where(Admin.email == email))).scalar_one_or_none()
    session.add(AdminAuditLog(admin_id=restored.id if restored else None, admin_email=email, action="backup.import",
                              target=str(header.get("created_at")), details={"tables": counts}))
    await session.commit()
    return {"ok": True, "tables": counts, "created_at": header.get("created_at")}
