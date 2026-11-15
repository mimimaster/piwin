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
See [WebKit's memory debugging guide](https://webkit.org/blog/6425/memory-debugging-with-web-inspector/).
Snapshots may contain page content: keep them local and share only the necessary
findings. The diagnostic opt-in is supported in release builds without enabling
Tauri's developer-tools feature globally. See
[WebKit's inspection API](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/).

The action exists only in packages containing this source change. It cannot be
added to an already running older package without replacing/restarting that app.
Source delivery does not change the owner's installed application.

## Restored right-panel tabs

The right panel remembers tool tabs, and a new conversation can inherit its
project's last tool layout. An empty layout has no default tool tabs. Restored
labels are metadata; they must not initialize every tool in the background.

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
