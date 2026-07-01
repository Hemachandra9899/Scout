#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PIDS=()

cleanup() {
  echo ""
  echo "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "All services stopped."
}
trap cleanup EXIT INT TERM

log() {
  local prefix="$1"
  shift
  echo "[$prefix] $*"
}

wait_for_port() {
  local port=$1
  local name=$2
  local max=30
  local i=0
  while ! lsof -ti :"$port" -sTCP:LISTEN &>/dev/null; do
    if [ $i -ge $max ]; then
      log "$name" "TIMEOUT waiting on port $port"
      return 1
    fi
    i=$((i + 1))
    sleep 1
  done
  log "$name" "ready on port $port"
}

run_bg() {
  local name="$1"
  shift
  log "$name" "starting..."
  "$@" &>"/tmp/rlm-$name.log" &
  local pid=$!
  PIDS+=("$pid")
  log "$name" "pid=$pid"
}

export $(grep -v '^#' .env | xargs)
export API_URL="http://localhost:8000"

log "ROOT" "Starting Scout..."

# Redis
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^rlm-forge-redis$'; then
  log "redis" "already running"
else
  run_bg "redis" docker run --rm --name rlm-forge-redis -p 6379:6379 redis:7
fi
wait_for_port 6379 redis

# Qdrant
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^rlm-forge-qdrant$'; then
  log "qdrant" "already running"
else
  run_bg "qdrant" docker run --rm --name rlm-forge-qdrant -p 6333:6333 -p 6334:6334 -v /tmp/qdrant_storage:/qdrant/storage qdrant/qdrant:latest
fi
wait_for_port 6333 qdrant

# Model service
run_bg "model-service" apps/model-service/.venv/bin/python apps/model-service/run.py
wait_for_port 8100 model-service

# RLM runtime
run_bg "rlm-runtime" deno run --allow-net --allow-env --allow-read --allow-ffi apps/rlm-runtime/src/server.ts
wait_for_port 8787 rlm-runtime

# API
run_bg "api" npx tsx apps/api/src/server.ts
wait_for_port 8000 api

# Worker
run_bg "worker" npx tsx apps/api/src/worker.ts

# Web
run_bg "web" npx next dev apps/web -H 0.0.0.0 -p 3000
wait_for_port 3000 web

echo ""
echo "============================================"
echo " All services running"
echo "  API      http://localhost:8000"
echo "  Web      http://localhost:3000"
echo "  Redis    localhost:6379"
echo "  Qdrant   localhost:6333"
echo "  Model    localhost:8100"
echo "  Runtime  localhost:8787"
echo "============================================"
echo " Press Ctrl+C to stop all services."
echo ""

wait
