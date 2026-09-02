// @vitest-environment happy-dom
/**
 * MarkdownView artifact preview policy coverage (design §7, §12).
 * Uses the same happy-dom + createRoot + act pattern as settings-shell.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as artifact from '@piwin/artifact';
import { createDefaultArtifactTheme } from '@piwin/artifact';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MarkdownView, STREAMDOWN_IMMEDIATE_STREAMING } from './MarkdownView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedMarkdownRenders: Array<{ container: HTMLElement; root: Root }> = [];

const ARTIFACT_HTML_FENCE = '```artifact-html\n<div><h1>Hi</h1></div>\n```';
const INTERACTIVE_ARTIFACT_HTML_FENCE =
  '```artifact-html\n<button id="count">0</button><script>count.onclick=()=>count.textContent="1"</script>\n```';
const CANVAS_ARTIFACT_FENCE =
  '```artifact-html title="Wide workspace" surface="canvas"\n<div>Wide</div>\n```';
const PLAIN_HTML_FENCE = '```html\n<div class="card"><p>Hello</p></div>\n```';
const FULL_HTML_DOCUMENT_FENCE = [
  '```html',
  '<!DOCTYPE html><html><head><title>Ink</title></head><body><main>App</main></body></html>',
  '```',
].join('\n');
const VIEWPORT_ARTIFACT_FENCE = [
  '```artifact-html',
  '<div style="height:100vh">Stage</div>',
  '```',
].join('\n');
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
  const render = { container, root };
  mountedMarkdownRenders.push(render);
  return render;
}

function unmountMarkdown(render: { container: HTMLElement; root: Root }): void {
  const index = mountedMarkdownRenders.indexOf(render);
  if (index >= 0) {
    mountedMarkdownRenders.splice(index, 1);
  }
  try {
    act(() => {
      render.root.unmount();
    });
  } catch {
    // Root may already have been unmounted by the test body.
  }
  render.container.remove();
}

function cleanupMountedMarkdownRenders(): void {
  while (mountedMarkdownRenders.length > 0) {
    const render = mountedMarkdownRenders.pop();
    if (render) {
      unmountMarkdown(render);
    }
  }
}

async function flushMarkdownEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('MarkdownView artifact preview policy', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    cleanupMountedMarkdownRenders();
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('paints later streaming tokens on the live Streamdown tree', () => {
    expect(STREAMDOWN_IMMEDIATE_STREAMING).toEqual({ duration: 0, stagger: 0 });
    const { container, root } = renderMarkdown(
      <MarkdownView text="first token" renderingPhase="streaming" />,
    );
    expect(container.textContent).toContain('first token');

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView text="first token, second token" renderingPhase="streaming" />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('first token, second token');
  });

  it('repairs incomplete markdown while streaming instead of snapping a finished document', () => {
    const { container } = renderMarkdown(
      <MarkdownView text="This is **partial" renderingPhase="streaming" />,
    );
    expect(container.textContent).toContain('partial');
    expect(container.textContent).not.toContain('**');
  });

  it('does not inject Streamdown animate word spans while tokens are live', () => {
    const { container } = renderMarkdown(
      <MarkdownView text="Hello streaming token" renderingPhase="streaming" />,
    );
    expect(container.querySelector('[data-sd-animate]')).toBeNull();
  });

  it('drops the live caret class after the same mount completes and keeps the text', () => {
    const { container, root } = renderMarkdown(
      <MarkdownView text="stable tail" renderingPhase="streaming" />,
    );
    expect(container.querySelector('.markdown')?.classList.contains('has-stream-caret')).toBe(true);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView text="stable tail" renderingPhase="completed" />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('stable tail');
    expect(container.querySelector('.markdown')?.classList.contains('has-stream-caret')).toBe(
      false,
    );
  });

  it('capability off: artifact-html fence stays ordinary source code when artifactPreviewEnabled is false', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={ARTIFACT_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled={false}
      />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('capability off: plain html fence renders as ordinary code, no Preview', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={PLAIN_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled={false}
      />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('default mode: completed static HTML renders directly in transcript flow', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    const wrapper = container.querySelector('.artifact-with-source');
    expect(wrapper?.classList.contains('artifact-with-source--preview')).toBe(true);
    // "Show code" action is rendered as floating actions overlay.
    expect(wrapper?.querySelector('.artifact-floating-actions')).not.toBeNull();
    expect(wrapper?.querySelector('.artifact-preview-surface .artifact-frame')).not.toBeNull();
    expect(wrapper?.querySelector('.artifact-frame .artifact-frame-actions')).toBeNull();
    expect(wrapper?.querySelector('.artifact-frame')?.getAttribute('data-artifact-renderer')).toBe(
      'static-flow',
    );
    expect(wrapper?.querySelector('[data-testid="artifact-static"]')).not.toBeNull();
    expect(wrapper?.querySelector('iframe')).toBeNull();
  });

  it('assigns distinct canonical ordinals to two artifact fences', () => {
    const text = [
      '```artifact-html title="First"',
      '<section><h1>One</h1></section>',
      '```',
      '',
      '```artifact-html title="Second"',
      '<section><h1>Two</h1></section>',
      '```',
    ].join('\n');
    const { container } = renderMarkdown(
      <MarkdownView
        text={text}
        renderingPhase="completed"
        artifactOrigin={{ sessionId: 'session-two', messageId: 'message-two' }}
      />,
    );
    const ids = [...container.querySelectorAll('[data-artifact-id]')].map((element) =>
      element.getAttribute('data-artifact-id'),
    );
    expect(ids).toEqual(['message-two-artifact-0', 'message-two-artifact-1']);
  });

  it('materializes only when the selected presentation will mount', () => {
    const spy = vi.spyOn(artifact, 'materializeArtifact');
    renderMarkdown(
      <MarkdownView
        text={CANVAS_ARTIFACT_FENCE}
        renderingPhase="completed"
        artifactOrigin={{ sessionId: 'session-1', messageId: 'message-2' }}
        onOpenArtifactCanvas={vi.fn()}
      />,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockClear();

    renderMarkdown(
      <MarkdownView
        text={FULL_HTML_DOCUMENT_FENCE}
        renderingPhase="completed"
        artifactOrigin={{ sessionId: 'session-full', messageId: 'message-full' }}
        onOpenArtifactCanvas={vi.fn()}
      />,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    renderMarkdown(
      <MarkdownView
        text={ARTIFACT_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled={false}
      />,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockClear();

    renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes an explicit Canvas fence to a launcher with stable message origin', () => {
    const onOpenArtifactCanvas = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text={CANVAS_ARTIFACT_FENCE}
        renderingPhase="completed"
        artifactOrigin={{ sessionId: 'session-1', messageId: 'message-2' }}
        onOpenArtifactCanvas={onOpenArtifactCanvas}
      />,
    );

    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).not.toBeNull();
    expect(container.querySelector('.artifact-canvas-launcher-title')?.textContent).toContain(
      'Wide workspace',
    );
    expect(container.querySelector('.artifact-frame')).toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="artifact-canvas-open"]')?.click();
    });
    expect(onOpenArtifactCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        messageId: 'message-2',
        surface: 'canvas',
        title: 'Wide workspace',
      }),
    );
  });

  it('code-first does not hide an explicit Canvas launcher', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={CANVAS_ARTIFACT_FENCE}
        renderingPhase="completed"
        artifactCodeFirst
        artifactOrigin={{ sessionId: 'session-1', messageId: 'message-2' }}
        onOpenArtifactCanvas={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('keeps completed JavaScript content inside the sandbox iframe', async () => {
    const { container } = renderMarkdown(
      <MarkdownView text={INTERACTIVE_ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.artifact-frame')?.getAttribute('data-artifact-renderer')).toBe(
      'sandbox',
    );
    expect(container.querySelector('iframe.artifact-iframe')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-static"]')).toBeNull();
  });

  it('keeps Canvas fences source-only in the transcript while the response is streaming', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={CANVAS_ARTIFACT_FENCE}
        renderingPhase="streaming"
        artifactOrigin={{ sessionId: 'session-1', messageId: 'message-2' }}
        onOpenArtifactCanvas={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-testid="code-fence-streaming"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('code-first mode (artifactCodeFirst=true): artifact-html fence shows Preview button first', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });

  it('streaming mode materializes live Artifact preview (owi-style)', async () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="streaming" />,
    );
    await flushMarkdownEffects();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
  });

  it('keeps the same Artifact frame across real Markdown streaming deltas', async () => {
    const firstText = [
      '```artifact-html',
      '<style>.card { padding: 12px; }</style><div class="card"><p>Hel',
    ].join('\n');
    const nextText = [
      '```artifact-html',
      '<style>.card { padding: 12px; }</style><div class="card"><p>Hello world</p><section>Next',
    ].join('\n');
    const { container, root } = renderMarkdown(
      <MarkdownView
        text={firstText}
        renderingPhase="streaming"
        artifactTheme={createDefaultArtifactTheme('dark')}
        artifactOrigin={{ sessionId: 's1', messageId: 'm-stream-stable' }}
      />,
    );
    await flushMarkdownEffects();
    const firstHost = container.querySelector<HTMLElement>('[data-testid="artifact-stream-live"]');
    const firstId = firstHost?.getAttribute('data-artifact-id');
    expect(firstHost).not.toBeNull();
    expect(firstId).toBe('m-stream-stable-artifact-0');

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView
            text={nextText}
            renderingPhase="streaming"
            artifactTheme={createDefaultArtifactTheme('dark')}
            artifactOrigin={{ sessionId: 's1', messageId: 'm-stream-stable' }}
          />
        </PiwinUiProvider>,
      );
    });
    await flushMarkdownEffects();

    const secondHost = container.querySelector<HTMLElement>('[data-testid="artifact-stream-live"]');
    expect(secondHost).toBe(firstHost);
    expect(secondHost?.getAttribute('data-artifact-id')).toBe('m-stream-stable-artifact-0');
  });

  it('replaces the temporary streaming sandbox with static natural flow on completion', async () => {
    const streamingText = [
      '```artifact-html',
      '<style>.card { padding: 12px; }</style><div class="card"><p>Hel',
    ].join('\n');
    const completedText = [
      '```artifact-html',
      '<style>.card { padding: 12px; }</style><div class="card"><p>Hello</p></div>',
      '```',
    ].join('\n');
    const { container, root } = renderMarkdown(
      <MarkdownView
        text={streamingText}
        renderingPhase="streaming"
        artifactOrigin={{ sessionId: 's1', messageId: 'm-stream-final' }}
      />,
    );
    await flushMarkdownEffects();
    const streamingFrame = container.querySelector<HTMLElement>('.artifact-frame');
    expect(streamingFrame).not.toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView
            text={completedText}
            renderingPhase="completed"
            artifactOrigin={{ sessionId: 's1', messageId: 'm-stream-final' }}
          />
        </PiwinUiProvider>,
      );
    });
    await flushMarkdownEffects();

    const completedFrame = container.querySelector<HTMLElement>('.artifact-frame');
    expect(completedFrame).not.toBe(streamingFrame);
    expect(completedFrame?.getAttribute('data-artifact-renderer')).toBe('static-flow');
    expect(container.querySelector('[data-testid="artifact-static"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('ordinary HTML with data-card-id does not hijack capability-off source rendering', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={FLASHCARD_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled={false}
      />,
    );
    expect(container.querySelector('[data-testid="flashcard-preview-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-flashcard"]')).toBeNull();
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('ordinary HTML with data-card-id stays generic Artifact content', async () => {
    const { container } = renderMarkdown(
      <MarkdownView text={FLASHCARD_FENCE} renderingPhase="completed" />,
    );
    await flushMarkdownEffects();
    expect(container.querySelector('[data-testid="flashcard-preview-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-flashcard"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
  });

  it('mermaid still renders (mounts MermaidBlock) when capability off', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={MERMAID_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled={false}
      />,
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

  it('streams native SVG directly as an Inline Artifact', async () => {
    const { container } = renderMarkdown(
      <MarkdownView text={SVG_FENCE} renderingPhase="streaming" />,
    );
    await flushMarkdownEffects();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
  });

  it('streams an incomplete native SVG through the safe Inline preview', async () => {
    const { container } = renderMarkdown(
      <MarkdownView text={'```svg\n<svg'} renderingPhase="streaming" locale="zh-CN" />,
    );
    await flushMarkdownEffects();
    expect(container.querySelector('[data-testid="artifact-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
  });

  it('auto-previews a native full HTML document as inline-viewport, not Canvas', async () => {
    const onOpenArtifactCanvas = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text={FULL_HTML_DOCUMENT_FENCE}
        renderingPhase="completed"
        artifactOrigin={{ sessionId: 'session-full', messageId: 'message-full' }}
        onOpenArtifactCanvas={onOpenArtifactCanvas}
      />,
    );

    await flushMarkdownEffects();
    expect(onOpenArtifactCanvas).not.toHaveBeenCalled();
    const frame = container.querySelector('[data-testid="artifact-frame"]');
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-viewport');
    expect(frame?.getAttribute('data-artifact-layout')).toBe('inline');
    expect(container.querySelector('iframe.artifact-iframe')).not.toBeNull();
  });

  it('mounts an explicit viewport artifact as inline-viewport in the transcript', async () => {
    const onOpenArtifactCanvas = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text={VIEWPORT_ARTIFACT_FENCE}
        renderingPhase="completed"
        artifactOrigin={{ sessionId: 'session-vh', messageId: 'message-vh' }}
        onOpenArtifactCanvas={onOpenArtifactCanvas}
      />,
    );
    await flushMarkdownEffects();
    const frame = container.querySelector('[data-testid="artifact-frame"]');
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-viewport');
    expect(frame?.getAttribute('data-artifact-layout')).toBe('inline');
    expect(container.querySelector('iframe.artifact-iframe')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).toBeNull();
    expect(onOpenArtifactCanvas).not.toHaveBeenCalled();
  });

  it('streaming mode keeps the explicit code-first preference source-only', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="streaming" artifactCodeFirst />,
    );
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('streams native HTML directly as an Inline Artifact', async () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={'```html\n<!doctype html><html><body><main>START-NATIVE-HTML'}
        renderingPhase="streaming"
      />,
    );
    await flushMarkdownEffects();
    expect(container.querySelector('[data-testid="artifact-stream-live"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
    expect(container.querySelector('[data-testid="artifact-frame"]')).not.toBeNull();
  });

  it('byte-stability: artifact-html language label identical in both modes', () => {
    // Capability off: renders code-fence-source with normalized language.
    const off = renderMarkdown(
      <MarkdownView
        text={ARTIFACT_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled={false}
      />,
    );
    const offLang = off.container.querySelector('[data-testid="code-fence-source"] .md-code-lang');
    const offText = offLang?.textContent ?? '';
    unmountMarkdown(off);

    // Code-first mode: renders artifact-with-source with the same normalized label.
    const on = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    const onLang = on.container.querySelector('.artifact-with-source .md-code-lang');
    const onText = onLang?.textContent ?? '';
    unmountMarkdown(on);

    // Both should normalize to the same language label (evaluate normalizes
    // artifact-html -> html). The invariant is equality across modes.
    expect(onText).toBe(offText);
    expect(offText.length).toBeGreaterThan(0);
  });

  it('in-place toggle (artifactCodeFirst=true): clicking Preview replaces source with ArtifactFrame', () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(500);
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" artifactCodeFirst />,
    );
    // Closed: source visible, no artifact frame.
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
    expect(
      container.querySelector('.md-code-collapsible')?.classList.contains('is-collapsed'),
    ).toBe(true);
    expect(
      container
        .querySelector('.artifact-with-source')
        ?.classList.contains('artifact-with-source--preview'),
    ).toBe(false);
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
    const wrapper = container.querySelector('.artifact-with-source');
    const artifactFrame = container.querySelector<HTMLElement>('.artifact-frame');
    expect(artifactFrame).not.toBeNull();
    expect(wrapper?.classList.contains('artifact-with-source--preview')).toBe(true);
    // "Show code" is a floating overlay action button.
    const showCode = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(showCode).not.toBeNull();
    expect(showCode?.getAttribute('aria-label')).toBe('Show code');
    expect(showCode?.classList.contains('artifact-floating-action-button')).toBe(true);
    expect(wrapper?.querySelector('.artifact-floating-actions')?.contains(showCode)).toBe(true);
    expect(artifactFrame?.querySelector('.artifact-frame-actions')).toBeNull();
    expect(artifactFrame?.classList.contains('has-artifact-action')).toBe(false);
    // Switch back to source.
    act(() => {
      showCode?.click();
    });
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
    expect(container.querySelector('.md-code-collapsible')?.classList.contains('is-expanded')).toBe(
      true,
    );
    expect(
      container
        .querySelector('.artifact-with-source')
        ?.classList.contains('artifact-with-source--preview'),
    ).toBe(false);
    const previewAgain = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(previewAgain?.textContent).toContain('Preview');
    scrollHeight.mockRestore();
  });

  it('default mode: Show code keeps a Preview toggle so the frame can come back', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    const showCode = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(showCode?.getAttribute('aria-label')).toBe('Show code');
    act(() => {
      showCode?.click();
    });
    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
    const preview = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(preview?.textContent).toContain('Preview');
    act(() => {
      preview?.click();
    });
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();
  });

  it('streaming Show code still offers Preview to switch back', async () => {
    const { container } = renderMarkdown(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="streaming" />,
    );
    await flushMarkdownEffects();
    const showCode = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(showCode?.getAttribute('aria-label')).toBe('Show code');
    act(() => {
      showCode?.click();
    });
    expect(container.querySelector('.artifact-frame')).toBeNull();
    const preview = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-preview-toggle"]',
    );
    expect(preview?.textContent).toContain('Preview');
    act(() => {
      preview?.click();
    });
    await flushMarkdownEffects();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
  });

  it('in-place toggle: static SVG replaces source without mounting an iframe', () => {
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
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-static"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('diff fences use old/new file line numbers from hunk headers', () => {
    const diffFence = [
      '```diff',
      '--- a/src/utils.ts',
      '+++ b/src/utils.ts',
      '@@ -1,3 +1,4 @@',
      '-old line',
      '+new line a',
      '+new line b',
      ' keep',
      '```',
    ].join('\n');
    const { container } = renderMarkdown(
      <MarkdownView text={diffFence} renderingPhase="completed" />,
    );
    expect(container.querySelector('.md-code-diff')).not.toBeNull();
    const oldNums = [...container.querySelectorAll('.md-code-line-num-old')].map(
      (el) => el.textContent ?? '',
    );
    const newNums = [...container.querySelectorAll('.md-code-line-num-new')].map(
      (el) => el.textContent ?? '',
    );
    // meta/hunk rows have empty gutters; content rows track real file lines.
    expect(oldNums).toEqual(['', '', '', '1', '', '', '2']);
    expect(newNums).toEqual(['', '', '', '', '1', '2', '3']);
  });

  it('non-diff fences keep sequential line numbers', () => {
    const fence = '```ts\nconst a = 1;\nconst b = 2;\n```';
    const { container } = renderMarkdown(<MarkdownView text={fence} renderingPhase="completed" />);
    const nums = [...container.querySelectorAll('.md-code-line-num')].map(
      (el) => el.textContent ?? '',
    );
    expect(nums).toEqual(['1', '2']);
  });
});

describe('MarkdownView file references', () => {
  afterEach(() => {
    cleanupMountedMarkdownRenders();
  });

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
    expect(chip?.querySelector('.chip-text')?.textContent ?? chip?.textContent).toContain(
      '自我介绍.md',
    );
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
    expect(chip?.querySelector('.chip-text')?.textContent ?? chip?.textContent).toContain(
      'README.md',
    );
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
    expect(chip?.querySelector('.chip-text')?.textContent ?? chip?.textContent).toContain(
      'My Notes',
    );
    expect(chip?.getAttribute('data-full-path')).toBe(fullPath);
    act(() => {
      chip?.click();
    });
    expect(onOpenDocument).toHaveBeenCalledWith({ title: 'My Notes', path: fullPath });
  });

  it('turns relative deliverable links into path chips instead of [blocked]', () => {
    const onOpenDocument = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text={[
          '获取结果：',
          '- 压缩包: [cropped-portraits-16.zip](cropped-portraits-16.zip)',
          '- 目录: [cropped-portraits/](cropped-portraits/)',
        ].join('\n')}
        renderingPhase="completed"
        onOpenDocument={onOpenDocument}
      />,
    );
    expect(container.textContent ?? '').not.toContain('[blocked]');
    const chips = [...container.querySelectorAll<HTMLElement>('.md-doc-chip')];
    expect(chips.length).toBeGreaterThanOrEqual(2);
    const paths = chips.map((chip) => chip.getAttribute('data-full-path'));
    expect(paths).toContain('cropped-portraits-16.zip');
    expect(paths).toContain('cropped-portraits/');
    act(() => {
      chips
        .find((chip) => chip.getAttribute('data-full-path') === 'cropped-portraits-16.zip')
        ?.click();
    });
    expect(onOpenDocument).toHaveBeenCalledWith({
      title: 'cropped-portraits-16.zip',
      path: 'cropped-portraits-16.zip',
    });
  });

  it('resolves relative deliverable chips against projectPath', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text="[cropped-portraits-16.zip](cropped-portraits-16.zip)"
        renderingPhase="completed"
        projectPath="/Users/me/proj"
        onOpenDocument={vi.fn()}
      />,
    );
    const chip = container.querySelector<HTMLElement>('.md-doc-chip');
    expect(chip?.getAttribute('data-full-path')).toBe('/Users/me/proj/cropped-portraits-16.zip');
  });

  it('opens absolute zip links via path chips (file: stripped)', () => {
    const onOpenDocument = vi.fn();
    const { container } = renderMarkdown(
      <MarkdownView
        text="[包](file:///Users/me/out.zip)"
        renderingPhase="completed"
        onOpenDocument={onOpenDocument}
      />,
    );
    expect(container.textContent ?? '').not.toContain('[blocked]');
    const chip = container.querySelector<HTMLElement>('.md-doc-chip');
    expect(chip?.getAttribute('data-full-path')).toBe('/Users/me/out.zip');
    act(() => {
      chip?.click();
    });
    expect(onOpenDocument).toHaveBeenCalledWith({ title: '包', path: '/Users/me/out.zip' });
  });

  it('renders bash command line code blocks with shell formatting', () => {
    const bashText = '```bash\npnpm run dev\n```';
    const { container } = renderMarkdown(
      <MarkdownView text={bashText} renderingPhase="completed" />,
    );
    const codeBlock = container.querySelector('[data-is-shell="true"]');
    expect(codeBlock).not.toBeNull();
    const shellIcon = container.querySelector('.md-code-shell-icon');
    expect(shellIcon).not.toBeNull();
    expect(shellIcon?.textContent).toBe('$');
  });

  it('renders markdown tables with proper structure and text-align styles', () => {
    const tableText = `
| Header 1 | Header 2 |
| :--- | ---: |
| Left cell | Right cell |
`;
    const { container } = renderMarkdown(
      <MarkdownView text={tableText} renderingPhase="completed" />,
    );
    const table = container.querySelector('[data-testid="md-table"]');
    expect(table).not.toBeNull();
    const headers = container.querySelectorAll('.md-table th');
    expect(headers.length).toBe(2);
    expect((headers[0] as HTMLElement).style.textAlign).toBe('left');
    expect((headers[1] as HTMLElement).style.textAlign).toBe('right');
  });

  it('renders Streamdown streaming caret without adding a second cursor node', () => {
    const { container } = renderMarkdown(
      <MarkdownView text="Hello streaming token" renderingPhase="streaming" />,
    );
    const p = container.querySelector('p.md-p');
    expect(p).not.toBeNull();
    expect(container.querySelector('.markdown')?.classList.contains('has-stream-caret')).toBe(true);
    expect(container.querySelector('.markdown')?.getAttribute('style') ?? '').not.toContain(
      '--streamdown-caret',
    );
    expect(container.querySelector('[data-sd-animate]')).toBeNull();
    expect(container.querySelector('.markdown > .streaming-cursor-pulse')).toBeNull();
  });

  it('does not render a caret for empty or non-owner streaming content', () => {
    const empty = renderMarkdown(<MarkdownView text="" renderingPhase="streaming" />);
    expect(empty.container.querySelector('.markdown')?.classList.contains('has-stream-caret')).toBe(
      false,
    );
    unmountMarkdown(empty);

    const notOwner = renderMarkdown(
      <MarkdownView
        text="This is not the live text owner"
        renderingPhase="streaming"
        showStreamingCaret={false}
      />,
    );
    expect(
      notOwner.container.querySelector('.markdown')?.classList.contains('has-stream-caret'),
    ).toBe(false);
    unmountMarkdown(notOwner);
  });

  it('keeps the live caret attached to text instead of a trailing blank line', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={'紧密衔接\n\n'} renderingPhase="streaming" />,
    );
    const markdown = container.querySelector('.markdown');
    expect(markdown?.classList.contains('has-stream-caret')).toBe(true);
    expect(markdown?.textContent).toBe('紧密衔接');
  });

  it('defers code-fence syntax highlighting until streaming completes', () => {
    const fence = '```ts\nconst answer = 42;\n```';
    const streaming = renderMarkdown(<MarkdownView text={fence} renderingPhase="streaming" />);
    expect(
      streaming.container.querySelector('.md-code-content')?.getAttribute('data-syntax-highlight'),
    ).toBe('deferred');
    unmountMarkdown(streaming);

    const completed = renderMarkdown(<MarkdownView text={fence} renderingPhase="completed" />);
    expect(
      completed.container.querySelector('.md-code-content')?.getAttribute('data-syntax-highlight'),
    ).toBe('enabled');
  });

  it('does not treat env vars or prices as KaTeX', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text="Set $HOME and $PATH. 价格是 $100，折扣后 $50。"
        renderingPhase="completed"
      />,
    );
    const markdown = container.querySelector('.markdown');
    expect(markdown?.querySelector('.katex')).toBeNull();
    expect(markdown?.textContent).toContain('$HOME');
    expect(markdown?.textContent).toContain('$PATH');
    expect(markdown?.textContent).toContain('$100');
    expect(markdown?.textContent).toContain('$50');
  });

  it('still renders display math with $$ delimiters', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={'公式 $$E=mc^2$$ 结束'} renderingPhase="completed" />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('annotation')?.textContent).toContain('E=mc^2');
  });

  it('shows HTML tag mentions as text instead of creating DOM nodes', () => {
    const { container } = renderMarkdown(
      <MarkdownView text="Use the <div> element and </div> to wrap." renderingPhase="completed" />,
    );
    const markdown = container.querySelector('.markdown');
    expect(markdown?.querySelector('div')).toBeNull();
    expect(markdown?.textContent).toContain('<div>');
    expect(markdown?.textContent).toContain('</div>');
  });

  it('keeps source-file inline code as code, not path chips', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text="Edit `main.ts` and `.tsx`, not `.svg`."
        renderingPhase="completed"
        onOpenDocument={vi.fn()}
      />,
    );
    const chips = [...container.querySelectorAll('.md-doc-chip')].map((el) =>
      el.getAttribute('data-full-path'),
    );
    expect(chips).toEqual(['.svg']);
    expect(container.querySelector('.md-inline-code')?.textContent).toBe('main.ts');
  });

  it('renders GFM task lists, strikethrough, callouts, and no raw HTML nodes', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={[
          '- [x] shipped',
          '- [ ] pending',
          '',
          '~~old wording~~',
          '',
          '> [!TIP]',
          '> Prefer the reusable renderer.',
          '',
          '<script data-untrusted="true">alert(1)</script>',
        ].join('\n')}
        renderingPhase="completed"
      />,
    );
    expect(container.querySelectorAll('.md-task-checkbox')).toHaveLength(2);
    expect(container.querySelector('.md-task-checkbox:checked')).not.toBeNull();
    expect(container.querySelector('.md-del')?.textContent).toBe('old wording');
    expect(container.querySelector('[data-testid="callout-tip"]')).not.toBeNull();
    expect(container.querySelector('script[data-untrusted="true"]')).toBeNull();
  });
});

describe('MarkdownView local media images', () => {
  afterEach(() => {
    cleanupMountedMarkdownRenders();
  });

  it('does not render host filesystem image paths', () => {
    const { container } = renderMarkdown(
      <MarkdownView
        text={'这是生成的结果：\n\n![cat](/Users/me/.piwin/media/session/a.jpg)'}
        renderingPhase="completed"
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('这是生成的结果');
  });

  it('still renders remote images', () => {
    const { container } = renderMarkdown(
      <MarkdownView text={'![cat](https://example.com/cat.jpg)'} renderingPhase="completed" />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/cat.jpg');
  });
});
