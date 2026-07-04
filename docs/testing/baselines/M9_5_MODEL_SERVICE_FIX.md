# M9.5 — Model Service NVIDIA Dependency Fix

## Environment (host)

| Component | Version |
|-----------|---------|
| Python | 3.13.5 |
| pydantic | 2.13.4 |
| langchain | 0.3.30 |
| langchain-core | 0.3.86 |
| langchain-nvidia-ai-endpoints | 0.3.19 |

## Blocker

`requirements.txt` pinned the **1.x** version line (`langchain-core==1.4.8`, `langchain-nvidia-ai-endpoints==1.4.2`) while the ecosystem had moved to the **0.3.x** line. This caused:

- `pydantic.model_rebuild()` / pydantic compatibility errors at import time in Docker builds
- Docker image builds failing or producing non-functional containers
- Blocked manual sandbox and agent executor E2E tests

## Fix

Updated `apps/model-service/requirements.txt` to use the **0.3.x** LangChain stack:

| Package | Old | New |
|---------|-----|-----|
| langchain-core | `==1.4.8` | `==0.3.86` |
| langchain-nvidia-ai-endpoints | `==1.4.2` | `==0.3.19` |
| pydantic | `==2.13.4` | `==2.13.4` (unchanged) |
| pydantic-settings | `==2.14.0` | `==2.14.2` |

## Verification

- `python apps/model-service/scripts/check_nvidia_chat.py` — import & construct ok
- `python -c "from app.main import app"` — FastAPI app imports cleanly
- `docker compose build model-service` — builds successfully
- `curl localhost:8100/health` — returns `{"status":"ok","service":"model-service"}`
- `curl localhost:8100/health/model` — returns `{"status":"ok","provider":"nvidia","model":"z-ai/glm-5.1"}`
- `AGENT_EXECUTOR_ENABLED=true` agent executor case passes end-to-end
- Normal gates (eval:ci, phase2, phase3, routing-intent) remain at 100%
