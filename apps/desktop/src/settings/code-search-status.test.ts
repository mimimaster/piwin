import { describe, expect, it } from 'vitest';

import { describeCodeSearchStatus, type CodeSearchStatusFacts } from './code-search-status';

const ready: CodeSearchStatusFacts = {
  enabled: true,
  persistedEnabled: true,
  dirty: false,
  missingStep: undefined,
};

describe('describeCodeSearchStatus', () => {
  it('reports off first, even when a step is also missing', () => {
    const status = describeCodeSearchStatus({ ...ready, enabled: false, missingStep: 'x' }, true);
    expect(status.tone).toBe('off');
    expect(status.detail).toContain('不会出现');
  });

  it('warns that saving will turn a persisted feature off', () => {
    const status = describeCodeSearchStatus({ ...ready, enabled: false, dirty: true }, true);
    expect(status.detail).toContain('保存后');
  });

  it('surfaces the missing step before unsaved changes', () => {
    const status = describeCodeSearchStatus({ ...ready, dirty: true, missingStep: '连接 Devin' }, true);
    expect(status).toMatchObject({ tone: 'blocked', detail: '连接 Devin' });
  });

  it('is pending while unsaved or not yet persisted', () => {
    expect(describeCodeSearchStatus({ ...ready, dirty: true }, true).tone).toBe('pending');
    expect(describeCodeSearchStatus({ ...ready, persistedEnabled: false }, false).tone).toBe('pending');
  });

  it('is ready once enabled, saved and complete', () => {
    expect(describeCodeSearchStatus(ready, false)).toMatchObject({ tone: 'ready', title: 'Active' });
  });
});
