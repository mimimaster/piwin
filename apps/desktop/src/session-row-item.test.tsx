// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionRowItem } from './session-row-item';
import { getDesktopCopy } from './desktop-locale';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const copy = getDesktopCopy('zh-CN').sidebar;

function renderSessionRow(props: {
  session: SessionListItemUi | DraftSessionItemUi;
  projectSubtitle?: string;
  activeSessionId?: string | null;
  isPinnedSection?: boolean;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SessionRowItem
        session={props.session}
        projectSubtitle={props.projectSubtitle}
        isPinnedSection={props.isPinnedSection}
        activeSessionId={props.activeSessionId ?? null}
        onResumeSession={vi.fn()}
        onOpenSessionMenu={vi.fn()}
        copy={copy}
      />,
    );
  });

  return { container, root };
}

describe('SessionRowItem', () => {
  let activeContainers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const container of activeContainers) {
      container.remove();
    }
    activeContainers = [];
  });

  it('renders session name and formatted preview snippet with quotes when lastPreview is present', () => {
    const session: SessionListItemUi = {
      id: 'sess-1',
      name: '手写简单 Agent 实现引导',
      lastPreview: '那就用python吧，我常年用java',
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({ session });
    activeContainers.push(container);

    const titleEl = container.querySelector('.session-item-title-text');
    expect(titleEl?.textContent).toBe('手写简单 Agent 实现引导');

    const previewEl = container.querySelector('[data-testid="session-item-preview"]');
    expect(previewEl).not.toBeNull();
    expect(previewEl?.textContent).toBe('“那就用python吧，我常年用java”');

    // Does not render any username or user tag (unlike proto-00 Yorick avatar)
    expect(container.querySelector('.u-tag')).toBeNull();
    expect(container.querySelector('.u-av')).toBeNull();
    expect(container.textContent).not.toContain('Yorick');
  });

  it('does not duplicate quotes if lastPreview already starts and ends with quotes', () => {
    const session: SessionListItemUi = {
      id: 'sess-2',
      name: 'Mobile session · 接线验证',
      lastPreview: '“你好，这是 Inkstone 接线验证。”',
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({ session });
    activeContainers.push(container);

    const previewEl = container.querySelector('[data-testid="session-item-preview"]');
    expect(previewEl?.textContent).toBe('“你好，这是 Inkstone 接线验证。”');
  });

  it('renders preview from draft text for draft sessions', () => {
    const draft: DraftSessionItemUi = {
      id: 'draft-1',
      name: '草稿会话',
      text: '整理这周的设计规范更新',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: { kind: 'general' },
      isDraft: true,
    };

    const { container } = renderSessionRow({ session: draft });
    activeContainers.push(container);

    const previewEl = container.querySelector('[data-testid="session-item-preview"]');
    expect(previewEl).not.toBeNull();
    expect(previewEl?.textContent).toBe('“整理这周的设计规范更新”');
  });

  it('does not render preview element when lastPreview is absent', () => {
    const session: SessionListItemUi = {
      id: 'sess-3',
      name: '新会话',
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({ session });
    activeContainers.push(container);

    expect(container.querySelector('[data-testid="session-item-preview"]')).toBeNull();
  });

  it('displays projectSubtitle instead of preview when projectSubtitle is provided', () => {
    const session: SessionListItemUi = {
      id: 'sess-4',
      name: '项目内会话',
      lastPreview: '一些工作区相关的提问',
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({ session, projectSubtitle: 'piwin' });
    activeContainers.push(container);

    const subtitleEl = container.querySelector('[data-testid="session-project-subtitle"]');
    expect(subtitleEl?.textContent).toBe('piwin');
    expect(container.querySelector('[data-testid="session-item-preview"]')).toBeNull();
  });

  it('sanitizes product history wrappers and extracts the clean user message', () => {
    const session: SessionListItemUi = {
      id: 'sess-5',
      name: 'Mobile session',
      lastPreview:
        '[piwin-product-history]\nPrior conversation (product transcript; not Pi JSONL):\nUser: 你好，这是 Inkstone 接线验证。\n[/piwin-product-history]\n\n---\nCurrent user message:\n你好',
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({ session });
    activeContainers.push(container);

    const previewEl = container.querySelector('[data-testid="session-item-preview"]');
    expect(previewEl?.textContent).toBe('“你好”');
    expect(previewEl?.textContent).not.toContain('piwin-product-history');
    expect(previewEl?.textContent).not.toContain('JSONL');

    const rowEl = container.querySelector('.session-row');
    expect(rowEl?.classList.contains('session-row--has-preview')).toBe(true);
  });

  it('strips XML context_ref tags from lastPreview', () => {
    const session: SessionListItemUi = {
      id: 'sess-6',
      name: 'Web search session',
      lastPreview:
        '<context_ref type="selection" location="web_search"> web_search </context_ref> Create exactly one flashcard',
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({ session });
    activeContainers.push(container);

    const previewEl = container.querySelector('[data-testid="session-item-preview"]');
    expect(previewEl?.textContent).toBe('“Create exactly one flashcard”');
  });

  it('renders top-hanging ribbon and unboxed project tag when isPinnedSection is true', () => {
    const session: SessionListItemUi = {
      id: 'sess-pinned-1',
      name: 'Pinned Session',
      isPinned: true,
      updatedAt: new Date().toISOString(),
    };

    const { container } = renderSessionRow({
      session,
      projectSubtitle: 'piwin',
      isPinnedSection: true,
    });
    activeContainers.push(container);

    // Ribbon bookmark is rendered
    expect(container.querySelector('[data-testid="session-pinned-ribbon"]')).not.toBeNull();
    // Redundant inline bookmark is omitted
    expect(container.querySelector('.session-pin-mark')).toBeNull();
    // Project tag is not rendered in pinned section
    expect(container.querySelector('[data-testid="session-project-subtitle"]')).toBeNull();
    // Button has data-pinned-section
    const button = container.querySelector('[data-testid="session-item"]');
    expect(button?.getAttribute('data-pinned-section')).toBe('true');
  });
});

