# Desktop memory diagnostics

The Memory panel reports the main WebContent process footprint. An empty idle
cache or a protected visible presentation does not explain the whole footprint:
WebKit allocations, decoded images and graphics resources are separate owners.
Do not treat a small cache estimate as proof that the process released that much
memory; compare fresh samples from the same process lifetime.

## Inspect the current page on macOS

The panel's **Investigate further → Enable page inspection** action opts the main
WKWebView into Safari Web Inspector using the public `isInspectable` API. Opening
the panel only queries status. The toggle requires a click, supports disabling
inspection again, and does not reload the view, interrupt a Run, change stored
settings, or enable inspection for other windows. Availability requires macOS
13.3 or newer; unsupported platforms hide this action. CLI and Host have no
WKWebView to inspect.

After enabling it, select piwin's main window in Safari's Develop menu. Safari's
web developer features may need to be enabled in its settings first. Use memory
timelines and JavaScript heap snapshots to identify retaining objects, and inspect
rendering layers to investigate graphics allocations. Record the high-usage
memory timeline before reloading or taking heap snapshots: a heap snapshot
performs garbage collection and then shows the remaining live object graph.
Snapshot collection and processing can temporarily stall the interface; capture
them while the owner is idle. Bringing the inspector to the front also takes
keyboard focus. Do not repeatedly automate inspector activation while the owner
is using piwin. The inspection opt-in itself does not collect a snapshot.
See [WebKit's memory debugging guide](https://webkit.org/blog/6425/memory-debugging-with-web-inspector/).
Snapshots may contain page content: keep them local and share only the necessary
findings. The diagnostic opt-in is supported in release builds without enabling
Tauri's developer-tools feature globally. See
[WebKit's inspection API](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/).

The action exists only in packages containing this source change. It cannot be
added to an already running older package without replacing/restarting that app.
Source delivery does not change the owner's installed application.

The reload action reads the current Host identity on each durability check.
An identity that was unavailable during startup does not keep the action locked
after the Host connects. Unknown identity, an active Run, and unsafe live drafts
still block recovery. This source correction does not reload a running app.

## Historical tool output retention

The report includes **Recent tool output**: Host output read by expanding
historical shell cards. Previously each session reader held every fulfilled
read promise for its whole lifetime, outside the cache census and pressure
budget. Closing a card or evicting its transcript row did not release that
reader's copy.

Resolved outputs now share a window-wide LRU budget: at most 64 entries and
8 MiB estimated strings/keys normally, 16 entries/2 MiB after a moderate-pressure
clear, and no retained entries under critical pressure. Pending requests still
coalesce. A pressure/manual clear invalidates pending cache admissions, so late
responses cannot refill the cleared generation. Clearing references does not
erase output that an open card currently displays. Reopening an evicted card
can fetch it from Host again; stored sessions and tool output are not deleted.

An isolated Node reproduction of the production reader, using 2,048 unique
64 KiB synthetic outputs and explicit GC at measurement points, increased heap
from 3.33 to 132.17 MiB before the fix and stayed at 132.18 MiB after critical
pressure. The same workload after the fix stayed at 7.71 MiB and measured
4.31 MiB after pressure. These values demonstrate this retaining path; they do
not establish that all of the owner's main WebContent footprint came from it.

## Right panel starts on the tool launcher

Generic expansion starts on the tool launcher, including reopening after a
collapse. Remembered tab lists and per-session tool snapshots are not restored
or inherited into the strip. Choosing a tool lists that tool; explicit tool
commands still reveal their target. The plus picker remains available on the
launcher for secondary tools, including Memory. Conversation/project changes
also return to the launcher without expanding a collapsed panel.

Listed tabs and retained runtime owners have separate lifetimes. Reopening the
launcher does not close a running terminal; selecting Terminal resumes it.
Previously shown docked tool surfaces can retain their state without being
listed or visible. Per-project stage/workspace persistence remains available,
and old profile records need no manual cleanup. No installed app/profile is
changed by source delivery.

Terminal availability alone no longer seeds an unsolicited `zsh` tab. The first
terminal is created when its expanded panel is selected or the user explicitly
adds one. Hiding the panel leaves an existing terminal/PTY running, and closing
the last terminal keeps the list empty.

Docked tools defer their first component mount until their actual body is shown.
An expanded inspector displaying Memory, for example, does not activate the
hidden docked Browser/Canvas body. Once a tool has been shown, its state survives
tab changes and host reparenting; its existing close/reclaim policy still owns
subsequent disposal. These changes remove demonstrated background initialization,
but do not attribute the whole ordinary-chat multi-GB footprint to these tabs.

Browser picture demand also follows the actual selected docked body. Switching
from Browser to a non-docked inspector tab such as Terminal or Memory no longer
keeps the old docked Browser classified as visible. A browser moved onto the
stage and an actually visible mini retain their independent picture demand.

## November 15 ordinary-chat incident

The owner reported 8.71 GB, fresh/critical, one visible presentation, no idle
cache, and an active Run blocking view reload. A read-only native snapshot of
main WebContent PID 89690 recorded approximately 8,103 tool MB, including 4,706 MB
owned graphics and 3,311 MB WebKit malloc. Its lifetime peak was about 11 GB.
This is a different renderer lifetime from the November 14 observation.

Xcode Instruments was already installed. An attempted 15-second Allocations
attachment was rejected because the system WebKit process is restricted under
System Integrity Protection. The trace contains no valid target allocation
recording. Do not disable system protection as a troubleshooting requirement.
The installed build did not expose page inspection, so the retaining owner in
the current ordinary-chat page remains unidentified. Terminal-only experiments
must not be presented as a fix for that incident.

An independent nonpersistent WKWebView using synthetic true-color CJK output
showed a concrete terminal graphics-pressure gap. Baseline reached 703.3 MiB at
15.6 seconds before a memory cap stopped it. A production-source run that entered
critical pressure and released GPU resources continued to 25 frames, retained
302 buffer lines and its first history marker, had zero terminal canvases, and
ended at 108.9 MiB (46.2-second sample; observed peak 109.9 MiB). Offscreen rAF was
replaced by a deterministic synthetic draw clock in these probes. These are
bounded mechanism tests, not a normal-chat reproduction or a long-run leak proof.

Evidence and reproduction sources are stored locally under
`docs/notes/2026-11-15-piwin-memory-evidence/`.

## Whitelisted live status animations

Core status indicators using `ui-anim-*` (such as `AgentLocatorMark` /
`RadialBellow` in `RunStatusFooter`) are whitelisted under `moderate` (768 MiB)
and `critical` (1536 MiB) memory pressure so active-run feedback stays alive
while the window is visible, pausing only under `data-memory-parked` when the
window is hidden. `RadialBellow` places its radial vane rotation and offset on
static `.ui-anim-radial-bellow__slot` wrappers while `@keyframes
ui-anim-radial-bellow` animates only `scale` and `opacity`, keeping animations
compositor-friendly and preventing vanes from collapsing at center when paused.
The Memory panel reports the live mounted count (`liveStatusAnimations` in
`desktopMetrics.resourceCounts`) alongside the current visual degradation policy
matrix without fabricating per-element WebKit graphics byte counts.
