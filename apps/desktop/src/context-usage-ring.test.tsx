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
  ContextUsageRing,
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
    expect(popover?.textContent).toContain('host report');
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
    expect(queryPopover()?.textContent).toContain('breakdown: host-estimate');
  });

  it('reports a critical tone and the model-config limit source', () => {
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
    expect(queryPopover()?.textContent).toContain('model config');
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
});

describe('CACHE_EXPIRY_ESTIMATE_MS', () => {
  it('is a 5-minute window', () => {
    expect(CACHE_EXPIRY_ESTIMATE_MS).toBe(5 * 60 * 1000);
  });
});
