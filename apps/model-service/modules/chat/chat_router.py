from fastapi import APIRouter

from modules.chat.chat_schema import ChatRequest
from modules.chat.chat_service import chat_response, list_available_models

router = APIRouter()


@router.get("/models")
def list_models():
    return list_available_models()


@router.post("/chat")
def chat(req: ChatRequest):
    return chat_response(req)
