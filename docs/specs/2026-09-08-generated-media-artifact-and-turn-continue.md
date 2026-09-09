# Generated media in Artifacts, and failed-turn continue

| Field | Value |
|-------|-------|
| Date | 2026-09-08 |
| Status | Implemented (S1–S3) |
| Evidence | `session-mtsoeoe5-eale09fc` |
| Execution | [plan](../plans/2026-09-08-generated-media-artifact-and-turn-continue.md) |
| Revises | ADR 0005, ADR 0029, ADR 0064 |
| Touches | `contracts`, `agent-host`, `artifact`, `host-runtime`, `apps/desktop`, `apps/cli` |

Three defects, one product story. Truncation must not look like a crash.
A failed turn that already did work must not be wiped. Generated pixels
must not be copied into Artifact HTML or the next prompt.

---

## 1. Problem

User asked for Inkstone icons on a canvas. The model generated rasters
into `~/.piwin/media/<session>/`, then tried to paste them as
`data:image/...;base64,...` into one `artifact-html` fence.

What the user saw:

1. `Artifact blocked: blocked-too-large` (100KB fence gate — working).
2. Red card `Provider finish_reason: max_tokens` (truncation misclassified
   as a failed Run).
3. Error-card **重试** deleted the tool loop and generated-image evidence
   from the transcript (`truncateFrom`). Vault files remained; the
   conversation did not.

Root causes are recorded in the [execution plan](../plans/2026-09-08-generated-media-artifact-and-turn-continue.md) §0–§1. This spec is the product contract.

---

## 2. Decisions

### D1 — Truncation is completion, not failure

OpenAI `finish_reason: length` already maps to `AgentPromptOutcome`
`{ status: 'completed', stopReason: 'length' }`. Gemini-native and some
OpenAI-compat gateways (this Host's CPA) emit `max_tokens` / `MAX_TOKENS`.
Pi 0.84.2 `mapStopReason` only accepts `length`; anything else becomes
`stopReason: error` plus `Provider finish_reason: ${reason}`, then throws.

**Do not fork Pi.** `@piwin/agent-host` normalizes before
`mapNativeStopReason`:

| Native fact | Outcome |
|---|---|
| `stopReason: length` | completed / `length` (unchanged) |
| `stopReason: max_tokens` or `MAX_TOKENS` | completed / `length` |
| `stopReason: error` and message matches `/finish_reason:\s*max_tokens/i` | completed / `length` |
| Other provider errors (500, 401, missing finish) | still failed |

Partial assistant text stays. The Run is `completed`. No `TurnErrorCard`.

When `run.agentStopReason === 'length'`, Desktop shows a non-error chip
on that assistant: **输出被截断** / **Output truncated**, plus **继续**.

### D2 — Repair with work is Continue, not wipe

ADR 0064 decision 3 assumed a failed attempt has no retention value.
That is true only for an empty bubble (no tools, no attachments, no
assistant text). It is false once the turn has tool results, generated
media, or prose.

`keepPreviousAttempt: true` is **not** the fix. That keeps a sibling in
the tree that is **off the active path**, so the next model call does
not see the work and regenerates.

Keep ADR 0064's two intents (repair vs explore). Change the repair
**write** when the turn already did work:

| Gesture | When | Write |
|---|---|---|
| **继续** (primary) | Truncation (`length`), or a failed/aborted run whose path after the user row has tools, attachments, or non-empty assistant text | `PromptInput.source: 'continuation'`. No rebase, no truncate, no new user row. Host-authored model-facing instruction only. |
| **从头再来** (destructive, confirm) | User explicitly wants a clean retry | Existing `retryUserMessageId` + `keepPreviousAttempt: false` |
| Empty failure | Error card on a blank bubble | Existing wipe-retry; nothing to keep |
| 另生成一版 | Conversation regenerate | Unchanged: `keepPreviousAttempt: true` |

`source: 'continuation'` is not pause-resume. It does not require a
checkpoint. `source: 'resume'` stays checkpoint-owned.

Host-authored continuation text (model-facing, never a user bubble):
previous turn ended by truncation or provider failure after work;
inspect transcript and tool state; do not repeat successful side
effects; do not regenerate `mediaIds` already produced; do not embed
image bytes, markdown images, or filesystem paths; finish only the
unfinished deliverable.

### D3 — Artifacts bind session media by id, never by bytes

`image_gen` already saves under `~/.piwin/media/<session>/` and tells
the model not to emit markdown images or paths. The Artifact contract
still says "self-contained," and CSP is `img-src data: blob:`. The
only raster the model can put in a canvas today is a data URL. That
is the token burn, and it still hits `blocked-too-large`.

**Product:** generated pixels live once, in the media vault. An
Artifact may *reference* them. It must not copy them into the prompt
or the fence.

Canonical markup:

```html
<img data-piwin-media="<mediaId>" alt="Inkstone slab icon">
```

Rules:

1. `@piwin/artifact` stays pure. It parses `data-piwin-media`. At
   `materializeArtifact`, the caller supplies a `mediaId → blob:` map.
   Copy/export keep the attribute, never the blob.
2. Desktop/Host resolve ids only from **this session's** vault.
   Unknown / other-session / path-like values do not bind.
3. CSP stays `img-src data: blob:`. No `file:`, no Host HTTP from
   the iframe.
4. `formatArtifactProtocol` (bump to v9) + `image_gen` notice: never
   `data:image`, never local paths, never markdown images for vault
   assets. Use `data-piwin-media`. If the user only needs to pick
   among generated images, attachment cards are enough — do not wrap
   them in a second HTML copy.
5. `blocked-too-large` still applies to fence bytes. A bound gallery
   of media ids is small; a base64 dump still blocks.

Do not invent a `piwin-media://` URL the iframe would fetch. Bind at
materialize time.

---

## 3. Contracts

### 3.1 `PromptInput.source`

```ts
source?: 'user' | 'resume' | 'queued-turn' | 'voice-delegation' | 'continuation';
```

| `source` | New user row | Rebase / truncate | Checkpoint |
|---|---|---|---|
| omitted / `user` | yes | no | no |
| `resume` | no | no | required |
| `continuation` | no | no | no |
| `retryUserMessageId` + `keepPreviousAttempt: false` | no | truncate then rebase to user row | no |

`continuation` is mutually exclusive with `retryUserMessageId` and
`branchFromMessageId`. Host refuses `continuation-and-repair-conflict`.

### 3.2 Truncation mapping (agent-host only)

Pure function, unit-tested with fixtures. Ordinary HTTP/auth/missing-finish
failures must not become `length`.

### 3.3 Artifact media bind

`materializeArtifact` accepts an optional `mediaObjectUrls: ReadonlyMap<string, string>`.
Only `blob:` values are written into `src`. The stored descriptor source
is never rewritten.

---

## 4. Non-goals

- Raising `DEFAULT_MAX_ARTIFACT_BYTES` to fit base64 galleries.
- Forking Pi `mapStopReason`.
- Putting media bytes into the text prompt (ADR 0005 still forbids this).
- Auto-continuing truncated turns without a click.
- Letting Artifact HTML fetch arbitrary files or other sessions' media.
- Changing pause-resume (`source: 'resume'`).

---

## 5. Acceptance

1. A CPA/Gemini stream that ends `finish_reason: max_tokens` with partial
   HTML is a completed Run with `agentStopReason: 'length'`. No red card.
2. Error-card **继续** on a turn that already generated images does not
   call `truncateFrom`. Vault attachments and tool rows stay. No second
   user bubble.
3. **从头再来** still truncates, after confirm, including
   `retry-discards-writes`.
4. An Artifact fence that only references `data-piwin-media` ids from
   this session renders those images in the sandbox. The same fence with
   inlined base64 PNGs still `blocked-too-large`.
5. Copy/Download of that Artifact is the original fence (ids), not blob
   URLs or pixels.
6. CLI has the same continuation vs wipe split as Desktop.
