# Task 2 implementation report

## Result

- Status: `DONE_WITH_CONCERNS`
- Commit: `891b83a` (`feat: expose native search model capability`)
- The commit contains only the six Task 2 source/test files listed below. The existing unrelated worktree changes were not reset, cleaned, staged, or committed.

## Implementation

- `apps/desktop/src/model-configuration.ts:20-42` extends `ModelConfigurationDraft` with `supportsNativeWebSearch` and `nativeWebSearchMode`.
- `apps/desktop/src/model-configuration.ts:73-90` derives native-search support with `modelSupportsCapability()` and resolves the mode with `resolveNativeWebSearchMode()`.
- `apps/desktop/src/model-configuration.ts:130-147` persists the native-search capability and top-level mode only when enabled.
- `apps/desktop/src/model-configuration.ts:197-229` replaces the owned native-search capability and removes stale top-level mode and `routes['native-web-search']` metadata when disabled, while preserving unrelated routes.
- `apps/desktop/src/model-edit-inline.tsx:164-211` adds localized native-search labels and the always-on explanation (`external-only` cannot disable an always-enabled provider feature).
- `apps/desktop/src/model-edit-inline.tsx:358-398` adds the native-search checkbox and conditional controllable/always-on select, with the requested test IDs and disabled-state handling.
- `apps/desktop/src/model-edit-inline.tsx:486-503` includes the new fields in save-round-trip draft equality.
- `apps/desktop/src/ModelWorkbench.tsx:283-294` renders the `Native search`/`内置搜索` model pill with `data-testid="model-pill-native-search-{model.id}"` when the capability is present.
- `apps/desktop/src/desktop-locale.ts:389-393,1119-1125` adds the English and Simplified Chinese native-search editor copy.
- `apps/desktop/src/model-configuration.test.ts:324-362` covers round-tripping always-on native search and cleanup of stale native-search metadata/routes.
- `apps/desktop/src/model-edit-inline.test.tsx:115-189` covers the checkbox, always-on select/description, absent-capability selector behavior, and model-workbench badge.

No change was made to `apps/desktop/src/styles/region-settings-models.css`; the existing layout supports the additional capability and select without a product-specific wrapping rule.

## Verification

Commands run:

1. `pnpm --filter @piwin/desktop test -- src/model-configuration.test.ts src/model-edit-inline.test.tsx`
   - PASS: 2 test files, 30 tests.
   - Vitest output included the existing React warning from the catalog hydration test: `An update to ModelEditInline inside a test was not wrapped in act(...)`.
2. `pnpm --filter @piwin/desktop typecheck`
   - PASS: `tsc -b --pretty false`.
3. `git diff HEAD^ HEAD --check`
   - PASS for the committed Task 2 diff.

The initial full-worktree `git diff --check` also reported a pre-existing blank line at `packages/host-runtime/src/provider-model-discovery.ts:270`; that unrelated file was not changed by Task 2.

## Staging and unrelated changes

`git show --format= --name-only 891b83a` reports exactly:

- `apps/desktop/src/ModelWorkbench.tsx`
- `apps/desktop/src/desktop-locale.ts`
- `apps/desktop/src/model-configuration.test.ts`
- `apps/desktop/src/model-configuration.ts`
- `apps/desktop/src/model-edit-inline.test.tsx`
- `apps/desktop/src/model-edit-inline.tsx`

`apps/desktop/src/desktop-locale.ts` had pre-existing unrelated session/sidebar copy hunks. Those hunks remain unstaged in the worktree; only the native-search translator type/value hunks were staged and committed. The pre-existing changes in `apps/desktop/src/styles/region-settings-models.css` and all other unrelated files likewise remain untouched and unstaged.

## Concerns

1. The current uncommitted settings composition routes the visible models page through `ProviderSettings`/`ProviderRow`; `ModelWorkbench.tsx` is not currently imported elsewhere in the repository. The badge was added to the explicitly requested `ModelWorkbench.tsx`, but the current ProviderRow surface will need a follow-up if the badge must appear there too. `provider-row.tsx` was intentionally not touched because it was outside the Task 2 file list and contains unrelated settings work.
2. The focused test suite passes but retains the pre-existing React `act(...)` warning described above.
3. The worktree still contains extensive unrelated modifications and untracked files; they were preserved as requested. The report itself is intentionally not part of commit `891b83a` because the brief's Task 2 staging list did not include it and the report records the already-created commit hash.

## Follow-up fix: visible ProviderRow native-search chip

- `apps/desktop/src/provider-row.tsx:2,56-109` now uses `modelSupportsCapability()` in the owning visible `modelCaps()` helper, exports that pure helper for focused coverage, and adds the existing `provider-capchip` pattern with localized `Native search` / `内置搜索` labels.
- `apps/desktop/src/provider-row.test.ts:1-25` covers the native-search chip shape and both localized labels without mounting the full provider settings surface.
- The `ModelWorkbench.tsx` native-search badge from `891b83a` was retained unchanged.

## Follow-up verification

1. `pnpm --filter @piwin/desktop test -- src/provider-row.test.ts`
   - PASS: 1 test file, 1 test.
2. `pnpm --filter @piwin/desktop typecheck`
   - PASS: `tsc -b --pretty false`.

## Follow-up concerns

1. The prior Task 2 focused suite's pre-existing React `act(...)` warning remains unchanged; this follow-up's focused pure-helper test emits no warning.
2. The follow-up commit intentionally stages only `apps/desktop/src/provider-row.tsx` and `apps/desktop/src/provider-row.test.ts`; this report append and all unrelated worktree changes remain unstaged.
