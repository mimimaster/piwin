# ADR 0031: Dirty-Base Consent for Parallel Writes

**Status:** Accepted  
**Date:** 2026-08-05  
**Supersedes:** The hard-reject dirty-base paragraph in ADR 0030 only  
**Related:** ADR 0030 (Safe Parallel Subagent Execution)

## Context

Parallel write tasks use one isolated worktree per child and serialized
integration into the parent project. Starting such a task from a dirty parent
working tree is risky because the parent contains changes that are not part of
the captured task base.

The previous design exposed a boolean,
`requireCleanBaseForParallelWrites`, and either rejected or allowed the
operation based on that value. The boolean does not express the user's intent
at the moment a risky write is about to begin: an old `false` value is not
proof that the user consents to every future dirty-base write.

## Decision

The Host asks for explicit consent when a write-capable parallel task detects a
dirty base. The ask is raised before a worktree lease is acquired and uses the
existing permission request/resolve transport with the stable action
`subagent:dirty-base`.

The persisted policy is an explicit domain value:

```ts
type DirtyBaseParallelWritePolicy = 'ask' | 'bypass';
```

The safe default is `ask`. A clean base proceeds without an ask. An explicitly
configured `bypass` policy may proceed on a dirty base, but it must remain
visible in diagnostics and must not be inferred from legacy configuration.

When the policy is `ask`, Desktop and CLI present the same three choices:

1. **Continue anyway** resolves the current ask as a one-run `allow`. The
   decision is recorded in the Run diagnostic/audit trail and is not persisted
   as a remembered approval.
2. **Commit or stash first** resolves the ask as `deny`, preserves the working
   tree, and explains that the user must prepare the base before retrying. The
   Host never commits or stashes automatically.
3. **Cancel** resolves the ask as `deny` and cleanly cancels the pending batch.

The old persisted `requireCleanBaseForParallelWrites` field is migrated to
`ask` for both `true` and `false` values. Neither legacy value proves explicit
permission to bypass the new consent step. The old field and its UI toggle are
removed after migration coverage is in place.

## Consequences

- Dirty-base parallel writes are never silently refused or silently allowed.
- Desktop and CLI share one Host decision and one user-visible choice model.
- A user may explicitly accept one risky batch without weakening future
  defaults.
- The Host must preserve the current tree when the user chooses to prepare the
  base; it must not perform Git commits or stashes as a side effect.
- The first implementation reuses existing permission transport rather than
  adding a new global permission-decision enum.
- The policy is an execution safety control, not a replacement for worktree
  isolation, serialized integration, or conflict retention.

Implementation update (2026-08-05): the old boolean and UI toggle are removed;
the Host uses `ask` by default, records the one-run decision on the owning Run,
and never commits or stashes as part of admission.
