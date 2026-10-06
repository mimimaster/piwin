# Negotiated historical replay for installed agent backends

Related: [ADR 0082](../adr/0082-grok-build-acp-backend.md), [failure evidence](../evidence/2026-10-05-grok-replay-frame-overflow.md).

Status: Host/contracts implemented and fixture-verified (9 protocol and 67 focused Host tests, both package typechecks, and root typecheck passed). Independent adapter implementation and real-history acceptance are still pending. This is not an installed-plugin upgrade or a release.

## Invariants

- `piwin-agent-stdio` remains protocol version 1, with a **2,097,152-byte** UTF-8 limit per complete JSON frame. No global limit increase.
- All vendor decoding stays in the independent adapter. Host consumes only normalized contracts.
- Replay is a provisional display projection, not a live Run stream. A failed or interrupted open must not publish partial historical events or replace the existing product history.
- Native history, media identities and event order are preserved; history is not silently truncated to fit a response.

## Additive negotiation

A replay-capable Host session bridge includes this optional initialization field:

```json
{ "hostCapabilities": { "replayStreaming": true } }
```

Control-only bridges do not advertise it. An older adapter may ignore the field and keep returning its existing `replayEvents` array. A new adapter must not send streamed history to a Host that did not opt in.

For a negotiated `session/load`, the adapter emits ordinary `type: "agent"` emissions while the request is pending. Each emission uses that request's exact session/generation scope, including the same normalized event and optional relative media proposals used by the legacy replay array. Stdout frame order is historical order. Each entire serialized envelope, not just its event payload, must fit the existing byte limit. A single oversized event must fail explicitly instead of losing content.

After **all** historical emissions have been sent, the adapter returns its normal small open-session result, with:

```json
{ "replayEvents": [], "streamedReplayEventCount": 1826 }
```

`streamedReplayEventCount` is a nonnegative safe integer and includes every streamed agent emission, not title/options/MCP notifications. Zero is a valid complete empty history. It is legal only for `session/load`. Inline and streamed replay cannot be mixed. The completion response ends the replay; no historical emission may follow it.

## Host reception

`AgentPluginSession.open` advertises the capability and collects scoped historical emissions only while a `session/load` is pending. It does not dispatch those events to a live Run, import their media prematurely, or apply transcript projection during collection.

On completion, `AgentPluginReplayCollector` validates the count, checks that no transport-closed emission was observed, and assembles `opened.replayEvents` for the existing external backend path. Media import and subsequent product projection therefore retain their existing ordering and ownership. Missing metadata, invalid counts, dropped foreign-scope events, incomplete streams and mixed representations fail rather than return partial history. A legacy response with no streamed events remains unchanged.

Bridge responses must also match the waiting request's method and complete scope, not merely its request id. This prevents a foreign generation from committing a provisional replay.

## Owned-process cleanup

Protocol closure rejects in-flight operations with their original method and error reason. Cleanup is idempotent and does not return early merely because the bridge is already closed. On a healthy connection, the dispose acknowledgement has a one-second grace; then stdin EOF lets the adapter release its own vendor transports. If its process does not exit, one-second grace periods precede SIGTERM and SIGKILL escalation. Only that bridge's own child is targeted; unrelated adapters/native Grok processes are never enumerated or killed.

An uncooperative adapter remains responsible for its own vendor subprocesses. The Host does not introduce vendor-specific process discovery to work around adapter lifecycle behavior.

## Acceptance boundaries

Host fixtures cover 1,826 ordered events with aggregate replay above 2 MiB, legacy arrays, media proposals, empty replay, invalid/missing counts, foreign sessions/generations/responses, interruption and owned-process cleanup including an uncooperative adapter. They do not prove the deployed Grok adapter has adopted the capability.

Producer implementation must land in its independent source repository and ship a new digest-verified immutable artifact. Installation/binding migration and an isolated paid prompt smoke require their separate approved gates. Merely merging Host support does not repair an existing immutable adapter that still sends one oversized response.
