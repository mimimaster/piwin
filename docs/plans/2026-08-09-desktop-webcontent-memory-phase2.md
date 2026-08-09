# Desktop WebContent memory containment — Phase 2 execution plan

| Field | Value |
|-------|-------|
| Status | **Implemented; clean-start 10-minute spot evidence passed, 30-minute Gate A pending** |
| Date | 2026-08-09 |
| Owner | Desktop renderer |
| Parent plan | [Host egress flow-control and Desktop renderer recovery](./2026-08-08-host-egress-flow-control-execution-plan.md) |
| Incident | [Desktop WebContent memory incident](../notes/2026-08-08-desktop-webcontent-memory-incident.md) |

## 1. Outcome

Bound the remaining Desktop renderer memory lanes after Host delivery,
tool-output, transcript-windowing, and pet-overlay containment landed. This
phase treats lifecycle, module loading, and compositor ownership as explicit
architecture boundaries rather than relying on WebKit to reclaim an
ever-growing renderer graph.

The target cold path is:

```text
main entry
  ├── bounded development diagnostics
  ├── shell + active transcript window
  ├── one workspace backdrop owner
  └── deferred feature surfaces
        ├── active right-panel surface only
        ├── terminal exception while an open PTY must survive tab switches
        ├── settings JS + CSS only while settings is open
        └── knowledge/subagent surfaces only while requested
```

## 2. Native evidence and abnormalities

The same main WebContent process was sampled twice on 2026-08-09:

| Sample | Footprint | WebKit malloc | Graphics | Observation |
|--------|-----------|---------------|----------|-------------|
| Warm renderer | about 393 MB | dominant | material | already above the desired idle envelope |
| About 20 minutes later | 976 MB (1.146 GB peak) | 690 MB | 244 MB | continued growth without a bounded plateau |

`heap` reported 133,944 live `WebCore::PerformanceMeasure` objects in the
later sample, up from roughly 38,581. The application does not call
`performance.mark()` or `performance.measure()`. React 19's development
renderer does call `performance.measure()` and attaches DevTools diagnostic
detail; WebKit retains those User Timing entries until explicitly cleared.
This is a development-build retention lane, not expected production React
behavior, but it makes native Tauri development unusably expensive and can
retain diagnostic copies of component data.

Static inspection found three additional ownership violations:

1. `RightPanel` restores every open tab and keeps every tab body mounted,
   including browser, document, canvas, notes, cards, file tree, side chat,
   and review surfaces while hidden or while the panel is collapsed.
2. `App.tsx` eagerly imports nearly every optional renderer surface.
   `SettingsPanel` transitively registers every settings page, while all
   settings CSS is also imported by the main stylesheet.
3. `.workspace`, `.chat-column`, `.workspace-document-stage`, and
   `.context-bar` apply nested full-stage `backdrop-filter` layers. This makes
   compositor ownership ambiguous and is consistent with the 244 MB graphics
   allocation lane.

Native verification also found two long-lived Vite servers bound to the same
port on different address families (`127.0.0.1:1420` and `[::1]:1420`) while
Tauri used `localhost`. That split asset/HMR routing and left the sampled
WebView on stale code. The default dev server and Tauri URL therefore share one
explicit IPv4 origin; configured remote development hosts remain supported.

Large JavaScript gigacage and WebKit reservation ranges in `vmmap` are virtual
address reservations and are not counted as physical regressions by this
plan. The tracked outcomes are footprint, dirty/owned graphics, live heap
objects, mounted surfaces, and cold bundle boundaries.

## 3. Architecture decisions

### 3.1 Development performance timeline has a hard budget

Both Desktop WebContent entries install a development-only guard before React
render, with lifecycle cleanup across Fast Refresh. The guard wraps
`performance.measure()` and clears measures and marks synchronously on the
first write above the configured maximum. This write-boundary enforcement is
required because React development instrumentation can emit thousands of
entries in one event-loop turn while an interval callback is starved. A
periodic count remains as reconciliation, and the explicit HMR disposer
restores the original method. Production builds do not install the guard.

### 3.2 Surface lifecycle follows visibility and authority

Only the active non-terminal right-panel body is mounted. An open terminal tab
is the sole temporary keep-alive exception because `TerminalDock` currently
owns PTY sessions and closes them on unmount. When the whole panel is
collapsed, non-terminal bodies unmount; an open terminal may stay mounted to
preserve its PTY.

Moving PTY session authority above `TerminalDock` is a later architectural
improvement. This phase records the exception rather than silently preserving
all unrelated surfaces.

### 3.3 Optional feature graphs are deferred

Heavy, route-like Desktop surfaces load through named React lazy boundaries.
Settings styles move to a settings-only CSS entry imported by the deferred
Settings module. Opening a feature may show the shared UI-kit spinner for one
chunk load; the base shell remains interactive.

### 3.4 One full-stage backdrop owner

`.workspace` owns the full-stage backdrop blur. Nested chat, document, and
context-bar regions retain translucent color surfaces but do not allocate
their own full-size backdrop-filter layers. Small bounded interaction overlays
remain outside this decision and can be measured separately.

### 3.5 Development uses one origin

Local Vite and Tauri development use `127.0.0.1:1420` consistently. A second
local server must fail the existing strict-port check instead of coexisting on
IPv4/IPv6 under the ambiguous `localhost` name.

## 4. Execution tasks

### Task 1 — bound React development timing retention

- [x] Add a focused performance-timeline budget module and unit tests.
- [x] Install it before React render in both Desktop WebContent entries only in
      development.
- [x] Enforce the budget synchronously at the `performance.measure()` write
      boundary and retain interval pruning as reconciliation.
- [x] Dispose the interval and restore the original method on HMR.
- [x] Confirm the native live `PerformanceMeasure` count falls below the
      configured budget without waiting for one pruning interval.

### Task 2 — enforce right-panel mount policy

- [x] Add a pure mounted-tab selector.
- [x] Mount the active tab plus the explicit terminal keep-alive only.
- [x] Unmount non-terminal content while collapsed.
- [x] Cover active, inactive, collapsed, and terminal-exception cases.

### Task 3 — split optional renderer JS and settings CSS

- [x] Add one focused deferred-surface module with named lazy imports.
- [x] Replace `App.tsx` eager imports for optional right-panel, settings,
      knowledge, and subagent surfaces.
- [x] Render the subagent session dialog only when a session is selected.
- [x] Move settings-only styles out of `styles.css` into a deferred settings
      entry.
- [x] Move the mock Host, file tree, and Shiki behind real dynamic imports;
      align the duplicate KaTeX dependency and expose browser-safe session
      naming through a pure public subpath.
- [x] Verify the production build emits separate feature JS/CSS chunks and
      reduces the main entry payload.

### Task 4 — enforce compositor ownership

- [x] Remove nested full-stage backdrop filters.
- [x] Add a source-level boundary test for the workspace blur owner.
- [x] Keep resizing behavior and translucent region colors intact.

### Task 5 — verify and record evidence

- [x] Run focused Desktop tests, Desktop typecheck, production build, and
      package-boundary tests.
- [x] Re-sample the clean renderer for timing-entry count and footprint.
- [x] Record emitted chunk sizes and the limits of high-water allocator
      measurements.
- [ ] Repeat the formal native cold-start/30-minute Gate A measurement after a
      user-approved clean Desktop restart.
- [x] Confirm a clean restart has one Vite listener and that the WebView runs
      the current performance-timeline guard.

The clean-start spot series at approximately 2.5, 5.25, 7.75, and 10.5
minutes held between 212 MB and 214 MB physical footprint, between 116 MB and
118.2 MB WebKit malloc, and at about 81 MB owned-unmapped graphics. No live
`WebCore::PerformanceMeasure` or `PerformanceMark` objects were reported. This
passes the short diagnostic plateau check but does not replace the unchecked
30-minute Gate A task above.

A later clean restart after Phase 3 exposed why interval-only enforcement was
insufficient: one starved event-loop turn reached 29,072 measures and about
1.1 GiB footprint. After the synchronous write-boundary hardening, the same
clean-idle gate held from 277.7 MiB at 2:54 to 278.3 MiB at 10:15 with 2,207
measures. The different absolute baselines reflect later application changes;
the acceptance signal is the flat same-process slope.

## 5. Acceptance gates

- Development User Timing history cannot grow beyond one pruning budget within
  a single event-loop turn, even if interval callbacks are starved.
- Inactive non-terminal right-panel surfaces are absent from the DOM; an open
  terminal is the only documented keep-alive exception.
- Settings and other optional surfaces do not belong to the cold main JS
  graph; settings CSS is not in the cold main CSS entry.
- Only `.workspace` owns the full-stage backdrop filter.
- Focused tests, Desktop typecheck, production build, and architecture tests
  pass without weakening TypeScript or package boundaries.
- A live HMR sample is diagnostic only: allocator high-water pages may remain
  committed. Closure of the incident still requires a clean native restart
  and the parent plan's 30-minute Gate A matrix.

## 6. Rollback boundaries

Each containment lane is independently reversible:

- remove only the development timing guard if it interferes with a profiling
  session;
- restore a specific surface's keep-alive only after documenting its external
  authority requirement;
- revert a lazy boundary without changing feature behavior;
- restore a nested compositor effect only with measured graphics evidence.

No rollback may restore the blanket policy that every hidden optional surface
stays mounted indefinitely.
