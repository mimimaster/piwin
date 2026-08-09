# IPC transport discipline (`@piwin/contracts` ipc layer)

> Status: Binding. Applies to `packages/contracts/src/ipc.ts` (`HostCommand`,
> `HostResponse`, `HostPush`, `HostServerMessage`) and every producer/consumer
> of these types (CLI `host serve`, desktop `HostClient`, Tauri bridge, future
> Host Server/client transports).
>
> Related: ADR 0006 (JSONL sidecar), ADR 0015 (async turn transport),
> ADR 0017 (host sidecar bundling), ADR 0036 (Host Server multi-client).

## Why this document exists

The UI ↔ host boundary is piwin's only wire protocol. Today it runs over
stdin/stdout JSONL between the Tauri shell and a local Node process. Tomorrow
the same protocol may run over WebSocket/SSH to a **remote** host. That upgrade
is cheap **only if** the protocol stays a real wire protocol. Every rule below
protects that property. Violations are architectural bugs even if they "work"
locally.

## Rules

### R1. Everything on the wire is plain JSON

`HostCommand`, `HostResponse`, and `HostPush` payloads must be
JSON-serializable values only:

- Allowed: `string`, `number`, `boolean`, `null`, plain objects, arrays.
- Forbidden: functions, class instances, `Map`/`Set`, `Date` (use ISO strings
  or epoch ms), `Buffer`/`Uint8Array` (use base64 with an explicit field name,
  see R4), `undefined` inside arrays, cyclic references, symbols.

Litmus test: `JSON.parse(JSON.stringify(x))` must round-trip losslessly.

### R2. No live handles across the boundary

Never put process handles, sockets, file descriptors, `AbortController`,
event emitters, or Pi SDK session objects into a command/push payload.
Cross-boundary references are **string IDs** minted by the host
(`sessionId`, `runId`, `requestId`, `serverId`, …). The host owns the
lookup table from ID → live object.

### R3. Paths are host-relative facts, not UI assumptions

- Any absolute path inside a payload refers to the **host machine's**
  filesystem, never the UI machine's. Today they are the same machine; the
  protocol must not depend on that.
- The UI must never construct or guess host paths. It only echoes back paths
  the host previously returned (e.g. `project/open` result, `SavedMediaAsset`
  paths).
- Relative paths in commands (`project/list-dir`, `project/read-file`) stay
  posix-style relative to a host-validated root. Keep it that way.
- New commands that need file content must transfer **content** (R4), not
  assume shared disk.

### R4. Binary data crosses as bounded base64, once

Pattern already established by `MediaSaveCommandInput`:

- UI → host: base64 field with explicit name (`base64Data`), host persists to
  `~/.piwin/media/` immediately and returns a `SavedMediaAsset` (path + id).
- After that, only the **reference** travels; never re-send the bytes.
- Enforce a size cap at the host edge; reject oversized payloads with a stable
  error instead of truncating.
- Never place base64 payloads into model prompts (AGENTS.md §1.6).

### R5. Long operations = accept fast, stream events (ADR 0015)

- A command that starts work returns an acceptance record
  (`{ sessionId, runId, acceptedAt }`-style) promptly. Progress and terminal
  state arrive as `HostPush` events keyed by the same `runId`.
- Never design a new command whose response waits for a model turn, tool run,
  or network fetch to finish. Remote transports amplify this mistake.
- Control-lane commands (`session/abort`, `permission/resolve`, …) must remain
  processable while a run is in flight.

### R6. Versionable, additive evolution

- Adding a command/push variant or an optional field: OK.
- Renaming/removing a field, changing a type, changing semantics: requires
  updating **all** implementers in the same change (host serve dispatcher,
  desktop `HostClient`, mock transport) plus `ipc.test.ts` shape tests.
- Prefer new command names over overloading old ones with mode flags.
- `host/status` is the capability handshake surface. If a client may face a
  host of a different build (future remote case), gate new features on
  status/capability fields, not on "it's the same repo".

### R7. Errors are data

- Failures cross the wire as `success: false` + stable, human-readable
  `error` string. Add machine-readable `code` fields for cases the UI must
  branch on (e.g. `run-active`).
- Never serialize raw stack traces, Pi-internal error objects, or secrets into
  the wire error. Map at the host edge.

### R8. No Pi shapes on the wire

The host translates Pi SDK/RPC payloads into the normalized `AgentEvent`
union **before** they reach `HostPush`. UI never parses Pi-native event
shapes. If Pi adds a new event kind, extend `AgentEvent` in contracts first,
then map in `agent-host`.

### R9. Secrets never transit the wire

API keys and credentials live in host-side config (`~/.piwin`,
env/keychain refs). Commands may reference a secret by name; the host
resolves it (`secret-resolver`). Pushes and responses must never echo
resolved secret values, including inside error messages.

### R10. Known sanctioned exceptions

| Exception | Scope | Why |
|-----------|-------|-----|
| PTY byte streams (ADR 0013) | Tauri commands/events, not JSONL | Raw terminal I/O is a desktop capability, deliberately outside the host protocol. A remote host does **not** get PTY via this path; remote PTY would need its own design. |
| `host-log` event | Tauri bridge only | Operational logging of the sidecar itself, not protocol data. |

Do not add new exceptions without an ADR.

## Review checklist for any `ipc.ts` change

- [ ] Payload round-trips through `JSON.parse(JSON.stringify(...))`.
- [ ] No new absolute-path assumption shared between UI and host.
- [ ] Long work returns acceptance + streams events; no blocking response.
- [ ] All three implementers updated (dispatcher, HostClient, mock) + tests.
- [ ] Errors mapped, no Pi internals or secrets in payloads.
- [ ] `pnpm typecheck` and contracts/CLI tests green.
