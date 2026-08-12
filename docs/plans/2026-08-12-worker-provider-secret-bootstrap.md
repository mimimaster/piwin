# Worker Provider Secret Bootstrap Repair

| Field | Value |
|---|---|
| Status | Implemented |
| Date | 2026-08-12 |
| Incident | `session-mspqaspa-ycmnnq5p` / child `5a4c9327-f0a6-4f93-aa43-cd51bdc83b86` |
| Related | ADR 0012, ADR 0030, ADR 0046 |

## 1. Outcome

An isolated foreground or subagent worker can use a provider whose credential
is stored as `apiKeyRef` without putting the raw API key in worker JSONL,
process arguments, process environment, logs, transcripts, run manifests, or a
temporary file.

The failed Reviewer case must then behave as follows:

1. The Reviewer inherits the parent session model
   `custom-openai/gpt-5.6-sol` because neither the built-in Reviewer profile nor
   the selected roster member pins another model.
2. Host resolves only the credential for `custom-openai`.
3. Host starts the isolated worker with a one-shot provider-secret bootstrap
   pipe.
4. The worker registers the inherited provider and completes the readonly
   review.

An unrelated enabled provider with an `apiKeyRef` must not block this child.

Implementation status: all five slices below are now landed. The incident
path is covered by compiler, worker-pipe, orchestration, and Desktop tests.

### Post-review closure (2026-08-12)

The implementation review found and closed four defense-in-depth gaps:

1. Worker JSONL now uses an auth type that excludes `inline`; both sides of
   the RPC boundary also reject forged inline envelopes at runtime.
2. The fd-3 writer awaits completion and handles asynchronous pipe errors;
   child/hello listeners are installed before bootstrap can complete.
3. Subagent preflight returns one in-memory config/model/credential snapshot,
   and worker compilation consumes it without a second keychain read.
4. Per-turn delegation mode is part of the frozen runtime tool surface. When a
   warm generation has the opposite mode, Host cools it before accepting the
   Run and cold activation recompiles the correct surface. Consecutive turns
   with the same mode reuse the resident generation.

Verification after closure:

- `@piwin/agent-host`: 226/226 tests passed.
- `@piwin/host-runtime`: 1166/1166 tests passed.
- Contracts and Agent Host typechecks passed.
- Package-boundary architecture check passed.
- Host Runtime typecheck reached one unrelated pre-existing error in the
  untracked `settings-runtime-hot-apply.integration.test.ts` fixture
  (`searchDelegateModel: undefined` under `exactOptionalPropertyTypes`).

## 2. Incident findings

The model inheritance path is already correct:

```text
per-call model -> profile/member model -> parent session model
```

The incident child and parent both resolved to:

```text
providerId: custom-openai
modelId:    gpt-5.6-sol
```

The failure is in credential transport:

- the main session uses the in-process SDK backend and may resolve
  `apiKeyRef` from the Host-owned keychain;
- every subagent uses `WorkerTaskRunner`, even when `hostMode` is `sdk`;
- `prepareSubagentTask()` compiles with `allowInlineProviderSecrets: false`;
- `buildProviderEnvelope()` currently iterates every enabled provider and
  rejects the first provider that has only `apiKeyRef`;
- no model request was made and the child transcript remained empty.

This exposes two separate defects:

1. there is no explicit secret bootstrap channel for isolated workers;
2. worker provider compilation is broader than the frozen child model needs.

## 3. Decision

### 3.1 Use a dedicated one-shot child-process pipe

Extend the worker spawn `stdio` array with a fourth pipe. The parent writes one
bounded, length-prefixed bootstrap document to child file descriptor 3 and
closes the pipe before normal session creation begins.

The provider envelope carried by JSONL contains only an opaque secret id:

```ts
type WorkerProviderAuth =
  | { kind: 'env'; envName: string }
  | { kind: 'bootstrap'; secretId: string }
  | { kind: 'none' };
```

The separate bootstrap pipe carries the ephemeral material:

```ts
type EphemeralProviderSecret = {
  secretId: string;
  value: string;
};
```

The raw value must never be part of `WorkerRequest`,
`SerializableProviderRuntime`, `BackendSessionBlueprint`, `HostPush`, or any
durable session/run type.

Why a separate pipe:

- JSONL is routinely parsed, diagnosed, fixture-captured, and may be logged;
- environment variables remain readable to all code in the worker, including
  loaded extensions;
- command-line arguments and temporary files are observable and persist too
  broadly;
- a dedicated inherited pipe is process-scoped, one-shot, and can be closed
  immediately after bootstrap.

The worker necessarily holds the API key in memory while registering and using
the model client. Process isolation is not an OS security sandbox; the goal is
to prevent accidental serialization, persistence, and broad ambient exposure.

### 3.2 Keep Host as the secret authority

`@piwin/host-runtime` remains the only layer that reads `apiKeyRef`. It resolves
the selected provider secret during worker task preparation and returns two
separate values:

- a serializable provider envelope with `auth.kind = 'bootstrap'`;
- an ephemeral secret bundle passed only to the worker runner.

`@piwin/agent-host` owns pipe creation, framing, startup timeout, validation,
and disposal. The worker never reads `~/.piwin`, the keychain, or Settings.

### 3.3 Compile the least provider set

Add an explicit required-provider input to worker compilation. For a frozen
subagent this set contains the effective child model's provider only. Add an
extra provider only when a compiled worker-owned capability demonstrably needs
it.

Do not iterate every enabled provider for a fixed subagent. In the incident
configuration, `custom-openai-2` is unrelated to the Reviewer and must not be
resolved or transported.

Foreground RPC generations may compile the currently selected provider set.
Switching to a provider outside that set must replace/reload the generation
before prompting; it must not silently reach back into Settings from the
worker.

### 3.4 Preserve model inheritance

Do not change the existing inheritance order. Add regression coverage proving
that a Reviewer without a pinned model inherits the exact parent
`providerId`, `modelId`, and protocol. Provider configuration is referenced by
id; it is not copied into the profile or orchestration scheme.

### 3.5 Fail before creating a durable child

Provider selection and secret availability checks must complete before a child
session is registered as running. A missing keychain item or unsupported worker
secret channel returns a stable unavailable result without leaving an empty,
failed child transcript.

For a model-initiated `piwin_subagent_run`:

- an active scheme member with `fallback: 'main'` returns the existing
  `subagent-unavailable-fallback-main` instruction;
- freehand delegation also receives an actionable result telling the parent
  model to complete the review itself;
- explicit Desktop/CLI batch starts surface the credential error to the user
  and do not pretend the task ran.

This fallback is for unavailable credentials, not for a child that started and
then failed during execution. There is still no automatic retry.

## 4. Delegation UX clarification

The current scheme option `None` means only "no roster/preamble injection".
It does not hide `piwin_subagent_run`, so a capable main model may still
delegate in freehand mode. The incident was therefore model-initiated, not a
Plan or scheme-driven batch.

Make that behavior explicit:

1. Rename `None` to `Freehand`.
2. Describe it as: "No scheme prompt; the agent may still delegate when useful."
3. Add a separate per-turn `Delegation disabled` option that omits the
   model-facing subagent tool from the compiled tool manifest. Desktop/CLI
   explicit subagent controls remain available.

Do not implement this as UI-only hiding. Host tool compilation is the
authority. A disabled turn must not advertise or execute
`piwin_subagent_run`.

## 5. Contract and package changes

### `@piwin/contracts`

- Define the shared worker provider auth descriptor instead of maintaining
  structurally mirrored auth unions.
- Add a narrowly named ephemeral provider-secret type for the in-memory
  `SubagentTaskRunInput` path, documented as non-serializable and
  non-persistable.
- Add a stable unavailable/secret-bootstrap error code if the existing tool
  result error vocabulary cannot represent it.
- Add the per-turn delegation mode only if the UX slice is implemented.

### `@piwin/host-runtime`

- Extend worker blueprint compilation with `requiredProviderIds`.
- Resolve `apiKeyRef` into bootstrap ids plus ephemeral secret material.
- Keep `apiKeyEnv` behavior unchanged.
- Pass ephemeral material from `prepareSubagentTask()` to `WorkerTaskRunner`.
- Perform availability checks before child registration and apply
  model-tool fallback semantics.
- Compile out the delegation tool when the turn disables delegation.

### `@piwin/agent-host`

- Add the fourth child-process pipe and a bounded bootstrap writer/reader.
- Delay the worker hello frame until bootstrap validation succeeds.
- Advertise a bumped worker protocol capability for provider-secret bootstrap.
- Resolve `auth.kind = 'bootstrap'` only inside worker provider registration.
- Drop bootstrap maps after registration and close the pipe on success,
  timeout, malformed input, abort, or worker exit.
- Keep Pi imports and worker protocol implementation inside this package.

### Desktop and CLI

- No secret handling.
- Clarify Freehand versus Delegation disabled.
- Render the stable unavailable error without an internal stack trace.

### Documentation

- Amend ADR 0012's provider-secret-channel decision; this changes an accepted
  architecture rule and cannot land as code-only behavior.
- Update architecture and user-facing provider/delegation guidance.

## 6. Security invariants

1. Secret bootstrap payload maximum: 64 KiB total and 16 KiB per value.
2. Secret ids are random, generation-scoped, and single-use.
3. Parent sends only secrets referenced by the compiled provider envelopes.
4. Worker rejects missing, duplicate, unreferenced, or oversized secret ids.
5. No secret in JSONL, argv, environment, temp files, logs, errors,
   transcripts, pushes, snapshots, tests, or run manifests.
6. Redaction tests use canary values and inspect both parent and worker
   diagnostic output.
7. Bootstrap timeout terminates the worker; it does not fall back to inline
   JSONL auth.
8. Runtime reload or provider change creates a new generation and a fresh
   bootstrap. Secrets are never refreshed through an old worker channel.
9. SDK mode keeps resolving keychain references in process; both backends use
   the same provider-selection semantics.

## 7. Implementation sequence

### Slice A — regression and provider scoping

1. Add an incident fixture with parent `custom-openai/gpt-5.6-sol`, Reviewer
   without a model, and `custom-openai` configured with only `apiKeyRef`.
2. Add an unrelated enabled `apiKeyRef` provider to the fixture.
3. Change compiler selection so the child envelope contains only
   `custom-openai`.
4. Keep the test failing on the missing bootstrap channel.

Acceptance: model inheritance and least-provider selection are proven without
weakening the current fail-closed secret rule.

### Slice B — contracts and one-shot bootstrap

1. Add contracts and remove/alias mirrored provider auth types.
2. Implement pipe framing and protocol capability negotiation.
3. Resolve bootstrap auth during worker provider registration.
4. Add timeout, malformed input, close, and worker-crash tests.

Acceptance: the incident fixture completes and no canary secret appears in any
JSONL or diagnostic capture.

### Slice C — orchestration preflight and fallback

1. Move preparation far enough ahead that credential failure does not create a
   durable child.
2. Add stable freehand and scheme fallback behavior.
3. Ensure explicit batches return a truthful error.

Acceptance: missing credentials create no empty child session and the parent
model can continue the requested review itself.

### Slice D — delegation UX truth

1. Rename `None` to `Freehand` with accurate copy.
2. Add `Delegation disabled` and enforce it in Host tool compilation.
3. Cover Desktop, CLI, and direct Host command behavior.

Acceptance: a disabled turn cannot invoke a model-facing subagent, while
Freehand remains autonomous and scheme mode retains its roster constraints.

### Slice E — ADR, docs, and full verification

1. Amend ADR 0012.
2. Update architecture and provider/delegation guide.
3. Run targeted tests, then repository typecheck, tests, and architecture
   checks.

## 8. Required tests

- parent model inheritance into built-in Reviewer;
- profile/member/per-call model precedence remains unchanged;
- selected `apiKeyRef` provider succeeds through bootstrap;
- selected `apiKeyEnv` provider keeps the existing path;
- no-auth local provider remains supported;
- unrelated `apiKeyRef` provider is neither resolved nor sent;
- keychain missing, resolver failure, malformed bootstrap, oversized payload,
  timeout, abort, and worker crash;
- secret canary absent from serialized worker frames, stderr/stdout diagnostics,
  Host pushes, transcript rows, and subagent run JSON;
- one secret cannot be reused by a second generation;
- scheme `fallback: main` and freehand fallback;
- delegation-disabled tool manifest omits the subagent tool;
- SDK/worker conformance for the same selected provider and model.

## 9. Explicit non-solutions

- Do not require users to replace keychain-backed providers with
  `apiKeyEnv`.
- Do not serialize inline API keys in `session/create` JSONL.
- Do not copy provider secrets into profiles or orchestration schemes.
- Do not inject secrets into global `process.env` or mutate it around worker
  spawn; concurrent workers make that race-prone.
- Do not disable worker isolation for Reviewer tasks as a hidden fallback.
- Do not let one unrelated enabled provider block a fixed-model child.
- Do not treat process isolation as protection from malicious code running as
  the same OS user.

## 10. Temporary operator workaround

Until the bootstrap channel lands, the only supported worker path is an
`apiKeyEnv` whose value exists in the Host process environment. Because the
current compiler scans every enabled provider, all enabled ref-only providers
may also need an environment reference or must be disabled for the workaround
to succeed.

This is operational relief only. It is not the product fix and should not be
presented as a requirement for keychain users.

## 11. Verification record

- `pnpm typecheck` passes across all workspace projects.
- `pnpm test:architecture` passes package-boundary checks.
- Targeted worker, compiler, orchestration, and Desktop regression suites pass.
- The repository-wide `pnpm test` reaches the Desktop suite, where the current
  dirty worktree still reports three asynchronous `window is not defined`
  errors from `MarkdownView.test.tsx` after test teardown. The files involved
  are outside this repair; the focused Desktop suite for the delegation UI
  passes.
