# Implementation Plan: Sidebar session index full load + renderer virtualization

| Field | Value |
|---|---|
| Status | Ready for implementation |
| Date | 2026-08-13 |
| Design | [`2026-08-13-sidebar-session-list-virtualization-design.md`](../specs/2026-08-13-sidebar-session-list-virtualization-design.md) |
| Architecture decision | Add ADR 0049; partially supersede ADR 0039 §4 only |
| Primary surface | `apps/desktop` sidebar |
| Cross-boundary scope | `@piwin/contracts`, `@piwin/session`, `@piwin/host-runtime`, remote Host projection |

## 1. Outcome

Replace Desktop's three-page session-index window and `See all`/lazy-boundary UI with:

1. one Host-owned, globally ordered `session/list` projection per scope;
2. a Desktop request bound of 2,000 durable session summaries;
3. one flattened sidebar row model;
4. one `@tanstack/react-virtual` virtualizer over `.sidebar-folder-tree` when the flattened row count exceeds 60;
5. a truthful, non-interactive truncation hint when the Host projection exceeds the Desktop bound.

The implementation is complete only when a 1,035-session fixture keeps at most 80 session rows mounted and scrolling the sidebar performs no additional session-list request.

## 2. Architecture and compatibility invariants

- Desktop continues to call only public Host contracts. It does not import session storage or Pi packages.
- `@piwin/host-runtime` remains the product command authority; `@piwin/session` owns pure index projection logic.
- `session/list-page`, opaque cursors, remote-safe page projection, and their tests remain available for CLI/mobile/future clients.
- Transcript paging and virtualization are untouched.
- `session/search` remains a separate Host-bounded query. A full resident index does not turn search into a client-only feature.
- `session/list` remains backward compatible when `order` and `maxItems` are omitted.
- Older Hosts may omit `totalCount` and `truncated`; Desktop must fall back to `sessions.length` and `false` without failing hydration.
- The Desktop bound is a client request policy, not a new global limit imposed on existing CLI/mobile consumers.
- No new dependency is required; Desktop already owns `@tanstack/react-virtual`.

## 3. Current-state findings that affect implementation

The design inventory is directionally correct, with four required additions found in the current tree:

1. `packages/host-server/src/remote-projection.ts` currently rewrites `session/list` to `{ sessions }` and would silently discard `totalCount` and `truncated`. It must project the new metadata without exposing Host paths.
2. `packages/host-server/src/host-server.ts` validates remote `session/list`; it must validate optional `order` and `maxItems` while keeping project-path restrictions unchanged.
3. `apps/desktop/src/host-client-mock.ts` implements both list commands. Its `session/list` branch must match Host ordering, truncation, and response metadata or browser-shell tests will exercise different semantics from Tauri/remote Hosts.
4. `sessionScopeKey` currently lives in the page-window module that will be deleted, but App search and the generation guard still need it. Move it to a focused Desktop module instead of retaining page-state code.

The reducer also needs per-scope list metadata. Without it the new `truncation-hint` row has no source of truth, and local add/delete/resume mutations can make the displayed hidden count stale.

## 4. Delivery sequence

### Phase 1 — Record the decision and extend contracts

#### 1.1 ADR and architecture docs

Files:

- add `docs/adr/0049-session-index-full-load-and-virtualized-sidebar.md`
- update `docs/adr/0039-host-owned-client-collection-pages.md`
- update `docs/architecture.md` §7.1

Work:

- Record the measured cost distinction: about 528 bytes per resident summary versus four buttons and three SVG roots per mounted session row.
- State that ADR 0049 supersedes only ADR 0039 §4 for the Desktop session index.
- Explicitly retain ADR 0039 §5 remote path safety and §6/§7 transcript paging.
- Record why `order` remains Host-owned: truncation must run after global ordering.
- Replace architecture text describing the Desktop three-page cursor window with the 2,000-item bounded full projection and renderer virtualization policy.

#### 1.2 `session/list` query and response contract

Files:

- update `packages/contracts/src/ipc.ts`
- update or add a focused contract test beside the existing session list/page tests
- if `SessionListOrder` is moved to a new focused module, re-export it from `packages/contracts/src/index.ts` and keep `session-list-page.ts` importing/re-exporting compatibly

Work:

- Extend the `session/list` command with:
  - `order?: SessionListOrder`
  - `maxItems?: number`
- Extend `SessionListData` with backward-compatible optional fields:
  - `totalCount?: number`
  - `truncated?: boolean`
- Document that ordering is applied before truncation and that omitted `maxItems` preserves the existing unbounded result.
- Validate contract examples through JSON serialization/parsing for both the new query and response shape.
- Do not change `SessionListPageQuery` or `SessionListPageData`.

Acceptance:

- Existing `session/list` call sites still typecheck unchanged.
- A new caller can request `{ order: 'alphabetical', maxItems: 2000 }`.
- The existing page contract test remains green.

### Phase 2 — Build one Host-owned full-index projection

#### 2.1 Extract shared pure ordering/projection logic

Files:

- add a focused projection module under `packages/session/src/`, for example `session-index-projection.ts`
- update `packages/session/src/session-index-page.ts`
- update `packages/session/src/index.ts`
- add colocated unit tests

Work:

- Extract the deterministic global ordering currently private to `session-index-page.ts` so full-list and page-list paths cannot drift.
- Add a pure full-list projection that performs, in this order:
  1. lifecycle filtering according to `includeArchived`;
  2. listability filtering;
  3. global `updated` or `alphabetical` ordering with stable session-id tie breaks;
  4. `totalCount` capture;
  5. optional truncation.
- Treat a supplied `maxItems` that is not a positive safe integer as a `RangeError` at the Host boundary. Omission stays unbounded for compatibility.
- Refactor `createSessionIndexPage` to use the same ordering helper while retaining revision/cursor behavior unchanged.

Tests:

- updated order: pinned first, then pinned/update timestamp, then id;
- alphabetical order: name, then id;
- listability and archive filtering occur before `totalCount`;
- order is applied before truncation;
- empty and exact-bound results report `truncated: false`;
- a 10,000-record fixture requested with `maxItems: 2000` returns 2,000 records, `totalCount: 10000`, `truncated: true`;
- invalid bounds fail deterministically;
- existing cursor fixtures remain unchanged.

#### 2.2 Wire `session/list` in Host Runtime

Files:

- update `packages/host-runtime/src/commands/session-product-commands.ts`
- add or extend `packages/host-runtime/src/session-list-page.integration.test.ts` with full-list integration coverage, or add `session-list.integration.test.ts`
- update existing `session/list` assertions that compare the entire response shape

Work:

- Load and repair records as today.
- Apply the shared full-index projection with `command.order ?? 'updated'` and `command.maxItems`.
- Return `sessions`, `totalCount`, and `truncated` on every new Host response.
- Preserve legacy `projectPath`, `scope`, and `includeArchived` behavior.
- Map to `SessionSummary` only after the owning package has selected the final record set.

Acceptance:

- Host tests prove global order before truncation.
- Existing unbounded CLI-style calls still receive every matching session.
- No application package imports `host-runtime` or `agent-host`.

#### 2.3 Keep remote and browser-mock semantics aligned

Files:

- update `packages/contracts/src/remote-protocol.ts`
- update `packages/host-server/src/remote-projection.ts`
- update `packages/host-server/src/remote-projection.test.ts`
- update `packages/host-server/src/host-server.ts`
- update `packages/host-server/src/host-server.test.ts`
- update `apps/desktop/src/host-client-mock.ts`
- update `apps/desktop/src/host-client-mock.test.ts`

Work:

- Add a remote-safe `session/list` data projection containing remote summaries plus `totalCount` and `truncated`.
- Preserve all current path redaction. Do not make project-scoped remote listing available through a raw Host path.
- Validate optional remote `order` and a positive safe `maxItems`; retain the existing general-scope-only remote admission rule.
- Make the browser mock sort globally, truncate after sorting, and return the same metadata as Host Runtime.
- Keep `session/list-page` mock and remote projection intact.

Acceptance:

- Local Host, remote Host general scope, and browser mock agree on result set and metadata.
- Remote responses contain no `projectPath`, `workingDirectory`, or other Host-local path.

### Phase 3 — Replace Desktop page-window state with scope hydration

#### 3.1 Introduce focused scope identity and metadata

Files:

- add `apps/desktop/src/session-scope-key.ts` with a colocated test
- update `apps/desktop/src/chat-reducer.ts`
- update `apps/desktop/src/chat-reducer.test.ts`

Work:

- Move `sessionScopeKey(scope)` out of `session-list-page-state.ts`.
- Replace `sessionListsWindowed` with explicit per-scope list metadata. Prefer a shape that does not encode project paths into an untyped catch-all, for example:

  ```ts
  type SessionListScopeMeta = {
    totalCount: number;
    truncated: boolean;
  };

  type SessionListScopeState = {
    general: SessionListScopeMeta | null;
    projects: Record<string, SessionListScopeMeta>;
  };
  ```

- Replace `session/hydrate-page` with `session/hydrate-scope` carrying `scope`, `sessions`, normalized `totalCount`, `truncated`, and optional `fillActiveList`.
- Remove both page-window item caps and all `slice(0, pageLimit)` behavior.
- Keep lists deduplicated by session id.
- Preserve active transcript selection even when hydration does not contain the active row.
- Make local add/update/remove paths maintain truthful scope counts:
  - a newly listable durable session increments the owning scope count only when it was not already known;
  - delete decrements it;
  - archive/unarchive is reconciled by the required scope refresh;
  - pin/rename does not change it;
  - an active session upserted from outside the 2,000-row projection becomes resident without being double-counted.
- Derive the hint count from `max(0, totalCount - distinct resident durable rows in scope)`, so an upserted active row reduces the hidden count correctly.

Tests:

- hydrate general and project scopes independently;
- out-of-bound active session remains selected after hydrate;
- local upsert outside the bounded set is admitted and visible;
- add/delete adjust total count once, not once per mirrored list;
- no list mutation is truncated back to 18/36 rows;
- placeholder sessions remain unlistable.

#### 3.2 Simplify `hydrateSessions`

Files:

- update `apps/desktop/src/hooks/use-session-actions.ts`
- update hook/integration tests that assert list commands
- update `apps/desktop/src/App.tsx`

Work:

- Define one named Desktop policy constant: `DESKTOP_SESSION_LIST_MAX_ITEMS = 2000` in a focused session-list module.
- Change `hydrateSessions` to issue exactly one:

  ```ts
  {
    type: 'session/list',
    scope,
    includeArchived,
    order,
    maxItems: DESKTOP_SESSION_LIST_MAX_ITEMS,
  }
  ```

- Normalize older Host responses to `totalCount = sessions.length` and `truncated = false` when metadata is absent.
- Retain the per-scope request-generation guard so an older sort/archive response cannot overwrite a newer one.
- Remove cursor, merge direction, anchor, session-list-window refs, and local hook state.
- Remove `sessionListWindows`, `handleSessionPageChange`, and `handleSessionWindowReset` from App and sidebar props.
- Remove anchor-page bookkeeping from resume. If a resumed session is outside the resident bound, the authoritative resume response followed by `session/update` admits it locally.
- Keep order changes and archive-filter changes as full one-request-per-scope refreshes.
- Pin and rename use their returned `SessionSummary` for a local upsert only.
- Delete removes locally without an unnecessary list refresh.
- Archive/unarchive re-request the owning scope because membership under the active lifecycle filter changes.

Acceptance:

- No Desktop production path sends `session/list-page`.
- One hydration equals one RPC, including sort/filter changes.
- A stale response cannot replace a newer scope projection.

### Phase 4 — Build the flattened sidebar row model

#### 4.1 Pure row projection

Files:

- add `apps/desktop/src/sidebar-tree-rows.ts`
- add `apps/desktop/src/sidebar-tree-rows.test.ts`

Required row union:

```ts
type SidebarTreeRow =
  | { kind: 'section-header'; sectionId: 'projects' | 'conversations' }
  | { kind: 'project-folder'; projectPath: string; collapsed: boolean }
  | {
      kind: 'session';
      scope: SessionScope;
      session: SessionListItemUi | DraftSessionItemUi;
    }
  | { kind: 'empty-hint'; scope: SessionScope }
  | { kind: 'truncation-hint'; scope: SessionScope; hiddenCount: number };
```

Work:

- Implement `buildSidebarTreeRows(...)` as a pure function with stable row keys.
- Project both Projects and Conversations into one ordered array.
- Respect Projects/Conversations section collapse and individual project-folder collapse.
- Merge drafts first, then durable sessions in the selected order.
- Apply current search semantics without replacing Host `session/search`: durable inputs may already be Host-search-projected; the row builder filters/merges local drafts and suppresses unrelated empty/truncation hints during active search.
- Sort the resident durable set for presentation using the selected order. This keeps local pin/rename/update mutations correct while the Host remains authoritative over which 2,000 rows survive truncation.
- Append one non-interactive truncation hint per affected scope using the reducer metadata and resident distinct count.
- Do not restore `See all`, `Show less`, page buttons, or lazy sentinels in the row model.

Tests:

- project and section collapse combinations;
- multiple projects retain independent session ownership;
- general/project drafts merge first and do not duplicate durable ids;
- updated and alphabetical order, including pin and rename mutations;
- local and Host-search-projected results;
- empty hints only for expanded empty scopes;
- truncation hint count after an out-of-bound active-session upsert;
- stable unique keys across identical session ids in different scopes are defensive, even though reducer ownership should prevent dual listing.

#### 4.2 Extract the session row component

Files:

- add `apps/desktop/src/session-row-item.tsx`
- update `apps/desktop/src/project-session-sidebar.tsx`
- keep row behavior tests in `project-session-sidebar.test.tsx` unless a focused component suite improves clarity

Work:

- Move `SessionActivityIndicator`, relative-time formatting used only by the row, and `SessionRowItem` to the new file.
- Preserve current ui-kit use, data attributes, context menu behavior, pin/archive controls, working/service/completion indicators, drafts, and accessibility labels.
- Do not lazy-mount hover actions in this slice.

Acceptance:

- The extracted component has no Host/data-fetch responsibility.
- Existing row interaction assertions remain green.

### Phase 5 — Render one virtualized flat tree

#### 5.1 Virtualization component path

Files:

- update `apps/desktop/src/project-session-sidebar.tsx`
- update `apps/desktop/src/styles/region-sidebar.css`
- update `apps/desktop/src/project-session-sidebar.test.tsx`

Work:

- Add `SIDEBAR_VIRTUALIZATION_MIN_ROWS = 60` and a pure `shouldVirtualizeSidebar(rowCount)` policy.
- Attach a dedicated ref to `.sidebar-folder-tree`; this exact element remains the scroll root.
- Build rows once with `useMemo` and feed them to one `useVirtualizer` instance.
- Use stable `getItemKey` values from the row model.
- Estimate sizes by row kind and use `measureElement` for corrected dynamic heights.
- Use bounded overscan sized to keep normal keyboard/focus transitions smooth while retaining the ≤80 mounted-session ceiling for the 1,035-session fixture.
- Below or at 60 flattened rows, render the same row array in normal flow so small unit/e2e fixtures keep straightforward DOM behavior.
- Above 60 rows, render one sized virtual window with absolutely positioned measured rows. Do not nest a virtualizer per project.
- Preserve section toggles, project context menus, add buttons, folder indentation, empty hints, and the sticky bottom fade.
- Add CSS only for the flat/virtual window layout and row-kind indentation. Remove lazy-boundary/disclosure CSS.
- Keep valid list/tree semantics and `aria-expanded`/`aria-current` behavior in both normal and virtual paths.

#### 5.2 Virtualization-aware keyboard navigation

Files:

- update `apps/desktop/src/project-session-sidebar.tsx`
- extend `apps/desktop/src/project-session-sidebar.test.tsx`

Work:

- Stop deriving navigation order from mounted `[data-session-id]` nodes.
- Derive the ordered session-row indexes from `SidebarTreeRow[]`.
- Track the focused session row by stable row key/id, not DOM position.
- On ArrowUp/ArrowDown, compute the next session row in the flat model, call `virtualizer.scrollToIndex()` when virtualized, then focus the materialized button on the next animation frame.
- Enter activates the focused session/draft through the existing callbacks.
- Skip editable inputs and keep wrap-around behavior unless product behavior is deliberately changed and tested.

Tests:

- Arrow navigation across an unmounted gap calls `scrollToIndex` and focuses the target after it mounts;
- navigation skips section/folder/hint rows;
- draft activation and durable-session activation call the correct handler;
- search input keystrokes remain untouched;
- normal-flow lists retain the same keyboard behavior.

#### 5.3 Gating DOM-bound regression

Test fixture requirements:

- Render 1,035 project sessions in a sidebar viewport with deterministic mocked dimensions/`ResizeObserver`, following the established transcript virtualizer test pattern.
- Assert:
  - total resident input is 1,035;
  - `[data-testid="session-item"]` count is greater than zero and at most 80;
  - a far session is initially absent, becomes mounted after `scrollToIndex`/scroll, and can be activated;
  - no spinner, `See all`, `Show less`, or load-more control exists.

### Phase 6 — Delete obsolete Desktop paging code

Delete:

- `apps/desktop/src/session-list-lazy-boundary.tsx`
- `apps/desktop/src/session-list-lazy-boundary.test.tsx`
- `apps/desktop/src/session-list-page-state.ts`
- `apps/desktop/src/session-list-page-state.test.ts`
- `apps/desktop/src/session-sidebar-page.ts`
- `apps/desktop/src/session-sidebar-page.test.ts`
- `apps/desktop/src/session-list-page-request.ts`
- `apps/desktop/src/session-list-page-request.test.ts`

Update:

- `apps/desktop/src/desktop-locale.ts`
- `apps/desktop/src/desktop-locale.test.ts`
- `apps/desktop/src/styles/region-sidebar.css`
- any imports/comments/tests still describing Desktop page windows

Work:

- Remove `seeAll`, `showLess`, `loadMoreSessions`, and `loadingSessions` locale entries.
- Add `olderSessionsHidden(count)` in zh-CN and English:
  - zh-CN: `还有 ${count} 个更早的会话，用搜索查找`
  - en: `${count} older session${count === 1 ? '' : 's'} hidden; use search to find them`
- Remove obsolete selectors and stale comments such as “bounded Host-page window” and the `session/list-page` cold-start warning.
- Run `rg` to prove Desktop has no production import/call for deleted paging modules or commands.
- Do not delete contracts/session/Host implementations for `session/list-page`.

### Phase 7 — End-to-end behavior and final documentation

Files:

- add or extend an `apps/desktop/e2e` sidebar scenario
- update the design status to implemented only after all gates pass
- add a dated implementation note under `docs/notes/` if native/manual measurements are collected

E2E scenario:

1. Start with a deterministic browser-mock scope containing more than 60 sessions.
2. Confirm the sidebar has no disclosure/loading UI.
3. Scroll to the bottom and activate a far row.
4. Observe request telemetry from an E2E-only mock fixture and assert exactly one `session/list` request for the scope and zero `session/list-page` requests during scrolling.

The request counter must stay test-only (Playwright fixture or dev mock diagnostics guarded from production output); do not add user-visible debug DOM or a second session-loading API.

Manual/native smoke:

- Open the measured large data root or an equivalent 1,000+ session fixture in Tauri.
- Verify scroll continuity, folder collapse/expand, search, pin, rename, archive/unarchive, delete, active-session resume, and keyboard navigation.
- Confirm no persistent spinner and no request burst in Host logs.
- Optionally record mounted buttons/SVG roots and renderer memory as evidence; this is useful but not a blocker beyond the automated DOM ceiling.

## 5. Verification gates

Run focused tests during each phase, then the repository gates:

```bash
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/session test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/desktop test
pnpm --dir apps/desktop e2e --grep "sidebar"
pnpm typecheck
pnpm test:architecture
pnpm test
pnpm --filter @piwin/desktop build
```

If the full `pnpm test` gate encounters a known unrelated flaky test, record the exact failure and prove all touched-package and rerun-isolated tests pass; do not silently claim a green workspace gate.

## 6. Acceptance checklist

- [ ] ADR 0049 exists and ADR 0039 is marked superseded only for Desktop session-index §4.
- [ ] `session/list` accepts `order`/`maxItems` and returns count/truncation metadata.
- [ ] Ordering is Host-owned and applied before truncation.
- [ ] Local Host, remote-safe general listing, and browser mock share the same semantics.
- [ ] Desktop makes one bounded `session/list` request per hydrated scope.
- [ ] Desktop contains no production `session/list-page` call.
- [ ] Page-window state, sentinels, disclosure controls, and related locale/CSS are deleted.
- [ ] The sidebar is built from one pure flat row projection.
- [ ] Lists with 60 or fewer rows render normally; larger lists use one virtualizer.
- [ ] 1,035 sessions mount no more than 80 session rows.
- [ ] Scrolling performs zero additional session-list requests.
- [ ] Keyboard navigation reaches initially unmounted session rows.
- [ ] Truncation hint remains truthful after active-session upsert and local add/delete.
- [ ] Pin/rename remain correctly ordered for both updated and alphabetical modes.
- [ ] Search remains Host-bounded and can find sessions outside the 2,000-row resident set.
- [ ] Types, tests, architecture check, and Desktop build pass.

## 7. Suggested commit boundaries

1. `docs: record virtualized sidebar session index decision`
2. `feat(contracts): bound and order session list projections`
3. `feat(host): project full session indexes before truncation`
4. `refactor(desktop): replace session page windows with scope hydration`
5. `feat(desktop): virtualize flattened sidebar session rows`
6. `test(desktop): gate large sidebar DOM and request behavior`

Each commit should remain typecheckable; do not mix unrelated Artifact or icon-preview work currently present in the worktree.

## 8. Stop conditions

- If remote projection would expose a Host project path, stop and repair the contract/projection before continuing.
- If the virtualized path requires a second scroll container, stop and keep `.sidebar-folder-tree` as the sole scroll authority.
- If the 1,035-row test mounts more than 80 session rows, do not compensate by lowering the test fixture or raising the ceiling; fix threshold/viewport/overscan behavior.
- If local mutations cannot preserve a truthful truncation count, rehydrate the affected scope as a correctness fallback rather than showing a knowingly incorrect number.
- Do not delete or weaken transcript paging while implementing this plan.
