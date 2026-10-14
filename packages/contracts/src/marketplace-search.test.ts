import { describe, expect, it } from 'vitest';
import { parsePiPackageSourceInput } from './marketplace-search.js';

describe('parsePiPackageSourceInput', () => {
  it('recognizes npm names, pinned versions, GitHub URLs and absolute paths', () => {
    expect(parsePiPackageSourceInput('pi install npm:pi-lens')).toMatchObject({
      ok: true,
      source: { kind: 'npm', packageName: 'pi-lens' },
    });
    expect(parsePiPackageSourceInput('@scope/pkg@1.2.3')).toMatchObject({
      ok: true,
      source: { kind: 'npm', packageName: '@scope/pkg', version: '1.2.3' },
    });
    expect(parsePiPackageSourceInput('git:github.com/o/r')).toMatchObject({
      ok: true,
      source: { kind: 'git', repositoryUrl: 'https://github.com/o/r' },
    });
    expect(parsePiPackageSourceInput('https://github.com/o/r.git')).toMatchObject({
      ok: true,
      source: { kind: 'git', repositoryUrl: 'https://github.com/o/r' },
    });
    expect(parsePiPackageSourceInput('/Users/me/pkg')).toMatchObject({ ok: true, source: { kind: 'local', path: '/Users/me/pkg' } });
  });

  it('rejects empty and unrecognized input', () => {
    expect(parsePiPackageSourceInput('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePiPackageSourceInput('https://gitlab.com/o/r')).toEqual({ ok: false, reason: 'unrecognized' });
    expect(parsePiPackageSourceInput('Not A Package')).toEqual({ ok: false, reason: 'unrecognized' });
  });
});
