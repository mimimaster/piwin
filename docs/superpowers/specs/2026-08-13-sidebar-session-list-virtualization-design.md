# Design: Sidebar session list — full index load + renderer virtualization

| Field | Value |
|-------|-------|
| Status | Reviewed — ready for implementation plan |
| Date | 2026-08-13 |
| Surface | `apps/desktop` sidebar, `@piwin/contracts` session list, `@piwin/host-runtime` session product commands |
| Related | [ADR 0039](../../adr/0039-host-owned-client-collection-pages.md), [Phase 3 record](../../notes/2026-08-09-desktop-client-collection-windowing-phase3.md) |
| Decision | Replace the Desktop three-page sliding window with a single bounded full-index load plus a virtualized flat row list. ADR 0039 §4 is superseded in part; §5/§6/§7 remain in force. |

---

## 0. Context

### 0.1 Reported symptom

Clicking `查看全部` (See all) on a project folder in the sidebar starts a spinner
that never settles. The list also shows a `加载更多会话` button and a `收起`
button below the spinner.

### 0.2 Root cause

The spinner is structural, not intermittent.

After `See all`, the renderer retains at most `SESSION_LIST_WINDOW_MAX_PAGES = 3`
Host pages. A project page is `PROJECT_SESSION_PAGE_SIZE = 6` rows, and a session
row is `min-height: 30px` with a `1px` list gap. The complete resident window is
therefore about **18 × 31 = 558 px** tall.

`SessionListLazyBoundary` observes its sentinel with `rootMargin: '160px 0px'`
against the `.sidebar-folder-tree` scroll root. Both the top and the bottom
sentinel are inside the observation area whenever:

```text
558 px (window height) <= viewportHeight + 160 px + 160 px
⇒ viewportHeight >= 238 px
```

Any real sidebar is taller than 238 px. The sentinel is supposed to mean "the
user scrolled to the edge", but it is on screen from the first frame. Two
consequences follow:

1. The bottom sentinel appends the next page immediately, and keeps appending,
   walking the entire collection six rows per RPC without any user scroll.
2. Each append evicts the first resident page, which makes `previousCursor`
   defined, which mounts the top sentinel, which is also in view, which prepends
   and evicts from the tail again. The two boundaries pull against each other
   indefinitely.

`lastRequestedCursorRef` only suppresses the *same* cursor twice in a row. The
ping-pong cursors alternate, so the guard never engages.

A secondary race exists on entry: `fillExpandedSessionWindow` awaits up to three
sequential page RPCs while the sentinel's `requestAnimationFrame` probe fires in
parallel. The single-flight `pendingSessionWindowLoads` guard rejects the
sentinel request, which then waits for another intersection event before
retrying.

### 0.3 Why the original boundary was misplaced

ADR 0039 was triggered by a real measurement: 133 rendered session rows produced
530 `HTMLButtonElement`, 400 `SVGSVGElement`, 3,599 `SVGLength`, and 847
`JSEventListener` live objects. That is roughly **4 buttons and 3 SVG roots per
row**, because every row unconditionally mounts three hover action buttons that
are only hidden with `opacity: 0; visibility: hidden`.

The same ADR measured the *data*:

| Scope | Named rows | Serialized full response | Bytes per row |
|-------|-----------:|-------------------------:|--------------:|
| Largest project at the time | 23 | 12,140 B | 528 B |
| General | 100 | 35,659 B | 357 B |

The 1,035-session project that motivated the work is therefore about **546 KB**
of session index JSON. That is not the source of a 214 MB renderer.

The cost lives in the DOM, and it scales with **rendered rows**, not with
**resident records**. ADR 0039 chose a transport-layer mechanism (cursor paging
plus a three-page sliding window) to bound a renderer-layer cost. It capped the
data — which was never the problem — while still mounting 133 rows, and it paid
for that with continuous RPC round-trips, a misleading `查看全部 (N)` label that
can never show N, and the loop described in §0.2.

Virtualized rendering bounds the actual cost directly. The repository already
depends on `@tanstack/react-virtual` and already virtualizes the transcript in
`transcript-turn-list.tsx`; the sidebar simply never adopted it.

### 0.4 Expected outcome

Measured against the 1,035-session data root from the ADR 0039 diagnosis:

| Metric | Today (paging + 3-page window) | This design (virtualized + full index) |
|--------|-------------------------------:|---------------------------------------:|
| Resident index data | ~9 KB | ~546 KB |
| Session rows in DOM | 133 | ~30 |
| Buttons / SVG roots | 530 / 400 | ~120 / ~90 |
| RPCs to fill one screen | 1 per 6 rows; up to 3 serial on `See all` | 1 |
| Scrolling to the bottom | may loop indefinitely | zero requests |

---

## 1. Approaches considered

| # | Approach | Verdict |
|---|----------|---------|
| **A** | Full bounded index load + virtualized flat row list; delete the paging UI | **Chosen.** Removes the loop, the misleading label, and the real DOM cost in one change. Uses an existing dependency and an existing in-repo pattern. |
| B | Keep `session/list-page`, raise the page size, make the window append-only with an absolute cap, add virtualization | Rejected. Keeps a cursor/revision/stale-cursor machinery that no longer earns its complexity once rendering is bounded. |
| C | Only fix the loop (drop the top sentinel, set `rootMargin: 0`, raise the page size) | Rejected as an endpoint. It leaves the dishonest `查看全部 (N)` label, the state-discarding `收起`, and the unaddressed per-row DOM cost. |

---

## 2. Contract layer

### 2.1 Extend `session/list` rather than adding a command

`session/list` already accepts a `SessionScope` and `includeArchived`, already
filters unlistable sessions on the Host, and already orders pinned-first. It is
the correct shape; it only lacks a transport bound and an explicit order.

```ts
| {
    id?: string;
    type: 'session/list';
    /** @deprecated Use `scope`. */
    projectPath?: string;
    scope?: SessionScope;
    includeArchived?: boolean;
    /** Host-side global ordering; truncation is applied after ordering. */
    order?: SessionListOrder;
    /** Transport bound. Omitted means unbounded (existing behaviour). */
    maxItems?: number;
  }
```

Response gains two optional fields; existing consumers are unaffected:

```ts
{
  sessions: SessionSummary[];
  /** Size of the filtered, ordered Host projection before truncation. */
  totalCount: number;
  /** True when `sessions.length < totalCount`. */
  truncated: boolean;
}
```

Desktop passes `maxItems: 2000` (≈ 1 MB at 528 B/row). With the whole scope
resident, the renderer needs no cursor, no revision, no `stale-cursor` recovery,
and no `anchorSessionId`.

### 2.2 Why `order` stays on the Host

ADR 0039 rejected client-side sorting because sorting one page cannot reproduce
a global order. That argument is specific to paging and does not apply to a full
load — but truncation reintroduces it. Taking the 2,000 most recent sessions and
then sorting them alphabetically is not the same set as the alphabetically-first
2,000. Keeping `order` on the Host guarantees truncation happens after the
correct global ordering.

### 2.3 What is not touched

`session/list-page`, its cursor implementation, and its remote projection stay
exactly as they are. CLI, Host Server, and future mobile shells continue to use
them, and ADR 0039 §5 remote path safety is unaffected. Desktop simply stops
calling it.

---

## 3. Renderer layer

### 3.1 Flatten before virtualizing

`.sidebar-folder-tree` is a single scroll container holding the Projects section
(one nested `<ul>` per project folder) and the Conversations section. Nested,
conditionally-rendered lists cannot be virtualized directly, so the tree is first
projected to a one-dimensional array:

```ts
export type SidebarTreeRow =
  | { kind: 'section-header'; sectionId: 'projects' | 'conversations' }
  | { kind: 'project-folder'; projectPath: string; collapsed: boolean }
  | { kind: 'session'; scope: SessionScope; session: SessionListItemUi | DraftSessionItemUi }
  | { kind: 'empty-hint'; scope: SessionScope }
  | { kind: 'truncation-hint'; scope: SessionScope; hiddenCount: number };
```

`buildSidebarTreeRows(...)` is a pure function covering collapse state, search
filtering, draft merging, ordering, and the truncation hint. It is unit-tested
directly and carries no React or DOM dependency.

### 3.2 One virtualizer over the existing scroll root

`useVirtualizer` from `@tanstack/react-virtual` runs over the flat array with
`.sidebar-folder-tree` as the scroll element. Row heights are near-uniform
(session rows 30 px, folder and hint rows ~26 px), so `estimateSize` returns a
constant per `kind` and `measureElement` corrects the remainder.

Following the existing `shouldVirtualizeTranscript` idiom, virtualization only
engages above `SIDEBAR_VIRTUALIZATION_MIN_ROWS = 60` flattened rows. Below that
the list renders normally, so small fixtures and e2e specs are unaffected by
virtualization behaviour.

### 3.3 File extraction

`project-session-sidebar.tsx` is 1,479 lines, well past the ~400-line guidance in
AGENTS.md §3.2. This change extracts exactly two files and leaves the rest in
place:

- `sidebar-tree-rows.ts` — the `SidebarTreeRow` model and `buildSidebarTreeRows`
- `session-row-item.tsx` — the existing `SessionRowItem` component

Broader decomposition of the sidebar is deliberately out of scope.

---

## 4. Deletion and change inventory

| File | Action |
|------|--------|
| `apps/desktop/src/session-list-lazy-boundary.tsx` (+ test) | Delete |
| `apps/desktop/src/session-list-page-state.ts` (+ test) | Delete |
| `apps/desktop/src/session-sidebar-page.ts` (+ test) | Delete |
| `apps/desktop/src/session-list-page-request.ts` | Delete (Desktop-only) |
| `apps/desktop/src/chat-reducer.ts` | Drop `sessionListsWindowed` and both `*_WINDOW_MAX_ITEMS` truncations; replace `session/hydrate-page` with `session/hydrate-scope` carrying `totalCount` and `truncated` |
| `apps/desktop/src/App.tsx` | Drop `sessionListWindows` state, `handleSessionPageChange`, `handleSessionWindowReset` |
| `apps/desktop/src/hooks/use-session-actions.ts` | `hydrateSessions` calls `session/list`; keep the request-generation guard against out-of-order responses; drop window merging |
| `apps/desktop/src/desktop-locale.ts` | Remove `seeAll`, `showLess`, `loadMoreSessions`, `loadingSessions`; add `olderSessionsHidden(count)` (zh-CN + en) |
| `apps/desktop/src/styles/region-sidebar.css` | Remove `.session-list-lazy-boundary` and `.session-list-disclosure*` rules |
| `apps/desktop/src/project-session-sidebar.tsx` | Remove `expandedProjectSessionLists`, `generalSessionListExpanded`, `fillExpandedSessionWindow`, `resetSessionWindow`, `loadSessionWindowPage`, `pendingSessionWindowLoads`, `SESSION_LIST_PREVIEW_SIZE`; mount the virtualizer; extract the two files in §3.3 |

Explicitly retained: `packages/contracts/src/session-list-page.ts` and its Host
implementation, ADR 0039 §5 remote projection, ADR 0039 §6/§7 transcript paging,
and `session/search`.

---

## 5. Edge cases

**Truncation hint.** When `truncated` is true, the scope's list ends with a
non-interactive row: "还有 N 个更早的会话，用搜索查找". It issues no request and
its state never changes, unlike the `加载更多会话` control it replaces.

**Active session outside the resident set.** Resuming a session that was
truncated away upserts it at the top of its scope list through the reducer's
existing `session/update` path, so the selected row is always visible. This
replaces the `anchorSessionId` mechanism.

**Keyboard navigation.** The current ↑/↓/Enter handler walks `[data-session-id]`
nodes in the DOM and will break once unrendered rows are absent. It is rewritten
to index into the `SidebarTreeRow` array and call `virtualizer.scrollToIndex()`,
mirroring the existing usage in `transcript-turn-list.tsx`.

**Mutations.** Pin, rename, archive, unarchive, and delete currently refresh the
owning Host page. With the full index resident they become local reducer
upserts. Only an archive/unarchive lifecycle-filter change re-requests the list.

**Order change.** Changing sort re-requests `session/list` with the new `order`
instead of re-sorting locally, so truncation always follows the correct order.

**Scroll compensation.** `captureScrollAnchor` / `restoreScrollAnchor` exist to
survive prepends and far-page eviction. Neither occurs anymore; both are removed
with the boundary component.

---

## 6. Testing

The gating regression test is: **render 1,035 sessions and assert that the DOM
holds at most 80 `[data-testid="session-item"]` nodes.** The ceiling is the
visible row count plus virtualizer overscan headroom; it is deliberately larger
than `SIDEBAR_VIRTUALIZATION_MIN_ROWS` so the two numbers are never confused.
The DOM ceiling was previously an implicit consequence of paging; deleting
paging requires an explicit assertion to take over, or a future change that
disables virtualization would silently restore the ADR 0039 condition.

| Layer | Test |
|-------|------|
| `@piwin/contracts` | `session/list` query and response round-trip with `order`, `maxItems`, `totalCount`, `truncated` |
| `@piwin/session` / host-runtime | `order` applied before truncation; `totalCount` reflects the untruncated projection; the existing 10,000-session fixture returns 2,000 rows with `truncated: true` |
| Desktop unit | `buildSidebarTreeRows` across collapse, search, draft merge, ordering, and truncation-hint combinations |
| Desktop unit | DOM ceiling assertion described above (1,035 rows, ≤ 80 mounted session rows) |
| Desktop unit | ↑/↓ navigation traverses rows that are not currently rendered |
| Desktop e2e | Expand a project, scroll to the bottom: no spinner appears and no additional `session/list` request is issued |

Removed with their subjects: `session-sidebar-page.test.ts`,
`session-list-lazy-boundary.test.tsx`, and the session list window state tests.

---

## 7. ADR

Write `docs/adr/0049-session-index-full-load-and-virtualized-sidebar.md` and mark
ADR 0039 "Superseded in part by ADR 0049", scoped to §4 (Desktop bounded
projections for the **session index**). ADR 0039 §5, §6, and §7 remain in force
and must be named as still-current in both documents.

The ADR records the cost argument from §0.3 — 528 B per index row versus 4
buttons and 3 SVG roots per rendered row — and the ordering caveat from §2.2:
ADR 0039's rejection of client-side sorting holds under paging, does not hold
under a full load, and is re-introduced by truncation, which is why `order`
stays on the Host.

---

## 8. Out of scope

- Lazy-mounting the three per-row hover action buttons. Virtualization already
  reduces them to roughly 120 live buttons; deferred as YAGNI.
- Further decomposition of `project-session-sidebar.tsx` beyond §3.3.
- Changes to `session/search`, which keeps its own 30-hit Host bound.
- Any change to transcript paging (ADR 0039 §6/§7), which addresses genuinely
  large per-message payloads and is working as intended.
