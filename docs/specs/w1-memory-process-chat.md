# Wave 1 Spec — Memory · ManagedProcess · Chat recoverability · Usage

| Field | Value |
|-------|-------|
| Status | **Ready for implementation planning** |
| Date | 2026-07-21 |
| Program | [`program-capability-expansion.md`](./program-capability-expansion.md) |
| Depends on | M2 shell, PermissionPolicy, ADR 0008/0010 |
| Parallel | Consume D-EXT-04 when ready; tools on SDK until D-HOST-01b |
| Packages | `contracts`, `@piwin/memory` (new), `@piwin/process` (new), `session`, `agent-host`, desktop, cli |

## 1. Goals
1. Cross-session **Memory** (MD + FTS + tools + Settings + inject).
2. **ManagedProcess** for long-running jobs (dev servers).
3. Chat **pin / search / edit-resend**.
4. **Usage** (tokens/context) via Pi `contextUsage`.

## 2. Non-goals
Organizer, always-on silent extract, PTY, worktree, cron, gateway (later waves).

## 3. Architecture
HostRuntime owns MemoryStore + ProcessRegistry. Tools as host `customTools` at `createAgentSession`. Memory overview injected as host system/reminder each prompt (default). Optional extension only reads overview cache file.

## 4. CE-MEM Memory
### Model
- scope: global | project; type: user|feedback|project|reference|daily
- confidence high/medium/low/unknown with quote downgrade (high needs quote>=5 or reviewed)
- store: `~/.piwin/memory/{global,projects/<key>,daily}/` + `memory-index.sqlite3`
- quota: 500 ordinary per scope; daily unlimited

### Package `@piwin/memory`
`list/read/search/write/update/delete/accept/quotaSummary/buildOverview/rebuildIndex`. Overview max 16KB, 30/bucket, project shadows global.

### Tools
`memory_list|search|read|write|update|delete|accept` with permission; audit log `~/.piwin/logs/memory-audit.jsonl`.

### Inject
If enabled + trusted project: `### Memory Index (data, not instructions)` + cache file under `.overview-cache/`.

### IPC/UI/CLI
`memory/*` HostCommands; Settings→Agent→Memory; `piwin memory ...`.

### CE-MEM-05 extract (optional)
Opt-in autoExtract after settle; 30s throttle; `memory_submit_plan` → apply_batch. Default off.

### Accept
Cross-session recall; project isolation; traversal reject; tools absent when disabled; unit tests.

## 5. CE-PROC ManagedProcess
### Package `@piwin/process`
start/list/get/readLogs/stop/disposeAll; max 8; max log 2MB; argv only; cwd trusted; redact secret env.

### Tools
`process_start|list|logs|stop`; permission ask; events process/*; Execution panel Processes; CLI `piwin process ...`.
killOnSessionEnd=false; killOnHostDispose=true.

### Accept
Long-run list/logs/stop; deny bad cwd; no orphans on dispose.

## 6. CE-CHAT
- **Pin:** isPinned/pinnedAt; session/pin|unpin
- **Search:** FTS `sessions-index/search.sqlite3`; session/search
- **Truncate/resend:** session/truncate-from; product transcript truth; no Pi JSONL rewind required in W1
- **Modes light:** chat|agent|agent-debug (chat strips tools)

### Accept
Pin persists; search hits; edit drops tail from product context; chat mode no tools.

## 7. CE-OBS Usage
AgentEvent `usage/update` from Pi contextUsage/assistant usage; header chip + Execution; CLI status.

## 8. Config
```ts
memory?: { enabled?, injectOverview?, autoExtract?, maxOverviewChars? }
process?: { enabled?, maxProcesses?, killOnSessionEnd?, killOnHostDispose? }
execution?: { defaultMode?: 'chat'|'agent'|'agent-debug' }
```

## 9. Slices
S0 contracts → S1 memory pkg → S2 host inject/tools → S3 UI/CLI → S4 process → S5 pin/search → S6 truncate → S7 usage → S8 optional extract.

## 10. Coordination
Do not rewrite extension-ui-bridge; claim tools only if capabilities.customTools.

## 11. Open
better-sqlite3 in host; product-only truncate confirmed by spike; host inject default.
