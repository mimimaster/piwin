import { describe, expect, it } from 'vitest';
import {
  buildDocumentUnavailableStub,
  isPathInsideProjectRoot,
  planDocumentOpenPath,
} from './document-open-path';

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
