# ADR 0048: Host-owned Settings runtime hot apply

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-12 |
| Related | [Settings / Capability Runtime Refactor](../specs/settings-capability-runtime-refactor.md), [Runtime Refactor](../specs/runtime-refactor.md), [ADR 0040](./0040-host-session-runtime-residency.md) |

## Context

Settings changes are persisted with a stable configuration hash, while a live
product session owns a separate Agent Runtime generation. The previous runtime
implementation used one `expectedSettingsRevision` field for both the active
generation and the replacement target. It also treated every change in the Web,
Process, Notes, Flashcards, Subagent, and Permission domains as an immediate
safety tightening.

That combination could leave a session permanently stale, reject a valid
replacement with a revision mismatch, and disable `web_search` after a harmless
source switch such as delegated search to CLI search.

## Decision

The Host is the only Settings-to-runtime update authority.

1. A runtime records `settingsRevision` for the active generation and
   `desiredSettingsRevision` for the latest committed Settings snapshot.
2. Runtime replacement uses the active generation ID as its compare-and-swap
   token and the desired Settings revision as immutable candidate input.
3. Resident sessions converge automatically after a successful `settings/apply`.
   The current Run tree is allowed to finish; a new root Run waits for the
   desired generation. Cold sessions activate directly from the latest durable
   Settings snapshot.
4. Multiple saves are latest-wins. A candidate for an obsolete revision is
   discarded before publication and never produces a normal revision-conflict
   error.
5. Immediate safety behavior is driven by semantic capability restrictions, not
   by domain names. A Web source switch remains a runtime schema change but does
   not revoke Web search when another usable route exists.
6. Candidate creation may overlap the old backend, but only the published
   generation admits new root Runs or tool calls. A failed candidate never
   replaces the active generation; the update remains visible and retryable.
7. Restrictions remain monotonic while an older generation is active because
   successive Settings impacts are deltas between persisted snapshots. They are
   cleared only when the desired generation attaches. A replacement generation
   has no native Pi conversation state, so its first prompt receives the same
   bounded, one-shot product-history reconstruction as a cold activation.
8. A per-turn model switch across Provider IDs is also a runtime-generation
   boundary. The Host leaves the new Run unattached while it compiles a
   generation whose Provider envelope contains the selected model's Provider,
   then attaches the Run to that generation. Same-Provider model switches use
   Pi's native model selection and do not rebuild the generation.

## Consequences

- App/Host restart is not required for `new-runtime` Settings changes.
- A currently executing turn retains its immutable generation semantics.
- The Host must publish runtime status transitions and precise capability
  restrictions so Desktop and CLI do not infer state from transcript events.
- `session/reload-runtime` remains a recovery/compatibility command; normal
  Settings application does not depend on a client clicking it.
- Model selection never registers a missing Provider into an already-live Pi
  `ModelRuntime`; that would bypass the compiled capability/secret boundary.
- `host-restart` settings remain explicit and are not falsely reported as hot
  applied.
