# Causal agent event stream

Status: Implemented

## Problem

The Desktop transcript currently projects every Assistant lifecycle message in a
Run into one synthetic “process” card. That projection moves earlier tool calls
under the newest reasoning text, so the screen can show a result before the
reasoning that caused it has finished rendering. Opening the card also creates a
second, independently scrolling transcript.

## Decision

Render the normalized `AgentEvent` transcript as an append-only sequence. One
Assistant lifecycle message remains one visible response segment:

1. reasoning for that response;
2. response text emitted before its tool request;
3. that response's tool-call container(s), updated in place as their output
   streams;
4. tool-derived media, diffs, citations, or summaries owned by that response;
5. the next Assistant response.

Multiple tool calls are shown together only when they already belong to the same
Assistant response. Messages from separate model responses are never merged,
reparented, or reordered by `runId`.

A rich block may create its shell as soon as its own event/text begins and then
stream content inside that shell. This is still causal because later transcript
events cannot appear above or inside it.

## Scope boundary

This is presentation-only. Do not change system prompts, tool descriptions,
model instructions, or tool-selection behavior. Product examples used to
explain the invariant are not prompt material and are not special-cased.

## Implementation

- Remove the Run-level transcript projection and hidden “owner” rows.
- Keep stable React identity on the real message id.
- Render thinking, text, and tools within each message in causal order.
- Replace the nested process/Run Inspector with direct tool cards.
- Keep disclosure state local to each tool card while its output updates.
- Show run-level permission/waiting state only on the newest Assistant segment.

## Verification

- A two-response fixture must render response 1 reasoning/text/tool before
  response 2 reasoning/text/tool.
- Adding response 2 must not move or remount response 1's tool container.
- Tool-only lifecycle messages must remain visible.
- No process summary or Run Inspector may mount in the main transcript.
- Existing tool expansion and streaming-update tests must remain green.
