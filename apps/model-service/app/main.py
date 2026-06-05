from fastapi import FastAPI

from modules.chat.chat_router import router as chat_router

app = FastAPI(title="RLM Forge Model Service")

app.include_router(chat_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "model-service"}
