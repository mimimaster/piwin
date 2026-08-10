# WebContent memory budget — attack plan

| Field | Value |
|-------|-------|
| Date | 2026-08-10 |
| Status | In progress |
| Surface | Desktop WebView (`piwin-desktop Web Content`) |

## Problem

Activity Monitor reports ~1GB+ for Web Content during normal use. Unmounting
React (session switch, viewport TTL) does **not** promptly shrink the process
footprint — WebKit retains heaps, decoded images, and GPU layers.

## What already shipped

1. **Viewport + 5s TTL recycle** for Inline Artifact iframes (geometry re-check,
   loading shell, no blank park).
2. **Hard live cap** `MAX_LIVE_ARTIFACT_IFRAMES = 2` via `live-host-registry`
   (evict lowest priority when claiming a new slot). Stream/Canvas are
   `forceKeep`.
3. **Show code side rail** + no full-bleed clip (layout correctness, not RAM).
4. Transcript cache already bounds messages (`retainBoundedTranscriptWindow`).

## Ranked next levers (impact × effort)

| # | Lever | Expected impact | Effort | Notes |
|---|--------|-----------------|--------|-------|
| 1 | Measure **release** empty-session baseline vs `tauri dev` | Truth | S | Dev HMR inflates; do not tune against dev alone |
| 2 | Keep live iframe cap = 2 (done); optional setting 1–3 | High peak | S | Default 2 is aggressive |
| 3 | Strip / reduce `backdrop-filter` on large surfaces | Medium sticky GPU | S | Transcript fades done; composer/sidebar next |
| 4 | Compress ink-wash assets; avoid unused PNG variants in public | Disk + decode | M | Prefer one optimized JPEG/WebP per slot |
| 5 | Session switch: explicit `releaseArtifactLiveHost` all + drop media blob caches | Medium | M | Registry clears on unmount; add media URL revoke audit |
| 6 | Code-first Artifact default for long sessions | High peak | S | Product preference already exists |
| 7 | Virtualization: ensure recycled turns fully unmount Markdown/Artifact | High | M | Audit overscan + sticky open previews |
| 8 | Host cold-storage offload (disk, not WebContent) | Disk | L | Separate plan already drafted |

## Non-goals

- Expect Activity Monitor to drop immediately after GC.
- Multi-WebView process isolation (Tauri architecture change).
- Killing Artifact feature.

## Acceptance checks

- Empty release session cold start: document RSS/footprint.
- Session with ≥5 Artifacts scrolled: live iframe count ≤ 2 (DOM).
- Session switch: 0 `.artifact-iframe` nodes for previous session.
- User-visible: parked viewport never pure blank (loading shell).
