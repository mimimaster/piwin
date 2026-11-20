// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { AgentLocator, SkillActivityChip } from '../agents/agent-locator.js';
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { desktopMetrics } from './diagnostic-metrics.js';
import {
  getLiveMotionStats,
  resetLiveMotionMetrics,
  trackLiveMotionMount,
} from './live-motion-metrics.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('live-motion-metrics', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetLiveMotionMetrics();
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetLiveMotionMetrics();
    globalMemoryGovernor.reset();
    window.matchMedia = previousMatchMedia;
  });

  it('tracks mount/release idempotently and exposes liveStatusAnimations in desktopMetrics', () => {
    const releaseA = trackLiveMotionMount('radial-bellow');
    const releaseB = trackLiveMotionMount('breath-dot');

    expect(getLiveMotionStats()).toEqual({
      total: 2,
      byKind: {
        'radial-bellow': 1,
        'asterisk-breath': 0,
        'breath-dot': 1,
        'breath-matrix': 0,
        'lite-ring': 0,
      },
    });
    expect(desktopMetrics.collectObservability().resourceCounts.liveStatusAnimations).toBe(2);

    // Calling the same release callback twice must not underflow.
    releaseA();
    releaseA();
    expect(getLiveMotionStats().total).toBe(1);

    releaseB();
    expect(getLiveMotionStats().total).toBe(0);
    expect(desktopMetrics.collectObservability().resourceCounts.liveStatusAnimations).toBe(0);
  });

  it('tracks mounted AgentLocatorMark and loading SkillActivityChip instances', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <AgentLocator input={{ kind: 'connecting-model', locale: 'en' }} />
          <SkillActivityChip skill={{ skillId: 's1', name: 's1' }} loading locale="en" />
        </PiwinUiProvider>,
      );
    });

    expect(getLiveMotionStats().total).toBe(2);
    expect(getLiveMotionStats().byKind['radial-bellow']).toBe(1);
    expect(getLiveMotionStats().byKind['breath-matrix']).toBe(1);
    expect(desktopMetrics.collectObservability().resourceCounts.liveStatusAnimations).toBe(2);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <AgentLocator input={{ kind: 'connecting-model', locale: 'en' }} animation="none" />
          <SkillActivityChip skill={{ skillId: 's1', name: 's1' }} loading={false} locale="en" />
        </PiwinUiProvider>,
      );
    });

    expect(getLiveMotionStats().total).toBe(0);
  });

  it('tracks lite-ring downgrade under critical pressure and restores primitives on normal', () => {
    act(() => {
      globalMemoryGovernor.setLevel('critical');
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <AgentLocator input={{ kind: 'connecting-model', locale: 'en' }} />
          <SkillActivityChip skill={{ skillId: 's1', name: 's1' }} loading locale="en" />
        </PiwinUiProvider>,
      );
    });

    expect(getLiveMotionStats()).toEqual({
      total: 2,
      byKind: {
        'radial-bellow': 0,
        'asterisk-breath': 0,
        'breath-dot': 0,
        'breath-matrix': 0,
        'lite-ring': 2,
      },
    });

    act(() => {
      globalMemoryGovernor.setLevel('normal');
    });

    expect(getLiveMotionStats()).toEqual({
      total: 2,
      byKind: {
        'radial-bellow': 1,
        'asterisk-breath': 0,
        'breath-dot': 0,
        'breath-matrix': 1,
        'lite-ring': 0,
      },
    });
  });
});
