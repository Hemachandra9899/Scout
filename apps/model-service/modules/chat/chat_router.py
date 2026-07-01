from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from modules.chat.chat_schema import ChatRequest
from modules.chat.chat_service import (
    chat_response,
    list_available_models,
    stream_chat_response,
)

router = APIRouter()


@router.get("/models")
def list_models():
    return list_available_models()


@router.post("/chat")
def chat(req: ChatRequest):
    return chat_response(req)


@router.post("/chat/stream")
def chat_stream(req: ChatRequest):
    return StreamingResponse(
        stream_chat_response(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive"},
    )
