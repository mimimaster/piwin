// @vitest-environment happy-dom
/**
 * Collapsed-workspace rail: compact tool pills stay reachable, and a live
 * shared browser docks its bezel-less mini under the rail until the user
 * drags it away.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostServerMessage, WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import type { BrowserSessionLeaseClient } from '../browser/browser-session-lease';
import { BrowserSessionProvider } from '../browser/browser-session-provider';
import { SessionRailDock } from './session-rail-dock';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FakeHost = BrowserSessionLeaseClient & { emit: (message: HostServerMessage) => void };

function createFakeHost(): FakeHost {
  const listeners = new Set<(message: HostServerMessage) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    browserStart: async () => ({ success: true }),
    browserStop: async () => ({ success: true }),
    emit: (message) => {
      for (const listener of listeners) listener(message);
    },
  };
}

const noPick = (_pick: WebElementPickResult): void => undefined;

let root: Root | undefined;
let container: HTMLElement | undefined;

async function renderRail(
  props: Partial<Parameters<typeof SessionRailDock>[0]> = {},
  options: { page?: boolean } = {},
): Promise<{ el: HTMLElement; host: FakeHost }> {
  const host = createFakeHost();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const node: ReactElement = (
    <BrowserSessionProvider
      hostClient={host as unknown as HostClient}
      locale="zh-CN"
      onAddWebElement={noPick}
      enabled
    >
      <SessionRailDock
        locale="zh-CN"
        diffStat={{ additions: 48, deletions: 12 }}
        tasksActiveCount={0}
        runningJobCount={0}
        overlayOpen={false}
        hostReady
        onOpenTool={() => {}}
        onReloadBrowser={() => {}}
        {...props}
      />
    </BrowserSessionProvider>
  );
  await act(async () => {
    root?.render(node);
  });
  if (options.page !== false) {
    // Effects (the lease subscription) run after commit, so the push follows.
    await act(async () => {
      host.emit({
        type: 'browser/state',
        url: 'http://127.0.0.1:3000/login',
        title: 'Sign in',
        lifecycle: 'ready',
        ts: 1,
      } as HostServerMessage);
    });
  }
  return { el: container, host };
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('SessionRailDock', () => {
  it('offers Changes, Browser, Terminal and Files with the tree stat', async () => {
    const { el } = await renderRail({}, { page: false });
    const labels = [...el.querySelectorAll('.piwin-session-rail-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['变更', '浏览器', '终端', '文件']);
    expect(el.querySelector('[data-testid="session-rail-diff-review"]')?.textContent).toContain(
      '+48',
    );
  });

  it('opens the tool the row names', async () => {
    const onOpenTool = vi.fn();
    const { el } = await renderRail({ onOpenTool }, { page: false });

    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="session-rail-item-review"]')?.click();
      el.querySelector<HTMLButtonElement>('[data-testid="session-rail-item-files"]')?.click();
    });

    expect(onOpenTool).toHaveBeenNthCalledWith(1, 'review');
    expect(onOpenTool).toHaveBeenNthCalledWith(2, 'files');
  });

  it('surfaces a tasks pill only while children are running', async () => {
    const idle = await renderRail({ tasksActiveCount: 0 }, { page: false });
    expect(idle.el.querySelector('[data-testid="session-rail-item-tasks"]')).toBeNull();
    act(() => root?.unmount());

    const busy = await renderRail({ tasksActiveCount: 2 }, { page: false });
    expect(
      busy.el.querySelector('[data-testid="session-rail-badge-tasks"]')?.textContent,
    ).toBe('2');
  });

  it('docks the browser mini under the rail for a live page', async () => {
    const onOpenTool = vi.fn();
    const { el } = await renderRail({ onOpenTool });

    const mini = el.querySelector('[data-testid="browser-mini"]');
    expect(mini).not.toBeNull();
    expect(mini?.getAttribute('data-placement')).toBe('docked');
    expect(el.querySelector('.piwin-session-rail-docked-slot')?.contains(mini)).toBe(true);

    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="browser-mini-expand"]')?.click();
    });
    expect(onOpenTool).toHaveBeenCalledWith('browser');
  });

  it('keeps the rail when the mini is dismissed', async () => {
    const { el } = await renderRail();
    expect(el.querySelector('[data-testid="browser-mini"]')).not.toBeNull();

    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="browser-mini-dismiss"]')?.click();
    });

    expect(el.querySelector('[data-testid="browser-mini"]')).toBeNull();
    expect(el.querySelector('[data-testid="session-rail"]')).not.toBeNull();
  });

  it('floats the mini after a real drag and snaps it back on reset', async () => {
    const { el } = await renderRail();
    const mini = el.querySelector<HTMLElement>('[data-testid="browser-mini"]');
    expect(mini).not.toBeNull();

    act(() => {
      mini?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 7,
          clientX: 100,
          clientY: 100,
        }),
      );
      mini?.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 7,
          clientX: 160,
          clientY: 150,
        }),
      );
    });

    const floating = el.querySelector('.stage-browser-mini');
    expect(floating?.className).toContain('is-floating');
    expect(floating?.querySelector('[data-testid="browser-mini"]')?.getAttribute('data-placement'))
      .toBe('floating');

    act(() => {
      mini?.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 7,
          clientX: 160,
          clientY: 150,
        }),
      );
    });

    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="browser-mini-reset-position"]')?.click();
    });
    expect(el.querySelector('.stage-browser-mini')?.className).toContain('is-docked');
  });

  it('restores a dragged corner after a remount', async () => {
    const key = 'piwin.browser-mini.placement.test-host';
    localStorage.setItem(key, JSON.stringify({ xRatio: 0.2, yRatio: 0.4 }));
    const { el } = await renderRail({ browserMiniPlacementKey: key });

    const wrapper = el.querySelector('.stage-browser-mini');
    expect(wrapper?.className).toContain('is-floating');
    act(() => root?.unmount());
    localStorage.clear();
  });

  it('gives phone layouts a chip instead of the rail and mini', async () => {
    const onOpenTool = vi.fn();
    const { el } = await renderRail({ phone: true, onOpenTool });

    expect(el.querySelector('[data-testid="session-rail"]')).toBeNull();
    expect(el.querySelector('[data-testid="browser-mini"]')).toBeNull();
    const chip = el.querySelector<HTMLButtonElement>('[data-testid="browser-activity-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('浏览器');

    act(() => chip?.click());
    expect(onOpenTool).toHaveBeenCalledWith('browser');
  });

  it('marks the chip while the agent drives and hides it with no page', async () => {
    const { host, el } = await renderRail({ phone: true }, { page: false });
    expect(el.querySelector('[data-testid="browser-activity-chip"]')).toBeNull();

    await act(async () => {
      host.emit({ type: 'browser/controller', owner: 'agent', reason: 'prompt', ts: 2 } as never);
    });
    const chip = el.querySelector('[data-testid="browser-activity-chip"]');
    expect(chip?.getAttribute('data-agent-driving')).toBe('true');
  });

  it('shows no mini before the shared browser has a page', async () => {
    const { el } = await renderRail({}, { page: false });
    expect(el.querySelector('[data-testid="browser-mini"]')).toBeNull();
    expect(el.querySelector('[data-testid="session-rail"]')).not.toBeNull();
  });
});
