import { describe, expect, it } from 'vitest';
import { resolveSubagentParentLocation } from './subagent-parent-scope.js';

describe('resolveSubagentParentLocation', () => {
  it('preserves project scope while allowing a later worktree cwd', () => {
    expect(
      resolveSubagentParentLocation(
        {
          projectPath: '/repo/piwin',
          scope: { kind: 'project', projectPath: '/repo/piwin' },
        },
        'worktree',
        '/general',
      ),
    ).toEqual({
      scope: { kind: 'project', projectPath: '/repo/piwin' },
      workspacePath: '/repo/piwin',
    });
  });

  it('preserves General scope for readonly children', () => {
    expect(
      resolveSubagentParentLocation(
        { projectPath: '', scope: { kind: 'general' } },
        'readonly',
        '/general',
      ),
    ).toEqual({ scope: { kind: 'general' }, workspacePath: '/general' });
  });

  it('rejects General worktree admission before child allocation', () => {
    expect(() =>
      resolveSubagentParentLocation(
        { projectPath: '', scope: { kind: 'general' } },
        'worktree',
        '/general',
      ),
    ).toThrow('worktree subagents require a project-scoped parent session');
  });

  it('normalizes legacy project records without scope', () => {
    expect(
      resolveSubagentParentLocation(
        { projectPath: ' /repo/legacy ' },
        'readonly',
        '/general',
      ),
    ).toEqual({
      scope: { kind: 'project', projectPath: '/repo/legacy' },
      workspacePath: '/repo/legacy',
    });
  });
});
