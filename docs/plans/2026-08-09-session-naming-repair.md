# Session naming repair plan

| Field | Value |
|---|---|
| Date | 2026-08-09 |
| Status | Completed |
| Incident | `session-msisgx7g-c6qhavyk` |
| Authority | ADR 0019 + `@piwin/host-runtime` |

## 1. Incident evidence

The session index persisted:

```text
name: [piwin-mode:agent] [piwin-… - 4
nameSource: text
```

Its first product-transcript user message begins with the old Desktop-injected
`[piwin-mode:agent]` operating contract and only reaches the human text after
`---\nUser:`. Six other records have the same leaked base title, which explains
the uniqueness suffix `- 4` on this record. Running the repaired text
derivation read-only against the actual transcript produces
`排查下为什么piwin 空窗口Tool definitions…`.

The session was created on 2026-08-07, before commit `801424a` moved agent-mode
contract injection to Host-owned model-facing prompt preparation. Its title
upgrade also used the historical 50-token completion budget with
`deepseek-v4-flash`; reasoning-compatible responses could exhaust that budget
in `reasoning_content` and return empty `content`. The completion helper reduced
all HTTP/network/empty-output failures to `null`, so the text fallback remained.

## 2. Target flow

1. Create an unnamed draft; it is not listed yet.
2. On first prompt, persist the raw user text and derive an immediate bounded
   text title (`nameSource: text`).
3. Build a separate model-facing prompt and add agent-mode, orchestration,
   context, and media injections only there.
4. After a completed exchange, make one best-effort lightweight title request
   from bounded human text plus assistant reply. A valid result upgrades the
   record to `nameSource: llm`; failure keeps the usable text title and may retry
   on a later completed exchange.
5. Manual rename writes `nameSource: user`; neither automatic path may overwrite
   it.
6. During list hydration or direct resume, strictly identifiable legacy
   `nameSource: text` titles beginning with known `[piwin-*]` internal markers
   are rebuilt from the first transcript user body. Clean, LLM, and user titles
   are never migration targets.

## 3. Implementation slices

- `@piwin/session`: narrow legacy-title classifier and guarded repair mutation.
- `@piwin/host-runtime`: repair orchestration on list/resume; sanitized and
  bounded title-model input; bounded provider request duration.
- Docs: update ADR 0019 to reflect raw/model prompt separation, current
  `text|llm|user` states, reasoning-model budget, and one-time repair policy.
- Tests: pure classifier/store guards, target-shaped repair fixture, provider
  prompt sanitation, timeout signal, session list/resume integration, package
  typechecks.

## 4. Safety constraints

- Never rewrite `nameSource: user` or `nameSource: llm`.
- Never infer a repair from a generic poor title; require a known internal
  prefix and a valid human body from the product transcript.
- Naming failure must not fail or delay an Agent run terminal transition.
- Repair is metadata-only and must not change `updatedAt` or session ordering.
- Host remains the sole writer and publishes `session/name-updated` after a
  repair for multi-client convergence.

## 5. Verification record

Completed on 2026-08-09:

- `pnpm --filter @piwin/session test`: 24 files, 163 tests passed.
- `pnpm --filter @piwin/host-runtime test`: 98 files, 952 tests passed.
- `pnpm --filter @piwin/session typecheck`: passed.
- `pnpm --filter @piwin/host-runtime typecheck`: passed.
- `pnpm typecheck`: all 29 participating workspace projects passed.
- `pnpm test:architecture`: package boundaries passed.
- `git diff --check`: passed.

The root `pnpm test` reached Desktop after every earlier workspace package
passed, then stopped on three pre-existing failures in the unrelated,
worktree-local `apps/desktop/src/resolve-document-content.test.ts`. The focused
session and Host Runtime suites above are green, including two HostRuntime
integration cases for list hydration and direct resume.

The live development Host was deliberately not restarted or given a second
writer during verification. Once it is restarted onto this code, the next
session list hydration or direct resume persists the guarded repair and emits
`session/name-updated`.
