import type { Component } from '@earendil-works/pi-tui';
import type { HostResponse } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TuiModalStack } from './tui-modals.js';
import {
  formatDesktopMemoryDiagnostics,
  TuiMemoryController,
} from './tui-memory-controller.js';

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

const okResponse = (data: unknown): HostResponse =>
  ({ type: 'response', command: 'desktop/memory-diagnostics', success: true, data }) as HostResponse;

const DIAGNOSTICS = {
  capturedAtMs: 1_700_000_000_000,
  snapshot: {
    samples: [
      {
        sampleId: 42,
        bytes: 900 * 1024 * 1024,
        osPressure: 'warning',
        quality: 'full',
        unknownWindows: ['pet-overlay'],
        errors: [{ kind: 'webview-pid', windowLabel: 'pet-overlay', message: 'x' }],
      },
    ],
    purgeResults: [
      { requestId: 1, status: 'completed', windowCount: 2 },
      { requestId: 2, status: 'timeout', windowCount: 2 },
    ],
    pendingSampleId: 42,
    stalledTicks: 3,
  },
  frontend: {
    renderCommits: 12,
    clientQueueHighWater: { items: 9, bytes: 2048 },
    domMetrics: { mountedTranscriptItems: 40, mountedCodeLines: 120 },
  },
};

function setup(response: HostResponse) {
  const modals = new FakeModals();
  const request = vi.fn(async () => response);
  const onError = vi.fn();
  const controller = new TuiMemoryController({
    modals: modals as unknown as TuiModalStack,
    request: request as never,
    onError,
  });
  return { controller, modals, request, onError };
}

describe('TuiMemoryController', () => {
  it('asks the Host for desktop/memory-diagnostics and renders the report', async () => {
    const { controller, modals, request } = setup(okResponse(DIAGNOSTICS));
    await controller.open();
    expect(request).toHaveBeenCalledWith({ type: 'desktop/memory-diagnostics' });
    const text = modals.text();
    expect(text).toContain('#42');
    expect(text).toContain('900 MiB');
    expect(text).toContain('warning');
    expect(text).toContain('pet-overlay');
    expect(text).toContain('completed ×1');
    expect(text).toContain('timeout ×1');
    expect(text).toContain('停滞 tick 3');
    expect(text).toContain('render commits 12');
  });

  it('explains when no desktop report has arrived yet', async () => {
    const { controller, modals } = setup(okResponse(null));
    await controller.open();
    expect(modals.text()).toContain('no desktop memory report yet');
  });

  it('renders the Host error when the request fails', async () => {
    const { controller, modals } = setup({
      type: 'response',
      command: 'desktop/memory-diagnostics',
      success: false,
      error: 'unhandled',
    } as HostResponse);
    await controller.open();
    expect(modals.text()).toContain('unhandled');
  });

  it('reports a thrown request through onError', async () => {
    const modals = new FakeModals();
    const failure = new Error('link closed');
    const controller = new TuiMemoryController({
      modals: modals as unknown as TuiModalStack,
      request: vi.fn(async () => {
        throw failure;
      }) as never,
      onError: (error) => expect(error).toBe(failure),
    });
    await controller.open();
    expect(modals.current).toBeUndefined();
  });

  it('formats an empty snapshot without crashing', () => {
    const lines = formatDesktopMemoryDiagnostics({
      capturedAtMs: 0,
      snapshot: { samples: [], purgeResults: [], stalledTicks: 0 },
    });
    expect(lines.join('\n')).toContain('暂无');
  });
});
