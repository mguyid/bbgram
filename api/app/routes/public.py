"""Routes without the /api prefix: X OAuth callback, Telegram bot webhook, health."""

import base64
import hashlib
import hmac
import json
import logging
import secrets
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import runtime, telegram
from app.config_store import get_config
from app.db import get_session
from app.deps import current_user
from app.models import User, XAccount
from app.points import add_points
from app.redis_client import redis
from app.settings import settings

log = logging.getLogger(__name__)
router = APIRouter()

X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"
X_TOKEN_URL = "https://api.x.com/2/oauth2/token"
X_ME_URL = "https://api.x.com/2/users/me"
X_STATE_TTL = 600


@router.get("/health")
async def health():
    return {"ok": True}


# ---------- X OAuth 2.0 PKCE ----------

@router.get("/api/x/connect-url")
async def x_connect_url(user: User = Depends(current_user)):
    rt = await runtime.get()
    if not rt.x_client_id:
        raise HTTPException(409, "X connect is not available yet.")
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    await redis.set(f"xoauth:{state}", json.dumps({"user_id": user.id, "verifier": verifier}), ex=X_STATE_TTL)
    params = {
        "response_type": "code",
        "client_id": rt.x_client_id,
        "redirect_uri": runtime.x_redirect_uri(),
        "scope": "tweet.read users.read",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return {"url": f"{X_AUTHORIZE_URL}?{urlencode(params, quote_via=quote)}"}


async def exchange_x_code(code: str, verifier: str) -> dict:
    """Exchange the auth code and return the X user ({id, username})."""
    rt = await runtime.get()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            X_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": runtime.x_redirect_uri(),
                "code_verifier": verifier,
                "client_id": rt.x_client_id,
            },
            auth=(rt.x_client_id, rt.x_client_secret) if rt.x_client_secret else None,
        )
        r.raise_for_status()
        access_token = r.json()["access_token"]
        me = await client.get(X_ME_URL, headers={"Authorization": f"Bearer {access_token}"})
        me.raise_for_status()
        return me.json()["data"]


@router.get("/x/callback")
async def x_callback(code: str = "", state: str = "", session: AsyncSession = Depends(get_session)):
    raw = await redis.getdel(f"xoauth:{state}") if state else None
    if not raw or not code:
        raise HTTPException(400, "This X connect link expired. Start again from the app.")
    data = json.loads(raw)
    try:
        x_user = await exchange_x_code(code, data["verifier"])
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("X OAuth failed: %s", e)
        raise HTTPException(400, "Could not connect your X account. Try again.") from e

    user = await session.get(User, data["user_id"])
    if user is None:
        raise HTTPException(404, "Account not found.")
    x_id, x_username = str(x_user["id"]), x_user["username"]
    taken = (await session.execute(select(XAccount).where(XAccount.x_user_id == x_id))).scalar_one_or_none()
    if taken and taken.user_id != user.id:
        raise HTTPException(409, "This X account is linked to another Telegram account.")
    acct = (await session.execute(select(XAccount).where(XAccount.user_id == user.id))).scalar_one_or_none()
    if acct:
        acct.x_user_id, acct.username = x_id, x_username
    else:
        session.add(XAccount(user_id=user.id, x_user_id=x_id, username=x_username))
    cfg = await get_config(session)
    if not cfg["activity_paused"] and not user.banned:
        await add_points(session, user.id, "x_connect", int(cfg["x_connect_points"]), "x_connect")
    await session.commit()
    return RedirectResponse(f"https://t.me/{(await runtime.get()).telegram_bot_username}?startapp=x_connected", 302)


# ---------- Telegram bot webhook ----------

@router.post("/bot/webhook")
async def bot_webhook(request: Request, x_telegram_bot_api_secret_token: str | None = Header(None)):
    secret = (await runtime.get()).telegram_webhook_secret
    if not secret or not hmac.compare_digest(x_telegram_bot_api_secret_token or "", secret):
        raise HTTPException(401, "Bad webhook secret")
    update = await request.json()
    message = update.get("message") or {}
    text = (message.get("text") or "").strip()
    chat_id = (message.get("chat") or {}).get("id")
    if chat_id and text.split(" ")[0].split("@")[0] == "/start":
        parts = text.split(maxsplit=1)
        param = parts[1].strip() if len(parts) > 1 else ""
        url = settings.MINIAPP_URL.rstrip("/") + "/"
        if param:
            url += "?" + urlencode({"start_param": param})
        await telegram.send_message(
            chat_id,
            "Welcome to Baby Grand. Spin every 3 hours, invite friends and complete tasks to earn points.",
            button_text="Open Baby Grand",
            web_app_url=url,
        )
    return {"ok": True}
