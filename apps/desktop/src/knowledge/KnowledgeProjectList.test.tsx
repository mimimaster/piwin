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

  it('lists only document folders and uses file counts', () => {
    const onSelect = vi.fn();
    const props: KnowledgeProjectListProps = {
      folders: ['/notes/os'],
      selectedPath: '/notes/os',
      activeProjectPath: '/Users/test/piwin',
      projectStats: {
        '/notes/os': { status: 'ready', fileCount: 12, cardCount: 8 },
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

    expect(container.querySelector('[data-testid="project-item-os"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="project-item-piwin"]')).toBeNull();
    expect(container.textContent).toContain('12 个文件 · 8 闪卡');
    expect(container.textContent).not.toContain('切片');
    expect(container.querySelector('[data-testid="configure-embedding-btn"]')).toBeNull();
  });
});
