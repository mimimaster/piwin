#!/usr/bin/env bash
# Isolated test Host: fresh config root, does not touch ~/.piwin.
# Packaged all-in-one Desktop keeps using ~/.piwin; this process uses ~/.piwin-test.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PIWIN_ROOT="${PIWIN_ROOT:-$HOME/.piwin-test}"
export PIWIN_HOST_BIND="${PIWIN_HOST_BIND:-127.0.0.1}"
export PIWIN_HOST_PORT="${PIWIN_HOST_PORT:-8787}"

mkdir -p "$PIWIN_ROOT"
chmod 700 "$PIWIN_ROOT"

echo "[start-test-host] PIWIN_ROOT=$PIWIN_ROOT"
echo "[start-test-host] subscription auth=$PIWIN_ROOT/pi-agent/auth.json"
echo "[start-test-host] listen=ws://${PIWIN_HOST_BIND}:${PIWIN_HOST_PORT}"
echo "[start-test-host] production Desktop config remains at $HOME/.piwin"

HOST_DIR="$ROOT/dist/piwin-host"
if [[ -x "$HOST_DIR/start-host.sh" ]]; then
  exec "$HOST_DIR/start-host.sh"
fi

echo "[start-test-host] dist/piwin-host missing — falling back to apps/host"
cd "$ROOT"
exec pnpm --dir apps/host dev
