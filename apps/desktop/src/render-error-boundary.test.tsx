// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import * as artifact from '@piwin/artifact';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { AppErrorBoundary } from './AppErrorBoundary';
import { ArtifactCanvasPanel } from './artifact-canvas-panel';
import {
  analyzeArtifactFence,
  createArtifactFenceRecord,
  type ArtifactRenderIntent,
} from '@piwin/artifact';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import { MarkdownView } from './MarkdownView';
import { RenderErrorBoundary } from './render-error-boundary';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderTree(node: ReactElement): { container: HTMLElement; root: Root } {
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

afterEach(() => {
  while (mounted.length > 0) {
    const render = mounted.pop();
    if (!render) continue;
    try {
      act(() => {
        render.root.unmount();
      });
    } catch {
      // already unmounted
    }
    render.container.remove();
  }
  vi.restoreAllMocks();
});

function Boom(): ReactElement {
  throw new Error('halfway stream boom');
}

function makeCanvasIntent(source: string): ArtifactRenderIntent {
  const analysis = analyzeArtifactFence(
    createArtifactFenceRecord({
      info: 'artifact-html title="鹈鹕骑自行车 · 2D 动画" surface="canvas"',
      source,
    }),
    { id: 'artifact-pelican-0', htmlUiModeEnabled: true, mode: 'stream-preview' },
  );
  if (analysis.kind !== 'intent') {
    throw new Error(`expected canvas intent, got ${analysis.kind}`);
  }
  return analysis.intent;
}

function makeCanvasTarget(source: string): ArtifactCanvasTarget {
  const intent = makeCanvasIntent(source);
  return {
    id: 'canvas:s1:m1:0',
    sessionId: 's1',
    messageId: 'm1',
    fenceIndex: 0,
    channelId: 'artifact-pelican-0',
    surface: 'canvas',
    title: '鹈鹕骑自行车 · 2D 动画',
    type: 'html',
    declaration: 'explicit',
    documentKind: intent.descriptor.documentKind,
    rawLanguage: 'artifact-html',
    source,
    intent,
    streaming: true,
  };
}

const PELICAN_HTML = [
  '<!DOCTYPE html>',
  '<html><head><meta charset="utf-8"><title>pelican</title>',
  '<style>',
  'body{margin:0;background:#0b1220;color:#fff}',
  '.scene{position:relative;width:100%;height:100%}',
  '@keyframes ride{from{transform:translateX(-20%)}to{transform:translateX(120%)}}',
  '.pelican{animation:ride 4s linear infinite}',
  '</style></head><body>',
  '<div class="scene"><div class="sky"></div>',
  '<div class="pelican"><svg viewBox="0 0 120 80"><circle cx="40" cy="30" r="18"/></svg></div>',
  '</div>',
  '<script>function tick(x){requestAnimationFrame(function(){tick(x+1)})}tick(0)</script>',
  '</body></html>',
].join('\n');

function pelicanMarkdown(prefixLength: number): string {
  const body = PELICAN_HTML.slice(0, prefixLength);
  return ['```artifact-html title="鹈鹕骑自行车 · 2D 动画" surface="canvas"', body].join('\n');
}

describe('RenderErrorBoundary', () => {
  it('contains a child throw so AppErrorBoundary does not take the shell', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = renderTree(
      <AppErrorBoundary>
        <RenderErrorBoundary locale="zh-CN" surface="canvas" resetKey="k0">
          <Boom />
        </RenderErrorBoundary>
      </AppErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="app-error-boundary"]')).toBeNull();
    expect(container.querySelector('[data-testid="render-error-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain('画布预览出错');
    expect(container.textContent).toContain('halfway stream boom');
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it('retries when resetKey changes after a catch', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container, root } = renderTree(
      <RenderErrorBoundary locale="en" surface="markdown" resetKey="a">
        <Boom />
      </RenderErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="render-error-boundary"]')).not.toBeNull();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RenderErrorBoundary locale="en" surface="markdown" resetKey="b">
            <p data-testid="recovered">ok</p>
          </RenderErrorBoundary>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="render-error-boundary"]')).toBeNull();
    expect(container.querySelector('[data-testid="recovered"]')?.textContent).toBe('ok');
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});

describe('streaming canvas HTML must not blank the desktop shell', () => {
  it('keeps AppErrorBoundary idle while a canvas HTML animation streams in', () => {
    const { container, root } = renderTree(
      <AppErrorBoundary>
        <MarkdownView
          text={pelicanMarkdown(40)}
          renderingPhase="streaming"
          locale="zh-CN"
          artifactOrigin={{ sessionId: 's1', messageId: 'm1' }}
          onOpenArtifactCanvas={() => undefined}
        />
      </AppErrorBoundary>,
    );

    const prefixes = [80, 180, 320, 480, PELICAN_HTML.length];
    for (const prefix of prefixes) {
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <AppErrorBoundary>
              <MarkdownView
                text={pelicanMarkdown(prefix)}
                renderingPhase="streaming"
                locale="zh-CN"
                artifactOrigin={{ sessionId: 's1', messageId: 'm1' }}
                onOpenArtifactCanvas={() => undefined}
              />
            </AppErrorBoundary>
          </PiwinUiProvider>,
        );
      });
      expect(container.querySelector('[data-testid="app-error-boundary"]')).toBeNull();
    }
  });

  it('contains a Canvas materialize throw inside the panel', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(artifact, 'materializeArtifact').mockImplementation(() => {
      throw new Error('halfway materialize');
    });
    const { container } = renderTree(
      <AppErrorBoundary>
        <ArtifactCanvasPanel activeTarget={makeCanvasTarget(PELICAN_HTML.slice(0, 220))} />
      </AppErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="app-error-boundary"]')).toBeNull();
    expect(container.querySelector('[data-testid="render-error-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain('halfway materialize');
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
