"""Minimal Telegram Bot API client over httpx (no bot framework)."""

import logging
from typing import Any

import httpx

from app import runtime

log = logging.getLogger(__name__)


async def call(method: str, payload: dict[str, Any], token: str | None = None) -> Any:
    """Call the Bot API with `token` (default: the saved bot token). Returns `result`, or None on failure."""
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
        return None
    if not data.get("ok"):
        log.info("Telegram %s not ok: %s", method, data.get("description"))
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
