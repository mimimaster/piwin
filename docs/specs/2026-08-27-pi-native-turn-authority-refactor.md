# Spec: Pi native turn authority and model-call pipeline cleanup

| Field | Value |
|---|---|
| Status | Shipped in-tree — live CPA/Grok smoke pending |
| Date | 2026-08-27 |
| Scope | `contracts`, `agent-host`, `host-runtime`, `session`, `host-client`, Desktop, CLI, ADRs |
| Trigger | Grok 4.6 thinking-only stops, unterminated CPA streams, duplicate Host completion policy, misleading Desktop errors |
| Related | ADR 0004, ADR 0015, ADR 0038, ADR 0040, ADR 0059, [`runtime-refactor.md`](./runtime-refactor.md) |
| Execution | [`2026-08-27-pi-native-turn-authority-execution.md`](../plans/2026-08-27-pi-native-turn-authority-execution.md) |

## 0. Executive decision

Pi owns the Agent Loop. `@piwin/agent-host` is the only boundary that may
translate Pi's final turn result. `RunRegistry` owns the product Run lifecycle.
No layer between them may infer completion from transcript contents, first-token
telemetry, UI state, elapsed time, or error-message substrings.

The target has two authorities, not one blended state machine:

```text
Pi Agent Loop
  owns: model turns, tool continuation, native retry, final stopReason
        |
        v
@piwin/agent-host
  owns: exact Pi -> AgentPromptOutcome / AgentEvent translation
        |
        v
Host RunRegistry
  owns: product Run admission, cancellation, terminal status, durable projection
```

Desktop and CLI are projections. They never decide that a Run completed,
failed, or was cancelled.

This spec supersedes these existing policies when implemented:

- ADR 0015's Host-owned model stream-idle watchdog;
- ADR 0059's unconditional Pi retry suppression;
- any Host transcript/first-token delivery gate;
- any Desktop error classification that changes lifecycle state.

## 1. Confirmed problems

### 1.1 The current completion contract erases Pi's result

`SessionHandle.prompt()` and `BackendSessionHandle.prompt()` return
`Promise<void>`. Pi normally resolves its prompt even when the final assistant
message has `stopReason: "error"`, because the error is represented inside the
native event stream. The Host therefore reconstructs failure through an
`AgentEvent` side channel and `RunRegistry.lastAgentErrorMessage`.

That is a second completion protocol. It is also why a clean thinking-only
`stop` and a failed empty assistant can be confused by outer gates.

### 1.2 Retry ownership is claimed but not implemented

The current Pi settings proxy overrides `getRetryEnabled()`,
`getRetrySettings()`, and `getProviderRetrySettings()` to disable all native
retry. ADR 0059 says retry belongs to the Host, but no Host retry authority
exists. The effective policy is therefore "no retry anywhere".

This suppresses Pi's native recovery for retryable missing-finish and transport
errors while retaining substantial retry-deduplication code.

### 1.3 Run identity is guessed after the Pi boundary

The worker path carries an active Run context, but the in-process SDK path does
not consistently stamp `runId` on normalized `AgentEvent` objects. Host then
uses AsyncLocalStorage, message/tool ownership caches, and finally the current
foreground Run to infer identity.

During replace-run, the new Run is admitted before the old provider operation
has fully settled. A late identity-less error from the old operation can be
misattributed to the new Run.

### 1.4 One provider failure is projected several times

The current path may represent the same failure as:

1. a Pi assistant message with `stopReason: "error"`;
2. a normalized `AgentEvent.error`;
3. `RunRegistry.lastAgentErrorMessage`;
4. a thrown Host error;
5. an independently interpreted Desktop error event;
6. a later `run/terminal` failure.

Deduplication cannot make several authorities safe. The pipeline needs one
outcome object and one Run terminal transition.

### 1.5 Error meaning is transported as prose

Desktop classifies authentication, quota, context, stream, and network errors
by substring. Host and Desktop separately recognize controlled aborts through
nearly identical string lists. Specific timeout codes are later collapsed to a
generic `timeout` terminal code.

This makes UI copy part of the protocol and explains why a model stream stall
was labelled as a network failure.

### 1.6 There is real dead and oversized code

- `agent-host/event-map.ts` generates event envelopes that consumers discard;
  Host generates the actual transport envelope again.
- model-connect/first-token/turn timeout codes remain after their producers are
  removed or are collapsed before publication.
- `host-runtime.ts` is over 7,800 lines.
- `event-map.ts` is approximately 985 lines and combines message, tool, error,
  usage, native-context, retry, and envelope responsibilities.

The refactor is incomplete until replaced code is deleted and every source file
is below the repository's 1,000-line hard cap.

## 2. Goals

1. Preserve Pi's native final turn meaning exactly once.
2. Make `RunRegistry` the only product Run lifecycle authority.
3. Carry `runId` explicitly across SDK and worker boundaries.
4. Restore the user's Pi retry settings without a Piwin-wide override.
5. Detect CPA-style parsed-stream stalls only where native transport cannot.
6. Carry structured failures to Host, transcript, Desktop, CLI, and diagnostics.
7. Delete transcript delivery gates, redundant event envelopes, string-based
   lifecycle policy, stale timeout producers, and error side channels.
8. Keep SDK/RPC behavior identical through conformance tests.
9. Split the oversized call-path modules by responsibility.

## 3. Non-goals

1. Changing Pi Agent Loop semantics.
2. Treating thinking content as assistant text.
3. Automatically continuing after a clean thinking-only `stop`.
4. Forking Pi or copying Pi Agent Loop into piwin.
5. Making CPA's request ledger the product Run authority.
6. Adding a Host retry loop, delivery-quality gate, or transcript validator.
7. Reclassifying old successful transcript rows retroactively.
8. Solving every provider-specific streaming quirk with a universal watchdog.
9. Mixing unrelated Artifact, Health, Mobile, session-tree, or UI redesign work
   into this program.

## 4. Terminology

| Term | Meaning |
|---|---|
| Pi turn | One native assistant call plus any tool result processing before the next native assistant call |
| Pi Agent run | The complete native loop started by one Pi `prompt()` call, including tools and native retries |
| Product Run | Host-owned execution lifecycle identified by `runId` |
| AgentPromptOutcome | Final result returned by `agent-host` after the Pi prompt and all native retry/tool activity settle |
| AgentFailure | Structured normalized failure; prose is display detail, not classification authority |
| parsed-stream stall | HTTP/SSE connection remains open but Pi receives no assistant message progress |
| clean thinking-only stop | final `stopReason: stop`, thinking present, no text, no tools |

## 5. Locked decisions

| ID | Decision |
|---|---|
| PTA-01 | Pi Agent Loop is the only authority for tool continuation and native final `stopReason`. |
| PTA-02 | `agent-host` translates one settled Pi prompt into one `AgentPromptOutcome`. |
| PTA-03 | `RunRegistry` is the only authority that terminalizes a product Run. |
| PTA-04 | `AgentEvent.error` is execution evidence and display data; it never terminalizes a Run by itself. |
| PTA-05 | Every foreground Agent event that can affect a Run carries an explicit `runId` before leaving `agent-host`. |
| PTA-06 | Host never attaches an identity-less provider error to the current foreground Run by guess. |
| PTA-07 | Pi native retry settings are honored. Piwin does not globally force retry budgets to zero. |
| PTA-08 | All Pi retry attempts remain inside the same product Run and are visibly projected as retry activity. |
| PTA-09 | A clean thinking-only `stop` is a successful empty assistant turn. Presentation may explain it but cannot rewrite the Run outcome. |
| PTA-10 | Missing required `finish_reason` remains Pi's native protocol/transport error. |
| PTA-11 | No Host first-token, empty-delivery, transcript, or output-quality completion gate exists. |
| PTA-12 | No Host model-stream watchdog exists. A necessary parsed-stream guard lives only in `agent-host`. |
| PTA-13 | The parsed-stream guard is enabled only for the OpenAI-completions streaming path that can receive SSE keep-alive comments. |
| PTA-14 | A parsed-stream timeout waits for Pi abort/idle settlement before the backend prompt returns. |
| PTA-15 | Expected model outcomes return structured values. Exceptions are reserved for broken runtime/invariant paths. |
| PTA-16 | Desktop and CLI classify current failures from `AgentFailure`, never from message substrings. |
| PTA-17 | The Host transport boundary is the only producer of `AgentEventEnvelope`. |
| PTA-18 | SDK and RPC-worker backends pass the same outcome, run identity, retry, timeout, and abort conformance suite. |

## 6. Target contracts

### 6.1 Structured failure

Add a leaf contract such as `packages/contracts/src/agent-failure.ts`:

```ts
export type AgentFailureOrigin =
  | 'provider'
  | 'transport'
  | 'protocol'
  | 'runtime';

export type AgentFailureCode =
  | 'provider-authentication'
  | 'provider-quota'
  | 'provider-rate-limit'
  | 'provider-http-error'
  | 'provider-unavailable'
  | 'model-request-timeout'
  | 'model-stream-missing-finish'
  | 'model-stream-stalled'
  | 'context-limit-exceeded'
  | 'backend-worker-crash'
  | 'backend-protocol-error'
  | 'unknown-agent-failure';

export type AgentFailure = {
  code: AgentFailureCode;
  origin: AgentFailureOrigin;
  message: string;
  retriable: boolean;
  httpStatus?: number;
  nativeName?: string;
};
```

`message` remains bounded human-readable detail. `code`, `origin`, and
`retriable` are adapter decisions. API keys, request headers, and raw response
bodies are never included.

### 6.2 Prompt outcome

Add a leaf contract such as `packages/contracts/src/agent-prompt-outcome.ts`:

```ts
export type AgentPromptOutcome =
  | {
      status: 'completed';
      stopReason: 'stop' | 'length' | 'toolUse' | 'handled';
    }
  | {
      status: 'failed';
      stopReason: 'error';
      failure: AgentFailure;
    }
  | {
      status: 'aborted';
      stopReason: 'aborted';
      message?: string;
    };
```

`toolUse` is only a final outcome when Pi itself ends the native loop after a
terminating tool path. Ordinary tool calls remain internal and do not return
from `prompt()`.

`handled` covers a Pi extension command that consumes input without starting a
model turn. It is not invented for an empty model response.

Change both internal seams:

```ts
interface SessionHandle {
  prompt(input: PromptInput): Promise<AgentPromptOutcome>;
}

type BackendSessionHandle = {
  prompt(prepared: BackendPreparedPrompt): Promise<AgentPromptOutcome>;
};
```

The public `session/prompt` HostCommand remains asynchronous and still returns
`runId` immediately. `AgentPromptOutcome` is an internal Host/backend contract,
not a client request/response wait.

### 6.3 Structured error event

Migrate the existing error event additively:

```ts
type AgentErrorEvent = {
  type: 'error';
  failure: AgentFailure;
  message: string;       // compatibility/display mirror of failure.message
  retriable: boolean;    // compatibility mirror of failure.retriable
  runId: string;
};
```

During one compatibility release, `failure` may be optional on decoded legacy
frames. New `agent-host` producers always provide it. Legacy frames map to
`unknown-agent-failure`; clients do not guess a more specific category from
prose.

### 6.4 Run terminal projection

`ExecutionRunRecord` gains optional structured Agent terminal data:

```ts
type ExecutionRunRecord = {
  // existing fields
  agentStopReason?: AgentPromptOutcome['stopReason'];
  failure?: AgentFailure;
};
```

`terminalCode` continues to describe product lifecycle causes such as
`cancelled`, `superseded-by-new-prompt`, `worker-crash`, or
`runtime-memory-pressure`. It must not erase a more precise timeout code. Agent
failure meaning comes from `failure`.

## 7. Authority matrix

| Decision | Authority | Projections that must not decide |
|---|---|---|
| Execute another tool / model turn | Pi Agent Loop | Host, transcript, Desktop |
| Retry a model attempt | Pi native retry | Host, Desktop Retry button |
| Final native stopReason | Pi Agent Loop | Host delivery gates |
| Normalize Pi result/failure | `agent-host` | Host string parser, Desktop substring parser |
| Attach event to Run | `agent-host` using active `runId` | Host current-Run fallback |
| Product Run admission/cancel/terminal | RunRegistry | AgentEvent reducer, Desktop reducer |
| Persist transcript | session recorder/store | Desktop local state |
| Transport envelope sequence | Host egress boundary | agent-host event mapper |
| Error title and recovery actions | Desktop projection of `AgentFailure` | raw prose matching |

## 8. Normal and exceptional flows

### 8.1 Clean stop

```text
Pi final assistant stop
  -> agent-host outcome { completed, stop }
  -> Host terminateRun(completed)
  -> run/terminal(completed)
```

Text may be empty. No transcript scan occurs.

### 8.2 Thinking-only stop

Exactly the clean-stop flow. Thinking remains thinking. Desktop may show a
neutral explanation such as "模型结束了本轮，但没有生成正文" only as a
presentation hint. It must not create an error event or failed Run.

### 8.3 Tool calls

Pi executes tools and continues natively. Host observes normalized tool events
and owns concrete side effects through injected ports. Host does not inspect
tool presence to decide whether `prompt()` should continue.

### 8.4 Provider or protocol error

Pi finishes with `stopReason: error`. `agent-host` maps the final native error
to one `AgentFailure`, returns `{ status: 'failed' }`, and may emit one
structured error event for transcript evidence. Host terminalizes once from the
returned outcome.

### 8.5 User stop, pause, or supersede

Host aborts the exact Run. `agent-host` stamps every trailing event with that
Run's id and returns `aborted` only after Pi is idle. Host maps the outcome using
its already recorded control reason:

- user stop -> cancelled;
- pause -> interrupted/paused;
- replace-run -> cancelled/superseded;
- spontaneous provider abort with no Host abort reason -> failed transport
  outcome, not a fake user cancellation.

### 8.6 Unterminated closed stream

`supportsFinishReason` remains at Pi's native default. When the SSE body closes
without a terminal finish reason, Pi produces its native error. Native Pi retry
may retry it within the same Run. The final settled outcome is returned.

### 8.7 Connection held open by keep-alive comments

The OpenAI SDK request timeout covers connection/response-header acquisition;
it does not provide a parsed-token idle deadline for the whole streaming body.
Raw HTTP body idle is also ineffective when `: keep-alive` bytes continue.

For the OpenAI-completions path only, `agent-host` tracks native assistant
message progress:

```text
assistant message_start -> arm
assistant message_update -> reset
assistant message_end -> disarm
tool / permission / native retry backoff -> disarmed
```

The duration is Pi's `httpIdleTimeoutMs`; `0` disables the guard. When it fires:

1. record `model-stream-stalled` as the intended failure;
2. request Pi abort;
3. await Pi prompt/idle settlement;
4. return the recorded failed outcome;
5. never clear active Run identity before settlement.

Abort failure is logged and attached as a bounded cause; it is never silently
swallowed.

## 9. Retry policy

Pi native retry is restored and remains inside the Pi session:

- `SettingsManager` is passed through without forced retry overrides;
- Pi's `retry.enabled`, `maxRetries`, `baseDelayMs`, and provider settings are
  honored;
- all attempts use one product `runId`;
- `auto_retry_start/end` are normalized into model-retry progress events or an
  equivalent `retry-waiting` Run phase;
- intermediate retryable failures do not terminalize the product Run;
- the final settled Pi outcome terminalizes it once.

Pi 0.84's generic retry classifier may treat some deterministic provider error
prose as transient. That is a pinned-kernel behavior, not authorization for a
Host retry loop or a dynamic Settings proxy. Resolution order is:

1. use a newer pinned Pi release when it provides structured retry
   classification and passes the conformance suite;
2. otherwise honor Pi 0.84's user-configurable native retry setting and expose
   retry attempts honestly;
3. never silently force a different product-wide budget in adapter code.

## 10. Run identity and late events

`BackendPreparedPrompt.runId` is mandatory for foreground prompts. Before
calling Pi, both SDK and worker backends set one active Run identity. Every
foreground normalized event is stamped before crossing the backend boundary.

Rules:

1. Event ids remain generation-scoped.
2. Run ids remain product-owned and are never derived from message ids.
3. Worker frame context and event `runId` must agree; disagreement is a backend
   protocol error.
4. An event from a settled Run is dropped at Host admission and logged.
5. An identity-less foreground provider error is never assigned to the current
   Run. The structured prompt outcome still carries the failure, so no error is
   lost by refusing to guess.
6. `RunEventCorrelator` may remain only for explicitly documented legacy or
   background events. It does not own provider-error fallback.

## 11. Host behavior

The detached turn executor receives one `AgentPromptOutcome` and performs one
terminal transition:

```ts
const outcome = await liveSession.prompt(promptInput);

switch (outcome.status) {
  case 'completed':
    return terminateCompleted(outcome.stopReason);
  case 'failed':
    return terminateFailed(outcome.failure);
  case 'aborted':
    return terminateFromRecordedHostAbortReason(outcome);
}
```

Delete from Host completion logic:

- `getRunLastAgentError` and `lastAgentErrorMessage`;
- first-token success/failure gates;
- assistant-delivery/transcript scans;
- model-stream watchdogs;
- identity-less provider error reclamation;
- unconditional `retriable: true`;
- message-substring error or abort policy.

Host exceptions remain for Host failures such as runtime activation,
memory-pressure admission, transcript I/O, job cleanup, or worker crash. They
are mapped separately from `AgentPromptOutcome`.

## 12. Desktop and CLI behavior

`run/terminal` is the only lifecycle terminal input. An Agent error event may
attach failure evidence to the current assistant row before terminal delivery,
but it cannot set Run status, clear the active Run, or invent cancellation.

Desktop maps structured codes to titles and actions:

| Failure code | Title | Primary action |
|---|---|---|
| provider-authentication | 模型认证失败 | Open provider settings |
| provider-quota / provider-rate-limit | 模型调用受限 | Retry later / switch model |
| context-limit-exceeded | 上下文长度超限 | Compact / reduce context |
| model-stream-missing-finish | 模型流异常结束 | Retry |
| model-stream-stalled | 模型输出中断 | Retry |
| model-request-timeout | 模型请求超时 | Retry / inspect timeout setting |
| provider-http-error | 模型服务返回错误 | Retry when `retriable` |
| unknown-agent-failure | 生成失败 | Copy detail |

Legacy rows without structured failure display a generic generation failure and
the original detail. They are not reclassified as network/auth/quota from prose.

Desktop's duplicate controlled-abort string classifier is deleted after Host
and protocol migration. Cancellation comes from `run/terminal`.

## 13. Event delivery and persistence

Only Host egress creates `AgentEventEnvelope`. `agent-host/event-map` returns
plain normalized `AgentEvent[]`.

Structured failure is persisted with the assistant terminal record so history,
reconnect, local Desktop, remote clients, and CLI see the same category. A
transcript write failure is logged at the Host boundary; no empty catch is
allowed.

Ordering invariant:

```text
all accepted message/tool/error evidence for runId
  -> recorder flush/finalization
  -> RunRegistry terminal mutation
  -> run/terminal push
```

ADR 0038's egress barrier keeps the terminal push behind preceding evidence.
Lost client delivery is recovered from Host Run authority and transcript, not
by letting Desktop infer terminal state from an error event.

## 14. Module decomposition

The behavior migration must not add more code to oversized modules.

### 14.1 `agent-host`

Split `event-map.ts` by responsibility:

- `event-map.ts` — orchestration and bounded mapper state;
- `message-event-map.ts` — message lifecycle and snapshots;
- `tool-event-map.ts` — tool lifecycle;
- `agent-failure-map.ts` — Pi/provider error normalization;
- `agent-usage-map.ts` — usage projection;
- `native-context-event-map.ts` — opaque native context copies.

Add focused modules:

- `pi-prompt-outcome-tracker.ts` — native final outcome only;
- `pi-parsed-stream-guard.ts` — OpenAI-completions progress deadline only;
- `agent-event-run-id.ts` — explicit Run stamping.

No module above owns product Run state.

### 14.2 `host-runtime`

Reduce `host-runtime.ts` to a composition shell below 1,000 lines through
mechanical, behavior-neutral extractions before changing semantics:

- `session-agent-event-router.ts` — correlation, recorder, usage/hook fan-out;
- `run-terminalizer.ts` — cleanup, transcript finalization, Run terminal push;
- `host-push-publisher.ts` — envelope and sink fan-out;
- `session-runtime-lifecycle.ts` — activation/replacement/suspension wiring;
- existing command modules remain command owners.

Split `session-prompt-command.ts`:

- command validation/admission remains in `session-prompt-command.ts`;
- detached model execution moves to `session-turn-executor.ts`.

The extraction commits contain no behavior changes.

## 15. Compatibility and rollout

1. Add structured fields before making them required on decoded wire input.
2. Upgrade Host and local Desktop together in the local sidecar build.
3. Remote/older clients receive compatibility `message` and `retriable` fields.
4. Host treats missing structured fields from an older backend as
   `unknown-agent-failure`, never as success.
5. No migration rewrites old successful thinking-only rows.
6. No database destructive migration is required; new structured failure data
   is additive and nullable.
7. Current live runtimes must be recreated after deployment so the new backend
   contract and retry settings take effect.

## 16. Observability

Diagnostics record bounded structured facts per model attempt:

- product `runId` and runtime generation id;
- provider/model identifiers without credentials;
- attempt number;
- time to response headers;
- time to first parsed assistant progress;
- time since last parsed progress;
- final native stopReason;
- normalized failure code and HTTP status when available;
- whether Pi native retry occurred;
- whether the parsed-stream guard fired;
- abort requested and abort settled timestamps.

CPA HTTP 200 is recorded as transport evidence, not as proof of product Run
success. No token content, reasoning content, prompts, API keys, or raw headers
are written to these diagnostics by default.

## 17. Required tests

### 17.1 Adapter fixtures

- clean text `stop`;
- clean thinking-only `stop`;
- tool call followed by successful final `stop`;
- final `length`;
- `stopReason: error` with structured HTTP status;
- native `aborted`;
- closed OpenAI stream without `finish_reason`;
- parsed stream with assistant deltas then no progress;
- tool/permission wait longer than the model idle duration;
- native retry error then success;
- native retry budget exhausted;
- immediate retry after parsed-stream timeout;
- late old-run error while a replacement Run is admitted.

### 17.2 Conformance

Every fixture runs against SDK and worker backends and asserts identical:

- `AgentPromptOutcome`;
- event `runId`;
- structured failure;
- retry lifecycle;
- abort settlement;
- final Run status/code/failure.

### 17.3 Host and clients

- exactly one Run terminal transition;
- no error event can terminalize Desktop state;
- lost terminal push recovers from RunRegistry + transcript;
- old-run identity-less errors cannot fail a new Run;
- legacy unstructured errors render generic failure;
- stream stall is not labelled as a network-connectivity failure;
- thinking-only stop remains completed.

## 18. Definition of done

1. `SessionHandle.prompt()` returns `AgentPromptOutcome` in every implementer.
2. No Host completion path checks transcript text, tools, first-token telemetry,
   or cached error prose.
3. No global Pi retry override remains.
4. No foreground Agent error leaves `agent-host` without `runId`.
5. SDK/RPC conformance suite is green.
6. Parsed-stream timeout awaits Pi idle and is limited to
   OpenAI-completions.
7. Desktop lifecycle changes only from Run pushes/reconciliation.
8. Current errors use structured failure classification.
9. agent-host event envelopes and duplicate abort classifiers are deleted.
10. ADR 0015, ADR 0038, ADR 0059, architecture docs, and tests match the
    shipped behavior.
11. `pnpm typecheck` and affected package tests pass.
12. No touched or new source file exceeds 1,000 lines; `host-runtime.ts` and
    `event-map.ts` are brought below the cap by responsibility splits.
13. A user-approved live CPA/Grok smoke proves all four cases: text stop,
    thinking-only stop, missing finish, and keep-alive stall.

