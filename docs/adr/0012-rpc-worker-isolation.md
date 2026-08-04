# ADR 0012: RPC process isolation worker (design)

| Field | Value |
|-------|-------|
| Status | Accepted design; implementation governed by Runtime Refactor Phase 3 |
| Date | 2026-07-21 (design), 2026-08-04 (final target clarified) |
| Related | ADR 0008, ADR 0011, ADR 0030, [`runtime-refactor.md`](../specs/runtime-refactor.md) |

## Context

ADR 0011 made `hostMode: "rpc"` use an in-process **SDK session backend** so
web/MCP/extensions/prompts work. That is not process isolation.

True isolation needs a piwin-owned worker that runs one Pi SDK session in a
child process and speaks a product JSONL protocol to the parent Host.

Stock `pi --mode rpc` remains unsuitable for custom tools (ADR 0008).

## Decision

1. **Do not claim isolation** for ADR 0011 fallback. It remains a transitional,
   explicitly non-isolated state until Runtime Refactor Phase 3 exits.
2. One worker process owns exactly one
   `(productSessionId, runtimeGenerationId)` and one Pi SDK session.
3. Worker lifetime equals runtime-generation lifetime. Workers are not reused
   across sessions or generations, and Phase 3 adds no automatic idle eviction.
4. `@piwin/agent-host` owns worker spawn, framing, shutdown, and Pi event
   normalization. Internal workers are not user-visible Jobs, and
   `agent-host` must not import `@piwin/process`.
5. Parent `@piwin/host-runtime` owns Settings compilation, permissions, Host
   custom tools, MCP, Jobs, browser, media, Git, secrets, and product Run state.
   Worker tool calls proxy back to that parent authority.
6. SDK and worker backends consume the same SessionBlueprint and exact
   ToolManifest descriptors and pass one parameterized conformance suite.
7. On Phase 3 exit, SDK fallback, stock Pi RPC, and temporary backend-selection
   environment switches are deleted.

## Non-goals for this ADR

- Sharing one worker across multiple live runtime generations
- Supporting stock Pi RPC custom tool registration
- Treating process isolation as an OS sandbox
- Automatic turn replay after worker crash

## Consequences

- Worker scaffolding or an opt-in flag does not satisfy this ADR by itself.
  Completion requires the Phase 3 conformance and deletion gates.
- One worker crash affects one runtime generation; parent RunRegistry creates
  terminal product state with the real active `runId`.
- Extension UI, prompt cancellation, native images, and Host tool cancellation
  are parity requirements rather than accepted permanent degradations.
