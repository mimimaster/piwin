# M1 Spec — Host Reality + CLI Smoke

| Field | Value |
|-------|-------|
| Status | In progress |
| Milestone | M1 |
| Depends on | M0 complete |
| Packages | contracts, agent-host, apps/cli |

## Goal

Dual-mode Agent Host is real enough for CLI:

1. Stream normalized `AgentEvent`s (text/tool/error)
2. SDK + RPC adapters share contracts
3. Config under `~/.piwin` with dual protocol providers
4. Permission policy (allow/ask/deny) for dangerous bash

## CLI deliverables

```bash
piwin doctor
piwin host-mode
piwin config init|show
piwin session list [--project <path>]
piwin chat "hello" [--project <path>] [--mode sdk|rpc] [--mock]
```

`--mock` demos event pipeline without network/Pi keys.

## Architecture

```text
apps/cli → @piwin/agent-host → (PiSdkAdapter | PiRpcAdapter | Mock)
                ↓
         event-map, permission-policy, config-store, paths
                ↓
         @piwin/contracts
```

Only agent-host may import `@earendil-works/pi-*`.

## Tasks

### M1.1 Event map
- `mapPiSessionEvent(raw) → AgentEvent[]`
- Fixtures: text_delta, tool start/end, error
- Unknown events ignored (no throw)

### M1.2 Permission policy
- `evaluateBashPermission(command)`
- Patterns: rm -rf, sudo, curl|sh, force-push, .env writes
- Non-interactive CLI: ask → deny (safe default); interactive UI is M2

### M1.3 Config ~/.piwin
- paths + load/save PiwinConfig
- `config init` / `config show`

### M1.4 PiSdkAdapter
- Optional real Pi via dynamic import
- MockSessionHandle for --mock
- createSession / prompt / subscribe / abort

### M1.5 PiRpcAdapter (thin)
- Spawn pi --mode rpc structure
- JSONL prompt/abort; gap list OK if partial

### M1.6 CLI
- doctor, config, chat, session list, host-mode

## Acceptance

1. pnpm typecheck && pnpm test green
2. piwin chat --mock "hi" streams text
3. doctor mentions ~/.piwin + dual modes
4. event-map + permission tests present
5. no app imports @earendil-works/*

## Gaps OK in M1
- Full RPC parity, interactive permission TTY, session tree UI, media, skills
