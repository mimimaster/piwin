import { describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import {
  absolutePathForProjectMatch,
  basenameOfPath,
  projectRelativeAliasForPath,
  projectSearchQueryForPath,
  resolveProjectAbsolutePath,
  resolveProjectFilePath,
} from './resolve-project-file';

function findResponse(matches: Array<{ relativePath: string }>, truncated = false): HostResponse {
  return {
    type: 'response',
    command: 'project/find-file',
    success: true,
    data: { projectPath: '/workspace', query: 'x', matches, truncated },
  } as unknown as HostResponse;
}

describe('projectSearchQueryForPath', () => {
  it('uses the project-relative form for a path inside the root', () => {
    expect(projectSearchQueryForPath('/workspace/docs/design/shot.png', '/workspace')).toBe(
      'docs/design/shot.png',
    );
  });

  it('falls back to the base name when the message used a symlink alias', () => {
    expect(projectSearchQueryForPath('/Users/me/real/shot.png', '/Volumes/alias/project')).toBe(
      'shot.png',
    );
  });

  it('returns null when the path is the root itself', () => {
    expect(projectSearchQueryForPath('/workspace', '/workspace')).toBeNull();
    expect(projectSearchQueryForPath('   ')).toBeNull();
  });
});

describe('absolutePathForProjectMatch', () => {
  it('joins without doubling or losing separators', () => {
    expect(absolutePathForProjectMatch('/workspace/', '/a/b.png')).toBe('/workspace/a/b.png');
    expect(absolutePathForProjectMatch('/workspace', 'a\\b.png')).toBe('/workspace/a/b.png');
  });
});

describe('projectRelativeAliasForPath', () => {
  it('maps a /tmp form of a /private/tmp root onto the workspace', () => {
    expect(
      projectRelativeAliasForPath(
        '/tmp/piwin-plan-ui-accept/PATH-RETEST.md',
        '/private/tmp/piwin-plan-ui-accept',
      ),
    ).toBe('PATH-RETEST.md');
    expect(
      projectRelativeAliasForPath(
        '/tmp/piwin-plan-ui-accept/docs/design/shot.png',
        '/private/tmp/piwin-plan-ui-accept',
      ),
    ).toBe('docs/design/shot.png');
  });

  it('maps a symlinked checkout onto the workspace root', () => {
    expect(
      projectRelativeAliasForPath('/Users/me/alias/piwin/src/a.ts', '/Volumes/Big/Dev/piwin'),
    ).toBe('src/a.ts');
  });

  it('keeps the canonical form working and rejects unrelated paths', () => {
    expect(projectRelativeAliasForPath('/w/docs/a.md', '/w')).toBe('docs/a.md');
    // Same file name, different folder: never force-mapped onto the project.
    expect(projectRelativeAliasForPath('/tmp/other/shot.png', '/w')).toBeNull();
    expect(projectRelativeAliasForPath('/tmp/workspace', '/w')).toBeNull();
    expect(projectRelativeAliasForPath('', '/w')).toBeNull();
  });

  it('takes the last matching segment so nested copies stay predictable', () => {
    expect(
      projectRelativeAliasForPath('/tmp/w/x/w/a.md', '/w'),
    ).toBe('a.md');
  });
});

describe('basenameOfPath', () => {
  it('returns the trailing segment without separators', () => {
    expect(basenameOfPath('/tmp/a/b.md')).toBe('b.md');
    expect(basenameOfPath('/tmp/a/b/')).toBe('b');
    expect(basenameOfPath('plain.md')).toBe('plain.md');
  });
});

describe('resolveProjectFilePath', () => {
  it('resolves a single match from a complete walk', async () => {
    const request = vi.fn(async () => findResponse([{ relativePath: 'docs/shot.png' }]));
    await expect(
      resolveProjectFilePath({ request, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({ kind: 'unique', relativePath: 'docs/shot.png' });
  });

  it('stays ambiguous for several matches', async () => {
    const request = vi.fn(async () =>
      findResponse([{ relativePath: 'a/shot.png' }, { relativePath: 'b/shot.png' }]),
    );
    await expect(
      resolveProjectFilePath({ request, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({
      kind: 'ambiguous',
      relativePaths: ['a/shot.png', 'b/shot.png'],
    });
  });

  it('resolves nothing when the walk was cut short with one match', async () => {
    const request = vi.fn(async () => findResponse([{ relativePath: 'a/shot.png' }], true));
    await expect(
      resolveProjectFilePath({ request, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({ kind: 'none' });
  });

  it('reports a vanished workspace instead of no match', async () => {
    const request = vi.fn(
      async () =>
        ({
          type: 'response',
          command: 'project/find-file',
          success: false,
          error: 'project-root-missing',
        }) as unknown as HostResponse,
    );
    await expect(
      resolveProjectFilePath({ request, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({ kind: 'missing-root' });
  });

  it('reports none on a failed or empty answer', async () => {
    const failed = vi.fn(
      async () =>
        ({
          type: 'response',
          command: 'project/find-file',
          success: false,
          error: 'nope',
        }) as unknown as HostResponse,
    );
    await expect(
      resolveProjectFilePath({ request: failed, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({ kind: 'none' });

    const empty = vi.fn(async () => findResponse([]));
    await expect(
      resolveProjectFilePath({ request: empty, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({ kind: 'none' });
  });

  it('throws nothing when the transport itself rejects', async () => {
    const request = vi.fn(async () => {
      throw new Error('host gone');
    });
    await expect(
      resolveProjectFilePath({ request, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toEqual({ kind: 'none' });
  });

  it('does not ask the Host for an empty query', async () => {
    const request = vi.fn(async () => findResponse([]));
    await expect(
      resolveProjectFilePath({ request, projectPath: '/workspace', query: '   ' }),
    ).resolves.toEqual({ kind: 'none' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('resolveProjectAbsolutePath', () => {
  it('returns the absolute path of the single match', async () => {
    const request = vi.fn(async () => findResponse([{ relativePath: 'docs/shot.png' }]));
    await expect(
      resolveProjectAbsolutePath({ request, projectPath: '/workspace/', query: 'shot.png' }),
    ).resolves.toBe('/workspace/docs/shot.png');
  });

  it('returns null when the match is not unique', async () => {
    const request = vi.fn(async () =>
      findResponse([{ relativePath: 'a/shot.png' }, { relativePath: 'b/shot.png' }]),
    );
    await expect(
      resolveProjectAbsolutePath({ request, projectPath: '/workspace', query: 'shot.png' }),
    ).resolves.toBeNull();
  });
});
