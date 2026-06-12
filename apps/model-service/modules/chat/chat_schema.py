from typing import Dict, List, Literal, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    mode: Literal["reasoning", "coding", "fast_intent"] = "reasoning"
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
