# Tool-output context overflow: Pi, Oh My Pi, and upgrade strategy

Date: 2026-11-06 (Asia/Shanghai). Status: research complete for selecting an implementation approach; production protection is not implemented and the owner deferred implementation on 2026-11-06. Track execution in [canonical backlog D-HOST-04d](../todo-deferred.md#25-session--host--engineering). The owner permits Pi core changes and expects future Pi upgrades. This report treats bounded kernel patches as an option rather than rejecting them on the older no-fork preference.

## Recommendation

Stay on the Pi upstream line. For the immediate fix, backport the small upstream mid-run compaction and trailing-tool-result cut-point fixes onto the currently pinned runtime, then port the relevant Oh My Pi output-spill, local tool-result reduction, post-reduction fit check, and bounded summary-fold behavior with their tests. Prefer an upstream upgrade instead of a backport when its compatibility work is independently ready. Do not replace Pi wholesale with Oh My Pi for this issue.

Keep product storage, references, budgets, and recovery policy outside Pi. Restrict kernel changes to the safe loop boundary/request integration needed to invoke that policy. Track each patch against an exact Pi version and delete upstream-fix patches as soon as the selected upstream release includes them. Do not make a broad session-controller fork the maintenance unit.

This recommendation follows executable comparisons: upgrading alone fixes ordinary mid-turn spikes in the tested newer releases but does not establish a hard bound on a batch retained after compaction or on every summarizer input.

## Evidence scope and corrections

Only synthetic text, in-memory credentials, public source, and public packages were used. No original conversation, CTF material, live provider request, user auth file, or running piwin session was inspected. Public npm packages were installed under a temporary directory with install scripts disabled. Project dependencies and runtime code were not changed.

The earlier preparation-only example had no persisted failed assistant response. That is not equivalent to the complete overflow-recovery path: persisting the error can change the cut point. In a complete synthetic run, the current installed Pi 0.84.2 recovered from a recognizable overflow error. The earlier example proves a preparation boundary, not inevitable failure after an API error.

Pi 0.84.2 already limits each tool result to 2,000 characters when serializing a summary (`core/compaction/utils.js`, `TOOL_RESULT_MAX_CHARS`). This is different from the live model context and piwin's 120,000-character Host-result projection. A single large tool output therefore does not automatically make its summary request equally large. Many messages or large user/assistant content can still overflow a summary request.

The user's reported failure is credible, but its exact provider error/recovery sequence remains unknown. The probes below demonstrate concrete mechanisms, not attribution of that private incident.

## Version baseline

| Runtime | Inspected evidence | Relevant behavior |
| --- | --- | --- |
| piwin's installed Pi 0.84.2 | `packages/agent-host/package.json`, installed SDK/core JS, existing adapters | Post-run/pre-prompt compaction; no native pre-next-response threshold compaction |
| Pi 0.84.4 | Published package and [release](https://github.com/earendil-works/pi/releases/tag/v0.84.4) | Adds mid-run threshold compaction after tools and before the next assistant request (#6879); retains the old trailing-result cut-point problem |
| Pi 0.86.0 | Published package and [release](https://github.com/earendil-works/pi/releases/tag/v0.86.0) | Fixes oversized trailing tool results falling back to the first cut point (#9740); includes per-model compaction budgets |
| Pi 1.5.0 | Published package and [tagged source](https://github.com/earendil-works/pi/tree/v1.5.0), release commit `f9a2636` | Latest release observed; adds later projection/context-edit machinery and other compatibility changes |
| Oh My Pi 18.17.0 | Published core package and [tagged source](https://github.com/can1357/oh-my-pi/tree/v18.17.0), release commit `75e7801` | Latest release observed; layered spill, mid-run maintenance, local rescue, progress checks, and budgeted summary folding |

The [Pi 1.5.0 changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/CHANGELOG.md) identifies both earlier fixes and their release versions. Current `main` documentation alone is insufficient evidence for a pinned runtime's behavior.

Downloaded source archive SHA-256 values:

- Pi 1.5.0: `04d24541dc25fa620f56844bf845e41a2f18e7f8c853b69e4c9345eb37e934e6`.
- Oh My Pi 18.17.0: `d10f9ce8ac2910cc090d0e2e2b4abbc24802b68c957084c705deded9fe84937c`.

## Executable comparisons

The [probe](./agent-context-overflow/probe.mjs) runs real Pi SDK sessions with discovery disabled, in-memory credentials/session managers, and a locally replaced stream function. It checks tool execution counts and writes only synthetic diagnostic facts. [Raw results](./agent-context-overflow/pi-probe-results.json) and [reproduction instructions](./agent-context-overflow/README.md) are retained.

The mock upstream uses `ceil(serialized request characters / 4)` as a deterministic rejection rule, not a real tokenizer. Repeated synthetic strings do not establish real model token usage. The experiment tests request/compaction ordering and recovery under a stated rejection condition. It is not a complete piwin SDK/worker integration test.

Three scenarios were run across four versions (12 runs):

1. **Threshold burst:** retained result fits after older history is summarized; original live request does not fit the mock window.
2. **Oversized retained batch:** nine tool results each contain 120,000 characters; the live retained batch alone exceeds the mock 256,000 window.
3. **Oversized summary:** seeded large user messages make a manual compaction's serialized summary input exceed that window.

| Pi version | Threshold burst | Oversized retained batch | Oversized summary |
| --- | --- | --- | --- |
| 0.84.2 | Sends over-budget request, then recognized-error compaction recovers | Sends over-budget request, then recovers | Summary fails |
| 0.84.4 | Same in this fixture: new check cannot obtain a cut point | Sends over-budget request, then recovers | Summary fails |
| 0.86.0 | Compacts before next request; no provider error | Compacts first, retained batch still overflows, second compaction recovers | Summary fails |
| 1.5.0 | Compacts before next request; no provider error | Compacts first, retained batch still overflows; final observed assistant event is an error | Summary fails |

For example, the 1.5.0 batch sequence contains a successful compaction followed by a request with a mock size of 270,779 against 256,000. A successful compaction event is not proof that the next request fits. The 1.5.0 result is a limitation observed in this fixture, not a claim that every real-provider overflow fails or a complete diagnosis of an upstream regression.

The Oh My Pi 18.17.0 published core package was also installed in isolation. Three original, unmodified upstream test files plus their helper were copied from the matching tag and run with Bun 1.4.4:

- [compaction-oversized-input.test.ts](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/agent/test/compaction-oversized-input.test.ts): fitting summaries, multi-window folding, shrinking after a provider rejects an apparently fitting window, small-window floor, non-overflow failures, previous summary, readable native-compaction boundaries.
- [shake.test.ts](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/agent/test/shake.test.ts): protected results, image preservation, savings thresholds, recovery preset that can reduce the newest oversized result, fenced/XML regions.
- [compaction-cut-point.test.ts](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/agent/test/compaction-cut-point.test.ts): retained-tail boundaries including oversized custom messages.

Final result: **32 passed, 0 failed, 102 expectations**; [test log](./agent-context-overflow/omp-tests.txt). These are upstream core tests, not evidence that a piwin port is already integrated. The full Oh My Pi session-maintenance and spill integration suites were inspected where relevant but were not run.

## How Oh My Pi handles the failure chain

### 1. Spill large results before they enter the live prompt

[`tools/output-meta.ts`](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/coding-agent/src/tools/output-meta.ts) contains `spillLargeResultToArtifact` and the tool wrapper. It checks joined text in UTF-8 bytes, saves large output, substitutes a bounded preview, preserves non-text blocks, and adds structured truncation/recovery information. Already recoverable paginated reads are exempt to avoid recursively saving pages of artifacts into more artifacts. The function returns unchanged output when its session-manager context is absent; it is not a universal standalone guard without the surrounding integration.

The default spill threshold is 50 KiB; configured head/tail windows are 20 KiB each. This is a per-result boundary, not an aggregate request budget. In the spill path, save failures are logged and output remains bounded; no fictitious recovery link is emitted. Depending on capture/storage limits, the original output may be unavailable or only partially retained. Piwin must make that loss explicit.

The streaming sink in [`streaming-output.ts`](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/tui/src/tools/streaming-output.ts) separately defaults its on-disk artifact cap to **16 MiB**, retaining a head and rolling tail beyond it. Therefore “all raw output is always stored losslessly” is not a valid blanket description. This storage cap, inline preview cap, and model token budget are separate limits.

### 2. Maintain context at a safe tool-loop boundary

[`SessionMaintenance.maintainContextMidRun`](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/coding-agent/src/session/session-maintenance.ts) waits for a completed paired tool batch and a persistence barrier. It checks whether another request will occur, respects cancellation and disposal, performs maintenance, and refreshes the active messages read by the loop. It also guards repeated no-progress maintenance.

This sequencing is important: starting manual `AgentSession.compact()` in the current Pi turn hook would abort/wait on that same active run. Native internal compaction avoids that public manual-operation lifecycle. The upstream Pi 0.84.4 fix provides the corresponding safe-boundary behavior without adopting Oh My Pi's controller.

### 3. Rescue a retained tail that ordinary compaction cannot shrink

[`shake.ts`](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/agent/src/compaction/shake.ts) is a pure region-selection/replacement layer; artifact I/O and persistence are orchestrated separately. Normal automatic shake protects 16,000 recent tokens and requires 4,000 savings. `RESCUE_SHAKE_CONFIG` sets recent protection to **zero**, allowing reduction of the newest oversized result that caused the dead end, while protecting skill and artifact-recovery reads.

Session maintenance uses local reduction and re-tests headroom/fit; insufficient progress blocks automatic continuation rather than indefinitely repeating compaction. Some upstream rescue paths can also discard images. Piwin should adopt recoverable tool-text reduction first; automatic removal of user images, automatic model promotion, and PNG-based snapcompact are separate product decisions and are not required for this fix.

### 4. Make summary requests themselves fit

[`compaction.ts`](https://github.com/can1357/oh-my-pi/blob/v18.17.0/packages/agent/src/compaction/compaction.ts) includes `summaryInputBudgetTokens`, `planSummaryWindows`, and `generateSummary`. It budgets conversation input separately from output, previous summary, and scaffolding. Larger histories are folded across multiple bounded summary calls. An explicit overflow causes a smaller window and replanning; unrelated failures propagate. A single oversized serialized message is clipped with a marker.

This is worth porting along with the tests. It is not lossless summarization: folding can omit facts, and single-message clipping can omit text. Keep raw source accessible, preserve custom instructions across every window, check cancellation, and commit the new compaction boundary only after the operation succeeds.

### 5. Estimate current request cost, including newly added data

Oh My Pi's tokenizer uses native bindings, provider/model policies, thinking replay behavior, images, and caches; it is not a self-contained helper to copy into a Node service. Its default reserve policy includes a proportional 15% reserve and an absolute floor, and it floors compaction decisions with a stored-conversation estimate instead of trusting stale/deflated provider usage alone.

A 15% reserve is an early-maintenance policy, not protection against an arbitrarily large tool batch. Piwin still needs post-extension final-request checks, output allowance handling, image/body limits, recognized-error recovery, and no-progress termination. Token windows and provider request-byte/media limits must not be conflated.

## What is practical to reuse

| Candidate | Reuse approach | Adaptation needed |
| --- | --- | --- |
| Pi's mid-run threshold integration and cut-point fix | Backport upstream fixes or consume a release containing both | Loop/context refresh, cancellation, existing extension hooks; remove backports after upgrade |
| OMP UTF-8-safe head/tail truncation and metadata cases | Extract the narrowly needed functions and matching tests | Piwin's pure domain module and result contract; avoid importing TUI just for text truncation |
| OMP shake victim selection and protection cases | Port pure selection logic and tests | Piwin tool identities, paired calls/results, native message mapping, Host storage references, persistence/rollback |
| OMP summary window planning and overflow shrink tests | Port the bounded-fold algorithm and tests | Node-compatible token counter, current provider/model runtime, OAuth/header routing, abort, usage aggregation, hook ownership |
| OMP SessionMaintenance controller | Use as a reference for sequencing/invariants | Do not paste its 6,570-line implementation with goal, promotion, native compaction, and UI assumptions |
| Whole OMP runtime dependency | Not recommended for this issue | OMP core is Bun >=1.4.4, source-TS exports, native tokenizer and OMP-specific AI/catalog/wire/snapcompact dependencies; not a drop-in Pi 0.84.2 module |

OMP 18.17.0's root [license](https://github.com/can1357/oh-my-pi/blob/v18.17.0/LICENSE) is MIT. Preserve required upstream copyright/license text for substantial copied portions, record tag/commit and local changes, and check separately licensed vendored portions before selecting code. This is dependency provenance, not generated agent attribution.

## piwin integration and upgrade hazards

### Existing boundaries to use

- `projectHostToolResultToPiContent` is shared by SDK and worker proxy tools, but only covers Host custom tools. It currently takes the first 120,000 UTF-16 code units. Errors, Pi-native tools, extension results, later context transformations, and images need coverage at their respective boundaries too.
- `agent.afterToolCall` and `agent.transformContext` are already available. Compose after existing hooks; do not replace the extension handler or admission logic. Final context transformation is useful for defensive projection, but does not itself persist a compaction boundary or repair already discarded raw text.
- `session_before_compact` can supply a bounded custom summary. It does not fire when native preparation returns no candidate. It also interacts with the existing `prioritizeCompactionHooks` policy and bundled DeepSeek compactor; avoid duplicate summarization requests or silent takeover of an explicit extension choice.
- Reuse the `session` package's persistence ownership. The existing `session/tool-output` command is a bounded, redacted historical preview, not a model-facing full-output store: recorder defaults are 256 KiB, and oversized native message copies are also capped at 256 KiB. Neither guarantees recovery of raw output removed before recording. Extend the owning service rather than creating a second session database or assuming that preview command already solves spill.
- Store recovery references under Host authority and scope reads to the owning session. They must survive runtime generation replacement and follow session deletion/export/import/retention rules. Paginated reads must be bounded and avoid re-spilling the same content. Storage failure must not invent a successful full-output capture.
- Persist successful compaction through the existing ADR 0068 replay path. Do not repeatedly inject compacted raw history on restart. Keep original tool execution separate from retrying the assistant request, so side effects are not repeated.

### Upgrading to 1.5.0 is not a package-number-only change

Pi 0.86 changes provider stream inputs to normalized `TranscriptContext`; system prompts and tool declarations are represented through transcript messages. Piwin's Devin encoder (`src/devin/protocol.ts`) and bundled Zen stream (`zen-stream.js`) still read `context.systemPrompt` / `context.tools`. These paths need compatibility work, not just a successful root typecheck.

Pi 0.87 adds append-only context edits and retain-none compaction. Pi 1.5 uses projection-aware replay and tool argument validation via `@earendil-works/pi-schema`; seed/native-message capture, provider adapters, extension APIs, tool schema semantics, and bundled codemode must be checked. The current local duck-typed session handles do not prove this compatibility.

An immediate major upgrade would mix a migration with the overflow fix. The smaller immediate route is versioned backports of Pi's own loop/cut fixes plus a narrow OMP-derived protection port. A later upgrade can then remove the upstream-fix patches while keeping the product protection contracts and behavior tests.

### A local pnpm patch does not reach today's desktop bundle automatically

`scripts/bundle-host.mjs` writes an isolated manifest and runs **npm install** for pinned external dependencies. It separately verifies Pi coding-agent/AI/codemode versions. A patch applied by pnpm only in workspace `node_modules` is absent from that fresh npm installation.

Any patch solution must either apply the same versioned patch to both installations or supply the same prebuilt patched package to both. Verify package version and original file hashes before application, fail on mismatches, and run a packaged SDK/worker overflow smoke. Never hand-edit installed files or hide a fuzzy postinstall replacement. pnpm provides a [recorded patch workflow](https://pnpm.io/cli/patch), but that alone does not cover this repository's npm packaging path.

Suggested patch metadata: exact package/version, source revision, patch hash, behavioral tests, affected files, and an explicit upstream-removal condition. On upgrade, first test the unpatched release, remove fixes it now supplies, and rebase only remaining integration changes. Do not assert a known-safe budget for an unknown runtime using a silent fallback.

## Implementation acceptance criteria

1. A tool batch crossing the maintenance threshold is considered before the next conversational request, including zero-usage responses, queued input, model switches, and extension modifications.
2. A single output and an aggregate batch exceeding usable context are reduced to bounded recoverable references; call/result pairing, error state, and current instructions remain intact. Large errors, mixed images/text, native and extension tools are included.
3. Successful maintenance is followed by a fit/progress check; no unchanged-context retry loop or false success. Unknown model limits and irreducible protected content produce an explicit actionable failure.
4. Summary requests fit their own budgets; overflow shrinking, single-message clipping, previous-summary carry, unrelated errors, cancellation, and usage aggregation are covered.
5. Save/read failures, partial capture, expired references, concurrent calls, cross-session denial, page retrieval, and cold replay are covered without promising nonexistent full data.
6. No prior tool side effect is rerun merely to retry an assistant response. Abort during persistence/compaction does not create a fabricated success boundary.
7. The same cases pass through the actual SDK and RPC worker adapters and the packaged Host; workspace typecheck, affected package suites, boundary checks, and source-file size checks pass.
8. A Pi upgrade runs the behavioral suite against the new unpatched version before patch migration. Unsupported seams fail visibly rather than disabling protection.

## Remaining limits

The private incident is not diagnosed at the provider-message level. Provider tokenization, endpoint request-byte caps, and a connection that never terminates are not faithfully reproduced by the character-budget mock. Native session tests do not replace SDK/worker/packaged Host integration tests. No production fix, dependency upgrade, kernel patch, or architecture decision has been shipped by this research.
