import { describe, expect, it } from 'vitest';
import { resolveTuiLaunchScope } from './tui-launch-scope.js';

const projects = [{ projectId: 'project-1', path: '/work/app' }];
const canonicalPath = (path: string): string => path.replace(/\/$/, '');

describe('resolveTuiLaunchScope', () => {
  it('takes an explicit project id as given', () => {
    expect(
      resolveTuiLaunchScope({ projects, explicitProjectId: 'p', explicitPath: '/nowhere', cwd: '/', canonicalPath }),
    ).toEqual({ projectId: 'p' });
  });

  it('finds the registered project at the named directory', () => {
    expect(
      resolveTuiLaunchScope({
        projects,
        explicitProjectId: undefined,
        explicitPath: '/work/app/',
        cwd: '/',
        canonicalPath,
      }),
    ).toEqual({ projectId: 'project-1' });
  });

  it('uses the current directory quietly when nothing was named', () => {
    const input = { projects, explicitProjectId: undefined, explicitPath: undefined, canonicalPath };
    expect(resolveTuiLaunchScope({ ...input, cwd: '/work/app' })).toEqual({ projectId: 'project-1' });
    expect(resolveTuiLaunchScope({ ...input, cwd: '/elsewhere' })).toEqual({});
  });

  it('says so when a named directory is not a trusted project', () => {
    const scope = resolveTuiLaunchScope({
      projects,
      explicitProjectId: undefined,
      explicitPath: '/work/other',
      cwd: '/work/app',
      canonicalPath,
    });
    expect(scope.projectId).toBeUndefined();
    expect(scope.notice).toContain('「/work/other」还不是已信任的项目');
  });
});
