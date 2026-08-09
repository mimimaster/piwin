# Desktop WebContent memory containment Phase 2 — implementation record

| Field | Value |
|-------|-------|
| Date | 2026-08-09 |
| Status | Implemented; clean-start 10-minute spot evidence passed, 30-minute Gate A pending |
| Plan | [Desktop WebContent memory containment Phase 2](../plans/2026-08-09-desktop-webcontent-memory-phase2.md) |
| Parent | [Host egress flow-control and Desktop renderer recovery](../plans/2026-08-08-host-egress-flow-control-execution-plan.md) |

## What was abnormal

The original development WebContent did not reach a stable plateau. During the
investigation its footprint moved from about 393 MB to 976 MB, later varying
between 880 MB and 907 MB after allocator pressure. The peak footprint was
1.146 GB. Samples attributed as much as 690 MB to WebKit malloc and 338 MB to
owned graphics.

The strongest live heap signal was React development User Timing retention:

| Sample | Live `WebCore::PerformanceMeasure` objects |
|--------|---------------------------------------------|
| Early heap sample | about 38,581 |
| Growing renderer | 133,944 |
| Later renderer | 152,767 |
| Final stale renderer sample | 155,520 |

The application has no calls to `performance.mark()` or
`performance.measure()`. React 19 development instrumentation creates these
entries and attaches DevTools detail. WebKit retained them until the User
Timing buffer was explicitly cleared.

Static and process inspection found additional independent leaks of ownership:

- every restored right-panel tab body stayed mounted while hidden or while the
  entire panel was collapsed;
- settings, terminal, browser, file tree, knowledge, document, and other
  optional feature graphs were eagerly imported by `App.tsx`;
- all settings CSS was parsed by the main entry;
- full-stage backdrop filters were nested across workspace, chat, document,
  and context-bar layers;
- the production HostClient statically bundled the 100 KiB-source browser
  mock backend;
- two KaTeX implementations (`0.16.47` and `0.18.1`) were present in the main
  graph;
- Shiki was lazily initialized but still statically imported and parsed;
- file-tree dragging imported the complete file-tree module for one MIME
  constant;
- the browser mock imported the Node-backed `@piwin/session` root to reuse one
  pure fork-name function;
- two Vite servers simultaneously listened on IPv4 and IPv6 port 1420 while
  Tauri used the ambiguous `localhost` origin, leaving the sampled renderer on
  stale code without current HMR updates.

## Landed boundaries

1. Both Desktop WebContent entries own a development-only Performance Timeline
   budget. The final hardened design wraps `performance.measure()` before
   React render and clears on the first write above 5,000 entries; a 10-second
   check remains as reconciliation and HMR restores the original method.
2. `RightPanel` mounts the active non-terminal body only. An open terminal is
   the one documented keep-alive exception because `TerminalDock` still owns
   and closes PTYs on unmount.
3. Optional Desktop surfaces use named React lazy imports. Each mounted surface
   has an isolated Suspense boundary using the shared UI-kit spinner.
4. Settings CSS has a deferred entry loaded by `SettingsPanel`.
5. `.workspace` is the only full-stage backdrop-filter owner; nested regions
   retain translucent colors without new full-size blur surfaces.
6. Host mock, file tree, terminal, settings, and Shiki are outside the cold
   main graph. The direct KaTeX dependency is aligned to the `0.16.47` already
   required by Streamdown and Mermaid.
7. Pure fork-name policy now has `@piwin/session/fork-session-name`; the browser
   mock no longer imports the Node-backed session package root.
8. Local Vite and Tauri development share `127.0.0.1:1420`, so strict-port
   enforcement prevents an IPv4/IPv6 split-brain server pair.

## Production bundle evidence

Vite output before this phase came from the already-landed renderer-bounds
slice. Values below are uncompressed output sizes:

| Asset | Before | After | Change |
|-------|--------|-------|--------|
| Main JS | 3,012,490 B | about 1,651,610 B | about -45.2% |
| Main CSS | 621,776 B | about 536,980 B | about -13.6% |

New cold-path boundaries include:

- Settings: 474.47 kB JS + 80.32 kB CSS;
- Terminal: 347.81 kB JS + 5.24 kB CSS;
- browser mock Host: 52.00 kB JS;
- file tree: 15.15 kB JS;
- Shiki and its grammars: dynamic on first completed/static highlight.

These numbers demonstrate graph separation; bundle size alone is not used as
a proxy for native heap closure.

## Clean native spot evidence — not Gate A

Updating the deterministic development origin caused Tauri dev to perform a
clean restart. After roughly 2.5 minutes, process inspection showed exactly one
Vite listener on `127.0.0.1:1420` and these WebContent footprints:

| WebContent | Footprint | WebKit malloc | Graphics |
|------------|-----------|---------------|----------|
| Main Desktop | 212 MB | 116 MB | 81 MB |
| Pet overlay | 36 MB | 13 MB | about 14 MB combined graphics categories |

`heap` returned no `WebCore::PerformanceMeasure` or `PerformanceMark` rows in
the new main process. This confirms that the clean renderer runs the budgeted
code. It does not prove a 30-minute plateau: the parent Gate A matrix remains
open and must include sustained tool/thinking activity, batch evaluation
counts, cursor/queue metrics, and Stop latency.

The clean process then remained on the same short-window platform:

| Uptime | Footprint | WebKit malloc | Owned-unmapped graphics | User Timing objects |
|--------|-----------|---------------|-------------------------|---------------------|
| about 2.5 min | 212 MB | 116 MB | 81 MB | 0 |
| 5 min 15 sec | 214 MB | 117 MB | 81 MB | 0 |
| 7 min 46 sec | 214 MB | 117 MB | 81 MB | 0 |
| 10 min 34 sec | 213.9 MB | 118.2 MB | 80.9 MB | 0 |

The approximately 2 MB movement across the window is short-window plateau
evidence, not the formal slope gate. Between the final two native allocation
samples, the WebKit-zone object count moved only from 333,990 to 333,992. The
graphics value is consistent with a small number of full-window high-DPI
backing surfaces; the old 338 MB lane was consistent with many redundant
surfaces. The 10-minute endpoint also had exactly one Vite listener, on
`127.0.0.1:1420`.

The later `vmmap`/`heap` sample contained about 368,000 live allocations in all
zones (about 334,000 in the WebKit zone), versus roughly 1.39 million WebKit
zone allocations in the old renderer. Reserved JS gigacage address ranges are
still large by design but remain uncommitted virtual space; they are not
reported as physical regressions.

The old and new footprint samples have different allocator histories, so the
large numerical drop is directional evidence rather than a controlled
percentage claim.

### Later clean-restart hardening

Phase 3's user-approved restart showed that this phase's original interval-only
guard could be starved during one long React development task. Measures jumped
from 5,118 to 29,072 while physical footprint reached about 1.1 GiB despite no
active Host turn, HMR, or Chromium. The guard was therefore moved out of a
post-mount effect and into both WebContent entry points before React render,
with synchronous enforcement at the `performance.measure()` write boundary.

The follow-up clean process held from 277.7 MiB at 2:54 to 278.3 MiB at 10:15,
ended with 2,207 measures, and had no Chromium. See the
[Phase 3 implementation record](./2026-08-09-desktop-client-collection-windowing-phase3.md)
for the full sample. This supersedes the interval as the authoritative timing
boundary while preserving the earlier clean renderer evidence above.

## Verification

- `pnpm typecheck`: passed for all 29 participating workspace projects.
- `pnpm test:architecture`: package boundaries passed.
- `pnpm --filter @piwin/session test`: 22 files / 146 tests passed.
- Focused Desktop performance, lifecycle, Host, Markdown, Shiki, settings,
  right-panel, and browser tests passed.
- The hardened write-boundary guard's focused suites passed 10/10, including a
  same-turn flood test that does not advance timers.
- Production Desktop build passed; final main output was about 1,651.61 kB JS
  and 536.98 kB CSS.
- Full Desktop Vitest: 149 files / 937 tests passed. The only failures are the
  same three assertions in the user's untracked
  `resolve-document-content.test.ts`; no Phase 2 or Browser test fails.
- `git diff --check`: passed.

## Still pending

- Formal 30-minute native Gate A run and slope calculation.
- Moving PTY session authority above `TerminalDock`, after which the terminal
  keep-alive exception can be removed.
- A measured decision on whether inline math and the artifact preflight should
  gain deeper content-triggered chunks; they remain core Markdown behavior and
  were not split speculatively in this phase.
- Complete session-index and transcript arrays are addressed by the follow-up
  [client collection windowing plan](../plans/2026-08-09-desktop-client-collection-windowing-phase3.md).
