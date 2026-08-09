// @vitest-environment happy-dom
/** Token usage statistics panel (CE-OBS). */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, UsageRollup } from '@piwin/contracts';
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

function okResponse(data: unknown): HostResponse {
  return { type: 'response', command: 'usage/get-rollup', success: true, data };
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
    request: async () => okResponse({ rollup: SAMPLE_ROLLUP }),
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

  it('consolidates totals, cache efficiency, and activity into three summaries', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    expect(container?.querySelector('[data-testid="usage-total"]')?.textContent).toBe('1.2k');
    expect(container?.querySelector('[data-testid="usage-cache-rate"]')?.textContent).toBe('19%');
    expect(container?.querySelectorAll('.usage-summary-card')).toHaveLength(3);
    expect(
      container?.querySelector('[data-testid="usage-panel"]')?.getAttribute('data-scope'),
    ).toBe('project');
  });

  it('renders one consolidated daily token-composition chart', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    expect(container?.querySelectorAll('.usage-trend-column')).toHaveLength(2);
    expect(container?.querySelectorAll('.usage-trend-bar span')).toHaveLength(8);
    expect(container?.querySelector('.usage-heatmap-card')).toBeNull();
    expect(container?.querySelector('.usage-perf-table')).toBeNull();
  });

  it('requests the selected project and defaults to a 30-day window', async () => {
    let requestedProjectPath: string | undefined;
    let requestedWindow: { from?: string; to?: string } | undefined;
    const request = async (command: {
      type: 'usage/get-rollup';
      projectPath?: string;
      window?: { from?: string; to?: string };
    }) => {
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
    let requestedWindow: { from?: string; to?: string } | undefined;
    const request = async (command: {
      type: 'usage/get-rollup';
      window?: { from?: string; to?: string };
    }) => {
      requestedWindow = command.window;
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
    expect(requestedWindow).toBeUndefined();
  });

  it('separates cache rates for the same model by Key', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    expect(container?.querySelectorAll('[data-testid^="usage-model-key-row-"]')).toHaveLength(2);
    expect(
      container?.querySelector('[data-testid="usage-model-key-cache-rate-work-key::gpt-4o"]')
        ?.textContent,
    ).toContain('22%');
    expect(
      container?.querySelector('[data-testid="usage-model-key-cache-rate-personal-key::gpt-4o"]')
        ?.textContent,
    ).toContain('12%');
  });

  it('filters the consolidated table by Key', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();

    const searchInput = container?.querySelector(
      'input[data-testid="usage-search-input"]',
    ) as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
    act(() => {
      if (searchInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(searchInput, 'personal');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    expect(container?.querySelectorAll('[data-testid^="usage-model-key-row-"]')).toHaveLength(1);
    expect(container?.textContent).toContain('personal-key');
    expect(container?.textContent).not.toContain('work-key');
  });
});
