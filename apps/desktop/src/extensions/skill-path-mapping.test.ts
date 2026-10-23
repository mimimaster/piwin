import { describe, expect, it } from 'vitest';
import { nextSkillsConfigForMapping } from './skill-path-mapping.js';

describe('nextSkillsConfigForMapping', () => {
  it('adds a path and keeps disabled ids', () => {
    expect(
      nextSkillsConfigForMapping({ extraPaths: ['/a'], disabledIds: ['x'] }, '~/.claude/skills', true),
    ).toEqual({ extraPaths: ['/a', '~/.claude/skills'], disabledIds: ['x'] });
  });

  it('removes a mapped path', () => {
    expect(
      nextSkillsConfigForMapping({ extraPaths: ['/a', '/b'], disabledIds: [] }, '/a', false),
    ).toEqual({ extraPaths: ['/b'], disabledIds: [] });
  });

  it('returns undefined when nothing changes', () => {
    expect(nextSkillsConfigForMapping({ extraPaths: ['/a'], disabledIds: [] }, '/a', true)).toBeUndefined();
    expect(nextSkillsConfigForMapping(undefined, '/a', false)).toBeUndefined();
  });
});
