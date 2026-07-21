# ADR 0003: Dual-mode Agent Host (SDK + RPC)

## Status

Accepted (2026-07-19)

## Context

Pi supports in-process SDK and `pi --mode rpc` JSONL. Need isolation options without rewriting UI.

## Decision

From day one, `packages/agent-host` exposes:

- `PiSdkAdapter`
- `PiRpcAdapter`

both implementing the same `AgentHost` / `SessionHandle` contracts.

Default: SDK. RPC for `piwin rpc`, isolation preference, external clients.

Implementations may be thin stubs early; **interfaces and wiring must exist**.

## Consequences

- Normalized `AgentEvent` bus required
- Slightly more scaffolding upfront; avoids later rewrite
- Tests can mock either adapter
