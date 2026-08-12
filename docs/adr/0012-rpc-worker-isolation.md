# ADR 0012: RPC process isolation worker (design)

| Field | Value |
|-------|-------|
| Status | Accepted; implemented and guarded by the Runtime Refactor deletion gates |
| Date | 2026-07-21 (design), 2026-08-04 (final target clarified) |
| Related | ADR 0008, ADR 0011, ADR 0030, [`runtime-refactor.md`](../specs/runtime-refactor.md) |

## Context

ADR 0011 made `hostMode: "rpc"` use an in-process **SDK session backend** so
web/MCP/extensions/prompts work. That is not process isolation.

True isolation needs a piwin-owned worker that runs one Pi SDK session in a
child process and speaks a product JSONL protocol to the parent Host.

Stock `pi --mode rpc` remains unsuitable for custom tools (ADR 0008).

## Decision

1. RPC product execution uses this worker boundary; the historical ADR 0011
   in-process fallback and stock RPC escape path are no longer product paths.
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

### Provider secret channel

Provider authentication is compiled by the parent before a backend session is
created:

- `apiKeyEnv` is represented as an environment-variable reference. The raw
  value is not included in the provider envelope.
- `apiKeyRef` is parent-owned keychain state. RPC/worker compilation resolves
  only the selected provider and sends its raw value through a bounded,
  one-shot file-descriptor-3 bootstrap pipe. The JSONL provider envelope
  carries only an opaque `secretId`; the raw value never enters JSONL,
  argv/env, a blueprint, logs, or durable state. The worker validates and
  drops the bootstrap map after provider registration.
- In-process SDK compilation may explicitly opt into inline auth for the
  backend call. That opt-in is not valid for RPC and must never cross worker
  JSONL. The worker protocol uses a distinct auth type that cannot represent
  inline credentials, and both the parent RPC backend and worker request edge
  reject forged/legacy inline envelopes at runtime. Worker bootstrap values
  are bounded to 64 KiB total and 16 KiB per value, and are generation-scoped.

Provider compilation is least-scope: a fixed session/subagent model compiles
only its effective provider. An unrelated enabled provider with a keychain
reference cannot block that session.

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

Implementation update (2026-08-05): `AgentWorkerSupervisor` is the sole
production worker-client owner, the worker artifact is bundled as
`agent-worker.mjs`, and unexpected worker exit terminalizes matching active
Runs through the parent `RunRegistry` with `worker-crash`.
