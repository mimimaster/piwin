// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { KnowledgeCenterPanel, type KnowledgeCenterPanelProps } from './KnowledgeCenterPanel.js';

describe('KnowledgeCenterPanel', () => {
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
    window.localStorage.clear();
  });

  function seedRecent(path: string): void {
    window.localStorage.setItem('piwin.doccards.recent_folders', JSON.stringify([path]));
  }

  it('does not auto-select the current git project', async () => {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel
            projectPath="/Users/test/piwin"
            request={vi.fn(async () => ({ success: true, data: {} })) as any}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="hero-pick-folder-btn"]')).not.toBeNull();
    expect(container.textContent).toContain('从文件夹学习');
    expect(container.querySelector('[data-testid="tab-wiki-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="tab-cards-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="use-current-project-btn"]')).not.toBeNull();
  });

  it('selects a recent document folder instead of projectPath', async () => {
    seedRecent('/notes/os');
    const request = vi.fn(async (cmd: { type: string; folderPath?: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return {
          success: true,
          data: { files: [{ relativePath: 'a.md', sizeBytes: 10, language: 'markdown' }], unsupported: [] },
        };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return {
          success: true,
          data: {
            job: { status: 'COMPLETED', completedFiles: 1, totalFiles: 1, warnings: [] },
            documents: [{ status: 'READY', relativePath: 'a.md' }],
          },
        };
      }
      return { success: true, data: {} };
    });
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel projectPath="/Users/test/piwin" request={request as any} />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('os');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'doccards/scan-folder', folderPath: '/notes/os' }));
    expect(request.mock.calls.some((call) => call[0]?.folderPath === '/Users/test/piwin')).toBe(false);
  });

  it('renders master-detail layout with a recent folder', async () => {
    seedRecent('/Users/test/piwin');
    const mockRequest = vi.fn().mockImplementation((cmd) => {
      if (cmd.type === 'doccards/scan-folder') {
        return Promise.resolve({
          success: true,
          data: {
            files: [{ relativePath: 'README.md', sizeBytes: 500, language: 'markdown' }],
            unsupported: [],
          },
        });
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return Promise.resolve({
          success: true,
          data: {
            records: [
              {
                id: 'card-1',
                front: 'Core concept',
                back: 'Core explanation',
                deck: 'piwin',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        });
      }
      if (cmd.type === 'config/get') {
        return Promise.resolve({
          success: true,
          data: {
            notes: {
              embedding: {
                provider: 'openai-compatible',
                baseUrl: 'https://example.test/v1',
                model: 'text-embedding-3-small',
              },
            },
          },
        });
      }
      if (cmd.type === 'doccards/index-status') {
        return Promise.resolve({
          success: true,
          data: {
            job: { status: 'COMPLETED', completedFiles: 1, totalFiles: 1, warnings: [] },
            documents: [{ status: 'READY', relativePath: 'README.md' }],
          },
        });
      }
      if (cmd.type === 'notes/list') {
        return Promise.resolve({
          success: true,
          data: {
            records: [
              {
                id: 'note-1',
                title: 'Architecture Overview',
                content: 'System architecture content.',
                collection: 'piwin',
                relativePath: 'arch.md',
                contentHash: 'hash123',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        });
      }
      return Promise.resolve({ success: true, data: {} });
    });

    const onConfigureEmbedding = vi.fn();
    const props: KnowledgeCenterPanelProps = {
      projectPath: '/Users/test/piwin',
      recentProjects: [{ path: '/Users/test/pi', name: 'pi' }],
      request: mockRequest,
      onConfigureEmbedding,
    };

    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel {...props} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="knowledge-center-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-project-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="generate-cards-btn"]')).not.toBeNull();
    const configBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-config-btn"]',
    );
    expect(configBtn).not.toBeNull();
    await act(async () => {
      configBtn?.click();
    });
    expect(onConfigureEmbedding).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="tab-wiki-btn"]')).toBeNull();
    const searchBtn = container.querySelector<HTMLButtonElement>('[data-testid="open-folder-search-btn"]');
    expect(searchBtn).not.toBeNull();
    await act(async () => {
      searchBtn?.click();
    });
    expect(container.querySelector('[data-testid="knowledge-search-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain('这个文件夹还没有检索结果。');
  });

  it('opens the review session only after the user clicks the result button', async () => {
    const onOpenSession = vi.fn();
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return {
          success: true,
          data: { files: [{ relativePath: 'a.md', sizeBytes: 10, language: 'markdown' }], unsupported: [] },
        };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return {
          success: true,
          data: {
            job: { status: 'COMPLETED', completedFiles: 1, totalFiles: 1, warnings: [] },
            documents: [{ status: 'READY', relativePath: 'a.md' }],
          },
        };
      }
      if (cmd.type === 'doccards/generate') {
        return { success: true, data: { generationId: 'gen_1', status: 'RUNNING' } };
      }
      if (cmd.type === 'doccards/generation-status') {
        if (!request.mock.calls.some((call) => call[0]?.type === 'doccards/generate')) {
          return { success: true, data: { job: null } };
        }
        return {
          success: true,
          data: {
            job: {
              id: 'gen_1',
              status: 'COMPLETED',
              created: 2,
              createdCardIds: ['c1', 'c2'],
              sessionId: 'session-review',
            },
          },
        };
      }
      return { success: true, data: {} };
    });
    seedRecent('/docs');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel
            projectPath="/docs"
            request={request as any}
            onOpenSession={onOpenSession}
          />
        </PiwinUiProvider>,
      );
    });
    const generate = container.querySelector<HTMLButtonElement>('[data-testid="generate-cards-btn"]');
    expect(generate).not.toBeNull();
    await act(async () => {
      generate?.click();
    });
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="knowledge-result-view"]')).not.toBeNull();
    const open = container.querySelector<HTMLButtonElement>('[data-testid="open-review-session-btn"]');
    expect(open).not.toBeNull();
    await act(async () => {
      open?.click();
    });
    expect(onOpenSession).toHaveBeenCalledWith('session-review');
    const browse = container.querySelector<HTMLButtonElement>('[data-testid="browse-library-btn"]');
    expect(browse).not.toBeNull();
    await act(async () => {
      browse?.click();
    });
    expect(container.querySelector('[data-testid="knowledge-library-view"]')).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="library-back-btn"]')?.click();
    });
    expect(container.querySelector('[data-testid="knowledge-result-view"]')).not.toBeNull();
  });

  it('treats created=0 as status, not an action error', async () => {
    const onOpenSession = vi.fn();
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return {
          success: true,
          data: { files: [{ relativePath: 'a.md', sizeBytes: 10, language: 'markdown' }], unsupported: [] },
        };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return {
          success: true,
          data: {
            job: { status: 'COMPLETED', completedFiles: 1, totalFiles: 1, warnings: [] },
            documents: [{ status: 'READY', relativePath: 'a.md' }],
          },
        };
      }
      if (cmd.type === 'doccards/generate') {
        return { success: true, data: { generationId: 'gen_0', status: 'RUNNING' } };
      }
      if (cmd.type === 'doccards/generation-status') {
        if (!request.mock.calls.some((call) => call[0]?.type === 'doccards/generate')) {
          return { success: true, data: { job: null } };
        }
        return {
          success: true,
          data: { job: { id: 'gen_0', status: 'COMPLETED', created: 0, createdCardIds: [] } },
        };
      }
      return { success: true, data: {} };
    });
    seedRecent('/docs');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel
            projectPath="/docs"
            request={request as any}
            onOpenSession={onOpenSession}
          />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="generate-cards-btn"]')?.click();
    });
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="knowledge-action-error"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('keeps the overlay open on COMPLETED_DEGRADED without auto-opening a session', async () => {
    const onOpenSession = vi.fn();
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return {
          success: true,
          data: { files: [{ relativePath: 'a.md', sizeBytes: 10, language: 'markdown' }], unsupported: [] },
        };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return {
          success: true,
          data: {
            job: { status: 'COMPLETED', completedFiles: 1, totalFiles: 1, warnings: [] },
            documents: [{ status: 'READY', relativePath: 'a.md' }],
          },
        };
      }
      if (cmd.type === 'doccards/generate') {
        return { success: true, data: { generationId: 'gen_d', status: 'RUNNING' } };
      }
      if (cmd.type === 'doccards/generation-status') {
        if (!request.mock.calls.some((call) => call[0]?.type === 'doccards/generate')) {
          return { success: true, data: { job: null } };
        }
        return {
          success: true,
          data: {
            job: {
              id: 'gen_d',
              status: 'COMPLETED_DEGRADED',
              created: 2,
              createdCardIds: ['c1', 'c2'],
            },
          },
        };
      }
      return { success: true, data: {} };
    });
    seedRecent('/docs');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel
            projectPath="/docs"
            request={request as any}
            onOpenSession={onOpenSession}
          />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="generate-cards-btn"]')?.click();
    });
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="knowledge-center-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-result-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="open-review-session-btn"]')).toBeNull();
  });

  it('restores a terminal generation job as the result page on mount', async () => {
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return {
          success: true,
          data: { files: [{ relativePath: 'a.md', sizeBytes: 10, language: 'markdown' }], unsupported: [] },
        };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return {
          success: true,
          data: {
            job: { status: 'COMPLETED', completedFiles: 1, totalFiles: 1, warnings: [] },
            documents: [{ status: 'READY', relativePath: 'a.md' }],
          },
        };
      }
      if (cmd.type === 'doccards/generation-status') {
        return {
          success: true,
          data: {
            job: {
              id: 'gen_restored',
              status: 'COMPLETED',
              created: 2,
              createdCardIds: ['c1', 'c2'],
              sessionId: 'session-restored',
            },
          },
        };
      }
      return { success: true, data: {} };
    });
    seedRecent('/docs');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel projectPath="/docs" request={request as any} />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="knowledge-result-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="generate-cards-btn"]')).toBeNull();
  });

  it('keeps unchecked files unchecked after a rescan', async () => {
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return {
          success: true,
          data: {
            files: [
              { relativePath: 'a.md', sizeBytes: 10, language: 'markdown' },
              { relativePath: 'b.md', sizeBytes: 10, language: 'markdown' },
            ],
            unsupported: [],
          },
        };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return { success: true, data: { job: null, documents: [] } };
      }
      return { success: true, data: {} };
    });
    seedRecent('/docs');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel projectPath="/docs" request={request as any} />
        </PiwinUiProvider>,
      );
    });
    const b = container.querySelector<HTMLInputElement>('input[data-path="b.md"]');
    expect(b?.checked).toBe(true);
    await act(async () => {
      b?.click();
    });
    expect(container.querySelector<HTMLInputElement>('input[data-path="b.md"]')?.checked).toBe(false);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rescan-btn"]')?.click();
    });
    expect(container.querySelector<HTMLInputElement>('input[data-path="b.md"]')?.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[data-path="a.md"]')?.checked).toBe(true);
  });

  it('unsticks partial index by selecting READY files and showing ready sidebar status', async () => {
    const files = Array.from({ length: 3 }, (_, index) => ({
      relativePath: `f${index}.md`,
      sizeBytes: 10,
      language: 'markdown',
    }));
    const request = vi.fn(async (cmd: { type: string }) => {
      if (cmd.type === 'doccards/scan-folder') {
        return { success: true, data: { files, unsupported: [] } };
      }
      if (cmd.type === 'doccards/list-by-folder') {
        return { success: true, data: { records: [] } };
      }
      if (cmd.type === 'doccards/index-status') {
        return {
          success: true,
          data: {
            job: {
              status: 'COMPLETED',
              completedFiles: 2,
              totalFiles: 2,
              warnings: [{ file: '', code: 'INDEX_WARNING', message: 'Reached max files (2); stopping.' }],
            },
            documents: [
              { status: 'READY', relativePath: 'f0.md' },
              { status: 'READY', relativePath: 'f1.md' },
            ],
          },
        };
      }
      return { success: true, data: {} };
    });
    seedRecent('/docs/partial');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel projectPath="/docs" request={request as any} />
        </PiwinUiProvider>,
      );
    });
    // Ready stage (selected ⊆ READY) — checklist is hidden; generate is primary.
    expect(container.querySelector('[data-testid="generate-cards-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-file-checklist"]')).toBeNull();
    expect(container.textContent).toContain('2 个文件');
    expect(container.textContent).not.toContain('未索引');
    expect(container.querySelector('[data-testid="knowledge-action-error"]')?.textContent).toContain(
      'Reached max files (2)',
    );
  });

  it('asks for a folder when none is selected', async () => {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel projectPath={null} request={vi.fn(async () => ({ success: true, data: {} })) as any} />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="hero-pick-folder-btn"]')).not.toBeNull();
    expect(container.textContent).toContain('从文件夹学习');
  });

  it('shows a single compact prompt pill when embedding is unconfigured', async () => {
    const onConfigureEmbedding = vi.fn();
    const mockReq = vi.fn((cmd: { type: string }) => {
      if (cmd.type === 'config/get') {
        return Promise.resolve({
          success: true,
          data: {
            knowledge: {
              embedding: { enabled: false },
            },
          },
        });
      }
      if (cmd.type === 'doccards/scan-folder') {
        return Promise.resolve({
          success: true,
          data: { files: [{ relativePath: 'README.md', sizeBytes: 100, language: 'markdown' }], unsupported: [] },
        });
      }
      return Promise.resolve({ success: true, data: {} });
    });

    seedRecent('/Users/test/piwin');
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel
            projectPath="/Users/test/piwin"
            request={mockReq as any}
            onConfigureEmbedding={onConfigureEmbedding}
          />
        </PiwinUiProvider>,
      );
    });

    const promptPill = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-config-prompt-pill"]',
    );
    expect(promptPill).not.toBeNull();
    expect(promptPill?.textContent).toContain('未配置向量模型');
    await act(async () => {
      promptPill?.click();
    });
    expect(onConfigureEmbedding).toHaveBeenCalledTimes(1);
  });

  it('renders top-left back button and closes on click and on Escape, with no top-right close cross', async () => {
    const onClose = vi.fn();
    seedRecent('/Users/test/piwin');
    const mockReq = vi.fn(async () => ({ success: true, data: {} }));

    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCenterPanel
            projectPath="/Users/test/piwin"
            request={mockReq as any}
            onClose={onClose}
          />
        </PiwinUiProvider>,
      );
    });

    // Top-left back button exists
    const backBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-back-button"]',
    );
    expect(backBtn).not.toBeNull();
    expect(backBtn?.textContent).toContain('返回工作区');

    // Titlebar drag region exists
    expect(container.querySelector('[data-testid="knowledge-titlebar-drag"]')).not.toBeNull();

    // Top-right close cross button is removed
    expect(container.querySelector('[data-testid="knowledge-stage-close-btn"]')).toBeNull();

    // Click back button
    await act(async () => {
      backBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Press Escape
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

