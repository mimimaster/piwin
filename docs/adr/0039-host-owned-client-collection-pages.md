# ADR 0039: Host-owned client collection pages

| Field | Value |
|-------|-------|
| Status | **Accepted — session index and transcript slices implemented; Desktop session-index §4 superseded in part by ADR 0049** |
| Date | 2026-08-09 |
| Trigger | Desktop mapped complete session indexes into renderer state and mounted 530 buttons / 400 SVG roots at idle |
| Related | ADR 0036, ADR 0038; [Phase 3 plan](../plans/2026-08-09-desktop-client-collection-windowing-phase3.md); [ADR 0049](./0049-session-index-full-load-and-virtualized-sidebar.md) |

> **Supersession (2026-08-13):** [ADR 0049](./0049-session-index-full-load-and-virtualized-sidebar.md)
> replaces **only §4 below** for the **Desktop session index**. Desktop hydrates
> a Host-bounded full `session/list` projection (max 2,000) and virtualizes
> flattened sidebar rows instead of the three-page cursor window described in
> §4. This document's historical diagnosis is retained. **§5 remote path
> safety** and **§6 / §7 transcript paging** remain in force. `session/list-page`
> stays available for CLI, mobile, and future clients.

## Context

The Host owns durable session indexes and transcripts, but the original client
contracts returned complete arrays:

```text
session/list   → every summary in one scope
session/resume → every UI transcript message
```

The renderer later added DOM virtualization and fixed sidebar pages, but it
still deserialized and retained the complete authority-sized collections. On
the measured data root, Desktop loaded 112 General summaries and 1,035 project
summaries, including one 1,003-session project. Client-only slicing prevents a
DOM explosion but does not bound transport frames, reducer state, or other
clients.

Changing `session/list` in place would break CLI, mobile, and older shells.
Pagination also makes client-side ordering invalid: sorting one page
alphabetically cannot produce the same result as sorting the complete Host
index. Archive filtering has the same problem.

## Decision

### 1. Additive collection commands

`session/list-page` is added beside legacy `session/list`. Existing CLI/mobile
callers continue to work while Desktop migrates. New collection capabilities
start in `@piwin/contracts`; no client imports session storage code.

The query explicitly carries:

- one `SessionScope`;
- lifecycle filter (`active` or `archived`);
- authority-owned order (`updated` or `alphabetical`);
- a validated item limit, capped at 50;
- an optional cursorless `anchorSessionId` used to locate the page containing
  a restored active session;
- an optional opaque cursor.

### 2. Query-bound revision cursors

The session package creates an opaque cursor containing a version, projection
revision, page offset, and page limit. The revision covers the query identity
and the filtered/ordered public record projection. It exposes no paths or
session content.

An unchanged query/index produces deterministic previous and next cursors. If
pinning, archiving, naming, ordering, or another mutation changes the
projection, a cursor is stale. The Host returns the explicit
`stale-cursor` result; the client restarts at page zero. It never silently
applies an offset to a different ordering.

Offset is intentionally internal to the opaque cursor. It is not a public
client-owned pagination authority and may be replaced later without changing
the command contract.

`anchorSessionId` is applied only when no cursor is supplied. The Host locates
the session after global filtering and ordering, then returns its containing
page. An absent or filtered-out anchor falls back to page zero. The anchor does
not alter the ordered projection revision and is ignored during cursor
navigation.

### 3. Host owns filtering and ordering

Page construction occurs after scope, lifecycle, listability, and ordering are
resolved. A page cannot contain unnamed placeholders or rows that the client
must discard, because post-page filtering would create short or incorrect
pages.

`updated` order is pinned-first, then pin/update time descending, then stable
session id. `alphabetical` order is name then stable session id. Tie-breaking
is deterministic.

### 4. Desktop owns only bounded projections

Desktop retains at most three adjacent pages per hydrated scope plus the active
live session projection. The page window also has a 128 KiB retained-UTF-8
budget. Loading toward either end evicts from the opposite end; a different
revision or non-adjacent response resets the window rather than splicing
incompatible indexes. Search uses its own bounded Host result.

The six-row project and twelve-row General sizes remain the transport-page
budgets. They are presentation-independent: the sidebar exposes no page number
or previous/next controls. Project and General sections initially expose a
six-row preview. `See all` enters the bounded lazy-browse presentation rather
than mounting the complete collection; `Show less` hides its cursor boundaries
and refreshes the first Host page. Invisible top/bottom intersection boundaries
request the adjacent Host cursor, and visible-row anchoring compensates for
prepends or far-page eviction. Thus lazy scrolling never requires the complete
index and never becomes an append-only cache.

### 5. Remote projection remains path-free

Host Server allows `session/list-page` under the same remote-safety rules as
session reads. Remote project paths are not exposed. General-scope clients can
page normally; project-scoped remote navigation requires the separate opaque
project-id contract rather than leaking Host paths.

### 6. Resume returns a bounded tail page

The Host may still load the complete durable transcript internally when it
reconstructs a Pi/Product Shell session. That is Host authority state and is
required for model-history injection, edit/revert, fork, export, and
compaction. It must not be copied into every shell.

`session/resume` therefore returns the newest transcript page plus page
metadata, not the complete UI projection. The default tail is at most 16
messages and 256 KiB of serialized message data. `session/transcript-page`
loads older pages with an opaque cursor; callers may request at most 50
messages and 512 KiB per page. `session/messages` remains a legacy complete
read for older shells and specialized internal views, but Desktop's primary
resume path does not fall back to it.

Transcript cursors contain a query-bound revision and an exclusive message
boundary. A content mutation makes an older cursor stale. The Host reports
`stale-cursor`; Desktop replaces its projection with a new tail page instead
of applying an old boundary to changed history.

The byte limit applies to the serialized message projection. Heavy historical
tool output is already omitted. If one projected message alone exceeds the
page byte budget, the page returns a clearly marked bounded text projection;
the durable message remains complete on the Host and full-fidelity operations
continue to use it.

### 7. Desktop keeps a bounded transcript window

Desktop prepends fetched older pages into the active transcript window, with
message-id deduplication and a fixed item/UTF-8 byte cache budget. The active
tail and any live partial turn are never evicted by a history fetch. Once the
older-page cache budget is exhausted, Desktop continues in an independent
bounded history view, fetching adjacent windows by boundary message id and
evicting the opposite edge. Both scroll directions remain available; the
cache budget must not become a navigation boundary. The live tail remains
resident for incoming Host pushes. See
[history boundary repair](../specs/2026-09-21-transcript-history-boundaries.md). Full transcript operations remain Host
commands and never depend on which pages are resident.

The same retention gate applies to initial/legacy hydration and live message
appends; staying connected for many turns cannot bypass the window. When old
resident messages are evicted, their per-message Run and Walkthrough
projections are pruned with them. A stale-cursor tail refresh merges the active
local turn and preserves its streaming/run state instead of replacing a
partial answer with an older durable snapshot.

## Consequences

- Pin/archive/name mutations may invalidate a visible cursor; restart is
  explicit and bounded.
- Cursorless active-session restore uses a Host-resolved anchor and never
  walks all preceding pages.
- Sidebar paging is an internal authority/retention primitive; users experience
  continuous lazy loading rather than explicit page navigation.
- Search applies the same explicit active/archived lifecycle before its
  bounded result, so paging does not degrade search to the resident page.
- Desktop alphabetical order becomes globally correct rather than page-local.
- Resume transport and renderer transcript state are bounded independently of
  durable transcript length; Host-side model history remains complete.
- A stale transcript cursor causes one bounded tail refresh, never an
  unbounded retry or a merge against a different revision.
- Legacy `session/list` remains temporarily available and is not the preferred
  API for new shells.
- Legacy `session/messages` remains temporarily available and is not the
  preferred Desktop resume API.

## Rejected alternatives

1. **Keep full arrays and virtualize DOM only** — leaves transport and JS state
   proportional to user data.
2. **Add `limit` to `session/list` without a cursor** — makes older rows
   unreachable and cannot recover from concurrent reorder.
3. **Client-side sort/filter after paging** — produces incorrect global pages.
4. **Mutable raw offsets as public API** — silently skips/duplicates rows after
   pin/archive/update changes.
5. **Send only the last N messages with no cursor** — bounds resume but makes
   older history unreachable from the primary transcript.
6. **Let the renderer cache every fetched page** — merely moves the unbounded
   collection from transport startup to user scrolling.
7. **Remove paging and append lazy results forever** — hides pagination chrome
   but recreates the same unbounded renderer state after the user scrolls the
   collection once.
