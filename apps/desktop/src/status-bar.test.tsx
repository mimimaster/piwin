// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar } from './status-bar.js';
import { buildStatusBarMetrics } from './status-bar-metrics.js';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('StatusBar turn telemetry', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render(node: ReactElement): void {
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
  }

  it('stays absent before the first Run or usage sample', () => {
    render(<StatusBar locale="en" />);

    expect(container.querySelector('[data-testid="status-bar"]')).toBeNull();
  });

  it('renders one icon-led rail without duplicating Composer model or context controls', () => {
    render(
      <StatusBar
        locale="en"
        contextUsage={{
          sessionId: 'session-chat',
          promptTokens: 700,
          completionTokens: 200,
          source: 'host-estimate',
          updatedAt: '2026-08-16T00:00:00.000Z',
        }}
      />,
    );

    expect(container.textContent).toContain('Last turn');
    expect(container.textContent).toContain('Input~700');
    expect(container.textContent).toContain('Output~200');
    expect(container.querySelectorAll('svg')).toHaveLength(3);
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows compact duration, token and cache metrics without inventing absent fields', () => {
    render(
      <StatusBar
        locale="zh-CN"
        contextUsage={{
          sessionId: 'session-chat',
          promptTokens: 700,
          completionTokens: 200,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
          durationMs: 1_250,
          source: 'assistant-usage',
          updatedAt: '2026-08-16T00:00:00.000Z',
        }}
      />,
    );

    expect(container.querySelector('[data-testid="status-bar-metric-duration"]')?.textContent).toBe(
      '耗时1.3s',
    );
    expect(container.querySelector('[data-testid="status-bar-metric-input"]')?.textContent).toBe(
      '输入700',
    );
    expect(container.querySelector('[data-testid="status-bar-metric-output"]')?.textContent).toBe(
      '输出200',
    );
    expect(container.querySelector('[data-testid="status-bar-metric-cache"]')?.textContent).toBe(
      '缓存12%',
    );
  });
});

describe('buildStatusBarMetrics', () => {
  it('uses the active Run clock and marks host-estimated tokens', () => {
    expect(
      buildStatusBarMetrics({
        usage: {
          sessionId: 'session-chat',
          promptTokens: 1_200,
          completionTokens: 300,
          source: 'host-estimate',
          updatedAt: '2026-08-16T00:00:00.000Z',
        },
        agentState: 'running',
        runStartedAt: 1_000,
        now: 66_000,
        locale: 'en',
      }),
    ).toEqual([
      { id: 'duration', label: 'Duration', value: '1:05' },
      { id: 'input', label: 'Input', value: '~1.2K' },
      { id: 'output', label: 'Output', value: '~300' },
    ]);
  });

  it('does not present the previous turn usage as part of a new active Run', () => {
    expect(
      buildStatusBarMetrics({
        usage: {
          sessionId: 'session-chat',
          promptTokens: 1_200,
          completionTokens: 300,
          cacheReadTokens: 600,
          source: 'assistant-usage',
          updatedAt: '2026-08-16T00:00:00.000Z',
        },
        agentState: 'running',
        runStartedAt: Date.parse('2026-08-16T00:01:00.000Z'),
        now: Date.parse('2026-08-16T00:01:05.000Z'),
        locale: 'zh-CN',
      }),
    ).toEqual([{ id: 'duration', label: '耗时', value: '5s' }]);
  });

  it('reports an explicit unknown cache rate for a zero prompt-side denominator', () => {
    const metrics = buildStatusBarMetrics({
      usage: {
        sessionId: 'session-chat',
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        source: 'assistant-usage',
        updatedAt: '2026-08-16T00:00:00.000Z',
      },
      agentState: 'idle',
      runStartedAt: undefined,
      now: 0,
      locale: 'zh-CN',
    });

    expect(metrics).toEqual([{ id: 'cache', label: '缓存', value: '—' }]);
  });
});
