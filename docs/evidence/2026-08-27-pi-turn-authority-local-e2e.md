# Evidence: Pi turn authority local fake-SSE e2e

| Field | Value |
|---|---|
| Date | 2026-08-27 |
| Pi | `@earendil-works/pi-ai` / `pi-coding-agent` 0.84.2 |
| Scope | Real Pi OpenAI-completions against `openai-sse-fixture`. No CPA, no paid model, no prompt bodies. |
| Related | `docs/specs/2026-08-27-pi-native-turn-authority-refactor.md` |

## How it was run

```bash
pnpm --filter @piwin/agent-host exec vitest run src/pi-turn-authority-local.e2e.test.ts
pnpm --filter @piwin/host-runtime exec vitest run src/pi-turn-authority-local.e2e.test.ts
```

Settings used by the isolated `agentDir`:

- `httpIdleTimeoutMs`: 400
- `retry.enabled`: true
- `retry.maxRetries`: 1
- `retry.baseDelayMs`: 20

Both SDK (`createBackendSdkSession`) and RPC (`WorkerSessionBackend`) share that home.

## Required assertions

| # | Assertion | Result |
|---|---|---|
| 1 | `session/prompt` accepted immediately with one `runId` | Pass. Host command returns `{ success, runId }` while the foreground Run is still live. |
| 2 | Every foreground Agent event carries that `runId` | Pass. SDK and RPC stamp thinking/text/retry/error events. Session lifecycle events stay identity-less. |
| 3 | Exactly one final Run transition | Pass. thinking-only, retry-success, and stall each emit one `run/terminal`. |
| 4 | No Host timeout/watchdog event | Pass. Terminal codes are not `model-*-timeout` / `mcp-timeout`. No stream-idle watchdog text. |
| 5 | Keep-alive comments do not reset parsed assistant progress | Pass. After the first assistant chunk, `: keep-alive` frames leave the parsed-stream guard armed. Outcome is `model-stream-stalled`. |
| 6 | Guard abort settles before a second prompt starts | Pass. The stalled prompt returns; a second `prompt()` starts immediately and also settles on the same fixture. |
| 7 | Missing finish follows Pi native retry settings | Pass. `maxRetries: 1` issues two HTTP requests. First-fail-then-stop completes; always-missing-finish fails with `model-stream-missing-finish`. |
| 8 | Thinking-only stop remains completed | Pass. Outcome `{ status: 'completed', stopReason: 'stop' }`. Host terminals `completed`. No error event. |

## Observed timings (this machine)

- thinking-only SDK ≈ 0.4–0.7s, RPC ≈ 0.7–0.9s
- missing-finish retry SDK/RPC ≈ 0.05–0.7s
- keep-alive stall ≈ 0.4s idle + abort; second prompt also settles
- Host thinking-only SDK ≈ 0.4s, RPC ≈ 0.8s
- Host stall SDK ≈ 0.4s, RPC ≈ 1.2s

## Intermediate retry evidence

A successful missing-finish retry still emits one `AgentEvent.error` for the first attempt, plus `model/retry`. That event carries the same `runId`. It does not become the prompt outcome. Host still terminals the Run once as `completed`.

## Not run

User-approved live CPA/Grok smoke. See execution plan §14.
