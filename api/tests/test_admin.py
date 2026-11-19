from decimal import Decimal

import pyotp
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import select

from app.db import SessionLocal
from app.merkle import leaf_hash
from app.models import PointEvent, Referral, RiskScore, UserDevice
from app.risk import compute_risk_scores
from app.routes.admin import create_admin
from tests.conftest import admin_login, login, set_runtime
from tests.test_crypto import oz_verify


async def test_admin_login_requires_totp(client):
    async with SessionLocal() as s:
        _, uri = await create_admin(s, "Boss@Example.com", "correct-horse-battery", "owner")
        await s.commit()
    totp = pyotp.parse_uri(uri)
    body = {"email": "boss@example.com", "password": "correct-horse-battery"}
    assert (await client.post("/admin-api/auth/login", json={**body, "totp": "000000"})).status_code == 401
    bad_pw = {**body, "password": "wrong-password", "totp": totp.now()}
    assert (await client.post("/admin-api/auth/login", json=bad_pw)).status_code == 401
    r = await client.post("/admin-api/auth/login", json={**body, "totp": totp.now()})
    assert r.status_code == 200
    assert r.json()["admin"]["role"] == "owner"
    me = await client.get("/admin-api/me", headers={"Authorization": f"Bearer {r.json()['token']}"})
    assert me.json() == {"id": 1, "email": "boss@example.com", "role": "owner"}
    # a user token is not an admin token
    h, _ = await login(client, 1, "alice")
    assert (await client.get("/admin-api/me", headers={"Authorization": h["Authorization"]})).status_code == 401


async def test_roles_and_audit_log(client, admin_headers):
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    assert (await client.get("/admin-api/stats", headers=viewer)).status_code == 200
    assert (await client.post("/admin-api/pause", headers=viewer)).status_code == 403
    assert (await client.get("/admin-api/admins", headers=viewer)).status_code == 403
    staff = await admin_login(client, "staff@example.com", "admin")
    assert (await client.post("/admin-api/admins", headers=staff,
                              json={"email": "x@example.com", "password": "long-enough-pw", "role": "admin"})
            ).status_code == 403

    r = await client.post("/admin-api/admins", headers=admin_headers,
                          json={"email": "new@example.com", "password": "long-enough-pw", "role": "viewer"})
    assert r.status_code == 200 and r.json()["totp_uri"].startswith("otpauth://totp/")
    r = await client.put("/admin-api/config", headers=admin_headers, json={"points_per_spin": 300})
    assert r.json()["points_per_spin"] == 300
    assert (await client.put("/admin-api/config", headers=admin_headers, json={"nope": 1})).status_code == 400
    assert (await client.put("/admin-api/config", headers=admin_headers,
                             json={"points_per_spin": "x"})).status_code == 400
    h, me = await login(client, 1, "alice")
    await client.post(f"/admin-api/users/{me['id']}/adjust", headers=admin_headers,
                      json={"amount": 50, "reason": "bug"})
    assert (await client.get("/api/me", headers=h)).json()["balance"] == 150

    log = (await client.get("/admin-api/audit-log", headers=admin_headers)).json()
    assert [i["action"] for i in log["items"]] == ["user.adjust", "config.update", "admin.create"]
    assert log["total"] == 3 and log["page"] == 1

    detail = (await client.get(f"/admin-api/users/{me['id']}", headers=viewer)).json()
    assert detail["balance"] == 150 and detail["point_events"][0]["note"] == "bug"
    assert detail["devices"][0]["device_hash"] == "dev-device" and detail["referrer"] is None
    users = (await client.get("/admin-api/users?q=ali", headers=viewer)).json()
    assert users["total"] == 1 and users["items"][0]["balance"] == 150


async def test_risk_scoring_and_clusters(client, admin_headers):
    _, a = await login(client, 1, "alice", device="shared")
    _, b = await login(client, 2, "bob", device="shared")
    _, c = await login(client, 3, "carol", device="own")
    async with SessionLocal() as s:
        assert await compute_risk_scores(s) == 3
        scores = {r.user_id: r for r in (await s.execute(select(RiskScore))).scalars()}
        devices = (await s.execute(select(UserDevice))).scalars().all()
    assert all(d.ip for d in devices)
    assert scores[a["id"]].score >= 40 and any("Device shared" in r for r in scores[a["id"]].reasons)
    # all three test clients share an IP, so carol only gets the IP signal
    assert scores[c["id"]].score == 20
    clusters = (await client.get("/admin-api/clusters", headers=admin_headers)).json()["items"]
    dev = [cl for cl in clusters if cl["kind"] == "device"]
    assert dev == [{"kind": "device", "key": "shared", "user_ids": [a["id"], b["id"]], "count": 2}]
    r = await client.post("/admin-api/clusters/ban", headers=admin_headers,
                          json={"user_ids": dev[0]["user_ids"], "reason": "shared device"})
    assert r.json()["banned"] == 2
    users = (await client.get("/admin-api/users?banned=true", headers=admin_headers)).json()
    assert users["total"] == 2
    await client.post(f"/admin-api/users/{a['id']}/unban", headers=admin_headers)
    assert (await client.get("/admin-api/users?banned=true", headers=admin_headers)).json()["total"] == 1


async def link_wallet(client, headers) -> str:
    acct = Account.create()
    n = (await client.get("/api/wallet/nonce", headers=headers)).json()
    sig = "0x" + acct.sign_message(encode_defunct(text=n["message"])).signature.hex()
    r = await client.post("/api/wallet/link", headers=headers,
                          json={"address": acct.address, "signature": sig, "nonce": n["nonce"]})
    assert r.status_code == 200
    return acct.address


async def test_snapshot_preview_airdrop(client, admin_headers, monkeypatch):
    from app import chain

    ha, a = await login(client, 1, "alice")                                   # referrer of bob and sybil
    hb, b = await login(client, 2, "bob", start_param=a["referral_code"])
    hs, sy = await login(client, 3, "sybil", start_param=a["referral_code"])
    hn, nw = await login(client, 4, "nowallet")
    for h in (hb, hs):
        await client.post("/api/spin", headers=h)
    wa, wb, _ = await link_wallet(client, ha), await link_wallet(client, hb), await link_wallet(client, hs)
    # alice: 100 + 2*250 = 600; bob: 300; sybil: 300; nowallet: 100
    async with SessionLocal() as s:
        s.add(RiskScore(user_id=sy["id"], score=90, reasons=["test"]))
        await s.commit()

    assert (await client.post("/admin-api/snapshots", headers=admin_headers)).status_code == 409
    await client.post("/admin-api/pause", headers=admin_headers)
    r = await client.post("/admin-api/snapshots", headers=admin_headers)
    assert r.status_code == 200
    snap = r.json()
    items = {i["user_id"]: i for i in snap["items"]}
    assert items[sy["id"]]["excluded"] and items[sy["id"]]["exclusion_reason"] == "risk"
    assert items[nw["id"]]["exclusion_reason"] == "no_wallet"
    assert items[a["id"]]["points"] == 350  # 250 clawed back for the sybil referral
    assert snap["total_points"] == 350 + 300
    async with SessionLocal() as s:
        claw = (await s.execute(select(PointEvent).where(PointEvent.type == "clawback"))).scalar_one()
        assert claw.amount == -250 and claw.user_id == a["id"]
        statuses = sorted((await s.execute(select(Referral.status))).scalars().all())
        assert statuses == ["clawed_back", "credited"]

    # wallet re-link is closed once a snapshot exists
    n = (await client.get("/api/wallet/nonce", headers=ha)).json()
    other = Account.create()
    sig = "0x" + other.sign_message(encode_defunct(text=n["message"])).signature.hex()
    r = await client.post("/api/wallet/link", headers=ha,
                          json={"address": other.address, "signature": sig, "nonce": n["nonce"]})
    assert r.status_code == 409

    body = {"pool_tokens": "1300", "min_points": None, "per_user_cap_tokens": None}
    p = (await client.post(f"/admin-api/snapshots/{snap['id']}/preview", headers=admin_headers, json=body)).json()
    assert p["total_points"] == 650 and p["recipients"] == 2 and p["total_tokens"] == "1300"
    amounts = {i["user_id"]: i["amount"] for i in p["items"]}
    assert amounts == {a["id"]: "700", b["id"]: "600"}

    capped = {**body, "per_user_cap_tokens": "650.5", "min_points": 301}
    p = (await client.post(f"/admin-api/snapshots/{snap['id']}/preview", headers=admin_headers, json=capped)).json()
    assert p["items"] == [{"user_id": a["id"], "wallet_address": wa, "points": 350, "amount": "650.5"}]

    # restore the sybil manually, then build
    await client.post(f"/admin-api/snapshots/{snap['id']}/exclusions", headers=admin_headers,
                      json={"user_id": sy["id"], "excluded": False})
    r = await client.post(f"/admin-api/snapshots/{snap['id']}/airdrop", headers=admin_headers, json=body)
    assert r.status_code == 200
    drop = r.json()
    assert drop["recipients"] == 3
    assert int(drop["total_amount_wei"]) <= 1300 * 10**18

    proofs = (await client.get(f"/admin-api/airdrops/{drop['airdrop_id']}/proofs", headers=admin_headers)).json()
    assert proofs["merkle_root"] == drop["merkle_root"]
    for item in proofs["items"]:
        assert oz_verify(item["proof"], drop["merkle_root"], leaf_hash(item["wallet_address"], int(item["amount_wei"])))
    by_wallet = {i["wallet_address"]: int(i["amount_wei"]) for i in proofs["items"]}
    assert by_wallet[wb] == int(Decimal(1300 * 10**18) * 300 // 950)

    # not active until the on-chain merkleRoot() matches
    ad = (await client.get("/api/airdrop", headers=hb)).json()
    assert ad == {"available": False, "airdrop_address": None, "amount_wei": "0", "proof": [], "claimed": False,
                  "deadline": None}
    contract = "0x" + "cd" * 20
    await set_runtime(airdrop_address=contract)
    onchain = {"merkle_root": drop["merkle_root"].upper().replace("0X", "0x"), "deadline": 1893456000,
               "claimed": False}
    seen_wallets = []

    async def fake_read_airdrop(rt, wallet=None):
        seen_wallets.append(wallet)
        return onchain

    monkeypatch.setattr(chain, "read_airdrop", fake_read_airdrop)
    ad = (await client.get("/api/airdrop", headers=hb)).json()
    assert ad["available"] is True and ad["claimed"] is False and ad["airdrop_address"] == contract
    assert ad["amount_wei"] == str(by_wallet[wb]) and ad["deadline"] == "2030-01-01T00:00:00Z"
    assert seen_wallets[-1] == wb
    assert oz_verify(ad["proof"], drop["merkle_root"], leaf_hash(wb, int(ad["amount_wei"])))
    drops = (await client.get("/admin-api/airdrops", headers=admin_headers)).json()["items"]
    assert drops[0]["active"] is True and "contract_address" not in drops[0]
    onchain["merkle_root"] = "0x" + "00" * 32
    assert (await client.get("/api/airdrop", headers=hb)).json()["available"] is False
    assert (await client.get("/admin-api/airdrops", headers=admin_headers)).json()["items"][0]["active"] is False
    assert (await client.get("/api/airdrop", headers=hn)).json()["available"] is False

    lists = [await client.get(f"/admin-api/{p}", headers=admin_headers) for p in ("snapshots", "airdrops")]
    assert all(r.status_code == 200 and len(r.json()["items"]) == 1 for r in lists)


async def test_x_review_presale_and_stats(client, admin_headers, monkeypatch):
    from app import chain, jobs

    h, me = await login(client, 1, "alice")
    wallet = await link_wallet(client, h)
    post = (await client.post("/api/x/post", headers=h, json={"url": "https://x.com/alice/status/77"})).json()
    await client.post("/api/x/bio", headers=h, json={"marked": True})

    posts = (await client.get("/admin-api/x/posts?status=active", headers=admin_headers)).json()["items"]
    assert posts[0]["id"] == post["id"] and posts[0]["username"] == "alice" and "x_username" in posts[0]
    await client.post(f"/admin-api/x/posts/{post['id']}/revoke", headers=admin_headers)
    bios = (await client.get("/admin-api/x/bios", headers=admin_headers)).json()["items"]
    assert bios[0]["user_id"] == me["id"]
    await client.post(f"/admin-api/x/bios/{me['id']}/revoke", headers=admin_headers)
    assert (await client.post("/api/x/bio", headers=h, json={"marked": True})).status_code == 403
    assert (await client.get("/api/x", headers=h)).json()["posts"][0]["status"] == "revoked"
    async with SessionLocal() as s:
        assert await jobs.accrue_x_daily(s) == 0

    # presale indexer with a stubbed chain
    await set_runtime(rpc_url="http://rpc.invalid")
    logs = [{"buyer": wallet, "amount": 10 * 10**18, "total": 10 * 10**18, "tx_hash": "0x" + "aa" * 32,
             "log_index": 0, "block_number": 5}]

    async def fake_fetch(rt, from_block):
        return logs, 10

    monkeypatch.setattr(chain, "fetch_contributed_logs", fake_fetch)
    async with SessionLocal() as s:
        assert await jobs.index_presale(s) == 1
        await jobs.index_presale(s)  # same log again: idempotent
    c = (await client.get("/admin-api/presale/contributions", headers=admin_headers)).json()
    assert c["raised_wei"] == str(10 * 10**18) and len(c["items"]) == 1 and c["items"][0]["user_id"] == me["id"]

    await client.post("/admin-api/presale/whitelist", headers=admin_headers, json={"wallet_address": wallet})
    assert (await client.post("/admin-api/presale/whitelist", headers=admin_headers,
                              json={"wallet_address": wallet})).status_code == 409
    wl = (await client.get("/admin-api/presale/whitelist", headers=admin_headers)).json()["items"]
    assert wl[0]["username"] == "alice"
    assert (await client.delete(f"/admin-api/presale/whitelist/{wallet.lower()}",
                                headers=admin_headers)).status_code == 200

    stats = (await client.get("/admin-api/stats", headers=admin_headers)).json()
    assert stats["users"] == 1 and stats["wallets_linked"] == 1
    assert stats["presale"] == {"raised_wei": str(10 * 10**18), "contributors": 1}
