"""Manual database backup (export) and restore (import)."""

import gzip
import json
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import delete, select

from app import backup, jobs, runtime
from app.db import SessionLocal
from app.models import (
    AdminAuditLog,
    Airdrop,
    AirdropProof,
    Ban,
    PointEvent,
    PresaleAllocation,
    PresaleContribution,
    Referral,
    RiskScore,
    ScreenView,
    Snapshot,
    SnapshotBalance,
    Spin,
    User,
    UserDevice,
    Wallet,
    XAccount,
    XPost,
)
from app.redis_client import redis
from tests.conftest import admin_login, set_runtime

WALLET = "0x" + "12" * 20
BIG = Decimal("123456789012345678901234567890123456789")


async def populate() -> None:
    t = datetime(2026, 3, 4, 5, 6, 7, 891011, tzinfo=UTC)
    async with SessionLocal() as s:
        a = User(telegram_id=9_000_000_001, username="alice", first_name="Alice ✨", referral_code="ALICE",
                 x_bio_marked=True, x_bio_marked_at=t, created_at=t)
        s.add(a)
        await s.flush()
        b = User(telegram_id=2, username="bob", referral_code="BOB", referred_by_id=a.id, banned=True)
        s.add(b)
        await s.flush()
        s.add_all([
            Referral(referrer_id=a.id, referred_id=b.id, status="credited", points=50, credited_at=t),
            PointEvent(user_id=a.id, type="spin", amount=10, ref_id="r1", note="first", created_at=t),
            PointEvent(user_id=a.id, type="task", amount=-3, ref_id="r2"),
            PointEvent(user_id=b.id, type="spin", amount=7, ref_id="r3"),
            Spin(user_id=a.id, points=10, created_at=t),
            UserDevice(user_id=a.id, ip="1.2.3.4", device_hash="h", user_agent="ua", platform="ios"),
            ScreenView(user_id=a.id, screen="home", views=3),
            RiskScore(user_id=b.id, score=40, reasons=["shared_ip", "new"]),
            Ban(user_id=b.id, reason="sybil", admin_id=1),
            XAccount(user_id=a.id, x_user_id="42", username="alice_x"),
            XPost(user_id=a.id, url="https://x.com/a/status/1", status_id="1"),
            Wallet(user_id=a.id, address=WALLET),
            PresaleAllocation(wallet_address=WALLET, user_id=a.id, contributed_wei=BIG, counted_wei=BIG,
                              tokens_wei=BIG * 100, credited_tx="0x" + "bb" * 32, created_at=t),
            PresaleContribution(wallet_address=WALLET, user_id=a.id, amount_wei=BIG, total_wei=BIG + 1,
                                tx_hash="0x" + "aa" * 32, log_index=3, block_number=12_345_678_901),
            AdminAuditLog(admin_id=1, admin_email="owner@example.com", action="test", target="x",
                          details={"nested": {"list": [1, 2.5, None, "s"]}, "ok": True}),
        ])
        snap = Snapshot(created_by=1, created_at=t)
        s.add(snap)
        await s.flush()
        s.add(SnapshotBalance(snapshot_id=snap.id, user_id=a.id, wallet_address=WALLET, points=7))
        drop = Airdrop(snapshot_id=snap.id, merkle_root="0x" + "bb" * 32, total_amount_wei=BIG, recipients=1,
                       params={"pool": str(BIG), "min": 1})
        s.add(drop)
        await s.flush()
        s.add(AirdropProof(airdrop_id=drop.id, user_id=a.id, wallet_address=WALLET, amount_wei=BIG,
                           proof=["0x" + "cc" * 32]))
        await s.commit()


async def dump() -> dict[str, list[dict]]:
    async with SessionLocal() as s:
        out = {}
        for t in backup.tables():
            rows = await s.execute(select(t).order_by(*t.primary_key.columns))
            out[t.name] = [dict(r._mapping) for r in rows]
        return out


async def do_import(client, headers, content: bytes, confirm: str = "RESTORE"):
    return await client.post("/admin-api/backup/import", headers=headers, data={"confirm": confirm},
                             files={"file": ("backup.jsonl.gz", content, "application/gzip")})


def lines_of(content: bytes) -> list[dict]:
    return [json.loads(x) for x in gzip.decompress(content).decode().splitlines()]


def pack(lines: list[dict]) -> bytes:
    return gzip.compress("".join(json.dumps(x) + "\n" for x in lines).encode())


async def export(client, headers) -> bytes:
    r = await client.get("/admin-api/backup/export", headers=headers)
    assert r.status_code == 200, r.text
    cd = r.headers["content-disposition"]
    assert cd.startswith('attachment; filename="babygrand-backup-') and cd.endswith('.jsonl.gz"')
    return r.content


async def test_export_import_round_trip(client, admin_headers):
    await populate()
    content = await export(client, admin_headers)
    original = await dump()

    lines = lines_of(content)
    header = lines[0]
    assert header["format"] == "babygrand-backup" and header["version"] == 1 and header["alembic_revision"]
    assert header["tables"] == [t.name for t in backup.tables()] and "alembic_version" not in header["tables"]
    assert {x["t"] for x in lines[1:]} == {name for name, rows in original.items() if rows}
    assert [x for x in original["admin_audit_log"] if x["action"] == "backup.export"]  # logged before streaming
    assert original["runtime_settings"] and original["config"] and original["airdrops"][0]["total_amount_wei"] == BIG

    # mutate: add and delete rows, change a setting
    async with SessionLocal() as s:
        s.add(User(telegram_id=3, referral_code="CAROL"))
        await s.execute(delete(PointEvent).where(PointEvent.ref_id == "r1"))
        await s.execute(delete(Wallet))
        await s.commit()
    await set_runtime(x_client_secret="changed-secret")
    assert (await runtime.get()).x_client_secret == "changed-secret"
    await redis.set(jobs.INDEXER_KEY, 999)

    r = await do_import(client, admin_headers, content)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["created_at"] == header["created_at"]
    assert body["tables"] == {name: len(rows) for name, rows in original.items()}

    after = await dump()
    for name, rows in original.items():
        if name == "admin_audit_log":
            assert after[name][:len(rows)] == rows
            last = after[name][len(rows):]
            assert len(last) == 1 and last[0]["action"] == "backup.import"
            assert last[0]["details"]["tables"] == body["tables"] and last[0]["admin_email"] == "owner@example.com"
            assert last[0]["id"] == rows[-1]["id"] + 1  # sequence continues
        else:
            assert after[name] == rows, name

    assert (await runtime.get()).x_client_secret == ""  # cache cleared, restored (unset) value read
    assert await redis.get(jobs.INDEXER_KEY) is None

    # sequences continue after max(id)
    async with SessionLocal() as s:
        u = User(telegram_id=4, referral_code="DAVE")
        s.add(u)
        await s.flush()
        pe = PointEvent(user_id=u.id, type="spin", amount=1, ref_id="new")
        s.add(pe)
        await s.commit()
    assert u.id == max(x["id"] for x in original["users"]) + 1
    assert pe.id == max(x["id"] for x in original["point_events"]) + 1

    # restored admin can still sign in with the restored token
    assert (await client.get("/admin-api/me", headers=admin_headers)).status_code == 200


async def test_import_rejects_wrong_confirm_and_bad_files(client, admin_headers):
    await populate()
    content = await export(client, admin_headers)
    before = await dump()

    r = await do_import(client, admin_headers, content, confirm="restore")
    assert r.status_code == 400 and "RESTORE" in r.json()["detail"]

    lines = lines_of(content)
    other = [{**lines[0], "alembic_revision": "0000_other"}, *lines[1:]]
    r = await do_import(client, admin_headers, pack(other))
    assert r.status_code == 400
    assert r.json()["detail"].startswith("This backup is from a different app version (")
    assert "Restore it on a matching version." in r.json()["detail"]

    r = await do_import(client, admin_headers, pack([{**lines[0], "format": "other"}, *lines[1:]]))
    assert r.status_code == 400

    r = await do_import(client, admin_headers, b"not a gzip file")
    assert r.status_code == 400

    # corrupt row mid-file: earlier rows insert fine, then the whole restore rolls back
    idx = next(i for i, x in enumerate(lines) if x.get("t") == "point_events")
    bad = [*lines[:idx], {"t": "point_events", "r": {**lines[idx]["r"], "created_at": "not-a-date"}}, *lines[idx:]]
    r = await do_import(client, admin_headers, pack(bad))
    assert r.status_code == 400 and "point_events" in r.json()["detail"], r.text

    # constraint violation (duplicate primary key) also rolls back
    dup = [*lines, lines[1]]
    r = await do_import(client, admin_headers, pack(dup))
    assert r.status_code == 400 and lines[1]["t"] in r.json()["detail"], r.text

    assert await dump() == before


async def test_backup_owner_only(client, admin_headers):
    content = await export(client, admin_headers)
    for role in ("admin", "viewer"):
        headers = await admin_login(client, f"{role}@example.com", role)
        assert (await client.get("/admin-api/backup/export", headers=headers)).status_code == 403
        assert (await do_import(client, headers, content)).status_code == 403
    assert (await client.get("/admin-api/backup/export")).status_code == 401
