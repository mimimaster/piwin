# Subagent Orchestration Repair Plan

Date: 2026-08-11

## Goal

Close the verified end-to-end gaps in Plan-driven subagent orchestration and
the Ultra Code scout scheme without introducing a second scheduling authority.

## Invariants

- `SubagentOrchestrator` remains the only batch scheduling authority.
- Plan inline/verification turns and subagent batches are descendants of the
  owning `plan-execution` Run.
- Cancellation joins descendants before terminalizing the Plan Run.
- Plan steps selected for subagent execution default to the `implementer`
  profile unless the step explicitly selects another profile.
- Parent verification receives bounded child summaries.
- Worker child events are persisted through the product transcript store as
  well as streamed live.
- Ultra Code validates pinned models before spawn and an unpinned member
  inherits the current parent-session model.

## Work

1. Add parent-Run-aware internal Plan prompting and terminal completion hooks.
2. Make the default Plan subagent profile `implementer` and preserve explicit
   per-step profiles.
3. Inject bounded child results into final parent verification.
4. Record worker child prompts/events in the product transcript store.
5. Resolve configured model keys when selecting a scheme and inherit the
   Composer model when a scheme member does not pin one.
6. Pass only declared provider environment secrets into isolated worker
   processes so SDK and subagent workers use the same credential boundary.
7. Add focused unit/integration tests and run package typechecks, tests, and
   architecture checks.

## Verification

- Plan Run tests cover child ownership, completion, failure, and abort.
- Default Plan task preparation resolves to worktree/implementer.
- Verification prompt contains bounded child summaries.
- Unknown pinned Ultra model returns spawn-before fallback.
- Unpinned Ultra scout receives the parent model.
- Completed worker child history remains readable after live stream cleanup.
- Declared provider env refs reach isolated subagent workers without copying
  the parent environment wholesale.

## Result

Implemented the Plan Run ownership/terminal lifecycle, abort ordering, default
implementer profile, summary merge/evidence propagation, worker transcript
recording, plan-tool push wiring, configured-model availability checks, and
Composer model inheritance, plus declared provider environment injection for
isolated workers.

Focused verification passed: 158 tests across RunRegistry, Plan execution,
session orchestration admission, and HostRuntime. Package-boundary checks and
the contracts/agent-host typechecks passed. The complete host-runtime suite
passed 1069 of 1070 tests; the remaining failure is in the pre-existing dirty
`session-message-response` tail-window work. Host-runtime typecheck reaches one
pre-existing `exactOptionalPropertyTypes` error in
`packages/pet/src/validate-manifest.ts`.

Real-provider multi-process E2E passed: RPC mode completed a parent generation
and an `explorer` subagent generation against the configured
`custom-openai/deepseek-v4-flash` endpoint, persisted the child transcript, and
observed two concurrent worker processes. No credential values were emitted.

The same real-provider run also passed the scheme-bound Ultra Code path:
`ultra-code` selected the `searcher` role, the parent delegated through the
model-facing tool, and the merged child transcript contained the expected
provider response.

Text-model matrix verification also passed for `deepseek-v4-flash`, `grok-4.5`,
and `gpt-5.6-terra`; each returned the expected assistant token. The configured
`swe-1-7` entry reached the provider but returned no response, so it remains a
provider/model-availability issue rather than an orchestration failure.

A role-specific cross-model flow also passed: `deepseek-v4-flash` remained the
main model, the `coder` role executed on `grok-4.5`, and the `reviewer` role
executed on `gpt-5.6-luna`. Both child transcripts carried the expected model
snapshot and response token, and the parent Run completed after both merges.

The complete Snake game acceptance flow passed in a temporary clean Git
project. Grok generated and integrated `index.html`, `game.js`, `styles.css`,
and `README.md` from a worktree; Luna reviewed the integrated diff and accepted
it; `node --check game.js` passed; and keyboard/touch, collision, and score /
restart feature checks passed. This exposed the original omission of untracked
files and led to the follow-up Git audit. The final implementation captures the
complete child snapshot through an alternate temporary index, performs the
three-way calculation through a temporary parent-index copy, and applies only
unstaged working-tree changes to the parent.

Post-repair credentialed verification passed through the reusable
`pnpm e2e:subagent-real` gate: DeepSeek V4 Flash main → Grok 4.5 coder with
uncommitted worktree changes → GPT-5.6 Luna reviewer. Integration was `applied`,
the parent index remained unchanged, generated worktree/branch state was
cleaned, JavaScript syntax validation passed, and the reviewer accepted the
gameplay implementation.
