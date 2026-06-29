import os

from fastapi import FastAPI

from modules.chat.chat_router import router as chat_router
from modules.embeddings.embeddings_router import router as embeddings_router
from modules.convert.convert_router import router as convert_router
from modules.scrape.scrape_router import router as scrape_router

app = FastAPI(title="Scout Model Service")


@app.get("/health")
def health():
    return {"status": "ok", "service": "model-service"}


@app.get("/health/model")
def health_model():
    try:
        from langchain_nvidia_ai_endpoints import ChatNVIDIA

        model = os.environ.get("NVIDIA_CODER_MODEL", "meta/llama-3.3-70b-instruct")
        ChatNVIDIA(model=model)

        return {
            "status": "ok",
            "provider": "nvidia",
            "model": model,
        }
    except Exception as exc:
        return {
            "status": "error",
            "provider": "nvidia",
            "error": repr(exc),
        }


app.include_router(chat_router)
app.include_router(embeddings_router)
app.include_router(convert_router)
app.include_router(scrape_router)
