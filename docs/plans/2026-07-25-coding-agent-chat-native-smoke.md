# Coding-Agent Chat Window — Native macOS Smoke Recipe

| Field | Value |
|---|---|
| Date | 2026-07-25 |
| Related plan | `docs/plans/2026-07-25-coding-agent-chat-window-plan.md` (C6) |
| Layers | Browser mock unit tests ≠ live JSONL sidecar ≠ native Tauri |

## Preconditions

1. Workspace install: `pnpm install`
2. Typecheck + unit tests green for contracts, agent-host, desktop, artifact
3. Provider configured (or mock host for non-model steps)
4. Launch Desktop via Tauri developer preview (not browser-only Vite mock for native claims)

## Checklist

| # | Scenario | Expect |
|---|---|---|
| 1 | Cold-start General prompt | Session creates without project; reply streams once; no duplicate bubble text |
| 2 | Rapid double-send / Enter+click | Only one accepted run; second rejected or queued per product rules |
| 3 | Tool run with shell/file tool | Work details shows structured card; host presentation preferred over name heuristics |
| 4 | Permission ask → allow/deny | Strip announces phase once; dialog focus returns; General has no “Allow for project” |
| 5 | Stop mid-stream | Cancelling → cancelled; partial text retained; no late duplicate append |
| 6 | Completed turn then new turn | Prior turn Work details still attributable; top strip only tracks active run |
| 7 | Streaming HTML fence | Source only; no iframe until complete + Preview artifact |
| 8 | Completed valid HTML artifact | Source + Preview toggle; sandbox still applies |
| 9 | Blocked external-resource artifact | Block reason visible; no iframe |
| 10 | General vs Project panels | General hides Files/Git/Terminal project actions |
| 11 | Sidecar restart / reconnect | History resumes; no duplicate listener double text |
| 12 | Long history (100+ messages) | Scroll/follow-tail remains usable; Work details collapsed by default when complete |
| 13 | Screen reader / keyboard | Phase changes announced without per-second elapsed spam; Escape closes overlays |

## Evidence notes

- Record which layer each check used: **browser mock**, **live sidecar**, or **native Tauri**.
- Do not claim release readiness from unit tests alone.
- Capture transport/backend/provider labels from the shell status UI.

## Result log (fill when run)

| Date | Runner | Layer | Pass/Fail | Notes |
|---|---|---|---|---|
| | | | | |
