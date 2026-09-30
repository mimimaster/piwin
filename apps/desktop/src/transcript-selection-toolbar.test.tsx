// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import {
  DesktopContextMenuProvider,
  type ContextMenuCapabilities,
  type ContextMenuDispatchers,
  type DesktopContextMenuValue,
} from './context-menu/index.js';
import {
  TranscriptSelectionToolbar,
  type TranscriptSelectionToolbarProps,
} from './transcript-selection-toolbar.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createDispatchers(): ContextMenuDispatchers {
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

function selectText(node: Text, start: number, end: number): Selection {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error('expected window.getSelection');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('TranscriptSelectionToolbar', () => {
  let root: Root | null = null;
  let hostElement: HTMLElement | null = null;
  let containerRef = createRef<HTMLDivElement>();
  let dispatchers: ContextMenuDispatchers;
  let caps: ContextMenuCapabilities;

  beforeEach(() => {
    dispatchers = createDispatchers();
    caps = {
      hasProject: true,
      canReveal: true,
      sideChatAvailable: true,
      applyAvailable: true,
      canSendPreset: true,
      locale: 'zh-CN',
    };
    hostElement = document.createElement('div');
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    hostElement?.remove();
    hostElement = null;
    root = null;
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function renderToolbar(
    customCaps?: Partial<ContextMenuCapabilities>,
    toolbarProps?: Partial<TranscriptSelectionToolbarProps>,
  ): {
    containerEl: HTMLDivElement;
    textNode: Text;
  } {
    containerRef = { current: null };
    const effectiveCaps = { ...caps, ...customCaps };
    const menuValue: DesktopContextMenuValue = {
      caps: effectiveCaps,
      dispatchers,
    };

    let containerEl!: HTMLDivElement;
    let textNode!: Text;

    function TestHarness(): ReactElement {
      return (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopContextMenuProvider value={menuValue}>
            <div
              ref={(node) => {
                containerRef.current = node;
                if (node) containerEl = node;
              }}
              data-testid="chat-thread"
            >
              <p
                ref={(p) => {
                  if (p && !p.firstChild) {
                    textNode = document.createTextNode('这是选中的文字，用于测试');
                    p.appendChild(textNode);
                  }
                }}
              />
            </div>
            <TranscriptSelectionToolbar
              containerRef={containerRef}
              projectPath="/mock/project"
              locale={effectiveCaps.locale}
              {...toolbarProps}
            />
          </DesktopContextMenuProvider>
        </PiwinUiProvider>
      );
    }

    act(() => {
      root!.render(<TestHarness />);
    });

    return { containerEl, textNode };
  }

  it('does not render toolbar when there is no text selection', () => {
    renderToolbar();
    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
  });

  it('renders toolbar with "添加到对话" and "生成闪卡" when text is selected', () => {
    const { textNode } = renderToolbar();

    act(() => {
      selectText(textNode, 0, 7); // "这是选中的文字"
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const toolbar = document.querySelector('[data-testid="transcript-selection-toolbar"]');
    expect(toolbar).not.toBeNull();

    const addToChatBtn = document.querySelector('[data-testid="selection-toolbar-add-to-chat"]');
    expect(addToChatBtn).not.toBeNull();
    expect(addToChatBtn?.textContent).toContain('添加到对话');

    const flashcardBtn = document.querySelector('[data-testid="selection-toolbar-generate-flashcard"]');
    expect(flashcardBtn).not.toBeNull();
    expect(flashcardBtn?.textContent).toContain('生成闪卡');
    expect((flashcardBtn as HTMLButtonElement)?.disabled).toBe(false);
  });

  it('renders English labels when locale is en', () => {
    const { textNode } = renderToolbar({ locale: 'en' });

    act(() => {
      selectText(textNode, 0, 7);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const addToChatBtn = document.querySelector('[data-testid="selection-toolbar-add-to-chat"]');
    expect(addToChatBtn?.textContent).toContain('Add to Chat');

    const flashcardBtn = document.querySelector('[data-testid="selection-toolbar-generate-flashcard"]');
    expect(flashcardBtn?.textContent).toContain('Generate flashcard');
  });

  it('clicking "添加到对话" adds selection ref to chat and focuses composer', () => {
    const { textNode } = renderToolbar();

    act(() => {
      selectText(textNode, 0, 7);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const addToChatBtn = document.querySelector('[data-testid="selection-toolbar-add-to-chat"]') as HTMLButtonElement;
    expect(addToChatBtn).not.toBeNull();

    act(() => {
      addToChatBtn.click();
    });

    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
    expect(dispatchers.addToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'selection',
        snapshotText: '这是选中的文字',
        projectPath: '/mock/project',
      }),
    );
    expect(dispatchers.focusComposer).toHaveBeenCalledTimes(1);
    expect(dispatchers.sendPreset).not.toHaveBeenCalled();

    // Toolbar closes after action
    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
  });

  it('clicking "生成闪卡" sends preset for flashcard creation', () => {
    const { textNode } = renderToolbar();

    act(() => {
      selectText(textNode, 0, 7);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const flashcardBtn = document.querySelector('[data-testid="selection-toolbar-generate-flashcard"]') as HTMLButtonElement;
    expect(flashcardBtn).not.toBeNull();

    act(() => {
      flashcardBtn.click();
    });

    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
    expect(dispatchers.sendPreset).toHaveBeenCalledTimes(1);
    expect(dispatchers.sendPreset).toHaveBeenCalledWith(
      expect.stringContaining('Create exactly one flashcard'),
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'selection',
          snapshotText: '这是选中的文字',
        }),
      ]),
    );

    // Toolbar closes after action
    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
  });

  it('disables "生成闪卡" button when canSendPreset is false', () => {
    const { textNode } = renderToolbar({ canSendPreset: false });

    act(() => {
      selectText(textNode, 0, 7);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const flashcardBtn = document.querySelector('[data-testid="selection-toolbar-generate-flashcard"]') as HTMLButtonElement;
    expect(flashcardBtn).not.toBeNull();
    expect(flashcardBtn.disabled).toBe(true);
    expect(flashcardBtn.title).toBe('会话未就绪');

    act(() => {
      flashcardBtn.click();
    });

    expect(dispatchers.sendPreset).not.toHaveBeenCalled();
  });

  it('does not open when selection is outside container', () => {
    renderToolbar();

    const outsideDiv = document.createElement('div');
    const outsideText = document.createTextNode('外部文本内容');
    outsideDiv.appendChild(outsideText);
    document.body.appendChild(outsideDiv);

    act(() => {
      selectText(outsideText, 0, 4);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
    outsideDiv.remove();
  });

  it('does not open when selection is inside an input or textarea', () => {
    const { containerEl } = renderToolbar();

    const input = document.createElement('input');
    input.value = 'input text';
    containerEl.appendChild(input);

    const inputText = document.createTextNode('input text inside');
    input.appendChild(inputText);

    act(() => {
      selectText(inputText, 0, 5);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
    input.remove();
  });

  it('closes toolbar on Escape key', () => {
    const { textNode } = renderToolbar();

    act(() => {
      selectText(textNode, 0, 7);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
  });

  it('closes toolbar on contextmenu event', () => {
    const { textNode } = renderToolbar();

    act(() => {
      selectText(textNode, 0, 7);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
  });
  describe('document surface actions', () => {
    function selectAndOpen(textNode: Text): void {
      act(() => {
        selectText(textNode, 0, 7);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    }

    function typeInto(textarea: HTMLTextAreaElement, value: string): void {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      act(() => {
        setter?.call(textarea, value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    it('offers neither Copy nor Comment on the transcript', () => {
      const { textNode } = renderToolbar();
      selectAndOpen(textNode);
      expect(document.querySelector('[data-testid="selection-toolbar-copy"]')).toBeNull();
      expect(document.querySelector('[data-testid="selection-toolbar-comment"]')).toBeNull();
    });

    it('Copy writes the whole selection, past the Add to Chat cap', () => {
      const long = '长'.repeat(9000);
      const { textNode } = renderToolbar(undefined, {
        copyable: true,
        serializeRange: () => long,
      });
      selectAndOpen(textNode);

      const copy = document.querySelector<HTMLButtonElement>(
        '[data-testid="selection-toolbar-copy"]',
      );
      expect(copy?.textContent).toContain('复制');
      act(() => copy?.click());

      expect(dispatchers.copyText).toHaveBeenCalledWith(long);
      expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
    });

    it('Add to Chat sends the serialized Markdown, capped', () => {
      const { textNode } = renderToolbar(undefined, {
        copyable: true,
        serializeRange: () => '`code` and **bold**',
      });
      selectAndOpen(textNode);
      act(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="selection-toolbar-add-to-chat"]')
          ?.click(),
      );
      expect(dispatchers.addToChat).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotText: '`code` and **bold**' }),
      );
    });

    it('Comment opens an inline composer and submits the quote with the note', () => {
      const submit = vi.fn();
      const { textNode } = renderToolbar(undefined, {
        serializeRange: () => 'exact quote',
        comment: { blockedReason: () => null, submit },
      });
      selectAndOpen(textNode);

      act(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="selection-toolbar-comment"]')
          ?.click(),
      );
      const input = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="selection-toolbar-comment-input"]',
      );
      expect(input).not.toBeNull();
      expect(document.querySelector('.selection-toolbar-quote')?.textContent).toBe('exact quote');

      const submitButton = document.querySelector<HTMLButtonElement>(
        '[data-testid="selection-toolbar-comment-submit"]',
      );
      expect(submitButton?.disabled).toBe(true);

      typeInto(input as HTMLTextAreaElement, '  tighten this  ');
      expect(submitButton?.disabled).toBe(false);
      act(() => submitButton?.click());

      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ quote: 'exact quote', commentText: 'tighten this' }),
      );
      expect(document.querySelector('[data-testid="transcript-selection-toolbar"]')).toBeNull();
    });

    it('keeps the composer open when arrow keys move the caret inside it', () => {
      const { textNode } = renderToolbar(undefined, {
        comment: { blockedReason: () => null, submit: vi.fn() },
      });
      selectAndOpen(textNode);
      act(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="selection-toolbar-comment"]')
          ?.click(),
      );
      const input = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="selection-toolbar-comment-input"]',
      );

      act(() => {
        window.getSelection()?.removeAllRanges();
        input?.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
      });

      expect(
        document.querySelector('[data-testid="selection-toolbar-comment-input"]'),
      ).not.toBeNull();
    });

    it('disables Comment with the reason when the block cannot take one', () => {
      const { textNode } = renderToolbar(undefined, {
        comment: { blockedReason: () => '这一段已有评论', submit: vi.fn() },
      });
      selectAndOpen(textNode);
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="selection-toolbar-comment"]',
      );
      expect(button?.disabled).toBe(true);
      expect(button?.title).toBe('这一段已有评论');
    });
  });
});
