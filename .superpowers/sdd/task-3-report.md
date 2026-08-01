# Task 3 Report: Agent Host — Evidence Collection and Source Hashing

## What I Implemented

Created `packages/agent-host/src/walkthrough-source.ts` with all deliverables from the task brief:

### 1. `WalkthroughEvidence` type (spec §9.1)
Internal type with `sessionId`, `messageId`, `runId?`, `userRequest`, `assistantResponse`, `outcome: 'completed'`, `changedPaths`, `tools[]`, `plan?`, `media[]`. Exported for use by other agent-host modules.

### 2. `collectWalkthroughEvidence(messages, targetMessageId, options)` (spec §9.2)
Pure function that:
- Finds the target assistant message by ID
- Pairs it with the most recent preceding user message
- Reads structured tool data from `ToolPresentation` (summary, command, changedPaths, exitCode, output, error)
- Reads optional `SessionPlan` evidence (id, title, goal, status, steps with detail)
- Enforces `outcome === 'completed'` (throws on failed/cancelled; undefined treated as completed for legacy)
- `changedPaths` priority: tool presentation `changedPaths` → `targetPaths` → plan file ops → empty (never guessed from text)
- Media: `[]` for MVP (no structured media references in current types; does not scan media directory)

### 3. `redactAndBoundEvidence(evidence)` (spec §9.3)
Returns `{ bounded: string; truncated: boolean }`:
- Applies `redactToolText()` semantics to all text fields (secrets → `[redacted]`)
- Enforces per-field byte limits using `TextEncoder` (browser-safe):
  - userRequest: 16 KiB, assistantResponse: 24 KiB
  - per tool field (summary/output/error/command): 4 KiB
  - total tool output: 32 KiB (budget tracked across tools)
  - changedPaths: max 256 entries, each path max 1 KiB
  - plan fields: 4 KiB each, max 32 steps
  - total evidence: 64 KiB
- Truncated fields get `[truncated]` appended
- Returns JSON-serialized bounded evidence string

### 4. `computeSourceHash(evidence)` / `computeSourceHashFromBounded(bounded)`
SHA-256 hash (hex) of the bounded evidence string. Stable for same evidence, differs for changed evidence.

### 5. `assembleSystemPrompt()` (spec §9.4)
Returns the constant system prompt text exactly as specified — untrusted data boundary, no tool execution, facts-only, no secrets, Markdown only.

### 6. `assembleUserPrompt(mode, customPrompt, boundedEvidence)` (spec §9.5, §9.6)
- `default` mode: `DEFAULT_WALKTHROUGH_PROMPT` + evidence in `<piwin-walkthrough-evidence>` delimiter
- `custom` mode: user's custom prompt + data-warning line + evidence in delimiter
- Evidence always wrapped in delimiter regardless of mode

### 7. `isWalkthroughEligibleMessage(message, allMessages)` (spec §11.4)
Pure eligibility function:
- Must be `assistant` role, `status === 'done'`
- `outcome` must not be `failed` or `cancelled`
- Must be the final assistant message of its run (no later assistant with same `runId`)
- Legacy (no `runId`): must be the last assistant message overall
- Messages with `runId` but no `outcome` require `endedAt`
- Must have non-empty text or at least one tool

### 8. `isMediaPathUnderMediaRoot(path, mediaRoot, sessionId)`
Pure path-validation helper. Checks prefix match AND rejects `..` traversal segments.

## What I Tested and Results

**54 tests** in `walkthrough-source.test.ts`, all passing:

### collectWalkthroughEvidence (13 tests)
- Correct user/assistant pairing
- Only target assistant message tools collected
- changedPaths uses structured presentation (changedPaths priority over targetPaths)
- changedPaths falls back to targetPaths
- changedPaths empty when no structured paths (no text guessing)
- Throws on missing/non-assistant/failed/cancelled target
- Plan evidence included/omitted correctly
- runId included when present
- Media empty for MVP
- Legacy messages without runId handled

### redactAndBoundEvidence (14 tests)
- Small evidence: truncated=false, valid JSON
- Secret-like output replaced with `[redacted]` (API keys, bearer tokens)
- Per-field byte limits enforced (userRequest 16K, assistantResponse 24K, tool output 4K)
- Total tool output budget (32K across multiple tools)
- changedPaths: max 256 entries, per-path 1K
- Plan title/goal/steps bounded, max 32 steps
- Total evidence 64K limit
- Structure preserved in bounded output

### computeSourceHash (3 tests)
- Stable for same evidence
- Different for changed evidence
- `computeSourceHashFromBounded` matches `computeSourceHash`

### assembleSystemPrompt / assembleUserPrompt (4 tests)
- System prompt contains spec §9.4 constants
- Default mode uses DEFAULT_WALKTHROUGH_PROMPT + delimiter
- Custom mode uses custom prompt + data warning + delimiter
- Evidence always wrapped in delimiter

### isWalkthroughEligibleMessage (12 tests)
- Completed final assistant → true
- Streaming → false
- Failed/cancelled → false
- Empty assistant with tools → true
- Empty assistant without tools → false
- Middle assistant in same run → false
- Legacy no runId completed → true
- Legacy non-last assistant → false
- Old run message not demoted by new run (middle=false, final=true)
- runId without outcome+no endedAt → false
- runId without outcome+with endedAt → true
- Non-assistant → false, error status → false

### isMediaPathUnderMediaRoot (5 tests)
- Valid path under media root → true
- Different session → false
- Outside media root → false
- Empty path → false
- Path traversal (`..`) → false

### Prompt injection safety (1 test)
- Injection text in evidence appears only within delimiter, not before it
- Secrets redacted even inside evidence

## TDD Evidence

Tests were written alongside implementation. Initial run had 2 failures (RED):
1. Bearer token test: regex only replaces `Bearer <token>`, not the `Authorization: ` prefix — fixed test assertion to match actual redaction behavior
2. Path traversal test: `startsWith` check allowed `..` segments — fixed `isMediaPathUnderMediaRoot` to reject `..` in path remainder

After fixes: all 54 tests pass (GREEN).

## Files Changed

- **Created:** `packages/agent-host/src/walkthrough-source.ts` (implementation, ~750 lines)
- **Created:** `packages/agent-host/src/walkthrough-source.test.ts` (tests, ~1090 lines)
- **Modified:** `packages/agent-host/src/index.ts` (added exports for walkthrough-source functions and types)

## Self-Review Findings

1. **Purity:** All functions are pure — no FS, no network, no side effects. Only `computeSourceHash` uses `node:crypto` (as noted in the brief). ✓
2. **Byte length:** Uses `TextEncoder().encode(str).length` consistently, not `Buffer.byteLength`. ✓
3. **ESM imports:** All relative imports use `.js` extensions. ✓
4. **TypeScript strict:** No `any`, no non-null assertions without runtime checks, `exactOptionalPropertyTypes` respected (optional fields only set when values exist). ✓
5. **Secret redaction:** Reuses `redactToolText` from `tool-presentation.ts` as specified. ✓
6. **Evidence delimiter:** `<piwin-walkthrough-evidence>...</piwin-walkthrough-evidence>` used consistently. ✓
7. **changedPaths priority:** Correctly implements changedPaths → targetPaths → plan → empty. The plan file ops source yields nothing for MVP since `SessionPlan` has no structured file-path field (step `detail` is free text and must not be parsed). ✓
8. **Media MVP:** Returns `[]` when no media references. Does not scan media directory. Path validation helper exported for future use. ✓
9. **Eligibility:** Covers all §11.4 test cases including legacy messages, runId-without-outcome, and multi-run scenarios. ✓

## Concerns

1. **`collectWalkthroughEvidence` signature:** The brief specified `collectWalkthroughEvidence(messages, targetMessageId, plan?)` but the evidence type requires `sessionId`. I used an options object `CollectWalkthroughEvidenceOptions` with `sessionId` (required), `plan?`, and `mediaRoot?` to avoid positional parameter ambiguity. This is a minor deviation from the brief's stated signature but is necessary for the evidence type and keeps the API clean.

2. **Plan file ops for changedPaths:** `SessionPlan` has no structured file-path field. The spec mentions "Plan 或 compaction file operation 中已经明确记录的路径" but compaction file ops are not available in the function's inputs. This source yields nothing for MVP, which is consistent with "没有证据时为空" but means changedPaths can only come from tool presentations in the current implementation.

3. **`_truncated` internal field pattern:** The bounding functions use a temporary `_truncated` boolean field on returned objects that is stripped before building the final evidence. This is a pragmatic approach to track truncation across nested structures. An alternative would be returning tuples, but that would make the code more verbose for little benefit.

## Review Fix Report

### Finding 1 (Important): — Custom prompt 16 KiB limit not enforced

**File:** `packages/agent-host/src/walkthrough-source.ts` (`assembleUserPrompt`)

`LIMITS.customPrompt = 16 * KIB` was declared but never used. `assembleUserPrompt` interpolated `customPrompt` directly without bounding.

**Fix:** In `assembleUserPrompt`, when `mode === 'custom'`, the custom prompt is now passed through `truncateToBytes(customPrompt, LIMITS.customPrompt)` before interpolation. When truncated, the `[truncated]` marker (appended by `truncateToBytes`) is included. The `LIMITS.customPrompt` constant is now actually exercised.

**Test added:** `custom mode truncates oversized custom prompt to 16 KiB` — verifies a 20 KiB custom prompt is bounded to ≤16 KiB + marker and contains `[truncated]`, while the evidence delimiter remains intact. Also added `custom mode does not truncate prompts under 16 KiB` to confirm the non-truncation path.

### Finding 2 (Important) — Plan fields not redacted

**File:** `packages/agent-host/src/walkthrough-source.ts` (`boundPlan`, `boundMedia`)

`boundPlan` only truncated plan fields but never called `redactToolText`. `boundMedia` likewise did not redact media labels. Plan `goal` and step `detail` (and title/status) are agent-generated free text that could contain secrets.

**Fix:** `boundPlan` now applies `redactToolText(...)` to `title`, `goal`, `status`, step `title`, step `status`, and step `detail` before truncation. `boundMedia` now applies `redactToolText(...)` to media `label` before truncation. The redaction-then-truncation order matches the existing pattern used for tool fields in `boundToolEntry`.

**Tests added:**
- `redacts secrets in plan title, goal, and step detail` — seeds plan fields with `API_KEY=...`, `token=...`, and `Bearer ...` and asserts the secret values are gone and `[redacted]` is present in the bounded output.
- `redacts secrets in media labels` — seeds a media label with `API_KEY=sk-media-secret` and asserts the secret is gone and `[redacted]` is present.

### Test Results

- `pnpm --filter @piwin/agent-host typecheck` — exit 0 (clean).
- `pnpm --filter @piwin/agent-host test` — 58 test files, 463 tests, all passing.
  - `src/walkthrough-source.test.ts`: 58 tests (was 54; +4 new tests), all passing.

### Files Changed

- `packages/agent-host/src/walkthrough-source.ts` — `assembleUserPrompt` custom prompt bounding; `boundPlan` redaction; `boundMedia` label redaction.
- `packages/agent-host/src/walkthrough-source.test.ts` — 4 new tests.

