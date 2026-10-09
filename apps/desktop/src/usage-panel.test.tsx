// @vitest-environment happy-dom
/** Token usage statistics panel (CE-OBS). */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, UsageCallLog, UsageRollup } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { UsagePanel, type UsagePanelProps } from './usage-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_ROLLUP: UsageRollup = {
  scope: { kind: 'project', projectPath: '/tmp/proj' },
  promptTokens: 600,
  completionTokens: 400,
  cacheReadTokens: 150,
  cacheWriteTokens: 50,
  totalTokens: 1_200,
  entryCount: 3,
  sessionCount: 2,
  firstAt: '2026-08-01T10:00:00.000Z',
  lastAt: '2026-08-02T09:00:00.000Z',
  byModel: {
    'gpt-4o': {
      promptTokens: 600,
      completionTokens: 400,
      cacheReadTokens: 150,
      cacheWriteTokens: 50,
      totalTokens: 1_200,
      entryCount: 3,
    },
  },
  byModelKey: [
    {
      providerId: 'work-key',
      modelId: 'gpt-4o',
      promptTokens: 400,
      completionTokens: 250,
      cacheReadTokens: 120,
      cacheWriteTokens: 30,
      totalTokens: 800,
      entryCount: 2,
      durationMs: 2_500,
      durationMsCompletionTokens: 250,
    },
    {
      providerId: 'personal-key',
      modelId: 'gpt-4o',
      promptTokens: 200,
      completionTokens: 150,
      cacheReadTokens: 30,
      cacheWriteTokens: 20,
      totalTokens: 400,
      entryCount: 1,
    },
  ],
  byDay: {
    '2026-08-01': {
      promptTokens: 500,
      completionTokens: 300,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalTokens: 950,
      entryCount: 2,
    },
    '2026-08-02': {
      promptTokens: 100,
      completionTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      totalTokens: 250,
      entryCount: 1,
    },
  },
  bySession: [
    {
      sessionId: 's1',
      promptTokens: 500,
      completionTokens: 300,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalTokens: 950,
      entryCount: 2,
      firstAt: '2026-08-01T10:00:00.000Z',
      lastAt: '2026-08-01T11:00:00.000Z',
    },
    {
      sessionId: 's2',
      promptTokens: 100,
      completionTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      totalTokens: 250,
      entryCount: 1,
      firstAt: '2026-08-02T09:00:00.000Z',
      lastAt: '2026-08-02T09:00:00.000Z',
    },
  ],
};

type UsageRequestCommand = {
  type: 'usage/get-rollup' | 'usage/list-recent';
  projectPath?: string;
  scope?: { kind: 'general' };
  window?: { from?: string; to?: string };
  topSessions?: number;
  windowMinutes?: number;
  limit?: number;
  offset?: number;
  timeZone?: string;
};

const SAMPLE_CALL_LOG: UsageCallLog = {
  windowMinutes: 60,
  from: '2026-08-02T08:00:00.000Z',
  to: '2026-08-02T09:00:00.000Z',
  entries: [
    {
      id: 'call-1',
      recordedAt: '2026-08-02T08:58:00.000Z',
      sessionId: 'session-abcdef12',
      projectPath: '/tmp/proj',
      providerId: 'work-key',
      modelId: 'gpt-4o',
      thinkingLevel: 'high',
      promptTokens: 400,
      completionTokens: 250,
      cacheReadTokens: 1_200,
      cacheWriteTokens: 0,
      totalTokens: 1_850,
      durationMs: 2_500,
      firstTokenMs: 350,
      firstTokenKind: 'reasoning',
      source: 'assistant-usage',
    },
    {
      id: 'call-2',
      recordedAt: '2026-08-02T08:31:00.000Z',
      sessionId: 'session-99887766',
      projectPath: '/tmp/proj',
      providerId: 'personal-key',
      modelId: 'gpt-4o',
      promptTokens: 900,
      completionTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 300,
      totalTokens: 1_280,
      source: 'host-estimate',
    },
  ],
  offset: 0,
  limit: 100,
  totalInWindow: 2,
  truncated: false,
};

function okResponse(data: unknown): HostResponse {
  return { type: 'response', command: 'usage/get-rollup', success: true, data };
}

/** Answers both panel commands so the recent-calls card renders. */
async function defaultRequest(command: UsageRequestCommand): Promise<HostResponse> {
  if (command.type === 'usage/list-recent') {
    return okResponse({ log: SAMPLE_CALL_LOG });
  }
  return okResponse({ rollup: SAMPLE_ROLLUP });
}

function renderPanel(props: Partial<UsagePanelProps> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const defaultProps: UsagePanelProps = {
    projectPath: '/tmp/proj',
    request: defaultRequest,
  };
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <UsagePanel {...defaultProps} {...props} />
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

async function flushLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('UsagePanel', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it('shows reference cost as the first summary card, with notes and breakdown on demand', async () => {
    const rollup: UsageRollup = {
      ...SAMPLE_ROLLUP, estimatedCostUsd: 0.006975, pricedEntryCount: 2,
      pricingCatalog: { source: 'models.dev', catalogVersion: 'models.dev@test', fetchedAt: '2026-10-09T00:00:00Z' },
      byModelKey: SAMPLE_ROLLUP.byModelKey.map((row, index) => index === 0
        ? { ...row, estimatedCostUsd: 0.006975, pricedEntryCount: 2, costReference: 'reference/gpt-4o' }
        : { ...row, pricedEntryCount: 0 }),
    };
    const log: UsageCallLog = { ...SAMPLE_CALL_LOG, entries: SAMPLE_CALL_LOG.entries.map((entry, index) => index === 0
      ? { ...entry, cost: { usd: 0.006975, reference: 'reference/gpt-4o' } } : entry) };
    ({ root, container } = renderPanel({ request: async (command) => okResponse(
      command.type === 'usage/list-recent' ? { log } : { rollup },
    ) }));
    await flushLoad();

    const cards = container?.querySelectorAll('.usage-summary-card');
    expect(cards?.[0]?.getAttribute('data-testid')).toBe('usage-cost-card');
    expect(cards?.[0]?.getAttribute('data-cost-state')).toBe('partial');
    expect(container?.querySelector('[data-testid="usage-cost-total"]')?.textContent).toBe('<$0.01');
    expect(container?.querySelector('[data-testid="usage-cost-meta"]')?.textContent).toContain('1');
    // No full-width cost panel and no reference paths on the default page.
    expect(container?.querySelector('[data-testid="usage-cost-details"]')).toBeNull();
    expect(container?.textContent).not.toContain('reference/gpt-4o');

    const notesTrigger = container?.querySelector<HTMLButtonElement>('[data-testid="usage-cost-notes-trigger"]');
    await act(async () => { notesTrigger?.click(); });
    const notes = document.querySelector('[data-testid="usage-cost-notes"]');
    expect(notes?.querySelector('[data-testid="usage-cost-exact"]')?.textContent).toBe('$0.0070');
    expect(notes?.querySelector('[data-testid="usage-cost-coverage"]')?.textContent).toMatch(/2.*3.*1/);
    expect(notes?.querySelector('[data-testid="usage-cost-source"]')?.textContent).toContain('models.dev');
    expect(notes?.querySelector('[data-testid="usage-cost-mappings"]')?.textContent).toContain('reference/gpt-4o');
    await act(async () => { notesTrigger?.click(); });

    const toggle = container?.querySelector<HTMLButtonElement>('[data-testid="usage-cost-details-toggle"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { toggle?.click(); });
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const rows = container?.querySelectorAll('[data-testid="usage-cost-model-row"]');
    expect(rows).toHaveLength(2);
    expect(rows?.[0]?.querySelector('[data-testid="usage-cost-row-cost"]')?.textContent).toBe('$0.0070');
    expect(rows?.[1]?.querySelector('[data-testid="usage-cost-row-cost"]')?.textContent).toBe('—');
    await act(async () => { toggle?.click(); });
    expect(container?.querySelector('[data-testid="usage-cost-details"]')).toBeNull();

    const cells = container?.querySelectorAll('[data-testid="usage-call-cost"]');
    expect(cells?.[0]?.textContent).toBe('$0.0070');
    expect(cells?.[0]?.getAttribute('title')).toBe('reference/gpt-4o');
    expect(cells?.[1]?.textContent).toBe('—');
  });

  it('keeps old Hosts unknown instead of showing a free cost', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();
    expect(container?.querySelector('[data-testid="usage-cost-card"]')?.getAttribute('data-cost-state')).toBe('unsupported');
    expect(container?.querySelector('[data-testid="usage-cost-total"]')?.textContent).toBe('—');
    expect(container?.querySelector('[data-testid="usage-cost-notes-trigger"]')).toBeNull();
    expect(container?.querySelector('[data-testid="usage-call-cost"]')?.textContent).toBe('—');
  });

  it('labels the heatmap as a fixed one-year window', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();
    expect(container?.querySelector('[data-testid="usage-heatmap-scope"]')?.textContent).toContain('不随上方范围变化');
  });

  it('consolidates cost, totals, cache efficiency, and activity into four summaries', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    expect(container?.querySelector('[data-testid="usage-total"]')?.textContent).toBe('1.2k');
    expect(container?.querySelector('[data-testid="usage-cache-rate"]')?.textContent).toBe('19%');
    expect(container?.querySelectorAll('.usage-summary-card')).toHaveLength(4);
    expect(
      container?.querySelector('[data-testid="usage-panel"]')?.getAttribute('data-scope'),
    ).toBe('project');
  });

  it('renders a one-year heatmap read in the viewer time zone with a hover card', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-03T12:00:00Z'), toFake: ['Date'] });
    const rollupCommands: UsageRequestCommand[] = [];
    const request = async (command: UsageRequestCommand) => {
      if (command.type === 'usage/list-recent') return okResponse({ log: SAMPLE_CALL_LOG });
      rollupCommands.push(command);
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    try {
      ({ root, container } = renderPanel({ request }));
      await flushLoad();
      await flushLoad();

      // Page rollup + the heatmap's own one-year rollup, both with a zone.
      expect(rollupCommands.length).toBeGreaterThanOrEqual(2);
      expect(rollupCommands.every((command) => typeof command.timeZone === 'string')).toBe(true);
      expect(container?.querySelector('.usage-perf-table')).toBeNull();

      const cells = container?.querySelectorAll('.usage-heatmap-cell[role="img"]') ?? [];
      expect(cells.length).toBeGreaterThan(360);
      const active = [...cells].filter((cell) => cell.getAttribute('data-level') !== '0');
      expect(active).toHaveLength(2);

      act(() => {
        active[0]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      expect(container?.querySelector('[data-testid="usage-heatmap-tooltip"]')?.textContent).toContain(
        'tokens',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('requests the selected project and defaults to a 30-day window', async () => {
    let requestedProjectPath: string | undefined;
    let requestedWindow: { from?: string; to?: string } | undefined;
    const request = async (command: UsageRequestCommand) => {
      if (command.type === 'usage/list-recent') {
        return okResponse({ log: SAMPLE_CALL_LOG });
      }
      requestedProjectPath = command.projectPath;
      requestedWindow = command.window;
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    expect(requestedProjectPath).toBe('/tmp/proj');
    expect(requestedWindow?.from).toBeTruthy();
  });

  it('can switch the time range to all time', async () => {
    // The heatmap reads its own one-year window; the page rollup is the one
    // that must drop its window for "all".
    const requestedWindows: Array<{ from?: string; to?: string } | undefined> = [];
    const request = async (command: UsageRequestCommand) => {
      if (command.type === 'usage/list-recent') {
        return okResponse({ log: SAMPLE_CALL_LOG });
      }
      requestedWindows.push(command.window);
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    const rangeSelect = container?.querySelector(
      'select[data-testid="usage-time-select"]',
    ) as HTMLSelectElement | null;
    expect(rangeSelect).toBeTruthy();
    act(() => {
      if (rangeSelect) {
        rangeSelect.value = 'all';
        rangeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await flushLoad();
    expect(requestedWindows).toContain(undefined);
  });

  it('does not render the model x Key card', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    expect(container?.querySelector('[data-testid="usage-model-key-table"]')).toBeNull();
  });

  it('renders recent calls with Key, first token latency, and TPS', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    const headers = Array.from(container?.querySelectorAll('.usage-calls-table th') ?? []).map(
      (th) => th.textContent?.trim(),
    );
    expect(headers).toContain('Key');
    expect(headers).not.toContain('Key（提供商配置）');
    expect(headers).toContain('思考度');
    expect(headers).not.toContain('Thinking');
    expect(headers).not.toContain('会话');
    expect(headers).not.toContain('Session');
    expect(headers).toContain('首字延迟');
    expect(headers).not.toContain('用时');
    expect(headers).toContain('TPS');
    expect(headers).not.toContain('输出速率');
    expect(headers.indexOf('思考度')).toBeLessThan(headers.indexOf('缓存'));
    expect(headers.indexOf('缓存')).toBeLessThan(headers.indexOf('首字延迟'));
    expect(headers.at(-1)).toBe('时间');

    const thinkingCells = container?.querySelectorAll('[data-testid="usage-call-thinking"]');
    expect(thinkingCells?.[0]?.textContent).toBe('高');
    expect(thinkingCells?.[1]?.textContent).toBe('—');

    const firstTokenCells = container?.querySelectorAll('[data-testid="usage-call-first-token"]');
    expect(firstTokenCells?.[0]?.textContent).toBe('350ms');
    expect(firstTokenCells?.[1]?.textContent).toBe('—');

    const tpsCells = container?.querySelectorAll('[data-testid="usage-call-tps"]');
    expect(tpsCells?.[0]?.textContent).toBe('116 tok/s');
    expect(tpsCells?.[1]?.textContent).toBe('—');
  });

  it('drops the intro copy from the toolbar', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    expect(container?.querySelector('.usage-toolbar-copy')).toBeNull();
    expect(container?.textContent).not.toContain('看清 Token 去向');
  });

  it('labels aggregate turn TPS so it is not mistaken for model decode speed', async () => {
    ({ root, container } = renderPanel({ request: async (command) => {
      if (command.type !== 'usage/list-recent') return defaultRequest(command);
      return okResponse({ log: {
        ...SAMPLE_CALL_LOG,
        entries: SAMPLE_CALL_LOG.entries.map((entry) => ({ ...entry, timingScope: 'turn' })),
      } });
    } }));
    await flushLoad();
    const cell = container?.querySelector('[data-testid="usage-call-tps"]');
    expect(cell?.textContent).toBe('116 tok/s（整轮）');
    expect(cell?.getAttribute('title')).toContain('包含工具执行和审批等待');
  });

  it('lists the rolling one-hour call log with a per-call cache verdict', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    const rows = container?.querySelectorAll('[data-testid="usage-call-row"]');
    expect(rows).toHaveLength(2);
    expect(container?.querySelectorAll('.usage-call-thinking')).toHaveLength(2);
    const cacheCells = container?.querySelectorAll('.usage-call-cache');
    expect(cacheCells?.[0]?.getAttribute('data-hit')).toBe('true');
    expect(cacheCells?.[1]?.getAttribute('data-hit')).toBe('false');
    expect(
      container?.querySelector('[data-testid="usage-recent-calls-summary"]')?.textContent,
    ).toContain('2');
  });

  it('requests the rolling window scoped to the selected project', async () => {
    let recentCommand: UsageRequestCommand | undefined;
    const request = async (command: UsageRequestCommand) => {
      if (command.type === 'usage/list-recent') {
        recentCommand = command;
        return okResponse({ log: SAMPLE_CALL_LOG });
      }
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    expect(recentCommand?.windowMinutes).toBe(60);
    expect(recentCommand?.projectPath).toBe('/tmp/proj');
  });

  it('pages the call log and pauses the live poll while paging', async () => {
    const pageSize = 100;
    const requested: Array<{ offset: number | undefined; limit: number | undefined }> = [];
    const request = async (command: UsageRequestCommand): Promise<HostResponse> => {
      if (command.type === 'usage/list-recent') {
        requested.push({ offset: command.offset, limit: command.limit });
        const offset = command.offset ?? 0;
        return okResponse({
          log: {
            ...SAMPLE_CALL_LOG,
            offset,
            limit: pageSize,
            totalInWindow: 250,
            truncated: true,
          },
        });
      }
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    expect(requested[0]?.limit).toBe(pageSize);
    expect(requested[0]?.offset).toBe(0);
    expect(container?.querySelector('[data-testid="usage-calls-range"]')?.textContent).toBe(
      '1–2 / 250',
    );
    const previous = container?.querySelector(
      '[data-testid="usage-calls-prev"]',
    ) as HTMLButtonElement | null;
    const next = container?.querySelector(
      '[data-testid="usage-calls-next"]',
    ) as HTMLButtonElement | null;
    expect(previous?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
    expect(
      container?.querySelector('[data-testid="usage-calls-live-label"]')?.textContent,
    ).toContain('自动刷新');

    act(() => {
      next?.click();
    });
    await flushLoad();

    expect(requested.at(-1)?.offset).toBe(pageSize);
    expect(container?.querySelector('[data-testid="usage-calls-range"]')?.textContent).toBe(
      '101–102 / 250',
    );
    expect(
      (container?.querySelector('[data-testid="usage-calls-prev"]') as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(false);
    // Auto-refresh must not shuffle rows under a reader on an older page.
    expect(container?.querySelector('[data-testid="usage-calls-live-label"]')?.textContent).toBe(
      '翻页时暂停刷新',
    );
  });

  it('restarts at the first page when the page size changes', async () => {
    const requested: Array<{ offset: number | undefined; limit: number | undefined }> = [];
    const request = async (command: UsageRequestCommand): Promise<HostResponse> => {
      if (command.type === 'usage/list-recent') {
        requested.push({ offset: command.offset, limit: command.limit });
        return okResponse({
          log: {
            ...SAMPLE_CALL_LOG,
            offset: command.offset ?? 0,
            limit: command.limit ?? 100,
            totalInWindow: 250,
            truncated: true,
          },
        });
      }
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    act(() => {
      (container?.querySelector('[data-testid="usage-calls-next"]') as HTMLButtonElement)?.click();
    });
    await flushLoad();
    expect(requested.at(-1)?.offset).toBe(100);

    const pageSizeSelect = container?.querySelector(
      'select[data-testid="usage-calls-page-size"]',
    ) as HTMLSelectElement | null;
    expect(pageSizeSelect).toBeTruthy();
    act(() => {
      if (pageSizeSelect) {
        pageSizeSelect.value = '50';
        pageSizeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await flushLoad();

    expect(requested.at(-1)).toEqual({ offset: 0, limit: 50 });
  });

  it('follows a Host that clamped the offset to a shrinking window', async () => {
    const requested: number[] = [];
    const request = async (command: UsageRequestCommand): Promise<HostResponse> => {
      if (command.type === 'usage/list-recent') {
        requested.push(command.offset ?? 0);
        // The window shrank: whatever page was asked for, only page 0 exists.
        return okResponse({
          log: { ...SAMPLE_CALL_LOG, offset: 0, limit: 100, totalInWindow: 2, truncated: false },
        });
      }
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    act(() => {
      (container?.querySelector('[data-testid="usage-calls-next"]') as HTMLButtonElement)?.click();
    });
    await flushLoad();
    await flushLoad();

    expect(container?.querySelector('[data-testid="usage-calls-range"]')?.textContent).toBe(
      '1–2 / 2',
    );
    expect(requested.at(-1)).toBe(0);
  });

  it('hides the call log when the Host does not implement the command', async () => {
    const request = async (command: UsageRequestCommand): Promise<HostResponse> => {
      if (command.type === 'usage/list-recent') {
        return {
          type: 'response',
          command: 'usage/list-recent',
          success: false,
          error: 'unknown command',
        };
      }
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();

    expect(container?.querySelector('[data-testid="usage-recent-calls"]')).toBeNull();
    expect(container?.querySelector('.usage-panel-error')).toBeNull();
  });

  it('mounts toolbar controls into the settings shell header slot when present', async () => {
    const headerSlot = document.createElement('div');
    headerSlot.id = 'settings-main-header-actions';
    document.body.appendChild(headerSlot);

    try {
      ({ root, container } = renderPanel());
      await flushLoad();

      expect(headerSlot.querySelector('[data-testid="usage-time-select"]')).not.toBeNull();
      expect(headerSlot.querySelector('[data-testid="usage-refresh-button"]')).not.toBeNull();
      expect(container?.querySelector('.usage-toolbar')).toBeNull();
    } finally {
      headerSlot.remove();
    }
  });
});
