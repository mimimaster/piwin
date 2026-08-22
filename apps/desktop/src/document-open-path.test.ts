import { describe, expect, it } from 'vitest';
import {
  buildDocumentUnavailableStub,
  isPathInsideProjectRoot,
  localPreviewPathForPlan,
  planDocumentOpenPath,
} from './document-open-path';
import { isPiwinMediaPath, isRemoteMediaAssetRef, mediaKindForPath } from './media-path';

describe('isPathInsideProjectRoot', () => {
  it('accepts the root and nested paths', () => {
    expect(isPathInsideProjectRoot('/workspace', '/workspace')).toBe(true);
    expect(isPathInsideProjectRoot('/workspace', '/workspace/docs/a.md')).toBe(true);
  });

  it('rejects sibling prefix collisions and outside paths', () => {
    expect(isPathInsideProjectRoot('/workspace', '/workspace-evil/a.md')).toBe(false);
    expect(isPathInsideProjectRoot('/workspace', '/tmp/outside.md')).toBe(false);
    expect(
      isPathInsideProjectRoot(
        '/workspace',
        '/Applications/piwinwin.app/Contents/Resources/host/skills/executing-plans/SKILL.md',
      ),
    ).toBe(false);
  });
});

describe('media reference helpers', () => {
  it('recognizes media vault paths but not arbitrary model strings', () => {
    expect(isPiwinMediaPath('/Users/t/.piwin/media/session-1/a.png')).toBe(true);
    expect(isPiwinMediaPath('/tmp/piwin-mock-media/s/b.jpg')).toBe(true);
    expect(isPiwinMediaPath('/etc/passwd')).toBe(false);
    expect(isPiwinMediaPath('docs/readme.md')).toBe(false);
  });

  it('recognizes opaque remote-asset refs only with a non-empty id', () => {
    expect(isRemoteMediaAssetRef('remote-asset:asset-42')).toBe(true);
    expect(isRemoteMediaAssetRef('remote-asset:')).toBe(false);
    expect(isRemoteMediaAssetRef('/Users/t/.piwin/media/s/a.png')).toBe(false);
  });

  it('hints render kind by extension only', () => {
    expect(mediaKindForPath('/x/a.b.jpg')).toBe('image');
    expect(mediaKindForPath('/x/a.mp4')).toBe('video');
    expect(mediaKindForPath('/x/a.md')).toBe(null);
  });
});

describe('planDocumentOpenPath', () => {
  it('plans project reads for in-project absolute paths', () => {
    expect(
      planDocumentOpenPath({
        path: '/workspace/docs/foo.md',
        projectPath: '/workspace',
      }),
    ).toEqual({
      kind: 'project',
      projectPath: '/workspace',
      relativePath: 'docs/foo.md',
      displayPath: '/workspace/docs/foo.md',
    });
  });

  it('plans project reads for project-relative paths', () => {
    expect(
      planDocumentOpenPath({
        path: 'docs/foo.md',
        projectPath: '/workspace',
      }),
    ).toEqual({
      kind: 'project',
      projectPath: '/workspace',
      relativePath: 'docs/foo.md',
      displayPath: 'docs/foo.md',
    });
  });

  it('does not forge projectPath from dirname of an outside absolute path', () => {
    const plan = planDocumentOpenPath({
      path: '/Applications/piwinwin.app/Contents/Resources/host/skills/executing-plans/SKILL.md',
      projectPath: '/workspace',
    });
    expect(plan.kind).toBe('skill-legacy');
    if (plan.kind === 'skill-legacy') {
      expect(plan.absolutePath).toContain('executing-plans');
      expect(plan.skillIdHint).toBe('executing-plans');
    }
    // Critical: never produce projectPath=/Applications/... or projectPath=/tmp
    expect(plan).not.toMatchObject({ kind: 'project' });
  });

  it('classifies /tmp/outside.md as legacy-absolute even with an active project', () => {
    const plan = planDocumentOpenPath({
      path: '/tmp/outside.md',
      projectPath: '/workspace',
    });
    expect(plan).toEqual({
      kind: 'legacy-absolute',
      absolutePath: '/tmp/outside.md',
      displayPath: '/tmp/outside.md',
    });
  });

  it('does not reclassify /tmp files as media; local preview helper returns the path', () => {
    const imagePlan = planDocumentOpenPath({
      path: '/tmp/ncg-boot2.png',
      projectPath: '/workspace',
    });
    expect(imagePlan.kind).toBe('legacy-absolute');
    expect(localPreviewPathForPlan(imagePlan)).toBe('/tmp/ncg-boot2.png');
    expect(
      localPreviewPathForPlan(
        planDocumentOpenPath({ path: '/tmp/outside.md', projectPath: '/workspace' }),
      ),
    ).toBe('/tmp/outside.md');
  });

  it('offers local preview for in-project paths without changing project classification', () => {
    const plan = planDocumentOpenPath({
      path: '/workspace/docs/shot.png',
      projectPath: '/workspace',
    });
    expect(plan.kind).toBe('project');
    expect(localPreviewPathForPlan(plan)).toBe('/workspace/docs/shot.png');
  });

  it('classifies config-root text as trusted-config after media and skill', () => {
    expect(
      planDocumentOpenPath({
        path: '/Users/t/.piwin/config.json',
        projectPath: '/workspace',
      }),
    ).toEqual({
      kind: 'trusted-config',
      relativePath: 'config.json',
      displayPath: '~/.piwin/config.json',
    });
    expect(
      planDocumentOpenPath({
        path: '/Users/t/.piwin/media/sess-1/a.png',
        projectPath: '/workspace',
      }).kind,
    ).toBe('media');
    expect(
      planDocumentOpenPath({
        path: '/Users/t/.piwin/skills/executing-plans/SKILL.md',
        projectPath: '/workspace',
      }).kind,
    ).toBe('skill-legacy');
  });

  it('classifies a custom config root via configRoot, not the /.piwin/ heuristic', () => {
    expect(
      planDocumentOpenPath({
        path: '/var/piwin-root/permissions.json',
        projectPath: '/workspace',
        configRoot: '/var/piwin-root',
      }),
    ).toEqual({
      kind: 'trusted-config',
      relativePath: 'permissions.json',
      displayPath: '~/.piwin/permissions.json',
    });
    expect(
      planDocumentOpenPath({
        path: '/var/piwin-root/permissions.json',
        projectPath: '/workspace',
      }).kind,
    ).toBe('legacy-absolute');
  });

  it('dispatches media vault paths to the media viewer with and without a project', () => {
    const vaultPath = '/Users/t/.piwin/media/session-1/0b1c2d.jpg';
    for (const projectPath of [null, '/workspace', '/Users/t']) {
      expect(planDocumentOpenPath({ path: vaultPath, projectPath })).toEqual({
        kind: 'media',
        absolutePath: vaultPath,
        assetId: null,
        displayPath: vaultPath,
      });
    }
  });

  it('dispatches by store identity, not extension: vault .txt is still media', () => {
    const plan = planDocumentOpenPath({
      path: '/Users/t/.piwin/media/session-1/notes.txt',
      projectPath: '/workspace',
    });
    expect(plan.kind).toBe('media');
  });

  it('extracts the asset id from remote-asset refs', () => {
    const plan = planDocumentOpenPath({ path: 'remote-asset:asset-77', projectPath: '/w' });
    expect(plan).toEqual({
      kind: 'media',
      absolutePath: 'remote-asset:asset-77',
      assetId: 'asset-77',
      displayPath: 'remote-asset:asset-77',
    });
  });

  it('keeps relative media-looking paths project-relative', () => {
    // 'media/…' without a vault/absolute prefix is an ordinary project path.
    const plan = planDocumentOpenPath({ path: 'media/session-1/a.jpg', projectPath: '/w' });
    expect(plan).toEqual({
      kind: 'project',
      projectPath: '/w',
      relativePath: 'media/session-1/a.jpg',
      displayPath: 'media/session-1/a.jpg',
    });
  });

  it('builds a zh unavailable stub for outside-project paths', () => {
    const stub = buildDocumentUnavailableStub({
      title: 'SKILL',
      displayPath: '/Applications/x/SKILL.md',
      reason: 'outside-project',
    });
    expect(stub).toContain('无法将此路径作为项目文件预览');
    expect(stub).toContain('/Applications/x/SKILL.md');
  });
});
