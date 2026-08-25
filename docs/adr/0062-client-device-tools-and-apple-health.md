# ADR 0062: Client device tools and Apple Health

| Field | Value |
|-------|-------|
| Status | **Proposed — review complete, awaiting implementation acceptance** |
| Date | 2026-08-23 |
| Scope | `@piwin/contracts`, `@piwin/host-client`, `@piwin/host-transport`, `@piwin/host-server`, `@piwin/host-runtime`, `apps/host`, `apps/cli`, `apps/mobile` |
| Related | ADR 0036, ADR 0037, ADR 0038, ADR 0050, [normative spec](../specs/ios-apple-health-client-capability.md), [execution plan](../plans/2026-08-23-ios-apple-health-client-capability-execution-plan.md) |

## Context

Piwin Mobile is currently a Tauri 2 shell connected to one authoritative Host.
It already owns legitimate device-local capabilities such as QR scanning,
Keychain credential storage, microphone input, and notifications, but model
tool execution remains Host-owned.

Apple Health data is available only through HealthKit on the user's iPhone.
Copying HealthKit data into the Host manually would produce poor UX, while
moving the Agent runtime onto the phone would violate the Host authority
boundary. iOS also suspends background applications, so an always-on mobile
WebSocket cannot be treated as a durable data pipeline.

The product needs both of these experiences:

1. A foreground question can pause while the paired iPhone reads the minimum
   requested HealthKit summary and then resume the same model turn.
2. A later optional mode can keep bounded daily summaries on the Host so a
   health question still works while the phone is offline.

## Decision

### 1. Mobile becomes a trusted device-capability executor, not an Agent Host

HostRuntime remains the only session, Run, model, permission, and model-tool
authority. A client may execute an allowlisted local capability only after the
Host sends a correlated request. Client-advertised capability IDs never carry
model-visible descriptions or schemas.

The generic execution path is:

```text
model tool
  -> SessionHostToolExecutionPort
  -> ClientToolExecutionPort
  -> DeviceToolBroker
  -> authenticated, targeted client connection
  -> native device executor
  -> DeviceToolBroker
  -> ToolResult
  -> same model turn
```

`ClientToolExecutionPort` is a contract owned by `@piwin/contracts`.
`DeviceToolBroker` is implemented by `@piwin/host-server`. Composition roots
create one broker before HostRuntime and inject the same instance into both
HostRuntime and HostServer. This preserves package direction; HostRuntime does
not import HostServer.

### 2. Foreground client-tool traffic uses direct WebSocket frames

The wire protocol gains negotiated, authenticated `client-tool/request`,
`client-tool/result`, and `client-tool/cancel` frames. These frames are
point-to-point control traffic. They are excluded from HostPush sequencing,
fan-out, replay journals, hydration, and snapshots.

Each request is bound to one authenticated `deviceId`, connection epoch,
`sessionId`, `runId`, and `toolCallId`. Disconnect, Run cancellation, deadline,
duplicate result, wrong connection, and malformed payload all fail closed.

### 3. Apple Health uses a two-lane data design

The first shippable lane is foreground and on demand. The Host model tool
`health_read_context` requests only bounded aggregate data. The iOS native
plugin reads HealthKit, aggregates on device, and returns the result over the
existing WebSocket. M1 creates no independent Host health cache.

The optional second lane is eventual background summary sync. A native Swift
component owns HealthKit observer queries, anchored incremental queries,
aggregate recomputation, and an encrypted local outbox. It uploads a bounded
batch using a short authenticated HTTP request when iOS grants execution time.
It does not depend on React, the WebView, or a permanent WebSocket.

### 4. Consent and connectivity are separate

The product treats these as independent state:

- Host pairing: one-time QR enrollment; a revocable device credential remains
  in iOS Keychain and is reused on reconnect.
- HealthKit authorization: category-scoped, read-only Apple system consent.
- Piwin use consent: ask for each use, allow for the current session, always
  allow this Host, or off.
- Background storage consent: a separate opt-in; it never follows implicitly
  from foreground use consent.

The user need not pair or authorize repeatedly, but network access still occurs
on demand. Background freshness is eventual and must always be displayed.

### 5. Health data is minimized and its persistence is described truthfully

Only normalized summaries leave the phone. M1 excludes raw per-second samples,
HealthKit object identifiers, source-device metadata, routes, and clinical
records. Apple Health is read-only.

Health aggregates supplied to a model become part of that Piwin session's
model context and may be persisted with its tool transcript. M1 therefore does
not claim that model-visible health data is ephemeral. It is excluded from
cross-session memory, notes/RAG ingestion, analytics, and logs. Deleting an
optional background cache does not delete an existing chat; the UI must explain
the two deletion scopes.

### 6. Apple Health stays a dedicated capability

`health_read_context` belongs to a new `device-health` tool family. Microphone
ambient-noise measurement is not part of the HealthKit tool; it may become a
separate device capability under its own permission and disclosure later.

## Consequences

### Positive

- Piwin Mobile gains useful native functionality without creating a second
  Agent loop or moving provider secrets and project authority to iOS.
- Foreground HealthKit access can ship before any health database or background
  networking exists.
- The generic client-tool seam can later support camera capture, location,
  notifications, and other explicitly designed device capabilities.
- Direct frames avoid leaking health requests to other connected shells and
  avoid replaying stale sensor work after reconnect.
- Native ownership makes the background design compatible with iOS lifecycle
  constraints.

### Costs and risks

- Host composition roots must share a broker with HostRuntime and HostServer.
- HostClient and HostTransport gain a second client-to-Host message path beyond
  commands and replay.
- HealthKit correctness needs real-device testing, interval deduplication,
  timezone handling, partial-result semantics, and explicit freshness.
- Model-visible summaries may remain in session storage until that session is
  deleted; stronger ephemeral-session semantics require a separate backend
  persistence design.
- True background sync adds a narrow HTTP ingress, encrypted aggregate store,
  retention, and deletion lifecycle and is deliberately not part of M1.

## Rejected alternatives

- **Keep a WebSocket alive indefinitely in iOS background** — rejected because
  iOS may suspend the process and does not promise durable socket continuity.
- **Run Pi/Node/model tools in the iOS bundle** — rejected because it violates
  ADR 0037 and duplicates Host authority, secrets, and session state.
- **Send HealthKit data as ordinary HostPush events** — rejected because push
  fan-out, replay, and hydration are the wrong privacy and lifecycle semantics
  for one targeted device request.
- **Implement HealthKit inside React/WebView** — rejected because HealthKit and
  background delivery require native lifecycle ownership.
- **Upload raw HealthKit samples and aggregate on Host** — rejected for data
  minimization, payload size, retention, and correctness risk.
- **Copy the local Planora SSE plus HTTP-result implementation unchanged** —
  rejected because Piwin already has an authenticated bidirectional WebSocket
  for foreground work. Its pending/resume pattern is retained; its microphone
  and HealthKit concerns are split.
- **Request HealthKit authorization on every model tool call** — rejected in
  favor of an explicit connect/first-use flow and category-scoped system state.

## Follow-up decisions

- M1 is authorized only after the normative spec is accepted.
- M2 background sync must not begin until M1 real-device acceptance passes and
  the Host storage key/transport profile is configured successfully.
- HealthKit writes, clinical records, diagnosis, public multi-user hosting, and
  custom end-to-end encryption remain separate decisions.
