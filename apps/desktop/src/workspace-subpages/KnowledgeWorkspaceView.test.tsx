// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  HostCommand,
  HostResponse,
  KnowledgeBaseSummary,
} from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeWorkspaceView, type KnowledgeWorkspaceViewProps } from './KnowledgeWorkspaceView.js';

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

function ok(command: HostCommand, data: unknown): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

function knowledgeRequest() {
  return vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    switch (command.type) {
      case 'knowledge/bases/list':
        return ok(command, { bases: [readyBase, pendingBase] });
      case 'knowledge/wiki/overview':
        return ok(command, { concepts: [], logCount: 0, tagCount: 0 });
      case 'flashcards/decks':
        return ok(command, { decks: [] });
      case 'flashcards/list':
        return ok(command, { cards: [] });
      case 'flashcards/study/catalog':
        return ok(command, { dueCount: 0, newCount: 0 });
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
      request: knowledgeRequest(),
      knowledgeSupported: true,
      initialTab: 'documents',
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
    });
    return props;
  }

  it('opens the wiki source drawer instead of the old documents hub', async () => {
    const props = await render();
    expect(container.querySelector('[data-testid="knowledge-source-hub"]')).toBeNull();
    expect(container.querySelector('[data-testid="wiki-source-drawer"]')).not.toBeNull();
    expect(container.querySelector(`[data-testid="wiki-source-card-${readyBase.id}"]`)?.textContent).toContain(
      'fsrs-papers',
    );
    expect(container.querySelector(`[data-testid="wiki-source-card-${pendingBase.id}"]`)?.textContent).toContain(
      '未入库',
    );

    act(() => {
      container.querySelector<HTMLButtonElement>(`[data-testid="wiki-source-reslice-${pendingBase.id}"]`)?.click();
    });
    expect(props.onOpenIngest).toHaveBeenCalledWith('/docs/design');
  });

  it('explains an old Host instead of listing nothing', async () => {
    const props = await render({ knowledgeSupported: false });
    expect(container.querySelector('[data-testid="knowledge-host-too-old"]')).not.toBeNull();
    expect(props.request).not.toHaveBeenCalled();
  });

  it('puts knowledge tabs in the titlebar and drops host status plus flywheel copy', async () => {
    await render({ initialTab: 'flashcards' });
    const titlebar = container.querySelector('[data-testid="studio-topbar"]');
    expect(titlebar?.querySelector('[data-testid="knowledge-tab-documents"]')).toBeNull();
    expect(titlebar?.querySelector('[data-testid="knowledge-tab-wiki"]')).not.toBeNull();
    expect(titlebar?.querySelector('[data-testid="knowledge-tab-flashcards"]')).not.toBeNull();
    expect(container.querySelector('.studio-chrome .vault-filters')).toBeNull();
    expect(container.querySelector('.subbar-flywheel')).toBeNull();
    expect(container.querySelector('.kb-topbar-status')).toBeNull();
    expect(container.textContent).not.toContain('三阶知识飞轮');
    expect(container.textContent).not.toContain('Host :4310');
    expect(container.textContent).not.toContain('BGE-M3');
  });

  it('keeps the knowledge title visible after switching to the ink face', async () => {
    await render({ initialTab: 'flashcards' });
    const ink = container.querySelector<HTMLButtonElement>('#face-ink');
    expect(ink).not.toBeNull();
    act(() => {
      ink?.click();
    });
    const stage = container.querySelector('.vault-stage');
    expect(stage?.getAttribute('data-face')).toBe('ink');
    expect(document.documentElement.dataset.themeId).toBe('piwin-inkstone-ink');
    expect(container.querySelector('.vault-bar-context')?.textContent).toContain('知识中心');
  });

  it('defaults to wiki tab when initialTab is omitted and no initial folder path is provided', async () => {
    await render({ initialTab: undefined });
    expect(container.querySelector('[data-testid="knowledge-tab-wiki"]')?.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('[data-testid="knowledge-tab-documents"]')).toBeNull();
  });

  it('slides the source drawer over flashcards without leaving the study tab', async () => {
    await render({ initialTab: 'flashcards' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="flashcards-study-view"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-goto-docs"]')?.click();
    });

    expect(container.querySelector('[data-testid="flashcards-study-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-tab-flashcards"]')?.classList.contains('is-active')).toBe(
      true,
    );
    expect(container.querySelector('[data-testid="knowledge-wiki-workspace"]')).toBeNull();
    expect(container.querySelector('[data-testid="wiki-source-drawer"]')).not.toBeNull();
    expect(container.querySelector(`[data-testid="wiki-source-card-${readyBase.id}"]`)?.textContent).toContain(
      'fsrs-papers',
    );
  });

  it('opens the wiki tab from the LLM-Wiki pathway without the source drawer', async () => {
    await render({ initialTab: 'flashcards' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-pathway-wiki"]')?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="knowledge-wiki-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-study-view"]')).toBeNull();
    expect(container.querySelector('[data-testid="wiki-source-drawer"]')).toBeNull();
  });

  it('switches between wiki and flashcards study tabs, and manages sources from the wiki', async () => {
    await render({ initialTab: 'wiki' });
    expect(container.querySelector('[data-testid="knowledge-tab-wiki"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-tab-flashcards"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-tab-documents"]')).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-tab-flashcards"]')?.click();
    });
    expect(container.querySelector('[data-testid="flashcards-study-view"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-tab-wiki"]')?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="flashcards-study-view"]')).toBeNull();
    expect(container.querySelector('[data-testid="knowledge-wiki-workspace"]')).not.toBeNull();

    // Source drawer interaction from wiki
    expect(container.querySelector('[data-testid="wiki-nav-source-footer"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-manage-sources-btn"]')?.click();
    });
    expect(container.querySelector('[data-testid="wiki-source-drawer"]')).not.toBeNull();
  });

  it('produces flashcards directly from knowledge base and provides a shortcut to review', async () => {
    const fakeRequest = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      switch (command.type) {
        case 'knowledge/bases/list':
          return ok(command, { bases: [readyBase] });
        case 'doccards/generate':
          return ok(command, {
            job: { id: 'gen-1', folderPath: readyBase.folderPath, status: 'COMPLETED', created: 7 },
          });
        case 'doccards/generation-status':
          return ok(command, {
            job: { id: 'gen-1', folderPath: readyBase.folderPath, status: 'COMPLETED', created: 7 },
          });
        case 'flashcards/decks':
          return ok(command, { decks: ['General'] });
        case 'flashcards/list':
          return ok(command, { cards: [] });
        case 'flashcards/study/catalog':
          return ok(command, { dueCount: 0, newCount: 0 });
        case 'knowledge/wiki/overview':
          return ok(command, { concepts: [], logCount: 0, tagCount: 0 });
        default:
          return ok(command, {});
      }
    });

    await render({ request: fakeRequest });
    const makeCardsBtn = container.querySelector<HTMLButtonElement>(
      `[data-testid="wiki-source-distill-${readyBase.id}"]`,
    );
    expect(makeCardsBtn).not.toBeNull();

    await act(async () => {
      makeCardsBtn?.click();
      await Promise.resolve();
    });

    const successNotice = container.querySelector('[data-testid="knowledge-produce-success"]');
    expect(successNotice).not.toBeNull();
    expect(successNotice?.textContent).toContain('7');

    const reviewBtn = successNotice?.querySelector<HTMLButtonElement>('button');
    expect(reviewBtn).not.toBeNull();
    await act(async () => {
      reviewBtn?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="flashcards-study-view"]')).not.toBeNull();
  });

  it('opens the in-app Host folder picker and adds the chosen directory', async () => {
    const addedBase: KnowledgeBaseSummary = {
      id: 'folder:newsource',
      kind: 'folder',
      name: 'Projects',
      folderPath: '/Users/mock/Projects',
      state: 'not-indexed',
      degraded: false,
      documentCount: 0,
    };
    const homeListing = {
      path: '/Users/mock',
      parentPath: '/',
      homePath: '/Users/mock',
      entries: [
        { name: 'Projects', kind: 'directory', path: '/Users/mock/Projects' },
        { name: 'Documents', kind: 'directory', path: '/Users/mock/Documents' },
      ],
    };
    const fakeRequest = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      switch (command.type) {
        case 'knowledge/bases/list':
          return ok(command, { bases: [readyBase, pendingBase] });
        case 'host/list-dir': {
          const reqPath = (command as { path?: string }).path;
          return ok(command, {
            ...homeListing,
            path: reqPath || homeListing.path,
          });
        }
        case 'knowledge/bases/add':
          return ok(command, { base: addedBase });
        case 'flashcards/study/catalog':
          return ok(command, { dueCount: 0, newCount: 0 });
        case 'knowledge/wiki/overview':
          return ok(command, { concepts: [], logCount: 0, tagCount: 0 });
        default:
          return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
    });

    await render({ request: fakeRequest, initialTab: 'documents' });
    expect(container.querySelector('[data-testid="knowledge-folder-picker"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-drawer-add-folder"]')?.click();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="knowledge-folder-picker"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="host-workspace-picker"]')).not.toBeNull();
    await act(async () => {
      await vi.waitFor(() => {
        expect(fakeRequest).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'host/list-dir' }),
        );
      });
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="host-workspace-dir"]')).not.toBeNull();
      });
    });

    const projectsFolder = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-testid="host-workspace-dir"]'),
    ).find((node) => node.textContent?.includes('Projects'));
    expect(projectsFolder).toBeTruthy();
    await act(async () => {
      projectsFolder?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fakeRequest).toHaveBeenCalledWith({
      type: 'knowledge/bases/add',
      folderPath: '/Users/mock/Projects',
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="knowledge-folder-picker"]')).toBeNull();
      });
    });
  });
});
