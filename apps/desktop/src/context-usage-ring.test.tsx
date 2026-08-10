// @vitest-environment happy-dom
/**
 * ContextUsageRing popover coverage for slice R5.
 * Same happy-dom + createRoot harness as ThinkingEffortControl.test.tsx; the
 * popover is portaled by Radix, so assertions read from document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import {
  CACHE_EXPIRY_ESTIMATE_MS,
  computeContextUsagePercent,
  ContextUsageRing,
  hasRenderableContextUsage,
  resolveContextTokensUsed,
  type ContextUsageRingProps,
} from './context-usage-ring.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createBaseProps(
  overrides: Partial<ContextUsageRingProps> = {},
): ContextUsageRingProps {
  return {
    usage: {
      sessionId: 'session-test',
      tokensUsed: 40_000,
      tokensLimit: 200_000,
      updatedAt: '2026-07-26T00:00:00.000Z',
    },
    ...overrides,
  };
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

/**
 * Native buttons fire `click` for Enter/Space, which is how Radix's popover
 * trigger activates. happy-dom does not synthesize that from a raw keydown,
 * so keyboard activation is exercised through the same activation event.
 */
function activateTrigger(): void {
  act(() => {
    // Focus first: Radix restores focus to whatever was focused when it opened.
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

describe('context usage resolution', () => {
  it('hides the ring until a real usage sample exists', () => {
    expect(hasRenderableContextUsage(null)).toBe(false);
    expect(computeContextUsagePercent(null, 128_000)).toBeUndefined();
  });

  it('prefers tokensUsed for context occupancy', () => {
    expect(
      resolveContextTokensUsed({
        sessionId: 's1',
        tokensUsed: 1_200,
        totalTokens: 1_500,
        updatedAt: '2026-07-26T00:00:00.000Z',
      }),
    ).toBe(1_200);
  });

  it('uses input-side tokens (prompt + cache) when tokensUsed is absent', () => {
    // Assistant turn total includes completion; window fill is input-side.
    expect(
      resolveContextTokensUsed({
        sessionId: 's1',
        promptTokens: 700,
        completionTokens: 200,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalTokens: 1_050,
        updatedAt: '2026-07-26T00:00:00.000Z',
        source: 'assistant-usage',
      }),
    ).toBe(850);
    expect(
      computeContextUsagePercent(
        {
          sessionId: 's1',
          promptTokens: 700,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
          totalTokens: 1_050,
          updatedAt: '2026-07-26T00:00:00.000Z',
        },
        10_000,
      ),
    ).toBe(9);
  });
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
    // Fake only the interval/clock the countdown ticker uses. setTimeout is
    // left real so the Escape test's `setTimeout(resolve, 0)` macrotask fires;
    // setInterval is faked so `advanceTimersByTime` drives the 1s ticker.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('does not render before the first usage sample', () => {
    render(createBaseProps({ usage: null }), root);
    expect(document.querySelector('[data-testid="context-usage-ring"]')).toBeNull();
  });

  it('renders a closed ring with the usage tone and title', () => {
    render(createBaseProps(), root);

    const trigger = queryTrigger();
    expect(trigger.className).toContain('tone-ok');
    expect(trigger.getAttribute('title')).toBe('Context 40K / 200K (20%)');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryPopover()).toBeNull();
  });

  it('opens the popover from the trigger and shows the usage figures', () => {
    render(createBaseProps(), root);

    activateTrigger();

    const popover = queryPopover();
    expect(popover).not.toBeNull();
    expect(queryTrigger().getAttribute('aria-expanded')).toBe('true');
    expect(popover?.getAttribute('aria-label')).toBe('Context usage');
    expect(popover?.textContent).toContain('20% Full');
    expect(popover?.textContent).toContain('40K / 200K Tokens');
  });

  it('lists every breakdown category, falling back to an em dash', () => {
    render(
      createBaseProps({
        breakdown: { systemPromptTokens: 1200, source: 'host-estimate' },
      }),
      root,
    );
    activateTrigger();

    const rows = document.querySelectorAll('.context-usage-rows li');
    expect(rows).toHaveLength(6);
    expect(rows[0]?.textContent).toContain('System prompt');
    expect(rows[0]?.textContent).toContain('1.2K');
    expect(rows[1]?.textContent).toContain('—');
  });

  it('reports a critical tone', () => {
    render(
      createBaseProps({
        usage: {
          sessionId: 'session-test',
          tokensUsed: 95_000,
          updatedAt: '2026-07-26T00:00:00.000Z',
        },
        modelContextWindow: 100_000,
      }),
      root,
    );

    expect(queryTrigger().className).toContain('tone-critical');

    activateTrigger();
    expect(queryPopover()?.textContent).toContain('95% Full');
  });

  it('recomputes percent from used/limit when host contextRatio used a different window', () => {
    // Host snapshot may carry contextRatio against a smaller window (e.g. 128K)
    // while the selected model exposes a 1M window for display.
    render(
      createBaseProps({
        usage: {
          sessionId: 'session-test',
          tokensUsed: 21_000,
          tokensLimit: 128_000,
          contextRatio: 21_000 / 128_000, // ~16% against the host window
          updatedAt: '2026-07-26T00:00:00.000Z',
        },
        modelContextWindow: 1_000_000,
      }),
      root,
    );

    const trigger = queryTrigger();
    expect(trigger.getAttribute('title')).toBe('Context 21K / 1M (2%)');
    expect(trigger.className).toContain('tone-ok');

    activateTrigger();
    const popover = queryPopover();
    expect(popover?.textContent).toContain('2% Full');
    expect(popover?.textContent).toContain('21K / 1M Tokens');
    // Must NOT still show the host-window ratio against the 1M denominator.
    expect(popover?.textContent).not.toContain('16% Full');
  });

  it('invokes the model-settings callback and closes the popover', () => {
    const onOpenModelSettings = vi.fn();
    render(createBaseProps({ onOpenModelSettings }), root);
    activateTrigger();

    const link = document.querySelector<HTMLButtonElement>('.linkish-btn');
    expect(link).not.toBeNull();
    act(() => {
      link?.click();
    });

    expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
    expect(queryPopover()).toBeNull();
  });

  it('closes from the popover close button', () => {
    render(createBaseProps(), root);
    activateTrigger();

    const close = document.querySelector<HTMLButtonElement>(
      '.context-usage-popover-header button',
    );
    expect(close?.getAttribute('aria-label')).toBe('Close');
    act(() => {
      close?.click();
    });

    expect(queryPopover()).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover).not.toBeNull();
    if (!popover) {
      throw new Error('popover not rendered');
    }

    pressKey(popover, 'Escape');

    expect(queryPopover()).toBeNull();
    expect(queryTrigger().getAttribute('aria-expanded')).toBe('false');

    // Radix's focus scope restores focus in a macrotask on unmount.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(document.activeElement).toBe(queryTrigger());
  });

  it('shows a 5:00 cache estimate when updatedAt is now and popover opens', () => {
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).toContain('Cache estimate · expires in 5:00');
  });

  it('decrements the estimate each second while the popover is open', () => {
    render(createBaseProps(), root);
    activateTrigger();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    const popover = queryPopover();
    // 61s elapsed → 300 - 61 = 239s → 3:59 (ceil keeps it at 3:59 once past 3:59.0)
    expect(popover?.textContent).toContain('Cache estimate · expires in 3:59');
  });

  it('hides the estimate when updatedAt is older than 5 minutes', () => {
    vi.setSystemTime(new Date('2026-07-26T00:06:00.000Z'));
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });

  it('hides the estimate when updatedAt is unparseable', () => {
    render(
      createBaseProps({
        usage: {
          sessionId: 'session-test',
          tokensUsed: 40_000,
          tokensLimit: 200_000,
          updatedAt: 'not-a-date',
        },
      }),
      root,
    );
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });

  it('hides the ring entirely when usage is null (no sample yet)', () => {
    render(createBaseProps({ usage: null }), root);
    expect(document.querySelector('[data-testid="context-usage-ring"]')).toBeNull();
    expect(queryPopover()).toBeNull();
  });

  it('clamps a future updatedAt to 5:00', () => {
    vi.setSystemTime(new Date('2026-07-25T23:59:00.000Z'));
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).toContain('Cache estimate · expires in 5:00');
  });

  it('does not run the ticker while the popover is closed', () => {
    render(createBaseProps(), root);
    // Popover never opened; advance well past the window.
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    activateTrigger();

    // Even though 10 minutes passed, the closed popover never ticked, so the
    // first render after open recomputes from Date.now() and shows expired/none.
    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });

  it('shows hover tooltip with usage and active cache expiry countdown on focus/hover', () => {
    render(
      createBaseProps({
        usage: {
          sessionId: 'session-test',
          tokensUsed: 270_000,
          tokensLimit: 1_000_000,
          updatedAt: '2026-07-26T00:00:00.000Z',
        },
      }),
      root,
    );

    act(() => {
      queryTrigger().focus();
    });

    const tooltip = document.querySelector('[data-testid="context-usage-hover-tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain('27% (270K / 1M) context used');
    expect(tooltip?.textContent).toContain('Prompt cache expires in 5:00');
  });

  it('shows expired prompt cache warning in hover tooltip when cache window has passed', () => {
    vi.setSystemTime(new Date('2026-07-26T00:06:00.000Z'));
    render(
      createBaseProps({
        usage: {
          sessionId: 'session-test',
          tokensUsed: 618_000,
          tokensLimit: 1_000_000,
          updatedAt: '2026-07-26T00:00:00.000Z',
        },
      }),
      root,
    );

    act(() => {
      queryTrigger().focus();
    });

    const tooltip = document.querySelector('[data-testid="context-usage-hover-tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain('62% (618K / 1M) context used');
    expect(tooltip?.textContent).toContain('Prompt cache has expired.');
    expect(tooltip?.textContent).toContain('Higher cost expected.');
  });
});

describe('CACHE_EXPIRY_ESTIMATE_MS', () => {
  it('is a 5-minute window', () => {
    expect(CACHE_EXPIRY_ESTIMATE_MS).toBe(5 * 60 * 1000);
  });
});
