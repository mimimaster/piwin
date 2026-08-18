import { describe, expect, it } from 'vitest';
import { projectIdForPath, resolveProjectPathById } from './project-id.js';

describe('projectIdForPath / resolveProjectPathById', () => {
  it('round-trips a registered project path through projectId', () => {
    const path = '/Users/me/work/app';
    const id = projectIdForPath(path);
    expect(resolveProjectPathById([{ path }, { path: '/tmp/other' }], id)).toBe(path);
  });

  it('uses project- + 24-char sha256 prefix (stable remote projection format)', () => {
    const id = projectIdForPath('/Users/me/work/app');
    expect(id).toMatch(/^project-[0-9a-f]{24}$/);
  });

  it('is stable for the same path', () => {
    const path = '/Users/me/work/app';
    expect(projectIdForPath(path)).toBe(projectIdForPath(path));
  });

  it('returns undefined for unknown projectId', () => {
    expect(
      resolveProjectPathById([{ path: '/Users/me/work/app' }], 'project-deadbeefdeadbeefdeadbeef'),
    ).toBeUndefined();
  });

  it('returns undefined for empty projectId', () => {
    expect(resolveProjectPathById([{ path: '/tmp/a' }], '')).toBeUndefined();
  });
});
