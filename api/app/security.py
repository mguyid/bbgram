import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from app.settings import settings

USER_TOKEN_TTL = 12 * 3600
ADMIN_TOKEN_TTL = 12 * 3600
INIT_DATA_MAX_AGE = 24 * 3600

_ph = PasswordHasher()


class InitDataError(ValueError):
    pass


@dataclass
class TelegramUser:
    id: int
    username: str | None = None
    first_name: str | None = None
    photo_url: str | None = None
    language_code: str | None = None
    start_param: str | None = None


def validate_init_data(init_data: str, bot_token: str, now: float | None = None) -> TelegramUser:
    """Validate Telegram WebApp initData per https://core.telegram.org/bots/webapps."""
    if settings.DEV_MODE and init_data.startswith("dev:"):
        parts = init_data.split(":", 2)
        if len(parts) != 3 or not parts[1].isdigit():
            raise InitDataError("Invalid dev init data")
        return TelegramUser(id=int(parts[1]), username=parts[2] or None, first_name=parts[2] or None,
                            photo_url=f"https://t.me/i/userpic/320/{parts[2]}.jpg" if parts[2] else None)

    if not bot_token:
        raise InitDataError("Bot token not configured")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise InitDataError("Missing hash")
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("Invalid init data signature")
    auth_date = int(pairs.get("auth_date", "0") or 0)
    if (now or time.time()) - auth_date > INIT_DATA_MAX_AGE:
        raise InitDataError("Init data expired")
    try:
        u = json.loads(pairs["user"])
        return TelegramUser(
            id=int(u["id"]),
            username=u.get("username"),
            first_name=u.get("first_name"),
            photo_url=u.get("photo_url"),
            language_code=u.get("language_code"),
            start_param=pairs.get("start_param"),
        )
    except (KeyError, ValueError, TypeError) as e:
        raise InitDataError("Invalid user in init data") from e


def make_token(sub: int, typ: str, ttl: int) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(sub), "typ": typ, "iat": now, "exp": now + ttl}, settings.JWT_SECRET,
                      algorithm="HS256")


def read_token(token: str, typ: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != typ:
        return None
    return int(payload["sub"])


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerificationError:
        return False


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Baby Grand Admin")


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(str(code).strip(), valid_window=1)
