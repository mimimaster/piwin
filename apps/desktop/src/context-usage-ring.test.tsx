// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ContextUsageRing, type ContextUsageRingProps } from './context-usage-ring.js';
import {
  applyContextTelemetry,
  createInitialContextTelemetryState,
} from './context-telemetry-reducer.js';
import { selectContextRingView } from './context-telemetry-selector.js';
import {
  makeContextSnapshot,
  makeKnownOccupancy,
} from './context-telemetry-test-fixtures.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function capableView(
  snapshot: ReturnType<typeof makeContextSnapshot>,
  options: {
    selectedModelContextWindow?: number;
    selectedModel?: { providerId: string; modelId: string };
    locale?: 'zh-CN' | 'en';
  } = {},
): ContextUsageRingProps['view'] {
  let telemetry = applyContextTelemetry(createInitialContextTelemetryState(), {
    type: 'capability',
    supported: true,
  });
  telemetry = applyContextTelemetry(telemetry, {
    type: 'select',
    sessionId: snapshot.sessionId,
    hostInstanceId: 'host-1',
  });
  telemetry = applyContextTelemetry(telemetry, { type: 'snapshot', snapshot, source: 'live' });
  return selectContextRingView({
    telemetry,
    locale: options.locale ?? 'en',
    ...(options.selectedModelContextWindow !== undefined
      ? { selectedModelContextWindow: options.selectedModelContextWindow }
      : {}),
    ...(options.selectedModel ? { selectedModel: options.selectedModel } : {}),
  });
}

function render(props: ContextUsageRingProps, root: Root): void {
  const tree: ReactElement = (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ContextUsageRing {...props} />
    </PiwinUiProvider>
  );
  act(() => {
    root.render(tree);
  });
}

function queryTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-testid="context-usage-ring"]',
  );
  if (!trigger) {
    throw new Error('context-usage-ring not rendered');
  }
  return trigger;
}

function queryPopover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="context-usage-popover"]');
}

function activateTrigger(): void {
  act(() => {
    queryTrigger().focus();
    queryTrigger().click();
  });
}

function pressKey(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

const eligibleSnapshot = makeContextSnapshot({
  sessionId: 'session-test',
  phase: 'idle',
  occupancy: makeKnownOccupancy({
    tokensUsed: 40_000,
    tokensLimit: 200_000,
    quality: 'measured',
  }),
  responseEvidence: {
    currentRunHasResponse: false,
    historyHasDisplayableResponse: true,
  },
});

describe('ContextUsageRing', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('T01: does not render when the selector hides empty/waiting states', () => {
    const hidden = selectContextRingView({
      telemetry: applyContextTelemetry(createInitialContextTelemetryState(), {
        type: 'capability',
        supported: true,
      }),
      locale: 'en',
    });
    render({ view: hidden }, root);
    expect(document.querySelector('[data-testid="context-usage-ring"]')).toBeNull();
  });

  it('renders a closed ring from an idle dirty lastConfirmed snapshot', () => {
    const view = capableView(
      makeContextSnapshot({
        sessionId: 'session-test',
        phase: 'idle',
        contextBoundary: { activeLeafMessageId: 'leaf-1' },
        occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
        lastConfirmed: {
          occupancy: makeKnownOccupancy({
            tokensUsed: 40_000,
            tokensLimit: 200_000,
            quality: 'measured',
          }),
          contextBoundary: { activeLeafMessageId: 'leaf-1' },
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(view.visible).toBe(true);
    expect(view.occupancySource).toBe('current');
    render({ view }, root);
    expect(document.querySelector('[data-testid="context-usage-ring"]')).not.toBeNull();
  });

  it('labels runtime-generation-mismatch lastConfirmed as pending measurement, not Confirmed', () => {
    const view = capableView(
      makeContextSnapshot({
        sessionId: 'session-test',
        phase: 'invalidated',
        contextBoundary: {
          activeLeafMessageId: 'voice-live-leaf',
          model: { providerId: 'openai', modelId: 'gpt-1' },
          compactionBoundary: 'compact:a',
          capabilityFingerprint: 'cap-a',
          seedFingerprint: 'seed-a',
        },
        occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
        lastConfirmed: {
          occupancy: makeKnownOccupancy({
            tokensUsed: 7_797,
            tokensLimit: 500_000,
            quality: 'measured',
          }),
          contextBoundary: {
            activeLeafMessageId: 'piw-old-leaf',
            model: { providerId: 'openai', modelId: 'gpt-1' },
            compactionBoundary: 'compact:a',
            capabilityFingerprint: 'cap-a',
            seedFingerprint: 'seed-a',
          },
          sampledAt: '2026-09-01T08:23:05.531Z',
        },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(view.visible).toBe(true);
    expect(view.occupancySource).toBe('last-confirmed');
    render({ view }, root);
    activateTrigger();
    const popover = queryPopover();
    expect(popover?.textContent).toContain(
      'Last confirmed; current context pending measurement',
    );
    expect(document.querySelector('[data-testid="conversation-usage-confirmed"]')).toBeNull();
    expect(document.querySelector('[data-testid="conversation-usage-last-confirmed"]')?.textContent).toBe(
      'Last confirmed; current context pending measurement',
    );
  });

  it('renders a closed ring from selector labels', () => {
    render({ view: capableView(eligibleSnapshot) }, root);
    const trigger = queryTrigger();
    expect(trigger.className).toContain('tone-ok');
    expect(trigger.getAttribute('aria-label')).toContain('40K');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryPopover()).toBeNull();
  });

  it('opens the popover and shows occupancy without category rows', () => {
    render({ view: capableView(eligibleSnapshot) }, root);
    activateTrigger();
    const popover = queryPopover();
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('Context occupied');
    expect(popover?.textContent).not.toContain('System prompt');
    expect(popover?.textContent).not.toContain('Tool definitions');
    expect(popover?.textContent).not.toContain('Skills');
    expect(popover?.textContent).not.toContain('MCP');
  });

  it('T24: shows 120% text, 100% arc, and exceeds copy', () => {
    const view = capableView(
      makeContextSnapshot({
        sessionId: 'session-test',
        phase: 'idle',
        occupancy: makeKnownOccupancy({
          tokensUsed: 153_600,
          tokensLimit: 1_000_000,
          quality: 'measured',
        }),
        contextBoundary: {
          activeLeafMessageId: 'a1',
          model: { providerId: 'openai', modelId: 'gpt-1m' },
        },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
      {
        selectedModelContextWindow: 128_000,
        selectedModel: { providerId: 'openai', modelId: 'gpt-128k' },
      },
    );
    expect(view.percentText).toBe(120);
    expect(view.arcRatio).toBe(1);
    render({ view }, root);
    activateTrigger();
    expect(queryPopover()?.textContent).toContain('120%');
    expect(queryPopover()?.textContent).toContain('Exceeds context limit');
    expect(queryPopover()?.textContent).toMatch(/selected model window/i);
    expect(queryPopover()?.textContent).toContain('128K');
    expect(queryPopover()?.textContent).not.toContain('1M');
  });

  it('T24: unknown limit does not invent 128K', () => {
    const view = capableView(
      makeContextSnapshot({
        sessionId: 'session-test',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 12_400, quality: 'estimated' }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(view.limitUnknown).toBe(true);
    expect(view.tokensLimit).toBeUndefined();
    render({ view }, root);
    activateTrigger();
    expect(queryPopover()?.textContent).toContain('12K');
    expect(queryPopover()?.textContent).toMatch(/limit unknown/i);
    expect(queryPopover()?.textContent).not.toContain('128K');
  });

  it('T25: never shows a cache countdown or higher-cost copy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:06:00.000Z'));
    render({ view: capableView(eligibleSnapshot) }, root);
    act(() => {
      queryTrigger().focus();
    });
    activateTrigger();
    const text = `${queryPopover()?.textContent ?? ''}${
      document.querySelector('[data-testid="context-usage-hover-tooltip"]')?.textContent ?? ''
    }`;
    expect(text).not.toContain('expires in');
    expect(text).not.toContain('Cache estimate');
    expect(text).not.toContain('Higher cost');
    expect(text).not.toContain('Prompt cache');
    vi.useRealTimers();
  });

  it('T26: does not invent category rows from percentages', () => {
    render({ view: capableView(eligibleSnapshot) }, root);
    activateTrigger();
    expect(document.querySelectorAll('.context-usage-rows li').length).toBeGreaterThan(0);
    expect(queryPopover()?.textContent).not.toContain('~');
    expect(queryPopover()?.textContent).not.toContain('System prompt');
  });

  it('invokes the model-settings callback and closes the popover', () => {
    const onOpenModelSettings = vi.fn();
    render({ view: capableView(eligibleSnapshot), onOpenModelSettings }, root);
    activateTrigger();
    const link = document.querySelector<HTMLButtonElement>('.linkish-btn');
    act(() => {
      link?.click();
    });
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
    expect(queryPopover()).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render({ view: capableView(eligibleSnapshot) }, root);
    activateTrigger();
    const popover = queryPopover();
    if (!popover) {
      throw new Error('popover not rendered');
    }
    pressKey(popover, 'Escape');
    expect(queryPopover()).toBeNull();
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(document.activeElement).toBe(queryTrigger());
  });
});
