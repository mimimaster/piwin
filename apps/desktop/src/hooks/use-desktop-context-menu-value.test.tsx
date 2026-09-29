// @vitest-environment happy-dom
/**
 * Typing in the composer must not re-render the transcript: the context-menu
 * value every row consumes stays identical while only handler closures (which
 * capture the composer text) change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostClient } from '../host-client';
import type { DesktopContextMenuValue } from '../context-menu';
import type { DesktopContextMenuValueDeps } from '../context-menu/desktop-context-menu-value';
import { useDesktopContextMenuValue } from './use-desktop-context-menu-value.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const hostClient = {
  supportsCommand: () => true,
} as unknown as HostClient;

function createDeps(
  handleSend: DesktopContextMenuValueDeps['handleSend'],
  overrides: Partial<DesktopContextMenuValueDeps> = {},
): DesktopContextMenuValueDeps {
  return {
    projectPath: '/repo',
    activeSessionId: 'sess-1',
    hostReady: true,
    locale: 'en',
    hostClient,
    addContextRef: () => ({ ok: false, reason: 'limit' }) as never,
    dispatchNotification: vi.fn(),
    handleOpenDocument: vi.fn(),
    handleRetryMessage: vi.fn(),
    requestTruncateAfter: vi.fn(),
    handleSend,
    handleForkSession: vi.fn(),
    setComposer: vi.fn(),
    openInspector: vi.fn(),
    ...overrides,
  };
}

describe('useDesktopContextMenuValue', () => {
  let container: HTMLDivElement;
  let root: Root;
  const seen: DesktopContextMenuValue[] = [];

  function Probe(props: { deps: DesktopContextMenuValueDeps }): ReactElement | null {
    seen.push(useDesktopContextMenuValue(props.deps));
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    seen.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps value identity when only handler closures change and calls the latest one', () => {
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    act(() => root.render(<Probe deps={createDeps(firstSend)} />));
    act(() => root.render(<Probe deps={createDeps(secondSend)} />));

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    seen[1]?.dispatchers.sendPreset?.('hi', []);
    expect(firstSend).not.toHaveBeenCalled();
    expect(secondSend).toHaveBeenCalledWith('hi');
  });

  it('rebuilds the value when capability data changes', () => {
    const send = vi.fn();
    act(() => root.render(<Probe deps={createDeps(send)} />));
    act(() => root.render(<Probe deps={createDeps(send, { activeSessionId: null })} />));

    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]?.caps.sideChatAvailable).toBe(false);
  });

  it('exposes the media capability only while a media handler is provided', () => {
    const send = vi.fn();
    act(() => root.render(<Probe deps={createDeps(send)} />));
    expect(seen[0]?.caps.canAddMediaAttachment).toBeUndefined();
    act(() =>
      root.render(<Probe deps={createDeps(send, { addMediaAttachment: vi.fn() })} />),
    );
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]?.caps.canAddMediaAttachment).toBe(true);
  });
});
