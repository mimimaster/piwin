# WebContent memory budget — review & plan

| Field | Value |
|-------|-------|
| Date | 2026-08-10 |
| Status | Reviewed + tightened |
| Surface | Desktop WebView (`piwin-desktop Web Content`) |

## 0. Review verdict (what was wrong / right)

### User idea check

| Idea | Verdict |
|------|---------|
| Drop 5s viewport TTL | **Right.** Footprint barely moved; false recycle + blank park hurt UX. |
| Session switch unmounts UI | **Right and already the main win.** Inactive sessions do not keep iframes. |
| “Only 3 sessions in memory” | **Half-right.** Need a precise budget (below). Not “load 3 full UIs.” |
| “Like Codex” | **Directionally OK** for warm text cache; **not** for multi-WebView processes. |

### What actually costs RAM

| Layer | Cost | On session switch |
|-------|------|-------------------|
| Sandboxed Artifact iframes | **High** | Unmount with transcript ✅ |
| Decoded images / GPU blur | Medium–high | Sticky; GC slow |
| Message JSON (transcript rows) | **Low–medium** | Cheap to warm |
| `tauri dev` / HMR | High baseline | Not production |

**Honest:** Activity Monitor 1GB will not drop just because we warm-cache cleverly. Warm cache is for **switch latency**, not for “fixing” WebKit footprint.

### Resident transcript budget (locked)

```text
1 × active session messages  (foreground UI + optional iframes)
+
MAX_WARM_INACTIVE_SESSIONS (2) × message JSON only
=
at most 3 sessions of transcript *rows* in the Desktop reducer
```

- Warm hit → paint that session immediately, **remove** from warm (promote to active).
- Cold miss → paint **empty**, Host `resume` + `load-messages` (never paint session A under id B).
- Leave active → `putWarm` (clone rows); oldest inactive evicted when cap exceeded.

### Dropped / avoided

| Approach | Why not |
|----------|---------|
| 5s viewport TTL recycle | Low footprint gain; UX bugs |
| keepPreviousTranscript (paint old session while loading new) | Wrong content under new id; warm hit covers recent switches |
| Holding warm *and* active copy of same session | Double rows; promote-on-hit fixes |

## 1. What already shipped

1. **No viewport TTL** — mount under live budget only.
2. **`MAX_LIVE_ARTIFACT_IFRAMES = 2`** — hard cap concurrent srcdocs (stream/canvas forceKeep).
3. **Warm inactive LRU (2)** + active = **3 session transcripts** of message data.
4. **Clone on stash** — warm snapshots cannot be mutated by later active edits.
5. **Cold paint empty** — no cross-session transcript flash.
6. Transcript fade without `backdrop-filter`.
7. Per-transcript byte bound (`retainBoundedTranscriptWindow`).

## 2. Next levers (ranked)

| # | Lever | Impact | Notes |
|---|--------|--------|-------|
| 1 | Measure **release** empty vs loaded vs multi-artifact | Truth | Stop tuning against dev-only |
| 2 | Live iframe cap 2–3 (product setting optional) | Peak | 2 is aggressive if two Artifacts on screen |
| 3 | Reduce remaining large `backdrop-filter` (composer/sidebar) | Sticky GPU | |
| 4 | Compress ink-wash assets; drop unused public PNG duplicates | Decode | |
| 5 | Code-first Artifact default for heavy sessions | Peak | Preference exists |
| 6 | Host cold storage offload | Disk | Separate plan |

## 3. Acceptance

- [ ] Active + warm inactive ≤ 3 message-bearing sessions in reducer.
- [ ] Cold switch: `messages.length === 0` until load-messages; warm has previous.
- [ ] Warm switch-back: previous rows paint before load-messages; not in warm set while active.
- [ ] Session switch: no `.artifact-iframe` for previous session.
- [ ] ≥3 Artifacts in one session: ≤ 2 live iframes (or forceKeep stream).
- [ ] Do **not** expect Activity Monitor to fall to “native app” levels after GC.

## 4. Non-goals

- Expect WebKit process RSS to shrink promptly after unmount.
- Multi-process WebView isolation.
- Removing Artifact sandbox feature.
