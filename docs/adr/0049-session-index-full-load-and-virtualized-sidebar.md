# ADR 0049: Session index full load and virtualized sidebar

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-08-13 |
| Trigger | Desktop three-page session-index window never settles after `See all`; measured cost is DOM density, not index JSON |
| Related | ADR 0039 (§4 superseded in part); [design](../superpowers/specs/2026-08-13-sidebar-session-list-virtualization-design.md) |

## Context

ADR 0039 introduced Host-owned `session/list-page` and a Desktop three-page,
128 KiB sliding window so the renderer would not retain complete session
indexes. That diagnosis mixed two costs:

| Cost | Scale | Measured magnitude |
|------|-------|--------------------|
| Resident session summary | bytes per durable row | ~528 B per summary (largest project sample) |
| Mounted session row | DOM nodes per visible row | ~4 buttons and ~3 SVG roots per row (hover actions always mounted, only CSS-hidden) |

A 1,035-session project is about **546 KB** of index JSON. That is not the
source of a multi-hundred-megabyte renderer. The expensive surface is
**rendered rows**, not **resident records**. ADR 0039 capped the data —
which was never the primary problem — while still mounting on the order of a
hundred session rows, and paid for that with continuous RPC round-trips, a
misleading `查看全部 (N)` label that cannot show N, and a structural spinner
loop: with only ~18 rows (~558 px) resident and 160 px sentinel margins, both
top and bottom lazy boundaries stay in view in any real sidebar, so append and
prepend fight indefinitely.

The repository already depends on `@tanstack/react-virtual` and already
virtualizes the transcript. The sidebar never adopted that pattern.

## Decision

### 1. Desktop hydrates one bounded full projection per scope

Desktop replaces the three-page cursor window with a single
`session/list` request per hydrated scope:

- `maxItems: 2000` (`DESKTOP_SESSION_LIST_MAX_ITEMS`)
- Host-owned `order` (`updated` or `alphabetical`)
- response carries optional `totalCount` and `truncated`

One hydration equals one `session/list` RPC. Desktop production code does not
send `session/list-page` for the session index. Scrolling performs **zero**
additional session-list requests.

The Desktop bound is a **client request policy**, not a new global Host limit
on CLI, mobile, or other shells. When `order` and `maxItems` are omitted,
`session/list` remains backward compatible (unbounded complete list, existing
consumers unchanged). Older Hosts may omit `totalCount` and `truncated`;
Desktop falls back to `sessions.length` and `false` without failing hydration.

### 2. Host owns ordering because truncation follows ordering

ADR 0039 correctly rejected client-side sort of **pages**: sorting one page
cannot reproduce global order. Under a complete resident set that objection
would not apply — but **truncation reintroduces it**. Taking the 2,000 most
recent sessions and then sorting them alphabetically is not the same set as
the alphabetically-first 2,000. Therefore `order` remains a Host field and
truncation always runs **after** global filtering and ordering.

### 3. Renderer virtualizes flattened sidebar rows

`.sidebar-folder-tree` remains the sole scroll root. The nested project /
Conversations tree is projected to a one-dimensional `SidebarTreeRow` array
(section headers, project folders, sessions, empty/truncation hints). One
`@tanstack/react-virtual` virtualizer mounts only the visible range when the
flattened row count **exceeds** `SIDEBAR_VIRTUALIZATION_MIN_ROWS = 60`.

Gating expectation against the 1,035-session fixture: at most **80** mounted
`[data-testid="session-item"]` rows (visible range plus overscan headroom).
No new dependency is required.

When `truncated` is true, the list ends with a non-interactive hint
(zh-CN: `还有 ${count} 个更早的会话，用搜索查找`; en: `${count} older
session(s) hidden; use search to find them`). The hint issues no request.

### 4. Scope of supersession and what stays

This ADR supersedes **only ADR 0039 §4** for the **Desktop session index**
(three-page sliding window, six-row preview / `See all` / `Show less` cursor
lazy loading, and Desktop preference for `session/list-page` on that surface).

The following remain in force unchanged:

- **ADR 0039 §5** — remote projection remains path-free;
- **ADR 0039 §6 / §7** — transcript resume tail pages, opaque transcript
  cursors, and Desktop bounded transcript windows;
- **`session/list-page`** — stays in contracts and Host for CLI, mobile, and
  future clients; Desktop simply stops calling it for the session index;
- **`session/search`** — remains a separate Host-bounded query; a full
  resident index does not turn search into a client-only feature.

## Consequences

- Desktop session-index transport and reducer state scale with the 2,000-item
  bound (~1 MB at ~528 B/row), not with full Host history and not with
  mounted DOM density.
- Mounted session-row DOM cost scales with viewport + overscan, not with
  resident summaries.
- Pin / rename / archive mutations that stay inside the resident filter can
  update locally; lifecycle filter changes and order changes rehydrate via
  `session/list`. If a local mutation cannot preserve a truthful truncation
  count, rehydrate rather than display a knowingly wrong number.
- An active session truncated out of the resident set is upserted via the
  existing `session/update` path so the selected row remains visible
  (replacing `anchorSessionId` for this surface).
- Keyboard ↑/↓ must index the flat row model and `scrollToIndex`, not only
  currently mounted `[data-session-id]` nodes.
- Transcript paging language and implementation are explicitly out of scope
  for this change.

## Rejected alternatives

1. **Keep `session/list-page`, raise page size, append-only window + virtualize**
   — retains cursor/revision/stale-cursor machinery that no longer earns its
   complexity once rendering is bounded.
2. **Only fix the sentinel loop** (drop top sentinel, `rootMargin: 0`, larger
   pages) — leaves the dishonest `查看全部 (N)` label, state-discarding
   `收起`, and unaddressed per-row DOM cost.
3. **Client-side sort after a full load, then truncate** — incorrect under
   `maxItems`; see Decision §2.
4. **Impose 2,000 as a Host-wide hard cap for every `session/list` consumer**
   — breaks CLI/mobile expectations; the bound is Desktop request policy.
5. **Delete or weaken transcript paging while changing the session index** —
   transcript payloads are genuinely large per message; ADR 0039 §6/§7 stay.
