# Desktop WebContent memory measurement

Use this note whenever a memory-diet slice claims a footprint change.
Product conclusions are **release-packaged** Desktop. Dev (Vite HMR +
`tauri dev` debug) is process-control only.

## Identify the right process

WebContent PIDs are XPC services (parent often `1`). **Do not** pick the
fattest `com.apple.WebKit.WebContent` on the machine — that is how a
foreign 180 MB renderer was blamed on the pet overlay (2026-08-17).

```bash
# From the repo root. Fails closed if it cannot prove a pid is ours.
./scripts/desktop-webview-footprint.sh
```

The script classifies a WebContent as piwin only when either `lsof` shows a
piwin path (`Caches/piwin-desktop`, `piwin-desktop.app`, `apps/desktop`,
`pet-overlay`, Vite `:1420`, or `/ui/ink-wash`) or macOS `launchctl` records
the process in the `app.piwinwin.desktop[.shell]` resource coalition. The
coalition path is required for release-packaged shells, whose WebContent may
expose no app/cache path through `lsof`. Everything else is printed as
unclassified and ignored.

When exactly two renderers share that cache and neither maps
`pet-overlay.html` (today's hide-not-destroy pet), the script assigns
**smaller RSS → pet**, larger → main. Three or more piwin candidates
still fail closed.

Manual fallback when the script exits 1:

1. `pgrep -lf piwin-desktop` — confirm our native shell is running.
2. Close the pet in Settings. After S5.3 there should be **one** remaining
   WebContent whose `lsof` mentions piwin or whose `launchctl print pid/<pid>`
   reports the piwin bundle ID. Before S5.3, hide still leaves a second ~25 MB
   pet process (look for `pet-overlay` in `lsof`).
3. `footprint <pid>` and record the three lines below.

## What to record

| Field | `footprint` line |
|---|---|
| Total | `Footprint: N MB` |
| Graphics | `Owned physical footprint (unmapped) (graphics)` |
| WebKit malloc | `WebKit malloc` |
| JS heap (sanity) | `JS VM Gigacage` |

Fixed conditions for comparable samples: **Noir**, desktop layout, pet
**off**, no attachments, no settings/knowledge overlay.

| Sample | When |
|---|---|
| cold-10m | Idle 10 minutes after launch |
| attach-1 | After S3a: paste one ≥4K image, lightbox closed |
| hide-2m | After S4: minimize 2 minutes |
| pet-off | After S5.3: Settings pet off → WebContent count = 1 |

## Baseline captured with this note

| Date | Build | Sample | pid | Footprint | graphics | WebKit malloc | Notes |
|---|---|---|---|---|---|---|---|
| 2026-08-17 16:48 | `tauri dev` debug, ~73 min uptime, after S1 CSS HMR | cold-ish idle | 66316 | 395 MB | 53 MB | 311 MB | Pet 66318 = 25 MB / 160 KB graphics. Unclassified 95404 ignored. **Not a release baseline.** |
| 2026-08-21 16:57 | `tauri dev` shell-only debug, ~54 min uptime, heavy agent streaming + HMR | post-use idle | 85506 | 1416 MB (peak 1933) | 1074 MB | 294 MB | Pinned graphics: survives `org.WebKit.lowMemory`, full-DOM `display:none`, and two document reloads. JS Gigacage 2.6 MB. |
| 2026-08-21 17:09 | same shell, renderer killed (`SIGKILL` WebContent) | fresh renderer | 26426 | 185 MB | 35 MB | 122 MB | WKWebView auto-relaunched + reloaded; shell stayed 46 MB → leak was WebContent-process-internal. Motivates renderer self-heal tier. |
| 2026-08-22 13:28 | installed thin Shell built 2026-08-21 23:13, 3 h uptime | quiet plateau after active use | 66571 | 1048 MB | 696 MB | 289 MB | JS Gigacage 2.2 MB. Installed bundle predates commit `f230d355`, so it has the old 1536 MiB/critical-only relaunch policy rather than the 512 MiB background reclaim policy. |
| 2026-08-22 13:40 | clean-HEAD thin Shell (`3e666c05`), newly installed | fresh renderer after safe Shell restart | 97128 | 126 MB | 29 MB | 71 MB | New bundle contains the 512 MiB background reclaim policy. Old installed bundle retained at `/Applications/piwinwin Shell.app.previous-20260821-231313`; standalone Host stayed running. |

S0 does not invent a release number. Fill the release row when a packaged
build is next launched for a 10-minute idle.

Forensic recipe for pinned graphics (2026-08-21): sample `footprint <pid>`;
`notifyutil -p org.WebKit.lowMemory` flushes WebKit caches/IOSurface pool —
if the graphics category refuses to drop, hide the whole DOM via a temporary
`body > * { display: none !important; }` in `styles/memory-degradation.css`
(HMR applies live) and pressure again. Still-pinned graphics after that plus
a full reload means process-level retention: only a renderer relaunch
(`relaunch_webview_renderer`) recovers it.
