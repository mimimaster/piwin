# Desktop client collection windowing — Phase 3 execution plan

| Field | Value |
|-------|-------|
| Status | **Tasks 1–3, browser lifecycle repair, and clean 10-minute idle gate complete; 30-minute tool-heavy gate pending** |
| Date | 2026-08-09 |
| Owner | Contracts + Host session authority + Desktop projection |
| Parent | [Host egress flow-control and Desktop renderer recovery](./2026-08-08-host-egress-flow-control-execution-plan.md) |
| Predecessor | [Desktop WebContent memory containment Phase 2](./2026-08-09-desktop-webcontent-memory-phase2.md) |

## 1. Outcome

Make every user-sized collection crossing into Desktop explicitly windowed.
The Host remains the authority for complete session indexes and transcripts;
the renderer owns only the page needed for navigation plus the active live
projection.

```text
Host session/index authority
  ├── bounded SessionListPage(cursor, limit, total)
  │     └── Desktop sidebar: one fixed-size page per visible scope
  └── bounded TranscriptPage(beforeCursor, limit, revision)
        └── Desktop: tail page + active partial turn + older-page cache budget
```

The immediate sidebar DOM boundary is a permanent first slice of this design:
it remains useful after the Host stops returning complete arrays.

## 2. Evidence and abnormalities

The clean Phase 2 renderer plateaued at about 214 MB, but its native heap still
contained approximately 400 `SVGSVGElement` objects, 530
`HTMLButtonElement` objects, and 847 `WebCore::JSEventListener` objects.

Read-only index statistics explained the counts:

- 112 active named General sessions were returned and mapped into the
  Conversations DOM without a limit;
- seven project scopes contained 1,035 active named sessions, including one
  project with 1,003 sessions;
- the default project previews mounted 21 additional session rows;
- each normal `SessionRowItem` mounted one row button, three action buttons,
  three action SVGs, and their handlers even while the actions were visually
  hidden.

The 133 default rows implied about 532 row buttons and 399 action SVGs, matching
the native heap almost exactly. The active restored transcript contained only
two messages and about 5.7 KiB on disk, so transcript DOM was not the source of
this particular residual object count.

Two latent unbounded paths are also present:

1. selecting an older active project session automatically expands the entire
   project list; for the 1,003-session project this can mount thousands of
   buttons and listeners;
2. `session/resume` still returns every UI transcript message even though
   reconnect hydration already caps a session tail to 16 messages.

Cold start additionally requests complete session lists for every recent
project and retains more than 1,100 summaries in Desktop state even though the
sidebar displays only a preview.

## 3. Architecture decisions

### 3.1 A navigation surface never maps an authority-sized array directly

Sidebar session rows use fixed-size pages. The active session selects its page
on navigation. The Host cursor page remains the transport primitive, but the
sidebar first presents six sessions and uses `See all` to enter an invisible
bidirectional lazy browser rather than showing page numbers or previous/next
controls. Desktop retains a sliding window of at most three adjacent pages per
hydrated scope; crossing the top or bottom boundary fetches the previous or
next cursor, evicts the farthest page when the budget is exceeded, and preserves
a visible-row scroll anchor. `Show less` returns to the six-row preview and
refreshes the first Host page. Search remains the fast path for large indexes.
“See all” must not mean “mount all”, and infinite scroll must not mean “append
forever”.

### 3.2 Host pagination replaces client-side possession of the full index

Additive contracts will expose stable cursor pages with a validated limit,
ordering identity, total/count metadata, and an explicit stale-cursor result.
Desktop keeps pages under an LRU/byte budget. The Host may read its complete
disk index internally but does not serialize the complete array to every
client.

### 3.3 Transcript resume is tail-first and revisioned

Resume returns a bounded recent page, outline metadata, transcript revision,
and an older-page cursor. Older history is fetched on upward navigation. Live
events update only the active tail projection. Editing, revert, fork, export,
and model history injection stay Host-authoritative and continue to operate on
the full transcript.

An ADR is required with the contract slice because cursor semantics affect
local sidecar and remote Host modes.

## 4. Execution tasks

### Task 1 — bound sidebar DOM immediately

- [x] Add a tested pure session-page selector.
- [x] Page project and General rows with fixed mount limits.
- [x] Select the active session's page without expanding the collection.
- [x] Replace “See all mounts all” with a fixed first-page safety boundary;
      Task 5 supersedes its temporary visible controls with bounded lazy load.
- [x] Verify a 1,003-row fixture mounts no more than the configured page.
- [x] Re-sample native SVG, button, listener, and footprint counts.

### Task 2 — add Host-owned session index pages

- [x] Write the cursor/order ADR.
- [x] Add additive `SessionListPage` contracts and validation.
- [x] Implement HostRuntime paging through the session package public API.
- [x] Project the same contract through local and remote transports.
- [x] Replace Desktop complete-list hydration with one replaceable page per
      hydrated scope.
- [x] Add stale cursor, anchor, pin/reorder, archive, lifecycle search, and
      10,000-row tests.

### Task 3 — add tail-first transcript pages

- [x] Add revisioned transcript-page contracts and byte/item limits.
- [x] Resume with the tail page and an older cursor.
- [x] Fetch older pages from the transcript viewport/history navigator.
- [x] Bound the Desktop page cache by messages and retained UTF-8 bytes.
- [x] Preserve active partial turns across page fetch/reconnect.
- [x] Test edit/revert/fork/export against history not resident in Desktop.

### Task 3A — close the right-panel browser resource lease

- [x] Prove whether Host push subscription launches Chromium before use.
- [x] Separate reusable BrowserSession lifetime from the Chromium process lease.
- [x] Give every mounted surface a one-shot lease ID so StrictMode, delayed
      commands, and multiple clients cannot resurrect or cross-release panels.
- [x] Make right-panel unmount await Host-side persistent-context shutdown.
- [x] Drop any screenshot frame that finishes after its final surface lease is
      released.
- [x] Keep already-registered agent browser tools able to relaunch after stop.
- [x] Resolve the injected `@medv/finder` entry independently of Host cwd.
- [x] Reuse persistent Chromium's initial page instead of retaining a redundant
      second renderer; close partial runtimes transactionally on init failure.
- [x] Run a real Playwright process smoke for passive subscribe, start, stop,
      multi-lease release, late-start suppression, relaunch, and permanent close.

### Task 3B — bound development User Timing at the write boundary

- [x] Reproduce the clean-start WebKit growth independently of sidebar DOM,
      Host traffic, HMR, and Playwright Chromium.
- [x] Install the development timeline guard before `createRoot().render()` in
      both the main and pet WebContent entry points.
- [x] Wrap `performance.measure()` so exceeding the 5,000-entry budget clears
      measures and marks synchronously in the same event-loop turn.
- [x] Retain interval pruning only as a reconciliation fallback and restore the
      original method during HMR disposal.
- [x] Add a timer-independent flood regression proving the fourth write clears
      a three-entry test budget immediately.

### Task 4 — verify closure

- [x] Run typecheck, architecture tests, affected-package tests, Desktop tests,
      and targeted lifecycle E2E. The three pre-existing Desktop document
      recovery failures are recorded in the implementation note.
- [x] Repeat a clean 10-minute idle native sample after the synchronous User
      Timing guard: footprint held from 277.7 MiB at 2:54 to 278.3 MiB at
      10:15, with 2,207 measures and no Chromium.
- [ ] Capture the 30-minute tool/thinking-heavy native sample and post-run
      reclaim without silently consuming a provider workload.
- [x] Record Host response sizes, mounted row counts, client cache bytes, and
      Stop latency.

### Task 5 — replace visible paging with bounded lazy loading

- [x] Keep `session/list-page` and opaque Host cursors as the only authority
      boundary; do not add a Desktop-owned complete index.
- [x] Retain at most three adjacent Host pages per scope and merge by revision
      plus page index, with stale/non-adjacent responses resetting the window.
- [x] Trigger previous/next loading through invisible intersection boundaries
      and preserve the visible row when pages are prepended or evicted.
- [x] Remove visible page numbers and previous/next controls from project and
      General lists; show only the shared loading spinner while a request is in
      flight.
- [x] Preserve the six-row `See all`/`Show less` disclosure: lazy cursor
      boundaries exist only while expanded, and collapsing refreshes page zero.
- [x] Test 10,000-session bounded retention, cursor direction, revision reset,
      duplicate suppression, and absence of pagination controls.

## 5. Acceptance gates

- No sidebar action can mount a number of session rows proportional to the
  complete Host index.
- Default and paged sidebar DOM remain within the declared row budget for a
  10,000-session fixture.
- Desktop cold-start session summary bytes are bounded by requested pages.
- Transcript resume bytes and retained renderer history are bounded while all
  history operations remain correct.
- Closing/switching away from the browser panel releases its Chromium runtime;
  passive Host subscription does not launch one, concurrent clients cannot
  cross-release leases, and later tools can relaunch.
- Development instrumentation cannot overshoot the retained User Timing budget
  while the WebKit main thread is too busy to service an interval callback.
- Lazy sidebar navigation retains no more than its declared adjacent-page
  window; scrolling through the complete index cannot accumulate every visited
  session or every visited row in Desktop.
- Local SDK/RPC sidecar and remote Host modes implement identical contracts.

## 6. Rollback boundary

The page size and presentation may change independently. Rollback may restore
an explicit page affordance, but must not restore complete-array rendering,
active-session auto-expansion, an append-only infinite list, or a “See all”
action that mounts every row.
