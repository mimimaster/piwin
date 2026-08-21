// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import {
  ComposerAttachmentShelf,
  composerShelfHasItems,
  mediaChipBadge,
  nextComposerShelfPop,
  nextShelfChipIndex,
  type ComposerAttachmentShelfCopy,
} from './composer-attachment-shelf';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';
import type { PendingComposerAttachment } from './media-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy: ComposerAttachmentShelfCopy = {
  textOnlyModelWarning: 'text-only model cannot analyze images',
  openModelSettings: 'Model settings',
  removeCommentAttachment: 'Remove comment attachment',
  removeAttachment: 'Remove attachment',
  attachmentPreparing: 'Preparing…',
  attachmentPreparingGif: 'Preparing GIF…',
  attachmentFailedLabel: 'Save failed',
  attachmentFailureConnectionHint: 'Connection lost',
  attachmentRetry: 'Retry',
  attachmentRemove: 'Remove',
};

const fileRef: PendingContextRefItem = {
  token: 'tok-1',
  key: 'file:/p:src/a.ts:20:50',
  ref: {
    kind: 'file',
    projectPath: '/p',
    relativePath: 'src/a.ts',
    lineStart: 20,
    lineEnd: 50,
    label: 'src/a.ts',
  },
  label: 'src/a.ts',
};

const mediaAttachment: PendingComposerAttachment = {
  localId: 'local-1',
  previewUrl: 'blob:test',
  attachment: {
    id: 'a1',
    kind: 'media',
    path: '/tmp/.piwin/media/s/a.png',
    mimeType: 'image/png',
    byteSize: 100,
    source: 'paste',
  },
};

function renderShelf(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('nextComposerShelfPop', () => {
  it('pops the last attachment first', () => {
    expect(
      nextComposerShelfPop({
        attachments: [{ localId: 'a' }, { localId: 'b' }],
        contextRefs: [{ key: 'r1' }],
        hasDocComments: true,
      }),
    ).toEqual({ kind: 'attachment', localId: 'b' });
  });

  it('pops the last context ref when no attachments remain', () => {
    expect(
      nextComposerShelfPop({
        attachments: [],
        contextRefs: [{ key: 'r1' }, { key: 'r2' }],
        hasDocComments: true,
      }),
    ).toEqual({ kind: 'context-ref', key: 'r2' });
  });

  it('pops doc comments last', () => {
    expect(
      nextComposerShelfPop({
        attachments: [],
        contextRefs: [],
        hasDocComments: true,
      }),
    ).toEqual({ kind: 'doc-comments' });
  });

  it('returns null when the shelf is empty', () => {
    expect(
      nextComposerShelfPop({
        attachments: [],
        contextRefs: [],
        hasDocComments: false,
      }),
    ).toBeNull();
  });
});

describe('nextShelfChipIndex', () => {
  it('stops at the ends instead of wrapping', () => {
    expect(nextShelfChipIndex(0, 3, 'prev')).toBe(0);
    expect(nextShelfChipIndex(2, 3, 'next')).toBe(2);
    expect(nextShelfChipIndex(1, 3, 'next')).toBe(2);
    expect(nextShelfChipIndex(1, 3, 'prev')).toBe(0);
  });
});

describe('composerShelfHasItems', () => {
  it('is false when every lane is empty', () => {
    expect(
      composerShelfHasItems({
        attachments: [],
        contextRefs: [],
        hasDocComments: false,
      }),
    ).toBe(false);
  });
});

describe('ComposerAttachmentShelf', () => {
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
    root = null;
    container = null;
  });

  it('renders nothing when the shelf is empty', () => {
    const rendered = renderShelf(
      <ComposerAttachmentShelf
        copy={copy}
        pendingAttachments={[]}
        showTextOnlyImageWarning={false}
        onRemoveAttachment={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="composer-attachment-shelf"]')).toBeNull();
  });

  it('renders a doc-comment chip and a selection capsule', () => {
    const selectionRef: PendingContextRefItem = {
      token: 'tok-sel',
      key: 'sel:42',
      ref: { kind: 'selection', snapshotText: '42', label: '42' },
      label: '42',
    };
    const rendered = renderShelf(
      <ComposerAttachmentShelf
        copy={copy}
        pendingAttachments={[]}
        pendingContextRefs={[selectionRef]}
        docCommentsAttachment={{ docTitle: 'README.md', commentCount: 2 }}
        showTextOnlyImageWarning={false}
        onRemoveAttachment={vi.fn()}
        onRemoveContextRef={vi.fn()}
        onRemoveDocComments={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="doc-comment-chip"]')?.textContent).toContain(
      'README.md',
    );
    expect(container.querySelector('[data-testid="composer-context-chip"]')?.textContent).toContain(
      '42',
    );
  });

  it('shows a bounded shelf with context and media cards', () => {
    const rendered = renderShelf(
      <ComposerAttachmentShelf
        copy={copy}
        pendingAttachments={[mediaAttachment]}
        pendingContextRefs={[fileRef]}
        showTextOnlyImageWarning={false}
        onRemoveAttachment={vi.fn()}
        onRemoveContextRef={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const shelf = container.querySelector('[data-testid="composer-attachment-shelf"]');
    expect(shelf).not.toBeNull();
    expect(shelf?.classList.contains('composer-attachment-shelf')).toBe(true);
    expect(container.querySelector('[data-testid="composer-context-chip"]')?.textContent).toContain(
      'a.ts:20-50',
    );
    expect(container.querySelector('[data-upload-status]')).not.toBeNull();
  });

  it('shows a GIF badge on gif thumbs', () => {
    const gif: PendingComposerAttachment = {
      localId: 'gif-1',
      previewUrl: 'blob:gif',
      attachment: {
        id: 'g1',
        kind: 'media',
        path: '/tmp/.piwin/media/s/a.gif',
        mimeType: 'image/gif',
        name: 'loop.gif',
        byteSize: 100,
        source: 'paste',
      },
    };
    const rendered = renderShelf(
      <ComposerAttachmentShelf
        copy={copy}
        pendingAttachments={[gif]}
        showTextOnlyImageWarning={false}
        onRemoveAttachment={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="composer-media-badge"]')?.textContent).toBe('GIF');
  });

  it('moves focus with arrow keys and deletes the focused card', () => {
    const onRemoveAttachment = vi.fn();
    const onRequestComposerFocus = vi.fn();
    const second: PendingComposerAttachment = {
      ...mediaAttachment,
      localId: 'local-2',
      attachment: { ...mediaAttachment.attachment, id: 'a2' },
    };
    const rendered = renderShelf(
      <ComposerAttachmentShelf
        copy={copy}
        pendingAttachments={[mediaAttachment, second]}
        showTextOnlyImageWarning={false}
        onRemoveAttachment={onRemoveAttachment}
        onRequestComposerFocus={onRequestComposerFocus}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const chips = container.querySelectorAll<HTMLElement>('[data-shelf-chip]');
    expect(chips).toHaveLength(2);
    act(() => {
      chips[0]?.focus();
      chips[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(chips[1]);

    act(() => {
      chips[1]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(onRequestComposerFocus).toHaveBeenCalledTimes(1);

    act(() => {
      chips[1]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
      );
    });
    expect(onRemoveAttachment).toHaveBeenCalledWith('local-2');
  });
});

describe('mediaChipBadge', () => {
  it('prefers GIF over pixel size', () => {
    expect(
      mediaChipBadge({
        id: 'g1',
        kind: 'media',
        path: '/tmp/a.gif',
        mimeType: 'image/gif',
        byteSize: 10,
        source: 'paste',
        width: 1920,
        height: 1080,
      }),
    ).toBe('GIF');
  });

  it('shows resolution on large stills', () => {
    expect(
      mediaChipBadge({
        id: 'p1',
        kind: 'media',
        path: '/tmp/a.png',
        mimeType: 'image/png',
        byteSize: 10,
        source: 'paste',
        width: 1920,
        height: 1080,
      }),
    ).toBe('1920×1080');
  });

  it('hides resolution on small stills', () => {
    expect(
      mediaChipBadge({
        id: 'p1',
        kind: 'media',
        path: '/tmp/a.png',
        mimeType: 'image/png',
        byteSize: 10,
        source: 'paste',
        width: 56,
        height: 56,
      }),
    ).toBeNull();
  });
});
