import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import admin, miniapp, public
from app.settings import settings

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Baby Grand API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(miniapp.router)
app.include_router(public.router)
app.include_router(admin.router)
