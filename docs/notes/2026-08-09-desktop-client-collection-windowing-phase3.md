# Desktop client collection windowing Phase 3 — Tasks 1–3 record

| Field | Value |
|-------|-------|
| Date | 2026-08-09 |
| Status | Sidebar, Host session-index paging, transcript paging, browser-process lease, and clean 10-minute idle gate complete; 30-minute tool-heavy gate pending |
| Plan | [Desktop client collection windowing Phase 3](../plans/2026-08-09-desktop-client-collection-windowing-phase3.md) |

## Diagnosis

After Phase 2 reached a stable clean-renderer platform near 214 MB, `heap`
still reported these live WebCore objects:

| Object | Before sidebar paging |
|--------|-----------------------|
| `HTMLButtonElement` | 530 |
| `SVGSVGElement` | 400 |
| `SVGLength` | 3,599 |
| `JSEventListener` | 847 |

The product session index contained 112 active named General sessions and
1,035 active named project sessions. Seven project scopes held
`[1003, 23, 4, 2, 1, 1, 1]` sessions; their default six-row previews mounted
21 project rows. The General section mapped all 112 rows.

That produced 133 default session rows. A normal row owned one main button,
three visually hidden action buttons, and three SVG action icons. The implied
532 buttons and 399 SVGs match the native counts closely enough to establish
the source. The restored transcript had only two messages and its persisted
file was about 5.7 KiB, ruling out transcript size for this residual lane.

The previous project logic also expanded an entire list whenever the active
session index exceeded five. Restoring an old session in the 1,003-session
project could therefore mount thousands of controls.

## Implemented boundary

- `selectSessionSidebarPage` is a pure, tested page selector.
- Project folders mount at most six session rows per page.
- General Conversations mount at most twelve rows per page.
- With no manually selected page, the active session chooses its page; this
  replaces active-session auto-expansion.
- Previous/next controls replace the old all-row expansion.
- Search and ordering reset manual page state so results begin at the relevant
  active/first page.

This is a permanent renderer projection boundary. Task 2 also prevents complete
session-index arrays from entering Desktop, and Task 3 applies the same
Host-authority/client-projection split to transcripts.

## Task 2 — Host-owned session pages

The additive `session/list-page` command now carries one explicit scope,
active/archived lifecycle, global Host order, a limit capped at 50, and an
opaque revision cursor. `session/list` remains available for older shells.

The session package filters scope, lifecycle, and listability and applies the
complete-index order before slicing. Cursor revisions invalidate after pin,
archive, rename, or other public projection changes. Desktop retries one stale
cursor once at page zero; it cannot enter a retry loop. A cursorless
`anchorSessionId` lets session restoration open the containing page directly,
including the 10,000-record fixture, rather than walking prior pages.

Desktop first shipped one replaceable page per hydrated scope. The follow-up
lazy presentation now retains a bounded adjacent-page window:

- Host project pages contain at most six summaries and General pages at most
  twelve;
- each scope retains at most three adjacent pages and 128 KiB of serialized
  summary projection;
- page responses are generation-guarded so an older response cannot overwrite
  a newer sort/lifecycle request;
- scrolling across an invisible top/bottom boundary prepends or appends one
  adjacent cursor page, evicts from the far side, and preserves the visible row
  rather than displaying page controls;
- a changed revision or non-adjacent response replaces the window instead of
  merging incompatible indexes;
- reducer list pushes ignore unknown background inserts after page mode starts;
  the active newly named projection is admitted but the array remains capped;
- pin, rename, archive, unarchive, and delete refresh the owning Host page;
- search requests at most 30 Host hits for the active scope and General, with
  lifecycle filtering before the bound, instead of searching only the
  resident page;
- local sidecar, browser mock, and remote Host Server expose the same page
  outcome and path-safe remote projection.

### Serialized response evidence

A read-only `JSON.stringify` byte measurement of the public response
projection against the current on-disk index produced:

| Scope at measurement time | Named active rows | Legacy full response | First Host page | Reduction |
|---------------------------|------------------:|---------------------:|----------------:|----------:|
| Largest current project | 23 | 12,140 B | 3,743 B (6 rows) | 69.2% |
| General | 100 | 35,659 B | 7,307 B (12 rows) | 79.5% |

The earlier 1,003-project diagnosis remains the native DOM stress evidence;
the live index contents changed between samples. The 10,000-row deterministic
test is the stable acceptance fixture and still returns only the requested
page.

### Invisible lazy sidebar navigation

The visible previous/next page row was a safety-first containment UI, not a
product requirement. It has been replaced by cursor-aware lazy boundaries:

- no page number or previous/next control is rendered;
- project and General lists initially render a six-row preview; `See all`
  switches that scope into this bounded lazy mode, while `Show less` removes
  the boundaries and reloads its first Host page;
- entering the bottom boundary requests `nextCursor`; entering the top boundary
  requests `previousCursor`;
- only one request per scope may be in flight;
- a shared UI-kit Spinner is shown only while the boundary request runs;
- the first visible session row is captured and restored across a prepend or
  far-page eviction, preventing scroll jumps;
- walking a deterministic 10,000-session projection retains only the final
  three pages (16 rows on its partial last project page), not all visited rows.

## Task 3 — Host-owned transcript pages

`session/resume` now returns a revisioned recent tail instead of copying the
complete durable transcript into Desktop. Its default projection is capped at
16 messages and 256 KiB. The additive `session/transcript-page` command accepts
an opaque older cursor and caps a requested page at 50 messages and 512 KiB.
A mutation changes the transcript revision, so an older cursor returns the
explicit `stale-cursor` outcome; Desktop retries once from the bounded tail and
cannot loop.

The Desktop projection has a second independent bound:

- older pages prepend chronologically with message-id deduplication;
- the retained history cache is capped at 160 messages and 2 MiB of UTF-8
  message data;
- the same retention gate runs on initial hydration and new user/assistant
  appends, so a renderer that stays connected for many turns cannot bypass the
  page-cache bound; evicted messages also prune their Run and Walkthrough
  projections;
- the current tail and a live partial turn are never evicted to admit history;
- a stale-cursor tail refresh merges, rather than replaces, the active local
  turn and preserves its run/streaming state;
- upward fetch preserves the scroll anchor instead of jumping the viewport;
- resume falls back to legacy `session/messages` only when connected to an
  older Host that returned neither messages nor transcript-page metadata.

Durable operations do not depend on the renderer cache. Duplicate and fork ask
for no redundant response transcript and then resume the new session through
its bounded tail. Edit/revert truncation asks the Host for a bounded tail
projection. Export, fork, truncation, model history, and compaction continue to
read complete Host storage. The integration fixture proves that a shell holding
only the newest 16 of 80 messages can still export the oldest message, fork
from non-resident history, truncate to 40 durable messages, and receive only a
16-message response tail.

Oversized individual projected messages are clipped only in the page response
and marked as truncated; the durable message is not rewritten. This closes the
case where one message could defeat an otherwise correct byte limit.

## Additional finding — browser panel Chromium lease

The right-panel audit found a separate lifecycle defect. It did **not** explain
the screenshot's 8.76 GB `piwin-desktop Web Content` process—Playwright Chromium
is a separate OS process—but it could add an avoidable browser process and
break later browser tools:

1. HostRuntime subscribed to BrowserSession pushes while composing Pi tools;
   `subscribe()` immediately launched Chromium even when the panel had never
   opened.
2. Browser panel unmount sent `browser/stop`, which permanently called
   `BrowserSession.close()` while HostRuntime and frozen tool registrations
   retained that closed object.
3. The injected `@medv/finder` bundle resolved from `process.cwd()`, so a Host
   launched outside `packages/browser` could spawn Chromium and then fail
   during context initialization.
4. A persistent context already starts with an `about:blank` page, but the
   service unconditionally created another page and retained a redundant
   renderer.
5. A naked global start/stop bit could not distinguish React StrictMode setup
   cleanup from a newer mount, or one connected client from another.

The repaired model keeps one reusable Host-owned BrowserSession and leases only
its Playwright runtime. Subscription is passive. Every mount uses a one-shot
UUID; its cleanup releases only that ID, and a bounded released-ID set prevents
a delayed start from resurrecting a closed surface. The final lease release
stops the timer, drops a screenshot that finishes after ownership ended, and
awaits the persistent `BrowserContext.close()`. An agent tool can lazily
relaunch afterward. Permanent `close()` is reserved for HostRuntime disposal.
Finder resolution is anchored to the browser package module URL, the context's
initial page is reused, and partial initialization is closed transactionally.

A real Playwright smoke from the repository root observed the final named-lease
implementation:

| Phase | Profile-owned Chromium main process |
|-------|--------------------------------------|
| Direct persistent-context probe | one initial Page (`about:blank`) |
| Host subscription only | none |
| Two concurrent mirror leases | PID 72969, 83,184 KiB RSS |
| First lease released | same PID 72969 remains |
| Final lease released | none after awaited close; 18 ms |
| Released lease's delayed start | none |
| New independent lease | new PID 73039, 79,664 KiB RSS |
| New lease released | none |

A separate tool-path smoke then observed no process after panel stop, a fresh
PID 74219 after `snapshot()`, and no process after permanent Host close. This
proves that panel cleanup releases the process without invalidating frozen
agent-tool registrations.

The RSS figures are for the profile-owning main process, not the complete
Chromium process tree. The lifecycle assertion is process identity and exit,
not a claim about total browser memory.

A read-only check of the still-running **pre-fix** development Host also found
one 24-minute-old `~/.piwin/browser-profile` Chromium tree: the main process and
its three direct GPU/network/renderer children totalled 212,448 KiB RSS (about
207.5 MiB). That Host must restart to load the new lifecycle implementation;
the process was observed but not terminated during this work.

At 2026-08-09 14:03 CST the same old tree was still present after 43 minutes.
Its main/GPU/network/renderer RSS then totalled 102,720 KiB (about 100.3 MiB).
Idle RSS reclamation changed the amount, but the unchanged process identity and
continued residence confirm the pre-fix lifetime defect. The running user
process was not terminated or restarted during implementation.

After explicit user approval, the old Desktop/Host process group and an
unrelated 1-day-old orphan piwin Vite process were shut down. A clean standard
`pnpm dev:tauri` restart then proved the new passive boundary in the real
composition root: Tauri, Vite, and the SDK Host were live, but no
profile-owned Chromium process existed while the browser panel remained
closed. The final supervised restart at 14:35 CST retained that state with one
Vite listener and no Chromium process after Host handshake.

## Native HMR evidence

The same WebContent process was sampled before and after HMR, so allocator
physical high-water pages were expected to remain committed. Live object
counts changed immediately:

| Object | Before | After | Direction |
|--------|--------|-------|-----------|
| `HTMLButtonElement` | 530 | 186 | about -65% |
| `SVGSVGElement` | 400 | 146 | about -64% |
| `SVGLength` | 3,599 | 1,413 | about -61% |
| `JSEventListener` | 847 | 503 | about -41% |

Physical footprint stayed around 214.6 MB in this HMR-aged process. That does
not negate the object removal: WebKit allocators do not necessarily return
committed pages after HMR. A clean-start sample belongs in Phase 3 Task 4.

The HMR generated 4,430 React development `PerformanceMeasure` objects, below
the configured 5,000-entry budget, and the count remained stationary in the
follow-up sample.

## Clean-restart finding — User Timing must be bounded synchronously

The first clean restart exposed a second, development-only WebKit allocation
lane that HMR sampling had hidden. It was independent of the original Host
event amplification and of the browser lifecycle defect: there was no active
turn, no HMR update, no Playwright Chromium process, and only a small change in
DOM object counts.

The original guard was installed from a React effect and checked the
Performance Timeline every ten seconds. React development instrumentation can
produce thousands of `performance.measure()` entries in one long event-loop
turn. When WebKit's main thread was busy hydrating the shell, the interval did
not run soon enough:

| Clean-start elapsed | Physical footprint | Peak | `PerformanceMeasure` entries |
|--------------------:|-------------------:|-----:|-----------------------------:|
| about 1:00 | 259.6 MiB | 417.5 MiB | 2,222 |
| about 1:45 | 559.3 MiB | 971.7 MiB | 5,118 |
| seconds later | 761.8 MiB, then about 1.1 GiB | over 1 GiB | 29,072 |

The process was stopped immediately. This result changes the enforcement
point, not merely the polling period:

- both `main.tsx` and `pet-overlay-main.tsx` install the guard before
  `createRoot().render()`;
- the guard wraps `performance.measure()` and clears measures plus marks on the
  first write above the 5,000-entry budget, after the current measure has
  consumed any named marks;
- the ten-second interval remains only as a reconciliation fallback;
- HMR disposal restores the original `measure` method;
- a unit test floods a three-entry budget without advancing timers and proves
  the fourth write clears synchronously.

The second clean renderer stayed flat for more than ten minutes:

| Elapsed | Physical footprint | Peak | `PerformanceMeasure` entries |
|--------:|-------------------:|-----:|-----------------------------:|
| 0:30 | 276.3 MiB | 528 MiB | 2,200 |
| 1:33 | 276.8 MiB | 528 MiB | 2,200 |
| 2:54 | 277.7 MiB | 528 MiB | 2,200 |
| 4:57 | 277.7 MiB | 528 MiB | 2,207 |
| 7:00 | 277.9 MiB | 528 MiB | 2,207 |
| 10:15 | 278.3 MiB | 528 MiB | 2,207 |

From 2:54 to 10:15 the footprint increased only 0.6 MiB. The endpoint retained
201 buttons, 202 SVG roots, and 529 WebCore event listeners, with no Chromium
process. Native heap output still described a roughly 4.1 GiB logical/virtual
WebKit allocation range, but its pages were not physically committed: the
authoritative `vmmap` physical footprint remained stable. Virtual address size
alone is therefore not the acceptance signal for this incident.

The final standard supervised `pnpm dev:tauri` restart independently remained
healthy after six minutes: the main WebContent was 286.7 MiB physical footprint
(508.1 MiB peak), retained 2,705 measures, 202 buttons, 202 SVG roots, and 529
listeners, and still had no Chromium while the panel was closed. Tauri, Vite,
and the SDK Host stayed in the same supervised process group with exactly one
Vite listener.

This finding does not overturn the original streaming-amplification diagnosis.
It closes a separate React-development instrumentation lane that could itself
commit multi-gigabyte WebKit allocator pages during local development.

## Verification

| Bounded metric | Recorded result |
|----------------|-----------------|
| Largest current project first Host page | 3,743 B / 6 rows |
| General first Host page | 7,307 B / 12 rows |
| Transcript Host response | 16 items / 256 KiB default; 50 / 512 KiB hard maxima |
| Desktop retained transcript cache | 160 messages / 2 MiB hard maxima |
| Browser final-lease Stop latency | 18 ms in real Chromium smoke |
| Clean idle native footprint | 277.7 MiB at 2:54; 278.3 MiB at 10:15 |
| Clean idle User Timing history | 2,207 measures at 10:15; 5,000 hard maximum |

- Root `pnpm typecheck` passed across all 29 participating workspace projects.
- The package-boundary architecture check passed.
- Full affected-package tests passed:
  - contracts: 23 files / 191 tests;
  - session: 24 files / 163 tests;
  - browser: 6 files / 54 tests;
  - HostRuntime: 100 files / 955 tests;
  - Host Server: 4 files / 19 tests;
  - Host Client: 1 file / 4 tests.
- Desktop session/transcript paging, reducer, mock, viewport, browser lifecycle,
  and sidebar tests passed, including 1,003- and 10,000-session bounded
  fixtures.
- Targeted Desktop lifecycle E2E passed 2/2: rename/archive/filter/delete and
  duplicate.
- Desktop production build passed. The current dirty-worktree build emitted a
  1,677.54 kB main JS chunk (502.13 kB gzip) and retained the existing Vite
  large-chunk warning; bundle size is not the runtime-memory acceptance gate.
- Desktop full tests reached 159/160 files and 987/990 tests. The only failures
  are the three pre-existing cases in `resolve-document-content.test.ts`
  (explicit Markdown fence cleanup, truncated `write_file` JSON recovery, and
  the long-plan regression). They are outside session collection paging and
  were not changed in this slice.
- Native live-object counts dropped in the running WebContent process, as
  recorded above.
- A real Chromium lifecycle smoke proved passive subscription, independent
  multi-client leases, delayed-start suppression, awaited process release, a
  new-PID tool relaunch, initial-page reuse, and final process release as
  recorded above.
- The focused development-timeline, pet-entry, theme-root, and browser-panel
  suites passed 19/19. The timing-specific subset passed 10/10, including
  synchronous same-turn pruning and HMR restoration.

The root typecheck result above was captured at 14:00 CST. A later 14:06 rerun,
after concurrently edited Usage dashboard files appeared in the shared dirty
worktree, stopped in `usage-panel.test.tsx`: its fixture lacked the new
`byModelKey` field and still passed the removed `onOpenSession` prop. This slice
did not modify or overwrite that independent work. The final browser package
typecheck and all 54 browser tests remained green after the last frame-loop
change.

After that concurrent Usage slice settled, the final 14:38 CST root
`pnpm typecheck` passed again across all 29 participating workspace projects.
`pnpm test:architecture`, the 19 focused Desktop tests, Prettier checks for all
touched implementation/record files, and the final Desktop production build
also passed.

This closes the automated Tasks 1–3, browser-lifecycle, and clean-start
10-minute idle gates. It does **not** close the complete Phase 3 native memory
gate: the 30-minute tool-heavy sample still has to be captured.

## Remaining verification work

1. Capture the 30-minute tool/thinking-heavy sample and post-run reclaim with an
   explicitly authorized provider workload or a controlled deterministic
   fixture.
2. Record its final WebContent footprint/peak and native event rate against the
   Phase 3 acceptance table.
