import { access, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureGeneralWorkspace } from './general-workspace.js';
import { getPiwinGeneralWorkspacePath } from './paths.js';
import {
  indexProjectPathForScope,
  resolveListFilter,
  resolveSessionLocation,
  resolveSessionScopeFromInput,
} from './session-scope.js';

describe('general workspace', () => {
  it('creates PIWIN_ROOT/workspace idempotently', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-general-ws-'));
    const first = await ensureGeneralWorkspace(rootDir);
    const second = await ensureGeneralWorkspace(rootDir);
    expect(first).toBe(getPiwinGeneralWorkspacePath(rootDir));
    expect(second).toBe(first);
    const stats = await stat(first);
    expect(stats.isDirectory()).toBe(true);
    await access(first);
  });
});

describe('session-scope resolution', () => {
  it('defaults to general when no projectPath or scope', () => {
    expect(resolveSessionScopeFromInput({})).toEqual({ kind: 'general' });
  });

  it('treats bare projectPath as project scope', () => {
    expect(resolveSessionScopeFromInput({ projectPath: '/tmp/demo' })).toEqual({
      kind: 'project',
      projectPath: '/tmp/demo',
    });
  });

  it('prefers explicit general scope over projectPath', () => {
    expect(
      resolveSessionScopeFromInput({
        scope: { kind: 'general' },
        projectPath: '/tmp/should-ignore',
      }),
    ).toEqual({ kind: 'general' });
  });

  it('resolves general location under product root workspace', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-scope-loc-'));
    const location = await resolveSessionLocation({ scope: { kind: 'general' } }, rootDir);
    expect(location.scope).toEqual({ kind: 'general' });
    expect(location.workingDirectory).toBe(getPiwinGeneralWorkspacePath(rootDir));
  });

  it('index project path is empty for general and path for project', () => {
    expect(indexProjectPathForScope({ kind: 'general' })).toBe('');
    expect(
      indexProjectPathForScope({ kind: 'project', projectPath: '/tmp/p' }),
    ).toBe('/tmp/p');
  });

  it('list filter defaults to general', () => {
    expect(resolveListFilter({})).toEqual({ kind: 'general' });
    expect(resolveListFilter({ projectPath: '/tmp/p' })).toBe('/tmp/p');
    expect(resolveListFilter({ scope: { kind: 'general' } })).toEqual({ kind: 'general' });
  });
});
