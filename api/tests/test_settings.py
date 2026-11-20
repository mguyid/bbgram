"""Runtime settings and contract action log (interfaces.md 2a)."""

from sqlalchemy import select

from app import chain, runtime
from app.db import SessionLocal
from app.models import RuntimeSetting
from tests.conftest import PRESALE_WALLET, admin_login, login, set_runtime


async def raw_setting(key: str) -> str | None:
    async with SessionLocal() as s:
        return (await s.execute(select(RuntimeSetting.value).where(RuntimeSetting.key == key))).scalar()


async def test_settings_round_trip_masked_and_encrypted(client, admin_headers):
    token = "0x" + "12" * 20
    body = {"x_client_id": "cid", "x_client_secret": "very-secret-value", "rpc_url": "https://rpc.example",
            "chain_id": 56, "token_address": token, "airdrop_address": "0x" + "cd" * 20}
    r = await client.put("/admin-api/settings", headers=admin_headers, json=body)
    assert r.status_code == 200, r.text
    assert "very-secret-value" not in r.text
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    got = (await client.get("/admin-api/settings", headers=viewer)).json()
    assert "very-secret-value" not in str(got)
    assert got["x_client_id"] == "cid" and got["x_client_secret_set"] is True and got["chain_id"] == 56
    assert got["rpc_url"] == "https://rpc.example" and got["token_address"] == token  # checksummed
    assert got["x_redirect_uri"] == "https://api.example.com/x/callback"
    assert got["telegram_bot_token_set"] is True and got["telegram_bot_username"] == "BabyGrandBot"
    assert got["presale_wallet"] == PRESALE_WALLET and got["multisend_address"] == ""
    assert set(got) == {
        "telegram_bot_token_set", "telegram_bot_username", "telegram_webhook_ok", "x_client_id",
        "x_client_secret_set", "x_redirect_uri", "chain_id", "rpc_url", "usdt_address", "token_address",
        "presale_wallet", "presale_start_block", "airdrop_address", "multisend_address",
    }

    # encrypted at rest: raw DB value differs from the plaintext and decrypts back
    raw = await raw_setting("x_client_secret")
    assert raw and raw != "very-secret-value" and runtime.decrypt(raw) == "very-secret-value"
    assert await raw_setting("x_client_id") == "cid"

    # empty string clears; bad input is rejected
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"x_client_secret": ""})
    assert r.json()["x_client_secret_set"] is False
    for bad in ({"token_address": "nope"}, {"chain_id": "abc"}, {"unknown": "x"}, {"rpc_url": 5}):
        assert (await client.put("/admin-api/settings", headers=admin_headers, json=bad)).status_code == 400

    log = (await client.get("/admin-api/audit-log", headers=admin_headers)).json()["items"]
    assert [i["action"] for i in log] == ["settings.update", "settings.update"]
    assert "very-secret-value" not in str(log) and log[1]["details"]["x_client_secret"] == "<secret>"


async def test_settings_owner_only(client, admin_headers):
    staff = await admin_login(client, "staff@example.com", "admin")
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    assert (await client.get("/admin-api/settings", headers=staff)).status_code == 200
    for h in (staff, viewer):
        assert (await client.put("/admin-api/settings", headers=h, json={"x_client_id": "x"})).status_code == 403


async def test_bot_token_save_sets_webhook(client, admin_headers, sent):
    await set_runtime(telegram_webhook_secret="")  # fresh install: no secret yet
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"telegram_bot_token": "bad-token"})
    assert r.status_code == 400
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"telegram_bot_token": "999:NEW"})
    assert r.status_code == 200
    got = r.json()
    assert got["telegram_bot_username"] == "NewBot" and got["telegram_webhook_ok"] is True
    payload = [p for m, p in sent if m == "setWebhook"][-1]
    assert payload["url"] == "https://api.example.com/bot/webhook"
    secret = payload["secret_token"]
    assert len(secret) >= 32 and runtime.decrypt(await raw_setting("telegram_webhook_secret")) == secret
    assert runtime.decrypt(await raw_setting("telegram_bot_token")) == "999:NEW"
    update = {"message": {"text": "/start", "chat": {"id": 5}}}
    assert (await client.post("/bot/webhook", json=update,
                              headers={"X-Telegram-Bot-Api-Secret-Token": secret})).status_code == 200
    assert (await client.post("/bot/webhook", json=update,
                              headers={"X-Telegram-Bot-Api-Secret-Token": "hook-secret"})).status_code == 401
    # links use the new bot username
    _, me = await login(client, 1, "alice")
    assert me["referral_link"].startswith("https://t.me/NewBot?startapp=")


async def test_dev_mode_works_without_bot_token(client, admin_headers):
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"telegram_bot_token": ""})
    assert r.json()["telegram_bot_token_set"] is False and r.json()["telegram_webhook_ok"] is False
    h, me = await login(client, 5, "dev")
    assert me["telegram_id"] == 5


async def test_presale_wallet_save_sets_start_block(client, admin_headers, monkeypatch):
    calls = []

    async def fake_block(rpc_url):
        calls.append(rpc_url)
        return 1234

    monkeypatch.setattr(chain, "current_block", fake_block)
    wallet = "0x" + "77" * 20
    usdt = "0x" + "55" * 20
    r = await client.put("/admin-api/settings", headers=admin_headers,
                         json={"rpc_url": "https://rpc.example", "presale_wallet": wallet, "usdt_address": usdt,
                               "multisend_address": "0x" + "66" * 20})
    got = r.json()
    assert r.status_code == 200, r.text
    assert calls == ["https://rpc.example"] and got["presale_start_block"] == 1234
    assert got["presale_wallet"].lower() == wallet and got["usdt_address"].lower() == usdt
    assert got["multisend_address"].lower() == "0x" + "66" * 20
    # an existing start block is kept; an explicit one wins
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"presale_wallet": wallet})
    assert r.json()["presale_start_block"] == 1234 and len(calls) == 1
    r = await client.put("/admin-api/settings", headers=admin_headers,
                         json={"presale_wallet": wallet, "presale_start_block": 99})
    assert r.json()["presale_start_block"] == 99
    assert (await client.put("/admin-api/settings", headers=admin_headers,
                             json={"presale_wallet": "nope"})).status_code == 400

    async def failing(rpc_url):
        raise ConnectionError("down")

    monkeypatch.setattr(chain, "current_block", failing)
    await client.put("/admin-api/settings", headers=admin_headers, json={"presale_start_block": ""})
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"presale_wallet": wallet})
    assert r.status_code == 400


async def test_usdt_defaults_to_bsc_on_mainnet(client, admin_headers):
    got = (await client.get("/admin-api/settings", headers=admin_headers)).json()
    assert got["usdt_address"] == ""
    assert (await runtime.get()).usdt == ""  # testnet (97) needs it set
    await set_runtime(chain_id="56")
    assert (await runtime.get()).usdt == runtime.BSC_USDT


async def test_contracts_log(client, admin_headers):
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    staff = await admin_login(client, "staff@example.com", "admin")
    body = {"contract": "multisend", "method": "send", "args": ["0x" + "12" * 20],
            "tx_hash": "0x" + "ab" * 32}
    assert (await client.post("/admin-api/contracts/log", headers=viewer, json=body)).status_code == 403
    assert (await client.post("/admin-api/contracts/log", headers=staff,
                              json={**body, "contract": "other"})).status_code == 422
    assert (await client.post("/admin-api/contracts/log", headers=staff, json=body)).json() == {"ok": True}
    item = (await client.get("/admin-api/audit-log", headers=admin_headers)).json()["items"][0]
    assert item["action"] == "contract.call" and item["admin_email"] == "staff@example.com"
    assert item["target"] == body["tx_hash"]
    assert item["details"] == {"contract": "multisend", "method": "send", "args": ["0x" + "12" * 20]}


async def test_web3_client_shared_per_rpc_url():
    a = await chain.w3("http://rpc-a.invalid")
    assert await chain.w3("http://rpc-a.invalid") is a
    b = await chain.w3("http://rpc-b.invalid")
    assert b is not a and await chain.w3("http://rpc-b.invalid") is b


async def test_bot_token_save_sets_menu_button_and_reports_status(client, admin_headers, sent, fake_bot):
    fake_bot.update(webhook="", menu="")
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"telegram_bot_token": "999:NEW"})
    assert r.status_code == 200
    menu = [p for m, p in sent if m == "setChatMenuButton"][-1]["menu_button"]
    assert menu == {"type": "web_app", "text": "Open", "web_app": {"url": "https://app.example.com/"}}
    status = (await client.get("/admin-api/settings/telegram", headers=admin_headers)).json()
    assert status["webhook_ok"] and status["menu_ok"] and status["username"] == "NewBot"
    assert status["webhook_url"] == "https://api.example.com/bot/webhook"


async def test_bot_token_save_fails_loudly_when_webhook_refused(client, admin_headers, fake_bot):
    fake_bot["refuse_webhook"] = "Bad Request: bad webhook: HTTPS url must be provided for webhook"
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"telegram_bot_token": "999:NEW"})
    assert r.status_code == 400 and "HTTPS url must be provided" in r.json()["detail"]
    # the token was not saved
    assert runtime.decrypt(await raw_setting("telegram_bot_token")) == "123456:TEST-TOKEN"


async def test_bot_reconnect_and_ensure_bot(client, admin_headers, fake_bot):
    from app import telegram
    fake_bot.update(webhook="https://old.example.com/bot/webhook", menu="")
    status = (await client.get("/admin-api/settings/telegram", headers=admin_headers)).json()
    assert not status["webhook_ok"] and not status["menu_ok"]
    assert await telegram.ensure_bot() == "reconnected"
    assert fake_bot["webhook"] == "https://api.example.com/bot/webhook" and fake_bot["menu"] == "https://app.example.com/"
    assert await telegram.ensure_bot() == "ok"
    fake_bot["webhook"] = ""
    r = await client.post("/admin-api/settings/telegram/reconnect", headers=admin_headers)
    assert r.status_code == 200 and r.json()["webhook_ok"]
    viewer = await admin_login(client, "v@example.com", "viewer")
    assert (await client.post("/admin-api/settings/telegram/reconnect", headers=viewer)).status_code == 403
