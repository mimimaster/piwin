# Desktop WebContent memory incident (2026-08-08)

## Status

- The original incident pass was diagnostic; the linked Phase 2/3 records now
  contain the implemented transport, renderer, collection, browser-lifecycle,
  and development User Timing repairs.
- Architecture follow-up: [Desktop streaming incident — architecture analysis](./2026-08-08-desktop-streaming-architecture-analysis.md).
- Adopted decision: [ADR 0038 — Host egress delivery authority, flow control, and client recovery](../adr/0038-host-egress-flow-control-and-recovery.md).
- Delivery contract: [Host egress delivery and recovery specification](../specs/host-egress-delivery.md).
- Implementation sequence: [Host egress flow-control and Desktop renderer recovery execution plan](../plans/2026-08-08-host-egress-flow-control-execution-plan.md).
- Collection-windowing and browser-process follow-up: [Phase 3 implementation record](./2026-08-09-desktop-client-collection-windowing-phase3.md).
- Severity: critical. The main Desktop renderer was terminated by WebKit twice and
  automatically reloaded before the 8.76 GB screenshot was taken.
- Primary cause confidence: high.
- Exact split between Tauri/WKWebView evaluation retention and React/WebKit render
  allocation retention: medium; both are downstream of the same event amplification.

## Executive conclusion

The 8.76 GB process was the **main `piwin-desktop` WebContent renderer**, not the
pet overlay, Node Host, image store, or a single oversized transcript.

The primary defect is an event-amplification loop introduced with the Run
projection:

1. A streaming `AgentEvent` delta is pushed by `HostRuntime`.
2. `RunRegistry.noteAgentEvent()` runs for the same event and unconditionally
   invokes `onRunUpdated`, even when neither phase nor any other user-visible Run
   field changed.
3. The resulting non-stream `run/updated` push forces
   `host-serve-stream-batcher` to flush its pending delta immediately. This
   defeats the intended 24 ms coalescing and produces two JSONL frames for nearly
   every provider delta.
4. The Tauri Rust bridge emits every JSONL frame separately as `host-message`.
   Tauri 2.11 generates a JavaScript snippet for each event and WRY 0.55 calls
   `WKWebView.evaluateJavaScript` on macOS.
5. The Desktop immediately reduces every `run/updated`. `applyRunRecord()` creates
   a new `runRecordsById` object every time; `ChatMessageRow` memoization compares
   that whole object by identity, so all mounted transcript rows become eligible
   to render again for every amplified update.

The result during a live agent turn was about **200 native-to-WebView JavaScript
evaluations per second**, plus repeated whole-transcript React work. WebKit
retained the resulting allocation churn mainly in `bmalloc`/compressed memory
until its renderer kill threshold was crossed.

## User-visible symptom and process identity

The Activity Monitor row in the screenshot showed:

```text
piwin-desktop Web Content    8.76 GB
```

Process and WebKit logs distinguish two piwin WebContent processes:

- Main Desktop renderer: the large and repeatedly killed process.
- Pet overlay renderer: approximately 90–207 MB throughout the incident.

The pet overlay's decoded sprite atlas accounts for its expected graphics
allocation. It did not track the main renderer's growth and is excluded as the
incident source.

## Timeline (Asia/Shanghai)

| Time | Main renderer | Observation |
| --- | ---: | --- |
| 11:57–13:56 | PID 48256 | Before the scroll-fade commit, reached about 5.1 GB, then reclaimed to about 1.7–2.0 GB. The underlying streaming allocation problem therefore predates the fade mask. |
| 13:56 | PID 422 | Desktop restart after commit `f18d4c2`. |
| 19:41:59 | PID 422 | WebKit measured 16,546 MB, could only shrink to 16,477 MB, and killed it at the 16,384 MB threshold. |
| 19:41:59 | PID 66700 | WebKit automatically created a replacement main renderer. It rose from about 10 MB to 898 MB in 30 seconds, 1,578 MB in 60 seconds, and 4,114 MB in about 5.5 minutes while a run was active. |
| 20:07:00 | PID 66700 | WebKit killed it at 9,913 MB because it could not shrink below the then-active 4,096 MB threshold. |
| 20:07 | PID 87718 | Second automatic replacement. It stayed near 279 MB while idle, crossed 1 GB shortly after a new turn at 20:21, reached 5.5 GB at 20:39, and plateaued around 9.6 GB after the active runs stopped. This is the screenshot-era process. |
| about 22:15 | PID 12592 | Full user restart. The new main renderer started around 10 MB and remained roughly 0.4–1.0 GB without a live run during the 46-minute observation window (1.5 GB sampled peak), without the prior catastrophic slope; the new pet renderer remained about 0.1 GB. |

This was not one anomalous high-water reading. It was a repeated renderer
OOM/reload cycle while the Host process remained alive.

## Native event-rate evidence

Unified WebKit logs record each Rust/Tauri event delivery as
`WebPageProxy::runJavaScriptInFrameInScriptWorld`. For PID 422, the count changed
as follows when the incident run began:

| Minute | Native-to-WebView JS evaluations |
| --- | ---: |
| 19:36 | 34 |
| 19:37 | 5,081 |
| 19:38 | 8,673 |
| 19:39 | 12,728 |
| 19:40 | 12,352 |
| 19:41 | 13,514 |

Additional one-minute samples:

- PID 66700 at 19:42: 14,166; at 19:50: 15,157.
- PID 87718 while idle at 20:10: 0; during a run at 20:22: 13,204;
  during another active interval at 20:39: 7,976; idle at 21:10 and 22:00: 0.
- Pet PID 428 at 19:40: only 21, versus 12,352 for main PID 422.

The event flood starts and stops with active turns, and its rate tracks the
main renderer's memory growth.

## Why the existing stream batcher did not protect the renderer

`apps/cli/src/host-serve-stream-batcher.ts` normally merges contiguous deltas.
An in-process probe against the current implementation produced:

```json
{
  "oneHundredDeltasOnly": 1,
  "oneHundredDeltasWithRunUpdates": 200,
  "eventFrames": 100,
  "runFrames": 100
}
```

The second case is the production order. In
`packages/host-runtime/src/host-runtime.ts`, the event is pushed first and then
`runRegistry.noteAgentEvent()` is called. In
`packages/host-runtime/src/run-registry.ts`, `noteAgentEvent()` calls
`onRunUpdated` at the end even when `nextPhase` is undefined. Since
`run/updated` is not a stream delta, the batcher clears its timer, drains the
pending delta, and writes both frames.

The unconditional Run update arrived in commit `6234b848` on 2026-08-05. The
stream batcher itself predates that change, so the interaction is a regression
that neither component's isolated tests caught.

## OOM allocator evidence

WebKit's own OOM statistics show that the multi-gigabyte footprint was not a
multi-gigabyte live JavaScript heap or a graphics atlas:

| Renderer | Footprint after shrink | Compressed | `bmalloc` dirty memory | JS GC heap size | Documents |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 422 | 16,477 MB | 14,295 MB | 15,277 MB | 199 MB | 1 |
| PID 66700 | 9,913 MB | 9,393 MB | 9,657 MB | 83 MB | 1 |

For PID 422, WebKit reported only 1,146 MB resident while the physical footprint
was 16,477 MB because 14,295 MB had already been compressed. This explains why
plain `ps rss` understated the failure while Activity Monitor, `vmmap`, and
WebKit's footprint logs exposed it.

These figures are consistent with extreme short-lived WebKit allocation churn
being retained/compressed in `bmalloc`. They rule out a 9–16 GB live React state
object as the direct explanation. A targeted production A/B is still required
to separate how much retention occurs in repeated `evaluateJavaScript` delivery
versus the render/layout work invoked by those deliveries.

## Rendering multiplier

The transport defect is sufficient to explain the event flood. The following UI
properties make its cost scale with transcript length:

- `ChatThread` mounts all transcript turns; there is no row virtualization or
  visible-window projection.
- `applyRunRecord()` recreates `runRecordsById` for every `run/updated`, including
  semantically identical updates.
- `ChatMessageRow` memoization requires the entire `runRecordsById` reference to
  remain identical. One Run update therefore invalidates every row's memo check.
- Historical thinking content is visually hidden when collapsed but remains
  mounted in `<pre>` elements.
- Many one- or two-tool assistant segments keep individual tool cards mounted.
- `appendBoundedToolOutput()` repeatedly concatenates the accumulated string and
  re-encodes the whole result with `TextEncoder`, causing quadratic allocation
  churn for a growing tool output.
- Syntax highlighting work is asynchronous and cannot abort an already-running
  Shiki tokenization when the source changes, although code fences were not
  common enough in the incident transcript to make this the primary cause.

The incident transcript was about 1.3 MB on disk (99 messages, 105 tools, about
0.6 MB thinking text, and about 0.29 MB tool output). The largest current
transcript was about 1.6 MB. No giant base64 string or individual multi-megabyte
message was found. Those sizes are large enough to magnify an all-row rerender,
but not to directly account for a 9–16 GB renderer footprint.

## Ruled out or demoted

### Pet overlay and media

- Pet WebContent stayed near 0.1–0.2 GB while main crossed 16 GB.
- `~/.piwin/media` was about 7.5 MB and `~/.piwin/pets` about 11 MB.
- No unbounded image/base64 payload was present in the active transcript.

### Right-panel Playwright Chromium

The controllable browser runs as a separate Playwright Chromium process, not as
the `piwin-desktop Web Content` process named in the 8.76 GB screenshot. It is
therefore excluded as the primary incident process. A later lifecycle audit did
find that Host push subscription launched it before the browser panel was used,
and panel close permanently closed a service object still retained by agent
tools. The repaired lease model now keeps subscription passive and awaits the
persistent context shutdown after the final independently identified panel
lease unmounts. It also reuses the persistent context's initial page instead of
retaining a redundant renderer. A final named-lease smoke observed the
profile-owning Chromium process disappear in 18 ms; a separate tool-path smoke
then relaunched it under a new PID and permanent Host close removed it again.
This removes a separate roughly 80–85 MiB main-process lane (plus helpers) but
does not reinterpret the multi-gigabyte WebKit evidence.

### Clean-restart React development User Timing

A user-approved clean restart on 2026-08-09 exposed another independent
development-build retention lane. The existing ten-second cleanup interval
could be starved while React produced many `PerformanceMeasure` entries in one
event-loop turn. With no active Host run, HMR, or Chromium process, the count
rose from 2,222 to 5,118 and then 29,072 while physical footprint advanced from
259.6 MiB through 559.3 MiB and 761.8 MiB to about 1.1 GiB.

The repair installs a guard in both WebContent entry points before React render
and enforces the 5,000-entry budget synchronously at the
`performance.measure()` write boundary. The interval remains a fallback. A
second clean sample stayed from 277.7 MiB at 2:54 to 278.3 MiB at 10:15, ending
with 2,207 measures and no Chromium. This does not replace the streaming root
cause above; it removes a separate development-only allocator amplifier.

### Web Inspector

Web Inspector was opened briefly around 17:24, after the main renderer was
already near 10 GB, and closed about a minute later. It added load but did not
start the incident.

### Scroll fade mask

Commit `f18d4c2` added a gradient mask to the transcript scroll container at
13:56, and the post-commit renderer retained substantially more memory than the
pre-commit renderer. However:

- the main renderer had already reached about 5.1 GB before that commit;
- both OOMs were overwhelmingly `bmalloc`, not graphics/IOSurface memory;
- a standalone WKWebView A/B with a long scroller, mask, nested backdrop filters,
  sticky rows, content growth, and scrolling did not reproduce catastrophic
  growth (static mask overhead was modest and the streaming probes reclaimed);
- the native event flood exactly follows active Host runs.

The mask/backdrop-filter combination remains a plausible compositor amplifier
and should not be applied directly to a large dynamic scrollport, but it is not
the primary root cause established by this incident.

WebKit has separately documented size-sensitive gradient-mask allocation/cache
behavior ([WebKit bug 282530](https://bugs.webkit.org/show_bug.cgi?id=282530));
that is corroborating risk, not proof for this OOM.

## Immediate containment

Until a fix lands:

1. If Desktop WebContent starts climbing continuously, stop active turns and
   fully quit/relaunch Desktop. A renderer auto-reload is not a reliable reset
   and already happened twice in this incident.
2. Avoid multiple concurrent, tool-heavy Desktop runs. Memory growth stopped
   when native event delivery stopped, but the compressed allocator footprint
   did not reliably return to baseline.
3. Do not rely on the 2 GB RunningBoard soft limit; WebKit allowed these
   renderers to reach 9.9 and 16.5 GB before termination.

The Tauri project has an open high-priority report showing that a high rate of
`Window::emit` calls can crash the app and that throttling reduces the problem
([tauri-apps/tauri#8177](https://github.com/tauri-apps/tauri/issues/8177)). That
report is on another WebView platform, so it supports the containment strategy
but does not replace the local macOS evidence above.

## Recommended repair order

1. **Stop redundant Run pushes.** In `RunRegistry.noteAgentEvent()`, invoke
   `onRunUpdated` only when a projected Run field actually changes. The first
   text/thinking delta may set `firstTokenReceived` and transition to
   `streaming`; subsequent same-phase deltas must not publish Run records.
2. **Make transport batching resilient.** Coalesce `run/updated` by `runId` and
   ensure a non-terminal presentation update cannot defeat delta batching. If
   an outer batch/envelope crosses the Host boundary, add it contracts-first and
   update every transport implementer.
3. **Prevent semantically identical UI updates.** Make `applyRunRecord()` return
   the prior state when the projected record is unchanged, and avoid passing the
   whole mutable-by-replacement Run map to every transcript row.
4. **Bound transcript rendering.** Window/virtualize historical turns and unmount
   collapsed thinking/tool detail content. Preserve scroll anchoring explicitly.
5. **Remove quadratic delta work.** Track bounded tool-output bytes
   incrementally instead of re-encoding the whole accumulated string per delta;
   make expensive highlighting abortable or defer it until a block is stable.
6. **Isolate visual fades.** Render top/bottom fade overlays outside the dynamic
   scroller rather than masking the full transcript surface.

## Required regression evidence

- Unit test: repeated same-phase `noteAgentEvent()` calls produce one initial
  Run projection change, not one callback per delta.
- Integration test: 100 same-stream deltas interleaved with Run projection must
  stay bounded; it must never produce the observed 200 wire frames.
- Desktop reducer/render-count test: identical Run projections do not replace
  `runRecordsById` and do not rerender historical rows.
- Native macOS smoke: the clean-start 10-minute idle gate passed after the
  synchronous User Timing repair. A tool/thinking-heavy turn must still run for
  at least 30 minutes; record `runJavaScriptInFrameInScriptWorld` evaluations
  per minute, WebContent physical footprint/peak, and post-run reclaim. There
  must be no monotonic multi-gigabyte growth and no WebKit renderer termination.
- Repeat with the transcript fade enabled and disabled to quantify the remaining
  compositor contribution after the transport defect is removed.
