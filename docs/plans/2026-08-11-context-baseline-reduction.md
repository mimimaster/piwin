# Context Baseline Reduction

Date: 2026-08-11
Status: Complete
Related: `docs/specs/settings-capability-runtime-refactor.md`, ADR 0016, ADR 0029, ADR 0033

## Goal

Reduce a fresh General session's model-visible input baseline from roughly 8.4K
provider-reported tokens toward 5–6K without removing core coding behavior or
bypassing Host tool admission.

## Measured baseline

- General workspace, DeepSeek V4 Flash, one `test` prompt: 8,391 input-side tokens.
- Trusted piwin project under the same model: 12,033 input-side tokens.
- The 3,642-token delta is the project's 14,190-byte `AGENTS.md`.
- MCP `fast_context_search` direct exposure accounts for roughly 500 tokens when pinned.

## Changes

1. Move the default Agent operating contract to the generation system prompt.
   Agent turns carry only a compact mode marker; Plan/Ask retain explicit
   turn-scoped overrides because the composer may switch mode without rebuilding
   the runtime.
2. Replace the always-on Artifact decision/runtime payload with a compact
   capability hint plus a read-only `artifact_instructions` tool that returns the
   full configured policy and runtime contract only when an Artifact is needed.
3. Keep high-frequency coding tools direct. Move low-frequency Host tools behind
   a Host-owned gateway only if their original permission declarations and
   generation admission can be preserved exactly; otherwise prefer descriptor
   compaction over a permission-bypassing dispatcher.
4. Measure serialized model-visible prompt/tool characters before and after each
   slice. Provider-reported input remains the final smoke-test authority.

## Non-goals

- Do not disable project `AGENTS.md` implicitly.
- Do not unpin high-frequency code search merely to improve the number.
- Do not dispatch hidden tools outside `SessionHostToolExecutionPort` or weaken
  their original permission specifications.
- Do not change the fake category breakdown in the same behavioral patch.

## Verification

- Unit tests for prompt composition and Artifact instruction loading.
- SDK/RPC tool-manifest parity tests.
- Full `@piwin/host-runtime` and `@piwin/agent-host` tests and typechecks.
- Restart Host and compare fresh General/project provider input totals.

## Result

- First slice (Agent/Artifact/MCP prose and descriptor compaction): fresh
  General input fell from 8,391 to 7,492 provider-reported tokens.
- Lazy Host toolbox slice: fresh General input fell to 4,978 tokens.
- `fast_context_search` remains a pinned first-class MCP tool.
- An SDK end-to-end `piwin_toolbox describe(process_list)` call returned the
  exact target descriptor; the first smoke exposed and the follow-up fixed a
  descriptor/allowlist mismatch.
