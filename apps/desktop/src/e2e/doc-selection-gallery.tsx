import { useState, type ReactElement } from 'react';
import { DocPreviewPanel } from '../DocPreviewPanel.js';
import type { LineCommentItem } from '../EnhancedMarkdownView.js';
import {
  DesktopContextMenuProvider,
  type ContextMenuDispatchers,
  type DesktopContextMenuValue,
} from '../context-menu/index.js';

const SOURCE = [
  '# Selecting rendered Markdown',
  '',
  'Read `AGENTS.md` first, then **run** the checks and _report_ back.',
  '',
  '- one',
  '- two',
  '  - nested',
  '- [ ] open',
  '- [x] closed',
  '',
  '> A quoted note that spans a sentence.',
  '',
  '```bash',
  'pnpm typecheck',
  'pnpm test',
  '```',
  '',
  '| Name | Count |',
  '| :--- | ---: |',
  '| a | 1 |',
].join('\n');

/** A spec may preview its own document through `window.__piwinE2eDocSource`. */
function readGallerySource(): string {
  const injected = (window as unknown as { __piwinE2eDocSource?: unknown }).__piwinE2eDocSource;
  return typeof injected === 'string' && injected.length > 0 ? injected : SOURCE;
}

type GalleryLog = { copied: string[]; addedToChat: string[] };

declare global {
  interface Window {
    __docSelectionGallery?: GalleryLog;
  }
}

function createDispatchers(log: GalleryLog): ContextMenuDispatchers {
  return {
    addToChat: (ref) => log.addedToChat.push(JSON.stringify(ref)),
    focusComposer: () => undefined,
    sendPreset: () => undefined,
    openPath: () => undefined,
    revealPath: () => undefined,
    copyText: (text) => log.copied.push(text),
    quoteInComposer: () => undefined,
    retryMessage: () => undefined,
    forkMessage: () => undefined,
    openSideChat: () => undefined,
    notify: () => undefined,
  };
}

/** Fixture for the doc pane: selection, Markdown copy, and selection comments. */
export function DocSelectionGallery(): ReactElement {
  const [comments, setComments] = useState<LineCommentItem[]>([]);
  const [source] = useState(readGallerySource);
  const [log] = useState<GalleryLog>(() => {
    const value: GalleryLog = { copied: [], addedToChat: [] };
    window.__docSelectionGallery = value;
    return value;
  });
  const [menu] = useState<DesktopContextMenuValue>(() => ({
    caps: {
      hasProject: true,
      canReveal: false,
      sideChatAvailable: false,
      applyAvailable: false,
      canSendPreset: true,
      locale: 'zh-CN',
    },
    dispatchers: createDispatchers(log),
  }));

  return (
    <DesktopContextMenuProvider value={menu}>
      <div style={{ height: '80vh', width: 720 }} data-testid="doc-selection-gallery">
        <DocPreviewPanel
          title="notes.md"
          filePath="/repo/docs/notes.md"
          projectPath="/repo"
          content={source}
          comments={comments}
          onAddComment={(comment) =>
            setComments((current) => [...current, { id: `c-${current.length}`, ...comment }])
          }
          onEditComment={(id, commentText) =>
            setComments((current) =>
              current.map((comment) => (comment.id === id ? { ...comment, commentText } : comment)),
            )
          }
          onDeleteComment={(id) => setComments((current) => current.filter((c) => c.id !== id))}
        />
      </div>
    </DesktopContextMenuProvider>
  );
}
