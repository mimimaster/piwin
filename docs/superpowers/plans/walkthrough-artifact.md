# Walkthrough Artifact — Implementation Plan

Source spec: `docs/specs/walkthrough-artifact.md` (authoritative; read relevant sections before each task).

## Global Constraints

- TypeScript strict mode (`tsconfig.base.json`); do not weaken `strict`, `noUncheckedIndexedAccess`, or `exactOptionalPropertyTypes`.
- ESM only; use `.js` extensions in relative imports for NodeNext.
- No `any`; prefer `unknown` + narrowing. No non-null assertion (`!`) except after explicit runtime check.
- Apps never import `@earendil-works/pi-*`; only `@piwin/*` allowed. Only `packages/agent-host` may depend on Pi.
- Contracts first: new cross-cutting types start in `packages/contracts`.
- `packages/contracts` has no runtime deps on other `@piwin/*`.
- `packages/ui-kit` depends on `@piwin/contracts` only; no host, no FS, no Mantine direct import from apps.
- Public API = package `src/index.ts` exports only. No deep relative imports into another package `src/`.
- Colocated tests: `foo.ts` + `foo.test.ts`.
- No floating promises; always `await` or explicitly void with comment.
- Secrets never enter walkthrough markdown, persisted artifact, host error, host log, or notification.
- Walkthrough generation never calls `SessionHandle.prompt()`, `steer()`, `followUp()`, or starts a new agent turn.
- Walkthrough markdown is untrusted; no HTML/JS/iframe execution. Markdown source-only rendering.
- `MAX_WALKTHROUGH_PROMPT_BYTES = 16 * 1024` (UTF-8 bytes).
- Provider completion defaults: `maxOutputTokens = 4096`, `temperature = 0.2`, timeout 60s.
- Evidence byte limits (UTF-8): user request 16 KiB, assistant 24 KiB, single tool 4 KiB, tools total 32 KiB, paths max 256, single path 1 KiB, custom prompt 16 KiB, evidence total 64 KiB, generated markdown 32 KiB.
- `createDefaultWalkthroughConfig()` returns `{ enabled: true, mode: 'default', custom: { model: null, prompt: DEFAULT_WALKTHROUGH_PROMPT } }`.
- WalkthroughArtifact `version: 1`. `model` required on `ready`, optional on `generating`/`error`.
- Persisted path: `~/.piwin/sessions/<sessionId>/walkthroughs/<encoded-message-id>.json`.
- `sessionId` and `messageId` must not escape session directory (path traversal protection).
- Atomic JSON writes. Raw evidence never persisted.
- IPC push order: `walkthrough/generate accepted → walkthrough/updated(generating) → walkthrough/updated(ready|error)`.
- Same `sessionId + messageId` max one in-flight generation; `force` only when not generating.
- `walkthrough/cancel` bypasses normal task queue, triggers AbortController immediately.
- Old generation results discarded if not current generation.
- SDK and RPC host both use same command contract.
- Settings UI uses `@piwin/ui-kit` only; no direct Mantine import from apps.
- Model select display: `<provider name> / <model label or model id>`, value is JSON-safe ModelRef.
- `memo` comparator must compare walkthrough artifact ref, generate/cancel callback refs, enabled state.
- Walkthrough results never appended to transcript; only enter `walkthroughsByMessageId`.
- CLI uses same Host commands; no hover UI needed.

---

## Task 1: Contracts — config, artifact, IPC types, transcript model snapshot

**Spec sections:** 6.1, 6.2, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 14.1, 15.1

**Deliverables:**

1. Create `packages/contracts/src/walkthrough.ts`:
   - `WalkthroughMode = 'default' | 'custom'`
   - `WalkthroughCustomConfig = { model: ModelRef | null; prompt: string }`
   - `WalkthroughConfig = { enabled: boolean; mode: WalkthroughMode; custom: WalkthroughCustomConfig }`
   - `MAX_WALKTHROUGH_PROMPT_BYTES = 16 * 1024`
   - `DEFAULT_WALKTHROUGH_PROMPT` (exact text from spec §9.5)
   - `createDefaultWalkthroughConfig(): WalkthroughConfig`

2. Create `packages/contracts/src/walkthrough-artifact.ts`:
   - `WalkthroughGenerationStatus = 'generating' | 'ready' | 'error'`
   - `WalkthroughErrorCode` union (all 14 codes from spec §7.1)
   - `WalkthroughError = { code: WalkthroughErrorCode; message: string }`
   - `WalkthroughArtifactBase` and discriminated union `WalkthroughArtifact` (version 1, three status variants)
   - `model` required on `ready`, optional on `generating`/`error`

3. Modify `packages/contracts/src/config.ts`:
   - Add `walkthrough?: WalkthroughConfig` to `PiwinConfig`
   - `createDefaultPiwinConfig()` includes `walkthrough: createDefaultWalkthroughConfig()`
   - `normalizeConfig()` fills missing `walkthrough` with default
   - `validatePiwinConfig()` validates: enabled is boolean, mode is 'default'|'custom', prompt trimmed non-empty, prompt UTF-8 bytes ≤ MAX_WALKTHROUGH_PROMPT_BYTES, custom.model non-null requires providerId/modelId/protocol non-empty, protocol in supported set

4. Modify `packages/contracts/src/session-transcript.ts`:
   - Add `model?: ModelRef` to `SessionTranscriptMessage`

5. Modify `packages/contracts/src/ipc.ts`:
   - Add `walkthrough/list`, `walkthrough/generate`, `walkthrough/cancel` to `HostCommand`
   - Add `walkthrough/updated` to `HostPush`
   - Add response data types per spec §8.2

6. Modify `packages/contracts/src/index.ts`:
   - Export all new walkthrough types and functions

7. Create `packages/contracts/src/walkthrough.test.ts`:
   - `createDefaultWalkthroughConfig()` returns enabled/default/default prompt
   - Config accepts three provider protocols
   - Empty prompt, over-limit prompt, invalid mode rejected by validate
   - WalkthroughArtifact three status field constraints
   - IPC command discriminator narrowing
   - Old config without `walkthrough` normalizes to default

8. Create `packages/contracts/src/walkthrough-artifact.test.ts`:
   - Artifact status variant field constraints
   - model required on ready, optional otherwise

9. Modify `packages/contracts/src/ipc.test.ts`:
   - Add walkthrough command/push discriminator tests

**Completion:** `pnpm --filter @piwin/contracts typecheck` and `pnpm --filter @piwin/contracts test` pass. Old config normalize passes. No new dependencies.

---

## Task 2: Agent Host — path functions and walkthrough store

**Spec sections:** 7.2, 14.2 (paths.ts, walkthrough-store.ts)

**Deliverables:**

1. Modify `packages/agent-host/src/paths.ts`:
   - `getPiwinSessionWalkthroughDir(rootDir: string, sessionId: string): string`
   - `getPiwinSessionWalkthroughPath(rootDir: string, sessionId: string, messageId: string): string`
   - Path traversal protection: sessionId and messageId cannot escape session dir (reject `..`, `/`, NUL)
   - Encode messageId safely for filename (e.g. base64url or sanitized)

2. Create `packages/agent-host/src/walkthrough-store.ts`:
   - `listWalkthroughs(rootDir, sessionId): Promise<WalkthroughArtifact[]>` — only valid version, skips orphans (message no longer in transcript)
   - `loadWalkthrough(rootDir, sessionId, messageId): Promise<WalkthroughArtifact | null>`
   - `saveWalkthrough(rootDir, sessionId, artifact: WalkthroughArtifact): Promise<void>` — atomic write, mkdir recursive
   - `deleteWalkthrough(rootDir, sessionId, messageId): Promise<void>`
   - `deleteSessionWalkthroughs(rootDir, sessionId): Promise<void>` — called on session delete
   - Raw evidence never persisted; only artifact metadata + markdown

3. Create `packages/agent-host/src/walkthrough-store.test.ts`:
   - Generates dir and JSON file
   - Atomic write then load round-trip
   - messageId cannot escape session dir
   - list returns only valid version artifacts
   - transcript not found → list returns empty
   - session delete removes walkthrough files
   - orphan artifact not returned by list
   - raw evidence not in saved file

**Completion:** `pnpm --filter @piwin/agent-host typecheck` and `pnpm --filter @piwin/agent-host test` pass. Store temp-dir tests pass.

---

## Task 3: Agent Host — evidence collection and source hashing

**Spec sections:** 9.1, 9.2, 9.3, 14.2 (walkthrough-source.ts), 15.2

**Deliverables:**

1. Create `packages/agent-host/src/walkthrough-source.ts`:
   - `WalkthroughEvidence` type (internal, spec §9.1)
   - `collectWalkthroughEvidence(messages, targetMessageId, plan?): WalkthroughEvidence` — pure function
   - Evidence collection per spec §9.2: find assistant message, find preceding user message, read tools from ToolPresentation, read plan, outcome must be 'completed', media only from validated paths under media root
   - `changedPaths` priority: tool presentation changedPaths → targetPaths → plan file ops → empty (never guess from text)
   - `redactAndBoundEvidence(evidence): { bounded: string; truncated: boolean }` — applies redactToolText semantics + byte limits per spec §9.3 table
   - `computeSourceHash(evidence): string` — SHA-256 or stable hash of bounded evidence
   - `assembleSystemPrompt(): string` — spec §9.4 constant
   - `assembleUserPrompt(mode, customPrompt, boundedEvidence): string` — default uses DEFAULT_WALKTHROUGH_PROMPT; custom wraps per spec §9.6 with evidence delimiter
   - Evidence delimiter: `<piwin-walkthrough-evidence>...</piwin-walkthrough-evidence>`
   - `isWalkthroughEligibleMessage(message, allMessages): boolean` — pure function per spec §11.4

2. Create `packages/agent-host/src/walkthrough-source.test.ts`:
   - Fixed transcript fixture, verify correct user/assistant pairing
   - Only target assistant message tools collected
   - changedPaths uses structured presentation
   - No changed paths → empty, no text guessing
   - Secret-like output replaced with `[redacted]`
   - Each field and total evidence respect byte limits
   - Plan status and steps correctly bounded
   - Media path only enters evidence if under media root
   - Source hash stable for same evidence, different for changed evidence
   - Prompt injection text in evidence only enters as data within delimiter
   - Eligibility: completed final assistant → true; streaming → false; failed/cancelled → false; empty assistant with tools → true; middle assistant → false; legacy no runId completed → true; old run message not target

**Completion:** All pure function tests pass. No real network dependency.

---

## Task 4: Agent Host — provider completion (three protocols)

**Spec sections:** 10.1, 10.2, 10.3, 10.4, 14.2 (walkthrough-completion.ts), 15.3

**Deliverables:**

1. Create `packages/agent-host/src/walkthrough-completion.ts`:
   - `WalkthroughCompletionRequest` type (provider, modelId, systemPrompt, userPrompt, maxOutputTokens, temperature, signal)
   - `WalkthroughCompletionResult = { text: string }`
   - `completeWalkthrough(request, dependencies?): Promise<WalkthroughCompletionResult>`
   - Reuse `buildProviderRequestHeaders()` and `createSecretResolver()` from existing provider utilities
   - OpenAI-compatible: base URL trailing slash removal, /v1 detection, POST /chat/completions, parse choices[0].message.content
   - Anthropic-compatible: /v1 detection, POST /messages, parse content[] first text part
   - Google Gemini: POST /models/{encoded modelId}:generateContent, x-goog-api-key header, parse candidates[0].content.parts[] text
   - Custom headers don't override protected auth headers
   - Error subclasses with stable `name`: provider-request-failed, provider-timeout, empty-output, cancelled, missing-credentials
   - Timeout 60s → provider-timeout; AbortSignal cancel → cancelled; finally cleanup timer
   - Output processing: trim, reject empty, remove NUL, 32 KiB UTF-8 cap with `[output truncated]`
   - Do NOT copy lightweight-completion.ts title-only logic; build a proper three-protocol service
   - If shared abstraction makes sense, create `provider-text-completion.ts` — but walkthrough-completion.ts is the entry point

2. Create `packages/agent-host/src/walkthrough-completion.test.ts`:
   - Stub fetch, no real network
   - OpenAI-compatible request URL, headers, body, response parse
   - Anthropic-compatible request URL, headers, body, response parse
   - Google Gemini request URL, x-goog-api-key, body, response parse
   - Custom headers don't override auth headers
   - HTTP 4xx/5xx → stable error, no response body leak
   - Malformed response → provider-request-failed
   - Empty text → empty-output
   - Timeout → provider-timeout
   - AbortSignal cancel → cancelled
   - Secret resolver called, secret not in error or log
   - maxOutputTokens and temperature use walkthrough defaults (4096, 0.2)

**Completion:** All stub fetch tests pass. No real network dependency.

---

## Task 5: Agent Host — host commands, generation state machine, wiring

**Spec sections:** 11.1, 11.2, 11.3, 11.4, 14.2 (walkthrough-commands.ts, config-store.ts, host-runtime.ts, host-command-context.ts, domain-command-dispatch.ts, index.ts, transcript-recorder.ts), 15.5

**Deliverables:**

1. Create `packages/agent-host/src/commands/walkthrough-commands.ts`:
   - `WalkthroughCommandContext` seam type (piwinRoot, push, loadTranscriptMessages, loadSessionPlan, loadConfig, resolveSessionModel)
   - `handleWalkthroughList(context, command): Promise<HostResponse>`
   - `handleWalkthroughGenerate(context, command): Promise<HostResponse>` — accepts immediately, publishes generating via push, runs completion async, publishes ready/error
   - `handleWalkthroughCancel(context, command): Promise<HostResponse>` — bypasses task queue, triggers AbortController
   - Generation state machine per spec §11.2
   - Concurrency: global in-flight map, same message max one generation, force only when not generating, old generation results discarded
   - Disabled config → reject with 'disabled'
   - Message not found → 'message-not-found'
   - Not eligible → 'not-eligible'
   - No provider/credentials → 'model-unavailable'/'missing-credentials'
   - Never calls SessionHandle.prompt(), steer(), followUp()

2. Modify `packages/agent-host/src/commands/host-command-context.ts`:
   - Add optional `walkthrough` service bag to HostCommandContext

3. Modify `packages/agent-host/src/commands/domain-command-dispatch.ts`:
   - Register walkthrough/list, walkthrough/generate, walkthrough/cancel handlers
   - walkthrough/cancel bypasses normal queue

4. Modify `packages/agent-host/src/config-store.ts`:
   - Ensure walkthrough config normalize/save works with new field

5. Modify `packages/agent-host/src/transcript-recorder.ts`:
   - Write model snapshot to assistant transcript message (spec §7.3)

6. Modify `packages/agent-host/src/host-runtime.ts`:
   - Provide WalkthroughCommandContext seam for both SDK and RPC adapters

7. Modify `packages/agent-host/src/index.ts`:
   - Export walkthrough store and command types as needed

8. Create `packages/agent-host/src/commands/walkthrough-commands.test.ts`:
   - Mock provider, fake transcript
   - All 12 test cases from spec §15.5
   - SDK and RPC both through same command contract
   - No new agent turn called

**Completion:** Host command tests pass. Cancel and late-result tests pass. No new agent turn. `pnpm --filter @piwin/agent-host typecheck` and `test` pass.

---

## Task 6: Desktop — chat state, host push, action button, card, document view, mock host

**Spec sections:** 5.1, 5.2, 5.3, 5.4, 5.5, 12.1, 12.2, 12.3, 12.4, 12.5, 14.3, 15.6

**Deliverables:**

1. Modify `apps/desktop/src/chat-reducer.ts`:
   - Add `walkthroughsByMessageId: Record<string, WalkthroughArtifact>` to ChatUiState
   - Add actions: `walkthrough/hydrate`, `walkthrough/updated`, `walkthrough/remove`
   - Session switch clears old map

2. Modify `apps/desktop/src/hooks/use-host-bootstrap.ts`:
   - Handle `walkthrough/updated` push → dispatch
   - On session load, call `walkthrough/list` to hydrate

3. Create `apps/desktop/src/walkthrough-action.tsx`:
   - Hover/focus reveals Generate Walkthrough button on eligible final assistant messages
   - Streaming → no button; completed final → button; middle assistant → no button; disabled config → no button
   - Click calls onGenerateWalkthrough(messageId)
   - Generating state → loading, disable repeat click
   - Ready → show card
   - Error → safe error message + Retry

4. Create `apps/desktop/src/walkthrough-card.tsx`:
   - Renders ready artifact markdown (source-only, no iframe/HTML execution)
   - View and Regenerate buttons
   - Safe markdown rendering

5. Modify `apps/desktop/src/chat-thread.tsx`:
   - Add walkthroughsByMessageId, onGenerateWalkthrough, onCancelWalkthrough props
   - Pass artifact to WalkthroughAction/WalkthroughCard per message
   - memo comparator includes walkthrough artifact ref, callback refs, enabled state

6. Modify `apps/desktop/src/App.tsx`:
   - handleGenerateWalkthrough, handleCancelWalkthrough callbacks
   - sessionDocuments derives Walkthrough doc items from walkthroughsByMessageId (virtual path `walkthroughs/<encoded-message-id>.md`)
   - Pass walkthrough props to ChatThread

7. Modify `apps/desktop/src/host-client-mock.ts`:
   - walkthrough/list returns deterministic artifacts
   - walkthrough/generate publishes generating then delayed ready
   - walkthrough/cancel publishes error(cancelled)
   - force overwrites
   - No provider → model-unavailable
   - No real network

8. Create `apps/desktop/src/walkthrough-action.test.tsx` and `apps/desktop/src/walkthrough-card.test.tsx`:
   - All 14 desktop component test cases from spec §15.6 (split across the two files as appropriate)

9. Modify `apps/desktop/src/styles/region-transcript.css` if needed for walkthrough card styling

**Completion:** Desktop component tests pass. `pnpm --filter @piwin/desktop typecheck` and `test` pass. Manual smoke feasible with mock host.

---

## Task 7: UI Kit — TextArea component

**Spec sections:** 6.3, 14.4

**Deliverables:**

1. Create `packages/ui-kit/src/textarea.tsx`:
   - Thin wrapper over native `<textarea>`
   - Controlled value/onChange
   - Props: label, description, testId, placeholder, disabled, maxLength (char count), error
   - Project token styles, no new UI runtime dependency
   - No Mantine import

2. Modify `packages/ui-kit/src/index.ts`:
   - Export TextArea

3. Create `packages/ui-kit/src/textarea.test.tsx`:
   - Renders controlled value
   - onChange fires
   - label/description/testId applied
   - disabled state
   - error display

**Completion:** `pnpm --filter @piwin/ui-kit typecheck` and `test` pass. No new dependency.

**Note:** This task can be done in parallel with Task 6 since it only touches ui-kit. But since SDD dispatches one implementer at a time, do this before or as part of Task 6 settings work. If Task 5 (settings) needs it, do this first. Actually — Settings (Task 8) needs TextArea. Do this task before Task 8.

---

## Task 8: Desktop — Settings UI for walkthrough configuration

**Spec sections:** 6.3, 14.3 (session-page.tsx, session-page.test.tsx)

**Deliverables:**

1. Modify `apps/desktop/src/settings/pages/session-page.tsx`:
   - Add Walkthrough section under Sessions & Context
   - Switch: Enable Walkthrough (default checked)
   - Select: Generation mode (Default / Custom)
   - Custom mode: Select for model list (flattened from all providers' models[], display `<provider name> / <model label or model id>`, value JSON-safe ModelRef)
   - Custom mode: ui-kit TextArea for prompt (Collapse wrapper, default expanded only when custom, switch to default retains draft)
   - Save success → existing transient info banner
   - No configured models → guide: "Add a model in Settings → Models first."
   - Prompt too long or model invalid → block save, field-level error
   - Only use @piwin/ui-kit components, no direct Mantine

2. Create `apps/desktop/src/settings/pages/session-page.test.tsx`:
   - Switch toggle works
   - Mode select switches between default/custom
   - Model select populates from providers
   - Prompt save works
   - Field-level errors for invalid prompt/model
   - Guide message when no models

**Completion:** Settings tests pass. enabled/default/custom/model/prompt end-to-end works. `pnpm --filter @piwin/desktop typecheck` and `test` pass.

**Dependency:** Requires Task 7 (TextArea) to be complete.

---

## Task 9: CLI — walkthrough commands

**Spec sections:** 13, 14.5, 15 (CLI tests)

**Deliverables:**

1. Create `apps/cli/src/walkthrough-command.ts`:
   - `piwin walkthrough list <session-id>` — table: message id, status, mode, generated time
   - `piwin walkthrough generate <session-id> <message-id>` — waits for walkthrough/updated(ready|error), prints markdown
   - `piwin walkthrough export <session-id> <message-id> [--output <path>]` — writes markdown only, no HTML; --output to user-specified path with existing file-write safety; stdout if no --output
   - Uses same Host commands as desktop

2. Create `apps/cli/src/walkthrough-command.test.ts`:
   - list output format
   - generate waits and prints
   - export to file and stdout
   - error handling

**Completion:** CLI tests pass. Full `pnpm typecheck` and `pnpm test` pass.

---

## Final Whole-Branch Review

After all tasks complete, run `pnpm typecheck` and `pnpm test` from root, then dispatch final code reviewer with full branch diff.
