// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeUnindexedHero, type KnowledgeUnindexedHeroProps } from './KnowledgeUnindexedHero.js';

describe('KnowledgeUnindexedHero', () => {
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

  it('renders scan statistics and triggers build knowledge base', () => {
    const onStart = vi.fn();
    const props: KnowledgeUnindexedHeroProps = {
      folderPath: '/Users/test/piwin',
      folderName: 'piwin',
      scannedFiles: [
        { relativePath: 'README.md', sizeBytes: 1024, language: 'markdown' },
      ],
      unsupportedFiles: [],
      indexingJob: null,
      busy: false,
      onStartIndexing: onStart,
      onRescan: vi.fn(),
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeUnindexedHero {...props} />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('入库这些文件');
    expect(container.textContent).not.toContain('构建知识库');
    expect(container.textContent).toContain('1.0 KB');

    const startBtn = container.querySelector<HTMLButtonElement>('[data-testid="start-indexing-btn"]');
    expect(startBtn).not.toBeNull();
    act(() => {
      startBtn?.click();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="hero-configure-embedding-btn"]')).toBeNull();
  });

  it('shows the embedding settings button when the callback is provided', () => {
    const onConfigure = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeUnindexedHero
            folderPath="/docs"
            folderName="docs"
            scannedFiles={[{ relativePath: 'a.md', sizeBytes: 10, language: 'markdown' }]}
            unsupportedFiles={[]}
            indexingJob={null}
            busy={false}
            onStartIndexing={vi.fn()}
            onRescan={vi.fn()}
            onConfigureEmbedding={onConfigure}
          />
        </PiwinUiProvider>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="hero-configure-embedding-btn"]',
    );
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it('shows choose-folder first when empty', () => {
    const onPick = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeUnindexedHero
            folderPath=""
            folderName=""
            scannedFiles={[]}
            unsupportedFiles={[]}
            indexingJob={null}
            busy={false}
            empty
            onStartIndexing={vi.fn()}
            onRescan={vi.fn()}
            onPickFolder={onPick}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('从文件夹学习');
    const button = container.querySelector<HTMLButtonElement>('[data-testid="hero-pick-folder-btn"]');
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
