import type { Component } from '@earendil-works/pi-tui';
import type { HostPush, SessionContextSnapshot } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TuiModalStack } from './tui-modals.js';
import { TuiUsageController } from './tui-usage-controller.js';

class FakeModals {
  public current: (Component & { handleInput?: (data: string) => void }) | undefined;
  public show(component: Component): void {
    this.current = component;
  }
  public close(): void {
    this.current = undefined;
  }
  public text(): string {
    return (this.current?.render(100) ?? []).join('\n');
  }
}

const SNAPSHOT = {
  sessionId: 's1',
  phase: 'idle',
  occupancy: {
    kind: 'known',
    tokensUsed: 100_000,
    tokensLimit: 200_000,
    quality: 'measured',
    coverage: 'complete',
    basis: 'b',
    sampledAt: 'x',
  },
} as unknown as SessionContextSnapshot;

const request = (totalTokens: number) => ({ totalTokens });

function setup() {
  const modals = new FakeModals();
  const controller = new TuiUsageController({
    modals: modals as unknown as TuiModalStack,
    getSessionId: () => 's1',
    getContext: () => SNAPSHOT,
    describeModel: () => ({ model: 'Grok 4.5' }),
  });
  return { controller, modals };
}

const usageUpdate = (sessionId: string, totalTokens: number): HostPush =>
  ({ type: 'event', sessionId, event: { type: 'usage/update', sessionId, usage: { sessionId, totalTokens } } }) as unknown as HostPush;

describe('TuiUsageController', () => {
  it('opens a report with the occupancy and the model', () => {
    const { controller, modals } = setup();
    controller.open();
    expect(modals.text()).toContain('50%');
    expect(modals.text()).toContain('Grok 4.5');
  });

  it('shows the request the resume payload carried, then the latest update', () => {
    const { controller, modals } = setup();
    controller.reset(request(1_000));
    controller.open();
    expect(modals.text()).toContain('合计 1.0k');
    controller.handlePush(usageUpdate('s1', 9_000));
    controller.open();
    expect(modals.text()).toContain('合计 9.0k');
  });

  it('ignores another session’s request and never claims the push', () => {
    const { controller, modals } = setup();
    controller.reset(request(1_000));
    expect(controller.handlePush(usageUpdate('other', 9_000))).toBe(false);
    expect(controller.handlePush(usageUpdate('s1', 2_000))).toBe(false);
    controller.open();
    expect(modals.text()).toContain('合计 2.0k');
  });

  it('closes on Escape', () => {
    const { controller, modals } = setup();
    controller.open();
    modals.current?.handleInput?.('\x1b');
    expect(modals.current).toBeUndefined();
  });

  it('loads session totals for the status line and refreshes after an update', async () => {
    vi.useFakeTimers();
    try {
      let tokens = 1_000;
      const request = vi.fn(async () => ({
        success: true as const,
        data: { totals: { sessionId: 's1', userTurnCount: 1, entryCount: 1, promptTokens: tokens, completionTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens + 10, latestRequest: { messageId: 'm', completionTokens: 10, durationMs: 1000, firstTokenMs: 500 } } },
      }));
      const onChanged = vi.fn();
      const controller = new TuiUsageController({
        modals: new FakeModals() as unknown as TuiModalStack,
        getSessionId: () => 's1',
        getContext: () => SNAPSHOT,
        describeModel: () => ({ model: 'm' }),
        request: request as never,
        onChanged,
      });
      controller.reset(null);
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(request).toHaveBeenCalledWith({ type: 'usage/get-session', sessionId: 's1' });
      expect(controller.metrics()).toMatchObject({ inputTokens: 1_000, ttftMs: 500, context: { ratio: 0.5, estimated: false } });
      tokens = 5_000;
      controller.handlePush(usageUpdate('s1', 1));
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
      expect(controller.metrics().inputTokens).toBe(5_000);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
