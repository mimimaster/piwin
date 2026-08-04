# ADR 0011: RPC SDK fallback + prompt templates channel

## Status

Accepted (2026-07-21); **transitional** per Phase 7 plan (2026-08-04).

> **Phase 7 update:** The SDK fallback described in this ADR is a
> **transitional** state, not the end-state. Phase 7 WP3–WP6 implement a
> piwin-owned worker process (`WorkerRpcSessionBackend`) that provides
> real process isolation for `hostMode=rpc`. Once the worker backend is
> rolled out (R1) and conformance is green in CI, the SDK fallback
> product path will be deleted (WP7, gated on R2). The `PIWIN_RPC_STOCK`
> escape hatch and `PIWIN_RPC_SDK_FALLBACK` temporary flag will also be
> removed at that time. See
> [`docs/specs/phase7-rpc-worker-parity-plan.md`](../specs/phase7-rpc-worker-parity-plan.md)
> for the authoritative execution plan.

## Context

Stock `pi --mode rpc` cannot register host `customTools` or inject piwin
ResourceLoader paths (ADR 0008). Product still needs web/MCP/bash gates,
extensions, and prompt templates under a single dual-mode host.

Pi prompt templates are first-class Markdown resources discovered by
`DefaultResourceLoader` via `additionalPromptTemplatePaths`.

## Decision

1. **RPC product path uses SDK session backend** (`PiRpcAdapter` → `PiSdkAdapter`)
   so extensions, prompts, and custom tools work under `hostMode: "rpc"`.
2. Surface honesty flags: `capabilities.rpcSdkFallback`, `extensions`, `prompts`.
3. Escape hatch: `PIWIN_RPC_STOCK=1` forces stock pi RPC (product tools fail).
4. **Prompt templates** live at `~/.piwin/prompts/*.md`, mirrored to Pi via
   ResourceLoader; list/enable via host IPC without executing templates.
5. **Extension install** reuses marketplace local/git install into
   `~/.piwin/extensions` (not a central registry).
6. **Extension `ctx.ui.confirm` → Desktop permission modal** remains residual
   (D-EXT-04): requires Pi ExtensionContext UI adapter in non-TUI hosts.

## Consequences

- RPC mode is no longer a capability dead-end for main product tools.
- True process isolation is still residual (D-HOST-01b worker).
- Users can map Cursor/Claude/Codex skill dirs via `skills.extraPaths` presets.
