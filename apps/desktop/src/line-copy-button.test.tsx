// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import {
  DesktopContextMenuProvider,
  type ContextMenuDispatchers,
  type DesktopContextMenuValue,
} from './context-menu/index.js';
import { EnhancedMarkdownView } from './EnhancedMarkdownView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LineCopyButton', () => {
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

  function renderWithMenu(text: string): ReturnType<typeof vi.fn> {
    const copyText = vi.fn();
    const dispatchers = {
      addToChat: vi.fn(),
      focusComposer: vi.fn(),
      sendPreset: vi.fn(),
      openPath: vi.fn(),
      revealPath: vi.fn(),
      copyText,
      quoteInComposer: vi.fn(),
      retryMessage: vi.fn(),
      forkMessage: vi.fn(),
      openSideChat: vi.fn(),
      notify: vi.fn(),
    } satisfies ContextMenuDispatchers;
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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopContextMenuProvider value={menu}>
            <EnhancedMarkdownView text={text} />
          </DesktopContextMenuProvider>
        </PiwinUiProvider>,
      );
    });
    return copyText;
  }

  it('copies the surrounding block as Markdown source and flashes a confirmation', () => {
    const copyText = renderWithMenu('## Plan\n\nRun `pnpm test` **now**.');
    const buttons = container?.querySelectorAll<HTMLButtonElement>('.line-copy-btn');
    expect(buttons).toHaveLength(2);
    expect(buttons?.[1]?.getAttribute('aria-label')).toBe('复制此块');

    act(() => buttons?.[1]?.click());

    expect(copyText).toHaveBeenCalledWith('Run `pnpm test` **now**.');
    expect(buttons?.[1]?.getAttribute('data-copied')).toBe('true');
  });

  it('copies a heading with its marker', () => {
    const copyText = renderWithMenu('## Plan\n\nbody');
    act(() => container?.querySelector<HTMLButtonElement>('.line-copy-btn')?.click());
    expect(copyText).toHaveBeenCalledWith('## Plan');
  });
});
