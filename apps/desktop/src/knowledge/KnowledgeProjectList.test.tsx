// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeProjectList, type KnowledgeProjectListProps } from './KnowledgeProjectList.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('KnowledgeProjectList', () => {
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

  it('renders active project and recent projects', () => {
    const onSelect = vi.fn();
    const props: KnowledgeProjectListProps = {
      activeProjectPath: '/Users/test/piwin',
      recentProjects: [{ path: '/Users/test/pi', name: 'pi' }],
      mountedFolders: [],
      selectedPath: '/Users/test/piwin',
      projectStats: {
        '/Users/test/piwin': { status: 'ready', sliceCount: 12, cardCount: 8 },
      },
      onSelectProject: onSelect,
      onMountFolder: vi.fn(),
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeProjectList {...props} />
        </PiwinUiProvider>,
      );
    });

    const piwinBtn = container.querySelector<HTMLButtonElement>('[data-testid="project-item-piwin"]');
    const piBtn = container.querySelector<HTMLButtonElement>('[data-testid="project-item-pi"]');
    expect(piwinBtn).not.toBeNull();
    expect(piBtn).not.toBeNull();
    expect(container.textContent).toContain('12 切片 · 8 闪卡');

    act(() => {
      piBtn?.click();
    });
    expect(onSelect).toHaveBeenCalledWith('/Users/test/pi');
    expect(container.querySelector('[data-testid="configure-embedding-btn"]')).toBeNull();
  });

  it('shows the embedding settings control when provided', () => {
    const onConfigure = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeProjectList
            activeProjectPath="/Users/test/piwin"
            recentProjects={[]}
            mountedFolders={[]}
            selectedPath="/Users/test/piwin"
            onSelectProject={vi.fn()}
            onMountFolder={vi.fn()}
            onConfigureEmbedding={onConfigure}
          />
        </PiwinUiProvider>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-embedding-btn"]',
    );
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });
});
