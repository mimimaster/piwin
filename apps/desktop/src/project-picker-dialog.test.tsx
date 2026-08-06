// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ProjectRecord } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ProjectPickerDialog } from './project-picker-dialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createProjects(): ProjectRecord[] {
  return [
    {
      path: '/Users/test/piwin',
      displayName: 'piwin',
      trust: 'trusted',
      lastOpenedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      path: '/Users/test/openwebui',
      displayName: 'openwebui',
      trust: 'trusted',
      lastOpenedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];
}

describe('ProjectPickerDialog', () => {
  let container: HTMLDivElement;
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

  it('filters projects by display name and path', () => {
    const projects = createProjects();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ProjectPickerDialog
            open
            onOpenChange={vi.fn()}
            projects={projects}
            activeProjectPath={projects[0]?.path ?? null}
            onOpenProject={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    expect(document.querySelectorAll('.project-picker-item')).toHaveLength(2);

    const searchInput = document.querySelector<HTMLInputElement>(
      '[data-testid="project-picker-search-input"]',
    );
    expect(searchInput).not.toBeNull();

    act(() => {
      if (searchInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(searchInput, 'openwebui');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    expect(document.querySelectorAll('.project-picker-item')).toHaveLength(1);
    expect(document.querySelector('.project-picker-item-name')?.textContent).toBe('openwebui');
  });
});
