// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import {
  ConversationPaneWorkspace,
  conversationPanePresetFits,
} from './conversation-pane-workspace.js';
import type { HostClient } from './host-client.js';
import { useConversationPaneLayout } from './use-conversation-pane-layout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const hostClient = {
  getTransport: () => 'mock',
  isReady: () => true,
  subscribe: () => () => undefined,
  supportsForegroundAdmission: () => true,
  request: vi.fn(),
} as unknown as HostClient;

function Probe(props: {
  keyboardEnabled?: boolean;
  onCreateConversation?: (paneId: string) => Promise<string | null>;
}): React.ReactElement {
  const controller = useConversationPaneLayout({ enabled: true, primarySessionId: 'primary' });
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ConversationPaneWorkspace
        controller={controller}
        primaryPane={<div data-testid="primary-pane">Primary</div>}
        primarySessionName="Primary Chat"
        sessions={[]}
        hostClient={hostClient}
        activeTheme={PIWIN_APPEARANCE_DARK}
        artifactThemeKey="test"
        artifactPreviewEnabled={true}
        readMedia={null}
        locale="en"
        {...(props.keyboardEnabled === undefined ? {} : { keyboardEnabled: props.keyboardEnabled })}
        onCreateConversation={props.onCreateConversation ?? (async () => null)}
      />
    </PiwinUiProvider>
  );
}

describe('ConversationPaneWorkspace', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let widthDescriptor: PropertyDescriptor | undefined;
  let heightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1600,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 900,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Probe />);
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    if (widthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
    }
    if (heightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
    }
  });

  it('allows shrinking a layout even below the expansion size guard', () => {
    expect(conversationPanePresetFits(8, 1, 100, 100)).toBe(true);
    expect(conversationPanePresetFits(1, 8, 100, 100)).toBe(false);
  });

  it('splits with visible controls and exposes a keyboard-operable separator', () => {
    expect(container?.querySelector('.conversation-pane-header')).toBeNull();
    expect(
      container
        ?.querySelector('[data-testid="conversation-pane-workspace"]')
        ?.classList.contains('is-single-pane'),
    ).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    });

    const workspace = container?.querySelector<HTMLElement>(
      '[data-testid="conversation-pane-workspace"]',
    );
    expect(workspace?.dataset.paneCount).toBe('2');
    expect(workspace?.classList.contains('is-single-pane')).toBe(false);
    expect(container?.querySelectorAll('[data-pane-id]')).toHaveLength(2);
    const primaryPane = container?.querySelector('[data-pane-id="conversation-pane-primary"]');
    const secondaryPane = container?.querySelectorAll<HTMLElement>('[data-pane-id]')[1];
    expect(primaryPane?.querySelector('[aria-label="Chat layout"]')).not.toBeNull();
    expect(primaryPane?.querySelector('[aria-label="Close pane"]')).toBeNull();
    expect(secondaryPane?.querySelector('[aria-label="Split right"]')).not.toBeNull();
    expect(secondaryPane?.querySelector('[aria-label="Close pane"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="conversation-pane-presets"]')).not.toBeNull();
    expect(container?.textContent).toContain('Open a Chat here');
    expect(container?.textContent).toContain('2 Chats');

    const separator = container?.querySelector<HTMLElement>('[role="separator"]');
    expect(separator?.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator?.getAttribute('aria-valuenow')).toBe('50');
    act(() => {
      separator?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(container?.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe(
      '55',
    );
  });

  it('creates and binds a Chat in the pane that requested it', async () => {
    const onCreateConversation = vi.fn(async (_paneId: string) => 'session-secondary');
    act(() => {
      root?.render(<Probe onCreateConversation={onCreateConversation} />);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    });

    const paneElements = container?.querySelectorAll<HTMLElement>('[data-pane-id]');
    const secondaryPane = paneElements?.[1];
    if (!secondaryPane) throw new Error('split did not create a secondary pane');
    const secondaryPaneId = secondaryPane.dataset.paneId;
    if (!secondaryPaneId) throw new Error('secondary pane has no id');

    await act(async () => {
      secondaryPane.querySelector<HTMLButtonElement>('.conversation-pane-picker button')?.click();
      await Promise.resolve();
    });

    expect(onCreateConversation).toHaveBeenCalledWith(secondaryPaneId);
    expect(
      container?.querySelector(
        `[data-pane-id="${secondaryPaneId}"] [data-testid="conversation-pane-session"]`,
      ),
    ).not.toBeNull();
    expect(
      container?.querySelector<HTMLElement>('[data-pane-id="conversation-pane-primary"]')?.dataset
        .conversationPaneActive,
    ).toBe('false');
  });

  it('handles pane shortcuts even when focus is inside the workspace', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    });
    expect(
      container?.querySelector<HTMLElement>('[data-testid="conversation-pane-workspace"]')?.dataset
        .paneCount,
    ).toBe('2');

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, shiftKey: true }),
      );
    });
    expect(
      container
        ?.querySelector('[data-testid="conversation-pane-workspace"]')
        ?.classList.contains('has-maximized-pane'),
    ).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, altKey: true }));
    });
    expect(
      container?.querySelector<HTMLElement>('[data-testid="conversation-pane-workspace"]')?.dataset
        .paneCount,
    ).toBe('1');
  });

  it('applies a layout preset from the chip bar', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    });
    const presets = container?.querySelectorAll<HTMLButtonElement>('.conversation-pane-preset') ?? [];
    const four = Array.from(presets).find((button) => button.textContent === '4 Chats');
    expect(four).toBeDefined();
    act(() => {
      four?.click();
    });
    expect(
      container?.querySelector<HTMLElement>('[data-testid="conversation-pane-workspace"]')?.dataset
        .paneCount,
    ).toBe('4');
    expect(container?.querySelector('.conversation-pane-preset.is-active')?.textContent).toBe(
      '4 Chats',
    );
  });

  it('toggles maximized pane when double clicking header', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    });
    const workspace = container?.querySelector<HTMLElement>(
      '[data-testid="conversation-pane-workspace"]',
    );
    expect(workspace?.dataset.paneCount).toBe('2');
    expect(workspace?.classList.contains('has-maximized-pane')).toBe(false);

    const header = container?.querySelector<HTMLElement>('.conversation-pane-header');
    expect(header).not.toBeNull();

    act(() => {
      header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(workspace?.classList.contains('has-maximized-pane')).toBe(true);

    act(() => {
      header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(workspace?.classList.contains('has-maximized-pane')).toBe(false);
  });

  it('does not capture shortcuts while an overlay owns the shell', () => {
    act(() => {
      root?.render(<Probe keyboardEnabled={false} />);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    });
    expect(
      container?.querySelector<HTMLElement>('[data-testid="conversation-pane-workspace"]')?.dataset
        .paneCount,
    ).toBe('1');
  });
});
