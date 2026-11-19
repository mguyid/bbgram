from functools import cached_property
from urllib.parse import quote

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://babygrand:change-me@localhost:5432/babygrand"
    # When POSTGRES_PASSWORD is set, DATABASE_URL is built from these parts (password URL-encoded, so any
    # characters are safe). Used by docker-compose; DATABASE_URL stays for local runs and tests.
    POSTGRES_HOST: str = "postgres"
    POSTGRES_USER: str = "babygrand"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = "babygrand"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET: str = "change-me-long-random"
    DEV_MODE: bool = False

    API_PUBLIC_URL: str = "http://localhost:8000"
    MINIAPP_URL: str = "http://localhost:3000"
    ADMIN_URL: str = "http://localhost:3001"
    # Extra origins only; the mini app and admin URLs are always allowed.
    CORS_ORIGINS: str = ""

    @model_validator(mode="after")
    def _build_database_url(self) -> "Settings":
        if self.POSTGRES_PASSWORD:
            self.DATABASE_URL = (
                f"postgresql+asyncpg://{quote(self.POSTGRES_USER, safe='')}:{quote(self.POSTGRES_PASSWORD, safe='')}"
                f"@{self.POSTGRES_HOST}:5432/{quote(self.POSTGRES_DB, safe='')}"
            )
        return self

    @cached_property
    def cors_origins(self) -> list[str]:
        origins = [self.MINIAPP_URL, self.ADMIN_URL, *self.CORS_ORIGINS.split(",")]
        return list(dict.fromkeys(o.strip().rstrip("/") for o in origins if o.strip()))


settings = Settings()
