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
import { buildComposerStatsSegments, generationTokensPerSecond } from './composer-stats-line-model';
import { useSessionUsageTotals, type SessionUsageTotalsHostPort } from './hooks/use-session-usage-totals';

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

describe('buildComposerStatsSegments', () => {
  it('shows turns, steps, speed, tokens and cache hit rate', () => {
    const segments = buildComposerStatsSegments({
      totals,
      lastRequest: { messageId: 'm1', completionTokens: 200, durationMs: 1500, firstTokenMs: 500 },
      locale: 'zh-CN',
    });
    expect(segments.map((segment) => segment.text)).toEqual([
      '2 轮 · 5 步 · 200 tok/s',
      '12K tok · 缓存命中 75%',
    ]);
  });

  it('prefers the session read timing over the hydrated context ring copy', () => {
    const segments = buildComposerStatsSegments({
      totals: { ...totals, latestRequest: { messageId: 'm2', completionTokens: 30, durationMs: 897, firstTokenMs: 718 } },
      lastRequest: { messageId: 'm1', completionTokens: 30, durationMs: 827, firstTokenMs: 814 },
      locale: 'en',
    });
    expect(segments[0]?.text).toBe('2 turns · 5 steps · 168 tok/s');
  });

  it('uses English copy with singular units', () => {
    const segments = buildComposerStatsSegments({
      totals: { ...totals, userTurnCount: 1, entryCount: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      locale: 'en',
    });
    expect(segments.map((segment) => segment.text)).toEqual(['1 turn · 1 step', '12K tok · cache 0%']);
  });

  it('shows nothing for a session without finalized requests', () => {
    expect(buildComposerStatsSegments({ totals: { ...totals, entryCount: 0 }, locale: 'en' })).toEqual([]);
    expect(buildComposerStatsSegments({ totals: null, locale: 'en' })).toEqual([]);
  });

  it('appends extension working message and statuses after the stats', () => {
    const segments = buildComposerStatsSegments({
      totals: null,
      extensionSurface: {
        sessionId: 's1',
        statuses: [{ key: 'kiro', text: 'Kiro 42%' }],
        widgets: [],
        workingMessage: '⏸ waiting · 12s',
      },
      locale: 'en',
    });
    expect(segments).toEqual([
      { kind: 'extension', key: 'working-message', text: '⏸ waiting · 12s', working: true },
      { kind: 'extension', key: 'kiro', text: 'Kiro 42%', working: false },
    ]);
  });
});

describe('generationTokensPerSecond', () => {
  it('excludes time to first token and rejects unusable samples', () => {
    expect(generationTokensPerSecond({ completionTokens: 100, durationMs: 2000, firstTokenMs: 1000 })).toBe(100);
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
  it('renders stats and extension status in one status row', () => {
    const view = render(
      <ComposerStatsLine
        totals={totals}
        extensionSurface={{ sessionId: 's1', statuses: [{ key: 'kiro', text: 'Kiro 42%' }], widgets: [] }}
        locale="en"
      />,
    );
    const rows = view.querySelectorAll('[role="status"]');
    expect(rows).toHaveLength(1);
    expect(view.querySelector('[data-testid="composer-stats-activity"]')?.textContent).toBe('2 turns · 5 steps');
    expect(view.querySelector('[data-status-key="kiro"]')?.textContent).toBe('Kiro 42%');
  });

  it('renders nothing when there is nothing to show', () => {
    expect(render(<ComposerStatsLine totals={null} locale="en" />).innerHTML).toBe('');
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
