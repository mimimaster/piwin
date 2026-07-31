// @vitest-environment happy-dom
/**
 * Token usage statistics panel (CE-OBS).
 */

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
  totalTokens: 1000,
  entryCount: 3,
  sessionCount: 2,
  firstAt: '2026-08-01T10:00:00.000Z',
  lastAt: '2026-08-02T09:00:00.000Z',
  byModel: {
    'gpt-4o': { promptTokens: 600, completionTokens: 400, totalTokens: 1000, entryCount: 3 },
  },
  byDay: {
    '2026-08-01': { promptTokens: 500, completionTokens: 300, totalTokens: 800, entryCount: 2 },
    '2026-08-02': { promptTokens: 100, completionTokens: 100, totalTokens: 200, entryCount: 1 },
  },
  bySession: [
    {
      sessionId: 's1',
      promptTokens: 500,
      completionTokens: 300,
      totalTokens: 800,
      entryCount: 2,
      firstAt: '2026-08-01T10:00:00.000Z',
      lastAt: '2026-08-01T11:00:00.000Z',
    },
    {
      sessionId: 's2',
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
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
    onOpenSession: () => {},
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

/** Flush the panel's async load() effect so the rollup is rendered. */
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

  it('renders totals from the rollup', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();
    const total = container?.querySelector('[data-testid="usage-total"]');
    expect(total?.textContent).toBe('1.0k');
    const panel = container?.querySelector('[data-testid="usage-panel"]');
    expect(panel?.getAttribute('data-scope')).toBe('project');
  });

  it('renders per-day bars and per-session rows', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();
    expect(container?.querySelectorAll('.usage-day-bar')).toHaveLength(2);
    expect(container?.querySelectorAll('.usage-session-row')).toHaveLength(2);
  });

  it('requests with project path when project scope is active', async () => {
    let requestedProjectPath: string | undefined;
    const request = async (command: { type: 'usage/get-rollup'; projectPath?: string }) => {
      requestedProjectPath = command.projectPath;
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();
    expect(requestedProjectPath).toBe('/tmp/proj');
  });

  it('opens a session from the breakdown', async () => {
    let opened: string | undefined;
    ({ root, container } = renderPanel({ onOpenSession: (id) => (opened = id) }));
    await flushLoad();
    const row = container?.querySelector('.usage-session-row');
    act(() => {
      (row as HTMLButtonElement | null)?.click();
    });
    expect(opened).toBe('s1');
  });

  it('sends a window when a time range is selected', async () => {
    let requestedWindow: { from?: string; to?: string } | undefined;
    const request = async (command: {
      type: 'usage/get-rollup';
      projectPath?: string;
      window?: { from?: string; to?: string };
    }) => {
      requestedWindow = command.window;
      return okResponse({ rollup: SAMPLE_ROLLUP });
    };
    ({ root, container } = renderPanel({ request }));
    await flushLoad();
    // Default range is 'all' → no window.
    expect(requestedWindow).toBeUndefined();
    const todayButton = container?.querySelector('[data-testid="usage-range-7d"]');
    act(() => {
      (todayButton as HTMLButtonElement | null)?.click();
    });
    await flushLoad();
    expect(requestedWindow?.from).toBeTruthy();
  });

  it('renders provider grouping derived from model ids', async () => {
    ({ root, container } = renderPanel());
    await flushLoad();
    // SAMPLE_ROLLUP.byModel has a single "gpt-4o" model → one provider row.
    const providerRows = container?.querySelectorAll('.usage-table tbody tr');
    expect(providerRows && providerRows.length).toBeGreaterThan(0);
  });
});
