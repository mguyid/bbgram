"""Runtime settings, signer rotation, contract action log (interfaces.md 2a)."""

from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import select

from app import chain, runtime
from app.db import SessionLocal
from app.models import RuntimeSetting
from tests.conftest import PRESALE, SIGNER, admin_login, login, set_runtime


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
    assert got["presale_address"] == PRESALE and got["signer_address"] == SIGNER.address
    assert set(got) == {
        "telegram_bot_token_set", "telegram_bot_username", "telegram_webhook_ok", "x_client_id",
        "x_client_secret_set", "x_redirect_uri", "chain_id", "rpc_url", "usdt_address", "token_address",
        "presale_address", "presale_start_block", "airdrop_address", "signer_address",
    }

    # encrypted at rest: raw DB value differs from the plaintext and decrypts back
    raw = await raw_setting("x_client_secret")
    assert raw and raw != "very-secret-value" and runtime.decrypt(raw) == "very-secret-value"
    assert await raw_setting("x_client_id") == "cid"
    assert runtime.decrypt(await raw_setting("signer_key")) == SIGNER.key.hex()

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
        assert (await client.post("/admin-api/settings/rotate-signer", headers=h)).status_code == 403


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


async def test_presale_address_save_reads_chain(client, admin_headers, monkeypatch):
    usdt = "0x" + "55" * 20
    calls = []

    async def fake_setup(rpc_url, presale):
        calls.append((rpc_url, presale))
        return usdt, 1234

    monkeypatch.setattr(chain, "read_presale_setup", fake_setup)
    new_presale = "0x" + "77" * 20
    r = await client.put("/admin-api/settings", headers=admin_headers,
                         json={"rpc_url": "https://rpc.example", "presale_address": new_presale})
    got = r.json()
    assert calls == [("https://rpc.example", new_presale)]
    assert got["usdt_address"] == usdt and got["presale_start_block"] == 1234
    # an explicit start block is kept
    r = await client.put("/admin-api/settings", headers=admin_headers,
                         json={"presale_address": new_presale, "presale_start_block": 99})
    assert r.json()["presale_start_block"] == 99

    async def failing(rpc_url, presale):
        raise ConnectionError("down")

    monkeypatch.setattr(chain, "read_presale_setup", failing)
    r = await client.put("/admin-api/settings", headers=admin_headers, json={"presale_address": new_presale})
    assert r.status_code == 400


async def test_rotate_signer_signature_recovers_to_new_address(client, admin_headers):
    h, _ = await login(client, 1, "alice")
    acct = Account.create()
    n = (await client.get("/api/wallet/nonce", headers=h)).json()
    sig = "0x" + acct.sign_message(encode_defunct(text=n["message"])).signature.hex()
    await client.post("/api/wallet/link", headers=h,
                      json={"address": acct.address, "signature": sig, "nonce": n["nonce"]})
    await client.post("/admin-api/presale/whitelist", headers=admin_headers, json={"wallet_address": acct.address})

    r = await client.post("/admin-api/settings/rotate-signer", headers=admin_headers)
    new_address = r.json()["signer_address"]
    assert new_address != SIGNER.address
    assert (await client.get("/admin-api/settings", headers=admin_headers)).json()["signer_address"] == new_address
    s = (await client.get("/api/presale/signature", headers=h)).json()
    assert chain.recover_whitelist_signer(97, PRESALE, acct.address, int(s["max_allocation_wei"]),
                                          s["signature"]) == new_address
    log = (await client.get("/admin-api/audit-log", headers=admin_headers)).json()["items"]
    assert log[0]["action"] == "settings.rotate_signer" and log[0]["target"] == new_address


async def test_signer_generated_on_first_need(client, admin_headers):
    async with SessionLocal() as s:
        await runtime.save(s, {"signer_key": ""})
        await s.commit()
    runtime.invalidate()
    address = (await client.get("/admin-api/settings", headers=admin_headers)).json()["signer_address"]
    assert address and address != SIGNER.address
    assert (await client.get("/admin-api/settings", headers=admin_headers)).json()["signer_address"] == address


async def test_contracts_log(client, admin_headers):
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    staff = await admin_login(client, "staff@example.com", "admin")
    body = {"contract": "presale", "method": "setPrice", "args": ["100000000000000000000"],
            "tx_hash": "0x" + "ab" * 32}
    assert (await client.post("/admin-api/contracts/log", headers=viewer, json=body)).status_code == 403
    assert (await client.post("/admin-api/contracts/log", headers=staff,
                              json={**body, "contract": "other"})).status_code == 422
    assert (await client.post("/admin-api/contracts/log", headers=staff, json=body)).json() == {"ok": True}
    item = (await client.get("/admin-api/audit-log", headers=admin_headers)).json()["items"][0]
    assert item["action"] == "contract.call" and item["admin_email"] == "staff@example.com"
    assert item["target"] == body["tx_hash"]
    assert item["details"] == {"contract": "presale", "method": "setPrice", "args": ["100000000000000000000"]}


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
