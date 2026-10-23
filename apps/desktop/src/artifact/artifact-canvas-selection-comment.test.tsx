// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import {
  DesktopContextMenuProvider,
  type ContextMenuDispatchers,
  type DesktopContextMenuValue,
} from '../context-menu/index.js';
import { ArtifactCanvasSelectionComment } from './artifact-canvas-selection-comment.js';
import { toArtifactTextSelection } from './artifact-canvas-selection.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeDispatchers() {
  return {
    addToChat: vi.fn(),
    focusComposer: vi.fn(),
    sendPreset: vi.fn(),
    openPath: vi.fn(),
    revealPath: vi.fn(),
    copyText: vi.fn(),
    quoteInComposer: vi.fn(),
    retryMessage: vi.fn(),
    forkMessage: vi.fn(),
    openSideChat: vi.fn(),
    notify: vi.fn(),
  } satisfies ContextMenuDispatchers;
}

describe('ArtifactCanvasSelectionComment', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('quotes the selection into the Composer, clears the frame selection, and closes', () => {
    const dispatchers = makeDispatchers();
    const menu: DesktopContextMenuValue = {
      caps: {
        hasProject: false,
        canReveal: false,
        sideChatAvailable: false,
        applyAvailable: false,
        canSendPreset: false,
        locale: 'zh-CN',
      },
      dispatchers,
    };
    const clear = vi.fn();
    const onDone = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopContextMenuProvider value={menu}>
            <ArtifactCanvasSelectionComment
              selection={{
                text: 'Revenue grew 12%',
                anchor: { getBoundingClientRect: () => new DOMRect(10, 10, 40, 12) },
                clear,
              }}
              locale="zh-CN"
              onDone={onDone}
            />
          </DesktopContextMenuProvider>
        </PiwinUiProvider>,
      );
    });

    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-canvas-selection-comment"]',
    );
    expect(button?.textContent).toBe('评论');
    act(() => button?.click());

    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
    expect(dispatchers.addToChat.mock.calls[0]?.[0]).toMatchObject({ kind: 'selection', snapshotText: 'Revenue grew 12%' });
    expect(dispatchers.focusComposer).toHaveBeenCalledTimes(1);
    expect(dispatchers.sendPreset).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalled();
  });
});

describe('toArtifactTextSelection', () => {
  it('maps the frame-local box through the iframe box and its CSS scale', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'clientWidth', { value: 400 });
    Object.defineProperty(iframe, 'clientHeight', { value: 300 });
    iframe.getBoundingClientRect = () => new DOMRect(100, 50, 200, 150);
    const selection = toArtifactTextSelection(
      {
        type: 'piwin-artifact:selection',
        channelId: 'c',
        text: 'hi',
        rect: { left: 40, top: 20, width: 60, height: 10 },
      },
      iframe,
    );
    const rect = selection?.anchor.getBoundingClientRect();
    expect([rect?.left, rect?.top, rect?.width, rect?.height]).toEqual([120, 60, 30, 5]);
  });

  it('is null for a clear report', () => {
    const iframe = document.createElement('iframe');
    expect(
      toArtifactTextSelection(
        { type: 'piwin-artifact:selection', channelId: 'c', text: '', rect: null },
        iframe,
      ),
    ).toBeNull();
  });
});
