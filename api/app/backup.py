"""Manual database backup (export) and restore (import).

File format: gzip of JSON Lines. Line 1 is a header, then one line per row:
{"t": <table>, "r": {<column>: <value>}}, tables parents first (Base.metadata.sorted_tables).
"""

import base64
import gzip
import json
import zlib
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import IO, Any

from sqlalchemy import JSON, Date, DateTime, Float, LargeBinary, Numeric, Table, Time, func, select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from app import models  # noqa: F401 - registers every table on Base.metadata
from app.db import Base, engine

FORMAT = "babygrand-backup"
VERSION = 1
BATCH = 1000


class RestoreError(Exception):
    pass


def tables() -> list[Table]:
    return list(Base.metadata.sorted_tables)


async def db_revision(conn: AsyncConnection) -> str | None:
    return (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()


def encode(value: Any) -> Any:
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return base64.b64encode(value).decode()
    return value


def decoder(column_type: Any):
    if isinstance(column_type, JSON):
        return lambda v: v
    if isinstance(column_type, DateTime):
        return datetime.fromisoformat
    if isinstance(column_type, Date):
        return date.fromisoformat
    if isinstance(column_type, Time):
        return time.fromisoformat
    if isinstance(column_type, Numeric) and not isinstance(column_type, Float):
        return lambda v: Decimal(str(v))
    if isinstance(column_type, LargeBinary):
        return base64.b64decode
    return lambda v: v


def _line(obj: dict) -> bytes:
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


async def export_stream(created_at: datetime) -> AsyncIterator[bytes]:
    """Yield the gzip-compressed backup, reading every table in one consistent snapshot."""
    gz = zlib.compressobj(wbits=31)  # gzip container
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="REPEATABLE READ")
        header = {"format": FORMAT, "version": VERSION, "alembic_revision": await db_revision(conn),
                  "created_at": created_at.isoformat(), "tables": [t.name for t in tables()]}
        yield gz.compress(_line(header))
        for table in tables():
            stmt = select(table).order_by(*table.primary_key.columns).execution_options(yield_per=BATCH)
            result = await conn.stream(stmt)
            async for rows in result.partitions():
                chunk = b"".join(
                    _line({"t": table.name, "r": {k: encode(v) for k, v in row._mapping.items()}}) for row in rows
                )
                out = gz.compress(chunk)
                if out:
                    yield out
    yield gz.flush()


def read_header(fileobj: IO[bytes]) -> dict:
    try:
        with gzip.open(fileobj, "rt", encoding="utf-8") as f:
            header = json.loads(f.readline())
    except Exception as e:  # noqa: BLE001 - not gzip, not JSON, empty file
        raise RestoreError("This file is not a Baby Grand backup.") from e
    if not isinstance(header, dict) or header.get("format") != FORMAT:
        raise RestoreError("This file is not a Baby Grand backup.")
    if header.get("version") != VERSION:
        raise RestoreError(f"Unsupported backup version {header.get('version')!r}.")
    return header


async def restore(fileobj: IO[bytes]) -> tuple[dict, dict[str, int]]:
    """Replace every application table with the backup's rows, in one transaction.

    Returns (header, row counts per table). Raises RestoreError with a plain message; nothing changes then.
    """
    fileobj.seek(0)
    header = read_header(fileobj)
    fileobj.seek(0)
    by_name = {t.name: t for t in tables()}
    decoders = {t.name: {c.name: decoder(c.type) for c in t.columns} for t in tables()}
    counts = dict.fromkeys(by_name, 0)
    current = "(header)"

    async with engine.connect() as conn:
        revision = await db_revision(conn)
        if header.get("alembic_revision") != revision:
            raise RestoreError(
                f"This backup is from a different app version (backup {header.get('alembic_revision')}, "
                f"server {revision}). Restore it on a matching version."
            )
        await conn.rollback()
        try:
            async with conn.begin():
                names = ", ".join(f'"{n}"' for n in by_name)
                await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
                batch: list[dict] = []
                with gzip.open(fileobj, "rt", encoding="utf-8") as f:
                    f.readline()  # header
                    for line in f:
                        if not line.strip():
                            continue
                        item = json.loads(line)
                        name = item["t"]
                        if name not in by_name:
                            raise ValueError(f"unknown table {name!r}")
                        if name != current and batch:
                            await conn.execute(by_name[current].insert(), batch)
                            batch = []
                        current = name
                        cols = decoders[name]
                        row = {}
                        for k, v in item["r"].items():
                            if k not in cols:
                                raise ValueError(f"unknown column {k!r}")
                            row[k] = None if v is None else cols[k](v)
                        batch.append(row)
                        counts[name] += 1
                        if len(batch) >= BATCH:
                            await conn.execute(by_name[name].insert(), batch)
                            batch = []
                if batch:
                    await conn.execute(by_name[current].insert(), batch)
                current = "(sequences)"
                for table in tables():
                    col = table.autoincrement_column
                    if col is None:
                        continue
                    seq = (await conn.execute(select(func.pg_get_serial_sequence(table.name, col.name)))).scalar()
                    if seq:
                        await conn.execute(select(func.setval(
                            seq, func.coalesce(select(func.max(col)).scalar_subquery(), 1),
                            select(func.max(col)).scalar_subquery().is_not(None),
                        )))
        except Exception as e:  # noqa: BLE001 - any failure rolls the whole restore back
            reason = str(e).strip().splitlines()[0][:300] if str(e).strip() else type(e).__name__
            raise RestoreError(f"Restore failed at table {current}: {reason}. Nothing was changed.") from e
    return header, counts


def backup_filename(now: datetime) -> str:
    return f"babygrand-backup-{now.astimezone(UTC):%Y%m%d-%H%M%S}.jsonl.gz"
