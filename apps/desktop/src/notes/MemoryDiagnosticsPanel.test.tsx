// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { MemoryDiagnosticsPanel } from './MemoryDiagnosticsPanel';
import { SAMPLE_FULL_PAYLOAD } from './memory-sample-contract';
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract';
import { registerWarmCache } from '../session/session-warm-cache.js';
import type { ComposerReclaimInput } from '../composer/composer-draft-reclaim.js';
import { sessionRenderResources } from '../session/session-render-resources.js';
import { globalMemoryGovernor } from './memory-governor.js';
import { recordReclaimEpisode, resetReclaimLedger } from './reclaim-ledger.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NATIVE: NativeMemoryObservabilitySnapshot = {
  samples: [{ ...SAMPLE_FULL_PAYLOAD, timestampMs: Date.now() }],
  purgeResults: [],
  stalledTicks: 0,
};

const EMPTY_DRAFTS: ComposerReclaimInput = {
  drafts: [],
  draftSnapshots: new Map(),
  sessionSnapshots: new Map(),
};

const roots: Root[] = [];
const containers: HTMLDivElement[] = [];

async function renderPanel(props: Parameters<typeof MemoryDiagnosticsPanel>[0] = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <MemoryDiagnosticsPanel locale="en" {...props} />
      </PiwinUiProvider>,
    );
  });
  roots.push(root);
  containers.push(container);
  return container;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  sessionRenderResources.reset();
  resetReclaimLedger();
  globalMemoryGovernor.reset();
});

function text(el: Element | null): string {
  return el?.textContent ?? '';
}

describe('MemoryDiagnosticsPanel', () => {
  it('explains the critical protected-only state in bilingual Chinese+English with raw diagnostics collapsed', async () => {
    globalMemoryGovernor.setLevel('critical');
    sessionRenderResources.register('current', vi.fn());
    sessionRenderResources.setVisible(['current']);
    recordReclaimEpisode({ episodeId: 1, startedAtMs: Date.now() - 30_000,
      endedAtMs: Date.now(), level: 'critical', admitted: true, rounds: [],
      releasedBytesEstimate: 8 * 1024 ** 2, outcome: 'protected-over-budget' });
    const container = await renderPanel({ locale: 'zh-CN', refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(NATIVE), recoveryDeps: { isRunActive: () => true } });
    const footprint = text(container.querySelector('[data-testid="memory-diag-footprint"]'));
    expect(footprint).toContain('内存占用');
    expect(footprint).toContain('Footprint');
    expect(footprint).toContain('采样 Sampling');
    expect(footprint).toContain('实时 · fresh');
    expect(footprint).toContain('调控 Governor');
    expect(footprint).toContain('critical');
    expect(text(container.querySelector('[data-testid="memory-diag-level"]'))).toBe('占用过高');
    expect(footprint).toContain('已没有闲置资源可清理');
    expect(text(container)).toContain('任务正在进行');
    expect(text(container.querySelector('[data-testid="memory-diag-last-action"]'))).not.toContain('8.0 MB');
    expect(container.querySelector('[data-testid="memory-diag-episode-detail"]')).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="memory-diag-technical-detail-toggle"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { toggle?.click(); });
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(text(container.querySelector('[data-testid="memory-diag-episode-detail"]'))).toContain('8.0 MB');
  });

  it('separates a measured footprint drop from a resource estimate while pressure remains critical', async () => {
    globalMemoryGovernor.setLevel('critical');
    recordReclaimEpisode({ episodeId: 1, startedAtMs: Date.now() - 30_000,
      level: 'critical', admitted: true, rounds: [], releasedBytesEstimate: 8 * 1024 ** 2,
      outcome: 'recovered', beforeBytes: 4 * 1024 ** 3, afterBytes: 3.5 * 1024 ** 3 });
    const container = await renderPanel({ locale: 'zh-CN', refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(NATIVE) });
    expect(text(container.querySelector('[data-testid="memory-diag-level"]'))).toBe('占用过高');
    const action = text(container.querySelector('[data-testid="memory-diag-last-action"]'));
    expect(action).toContain('本轮回收有进展');
    expect(action).toContain('实测减少 512.0 MB');
    expect(action).not.toContain('8.0 MB');
    expect(action).not.toContain('已恢复正常');
  });

  it('shows terminal no-progress with fresh sampling and offers no release of a visible view', async () => {
    globalMemoryGovernor.setLevel('critical');
    sessionRenderResources.register('current', vi.fn());
    sessionRenderResources.setVisible(['current']);
    recordReclaimEpisode({
      episodeId: 1, startedAtMs: Date.now() - 30_000, endedAtMs: Date.now(),
      level: 'critical', admitted: true, rounds: [], releasedBytesEstimate: 0,
      outcome: 'no-progress', lastSampleQuality: 'fresh',
    });
    const container = await renderPanel({ refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(NATIVE),
      recoveryDeps: { isRunActive: () => true },
    });
    expect(text(container)).toContain('Live · fresh');
    expect(text(container.querySelector('[data-testid="memory-diag-level"]'))).toContain('High usage');
    const summary = text(container.querySelector('[data-testid="memory-diag-episode-summary"]'));
    expect(summary).toBe('reclaim did not reduce memory pressure');
    expect(summary).not.toContain('waiting');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="memory-diag-release-btn"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="memory-diag-restart-btn"]')?.disabled).toBe(true);
    expect(text(container.querySelector('[data-testid="memory-diag-restart-blocked"]'))).toContain('A run is in progress');
  });

  it('renders all sections and shows native-unavailable when the snapshot is null', async () => {
    const container = await renderPanel({
      refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(null),
    });
    for (const id of [
      'memory-diag-footprint',
      'memory-diag-residency',
      'memory-diag-caches',
      'memory-diag-last-action',
      'memory-diag-actions',
    ]) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    expect(text(container.querySelector('[data-testid="memory-diag-footprint"]'))).toContain(
      'Sampling unavailable',
    );
    expect(text(container.querySelector('[data-testid="memory-diag-last-action"]'))).toContain(
      'No reclaim episodes recorded.',
    );
  });

  it('shows the footprint, sampling freshness and governor level when native data arrives', async () => {
    const container = await renderPanel({
      refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(NATIVE),
    });
    const footprint = text(container.querySelector('[data-testid="memory-diag-footprint"]'));
    expect(footprint).toContain('1.07 GB');
    expect(footprint).toContain('Live · fresh');
    expect(text(container.querySelector('[data-testid="memory-diag-governor"]'))).toContain('normal');
    expect(text(container.querySelector('[data-testid="memory-diag-level"]'))).toContain('Normal');
  });

  it('clears the refresh interval on unmount', async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <MemoryDiagnosticsPanel
              refreshMs={1_000}
              getNativeSnapshot={() => Promise.resolve(null)}
            />
          </PiwinUiProvider>,
        );
      });
      const timersAfterMount = vi.getTimerCount();
      expect(timersAfterMount).toBeGreaterThan(0);
      await act(async () => root.unmount());
      expect(vi.getTimerCount()).toBe(0);
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables both actions when nothing is idle and drafts cannot be checked', async () => {
    const container = await renderPanel({
      refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(null),
    });
    const release = container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-diag-release-btn"]',
    );
    const restart = container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-diag-restart-btn"]',
    );
    expect(release?.disabled).toBe(true);
    expect(restart?.disabled).toBe(true);
    expect(
      text(container.querySelector('[data-testid="memory-diag-restart-blocked"]')),
    ).toContain('Draft state is unavailable');
  });

  it('enables restart when recovery deps pass and runs the injected relaunch', async () => {
    const relaunch = vi.fn();
    const dispatch = vi.fn(() => true);
    const container = await renderPanel({
      refreshMs: 0,
      getNativeSnapshot: () => Promise.resolve(null),
      recoveryDeps: {
        getDraftState: () => EMPTY_DRAFTS,
        isRunActive: () => false,
        dispatchRelaunchEvent: dispatch,
        relaunch,
      },
    });
    const restart = container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-diag-restart-btn"]',
    );
    expect(restart?.disabled).toBe(false);
    await act(async () => {
      restart?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('releases a warm-snapshot candidate through the default reclaim path', async () => {
    const cache = {
      byId: {
        s1: {
          sessionId: 's1',
          messages: [{ id: 'm1' } as never],
          transcriptWindow: null,
          outline: [],
          runRecordsById: {},
          walkthroughsByMessageId: {},
          contextUsage: null,
          touchedAt: Date.now(),
        },
      },
      order: ['s1'],
    };
    const setSpy = vi.fn();
    const unregister = registerWarmCache({ get: () => cache, set: setSpy });
    try {
      const container = await renderPanel({
        refreshMs: 0,
        getNativeSnapshot: () => Promise.resolve(null),
      });
      const release = container.querySelector<HTMLButtonElement>(
        '[data-testid="memory-diag-release-btn"]',
      );
      expect(release?.disabled).toBe(false);
      await act(async () => {
        release?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(setSpy).toHaveBeenCalled();
      expect(text(container.querySelector('[data-testid="memory-diag-reclaim-result"]'))).toContain(
        'Released 1 resource(s)',
      );
    } finally {
      unregister();
    }
  });
});
