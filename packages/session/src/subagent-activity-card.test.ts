import { describe, expect, it } from 'vitest';
import {
  buildSubagentActivityView,
  formatSubagentActivityText,
  mapSubagentStatusToActivityState,
} from './subagent-activity-card.js';

describe('subagent activity card', () => {
  it('maps lifecycle states', () => {
    expect(mapSubagentStatusToActivityState('running', false)).toBe('running');
    expect(mapSubagentStatusToActivityState('done', false)).toBe('completed');
    expect(mapSubagentStatusToActivityState('failed', false)).toBe('failed');
    expect(mapSubagentStatusToActivityState('cancelled', false)).toBe('cancelled');
    expect(mapSubagentStatusToActivityState('done', true)).toBe('merged');
  });

  it('builds a readable activity view', () => {
    const view = buildSubagentActivityView({
      childSessionId: 'child-1',
      displayName: 'Explore',
      task: 'Find the bug',
      status: 'running',
      worktreePath: '/tmp/wt',
    });
    expect(view.state).toBe('running');
    expect(formatSubagentActivityText(view)).toContain('childSessionId=child-1');
    expect(formatSubagentActivityText(view)).toContain('Find the bug');
  });
});
