// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DocPreviewPanel } from './DocPreviewPanel';
import {
  DesktopContextMenuProvider,
  type ContextMenuDispatchers,
  type DesktopContextMenuValue,
} from './context-menu/index.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('DocPreviewPanel', () => {
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

  it('shows a back action when embedded in the workspace stage', () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="README.md"
            content="# Readme"
            filePath="/workspace/README.md"
            onClose={onClose}
          />
        </PiwinUiProvider>,
      );
    });

    const closeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="doc-preview-close"]',
    );
    expect(closeButton).not.toBeNull();

    act(() => {
      closeButton?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render a back action for standalone document previews', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel title="README.md" content="# Readme" />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="doc-preview-close"]')).toBeNull();
  });

  it('shows only the filename in the header, not the path or provenance', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="live-call-coordinator.ts"
            content="export {}"
            filePath="/Users/me/piwin/packages/host-runtime/src/voice/live-call-coordinator.ts"
            displayRef="packages/host-runtime/src/voice/live-call-coordinator.ts"
            provenance="project-current"
          />
        </PiwinUiProvider>,
      );
    });

    const heading = container.querySelector('.doc-preview-title');
    expect(heading?.textContent).toBe('live-call-coordinator.ts');
    expect(heading?.getAttribute('title')).toBe(
      'packages/host-runtime/src/voice/live-call-coordinator.ts',
    );
    expect(container.querySelector('[data-testid="doc-preview-provenance"]')).toBeNull();
    expect(container.querySelector('[data-testid="doc-preview-meta"]')).toBeNull();
    expect(container.querySelector('.doc-preview-header')?.textContent).not.toContain(
      'packages/host-runtime/src/voice/live-call-coordinator.ts',
    );
    expect(container.querySelector('.doc-preview-header')?.textContent).not.toContain(
      '当前磁盘版本',
    );
  });

  it('shows the outside-project read-only badge for trusted-config previews', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="config.json"
            content='{"ok":true}'
            provenance="trusted-config"
            readOnly
          />
        </PiwinUiProvider>,
      );
    });

    const badge = container.querySelector('[data-testid="doc-preview-readonly"]');
    expect(badge?.textContent).toContain('项目外 · 只读');
  });

  it('renders HTML files visually instead of as source code', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="card.html"
            filePath="/tmp/card.html"
            content="<h1>Hello</h1>"
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="markup-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-static"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-preview-view"]')).toBeNull();
  });

  it('shows a centered reason instead of dumping host codes', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="Setup.dmg"
            filePath="/proj/Setup.dmg"
            status="unavailable"
            unavailableReason="binary"
            displayRef="/proj/Setup.dmg"
            suggestion="该文件无法作为文档预览。请右键路径芯片选择另存为，或在文件管理器中显示。"
          />
        </PiwinUiProvider>,
      );
    });

    const state = container.querySelector('[data-testid="doc-preview-state-unavailable"]');
    expect(state).not.toBeNull();
    expect(state?.textContent).toContain('无法预览此文件');
    expect(state?.textContent).toContain('不支持预览 .dmg 文件');
    expect(state?.textContent).not.toContain('binary');
    expect(state?.textContent).not.toContain('Reason');
    expect(state?.textContent).not.toContain('/proj/Setup.dmg');
  });

  it('explains when a file is too large to preview', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="huge.png"
            filePath="/proj/huge.png"
            status="unavailable"
            unavailableReason="too-large"
            byteSize={12.4 * 1024 * 1024}
            maxBytes={8 * 1024 * 1024}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const state = container.querySelector('[data-testid="doc-preview-state-unavailable"]');
    expect(state?.textContent).toContain('File is too large to preview');
    expect(state?.textContent).toContain('12.4 MB exceeds the 8.0 MB preview limit');
  });

  it('shows the Host resolution attempts behind an unavailable preview (ADR 0052 §6)', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="notes.md"
            filePath="/Users/wren/notes.md"
            status="unavailable"
            unavailableReason="remote-local-path-denied"
            attempts={[
              { route: 'media', reason: 'not-a-vault-path' },
              { route: 'project', reason: 'not-inside-project-root' },
              { route: 'local-file', reason: 'channel-denied-by-remote-shell' },
            ]}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const state = container.querySelector('[data-testid="doc-preview-state-unavailable"]');
    expect(state?.getAttribute('data-reason')).toBe('remote-local-path-denied');
    expect(state?.textContent).toContain('远程 Host 不允许读取本机路径');
    expect(state?.textContent).not.toContain('找不到此文件');

    const diagnostics = container.querySelector(
      '[data-testid="doc-preview-state-unavailable-attempts"]',
    );
    expect(diagnostics?.textContent).toContain('尝试过的路径（3）');
    expect(diagnostics?.textContent).toContain('channel-denied-by-remote-shell');
    expect(state?.getAttribute('data-attempts')).toBe('3');
  });

  it('renders SVG files visually instead of as source code', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="mark.svg"
            filePath="/tmp/mark.svg"
            content='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="markup-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-preview-view"]')).toBeNull();
  });
  describe('selection and copy', () => {
    const SOURCE = 'Use `a.ts` here.\n\nSecond **bold** paragraph.';

    function menuValue(): { value: DesktopContextMenuValue; copyText: ReturnType<typeof vi.fn> } {
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
      return {
        copyText,
        value: {
          caps: {
            hasProject: true,
            canReveal: true,
            sideChatAvailable: false,
            applyAvailable: false,
            canSendPreset: true,
            locale: 'zh-CN',
          },
          dispatchers,
        },
      };
    }

    function renderPanel(props: Partial<Parameters<typeof DocPreviewPanel>[0]> = {}) {
      const menu = menuValue();
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopContextMenuProvider value={menu.value}>
              <DocPreviewPanel title="notes.md" content={SOURCE} {...props} />
            </DesktopContextMenuProvider>
          </PiwinUiProvider>,
        );
      });
      return menu;
    }

    function selectParagraph(index: number): void {
      const paragraph = container.querySelectorAll('.enhanced-paragraph')[index] as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    }

    afterEach(() => {
      window.getSelection()?.removeAllRanges();
    });

    it('lets the rendered Markdown be selected', () => {
      renderPanel();
      expect(
        container.querySelector('[data-testid="enhanced-markdown"]')?.hasAttribute('data-selectable'),
      ).toBe(true);
    });

    it('puts Markdown source on the clipboard for a native copy', () => {
      renderPanel();
      selectParagraph(1);
      const setData = vi.fn();
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData } });

      act(() => {
        container.querySelector('.doc-preview-body')?.dispatchEvent(event);
      });

      expect(setData).toHaveBeenCalledWith('text/plain', 'Second **bold** paragraph.');
      expect(event.defaultPrevented).toBe(true);
    });

    it('shows Copy on the selection toolbar and copies Markdown, not visible text', () => {
      const { copyText } = renderPanel();
      selectParagraph(0);

      const copy = document.querySelector<HTMLButtonElement>(
        '[data-testid="selection-toolbar-copy"]',
      );
      expect(copy).not.toBeNull();
      act(() => copy?.click());

      expect(copyText).toHaveBeenCalledWith('Use `a.ts` here.');
    });

    it('offers no selection Comment unless the host can store comments', () => {
      renderPanel();
      selectParagraph(0);
      expect(document.querySelector('[data-testid="selection-toolbar-comment"]')).toBeNull();
    });

    it('anchors a selection comment to its block and quotes the selected Markdown', () => {
      const onAddComment = vi.fn();
      const onCommentLine = vi.fn();
      renderPanel({ onAddComment, onCommentLine, comments: [] });
      selectParagraph(1);

      act(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="selection-toolbar-comment"]')
          ?.click(),
      );
      const input = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="selection-toolbar-comment-input"]',
      );
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      act(() => {
        setter?.call(input, 'Say more');
        input?.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="selection-toolbar-comment-submit"]')
          ?.click(),
      );

      expect(onAddComment).toHaveBeenCalledWith({
        lineId: expect.stringMatching(/^paragraph-\d+-Second/),
        lineText: 'Second **bold** paragraph.',
        commentText: 'Say more',
      });
      expect(onCommentLine).toHaveBeenCalledWith('[Second **bold** paragraph.] "Say more"');
    });

    it('blocks a second comment on a block that already has one', () => {
      renderPanel({ onAddComment: vi.fn() });
      selectParagraph(1);
      const lineId = container
        .querySelectorAll('.enhanced-line-wrapper')[1]
        ?.getAttribute('data-line-id');
      expect(lineId).toBeTruthy();

      renderPanel({
        onAddComment: vi.fn(),
        comments: [{ id: 'c1', lineId: lineId as string, lineText: 'x', commentText: 'y' }],
      });
      selectParagraph(1);
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="selection-toolbar-comment"]',
      );
      expect(button?.disabled).toBe(true);
      expect(button?.title).toContain('已有评论');
    });
  });
});
