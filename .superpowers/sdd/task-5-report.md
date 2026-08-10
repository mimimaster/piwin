# Task 5 implementation report

## Scope

Implemented Task 5 only: provider-backed video-generation discovery metadata now participates in the existing video suggestion flow with provider > registry > heuristic precedence. Existing image discovery and the ADR 0043 registry/heuristic implementation were preserved.

## Changes

- `packages/contracts/src/config.ts`
  - Added `'provider'` to `DiscoveredModel.videoGenerationSuggestion.reason`.
  - Updated the contract documentation to distinguish provider, registry, and heuristic enrichment.
- `packages/host-runtime/src/provider-model-capabilities.ts`
  - Added the pure `readExplicitVideoGenerationMetadata()` helper.
  - Recognizes only explicit Google long-running generation methods and explicit provider capability declarations.
  - Ignores bare video input modalities and does not retain provider payloads.
- `packages/host-runtime/src/provider-model-discovery.ts`
  - Carries only normalized provider video metadata through the private parse/enrichment boundary.
  - Applies provider metadata before the existing curated registry and heuristic layers.
  - Provider enrichment adds `video-generation` and only normalized provider style/path fields; registry and heuristic behavior remains unchanged.
- `packages/contracts/src/model-catalog.test.ts`
  - Added focused Sora/Veo registry and Kling/Pika/video-understanding heuristic contract coverage.
- `packages/host-runtime/src/provider-model-capabilities.test.ts`
  - Added the required Google metadata and bare video-input cases.
- `packages/host-runtime/src/provider-model-discovery.test.ts`
  - Added Sora and Veo registry discovery, provider-over-registry precedence, Kling/Pika heuristic, and video-understanding negative cases.

The Desktop import path remains unchanged and continues to merge only normalized discovery fields into configured models, preserving existing configured values and never persisting provider payloads or the transient suggestion object.

## Validation

Passed:

```text
pnpm --filter @piwin/contracts test -- src/model-catalog.test.ts
  18 tests passed

pnpm --filter @piwin/host-runtime test -- src/provider-model-capabilities.test.ts src/provider-model-discovery.test.ts
  15 tests passed across 2 files

pnpm --filter @piwin/contracts typecheck
  passed

git diff --cached --check && git diff --check
  passed
```

The required Host typecheck was run:

```text
pnpm --filter @piwin/host-runtime typecheck
```

It is blocked by pre-existing unrelated `TS2379` exact-optional-property errors in the current ADR/native-search worktree changes:

- `packages/agent-host/src/native-web-search.ts:52,69,72`
- `packages/agent-host/src/pi-model-runtime.ts:146`
- `packages/agent-host/src/rpc/worker-pi-session-factory.ts:207`
- `packages/host-runtime/src/blueprint-compiler.ts:526,539`

No Task 5 source error remains in that output.

## Staging

Only Task 5 contract/helper/discovery/test hunks and the Task 5 report are intended for the Task 5 commit. Unrelated Desktop, image-generation, native-search, and current ADR 0043 worktree changes remain unstaged. The existing ADR 0043 registry/heuristic source in `packages/contracts/src/model-catalog.ts` and its corresponding existing Host enrichment hunk remain in the worktree as the preserved dependency for this incremental Task 5 change. The staged Host discovery delta therefore depends on that existing unstaged ADR 0043 implementation; staging it independently would require also staging those pre-existing registry/heuristic hunks.

## Follow-up dependency fix

Committed `5975096` (`fix: include video discovery registry dependency`) as a follow-up to `b2b048d`. It contains only `packages/contracts/src/model-catalog.ts`, adding the ADR 0043 `VideoGenerationRegistryEntry`, `VIDEO_GENERATION_MODEL_REGISTRY`, `lookupVideoGenerationRegistry()`, and `isLikelyVideoGenerationModel()` implementation required by Task 5. The clean-checkout sequence `560c736 + b2b048d + 5975096` is self-contained for this dependency.

## Follow-up validation

Passed:

```text
pnpm --filter @piwin/contracts test -- src/model-catalog.test.ts
  18 tests passed

pnpm --filter @piwin/host-runtime test -- src/provider-model-capabilities.test.ts src/provider-model-discovery.test.ts
  15 tests passed across 2 files

pnpm --filter @piwin/contracts typecheck
  passed
```
