// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  SessionUsageTotals,
} from '@piwin/contracts';
import { ComposerStatsLine } from './composer-stats-line';
import { buildComposerStatusBar, generationTokensPerSecond } from './composer-stats-line-model';
import { useSessionUsageTotals, type SessionUsageTotalsHostPort } from '../hooks/use-session-usage-totals';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(element: React.ReactElement): HTMLElement {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

const totals: SessionUsageTotals = {
  sessionId: 's1',
  userTurnCount: 2,
  promptTokens: 1000,
  completionTokens: 2300,
  cacheReadTokens: 6000,
  cacheWriteTokens: 1000,
  totalTokens: 12300,
  entryCount: 5,
};

describe('buildComposerStatusBar', () => {
  const texts = (items: { label?: string; text: string }[]) => items.map((item) => [item.label, item.text].filter(Boolean).join(' '));

  it('splits the turn (last duration · first token · speed) from the resources', () => {
    const bar = buildComposerStatusBar({
      totals,
      lastRequest: { messageId: 'm1', completionTokens: 200, durationMs: 1500, firstTokenMs: 500, firstTokenKind: 'reasoning' },
      locale: 'zh-CN',
    });
    expect(texts(bar.turn)).toEqual(['上轮 1.50s', '首字 0.50s', '200 tok/s']);
    expect(texts(bar.resources)).toEqual(['2 轮', '↑8k ↓2k', '缓存 75%']);
    expect(bar.resources[0]?.title).toContain('2 轮 · 5 步');
    expect(bar.resources[1]?.title).toContain('2 轮 · 5 步');
  });

  it('counts turns in the singular and hides a zero count', () => {
    expect(texts(buildComposerStatusBar({ totals: { ...totals, userTurnCount: 1 }, locale: 'en' }).resources)[0]).toBe('1 turn');
    expect(buildComposerStatusBar({ totals: { ...totals, userTurnCount: 0 }, locale: 'en' }).resources.map((item) => item.key)).not.toContain('turns');
  });

  it('prefers the session read timing over the hydrated context ring copy', () => {
    const bar = buildComposerStatusBar({
      totals: { ...totals, latestRequest: { messageId: 'm2', completionTokens: 30, durationMs: 897, firstTokenMs: 718, firstTokenKind: 'reasoning' } },
      lastRequest: { messageId: 'm1', completionTokens: 30, durationMs: 827, firstTokenMs: 814 },
      locale: 'en',
    });
    expect(texts(bar.turn)).toEqual(['last 0.90s', 'TTFT 0.72s', '168 tok/s']);
  });

  it('shows the running turn and colours a slow first token', () => {
    const bar = buildComposerStatusBar({
      totals,
      lastRequest: { messageId: 'm1', completionTokens: 10, durationMs: 9000, firstTokenMs: 6000 },
      runningElapsedMs: 12_400,
      locale: 'zh-CN',
    });
    expect(bar.turn[0]).toMatchObject({ key: 'elapsed', running: true, label: '进行中', text: '12s' });
    expect(bar.turn.find((item) => item.key === 'ttft')?.tone).toBe('critical');
  });

  it('shows the session cost whenever it is priced', () => {
    const priced = { ...totals, estimatedCostUsd: 0.42, pricedEntryCount: 5 };
    expect(texts(buildComposerStatusBar({ totals: priced, locale: 'en' }).resources)).toContain('$0.42');
    expect(buildComposerStatusBar({ totals, locale: 'en' }).resources.map((item) => item.key)).not.toContain('cost');
  });

  it('shows nothing for a session without finalized requests', () => {
    expect(buildComposerStatusBar({ totals: { ...totals, entryCount: 0 }, locale: 'en' })).toEqual({ extensions: [], turn: [], resources: [] });
    expect(buildComposerStatusBar({ totals: null, locale: 'en' })).toEqual({ extensions: [], turn: [], resources: [] });
  });

  it('lists the extension working message and statuses', () => {
    const bar = buildComposerStatusBar({
      totals: null,
      extensionSurface: {
        sessionId: 's1',
        statuses: [{ key: 'kiro', text: 'Kiro 42%' }],
        widgets: [],
        workingMessage: '⏸ waiting · 12s',
      },
      locale: 'en',
    });
    expect(bar.extensions).toEqual([
      { key: '__working__', text: '⏸ waiting · 12s', working: true },
      { key: 'kiro', text: 'Kiro 42%', working: false },
    ]);
  });
});

describe('generationTokensPerSecond', () => {
  it('excludes time to first token and rejects unusable samples', () => {
    expect(generationTokensPerSecond({
      completionTokens: 100, durationMs: 2000, firstTokenMs: 1000, firstTokenKind: 'reasoning',
    })).toBe(100);
    // Hidden reasoning ran during the first-token wait: only visible tokens are rated.
    expect(generationTokensPerSecond({
      completionTokens: 100, durationMs: 2000, firstTokenMs: 1000, firstTokenKind: 'content', reasoningTokens: 60,
    })).toBe(40);
    // Unknown split: end-to-end, never the whole output over the tail.
    expect(generationTokensPerSecond({ completionTokens: 100, durationMs: 2000, firstTokenMs: 1000 })).toBe(50);
    expect(generationTokensPerSecond({ completionTokens: 100, durationMs: 2000 })).toBe(50);
    expect(generationTokensPerSecond({ completionTokens: 0, durationMs: 1000 })).toBeNull();
    expect(generationTokensPerSecond({ completionTokens: 100 })).toBeNull();
    expect(generationTokensPerSecond(undefined)).toBeNull();
  });

  it('falls back to end-to-end duration when the decode window is a buffered flush', () => {
    // Real DeepSeek Flash sample: 30 tokens, 827ms total, first token at 814ms.
    // A 13ms decode window would read ~2300 tok/s.
    const rate = generationTokensPerSecond({ completionTokens: 30, durationMs: 827, firstTokenMs: 814 });
    expect(Math.round(rate ?? 0)).toBe(36);
  });
});

describe('ComposerStatsLine', () => {
  const withTiming: SessionUsageTotals = {
    ...totals,
    latestRequest: { messageId: 'm', completionTokens: 200, durationMs: 1500, firstTokenMs: 500, firstTokenKind: 'reasoning' },
  };

  it('renders extension status, the turn and the resources in one status row', () => {
    const view = render(
      <ComposerStatsLine
        totals={withTiming}
        extensionSurface={{
          sessionId: 's1',
          statuses: [{ key: 'kiro', text: 'Kiro 42%' }],
          widgets: [],
          workingMessage: 'waiting · 12s',
        }}
        locale="en"
      />,
    );
    expect(view.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(view.querySelector('[data-testid="composer-stats-turn"]')?.textContent).toBe('last1.50s·TTFT0.50s·200 tok/s');
    expect(view.querySelector('[data-testid="composer-stats-turns"]')?.textContent).toBe('2 turns');
    expect(view.querySelector('[data-testid="composer-stats-tokens"]')?.textContent).toBe('↑8k ↓2k');
    expect(view.querySelector('[data-testid="composer-stats-cache"]')?.textContent).toBe('cache75%');
    expect(view.querySelector('[data-testid="composer-stats-tokens"]')?.className).toContain('priority-3');
    expect(view.querySelector('[data-status-key="kiro"]')?.textContent).toBe('Kiro 42%');
    expect(view.querySelector('[data-status-key="__working__"]')?.textContent).toBe('waiting · 12s');
    expect(view.querySelector('.composer-stats-pulse-dot')).not.toBeNull();
  });

  it('keeps an inert empty slot for multi-pane alignment without announcing empty status', () => {
    const view = render(<ComposerStatsLine totals={null} locale="en" />);
    const slot = view.querySelector('.composer-stats-line.is-empty');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    expect(slot?.textContent).toBe('');
    expect(view.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the session cost in the resources section', () => {
    const priced = { ...withTiming, estimatedCostUsd: 1.234, pricedEntryCount: 5 };
    const view = render(<ComposerStatsLine totals={priced} locale="en" />);
    expect(view.querySelector('[data-testid="composer-stats-cost"]')?.textContent).toBe('$1.23');
  });

  it('ticks the running turn once a second', () => {
    vi.useFakeTimers();
    const view = render(<ComposerStatsLine totals={withTiming} isRunning locale="en" />);
    expect(view.querySelector('[data-testid="composer-stats-elapsed"]')?.textContent).toBe('running0s');
    act(() => vi.advanceTimersByTime(3000));
    expect(view.querySelector('[data-testid="composer-stats-elapsed"]')?.textContent).toBe('running3s');
  });

  it('preserves complete values in tooltips when narrow panes truncate the row', () => {
    const view = render(
      <ComposerStatsLine
        totals={totals}
        extensionSurface={{
          sessionId: 's1',
          statuses: [{ key: 'extension', text: 'Long extension status value' }],
          widgets: [],
        }}
        locale="en"
      />,
    );
    expect(view.querySelector('[data-status-key="extension"]')?.getAttribute('title'))
      .toBe('Long extension status value');
    expect(view.querySelector('[data-testid="composer-stats-tokens"]')?.getAttribute('title'))
      .toContain('Session total 12k tok');
  });
});

function createHostPort(responses: SessionUsageTotals[]): SessionUsageTotalsHostPort & {
  push(message: HostServerMessage): void;
  requests: HostCommand[];
} {
  const listeners = new Set<(message: HostServerMessage) => void>();
  const requests: HostCommand[] = [];
  return {
    requests,
    supportsCommand: (type) => type === 'usage/get-session',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(command) {
      requests.push(command);
      const next = responses[Math.min(requests.length - 1, responses.length - 1)];
      return {
        type: 'response',
        command: 'usage/get-session',
        success: true,
        data: { totals: next },
      } as HostResponse;
    },
    push(message) {
      for (const listener of listeners) listener(message);
    },
  };
}

function TotalsProbe(props: { host: SessionUsageTotalsHostPort; sessionId: string | null }): React.ReactElement {
  const value = useSessionUsageTotals(props.host, props.sessionId);
  return <span data-testid="probe">{value ? `${value.sessionId}:${value.entryCount}` : 'none'}</span>;
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSessionUsageTotals', () => {
  it('loads on activation and refreshes after a usage update of the same session', async () => {
    vi.useFakeTimers();
    const host = createHostPort([totals, { ...totals, entryCount: 6 }]);
    const view = render(<TotalsProbe host={host} sessionId="s1" />);
    await flushPromises();
    expect(view.textContent).toBe('s1:5');

    // Another session's update is ignored.
    act(() => host.push({ type: 'event', event: { type: 'usage/update', sessionId: 's2' } } as HostServerMessage));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(host.requests).toHaveLength(1);

    act(() => host.push({ type: 'event', event: { type: 'usage/update', sessionId: 's1' } } as HostServerMessage));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flushPromises();
    expect(host.requests).toHaveLength(2);
    expect(view.textContent).toBe('s1:6');
  });

  it('stays empty when the host does not offer the command', async () => {
    const host = { ...createHostPort([totals]), supportsCommand: () => false };
    const view = render(<TotalsProbe host={host} sessionId="s1" />);
    await flushPromises();
    expect(view.textContent).toBe('none');
    expect(host.requests).toHaveLength(0);
  });
});
