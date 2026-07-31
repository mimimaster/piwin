// @vitest-environment happy-dom
/**
 * MarkdownView artifact preview policy coverage (design §7, §12).
 * Uses the same happy-dom + createRoot + act pattern as settings-shell.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MarkdownView } from './MarkdownView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ARTIFACT_HTML_FENCE = '```artifact-html\n<div><h1>Hi</h1></div>\n```';
const PLAIN_HTML_FENCE = '```html\n<div class="card"><p>Hello</p></div>\n```';
const FLASHCARD_FENCE =
  '```html\n<div class="piwin-flashcard" data-card-id="card-abc12345-xyz"></div>\n```';
const MERMAID_FENCE = '```mermaid\ngraph TD\nA-->B\n```';
const SVG_FENCE = '```svg\n<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>\n```';

function renderMarkdown(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

describe('MarkdownView artifact preview policy', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('capability off: artifact-html fence stays ordinary source code when artifactPreviewEnabled is false', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactPreviewEnabled={false} />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('capability off: plain html fence renders as ordinary code, no Preview', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={PLAIN_HTML_FENCE} renderingPhase="completed" artifactPreviewEnabled={false} />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('default mode (artifactCodeFirst=false): artifact-html fence directly renders ArtifactFrame', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
  });

  it('code-first mode (artifactCodeFirst=true): artifact-html fence shows Preview button first', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('streaming mode (artifactCodeFirst=false): renders live ArtifactFrame in stream-preview', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="streaming" />,
    );
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
  });

  it('capability off + flashcard source: shows Preview card affordance', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={FLASHCARD_FENCE} renderingPhase="completed" artifactPreviewEnabled={false} />,
    );
    expect(container.querySelector('[data-testid="flashcard-preview-card"]')).not.toBeNull();
  });

  it('capability on + flashcard source: directly renders ArtifactFrame by default', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={FLASHCARD_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
  });

  it('mermaid still renders (mounts MermaidBlock) when capability off', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={MERMAID_FENCE} renderingPhase="completed" artifactPreviewEnabled={false} />,
    );
    // MermaidBlock is mounted (not the streaming source fallback).
    expect(container.querySelector('[data-testid="mermaid-stream-source"]')).toBeNull();
  });

  it('capability off: svg fence stays ordinary source code when artifactPreviewEnabled is false', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="completed" artifactPreviewEnabled={false} />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('code-first mode: svg fence shows a Preview SVG toggle', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain('Preview SVG');
  });

  it('streaming mode (artifactCodeFirst=true): svg fence shows source code first', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="streaming" artifactCodeFirst />,
    );
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('byte-stability: artifact-html language label identical in both modes', () => {
    // Capability off: renders code-fence-source with normalized language.
    const off = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactPreviewEnabled={false} />,
    );
    const offLang = off.container.querySelector('[data-testid="code-fence-source"] .md-code-lang');
    const offText = offLang?.textContent ?? '';
    act(() => {
      off.root.unmount();
    });
    off.container.remove();

    // Code-first mode: renders artifact-with-source with the same normalized label.
    const on = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    const onLang = on.container.querySelector('.artifact-with-source .md-code-lang');
    const onText = onLang?.textContent ?? '';
    act(() => {
      on.root.unmount();
    });
    on.container.remove();

    // Both should normalize to the same language label (evaluate normalizes
    // artifact-html -> html). The invariant is equality across modes.
    expect(onText).toBe(offText);
    expect(offText.length).toBeGreaterThan(0);
  });

  it('in-place toggle (artifactCodeFirst=true): clicking Preview replaces source with ArtifactFrame', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    // Closed: source visible, no artifact frame.
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
    // Open preview in-place.
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(toggle?.textContent).toContain('Preview');
    act(() => {
      toggle?.click();
    });
    // Source code block is gone; rendered frame replaces it in place.
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    // The "Show code" affordance lives inside the frame header.
    const showCode = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(showCode?.textContent).toContain('Show code');
    // Switch back to source.
    act(() => {
      showCode?.click();
    });
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('in-place toggle: SVG preview replaces source with ArtifactFrame', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(toggle?.textContent).toContain('Preview SVG');
    act(() => {
      toggle?.click();
    });
    // Flush the async artifact init promise that resolves setGranted.
    act(() => {});
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
  });
});

describe('MarkdownView path chips', () => {
  it('collapses a full .md path to its file name', () => {
    const fullPath = '/Users/yorickjue/.piwin/workspace/自我介绍.md';
    const { container } = renderMarkdown(
      <MarkdownView
        text={`文件完整路径：${fullPath}`}
        renderingPhase="completed"
        onOpenDocument={vi.fn()}
      />,
    );
    const chip = container.querySelector<HTMLElement>('.md-doc-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('自我介绍.md');
    expect(chip?.getAttribute('title')).toBe(fullPath);
    expect(chip?.getAttribute('data-full-path')).toBe(fullPath);
  });

  it('opens the full path when a path chip is clicked', () => {
    const fullPath = '/Users/yorickjue/.piwin/workspace/自我介绍.md';
    const onOpenDocument = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text={`文件完整路径：${fullPath}`}
        renderingPhase="completed"
        onOpenDocument={onOpenDocument}
      />,
    );
    const chip = container.querySelector<HTMLElement>('.md-doc-chip');
    act(() => {
      chip?.click();
    });
    expect(onOpenDocument).toHaveBeenCalledWith({
      title: '自我介绍.md',
      path: fullPath,
    });
  });

  it('collapses an inline code .md path to its file name', () => {
    const fullPath = '/Users/yorickjue/project/README.md';
    const { container } = renderMarkdown(
      <MarkdownView
        text={`Open \`${fullPath}\` now.`}
        renderingPhase="completed"
        onOpenDocument={vi.fn()}
      />,
    );
    const chip = container.querySelector<HTMLElement>('.md-doc-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('README.md');
    expect(chip?.getAttribute('data-full-path')).toBe(fullPath);
  });

  it('uses the link title for a .md document link', () => {
    const fullPath = '/Users/yorickjue/project/notes.md';
    const onOpenDocument = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text={`[My Notes](${fullPath})`}
        renderingPhase="completed"
        onOpenDocument={onOpenDocument}
      />,
    );
    const chip = container.querySelector<HTMLElement>('.md-doc-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('My Notes');
    expect(chip?.getAttribute('data-full-path')).toBe(fullPath);
    act(() => {
      chip?.click();
    });
    expect(onOpenDocument).toHaveBeenCalledWith({ title: 'My Notes', path: fullPath });
  });
});
