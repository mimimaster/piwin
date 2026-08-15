# Run interventions implementation plan

| Field | Value |
|-------|-------|
| Date | 2026-08-15 |
| Status | Stages 1–4 implemented; Stage 5 cleanup is the next slice |
| Decision | [ADR 0051](../adr/0051-host-owned-run-interventions.md) |
| Product spec | [Run interventions](../specs/run-interventions.md) |

## Outcome

Replace the ambiguous product-facing `steer` action with three explicit Host
workflows:

1. adjust the exact active Run at a safe checkpoint;
2. queue a normal next turn without changing the active Run;
3. stop the exact active Run and replace it with a new normal turn.

This implementation ships those as separate vertical slices. Stages 1–4 are
complete; Stage 5 is reserved for removing compatibility surfaces after all
capability-aware clients migrate.

## Completed: exact-Run adjustment

- Contracts define the instruction payload, lifecycle, limits, commands,
  backend events, capability, transcript projection, and Host push.
- The session SQLite store atomically writes the intervention and provisional
  user row, assigns per-Run order, enforces revisions/idempotency, reconciles
  restart state, and excludes unapplied rows from model history.
- HostRuntime validates exact foreground Run/generation ownership, persists
  before backend arming, owns lifecycle transitions, records model visibility,
  and closes open interventions before Run terminal publication.
- `agent-host` stages one instruction per safe checkpoint, requires a durable
  Host claim before injection, bypasses Skill/template expansion, and reports
  applied/expired/uncertain outcomes. It also covers the Host-accepted/backend-
  preparing window and retires a staged slot if that exact Run never starts.
- SDK and RPC-worker modes share the same semantics. RPC uses an explicit
  claim/permit handshake with stale-generation checks and a bounded failure
  timeout.
- Host transport treats lifecycle updates as exact-Run projections and flushes
  the latest revision before the Run terminal barrier. Remote validation and
  capability reporting include the new commands.
- Desktop uses Cmd/Ctrl+Enter for adjustment, reconciles the Host projection,
  shows truthful pending/applying/applied/expired/failed/uncertain labels, and
  permits revision-checked edit or cancel while pending. ACK timeout recovery
  retries once with the same stable identities; Host and backend re-arming are
  idempotent for that exact revision.
- The old `session/steer` route remains only for compatibility.

## Explicit current limits

- Adjustment input is literal text. Attachments, context references, slash
  commands, model switches, and thinking changes are rejected rather than
  partially supported.
- `applied` means the instruction entered the model-facing context; it does not
  mean the model obeyed it or the Run succeeded.
- A crash after the Host grants an application claim is reported as
  `uncertain`; the instruction is never replayed automatically.
- Pending instruction reorder and combine policies are not implemented.

## Completed: Host-owned queued turns and Replace Run

- Contracts define queued-turn status, bounds, idempotency, sequence, revision,
  queue commands, Replace Run, capabilities, and transcript projection.
- SQLite persistence owns create/list/edit/cancel/reorder, restart recovery,
  aggregate limits, and one user transcript row per queued turn.
- HostRuntime drains one queued turn only after the exact foreground Run is
  terminal and admits it through the normal prompt path without superseding a
  different Run. Replace Run persists first, cancels the exact Run, then waits
  for terminal confirmation before admission.
- Host transport and remote projection preserve queue revisions, opaque media
  references, and the terminal-to-next-Run ordering barrier.
- Desktop Enter uses the Host queue; it supports edit, cancel, reorder/send-now,
  hydration, optimistic rollback, and stale queue-revision recovery.
- CLI exposes queue list/submit/edit/cancel/reorder and Replace Run helpers.

## Next: Stage 5 compatibility cleanup

1. Keep legacy `session/steer`, `session/follow_up`, and direct
   `session/prompt` available until all clients negotiate the new capabilities.
2. Add a clearly surfaced Desktop “Stop and send this instead” action backed by
   `session/replace-run`; the Host/CLI workflow already exists.
3. Retire the transitional `SteerQueue` naming and compatibility paths after
   multi-client migration and native live-provider verification.

## Verification gates

- `pnpm typecheck`
- Tests for session persistence/history filtering, Host admission/edit/cancel,
  safe-checkpoint staging, RPC claim/permit, remote egress ordering, Desktop
  reconciliation, and pending controls
- Manual SDK and RPC smoke tests covering apply, Run-end expiry, edit race,
  cancel race, client reconnect, and worker failure
