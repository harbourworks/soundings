import asyncpg
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url)


async def connect():
    return await asyncpg.create_pool(settings.database_url)
