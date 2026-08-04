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

The composition boundary is clarified by the 2026-08-04 Runtime Refactor:

- `@piwin/host-runtime` is the product composition root. It owns Settings
  compilation, product commands/pushes, runtime generations, Run/Job
  orchestration, permissions, Host tools, and prompt preparation.
- `@piwin/agent-host` is the Pi-only backend boundary. It owns the in-process
  SDK backend, isolated worker backend, Pi event/tool adaptation, and worker
  protocol. It does not import application packages.
- SDK and RPC consume the same compiled SessionBlueprint. RPC is complete only
  when it uses the piwin-owned worker described by ADR 0012 and
  [`runtime-refactor.md`](../specs/runtime-refactor.md) Phase 3.

## Consequences

- Normalized `AgentEvent` bus required
- Product operational state uses sibling `HostPush` variants rather than
  expanding `AgentEvent` beyond Pi session execution
- Slightly more scaffolding upfront; avoids later rewrite
- Tests can mock either adapter
