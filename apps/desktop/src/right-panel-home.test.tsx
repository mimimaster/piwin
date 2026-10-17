// @vitest-environment happy-dom
/**
 * Empty launcher: Environment block (Host, folder, branch), Changes first,
 * working-tree diff stat.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RightPanelHome, type RightPanelHomeProps } from './right-panel-home';
import {
  describeProjectFolder,
  type HomeGitSummary,
  type RightPanelHomeContext,
} from './right-panel-home-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderHome(props: Partial<RightPanelHomeProps>): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  const nextRoot = createRoot(host);
  root = nextRoot;
  await act(async () => {
    nextRoot.render(<RightPanelHome locale="en" onSelect={() => {}} {...props} />);
  });
  return host;
}

function contextWith(loadGit?: () => Promise<HomeGitSummary | null>): RightPanelHomeContext {
  return {
    host: { label: 'This Mac', remote: false },
    project: { name: 'piwin', parentPath: '~/Developer' },
    gitKey: '/Users/me/Developer/piwin',
    ...(loadGit ? { loadGit } : {}),
  };
}

function text(host: HTMLElement, testId: string): string | null | undefined {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('RightPanelHome', () => {
  it('lists Changes first', async () => {
    const host = await renderHome({});
    const first = host.querySelector('[data-testid^="right-panel-home-"]');
    expect(first?.getAttribute('data-testid')).toBe('right-panel-home-review');
  });

  it('shows Host, folder, branch and the diff stat while active', async () => {
    const load = vi.fn(
      async (): Promise<HomeGitSummary> => ({
        branch: 'main',
        changes: { additions: 2613, deletions: 1290 },
      }),
    );
    const host = await renderHome({ active: true, context: contextWith(load) });
    expect(text(host, 'right-panel-home-env-host')).toBe('This Mac');
    expect(text(host, 'right-panel-home-env-project')).toBe('piwin~/Developer');
    expect(text(host, 'right-panel-home-env-branch')).toBe('main');
    expect(text(host, 'right-panel-home-diffstat')).toBe('+2613−1290');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not ask git while the panel is closed', async () => {
    const load = vi.fn(async (): Promise<HomeGitSummary> => ({ branch: 'main', changes: null }));
    const host = await renderHome({ active: false, context: contextWith(load) });
    expect(load).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="right-panel-home-env-host"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="right-panel-home-env-branch"]')).toBeNull();
  });

  it('hides the stat for a clean tree', async () => {
    const host = await renderHome({
      active: true,
      context: contextWith(async () => ({
        branch: 'main',
        changes: { additions: 0, deletions: 0 },
      })),
    });
    expect(host.querySelector('[data-testid="right-panel-home-diffstat"]')).toBeNull();
  });
});

describe('describeProjectFolder', () => {
  it('splits the folder name and abbreviates the home directory', () => {
    expect(describeProjectFolder('/Users/me/Developer/piwin/')).toEqual({
      name: 'piwin',
      parentPath: '~/Developer',
    });
    expect(describeProjectFolder('/home/me/app')).toEqual({ name: 'app', parentPath: '~' });
    expect(describeProjectFolder('C:\\Users\\me\\code\\app')).toEqual({
      name: 'app',
      parentPath: '~\\code',
    });
    expect(describeProjectFolder('/srv/app')).toEqual({ name: 'app', parentPath: '/srv' });
  });

  it('returns null without a project', () => {
    expect(describeProjectFolder(null)).toBeNull();
    expect(describeProjectFolder('')).toBeNull();
  });
});
