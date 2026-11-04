// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse, KnowledgeBaseSummary } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import {
  KnowledgeWorkspaceView,
  type KnowledgeWorkspaceViewProps,
} from './KnowledgeWorkspaceView.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const readyBase: KnowledgeBaseSummary = {
  id: 'folder:0123456789abcdef',
  kind: 'folder',
  name: 'fsrs-papers',
  folderPath: '/docs/fsrs',
  state: 'ready',
  degraded: true,
  documentCount: 18,
  chunkCount: 412,
};

const pendingBase: KnowledgeBaseSummary = {
  id: 'folder:fedcba9876543210',
  kind: 'folder',
  name: 'design-notes',
  folderPath: '/docs/design',
  state: 'not-indexed',
  degraded: false,
  documentCount: 0,
};

const missingBase: KnowledgeBaseSummary = {
  id: 'folder:aaaaaaaaaaaaaaaa',
  kind: 'folder',
  name: 'moved-away',
  folderPath: '/docs/moved',
  state: 'missing',
  degraded: false,
  documentCount: 0,
};

const wikiConcepts = [
  {
    title: '极限的严格定义',
    slug: 'limit',
    summary: 'epsilon-N',
    tags: ['数学'],
    updatedAt: '2026-11-02T00:00:00.000Z',
    relativePath: 'concepts/limit.md',
  },
  {
    title: '核与像',
    slug: 'kernel',
    summary: '线性映射',
    tags: ['数学'],
    updatedAt: '2026-10-28T00:00:00.000Z',
    relativePath: 'concepts/kernel.md',
  },
];

function ok(command: HostCommand, data: unknown): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

function knowledgeRequest(overrides: Partial<Record<HostCommand['type'], unknown>> = {}) {
  return vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    if (command.type in overrides) {
      return ok(command, overrides[command.type]);
    }
    switch (command.type) {
      case 'knowledge/bases/list':
        return ok(command, { bases: [readyBase, pendingBase, missingBase] });
      case 'knowledge/search':
        return ok(command, {
          citations: [
            {
              ref: 1,
              baseId: readyBase.id,
              baseName: readyBase.name,
              kind: 'folder',
              title: 'fsrs.md',
              relativePath: 'fsrs.md',
              text: 'Spaced repetition schedule.',
            },
            {
              ref: 2,
              baseId: 'wiki',
              baseName: 'Wiki',
              kind: 'wiki',
              title: 'FSRS',
              relativePath: 'concepts/fsrs.md',
              text: 'Compiled FSRS page.',
              metadata: { sources: [{ baseId: readyBase.id, relativePath: 'fsrs.md' }] },
            },
          ],
          degradedBaseIds: [],
          skipped: [{ baseId: pendingBase.id, reason: 'not-indexed' }],
        });
      case 'knowledge/collections/list':
        return ok(command, { collections: [] });
      case 'knowledge/wiki/overview':
        return ok(command, {
          indexContent: '',
          logSnippet: '',
          concepts: wikiConcepts,
          totalConcepts: wikiConcepts.length,
        });
      case 'knowledge/wiki/concept':
        return ok(command, {
          concept: {
            title: '极限的严格定义',
            slug: 'limit',
            summary: 'epsilon-N',
            tags: ['数学'],
            updatedAt: '2026-11-02',
            relativePath: 'concepts/limit.md',
            content: '正文',
            links: [],
          },
        });
      case 'knowledge/documents/list':
        return ok(command, {
          baseId: command.baseId,
          folderPath: '/docs/fsrs',
          items: [
            {
              relativePath: 'fsrs.md',
              title: 'fsrs',
              extension: 'md',
              sizeBytes: 1200,
              language: 'markdown',
              indexed: true,
              chunkCount: 12,
              readability: 'text',
              updatedAt: '2026-11-01T00:00:00.000Z',
            },
            {
              relativePath: 'pending.md',
              title: 'pending',
              extension: 'md',
              sizeBytes: 10,
              language: 'markdown',
              indexed: false,
              chunkCount: 0,
              readability: 'text',
            },
          ],
          total: 2,
        });
      case 'knowledge/document/read': {
        const startLine = command.startLine ?? 1;
        return ok(command, {
          baseId: command.baseId,
          relativePath: command.relativePath,
          title: 'fsrs',
          language: 'markdown',
          text: startLine === 1 ? '# FSRS\n\n第一段正文。' : '第三段继续。',
          startLine,
          endLine: startLine === 1 ? 2 : 4,
          totalLines: 10,
          hasMore: true,
          truncatedChars: false,
          indexed: false,
          chunkCount: 0,
          readability: 'text',
        });
      }
      case 'flashcards/study/catalog':
        return ok(command, {
          tiles: command.query
            ? [{ kind: 'single', id: 'card_fsrs', count: 1, preview: 'What is FSRS?' }]
            : [],
          dueCount: 5,
          newCount: 3,
          unfinishedRounds: [],
        });
      case 'flashcards/decks':
        return ok(command, { decks: [] });
      case 'flashcards/list':
        return ok(command, { cards: [] });
      default:
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
    }
  });
}

describe('KnowledgeWorkspaceView', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(overrides: Partial<KnowledgeWorkspaceViewProps> = {}) {
    const props: KnowledgeWorkspaceViewProps = {
      locale: 'zh-CN',
      onClose: vi.fn(),
      request: knowledgeRequest() as unknown as KnowledgeWorkspaceViewProps['request'],
      knowledgeSupported: true,
      initialTab: 'overview',
      onOpenIngest: vi.fn(),
      onUseInChat: vi.fn(),
      onSendToChat: vi.fn(),
      onOpenCitation: vi.fn(),
      ...overrides,
    };
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeWorkspaceView {...props} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return props;
  }

  function clickTestId(testId: string): void {
    act(() => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    });
  }

  it('names the surface 知识空间 and opens the overview for a plain entry', async () => {
    await render();

    expect(container.querySelector('.vault-bar-context')?.textContent).toContain('知识空间');
    expect(container.querySelector('[data-testid="knowledge-overview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-section-overview"]')?.getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('uses English chrome when the locale is en', async () => {
    await render({ locale: 'en' });
    expect(container.querySelector('.vault-bar-context')?.textContent).toContain('Knowledge Space');
    expect(container.querySelector('[data-testid="knowledge-overview-continue"]')?.textContent).toContain(
      'Continue reading',
    );
    expect(container.querySelector('[data-testid="knowledge-topbar-search"]')?.getAttribute('placeholder')).toContain(
      'Search materials',
    );
  });

  it('shows real overview numbers from the Host, never placeholder metrics', async () => {
    await render();

    expect(container.querySelector('[data-testid="knowledge-kpi-materials"]')?.textContent).toContain('18');
    expect(container.querySelector('[data-testid="knowledge-kpi-wiki"]')?.textContent).toContain('2');
    expect(container.querySelector('[data-testid="knowledge-kpi-due"]')?.textContent).toContain('5');
    expect(container.querySelector('[data-testid="knowledge-overview-concept-limit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-overview-continue"]')).not.toBeNull();

    // The removed pseudo-metrics must not come back on any knowledge surface.
    expect(container.textContent).not.toContain('0.87s');
    expect(container.textContent).not.toContain('已交叉校验');
    expect(container.textContent).not.toContain('向量索引校验');
    expect(container.textContent).not.toContain('三阶知识飞轮');
  });

  it('lists registered sources with their real index state and filters them', async () => {
    await render({ initialTab: 'documents' });

    expect(container.querySelector(`[data-testid="knowledge-material-${readyBase.id}"]`)).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="knowledge-material-state-${pendingBase.id}"]`)?.textContent,
    ).toContain('尚未索引');
    expect(
      container.querySelector(`[data-testid="knowledge-material-state-${missingBase.id}"]`)?.textContent,
    ).toContain('来源已丢失');

    expect(container.querySelector('[data-testid="knowledge-topbar-search"]')).not.toBeNull();
  });

  it('opens index status from the nav with retry for unindexed folders', async () => {
    await render({ onConfigureEmbedding: vi.fn() });
    clickTestId('knowledge-index-settings');
    expect(container.querySelector('[data-testid="knowledge-index-status"]')).not.toBeNull();
    expect(container.querySelector(`[data-testid="knowledge-index-retry-${pendingBase.id}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-index-open-settings"]')).not.toBeNull();
  });

  it('groups materials, wiki and cards in one search and offers Ask AI', async () => {
    const props = await render({ initialTab: 'overview' });

    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('[data-testid="knowledge-topbar-search"]');
      if (input) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(input, 'fsrs');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-workspace-search"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-search-group-material"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-search-group-wiki"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-search-group-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-search-unindexed"]')).not.toBeNull();
    expect(container.textContent).toContain('派生于原文');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-search-ask-ai"]')?.click();
    });
    expect(props.onSendToChat).toHaveBeenCalled();
    const sent = String((props.onSendToChat as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
    expect(sent).toContain('Spaced repetition schedule.');
    expect(sent).not.toContain('What is FSRS?');
  });

  it('lists a source document by document and opens one in the reader', async () => {
    await render({ initialTab: 'documents', knowledgeDocumentsSupported: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-documents"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-document-fsrs.md"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-documents-count"]')?.textContent).toContain(
      '2',
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-document-fsrs.md"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-reader"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-reader-body"]')?.textContent).toContain(
      '第一段正文',
    );
    expect(container.querySelector('[data-testid="knowledge-reader-progress"]')?.textContent).toContain(
      '10',
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-reader-back"]')?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="knowledge-reader"]')).toBeNull();
    expect(container.querySelector('[data-testid="knowledge-documents"]')).not.toBeNull();
  });

  it('reads a document that has no index yet, and says so', async () => {
    await render({ initialTab: 'documents', knowledgeDocumentsSupported: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = container.querySelector('[data-testid="knowledge-document-pending.md"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('可读');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-document-pending.md"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-reader-unindexed"]')?.textContent).toContain(
      '尚未索引',
    );
    expect(container.querySelector('[data-testid="knowledge-reader-body"]')?.textContent).toContain(
      '第一段正文',
    );
  });

  it('keeps reading bounded: the foot states the window and offers more', async () => {
    await render({ initialTab: 'documents', knowledgeDocumentsSupported: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-document-fsrs.md"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-reader-progress"]')?.textContent).toContain(
      '已读到第 2 行',
    );
    const more = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-reader-load-more"]',
    );
    expect(more).not.toBeNull();

    await act(async () => {
      more?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-reader-body"]')?.textContent).toContain(
      '第三段继续',
    );
    expect(container.querySelector('[data-testid="knowledge-reader-progress"]')?.textContent).toContain(
      '已读到第 4 行',
    );
  });

  it('falls back to source cards on a Host without document browsing', async () => {
    await render({ initialTab: 'documents', knowledgeDocumentsSupported: false });
    expect(container.querySelector('[data-testid="knowledge-documents"]')).toBeNull();
    expect(container.querySelector('[data-testid="knowledge-materials"]')).not.toBeNull();
  });

  it('maps the legacy documents entry onto the materials library', async () => {
    await render({ initialTab: 'documents' });
    expect(container.querySelector('[data-testid="knowledge-materials"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-section-materials"]')?.getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('keeps an explicit folder path on the materials section', async () => {
    await render({ initialTab: 'wiki', initialFolderPath: '/docs/design' });
    expect(container.querySelector('[data-testid="knowledge-materials"]')).not.toBeNull();
  });

  it('opens the wiki section with its own source drawer', async () => {
    await render({ initialTab: 'wiki' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-wiki-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wiki-manage-sources-btn"]')).not.toBeNull();
    clickTestId('wiki-manage-sources-btn');
    expect(container.querySelector('[data-testid="wiki-source-drawer"]')).not.toBeNull();
  });

  it('opens the concept a recent-edit row points at', async () => {
    await render();
    clickTestId('knowledge-overview-concept-kernel');
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-wiki-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-section-wiki"]')?.getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('sends the flashcards section to materials instead of a drawer overlay', async () => {
    await render({ initialTab: 'flashcards' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="flashcards-study-view"]')).not.toBeNull();

    clickTestId('flashcards-goto-docs');
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="flashcards-study-view"]')).toBeNull();
    expect(container.querySelector('[data-testid="knowledge-materials"]')).not.toBeNull();
  });

  it('explains an old Host instead of listing nothing', async () => {
    const props = await render({ knowledgeSupported: false });
    expect(container.querySelector('[data-testid="knowledge-host-too-old"]')).not.toBeNull();
    expect(props.request).not.toHaveBeenCalled();
  });

  it('treats a Host without collections as a version hint, not an overview error', async () => {
    const base = knowledgeRequest();
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'knowledge/collections/list') {
        return { type: 'response', command: command.type, success: false, error: 'Unhandled command' };
      }
      return base(command);
    });

    await render({ request: request as unknown as KnowledgeWorkspaceViewProps['request'] });

    expect(container.querySelector('[data-testid="knowledge-overview-error"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="knowledge-overview-collections"]')?.textContent,
    ).toContain('还不支持主题合集');
  });

  it('offers real empty states instead of sample content', async () => {
    const emptyRequest = knowledgeRequest({
      'knowledge/bases/list': { bases: [] },
      'knowledge/wiki/overview': {
        indexContent: '',
        logSnippet: '',
        concepts: [],
        totalConcepts: 0,
      },
      'flashcards/study/catalog': { tiles: [], dueCount: 0, newCount: 0, unfinishedRounds: [] },
    });
    await render({
      request: emptyRequest as unknown as KnowledgeWorkspaceViewProps['request'],
    });

    const empty = container.querySelector('[data-testid="knowledge-overview-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('添加资料');
  });

  it('produces flashcards from a source and offers the review shortcut', async () => {
    const fakeRequest = knowledgeRequest({
      'doccards/generate': {
        job: { id: 'gen-1', folderPath: readyBase.folderPath, status: 'COMPLETED', created: 7 },
      },
      'doccards/generation-status': {
        job: { id: 'gen-1', folderPath: readyBase.folderPath, status: 'COMPLETED', created: 7 },
      },
    });
    await render({
      initialTab: 'documents',
      request: fakeRequest as unknown as KnowledgeWorkspaceViewProps['request'],
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-testid="knowledge-material-produce-${readyBase.id}"]`)
        ?.click();
      await Promise.resolve();
    });

    const successNotice = container.querySelector('[data-testid="knowledge-produce-success"]');
    expect(successNotice?.textContent).toContain('7');

    await act(async () => {
      successNotice?.querySelector<HTMLButtonElement>('button')?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="flashcards-study-view"]')).not.toBeNull();
  });

  it('opens the in-app Host folder picker and adds the chosen directory', async () => {
    const fakeRequest = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'host/list-dir') {
        return ok(command, {
          path: '/Users/mock',
          parentPath: '/',
          homePath: '/Users/mock',
          entries: [
            { name: 'Projects', kind: 'directory', path: '/Users/mock/Projects' },
          ],
        });
      }
      if (command.type === 'knowledge/bases/add') {
        return ok(command, {
          base: {
            id: 'folder:newsource',
            kind: 'folder',
            name: 'Projects',
            folderPath: '/Users/mock/Projects',
            state: 'not-indexed',
            degraded: false,
            documentCount: 0,
          },
        });
      }
      return knowledgeRequest()(command);
    });

    await render({
      initialTab: 'documents',
      request: fakeRequest as unknown as KnowledgeWorkspaceViewProps['request'],
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-materials-add-folder"]')?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="knowledge-folder-picker"]')).not.toBeNull();

    await act(async () => {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="host-workspace-dir"]')).not.toBeNull();
      });
    });

    const projects = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-testid="host-workspace-dir"]'),
    ).find((node) => node.textContent?.includes('Projects'));
    await act(async () => {
      projects?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeRequest).toHaveBeenCalledWith({
      type: 'knowledge/bases/add',
      folderPath: '/Users/mock/Projects',
    });
  });
});
