// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ContextMenuFromCatalog, type ContextMenuTarget } from './context-menu';
import { MessageBubbleContextMenu } from './message-bubble-context-menu.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function noopDispatchers() {
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
    applyToFile: vi.fn(),
    openChangedFiles: vi.fn(),
    notify: vi.fn(),
  };
}

const caps = {
  hasProject: true,
  canReveal: true,
  sideChatAvailable: true,
  applyAvailable: true,
  canSendPreset: true,
  locale: 'en' as const,
};

const messageTarget: ContextMenuTarget = {
  surface: 'message-assistant',
  sessionId: 's1',
  messageId: 'm1',
  text: 'the number 42 is fine',
  label: 'Assistant response',
  capabilities: { canRetry: false, canFork: false, canSideChat: false },
};

const codeBlockTarget: ContextMenuTarget = {
  surface: 'code-block',
  selectedText: 'const x = 1;',
  label: 'ts',
};

function selectText(node: Text, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error('expected window.getSelection');
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('MessageBubbleContextMenu', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    document.body.innerHTML = '';
    root = null;
    container = null;
  });

  function renderMenu(node: ReactElement): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const menuRoot = createRoot(host);
    act(() => {
      menuRoot.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
      );
    });
    root = menuRoot;
    container = host;
  }

  it('uses the selection menu when the bubble has a live range', () => {
    renderMenu(
      <MessageBubbleContextMenu messageTarget={messageTarget} caps={caps} dispatchers={noopDispatchers()}>
        <article data-testid="message-bubble">the number 42 is fine</article>
      </MessageBubbleContextMenu>,
    );

    const bubble = container?.querySelector('[data-testid="message-bubble"]');
    const text = bubble?.firstChild;
    if (!(text instanceof Text) || !bubble) {
      throw new Error('expected bubble text');
    }
    selectText(text, 11, 13);
    act(() => {
      bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="context-menu-add-to-chat"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-quote-in-composer"]')).toBeNull();
  });

  it('keeps the whole-message menu when the selection is collapsed', () => {
    renderMenu(
      <MessageBubbleContextMenu messageTarget={messageTarget} caps={caps} dispatchers={noopDispatchers()}>
        <article data-testid="message-bubble">the number 42 is fine</article>
      </MessageBubbleContextMenu>,
    );

    const bubble = container?.querySelector('[data-testid="message-bubble"]') as HTMLElement | null;
    act(() => {
      bubble?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="context-menu-quote-in-composer"]')).not.toBeNull();
  });

  it('quotes visible Artifact text instead of shadow CSS', () => {
    renderMenu(
      <MessageBubbleContextMenu messageTarget={messageTarget} caps={caps} dispatchers={noopDispatchers()}>
        <article data-testid="message-bubble">
          <div data-testid="artifact-static-host" />
        </article>
      </MessageBubbleContextMenu>,
    );

    const host = container?.querySelector('[data-testid="artifact-static-host"]');
    const bubble = container?.querySelector('[data-testid="message-bubble"]');
    if (!(host instanceof HTMLElement) || !bubble) {
      throw new Error('expected artifact host');
    }
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { color: red; }';
    const card = document.createElement('div');
    card.textContent = 'visible title';
    shadow.append(style, card);
    const text = card.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected artifact text');
    }
    selectText(text, 0, 13);
    act(() => {
      bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="context-menu-add-to-chat"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-quote-in-composer"]')).toBeNull();
    const header = document.body.querySelector('.ui-menu-header');
    expect(header?.textContent).toContain('visible title');
    expect(header?.textContent).not.toContain('color: red');
  });

  it('does not steal a code-fence right-click', () => {
    renderMenu(
      <MessageBubbleContextMenu messageTarget={messageTarget} caps={caps} dispatchers={noopDispatchers()}>
        <article data-testid="message-bubble">
          <span>prose</span>
          <ContextMenuFromCatalog
            testId="code-block-context-menu"
            target={codeBlockTarget}
            caps={caps}
            dispatchers={noopDispatchers()}
          >
            <pre className="md-code-block" data-testid="code-fence-source">
              const x = 1;
            </pre>
          </ContextMenuFromCatalog>
        </article>
      </MessageBubbleContextMenu>,
    );

    const fence = container?.querySelector('[data-testid="code-fence-source"]') as HTMLElement | null;
    act(() => {
      fence?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="context-menu-apply-to-file"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-quote-in-composer"]')).toBeNull();
  });
});
