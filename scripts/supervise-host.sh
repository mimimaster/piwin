#!/usr/bin/env bash
# Supervise standalone piwin-host with exponential backoff (mirrors Desktop Tauri sidecar).
# Usage: ./scripts/supervise-host.sh [host-command...]
# Default command: pnpm --dir apps/host dev
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CMD=("$@")
if [[ ${#CMD[@]} -eq 0 ]]; then
  CMD=(pnpm --dir apps/host dev)
fi

attempt=0
max_backoff=60
while true; do
  echo "[supervise-host] starting: ${CMD[*]}"
  set +e
  "${CMD[@]}"
  code=$?
  set -e
  if [[ $code -eq 0 ]]; then
    echo "[supervise-host] host exited cleanly"
    exit 0
  fi
  attempt=$((attempt + 1))
  backoff=$((2 ** (attempt > 5 ? 5 : attempt)))
  if [[ $backoff -gt $max_backoff ]]; then
    backoff=$max_backoff
  fi
  echo "[supervise-host] host exited with $code; restarting in ${backoff}s (attempt $attempt)"
  sleep "$backoff"
done
