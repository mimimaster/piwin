# ADR 0012: RPC process isolation worker (design)

| Field | Value |
|-------|-------|
| Status | Accepted design; implementation residual |
| Date | 2026-07-21 |
| Related | ADR 0008, ADR 0011, D-HOST-01b |

## Context

ADR 0011 made `hostMode: "rpc"` use an in-process **SDK session backend** so
web/MCP/extensions/prompts work. That is not process isolation.

True isolation needs a piwin-owned worker that runs the SDK adapter in a child
process and speaks a product JSONL protocol to HostRuntime.

Stock `pi --mode rpc` remains unsuitable for custom tools (ADR 0008).

## Decision

1. **Do not claim isolation** for ADR 0011 fallback. Surface
   `capabilities.rpcSdkFallback` and `extensionUiBridge` honestly.
2. **Future worker** (`D-HOST-01b`):
   - HostRuntime spawns `node …/rpc-sdk-worker` (or package bin).
   - Worker owns `PiSdkAdapter` + MCP lifecycle + extension UI bridge over IPC.
   - Parent HostRuntime proxies `SessionHandle` and forwards `extension/ui_*` /
     `permission/*` events to Desktop.
3. Escape hatches stay:
   - default: SDK fallback (product complete)
   - `PIWIN_RPC_STOCK=1`: stock pi RPC (tools fail)
   - future: `PIWIN_RPC_WORKER=1`: isolated worker

## Non-goals for this ADR

- Implementing the worker in the same change as D-EXT-04
- Supporting stock Pi RPC custom tool registration

## Consequences

- D-HOST-01b remains residual until worker lands.
- D-EXT-04 (extension UI bridge) works with SDK path and SDK-fallback RPC path
  in the host process today.
