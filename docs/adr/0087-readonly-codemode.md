# ADR 0087: Opt-in read-only Codemode

- **Status**: Accepted
- **Date**: 2026-08-14
- **Scope**: `@piwin/contracts`, `@piwin/agent-host`, `@piwin/host-runtime`
- **Consults**: ADR 0019, ADR 0033, ADR 0050, ADR 0053

## Context

Models need to filter large tool results before those results enter the transcript. Copying a JavaScript runtime, `node:vm`, or a newer Pi extension into the Host would bypass the generation port and the pinned Pi 0.84.2 boundary.

## Decision

1. Codemode is off by default. `codemode` is a settings domain. Enabling or changing it invalidates the runtime generation. There is no desktop control in this slice.
2. `@piwin/agent-host` is the only package that depends on `@earendil-works/pi-codemode@1.1.0`. It exposes `runCodemodeScript`. `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` stay at 0.84.2. Host-runtime does not import the sandbox package.
3. `buildSessionHostTools` registers `piwin_codemode` only when the normalized config is enabled and the real session port is available. The same descriptor reaches SDK custom tools and RPC proxy tools.
4. Nested calls use `SessionHostToolExecutionPort.execute` for the admitted generation and Run. The host, not the model, sets `sessionId`, `runtimeGenerationId`, `runId`, `toolCallId`, and `scriptInvocation`. Nested ids are generation-normalized and record the parent call. Permission, disablement, schema validation, and capture still apply. Recursion is denied.
5. A script may call only compiled tools with `permissionSpec.readOnly === true`, an admitted read family and action, and no file effect. A read-only toolbox shell does not authorize a shell, browser, process, or write target. MCP calls from scripts require live `annotations.readOnlyHint === true`. An absent hint is denied only on the script path. Ordinary MCP stays config-trusted and does not gain a permission popup. Search and describe use that same filter. A guessed name outside the host allowlist cannot bypass it.
6. Scripts read `ToolResult.scriptPayload` before chat projection. The field preserves actual MCP `structuredContent` and `isError`. Text is not parsed into invented structure. Projection omits the payload. The model-facing script output is bounded. Tool failures reject inside the script. Ordinary tool results and JSONL stay compatible.
7. Each run has a hard deadline, memory cap, call budget, concurrency cap, and output cap. Cancellation aborts nested Host and MCP calls. A call waiting for a slot does not start after abort. The worker is closed on success and on syntax or runtime failure. Partial nested effects are not rolled back. `store`/`load` receive an empty store and their writes are discarded. This slice has no classifier or image tools.
8. The host bundle externalizes `@earendil-works/pi-codemode@1.1.0` so the package worker and `quickjs-wasi` WASM remain real files after prune. The bundle smoke executes the sandbox against those files.

## Consequences

- Direct tools and `piwin_toolbox` are unchanged while Codemode is off.
- Subagent ceilings, trust, and live disablement still apply because nested calls use the frozen generation surface.
- A script can observe a nested read that already completed if a later call is cancelled. That is not rolled back.
- `store`/`load` must not be described as branch or resume state.

## Enable

```json
{
  "codemode": {
    "enabled": true,
    "timeoutMs": 30000,
    "memoryLimitBytes": 67108864,
    "maxCalls": 32,
    "maxConcurrency": 4,
    "maxOutputChars": 16000,
    "maxTools": 32
  }
}
```

Omitted config normalizes to `enabled: false` and the safe defaults. Out-of-range numbers do not widen the hard maximums.
