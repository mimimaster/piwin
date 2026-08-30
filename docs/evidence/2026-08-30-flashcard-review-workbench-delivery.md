# Flashcard review workbench — delivery notes

| Field | Value |
|-------|-------|
| Date | 2026-08-30 |
| Branch | `feat/flashcard-review-workbench` (merge-base `8253db51`) |
| Spec | [2026-08-30-flashcard-review-workbench-spec.md](../specs/2026-08-30-flashcard-review-workbench-spec.md) |
| ADR | [0066](../adr/0066-host-owned-flashcard-study-rounds.md) — **Implemented in tree — verification incomplete** |
| P7 | **Not complete.** Dual-device videos, visual fixtures, and full typecheck/device matrix are missing. Do not treat this file as a release sign-off. |

## What is in the tree

- Desktop study page (library tile/set → `sequence`; 待复习 → `scheduled`)
- Mobile catalog `#flashcards` + study `#flashcards/study/<roundId>`
- CLI `piwin study` (alias `piwin cards study`) against the same Host
- Host `flashcards/study/*`; durable `study/rounds` + `study/operations`
- Additive `ReviewState.revision` (missing = 0)
- Existing card UI and `fcws-tear-off` 200ms tear-off kept
- Unique CardStore (`cards/` + `review/`)
- Desktop Vite build **passes** after Node-free `@piwin/flashcards/study-sequence`

## What is not claimed

- Dual-device continuous-learning video
- Tear-off video on device
- Before/after card-face screenshots (P0 visual fixtures not captured)
- V04 / V09 / V22 real-device pass
- Root `pnpm typecheck` green
- Mobile production build green
- P7 complete / 已上线

## Release blockers (with repro)

### 1. Real-device V04 / V09 / V22 not run

Required by spec §11 and plan V04 (Mobile back / lock), V09 (cross-device claim), V22 (small screen / landscape / keyboard).

Repro / environment:

```text
xcrun simctl list devices | grep -i 'Piwin Mobile Test'
# observed: simulator exists, state Shutdown
which adb
# observed: adb missing
ls apps/mobile/src-tauri/gen
# observed: no Android gen project
```

No isolated Host / `piwinRoot` fixture was started. `tauri ios dev` against the live user Host was not run. Happy-dom unit tests of `popstate` are **not** a device pass.

### 2. Visual fixtures not captured

P0 required Desktop screenshots of single front/back, three-card set first/mid/last, long Markdown, theme switch, and a tear recording, using **fixed test cards** (not private user cards). Blocker: no isolated fixture Desktop launched against a dedicated `piwinRoot`. Private library cards were not (and must not be) captured.

### 3. Root typecheck / Mobile build (pre-existing)

```bash
pnpm typecheck
# FAIL: recursive stop on @piwin/mobile
# pre-existing @piwin/artifact / splitMarkdownBlocks / htmlUiModeEnabled

pnpm --filter @piwin/mobile build
# FAIL: same tsc -b errors
```

CLI, desktop, host-runtime, host-client typecheck **pass**. These artifact errors are not introduced by study files.

## Automated results (from P6 matrix)

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | FAIL | Mobile pre-existing artifact types |
| `pnpm --filter @piwin/contracts test` | PASS | 393 |
| `pnpm --filter @piwin/flashcards test` | PASS | 107 |
| `pnpm --filter @piwin/host-runtime test` | FAIL 3 | 1780 / 1783; unrelated (Plan-mode live command, Plan abort, RPC turn-authority e2e) |
| `pnpm --filter @piwin/host-client test` | PASS | 45 |
| `pnpm --filter @piwin/host-transport test` | PASS | 34 |
| `pnpm --filter @piwin/host-server test` | PASS | 163 |
| `pnpm --filter @piwin/ui-kit test` | PASS | 51 |
| `pnpm --filter @piwin/desktop test` | FAIL 40 | Pre-existing shells; **flashcard study suites 53 passed** |
| `pnpm --filter @piwin/mobile test` | FAIL 4 | Pre-existing artifact/surfaces; **flashcard pages 31 passed** |
| `pnpm --filter @piwin/cli test` | PASS | 152 (includes study verbs) |
| `pnpm --filter @piwin/mobile build` | FAIL | Same pre-existing `tsc -b` |
| `pnpm --filter @piwin/desktop build` | PASS | After `study-sequence` export; `tsc -b && vite build` |

Desktop Playwright study e2e was **not** added (`apps/desktop/e2e` is in-browser mock Host without `flashcards/study/*`).

## Compatibility

- Old card Markdown is not migrated. Missing `model` still decodes as `basic`.
- Old `ReviewState` missing `revision` is **0**.
- `study/rounds` and `study/operations` are lazy-created on first write. Existing `cards/` + `review/` keep working with no rewrite.

## Rollback

1. Reverting Desktop / Mobile / CLI study **entries** must not delete `~/.piwin/flashcards/study/`.
2. Do not run an old Host that cannot safely read or complete the new operation log against a root with unapplied logs.
3. Before restoring an old Host: verify projections (`applied` operations), then backup:

```bash
cp -a ~/.piwin/flashcards ~/.piwin/flashcards.bak-$(date +%Y%m%d)
```

4. Frontend-only rollback leaves rounds on disk; a newer Host can resume them.

## Intentional v1 differences

- Mobile source preview is excerpt + title only; Host absolute paths stripped; never `doccards/open-source`.
- Online-only: no Host → no new round / no batch rate / no second library.
- CLI has no tear animation and no touch. Progress is the Host snapshot. Checkpoint before `rate`.

## Key files (not exhaustive)

| Area | Path |
|---|---|
| Spec | `docs/specs/2026-08-30-flashcard-review-workbench-spec.md` |
| ADR | `docs/adr/0066-host-owned-flashcard-study-rounds.md` |
| Contracts | `packages/contracts/src/flashcard-study.ts`, `flashcard-study-commands.ts` |
| Domain | `packages/flashcards/src/study-service.ts`, `study-transaction.ts`, `study-round-reducer.ts` |
| Host | `packages/host-runtime/src/commands/flashcard-study-commands.ts` |
| Controller | `packages/host-client/src/flashcard-study-controller.ts` |
| UI extract | `packages/ui-kit/src/flashcard-face.tsx`, `tear-deck-surface.tsx`, `flashcards.css` |
| Desktop | `apps/desktop/src/workspace-subpages/flashcards/study/` |
| Mobile | `apps/mobile/src/surfaces/flashcards/` |
| CLI | `apps/cli/src/study-command.ts` |

`docs/plans/` is gitignored. Do not force-add the execution plan.

## Line counts (`wc -l`)

New feature sources on this branch are all **under 1000**. Largest new files:

| Lines | File |
|------:|------|
| 603 | `apps/cli/src/study-command.test.ts` |
| 593 | `packages/contracts/src/flashcard-study-commands.ts` |
| 585 | `packages/flashcards/src/study-round-reducer.test.ts` |
| 584 | `packages/host-client/src/flashcard-study-controller.ts` |
| 525 | `packages/flashcards/src/study-service.ts` |
| 522 | `apps/cli/src/study-command.ts` |
| 519 | `apps/desktop/.../study/FlashcardStudyView.tsx` |
| 519 | `apps/mobile/src/surfaces/flashcards/FlashcardStudyPage.tsx` |
| 512 | `packages/flashcards/src/study-crash-recovery.test.ts` |
| 472 | `packages/flashcards/src/study-round-reducer.ts` |
| 460 | `packages/contracts/src/ipc-platform-commands.ts` (P0 split) |
| 447 | `packages/contracts/src/ipc-session-commands.ts` (P0 split) |
| 407 | `packages/ui-kit/src/flashcards.css` |

Pre-existing files this branch touched that were already over 1000 at merge-base, and stay over:

| Now | Base | File | This-branch delta |
|----:|-----:|------|-------------------|
| 1024 | 1010 | `packages/host-runtime/src/host-runtime.ts` | +16 composition |
| 1350 | 1349 | `packages/host-server/src/remote-projection.ts` | +1 |
| 3432 | 3396 | `apps/cli/src/index.ts` | +38 thin dispatch |

`packages/contracts/src/ipc.ts` was 1633 and is now a 6-line re-export (P0 split). `packages/host-server/src/host-server.ts` is 998 (was 993).

## Known limits (parked, not claimed fixed)

- Process-local study lock only (not cross-process).
- Operation lookup: legacy records without `principalId` still resolve for any authenticated caller.
- Desktop study Playwright e2e not added.
- `needsReview` completed-copy count is session-local (Host snapshot has no aggregate field).
- Several study shells sit over the 400-line planning hint and under 1000.

## Commits (implementation, `8253db51..1167bd4f`)

`de0f2690` spec · `2520376d` ipc split · `b571d9de` review-state extract · `d947a8ca` study contracts · `b801b3fb` sequence/catalog/reducer · `138a7f46` undo/paused gate · `c7698e02` durable rounds · `36d4f77f` review-write-service · `0c4c3c48` rate through root lock · `17cded52` recover/onApplied · `1b91d44a` ui-kit extract · `b80a44ac` Host commands · `0526d6da` controller · `0c13e936` stale pending · `a3391139` needsReview checkpoint · `f0d38208` Desktop page · `0aa77b1a` under-shell/keys/scroll · `be2c4237` Mobile pages · `9e949c18` pause on back / IME · `64373c1d` CLI · `1167bd4f` study-sequence export
