# ADR 0019: Session Auto-Naming

## Status

Proposed (2026-07-29)

## Context

piwin sessions default to `session-${id.slice(0,8)}` — a placeholder that
gives the user no signal about what a session is about. Manual rename exists
(`session/rename` host command → `renameSessionRecord`), but most users never
bother, and the session list becomes a wall of opaque IDs.

Industry consensus (Claude Code, ChatGPT, ChatOllama, openhuman, piper-morgan):
trigger after the first complete exchange, use a lightweight model to generate
a 3-7 word title, fire-and-forget, never overwrite a user-renamed session,
provide an opt-out setting, and fall back to a text-derived name on LLM
failure.

## Decision

Implement **Option C: text fallback + LLM auto-naming**.

### Three-state name tracking

Add `nameSource?: 'default' | 'auto' | 'user'` to `SessionIndexRecord` and
`SessionSummary`. Auto-naming only overwrites `default` or `auto` — never
`user`. This is the critical invariant: a user who manually renames a session
has their name preserved permanently.

### LLM completion via direct provider API

The Pi SDK has no standalone lightweight completion API — model calls only go
through `piSession.prompt(text)`, which would create a full agent session just
to generate a title. Instead, `lightweight-completion.ts` resolves the
provider secret via `secret-resolver.ts` and makes a direct `fetch` to the
OpenAI/Anthropic chat-completion endpoint. This bypasses Pi entirely for a
one-shot 50-token completion.

### Orchestrator: `session-naming-service.ts`

1. Check `PiwinConfig.session.autoName` (default `true`); skip when `false`.
2. Attempt LLM title generation via the session's current model + provider.
3. On LLM failure, fall back to `deriveDefaultNameFromMessage` (text cleanup:
   strip markdown/URLs, collapse whitespace, truncate at 60 chars).
4. Write via `setSessionAutoName` (respects `nameSource: 'user'` guard).
5. Push `session/name-updated` so the desktop session list refreshes.

### Trigger point

`emitRunTerminal` with `outcome: 'completed'` in `host-runtime.ts`. The
`maybeTriggerAutoName` method checks:
- `messageCount >= 2` (first exchange = user + assistant)
- `nameSource !== 'user'` (never overwrite manual renames)
- `nameSource !== 'auto'` with existing name (only trigger once)

Fire-and-forget: failures are logged via `host/log` warn, never propagated.

### Config

`SessionConfig.autoName?: boolean` (default `true` via
`createDefaultSessionConfig`). Normalized in `config-store.ts`. Users can
opt out by setting `{ "session": { "autoName": false } }` in `~/.piwin/config.json`.

## Consequences

- **Provider dependency for best titles**: when no provider is configured or
  the API key is missing, auto-naming falls back to text-derived names. This
  is acceptable — the fallback is still better than `session-abc12345`.
- **No Pi session overhead**: the direct provider call avoids creating a full
  agent session for a 50-token completion.
- **google-gemini not yet supported**: `lightweight-completion.ts` returns
  `null` for the `google-gemini` protocol. Text fallback applies. Can be
  added later.
- **`session/auto-name` command**: allows manual re-trigger (text fallback
  only; LLM path is host-driven via `run/terminal`).
