import { describe, expect, it } from 'vitest';
import { sessionScopeKey } from './session-scope-key';

describe('sessionScopeKey', () => {
  it('uses collision-free keys for General and project paths', () => {
    expect(sessionScopeKey({ kind: 'general' })).toBe('general');
    expect(sessionScopeKey({ kind: 'project', projectPath: '/project' })).toBe('project:/project');
  });
});
