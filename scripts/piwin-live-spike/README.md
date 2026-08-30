# piwin Live — R1 native Spike (Codex subscription path)

Isolated prototypes for ADR 0065. **Not** product code.

## Auth

```bash
# Access token from openai-codex OAuth (never commit):
export PIWIN_LIVE_SPIKE_CODEX_TOKEN='…'

pnpm exec tsx scripts/piwin-live-spike/host-call.ts --dry-run
pnpm exec tsx scripts/piwin-live-spike/host-call.test.ts
pnpm exec tsx scripts/piwin-live-spike/host-call.ts --once
pnpm exec tsx scripts/piwin-live-spike/host-call.ts --serve 8787
```

Creates against `chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas`
with model `gpt-live-1-codex`. **Not** `api.openai.com`.

## Delegation unit checks

```bash
pnpm exec tsx scripts/piwin-live-spike/sideband-tool-ledger.test.ts
pnpm exec tsx scripts/piwin-live-spike/sideband-tool-protocol.test.ts
```

## Desktop WebRTC panel

```bash
cd apps/desktop && VITE_PIWIN_LIVE_SPIKE=1 pnpm exec vite --port 1420 --strictPort
# http://127.0.0.1:1420/#/live-spike
```
