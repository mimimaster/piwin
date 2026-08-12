# Mobile, Deployment, and Knowledge Sequencing Recommendation

Status: discussion recommendation  
Date: 2026-08-12  
Related: ADR 0036, ADR 0037, Host Server multi-client spec, ADR 0018

## 1. Decision summary

piwin should continue with a **Host-first, thin-client, Tauri-first** strategy:

1. Keep Node, Pi, provider secrets, MCP, project files, processes, and session
   authority in one deployable Host.
2. Treat Desktop, CLI, iOS, Android, and Web as clients of the same Host
   protocol.
3. Use Tauri 2 for the first iOS and Android shells. Build a mobile-specific
   interaction model instead of copying Desktop UI.
4. Do not embed Node or Pi in iOS/Android. Native mobile code is limited to
   client capabilities such as secure credentials, notifications, photos,
   camera, sharing, and lifecycle integration.
5. Do not rewrite the iOS client in SwiftUI before real-device evidence shows
   that Tauri cannot meet an accepted experience gate.
6. Do not wait for an abstract "perfect Agent" before opening the next area.
   Close a short, explicit Agent release gate first, then deliver bounded
   vertical slices.

The recommended mainline is:

```text
truthful green baseline
  -> remote Host identity/security/recovery foundation
  -> production-quality iOS Tauri slice
  -> Android validation and Web shell
```

The existing local Knowledge Center can be completed as a bounded side slice
after the baseline is green. Remote knowledge access follows the Host security
and logical-resource contracts rather than bypassing them.

## 2. Mobile technology decision

### 2.1 What one Tauri codebase can solve

Tauri 2 is a good fit for the first iOS and Android clients because piwin mobile
is a chat, activity, approval, session, and knowledge shell rather than a local
IDE or local Agent runtime. The portable TypeScript layer can own:

- HostClient and reconnect state;
- session, message, Run, permission, and notification projections;
- Markdown, tool, plan, artifact, and knowledge presentation;
- most navigation, forms, settings, and responsive layout;
- protocol fixtures and cross-platform conformance tests.

Small platform adapters can own:

- iOS Keychain and Android Keystore;
- APNs/FCM and local notifications;
- photo, camera, document, and share pickers;
- app lifecycle, deep links, and pairing QR scans;
- biometric app unlock when desired.

This is still "one product codebase" even though small Swift/Kotlin/Rust
plugins exist at the OS edge.

### 2.2 What Tauri does not automatically solve

Tauri does not make a Desktop layout feel native on mobile. Product quality
still requires a mobile information architecture, touch targets, safe areas,
keyboard behavior, foreground recovery, upload progress, and bounded rendering
for large transcripts and diffs.

iOS also cannot assume that a WebSocket remains alive in the background.
Foreground resynchronization is required; background completion alerts should
eventually use push notifications rather than pretending the socket is
permanent.

### 2.3 Native iOS decision gate

Native SwiftUI should be a later client implementation, not a conversion of the
Host or product architecture. Reconsider it only after an iPhone acceptance run
shows a material, persistent problem in one of these areas:

- transcript and diff rendering performance;
- keyboard/composer behavior;
- gestures, navigation, accessibility, or system integration;
- background notifications and lifecycle reliability;
- App Store constraints that cannot be solved with focused Tauri plugins.

Before a native client starts, make the wire protocol code-generatable or at
least schema-driven so Swift does not hand-copy a large TypeScript union and
recovery state machine.

## 3. Supported deployment shapes

### 3.1 Local all-in-one Desktop product

The distributable Mac/Windows/Linux app packages the Tauri shell, a Node
runtime, and Host resources together. They remain separate runtime
responsibilities: Tauri supervises a local Node Host sidecar, and the user
experiences one application.

This is the default zero-setup mode.

### 3.2 Standalone private Host

The Node Host runs on a Mac, Windows/Linux machine, NAS, or server. Desktop,
CLI, mobile, and Web clients connect to it through the public HostClient
protocol.

Tailscale/Headscale or WireGuard is the recommended first remote deployment.
A strong application credential is still required; the VPN is not a substitute
for Host authentication.

### 3.3 Hybrid Host

The Host machine may have a local Desktop/CLI shell while mobile or another
Desktop connects remotely. All clients observe one Host authority, not copied
session databases or independent Agent loops.

### 3.4 Web shell plus remote Host

A browser shell is supported, but **Node and Pi do not run in the browser**.
The Web app is a static client that connects to a remote Host over WSS.

For convenient deployment, one server package or container may ship both:

- the Node Host process and WebSocket/API endpoints; and
- the compiled static Web assets.

That is one deployment artifact, not one browser runtime. The package boundary
remains `Web client -> Host Server -> HostRuntime`.

Running the full Pi/Node Host through WebContainers or WASM is rejected for the
primary product path because project filesystem access, process execution,
native dependencies, MCP, provider secrets, and durable Host authority do not
map truthfully to a normal browser sandbox.

### 3.5 Optional Gateway

A relay may be added after direct private connectivity is production-ready. It
may provide NAT traversal, TLS termination, and bounded transport buffering,
but it must remain transport-only and must never own Pi, provider credentials,
sessions, tools, notes, or flashcards.

### 3.6 Public Internet exposure

The current private WebSocket/token slice is suitable for controlled private
testing, not direct public exposure. A public endpoint needs, at minimum:

- TLS/WSS or a documented TLS reverse proxy;
- short-lived pairing and revocable per-device credentials;
- Host-side principals and per-device capability ceilings;
- origin checks, rate limits, safe logs, and authentication throttling;
- logical project/asset references with no Host absolute path leakage;
- durable idempotency and complete reconnect hydration.

## 4. Current repository reality

### 4.1 Mobile and Host Server

The repository already contains more than a placeholder:

- a standalone Host Server entry point;
- public host-client and host-transport packages;
- WebSocket reconnect, heartbeat, sequencing, replay, and bounded egress;
- a Tauri mobile scaffold for iOS/Android;
- a real mobile status/session/chat/permission/small-image slice.

The important remaining work is productionization: pairing/revocation, secure
credential storage, TLS deployment, logical project access, complete hydration,
durable media upload/download, Desktop/CLI client convergence, and real-device
acceptance.

### 4.2 Knowledge and flashcards

The Knowledge Center is also not unimplemented. The repository contains:

- local Markdown notes and CJK-aware FTS;
- optional embeddings, hybrid retrieval, reranking, and recall evaluation;
- FSRS flashcards, queues, deduplication, Agent tools, review UI, and Anki
  export;
- folder-scoped document RAG and Doc Cards;
- Desktop and CLI surfaces.

The remaining work is product completion and contract cleanup rather than a
greenfield feature build. Important gaps include canonical PRD/status truth,
source-hash staleness, typed Knowledge Center command ownership, embedding
settings UX, Desktop golden-result pinning, a native folder picker, and a safe
remote command/resource design.

## 5. Sequencing recommendation

Avoid both extremes:

- Do not polish the Agent forever before touching another product surface.
- Do not open iOS, Android, Web, public remote access, and a Knowledge rewrite
  at the same time.

Use stage gates and keep only one architectural mainline active.

### Gate 0: truthful, green baseline

Close before widening the product:

- repository typecheck, tests, architecture tests, and Desktop build are green;
- SDK and RPC-worker prompt/tool/permission/cancel behavior is equivalent;
- stuck cancellation terminates once and rejects late generation work;
- packaged Desktop Host receives a clean-machine smoke test;
- canonical status documents match the actual implementation;
- a bounded native soak covers large transcripts and runtime residency.

This is a short stabilization sprint, not an indefinite perfection phase.

### Gate 1: remote Host foundation

Make the remote boundary safe and reusable before adding more client pages:

- persistent HostTarget selection;
- one-time pairing, device credentials, revocation, and secure storage;
- Host principals and capability ceilings;
- TLS/WSS or a supported Tailscale Serve/reverse-proxy profile;
- opaque project IDs and authorized project-scoped sessions;
- scoped durable idempotency and complete hydration;
- durable upload/download assets;
- real two-client prompt, permission, disconnect, replay, and transcript smoke.

### Gate 2: iOS Tauri product slice

Ship one coherent iOS experience:

- pair with a Host and store credentials securely;
- Inbox/activity, sessions, conversation, Runs, permissions, and settings;
- foreground resync and honest offline/reconnecting states;
- photo/file upload with progress and historical image retrieval;
- mobile-specific Markdown/diff/plan/artifact bounds;
- real iPhone acceptance, signing, and distribution evidence.

Keep Android compiling, but do not split product design effort until this gate
passes.

### Bounded side slice: local Knowledge completion

After Gate 0, close the existing local Knowledge gaps without coupling them to
mobile work:

- update the PRD and roadmap to describe the shipped knowledge layer;
- remove unsafe command-union casts and align contracts;
- finish card source-hash/staleness behavior;
- complete embedding/rerank Settings and retrieval test UX;
- add Desktop golden-result pinning and a native Doc Cards folder picker;
- verify offline FTS, index rebuild, FSRS restart, export, and SDK/RPC Agent
  generation parity.

For a single developer, implement this as one or two bounded slices between
Host milestones, not as a second open-ended mainline.

### Gate 3: Android and Web

After the iOS and Host protocol gates:

- validate the same Tauri mobile product on a real Android device;
- create a static Web shell using the same HostClient and recovery fixtures;
- require WSS, strict origins, safe credential handling, and no direct
  filesystem assumptions;
- expose remote Knowledge read/review first, then explicit write capabilities;
- design remote Doc Cards around Host-approved folder handles or uploaded
  documents, never client-supplied Host absolute paths.

### Gate 4: native iOS and Gateway reassessment

Only now decide whether SwiftUI or an optional public relay earns its cost.
Both decisions should be based on measured product constraints, not fear that
Tauri might eventually be insufficient.

## 6. Priority answer

The next move should be:

1. **Short Agent/baseline closure first.**
2. **Remote Host security and recovery as the next main architecture slice.**
3. **Finish the iOS Tauri client on that foundation.**
4. **Complete the already-existing local Knowledge product in bounded slices.**
5. **Add Android and Web after the shared protocol is stable.**
6. **Defer native iOS rewrite and Gateway until evidence justifies them.**

This sequence gets new user-visible capability early without allowing several
clients and feature domains to multiply unfinished Agent, transport, security,
and recovery behavior.
