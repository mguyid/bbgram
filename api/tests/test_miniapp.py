import asyncio
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import select

from app.db import SessionLocal
from app.jobs import accrue_x_daily, send_spin_reminders
from app.models import Referral, Spin, User
from app.security import InitDataError, validate_init_data
from app.services import apply_referral
from app.settings import settings
from tests.conftest import login, set_runtime

BOT_TOKEN = "123456:TEST-TOKEN"


def make_init_data(user: dict, auth_date: int | None = None, token: str = BOT_TOKEN, **extra) -> str:
    fields = {"auth_date": str(auth_date or int(time.time())), "query_id": "AAH",
              "user": json.dumps(user, separators=(",", ":")), **extra}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


# ---------- initData ----------

def test_init_data_valid():
    data = make_init_data({"id": 42, "username": "alice", "first_name": "Alice"}, start_param="abc")
    u = validate_init_data(data, BOT_TOKEN)
    assert (u.id, u.username, u.start_param) == (42, "alice", "abc")


def test_init_data_rejects_tampering_wrong_token_and_expiry():
    data = make_init_data({"id": 42, "username": "alice"})
    with pytest.raises(InitDataError):
        validate_init_data(data.replace("alice", "mallory"), BOT_TOKEN)
    with pytest.raises(InitDataError):
        validate_init_data(make_init_data({"id": 42}, token="999:OTHER"), BOT_TOKEN)
    with pytest.raises(InitDataError):
        validate_init_data(make_init_data({"id": 42}, auth_date=int(time.time()) - 3 * 86400), BOT_TOKEN)
    with pytest.raises(InitDataError):
        validate_init_data("auth_date=1&user=%7B%7D", BOT_TOKEN)


async def test_auth_endpoint_with_real_init_data(client):
    data = make_init_data({"id": 7, "username": "bob", "first_name": "Bob", "photo_url": "https://x/p.jpg"})
    r = await client.post("/api/auth/telegram", json={"init_data": data})
    assert r.status_code == 200
    me = r.json()["user"]
    assert me["telegram_id"] == 7 and me["balance"] == 100 and me["rank"] == 1
    assert me["referral_link"] == f"https://t.me/BabyGrandBot?startapp={me['referral_code']}"
    r = await client.post("/api/auth/telegram", json={"init_data": data + "0"})
    assert r.status_code == 401
    assert (await client.get("/api/me")).status_code == 401


async def test_dev_mode_off_rejects_dev_init_data(client, monkeypatch):
    monkeypatch.setattr(settings, "DEV_MODE", False)
    r = await client.post("/api/auth/telegram", json={"init_data": "dev:1:alice"})
    assert r.status_code == 401


# ---------- registration / referrals ----------

async def test_referral_credited_only_after_first_spin(client):
    ha, a = await login(client, 1001, "alice")
    hb, b = await login(client, 1002, "bob", start_param=a["referral_code"])
    assert b["balance"] == 100

    r = (await client.get("/api/referrals", headers=ha)).json()
    assert r["stats"] == {"friends": 1, "points_earned": 0, "pending": 1}
    assert r["items"][0]["status"] == "pending"
    assert (await client.get("/api/me", headers=ha)).json()["balance"] == 100

    assert (await client.post("/api/spin", headers=hb)).status_code == 200
    r = (await client.get("/api/referrals", headers=ha)).json()
    assert r["stats"] == {"friends": 1, "points_earned": 250, "pending": 0}
    assert r["items"][0]["status"] == "credited"
    assert (await client.get("/api/me", headers=ha)).json()["balance"] == 350


async def test_referral_not_credited_without_username_or_above_max_id(client):
    ha, a = await login(client, 1001, "alice")
    hb, _ = await login(client, 1002, "", start_param=a["referral_code"])  # no username, no photo
    await client.post("/api/spin", headers=hb)
    async with SessionLocal() as s:
        from app.config_store import set_config
        await set_config(s, "max_telegram_id", 1500)
        await s.commit()
    hc, _ = await login(client, 2000, "carol", start_param=a["referral_code"])
    await client.post("/api/spin", headers=hc)
    assert (await client.get("/api/me", headers=ha)).json()["balance"] == 100
    async with SessionLocal() as s:
        statuses = (await s.execute(select(Referral.status))).scalars().all()
    assert statuses == ["rejected", "rejected"]


async def test_self_and_circular_referral_rejected(client):
    ha, a = await login(client, 1001, "alice")
    # existing user passing its own code: ignored
    await login(client, 1001, "alice", start_param=a["referral_code"])
    hb, b = await login(client, 1002, "bob", start_param=a["referral_code"])
    async with SessionLocal() as s:
        alice = (await s.execute(select(User).where(User.telegram_id == 1001))).scalar_one()
        assert alice.referred_by_id is None
        assert await apply_referral(s, alice, a["referral_code"]) is False  # self
        assert await apply_referral(s, alice, b["referral_code"]) is False  # A->B->A
        assert alice.referred_by_id is None
        assert len((await s.execute(select(Referral))).scalars().all()) == 1


# ---------- spin ----------

async def test_spin_and_duplicate_rejected(client):
    h, _ = await login(client, 1, "alice")
    st = (await client.get("/api/spin", headers=h)).json()
    assert st == {"ready": True, "next_refill_at": None, "points_per_spin": 200, "interval_seconds": 10800}
    r = await client.post("/api/spin", headers=h)
    assert r.status_code == 200
    assert r.json()["points"] == 200 and r.json()["balance"] == 300
    r = await client.post("/api/spin", headers=h)
    assert r.status_code == 409
    st = (await client.get("/api/spin", headers=h)).json()
    assert st["ready"] is False and st["next_refill_at"]


async def test_concurrent_spins_only_one_succeeds(client):
    h, _ = await login(client, 1, "alice")
    results = await asyncio.gather(*[client.post("/api/spin", headers=h) for _ in range(5)])
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409, 409, 409, 409]
    assert (await client.get("/api/me", headers=h)).json()["balance"] == 300


async def test_spin_reminder_sent_once(client, sent):
    h, me = await login(client, 1, "alice")
    await client.post("/api/spin", headers=h)
    async with SessionLocal() as s:
        spin = (await s.execute(select(Spin))).scalar_one()
        spin.created_at = spin.created_at.replace(year=spin.created_at.year - 1)
        await s.commit()
        assert await send_spin_reminders(s) == 1
        assert await send_spin_reminders(s) == 0
    assert sent[-1][0] == "sendMessage" and sent[-1][1]["chat_id"] == 1


# ---------- pause ----------

async def test_pause_returns_423_on_earning_endpoints(client, admin_headers):
    h, _ = await login(client, 1, "alice")
    assert (await client.post("/admin-api/pause", headers=admin_headers)).status_code == 200
    assert (await client.get("/api/me", headers=h)).json()["activity_paused"] is True
    assert (await client.post("/api/spin", headers=h)).status_code == 423
    assert (await client.post("/api/x/post", headers=h,
                              json={"url": "https://x.com/a/status/1"})).status_code == 423
    assert (await client.post("/api/x/bio", headers=h, json={"marked": True})).status_code == 423
    assert (await client.post("/api/tasks/join_channel", headers=h)).status_code == 423
    _, newbie = await login(client, 2, "newbie")
    assert newbie["balance"] == 0  # no register points while paused
    async with SessionLocal() as s:
        assert await accrue_x_daily(s) == 0
    assert (await client.post("/admin-api/resume", headers=admin_headers)).status_code == 200
    assert (await client.post("/api/spin", headers=h)).status_code == 200


async def test_banned_user_cannot_earn(client, admin_headers):
    h, me = await login(client, 1, "alice")
    await client.post(f"/admin-api/users/{me['id']}/ban", headers=admin_headers, json={"reason": "sybil"})
    assert (await client.post("/api/spin", headers=h)).status_code == 403


# ---------- X ----------

async def test_x_post_submission_and_daily_accrual(client):
    h, _ = await login(client, 1, "alice")
    r = await client.post("/api/x/post", headers=h, json={"url": "not a url"})
    assert r.status_code == 400
    r = await client.post("/api/x/post", headers=h,
                          json={"url": "https://twitter.com/Alice_1/status/1234567890?s=20"})
    assert r.status_code == 200
    post = r.json()
    assert post["url"] == "https://x.com/Alice_1/status/1234567890" and post["status"] == "active"
    again = await client.post("/api/x/post", headers=h, json={"url": "https://x.com/Alice_1/status/1234567890"})
    assert again.json()["id"] == post["id"]
    assert (await client.get("/api/me", headers=h)).json()["balance"] == 200  # 100 register + 100 x_post

    h2, _ = await login(client, 2, "bob")
    r = await client.post("/api/x/post", headers=h2, json={"url": "https://x.com/Alice_1/status/1234567890"})
    assert r.status_code == 409

    assert (await client.post("/api/x/bio", headers=h, json={"marked": True})).json() == {"bio_marked": True}
    x = (await client.get("/api/x", headers=h)).json()
    assert x["connected"] is False and x["bio_marked"] is True and len(x["posts"]) == 1

    async with SessionLocal() as s:
        assert await accrue_x_daily(s) == 2
        assert await accrue_x_daily(s) == 0  # idempotent within the UTC day
    assert (await client.get("/api/me", headers=h)).json()["balance"] == 300

    tasks = {t["key"]: t["state"] for t in (await client.get("/api/tasks", headers=h)).json()["tasks"]}
    assert tasks["x_post"] == "done" and tasks["x_bio"] == "done" and tasks["x_connect"] == "todo"


async def test_x_connect_url_and_callback(client, monkeypatch):
    from app.routes import public

    await set_runtime(x_client_id="cid")
    h, _ = await login(client, 1, "alice")
    url = (await client.get("/api/x/connect-url", headers=h)).json()["url"]
    assert "code_challenge_method=S256" in url and "redirect_uri=https%3A%2F%2Fapi.example.com%2Fx%2Fcallback" in url
    state = url.split("state=")[1].split("&")[0]

    async def fake_exchange(code, verifier):
        return {"id": "999", "username": "alice_x"}

    monkeypatch.setattr(public, "exchange_x_code", fake_exchange)
    r = await client.get(f"/x/callback?code=abc&state={state}")
    assert r.status_code == 302
    assert r.headers["location"] == "https://t.me/BabyGrandBot?startapp=x_connected"
    me = (await client.get("/api/me", headers=h)).json()
    assert me["x_username"] == "alice_x" and me["balance"] == 600
    assert (await client.get(f"/x/callback?code=abc&state={state}")).status_code == 400  # state single use


# ---------- wallet ----------

async def test_wallet_link_signature(client):
    h, me = await login(client, 1, "alice")
    acct = Account.create()
    n = (await client.get("/api/wallet/nonce", headers=h)).json()
    assert n["message"] == f"Link this wallet to Baby Grand: 1 {n['nonce']}"

    bad = Account.create().sign_message(encode_defunct(text=n["message"])).signature.hex()
    r = await client.post("/api/wallet/link", headers=h,
                          json={"address": acct.address, "signature": "0x" + bad, "nonce": n["nonce"]})
    assert r.status_code == 400

    sig = "0x" + acct.sign_message(encode_defunct(text=n["message"])).signature.hex()
    r = await client.post("/api/wallet/link", headers=h,
                          json={"address": acct.address.lower(), "signature": sig, "nonce": n["nonce"]})
    assert r.status_code == 200 and r.json() == {"address": acct.address}
    assert (await client.get("/api/me", headers=h)).json()["wallet_address"] == acct.address
    # nonce is single use
    r = await client.post("/api/wallet/link", headers=h,
                          json={"address": acct.address, "signature": sig, "nonce": n["nonce"]})
    assert r.status_code == 400

    # same wallet on another account -> 409
    h2, _ = await login(client, 2, "bob")
    n2 = (await client.get("/api/wallet/nonce", headers=h2)).json()
    sig2 = "0x" + acct.sign_message(encode_defunct(text=n2["message"])).signature.hex()
    r = await client.post("/api/wallet/link", headers=h2,
                          json={"address": acct.address, "signature": sig2, "nonce": n2["nonce"]})
    assert r.status_code == 409


async def test_handoff_single_use(client, sent):
    h, me = await login(client, 1, "alice")
    url = (await client.post("/api/handoff", headers=h)).json()["url"]
    assert url.startswith("https://app.example.com/?handoff=")
    token = url.split("handoff=")[1]
    r = await client.post("/api/auth/handoff", json={"handoff_token": token})
    assert r.status_code == 200 and r.json()["user"]["id"] == me["id"]
    assert (await client.post("/api/auth/handoff", json={"handoff_token": token})).status_code == 401
    assert (await client.post("/api/handoff/send", headers=h)).json() == {"ok": True}
    assert sent[-1][1]["reply_markup"]["inline_keyboard"][0][0]["url"].startswith("https://app.example.com/")


# ---------- misc screens ----------

async def test_leaderboard_tasks_events_settings(client, sent):
    h1, _ = await login(client, 1, "alice")
    h2, _ = await login(client, 2, "bob")
    await client.post("/api/spin", headers=h2)
    lb = (await client.get("/api/leaderboard?period=week", headers=h1)).json()
    assert [i["name"] for i in lb["items"]] == ["bob", "alice"]
    assert lb["me"] == {"rank": 2, "points": 100}
    assert (await client.post("/api/events", headers=h1, json={"screen": "tasks"})).json() == {"ok": True}
    me = (await client.patch("/api/settings", headers=h1, json={"reminders_enabled": False})).json()
    assert me["reminders_enabled"] is False
    async with SessionLocal() as s:
        from app.config_store import set_config
        await set_config(s, "telegram_channel", "@babygrand")
        await s.commit()
    assert (await client.post("/api/tasks/join_channel", headers=h1)).json() == {"state": "done"}
    assert (await client.post("/api/tasks/join_channel", headers=h1)).json() == {"state": "done"}
    assert (await client.get("/api/me", headers=h1)).json()["balance"] == 350


async def test_bot_webhook(client, sent):
    r = await client.post("/bot/webhook", json={})
    assert r.status_code == 401
    update = {"message": {"text": "/start ref123", "chat": {"id": 55}}}
    r = await client.post("/bot/webhook", json=update, headers={"X-Telegram-Bot-Api-Secret-Token": "hook-secret"})
    assert r.status_code == 200
    method, payload = sent[-1]
    assert method == "sendMessage" and payload["chat_id"] == 55
    assert payload["reply_markup"]["inline_keyboard"][0][0]["web_app"]["url"] == (
        "https://app.example.com/?start_param=ref123")


async def test_rate_limits_return_429(client):
    h, _ = await login(client, 1, "alice")
    codes = [(await client.get("/api/me", headers=h)).status_code for _ in range(60)]
    assert codes == [200] * 60  # 60 per user per minute (the login itself is IP-limited, not user-limited)
    r = await client.get("/api/me", headers=h)
    assert r.status_code == 429 and r.json() == {"detail": "Too many requests. Try again in a minute."}

    body = {"email": "x@example.com", "password": "wrong-password", "totp": "000000"}
    codes = [(await client.post("/admin-api/auth/login", json=body)).status_code for _ in range(11)]
    assert codes == [401] * 10 + [429]

    for _ in range(29):  # 1 already used by the login above
        await client.post("/api/auth/telegram", json={"init_data": "dev:2:bob"})
    assert (await client.post("/api/auth/telegram", json={"init_data": "dev:2:bob"})).status_code == 429
