# ADR 0066: Host-owned flashcard study rounds

| Field | Value |
|-------|-------|
| Status | **Implemented in tree — verification incomplete** (2026-08-30) |
| Date | 2026-08-30 |
| Scope | `@piwin/contracts`, `@piwin/flashcards`, `@piwin/host-runtime`, `@piwin/host-client`, `@piwin/host-server`, `@piwin/ui-kit`, `apps/desktop`, `apps/mobile`, `apps/cli` |
| Product | [2026-08-30 flashcard review workbench spec](../specs/2026-08-30-flashcard-review-workbench-spec.md) |
| Related | ADR 0018 (CardStore / review JSON), ADR 0054 (item vs review card), ADR 0037 (Mobile is a Host client) |
| Delivery | [2026-08-30 delivery notes](../evidence/2026-08-30-flashcard-review-workbench-delivery.md) |

This ADR is **not Accepted** and must not be read as 已上线. Desktop / Mobile / CLI study code is in the tree. Required dual-device evidence and visual fixtures have not been captured. See Status meaning.

## Status meaning

Implemented: unique CardStore; Host `flashcards/study/*`; durable `study/rounds` + `study/operations`; additive `ReviewState.revision`; Desktop study page; Mobile catalog + study pages; CLI `piwin study`; existing `fcws-tear-off` 200ms tear-off; Node-free `@piwin/flashcards/study-sequence` so Desktop Vite build passes.

Not verified, therefore not Accepted:

- Real-device V04 / V09 / V22 were **not run**. iOS simulator `Piwin Mobile Test` exists and is **Shutdown**. No isolated Host / `piwinRoot` fixture. `adb` is missing. No Android gen project. Do not claim dual-device video or a device pass.
- Visual fixture screenshots of private user cards were **not** captured (P0 blocker: no isolated Desktop against live `piwinRoot`).
- Root `pnpm typecheck` and `@piwin/mobile` build still fail on **pre-existing** `@piwin/artifact` / `splitMarkdownBlocks` / `htmlUiModeEnabled` errors. CLI / desktop / host-* typecheck pass. `@piwin/host-runtime` has 3 unrelated test failures (Plan-mode live command, Plan abort, RPC turn-authority e2e).

Promote to Accepted only after V04/V09/V22 on real devices, visual fixtures on isolated test cards, and the remaining automated gates the spec lists.

## Context

ADR 0018 stored cards as markdown under `~/.piwin/flashcards/cards/` and FSRS `ReviewState` as JSON under `review/`. ADR 0054 split disk items from derived review cards. Desktop already had a library plus a local `TearDeck` browse overlay (`index` / `revealed` were client state). Mobile flashcards were chat Q/A text. There was no durable round, no operation log, no cross-client resume, and no `ReviewState` write revision.

Owner required a study workbench around the **current** card UI: same Host, same CardStore, tear-off kept (`fcws-tear-off` 200ms, translate + rotate + fade). Not a second library, not a phone-local scheduler, not the discarded HTML prototype.

## Decision

### 1. One CardStore

Cards stay in `cards/`. ReviewState stays in `review/`. No second library, no phone-local FSRS, no Pi dependency from apps. `sequenceId` / `position` remain display order (ADR 0054). `ts-fsrs` is not upgraded in this change.

### 2. Host owns rounds and the operation log

New user data (not cache), lazy-created:

```text
~/.piwin/flashcards/
  cards/<itemId>.md
  review/<cardId>.json          # or <itemId>--cN.json
  study/rounds/<roundId>.json
  study/operations/<sequence>-<keyHash>.json
```

`keyHash` is a digest of the existing Host `idempotencyKey`. The raw key lives only inside the record. Directories are created on first write.

`@piwin/flashcards` serializes mutations on `flashcardsRoot`. Commit point is the durable operation record (target round + ReviewState already computed; Host timestamp frozen). Projection is temp-file + rename, then `applied`. Crash after commit, before ACK: startup replays stored targets in sequence order and does **not** re-sample FSRS. Corrupt logs isolate to `.corrupt` and raise `StudyStorageError`; progress is not wiped.

Old `flashcards/rate`, chat rating, and tool rating share the same ReviewState write service and lock. They may have no round, but they increment `revision`.

### 3. Additive ReviewState.revision

`ReviewState.revision` is optional. Missing in old files means **0**. Every write increments it. It is not an FSRS field. Undo restores business fields and still assigns a new revision / round revision so versions are monotonic (`controlEpoch` is not rolled back). If another round or the old rate path changed that card, undo conflicts instead of overwriting.

### 4. One protocol, three shells

Commands: `flashcards/study/catalog|start|get|claim|checkpoint|next|rate|undo|pause|resume|end|operation`. Capability: `host/status.capabilities.flashcardStudy` (absent = old Host → clients say 需要更新 Host).

Controller identity comes from the authenticated connection, not a request-body `deviceId`. Claim raises `controlEpoch`. Host commit happens before tear animation. `animationend` / `noteTransitionEnd` never send `rate` / `next`. `transitionId = roundId:revision`.

### 5. Keep the current card UI and tear-off

`@piwin/ui-kit` `FlashcardFace` + `TearDeckSurface` extract the existing faces and `fcws-tear-off` 200ms motion. No stacked Q/A prototype, no new card skin. Desktop library click opens the study page (`sequence`); 待复习 opens `scheduled`. Produce / delete stay on the gallery.

### 6. Intentional client differences (v1)

| Surface | Difference | Why |
|---------|------------|-----|
| Mobile source | Title + excerpt only; Host absolute paths stripped; never `doccards/open-source` | Phone must not pretend to open a Host-machine editor |
| Online-only | No Host → no new round, no batch rate, no second offline library | One progress authority |
| CLI `piwin study` | Same commands; explicit checkpoint before rate; **no tear animation, no touch** | Text interface; progress is the Host snapshot |

### 7. Compatibility

- Old card Markdown is **not** migrated. Missing `model` still decodes as `basic` (ADR 0054).
- Old ReviewState missing `revision` = 0.
- `study/` directories are lazy-created. Existing libraries keep working with no rewrite.

### 8. Rollback

- Reverting Desktop / Mobile / CLI **entries** must not delete `study/rounds` or `study/operations`.
- Do not attach an **old Host** that cannot safely read or complete the new operation log to a data root with unapplied logs.
- Before restoring an old Host binary: finish / verify log projection, then **backup** `~/.piwin/flashcards`.
- Frontend-only rollback leaves rounds on disk; the next new Host can resume them.

## Consequences

- Study progress is Host truth. Shells are projections. CLI has no animation on purpose.
- `sequence` never writes FSRS due/reps/lapses. `scheduled` uses existing `again/hard/good/easy`.
- 2026-08-27 “library click opens a local TearDeck browse / there is no independent study workbench” is outdated. Unique CardStore and original tear-off remain in force.
- P7 (device videos, visual fixtures, root typecheck) is **not** complete. This ADR stays unimplemented-as-released until those blockers clear.
