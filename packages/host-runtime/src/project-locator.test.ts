import { describe, expect, it } from 'vitest';
import { bindProjectLocator } from './project-locator.js';
import { createRemoteProjectId } from './remote-project-id.js';

describe('bindProjectLocator', () => {
  it('resolves a Host-issued projectId to the registered path', () => {
    const path = '/home/host/work/app';
    const bound = bindProjectLocator(createRemoteProjectId(path), [{ path }]);
    expect(bound).toEqual({ ok: true, path });
  });

  it('passes filesystem paths through', () => {
    expect(bindProjectLocator('/home/host/work/app', [{ path: '/home/host/work/app' }])).toEqual({
      ok: true,
      path: '/home/host/work/app',
    });
  });

  it('rejects an unknown projectId', () => {
    expect(bindProjectLocator('project-aaaaaaaaaaaaaaaaaaaaaaaa', [{ path: '/tmp/a' }])).toEqual({
      ok: false,
      error: 'unknown-project',
    });
  });
  it('resolves the advertised No Repo workspace id even when it is not registered', () => {
    const workspace = '/Users/me/.piwin/workspace';
    const id = createRemoteProjectId(workspace);
    expect(bindProjectLocator(id, [], { generalWorkspacePath: workspace })).toEqual({
      ok: true,
      path: workspace,
    });
    // Without the workspace hint the id stays unknown (old behaviour, the bug).
    expect(bindProjectLocator(id, [])).toEqual({ ok: false, error: 'unknown-project' });
  });
});
