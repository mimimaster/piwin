# Transcript Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat transcript Markdown keeps working for ordinary prose, and four independent rendering defects stop looking broken: Mermaid diagrams upgrade after the stream ends without a session remount, GFM task items lose the extra disc, GFM footnotes show their definition text, and bash fences stop using a list-like disc gutter.

**Architecture:** All work stays in `apps/desktop` chat Markdown (`MarkdownView` / Streamdown / `transcript-markdown.css`). Each defect has its own component or CSS section. Mermaid must keep a stable `MermaidBlock` mounted across `streaming` → `completed` because Streamdown retains its keyed block tree after live tokens (so Artifact iframes do not remount). Phase is pushed through a React context so `MermaidBlock` can re-render when `renderingPhase` flips even if Streamdown does not re-invoke `components.code`. Do not remount `Streamdown` on phase change.

**Tech Stack:** React 19, TypeScript strict, Streamdown 2.5, mermaid 11 (dynamic import), existing happy-dom + `createRoot` + `act` Markdown tests, Vitest, desktop CSS tokens in `transcript-markdown.css`.

## Global Constraints

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` stay on (AGENTS.md §3.1).
- ESM only; relative imports use `.js` extensions; `import type` for types.
- Apps never import `@earendil-works/pi-*`.
- No new npm dependencies.
- No `any`. No non-null assertion without a runtime check in the same block.
- No file over 1000 lines. `apps/desktop/src/MarkdownView.test.tsx` is already 1034 lines — **do not add tests there**. Put new coverage in new colocated test files or `markdown-rendering.test.tsx` (68 lines).
- Tests required for every logic change (AGENTS.md §3.5).
- Do **not** set Streamdown `mode` back to `static` after a live stream on the same mount (`usedStreamingRendererRef` in `MarkdownView.tsx`). That retention exists so Artifact iframes keep identity.
- Do **not** enable `singleDollarTextMath`. `$HOME` / `$100` must stay prose. Existing tests in `MarkdownView.test.tsx` (`does not treat env vars or prices as KaTeX`, `still renders display math with $$ delimiters`) must stay green.
- Do **not** stop escaping raw HTML (`escapeRawHtmlInMarkdown` + `skipHtml`). `<kbd>` / `<mark>` / `<div>` in assistant prose stay visible text. Existing test `shows HTML tag mentions as text instead of creating DOM nodes` must stay green.
- Do **not** change `EnhancedMarkdownView`, mobile Markdown, contracts, host-runtime, or artifact fence policy.
- Do **not** “fix” `h2` underline plus a following `---` (double rule). That is heading chrome plus author `hr`, not a parser bug.
- Prefer `:has()` / GFM class CSS for task lists over new Streamdown list renderers, so Task 2 does not contend with Task 3 on `markdown-streamdown.tsx`.

---

## Scope

### In scope (four independent defects)

| ID | Symptom | Root cause | Task |
|----|---------|------------|------|
| **MD-6** | `` ```mermaid `` dumps source; switching sessions then back draws the diagram | `markdown-code-fence.tsx` returns a `<pre data-testid="mermaid-stream-source">` while `renderingPhase === 'streaming'`. After completion Streamdown keeps that cached node because the mermaid source did not change, so `MermaidBlock` never mounts. Remount starts at `completed` and works. | Task 1 |
| **MD-2** | Task items show both a disc `•` and a checkbox | `.md-list` keeps default `list-style`; GFM checkboxes are extra | Task 2 |
| **MD-1** | Footnote ref superscript works; definition renders as `1. ○` plus `↩`, body missing | Footnote `<section>` / `<ol>` go through the generic list renderer; no footnote CSS | Task 3 |
| **MD-5** | Bash fences put an iris disc on every line, reads as a leaked list | `.md-code-block[data-is-shell='true'] .md-code-line::before` is a 6px circle | Task 4 |

### Out of scope (do not implement)

| ID | Symptom | Why out |
|----|---------|---------|
| **MD-3** | Inline `$E = mc^2$` stays literal; `$$a^2+b^2=c^2$$` renders | Product: `createMathPlugin({ singleDollarTextMath: false })` in `MarkdownView.tsx`. Inline math is `\(...\)` or `$$...$$`. |
| **MD-4** | `<kbd>` / `<mark>` show as tags | Product: coding-agent replies mention HTML. `escapeRawHtmlInMarkdown` is required. `md-kbd` / `md-mark` renderers stay for non-escaped trees; chat input will not reach them. |
| **MD-7** | `##` underline plus `---` looks like a double rule | Content + `.md-h2 { border-bottom }`. Not a defect. |
| — | New diagram languages, mermaid themes, click handlers | `mermaid.initialize({ securityLevel: 'strict' })` stays. `graph` / `sequenceDiagram` / `stateDiagram-v2` / `gantt` already work once `MermaidBlock` mounts. |
| — | Mobile `MobileMarkdown.tsx` | Desktop transcript only. Same math plugin choice stays. |

### File mutex (honest parallelism)

| Task | Exclusive files | May run isolated? |
|------|-----------------|-------------------|
| 1 Mermaid | `markdown-rendering-phase.tsx` (new), `markdown-rendering-phase.test.tsx` (new), `markdown-mermaid-phase.test.tsx` (new), `MermaidBlock.tsx`, `markdown-code-fence.tsx`, `MarkdownView.tsx` (provider wrap only) | **Yes** |
| 2 Task list | `styles/transcript-markdown.css` (insert after `.md-task-checkbox` only), `markdown-rendering.test.tsx` | No — shared CSS file with 3 and 4 |
| 3 Footnotes | `markdown-streamdown.tsx`, `styles/transcript-markdown.css` (append at end only), `markdown-footnotes.test.tsx` (new) | No — shared CSS file; exclusive TS |
| 4 Shell gutter | `styles/transcript-markdown.css` (replace the `::before` block around the current shell gutter only) | No — shared CSS file |

`independentSteps`: Task 1 only.

Tasks 2, 3, and 4 **must not** run as concurrent editors of `transcript-markdown.css`. If Task 2 is already merged, Task 3 only appends, Task 4 only edits the existing shell `::before` rule.

---

## File map

```text
apps/desktop/src/markdown-rendering-phase.tsx          # Task 1: context + hook
apps/desktop/src/markdown-rendering-phase.test.tsx     # Task 1
apps/desktop/src/markdown-mermaid-phase.test.tsx       # Task 1: stream → complete same mount
apps/desktop/src/MermaidBlock.tsx                      # Task 1: read phase, keep source while streaming
apps/desktop/src/markdown-code-fence.tsx               # Task 1: always mount MermaidBlock
apps/desktop/src/MarkdownView.tsx                      # Task 1: provide phase

apps/desktop/src/styles/transcript-markdown.css        # Tasks 2–4: disjoint edits
apps/desktop/src/markdown-rendering.test.tsx           # Task 2
apps/desktop/src/markdown-streamdown.tsx               # Task 3: section renderer
apps/desktop/src/markdown-footnotes.test.tsx           # Task 3
```

---

## Background (why Mermaid looks “unsupported”)

`markdown-code-fence.tsx` today:

```tsx
if (isMermaidFenceLanguage(props.language)) {
  if (streamMode) {
    return (
      <pre className="md-code" data-testid="mermaid-stream-source">
        <code data-language="mermaid">{props.source}</code>
      </pre>
    );
  }
  return <MermaidBlock source={props.source} />;
}
```

`MarkdownView.tsx` keeps `mode="streaming"` after the first live token so custom fences (Artifact iframes) are not unmounted. `createStreamdownComponents` is `useMemo(..., [])`. `optionsRef.current.phase` updates, but Streamdown does not re-call `components.code` when only the phase changes and the mermaid source is unchanged.

The screenshot source blocks have no Copy header and no “Mermaid diagram failed” chrome — that is `mermaid-stream-source`, not `SourceCodeBlock` and not `MermaidFallback`.

Fix: always return `<MermaidBlock>` (stable type). `MermaidBlock` reads phase from context (default `'completed'` so `EnhancedMarkdownView` stays unchanged). While `streaming`, keep the existing source `<pre>`. When phase becomes `completed`, the same mounted `MermaidBlock` runs `mermaid.render`.

Do **not** pass `defer={options.phase === 'streaming'}` as a prop from `markdown-streamdown.tsx`. Those props go stale for the same reason.

---

### Task 1: Mermaid same-mount upgrade (MD-6)

**Files:**
- Create: `apps/desktop/src/markdown-rendering-phase.tsx`
- Create: `apps/desktop/src/markdown-rendering-phase.test.tsx`
- Create: `apps/desktop/src/markdown-mermaid-phase.test.tsx`
- Modify: `apps/desktop/src/MermaidBlock.tsx`
- Modify: `apps/desktop/src/markdown-code-fence.tsx`
- Modify: `apps/desktop/src/MarkdownView.tsx` (wrap Streamdown only)

**Interfaces:**
- Consumes: existing `MarkdownRenderingPhase` from `markdown-code-fence.ts` (`'streaming' | 'completed' | 'explicit-artifact-review'`)
- Produces:
  - `MarkdownRenderingPhaseProvider({ phase, children })`
  - `useMarkdownRenderingPhase(): MarkdownRenderingPhase` — default `'completed'` when no provider
  - `MermaidBlock` still `{ source: string }` (no new required props)

- [ ] **Step 1: Write the failing same-mount test**

Create `apps/desktop/src/markdown-mermaid-phase.test.tsx`. Copy the happy-dom `createRoot` + `act` harness from `markdown-rendering.test.tsx`. Mock mermaid before importing `MarkdownView`:

```tsx
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg data-testid="mock-mermaid-svg"></svg>',
    })),
  },
}));

import { MarkdownView } from './MarkdownView.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MERMAID_FENCE = ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n');

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderMarkdown(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  const render = { container, root };
  mounted.push(render);
  return render;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop();
    if (!item) continue;
    act(() => {
      item.root.unmount();
    });
    item.container.remove();
  }
});

describe('Mermaid phase upgrade', () => {
  it('keeps mermaid source while streaming and draws after completed on the same mount', async () => {
    const { container, root } = renderMarkdown(
      <MarkdownView text={MERMAID_FENCE} renderingPhase="streaming" />,
    );
    expect(container.querySelector('[data-testid="mermaid-stream-source"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mermaid-diagram"]')).toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView text={MERMAID_FENCE} renderingPhase="completed" />
        </PiwinUiProvider>,
      );
    });
    await flush();

    expect(container.querySelector('[data-testid="mermaid-stream-source"]')).toBeNull();
    expect(container.querySelector('[data-testid="mermaid-diagram"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mock-mermaid-svg"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm --filter @piwin/desktop exec vitest run src/markdown-mermaid-phase.test.tsx
```

Expected: FAIL. After the completed re-render, `[data-testid="mermaid-stream-source"]` is still in the document (or `mermaid-diagram` is null). That is the session-switch bug.

- [ ] **Step 3: Add the phase context**

Create `apps/desktop/src/markdown-rendering-phase.tsx`:

```tsx
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { MarkdownRenderingPhase } from './markdown-code-fence.js';

const MarkdownRenderingPhaseContext = createContext<MarkdownRenderingPhase>('completed');

export function MarkdownRenderingPhaseProvider(props: {
  phase: MarkdownRenderingPhase;
  children: ReactNode;
}): ReactElement {
  return (
    <MarkdownRenderingPhaseContext.Provider value={props.phase}>
      {props.children}
    </MarkdownRenderingPhaseContext.Provider>
  );
}

export function useMarkdownRenderingPhase(): MarkdownRenderingPhase {
  return useContext(MarkdownRenderingPhaseContext);
}
```

Create `apps/desktop/src/markdown-rendering-phase.test.tsx` that renders a tiny consumer without a provider and expects `'completed'`.

- [ ] **Step 4: Always mount MermaidBlock; honor phase inside it**

In `markdown-code-fence.tsx` `FenceBody`, replace the mermaid branch with:

```tsx
if (isMermaidFenceLanguage(props.language)) {
  return <MermaidBlock source={props.source} />;
}
```

Do not keep the streaming `<pre>` here.

In `MermaidBlock.tsx` `MermaidInner`:

1. `const phase = useMarkdownRenderingPhase();`
2. Add `phase` to the `useEffect` dependency list.
3. At the top of the effect: if `phase === 'streaming'`, `setState({ status: 'loading' })` and return (do not call `mermaid.render`).
4. Before the loading/error/ready returns:

```tsx
if (phase === 'streaming') {
  return (
    <pre className="md-code" data-testid="mermaid-stream-source">
      <code data-language="mermaid">{source}</code>
    </pre>
  );
}
```

Keep `MermaidErrorBoundary` around `MermaidInner`. Keep `securityLevel: 'strict'`.

- [ ] **Step 5: Provide phase from MarkdownView**

In `MarkdownView.tsx`, wrap the existing `Streamdown` (no extra DOM node besides the provider):

```tsx
import { MarkdownRenderingPhaseProvider } from './markdown-rendering-phase.js';

return (
  <MarkdownRenderingPhaseProvider phase={phase}>
    <Streamdown
      className={shouldShowStreamingCaret ? 'markdown has-stream-caret' : 'markdown'}
      mode={streamdownMode}
      parseMarkdownIntoBlocksFn={parseStreamdownAsSingleDocument}
      parseIncompleteMarkdown={streamMode}
      isAnimating={false}
      animated={STREAMDOWN_IMMEDIATE_STREAMING}
      plugins={STREAMDOWN_PLUGINS}
      components={streamdownComponents}
      controls={false}
      lineNumbers={false}
      skipHtml
      linkSafety={MARKDOWN_LINK_SAFETY}
    >
      {streamdownTextForRender}
    </Streamdown>
  </MarkdownRenderingPhaseProvider>
);
```

Do not change `usedStreamingRendererRef` / `streamdownMode`.

- [ ] **Step 6: Re-run tests**

```bash
pnpm --filter @piwin/desktop exec vitest run src/markdown-mermaid-phase.test.tsx src/markdown-rendering-phase.test.tsx src/MarkdownView.test.tsx src/markdown-rendering.test.tsx src/artifact-streaming-invariants.test.tsx
```

Expected: PASS. Existing mermaid test `mermaid still renders (mounts MermaidBlock) when capability off` still asserts `mermaid-stream-source` is null on a completed mount.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/markdown-rendering-phase.tsx \
  apps/desktop/src/markdown-rendering-phase.test.tsx \
  apps/desktop/src/markdown-mermaid-phase.test.tsx \
  apps/desktop/src/MermaidBlock.tsx \
  apps/desktop/src/markdown-code-fence.tsx \
  apps/desktop/src/MarkdownView.tsx
git commit -m "$(cat <<'EOF'
fix(desktop): upgrade mermaid fences after stream without remount

Keep MermaidBlock mounted across streaming → completed and read phase
from context so Streamdown's retained block tree still draws the diagram.
EOF
)"
```

---

### Task 2: Task list discs (MD-2)

**Files:**
- Modify: `apps/desktop/src/styles/transcript-markdown.css` (insert immediately after `.md-task-checkbox`, currently lines 155–161)
- Modify: `apps/desktop/src/markdown-rendering.test.tsx`

**Interfaces:**
- Consumes: existing `input.md-task-checkbox` from `markdown-streamdown.tsx` `renderInput`; GFM classes `contains-task-list` / `task-list-item` when Streamdown forwards them via `mergeMarkdownClassNames`
- Produces: CSS-only. No new TS exports.

Do **not** edit `markdown-streamdown.tsx` in this task (Task 3 owns that file).

- [ ] **Step 1: Extend the semantic Markdown test**

Add to `apps/desktop/src/markdown-rendering.test.tsx`:

```tsx
it('renders GFM task items as checkboxes inside list items', () => {
  const { container } = renderMarkdown(
    <MarkdownView
      text={['- [x] shipped', '- [ ] pending'].join('\n')}
      renderingPhase="completed"
    />,
  );

  expect(container.querySelectorAll('.md-task-checkbox')).toHaveLength(2);
  expect(container.querySelector('.md-task-checkbox:checked')).not.toBeNull();
  const items = container.querySelectorAll('li.md-list-item');
  expect(items.length).toBeGreaterThanOrEqual(2);
  expect(items[0]?.querySelector('.md-task-checkbox')).not.toBeNull();
});
```

This test should already pass (checkboxes exist). It is the fixture for the CSS change, not a new parser.

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @piwin/desktop exec vitest run src/markdown-rendering.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Suppress discs on task lists**

Insert after `.md-task-checkbox` in `transcript-markdown.css`:

```css
/* GFM task items already draw a checkbox. Drop the ul disc. */
.markdown ul.contains-task-list,
.markdown ul.md-list:has(> .md-list-item .md-task-checkbox) {
  list-style: none;
  padding-left: 0.2em;
}

.markdown li.task-list-item,
.markdown li.md-list-item:has(> .md-task-checkbox) {
  list-style: none;
}
```

Keep ordinary `.md-list` discs for non-task uls (`- 苹果`). `:has()` is available in the Tauri 2 WKWebView / Chromium shell.

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @piwin/desktop exec vitest run src/markdown-rendering.test.tsx src/MarkdownView.test.tsx
```

Expected: PASS. The existing `renders GFM task lists, strikethrough, callouts, and no raw HTML nodes` test still finds two `.md-task-checkbox` nodes.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/styles/transcript-markdown.css \
  apps/desktop/src/markdown-rendering.test.tsx
git commit -m "$(cat <<'EOF'
fix(desktop): drop extra discs on GFM task list items

Task checkboxes already mark the row; keep ul discs for ordinary lists.
EOF
)"
```

---

### Task 3: Footnote definitions (MD-1)

**Files:**
- Modify: `apps/desktop/src/markdown-streamdown.tsx` (add `section` renderer; do not change `renderList` / `renderInput`)
- Modify: `apps/desktop/src/styles/transcript-markdown.css` (**append** at end of file only)
- Create: `apps/desktop/src/markdown-footnotes.test.tsx`

**Interfaces:**
- Consumes: Streamdown/GFM footnote hast (`section` with `data-footnotes` and/or class `footnotes`; backref `a[data-footnote-backref]` / `.data-footnote-backref`; inline `sup > a`)
- Produces: `section.md-footnotes` when the node is a footnote section; CSS under `.markdown .md-footnotes`

- [ ] **Step 1: Write the failing footnote test**

Create `apps/desktop/src/markdown-footnotes.test.tsx`. Reuse the `markdown-rendering.test.tsx` harness (copy the helper; do not import from that file — it has no exports).

```tsx
describe('MarkdownView GFM footnotes', () => {
  it('renders footnote definition text and a backref, not an empty disc list', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={['脚注示例[^1]，结束。', '', '[^1]: 这是脚注正文'].join('\n')}
        renderingPhase="completed"
      />,
    );

    const markdown = container.querySelector('.markdown');
    expect(markdown?.textContent).toContain('脚注示例');
    expect(markdown?.textContent).toContain('这是脚注正文');

    const section = container.querySelector('section.md-footnotes, section[data-footnotes]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('这是脚注正文');

    const backref = container.querySelector(
      'a[data-footnote-backref], a.data-footnote-backref',
    );
    expect(backref).not.toBeNull();
  });
});
```

If the first run fails because Streamdown does not emit `section[data-footnotes]`, do **not** weaken the body-text assertion. Inspect `container.querySelector('.markdown')?.innerHTML` once, then map the real footnote node to `md-footnotes` in Step 3. The definition text `'这是脚注正文'` must remain the acceptance criterion.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @piwin/desktop exec vitest run src/markdown-footnotes.test.tsx
```

Expected: FAIL (missing section class and/or missing definition text in a footnotes container). Current UI shows `1. ○` plus `↩`.

- [ ] **Step 3: Add a footnote section renderer**

In `markdown-streamdown.tsx`, next to the other renderers:

```tsx
const renderSection = ({
  children,
  node: _node,
  className,
  ...props
}: StreamdownElementProps<'section'>): ReactElement => {
  const isFootnotes =
    (typeof className === 'string' && className.includes('footnotes')) ||
    props['data-footnotes'] !== undefined;
  return (
    <section
      {...props}
      className={mergeMarkdownClassNames(isFootnotes ? 'md-footnotes' : '', className)}
    >
      {children}
    </section>
  );
};
```

Register it on the returned `Components` object:

```tsx
section: renderSection,
```

Do not special-case `ol` / `li` in this task. Footnote lists keep `md-list`; CSS under `.md-footnotes` overrides discs.

- [ ] **Step 4: Append footnote CSS**

Append to `transcript-markdown.css` (do not edit Task 2’s task-list rules or Task 4’s shell `::before`):

```css
.markdown .md-footnotes,
.markdown section[data-footnotes] {
  margin-top: 1.2em;
  padding-top: 0.75em;
  border-top: 1px solid var(--line-1);
  color: var(--text-2);
  font-size: 0.92em;
}

.markdown .md-footnotes > .md-h,
.markdown .md-footnotes > h2,
.markdown section[data-footnotes] > h2 {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.markdown .md-footnotes > .md-list,
.markdown .md-footnotes > ol,
.markdown section[data-footnotes] > ol {
  list-style: decimal;
  padding-left: 1.5em;
}

.markdown .md-footnotes ul,
.markdown section[data-footnotes] ul {
  list-style: none;
  padding-left: 0;
}

.markdown a[data-footnote-backref],
.markdown a.data-footnote-backref {
  margin-left: 0.35em;
  text-decoration: none;
}
```

- [ ] **Step 5: Re-run tests**

```bash
pnpm --filter @piwin/desktop exec vitest run src/markdown-footnotes.test.tsx src/markdown-rendering.test.tsx
```

Expected: PASS. Definition text is visible. Ordinary lists in Task 2 tests still have discs (they are not inside `.md-footnotes`).

If definition text is still missing after the section class is applied, the renderer is dropping the footnote paragraph. In that case, log `section.innerHTML` and stop — do not invent a second parser. Fix the `section` / children pass-through only.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/markdown-streamdown.tsx \
  apps/desktop/src/styles/transcript-markdown.css \
  apps/desktop/src/markdown-footnotes.test.tsx
git commit -m "$(cat <<'EOF'
fix(desktop): render GFM footnote definitions as a footnote block

Keep the superscript ref and show the definition text instead of an
empty numbered disc plus a backref.
EOF
)"
```

---

### Task 4: Shell gutter is a prompt, not a disc (MD-5)

**Files:**
- Modify: `apps/desktop/src/styles/transcript-markdown.css` — **only** the existing rule `.md-code-block[data-is-shell='true'] .md-code-line::before` (currently lines 378–386)

**Interfaces:**
- Consumes: `data-is-shell="true"` from `SourceCodeBlock` (`markdown-code-block.tsx`)
- Produces: no TS changes

Do not add tests to `MarkdownView.test.tsx` (over the 1000-line cap). The existing test `renders bash command line code blocks with shell formatting` already asserts `data-is-shell="true"` and `.md-code-shell-icon` text `$`.

- [ ] **Step 1: Confirm the current gutter rule**

Current rule:

```css
.md-code-block[data-is-shell='true'] .md-code-line::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--iris);
  flex-shrink: 0;
}
```

That iris circle is what reads as a list disc on bash fences.

- [ ] **Step 2: Replace the disc with a muted prompt**

Replace that one rule with:

```css
.md-code-block[data-is-shell='true'] .md-code-line::before {
  content: '$';
  display: inline-block;
  width: 1.2em;
  height: auto;
  border-radius: 0;
  background: transparent;
  color: var(--text-4);
  font-family: var(--font-mono);
  font-size: 0.85em;
  line-height: 1.35;
  flex-shrink: 0;
  user-select: none;
}
```

Leave `.md-code-line-num { display: none }` on shell blocks. Leave the header `$` icon. Do not restyle javascript / non-shell fences.

- [ ] **Step 3: Run the existing shell test**

```bash
pnpm --filter @piwin/desktop exec vitest run src/MarkdownView.test.tsx -t "renders bash command line code blocks with shell formatting"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/styles/transcript-markdown.css
git commit -m "$(cat <<'EOF'
fix(desktop): use a prompt gutter on shell code fences

Replace the iris disc so bash fences no longer look like a nested list.
EOF
)"
```

---

## Verification (after all tasks)

```bash
pnpm --filter @piwin/desktop exec vitest run \
  src/markdown-mermaid-phase.test.tsx \
  src/markdown-rendering-phase.test.tsx \
  src/markdown-rendering.test.tsx \
  src/markdown-footnotes.test.tsx \
  src/MarkdownView.test.tsx \
  src/artifact-streaming-invariants.test.tsx
pnpm --filter @piwin/desktop typecheck
```

Expected: all green.

Manual smoke (desktop transcript, one assistant message, no session switch):

1. Closed `` ```mermaid `` fence with `graph TD` — diagram, not a source `<pre>`, after the run finishes.
2. `- [x]` / `- [ ]` — checkbox only, no extra disc.
3. `脚注示例[^1]` plus `[^1]: 正文` — superscript plus definition text plus backref.
4. `` ```bash `` — muted `$` gutter, not iris discs; javascript fences still have line numbers.

---

## Self-review

1. **Spec coverage:** MD-6 → Task 1. MD-2 → Task 2. MD-1 → Task 3. MD-5 → Task 4. MD-3 / MD-4 / MD-7 recorded as out of scope with the existing tests / CSS that lock the decision.
2. **Placeholder scan:** no TBD / “handle edge cases” / “similar to Task N”. Tests and CSS are inlined.
3. **Type consistency:** `MarkdownRenderingPhase` stays the existing union. `useMarkdownRenderingPhase()` returns that union. `MermaidBlock` props stay `{ source: string }`. Task 3’s class is `md-footnotes`.
4. **Independence:** Task 1 does not edit `transcript-markdown.css` or `markdown-streamdown.tsx`. Tasks 2–4 share the CSS file and must run sequentially. Task 3 is the only editor of `markdown-streamdown.tsx`.
)
