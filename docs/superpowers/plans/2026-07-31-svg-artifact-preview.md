# SVG Artifact Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make standard fenced `svg` blocks render as safe, source-first Artifact previews when the existing Desktop Artifact preview capability is enabled.

**Architecture:** Extend the existing heavy Artifact pipeline with an explicit `svg` descriptor type. SVG stays inside the existing sandboxed `ArtifactFrame` (`sandbox="allow-scripts"`, strict CSP, external-resource classifier, height bridge, init queue, and theme contract); it is never injected into the parent chat DOM. The current Markdown-first policy remains unchanged: capability-off and streaming states show source only, while a completed capability-on message offers a per-fence `Preview SVG` action.

> Historical note (2026-08-09): the source-only streaming constraint below was
> superseded by ADR 0005's stable streaming Artifact amendment. Capability-off
> SVG remains source-only; enabled SVG preview now uses sanitized snapshots in
> one stable sandboxed iframe.

**Tech Stack:** TypeScript strict ESM, Vitest, React 19, existing `@piwin/artifact` runtime, existing Desktop `MarkdownView`/`ArtifactFrame`, pnpm workspace.

## Global Constraints

- Treat model-produced SVG as untrusted; do not add parent-document `innerHTML`/`dangerouslySetInnerHTML` rendering.
- Reuse the existing Artifact sandbox, CSP, security classifier, height bridge, theme repair, and init queue; do not add a second iframe or a new SVG dependency.
- `artifactPreviewEnabled` remains `false` by default; `svg` is source-only when the capability is off.
- Streaming remains source-only and never mounts an Artifact iframe.
- Raw model source remains the value copied and shown in the source disclosure; the generated `srcdoc` is never copied.
- Keep `@piwin/artifact` framework-free and portable; Desktop-only wording belongs in `apps/desktop`.
- Preserve existing HTML and flashcard behavior, public HTML descriptor compatibility, strict TypeScript settings, and colocated Vitest conventions.
- Run the touched package tests and typechecks before the full workspace verification.

## File Map

- Modify `packages/contracts/src/artifact.ts` to expose the shared `svg` language and descriptor union.
- Modify `packages/artifact/src/constants.ts` and `packages/artifact/src/index.ts` to expose the SVG language constant.
- Modify `packages/artifact/src/types.ts` to add `ArtifactDescriptor`/`SvgArtifactDescriptor` while retaining `HtmlArtifactDescriptor` for HTML callers.
- Modify `packages/artifact/src/parser.ts` to parse valid-root `svg` fences only when Artifact parsing is enabled; retain `tryParseHtmlArtifactFence` as a compatibility wrapper.
- Modify `packages/artifact/src/security.ts` to classify external SVG image/use references using the existing `image` resource kind.
- Modify `packages/artifact/src/streaming.ts` so an open `svg` fence is closed synthetically only for source-safe Markdown streaming normalization.
- Modify `packages/artifact/src/evaluate.ts` and `packages/artifact/src/index.ts` to expose the generic descriptor evaluator while retaining the existing HTML-named evaluator.
- Modify `packages/artifact/src/parser.test.ts`, `security.test.ts`, `streaming.test.ts`, and `evaluate.test.ts` for parser, security, streaming, and srcdoc coverage.
- Modify `apps/desktop/src/MarkdownView.tsx` to show `Preview SVG` for an SVG Artifact decision without changing the capability or streaming gates.
- Modify `apps/desktop/src/ArtifactFrame.tsx` to label blocked/source states as SVG when appropriate.
- Modify `apps/desktop/src/MarkdownView.test.tsx` for capability-off, capability-on, and streaming SVG behavior.
- Modify `docs/artifact-research.md`, `docs/adr/0005-artifact-and-media.md`, and `docs/todo-deferred.md` to distinguish shipped heavy SVG previews from the still-deferred light renderer.

---

### Task 1: Add the shared SVG Artifact descriptor contract

**Files:**
- Modify: `packages/contracts/src/artifact.ts`
- Modify: `packages/artifact/src/constants.ts`
- Modify: `packages/artifact/src/types.ts`
- Modify: `packages/artifact/src/index.ts`
- Test: `packages/contracts/src/artifact.test.ts`

**Interfaces:**
- Produces `NATIVE_SVG_ARTIFACT_LANGUAGES = ['svg'] as const` from both the shared contract and the runtime constants.
- Produces `ArtifactDescriptorBase`, `HtmlArtifactDescriptor`, `SvgArtifactDescriptor`, and `ArtifactDescriptor = HtmlArtifactDescriptor | SvgArtifactDescriptor` from `@piwin/artifact`.
- Keeps `HtmlArtifactDescriptor` HTML-only so existing HTML consumers remain type-safe.
- Changes `ArtifactPreviewDecision` descriptor fields to use `ArtifactDescriptor`.

- [ ] **Step 1: Write the failing contract test**

Create `packages/contracts/src/artifact.test.ts` with this exact test:

```ts
import { describe, expect, it } from 'vitest';
import { NATIVE_SVG_ARTIFACT_LANGUAGES } from './artifact.js';

describe('SVG artifact contract', () => {
  it('declares the standard svg fence language', () => {
    expect(NATIVE_SVG_ARTIFACT_LANGUAGES).toEqual(['svg']);
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
pnpm --filter @piwin/contracts test -- src/artifact.test.ts
```

Expected: `FAIL` because `NATIVE_SVG_ARTIFACT_LANGUAGES` is not exported yet.

- [ ] **Step 3: Add the shared constant and descriptor union**

In `packages/contracts/src/artifact.ts`, add the constant immediately after `NATIVE_HTML_ARTIFACT_LANGUAGES` and replace the single HTML-only descriptor with this compatible model:

```ts
export const NATIVE_SVG_ARTIFACT_LANGUAGES = ['svg'] as const;

export type ArtifactDescriptorBase = {
  id: string;
  title: string;
  source: string;
  rawLanguage: string;
  alias: string;
};

export type HtmlArtifactDescriptor = ArtifactDescriptorBase & {
  type: 'html';
};

export type SvgArtifactDescriptor = ArtifactDescriptorBase & {
  type: 'svg';
};

export type ArtifactDescriptor = HtmlArtifactDescriptor | SvgArtifactDescriptor;
```

In `packages/artifact/src/constants.ts`, add the same runtime constant after `NATIVE_HTML_ARTIFACT_LANGUAGES`:

```ts
export const NATIVE_SVG_ARTIFACT_LANGUAGES = ['svg'] as const;
```

In `packages/artifact/src/types.ts`, replace the existing `HtmlArtifactDescriptor` declaration with the same four type declarations, then change every `descriptor: HtmlArtifactDescriptor` in `ArtifactPreviewDecision` to `descriptor: ArtifactDescriptor`.

- [ ] **Step 4: Export the new runtime constant and types**

In `packages/artifact/src/index.ts`, export `NATIVE_SVG_ARTIFACT_LANGUAGES` with the other constants and export `ArtifactDescriptorBase`, `ArtifactDescriptor`, and `SvgArtifactDescriptor` with the existing artifact types. Keep `HtmlArtifactDescriptor` in the export list.

- [ ] **Step 5: Run the contract and artifact typechecks**

Run:

```bash
pnpm --filter @piwin/contracts test -- src/artifact.test.ts
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/artifact typecheck
```

Expected: the contract test passes and both typechecks exit with code 0.

---

### Task 2: Parse SVG fences and classify SVG external resources

**Files:**
- Modify: `packages/artifact/src/parser.ts`
- Modify: `packages/artifact/src/security.ts`
- Modify: `packages/artifact/src/streaming.ts`
- Test: `packages/artifact/src/parser.test.ts`
- Test: `packages/artifact/src/security.test.ts`
- Test: `packages/artifact/src/streaming.test.ts`

**Interfaces:**
- `tryParseArtifactFence(input)` returns `ArtifactDescriptor | null`.
- `tryParseHtmlArtifactFence(input)` remains exported and delegates to `tryParseArtifactFence` so existing callers keep working.
- Native `svg` parsing requires `htmlUiModeEnabled !== false` and a source whose root is `<svg>` (optionally preceded by one XML declaration); malformed or non-SVG `svg` fences remain ordinary code.
- External `<image ... href="https://...">`, `<image ... xlink:href="https://...">`, `<use ... href="https://...">`, and equivalent `src` forms are reported as existing `image` external resources.
- Streaming recognizes an open `svg` fence for synthetic Markdown fence closure but does not mount or execute it.

- [ ] **Step 1: Add failing parser, security, and streaming tests**

Append these cases to `packages/artifact/src/parser.test.ts`:

```ts
  it('promotes a valid svg fence when Artifact parsing is enabled', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'svg title="Pelican"',
      source: '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"><circle r="5" /></svg>',
      id: 'svg-1',
      htmlUiModeEnabled: true,
    });
    expect(descriptor).toMatchObject({
      type: 'svg',
      title: 'Pelican',
      rawLanguage: 'svg title="Pelican"',
      alias: 'svg',
    });
    expect(descriptor?.source).toContain('<svg');
  });

  it('keeps svg source as code when Artifact parsing is disabled', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'svg',
        source: '<svg><circle r="5" /></svg>',
        id: 'svg-2',
        htmlUiModeEnabled: false,
      }),
    ).toBeNull();
  });

  it('rejects a non-svg source in an svg fence', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'svg',
        source: '<div>not an SVG</div>',
        id: 'svg-3',
        htmlUiModeEnabled: true,
      }),
    ).toBeNull();
  });
```

Append this case to `packages/artifact/src/security.test.ts`:

```ts
  it('blocks external SVG image and use references', () => {
    const result = classifyArtifactSecurity(`
      <svg>
        <image href="https://cdn.example.com/pelican.png" />
        <use xlink:href="https://cdn.example.com/symbol.svg#bird" />
      </svg>
    `);
    expect(result.blockReason).toBe('blocked-external-resource');
    expect(result.externalResources.map((resource) => resource.kind)).toEqual(['image', 'image']);
  });
```

Append this case to `packages/artifact/src/streaming.test.ts`:

```ts
  it('finds an incomplete svg fence for source-safe normalization', () => {
    const open = findOpenArtifactFence('```svg\n<svg viewBox="0 0 10 10"><circle r="5" />', true);
    expect(open).not.toBeNull();
    expect(open?.info).toBe('svg');
  });
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @piwin/artifact test -- src/parser.test.ts src/security.test.ts src/streaming.test.ts
```

Expected: `FAIL` because the parser does not yet recognize `svg`, the SVG resource pattern is absent, and streaming only knows HTML languages.

- [ ] **Step 3: Implement SVG parser recognition**

In `packages/artifact/src/parser.ts`:

1. Import `NATIVE_SVG_ARTIFACT_LANGUAGES` and `ArtifactDescriptor`.
2. Add `NATIVE_SVG_SET` beside the existing language sets.
3. Add this root check after `HTML_LIKE_SOURCE_PATTERN`:

```ts
const SVG_SOURCE_PATTERN =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b[\s\S]*(?:<\/svg\s*>|\/>)\s*$/i;
```

4. Add `isNativeSvgLanguage` and `isSvgSource` helpers using `getAlias` and `SVG_SOURCE_PATTERN.test(source)`.
5. Rename the implementation function to `tryParseArtifactFence` and return `ArtifactDescriptor | null`.
6. Before the native HTML branch, add:

```ts
  if (isNativeSvgLanguage(rawLanguage)) {
    if (!htmlUiModeEnabled || !isSvgSource(source)) {
      return null;
    }
    return {
      id: input.id,
      type: 'svg',
      title: parseTitle(rawLanguage) ?? 'SVG',
      source,
      rawLanguage,
      alias,
    };
  }
```

7. Keep existing HTML branches returning `type: 'html'`.
8. Add the compatibility wrapper after the implementation:

```ts
export function tryParseHtmlArtifactFence(input: {
  language: string;
  source: string;
  id: string;
  htmlUiModeEnabled?: boolean;
}): ArtifactDescriptor | null {
  return tryParseArtifactFence(input);
}
```

- [ ] **Step 4: Implement SVG external-reference classification**

In `packages/artifact/src/security.ts`, add this entry after the existing `<img>` pattern:

```ts
  {
    kind: 'image',
    pattern:
      /<(?:image|use)\b[^>]*\b(?:href|xlink:href|src)\s*=\s*(['"])(https?:\/\/[^'"]+)\1/gi,
  },
```

Keep the existing resource kind as `image` so `ArtifactSecurityResult` and blocked-state UI remain compatible.

- [ ] **Step 5: Implement streaming SVG recognition**

In `packages/artifact/src/streaming.ts`:

1. Import `NATIVE_SVG_ARTIFACT_LANGUAGES`.
2. Create `NATIVE_SVG_SET` beside `NATIVE_HTML_SET`.
3. Add:

```ts
const SVG_LIKE_SOURCE_PATTERN = /<\s*svg\b/i;

function isNativeSvgLanguage(info: string): boolean {
  return NATIVE_SVG_SET.has(getAlias(info));
}
```

4. Add this clause to the `findOpenArtifactFence` condition:

```ts
      (isNativeSvgLanguage(info) && SVG_LIKE_SOURCE_PATTERN.test(source))
```

Do not add SVG to the ambiguous-fence normalizer; a standard `svg` fence should retain its language and remain source-only during streaming.

- [ ] **Step 6: Run the focused tests and verify they pass**

Run:

```bash
pnpm --filter @piwin/artifact test -- src/parser.test.ts src/security.test.ts src/streaming.test.ts
```

Expected: all focused parser, security, and streaming tests pass, including the pre-existing HTML cases.

---

### Task 3: Evaluate SVG through the existing Artifact srcdoc pipeline

**Files:**
- Modify: `packages/artifact/src/evaluate.ts`
- Modify: `packages/artifact/src/index.ts`
- Test: `packages/artifact/src/evaluate.test.ts`

**Interfaces:**
- `evaluateArtifactDescriptor(descriptor: ArtifactDescriptor, options?: EvaluateDescriptorOptions)` is the generic evaluator.
- `evaluateHtmlArtifactDescriptor` remains exported and delegates to the generic evaluator for backward compatibility.
- `evaluateCodeFence({ language: 'svg', source, htmlUiModeEnabled: true })` returns a render/blocked decision using the same CSP and `srcdoc` builder as HTML Artifacts.
- The raw SVG source remains in `decision.descriptor.source`; the generated `decision.srcdoc` contains the wrapped SVG and existing bridge bootstrap.

- [ ] **Step 1: Add the failing evaluator test**

Append this case to `packages/artifact/src/evaluate.test.ts`:

```ts
  it('renders a safe svg fence through the Artifact srcdoc pipeline', () => {
    const decision = evaluateCodeFence({
      language: 'svg',
      source: '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>',
      id: 'svg-render',
      htmlUiModeEnabled: true,
    });
    expect(decision.kind).toBe('render');
    if (decision.kind === 'render') {
      expect(decision.descriptor.type).toBe('svg');
      expect(decision.descriptor.source).toContain('<svg');
      expect(decision.srcdoc).toContain('<svg viewBox="0 0 100 60">');
      expect(decision.srcdoc).toContain("default-src 'none'");
      expect(decision.srcdoc).toContain('piwin-artifact:ready');
    }
  });
```

- [ ] **Step 2: Run the evaluator test and verify it fails**

Run:

```bash
pnpm --filter @piwin/artifact test -- src/evaluate.test.ts
```

Expected: `FAIL` because the parser currently returns `code` for `svg`.

- [ ] **Step 3: Add the generic descriptor evaluator**

In `packages/artifact/src/evaluate.ts`:

1. Import `ArtifactDescriptor`.
2. Rename the implementation function to `evaluateArtifactDescriptor` and change its parameter type to `ArtifactDescriptor`.
3. Add a compatibility function below it:

```ts
export function evaluateHtmlArtifactDescriptor(
  descriptor: ArtifactDescriptor,
  options: EvaluateDescriptorOptions = {},
): ArtifactPreviewDecision {
  return evaluateArtifactDescriptor(descriptor, options);
}
```

4. Change `evaluateCodeFence` to call `evaluateArtifactDescriptor(descriptor, evaluateOptions)`.
5. Keep security classification on `descriptor.source`, keep theme repair and `buildHtmlArtifactSrcdoc` unchanged, and do not add a second SVG-specific srcdoc builder.

- [ ] **Step 4: Export the generic evaluator**

In `packages/artifact/src/index.ts`, export both `evaluateArtifactDescriptor` and `evaluateHtmlArtifactDescriptor`.

- [ ] **Step 5: Run evaluator tests and typecheck**

Run:

```bash
pnpm --filter @piwin/artifact test -- src/evaluate.test.ts
pnpm --filter @piwin/artifact typecheck
```

Expected: all evaluator tests pass and the artifact package typecheck exits with code 0. The existing HTML render, theme-repair, streaming, external-script, and non-artifact tests must remain green.

---

### Task 4: Expose the SVG preview affordance in Desktop

**Files:**
- Modify: `apps/desktop/src/MarkdownView.tsx`
- Modify: `apps/desktop/src/ArtifactFrame.tsx`
- Test: `apps/desktop/src/MarkdownView.test.tsx`

**Interfaces:**
- Capability-off behavior remains `data-testid="code-fence-source"` with no `artifact-preview-toggle` for `svg`.
- Capability-on completed behavior shows `data-testid="artifact-preview-toggle"` with button text `Preview SVG`.
- Clicking the existing toggle mounts the existing `ArtifactFrame`; no new component or DOM injection path is introduced.
- Blocked/source-disclosure labels use `SVG` for `descriptor.type === 'svg'` and `HTML UI` otherwise.

- [ ] **Step 1: Add failing Desktop tests**

Add this fixture beside the existing Markdown fixtures in `apps/desktop/src/MarkdownView.test.tsx`:

```ts
const SVG_FENCE =
  '```svg\n<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>\n```';
```

Add these tests inside the existing `MarkdownView artifact preview policy` suite:

```tsx
  it('capability off: svg fence stays ordinary source code', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('capability on: svg fence shows a Preview SVG toggle', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="completed" artifactPreviewEnabled />,
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain('Preview SVG');
  });

  it('streaming: svg never mounts an Artifact toggle', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="streaming" artifactPreviewEnabled />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).not.toBeNull();
  });
```

- [ ] **Step 2: Run the Desktop tests and verify they fail**

Run:

```bash
pnpm --filter @piwin/desktop test -- src/MarkdownView.test.tsx
```

Expected: the capability-on test fails because the current button always says `Preview artifact` and the parser does not yet produce an SVG render decision.

- [ ] **Step 3: Update the Markdown button label without changing the policy gates**

In `apps/desktop/src/MarkdownView.tsx`, immediately before the `return` that renders `.artifact-with-source`, derive the label from the decision:

```tsx
const previewLabel =
  decision.kind !== 'code' && decision.descriptor.type === 'svg'
    ? 'Preview SVG'
    : 'Preview artifact';
```

Replace only the button's closed-state text with `{artifactPreviewOpen ? 'Hide preview' : previewLabel}`. Keep the existing test id, `aria-expanded`, click handler, source block, blocked strip, and `ArtifactFrame` mount unchanged.

- [ ] **Step 4: Update ArtifactFrame content labels**

In `apps/desktop/src/ArtifactFrame.tsx`, add this pure helper before `ArtifactFrame`:

```tsx
function getArtifactContentLabel(type: 'html' | 'svg'): string {
  return type === 'svg' ? 'SVG' : 'HTML UI';
}
```

Inside `ArtifactFrame`, derive `const contentLabel = getArtifactContentLabel(decision.descriptor.type);` and replace the two fixed phrases as follows:

```tsx
Cannot preview this {contentLabel}: <code>{decision.reason}</code>
```

and:

```tsx
<summary>Source (raw model {contentLabel})</summary>
```

Apply the same source-summary wording in the `preparing` branch. Leave the iframe attributes, sandbox, bridge listener, height policy, and action checks unchanged.

- [ ] **Step 5: Run Desktop tests and typecheck**

Run:

```bash
pnpm --filter @piwin/desktop test -- src/MarkdownView.test.tsx
pnpm --filter @piwin/desktop typecheck
```

Expected: all existing Markdown policy tests plus the three SVG cases pass, and Desktop typecheck exits with code 0.

---

### Task 5: Record the shipped boundary and run full verification

**Files:**
- Modify: `docs/artifact-research.md`
- Modify: `docs/adr/0005-artifact-and-media.md`
- Modify: `docs/todo-deferred.md`

**Interfaces:**
- Documentation states that standard `svg` fences use the existing heavy Artifact preview only when the Desktop capability is enabled.
- Documentation explicitly keeps the separate light, parent-document SVG renderer deferred; this prevents future work from bypassing the sandbox policy accidentally.

- [ ] **Step 1: Update the artifact research decision**

In `docs/artifact-research.md` section `2. Markdown default`, replace the SVG row with:

```markdown
| SVG | standard `svg` fences use the existing sandboxed Artifact iframe when Artifact preview is enabled; a light parent-document SVG renderer remains deferred |
```

- [ ] **Step 2: Add an ADR amendment**

Append this section to `docs/adr/0005-artifact-and-media.md`:

```markdown
## Amendment (2026-07-31): SVG fences use the heavy Artifact path

- Desktop recognizes valid-root `svg` fences as `SvgArtifactDescriptor` values when `artifactPreviewEnabled` is on.
- SVG preview reuses the existing sandbox iframe, strict CSP, external-resource classifier, theme contract, height bridge, and init queue; it is not inserted into the parent chat document.
- Capability-off and streaming behavior remain source-only.
- A separate light/native SVG renderer with pan/zoom is still deferred and must not share the heavy Artifact switch implicitly.
```

- [ ] **Step 3: Clarify the deferred item**

Change the `D-ART-12` row in `docs/todo-deferred.md` to:

```markdown
| D-ART-12 | Light fence registry (native svg / html-preview / Cherry-style) | heavy sandboxed `svg` preview shipped 2026-07-31; parent-document light rendering still needs its own sanitizer and UX | later |
```

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/artifact test
pnpm --filter @piwin/artifact typecheck
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/desktop typecheck
pnpm check
```

Expected: every command exits with code 0; the full check reports passing typechecks and tests across the workspace.

- [ ] **Step 5: Perform the manual smoke check**

Start the Desktop app with:

```bash
pnpm dev:desktop
```

Verify in the UI:

1. Appearance → Artifact preview is off by default.
2. A completed ` ```svg ` block shows source and Copy only while the switch is off.
3. Turning Artifact preview on makes the same block show `Preview SVG`.
4. Clicking `Preview SVG` renders the SVG inside the Artifact frame and leaves the raw source disclosure available.
5. An SVG containing an external `<image href="https://...">` shows the blocked state and does not mount a preview.
6. An SVG fence still shows source only while the assistant is streaming.
7. Existing `artifact-html`, plain `html`, Mermaid, and flashcard behavior is unchanged.

Plan complete and saved to `docs/superpowers/plans/2026-07-31-svg-artifact-preview.md`.
