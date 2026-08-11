# Subagent worktree / Git integration audit

Date: 2026-08-11

Scope: the Piwin worktree lifecycle used by write-capable subagents: dirty-base
admission, worktree creation, change collection, output-path enforcement,
three-way application, model-facing status propagation, cleanup, and local
Desktop bundle selection.

This note records diagnosis only. Except for the already-landed untracked-file
collection fix, the findings below are not repaired by this audit.

## Repair update

The confirmed P1 findings and the stale Desktop development Host issue were
repaired in the follow-up implementation on 2026-08-11:

- child snapshots and parent three-way calculations now use alternate temporary
  indexes, preserving both real indexes;
- the final parent delta is applied without `--index`, so agent changes remain
  unstaged;
- NUL-delimited name-status parsing validates both sides of renames;
- production worktrees live under
  `<piwinRoot>/worktrees/<repository-key>/`, successful integration uses forced
  cleanup, and generated subagent branches are removed;
- cleanup failure after a successful parent apply no longer changes the
  integration result to failed;
- Git conflict diagnostics reach the Host task result;
- `piwin_subagent_run` returns explicit non-success results for failed,
  cancelled, and needs-integration batches;
- debug Tauri runs always select the current workspace Host source instead of a
  copied resource bundle.

Regression coverage includes uncommitted new files through real
Host/Git coordinator cleanup, parent/child index preservation, rename path
enforcement, conflict non-mutation, unusual filenames, branch cleanup, status
propagation, and debug Host selection. The process-local integration lock and
the unused legacy `diffWorktreeAgainstMain` helper remain follow-up hardening
items.

The credentialed multi-process E2E also passed after repair:
DeepSeek V4 Flash ran the main session, Grok 4.5 generated the Snake game while
a pre-commit hook guaranteed the child changes remained uncommitted, the Host
reported integration `applied` while preserving the parent index and cleaning
the worktree/branch, and GPT-5.6 Luna accepted the integrated game. The reusable
manual gate is `pnpm e2e:subagent-real`; it resolves the configured keychain
secret into a temporary named environment reference without printing or
persisting the secret in the temporary config.

## Executive result

The untracked-file defect was a Piwin Git adapter defect, not a provider/model,
Pi SDK, or Git defect. Staging the isolated child index before producing the
patch makes new files visible, but it also exposed a cleanup-state mismatch.

Five related correctness problems were confirmed with source inspection and
temporary repositories. A sixth problem was confirmed in the current local
Desktop development artifacts. Several lower-severity hardening gaps remain.

## Confirmed findings

### P1 — Applied changes are reported as failed when the child did not commit

`integrateWorktreeChanges` runs `git add --all` in the child worktree so that
untracked files enter the diff. A successful apply is followed by a normal
`git worktree remove`, without `--force`. The staged child index is still dirty,
so Git refuses cleanup. The coordinator then changes the task result from
`applied` to `failed` even though the parent files were already changed.

Reproduction result:

```text
integration result: applied
git worktree remove: fatal: ... contains modified or untracked files,
use --force to delete it
coordinator projection: integrationStatus=failed
parent files: already applied
```

This creates a dangerous split-brain result: filesystem state says success,
while orchestration state says failure. It occurs whenever a successful child
leaves captured changes uncommitted; committing inside the child happens to
avoid it.

Relevant code:

- `packages/git/src/worktree-integration.ts` stages the child at lines 53-69.
- `packages/git/src/worktree.ts` performs non-force removal at lines 89-110.
- `packages/host-runtime/src/subagent-integration-coordinator.ts` converts the
  cleanup failure into integration failure at lines 305-316.

### P1 — Rename can bypass `allowedOutputPaths`

`git diff --name-status` emits both source and destination for a rename, but
`parseChangedFiles` keeps only the last tab-separated field. Therefore a rename
from a forbidden source to an allowed destination validates only the
destination. Applying the patch also deletes the forbidden source.

Reproduction result:

```text
child operation: git mv source.txt allowed.txt
allowedOutputPaths: [allowed.txt]
integration result: applied
parent effect: source.txt deleted, allowed.txt created
```

Relevant code: `packages/git/src/worktree-integration.ts` lines 81-97 and
140-155.

### P1 — Model-facing subagent tool masks failed integration and failed batches

The orchestration result correctly has terminal statuses such as `failed` and
`needs-integration`. The model-facing seam waits for completion but checks only
whether a child session id exists. It stores the task result and returns the
child id regardless of batch, execution, or integration status. The tool then
merges the summary and returns `ok: true` with the text `subagent completed`.

This allows the composer or a reviewer to continue against incomplete parent
state. The first real snake-game E2E exhibited this behavior: integration was
in conflict while the parent/reviewer flow still completed.

Relevant code:

- `packages/host-runtime/src/subagent-orchestrator.ts` lines 447-503 derives the
  correct terminal status.
- `packages/host-runtime/src/host-runtime.ts` lines 2442-2458 drops that status.
- `packages/host-runtime/src/subagent-run-tool.ts` lines 252-266 reports success.

### P1 — Piwin's own worktree directory makes a clean parent look dirty

Worktrees are created below `<repo>/.piwin-worktrees`, but that path is not in
the repository `.gitignore`. While any child exists, `git status --porcelain`
reports `?? .piwin-worktrees/`, so `isWorktreeBaseClean` returns false.

Reproduction result:

```text
initial base clean: true
after createWorktree: false
status: ?? .piwin-worktrees/
```

This can make a later or staggered parallel child request dirty-base consent
because of Piwin's own isolation directory, rather than user edits.

Relevant code:

- `packages/git/src/worktree.ts` lines 51-58 creates the directory inside the
  parent checkout.
- `packages/git/src/worktree-integration.ts` lines 162-171 treats every status
  entry as dirty.
- `.gitignore` currently has no `.piwin-worktrees/` entry.

### P1 — Three-way apply stages child changes in the parent's index

`git apply --3way` implies index participation and leaves successfully applied
child changes staged in the parent repository. A controlled repository with an
existing user-staged file produced:

```text
M  child.txt
M  user.txt
?? .piwin-worktrees/
```

The user's existing staged change was preserved, but the Host silently added
the child's files to the same staging set. This weakens the user's staging
boundary and can cause an unrelated later commit to include agent changes.
ADR 0031 requires preservation of the current tree and explicitly disallows
automatic commit/stash behavior; index semantics should be explicit as well.

Relevant code: `packages/git/src/worktree-integration.ts` lines 100-119.

### P2 — Desktop development can run a stale bundled Host

The source contains the untracked-file fix, but both the current
`dist-host/host-serve.mjs` and the current Tauri debug resource copy still use
the old diff path without `git add --all`.

`pnpm dev:tauri` runs only `ensure:packaging-placeholders` before `tauri dev`;
it does not rebuild `dist-host`. The Rust resolver prefers a resource Host file
larger than the placeholder threshold, including a stale real bundle. Packaged
release builds are safer because `package:desktop` explicitly runs
`bundle:host` first, but local Desktop/provider E2E can test yesterday's Host
while source-level CLI tests exercise today's code.

Relevant code:

- root `package.json` lines 21-26.
- `scripts/ensure-packaging-placeholders.mjs` lines 35-43.
- `apps/desktop/src-tauri/src/host_bridge.rs` lines 240-294.

## Secondary hardening gaps

### P2 — Conflict diagnostics are discarded at the Host adapter

The Git layer returns an error string for conflict/failure, but the integration
adapter keeps only `conflictedFiles` for conflict results. Low-level causes
such as patch errors, timeouts, and buffer errors are absent from the task
result, which makes real-provider diagnosis substantially harder.

Relevant code: `packages/host-runtime/src/subagent-integration-coordinator.ts`
lines 63-101.

### P2 — Integration serialization is process-local only

Serialization uses an in-memory `Map<string, Promise<void>>`. It protects one
Host process, but two Host processes pointed at the same repository can apply
concurrently. The normal architecture expects one Host authority, so this is a
hardening gap rather than the primary path, but the filesystem currently has no
cross-process integration lock.

Relevant code: `packages/host-runtime/src/subagent-integration-coordinator.ts`
lines 212-249.

### P2 — Successful worktree cleanup leaves branches behind

`removeWorktree` removes and prunes worktrees but never deletes the generated
`piwin/subagent/*` branch. Worktree names normally include UUID/time entropy,
so branch reuse is rare, but normal successful operation can accumulate refs.
The fallback in `createWorktree` also blindly returns an existing path when Git
says it already exists, without verifying its HEAD/base/branch ownership.

Relevant code: `packages/git/src/worktree.ts` lines 51-113.

### P3 — Diff parsing is not pathname-safe

Name-status parsing uses newline/tab splitting rather than `-z`, and trims the
path. Tabs, newlines, quoting, and leading/trailing spaces can produce incorrect
`changedFiles` and allowlist diagnostics. With an allowlist this is usually
fail-closed, but the result is still not a correct Git pathname parser.

Relevant code: `packages/git/src/worktree-integration.ts` lines 66-70 and
140-155.

### P3 — Generic Git runner imposes an undocumented 4 MiB diff ceiling

All Git stdout is buffered as text with `maxBuffer = 4 MiB`. Large text or
binary patches can fail before integration and appear as generic conflicts.
The patch is also written into the repository using a timestamp-only name;
normal exceptions remove it, but process crashes can leave residue.

Relevant code:

- `packages/git/src/git-command-runner.ts` lines 39-78.
- `packages/git/src/worktree-integration.ts` lines 100-119.

### P3 — Exported legacy diff helper has incorrect comparison semantics

`diffWorktreeAgainstMain` contains an expression that always resolves to
`HEAD`, assumes `main`/`master`, and chooses one of committed diff or worktree
status rather than combining both. No production caller was found, so this is a
latent public-API defect rather than a current orchestration blocker.

Relevant code: `packages/git/src/worktree.ts` lines 115-162.

## Negative result

A controlled two-file patch with one parent conflict did **not** partially
apply the other file. Parent content and the new file remained unchanged when
`git apply --3way` failed. The earlier snake-game residue is therefore not
enough evidence to claim that `git apply --3way` is generally non-atomic; that
hypothesis is excluded from the confirmed findings.

## Recommended repair order

1. Make integration outcome and cleanup outcome independent; never report
   integration failure after parent mutation has succeeded.
2. Define parent-index semantics and implement an apply strategy that preserves
   the user's staging boundary.
3. Parse name-status with `-z` and validate every affected path, including both
   sides of renames.
4. Propagate batch/execution/integration status through `SubagentRunSeam` and
   make `piwin_subagent_run` fail or explicitly report `needs-integration`.
5. Move worktrees outside the checkout or exclude only Piwin's internal
   worktree root from dirty-base detection.
6. Make Desktop dev rebuild/use current Host source, then add a bundled-host
   regression check for untracked-file integration.
7. Preserve conflict diagnostics, clean generated branches, and add a
   cross-process repository lock before supporting multiple independent Hosts
   against one checkout.

## Regression coverage to add with the repair

- uncommitted new/tracked/deleted child changes integrate and clean up;
- parent index before/after integration is exactly preserved except for the
  intended working-tree changes;
- rename source and destination both obey `allowedOutputPaths`;
- a second child does not see the first child's internal worktree as dirty base;
- failed/needs-integration batch is visible as a failed/non-success model tool
  result;
- source Host and bundled Host run the same untracked-file case;
- branch/worktree counts return to baseline after successful batches;
- filenames containing tabs/newlines/spaces round-trip through changed-files
  reporting.
