// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  HostCommand,
  HostResponse,
  KnowledgeBaseSummary,
  KnowledgeCitation,
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

const citation: KnowledgeCitation = {
  ref: 1,
  baseId: readyBase.id,
  baseName: readyBase.name,
  kind: 'folder',
  title: 'fsrs/overview.md',
  relativePath: 'fsrs/overview.md',
  startLine: 12,
  text: 'Stability decides the next review interval.',
};

function ok(command: HostCommand, data: unknown): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

function knowledgeRequest() {
  return vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    switch (command.type) {
      case 'knowledge/bases/list':
        return ok(command, { bases: [readyBase, pendingBase] });
      case 'knowledge/search':
        return ok(command, { citations: [citation], degradedBaseIds: [readyBase.id], skipped: [] });
      default:
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
    }
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(text),
    ) ?? null
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

  it('shows each base with its state and a next step for unindexed folders', async () => {
    const props = await render();
    expect(container.querySelectorAll('.kb-list-row')).toHaveLength(2);
    const detail = () => container.querySelector('[data-testid="knowledge-base-detail"]');
    expect(detail()?.textContent).toContain('fsrs-papers');
    expect(container.querySelector('[data-testid="knowledge-base-degraded"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>(`[data-testid="knowledge-base-row-${pendingBase.id}"]`)?.click();
    });
    expect(detail()?.textContent).toContain('未入库');
    expect(container.querySelector('[data-testid="knowledge-base-use-in-chat"]')).toBeNull();
    act(() => buttonByText(container, '选择文件入库')?.click());
    expect(props.onOpenIngest).toHaveBeenCalledWith('/docs/design');
  });

  it('finds passages without a model and hands one to chat', async () => {
    const props = await render();
    const input = container.querySelector<HTMLInputElement>('[data-testid="knowledge-search-input"]');
    expect(input).not.toBeNull();
    act(() => {
      if (input) setInputValue(input, 'stability');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-search-submit"]')?.click();
      await Promise.resolve();
    });
    expect(props.request).toHaveBeenCalledWith({
      type: 'knowledge/search',
      query: 'stability',
      baseIds: [readyBase.id],
    });
    expect(container.querySelector('[data-testid="knowledge-search-results"]')?.textContent).toContain(
      citation.text,
    );
    act(() => buttonByText(container, '带到对话')?.click());
    expect(props.onSendToChat).toHaveBeenCalledWith(expect.stringContaining(`> ${citation.text}`));
    act(() => buttonByText(container, '打开原文')?.click());
    expect(props.onOpenCitation).toHaveBeenCalledWith(citation);
  });

  it('mounts a searchable base in chat', async () => {
    const props = await render();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="knowledge-base-use-in-chat"]')?.click();
    });
    expect(props.onUseInChat).toHaveBeenCalledWith(readyBase.id);
  });

  it('explains an old Host instead of listing nothing', async () => {
    const props = await render({ knowledgeSupported: false });
    expect(container.querySelector('[data-testid="knowledge-host-too-old"]')).not.toBeNull();
    expect(props.request).not.toHaveBeenCalled();
  });
});
