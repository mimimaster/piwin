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
5. Residual: keep **D-M2-01b** / **D-M2-02-full** as “do not resume Pi JSONL”.
   In-session branching is a product-store tree (ADR 0055), not a Pi JSONL
   multi-leaf projection.

## Consequences

- Resume after process kill shows prior messages + images (product layer).
- Live tool/MCP process state is recreated on next live session, not restored
  from Pi JSONL.
- No half-broken “looks resumed but wrong model state”.
- `session/truncate-from` is the explicit subtree delete (“delete this and
  after”). It still drops the adapter's cached Product Shell / live Pi handle
  (`AgentHost.dropSession`) and rebuilds a fresh shell from the remaining
  active path. Daily edit/resend no longer truncates — it branches via
  `PromptInput.branchFromMessageId` (ADR 0055).

## 2026-08-04 extension: product-level Session Fork

Product-level conversation branching is allowed without superseding this ADR:

1. **Duplicate** creates an independent copy of the complete product
   transcript.
2. **Fork from here** creates a separate product session containing the
   transcript prefix through one completed assistant response and records
   explicit product lineage.
3. Each derived session remains linear internally and receives a fresh live Pi
   session lazily on its next prompt.
4. Product lineage must not reuse `SessionTreeView`, `SessionOutlineNode[]`, or
   subagent `parentSessionId`; those domains retain their existing meanings.
5. A future Pi JSONL tree spike may optimize the Host implementation, but it
   must preserve the product command and lineage semantics.

The executable design is
[`docs/specs/session-fork-product-adaptation.md`](../specs/session-fork-product-adaptation.md).
