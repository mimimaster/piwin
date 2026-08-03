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

Implement **Option C: text fallback + LLM auto-naming**, with a hard sidebar rule:

**Unnamed sessions never appear in the session list.** A session is listable
only when it has a real display name (see `sessionHasListName` in
`@piwin/session`). Host `session/list` and desktop hydrate both filter
placeholders such as `session-<id>`.

### Naming pipeline (ordered)

1. **Create** without an explicit name → no list row (no placeholder name written).
2. **First user message** → host immediately derives a truncated title via
   `deriveDefaultNameFromMessage` and writes `nameSource: 'text'`, then pushes
   `session/name-updated` so the sidebar inserts the row.
3. **First completed exchange** → optional LLM title upgrades to `nameSource: 'llm'`.
4. **Manual rename** → `nameSource: 'user'` (never overwritten).

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

**Immediate text name** on first user send: `recordUserPrompt` →
`maybeAssignTextNameFromPrompt` writes `nameSource: 'text'` via
`deriveDefaultNameFromMessage` so the sidebar never waits on a completed run.

**LLM upgrade** after `emitRunTerminal` with `outcome: 'completed'` in
`host-runtime.ts`. The `maybeTriggerAutoName` method checks:
- `messageCount >= 1` — `messageCount` counts completed runs (not messages), so
  >= 1 means the first exchange finished. The session index is touched *before*
  the terminal event so the trigger sees the current run.
- `nameSource !== 'user'` (never overwrite manual renames)
- `nameSource !== 'auto'` with existing name (only trigger once)

The trigger fires after **every** completed exchange while the session is still
unnamed: if naming fails (LLM error + empty text fallback), `nameSource` stays
`'default'` and the next exchange retries until naming succeeds. Normally the
first exchange succeeds. The LLM title is generated from the latest user message
plus the latest assistant reply (captured from the event stream), falling back to
a text-derived name from the user message when no model/provider is configured.

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
