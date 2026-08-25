# iOS Apple Health Client Capability Specification

| Field | Value |
|-------|-------|
| Status | **Review-complete proposal — ready for implementation approval** |
| Date | 2026-08-23 |
| Product owner | Piwin |
| Architecture authority | [ADR 0062](../adr/0062-client-device-tools-and-apple-health.md), ADR 0036, ADR 0037, ADR 0050 |
| Execution authority | [2026-08-23 implementation plan](../plans/2026-08-23-ios-apple-health-client-capability-execution-plan.md) |
| Review record | [2026-08-23 spec review](../notes/2026-08-23-ios-apple-health-spec-review.md) |

This document is the normative product, protocol, data, privacy, and lifecycle
specification for reading Apple Health data through Piwin Mobile. The execution
plan may split work into smaller PRs, but it must not weaken this document's
invariants.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

---

## 0. Frozen decision

Piwin will implement Apple Health as a read-only client device capability under
one Host-owned model tool:

```text
health_read_context
```

The feature has two independent data lanes:

1. **M1 foreground on-demand lane**: model tool -> Host broker -> targeted,
   authenticated iPhone -> native HealthKit aggregation -> direct result ->
   same model turn resumes. M1 has no independent Host health cache.
2. **M2 optional background-summary lane**: native HealthKit observer ->
   anchored incremental query -> recomputed daily buckets -> encrypted local
   outbox -> short authenticated HTTP upload -> encrypted, bounded Host summary
   store. No permanent background WebSocket is assumed.

M1 is the first shippable release. M2 is separately opt-in and MUST NOT block
M1.

The iOS app remains a client shell. It does not run Pi, a model loop, MCP,
Skills, Host filesystem tools, or a Node sidecar. HostRuntime remains the only
model-tool and session execution authority.

---

## 1. Problem and user outcomes

### 1.1 Problem

Piwin Mobile can currently pair once with a remote Host, retain a Host-issued
device credential in Keychain, reconnect its WebSocket, and operate Host-owned
sessions. It cannot yet expose iPhone-local data as a model tool.

HealthKit data is local to iOS and protected by category-scoped system consent.
The intended experience cannot be built by the Host alone, and a mobile
WebSocket cannot be treated as continuously available while iOS backgrounds
the app.

### 1.2 Required user outcomes

A user MUST be able to:

- pair the phone once and reuse the device credential after app and Host
  restarts;
- connect Apple Health once, choosing explicit read categories;
- ask “分析我最近七天的睡眠” and have the same model turn wait for and use
  real device data;
- explicitly select `@Health`, or let the model request Health only when the
  user's question is relevant;
- choose ask-every-time, allow-for-session, always-allow-this-Host, or off;
- see which metrics and date range were read, and when they were last fresh;
- receive a truthful offline/no-data/timeout response instead of fabricated
  health facts;
- disconnect, revoke access, and understand which Host cache or chat data is
  deleted;
- optionally enable bounded background summaries later, without expecting
  real-time delivery.

### 1.3 Success definition

The feature succeeds when Piwin Mobile is a useful native capability executor
while all of these remain true:

- Host owns the model tool schema, execution admission, session, Run, and
  transcript;
- client data release is explicit and category-bounded;
- no raw HealthKit timeline is uploaded;
- no mobile background socket continuity is claimed;
- every answer can state source period and freshness;
- cancellation, disconnect, and revocation fail closed.

---

## 2. Scope

### 2.1 M1 in scope

- Generic client-tool capability advertisement and direct request/result/cancel
  frames.
- A HostServer-owned `DeviceToolBroker` implementing a contracts-owned
  `ClientToolExecutionPort`.
- Host model tool `health_read_context` and tool family `device-health`.
- A Tauri 2 mobile native plugin backed by Swift and HealthKit.
- Foreground consent, authorization, aggregation, partial results, and a
  health-specific tool card.
- `@Health` as structured turn intent, not hidden text inserted into the user's
  message.
- Metrics listed in section 8, with a maximum 90-day total query window.
- SDK and RPC backend parity through the existing
  `SessionHostToolExecutionPort`.
- Real-device functional and privacy acceptance.

### 2.2 M2 in scope

- Optional HealthKit background observer and anchored incremental processing.
- Encrypted local outbox and short authenticated HTTP sync.
- Bounded encrypted Host daily-summary store, retention, cache status, and
  deletion.
- Cache-aware resolution when the phone is offline.
- A Health settings/status page with sync freshness and cache controls.

### 2.3 Explicit non-goals

- Writing any value to Apple Health.
- Clinical records, medications, diagnoses, lab reports, or medical record
  imports.
- Continuous/current heart-rate monitoring or emergency alerting.
- Raw workout routes, raw GPS, per-second samples, or HealthKit object UUIDs.
- Nutrition, blood glucose, blood pressure, blood oxygen, ECG, fertility, or
  reproductive-health data in M1/M2.
- Medical diagnosis or treatment instructions.
- Public multi-user Health hosting.
- Custom E2EE between HealthKit and a remote model provider. Data is decrypted
  at the user's Host before the selected summary is sent to its configured
  model provider.
- Ambient microphone measurement. A future
  `device_measure_ambient_noise` capability requires a separate spec and
  permission disclosure.
- Guaranteed instant background sync.

---

## 3. Existing Piwin baseline

The implementation MUST extend, not bypass, these existing seams:

| Existing seam | Current authority | Required extension |
|---------------|-------------------|--------------------|
| `HostClientHello` / `HostHello` | `@piwin/contracts` | optional client-tool advertisement and Host support flag |
| Wire codec and WebSocket | `@piwin/host-transport` | direct client-tool frames with strict validation and smaller payload caps |
| Device pairing and hashed secret store | `@piwin/host-server` | bind capability/connection state to authenticated `deviceId` |
| `SessionHostToolExecutionPort` | `@piwin/host-runtime` | continue as the only model-tool execution entry |
| `buildSessionHostTools()` | `@piwin/host-runtime` | register `health_read_context` from one composition source |
| SDK/RPC tool adapters | `@piwin/agent-host` | no second health-specific adapter path |
| Tauri Mobile + React | `apps/mobile` | settings, consent, client-tool runtime, fixed health presentation |
| Tauri native entry | `apps/mobile/src-tauri` | app-local HealthKit mobile plugin |

Current generated Apple project files under `apps/mobile/src-tauri/gen/apple`
are build output. Implementation MUST NOT make those files the source of truth.

---

## 4. Product and authority model

### 4.1 Host remains authoritative

The Host owns:

- the model-visible name, description, and JSON schema;
- which sessions and generations expose the tool;
- Run and tool-call admission;
- request construction, canonical date limits, selected device, deadline, and
  cancellation;
- validation and deterministic formatting of the result passed to the model;
- optional M2 cache, retention, and deletion;
- the session transcript and configured model-provider call.

The Host MUST NOT accept a model tool description, JSON schema, system prompt,
or arbitrary display HTML from a client.

### 4.2 iOS remains authoritative over data release

The iPhone owns:

- HealthKit system authorization;
- Piwin's local source-release setting;
- foreground user-presence checks;
- HealthKit query execution and on-device aggregation;
- which requested fields can actually be returned;
- M2 anchors, change processing, and local outbox;
- refusal when the request exceeds the client allowlist or local policy.

The client MUST treat Host arguments as untrusted network input even after
device authentication. It MUST validate capability ID, metric IDs, date span,
granularity, deadline, and output bounds again before querying HealthKit.

### 4.3 Reference product patterns

Piwin adopts these product patterns without copying their architecture:

- Claude: contextually request only the health data needed for the question,
  read-only access, explicit user permission, and native chart presentation.
- ChatGPT Health: connected-source status, explicit `@Health`, ask-before-use,
  Health-focused history/status UI, read-only behavior, and disconnect/delete
  semantics.
- The local Planora implementation: model-selected CLIENT tool, pending wait,
  iOS execution, result correlation, and same-turn resume.

Piwin differs from Planora by using its existing bidirectional WebSocket for
M1, separating microphone and HealthKit, requesting HealthKit authorization in
an explicit setup/first-use flow, and assigning background ownership to native
Swift rather than SSE/WebView lifecycle.

---

## 5. Architecture

### 5.1 M1 foreground path

```text
User / @Health
      │
      ▼
Host model calls health_read_context
      │
      ▼
SessionHostToolExecutionPort
      │ run + generation + tool admission
      ▼
health tool executor
      │ canonical request
      ▼
ClientToolExecutionPort (contracts)
      │
      ▼
DeviceToolBroker (host-server)
      │ targeted, direct WebSocket frame
      ▼
HostClient -> Mobile ClientToolRuntime
      │ fixed consent UI
      ▼
Swift HealthKit plugin
      │ aggregate + normalize
      ▼
client-tool/result
      │ validate + format
      ▼
ToolResult -> Pi SDK/RPC -> same model turn
```

### 5.2 Composition rule

`@piwin/host-runtime` MUST NOT import `@piwin/host-server`.

Each Host composition root performs this order:

```text
1. create DeviceCapabilityRegistry / DeviceToolBroker
2. create HostRuntime({ clientToolExecution: broker })
3. create HostServer({ runtime, clientToolBroker: broker })
4. start HostServer
```

The CLI/desktop sidecar mobile-access composition MUST inject the same broker
into its `MobileAccessController`. Tests may inject a fake
`ClientToolExecutionPort` directly into HostRuntime.

### 5.3 M2 background path

```text
HKObserverQuery notification
      │
      ▼
HKAnchoredObjectQuery per metric
      │ added/deleted samples
      ▼
recompute affected local-day buckets
      │
      ▼
encrypted native outbox
      │ short URLSession upload when allowed
      ▼
authenticated Host HTTP ingress
      │ deviceId inferred from credential
      ▼
HealthSummarySyncPort -> encrypted bounded store
      │
      ▼
health_read_context cache resolver
```

React and the WebView MUST NOT be required for this M2 path.

---

## 6. Connection, pairing, consent, and device selection

### 6.1 Pairing

Existing one-use pairing remains unchanged:

1. Host mints a short-lived pairing token and QR payload.
2. Mobile sends exactly one admission key on `client/hello`.
3. Host issues `deviceId` plus `deviceSecret` once.
4. Mobile stores the credential in Keychain.
5. Host stores only the secret hash and reuses the device identity on later
   reconnects.

Health settings MUST NOT use `hostInstanceId` as their durable scope because
that value identifies one replay/journal lifetime and can rotate when a
sidecar listener restarts. M1 derives a local consent scope from:

```text
SHA-256(normalized Host endpoint (scheme/host/port/path, no query/fragment)
        + "\n" + paired deviceId)
```

Changing endpoint or device credential requires confirmation again.
Changing the model destination from local to external, or changing external
provider ID, invalidates any persistent/session Health use grant and prompts
again. A Host process restart with the same endpoint and paired credential does
not.

### 6.2 Four distinct states

The UI MUST NOT collapse these into a single “connected” switch:

| State | Meaning | Persistence |
|-------|---------|-------------|
| Host paired | Phone may authenticate to this Host | iOS Keychain + Host pairing store |
| HealthKit categories selected | iOS may return accessible samples | Apple Health authorization state |
| Piwin foreground use mode | When a model request may release a summary | local, per Host; Host learns only the outcome of each request |
| Background summary sync | Whether daily aggregates may be stored on Host | separate opt-in, local + Host |

Default foreground use mode is `ask-every-time`. Background sync defaults off.

### 6.3 Foreground use modes

```ts
type HealthForegroundUseMode =
  | 'off'
  | 'ask-every-time'
  | 'allow-for-session'
  | 'always-allow-this-host';
```

- `off`: do not advertise the Health executor and reject any stale request.
- `ask-every-time`: show a fixed Piwin consent sheet for every request.
- `allow-for-session`: allow only the named `sessionId`; the user can revoke it
  at any time. It does not carry to another session.
- `always-allow-this-host`: available only after one successful explicit read;
  every execution remains visible in the chat tool card and Health activity
  log.

Selecting `@Health` is explicit consent for that turn, but it does not grant
background sync or change the persistent use mode.

### 6.4 Device selection

The Host MUST target one device; it MUST NOT broadcast a health request.

Selection order:

1. configured primary Health device if it is non-revoked and known capable;
2. most recently connected capable iOS device;
3. most recently advertised capable iOS device, which may produce an explicit
   offline result;
4. no device -> `tool-not-available` with reason `client-device-unavailable`.

The capability registry persists an optional primary `deviceId` per capability.
The primary selector is accepted only when that device is currently paired,
non-revoked, and known to advertise the capability.

When two live connections claim the same `deviceId`, the newest authenticated
connection epoch supersedes the older one for new work. Existing pending work
is not silently migrated.

---

## 7. Client-tool protocol

### 7.1 Capability advertisement

`HostClientCapabilities` gains an optional bounded list:

```ts
export type ClientToolCapabilityAdvertisement = {
  id: string;
  version: number;
};

export type HostClientCapabilities = {
  // existing fields...
  clientTools?: readonly ClientToolCapabilityAdvertisement[];
};
```

M1 recognizes exactly:

```text
apple-health.read-context.v1
```

Rules:

- maximum 32 advertisements;
- capability ID maximum 128 ASCII characters and version a positive safe
  integer;
- duplicate IDs are rejected;
- unknown IDs may be recorded as unsupported diagnostics but MUST NOT create a
  model tool;
- the advertisement contains no HealthKit values, category authorization
  state, model description, prompt, or executable code;
- only a paired `deviceId` may advertise a device tool. Door-token or anonymous
  clients cannot become health executors.

`RemoteCapabilitySummary` gains:

```ts
clientToolRequests?: boolean;
```

The Host sends direct client-tool frames only when both sides negotiated the
feature.

An authenticated client MAY send a bounded
`client-tool/capabilities` replacement frame when a local executor is enabled
or disabled. Replacement is atomic; omission removes the capability. The Host
persists only normalized capability IDs, app version, last-advertised time, and
an optional validated primary device per capability under
`~/.piwin/devices/capabilities.json` with owner-only permissions.

### 7.2 Direct frames

The following TypeScript is normative in shape; exact type aliases may be split
across contract files.

```ts
export type ClientToolRequestFrame = {
  type: 'client-tool/request';
  requestId: string;
  capabilityId: 'apple-health.read-context.v1';
  sessionId: string;
  runId: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  deadlineAt: string;
  timeoutMs: number;
  display: {
    title: '读取 Apple Health';
    metricLabels: string[];
    periodLabel: string;
    provider?: {
      id: string;
      label: string;
      processing: 'local' | 'external';
    };
    explicitTurnIntent: boolean;
  };
};

export type ClientToolResultStatus =
  | 'success'
  | 'permission-denied'
  | 'user-presence-required'
  | 'no-accessible-data'
  | 'unavailable'
  | 'cancelled'
  | 'failed';

export type ClientToolResultErrorCode =
  | 'local-policy-denied'
  | 'user-presence-required'
  | 'healthkit-unavailable'
  | 'healthkit-no-accessible-data'
  | 'healthkit-query-failed'
  | 'deadline-expired'
  | 'cancelled';

export type ClientToolResultFrame = {
  type: 'client-tool/result';
  requestId: string;
  status: ClientToolResultStatus;
  completedAt: string;
  result?: Record<string, unknown>;
  errorCode?: ClientToolResultErrorCode;
};

export type ClientToolCancelFrame = {
  type: 'client-tool/cancel';
  requestId: string;
  reason: 'run-aborted' | 'deadline' | 'connection-replaced' | 'host-shutdown';
};

export type ClientToolCapabilitiesFrame = {
  type: 'client-tool/capabilities';
  capabilities: readonly ClientToolCapabilityAdvertisement[];
  sentAt: string;
};
```

The Host creates all display strings from trusted product copy and normalized
arguments. Model-generated free text MUST NOT be rendered in the consent sheet.
The client result is data-only; the Host ignores any unknown string fields and
does not pass a client error string directly to the model.

The provider object is disclosure and consent-fingerprint input, not an API
credential. It contains no endpoint, key, or secret. If provider facts are
unavailable, ask-every-time remains mandatory for that request.

`success` requires one result object and forbids `errorCode`. Every non-success
status forbids `result` and may use only a status-compatible stable error code.
The codec rejects inconsistent combinations.

### 7.3 Direct-frame semantics

Client-tool frames MUST NOT:

- consume or advance HostPush `seq`;
- enter `HostReplayJournal` or `HostEgressHub` fan-out;
- appear in hydration or snapshots;
- be replayed after reconnect;
- be sent to another authenticated connection or shell;
- use `HostCommand` as a disguised device request.

The codec still enforces the existing one-MiB hard frame ceiling. In addition:

- request arguments maximum: 32 KiB encoded;
- result maximum: 128 KiB encoded;
- capability replacement maximum: 8 KiB encoded;
- `timeoutMs` is a positive integer capped at 180,000; the client applies it to
  a monotonic timer starting when the frame is accepted, so wall-clock skew
  cannot extend execution;
- all timestamps must be valid RFC 3339 strings;
- `completedAt` and result `generatedAt` must fall between ten minutes before
  Host request issue and ten minutes after the request deadline; future
  `freshAsOf` values beyond the same ten-minute clock-skew allowance fail;
- all IDs must be non-empty, bounded strings;
- records must be plain JSON values with finite numbers and no prototype-based
  interpretation.

### 7.4 Broker contract

`@piwin/contracts` defines a transport-neutral port:

```ts
export type ClientToolExecutionRequest = {
  capabilityId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  deadlineMs: number;
  preferredDeviceId?: string;
  display: ClientToolRequestFrame['display'];
};

export type ClientToolExecutionOutcome =
  | { ok: true; deviceId: string; completedAt: string; result: Record<string, unknown> }
  | {
      ok: false;
      reason:
        | 'client-device-unavailable'
        | 'client-device-disconnected'
        | 'client-tool-timeout'
        | 'permission-denied'
        | 'user-presence-required'
        | 'no-accessible-data'
        | 'cancelled'
        | 'invalid-client-result'
        | 'client-tool-failed';
      retryable: boolean;
    };

export interface ClientToolExecutionPort {
  execute(
    request: ClientToolExecutionRequest,
    signal: AbortSignal,
  ): Promise<ClientToolExecutionOutcome>;
}
```

`DeviceToolBroker` MUST enforce:

- maximum 32 pending client-tool calls Host-wide;
- maximum one pending Apple Health call per device;
- M1 default deadline 120 seconds, capped at 180 seconds;
- one accepted result per request ID;
- result connection ID and authenticated device ID equal the pending binding;
- duplicate, late, wrong-device, malformed, and post-cancel results are ignored
  and logged without payload values;
- disconnect fails pending work immediately as retryable; reconnect does not
  resend automatically;
- AbortSignal sends best-effort cancel, settles the Host promise as cancelled,
  and leaves no pending entry;
- Host shutdown cancels every pending request.

### 7.5 HostClient API

`HostTransport.send` is expanded from command/replay-only to an explicit
client-outbound union that includes `client-tool/result` and
`client-tool/capabilities`. `client-tool/request` and cancel remain
Host-to-client only.

`HostClient` exposes narrow APIs rather than leaking the raw transport:

```ts
subscribeClientToolRequests(listener): () => void;
subscribeClientToolCancellations(listener): () => void;
sendClientToolResult(frame): void;
replaceClientToolCapabilities(capabilities): void;
```

Calling these before an authenticated ready state or without Host support MUST
fail locally.

### 7.6 Compatibility

M1 keeps `HOST_PROTOCOL_VERSION = 1`. Every new hello field is optional, and no
new frame is sent without bilateral capability negotiation. Therefore:

- a new mobile client connected to an old Host does not advertise an active
  feature in UI and never sends a client-tool result;
- a new Host never sends client-tool traffic to an old client;
- an old codec is never asked to parse an unnegotiated new frame.

A future incompatible frame meaning or authentication change requires a
protocol-version decision; adding arbitrary fallbacks under version 1 is not
allowed.

---

## 8. Health domain contract

### 8.1 Model-visible tool

```text
name: health_read_context
family: device-health
```

Description requirements:

- use only when the user asks about their Apple Health data or explicitly
  selects Health;
- do not call for generic wellness advice that does not need personal data;
- request the minimum metrics and shortest useful range;
- one call per Run; include all required metrics in that call;
- treat unavailable or missing data as missing, never as a normal/zero value;
- report data period and freshness in the answer;
- do not diagnose.

The tool MUST be a direct Host tool, not a lazy toolbox target. It is eligible
only for user-owned root sessions and MUST be absent from subagent, unattended
Job, and side-chat capability ceilings.

M1 uses the exact experimental composition gate:

```text
PIWIN_EXPERIMENTAL_APPLE_HEALTH=1
```

When the gate is off, composition does not inject `ClientToolExecutionPort`,
the Host advertises no client-tool support, and the health tool is absent. When
on, `ToolExposureInput` gains `deviceHealth: true` for eligible root sessions
and intersects that exposure with the `device-health` registration in
`availableFamilies`. Online device state MUST NOT mutate an already frozen
generation surface; execution reports current device availability dynamically.

### 8.2 Tool arguments

```ts
type AppleHealthMetricId =
  | 'steps'
  | 'active-energy'
  | 'exercise-minutes'
  | 'workouts'
  | 'sleep-duration'
  | 'sleep-stages'
  | 'resting-heart-rate'
  | 'heart-rate-variability';

type HealthReadContextArguments = {
  metrics: AppleHealthMetricId[]; // 1..8 unique values
  range:
    | { preset: 'today' | 'last-7-days' | 'last-30-days' }
    | { preset: 'custom'; startDate: string; endDateExclusive: string };
  granularity?: 'summary' | 'day';
  includePreviousPeriod?: boolean;
};
```

Date strings use `YYYY-MM-DD`. The phone resolves date boundaries in its
current calendar and timezone and returns exact instants and timezone. The
normalized total window, including an optional previous-period comparison,
MUST NOT exceed 90 days. Future dates, reversed ranges, unknown metrics,
duplicate metrics, extra nesting, non-finite numbers, and oversized arrays are
`invalid-input` before the broker is called.

`prepareArgs` performs canonicalization before policy and execution, preserving
Tool Execution Pipeline V2 ordering.

### 8.3 One-call budget

The Host allows at most one admitted `health_read_context` invocation per
`runId`. A second distinct tool call in the same Run returns
`tool-not-available` with detail reason `health-call-budget-exhausted`. The
budget is released only when the Run becomes terminal, not merely cancelling.

### 8.4 Normalized result

The native result uses stable enums and numbers only:

```ts
type AppleHealthRecord = {
  metric: AppleHealthMetricId;
  localDate: string;
  unit: 'count' | 'kcal' | 'minute' | 'bpm' | 'ms';
  value?: number;
  components?: Record<string, number>;
  sampleCount?: number;
  freshAsOf: string;
};

type AppleHealthReadResultV1 = {
  schemaVersion: 1;
  source: 'apple-health';
  timeZone: string;
  startAt: string;
  endAt: string;
  generatedAt: string;
  records: AppleHealthRecord[];
  unavailableMetrics: Array<{
    metric: AppleHealthMetricId;
    reason: 'not-authorized-or-no-data' | 'unsupported' | 'query-failed';
  }>;
  warnings: Array<
    | 'partial-result'
    | 'sleep-source-overlap-normalized'
    | 'timezone-changed-within-range'
    | 'comparison-unavailable'
  >;
};
```

Bounds:

- maximum 720 records;
- maximum eight unavailable metrics and 16 warnings;
- all values finite and non-negative unless a future metric explicitly says
  otherwise;
- `components` keys come from a metric-specific Host allowlist;
- unknown records and keys are rejected, not forwarded;
- `freshAsOf` is per record because metrics update at different times.

Host result validation additionally requires every record metric to have been
requested, every unit/component key to match that metric's allowlist, every
local date to fall inside the normalized range, and every `(metric, localDate)`
pair to be unique. `startAt`/`endAt` must represent the requested local-date
window in the returned timezone within bounded clock skew. A partial result
cannot smuggle an unrequested metric.

The client MUST NOT send HealthKit UUIDs, source names, device names, metadata,
routes, notes, or arbitrary strings. Workout components are bounded normalized
activity categories, count, duration, and energy only.

### 8.5 ToolResult mapping

The Host validates the native result and builds model text itself. It MUST NOT
use a client-generated prose summary as model content.

Successful `ToolResult`:

- `output`: deterministic, compact JSON or tabular text containing the
  validated records, source, period, timezone, and freshness;
- `details.sensitivity = 'health'`;
- `details.health`: a bounded UI summary, not a second unbounded copy;
- no images or raw HealthKit payload.

The model-visible output starts with a fixed statement that the values are
user-authorized Apple Health summaries and that missing metrics are unknown,
not zero.

Outcome mapping:

| Client/broker outcome | ToolResult |
|-----------------------|------------|
| success | `ok: true` |
| local policy denied | `permission-denied` |
| Run/client cancel | `aborted`, `cancelled: true` |
| phone offline/disconnected | `tool-not-available`, retryable |
| user presence required | `tool-not-available`, retryable |
| timeout | `tool-not-available`, retryable, detail `client-tool-timeout` |
| no accessible data | `tool-not-available`, non-retryable for this request |
| malformed result | `execution-failed`, non-retryable |

No new top-level `ToolResultErrorCode` is required for M1; stable detailed
reasons live in `details.reason`.

### 8.6 Permission-pipeline behavior

`HOST_TOOL_PERMISSION_ACTIONS` gains `device:health-read`. The registration
uses risk `network`, `rememberable: false`, and an explicit policy outcome whose
reason is `client-device-consent-enforced`. It MUST NOT produce a duplicate
generic filesystem/network permission dialog. Piwin's fixed Health consent
flow is the human approval authority.

Immediate safety and Run/generation revalidation still execute immediately
before the client request is admitted.

---

## 9. iOS HealthKit implementation

### 9.1 Native plugin ownership

Create an app-local Tauri 2 mobile plugin with:

- a Rust registration boundary used by `apps/mobile/src-tauri/src/lib.rs`;
- an iOS Swift Package containing the HealthKit implementation;
- fixed Tauri permissions/capabilities for the exposed commands;
- a typed TypeScript bridge used by `MobileClientToolRuntime`;
- no HealthKit calls in React components.

M1 native commands:

```text
healthkit_is_available
healthkit_authorization_request_status
healthkit_request_read_authorization
healthkit_read_context
healthkit_cancel_read
```

Phase M2 adds native sync configuration/status commands but does not route
observer callbacks through React.

### 9.2 Entitlements and purpose strings

The canonical Tauri configuration/build inputs MUST add:

- HealthKit capability/entitlement;
- `NSHealthShareUsageDescription` that names the categories and explains that
  selected summaries are sent to the user's configured Piwin Host for chat
  analysis;
- no `NSHealthUpdateUsageDescription`, because the feature does not write;
- no background mode or entitlement unrelated to the documented M2 flow.

Generated Xcode project files MUST be regenerated and inspected but not used as
the only source of these settings.

### 9.3 Authorization behavior

- Setup or first relevant use presents Piwin disclosure before Apple's system
  authorization sheet.
- Request only the categories selected by the user and supported by the
  requested M1 metrics.
- Do not call `requestAuthorization` on every tool execution.
- HealthKit read privacy can make “denied” indistinguishable from “no accessible
  samples”; user-facing and wire status MUST say “not authorized or no data”
  unless Piwin itself denied through its local share mode.
- A partial result is successful when at least one requested metric has valid
  records; unavailable metrics are returned explicitly.
- If no requested metric is available, return `no-accessible-data`.

### 9.4 Metric aggregation

| Metric | HealthKit input | M1 output |
|--------|-----------------|-----------|
| steps | step count | sum per local day |
| active energy | active energy burned | kcal per local day |
| exercise minutes | Apple exercise time | minutes per local day |
| workouts | workout samples | total duration in minutes, workout count, bounded per-type duration totals |
| sleep duration | sleep analysis | union of asleep intervals, minutes per sleep day |
| sleep stages | sleep analysis stages | awake/core/deep/REM/asleep-unspecified minutes |
| resting heart rate | resting HR quantity | discrete average per local day with sample count |
| HRV | SDNN quantity | discrete average per local day in ms with sample count |

Rules:

- Convert units on device into the canonical units above.
- Query only exact normalized date bounds.
- Use strict local calendar boundaries and return the applied IANA timezone.
- For sleep only, query may look back up to 18 hours before the normalized
  start boundary so a sleep episode ending on the first requested day is not
  truncated; output still includes only requested sleep days.
- Sleep total MUST be the union of asleep intervals, not the sum of every
  overlapping sample. Unioned intervals whose gap is at most 120 minutes form
  one sleep episode; the episode is attributed to the local date on which it
  ends. Naps follow the same rule.
- Stage-specific intervals are unioned per stage; if sources overlap, cap and
  warn rather than double-counting total sleep.
- Workout routes, locations, and metadata are never queried.
- Latest/current raw heart rate is intentionally absent from M1.
- Query errors are per metric; one failed type does not erase successful types.
- Cancellation calls `healthStore.stop(query)` for active queries where
  possible and ignores late completions.

Record interpretation is fixed:

| Metric | `unit` | `value` | `sampleCount` / allowed `components` |
|--------|--------|---------|--------------------------------------|
| steps | `count` | daily step sum | optional contributing sample count |
| active-energy | `kcal` | daily active-energy sum | optional sample count |
| exercise-minutes | `minute` | daily exercise-minute sum | optional sample count |
| workouts | `minute` | total workout duration | `sampleCount` is workout count; components are minute totals for `walking`, `running`, `cycling`, `strength-training`, `swimming`, `other` |
| sleep-duration | `minute` | unioned asleep duration | episode count may be `sampleCount` |
| sleep-stages | `minute` | unioned total asleep duration | components only `awake`, `core`, `deep`, `rem`, `asleep-unspecified` |
| resting-heart-rate | `bpm` | discrete daily average | contributing quantity count |
| heart-rate-variability | `ms` | discrete daily average | contributing quantity count |

Component values always use the record's unit. Workout active energy is not
duplicated inside `workouts`; callers request `active-energy` when needed.

### 9.5 Foreground lifecycle

`MobileClientToolRuntime` validates the request, checks application-active
state, applies use consent, invokes Swift, and sends exactly one result.

States exposed to UI:

```text
waiting-for-phone
awaiting-consent
awaiting-healthkit-authorization
reading
completed
partial
denied
no-data
phone-offline
timed-out
cancelled
failed
```

If the WebView is active but the app is not in a state that can present consent,
the client returns `user-presence-required`. If the process is suspended, the
Host deadline is the truthful fallback.

---

## 10. Product UX

### 10.1 Settings

Piwin Mobile adds `设置 -> 本机能力 -> Apple Health` with:

- unavailable / not connected / connected / partial / needs attention;
- Host display name and endpoint identity;
- current model/provider disclosure for the active session when known;
- selected metric categories;
- foreground use mode;
- primary Health device status;
- last foreground read;
- M2 background-summary toggle, retention, last sync, queued batch count, and
  cache delete action;
- disconnect action and a link/instruction for changing Apple Health system
  permissions.

The switch label MUST describe the effect. “Connect” cannot imply either
permanent network connectivity or background upload.

### 10.2 Consent sheet

The fixed consent sheet shows:

- “Piwin wants to read Apple Health for this question”;
- normalized metric labels and date range;
- destination Host identity;
- model provider/model if the summary will leave the Host;
- buttons: allow once, allow for this session, always allow this Host, deny;
- a reminder that Piwin is read-only.

No model-written rationale is shown. A model may choose metrics, but product
copy describes them.

### 10.3 Composer

`@Health` reuses Piwin's existing structured `PromptInput.contextRefs` and
transcript/queued-turn persistence rather than adding a parallel context-source
column:

```ts
type ConnectedSourceContextRef = {
  kind: 'connected-source';
  source: 'apple-health';
  label: 'Apple Health';
};

type PromptContextRef = ExistingPromptContextRef | ConnectedSourceContextRef;
```

The raw user message remains unchanged. Host prompt preparation appends a fixed
model-facing instruction that the user explicitly selected Apple Health for
this turn. Remote context-ref admission accepts only the exact source enum and
fixed bounded label; unknown connected sources fail validation. Explicit
Health intent does not bypass metric/date caps or HealthKit authorization.

### 10.4 Tool card and charts

`ToolKind` gains `health`. Desktop and Mobile render a fixed card rather than
raw JSON or model-generated HTML.

Collapsed card example:

```text
读取 Apple Health · 已完成
近 7 天：睡眠、步数 · 更新至 08:42
```

Expanded card may show:

- metrics used;
- date range and timezone;
- freshness;
- unavailable metrics and stable warnings;
- a typed daily line/bar chart generated from validated values.

The card never displays raw HealthKit identifiers or untrusted HTML.

### 10.5 Offline behavior

M1:

- no live phone -> state “手机离线”; model receives unavailable;
- UI offers “在 iPhone 打开 Piwin 后重试”;
- the Host does not silently answer from an old value.

M2:

- if cache satisfies requested range and freshness policy, use it and disclose
  `freshAsOf`;
- if cache is stale but still useful, the answer may use it only with an
  explicit stale-data warning;
- if current data is required and phone is offline, ask the user to open the
  phone rather than implying real-time access.

---

## 11. Privacy, persistence, and security

### 11.1 Data minimization

M1 sends only the normalized result in section 8.4. Client and Host logs MUST
contain only request ID, capability ID, duration, status, payload byte count,
and a redacted device identifier. They MUST NOT contain metric values, date
series, authorization choices, or user questions.

### 11.2 Session persistence — truthful M1 rule

The validated health summary passed to Pi becomes model context and may appear
in Pi-native session state and Piwin's tool transcript. M1 MUST disclose this.

M1 guarantees:

- raw HealthKit samples never leave iOS;
- summaries are excluded from cross-session memory, Notes, flashcard creation,
  generic RAG indexing, diagnostics, telemetry, and logs unless the user
  explicitly copies them into such a destination;
- deleting the Piwin session removes the Piwin-owned session copy according to
  normal session deletion semantics;
- provider-side retention follows the configured model provider and cannot be
  represented as Host cache deletion.

Normal multi-client session semantics still apply after tool execution: the
assistant answer and the persisted, validated health tool summary may be sent
through ordinary transcript pushes/replay/hydration to other authenticated
shells subscribed to that session. This is same-user session synchronization,
not the direct device-tool transport. Only the targeted
`client-tool/request/result/cancel` frames and pre-validation native payload are
excluded from fan-out/replay/hydration.

M1 does not claim that the health summary is ephemeral or absent from the chat
transcript.

### 11.3 Transport

- Health transfer requires `wss://` / `https://` by default.
- Loopback cleartext is allowed for simulator/development only.
- An advanced profile MAY allow `ws://` / `http://` only when the user explicitly
  declares a verified encrypted private tunnel such as WireGuard/Tailscale;
  ordinary private LAN is not sufficient by default.
- Pairing/device authentication remains mandatory even inside a private
  tunnel.
- Health payloads MUST never be placed in URL query parameters.
- Authorization and device secrets MUST be redacted by operational logging.

### 11.4 Model-provider disclosure

Before a summary is released, the user can see whether the configured Host
uses a local model or an external provider. The selected summary is sent to
that provider as part of the model tool result. Piwin MUST NOT claim
end-to-end secrecy from the provider.

### 11.5 Memory and secondary use

- Health tool results have `sensitivity: 'health'`.
- General memory creation MUST ignore health-sensitive tool results by default.
- Auto-generated notes, flashcards, walkthroughs, exports, or background
  reports MUST NOT consume health-sensitive tool output unless the user
  explicitly initiates that destination and sees the scope.
- Health data MUST NOT be used for advertising, marketing profiles, unrelated
  analytics, or capability recommendations.

### 11.6 Revocation and deletion

M1 disconnect:

- remove `apple-health.read-context.v1` from the client advertisement;
- clear local Piwin Health use/session grants for that Host;
- cancel active queries and clear transient result buffers;
- do not delete or modify Apple Health data;
- explain that existing chat summaries remain until those chats are deleted.

M2 disconnect additionally:

- stop background delivery requested by Piwin where applicable;
- clear local anchors/outbox after an acknowledged Host cache-deletion request,
  or retain a visible pending-delete state until acknowledged;
- delete the selected device's Host summary cache and capability record;
- retain no plaintext backup.

Revoking a paired device immediately disconnects it and prevents future result
or sync admission. By default, M2 revocation also schedules deletion of that
device's health summary cache; existing chats remain separate.

### 11.7 App Store and HealthKit boundaries

Apple Health support MUST be a visible user-facing health feature, not a hidden
generic sensor extractor. The privacy policy and App Store disclosure identify
the categories, Host destination, model-provider use, retention, and deletion.
No Health data is used for advertising or data mining.

Official references:

- [Configuring HealthKit access](https://developer.apple.com/documentation/xcode/configuring-healthkit-access)
- [Executing observer queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries)
- [HKAnchoredObjectQuery](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [HealthKit Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/healthkit/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

---

## 12. M2 background summary sync

M2 begins only after M1 acceptance.

### 12.1 Native processing

For each enabled metric, Swift persists an `HKQueryAnchor` and a monotonic local
summary revision counter in an iOS-protected store excluded from ordinary cloud
backup.

The M2 outbox is AES-GCM encrypted with a CryptoKit key generated on device and
stored in Keychain. Its files use complete-until-first-user-authentication data
protection and are excluded from backup. There is no plaintext outbox fallback.

On observer delivery:

1. run an anchored query for added/deleted objects;
2. identify affected local dates;
3. recompute complete daily buckets for those dates from HealthKit;
4. emit upsert/tombstone records with increasing device-local revision;
5. enqueue an encrypted batch;
6. call the HealthKit observer completion after durable staging, not after a
   long network wait;
7. attempt a short upload when iOS permits; otherwise retry on the next native
   wake or foreground launch.

The implementation never assumes observer delivery frequency or wall-clock
latency.

### 12.2 Sync body

```ts
type HealthSummarySyncBatchV1 = {
  schemaVersion: 1;
  batchId: string;
  generatedAt: string;
  records: Array<{
    revision: number;
    operation: 'upsert' | 'delete';
    metric: AppleHealthMetricId;
    localDate: string;
    timeZone: string;
    record?: AppleHealthRecord;
  }>;
};
```

Bounds:

- maximum 256 KiB request body;
- maximum 512 records per batch;
- record revision positive and monotonic for one `deviceId`;
- body `deviceId` is rejected if present; Host infers identity from auth;
- Host derives the storage key from authenticated `deviceId`, metric,
  localDate, and timezone; it never trusts a client-generated record key;
- `upsert` requires a matching validated `record`; `delete` forbids `record`;
- Host stores a SHA-256 digest with the most recent 1,024 batch IDs per device
  for up to 30 days; an identical duplicate returns the prior success after
  restart, while the same ID with a different digest returns conflict;
- older/equal record revisions do not overwrite newer records;
- tombstones delete only the authenticated device's matching key.

### 12.3 HTTP ingress

The Host exposes a narrow native-client endpoint on the same HTTP server that
owns the WebSocket upgrade:

```text
POST   /v1/device-health/summaries:sync
DELETE /v1/device-health/summaries
```

When M2 is enabled, `RemoteCapabilitySummary` advertises a relative,
Host-configured ingress description:

```ts
deviceHealthSync?: {
  schemaVersion: 1;
  syncPath: string;
  deletePath: string;
  maxBatchBytes: 262_144;
};
```

The client resolves these paths against the paired WebSocket endpoint's
normalized origin. Paths must be absolute-path references without credentials,
query, fragment, dot segments, or an authority component. The client refuses
cross-origin redirects. Reverse proxies with a path prefix configure the
advertised relative paths explicitly; the client does not guess by replacing a
WebSocket path.

Authentication:

```text
X-Piwin-Device-Id: <deviceId>
Authorization: Bearer <deviceSecret>
Idempotency-Key: <batchId>
```

The endpoint:

- is unavailable unless pairing and M2 health storage are enabled;
- uses the existing paired-device hash verification;
- accepts only JSON with an exact body cap;
- applies per-device rate limiting and at most one concurrent sync;
- never calls the model or Host session runtime;
- emits no health values in access/error logs;
- returns bounded status only.

Implementing M2 requires refactoring the current standalone
`WebSocketServer({ host, port })` ownership to an HTTP server plus WebSocket
upgrade. That refactor is a separate PR with characterization tests.

### 12.4 Host store

M2 adds `@piwin/health` with transport-neutral ports for sync, read, status,
and delete. The first store is a bounded encrypted atomic snapshot, not a new
database dependency:

```text
~/.piwin/health/summaries.v1.enc
```

- AES-256-GCM using Node's built-in crypto;
- encryption key obtained by the composition root through the existing secret
  resolver and injected into `@piwin/health`;
- owner-only directory/file permissions and atomic replace;
- no plaintext fallback when the key is unavailable;
- default rolling retention 90 days, configurable up to 365;
- maximum four devices, eight metrics, and 25,000 daily records;
- bounded persisted batch-id/digest ledger as specified above;
- delete is durable before success is returned;
- storage is not included in Notes/RAG indexes or generic config exports.

The encrypted snapshot threat model protects accidental disclosure and backups;
it does not claim protection from an attacker who controls the running Host and
its secret store.

### 12.5 Cache resolution

`health_read_context` resolves in this order:

1. use cache if it fully covers the range and meets freshness policy;
2. otherwise request the live phone when available;
3. optionally combine validated cache and live result only by metric/day key,
   preferring the newer `freshAsOf`;
4. if live is unavailable, return bounded stale cache only when the question
   does not require “now/today” and include an explicit stale warning;
5. otherwise return unavailable.

Default freshness:

| Metric | Fresh cache target |
|--------|--------------------|
| today activity/workouts | 2 hours |
| completed past days | 24 hours after day end, then stable unless corrected |
| sleep | 6 hours |
| resting HR / HRV | 24 hours |

These are product defaults, not medical guarantees. Every result still carries
its actual `freshAsOf`.

---

## 13. Package and file ownership

### 13.1 Contracts

Expected files:

- `packages/contracts/src/client-tool.ts` — capability advertisement, frames,
  execution port, normalized outcomes and caps;
- `packages/contracts/src/apple-health.ts` — metric, query, result, sync and
  validation-facing types;
- `packages/contracts/src/remote-protocol.ts` — hello capability and wire union;
- `packages/contracts/src/host.ts` — `ToolKind = 'health'` and structured
  connected-source context ref support through existing `PromptInput.contextRefs`;
- `packages/contracts/src/side-chat.ts` and remote context-ref validators — add
  the exact `connected-source/apple-health` ref without weakening file/message
  ref admission;
- `packages/contracts/src/session-capability.ts` — `device-health` family;
- `packages/contracts/src/tool-registration.ts` — `device:health-read` action;
- `packages/contracts/src/tool-result.ts` — typed health sensitivity marker;
- `packages/contracts/src/index.ts` — public exports.

### 13.2 Host transport/client

- `packages/host-transport/src/protocol-codec.ts` — frame allowlist, strict
  validation, per-frame caps;
- `packages/host-transport/src/host-transport.ts` — explicit outbound union;
- `packages/host-client/src/host-client.ts` — subscriptions and bounded result
  send APIs.

### 13.3 Host server

New domain files rather than further growing `host-server.ts`:

- `device-capability-registry.ts` and file store;
- `device-tool-broker.ts`;
- `client-tool-frame-router.ts`;
- M2 `device-health-http-ingress.ts`.

`host-server.ts` only delegates authenticated hello, post-auth frame routing,
connection close, and direct send seams to those components.

### 13.4 Host runtime

- `health-read-context-tool.ts` — descriptor, preparation, deterministic output
  and ToolResult mapping;
- `health-tool-run-budget.ts` — one call per Run with terminal cleanup;
- `tools/build-session-host-tools.ts` — sole registration composition;
- capability policy/compiler updates for `device-health` root-session exposure;
- `HostRuntimeOptions.clientToolExecution` optional injected port;
- M2 cache reader injected as a contracts-owned port.

`@piwin/agent-host` receives no HealthKit implementation. It only needs tests
confirming the existing SDK/RPC ToolResult path carries the health result and
cancellation consistently. Its pure `tool-presentation.ts` classifier gains
the known `health_read_context -> health` mapping and bounded health-specific
argument/output presentation; UI apps still do not infer tool kind.

### 13.5 Mobile

- app-local HealthKit Tauri plugin under `apps/mobile/src-tauri/plugins/`;
- `apps/mobile/src/client-tools/` for request runtime, consent state, result
  validation bridge, and fixed UI status;
- `apps/mobile/src/health/` for settings/view models and typed charts;
- updates to `mobile-host-connection.ts`, settings surfaces, composer, and tool
  card rendering;
- canonical Tauri/iOS configuration for entitlement and purpose string.

---

## 14. Failure and recovery matrix

| Condition | Host behavior | Mobile/UI behavior | Retry |
|-----------|---------------|--------------------|-------|
| no paired capable device | fail before wire send | show setup action | after setup |
| capable phone offline | fail unavailable | “打开 iPhone 后重试” | manual/new Run |
| disconnect while pending | settle pending, no transparent resend | preserve denied/offline card | manual/new Run |
| app cannot present consent | user-presence-required | prompt to foreground | manual/new Run |
| user denies Piwin consent | permission-denied | denied card | only after new user action |
| HealthKit has no accessible values | no-accessible-data | explain no authorized/data values | after settings/data change |
| one metric query fails | return partial success | list unavailable metric | optional |
| result malformed/oversized | reject and close or error according to codec severity | generic failed state | no automatic retry |
| Run aborted | cancel frame + settled aborted | cancel native query | none |
| deadline | remove pending + cancel frame | timed-out card | new Run only |
| duplicate/late result | ignore, no model resume | no state regression | none |
| device revoked | disconnect + reject new frames | disconnected | re-pair |
| M2 key unavailable | disable cache, never plaintext | needs-attention status | after key recovery |
| M2 sync correction/delete | higher revision/tombstone wins | update freshness/status | automatic eventual |

---

## 15. Observability

Allowed fields:

- operation (`advertise`, `request`, `result`, `cancel`, `sync`);
- capability ID;
- request/batch ID;
- redacted device ID suffix/hash;
- status/reason enum;
- duration and encoded byte count;
- pending queue count;
- Host/client version.

Forbidden fields:

- metric values or component values;
- full date series or HealthKit samples;
- user prompt/question;
- device secret or authorization header;
- HealthKit source/device metadata;
- client-provided arbitrary error text.

Required counters/gauges:

```text
client_tool_request_total{capability,status}
client_tool_pending
client_tool_duration_ms{capability,status}
client_tool_payload_bytes{direction}
health_sync_batch_total{status}
health_cache_records
health_cache_last_sync_age_seconds
```

Operational diagnostics MUST remain useful without including health content.

---

## 16. Tests and acceptance

### 16.1 Contracts and codec

- optional capability fields round-trip without changing protocol version;
- every direct frame validates required fields and direction;
- unknown types, malformed dates, non-finite values, duplicate capability IDs,
  and per-frame oversize fail;
- existing command/push/replay fixtures remain unchanged;
- old hello without client tools remains valid.

### 16.2 Broker and server

- only a paired device may advertise and answer a client tool;
- exact device/connection binding;
- no fan-out to a second connected shell;
- no replay/hydration/journal entry;
- newest same-device connection fencing;
- one result, late result, duplicate result, wrong device, timeout, abort,
  disconnect, shutdown, max pending, and per-device concurrency;
- logs contain no sentinel metric values.

### 16.3 Host tool

- exact schema and canonical date/metric bounds;
- one-call Run budget and terminal cleanup;
- root session exposure only; no subagent/Job/side-chat exposure;
- SDK/RPC parity;
- partial result and every outcome-to-ToolResult mapping;
- deterministic model output contains source/range/timezone/freshness;
- client string fields cannot inject model text;
- `sensitivity: health` excludes cross-session memory paths.

### 16.4 Mobile TypeScript/UI

- capability advertisement only when native support and local setting allow;
- Host support negotiation;
- request/cancel correlation and exactly one result;
- consent mode transitions scoped to Host/session;
- `@Health` stored separately from raw user text;
- every tool-card state and accessible copy;
- no raw JSON/HTML rendering;
- disconnect clears grants and advertisements.

### 16.5 Swift

- query argument validation and cancellation;
- canonical units;
- partial metric failure;
- sleep interval union and overlapping-source warning;
- DST, timezone transition, midnight boundaries, and end-exclusive ranges;
- no-data vs local-policy-denied distinction;
- no write authorization request;
- no raw metadata in encoded result;
- M2 anchor persistence, deleted samples, outbox restart, idempotent retry, and
  observer completion after staging.

### 16.6 Real-device acceptance

M1 is not complete until a physical iPhone proves:

1. Pair once, kill/relaunch app, reconnect without scanning again.
2. Connect Apple Health and select only a subset of categories.
3. Ask for seven-day steps/sleep; consent card -> system authorization if
   needed -> tool card -> same model turn cites actual values and freshness.
4. Ask an unrelated question; the model does not call Health.
5. Explicit `@Health` works without changing the visible user message.
6. Deny Piwin consent and deny/omit a HealthKit category; the model does not
   fabricate or treat missing as zero.
7. Abort generation while reading; native query and Host pending state settle.
8. Disconnect/lock/background the phone; Host times out or reports offline
   without deadlock.
9. Reconnect after the failure; stale client-tool work is not replayed.
10. Inspect logs, replay journal, hydration, and another shell: no direct
    client-tool frame or pre-validation native payload appears. Confirm that
    the resulting assistant answer and bounded health transcript/card do follow
    normal authenticated session synchronization, as disclosed in §11.2.

M2 additionally proves eventual sync after real iOS background delivery, retry
after Host unavailability, correction/deletion recomputation, cache freshness,
retention, revocation, and durable deletion.

---

## 17. Rollout and feature gates

### 17.1 M1 rollout

- Host experimental gate defaults off in production builds until physical-device
  acceptance passes.
- Mobile Health settings appear only on iOS with native HealthKit support and a
  Host advertising `clientToolRequests`.
- Capability is read-only and uses ask-every-time by default.
- Initial metrics may be released in two internal sub-slices, but the public
  schema remains version 1 and unsupported metrics return explicit status.
- There is no background upload or independent Host health store in M1.

### 17.2 M2 rollout

- M2 Host ingestion/storage uses the exact experimental gate
  `PIWIN_EXPERIMENTAL_APPLE_HEALTH_BACKGROUND=1`; it defaults off and is
  independent from the M1 live-read gate;
- separate opt-in and privacy disclosure;
- storage key and encrypted store health must be ready before enabling sync;
- default retention 90 days;
- staged internal -> developer preview -> opt-in beta;
- feature automatically stops and shows needs-attention rather than falling
  back to plaintext or unencrypted transport.

### 17.3 Versioning

- Capability ID versions native request/result semantics:
  `apple-health.read-context.v1`.
- Health result and sync body also carry `schemaVersion: 1`.
- Additive optional metrics require both Host and client support negotiation;
  breaking field meaning requires `v2`.
- Host never interprets an unknown capability ID as a compatible newer Health
  executor.

### 17.4 Rollback

- M1 emergency rollback unsets `PIWIN_EXPERIMENTAL_APPLE_HEALTH` and restarts
  each Host composition root. New generations then omit the health tool and
  client-tool protocol support; pending calls settle through normal
  disconnect/abort handling. Mobile hides execution controls after the next
  capability negotiation.
- M2 emergency rollback unsets
  `PIWIN_EXPERIMENTAL_APPLE_HEALTH_BACKGROUND` and disables the user's mobile
  background-sync preference. The Host rejects new sync/delete ingress before
  body processing, and iOS stops observers/uploads while preserving the
  encrypted outbox until the user deletes it or a compatible release resumes.
- Rollback MUST NOT fall back to plaintext, silently downgrade an encrypted
  snapshot, revoke the user's HealthKit permission, or claim to retract data
  already present in a model-provider context or Piwin chat transcript.
- Disabling either gate is reversible and does not delete data. Cache, outbox,
  chat, and provider-copy deletion remain separate explicit operations with
  their documented retention semantics.

---

## 18. Competitor and implementation references

- [Claude with iOS apps](https://support.claude.com/en/articles/11869619-use-claude-with-ios-apps)
- [ChatGPT Health](https://help.openai.com/en/articles/20001036-what-is-chatgpt-health)
- Local Planora implementation inspected on 2026-08-23 (external research,
  not a Piwin source dependency): CLIENT tool pending/resume, HealthKit
  executor, and result upload patterns summarized in §4.3.
- Piwin Host protocol: `packages/contracts/src/remote-protocol.ts`
- Piwin model-tool composition:
  `packages/host-runtime/src/tools/build-session-host-tools.ts`
- Piwin mobile connection: `apps/mobile/src/mobile-host-connection.ts`
- Piwin Tauri native entry: `apps/mobile/src-tauri/src/lib.rs`

---

## 19. Definition of done

M1 is done only when:

- all mandatory M1 scope and acceptance items pass;
- protocol and package boundaries comply with `AGENTS.md`;
- no source file exceeds repository limits as a result of the change;
- typecheck, relevant package tests, architecture tests, Rust checks, iOS build,
  and physical-device acceptance are recorded;
- privacy copy and deletion semantics match actual persistence;
- the feature cannot write HealthKit data;
- the Host cannot receive a health result from the wrong/revoked device;
- an offline/background phone cannot deadlock a model Run;
- docs/architecture and product privacy documentation are updated in the final
  M1 PR.

M2 has a separate done gate and cannot be represented as complete by M1.
