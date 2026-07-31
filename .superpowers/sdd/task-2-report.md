# Task 2 Report: Parse SVG fences and classify SVG external resources

## What was implemented

- `packages/artifact/src/parser.ts:5-24, 115-201`
  - Imported `NATIVE_SVG_ARTIFACT_LANGUAGES` and `ArtifactDescriptor`.
  - Added `NATIVE_SVG_SET`, the required `SVG_SOURCE_PATTERN`, `isNativeSvgLanguage`, and `isSvgSource`.
  - Renamed the implementation to exported `tryParseArtifactFence`, returning `ArtifactDescriptor | null`.
  - Added the SVG branch before native HTML parsing. It requires Artifact/UI mode and a valid SVG-root source, preserves raw source, and uses the parsed title or `SVG`.
  - Kept `tryParseHtmlArtifactFence` as an exported compatibility wrapper delegating to `tryParseArtifactFence`.

- `packages/artifact/src/security.ts:21-28`
  - Added the required `<image>`/`<use>` external `href`, `xlink:href`, and `src` pattern with existing resource kind `image`.

- `packages/artifact/src/streaming.ts:5-16, 25-29, 46-52, 101-106`
  - Added `NATIVE_SVG_SET`, `SVG_LIKE_SOURCE_PATTERN`, `isNativeSvgLanguage`, and SVG recognition only to `findOpenArtifactFence`.
  - Left the ambiguous-fence normalizer unchanged, so standard SVG fences retain `svg` and remain source-only during streaming.

- Tests appended as specified:
  - `packages/artifact/src/parser.test.ts:45-81`
  - `packages/artifact/src/security.test.ts:88-97`
  - `packages/artifact/src/streaming.test.ts:24-28`

## TDD evidence

### RED

Command:

```bash
pnpm --filter @piwin/artifact test -- src/parser.test.ts src/security.test.ts src/streaming.test.ts
```

Result: expected failure. The focused run reported 3 failed new tests and 27 passed tests: SVG parser promotion, external SVG image/use classification, and open SVG fence detection each failed; all pre-existing cases passed.

### GREEN

Command:

```bash
pnpm --filter @piwin/artifact test -- src/parser.test.ts src/security.test.ts src/streaming.test.ts
```

Result: pass — 3 test files, 30 tests passed.

Full package verification command:

```bash
pnpm --filter @piwin/artifact test
```

Result: pass — 11 test files, 69 tests passed.

Additional checks:

```bash
git diff --check
```

Result: pass with no whitespace errors.

## Files changed

- `packages/artifact/src/parser.ts`
- `packages/artifact/src/parser.test.ts`
- `packages/artifact/src/security.ts`
- `packages/artifact/src/security.test.ts`
- `packages/artifact/src/streaming.ts`
- `packages/artifact/src/streaming.test.ts`

## Self-review findings

- The required SVG root pattern is copied verbatim and accepts an optional XML declaration, a root `<svg>`, and either a closing `</svg>` or self-closing `/>` form.
- The SVG parser branch is before native HTML parsing and returns `null` for disabled mode or non-SVG source, preserving ordinary-code behavior.
- The security expression is the required exact pattern and reports both SVG references as `image` resources.
- SVG was not added to the ambiguous-fence normalizer; only open-fence discovery was extended.
- `git diff --check` is clean and the full artifact test suite is green.

## Concerns

`pnpm --filter @piwin/artifact typecheck` currently fails at the pre-existing Task 1/Task 3 boundary in `packages/artifact/src/evaluate.ts:78`: `tryParseHtmlArtifactFence` now correctly returns `ArtifactDescriptor`, while `evaluateHtmlArtifactDescriptor` still accepts only `HtmlArtifactDescriptor`. The implementation plan assigns the generic evaluator/signature update to Task 3, and Task 2 explicitly says not to change evaluator/UI code, so evaluator code was intentionally left untouched. Task 3 should resolve this before workspace typecheck.
