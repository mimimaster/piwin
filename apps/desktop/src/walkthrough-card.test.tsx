// @vitest-environment happy-dom
/**
 * WalkthroughCard state rendering coverage (spec §5.3, §15.6).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { WalkthroughCard } from './walkthrough-card';
import type { WalkthroughArtifact } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function renderCard(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

function readyArtifact(
  overrides: Partial<WalkthroughArtifact> & { status?: 'ready' } = {},
): WalkthroughArtifact {
  const base = {
    version: 1 as const,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default' as const,
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    ...base,
    status: 'ready',
    markdown: '# Walkthrough\n\n## Summary\n\nBody text.',
    generatedAt: '2026-01-01T00:00:00.000Z',
    model: { protocol: 'openai-compatible', providerId: 'mock', modelId: 'mock-wt' },
    ...overrides,
  } as WalkthroughArtifact;
}

function generatingArtifact(): WalkthroughArtifact {
  return {
    version: 1,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default',
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'generating',
    generationId: 'gen-1',
  };
}

function errorArtifact(): WalkthroughArtifact {
  return {
    version: 1,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default',
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'error',
    error: { code: 'model-unavailable', message: 'No model configured.' },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('WalkthroughCard', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders markdown content for a ready artifact', () => {
    const { container } = renderCard(<WalkthroughCard artifact={readyArtifact()} messageId="a1" />);
    expect(container.querySelector('[data-testid="walkthrough-card-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-status-a1"]')?.textContent).toBe(
      'Ready',
    );
    // Markdown body text is rendered.
    expect(container.textContent).toContain('Walkthrough');
  });

  it('shows error message for an error artifact', () => {
    const { container } = renderCard(
      <WalkthroughCard artifact={errorArtifact()} messageId="a1" onRegenerate={() => undefined} />,
    );
    expect(container.querySelector('[data-testid="walkthrough-error-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-error-a1"]')?.textContent).toContain(
      'No model configured',
    );
    expect(container.querySelector('[data-testid="walkthrough-retry-btn-a1"]')).toBeTruthy();
  });

  it('shows loading state for a generating artifact', () => {
    const { container } = renderCard(
      <WalkthroughCard artifact={generatingArtifact()} messageId="a1" />,
    );
    expect(container.querySelector('[data-testid="walkthrough-loading-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-status-a1"]')?.textContent).toBe(
      'Generating',
    );
  });

  it('calls onOpenDocument when View as document is clicked', () => {
    let opened: { title: string; path?: string; content?: string } | undefined;
    const { container } = renderCard(
      <WalkthroughCard
        artifact={readyArtifact()}
        messageId="a1"
        onOpenDocument={(doc) => {
          opened = doc;
        }}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-doc-btn-a1"]',
    );
    expect(btn).toBeTruthy();
    act(() => {
      btn?.click();
    });
    expect(opened).toBeDefined();
    expect(opened?.path).toBe('walkthroughs/a1.md');
    expect(opened?.content).toContain('Walkthrough');
  });

  it('calls onRegenerate when Regenerate is clicked', () => {
    let regenerated = false;
    const { container } = renderCard(
      <WalkthroughCard
        artifact={readyArtifact()}
        messageId="a1"
        onRegenerate={() => {
          regenerated = true;
        }}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-regenerate-btn-a1"]',
    );
    expect(btn).toBeTruthy();
    act(() => {
      btn?.click();
    });
    expect(regenerated).toBe(true);
  });

  it('does not enable Artifact iframe for walkthrough markdown (spec §15.6 case 12)', () => {
    // Walkthrough markdown is source-only (§5.3). Even when the markdown
    // contains an ```html fence, no Artifact iframe should be mounted.
    const artifact = readyArtifact({
      markdown: '# Walkthrough\n\n```html\n<div>hello</div>\n```\n',
    });
    const { container } = renderCard(<WalkthroughCard artifact={artifact} messageId="a1" />);
    // No iframe is rendered for the html fence.
    expect(container.querySelector('iframe')).toBeNull();
    // The source-only path renders a code-fence-source block instead.
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeTruthy();
  });

  it('renders zh-CN strings when locale is zh-CN', () => {
    const { container } = renderCard(
      <WalkthroughCard
        artifact={readyArtifact()}
        messageId="a1"
        locale="zh-CN"
        onOpenDocument={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="walkthrough-status-a1"]')?.textContent).toBe(
      '就绪',
    );
    expect(container.querySelector('.walkthrough-card-title')?.textContent).toBe('演练');
    const docBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-doc-btn-a1"]',
    );
    expect(docBtn?.textContent).toContain('作为文档查看');
  });

  it('renders zh-CN generating status and loading text', () => {
    const { container } = renderCard(
      <WalkthroughCard artifact={generatingArtifact()} messageId="a1" locale="zh-CN" />,
    );
    expect(container.querySelector('[data-testid="walkthrough-status-a1"]')?.textContent).toBe(
      '生成中',
    );
    expect(container.querySelector('[data-testid="walkthrough-loading-a1"]')?.textContent).toBe(
      '正在生成演练…',
    );
  });
});
