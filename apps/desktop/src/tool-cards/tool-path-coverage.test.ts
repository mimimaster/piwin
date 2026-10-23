import { describe, expect, it } from 'vitest';
import {
  documentTargetCoversPath,
  isRedundantPathArgsPreview,
  sameToolPath,
  visibleTargetPaths,
} from './tool-path-coverage.js';

const PROJECT = '/Volumes/BigDesk/Projectsys/Projectsys/piwin';
const RELATIVE = 'packages/artifact/src/materialize.test.ts';
const ABSOLUTE = `${PROJECT}/${RELATIVE}`;

describe('sameToolPath', () => {
  it('treats project-relative and absolute paths as the same file', () => {
    expect(sameToolPath(RELATIVE, ABSOLUTE, PROJECT)).toBe(true);
    expect(sameToolPath(ABSOLUTE, RELATIVE, PROJECT)).toBe(true);
  });

  it('does not collapse distinct files', () => {
    expect(sameToolPath(RELATIVE, 'packages/artifact/src/materialize.ts', PROJECT)).toBe(false);
  });
});

describe('documentTargetCoversPath', () => {
  it('covers an absolute targetPath with a project-file relative ref', () => {
    expect(
      documentTargetCoversPath(
        { kind: 'project-file', relativePath: RELATIVE, displayRef: RELATIVE },
        ABSOLUTE,
        PROJECT,
      ),
    ).toBe(true);
  });

  it('covers a skill read by catalog id', () => {
    expect(
      documentTargetCoversPath(
        { kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' },
        '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
        '/workspace',
      ),
    ).toBe(true);
  });
});

describe('visibleTargetPaths', () => {
  it('hides the absolute twin when documentTargets already name the file', () => {
    expect(
      visibleTargetPaths(
        [ABSOLUTE],
        [{ kind: 'project-file', relativePath: RELATIVE, displayRef: RELATIVE }],
        PROJECT,
      ),
    ).toEqual([]);
  });

  it('keeps a path that documentTargets do not cover', () => {
    expect(
      visibleTargetPaths(
        [ABSOLUTE, '/etc/passwd'],
        [{ kind: 'project-file', relativePath: RELATIVE, displayRef: RELATIVE }],
        PROJECT,
      ),
    ).toEqual(['/etc/passwd']);
  });

  it('dedupes relative + absolute targetPaths down to the relative chip', () => {
    expect(visibleTargetPaths([ABSOLUTE, RELATIVE], [], PROJECT)).toEqual([RELATIVE]);
  });
});

describe('isRedundantPathArgsPreview', () => {
  it('hides JSON that only restates an already-shown path', () => {
    expect(
      isRedundantPathArgsPreview(JSON.stringify({ path: ABSOLUTE }), [RELATIVE], PROJECT),
    ).toBe(true);
  });

  it('hides path + line-range args', () => {
    expect(
      isRedundantPathArgsPreview(
        JSON.stringify({ path: ABSOLUTE, offset: 1, limit: 80 }),
        [RELATIVE],
        PROJECT,
      ),
    ).toBe(true);
  });

  it('keeps preview when extra args are not just the path', () => {
    expect(
      isRedundantPathArgsPreview(
        JSON.stringify({ path: ABSOLUTE, query: 'DEFAULT_MAX_ARTIFACT_BYTES' }),
        [RELATIVE],
        PROJECT,
      ),
    ).toBe(false);
  });
});
