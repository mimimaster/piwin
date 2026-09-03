# Live Session Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make piwin Live able to *talk about the bound work session*. Today the voice model receives a constant `instructions` string on every channel and never sees one word of the session; the spoken contract even tells it to answer "from this conversation" that it does not have. Align with the reference extension (`@howaboua/pi-codex-conversion`): inject a **startup continuity summary** at call create, keep the voice layer **in sync** while the call runs (typed input, every Run result on the bound session), and clean up the dead code found along the way.

**Architecture:** Host owns context; shells stay media-only. One new Host module reads the bound session transcript, summarizes it with the session's current chat model through the existing tool-free `completeModelText` boundary, and hands the summary to the provider registration (`initial_items` for Codex, `systemInstruction` part for Gemini, owner bootstrap field for OpenAI Realtime). Rebind and typed input flow through the existing `append-context` owner action. Slice C removes deprecated exports, a re-export shim, and splits the oversized coordinator.

**Tech Stack:** TypeScript strict (NodeNext ESM), vitest, existing `LiveCallCoordinator` / `LiveDelegationController` / `LiveProviderRegistration` / `DesktopLiveMediaDriver` stack. No new runtime dependencies.

**Product decision (owner, 2026-09-03):** A + B + C. Summary model = the bound session's current chat model (same resolution as intent review; zero new settings). Supersedes ADR 0065 §4 / language-layers spec §2 "layer ① must not see assistant text" — update those docs in Slice C (AGENTS.md §0.1).

---

## Root cause (evidence)

| Channel | Where instructions come from | Session content |
|---------|------------------------------|-----------------|
| Codex | `packages/voice/src/codex-live-registration.ts:39` → `PIWIN_LIVE_INSTRUCTIONS` | none |
| Gemini | `packages/voice/src/gemini-live-adapter.ts:48` → `GEMINI_LIVE_SYSTEM_INSTRUCTION` | none |
| OpenAI Realtime | `apps/desktop/src/live/media/openai-realtime-events.ts:29` → `OPENAI_REALTIME_LIVE_INSTRUCTIONS` | none |

`compose-host-live.ts` resolves only `resolveSessionLabel` (session title), used for LiveBar and the retarget sentence — never given to the voice model. `buildCodexLiveCallBody` has no `initial_items`. `appendContext` exists on every driver but is only reached from Host owner actions, and Host only pushes: admission ack, hold reasons, a 600-char takeaway for **voice-delegated** Runs, and a one-line retarget notice.

Reference (`/tmp/pi-codex-ref/package/dist/voice/`, v3.0.25):

- `context.js` `buildRealtimeInitialItems`: serialize Pi session as `[User]: … / [Assistant]: … / [Conversation summary]: …`, one tool-free completion with a continuity prompt, wrap in `<startup_context>`, send as `initial_items[{role:"developer"}]` in `call-setup.js`. Cache key `sessionId:leafId:model:reasoning`.
- `conversation/handoff.js`: typed Pi input → commentary `<pi_steer>`; assistant reply streamed as `speakable` (first two sentences, then per paragraph).
- We copy the **layering**, not the XML names or the `~/.pi` prompt files.

---

## Global constraints

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — do not weaken.
- ESM only; `.js` on relative imports; `import type` for types. No `any`; no `!` without a runtime check in the same block.
- `packages/contracts` stays a leaf. `packages/voice` never imports Pi; the only Pi completion is `completeModelText` in `@piwin/agent-host`, composed from `host-runtime`.
- Apps and `@piwin/voice` never read `fs`; transcript access goes through `deps.getTranscriptStore` in `host-runtime`.
- **Privacy:** the summary lives in memory only. Never log it, never write it to the session transcript, never put it on `LiveCallView` / `voice/live-updated` (observers must not see it). It may appear only in the owner's start bootstrap / owner actions and the provider request body.
- **Bounded:** serialized transcript input ≤ 24 KiB (tail window), summary output ≤ 1 200 chars, summary budget ≤ 15 s. Failure to summarize **never** blocks call start — degrade to no startup context and `console.error('[piwin-live] startup context unavailable')`.
- Do not abort admitted Runs on rebind or on call end (unchanged authority).
- No keyword intent guessing anywhere (ADR 0065 §4 stays).
- Tests for every logic change (AGENTS.md §3.5). Files stay under 1 000 lines; plan the split at ~400.
- Do not edit `apps/desktop/src/live/use-live-call.ts` or `LiveBar.tsx` beyond what Slice B3 lists — no UI redesign in this plan.

## Dispatch (independent sub-agents)

| Task | `dependsOn` | Exclusive files |
|------|-------------|-----------------|
| A1 contracts | none | `packages/contracts/src/live-spoken-contract.ts`, `live-session-context.ts` (new), `live-delegation-review.ts`, `voice-live.ts` (openai bootstrap field), `index.ts` |
| A2 voice summarizer | A1 | `packages/voice/src/live-session-context.ts` (new) + test, `index.ts` |
| A3 voice provider plumbing | A1 | `live-provider-registration.ts`, `codex-live-adapter.ts`, `codex-live-registration.ts`, `fake-codex-live-registration.ts`, `gemini-live-adapter.ts`, `gemini-live-registration.ts`, `openai-realtime-registration.ts`, their tests |
| A4 host wiring | A2, A3 | `host-runtime/src/voice/live-session-context-source.ts` (new) + test, `compose-live-completion.ts` (new, extracted from `compose-live-reviewer.ts`), `compose-live-reviewer.ts`, `compose-host-live.ts`, `live-call-types.ts`, `live-call-coordinator.ts`, `live-coordinator-test-harness.ts`, coordinator tests |
| A5 shell openai bootstrap | A1 | `apps/desktop/src/live/media/openai-realtime-events.ts`, `openai-realtime-driver.ts` (+ tests), `apps/mobile/src/live/mobile-pcm-live-driver.ts` |
| A6 reviewer context | A4 | `packages/voice/src/delegation-review.ts` + test, `live-delegation-controller.ts` |
| B1 typed input sync | A4 | `live-call-coordinator.ts` (one method), `commands/prompt-preparation.ts` (one hook), `host-runtime-init.ts` |
| B2 any-Run result | A4 | `live-delegation-controller.ts`, `live-delegation-controller.test.ts` |
| B3 run-keyed reply | none | `host-runtime-fields.ts`, `session-agent-event-router.ts`, `host-runtime-init.ts`, `session-runtime-dispose.ts`, `session-runtime-lifecycle.ts`, `host-runtime-dispose.ts` |
| C1 dead code | none | `packages/contracts/src/live-delegation-instruction.ts` + test, `host-runtime/src/voice/live-speakable-result.ts` (delete), `live-delegation-controller.ts` import line |
| C2 coordinator split | A4, B1 | `live-call-coordinator.ts`, `live-start-gate.ts` (new) + test |
| C3 docs | A4, B2 | `docs/adr/0065-…md`, `docs/specs/2026-08-31-live-language-layers.md`, `docs/specs/2026-09-03-live-session-context.md` (new) |

A3 and A4 must not both edit `codex-live-registration.ts`; A4 consumes A3's new `start` input field only.

---

## Slice A — startup continuity summary (the fix)

### A1 · contracts

- [ ] `packages/contracts/src/live-session-context.ts` (new):
  - `PIWIN_LIVE_STARTUP_CONTEXT_HEADER` — plain sentences: this is background from the bound work session before the call started; it may be summarized; use it to answer questions about the earlier conversation; do not recite it unless relevant; the chat page remains the source of truth.
  - `renderLiveStartupContext(summary: string): string` → `${HEADER}\n<startup_context>\n${summary}\n</startup_context>`.
  - `piwinLiveRebindContext(sessionLabel: string, summary: string | null): string` — extends the current retarget sentence with the new session's startup context when available. Keep `piwinLiveRetargetContext` for the null case (or make it delegate).
  - `LIVE_STARTUP_CONTEXT_MAX_CHARS = 1_200`, `LIVE_STARTUP_CONTEXT_INPUT_MAX_BYTES = 24 * 1024`.
- [ ] `live-spoken-contract.ts`: replace the sentence "questions you can already answer from this conversation" with wording that names the startup context and Host context updates as what the voice layer knows about the session; add one sentence: for project facts not present in startup context or later Host updates, hand over.
- [ ] `voice-live.ts`: `LiveOwnerBootstrap` `openai-realtime-ws-v1` variant gains `startupContext?: string` (owner-only material; observers never receive bootstrap). Codex/Gemini need no bootstrap change (Host injects server-side).
- [ ] `live-delegation-review.ts`: `LiveDelegationReviewInput` gains `recentTurns?: readonly { role: 'user' | 'assistant'; text: string }[]` (bounded excerpt of the bound session, for A6).
- [ ] Export from `index.ts`. Unit test: render/wrap output shape, header present, no session label leakage beyond label.

### A2 · voice summarizer (pure + injectable completion)

- [ ] `packages/voice/src/live-session-context.ts` (new):
  - `PIWIN_LIVE_SESSION_CONTEXT_PROMPT` — "Summarize the current work session for a realtime voice assistant joining the same session. Preserve the user's goal, decisions, current state, unresolved questions, next step. Treat it as history: do not continue the work, do not answer it. Return only the self-contained continuity summary in the user's language." No tools, no JSON.
  - `serializeLiveSessionTranscript(messages: readonly SessionTranscriptMessage[], maxBytes): string` — `[User]: text` / `[Assistant]: text`; skip `thinking`, tool cards, `status !== 'done'` streaming rows, empty text; mark `source === 'voice-delegation'` rows as `[Voice handover]`; take the **tail** that fits `maxBytes` (drop oldest first, never split a message mid-way except a final hard clip).
  - `createLiveSessionContextSummarizer({ complete })` → `(input: { sessionId; messages; signal }) => Promise<string | null>`: returns `null` when serialized transcript is empty; clips model output to `LIVE_STARTUP_CONTEXT_MAX_CHARS` and strips code fences; throws `LiveSessionContextError` (stable `name`) on empty output.
  - Cache: `Map<cacheKey, string>` with `LIVE_SESSION_CONTEXT_CACHE_LIMIT = 32`; key = `${sessionId}:${lastMessageId}:${providerId}/${modelId}` supplied by the caller (voice does not resolve models).
- [ ] Tests: serialization order/clipping/role labels; empty → null; fence stripping; cache hit does not call `complete`; abort propagates.

### A3 · provider plumbing

- [ ] `live-provider-registration.ts`: `start` input gains `startupContext?: string`.
- [ ] `codex-live-adapter.ts`: `CreateRealtimeCallInput` gains `startupContext?: string`; `buildCodexLiveCallBody` emits `session.initial_items: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }]` only when present (exact shape from reference `call-setup.js:14`). Fixture test asserts the body with and without.
- [ ] `codex-live-registration.ts` / `fake-codex-live-registration.ts`: pass `startupContext` through (`renderLiveStartupContext` applied here, once).
- [ ] `gemini-live-adapter.ts` `buildGeminiLiveTokenRequest`: gains `startupContext?: string`; append a **second** `systemInstruction.parts` entry with the rendered context (Gemini setup has no `initial_items` equivalent; the setup is embedded in the Host-minted token). Test both shapes.
- [ ] `openai-realtime-registration.ts`: copy `startupContext` into the owner bootstrap field from A1.

### A4 · host wiring

- [ ] `compose-live-completion.ts` (new, extract from `compose-live-reviewer.ts`): `createLiveSessionModelCompletion(input)` → `(request: { sessionId; systemPrompt; userPrompt; maxOutputTokens; signal }) => Promise<string>` containing today's config/accounts/desired-model/provider-secret resolution. Also expose `resolveLiveSessionModelRef(sessionId)` for the cache key. `composeLiveReviewer` becomes a thin caller. Existing reviewer tests must stay green.
- [ ] `live-session-context-source.ts` (new): `createLiveSessionContextSource({ getTranscriptStore, completion, resolveModelRef })` → `{ resolve(sessionId, signal): Promise<string | null> }`: `store.listTail(LIVE_SESSION_CONTEXT_TAIL_ROWS = 60)` → summarizer with 15 s `AbortSignal.timeout` combined with the caller signal. Catch everything → `console.error` (message only, never the text) → `null`. Mock mode: return `null` without a model call.
- [ ] `live-call-types.ts`: `LiveCoordinatorDeps.resolveStartupContext: (sessionId: string, signal: AbortSignal) => Promise<string | null>`.
- [ ] `live-call-coordinator.ts`:
  - `startUnlocked`: after `label` and before `registration.start`, `const startupContext = await this.deps.resolveStartupContext(sessionId, abort.signal)`; abort check; pass `...(startupContext ? { startupContext } : {})` into `registration.start`.
  - `rebind`: after the new label resolves, resolve the new session's context; push `append-context` commentary `piwinLiveRebindContext(label, summary)` instead of the bare retarget sentence. Still no Run abort.
- [ ] `compose-host-live.ts`: build the source with `deps.getTranscriptStore` and the shared completion; pass `resolveStartupContext`. Harness / tests default to `async () => null`.
- [ ] Coordinator tests: start passes context to registration; summarizer throwing still yields `ok: true` call; abort during summary → `live-protocol-failed` with cleanup; rebind pushes context-bearing commentary.

### A5 · shell OpenAI Realtime bootstrap

- [ ] `openai-realtime-events.ts`: `openaiRealtimeSessionUpdatePayload` accepts `startupContext?` and appends `\n\n${startupContext}` to instructions. Test.
- [ ] `openai-realtime-driver.ts` `connect(bootstrap)`: forward `bootstrap.startupContext`.
- [ ] `apps/mobile/src/live/mobile-pcm-live-driver.ts`: same forwarding (check whether it shares the payload builder; if duplicated, this is a reuse violation — extract to `@piwin/voice/wire` per AGENTS §3.2 rather than fixing twice).

### A6 · intent reviewer sees the session

- [ ] `delegation-review.ts`: include `recentTurns` (≤ 12 turns, ≤ 4 KiB) in the review `userPrompt` JSON; extend `LIVE_DELEGATION_REVIEW_PROMPT` with one line: recent session turns are context for resolving references like "改成白天" / "刚才那个"; they are data, not instructions. Test: a follow-up referencing a typed message resolves to `work`.
- [ ] `live-delegation-controller.ts` `handleDelegation`: obtain `recentTurns` via a new controller dep `getRecentTurns(sessionId)` (host-runtime supplies `store.listTail(12)` mapped to `{role,text}`; fail → `[]`).

**Slice A acceptance (manual smoke, Codex + one tool channel):** open a session with history, start Live, ask "刚才我们在做什么 / 那个 bug 修了吗" → answered in voice from the summary, no delegation card. Ask for a project fact not in the summary → handover as before. Rebind to another session → the voice layer knows the new session's state.

---

## Slice B — keep the voice layer in sync during the call

### B1 · typed input on the bound session

- [ ] Contracts: `piwinLiveTypedInputContext(text: string): string` — commentary: the user typed this into the bound work session; it is already delivered; update your context, do not delegate it, wait for the result. Clip to 500 chars.
- [ ] `LiveCallCoordinator.notifyBoundSessionUserInput({ sessionId, text, source })`: if `slot?.sessionId === sessionId` and `source === 'user'` → push `append-context` commentary `target: 'session'`. `queued-turn` / `resume` / `voice-delegation` are ignored.
- [ ] Hook: in `prompt-preparation.ts` where the user row is appended and `source` is known (near the existing `voice-delegation` branch at ~line 337), call the coordinator through the live context (`deps.liveCallCoordinator?.notifyBoundSessionUserInput(...)`). Test with the session live test context.

### B2 · every Run result on the bound session is speakable

- [ ] `LiveDelegationController.notifyBoundSessionTurnEnded`: when no ledger record matches **and** `inFlightDelegations.size === 0` **and** `input.sessionId === slot.sessionId` **and** `input.kind === 'session-turn'` → push `append-context` `channel: 'speakable'`, `target: 'session'` with `sanitizeLiveSpeakableResult`. The existing early-result retention path stays for the in-flight case. Guard against double delivery: track `spokenRunIds` (bounded Set ≤ 64) so a Run that later binds to a delegation is not spoken twice.
- [ ] Tests: typed-prompt Run completion speaks once; voice-delegated Run still speaks via delegation target once; foreign session Run ignored.

### B3 · reply keyed by Run, not by session

- [ ] Replace `deps.sessionLastAssistantReply` (session → text) usage for Live with `deps.runAssistantReply: Map<runId, string>` populated in `session-agent-event-router.ts` at `message/end` using `correlatedRunId ?? activeRunId`. `host-runtime-init.ts:150` reads by `run.runId` and deletes after use. Clear in dispose paths. If grep confirms `sessionLastAssistantReply` has no other reader, delete it; otherwise leave it for its owner.
- [ ] Test: two overlapping Runs in one session deliver their own text.

---

## Slice C — cleanup and docs

### C1 · dead code

- [ ] Delete `PIWIN_LIVE_POLICY`, `PIWIN_LIVE_DELEGATE_TOOL_HINT`, `compressLiveDelegationInstruction` and its regex helpers (`SPOKEN_LEAD*`, `SPOKEN_META*`, `SPOKEN_TRAIL`) from `live-delegation-instruction.ts`; delete the matching `describe` block in its test. Keep `sanitizeLiveDelegationInstruction`, `isLiveStopInstruction`, `wrapLiveDelegationForAgent`.
- [ ] Delete `packages/host-runtime/src/voice/live-speakable-result.ts`; controller imports `sanitizeLiveSpeakableResult` from `@piwin/contracts`.
- [ ] `pnpm typecheck` + `pnpm -r test` green; grep confirms zero references.

### C2 · coordinator split (479 → two files)

- [ ] `live-start-gate.ts` (new, pure): `decideLiveStart({ slot, startInFlight, input })` → `{ kind: 'replay'; bootstrap } | { kind: 'join-inflight' } | { kind: 'reject'; errorCode } | { kind: 'proceed' }`. Consolidates the duplicated idempotency/owner/conflict checks now in both `start` and `startUnlocked`. Golden tests for every branch (same owner + same key + same target → replay; same key different session → `live-conflict`; other owner → `live-call-busy`; etc.).
- [ ] Coordinator calls the gate; behaviour unchanged (existing coordinator tests are the regression net). Target ≤ 350 lines.

### C3 · docs (same change set as the code)

- [ ] `docs/specs/2026-09-03-live-session-context.md` (new): problem, reference comparison, what each channel receives, sync events, privacy/retention row ("session continuity summary — memory only"), acceptance list.
- [ ] ADR 0065 §4 and §5: layer ① now sees a bounded startup summary + Host context updates for the bound session (not tools, diff, other sessions); retention table gains the summary row; header adds "2026-09-03 session context" revision line.
- [ ] `docs/specs/2026-08-31-live-language-layers.md` §2 table: ① "可以看见" += 启动续接摘要、绑定会话打字与 Run 短结果; ② "可以看见" += 绑定会话最近若干轮; §5 remove the implication that voice must never know the page. §7 add acceptance items 11–13 from this plan.

---

## Verification

1. `pnpm typecheck`.
2. `pnpm --filter @piwin/contracts --filter @piwin/voice --filter @piwin/host-runtime test`; Desktop live tests `pnpm --filter piwin-desktop test -- live`.
3. Line counts: `wc -l` on touched files, all < 1 000, coordinator < 400.
4. Manual smoke per Slice A acceptance; then B: type in the bound session while on the call → voice acknowledges when the Run ends without a delegation card; two concurrent Runs speak the correct text.
5. Leak check: `rg -n "startup_context|startupContext" apps packages/host-server` shows no path onto `LiveCallView`, `voice/live-updated`, host logs, or transcript rows.

## Out of scope

- Streaming assistant text into the call mid-Run (reference `handoff.js` sentence streaming) — evaluate after B lands; needs a per-run text tap.
- Editable voice persona files under `~/.piwin`.
- Host PCM relay, Mobile UI changes, new Live settings fields.