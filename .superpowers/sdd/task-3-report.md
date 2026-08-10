# Task 3 implementation report

## Result

- Status: `DONE`
- Commit: `e4fe9ee` (`feat: add search route settings`)
- The commit contains only the seven Task 3 files listed below. Existing unrelated Desktop, Host, contract, docs, and other worktree changes were preserved and were not reset, cleaned, or committed.

## Implementation

- `apps/desktop/src/settings/web-draft.ts:5-8,26-29,40-44,74-78` imports the typed `SearchRoutePolicy` and `DEFAULT_SEARCH_ROUTE_POLICY`, adds `DraftWeb.searchRoutePolicy`, defaults legacy Web configs to `external-first`, and persists the typed policy through `draftToWeb()`.
- `apps/desktop/src/settings/web-draft.test.ts:20,35-46` adds the `native-first` sample policy and covers native/external policy round-trip plus migration of a legacy config without a policy to `external-first`.
- `apps/desktop/src/settings/search-route-status.tsx:5-79` adds `SearchRouteStatus`, which consumes `SearchRoutePreviewData` from Host and displays the selected backend, fallback, model, issues, incompatibility notice, localized English/Chinese labels, and warning tones without resolving a route itself.
- `apps/desktop/src/settings/pages/web-page.tsx:5-29,84-157` derives a secret-free `SearchRoutePreviewInput` from the existing draft and requests `web/search-route-preview` through the typed Settings request surface after a 150 ms debounce. Cleanup ignores stale responses, successful previews remain visible while a newer request is pending, and request failures use a non-blocking localized warning.
- `apps/desktop/src/settings/pages/web-page.tsx:440-472` adds the localized four-option route-policy selector and Host-derived status above Advanced search settings. Existing Web source/fetch controls, save behavior, and `Changes apply to new sessions` copy remain in place.
- `apps/desktop/src/settings/pages/web-page.test.tsx:1-296` adds component coverage with `SettingsProvider`, `DesktopLocaleProvider`, and `PiwinUiProvider`: default selector value, native Host preview, debounced `native-only` request input, and incompatible warning status.
- `apps/desktop/src/desktop-locale.ts:296-304,988-1001` adds localized Web route selector/description/error copy to the existing Desktop translator, without staging the pre-existing unrelated locale hunks.
- `apps/desktop/src/styles/settings-resources.css:1107-1144` adds product-specific route selector and status layout styling to the existing Web settings stylesheet.

No Host implementation was changed. The existing Task 1 `web/search-route-preview` contract/request adapter is used as the route authority.

## Verification

Commands run:

1. `pnpm --filter @piwin/desktop test -- src/settings/web-draft.test.ts src/settings/pages/web-page.test.tsx`
   - PASS: 2 test files, 16 tests.
2. `pnpm --filter @piwin/desktop typecheck`
   - PASS: `tsc -b --pretty false`.
3. `pnpm exec prettier --check apps/desktop/src/settings/web-draft.ts apps/desktop/src/settings/web-draft.test.ts apps/desktop/src/settings/pages/web-page.tsx apps/desktop/src/settings/search-route-status.tsx apps/desktop/src/settings/pages/web-page.test.tsx apps/desktop/src/desktop-locale.ts apps/desktop/src/styles/settings-resources.css`
   - PASS: all touched files use Prettier style.
4. `git diff HEAD^ HEAD --check`
   - PASS for the committed Task 3 diff.

An initial Desktop typecheck caught strict-test typing issues around the discriminated Settings request input and an `exactOptionalPropertyTypes` harness prop; those were fixed in the focused test before the final verification. No unresolved TypeScript errors remain.

## Staging and unrelated changes

`git show --format= --name-only e4fe9ee` reports exactly:

- `apps/desktop/src/desktop-locale.ts`
- `apps/desktop/src/settings/pages/web-page.test.tsx`
- `apps/desktop/src/settings/pages/web-page.tsx`
- `apps/desktop/src/settings/search-route-status.tsx`
- `apps/desktop/src/settings/web-draft.test.ts`
- `apps/desktop/src/settings/web-draft.ts`
- `apps/desktop/src/styles/settings-resources.css`

`apps/desktop/src/desktop-locale.ts` contained pre-existing session/sidebar copy changes. Only the new Web translator type/value hunks were staged with a non-interactive patch; the unrelated locale hunks remain unstaged. The rest of the extensive unrelated worktree remains untouched and unstaged.

## Concerns

1. The worktree still contains extensive unrelated uncommitted changes and untracked files, including Task 1 Host/contract work; they were intentionally preserved as requested.
2. The report itself is intentionally not part of commit `e4fe9ee`, matching the brief's Task 3 source/test staging list; it is written at `.superpowers/sdd/task-3-report.md`.
3. No focused-test warnings or unresolved Task 3 implementation concerns were observed.
