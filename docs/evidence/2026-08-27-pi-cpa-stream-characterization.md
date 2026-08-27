# Evidence: Pi 0.84.2 stream termination characterization

| Field | Value |
|---|---|
| Date | 2026-08-27 |
| Pi | `@earendil-works/pi-ai` / `pi-coding-agent` 0.84.2 |
| Scope | Secret-free local fixtures only. No CPA, no paid model, no prompt bodies. |
| Related | `docs/specs/2026-08-27-pi-native-turn-authority-refactor.md` |

## What was frozen

Sanitized Pi session-event sequences live in
`packages/agent-host/src/fixtures/model-stream/`:

- `thinking-only-stop.json`
- `text-stop.json`
- `tool-then-stop.json`
- `missing-finish.json`
- `provider-error.json`
- `aborted.json`

A local OpenAI-compatible SSE server
(`openai-sse-fixture.ts`) can emit:

- reasoning deltas then `finish_reason: stop` + `[DONE]`
- ordinary text then `finish_reason: stop` + `[DONE]`
- a closed body with no `finish_reason`
- assistant deltas followed only by `: keep-alive` comments
- a first-request `tool_calls` finish, then a held second request

## Observed current Pi 0.84.2 behavior

Source: `pi-ai/dist/api/openai-completions.js` and
`pi-coding-agent/dist/core/agent-session.js`.

1. Default `compat.supportsFinishReason` is `true`. Piwin registrations do not
   set it to `false`.
2. A stream that closes without `finish_reason` does **not** reject
   `stream.result()`. It resolves with `stopReason: "error"` and
   `errorMessage: "Stream ended without finish_reason"`. The throw is
   caught inside Pi's stream parser and recorded on the assistant message.
3. Thinking-only content (`reasoning_content`) plus `finish_reason: stop`
   produces `stopReason: "stop"` with thinking and no assistant text.
4. `Session.prompt()` awaits `_runAgentPrompt` → `agent.prompt()`. A native
   `stopReason: "error"` is recorded on the assistant message and emitted
   through the event stream. `prompt()` still resolves; it does not throw
   that model failure.
5. OpenAI SDK `timeout` / Pi `timeoutMs` is attached to
   `chat.completions.create`. After response headers arrive, keep-alive
   comments keep the socket open and do not create a parsed-token idle
   deadline.

## Observed current piwin behavior (before this refactor)

- `BackendSessionHandle.prompt()` / `SessionHandle.prompt()` return
  `Promise<void>`.
- `event-map` turns `stopReason: "error"` / aborted-with-detail into
  `AgentEvent.error`. Thinking-only `stop` does not become an error.
- `createPiwinSettingsManager` still forces `getRetryEnabled() === false`
  and `maxRetries: 0`.
- `runPiPromptWithProgressTimeout` uses `Promise.race` and rejects the
  prompt. Abort failure is swallowed. It is not limited to
  `openai-completions` and does not wait for Pi idle before returning.

## Baseline package failures (not in this program)

`@piwin/agent-host` typecheck is green. Full package tests at this commit:
299 tests, 4 pre-existing Health presentation failures:

- `event-map.test.ts` copies Health details from `tool_execution_end`
- `tool-presentation.test.ts` classify known tools
- `tool-presentation.test.ts` copies Health card details
- `tool-presentation.test.ts` defaults live `health_read_context` start cards

These belong to Health/Artifact owners. Characterization and stream
conformance files are green (14/14).

## Live CPA

Not run. These fixtures reproduce the four incident shapes locally.
