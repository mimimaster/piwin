# Spec: Phase 7 — Piwin RPC Worker Parity (Deep Implementation Plan)

| Field | Value |
|---|---|
| Status | Ready for implementation |
| Date | 2026-08-04 |
| Scope | `contracts`, `agent-host` (RPC/worker/backend), `cli` doctor/capabilities honesty, docs/ADR 0011/0012, conformance tests |
| Primary owners | Agent Host dual-mode backend, tool execution authority, session isolation boundary |
| Parent program | [`settings-capability-runtime-refactor.md`](./settings-capability-runtime-refactor.md) §15–§16 Phase 7 |
| Related | ADR 0003 dual-mode host, ADR 0008 skills/MCP wiring, ADR 0011 RPC SDK fallback, ADR 0012 RPC worker isolation, AGENTS.md dual-mode rules |
| Trigger | Phases 1–6 delivered capability compilation, Settings control plane, runtime status, and partial worker scaffolding. Phase 7 must make RPC isolation real without reintroducing a second product path. |
| Binding rules | UI never imports Pi; only `agent-host` may import `@earendil-works/pi-*`; SDK and RPC remain dual modes implementing the same contracts; parent Host remains the single authority for permissions, MCP lifecycle, process, browser, secrets, and Settings. |

---

## 0. Executive summary

### 0.1 What “done” means for Phase 7

Phase 7 is complete only when:

1. `hostMode=rpc` runs product sessions in a **piwin-owned Node worker process**.
2. The worker creates Pi sessions from a **serializable blueprint projection**, not by re-reading Settings/trust ad hoc.
3. All Host custom tool execution (web, MCP gateway/direct tools, process, browser, notes, flashcards, image gen, plan tools, subagent spawn) is **proxied to the parent Host**.
4. Parent remains the only place that evaluates permissions, resolves secrets, starts MCP servers, and owns process/browser services.
5. SDK and RPC pass a **conformance suite** proving same capability snapshot identity, tool names, prepared prompt routing, event terminal outcomes, permission behavior, and subagent ceilings.
6. Only then may the codebase delete:
   - RPC → in-process SDK fallback
   - stock `pi --mode rpc` product path
   - `PIWIN_RPC_STOCK` / temporary worker switches
   - duplicated option forwarding that exists only for the fallback world

### 0.2 Current baseline (already landed)

| Asset | Status | Gap relative to Phase 7 exit |
|---|---|---|
| `SerializableBlueprint` + `projectBlueprintForWorker` | Done (unit-tested) | Not yet the production create-session payload for product RPC |
| Worker JSONL protocol (`session/create|prompt|abort|steer|follow-up|drop`) | Scaffold | Create payload still subagent-shaped; no blueprint; no tool proxy frames |
| `RpcSdkWorkerClient` | Scaffold | Used for subagent isolation experiments; not product `PiRpcAdapter` path |
| `rpc-sdk-worker-entry` | Stub | Returns stub session ids; no real Pi session |
| `PiRpcAdapter` | Product path = SDK fallback | Isolation is claimed only via honesty flag `rpcSdkFallback` |
| Capability compilation (Phases 1–5) | Done | Must become the single input to both SDK and worker backends |
| Desktop Session Runtime UI (Phase 6) | Partial | Must later show true worker isolation vs fallback honestly |

### 0.3 Non-goals for Phase 7

- Reworking Settings IA beyond honesty copy for isolation status.
- Making stock Pi RPC accept custom tools (still forbidden by ADR 0008).
- OS sandboxing of the worker (not claimed; worker is process isolation only).
- Completing Desktop selectable RPC host mode if CLI/host already exercises worker path (Desktop may remain SDK-first; honesty required either way).
- Full Pi-native lossless conversation restore on runtime reload (still product-history reconstruction; Phase 5 honesty remains).

---

## 1. Purpose and product requirements

### 1.1 User-visible purpose

Users and operators must be able to answer:

- Is RPC mode actually isolated?
- If isolation is unavailable, does the product fail closed or fall back with explicit honesty?
- Are tools/permissions identical between SDK and RPC?
- Can I abort/steer/follow-up a long run under RPC the same way as SDK?

### 1.2 Architecture purpose

Phase 1–5 established:

```text
Settings + trust + MCP + resources
        → SessionCapabilitySnapshot
        → Resource/Context/Tool Manifests
```

Phase 7 must complete:

```text
SessionCapabilitySnapshot
        → SessionBlueprint (host-internal)
        → SerializableBlueprint (JSONL)
        → Worker Pi session
        → Tool calls proxy back to parent HostToolExecutionRouter
        → Normalized AgentEvent stream back to parent
```

### 1.3 Product one-liner for this phase

> RPC mode becomes a real isolated backend for the same compiled capability blueprint that SDK mode uses; tool authority stays in the parent Host.

---

## 2. Locked decisions for Phase 7

These decisions are locked for implementers. Do not reopen without an ADR update.

| ID | Decision |
|---|---|
| P7-01 | Product RPC never uses stock `pi --mode rpc` for custom tools. Stock path remains non-product or is deleted after worker ships. |
| P7-02 | Parent Host owns Settings, permissions, MCP lifecycle, process registry, browser session, secrets, media roots, and runtime gates. |
| P7-03 | Worker owns Pi model session, extension loading, and model streaming only. |
| P7-04 | Worker custom tools are **proxy definitions** whose executors call parent over JSONL; worker must not reimplement web/MCP/process/browser. |
| P7-05 | Worker receives only `SerializableBlueprint` (+ minimal runtime options). Worker must not load `~/.piwin/config.json` for capability decisions. |
| P7-06 | Secrets never appear in worker logs; raw API keys cross the boundary only through explicit short-lived secret envelopes if required for model providers, never for MCP/tool authority. Prefer parent-resolved provider registration snapshots with redacted persistence. |
| P7-07 | Event boundary is `AgentEvent` only. Pi-native event shapes never leave the worker. |
| P7-08 | Empty tool/capability allowlists mean **none**, not unrestricted (Phase 3 semantics remain). |
| P7-09 | Fallback may remain behind an explicit temporary env during rollout, but product default for `hostMode=rpc` must become worker once conformance is green. |
| P7-10 | Deletion of fallback/stock is gated on conformance suite green + doctor honesty green + one release window with feature flag if needed. |
| P7-11 | Dual modes remain real: SDK path stays in-process; RPC path is worker; both consume the same blueprint compiler and tool registry. |
| P7-12 | Subagent process isolation may reuse the worker protocol, but product session RPC isolation is the primary Phase 7 goal; do not conflate subagent runner completeness with product hostMode completion. |

---

## 3. Target architecture

### 3.1 Component map

```text
Desktop / CLI
    │ HostCommand / HostPush
    v
HostRuntime
    │ owns SettingsService, SessionCapabilityResolver, ToolRegistry,
    │ Permission, MCP, Process, Browser, secrets, runtime status
    │
    ├─ hostMode=sdk ──► PiSdkSessionBackend (in-process)
    │                       │
    │                       ├─ Pi createAgentSession(blueprint)
    │                       └─ HostToolExecutionRouter (local calls)
    │
    └─ hostMode=rpc ──► PiRpcSessionBackend
                            │
                            ├─ RpcSdkWorkerClient (parent)
                            │     JSONL request/response/event/tool-proxy
                            v
                          rpc-sdk-worker-entry (child Node process)
                            │
                            ├─ projectBlueprint → Pi session
                            ├─ proxy custom tool definitions
                            └─ map Pi events → AgentEvent
```

### 3.2 Authority matrix

| Concern | Parent Host | Worker |
|---|---|---|
| Settings load/apply/revision | Yes | No |
| Project trust | Yes | No (receives trusted-only project scope in blueprint) |
| Resource/context/tool compile | Yes | No (receives exact manifests) |
| Pi model/provider registration | Parent prepares serializable provider runtime | Worker applies registration for model calls |
| Permission decide/ask | Yes | No (tool proxy waits on parent) |
| MCP start/stop/list/call | Yes | No (gateway/direct tools proxy) |
| Process start/list/logs/stop | Yes | No |
| Browser tools | Yes | No |
| Notes/flashcards/image_gen | Yes | No |
| Extension load/execution | Blueprint-selected paths only | Yes (load selected extensions) |
| Prompt preparation (images) | Prefer parent-prepared `PreparedPrompt` | Worker accepts prepared text/images; may not invent path injection |
| Transcript product store | Yes | No (worker may hold Pi-native tree only) |
| Abort/steer/follow-up | Parent command → worker method | Yes |

### 3.3 Process model

Worker process properties:

- One worker process per HostRuntime (not per session) for Phase 7.1.
- Multiple sessions multiplexed by `sessionId` inside one worker.
- Worker crash → all live RPC sessions mark `failed` / `stale`; parent does not silently recreate without user-visible status.
- Worker restart policy: explicit HostRuntime recovery path; not invisible auto-retry loops for permission dialogs.
- Stdio: stdin requests, stdout frames, stderr diagnostics only (no secrets).

Later optional (out of Phase 7.1 scope unless needed):

- Per-session worker (higher isolation cost).
- Shared worker pool across HostRuntime instances (not required).

---

## 4. Protocol design (JSONL)

### 4.1 Frame taxonomy

Existing frames remain:

- `request` parent → worker
- `response` worker → parent
- `event` worker → parent (`AgentEvent`)

Phase 7 **adds**:

```ts
// worker → parent: custom tool invocation needs parent authority
type WorkerToolCallFrame = {
  type: 'tool-call';
  id: string;              // correlation id
  sessionId: string;
  toolName: string;
  args: unknown;
  signalId?: string;       // optional abort correlation
};

// parent → worker: tool result
type WorkerToolResultFrame = {
  type: 'tool-result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

// parent → worker: extension UI / permission is NOT needed if tools proxy fully
// through parent. Prefer tool proxy over re-implementing permission UI in worker.
```

Also add control frames if needed:

```ts
type WorkerHelloFrame = {
  type: 'hello';
  protocolVersion: 1;
  workerPid: number;
  capabilities: {
    toolProxy: true;
    steer: true;
    followUp: true;
    preparedPrompt: true;
  };
};

type WorkerShutdownFrame = {
  type: 'shutdown';
  reason: 'parent-dispose' | 'worker-fatal' | 'protocol-error';
};
```

### 4.2 Request methods (product session)

Upgrade `session/create` payload from subagent-shaped fields to blueprint-shaped:

```ts
type SessionCreatePayload = {
  method: 'session/create';
  productSessionId: string;          // stable product id
  blueprint: SerializableBlueprint;  // exact compiled projection
  preparedProviders?: SerializableProviderRuntime[]; // redacted/env-ref based
  extensionUiProxy?: boolean;
};

type SessionPromptPayload = {
  method: 'session/prompt';
  sessionId: string;
  prepared: {
    text: string;
    images?: Array<{ mimeType: string; dataBase64: string }>;
    thinkingLevel?: string;
    model?: { providerId: string; modelId: string };
  };
};

// abort / steer / follow-up / drop already scaffolded
```

### 4.3 Protocol versioning

- `protocolVersion: 1` for Phase 7.
- Parent refuses workers that advertise incompatible versions.
- Unknown frame types: worker logs and ignores; parent treats unknown worker frames as fatal if they affect session correctness.

### 4.4 Timeouts and backpressure

| Operation | Default timeout | Notes |
|---|---|---|
| worker start/hello | 5s | fail create with actionable error |
| session/create | 30s | includes provider registration + resource load |
| session/prompt ack | 2s | long generation continues via events |
| tool-call roundtrip | 10 min hard cap / inherits AbortSignal | parent may ask user |
| abort | 2s to ack; cleanup best-effort after | must not block control lane |
| worker idle dispose | HostRuntime.dispose | kill SIGTERM then SIGKILL after 3s |

Stdout buffering: line-delimited JSON only; never partial JSON across handlers without a buffer.

---

## 5. SerializableBlueprint completeness requirements

Current `SerializableBlueprint` is necessary but not sufficient for product sessions.

### 5.1 Required fields for product RPC create

```ts
type SerializableBlueprintV1 = {
  protocolVersion: 1;
  snapshotId: string;
  settingsRevision: string;
  workingDirectory: string;
  scope:
    | { kind: 'general' }
    | { kind: 'project'; projectPath: string; trusted: true };
  resourceManifest: ResourceManifest;
  contextManifest: ContextManifest;
  tools: SessionToolPolicy; // exact names + mcp server ids
  subagentCeiling?: {
    allowedCapabilities: SubagentCapability[];
    allowedSkillIds: string[];
    isolation: SubagentIsolationMode;
  };
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  // Explicit path lists the worker may load (no discovery outside these)
  activeSkillPaths: string[];
  activeExtensionPaths: string[];
  activePromptPaths: string[];
  // Provider runtime is separate envelope (see §6)
};
```

### 5.2 Projection rules

1. Project only from `SessionCapabilitySnapshot` + active path lists from ResourceManifest.
2. Never include disabled/shadowed resources.
3. Never include untrusted project scope.
4. Round-trip JSON must preserve exact tool name sets.
5. `snapshotId` must match parent-compiled snapshot id (conformance key).

### 5.3 Migration from current type

- Extend `packages/agent-host/src/rpc/serializable-blueprint.ts`.
- Keep pure unit tests for general/project/subagent/model projections.
- Add golden fixture: snapshot → blueprint → JSON → parse → deep equality.

---

## 6. Provider/model runtime envelope (secrets)

### 6.1 Problem

Worker must call models, but parent owns secrets and provider config.

### 6.2 Decision

Introduce `SerializableProviderRuntime` created by parent for the session:

```ts
type SerializableProviderRuntime = {
  providerId: string;
  protocol: ModelProviderConfig['protocol'];
  baseUrl: string;
  headers?: Record<string, string>;
  models: Array<{
    id: string;
    label?: string;
    input?: Array<'text' | 'image'>;
    reasoning?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
  /**
   * Secret delivery modes (prefer in order):
   * 1) apiKeyEnv name already present in worker env injected by parent
   * 2) one-shot apiKey material only over stdio request frame (never logs)
   * Never persist secrets to worker disk.
   */
  auth:
    | { kind: 'env'; envName: string }
    | { kind: 'inline'; apiKey: string }
    | { kind: 'none' };
};
```

Parent injects only the providers needed for:

- default/session model
- optional vision delegation model (if delegation still runs in parent, omit)

### 6.3 Preferred image routing ownership

Keep **PromptPreparation in parent** (Phase 4). Parent sends `prepared.text` + base64 images. Worker must not:

- invent path inventory text
- force-widen model image capability
- load media outside parent-validated paths

This preserves one image-routing truth across SDK/RPC.

---

## 7. Tool proxy design

### 7.1 Registration in worker

Worker builds Pi custom tools from blueprint tool names:

```text
for toolName in blueprint.tools.customToolNames:
  register ProxyTool(toolName) {
    execute(args, signal) {
      return parent.toolCall(sessionId, toolName, args, signal)
    }
  }
```

Worker must not import tools-web executors, MCP managers, process registry, browser session, notes stores, etc.

### 7.2 Parent HostToolExecutionRouter

Create:

- `packages/agent-host/src/tools/host-tool-execution-router.ts`

Responsibilities:

1. Map `toolName` → already-built Host tool executor from ToolRegistry/session bag.
2. Re-check immediate safety gates (Phase 5 stale/disabled families).
3. Run permission policy for gated tools.
4. Return structured result/error to worker.

### 7.3 Pi built-in tools

`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`:

- Prefer parent-gated replacements already used in SDK adapter (`gated bash/file tools`) registered as custom replacements, not ungated Pi natives.
- Blueprint `piBuiltinToolNames` + custom replacements must match SDK behavior.
- If Pi natives remain, they must still pass through equivalent gates; do not open a second ungated path in worker.

### 7.4 MCP

- Direct MCP tools and `mcp_gateway` execute only in parent.
- Worker never holds MCP child processes.
- Enabled server ids come from blueprint; parent re-validates server still enabled/trusted at call time.

### 7.5 Abort during tool calls

- Parent abort of session aborts in-flight tool proxy waits.
- Worker abort cancels Pi run and best-effort cancels outstanding tool-call ids.

---

## 8. Shared backend interface and adapter refactor

### 8.1 Introduce `PiSessionBackend`

```ts
// packages/agent-host/src/backends/pi-session-backend.ts
export type BackendSessionHandle = {
  id: string;
  prompt(prepared: PreparedPromptInput): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  compact?(...): Promise<...>;
  // optional setters for model/thinking if supported
};

export interface PiSessionBackend {
  createSession(input: {
    productSessionId: string;
    blueprint: SessionBlueprint; // host-internal may include non-serializable refs for SDK
    serializable: SerializableBlueprint;
    providers: SerializableProviderRuntime[];
  }): Promise<BackendSessionHandle>;
  dropSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

### 8.2 Implementations

| Backend | File | Mode |
|---|---|---|
| `InProcessSdkSessionBackend` | `backends/in-process-sdk-session-backend.ts` | sdk |
| `WorkerRpcSessionBackend` | `backends/worker-rpc-session-backend.ts` | rpc |

`PiSdkAdapter` and `PiRpcAdapter` become thin facades over these backends + product shell/index integration. Avoid two divergent createSession mega-functions.

### 8.3 HostRuntime integration points

1. Compile snapshot/blueprint once in HostRuntime (or SessionBlueprintCompiler).
2. Pass compiled artifacts into backend create.
3. On `settings/apply`, mark runtime stale (already done); reload still parent-driven.
4. Doctor/status:
   - sdk: `rpcSdkFallback=false`, isolation=false
   - rpc+worker: `rpcSdkFallback=false`, isolation=true
   - rpc+fallback (temporary): `rpcSdkFallback=true`, isolation=false

---

## 9. Event, control-lane, and lifecycle parity

### 9.1 Events

Worker maps Pi events with the same `createPiSessionEventMapper` / event-map used by SDK path, then emits `AgentEvent`.

Conformance requires same terminal outcomes for:

- completed
- cancelled (user abort)
- error
- superseded-by-new-prompt behavior if product still supports it

### 9.2 Control operations

| Command | Parent behavior | Worker method |
|---|---|---|
| `session/prompt` | prepare prompt, register active run, call backend | `session/prompt` |
| `session/abort` | control-lane immediate | `session/abort` |
| `session/steer` | control-lane | `session/steer` |
| `session/follow_up` | control-lane | `session/follow-up` |
| `session/drop` / dispose | cleanup | `session/drop` |

CLI host-serve lanes: ensure worker-related control commands remain control/serialized correctly (abort stays control).

### 9.3 Crash semantics

| Failure | User-visible result |
|---|---|
| worker fails to start | create session fails; message tells user isolation worker unavailable |
| worker crash mid-run | active sessions → failed; host/log error; no silent SDK fallback unless temporary flag explicitly enables it |
| tool proxy parent dies | worker should fail outstanding tool-calls; process exits |
| protocol parse error | treat as fatal for that worker connection |

---

## 10. Rollout strategy (safe, reversible)

### 10.1 Feature flags

| Flag | Meaning | Default after Phase 7 land |
|---|---|---|
| `PIWIN_RPC_WORKER=1` | force worker path | default on when `hostMode=rpc` after conformance |
| `PIWIN_RPC_SDK_FALLBACK=1` | temporary allow old in-process fallback | off in production once worker default |
| `PIWIN_RPC_STOCK=1` | stock pi path (non-product) | remains non-default; delete later |

Recommended rollout:

1. **R0**: worker behind env, fallback still default.
2. **R1**: worker default for `hostMode=rpc`; fallback only with explicit env.
3. **R2**: delete fallback/stock after soak + conformance CI green.

### 10.2 Compatibility window

Keep fallback for one release window if private users depend on `hostMode=rpc` without worker packaging. Document in CHANGELOG/doctor.

### 10.3 Packaging

Worker entry must be runnable from:

- monorepo `tsx`/`node` dev path
- bundled host packaging (`scripts/bundle-host.mjs`) if CLI/desktop ship host binary

Add packaging checklist item: worker script path resolution must not depend on `import.meta.url` alone without bundle tests.

---

## 11. Work packages (executable)

Each WP is a mergeable vertical slice with tests and a deletion/acceptance gate.

### WP0 — Plan lock and ADR updates

**Deliverables**

- This plan file (authoritative Phase 7 execution plan).
- Update ADR 0011 status note: fallback is transitional, not end-state.
- Update ADR 0012: implementation plan reference; isolation claims only when worker active.
- Update parent spec Phase 7 section to point here.
- Update `docs/dev-plan.md` Phase 7 pointer.

**Exit**

- Docs agree on authority matrix and deletion gates.

### WP1 — Blueprint/protocol completion

**Files**

- `packages/agent-host/src/rpc/serializable-blueprint.ts` (+tests)
- `packages/agent-host/src/rpc-sdk-worker-protocol.ts` (+tests)
- optional contracts export if cross-package needed (prefer host-internal first)

**Tasks**

1. Expand blueprint fields (§5).
2. Add hello/tool-call/tool-result frames (§4).
3. Change `session/create` payload to blueprint-first.
4. Golden JSON fixtures.

**Tests**

- round-trip blueprint
- reject untrusted project scope projection
- empty allowlist remains empty
- protocol parse unknown frames

**Exit**

- Protocol and blueprint ready for a real worker without product wiring yet.

### WP2 — HostToolExecutionRouter extraction

**Files**

- `packages/agent-host/src/tools/host-tool-execution-router.ts`
- refactor SDK adapter to use router for custom tool execution paths where practical
- tests with fake tool registry

**Tasks**

1. Define registry lookup by tool name.
2. Immediate gate integration (disabled family/stale).
3. Permission-aware execution for gated tools.
4. Stable error codes: `tool-not-available`, `tool-disabled`, `permission-denied`, `aborted`.

**Exit**

- Parent can execute any product custom tool by name without going through Pi.

### WP3 — Worker real session create/prompt/event

**Files**

- `rpc-sdk-worker-entry.ts` (rewrite from stubs)
- worker-side Pi session factory module
- event mapping reuse

**Tasks**

1. On create: apply providers, build ResourceLoader from exact paths, create Pi session.
2. On prompt: accept prepared prompt; stream mapped events.
3. On abort/steer/follow-up/drop: wire real session methods.
4. No Settings reload in worker.

**Tests**

- integration with mock Pi or recorded fixtures if full Pi is heavy
- at minimum: worker process hello + create + drop lifecycle test

**Exit**

- Worker can run a text-only session end-to-end in isolation without custom tools.

### WP4 — Tool proxy end-to-end

**Files**

- worker proxy tool factory
- parent client handlers for tool-call frames
- HostRuntime wiring

**Tasks**

1. Register proxy tools for blueprint custom names.
2. Parent routes tool-call → HostToolExecutionRouter.
3. Permission ask path remains parent Desktop/CLI UI.
4. MCP/web/process/browser/notes/flashcards/image_gen covered by matrix tests.

**Tests**

- each family disabled in blueprint never registers
- enabled family executes in parent (spy)
- abort cancels outstanding tool proxy
- permission deny returns structured tool error to model path

**Exit**

- Custom tools work under worker RPC with parent authority.

### WP5 — `PiSessionBackend` dual implementation + adapter switch

**Files**

- `backends/*`
- `rpc-adapter.ts` rewrite
- `create-host.ts` simplification
- host status capabilities

**Tasks**

1. SDK backend wraps current in-process path.
2. RPC backend uses worker client by default (flagged rollout).
3. Remove duplicated option bag forwarding where possible.
4. Doctor/status honesty.

**Exit**

- `hostMode=rpc` product path uses worker under flag/default policy.

### WP6 — Conformance suite

**Files**

- `packages/agent-host/src/backends/conformance/*.test.ts` or `tests/conformance/`
- fixtures for settings/trust/mcp inventories

**Required assertions (from parent spec + this plan)**

Same for SDK backend vs Worker backend:

1. same `snapshotId`
2. same active resource paths
3. same Pi built-in + custom tool names
4. same prepared prompt text mode and image mode (native/delegated/fallback)
5. same normalized event terminal outcome for abort/complete
6. same permission decision context for a gated bash/file case
7. same MCP/web/process disabled behavior
8. same subagent ceiling exact tool set
9. empty capability array ⇒ no tools
10. new global tool does not expand old child ceiling

**Exit**

- CI runs conformance on every agent-host test job.

### WP7 — Deletion pass

> **Status (session 2025-01):** WP0–WP6 implemented and committed on
> `feat/settings-capability-runtime-refactor`. WP7 is **not executed** in
> this session — it is gated on WP6 CI green + rollout decision R2.
> The deletion pass should be a separate PR after the worker backend is
> validated in staging.

Only after WP6 green in CI and rollout decision R2:

Delete / stop shipping:

- `PiRpcAdapter` in-process SDK fallback product path
- stock `pi --mode rpc` product attempt path
- `PIWIN_RPC_STOCK` handling if fully removed
- temporary env switches no longer referenced
- dead code in create-host option duplication
- docs that claim fallback as permanent architecture

Update:

- ADR 0011 → historical transitional
- ADR 0012 → implemented
- architecture.md dual-mode section
- doctor capability matrix

**Exit**

- No code path silently returns to in-process SDK under `hostMode=rpc`.

---

## 12. Detailed implementation sequence (recommended PR order)

1. **Docs/ADR pointer PR** (WP0) — no runtime change.
2. **Blueprint+protocol PR** (WP1).
3. **Tool router PR** (WP2) — can ship behind no behavior change for SDK.
4. **Worker lifecycle PR** (WP3) — env-gated.
5. **Tool proxy PR** (WP4) — env-gated.
6. **Adapter switch PR** (WP5) — default off then on.
7. **Conformance PR** (WP6) — block merge if red.
8. **Deletion PR** (WP7) — last.

Do not combine deletion with first worker enablement.

---

## 13. Testing strategy

### 13.1 Unit

- blueprint projection
- protocol parse/serialize
- tool router gates
- capability empty allowlist

### 13.2 Integration

- spawn real worker process with mock/stub Pi if needed
- parent-child tool-call roundtrip
- abort during tool call
- worker crash surfaces session failure

### 13.3 Conformance

- single test harness constructing identical compiled snapshots for both backends
- prefer deterministic mock model/tool executors over live network

### 13.4 Manual smoke checklist

1. CLI `hostMode=rpc` create session, plain prompt, abort.
2. Web search tool under RPC (parent network).
3. MCP tool call under RPC.
4. Permission prompt for gated bash under RPC.
5. Image native vision path (parent prepared images).
6. Doctor shows isolation true / fallback false.
7. Kill worker mid-run → user-visible failure, no hang.

---

## 14. Observability and error codes

Stable error strings/codes:

| Code | When |
|---|---|
| `rpc-worker-start-failed` | spawn/hello failure |
| `rpc-worker-protocol-error` | malformed frames / version mismatch |
| `rpc-worker-crashed` | unexpected exit |
| `rpc-tool-proxy-failed` | parent router error |
| `rpc-tool-not-available` | tool not in blueprint/router |
| `rpc-session-not-found` | unknown session in worker |
| `rpc-isolation-unavailable` | fallback disabled and worker unavailable |

Host logs:

- worker start/stop with pid
- tool proxy latency optionally sampled
- never log api keys, tool raw secrets, or full env dumps

---

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Worker reimplements Settings/tool policy | dual brains, regressions | blueprint-only worker; lint/review ban on config load in worker entry |
| Secrets leak via stderr | security | secret redaction helpers; tests forbid key patterns in logs |
| Deadlocks on tool proxy + permission modal | hung sessions | timeouts; abort cancels waits; control-lane abort remains free |
| Event double-terminal | UI glitches | single terminal ownership in parent active-run registry |
| Packaging misses worker script | rpc mode fails in release | bundle + smoke test for worker path |
| Fallback left forever | isolation never real | WP7 deletion gate + ADR update required |
| Pi extension UI in worker | missing Desktop bridge | proxy extension UI to parent or disable third-party extensions in worker until bridge exists; document honesty |
| Performance of base64 image over stdio | slow prompts | keep images parent-prepared; consider FD/path handoff later only under media-root validation |

---

## 16. Acceptance criteria (Phase 7 complete)

- [ ] `hostMode=rpc` default product path uses piwin worker process.
- [ ] Worker does not load Settings for capability decisions.
- [ ] Custom tools execute only via parent HostToolExecutionRouter.
- [ ] Permissions/MCP/process/browser authority remain parent-only.
- [ ] Prompt preparation remains single parent path; no native path inventory regression.
- [ ] Conformance suite green for all required assertions.
- [ ] Doctor/capabilities report isolation honestly.
- [ ] Fallback/stock paths deleted or explicitly residual with no product default.
- [ ] ADR 0011/0012/architecture updated.
- [ ] No new UI→Pi imports; contracts-first boundaries preserved.

---

## 17. Mapping to parent program Phase 7 steps

Parent spec Phase 7 steps → this plan:

| Parent step | Work package |
|---|---|
| Define serializable blueprint projection | WP1 (extends existing scaffold) |
| Implement worker session creation + normalized events | WP3 |
| Implement parent-owned tool execution proxy | WP2 + WP4 |
| Implement abort/steer/follow-up | WP3 + WP5 |
| Implement extension UI proxy | WP4/WP5 sub-task (or documented degradation) |
| Conformance suite | WP6 |
| Switch RPC product mode | WP5 rollout |
| Delete fallback/stock/temporary switches | WP7 |

---

## 18. Immediate next actions for the implementing agent

1. Land WP0 doc pointers (this file already is the plan body).
2. Start WP1: expand `SerializableBlueprint` and protocol frames with tests only.
3. Start WP2 in parallel if staffing allows (no product behavior change).
4. Do not delete fallback until WP6 is green.

---

## 19. Definition of ready for coding

Implementers may start WP1 when:

- this plan is merged/available in the worktree
- Phases 1–5 capability compiler APIs remain green
- they will not modify Settings IA except honesty strings

---

## 20. Open items requiring product confirmation only if blocked

These should not block WP1–WP2:

1. Desktop selectable RPC host mode vs CLI-only RPC (architecture currently SDK-first Desktop).
2. Whether third-party extensions are supported on day-one worker or deferred with honesty.
3. One worker per HostRuntime vs per session (this plan chooses per HostRuntime).

If product confirmation is delayed, implementers must follow the defaults in this document.
