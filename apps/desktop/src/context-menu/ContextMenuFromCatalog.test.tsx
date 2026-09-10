// @vitest-environment happy-dom
// CM-16: More… submenu renders as a nested Radix context-menu branch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { ContextMenuFromCatalog } from './ContextMenuFromCatalog.js';
import { buildContextMenuItems } from './catalog.js';
import type { ContextMenuTarget } from './types.js';

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

const fileTarget: ContextMenuTarget = {
  surface: 'file-tree-file',
  projectPath: '/p',
  relativePath: 'src/a.ts',
  absolutePath: '/p/src/a.ts',
  label: 'a.ts',
};

const caps = {
  hasProject: true,
  canReveal: true,
  sideChatAvailable: true,
  applyAvailable: true,
  canSendPreset: true,
  locale: 'en' as const,
};

describe('ContextMenuFromCatalog submenu (CM-16)', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
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

  function renderMenu(node: ReactElement): { container: HTMLElement; root: Root } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const menuRoot = createRoot(host);
    act(() => {
      menuRoot.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
      );
    });
    return { container: host, root: menuRoot };
  }

  it('opens with a resolveTarget captured on contextmenu', () => {
    const dispatchers = noopDispatchers();
    const messageTarget: ContextMenuTarget = {
      surface: 'message-assistant',
      sessionId: 's1',
      messageId: 'm1',
      text: 'whole bubble',
      label: 'Assistant',
      capabilities: { canRetry: false, canFork: false, canSideChat: false },
    };
    const selectionTarget: ContextMenuTarget = {
      surface: 'selection',
      selectedText: '42',
      label: '42',
    };
    let resolved: ContextMenuTarget = messageTarget;
    const rendered = renderMenu(
      <ContextMenuFromCatalog
        testId="cm-resolve"
        target={messageTarget}
        resolveTarget={() => resolved}
        caps={caps}
        dispatchers={dispatchers}
      >
        <button type="button" data-testid="cm-trigger">
          bubble
        </button>
      </ContextMenuFromCatalog>,
    );
    root = rendered.root;
    container = rendered.container;

    resolved = selectionTarget;
    const trigger = container.querySelector('[data-testid="cm-trigger"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="context-menu-add-to-chat"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-quote-in-composer"]')).toBeNull();
    expect(document.body.querySelector('.ui-menu-header')).toBeNull();
  });

  it('keeps quote-in-composer when resolveTarget is the whole message', () => {
    const dispatchers = noopDispatchers();
    const messageTarget: ContextMenuTarget = {
      surface: 'message-assistant',
      sessionId: 's1',
      messageId: 'm1',
      text: 'whole bubble',
      label: 'Assistant',
      capabilities: { canRetry: false, canFork: false, canSideChat: false },
    };
    const rendered = renderMenu(
      <ContextMenuFromCatalog
        testId="cm-message"
        target={messageTarget}
        resolveTarget={() => messageTarget}
        caps={caps}
        dispatchers={dispatchers}
      >
        <button type="button" data-testid="cm-trigger">
          bubble
        </button>
      </ContextMenuFromCatalog>,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector('[data-testid="cm-trigger"]') as HTMLElement | null;
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[data-testid="context-menu-quote-in-composer"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="context-menu-add-to-chat"]')).not.toBeNull();
  });

  it('renders the More submenu trigger from the catalog', () => {
    const dispatchers = noopDispatchers();
    const rendered = renderMenu(
      <ContextMenuFromCatalog
        testId="cm-test"
        target={fileTarget}
        caps={caps}
        dispatchers={dispatchers}
      >
        <button type="button" data-testid="cm-trigger">
          a.ts
        </button>
      </ContextMenuFromCatalog>,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector('[data-testid="cm-trigger"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    });

    // Catalog places explain/review/tests under More…
    const items = buildContextMenuItems(fileTarget, caps);
    const more = items.find(
      (item): item is Extract<typeof item, { type: 'submenu' }> =>
        item.type === 'submenu' && item.id === 'more',
    );
    expect(more).toBeDefined();
    expect(document.body.querySelector('[data-testid="context-menu-sub-more"]')).not.toBeNull();
  });

  it('renders target header and action icons for file target', () => {
    const dispatchers = noopDispatchers();
    const rendered = renderMenu(
      <ContextMenuFromCatalog
        testId="cm-header-test"
        target={fileTarget}
        caps={caps}
        dispatchers={dispatchers}
      >
        <button type="button" data-testid="cm-trigger">
          a.ts
        </button>
      </ContextMenuFromCatalog>,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector('[data-testid="cm-trigger"]') as HTMLElement | null;
    act(() => {
      trigger?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
    });

    const header = document.body.querySelector('.ui-menu-header');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('a.ts');

    const addToChatItem = document.body.querySelector('[data-testid="context-menu-add-to-chat"]');
    expect(addToChatItem).not.toBeNull();
    expect(addToChatItem?.querySelector('.ui-menu-item-icon')).not.toBeNull();
  });

  it('shows a friendly header for a remote media asset instead of its raw ref', () => {
    const mediaTarget: ContextMenuTarget = {
      surface: 'media-image',
      label: 'remote-asset:f01f236b-4924-44f3-8560-0771f8b83646',
      fileName: 'remote-asset:f01f236b-4924-44f3-8560-0771f8b83646',
      mimeType: 'image/png',
      attachment: {
        id: 'f01f236b',
        kind: 'media',
        path: 'remote-asset:f01f236b',
        mimeType: 'image/png',
        byteSize: 10,
        source: 'generated',
      },
    };
    const rendered = renderMenu(
      <ContextMenuFromCatalog
        testId="cm-media-header"
        target={mediaTarget}
        caps={{ ...caps, canReveal: false, locale: 'zh-CN' }}
        dispatchers={noopDispatchers()}
      >
        <button type="button" data-testid="cm-trigger">
          img
        </button>
      </ContextMenuFromCatalog>,
    );
    root = rendered.root;
    container = rendered.container;
    act(() => {
      container
        ?.querySelector('[data-testid="cm-trigger"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    const header = document.body.querySelector('.ui-menu-header');
    expect(header?.textContent).toBe('PNG 图片');
    expect(header?.textContent).not.toContain('remote-asset');
    expect(document.body.querySelector('[data-testid="context-menu-reveal"]')).toBeNull();
  });
});
