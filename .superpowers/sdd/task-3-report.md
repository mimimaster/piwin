# Task 3 Report: Evaluate SVG through the existing Artifact srcdoc pipeline

## Implementation

- `packages/artifact/src/evaluate.ts:19` now imports the generic `ArtifactDescriptor` union.
- `packages/artifact/src/evaluate.ts:78` routes parsed descriptors from `evaluateCodeFence` through `evaluateArtifactDescriptor`.
- `packages/artifact/src/evaluate.ts:94-159` renames the existing evaluator implementation to `evaluateArtifactDescriptor(descriptor: ArtifactDescriptor, ...)` without changing the security, theme-repair, streaming, or `buildHtmlArtifactSrcdoc` pipeline.
- `packages/artifact/src/evaluate.ts:161-166` adds the backward-compatible `evaluateHtmlArtifactDescriptor` delegating wrapper.
- `packages/artifact/src/index.ts:130-134` exports both evaluator functions.
- `packages/artifact/src/evaluate.test.ts:73-88` adds the specified safe SVG fence render test, including raw SVG descriptor, wrapped SVG, CSP, and bridge assertions.

The SVG path reuses `buildHtmlArtifactSrcdoc` unchanged. Security classification remains on `descriptor.source`, so the raw SVG source remains available in `decision.descriptor.source`; the generated `decision.srcdoc` contains the wrapped SVG and existing bridge bootstrap.

## TDD evidence

### RED attempt before implementation

Command:

```bash
pnpm --filter @piwin/artifact test -- src/evaluate.test.ts
```

Result: unexpectedly **GREEN** before the evaluator rename: `src/evaluate.test.ts (6 tests)` and `Tests 6 passed`.

The brief expected this test to fail because the parser would return `code` for SVG. In the actual checkout, Task 2's parser changes are already present in `d3d6e33`, and `tryParseHtmlArtifactFence` already returns an SVG descriptor at `packages/artifact/src/parser.ts:163-175`. The old evaluator also worked at runtime because the descriptor is structurally passed through, even though its TypeScript signature was too narrow.

The known pre-implementation type failure was reproduced with:

```bash
pnpm --filter @piwin/artifact typecheck
```

Result: **RED**, exit status 2:

```text
src/evaluate.ts(78,41): error TS2345: Argument of type 'ArtifactDescriptor' is not assignable to parameter of type 'HtmlArtifactDescriptor'.
  Type 'SvgArtifactDescriptor' is not assignable to type 'HtmlArtifactDescriptor'.
```

The SVG test was not weakened to manufacture a runtime failure.

### GREEN after implementation

Focused evaluator test:

```bash
pnpm --filter @piwin/artifact test -- src/evaluate.test.ts
```

Result: **GREEN**, `src/evaluate.test.ts (6 tests)`, `Tests 6 passed`, exit 0.

Artifact package suite:

```bash
pnpm --filter @piwin/artifact test
```

Result: **GREEN**, `11` test files and `70` tests passed, exit 0. Existing bridge, streaming, parser, security, srcdoc, theme, height, init-queue, and evaluator tests remained green.

Artifact package typecheck:

```bash
pnpm --filter @piwin/artifact typecheck
```

Result: **GREEN**, no diagnostics, exit 0.

Additional hygiene check:

```bash
git diff --check
```

Result: no whitespace errors, exit 0.

## Files changed

- `packages/artifact/src/evaluate.ts`
- `packages/artifact/src/index.ts`
- `packages/artifact/src/evaluate.test.ts`
- `.superpowers/sdd/task-3-report.md` (this report)

No SVG-specific srcdoc builder was added, and `packages/artifact/src/srcdoc.ts` was not modified.

## Self-review

- Confirmed `evaluateCodeFence` calls the generic evaluator.
- Confirmed the generic evaluator accepts the `ArtifactDescriptor` union and returns the existing `ArtifactPreviewDecision` union.
- Confirmed the compatibility wrapper delegates directly and remains exported.
- Confirmed `descriptor.source` is still used for security classification and is not replaced by repaired/render source.
- Confirmed theme repair and bridge bootstrap behavior are unchanged.
- Confirmed the required srcdoc assertions match actual output: the CSP text appears in the HTML attribute (apostrophes remain unescaped) and `piwin-artifact:ready` appears in the bridge bootstrap.
- The working tree contained unrelated pre-existing changes in `apps/desktop/src/pet-overlay-app.tsx` and untracked `apps/desktop/src/pet-overlay-app.test.tsx`; they were left untouched and are not included in the task commit.

## Concerns

No implementation or verification concerns. The only process deviation is that the brief's expected runtime RED could not be reproduced because the Task 2 parser already promotes SVG fences in this checkout; the pre-change TypeScript failure was reproduced and fixed.
