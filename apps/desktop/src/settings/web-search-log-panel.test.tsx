// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostResponse, WebSearchLogEntry } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { WebSearchLogPanel, type WebSearchLogPanelProps } from './web-search-log-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const entries: WebSearchLogEntry[] = [
  {
    id: 'e2',
    recordedAt: new Date().toISOString(),
    sessionId: 'session-a',
    query: 'tauri webkit iframe sandbox',
    ok: true,
    providerId: 'aggregate:brave+tavily',
    hitCount: 6,
    durationMs: 5010,
    attempts: [
      { sourceId: 'brave', ok: false, hitCount: 0, durationMs: 5002, timedOut: true },
      { sourceId: 'tavily', ok: true, hitCount: 6, durationMs: 1240 },
    ],
  },
  {
    id: 'e1',
    recordedAt: new Date().toISOString(),
    sessionId: 'session-b',
    query: 'pnpm catalog',
    ok: false,
    providerId: 'brave',
    hitCount: 0,
    durationMs: 312,
    attempts: [{ sourceId: 'brave', ok: false, hitCount: 0, durationMs: 312, error: 'HTTP 429' }],
    error: 'Brave search failed: HTTP 429',
  },
];

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WebSearchLogPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(request: WebSearchLogPanelProps['request']): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WebSearchLogPanel locale="zh-CN" request={request} />
        </PiwinUiProvider>,
      );
    });
  }

  it('lists calls, marks partial and full failures, and expands source detail', async () => {
    const request = vi.fn(
      async (): Promise<HostResponse> => ({
        type: 'response',
        command: 'web/search-log-list',
        success: true,
        data: { page: { entries, total: 2, offset: 0, limit: 50 } },
      }),
    );
    render(request);
    await flush();

    expect(request).toHaveBeenCalledWith({
      type: 'web/search-log-list',
      limit: 50,
      offset: 0,
      logStatus: 'all',
    });
    expect(container.querySelector('[data-testid="web-search-log-count"]')?.textContent).toBe(
      '共 2 条',
    );
    const rows = container.querySelectorAll<HTMLButtonElement>('[data-testid="web-search-log-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.closest('li')?.classList.contains('is-partial')).toBe(true);
    expect(rows[0]?.textContent).toContain('1 源失败');
    expect(rows[1]?.closest('li')?.classList.contains('is-failed')).toBe(true);

    act(() => rows[1]?.click());
    const detail = container.querySelector('[data-testid="web-search-log-detail"]');
    expect(detail?.textContent).toContain('Brave search failed: HTTP 429');
    expect(detail?.textContent).toContain('session-b');
    expect(detail?.querySelectorAll('[data-testid="tool-call-web-search-attempt"]')).toHaveLength(1);
  });

  it('asks for confirmation before clearing, then reloads', async () => {
    let cleared = false;
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => {
      if (command.type === 'web/search-log-clear') {
        cleared = true;
        return { type: 'response', command: 'web/search-log-clear', success: true, data: {} };
      }
      const rows = cleared ? [] : entries;
      return {
        type: 'response',
        command: 'web/search-log-list',
        success: true,
        data: { page: { entries: rows, total: rows.length, offset: 0, limit: 50 } },
      };
    });
    render(request);
    await flush();

    const clear = container.querySelector<HTMLButtonElement>('[data-testid="web-search-log-clear"]');
    act(() => clear?.click());
    expect(cleared).toBe(false);
    expect(clear?.textContent).toBe('确认清空');
    await act(async () => clear?.click());
    await flush();
    expect(cleared).toBe(true);
    expect(container.querySelector('[data-testid="web-search-log-empty"]')).not.toBeNull();
  });
});
