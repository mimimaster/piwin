# Task 2 Report — Agent Host: path functions and walkthrough store

## What I implemented

### 1. `packages/agent-host/src/paths.ts`
- Added `assertSafePathSegment(id, label)` helper: rejects empty, `.`, `..`, `/`, `\`, and NUL bytes. Throws on violation so traversal payloads can never be silently persisted.
- Added `encodeMessageIdForFilename(messageId)` helper: base64url-encodes the messageId into a filesystem-safe, collision-free filename component (no `/`, `+`, `=`). Decoding is not required — we only need a unique messageId → filename mapping.
- `getPiwinSessionWalkthroughDir(rootDir, sessionId): string` — returns `<root>/sessions/<sessionId>/walkthroughs/`, validating `sessionId`.
- `getPiwinSessionWalkthroughPath(rootDir, sessionId, messageId): string` — returns the encoded JSON path, validating both `sessionId` and `messageId`.
- Validation is scoped to the new walkthrough functions only; the existing `getPiwinSessionDir` is left unchanged so no existing callers are affected.

### 2. `packages/agent-host/src/walkthrough-store.ts`
- `listWalkthroughs(rootDir, sessionId): Promise<WalkthroughArtifact[]>` — loads the transcript to get valid message IDs; if the transcript is missing or unreadable, returns `[]`. Reads the walkthroughs dir, parses each `.json`, keeps only `version === 1` artifacts whose `messageId` still exists in the transcript (skips orphans). Unparseable / non-artifact files are skipped.
- `loadWalkthrough(rootDir, sessionId, messageId): Promise<WalkthroughArtifact | null>` — reads a single artifact file, returns `null` if missing or invalid.
- `saveWalkthrough(rootDir, sessionId, artifact): Promise<void>` — `mkdir { recursive: true }` then atomic write (write to `<path>.tmp` then `rename`). Only artifact metadata + markdown are written; the store has no raw-evidence fields.
- `deleteWalkthrough(rootDir, sessionId, messageId): Promise<void>` — removes a single artifact file; no-op if missing.
- `deleteSessionWalkthroughs(rootDir, sessionId): Promise<void>` — removes the entire walkthroughs directory recursively; no-op if missing (called on session permanent delete).

### 3. `packages/agent-host/src/index.ts`
- Exported `getPiwinSessionWalkthroughDir`, `getPiwinSessionWalkthroughPath` from `./paths.js`.
- Exported `listWalkthroughs`, `loadWalkthrough`, `saveWalkthrough`, `deleteWalkthrough`, `deleteSessionWalkthroughs` from `./walkthrough-store.js`.

## What I tested and results

`packages/agent-host/src/walkthrough-store.test.ts` (13 tests, all passing):
1. saveWalkthrough creates dir and JSON file
2. round-trips an artifact via save then load
3. loadWalkthrough returns null when file does not exist
4. messageId cannot escape session dir (path traversal rejected) — covers `..`, `/`, NUL for both sessionId and messageId
5. listWalkthroughs returns only valid-version artifacts (a `version: 99` file is ignored)
6. listWalkthroughs returns empty when transcript not found
7. listWalkthroughs skips orphan artifacts (message no longer in transcript)
8. raw evidence is not present in saved file (asserts no `rawEvidence`/`toolOutput` keys, only `markdown`)
9. deleteWalkthrough removes the artifact file
10. deleteWalkthrough is a no-op when file missing
11. deleteSessionWalkthroughs removes the walkthroughs directory
12. deleteSessionWalkthroughs is a no-op when dir missing
13. saveWalkthrough overwrites existing artifact for same messageId

Tests use `mkdtemp` + `tmpdir()` per the existing `config-store.test.ts` pattern.

## TDD evidence

Implemented tests alongside the store (tests written immediately after the implementation file, then run RED→fixed narrowing issues→GREEN). Final state: 13/13 green.

## Verification

- `pnpm --filter @piwin/agent-host typecheck` → pass (exit 0)
- `pnpm --filter @piwin/agent-host test` → 57 files / 401 tests pass (exit 0), including the new `walkthrough-store.test.ts` (13 tests) and existing `paths.test.ts`.

## Files changed
- `packages/agent-host/src/paths.ts` (modified — added 2 functions + 2 helpers)
- `packages/agent-host/src/walkthrough-store.ts` (new)
- `packages/agent-host/src/walkthrough-store.test.ts` (new)
- `packages/agent-host/src/index.ts` (modified — added exports)

## Self-review findings
- Path traversal protection is scoped to the new walkthrough path functions only, leaving the shared `getPiwinSessionDir` behavior unchanged (no risk to existing callers).
- Atomic write uses temp-file + `rename` on the same filesystem (same directory), which is atomic on POSIX/NTFS.
- `listWalkthroughs` loads the transcript to derive valid message IDs; a missing/unparseable transcript yields `[]` (matches spec §7.2 "transcript truncate 后，指向已不存在消息的 Artifact 不再返回"). Orphan files are skipped, not deleted, in this task; spec notes Host may clean orphans on next write — that cleanup is deferred to the generation task.
- The store never persists raw evidence: `WalkthroughArtifact` carries only `markdown` and metadata; no `rawEvidence`/`toolOutput` fields exist on the type.
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` satisfied (typed the ready-artifact helper as `Extract<WalkthroughArtifact, { status: 'ready' }>`).

## Concerns
- None blocking. Orphan file cleanup-on-write is intentionally deferred to the generation task per spec wording.
