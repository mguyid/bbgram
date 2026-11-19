"""Minimal Telegram Bot API client over httpx (no bot framework)."""

import logging
import secrets
from typing import Any

import httpx

from app import runtime
from app.db import SessionLocal
from app.settings import settings

log = logging.getLogger(__name__)


async def call(method: str, payload: dict[str, Any], token: str | None = None) -> Any:
    """Call the Bot API with `token` (default: the saved bot token). Returns `result`, or None on failure."""
    global _last_error
    _last_error = ""
    token = token if token is not None else (await runtime.get()).telegram_bot_token
    if not token:
        log.warning("Telegram bot token not set, skipping %s", method)
        return None
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=payload)
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("Telegram %s failed: %s", method, e)
        _last_error = "Could not reach Telegram."
        return None
    if not data.get("ok"):
        log.info("Telegram %s not ok: %s", method, data.get("description"))
        _last_error = str(data.get("description") or "")
        return None
    return data.get("result")


async def send_message(chat_id: int, text: str, button_text: str | None = None,
                       web_app_url: str | None = None, url: str | None = None) -> bool:
    payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
    if button_text and web_app_url:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": button_text, "web_app": {"url": web_app_url}}]]}
    elif button_text and url:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": button_text, "url": url}]]}
    return await call("sendMessage", payload) is not None


async def is_channel_member(channel: str, user_id: int) -> bool:
    result = await call("getChatMember", {"chat_id": channel, "user_id": user_id})
    if not result:
        return False
    status = result.get("status")
    return status in ("creator", "administrator", "member") or (
        status == "restricted" and bool(result.get("is_member"))
    )


# ---------- bot setup: webhook + menu button ----------

class BotSetupError(Exception):
    """Setting up the bot failed; the message is shown to the admin as-is."""


_last_error: str = ""


def webhook_url() -> str:
    return settings.API_PUBLIC_URL.rstrip("/") + "/bot/webhook"


def miniapp_url() -> str:
    return settings.MINIAPP_URL.rstrip("/") + "/"


async def connect_bot(token: str, secret: str) -> dict[str, Any]:
    """Point the bot at this API (webhook) and its menu button at the mini app.

    Raises BotSetupError with a readable reason; returns {"username", "menu_ok"} on success.
    """
    for name, url in (("API_PUBLIC_URL", settings.API_PUBLIC_URL), ("MINIAPP_URL", settings.MINIAPP_URL)):
        if not url.startswith("https://"):
            raise BotSetupError(f"{name} must be a public https URL (it is {url!r}). Check the deploy settings.")
    me = await call("getMe", {}, token=token)
    if not me:
        raise BotSetupError("Telegram rejected this bot token.")
    ok = await call("setWebhook", {"url": webhook_url(), "secret_token": secret,
                                   "allowed_updates": ["message"]}, token=token)
    if not ok:
        raise BotSetupError(f"Telegram refused the webhook {webhook_url()}: {_last_error or 'no reason given'}")
    menu_ok = await call("setChatMenuButton", {"menu_button": {
        "type": "web_app", "text": "Open", "web_app": {"url": miniapp_url()}}}, token=token)
    return {"username": me.get("username", ""), "menu_ok": bool(menu_ok)}


async def bot_status() -> dict[str, Any]:
    """Live status from Telegram for the saved bot."""
    rt = await runtime.get()
    out: dict[str, Any] = {
        "token_set": bool(rt.telegram_bot_token), "username": rt.telegram_bot_username,
        "expected_webhook_url": webhook_url(), "expected_menu_url": miniapp_url(),
        "webhook_url": "", "webhook_ok": False, "pending_updates": 0, "last_error": "",
        "menu_url": "", "menu_ok": False, "reachable": False,
    }
    if not rt.telegram_bot_token:
        return out
    info = await call("getWebhookInfo", {})
    if info is None:
        out["last_error"] = _last_error or "Could not reach Telegram."
        return out
    out["reachable"] = True
    out["webhook_url"] = info.get("url", "")
    out["webhook_ok"] = out["webhook_url"] == webhook_url()
    out["pending_updates"] = info.get("pending_update_count", 0)
    out["last_error"] = info.get("last_error_message", "")
    menu = await call("getChatMenuButton", {}) or {}
    out["menu_url"] = (menu.get("web_app") or {}).get("url", "")
    out["menu_ok"] = out["menu_url"] == miniapp_url()
    return out


async def save_bot_state(values: dict[str, str]) -> None:
    async with SessionLocal() as session:
        await runtime.save(session, values)
        await session.commit()
    runtime.invalidate()


async def ensure_bot() -> str:
    """Re-connect the saved bot if its webhook or menu button points somewhere else (e.g. after a redeploy)."""
    rt = await runtime.get()
    if not rt.telegram_bot_token:
        return "no token"
    status = await bot_status()
    if not status["reachable"]:
        return f"telegram unreachable: {status['last_error']}"
    if status["webhook_ok"] and status["menu_ok"] and rt.telegram_webhook_secret:
        return "ok"
    secret = rt.telegram_webhook_secret or secrets.token_urlsafe(32)
    try:
        result = await connect_bot(rt.telegram_bot_token, secret)
    except BotSetupError as e:
        await save_bot_state({"telegram_webhook_ok": ""})
        return f"failed: {e}"
    await save_bot_state({"telegram_webhook_secret": secret, "telegram_webhook_ok": "true",
                          "telegram_bot_username": result["username"]})
    return "reconnected"
