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
        <MemoryDiagnosticsPanel {...props} />
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
});

function text(el: Element | null): string {
  return el?.textContent ?? '';
}

describe('MemoryDiagnosticsPanel', () => {
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
      'native sampling unavailable',
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
    expect(footprint).toContain('fresh');
    expect(text(container.querySelector('[data-testid="memory-diag-level"]'))).toContain('normal');
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
