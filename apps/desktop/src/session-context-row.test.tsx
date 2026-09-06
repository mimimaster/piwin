// @vitest-environment happy-dom
import type { HostResponse, ProjectRecord } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SessionContextRow } from './session-context-row';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projects: ProjectRecord[] = [
  {
    path: '/Users/test/piwin',
    displayName: 'piwin',
    trust: 'trusted',
    createdAt: '2026-08-08T00:00:00.000Z',
    lastOpenedAt: '2026-08-09T00:00:00.000Z',
  },
];

function renderRow(node: ReactElement): { container: HTMLElement; root: Root } {
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

describe('SessionContextRow', () => {
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

  const mockRequest = vi.fn().mockResolvedValue({
    type: 'response',
    command: 'git/status',
    success: true,
    data: { branch: 'main', dirty: false },
  } as HostResponse);

  it('renders null when projectPath is null (general conversation)', () => {
    const rendered = renderRow(
      <SessionContextRow
        projectPath={null}
        recentProjects={projects}
        request={mockRequest}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('.session-context')).toBeNull();
    expect(container.querySelector('[data-testid="session-context-row"]')).toBeNull();
  });

  it('renders null when projectPath is whitespace', () => {
    const rendered = renderRow(
      <SessionContextRow
        projectPath="   "
        recentProjects={projects}
        request={mockRequest}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('.session-context')).toBeNull();
  });

  it('renders session context row for project sessions', async () => {
    let rendered!: { container: HTMLElement; root: Root };
    await act(async () => {
      rendered = renderRow(
        <SessionContextRow
          projectPath="/Users/test/piwin"
          recentProjects={projects}
          request={mockRequest}
        />,
      );
    });
    root = rendered.root;
    container = rendered.container;

    const row = container.querySelector('[data-testid="session-context-row"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('piwin');
    expect(row?.querySelector('.context-detail')).toBeNull();
    expect(row?.textContent).not.toContain('/Users/test/piwin');
  });
});
