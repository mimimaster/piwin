// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MessageBranchSwitcher } from './message-branch-switcher.js';

const point: TranscriptBranchPoint = {
  anchorMessageId: 'a1',
  activeIndex: 0,
  siblings: [
    {
      headMessageId: 'u2-a',
      role: 'user',
      preview: 'original',
      leafPreview: 'original reply',
      messageCount: 2,
      writesWorkspace: false,
      updatedAt: '2026-08-21T00:00:00.000Z',
    },
    {
      headMessageId: 'u2-b',
      role: 'user',
      preview: 'alternative',
      leafPreview: 'alternative reply',
      messageCount: 2,
      writesWorkspace: false,
      updatedAt: '2026-08-21T00:01:00.000Z',
    },
  ],
};

describe('MessageBranchSwitcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders ‹n/m›, clicks the open side, and disables while streaming', () => {
    const onSwitch = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MessageBranchSwitcher point={point} onSwitch={onSwitch} locale="en" />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="message-branch-label"]')?.textContent).toBe(
      '1 / 2',
    );
    const prev = container.querySelector(
      '[data-testid="message-branch-prev"]',
    ) as HTMLButtonElement;
    const next = container.querySelector(
      '[data-testid="message-branch-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    act(() => {
      next.click();
    });
    expect(onSwitch).toHaveBeenCalledWith('u2-b');

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MessageBranchSwitcher point={point} disabled onSwitch={onSwitch} locale="en" />
        </PiwinUiProvider>,
      );
    });
    expect(
      (container.querySelector('[data-testid="message-branch-next"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
