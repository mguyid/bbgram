from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://babygrand:change-me@localhost:5432/babygrand"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET: str = "change-me-long-random"
    DEV_MODE: bool = False

    API_PUBLIC_URL: str = "http://localhost:8000"
    MINIAPP_URL: str = "http://localhost:3000"
    ADMIN_URL: str = "http://localhost:3001"
    CORS_ORIGINS: str = ""

    @cached_property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
