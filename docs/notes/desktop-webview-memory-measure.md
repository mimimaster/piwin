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

The script classifies a WebContent as piwin only when `lsof` shows a
piwin path (`Caches/piwin-desktop`, `piwin-desktop.app`, `apps/desktop`,
`pet-overlay`, Vite `:1420`, or `/ui/ink-wash`). Everything else is
printed as unclassified and ignored.

When exactly two renderers share that cache and neither maps
`pet-overlay.html` (today's hide-not-destroy pet), the script assigns
**smaller RSS → pet**, larger → main. Three or more piwin candidates
still fail closed.

Manual fallback when the script exits 1:

1. `pgrep -lf piwin-desktop` — confirm our native shell is running.
2. Close the pet in Settings. After S5.3 there should be **one** remaining
   WebContent whose `lsof` mentions piwin. Before S5.3, hide still leaves a
   second ~25 MB pet process (look for `pet-overlay` in `lsof`).
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

S0 does not invent a release number. Fill the release row when a packaged
build is next launched for a 10-minute idle.
