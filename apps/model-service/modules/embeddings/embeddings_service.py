import os
from typing import List

from fastapi import HTTPException
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings

from modules.embeddings.embeddings_schema import EmbedRequest


DEFAULT_EMBEDDING_MODEL = "nvidia/nv-embedqa-e5-v5"
MAX_TEXT_CHARS = int(os.getenv("MAX_EMBED_TEXT_CHARS", "6000"))
EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "8"))


def _clean_text(text: str) -> str:
    text = (text or "").strip()
    if len(text) > MAX_TEXT_CHARS:
        return text[:MAX_TEXT_CHARS]
    return text


def _batch(items: List[str], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def embed_texts(req: EmbedRequest) -> dict:
    model = os.getenv("NVIDIA_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
    api_key = os.getenv("NVIDIA_API_KEY")

    if not req.texts:
        return {
            "model": model,
            "vectors": [],
            "dim": 0,
        }

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="NVIDIA_API_KEY is missing in model-service environment.",
        )

    texts = [_clean_text(text) for text in req.texts]
    texts = [text for text in texts if text]

    if not texts:
        return {
            "model": model,
            "vectors": [],
            "dim": 0,
        }

    try:
        client = NVIDIAEmbeddings(
            model=model,
            api_key=api_key,
        )

        vectors = []
        for group in _batch(texts, EMBED_BATCH_SIZE):
            vectors.extend(client.embed_documents(group))

        dim = len(vectors[0]) if vectors else 0

        return {
            "model": model,
            "vectors": vectors,
            "dim": dim,
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "NVIDIA embedding request failed.",
                "model": model,
                "textCount": len(texts),
                "batchSize": EMBED_BATCH_SIZE,
                "maxTextChars": MAX_TEXT_CHARS,
                "error": str(exc),
            },
        )
