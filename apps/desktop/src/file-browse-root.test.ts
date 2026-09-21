import { describe, expect, it } from 'vitest';
import {
  isNoRepoProjectPath,
  resolveFileBrowseRoot,
  resolveNoRepoSendPath,
  sameHostPath,
} from './file-browse-root.js';

describe('resolveFileBrowseRoot', () => {
  it('prefers the opened project over the General workspace', () => {
    expect(
      resolveFileBrowseRoot({
        projectPath: '/Users/me/app',
        generalWorkspacePath: '/Users/me/.piwin/workspace',
      }),
    ).toBe('/Users/me/app');
  });

  it('falls back to the General workspace when Chat has no project', () => {
    expect(
      resolveFileBrowseRoot({
        projectPath: null,
        generalWorkspacePath: '/Users/me/.piwin/workspace',
      }),
    ).toBe('/Users/me/.piwin/workspace');
  });

  it('returns null when neither root is known', () => {
    expect(resolveFileBrowseRoot({ projectPath: '  ', generalWorkspacePath: '' })).toBeNull();
  });
});

describe('sameHostPath', () => {
  it('treats a trailing slash as the same root', () => {
    expect(sameHostPath('/Users/me/.piwin/workspace', '/Users/me/.piwin/workspace/')).toBe(true);
  });

  it('rejects empty or unrelated paths', () => {
    expect(sameHostPath('', '/Users/me/.piwin/workspace')).toBe(false);
    expect(sameHostPath('/Users/me/app', '/Users/me/.piwin/workspace')).toBe(false);
  });
});

describe('isNoRepoProjectPath', () => {
  it('matches Host generalWorkspacePath', () => {
    expect(
      isNoRepoProjectPath('/Users/me/.piwin/workspace/', '/Users/me/.piwin/workspace'),
    ).toBe(true);
  });

  it('matches the default product workspace without hello', () => {
    expect(isNoRepoProjectPath('/Users/me/.piwin/workspace')).toBe(true);
    expect(isNoRepoProjectPath('C:\\Users\\me\\.piwin\\workspace')).toBe(true);
  });

  it('rejects a real repository path', () => {
    expect(isNoRepoProjectPath('/Users/me/Developer/piwin')).toBe(false);
    expect(isNoRepoProjectPath('/Users/me/.piwin/workspace-copy')).toBe(false);
  });
});

describe('resolveNoRepoSendPath', () => {
  const workspace = '/Users/me/.piwin/workspace';

  it('prefers a No Repo draft path', () => {
    expect(
      resolveNoRepoSendPath({
        draftScope: { kind: 'project', projectPath: workspace },
        projectPath: '/Users/me/app',
        generalWorkspacePath: workspace,
      }),
    ).toBe(workspace);
  });

  it('uses the active project when the draft is still General', () => {
    expect(
      resolveNoRepoSendPath({
        draftScope: { kind: 'general' },
        projectPath: workspace,
      }),
    ).toBe(workspace);
  });

  it('falls back to Host hello', () => {
    expect(
      resolveNoRepoSendPath({
        draftScope: { kind: 'general' },
        projectPath: null,
        generalWorkspacePath: workspace,
      }),
    ).toBe(workspace);
  });

  it('is null for a real repository draft', () => {
    expect(
      resolveNoRepoSendPath({
        draftScope: { kind: 'project', projectPath: '/Users/me/app' },
        projectPath: '/Users/me/app',
      }),
    ).toBeNull();
  });
});
