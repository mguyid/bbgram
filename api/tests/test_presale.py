"""Presale without a contract (interfaces.md sections 1 and 2, Presale)."""

from datetime import UTC, datetime, timedelta

from app import chain, jobs
from app.db import SessionLocal
from app.models import PresaleContribution
from tests.conftest import PRESALE_WALLET, admin_login, login, set_runtime
from tests.test_admin import link_wallet

E18 = 10**18
_log = iter(range(1, 10_000))


async def pay(wallet: str, usdt: int) -> None:
    """A USDT transfer into the presale wallet, as the indexer would store it."""
    n = next(_log)
    async with SessionLocal() as s:
        s.add(PresaleContribution(wallet_address=wallet, amount_wei=usdt * E18, total_wei=0,
                                  tx_hash="0x" + f"{n:064x}", log_index=0, block_number=n,
                                  created_at=datetime.now(UTC)))
        await s.commit()


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def open_sale(client, admin_headers, **extra) -> None:
    now = datetime.now(UTC)
    body = {"presale_tokens_per_usdt": "100", "presale_hard_cap_usdt": 10_000, "presale_max_usdt": 500,
            "presale_start_at": iso(now - timedelta(minutes=1)), "presale_end_at": iso(now + timedelta(hours=1)),
            **extra}
    r = await client.put("/admin-api/config", headers=admin_headers, json=body)
    assert r.status_code == 200, r.text


async def test_terms_validation(client, admin_headers):
    now = datetime.now(UTC)
    bad = [
        {"presale_tokens_per_usdt": "abc"}, {"presale_tokens_per_usdt": "0"}, {"presale_tokens_per_usdt": 100},
        {"presale_start_at": "tomorrow"},
        {"presale_start_at": iso(now), "presale_end_at": iso(now - timedelta(hours=1))},
        {"presale_min_usdt": 600, "presale_max_usdt": 500},
        {"presale_closed_at": iso(now)},
        {"presale_hard_cap_usdt": -1},
    ]
    for body in bad:
        r = await client.put("/admin-api/config", headers=admin_headers, json=body)
        assert r.status_code == 400, body
    await open_sale(client, admin_headers, presale_tokens_per_usdt="12.5")
    cfg = (await client.get("/admin-api/config", headers=admin_headers)).json()
    assert cfg["presale_tokens_per_usdt"] == "12.5" and cfg["presale_max_usdt"] == 500


async def test_statuses(client, admin_headers):
    h, _ = await login(client, 1, "alice")

    async def status() -> str:
        return (await client.get("/api/presale", headers=h)).json()["status"]

    p = (await client.get("/api/presale", headers=h)).json()
    assert p["status"] == "upcoming" and p["raised_wei"] == "0" and p["tokens_wei"] == "0"
    assert p["presale_wallet"] == PRESALE_WALLET and p["usdt_address"] is None and p["chain_id"] == 97
    assert "whitelisted" not in p
    await open_sale(client, admin_headers)
    assert await status() == "live"
    await client.put("/admin-api/config", headers=admin_headers, json={"presale_paused": True})
    assert await status() == "paused"
    await client.put("/admin-api/config", headers=admin_headers, json={"presale_paused": False})
    now = datetime.now(UTC)
    await client.put("/admin-api/config", headers=admin_headers,
                     json={"presale_start_at": iso(now + timedelta(hours=1)),
                           "presale_end_at": iso(now + timedelta(hours=2))})
    assert await status() == "upcoming"
    await client.put("/admin-api/config", headers=admin_headers,
                     json={"presale_start_at": iso(now - timedelta(hours=2)),
                           "presale_end_at": iso(now - timedelta(hours=1))})
    assert await status() == "ended"
    await open_sale(client, admin_headers, presale_hard_cap_usdt=100)
    await pay("0x" + "11" * 20, 100)
    assert await status() == "ended"  # hard cap reached
    await set_runtime(presale_wallet="")
    assert await status() == "upcoming"  # no presale wallet configured


async def test_estimate_close_credit_reopen(client, admin_headers):
    h, me = await login(client, 1, "alice")
    hb, _ = await login(client, 2, "bob")
    wa, wb = await link_wallet(client, h), await link_wallet(client, hb)
    stranger = "0x" + "99" * 20
    await open_sale(client, admin_headers)
    await pay(wa, 300)
    await pay(wa.lower(), 300)  # same wallet, any case: summed, capped at the 500 max
    await pay(wb, 50)
    await pay(stranger, 20)  # not linked to any user: still gets an allocation

    p = (await client.get("/api/presale", headers=h)).json()
    assert p["status"] == "live" and p["raised_wei"] == str(670 * E18)
    assert p["contributed_wei"] == str(600 * E18) and p["counted_wei"] == str(500 * E18)
    assert p["tokens_wei"] == str(50_000 * E18) and p["credited"] is False

    a = (await client.get("/admin-api/presale/allocations", headers=admin_headers)).json()
    assert a["closed"] is False and a["total_tokens_wei"] == str(57_000 * E18)
    assert [(i["wallet_address"].lower(), i["username"]) for i in a["items"]] == [
        (wa.lower(), "alice"), (wb.lower(), "bob"), (stranger, None)]

    # closing needs a writer; the snapshot freezes the allocation at the current price
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    assert (await client.post("/admin-api/presale/close", headers=viewer)).status_code == 403
    r = await client.post("/admin-api/presale/close", headers=admin_headers)
    assert r.status_code == 200 and r.json()["closed"] is True and len(r.json()["items"]) == 3
    assert (await client.post("/admin-api/presale/close", headers=admin_headers)).status_code == 409
    for body in ({"presale_tokens_per_usdt": "200"}, {"presale_paused": True}):
        assert (await client.put("/admin-api/config", headers=admin_headers, json=body)).status_code == 409
    await client.put("/admin-api/config", headers=admin_headers, json={"risk_threshold": 80})  # others still fine

    await pay(wa, 100)  # a late payment does not change the frozen allocation
    p = (await client.get("/api/presale", headers=h)).json()
    assert p["status"] == "closed" and p["tokens_wei"] == str(50_000 * E18)
    s = (await client.get("/admin-api/presale", headers=admin_headers)).json()
    assert s["status"] == "closed" and s["contributors"] == 3 and s["credited"] == 0
    assert s["tokens_wei"] == str(57_000 * E18) and s["closed_at"]

    # the indexer stops once closed
    await set_runtime(rpc_url="http://rpc.invalid", usdt_address="0x" + "55" * 20)

    async def boom(rt, from_block):
        raise AssertionError("indexer ran after close")

    chain_fetch = chain.fetch_presale_transfers
    chain.fetch_presale_transfers = boom
    try:
        async with SessionLocal() as session:
            assert await jobs.index_presale(session) == 0
    finally:
        chain.fetch_presale_transfers = chain_fetch

    # credit a batch
    tx = "0x" + "cd" * 32
    bad = {"tx_hash": "0x12", "wallet_addresses": [wa]}
    assert (await client.post("/admin-api/presale/credited", headers=admin_headers, json=bad)).status_code == 422
    r = await client.post("/admin-api/presale/credited", headers=admin_headers,
                          json={"tx_hash": tx, "wallet_addresses": [wa.lower(), wb]})
    assert r.json() == {"credited": 2}
    r = await client.post("/admin-api/presale/credited", headers=admin_headers,
                          json={"tx_hash": "0x" + "ef" * 32, "wallet_addresses": [wa, stranger]})
    assert r.json() == {"credited": 1}  # alice already credited, left alone
    p = (await client.get("/api/presale", headers=h)).json()
    assert p["credited"] is True and p["credited_tx"] == tx
    assert (await client.get("/admin-api/presale", headers=admin_headers)).json()["credited"] == 3

    # reopening is owner-only and refused once anything was credited
    staff = await admin_login(client, "staff@example.com", "admin")
    assert (await client.post("/admin-api/presale/reopen", headers=staff)).status_code == 403
    assert (await client.post("/admin-api/presale/reopen", headers=admin_headers)).status_code == 409
    log = [i["action"] for i in (await client.get("/admin-api/audit-log", headers=admin_headers)).json()["items"]]
    assert "presale.close" in log and log.count("presale.credited") == 2


async def test_reopen_and_close_needs_price(client, admin_headers):
    assert (await client.post("/admin-api/presale/close", headers=admin_headers)).status_code == 400
    await open_sale(client, admin_headers)
    await pay("0x" + "11" * 20, 100)
    await client.post("/admin-api/presale/close", headers=admin_headers)
    r = await client.post("/admin-api/presale/credited", headers=admin_headers,
                          json={"tx_hash": "0x" + "cd" * 32, "wallet_addresses": ["0x" + "22" * 20]})
    assert r.json() == {"credited": 0}
    assert (await client.post("/admin-api/presale/reopen", headers=admin_headers)).json() == {"ok": True}
    a = (await client.get("/admin-api/presale/allocations", headers=admin_headers)).json()
    assert a["closed"] is False and a["closed_at"] is None and len(a["items"]) == 1
    await client.put("/admin-api/config", headers=admin_headers, json={"presale_tokens_per_usdt": "200"})
    a = (await client.get("/admin-api/presale/allocations", headers=admin_headers)).json()
    assert a["items"][0]["tokens_wei"] == str(20_000 * E18)
    r = await client.post("/admin-api/presale/credited", headers=admin_headers,
                          json={"tx_hash": "0x" + "cd" * 32, "wallet_addresses": ["0x" + "11" * 20]})
    assert r.status_code == 409  # not closed


async def test_indexer_reads_transfers_into_presale_wallet(client, admin_headers, monkeypatch):
    h, me = await login(client, 1, "alice")
    wa = await link_wallet(client, h)
    async with SessionLocal() as session:
        assert await jobs.index_presale(session) == 0  # no RPC configured
    await set_runtime(rpc_url="http://rpc.invalid", presale_start_block="7")
    async with SessionLocal() as session:
        assert await jobs.index_presale(session) == 0  # testnet without a USDT address
    await set_runtime(usdt_address="0x" + "55" * 20)
    seen = []
    logs = [{"buyer": wa, "amount": 25 * E18, "tx_hash": "0x" + "aa" * 32, "log_index": 3, "block_number": 9}]

    async def fake_fetch(rt, from_block):
        seen.append((rt.usdt, rt.presale_wallet, from_block))
        return logs, 20

    monkeypatch.setattr(chain, "fetch_presale_transfers", fake_fetch)
    async with SessionLocal() as session:
        assert await jobs.index_presale(session) == 1
        assert await jobs.index_presale(session) == 1  # same log again is ignored by the unique key
    assert seen == [("0x" + "55" * 20, PRESALE_WALLET, 7), ("0x" + "55" * 20, PRESALE_WALLET, 21)]
    c = (await client.get("/admin-api/presale/contributions", headers=admin_headers)).json()
    assert c["raised_wei"] == str(25 * E18) and len(c["items"]) == 1 and c["items"][0]["user_id"] == me["id"]
    assert (await client.get("/admin-api/presale", headers=admin_headers)).json()["last_block"] == 20


def test_topic_address_pads_to_32_bytes():
    t = chain._topic_address("0x" + "AB" * 20)
    assert t == "0x" + "00" * 12 + "ab" * 20 and len(t) == 66


# ---------- progress bar and simulated contributions ----------

async def sim(usdt: int) -> None:
    """A simulated contribution, as the worker would store it."""
    from app.models import PresaleSimulated
    async with SessionLocal() as s:
        s.add(PresaleSimulated(wallet_address="0x" + "ee" * 20, amount_wei=usdt * E18, created_at=datetime.now(UTC)))
        await s.commit()


async def test_progress_target_and_reset_are_display_only(client, admin_headers):
    h, _ = await login(client, 1, "alice")
    wa = await link_wallet(client, h)
    await open_sale(client, admin_headers, presale_hard_cap_usdt=5000)
    await pay(wa, 300)
    await sim(200)

    p = (await client.get("/api/presale", headers=h)).json()
    assert p["progress_wei"] == str(500 * E18) and p["progress_target_wei"] == str(5000 * E18)  # target = cap
    assert p["progress_reset_at"] is None
    await client.put("/admin-api/config", headers=admin_headers, json={"presale_progress_target_usdt": 2000})
    p = (await client.get("/api/presale", headers=h)).json()
    assert p["progress_target_wei"] == str(2000 * E18)
    before = (p["raised_wei"], p["contributed_wei"], p["tokens_wei"])
    alloc_before = (await client.get("/admin-api/presale/allocations", headers=admin_headers)).json()

    viewer = await admin_login(client, "viewer@example.com", "viewer")
    assert (await client.post("/admin-api/presale/progress/reset", headers=viewer)).status_code == 403
    r = await client.post("/admin-api/presale/progress/reset", headers=admin_headers)
    assert r.status_code == 200 and r.json()["progress_wei"] == "0" and r.json()["progress_reset_at"]

    p = (await client.get("/api/presale", headers=h)).json()
    assert p["progress_wei"] == "0" and p["progress_target_wei"] == str(2000 * E18)
    assert (p["raised_wei"], p["contributed_wei"], p["tokens_wei"]) == before  # money untouched
    assert (await client.get("/admin-api/presale/allocations", headers=admin_headers)).json() == alloc_before
    c = (await client.get("/admin-api/presale/contributions", headers=admin_headers)).json()
    assert c["raised_wei"] == str(300 * E18) and len(c["items"]) == 1

    await pay(wa, 50)
    await sim(25)
    p = (await client.get("/api/presale", headers=h)).json()
    assert p["progress_wei"] == str(75 * E18) and p["raised_wei"] == str(350 * E18)
    s = (await client.get("/admin-api/presale", headers=admin_headers)).json()
    assert s["progress_wei"] == str(75 * E18) and s["simulated_wei"] == str(225 * E18) and s["sim_running"] is False
    log = [i["action"] for i in (await client.get("/admin-api/audit-log", headers=admin_headers)).json()["items"]]
    assert "presale.progress_reset" in log

    # the reset marker is not writable through config
    for key in ("presale_progress_after_id", "presale_progress_after_sim_id", "presale_progress_reset_at"):
        r = await client.put("/admin-api/config", headers=admin_headers, json={key: 0 if "id" in key else ""})
        assert r.status_code == 400, key


async def test_simulated_never_counts_as_money(client, admin_headers):
    h, _ = await login(client, 1, "alice")
    wa = await link_wallet(client, h)
    await open_sale(client, admin_headers, presale_hard_cap_usdt=1000)
    await pay(wa, 100)
    await sim(5000)  # far over the hard cap
    p = (await client.get("/api/presale", headers=h)).json()
    assert p["status"] == "live" and p["raised_wei"] == str(100 * E18)
    assert p["progress_wei"] == str(5100 * E18)
    s = (await client.get("/admin-api/presale", headers=admin_headers)).json()
    assert s["raised_wei"] == str(100 * E18) and s["contributors"] == 1
    r = (await client.post("/admin-api/presale/close", headers=admin_headers)).json()
    assert len(r["items"]) == 1 and r["total_usdt_wei"] == str(100 * E18)
    stats = (await client.get("/admin-api/stats", headers=admin_headers)).json()
    assert stats["presale"]["raised_wei"] == str(100 * E18)


async def test_sim_settings_validation_and_editable_after_close(client, admin_headers):
    for body in ({"presale_sim_min_usdt": 600, "presale_sim_max_usdt": 500},
                 {"presale_sim_min_seconds": 0},
                 {"presale_sim_min_seconds": 700, "presale_sim_max_seconds": 600},
                 {"presale_sim_running": "yes"}):
        assert (await client.put("/admin-api/config", headers=admin_headers, json=body)).status_code == 400, body
    await open_sale(client, admin_headers)
    await pay("0x" + "11" * 20, 10)
    await client.post("/admin-api/presale/close", headers=admin_headers)
    # terms are locked, but the simulation and the progress target can still be changed
    assert (await client.put("/admin-api/config", headers=admin_headers,
                             json={"presale_max_usdt": 100})).status_code == 409
    r = await client.put("/admin-api/config", headers=admin_headers,
                         json={"presale_sim_running": True, "presale_progress_target_usdt": 10})
    assert r.status_code == 200 and r.json()["presale_sim_running"] is True


async def test_simulation_job(client, admin_headers, monkeypatch):
    import time

    from app.redis_client import redis

    async def run() -> int:
        async with SessionLocal() as session:
            return await jobs.simulate_presale(session)

    assert await run() == 0 and await redis.get(jobs.SIM_NEXT_KEY) is None  # stopped: nothing scheduled
    await client.put("/admin-api/config", headers=admin_headers, json={
        "presale_sim_running": True, "presale_sim_min_usdt": 20, "presale_sim_max_usdt": 30,
        "presale_sim_min_seconds": 10, "presale_sim_max_seconds": 20})
    t0 = time.time()
    assert await run() == 0  # first run only schedules the first event
    due = float(await redis.get(jobs.SIM_NEXT_KEY))
    assert t0 + 10 <= due <= time.time() + 20
    assert await run() == 0  # not due yet

    await redis.set(jobs.SIM_NEXT_KEY, time.time() - 1)
    assert await run() == 1
    nxt = float(await redis.get(jobs.SIM_NEXT_KEY))
    assert time.time() + 9 <= nxt <= time.time() + 21  # next wait is random within the range
    lst = (await client.get("/admin-api/presale/simulated", headers=admin_headers)).json()
    assert lst["running"] is True and lst["count"] == 1 and lst["next_at"]
    item = lst["items"][0]
    assert 20 * E18 <= int(item["amount_wei"]) <= 30 * E18 and int(item["amount_wei"]) % (E18 // 100) == 0
    assert item["wallet_address"].startswith("0x") and len(item["wallet_address"]) == 42
    assert item["wallet_address"] != item["wallet_address"].lower()  # checksummed

    # many events: every amount stays within the range
    for _ in range(30):
        await redis.set(jobs.SIM_NEXT_KEY, time.time() - 1)
        await run()
    amounts = [int(i["amount_wei"]) for i in
               (await client.get("/admin-api/presale/simulated", headers=admin_headers)).json()["items"]]
    assert len(amounts) == 31 and all(20 * E18 <= a <= 30 * E18 for a in amounts) and len(set(amounts)) > 1

    # the cap stops new events
    await client.put("/admin-api/config", headers=admin_headers, json={"presale_sim_cap_usdt": 100})
    await redis.set(jobs.SIM_NEXT_KEY, time.time() - 1)
    assert await run() == 0
    assert (await client.get("/admin-api/presale/simulated", headers=admin_headers)).json()["count"] == 31

    # stopping clears the schedule; the list says not running
    await client.put("/admin-api/config", headers=admin_headers, json={"presale_sim_running": False})
    assert await run() == 0 and await redis.get(jobs.SIM_NEXT_KEY) is None
    lst = (await client.get("/admin-api/presale/simulated", headers=admin_headers)).json()
    assert lst["running"] is False and lst["next_at"] is None

    # clearing deletes simulated events only (writer only)
    viewer = await admin_login(client, "viewer@example.com", "viewer")
    assert (await client.delete("/admin-api/presale/simulated", headers=viewer)).status_code == 403
    assert (await client.delete("/admin-api/presale/simulated", headers=admin_headers)).json() == {"deleted": 31}
    assert (await client.get("/admin-api/presale/simulated", headers=admin_headers)).json()["count"] == 0


async def test_activity_merges_real_and_simulated(client, admin_headers):
    h, _ = await login(client, 1, "alice")
    wa = await link_wallet(client, h)
    assert (await client.get("/api/presale/activity", headers=h)).json() == {"items": []}
    await pay(wa, 100)
    await sim(40)
    await pay(wa, 7)
    items = (await client.get("/api/presale/activity", headers=h)).json()["items"]
    assert [(i["amount_wei"], i["simulated"]) for i in items] == [
        (str(7 * E18), False), (str(40 * E18), True), (str(100 * E18), False)]
    assert items[0]["tx_hash"].startswith("0x") and items[1]["tx_hash"] is None
    assert items[0]["wallet_address"] == wa and items[0]["at"].endswith("Z")
    for _ in range(25):
        await sim(1)
    assert len((await client.get("/api/presale/activity", headers=h)).json()["items"]) == 20
    assert (await client.get("/api/presale/activity")).status_code == 401
