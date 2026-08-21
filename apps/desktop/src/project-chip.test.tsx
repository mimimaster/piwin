// @vitest-environment happy-dom
import type { ProjectRecord } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { ProjectChip } from './project-chip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projects: ProjectRecord[] = [
  {
    path: '/Users/test/piwin',
    displayName: 'piwin',
    trust: 'trusted',
    createdAt: '2026-08-08T00:00:00.000Z',
    lastOpenedAt: '2026-08-09T00:00:00.000Z',
  },
  {
    path: '/Users/test/openwebui',
    displayName: 'openwebui',
    trust: 'trusted',
    createdAt: '2026-08-07T00:00:00.000Z',
    lastOpenedAt: '2026-08-08T00:00:00.000Z',
  },
];

function renderChip(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

describe('ProjectChip', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('opens an anchored recent-project menu and marks the active project', () => {
    const rendered = renderChip(
      <ProjectChip
        projectPath={projects[0]?.path ?? ''}
        recentProjects={projects}
        onOpenProject={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-project-chip"]',
    );
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
      );
    });

    const menu = document.querySelector('[data-testid="composer-project-menu"]');
    expect(menu).not.toBeNull();
    expect(document.querySelectorAll('[data-testid^="composer-project-item-"]')).toHaveLength(2);
    expect(
      document.querySelector('[data-project-path="/Users/test/piwin"] .project-picker-menu-check'),
    ).not.toBeNull();
    expect(document.querySelector('[data-testid="workspace-path-dialog"]')).toBeNull();
  });

  it('switches immediately when a recent project is selected', () => {
    const onOpenProject = vi.fn();
    const rendered = renderChip(
      <ProjectChip
        projectPath={projects[0]?.path ?? ''}
        recentProjects={projects}
        onOpenProject={onOpenProject}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-project-chip"]',
    );
    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
      );
    });

    const target = document.querySelector<HTMLElement>('[data-testid="composer-project-item-1"]');
    act(() => target?.click());

    expect(onOpenProject).toHaveBeenCalledOnce();
    expect(onOpenProject).toHaveBeenCalledWith('/Users/test/openwebui');
  });

  it('shows Host displayName on the chip when path is an opaque remote id', () => {
    const remoteId = 'project-3f3cd6fe3b1082e864080402';
    const rendered = renderChip(
      <ProjectChip
        projectPath={remoteId}
        recentProjects={[
          {
            path: remoteId,
            displayName: 'piwin',
            trust: 'trusted',
            createdAt: '2026-08-08T00:00:00.000Z',
            lastOpenedAt: '2026-08-09T00:00:00.000Z',
          },
        ]}
        onOpenProject={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector('[data-testid="composer-project-chip"]');
    expect(trigger?.textContent).toContain('piwin');
    expect(trigger?.textContent).not.toContain(remoteId);
    expect(trigger?.getAttribute('title')).toBe(remoteId);
  });
});
