# ADR 0035: Session compact-summary Markdown export

## Status

Accepted (2026-08-06)

## Context

The Desktop already exposes Pi compaction through `/compact` and supports a
full product-transcript export. Users also need a portable, smaller snapshot
of a long coding session for review or handoff. Exporting the unchanged
product transcript after compaction would not reduce the file and would make
the feature name misleading.

## Decision

1. Add a Session settings action, **Generate and export Markdown summary**.
2. Add the Host command `session/compact-export` with the same optional custom
   compaction instructions and output-path semantics as session export.
3. Build an ephemeral snapshot from the product transcript. Reuse
   `cloneTranscriptForDuplicate()` from the duplicate implementation to clone
   message identity and history, but do not call the user-visible duplicate
   command because it persists an index record.
4. Pass the cloned history to `agent-host` as seed messages. SDK and RPC create
   a Pi `SessionManager.inMemory()` and invoke the same `SessionHandle.compact()`
   path on that temporary session. Drop the temporary session in a `finally`
   path after the summary is obtained.
5. Render only `result.summary` as Markdown and write it through the Host.
6. Ask for a save location in Desktop. If no picker is available, the Host
   writes under `~/.piwin/sessions/<sessionId>/exports/`.
7. Do not rewrite the product transcript, native Pi JSONL, or session index;
   do not introduce a second summarizer.
   The existing `session/export` command remains the full transcript export.

## Consequences

- Compact export is genuinely smaller and is useful as a handoff artifact.
- The original live Pi context is not changed, so a file-write failure does not
  alter the working session.
- Snapshot creation pays the cost of one temporary agent session and one
  compaction call; it is intentionally separate from a persistent duplicate.
- The action is unavailable when the Host cannot create/compact the temporary
  session or the source transcript has no messages.
- The Markdown contains model-generated text and must be treated as untrusted
  content by any later renderer.
