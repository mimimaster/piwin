// @vitest-environment happy-dom
/**
 * MarkdownView artifact preview policy coverage (design §7, §12).
 * Uses the same happy-dom + createRoot + act pattern as settings-shell.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MarkdownView } from './MarkdownView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ARTIFACT_HTML_FENCE = '```artifact-html\n<div><h1>Hi</h1></div>\n```';
const PLAIN_HTML_FENCE = '```html\n<div class="card"><p>Hello</p></div>\n```';
const FLASHCARD_FENCE =
  '```html\n<div class="piwin-flashcard" data-card-id="card-abc12345-xyz"></div>\n```';
const MERMAID_FENCE = '```mermaid\ngraph TD\nA-->B\n```';

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

  it('capability off (default): artifact-html fence shows no Preview toggle', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('capability off: plain html fence renders as ordinary code, no Preview', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={PLAIN_HTML_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('capability on: artifact-html fence shows Preview toggle', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactPreviewEnabled />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).not.toBeNull();
  });

  it('capability on: plain html fence shows Preview toggle (promoted by parser)', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={PLAIN_HTML_FENCE} renderingPhase="completed" artifactPreviewEnabled />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).not.toBeNull();
  });

  it('streaming: never mounts Artifact toggle even when capability on', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="streaming" artifactPreviewEnabled />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).not.toBeNull();
  });

  it('capability off + flashcard source: shows Preview card affordance', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={FLASHCARD_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('[data-testid="flashcard-preview-card"]')).not.toBeNull();
  });

  it('capability on + flashcard source: shows standard Preview toggle', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={FLASHCARD_FENCE} renderingPhase="completed" artifactPreviewEnabled />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).not.toBeNull();
  });

  it('mermaid still renders (mounts MermaidBlock) when capability off', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={MERMAID_FENCE} renderingPhase="completed" />,
    );
    // MermaidBlock is mounted (not the streaming source fallback).
    expect(container.querySelector('[data-testid="mermaid-stream-source"]')).toBeNull();
  });

  it('byte-stability: artifact-html language label identical in both modes', () => {
    // Capability off: renders code-fence-source with normalized language.
    const off = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    const offLang = off.container.querySelector('[data-testid="code-fence-source"] .md-code-lang');
    const offText = offLang?.textContent ?? '';
    act(() => {
      off.root.unmount();
    });
    off.container.remove();

    // Capability on: renders artifact-with-source with the same normalized label.
    const on = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactPreviewEnabled />,
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
});
