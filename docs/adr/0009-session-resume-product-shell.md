# ADR 0009: Session resume stays on product shell (Pi JSONL deferred)

## Status

Accepted (2026-07-20)

## Context

P6 main-path completion asked for a time-boxed spike on whether Pi 0.80.10
SessionManager / session file paths can restore live model state (tools, branch
tree) on `session/resume`.

Today piwin already restores **product transcript** under
`~/.piwin/sessions/<id>/transcript.json` and binds a product shell that creates
a live Pi session on first prompt after process restart. Attachments hydrate
from the same transcript.

## Decision

**Option A — product shell only (status quo for main path).**

1. Linear product transcript is the source of truth for chat UI history.
2. Session list metadata (`lastPreview`, `messageCount`, `updatedAt`) comes from
   the product session index.
3. `SessionOutlineNode[]` is derived from the transcript for jump-scroll UI —
   **not** a multi-leaf Pi branch graph.
4. Do **not** wire `piSessionFile` into create/resume until a later spike proves
   stable dual-mode semantics (SDK + RPC) without silent wrong model state.
5. Residual: keep **D-M2-01b** / **D-M2-02-full** for true Pi JSONL multi-leaf tree.

## Consequences

- Resume after process kill shows prior messages + images (product layer).
- Live tool/MCP process state is recreated on next live session, not restored
  from Pi JSONL.
- No half-broken “looks resumed but wrong model state”.
