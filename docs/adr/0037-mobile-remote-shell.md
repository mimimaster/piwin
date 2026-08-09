# ADR 0037: Tauri mobile shell as a Host client

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-08-08 |
| Related | [Mobile shell execution plan](../plans/ios-mobile-shell-execution-plan.md), ADR 0013, ADR 0015, ADR 0036 |

## Context

Piwin needs an iOS shell that can observe and control the same Host sessions as
Desktop and CLI. The mobile device has a constrained lifecycle and must not
become a second execution authority. The existing Desktop shell also contains
desktop-only concerns such as a Node sidecar, local PTY, pet overlay, and
desktop window integrations.

Copying the Desktop application into a mobile target would duplicate state,
transport, and product policy. Embedding Node or Pi in the mobile bundle would
break the Host boundary and make secrets, MCP, Skill, project files, and
process execution mobile-owned.

## Decision

### 1. Mobile is a thin Tauri 2 client

Create apps/mobile as a Tauri 2 Mobile shell using the existing React,
TypeScript, Vite, contracts, and ui-kit stack. iOS is the first target;
Android uses the same TypeScript and Host protocol.

The mobile shell may use local OS capabilities such as camera, secure
credential storage, notifications, and file/photo pickers. It must not import
Pi packages, start the Node Host sidecar, execute MCP/Skill code, or access
Host filesystem paths directly.

### 2. Host remains the only execution authority

The topology is:

    apps/mobile → @piwin/host-client → @piwin/host-transport
        → Host Server → @piwin/host-runtime → @piwin/agent-host → Pi

The initial scaffold may render a disconnected state, but it must not fake a
successful connection. Pairing, device authentication, commands, pushes,
replay, and snapshot hydration will be implemented through the shared Host
protocol.

### 3. Do not copy Desktop UI

Desktop and Mobile share public packages and portable state/rendering logic.
Mobile has its own small layout for Inbox, Sessions, Conversation, Pairing, and
Settings. No deep imports from apps/desktop/src are allowed.

Desktop-only native modules remain Desktop-only:

- Node sidecar and local JSONL bridge.
- Local PTY.
- Pet overlay and desktop window behavior.
- Desktop external-binary/resource bundling.

### 4. Private remote transport first

The first supported deployment is a private Host endpoint over Tailscale,
WireGuard, private LAN, or SSH forwarding. WebSocket carries typed command and
push envelopes. Binary media uses a Host-issued HTTP upload ticket and opaque
asset IDs. A public Gateway, custom E2EE, APNs background delivery, and remote
PTY are separate future decisions.

### 5. Documentation and package boundaries

The implementation must introduce the planned @piwin/host-client,
@piwin/host-transport, and @piwin/host-server surfaces before the Mobile
shell starts making real Host calls. Cross-boundary types enter
@piwin/contracts; mobile never imports @earendil-works/pi-*.

## Consequences

Positive:

- iOS and Android share one client protocol and most application code.
- Desktop remains stable while its HostClient is extracted.
- Host secrets, projects, MCP, Skill, Pi, and process authority stay on Host.
- The mobile app is small enough to test against a fake Host before native
  capabilities are integrated.

Costs:

- Host Server, authentication, replay, and snapshot work precede the first real
  mobile conversation.
- A separate mobile layout needs some new UI code.
- iOS/Android native capability and signing checks are required.
- Background WebSocket continuity cannot be assumed; notification delivery is
  a later phase.

## Rejected alternatives

- WeChat Mini Program as the first shell — rejected for this private Host-first
  slice because it introduces a separate client/runtime and private network,
  secure credential, lifecycle, and native capability constraints before the
  shared Host protocol exists.
- Bundle Node/Pi in iOS — rejected because it violates Host authority,
  increases package size and native complexity, and moves secrets/execution to
  the client.
- Copy apps/desktop into apps/mobile — rejected because it duplicates
  transport/state and carries PTY, sidecar, and desktop-only assumptions.
- Remote PTY in P0 — rejected under ADR 0013; it needs a separate security,
  flow-control, and lifecycle design.
