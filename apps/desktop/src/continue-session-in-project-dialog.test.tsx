// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ProjectRecord } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ContinueSessionInProjectDialog } from './continue-session-in-project-dialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createProject(path: string, displayName: string): ProjectRecord {
  const now = new Date().toISOString();
  return {
    path,
    displayName,
    trust: 'trusted',
    lastOpenedAt: now,
    createdAt: now,
  };
}

describe('ContinueSessionInProjectDialog', () => {
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

  function render(props: {
    sessionName?: string | null;
    busy?: boolean;
    trustedProjects?: readonly ProjectRecord[];
    onSelectTarget?: (scope: unknown) => void;
    onCancel?: () => void;
  }): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ContinueSessionInProjectDialog
            sessionName={props.sessionName === undefined ? 'Notes' : props.sessionName}
            busy={props.busy ?? false}
            trustedProjects={props.trustedProjects ?? []}
            locale="en"
            onOpenChange={vi.fn()}
            onSelectTarget={props.onSelectTarget ?? vi.fn()}
            onCancel={props.onCancel ?? vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('offers No Repo alongside trusted projects and reports the chosen scope', () => {
    const onSelectTarget = vi.fn();
    render({
      trustedProjects: [createProject('/Users/test/piwin', 'piwin')],
      onSelectTarget,
    });

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="continue-session-no-repo-option"]')
        ?.click();
    });
    expect(onSelectTarget).toHaveBeenCalledWith({ kind: 'general' });

    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="continue-session-project-option"]')
        ?.click();
    });
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      kind: 'project',
      projectPath: '/Users/test/piwin',
    });
  });

  it('keeps No Repo available when no project is trusted yet', () => {
    const onSelectTarget = vi.fn();
    render({ onSelectTarget });

    expect(document.body.textContent).toContain('No trusted projects yet');
    const noRepo = document.querySelector<HTMLButtonElement>(
      '[data-testid="continue-session-no-repo-option"]',
    );
    expect(noRepo?.disabled).toBe(false);

    act(() => noRepo?.click());
    expect(onSelectTarget).toHaveBeenCalledWith({ kind: 'general' });
  });

  it('disables every destination while the copy is in flight', () => {
    render({
      busy: true,
      trustedProjects: [createProject('/Users/test/piwin', 'piwin')],
    });

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="continue-session-no-repo-option"]')
        ?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="continue-session-project-option"]')
        ?.disabled,
    ).toBe(true);
  });
});
