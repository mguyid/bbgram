import os
import subprocess
import sys
from pathlib import Path

from eth_account import Account

SIGNER = Account.from_key("0x" + "11" * 32)
os.environ.update({
    "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:test@localhost:55432/bg_test"),
    "REDIS_URL": os.environ.get("TEST_REDIS_URL", "redis://localhost:56379/15"),
    "JWT_SECRET": "test-secret-that-is-at-least-32-bytes-long",
    "DEV_MODE": "true",
    "API_PUBLIC_URL": "https://api.example.com",
    "MINIAPP_URL": "https://app.example.com",
    "CORS_ORIGINS": "https://app.example.com",
})
PRESALE = "0x" + "ab" * 20
RUNTIME_DEFAULTS = {
    "telegram_bot_token": "123456:TEST-TOKEN",
    "telegram_bot_username": "BabyGrandBot",
    "telegram_webhook_secret": "hook-secret",
    "chain_id": "97",
    "presale_address": PRESALE,
    "signer_key": SIGNER.key.hex(),
}

API_DIR = Path(__file__).resolve().parent.parent
for cmd in (["downgrade", "base"], ["upgrade", "head"]):
    subprocess.run([sys.executable, "-m", "alembic", *cmd], cwd=API_DIR, check=True, env=os.environ,
                   capture_output=True)

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import runtime, telegram  # noqa: E402
from app.config_store import DEFAULTS, set_config  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.redis_client import redis  # noqa: E402

TABLES = [
    "airdrop_proofs", "airdrops", "snapshot_balances", "snapshots", "presale_contributions", "presale_whitelist",
    "admin_audit_log", "bans", "admins", "risk_scores", "screen_views", "user_devices", "x_posts", "x_accounts",
    "wallets", "spins", "point_events", "referrals", "users", "runtime_settings",
]


async def set_runtime(**values: str) -> None:
    async with SessionLocal() as s:
        await runtime.save(s, values)
        await s.commit()
    runtime.invalidate()


@pytest.fixture(autouse=True)
async def clean_state(monkeypatch):
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
    async with SessionLocal() as s:
        for k, v in DEFAULTS.items():
            await set_config(s, k, v)
        await s.commit()
    await set_runtime(**RUNTIME_DEFAULTS)
    await redis.flushdb()

    sent: list[tuple[str, dict]] = []

    async def fake_call(method, payload, token=None):
        sent.append((method, payload))
        if method == "getChatMember":
            return {"status": "member"}
        if method == "getMe":
            return None if token == "bad-token" else {"id": 1, "username": "NewBot"}
        if method == "setWebhook":
            return True
        return {"message_id": 1}

    monkeypatch.setattr(telegram, "call", fake_call)
    yield sent


@pytest.fixture
def sent(clean_state):
    return clean_state


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def login(client, telegram_id: int, username: str = "", start_param: str | None = None,
                device: str = "dev-device") -> tuple[dict, dict]:
    """Returns (auth headers, me)."""
    body = {"init_data": f"dev:{telegram_id}:{username}", "timezone": "UTC", "platform": "ios", "language": "en"}
    if start_param:
        body["start_param"] = start_param
    r = await client.post("/api/auth/telegram", json=body, headers={"X-Device-Hash": device})
    assert r.status_code == 200, r.text
    data = r.json()
    return {"Authorization": f"Bearer {data['token']}", "X-Device-Hash": device}, data["user"]


@pytest.fixture
async def admin_headers(client):
    return await admin_login(client, "owner@example.com", "owner")


async def admin_login(client, email: str, role: str) -> dict:
    from app.routes.admin import create_admin

    async with SessionLocal() as s:
        await create_admin(s, email, "correct-horse-battery", role)
        await s.commit()
    r = await client.post("/admin-api/auth/login", json={"email": email, "password": "correct-horse-battery"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
