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
  });

  it('renders master-detail layout with selected project', async () => {
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
    expect(container.textContent).toContain('Core concept');
    const configBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-config-btn"]',
    );
    expect(configBtn).not.toBeNull();
    await act(async () => {
      configBtn?.click();
    });
    expect(onConfigureEmbedding).toHaveBeenCalledTimes(1);

    // Switch to Wiki view
    const wikiBtn = container.querySelector<HTMLButtonElement>('[data-testid="tab-wiki-btn"]');
    expect(wikiBtn).not.toBeNull();
    await act(async () => {
      wikiBtn?.click();
    });
    expect(container.textContent).toContain('Architecture Overview');
  });

  it('opens the review session after generate completes', async () => {
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
        return {
          success: true,
          data: {
            job: {
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
    expect(onOpenSession).toHaveBeenCalledWith('session-review');
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
    expect(container.textContent).toContain('先选一个文档文件夹');
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
});
