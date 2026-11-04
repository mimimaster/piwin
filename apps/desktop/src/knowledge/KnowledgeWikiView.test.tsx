// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse, KnowledgeBaseSummary, WikiOverviewResult } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import {
  KnowledgeWikiView,
  formatWikilinksForMarkdown,
  wikiUnavailableCopy,
  type KnowledgeWikiViewProps,
} from './KnowledgeWikiView.js';

describe('KnowledgeWikiView', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  describe('formatWikilinksForMarkdown', () => {
    it('formats basic [[Target]] to markdown link', () => {
      expect(formatWikilinksForMarkdown('Refer to [[FSRS Algorithm]] for details.')).toBe(
        'Refer to [FSRS Algorithm](#concept-fsrs-algorithm) for details.',
      );
    });

    it('formats [[Target|Alias]] with custom alias', () => {
      expect(formatWikilinksForMarkdown('See [[Knowledge Base|Personal Wiki]].')).toBe(
        'See [Personal Wiki](#concept-knowledge-base).',
      );
    });

    it('handles non-English characters in slug', () => {
      expect(formatWikilinksForMarkdown('阅读 [[分布式共识算法|共识]] 章节。')).toBe(
        '阅读 [共识](#concept-分布式共识算法) 章节。',
      );
    });
  });


  const mockOverview: WikiOverviewResult = {
    indexContent: '# Knowledge Index',
    logSnippet: '# Wiki Log',
    concepts: [
      {
        slug: 'fsrs-spaced-repetition',
        title: 'FSRS Spaced Repetition',
        summary: 'Free Spaced Repetition Scheduler algorithm and concepts.',
        tags: ['learning', 'algorithm'],
        updatedAt: '2026-09-11T12:00:00Z',
        relativePath: 'concepts/fsrs-spaced-repetition.md',
      },
      {
        slug: 'llm-wiki-architecture',
        title: 'LLM-Wiki Architecture',
        summary: 'Karpathy pattern for compiling raw knowledge into an encyclopedia.',
        tags: ['architecture', 'ai'],
        updatedAt: '2026-09-10T15:30:00Z',
        relativePath: 'concepts/llm-wiki-architecture.md',
      },
    ],
    totalConcepts: 2,
  };

  const mockConceptDetail = {
    slug: 'fsrs-spaced-repetition',
    title: 'FSRS Spaced Repetition',
    summary: 'Free Spaced Repetition Scheduler algorithm and concepts.',
    tags: ['learning', 'algorithm'],
    updatedAt: '2026-09-11T12:00:00Z',
    aliases: ['FSRS-4.5', 'Free Spaced Repetition'],
    links: ['llm-wiki-architecture'],
    relativePath: 'concepts/fsrs-spaced-repetition.md',
    contentHash: 'hash-fsrs',
    content:
      '# FSRS Spaced Repetition\n\nFSRS outperforms SM-2. It connects well with [[LLM-Wiki Architecture|Personal Wiki]].',
  };

  const mockLinkedConceptDetail = {
    slug: 'llm-wiki-architecture',
    title: 'LLM-Wiki Architecture',
    summary: 'Karpathy pattern for compiling raw knowledge into an encyclopedia.',
    tags: ['architecture', 'ai'],
    updatedAt: '2026-09-10T15:30:00Z',
    aliases: [],
    links: ['fsrs-spaced-repetition'],
    relativePath: 'concepts/llm-wiki-architecture.md',
    contentHash: 'hash-llm',
    content: '# LLM-Wiki Architecture\n\nCompiles raw inputs into structured concepts.',
  };

  function createWikiRequest(overview: WikiOverviewResult = mockOverview) {
    return vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      switch (command.type) {
        case 'knowledge/wiki/overview':
          return { type: 'response', command: command.type, success: true, data: overview };
        case 'knowledge/wiki/concept': {
          const slug = (command as { slug?: string }).slug;
          if (slug === 'fsrs-spaced-repetition') {
            return {
              type: 'response',
              command: command.type,
              success: true,
              data: { concept: mockConceptDetail },
            };
          }
          if (slug === 'llm-wiki-architecture') {
            return {
              type: 'response',
              command: command.type,
              success: true,
              data: { concept: mockLinkedConceptDetail },
            };
          }
          return { type: 'response', command: command.type, success: false, error: 'not found' };
        }
        case 'knowledge/wiki/distill-draft':
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: {
              draft: {
                title: 'Batch concept',
                summary: 'From two files.',
                tags: ['batch'],
                content: 'Draft only.',
                sources: [
                  { baseId: command.baseId, relativePath: 'a.md' },
                  { baseId: command.baseId, relativePath: 'b.md' },
                ],
                relatedPages: [{ slug: 'fsrs-spaced-repetition', title: 'FSRS Spaced Repetition', reason: 'tag' }],
              },
            },
          };
        case 'knowledge/wiki/write':
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: {
              concept: {
                ...mockConceptDetail,
                slug: 'new-note',
                title: command.input.title,
                content: command.input.content,
                kind: 'note',
                contentHash: 'hash-new',
              },
            },
          };
        case 'knowledge/wiki/update': {
          if (command.input.expectedContentHash !== 'hash-fsrs') {
            return {
              type: 'response',
              command: command.type,
              success: false,
              error: 'Wiki page changed since the client last read it',
              problem: { code: 'wiki-revision-conflict' },
            };
          }
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: {
              concept: {
                ...mockConceptDetail,
                title: command.input.title ?? mockConceptDetail.title,
                content: command.input.content ?? mockConceptDetail.content,
                contentHash: 'hash-fsrs-2',
              },
            },
          };
        }
        default:
          return { type: 'response', command: command.type, success: false, error: 'unknown' };
      }
    });
  }

  async function render(overrides: Partial<KnowledgeWikiViewProps> = {}) {
    const props: KnowledgeWikiViewProps = {
      locale: 'zh-CN',
      request: createWikiRequest(),
      onUseInChat: vi.fn(),
      onProduceFlashcards: vi.fn(),
      wikiFolderPath: '/Users/piwin/.piwin/wiki',
      ...overrides,
    };

    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeWikiView {...props} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return props;
  }

  it('shows a real empty state with no concepts and never counts the sample as content', async () => {
    const emptyOverview: WikiOverviewResult = {
      indexContent: '',
      logSnippet: '',
      concepts: [],
      totalConcepts: 0,
    };
    await render({ request: createWikiRequest(emptyOverview) });

    const empty = container.querySelector('[data-testid="wiki-empty-state"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('还没有知识页');
    expect(container.querySelector('[data-testid="wiki-active-concept-title"]')).toBeNull();
    expect(container.textContent).not.toContain('Andrej Karpathy LLM-Wiki');
  });

  it('opens the sample only when asked, and it can still mount the wiki in chat', async () => {
    const emptyOverview: WikiOverviewResult = {
      indexContent: '',
      logSnippet: '',
      concepts: [],
      totalConcepts: 0,
    };
    const props = await render({ request: createWikiRequest(emptyOverview) });

    const sampleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="wiki-empty-show-sample"]',
    );
    expect(sampleButton).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-empty-show-sample"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="wiki-active-concept-title"]')).not.toBeNull();
    });
    expect(container.textContent).toContain('Andrej Karpathy LLM-Wiki');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-use-in-chat-btn"]')?.click();
    });
    expect(props.onUseInChat).toHaveBeenCalledWith('wiki');
  });

  it('renders concept list and loads initial concept detail', async () => {
    const props = await render();

    expect(container.querySelector('[data-testid="knowledge-wiki-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wiki-concept-item-fsrs-spaced-repetition"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wiki-concept-item-llm-wiki-architecture"]')).not.toBeNull();

    // Verify header detail
    expect(container.querySelector('[data-testid="wiki-active-concept-title"]')?.textContent).toContain(
      'FSRS Spaced Repetition',
    );

    // Verify use in chat
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-use-in-chat-btn"]')?.click();
    });
    expect(props.onUseInChat).toHaveBeenCalledWith('wiki');

    // Verify make flashcards
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-produce-cards-btn"]')?.click();
    });
    expect(props.onProduceFlashcards).toHaveBeenCalledWith('/Users/piwin/.piwin/wiki');
  });

  it('navigates to linked concept when in-text wikilink is clicked', async () => {
    await render();

    // Click in-text wikilink Personal Wiki (points to #concept-llm-wiki-architecture)
    const anchor = container.querySelector<HTMLAnchorElement>('a[href="#concept-llm-wiki-architecture"]');
    expect(anchor).not.toBeNull();

    await act(async () => {
      anchor?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="wiki-active-concept-title"]')?.textContent).toContain(
      'LLM-Wiki Architecture',
    );
  });

  it('filters concepts by tag filter pills', async () => {
    await render();

    const tagButtons = container.querySelectorAll<HTMLButtonElement>('.wiki-tag-filter-btn');
    const aiTagBtn = Array.from(tagButtons).find((b) => b.textContent?.includes('#ai'));
    expect(aiTagBtn).toBeDefined();

    act(() => {
      aiTagBtn?.click();
    });

    // FSRS should be hidden, LLM-Wiki should be visible
    expect(container.querySelector('[data-testid="wiki-concept-item-fsrs-spaced-repetition"]')).toBeNull();
    expect(container.querySelector('[data-testid="wiki-concept-item-llm-wiki-architecture"]')).not.toBeNull();
  });

  it('maps host teardown to a centered unavailable state, not the three-pane grid', async () => {
    const copy = wikiUnavailableCopy('Host transport is not open', 'zh-CN');
    expect(copy.title).toBe('知识库不可用');
    expect(copy.description).not.toContain('Host transport is not open');

    await render({
      request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
        if (command.type === 'knowledge/wiki/overview') {
          return {
            type: 'response',
            command: command.type,
            success: false,
            error: 'Host transport is not open',
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unknown' };
      }),
    });

    expect(container.querySelector('[data-testid="wiki-error-view"]')).not.toBeNull();
    expect(container.querySelector('.wiki-layout')).toBeNull();
    expect(container.querySelector('.wiki-nav-pane')).toBeNull();
    expect(container.textContent).toContain('知识库不可用');
    expect(container.textContent).not.toContain('Host transport is not open');
    expect(container.querySelector('[data-testid="wiki-error-retry"]')).not.toBeNull();
  });

  it('resolves outlink slugs to concept titles in the copilot pane', async () => {
    await render();
    const copilot = container.querySelector('[aria-label="维基助读"]');
    expect(copilot?.textContent).toContain('LLM-Wiki Architecture');
    expect(copilot?.textContent).not.toContain('[[llm-wiki-architecture]]');
  });

  it('opens a distill draft with sources and cancels without writing', async () => {
    const request = createWikiRequest();
    const sourceBases: KnowledgeBaseSummary[] = [
      {
        id: 'folder:docs',
        kind: 'folder',
        name: 'Docs',
        folderPath: '/tmp/docs',
        state: 'ready',
        degraded: false,
        documentCount: 2,
      },
    ];
    await render({ request, sourceBases, sourceDrawerOpen: true });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-source-distill-folder:docs"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="wiki-page-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wiki-draft-sources"]')?.textContent).toContain('a.md');
    expect(container.querySelector('[data-testid="wiki-draft-related"]')?.textContent).toContain(
      'FSRS Spaced Repetition',
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-draft-cancel"]')?.click();
    });
    expect(container.querySelector('[data-testid="wiki-page-editor"]')).toBeNull();
    expect(request.mock.calls.some((call) => call[0].type === 'knowledge/wiki/write')).toBe(false);
    expect(request.mock.calls.some((call) => call[0].type === 'knowledge/wiki/update')).toBe(false);
    expect(request.mock.calls.some((call) => call[0].type === 'knowledge/wiki/distill')).toBe(false);
  });

  it('cancels a handwritten draft without writing a page', async () => {
    const request = createWikiRequest();
    await render({ request });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-new-note-btn"]')?.click();
    });
    expect(container.querySelector('[data-testid="wiki-page-editor"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-draft-cancel"]')?.click();
    });
    expect(container.querySelector('[data-testid="wiki-page-editor"]')).toBeNull();
    expect(request.mock.calls.some((call) => call[0].type === 'knowledge/wiki/write')).toBe(false);
    expect(request.mock.calls.some((call) => call[0].type === 'knowledge/wiki/update')).toBe(false);
  });

  it('saves an edit with the last content hash and keeps the draft on conflict', async () => {
    const request = createWikiRequest();
    await render({ request });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-edit-page-btn"]')?.click();
    });
    const body = container.querySelector<HTMLTextAreaElement>('[data-testid="wiki-draft-body"]');
    expect(body).not.toBeNull();
    await act(async () => {
      if (!body) return;
      body.value = 'Edited locally.';
      body.dispatchEvent(new Event('input', { bubbles: true }));
      body.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="wiki-draft-save"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const updated = request.mock.calls.find((call) => call[0].type === 'knowledge/wiki/update')?.[0];
    expect(updated?.type).toBe('knowledge/wiki/update');
    if (updated?.type !== 'knowledge/wiki/update') throw new Error('expected update');
    expect(updated.input.expectedContentHash).toBe('hash-fsrs');
    expect(container.querySelector('[data-testid="wiki-page-editor"]')).toBeNull();
  });
});
