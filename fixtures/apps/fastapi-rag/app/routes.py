import logging

from fastapi import APIRouter, Request

from app.rag import answer

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health():
    logger.info("health check")
    return {"ok": True}


@router.post("/ask")
async def ask(payload: dict, request: Request):
    logger.info("ask request %s", payload)
    return {"answer": answer(payload["question"], payload.get("context", ""))}
