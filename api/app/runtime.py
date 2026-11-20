"""Runtime settings stored in the database (interfaces.md section 2a).

Values are strings; secrets are Fernet-encrypted with a key derived from JWT_SECRET via HKDF.
Reads go through a small in-process cache (30 s TTL, invalidated locally on write).
"""

import base64
import time
from dataclasses import dataclass

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import RuntimeSetting
from app.settings import settings

SECRET_KEYS = {"telegram_bot_token", "x_client_secret", "telegram_webhook_secret"}
KEYS = SECRET_KEYS | {
    "telegram_bot_username", "telegram_webhook_ok", "x_client_id", "chain_id", "rpc_url", "usdt_address",
    "token_address", "presale_wallet", "presale_start_block", "airdrop_address", "multisend_address",
}
CACHE_TTL = 30
DEFAULT_CHAIN_ID = 97
BSC_USDT = "0x55d398326f99059fF775485246999027B3197955"

_fernet = Fernet(base64.urlsafe_b64encode(
    HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"babygrand-runtime-settings")
    .derive(settings.JWT_SECRET.encode())
))


@dataclass(frozen=True)
class Runtime:
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_webhook_secret: str = ""
    telegram_webhook_ok: str = ""
    x_client_id: str = ""
    x_client_secret: str = ""
    chain_id: str = ""
    rpc_url: str = ""
    usdt_address: str = ""
    token_address: str = ""
    presale_wallet: str = ""
    presale_start_block: str = ""
    airdrop_address: str = ""
    multisend_address: str = ""

    @property
    def chain_id_int(self) -> int:
        return int(self.chain_id) if self.chain_id else DEFAULT_CHAIN_ID

    @property
    def start_block_int(self) -> int:
        return int(self.presale_start_block) if self.presale_start_block else 0

    @property
    def usdt(self) -> str:
        """USDT contract buyers pay with: the setting, else official BSC USDT on chain 56."""
        if self.usdt_address:
            return self.usdt_address
        return BSC_USDT if self.chain_id_int == 56 else ""


def x_redirect_uri() -> str:
    return settings.API_PUBLIC_URL.rstrip("/") + "/x/callback"


def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet.decrypt(value.encode()).decode()


_cache: tuple[float, Runtime] | None = None


def invalidate() -> None:
    global _cache
    _cache = None


async def get() -> Runtime:
    global _cache
    if _cache and time.monotonic() - _cache[0] < CACHE_TTL:
        return _cache[1]
    async with SessionLocal() as session:
        rows = (await session.execute(select(RuntimeSetting))).scalars().all()
    values = {r.key: decrypt(r.value) if r.key in SECRET_KEYS and r.value else r.value
              for r in rows if r.key in KEYS}
    rt = Runtime(**values)
    _cache = (time.monotonic(), rt)
    return rt


async def save(session: AsyncSession, values: dict[str, str]) -> None:
    """Upsert values (strings; "" clears). Caller commits, then calls invalidate()."""
    for key, value in values.items():
        if key not in KEYS:
            raise ValueError(f"Unknown setting: {key}")
        stored = encrypt(value) if key in SECRET_KEYS and value else value
        stmt = insert(RuntimeSetting).values(key=key, value=stored)
        await session.execute(stmt.on_conflict_do_update(index_elements=[RuntimeSetting.key],
                                                         set_={"value": stored}))
