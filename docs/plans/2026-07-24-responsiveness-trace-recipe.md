# Responsiveness Trace Recipe (macOS)

| Field | Value |
|---|---|
| Date | 2026-07-24 |
| Purpose | Reproduce and measure the "spinning cursor / dead app" failure before and after fixes |
| Related | `docs/plans/2026-07-24-desktop-responsiveness-recovery-execution-plan.md` Slice 0 |

## Prerequisites

- macOS with Instruments installed (Xcode → Open Developer Tool → Instruments)
- piwin desktop dev build: `pnpm dev:tauri`
- A controlled slow provider or the `createDelayedSessionHandle` fixture

## Scenario 1: 30-second no-token turn (Stop unreachable)

1. Configure a provider endpoint that accepts TCP but never responds, or use
   the delayed fixture with `hangUntilAbort: true`.
2. Open a project and send a prompt.
3. **Observe:** macOS spinning cursor appears within ~5 s. Window cannot be
   dragged. Stop button click has no visible effect.
4. **Instruments:** Time Profiler → record during the wait. Look for
   `host_request` / `recv_timeout` on the main thread.
5. **After fix:** Stop should reach the host within 250 ms. Terminal
   `session/aborted` within 1 s. Window remains draggable.

## Scenario 2: High-rate token stream (renderer jank)

1. Use the delayed fixture with `tokenIntervalMs: 0`, `chunkCount: 5000`.
2. Open browser DevTools → Performance tab (or Tauri webview inspector).
3. **Observe:** Long tasks (>50 ms) during streaming. Scroll jank. Composer
   input lag.
4. **After fix:** Visual commits coalesced to ≤1 per animation frame. No long
   tasks from delta processing.

## Scenario 3: 10 MB tool output (memory / backpressure)

1. Use a managed process or fixture that emits 10 MB of stdout in rapid chunks.
2. **Observe:** Browser heap grows unboundedly. Activity panel becomes
   unresponsive. Event delivery lag increases.
3. **After fix:** Retained output bounded. Terminal/log panels show truncation
   indicator. Heap stabilizes.

## Scenario 4: Cold session creation on external volume

1. Place `~/.piwin` on an external USB APFS SSD (or simulate with a slow
   filesystem).
2. Open a project with many extensions/prompts/skills.
3. **Observe:** Multi-second freeze after clicking "Open workspace". No phase
   indicator.
4. **After fix:** Shell renders immediately. Session preparation shows
   progress phases. First prompt accepted before all resources finish loading.

## Measurement checklist

For each scenario, record:

- [ ] Time from user action to first visible feedback
- [ ] Time from Stop click to `session/aborted` event in UI
- [ ] Main-thread long tasks (>50 ms) count during the scenario
- [ ] Browser heap size at start, peak, and 10 s after completion
- [ ] Node host CPU% and filesystem write count (Activity Monitor / `fs_usage`)
- [ ] Whether macOS shows the spinning wait cursor at any point

## Quick reproduction without Instruments

```bash
# Terminal 1: start desktop
pnpm dev:tauri

# Terminal 2: monitor host process CPU/IO
sudo fs_usage -w -f filesys -p $(pgrep -f "host serve")

# Terminal 3: monitor event loop lag (add to host serve temporarily)
# node --inspect-brk ... then Chrome DevTools → Performance
```
