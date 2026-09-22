import { describe, expect, it } from 'vitest';
import { isSessionPlanDisplayPath, sessionPlanDisplayPath } from './plan-document-path';

describe('session plan display path', () => {
  it('matches only the current session logical path', () => {
    const path = sessionPlanDisplayPath('session-1');
    expect(path).toBe('plans/session-1.md');
    expect(isSessionPlanDisplayPath(path, 'session-1')).toBe(true);
    expect(isSessionPlanDisplayPath('file://plans/session-1.md', 'session-1')).toBe(true);
    expect(isSessionPlanDisplayPath('plans\\session-1.md', 'session-1')).toBe(true);
    expect(isSessionPlanDisplayPath('docs/plans/session-1.md', 'session-1')).toBe(false);
    expect(isSessionPlanDisplayPath('plans/session-2.md', 'session-1')).toBe(false);
  });
});
