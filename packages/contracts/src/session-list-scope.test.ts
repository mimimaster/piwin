import { describe, expect, it } from 'vitest';
import type { HostCommand, SessionListScopeRef } from './index.js';

describe('SessionListScopeRef', () => {
  it('lists a project by opaque id, not a path', () => {
    const scopeRef: SessionListScopeRef = { kind: 'project', projectId: 'project-abc' };
    const command: HostCommand = { type: 'session/list', scopeRef };
    expect(JSON.stringify(scopeRef)).not.toContain('/');
    expect('scope' in command && command.scope !== undefined).toBe(false);
  });
});
